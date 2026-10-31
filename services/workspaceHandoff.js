/**
 * workspaceHandoff.js — asks the EXISTING main-window workspace to open a camera card
 * (AI-FEAT-061 Q2/Q4 handoff, the approved non-visual listener).
 *
 * Main focuses (or reopens) the main window, waits until its renderer has finished
 * starting up and announced itself ready, then sends one request:
 *   companion:openSource { requestId, type: 'memory-card', path, label, selectPaths? }
 * The renderer opens the card through its own selectSource() — the same path as
 * choosing the card and pressing Continue — and, when selectPaths is given, selects
 * those files with the workspace's own selection set. Nothing is imported; the
 * operator continues with the normal event, grouping, metadata and Confirm Event
 * Import steps.
 *
 * Every handoff is an explicit OPERATION with one terminal outcome:
 *   pending   → waiting for the workspace / the workspace is opening the card
 *   completed → the card is open (and the files selected)
 *   refused   → the workspace (or main) declined; nothing changed
 *   cancelled → the card was removed, the window closed, or AutoIngest never opened
 *   failed    → the workspace stopped responding, or opening the card failed
 * The renderer acknowledges a request at once (companion:openSourceProgress) and
 * repeats that heartbeat while it works, then answers on companion:openSourceResult.
 * A slow card scan therefore stays "pending" for as long as it is genuinely running;
 * only silence (no acknowledgement, or no heartbeat) is a failure. One operation at a
 * time; a late answer for an operation that already ended is ignored.
 */

'use strict';

// Reopening a closed main window goes through the splash, which waits for the operator.
const READY_TIMEOUT_MS = 120_000;
/** The workspace must acknowledge a request within this time. */
const ACK_TIMEOUT_MS = 15_000;
/** While opening, the workspace sends a heartbeat every ~2 s; this much silence = no response. */
const HEARTBEAT_TIMEOUT_MS = 20_000;
const READY_POLL_MS = 100;

const TERMINAL = new Set(['completed', 'refused', 'cancelled', 'failed']);

/**
 * @param {object} deps
 * @param {import('electron').IpcMain} deps.ipcMain
 * @param {() => import('electron').BrowserWindow|null} deps.getMainWindow
 * @param {() => void} deps.openApp  focus the main window, or reopen it via the splash
 * @param {() => boolean} deps.isBusy
 * @param {(op: object) => void} [deps.onChange]  an operation changed state
 * @param {(msg: string) => void} [deps.log]
 * @param {number} [deps.readyTimeoutMs]
 * @param {number} [deps.ackTimeoutMs]
 * @param {number} [deps.heartbeatTimeoutMs]
 */
