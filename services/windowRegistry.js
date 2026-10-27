/**
 * windowRegistry.js — Main-process window ownership (AI-FEAT-061 Q1, risk R1).
 *
 * Before the menu-bar/tray companion existed, AutoIngest only ever had a splash
 * window and a main window, so main.js could route import/checksum/sync/metadata
 * progress to `BrowserWindow.getAllWindows().find(w => !w.isDestroyed())` — "the
 * first window" was always the main window in practice. A companion popup is a
 * real BrowserWindow too, so that expression could silently deliver the main
 * window's progress to the popup instead.
 *
 * This module names the windows explicitly:
 *   - the MAIN window (set by main.js when it creates one),
 *   - AUXILIARY windows (the companion popup) — never a progress target, never
 *     counted as an "app window" for activate/broadcast decisions.
 *
 * Behavior preservation: with no auxiliary window registered, getProgressTarget()
 * returns the main window when one exists, otherwise exactly what the old
 * expression returned (first non-destroyed window), and getAppWindows() returns
 * exactly BrowserWindow.getAllWindows() minus destroyed windows.
 */

'use strict';

const { BrowserWindow } = require('electron');

let _mainWindow = null;
const _auxiliary = new Set();

function _alive(win) {
  return !!win && !win.isDestroyed() && !!win.webContents && !win.webContents.isDestroyed();
}

/** @param {import('electron').BrowserWindow|null} win */
function setMainWindow(win) {
  _mainWindow = win || null;
  if (win) {
    win.once('closed', () => { if (_mainWindow === win) _mainWindow = null; });
  }
}

/** @returns {import('electron').BrowserWindow|null} the live main window, or null */
function getMainWindow() {
  return _alive(_mainWindow) ? _mainWindow : null;
}

/**
 * Marks a window as auxiliary (e.g. the companion popup). It is excluded from
 * getProgressTarget()/getAppWindows() for its whole lifetime.
 * @param {import('electron').BrowserWindow} win
 */
function registerAuxiliary(win) {
  _auxiliary.add(win);
  win.once('closed', () => _auxiliary.delete(win));
}

/** @param {import('electron').BrowserWindow} win */
function isAuxiliary(win) {
  return _auxiliary.has(win);
}

/** @returns {import('electron').BrowserWindow[]} live, non-auxiliary windows in Electron's order */
function getAppWindows() {
  return BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && !_auxiliary.has(w));
}

/**
 * The window that should receive main-window progress events.
 * @returns {import('electron').BrowserWindow|undefined} same "maybe undefined" shape as Array#find
 */
function getProgressTarget() {
  return getMainWindow() || getAppWindows()[0];
}

module.exports = {
  setMainWindow,
  getMainWindow,
  registerAuxiliary,
  isAuxiliary,
  getAppWindows,
  getProgressTarget,
};
