/**
 * autoIngestClient.ts — Connection manager for AutoIngest's Phase 2 local
 * control transport (see ../../../../docs/mxControlTransport.md).
 *
 * Owns discovery, the WebSocket connection, authentication, reconnect/
 * backoff, latest-state caching, and requestId-correlated command
 * execution. Individual Logitech actions never touch a socket, the
 * descriptor, or the wire protocol directly — they only call
 * executeCommand()/getLatestState()/subscribe() on a single shared
 * instance (see sharedClient.ts).
 *
 * This class duplicates NO AutoIngest business rules. `executeCommand()`
 * forwards a commandId/payload opaquely and returns exactly what
 * AutoIngest's own AutoIngestCommands.execute() decided — that result is
 * the sole source of truth for whether anything happened.
 */

import WebSocket from 'ws';
import { discoverDescriptor, DescriptorError, type Descriptor } from './descriptor.js';

export type ConnectionState = 'disconnected' | 'discovering' | 'connecting' | 'authenticating' | 'connected';

export interface CommandResult {
  ok: boolean;
  commandId?: string;
  executed?: boolean;
  detail?: unknown;
  reason?: string;
}

/** Mirrors AutoIngestCommands.getState()'s shape — see docs/commandLayer.md. */
export interface AutoIngestState {
  context: 'browse' | 'qmz' | 'import';
  activeFile: string | null;
  selectedCount: number;
  hasSelection: boolean;
  previewOpen: boolean;
  availableCommands: string[];
  groups?: Array<{ id: number; label: string; fileCount: number; subEventId: unknown; colorIndex: number }>;
  sequences?: Array<{ code: string; count: number }>;
}

export interface ClientSnapshot {
  connectionState: ConnectionState;
  state: AutoIngestState | null;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type Logger = (level: LogLevel, message: string) => void;
type Listener = (snapshot: ClientSnapshot) => void;

const PROTOCOL_VERSION = 1;
const COMMAND_TIMEOUT_MS = 8000;
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 15000;

/** Silent by default — callers (sharedClient.ts) supply a real logger. */
const NOOP_LOGGER: Logger = () => {};

export class AutoIngestClient {
  private ws: WebSocket | null = null;
  private connectionState: ConnectionState = 'disconnected';
  private latestState: AutoIngestState | null = null;
  private listeners = new Set<Listener>();
  private pending = new Map<string, { resolve: (r: CommandResult) => void; timer: NodeJS.Timeout }>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private stopped = true;
  private requestCounter = 0;
  private readonly log: Logger;
  private readonly homeOverride: string | undefined;

  /**
   * @param logger Sink for connection/lifecycle diagnostics.
   * @param homeOverride Test-only seam threaded to descriptor discovery
   *   (see descriptor.ts) — never set outside tests.
   */
  constructor(logger: Logger = NOOP_LOGGER, homeOverride?: string) {
    this.log = logger;
    this.homeOverride = homeOverride;
  }

  /** Public logging passthrough so actions can report their own outcomes
   *  through the same channel/conventions without owning a logger. */
  logMessage(level: LogLevel, message: string): void {
    this.log(level, message);
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  getLatestState(): AutoIngestState | null {
    return this.latestState;
  }

  /** Subscribes to every connection-state transition and state push.
   *  Fires once immediately with the current snapshot. Returns an
   *  unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this._snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Starts discovery + connection, with automatic reconnect on failure/
   *  disconnect. Idempotent — calling while already connecting/connected
   *  is a no-op. */
  async connect(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.reconnectAttempt = 0;
    await this._attemptConnect();
  }

  /** Stops reconnect attempts and closes any open connection. Safe to call
   *  even if never connected. */
  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    for (const [, pending] of this.pending) clearTimeout(pending.timer);
    this.pending.clear();
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {
        /* socket may already be gone */
      }
      this.ws = null;
    }
    this.latestState = null;
    this._setConnectionState('disconnected');
  }

