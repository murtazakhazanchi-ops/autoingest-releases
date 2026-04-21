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
 * Persist the current in-memory state to disk atomically.
 * Writes to a .tmp file then renames over the real file so a partial write
 * cannot corrupt the settings file.
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

module.exports = { init, getArchiveRoot, setArchiveRoot };
