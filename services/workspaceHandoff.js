/**
 * workspaceHandoff.js — asks the EXISTING main-window workspace to open a camera card
 * (AI-FEAT-061 Q2/Q4 handoff, the approved non-visual listener).
 *
 * Main focuses (or reopens) the main window, waits until its renderer has finished
 * starting up and announced itself ready, then sends one request:
 *   companion:openSource { requestId, type: 'memory-card', path, label, selectPaths? }
 * The renderer opens the card through its own selectSource() — the same path as
 * choosing the card and pressing Continue — and, when selectPaths is given, selects
 * those files with the workspace's own selection set. It answers on
 * companion:openSourceResult. Nothing is imported; the operator continues with the
 * normal event, grouping, metadata and Confirm Event Import steps.
 *
 * Fails closed: busy main process, a handoff already in flight, a renderer that
 * refuses (import running, files already in progress) or no answer → { ok: false }.
 * Same request/reply shape as services/mxControlService.js.
 */

'use strict';

// Reopening a closed main window goes through the splash, which waits for the operator.
const READY_TIMEOUT_MS = 120_000;
const RESULT_TIMEOUT_MS = 180_000; // the renderer scans the whole card before answering
const READY_POLL_MS = 100;

/**
 * @param {object} deps
 * @param {import('electron').IpcMain} deps.ipcMain
 * @param {() => import('electron').BrowserWindow|null} deps.getMainWindow
 * @param {() => void} deps.openApp  focus the main window, or reopen it via the splash
 * @param {() => boolean} deps.isBusy
 * @param {(msg: string) => void} [deps.log]
 * @param {number} [deps.readyTimeoutMs]
 * @param {number} [deps.resultTimeoutMs]
 */
function createWorkspaceHandoff({ ipcMain, getMainWindow, openApp, isBusy, log = () => {}, readyTimeoutMs = READY_TIMEOUT_MS, resultTimeoutMs = RESULT_TIMEOUT_MS }) {
  const _ready = new Set();            // webContents ids whose renderer announced ready
  const _watched = new WeakSet();
  const _pending = new Map();          // requestId -> { resolve, timer, wcId }
  let _seq = 0;
  let _inFlight = false;
  let _registered = false;

  function _mainContents() {
    const win = getMainWindow();
    return win && !win.isDestroyed() && !win.webContents.isDestroyed() ? win.webContents : null;
  }

  function _watch(wc) {
    if (_watched.has(wc)) return;
    _watched.add(wc);
    const forget = () => {
      _ready.delete(wc.id);
      for (const [id, p] of _pending) {
        if (p.wcId === wc.id) { clearTimeout(p.timer); _pending.delete(id); p.resolve({ ok: false, reason: 'workspace-closed' }); }
      }
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

  function _onResult(event, msg) {
    if (!msg || typeof msg.requestId !== 'number') return;
    const p = _pending.get(msg.requestId);
    if (!p || event.sender.id !== p.wcId) return;
    clearTimeout(p.timer);
    _pending.delete(msg.requestId);
    const r = msg.result && typeof msg.result === 'object' ? msg.result : {};
    p.resolve({
      ok: r.ok === true,
      reason: typeof r.reason === 'string' ? r.reason : (r.ok === true ? null : 'refused'),
      selected: Number.isInteger(r.selected) ? r.selected : 0,
    });
  }

  function register() {
    if (_registered) return;
    _registered = true;
    ipcMain.on('companion:workspaceReady', _onReady);
    ipcMain.on('companion:openSourceResult', _onResult);
  }

  function unregister() {
    if (!_registered) return;
    _registered = false;
    ipcMain.removeListener('companion:workspaceReady', _onReady);
    ipcMain.removeListener('companion:openSourceResult', _onResult);
    for (const [id, p] of _pending) { clearTimeout(p.timer); _pending.delete(id); p.resolve({ ok: false, reason: 'shutdown' }); }
  }

  async function _waitForReadyWorkspace() {
    const deadline = Date.now() + readyTimeoutMs;
    while (Date.now() < deadline) {
      const wc = _mainContents();
      if (wc) { _watch(wc); if (_ready.has(wc.id)) return wc; }
      await new Promise(r => setTimeout(r, READY_POLL_MS));
    }
    return null;
  }

  /**
   * @param {{ mountpoint: string, label: string, selectPaths?: string[]|null }} req
   * @returns {Promise<{ ok: boolean, reason: string|null, selected: number }>}
   */
  async function openSource({ mountpoint, label, selectPaths = null }) {
    if (isBusy()) return { ok: false, reason: 'busy', selected: 0 };
    if (_inFlight) return { ok: false, reason: 'handoff-in-progress', selected: 0 };
    _inFlight = true;
    try {
      openApp();
      const wc = await _waitForReadyWorkspace();
      if (!wc) return { ok: false, reason: 'workspace-unavailable', selected: 0 };
      if (isBusy()) return { ok: false, reason: 'busy', selected: 0 };
      const requestId = ++_seq;
      const result = new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (_pending.delete(requestId)) resolve({ ok: false, reason: 'timeout', selected: 0 });
        }, resultTimeoutMs);
        _pending.set(requestId, { resolve, timer, wcId: wc.id });
      });
      wc.send('companion:openSource', { requestId, type: 'memory-card', path: mountpoint, label, selectPaths });
      const r = await result;
      log(`[handoff] open card → ${r.ok ? `ok (${r.selected} selected)` : `refused: ${r.reason}`}`);
      return r;
    } finally {
      _inFlight = false;
    }
  }

  function getDiagnostics() {
    const wc = _mainContents();
    return { inFlight: _inFlight, pending: _pending.size, workspaceReady: !!wc && _ready.has(wc.id) };
  }

  return { register, unregister, openSource, getDiagnostics };
}

module.exports = { createWorkspaceHandoff, READY_TIMEOUT_MS, RESULT_TIMEOUT_MS };
