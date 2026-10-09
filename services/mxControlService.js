/**
 * mxControlService.js — MX Console local control transport (Phase 2).
 *
 * A narrow, localhost-only WebSocket bridge so a FUTURE external process
 * (the Logitech MX Creative Console plugin, or any other local controller)
 * can, once it exists:
 *
 *   1. query AutoIngest's current command-layer state
 *   2. request execution of an already-registered AutoIngestCommands command
 *   3. receive AutoIngest state-change notifications
 *
 * This module implements ONLY the transport. It contains no Logitech-specific
 * code, no command logic of its own, and no renderer/DOM access — it is a
 * thin, authenticated relay in front of the renderer's own
 * AutoIngestCommands registry (renderer/commandManager.js), reached only
 * through the existing narrow preload/IPC surface (mx-control:* channels in
 * main/preload.js). See docs/mxControlTransport.md for the full design.
 *
 * Security model:
 *   - Binds to 127.0.0.1 ONLY (never 0.0.0.0, never a LAN/IPv6-wildcard
 *     address) — the OS assigns an ephemeral port (`listen(0, ...)`), never
 *     a hardcoded one.
 *   - A high-entropy token (crypto.randomBytes(32), 256 bits) is generated
 *     fresh every time this service starts and lives only in memory — never
 *     hardcoded, never committed, invalid the moment the process exits.
 *     Localhost alone is NEVER treated as sufficient authentication.
 *   - The token is discoverable only via a restrictive-permission descriptor
 *     file this service writes atomically to <userData>/mx-control.json and
 *     deletes on clean shutdown — see docs/mxControlTransport.md "Discovery".
 *   - Exactly one authenticated client at a time (see CLIENT POLICY below).
 *   - executeCommand payloads are forwarded OPAQUELY to
 *     AutoIngestCommands.execute() in the renderer — this module never
 *     duplicates canExecute()/isValid() eligibility logic, never exposes
 *     eval/arbitrary function invocation/filesystem/shell access, and never
 *     talks to the renderer directly (only through main/preload.js's
 *     existing narrow, explicit IPC channels).
 *
 * Usage (main.js):
 *   const mxControlService = require('../services/mxControlService');
 *   await mxControlService.init({ getMainWindow: () => currentMainWindow });
 *   // ...
 *   app.on('before-quit', () => mxControlService.shutdown());
 */

'use strict';

const fsp    = require('fs').promises;
const path   = require('path');
const http   = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');
const { log } = require('./logger');

const PROTOCOL_VERSION = 1;

// Auth handshake must complete within this window or the socket is dropped —
// protects against a connection that opens and then sends nothing/garbage.
const AUTH_TIMEOUT_MS = 5_000;

// Generous message-size cap (JSON command/state payloads are tiny; this is a
// sanity ceiling against abuse, not a realistic legitimate size).
const MAX_PAYLOAD_BYTES = 64 * 1024;

// Message-rate sanity net. An MX dial can legitimately fire rapid
// navigation/selection commands, so this must stay generous — it exists only
// to stop a runaway/broken client from hammering the main process, never to
// throttle real dial usage.
const MAX_MESSAGES_PER_WINDOW = 200;
const MESSAGE_WINDOW_MS       = 1_000;

// Unauthenticated sockets allowed to be "in flight" at once (before hello
// succeeds or the auth timeout fires) — a small cap against trivial local
// connection-flood abuse, independent of the single-authenticated-client rule.
const MAX_PENDING_CONNECTIONS = 5;

// Safety net if the renderer never replies to a forwarded executeCommand
// (e.g. it crashed or reloaded mid-flight) — the WS client still gets a
// definite, honest answer instead of hanging forever.
const COMMAND_TIMEOUT_MS = 8_000;

let _httpServer          = null;
let _wss                 = null;
let _token                = null;
let _port                 = null;
let _descriptorPath       = null;
let _getMainWindow        = null;
let _authenticatedClient  = null;   // the one active, authenticated ws connection, or null
const _pendingConnections = new Set();   // unauthenticated sockets currently open
const _pendingCommands    = new Map();   // requestId -> { resolve, timer }
let _lastState              = null;   // last state the renderer reported (cache, never polled)
let _lastBroadcastStateJson = null;   // dedup marker for the CURRENT authenticated client
let _ipcWired = false;
let _started  = false;

