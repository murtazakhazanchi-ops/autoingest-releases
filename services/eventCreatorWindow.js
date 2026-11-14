/**
 * eventCreatorWindow.js — the menu-bar companion's own Event Creator window (AI-FEAT-064 EQI-2.1).
 * Main process only.
 *
 * "Create New Event" from the companion used to bring up the whole main application to show its
 * Event Creator. This opens ONLY the existing Event Creator, in a small auxiliary window:
 *   - page: renderer/eventCreatorWindow.html — the same EventCreator / EventMgmt modules, the same
 *     preload (window.api), started the way the main window starts them;
 *   - styles: the main window's own <style> block, read from renderer/index.html and injected
 *     with insertCSS — one source for both windows, nothing copied, index.html untouched;
 *   - registered as an AUXILIARY window: never a progress target, never the "main window", never
 *     counted for activate / window-all-closed.
 * Exactly one result per opening: { ok: true, eventPath, pendingSync, localFirst } or
 * { ok: false, reason } (cancelled / closed). The result is accepted only from this window.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const PAGE = path.join(__dirname, '..', 'renderer', 'eventCreatorWindow.html');
const INDEX = path.join(__dirname, '..', 'renderer', 'index.html');
const PRELOAD = path.join(__dirname, '..', 'main', 'preload.js');
const RESULT_CHANNEL = 'eventCreatorWindow:result';

/**
 * Window chrome only: the Event Management box fills this window instead of floating over an app,
 * and a component's five fields wrap onto a second line rather than scrolling sideways (the main
 * window's grid needs ~1130 px; this window is narrower). Same fields, same order, same logic.
 */
const HOST_CSS = `
  html, body.ecw-body { height: 100%; margin: 0; overflow: hidden; background: var(--card-bg, #0b0f1a); }
  body.ecw-body .emm-overlay { position: fixed !important; inset: 0 !important; background: transparent !important; opacity: 1 !important; pointer-events: all !important; display: block !important; }
  body.ecw-body .emm-box { width: 100% !important; max-width: none !important; height: 100% !important; max-height: none !important;
    border: none !important; border-radius: 0 !important; transform: none !important; box-shadow: none !important; }
  body.ecw-body .ec-comp-fields { grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)) !important; }
`;
let _styleCache = null;
function _mainWindowStyles() {
  if (_styleCache !== null) return _styleCache;
  try {
    const html = fs.readFileSync(INDEX, 'utf8');
    const a = html.indexOf('<style>');
    const b = html.indexOf('</style>', a);
    _styleCache = a >= 0 && b > a ? html.slice(a + '<style>'.length, b) : '';
  } catch { _styleCache = ''; }
  return _styleCache;
}

/**
 * @param {{ BrowserWindow: Function, ipcMain: object, windowRegistry: object, log?: Function }} deps
 */
function createEventCreatorWindow({ BrowserWindow, ipcMain, windowRegistry, log = () => {} }) {
  let _win = null;
  let _pending = null;   // { resolve }

  function _onResult(event, result) {
    if (!_win || _win.isDestroyed() || event.sender !== _win.webContents) return;
    _finish(result && typeof result === 'object' ? result : { ok: false, reason: 'invalid' });
  }

  function _finish(result) {
    const p = _pending;
    _pending = null;
    const win = _win;
    _win = null;
    if (win && !win.isDestroyed()) setImmediate(() => { if (!win.isDestroyed()) win.destroy(); });
    if (p) p.resolve(result);
  }

  /** Opens (or focuses) the Event Creator window. Resolves with its single outcome. */
  function open() {
    if (_win && !_win.isDestroyed()) { _win.focus(); return { opened: false, done: Promise.resolve({ ok: false, reason: 'already-open' }) }; }
    let resolve;
    const done = new Promise((r) => { resolve = r; });
    _pending = { resolve };
    const win = new BrowserWindow({
      width: 1080, height: 820, minWidth: 960, minHeight: 600,   // the Event Management layout needs ~960 px (no sideways scrolling)
      show: false, center: true, resizable: true, minimizable: false, maximizable: false, fullscreenable: false,
      title: 'New Event — AutoIngest',
      backgroundColor: '#0b0f1a',
      webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    _win = win;
    windowRegistry.registerAuxiliary(win);
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    win.webContents.on('dom-ready', () => {
      win.webContents.insertCSS(_mainWindowStyles()).catch(() => {});
      win.webContents.insertCSS(HOST_CSS).catch(() => {});
    });
    win.once('ready-to-show', () => { if (!win.isDestroyed()) { win.show(); win.focus(); } });
    win.on('closed', () => { if (_win === win) { _win = null; if (_pending) { const p = _pending; _pending = null; p.resolve({ ok: false, reason: 'closed' }); } } });
    win.loadFile(PAGE);
    log('[event-creator-window] opened');
    return { opened: true, done };
  }

  function isOpen() { return !!_win && !_win.isDestroyed(); }
  function getWindow() { return _win && !_win.isDestroyed() ? _win : null; }
  function close() { if (_win) _finish({ ok: false, reason: 'closed' }); }
  function register() { ipcMain.on(RESULT_CHANNEL, _onResult); }
  function unregister() { ipcMain.removeListener(RESULT_CHANNEL, _onResult); close(); }

  return { open, isOpen, getWindow, close, register, unregister };
}

module.exports = { createEventCreatorWindow, RESULT_CHANNEL };
