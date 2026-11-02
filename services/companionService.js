/**
 * companionService.js — macOS menu-bar / Windows system-tray companion (AI-FEAT-061 Q1).
 *
 * A presentation/control layer only. It owns:
 *   - the Tray icon (and, on Windows, its right-click native menu),
 *   - the popup window — created on demand and DESTROYED when hidden (see
 *     docs/product/features/AI-FEAT-061_QUICK_INGEST_DESKTOP_COMPANION.md
 *     § Popup lifecycle decision for the measured comparison),
 *   - the companion:* IPC surface, reachable only from the popup's own webContents,
 *   - the automatic popup when a camera card is newly connected (see _maybeAutoOpen),
 *   - Q2: the read-only capture-date assessment of each connected card
 *     (cardAssessmentService), the operator's chosen shoot date per card, and the
 *     "Review" handoffs into the existing workspace (workspaceHandoff),
 *   - Q3: the camera summary of each card (which cameras, how many files, whether each
 *     body is identified). It never assigns a photographer and stores nothing.
 *
 * It never copies or writes anything, and never starts an import. Card data comes
 * from the single shared poller (sourceMonitorService) as a 'companion' consumer; the
 * popup receives only the path-free snapshot from companionModel.buildSnapshot().
 *
 * "Open AutoIngest" goes through the same function main.js uses for dock activation /
 * second-instance focus; the Review actions use the approved non-visual handoff.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } = require('electron');
const windowRegistry = require('./windowRegistry');
const operatorActivity = require('./operatorActivity');
const {
  buildSnapshot, computePopupPosition, resolveTrayAnchor, createAutoOpenTracker, handoffStatusText, localDateString,
  POPUP_WIDTH, POPUP_HEIGHT,
} = require('./companionModel');
const { createCardAssessor } = require('./cardAssessmentService');
const { summarize, filesForSelection, normalizeSelection } = require('./dateAssessmentModel');
const { summarizeCameras } = require('./cameraAssessmentModel');
const { createWorkspaceHandoff } = require('./workspaceHandoff');

const MONITOR_CONSUMER = 'companion';
const TOOLTIP = 'AutoIngest';
/**
 * On macOS, clicking the tray icon while the popup is open first blurs (and so
 * destroys) the popup, then delivers the click. A click this soon after a
 * blur-close is treated as "close", not "reopen".
 */
const BLUR_TOGGLE_GUARD_MS = 300;
/**
 * An automatically opened popup is shown WITHOUT taking focus, so it cannot close on
 * blur. If the operator does not interact with it, it hides itself after this long.
 */
const AUTO_POPUP_DISMISS_MS = 15000;
/** A finished Review handoff's outcome stays visible in the popup for this long. */
const NOTICE_TTL_MS = 60000;
const SOURCE_ID_RE = /^src-\d+$/;

const IPC_HANDLE_CHANNELS = [
  'companion:getSnapshot', 'companion:openAutoIngest', 'companion:quit', 'companion:hide',
  'companion:selectDate', 'companion:reviewSelected', 'companion:reviewEarlier',
];

const ASSETS_DIR = path.join(__dirname, '..', 'assets');
const RENDERER_HTML = path.join(__dirname, '..', 'renderer', 'companion', 'companion.html');
const PRELOAD = path.join(__dirname, '..', 'main', 'companionPreload.js');

let _tray = null;
let _popup = null;
let _monitor = null;
let _unsubscribe = null;
let _openApp = null;
let _log = () => {};
let _lastBlurCloseAt = 0;
let _ipcRegistered = false;
let _popupOpenCount = 0;
let _autoOpen = null;            // createAutoOpenTracker() while the companion runs
let _autoDismissTimer = null;
let _autoOpenCount = 0;
let _autoOpenSuppressedCount = 0;
let _assessor = null;
let _handoff = null;
/**
 * Camera keys in the popup are HMACs under a secret that lives only for this process:
 * they let the popup tell cameras apart, reveal nothing about serials, and are useless
 * outside this run — never a registry identity (AI-FEAT-063 defines that, Q4+).
 */
const _sessionKeySecret = crypto.randomBytes(32);
const _cameraKey = (ref) => crypto.createHmac('sha256', _sessionKeySecret).update(ref).digest('hex').slice(0, 16);
/** sourceId -> the operator's chosen { date, untilTime }; absent = today. */
const _selections = new Map();
/** sourceId -> the latest Review handoff operation for that card ({ state, reason, selected, at, ... }). */
const _ops = new Map();
/** True from a Review click until its handoff operation exists (blocks double clicks during the awaits). */
let _reviewStarting = false;
/** Popup windows currently inside a native show/focus call (see _nativeShow). */
const _inNativeShow = new Set();