function createWorkspaceHandoff({
  ipcMain, getMainWindow, openApp, isBusy, onChange = () => {}, log = () => {},
  readyTimeoutMs = READY_TIMEOUT_MS, ackTimeoutMs = ACK_TIMEOUT_MS, heartbeatTimeoutMs = HEARTBEAT_TIMEOUT_MS,
}) {
  const _ready = new Set();            // webContents ids whose renderer announced ready
  const _watched = new WeakSet();
  let _seq = 0;
  let _registered = false;
  /** The one operation that is not yet terminal (or null). */
  let _active = null;

  function _mainContents() {
    const win = getMainWindow();
    return win && !win.isDestroyed() && !win.webContents.isDestroyed() ? win.webContents : null;
  }

  function _publicView(op) {
    return { id: op.id, sourceId: op.sourceId, state: op.state, phase: op.phase, reason: op.reason, selected: op.selected, startedAt: op.startedAt, endedAt: op.endedAt };
  }

  function _finish(op, state, reason = null, selected = 0) {
    if (TERMINAL.has(op.state)) return;
    op.state = state;
    op.reason = reason;
    op.selected = selected;
    op.endedAt = Date.now();
    clearTimeout(op.timer);
    op.timer = null;
    if (_active === op) _active = null;
    log(`[handoff] #${op.id} ${op.sourceId} → ${state}${reason ? ` (${reason})` : ''}${state === 'completed' ? `, ${selected} selected` : ''}`);
    try { onChange(_publicView(op)); } catch { /* observer errors never affect the handoff */ }
    op.resolve(_publicView(op));
  }

  /** (Re)arms the silence timer: no acknowledgement / heartbeat in time → failed. */
  function _arm(op, ms) {
    clearTimeout(op.timer);
    op.timer = setTimeout(() => _finish(op, 'failed', 'no-response'), ms);
  }

  function _watch(wc) {
    if (_watched.has(wc)) return;
    _watched.add(wc);
    const forget = () => {
      _ready.delete(wc.id);
      if (_active && _active.wcId === wc.id) _finish(_active, 'cancelled', 'workspace-closed');
    };
    wc.on('did-start-loading', forget); // reload: the new page announces ready again
    wc.once('destroyed', forget);
  }

  function _onReady(event) {
    const wc = _mainContents();
    if (!wc || event.sender !== wc) return;
    _watch(wc);
    _ready.add(wc.id);
  }

  function _ownActive(event, msg) {
    if (!msg || typeof msg.requestId !== 'number' || !_active) return null;
    if (_active.id !== msg.requestId || event.sender.id !== _active.wcId) return null;
    return _active;
  }

  function _onProgress(event, msg) {
    const op = _ownActive(event, msg);
    if (!op) return;
    op.phase = 'opening';
    _arm(op, heartbeatTimeoutMs);
    if (!op.acked) { op.acked = true; try { onChange(_publicView(op)); } catch { /* ignore */ } }
  }

  function _onResult(event, msg) {
    const op = _ownActive(event, msg);
    if (!op) return; // unknown, superseded or already-ended operation: ignored
    const r = msg.result && typeof msg.result === 'object' ? msg.result : {};
    const reason = typeof r.reason === 'string' ? r.reason : null;
    if (typeof r.detail === 'string') log(`[handoff] #${op.id} workspace detail: ${r.detail.slice(0, 120)}`);
    if (r.ok === true) _finish(op, 'completed', null, Number.isInteger(r.selected) ? r.selected : 0);
    else if (reason === 'open-failed' || reason === 'error') _finish(op, 'failed', reason);
    else _finish(op, 'refused', reason || 'refused');
  }

  function register() {
    if (_registered) return;
    _registered = true;
    ipcMain.on('companion:workspaceReady', _onReady);
    ipcMain.on('companion:openSourceProgress', _onProgress);
    ipcMain.on('companion:openSourceResult', _onResult);
  }

  function unregister() {
    if (!_registered) return;
    _registered = false;
    ipcMain.removeListener('companion:workspaceReady', _onReady);
    ipcMain.removeListener('companion:openSourceProgress', _onProgress);
    ipcMain.removeListener('companion:openSourceResult', _onResult);
    if (_active) _finish(_active, 'cancelled', 'shutdown');
  }

  async function _waitForReadyWorkspace(op) {
    const deadline = Date.now() + readyTimeoutMs;
    while (Date.now() < deadline && !TERMINAL.has(op.state)) {
      const wc = _mainContents();
      if (wc) { _watch(wc); if (_ready.has(wc.id)) return wc; }
      await new Promise(r => setTimeout(r, READY_POLL_MS));
    }
    return null;
  }

  /**
   * Starts a handoff. Returns at once with the operation; `done` resolves with its
   * terminal state. While another operation is pending, no second one is started.
   * @param {{ sourceId: string, mountpoint: string, label: string, selectPaths?: string[]|null }} req
   * @returns {{ started: boolean, operation: object, done: Promise<object> }}
   */
  function openSource({ sourceId, mountpoint, label, selectPaths = null }) {
    if (_active) return { started: false, operation: _publicView(_active), done: Promise.resolve(_publicView(_active)) };
    let resolve;
    const done = new Promise(r => { resolve = r; });
    const op = {
      id: ++_seq, sourceId, state: 'pending', phase: 'waiting-for-workspace', reason: null, selected: 0,
      startedAt: Date.now(), endedAt: null, wcId: null, acked: false, timer: null, resolve,
    };
    if (isBusy()) {
      _finish(op, 'refused', 'busy');
      return { started: false, operation: _publicView(op), done };
    }
    _active = op;
    try { onChange(_publicView(op)); } catch { /* ignore */ }

    (async () => {
      openApp();
      const wc = await _waitForReadyWorkspace(op);
      if (TERMINAL.has(op.state)) return; // cancelled while waiting (card removed)
      if (!wc) return _finish(op, 'cancelled', 'workspace-not-opened');
      if (isBusy()) return _finish(op, 'refused', 'busy');
      op.wcId = wc.id;
      op.phase = 'sent';
      _arm(op, ackTimeoutMs);
      wc.send('companion:openSource', { requestId: op.id, type: 'memory-card', path: mountpoint, label, selectPaths });
    })().catch((err) => _finish(op, 'failed', `error: ${err && err.message}`));

    return { started: true, operation: _publicView(op), done };
  }

  /** Ends the pending operation for this card (e.g. the card was removed). */
  function cancelForSource(sourceId, reason) {
    if (_active && _active.sourceId === sourceId) _finish(_active, 'cancelled', reason);
  }

  /** @returns {object|null} the pending operation, if any */
  function getActive() { return _active ? _publicView(_active) : null; }

  function getDiagnostics() {
    const wc = _mainContents();
    return { inFlight: !!_active, active: getActive(), workspaceReady: !!wc && _ready.has(wc.id), operationsStarted: _seq };
  }

  return { register, unregister, openSource, cancelForSource, getActive, getDiagnostics };
}

module.exports = { createWorkspaceHandoff, READY_TIMEOUT_MS, ACK_TIMEOUT_MS, HEARTBEAT_TIMEOUT_MS };