function _resolveDescriptorPath() {
  if (_descriptorPath) return _descriptorPath;
  const { app } = require('electron');
  _descriptorPath = path.join(app.getPath('userData'), 'mx-control.json');
  return _descriptorPath;
}

/**
 * Atomic write, mirroring services/fileUtils.js's safeWrite tmp+rename
 * pattern, plus a restrictive chmod applied to the .tmp file BEFORE the
 * rename so the final file is never briefly world-readable.
 */
async function _writeDescriptorAtomic(data) {
  const finalPath = _resolveDescriptorPath();
  const tmpPath   = `${finalPath}.tmp`;
  await fsp.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  try { await fsp.chmod(tmpPath, 0o600); }
  catch (err) { log(`[mx-control] descriptor chmod not supported on this platform: ${err.message}`); }
  await fsp.rename(tmpPath, finalPath);
}

async function _removeDescriptor() {
  try { await fsp.unlink(_resolveDescriptorPath()); }
  catch (err) { if (err.code !== 'ENOENT') log(`[mx-control] descriptor cleanup failed: ${err.message}`); }
}

function _send(ws, obj) {
  try { ws.send(JSON.stringify(obj)); }
  catch (err) { log(`[mx-control] send failed: ${err.message}`); }
}

/** Timing-safe token comparison — avoids leaking match-length via timing. */
function _tokensMatch(candidate) {
  if (typeof candidate !== 'string' || !_token) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(_token);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ── Renderer IPC glue (narrow, explicit channels only — see main/preload.js) ──

function _wireRendererIpc() {
  if (_ipcWired) return;
  _ipcWired = true;
  const { ipcMain } = require('electron');

  // The renderer pushes its OWN full state whenever AutoIngestCommands'
  // subscribe() fires, plus one bootstrap push right after it wires up (see
  // renderer/mxControlAdapter.js) — this service never calls getState() on
  // the renderer and never polls.
  ipcMain.on('mx-control:state-changed', (_event, state) => {
    _lastState = state;
    _broadcastStateIfChanged();
  });

  ipcMain.on('mx-control:command-result', (_event, msg) => {
    const requestId = msg && msg.requestId;
    const pending = _pendingCommands.get(requestId);
    if (!pending) return; // already timed out, or an unsolicited/duplicate reply — ignore, never throw
    _pendingCommands.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(msg.result);
  });
}

function _broadcastStateIfChanged() {
  if (!_authenticatedClient) return;
  const json = JSON.stringify(_lastState);
  // Avoid spamming duplicate snapshots when the renderer's subscribe() fires
  // but the value hasn't actually changed by content.
  if (json === _lastBroadcastStateJson) return;
  _lastBroadcastStateJson = json;
  _send(_authenticatedClient, { type: 'state', state: _lastState });
}

// ── Connection handling ────────────────────────────────────────────────────

function _handleConnection(ws) {
  if (_pendingConnections.size >= MAX_PENDING_CONNECTIONS) {
    ws.close(1013, 'too many pending connections');
    return;
  }
  ws._mxAuthenticated = false;
  ws._mxMessageTimes  = [];
  _pendingConnections.add(ws);

  const authTimer = setTimeout(() => {
    if (!ws._mxAuthenticated) {
      log('[mx-control] client auth timeout');
      try { ws.close(4001, 'auth timeout'); } catch { /* socket may already be gone */ }
    }
  }, AUTH_TIMEOUT_MS);

  ws.on('message', (raw) => _handleMessage(ws, raw));
  ws.on('close', () => _handleClose(ws, authTimer));
  ws.on('error', (err) => log(`[mx-control] socket error: ${err.message}`));
}

function _handleMessage(ws, raw) {
  const now = Date.now();
  ws._mxMessageTimes = ws._mxMessageTimes.filter((t) => now - t < MESSAGE_WINDOW_MS);
  ws._mxMessageTimes.push(now);
  if (ws._mxMessageTimes.length > MAX_MESSAGES_PER_WINDOW) {
    log('[mx-control] client exceeded message-rate sanity limit — disconnecting');
    try { ws.close(1008, 'rate limit'); } catch { /* ignore */ }
    return;
  }

  let msg;
  try { msg = JSON.parse(raw.toString('utf8')); }
  catch {
    log('[mx-control] malformed request (invalid JSON)');
    _send(ws, { type: 'error', code: 'invalid-json', message: 'Malformed JSON' });
    try { ws.close(1003, 'invalid json'); } catch { /* ignore */ }
    return;
  }

  if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
    _send(ws, { type: 'error', code: 'invalid-message', message: 'Message must be an object with a string "type"' });
    return;
  }

  if (!ws._mxAuthenticated) {
    if (msg.type !== 'hello') {
      log('[mx-control] rejected pre-auth message (not hello)');
      _send(ws, { type: 'error', code: 'unauthenticated', message: 'Send hello first' });
      try { ws.close(4003, 'unauthenticated'); } catch { /* ignore */ }
      return;
    }
    _handleHello(ws, msg);
    return;
  }

  switch (msg.type) {
    case 'getState':
      _send(ws, {
        type: 'state',
        requestId: typeof msg.requestId === 'string' ? msg.requestId : undefined,
        state: _lastState,
      });
      break;
    case 'executeCommand':
      _handleExecuteCommand(ws, msg);
      break;
    case 'hello':
      _send(ws, { type: 'error', code: 'already-authenticated', message: 'Already authenticated' });
      break;
    default:
      _send(ws, { type: 'error', code: 'unknown-message-type', message: `Unknown type: ${msg.type}` });
  }
}