function _trayImage() {
  if (process.platform === 'darwin') {
    // Template images are monochrome; macOS tints them for light/dark menu bars.
    const img = nativeImage.createFromPath(path.join(ASSETS_DIR, 'tray', 'trayTemplate.png'));
    img.setTemplateImage(true);
    return img;
  }
  if (process.platform === 'win32') {
    // Full-colour emblem drawn for the notification area: 16/20/24/32/40/48 px
    // (100–300 % scaling); Windows picks the size for the current DPI.
    return nativeImage.createFromPath(path.join(ASSETS_DIR, 'tray', 'tray.ico'));
  }
  return nativeImage.createFromPath(path.join(ASSETS_DIR, 'icon.png')).resize({ width: 16, height: 16, quality: 'best' });
}

function _isFromPopup(event) {
  return !!_popup && !_popup.isDestroyed() && event.sender === _popup.webContents;
}

/** Path-free assessment view of one card for the popup (null before Q2 starts). */
function _assessmentView(sourceId) {
  if (!_assessor) return null;
  const job = _assessor.get(sourceId);
  if (!job) return null;
  const op = _ops.get(sourceId);
  const showOp = op && (op.state === 'pending' || Date.now() - op.at < NOTICE_TTL_MS);
  const view = {
    state: job.state,
    progress: { done: job.done, total: job.total },
    identifyProgress: { done: job.idDone, total: job.idTotal },
    error: job.error,
    handoff: showOp ? { state: op.state, message: handoffStatusText(op), at: op.at } : null,
    // One handoff at a time: while any is pending, every card's Review actions wait.
    handoffPending: _reviewStarting || !!(_handoff && _handoff.getActive()),
    summary: null,
    cameras: null,
  };
  if (job.datesReady) {
    // Dates are final before camera identification finishes (Q3 phase 2).
    view.summary = summarize(job.records, { today: localDateString(new Date()), selection: _selections.get(sourceId) });
  }
  if (job.state === 'complete') {
    if (job.cameras) {
      if (!job.cameraSummary) job.cameraSummary = summarizeCameras(job.records, job.cameras, _cameraKey);
      view.cameras = job.cameraSummary; // names, counts, opaque keys — never identifiers
    }
  }
  return view;
}

function _snapshot() {
  return buildSnapshot(_monitor ? _monitor.getLatest() : null, new Date(), _assessmentView);
}

function _pushSnapshot() {
  if (_popup && !_popup.isDestroyed() && !_popup.webContents.isDestroyed()) {
    _popup.webContents.send('companion:snapshot', _snapshot());
  }
}

function _registerIpc() {
  if (_ipcRegistered) return;
  _ipcRegistered = true;
  // Every handler rejects callers other than the popup; none accepts a payload.
  ipcMain.handle('companion:getSnapshot', (event) => (_isFromPopup(event) ? _snapshot() : null));
  ipcMain.handle('companion:openAutoIngest', (event) => {
    if (!_isFromPopup(event)) return { ok: false };
    hidePopup();
    if (_openApp) _openApp();
    return { ok: true };
  });
  ipcMain.handle('companion:hide', (event) => {
    if (!_isFromPopup(event)) return { ok: false };
    hidePopup();
    return { ok: true };
  });
  ipcMain.handle('companion:selectDate', (event, payload) => {
    if (!_isFromPopup(event)) return { ok: false };
    return _selectDate(payload);
  });
  ipcMain.handle('companion:reviewSelected', (event, payload) => {
    if (!_isFromPopup(event)) return { ok: false };
    return _review(payload, 'selected');
  });
  ipcMain.handle('companion:reviewEarlier', (event, payload) => {
    if (!_isFromPopup(event)) return { ok: false };
    return _review(payload, 'card');
  });
  ipcMain.handle('companion:quit', (event) => {
    if (!_isFromPopup(event)) return { ok: false };
    hidePopup();
    // Normal quit path: main.js's before-quit guard and will-quit cleanup still run.
    setImmediate(() => app.quit());
    return { ok: true };
  });
}

function _unregisterIpc() {
  if (!_ipcRegistered) return;
  for (const ch of IPC_HANDLE_CHANNELS) ipcMain.removeHandler(ch);
  _ipcRegistered = false;
}

