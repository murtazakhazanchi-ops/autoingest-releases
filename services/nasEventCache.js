'use strict';

/**
 * nasEventCache.js — Local UserData cache for the last-known NAS event list.
 *
 * Stores a lightweight snapshot of the NAS event scan result so the app can
 * show the last-known list when the NAS is temporarily unreachable (offline,
 * unmounted, etc.).
 *
 * Rules:
 *  - Cache is NEVER authoritative. It is a fallback/helper only.
 *  - event.json on the NAS remains the source of truth.
 *  - Cache is stored in userData (local machine only) and is never written to
 *    the NAS archive.
 *  - Writes are atomic (tmp → rename) for crash safety.
 *
 * File location (Mac):  ~/Library/Application Support/auto-ingest/nasEventCache.json
 * File location (Win):  %APPDATA%/auto-ingest/nasEventCache.json
 */

const fs   = require('fs');
const fsp  = require('fs').promises;
const path = require('path');

let _cachePath = null;

function _resolvePath() {
  if (_cachePath) return _cachePath;
  const { app } = require('electron');
  _cachePath = path.join(app.getPath('userData'), 'nasEventCache.json');
  return _cachePath;
}

/**
 * Load the cached NAS event list from disk.
 * Returns the parsed cache object or null if absent/corrupt.
 * @returns {{ cachedAt: string, collections: Array } | null}
 */
async function load() {
  try {
    const raw = await fsp.readFile(_resolvePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.collections)) return null;
    return parsed;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[nasEventCache] Load failed:', err.message);
    }
    return null;
  }
}

/**
 * Persist a NAS event scan result as the local cache.
 * Only the lightweight, imports-stripped data should be passed here.
 * @param {{ cachedAt: string, collections: Array }} data
 * @returns {Promise<void>}
 */
async function save(data) {
  const p   = _resolvePath();
  const tmp = p + '.tmp';
  try {
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fsp.rename(tmp, p);
  } catch (err) {
    console.error('[nasEventCache] Save failed:', err.message);
    try { await fsp.unlink(tmp); } catch { /* tmp may not exist */ }
  }
}

/**
 * Delete the local cache file. Non-throwing — missing cache is fine.
 * @returns {Promise<void>}
 */
async function clear() {
  try {
    await fsp.unlink(_resolvePath());
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('[nasEventCache] Clear failed:', err.message);
    }
  }
}

module.exports = { load, save, clear };