function _handleHello(ws, msg) {
  if (msg.protocolVersion !== PROTOCOL_VERSION) {
    log(`[mx-control] client protocol mismatch (got ${msg.protocolVersion})`);
    _send(ws, {
      type: 'error',
      code: 'protocol-mismatch',
      message: `Unsupported protocolVersion`,
      serverProtocolVersion: PROTOCOL_VERSION,
    });
    try { ws.close(4004, 'protocol mismatch'); } catch { /* ignore */ }
    return;
  }

  if (!_tokensMatch(msg.token)) {
    // Never log the token itself, valid or invalid.
    log('[mx-control] client sent an invalid token');
    _send(ws, { type: 'error', code: 'invalid-token', message: 'Authentication failed' });
    try { ws.close(4001, 'invalid token'); } catch { /* ignore */ }
    return;
  }

  if (_authenticatedClient && _authenticatedClient.readyState === WebSocket.OPEN) {
    log('[mx-control] rejected second client — one already connected');
    _send(ws, { type: 'error', code: 'already-connected', message: 'Another client is already connected' });
    try { ws.close(4009, 'already connected'); } catch { /* ignore */ }
    return;
  }

  ws._mxAuthenticated = true;
  _pendingConnections.delete(ws);
  _authenticatedClient = ws;
  log('[mx-control] client authenticated');

  _send(ws, { type: 'ready', protocolVersion: PROTOCOL_VERSION });
  // "On initial authenticated connection: send the current complete state
  // once." _lastState is null (sent as null, never fabricated) if the
  // renderer hasn't reported anything yet — fail closed, per Phase 2 §9.
  _send(ws, { type: 'state', state: _lastState });
  _lastBroadcastStateJson = JSON.stringify(_lastState);
}

function _handleExecuteCommand(ws, msg) {
  const requestId = msg.requestId;
  if (typeof requestId !== 'string' || !requestId) {
    _send(ws, { type: 'error', code: 'invalid-message', message: 'executeCommand requires a string requestId' });
    return;
  }
  if (typeof msg.commandId !== 'string' || !msg.commandId) {
    _send(ws, { type: 'commandResult', requestId, result: { ok: false, reason: 'invalid-payload' } });
    return;
  }

  const win = _getMainWindow ? _getMainWindow() : null;
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
    // Fail closed — never invent a result when there is no renderer to ask.
    log('[mx-control] executeCommand with no renderer available — failing closed');
    _send(ws, { type: 'commandResult', requestId, result: { ok: false, commandId: msg.commandId, reason: 'renderer-not-ready' } });
    return;
  }

  log(`[mx-control] command requested: ${msg.commandId}`);

  const timer = setTimeout(() => {
    if (_pendingCommands.delete(requestId)) {
      log(`[mx-control] command timed out waiting for renderer: ${msg.commandId}`);
      _send(ws, { type: 'commandResult', requestId, result: { ok: false, commandId: msg.commandId, reason: 'renderer-timeout' } });
    }
  }, COMMAND_TIMEOUT_MS);

  _pendingCommands.set(requestId, {
    resolve: (result) => {
      // group.assign's own result carries { detail: { groupId, claim } } (see
      // commandManager.js's computeExecuted for 'group.assign') — surface which
      // group a hardware assign actually landed on, for console-side diagnosis.
      // Still logging the result object the renderer already returned, not the
      // request payload — the "payload forwarded opaquely" rule above is unchanged.
      const groupSuffix = (result && result.detail && typeof result.detail.groupId === 'number')
        ? ` groupId=${result.detail.groupId}`
        : '';
      log(`[mx-control] command result: ${msg.commandId} ok=${!!(result && result.ok)}${groupSuffix}`);
      _send(ws, { type: 'commandResult', requestId, result });
    },
    timer,
  });

  // Payload is forwarded OPAQUELY — AutoIngestCommands.execute()'s own
  // isValid()/check() in the renderer is the only validation. This service
  // never duplicates command eligibility logic (no allowlist copy, no
  // reimplementation of canExecute()).
  win.webContents.send('mx-control:execute-command', { requestId, commandId: msg.commandId, payload: msg.payload });
}