function _createPopup() {
  const win = new BrowserWindow({
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // An automatically shown popup is not focused; let the first click act on it (macOS).
    acceptFirstMouse: true,
    backgroundColor: '#0b0f1a',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  windowRegistry.registerAuxiliary(win);
  win.setMenu(null);
  // The popup only ever shows its own bundled page.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  // Once the operator interacts with an automatically shown popup it behaves like a
  // clicked-open one: it stays until dismissed or blurred.
  win.on('focus', () => { if (_popup === win) _clearAutoDismiss(); });
  win.on('blur', () => {
    // A popup already closing (destroy pending) must not close its successor.
    if (_popup !== win) return;
    _lastBlurCloseAt = Date.now();
    hidePopup();
  });
  win.on('closed', () => { if (_popup === win) _popup = null; });
  win.loadFile(RENDERER_HTML);
  return win;
}

function _positionPopup(win) {
  if (!_tray) return;
  const trayBounds = resolveTrayAnchor({
    trayBounds: _tray.getBounds(),
    displays: screen.getAllDisplays(),
    primary: screen.getPrimaryDisplay(),
    platform: process.platform,
  });
  const { workArea } = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const { x, y } = computePopupPosition({ trayBounds, workArea, platform: process.platform });
  win.setPosition(x, y, false);
}

/**
 * Runs a native show/focus call on the popup. On macOS those calls can pump a nested
 * run loop, so hidePopup() (tray click, blur, IPC) may run INSIDE them. The window is
 * marked as "in a native call" so a hide requested meanwhile only detaches it; the
 * destroy happens after the native call has returned (see _destroyPopupLater).
 */
function _nativeShow(win, fn) {
  _inNativeShow.add(win);
  try {
    fn();
  } catch (err) {
    _log(`[companion] popup show failed: ${err && err.message}`);
  } finally {
    _inNativeShow.delete(win);
  }
  if (_popup !== win) _destroyPopupLater(win); // hidden while the native call ran
}

/**
 * Never destroy the popup synchronously: destroying an NSWindow while AppKit is still
 * ordering or focusing it crashed the main process (SIGTRAP) under stress, and the
 * pending JS continuation then threw "Object has been destroyed".
 */
function _destroyPopupLater(win) {
  setImmediate(() => {
    if (win.isDestroyed() || _inNativeShow.has(win)) return; // _nativeShow retries on return
    win.destroy();
  });
}

/**
 * @param {{ inactive?: boolean }} [opts]  inactive: show without taking focus (automatic
 *   popup) and hide again after AUTO_POPUP_DISMISS_MS unless the operator interacts.
 */
function showPopup({ inactive = false } = {}) {
  if (_popup && !_popup.isDestroyed()) {
    if (inactive) return; // already open: it updates in place, never steals focus
    const existing = _popup;
    _clearAutoDismiss();
    _nativeShow(existing, () => existing.focus());
    return;
  }
  _popup = _createPopup();
  _popupOpenCount++;
  const win = _popup;
  win.once('ready-to-show', () => {
    if (_popup !== win || win.isDestroyed()) return;
    _positionPopup(win);
    _nativeShow(win, () => {
      if (inactive) {
        win.showInactive();
        if (_popup === win && !win.isDestroyed()) _startAutoDismiss(win);
        return;
      }
      win.show();
      if (_popup === win && !win.isDestroyed()) win.focus();
    });
  });
}

function _startAutoDismiss(win) {
  _clearAutoDismiss();
  _autoDismissTimer = setTimeout(() => {
    _autoDismissTimer = null;
    if (_popup === win && !win.isDestroyed() && !win.isFocused()) hidePopup();
  }, AUTO_POPUP_DISMISS_MS);
}

function _clearAutoDismiss() {
  if (_autoDismissTimer) { clearTimeout(_autoDismissTimer); _autoDismissTimer = null; }
}

function _attachedCard(sourceId) {
  const latest = _monitor ? _monitor.getLatest() : null;
  return ((latest && latest.cards) || []).find(c => c.sourceId === sourceId) || null;
}

/** @param {unknown} payload  { sourceId, date, untilTime? } from the popup (untrusted) */
function _selectDate(payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const keys = Object.keys(p);
  if (keys.some(k => !['sourceId', 'date', 'untilTime'].includes(k))) return { ok: false, reason: 'invalid' };
  if (typeof p.sourceId !== 'string' || !SOURCE_ID_RE.test(p.sourceId)) return { ok: false, reason: 'invalid' };
  const view = _assessmentView(p.sourceId);
  if (!view || !view.summary) return { ok: false, reason: 'assessment-unavailable' };
  if (!view.summary.options.some(o => o.date === p.date)) return { ok: false, reason: 'invalid' };
  if (p.untilTime != null && !view.summary.afterMidnightOptions.includes(p.untilTime)) return { ok: false, reason: 'invalid' };
  _selections.set(p.sourceId, normalizeSelection({ date: p.date, untilTime: p.untilTime }, view.summary.today));
  if (_ops.get(p.sourceId) && _ops.get(p.sourceId).state !== 'pending') _ops.delete(p.sourceId);
  _pushSnapshot();
  return { ok: true };
}

function _recordOp(op) {
  _ops.set(op.sourceId, { ...op, at: Date.now() });
  _pushSnapshot();
}

/**
 * Review in the existing workspace. 'selected': open the card with the chosen date's
 * files selected; 'card': open the whole card (earlier files included), no selection.
 * One handoff at a time: a click while one is pending (or still starting) is answered
 * with the pending operation and starts nothing.
 * @param {unknown} payload  { sourceId } from the popup (untrusted)
 * @param {'selected'|'card'} mode
 * @returns {Promise<object>} the operation's terminal state (or the pending one)
 */
async function _review(payload, mode) {
  const p = payload && typeof payload === 'object' ? payload : {};
  if (Object.keys(p).some(k => k !== 'sourceId') || typeof p.sourceId !== 'string' || !SOURCE_ID_RE.test(p.sourceId)) {
    return { state: 'refused', reason: 'invalid' };
  }
  const active = _handoff && _handoff.getActive();
  if (_reviewStarting || active) return active || { state: 'pending', reason: 'handoff-in-progress' };
  const { sourceId } = p;
  const refuse = (reason) => {
    const op = { sourceId, state: 'refused', reason, selected: 0 };
    _recordOp(op);
    return op;
  };
  _reviewStarting = true;
  _pushSnapshot();
  let started;
  try {
    const card = _attachedCard(sourceId);
    if (!card) return refuse('source-detached');
    if (operatorActivity.isBusy()) return refuse('busy');
    let selectPaths = null;
    if (mode === 'selected') {
      const job = _assessor ? await _assessor.verify(sourceId) : null;
      if (!job || !_attachedCard(sourceId)) return refuse('assessment-unavailable');
      selectPaths = filesForSelection(job.records, normalizeSelection(_selections.get(sourceId), localDateString(new Date())));
      if (selectPaths.length === 0) return refuse('nothing-selected');
    }
    hidePopup(); // the main window is about to take focus
    started = _handoff.openSource({ sourceId, mountpoint: card.mountpoint, label: card.label, selectPaths });
  } finally {
    _reviewStarting = false;
  }
  _recordOp(started.operation);
  const final = await started.done;
  // Explain anything but success where the operator asked (the main window has focus).
  if (final.state !== 'completed' && _tray && _attachedCard(sourceId)) showPopup({ inactive: true });
  return final;
}

function _statMount(mountpoint) {
  return fs.promises.stat(mountpoint).then(st => ({ dev: st.dev, ino: st.ino }), () => null);
}

function _onPoll(latest) {
  const ids = new Set(((latest && latest.cards) || []).map(c => c.sourceId));
  for (const id of new Set([..._selections.keys(), ..._ops.keys()])) {
    if (ids.has(id)) continue;
    // A removed card ends any handoff still opening it; its state is forgotten.
    if (_handoff) _handoff.cancelForSource(id, 'source-detached');
    _selections.delete(id);
    _ops.delete(id);
  }
  if (_assessor) _assessor.sync(latest && latest.cards);
  _pushSnapshot();
  _maybeAutoOpen(latest);
}

/** True while an import/sync/transfer/checksum or a native dialog is in flight, or an AutoIngest window has focus. */
function _isOperatorBusy() {
  if (operatorActivity.isBusy()) return true;
  const focused = BrowserWindow.getFocusedWindow();
  return !!focused && !focused.isDestroyed() && !windowRegistry.isAuxiliary(focused);
}

/**
 * Opens the popup once per genuine new camera-card connection (a new attachment
 * sourceId). Repeated polls of the same card, cards present at startup, and cards seen
 * while the operator is busy never open it; a dismissed popup is not reopened until a
 * further card is connected.
 */
function _maybeAutoOpen(latest) {
  if (!_autoOpen) return;
  const fresh = _autoOpen.observe(latest && latest.cards);
  if (fresh.length === 0) return;
  if (_popup && !_popup.isDestroyed()) return; // already showing; the snapshot push updates it
  if (_isOperatorBusy()) {
    _autoOpenSuppressedCount++;
    _log(`[companion] card connected; automatic popup suppressed (operator busy: ${operatorActivity.activeKinds().join(',') || 'app window focused'})`);
    return;
  }
  _autoOpenCount++;
  _log(`[companion] card connected; showing popup (${fresh.length} new)`);
  showPopup({ inactive: true });
}

/**
 * Closes the popup (on-demand lifecycle: a hidden popup holds no renderer). The popup
 * is detached at once — it stops counting as open and its IPC is rejected — and is
 * destroyed on the next turn of the event loop.
 */
function hidePopup() {
  _clearAutoDismiss();
  const win = _popup;
  _popup = null;
  if (win && !win.isDestroyed()) _destroyPopupLater(win);
}

function togglePopup() {
  if (_popup && !_popup.isDestroyed()) { hidePopup(); return; }
  if (Date.now() - _lastBlurCloseAt < BLUR_TOGGLE_GUARD_MS) return;
  showPopup();
}

function _contextMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open AutoIngest', click: () => { hidePopup(); if (_openApp) _openApp(); } },
    { type: 'separator' },
    { label: 'Quit AutoIngest', click: () => { hidePopup(); app.quit(); } },
  ]);
}

