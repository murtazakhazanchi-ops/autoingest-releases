/**
 * companionService.js — macOS menu-bar / Windows system-tray companion (AI-FEAT-061 Q1).
 *
 * A presentation/control layer only. It owns:
 *   - the Tray icon (and, on Windows, its right-click native menu),
 *   - the popup window — created on demand and DESTROYED when hidden (see
 *     docs/product/features/AI-FEAT-061_QUICK_INGEST_DESKTOP_COMPANION.md
 *     § Popup lifecycle decision for the measured comparison),
 *   - the companion:* IPC surface, reachable only from the popup's own webContents.
 *
 * It never scans, copies or writes anything. Card data comes from the single shared
 * poller (sourceMonitorService) as a 'companion' consumer; the popup receives only
 * the path-free snapshot from companionModel.buildSnapshot().
 *
 * The existing main window is never touched: "Open AutoIngest" goes through the same
 * function main.js uses for dock activation / second-instance focus.
 */

'use strict';

const path = require('path');
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen } = require('electron');
const windowRegistry = require('./windowRegistry');
const { buildSnapshot, computePopupPosition, POPUP_WIDTH, POPUP_HEIGHT } = require('./companionModel');

const MONITOR_CONSUMER = 'companion';
const TOOLTIP = 'AutoIngest';
/**
 * On macOS, clicking the tray icon while the popup is open first blurs (and so
 * destroys) the popup, then delivers the click. A click this soon after a
 * blur-close is treated as "close", not "reopen".
 */
const BLUR_TOGGLE_GUARD_MS = 300;

const IPC_HANDLE_CHANNELS = ['companion:getSnapshot', 'companion:openAutoIngest', 'companion:quit', 'companion:hide'];

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

function _trayImage() {
  if (process.platform === 'darwin') {
    // Template images are monochrome; macOS tints them for light/dark menu bars.
    const img = nativeImage.createFromPath(path.join(ASSETS_DIR, 'tray', 'trayTemplate.png'));
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(path.join(ASSETS_DIR, 'icon.png')).resize({ width: 16, height: 16, quality: 'best' });
}

function _isFromPopup(event) {
  return !!_popup && !_popup.isDestroyed() && event.sender === _popup.webContents;
}

function _snapshot() {
  return buildSnapshot(_monitor ? _monitor.getLatest() : null);
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
  win.on('blur', () => {
    _lastBlurCloseAt = Date.now();
    hidePopup();
  });
  win.on('closed', () => { if (_popup === win) _popup = null; });
  win.loadFile(RENDERER_HTML);
  return win;
}

function _positionPopup(win) {
  if (!_tray) return;
  const trayBounds = _tray.getBounds();
  const { workArea } = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const { x, y } = computePopupPosition({ trayBounds, workArea, platform: process.platform });
  win.setPosition(x, y, false);
}

function showPopup() {
  if (_popup && !_popup.isDestroyed()) { _popup.focus(); return; }
  _popup = _createPopup();
  _popupOpenCount++;
  const win = _popup;
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    _positionPopup(win);
    win.show();
    win.focus();
  });
}

/** Destroys the popup (on-demand lifecycle: a hidden popup holds no renderer). */
function hidePopup() {
  const win = _popup;
  _popup = null;
  if (win && !win.isDestroyed()) win.destroy();
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

  _unsubscribe = _monitor.subscribe(() => _pushSnapshot());
  _monitor.acquire(MONITOR_CONSUMER);
  _log('[companion] tray started');
}

/** Idempotent; safe to call from will-quit. */
function shutdown() {
  hidePopup();
  if (_unsubscribe) { _unsubscribe(); _unsubscribe = null; }
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
    ipcRegistered: _ipcRegistered,
    monitor: _monitor ? _monitor.getDiagnostics() : null,
    snapshot: _monitor ? _snapshot() : null,
  };
}

module.exports = { init, shutdown, showPopup, hidePopup, togglePopup, getDiagnostics };
