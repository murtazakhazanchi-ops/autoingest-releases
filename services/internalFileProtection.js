'use strict';

/**
 * internalFileProtection.js — Centralised hidden/protected handling for
 * AutoIngest internal files and directories.
 *
 * Internal files must not appear in media browser listings, must not be counted
 * as importable media, and should be hidden on platforms that support it.
 *
 * Platform behaviour:
 *   macOS  : chflags hidden  (best-effort, non-fatal)
 *   Windows: attrib +H       (best-effort, non-fatal)
 *   Linux/NAS: maintain .hidden file in the same directory listing the filename
 *              (GNOME Nautilus and compatible file managers honour this file)
 *
 * _Selected is NOT internal — it must remain visible.
 */

const path         = require('path');
const fsp          = require('fs').promises;
const { execFile } = require('child_process');

// ── Internal name registry ────────────────────────────────────────────────────

const INTERNAL_FILE_NAMES = new Set([
  'event.json',
  'event.metadata.json',
  'event.sync.json',
]);

const INTERNAL_DIR_NAMES = new Set([
  '.autoingest',
]);

const TMP_SUFFIX = '.autoingest-sync-tmp';

/**
 * Returns true when a basename is an AutoIngest-internal file or directory
 * that must not appear in media browser listings or be counted as content.
 *
 * Note: _Selected is explicitly NOT internal.
 *
 * @param {string} name  Basename only (no directory component).
 * @returns {boolean}
 */
function isAutoIngestInternalName(name) {
  if (!name) return false;
  if (INTERNAL_FILE_NAMES.has(name)) return true;
  if (INTERNAL_DIR_NAMES.has(name)) return true;
  if (name.endsWith(TMP_SUFFIX)) return true;
  return false;
}

/**
 * Returns true when a file entry should be excluded from media browser results.
 * @param {string} name  Basename only.
 * @returns {boolean}
 */
function shouldExcludeFromMediaBrowser(name) {
  return isAutoIngestInternalName(name);
}

// ── Platform hiding ────────────────────────────────────────────────────────────

/**
 * Apply a platform-appropriate hidden attribute to a file or directory.
 * Best-effort: returns false without throwing when the OS command fails
 * (e.g. permission denied on a NAS mount).
 *
 * Platform behaviour:
 *   macOS  : chflags hidden <path>
 *   Windows: attrib +H <path>
 *   Linux/other: append the basename to .hidden in the same directory
 *                (Nautilus/compatible file managers honour this convention)
 *
 * @param {string} filePath  Absolute path to file or directory.
 * @returns {Promise<boolean>}  true if the attribute was applied.
 */
async function hidePathBestEffort(filePath) {
  if (process.platform === 'darwin') {
    return new Promise(resolve => execFile('chflags', ['hidden', filePath], err => {
      if (err) console.warn('[hidePathBestEffort] chflags hidden failed:', filePath, '—', err.message);
      resolve(!err);
    }));
  }
  if (process.platform === 'win32') {
    return new Promise(resolve => execFile('attrib', ['+H', filePath], err => {
      if (err) console.warn('[hidePathBestEffort] attrib +H failed:', filePath, '—', err.message);
      resolve(!err);
    }));
  }
  // Linux/other: maintain .hidden file in the same directory.
  // Files/dirs starting with '.' are already hidden by convention; only non-dot
  // names need an explicit .hidden entry.
  const name = path.basename(filePath);
  if (name.startsWith('.')) return false;
  const hiddenFile = path.join(path.dirname(filePath), '.hidden');
  try {
    let existing = '';
    try { existing = await fsp.readFile(hiddenFile, 'utf8'); } catch {}
    const lines = existing.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.includes(name)) {
      lines.push(name);
      await fsp.writeFile(hiddenFile, lines.join('\n') + '\n', 'utf8');
    }
    return true;
  } catch (err) {
    console.warn('[hidePathBestEffort] .hidden write failed:', filePath, '—', err.message);
    return false;
  }
}

// ── Bulk hiding ───────────────────────────────────────────────────────────────

/**
 * Best-effort: hide all known AutoIngest internal paths inside an event folder.
 * Silently skips paths that do not exist. Does NOT throw.
 *
 * Hides:
 *   {eventPath}/event.json
 *   {eventPath}/event.metadata.json
 *   {eventPath}/.autoingest/                (directory)
 *   {eventPath}/.autoingest/event.sync.json
 *
 * @param {string} eventPath  Absolute path to the local staging event folder.
 * @returns {Promise<void>}
 */
async function ensureEventInternalFilesHidden(eventPath) {
  const candidates = [
    path.join(eventPath, 'event.json'),
    path.join(eventPath, 'event.metadata.json'),
    path.join(eventPath, '.autoingest'),
    path.join(eventPath, '.autoingest', 'event.sync.json'),
  ];

  await Promise.all(candidates.map(async (p) => {
    try {
      await fsp.access(p);
      await hidePathBestEffort(p);
    } catch {
      // ENOENT or hide failure — both non-fatal
    }
  }));
}

/**
 * Best-effort: apply hidden attribute to each path in the list.
 * Silently skips failures. Does NOT throw.
 *
 * @param {string[]} paths  Absolute paths.
 * @returns {Promise<void>}
 */
async function hideInternalFilesBestEffort(paths) {
  await Promise.all(paths.map(p => hidePathBestEffort(p).catch(() => {})));
}

module.exports = {
  isAutoIngestInternalName,
  shouldExcludeFromMediaBrowser,
  hidePathBestEffort,
  ensureEventInternalFilesHidden,
  hideInternalFilesBestEffort,
};
