/**
 * settings.js — Main-process user-preference store.
 *
 * Persists small user preferences (currently just archiveRoot) as JSON at
 * <userData>/settings.json. Mirrors the atomic write pattern used by
 * importIndex.json in main.js: write to .tmp, then rename over the real file
 * so a crash mid-write never leaves a corrupted settings file.
 *
 * Initial load is synchronous (called once at startup, before the window
 * exists). Writes are async. Failures are logged but never thrown — settings
 * are non-critical state.
 *
 * Usage:
 *   const settings = require('../services/settings');
 *   settings.init();                           // once, at app startup
 *   const root = settings.getArchiveRoot();    // string | null
 *   await settings.setArchiveRoot('/path');    // persist
 *
 * File location (Mac):   ~/Library/Application Support/auto-ingest/settings.json
 * File location (Win):   %APPDATA%/auto-ingest/settings.json
 */

'use strict';

const fs   = require('fs');
const fsp  = require('fs').promises;
const path = require('path');

let _path   = null;   // resolved lazily because app may not be ready
let _state  = {};     // in-memory cache of the settings object
let _loaded = false;  // true once init() has run

function _resolvePath() {
  if (_path) return _path;
  const { app } = require('electron');
  _path = path.join(app.getPath('userData'), 'settings.json');
  return _path;
}

/**
 * Load settings from disk into memory. Idempotent — calling twice is a no-op.
 * Must be called once at startup, after app.whenReady() fires (so userData
 * path is available) and before any renderer can request settings.
 *
 * Synchronous by design: startup-critical path, runs once, tiny file.
 */
function init() {
  if (_loaded) return;
  const p = _resolvePath();
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    // Accept only plain objects; anything else → empty state (corrupt file safety)
    _state = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // Corrupt or unreadable — log but continue with empty state
      console.error('[settings] Load failed, starting fresh:', err.message);
    }
    _state = {};
  }
  _loaded = true;
}

/**
 * Persist the current in-memory state to disk atomically (async).
 */
async function _save() {
  const p   = _resolvePath();
  const tmp = p + '.tmp';
  try {
    await fsp.writeFile(tmp, JSON.stringify(_state, null, 2), 'utf8');
    await fsp.rename(tmp, p);
  } catch (err) {
    console.error('[settings] Save failed:', err.message);
    try { await fsp.unlink(tmp); } catch { /* tmp may not exist */ }
    throw err;
  }
}

/**
 * Synchronous variant — used only in the window close handler where the event
 * loop may not flush async work before the process exits. Same atomic
 * tmp → rename guarantee as _save().
 */