function _handleClose(ws, authTimer) {
  clearTimeout(authTimer);
  _pendingConnections.delete(ws);
  if (_authenticatedClient === ws) {
    log('[mx-control] client disconnected');
    _authenticatedClient = null;
    _lastBroadcastStateJson = null; // the next client always gets a fresh, un-deduped initial state
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

function _startServer() {
  return new Promise((resolve, reject) => {
    _httpServer = http.createServer();
    _wss = new WebSocket.Server({ server: _httpServer, maxPayload: MAX_PAYLOAD_BYTES });
    _wss.on('connection', (ws) => _handleConnection(ws));
    _httpServer.once('error', (err) => reject(err));
    // Port 0 → OS assigns an ephemeral free port. Host is explicit and
    // literal — 127.0.0.1 only, never 0.0.0.0/::/a LAN interface.
    _httpServer.listen(0, '127.0.0.1', () => {
      _port = _httpServer.address().port;
      resolve();
    });
  });
}

/**
 * Starts the control service: generates a fresh session token, starts the
 * loopback-only WebSocket server on an OS-assigned port, and writes the
 * discovery descriptor. Idempotent — a second call while already started is
 * a no-op returning the same descriptor summary.
 *
 * @param {{ getMainWindow: () => import('electron').BrowserWindow|null }} opts
 * @returns {Promise<{ port: number, pid: number, protocolVersion: number }>}
 */
async function init({ getMainWindow } = {}) {
  if (_started) return { port: _port, pid: process.pid, protocolVersion: PROTOCOL_VERSION };
  _getMainWindow = typeof getMainWindow === 'function' ? getMainWindow : () => null;
  _token = crypto.randomBytes(32).toString('hex'); // 256 bits, generated fresh every start — never hardcoded, never persisted beyond this process's lifetime
  _wireRendererIpc();
  await _startServer();
  _started = true;
  await _writeDescriptorAtomic({ port: _port, token: _token, pid: process.pid, protocolVersion: PROTOCOL_VERSION });
  log(`[mx-control] service started on 127.0.0.1:${_port} (pid ${process.pid}, protocolVersion ${PROTOCOL_VERSION})`);
  return { port: _port, pid: process.pid, protocolVersion: PROTOCOL_VERSION };
}

/**
 * Stops the control service: closes all sockets, clears pending command
 * timers, closes the server, and removes the discovery descriptor so a
 * stale port/token is never left discoverable after a clean exit.
 */
async function shutdown() {
  if (!_started) return;
  _started = false;

  if (_authenticatedClient) { try { _authenticatedClient.close(1001, 'server shutting down'); } catch { /* ignore */ } }
  for (const ws of _pendingConnections) { try { ws.close(1001, 'server shutting down'); } catch { /* ignore */ } }
  _pendingConnections.clear();
  _authenticatedClient = null;

  for (const [, pending] of _pendingCommands) clearTimeout(pending.timer);
  _pendingCommands.clear();

  if (_wss) { try { _wss.close(); } catch { /* ignore */ } _wss = null; }
  if (_httpServer) {
    await new Promise((resolve) => _httpServer.close(() => resolve()));
    _httpServer = null;
  }

  await _removeDescriptor();

  _port  = null;
  _token = null;
  _lastState = null;
  _lastBroadcastStateJson = null;
  log('[mx-control] service stopped, descriptor removed');
}

module.exports = { init, shutdown, PROTOCOL_VERSION };