/**
 * @param {object} opts
 * @param {ReturnType<import('./sourceMonitorService').createSourceMonitor>} opts.monitor
 * @param {() => void} opts.openApp  focus/restore the main window or reopen it via splash
 * @param {(msg: string) => void} [opts.log]
 */
function init({ monitor, openApp, log }) {
  if (_tray) return;
  _monitor = monitor;
  _openApp = openApp;
  if (log) _log = log;

  _registerIpc();
  _tray = new Tray(_trayImage());
  _tray.setToolTip(TOOLTIP);
  _tray.on('click', () => togglePopup());
  if (process.platform !== 'darwin') {
    _tray.on('right-click', () => { hidePopup(); _tray.popUpContextMenu(_contextMenu()); });
  }

  _autoOpen = createAutoOpenTracker();
  _assessor = createCardAssessor({
    // The workspace's own discovery rules; exifr / the shared ExifTool pool (read-only).
    listMedia: (mountpoint) => require('../main/fileBrowser').scanMediaRecursive(mountpoint),
    // One read per file for date + camera identity; maker-note follow-up only when needed.
    readTags: (filePath, type) => require('./captureDateReader').readCaptureMetadata(filePath, type),
    readIdentity: (filePath) => require('./captureDateReader').readIdentityTags(filePath),
    statMount: _statMount,
    // Never compete with an import/sync/transfer/checksum for disk or ExifTool.
    isPaused: () => operatorActivity.activeKinds().some(k => k !== 'dialog'),
    onChange: _pushSnapshot,
    log: _log,
  });
  _handoff = createWorkspaceHandoff({
    ipcMain,
    getMainWindow: () => windowRegistry.getMainWindow(),
    openApp: () => { if (_openApp) _openApp(); },
    isBusy: () => operatorActivity.isBusy(),
    onChange: _recordOp,
    log: _log,
  });
  _handoff.register();
  _unsubscribe = _monitor.subscribe(_onPoll);
  _monitor.acquire(MONITOR_CONSUMER);
  _log('[companion] tray started');
}