  /**
   * Forwards commandId/payload to AutoIngest's real command registry.
   * Never duplicates canExecute()/isValid() logic — the returned result IS
   * the authoritative outcome. Resolves (never rejects) even when not
   * connected, so a caller never needs its own try/catch for transport
   * failures.
   */
  async executeCommand(commandId: string, payload?: unknown): Promise<CommandResult> {
    if (!this.ws || this.connectionState !== 'connected') {
      return { ok: false, commandId, reason: 'not-connected' };
    }
    const requestId = `mx-plugin-${Date.now()}-${this.requestCounter++}`;
    const ws = this.ws;
    return new Promise<CommandResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve({ ok: false, commandId, reason: 'plugin-timeout' });
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(requestId, { resolve, timer });
      try {
        ws.send(JSON.stringify({ type: 'executeCommand', requestId, commandId, payload }));
      } catch (err) {
        this.pending.delete(requestId);
        clearTimeout(timer);
        resolve({ ok: false, commandId, reason: `send-failed: ${(err as Error).message}` });
      }
    });
  }

  // ── Internal ─────────────────────────────────────────────────────────

  private async _attemptConnect(): Promise<void> {
    if (this.stopped) return;

    this._setConnectionState('discovering');
    let descriptor: Descriptor;
    try {
      descriptor = await discoverDescriptor(this.homeOverride);
    } catch (err) {
      const code = err instanceof DescriptorError ? err.code : 'unknown';
      this.log('debug', `descriptor not available (${code}) — will retry`);
      this._setConnectionState('disconnected');
      this._scheduleReconnect();
      return;
    }

    this._setConnectionState('connecting');
    this.log('info', `connecting to AutoIngest on 127.0.0.1:${descriptor.port}`);

    let ws: WebSocket;
    try {
      // Loopback only — never anything other than 127.0.0.1, matching the
      // transport's own binding guarantee (docs/mxControlTransport.md).
      ws = new WebSocket(`ws://127.0.0.1:${descriptor.port}`);
    } catch (err) {
      this.log('warn', `failed to open socket: ${(err as Error).message}`);
      this._setConnectionState('disconnected');
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on('open', () => {
      this._setConnectionState('authenticating');
      ws.send(JSON.stringify({ type: 'hello', token: descriptor.token, protocolVersion: PROTOCOL_VERSION }));
    });

    ws.on('message', (raw: WebSocket.RawData) => this._handleMessage(raw));

    ws.on('close', () => {
      const wasConnected = this.connectionState === 'connected';
      this.log(wasConnected ? 'info' : 'debug', 'AutoIngest disconnected');
      this.ws = null;
      this.latestState = null;
      for (const [, pending] of this.pending) clearTimeout(pending.timer);
      this.pending.clear();
      if (!this.stopped) {
        this._setConnectionState('disconnected');
        this._scheduleReconnect();
      }
    });

    ws.on('error', (err: Error) => {
      this.log('debug', `socket error: ${err.message}`);
    });
  }

  private _handleMessage(raw: WebSocket.RawData): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString('utf8'));
    } catch {
      return; // malformed frame from a well-behaved server should never happen; ignore rather than crash
    }

    switch (msg.type) {
      case 'ready': {
        if (msg.protocolVersion !== PROTOCOL_VERSION) {
          this.log('warn', `protocol mismatch (server=${String(msg.protocolVersion)}, plugin=${PROTOCOL_VERSION}) — disconnecting`);
          this.ws?.close();
          return;
        }
        this.reconnectAttempt = 0;
        this._setConnectionState('connected');
        this.log('info', 'authenticated');
        break;
      }
      case 'state': {
        this.latestState = (msg.state as AutoIngestState | null) ?? null;
        this._notify();
        break;
      }
      case 'commandResult': {
        const requestId = msg.requestId as string;
        const pending = this.pending.get(requestId);
        if (!pending) return; // already timed out or unsolicited — ignore, never throw
        this.pending.delete(requestId);
        clearTimeout(pending.timer);
        pending.resolve(msg.result as CommandResult);
        break;
      }
      case 'error': {
        this.log('warn', `server error: ${String(msg.code)}`);
        if (msg.code === 'invalid-token' || msg.code === 'protocol-mismatch' || msg.code === 'already-connected') {
          this.ws?.close();
        }
        break;
      }
      default:
        this.log('debug', `unhandled message type: ${String(msg.type)}`);
    }
  }

  private _scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    // Modest exponential backoff — this is process discovery (is AutoIngest
    // running yet/again?), not application-state polling, so a slower cadence
    // than the transport's own state pushes is appropriate. Never hammers
    // the descriptor file or a closed socket.
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_DELAY_MS);
    this.reconnectAttempt++;
    this.log('debug', `reconnect scheduled in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this._attemptConnect();
    }, delay);
  }

  private _setConnectionState(state: ConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this._notify();
  }

  private _notify(): void {
    const snapshot = this._snapshot();
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot);
      } catch (err) {
        this.log('error', `a state listener threw: ${(err as Error).message}`);
      }
    }
  }

  private _snapshot(): ClientSnapshot {
    return { connectionState: this.connectionState, state: this.latestState };
  }
}