function _saveSync() {
  const p   = _resolvePath();
  const tmp = p + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(_state, null, 2), 'utf8');
    fs.renameSync(tmp, p);
  } catch (err) {
    console.error('[settings] Sync save failed:', err.message);
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

/**
 * Returns the persisted archive root, or null if never set.
 * @returns {string | null}
 */
function getArchiveRoot() {
  if (!_loaded) init();
  const v = _state.archiveRoot;
  return (typeof v === 'string' && v.length > 0) ? v : null;
}

/**
 * Persists a new archive root. Pass null or '' to clear.
 * @param {string | null} value
 * @returns {Promise<void>}
 */
async function setArchiveRoot(value) {
  if (!_loaded) init();
  if (value === null || value === '') {
    delete _state.archiveRoot;
  } else if (typeof value === 'string') {
    _state.archiveRoot = value;
  } else {
    throw new Error('setArchiveRoot: expected string or null');
  }
  await _save();
}

/**
 * Returns the last user-chosen import destination, or null if never set.
 * @returns {string | null}
 */
function getLastDestPath() {
  if (!_loaded) init();
  const v = _state.lastDestPath;
  return (typeof v === 'string' && v.length > 0) ? v : null;
}

/**
 * Persists the last import destination. Pass null or '' to clear.
 * @param {string | null} value
 * @returns {Promise<void>}
 */
async function setLastDestPath(value) {
  if (!_loaded) init();
  if (value === null || value === '') {
    delete _state.lastDestPath;
  } else if (typeof value === 'string') {
    _state.lastDestPath = value;
  } else {
    throw new Error('setLastDestPath: expected string or null');
  }
  await _save();
}

/**
 * Returns the last active event context, or null if never set.
 * Requires collectionPath (full disk path) — old entries missing it return null.
 * Only lookup keys are stored here; component data is re-derived from the
 * event folder name at restore time via master:parseEvent.
 * @returns {{ collectionPath: string, collectionName: string, eventName: string } | null}
 */
function getLastEvent() {
  if (!_loaded) init();
  const v = _state.lastEvent;
  if (!v || typeof v !== 'object') return null;
  if (typeof v.collectionPath !== 'string' || !v.collectionPath.length) return null;
  if (typeof v.collectionName !== 'string' || !v.collectionName.length) return null;
  if (typeof v.eventName !== 'string' || !v.eventName.length) return null;
  return { collectionPath: v.collectionPath, collectionName: v.collectionName, eventName: v.eventName };
}

/**
 * Persists the last active event context. Pass null to clear.
 * Only lookup keys are persisted — not component objects, which drift on rename.
 * @param {{ collectionPath: string, collectionName: string, eventName: string } | null} value
 * @returns {Promise<void>}
 */
async function setLastEvent(value) {
  if (!_loaded) init();
  if (value === null || value === undefined) {
    delete _state.lastEvent;
  } else if (
    value && typeof value === 'object' &&
    typeof value.collectionPath === 'string' && value.collectionPath.length > 0 &&
    typeof value.collectionName === 'string' && value.collectionName.length > 0 &&
    typeof value.eventName === 'string' && value.eventName.length > 0
  ) {
    _state.lastEvent = {
      collectionPath: value.collectionPath,
      collectionName: value.collectionName,
      eventName:      value.eventName,
    };
  } else {
    throw new Error('setLastEvent: expected { collectionPath, collectionName, eventName } or null');
  }
  await _save();
}

/**
 * Returns the last saved window bounds, or null if never set.
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
function getWindowBounds() {
  if (!_loaded) init();
  const v = _state.windowBounds;
  if (!v || typeof v !== 'object') return null;
  if (typeof v.width !== 'number' || typeof v.height !== 'number') return null;
  return { x: v.x, y: v.y, width: v.width, height: v.height };
}

/**
 * Persists the current window bounds. Pass null to clear.
 * @param {{ x: number, y: number, width: number, height: number } | null} value
 * @returns {Promise<void>}
 */
async function setWindowBounds(value) {
  if (!_loaded) init();
  if (value === null || value === undefined) {
    delete _state.windowBounds;
  } else if (value && typeof value === 'object' &&
             typeof value.width === 'number' && typeof value.height === 'number') {
    _state.windowBounds = { x: value.x, y: value.y, width: value.width, height: value.height };
  } else {
    throw new Error('setWindowBounds: expected { x, y, width, height } or null');
  }
  await _save();
}

/**
 * Synchronous version of setWindowBounds — call from the BrowserWindow 'close'
 * handler so bounds are guaranteed to flush before the process exits.
 * @param {{ x: number, y: number, width: number, height: number } | null} value
 */
function setWindowBoundsSync(value) {
  if (!_loaded) init();
  if (value === null || value === undefined) {
    delete _state.windowBounds;
  } else if (value && typeof value === 'object' &&
             typeof value.width === 'number' && typeof value.height === 'number') {
    _state.windowBounds = { x: value.x, y: value.y, width: value.width, height: value.height };
  } else {
    return; // silently ignore invalid bounds on close — non-critical
  }
  _saveSync();
}

module.exports = { init, getArchiveRoot, setArchiveRoot, getLastDestPath, setLastDestPath, getLastEvent, setLastEvent, getWindowBounds, setWindowBounds, setWindowBoundsSync };