/** Idempotent; safe to call from will-quit. */
function shutdown() {
  hidePopup();
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
  _autoOpen = null;
  if (_assessor) { _assessor.shutdown(); _assessor = null; }
  if (_handoff) { _handoff.unregister(); _handoff = null; }
  _selections.clear();
  _ops.clear();
  _reviewStarting = false;
  if (_monitor) { _monitor.release(MONITOR_CONSUMER); _monitor = null; }
  _unregisterIpc();
  if (_tray) {
    if (!_tray.isDestroyed()) _tray.destroy();
    _tray = null;
    _log('[companion] tray stopped');
  }
}

/** Test/diagnostic view of the companion's own state (no paths). */
function getDiagnostics() {
  return {
    trayActive: !!_tray && !_tray.isDestroyed(),
    trayBounds: _tray && !_tray.isDestroyed() ? _tray.getBounds() : null,
    popupOpen: !!_popup && !_popup.isDestroyed(),
    popupOpenCount: _popupOpenCount,
    popupFocused: !!_popup && !_popup.isDestroyed() && _popup.isFocused(),
    autoOpenCount: _autoOpenCount,
    autoOpenSuppressedCount: _autoOpenSuppressedCount,
    autoDismissPending: !!_autoDismissTimer,
    ipcRegistered: _ipcRegistered,
    monitor: _monitor ? _monitor.getDiagnostics() : null,
    assessment: _assessor ? _assessor.getDiagnostics() : null,
    handoff: _handoff ? _handoff.getDiagnostics() : null,
    snapshot: _monitor ? _snapshot() : null,
  };
}

module.exports = { init, shutdown, showPopup, hidePopup, togglePopup, getDiagnostics };
