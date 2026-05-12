'use strict';

/**
 * archiveRepairService.js — Safe cleanup of known AutoIngest temp artifacts.
 *
 * Phase 13B-2: Temp File Cleanup.
 *
 * Rules:
 *  - Deletes only files whose basename ends with a known AutoIngest temp suffix.
 *  - Basename comparisons are case-insensitive (handles macOS HFS+/APFS volumes).
 *  - Resolves both tempPath and each configured root through fsp.realpath before
 *    the containment check — prevents symlink traversal escaping the root.
 *  - Uses fsp.lstat (not stat) so symlinks are caught even after realpath.
 *  - Never deletes directories, symlinks, media, or event structure files.
 *  - ENOENT on realpath or lstat returns idempotent success: { ok:true, reason:'already-missing' }.
 *  - Does not touch lock files, manifests, event.json, or any media.
 */

const fsp  = require('fs').promises;
const path = require('path');

// The only AutoIngest temp suffixes eligible for cleanup (lowercase — compared case-insensitively).
const AUTOINGEST_TEMP_SUFFIXES = [
  '.autoingest-sync-tmp',
  '.autoingest-tx-tmp',
];

// Protected basenames (lowercase) that must never be deleted by this service.
const PROTECTED_NAMES = new Set([
  'event.json',
  'event.metadata.json',
  'event.sync.json',
]);

/**
 * Cheap sync pre-checks on the basename alone (no filesystem access).
 * Returns false for non-string, empty basename, protected names, or
 * basenames that do not end with a known AutoIngest temp suffix.
 * All comparisons are lowercase so macOS case-insensitive volumes are handled.
 *
 * @param {string} basename  Basename of the candidate path (already normalized).
 * @returns {boolean}
 */
function _isEligibleBasename(basename) {
  if (!basename) return false;
  const lower = basename.toLowerCase();
  if (PROTECTED_NAMES.has(lower)) return false;
  return AUTOINGEST_TEMP_SUFFIXES.some(s => lower.endsWith(s));
}

/**
 * Safely delete a known AutoIngest temp file.
 *
 * Flow:
 *  1. Cheap sync checks on the raw path + basename.
 *  2. fsp.realpath on tempPath — resolves all symlinks; ENOENT → already-missing.
 *  3. fsp.realpath on each configured root (best-effort; skips unresolvable roots).
 *  4. path.relative containment check — ensures file is inside a configured root.
 *  5. fsp.lstat — confirms regular file (not directory, not symlink).
 *  6. Re-verify resolved basename is still an eligible temp suffix.
 *  7. fsp.unlink — delete only that file.
 *
 * @param {string}   tempPath         Absolute path to the candidate temp file.
 * @param {string[]} configuredRoots  All configured roots (nas, local, tx, main).
 * @returns {Promise<{ ok: boolean, reason: string }>}
 *   Reasons: 'cleaned' | 'already-missing' | 'invalid-path' |
 *            'not-temp-file' | 'is-directory' | 'outside-configured-root'
 */
async function cleanupTempFile(tempPath, configuredRoots) {
  if (!tempPath || typeof tempPath !== 'string') {
    return { ok: false, reason: 'invalid-path' };
  }
  if (!Array.isArray(configuredRoots) || configuredRoots.length === 0) {
    return { ok: false, reason: 'outside-configured-root' };
  }

  // ── Cheap sync pre-checks ─────────────────────────────────────────────────
  const normalized = path.normalize(tempPath);
  const rawBasename = path.basename(normalized);
  if (!_isEligibleBasename(rawBasename)) {
    return { ok: false, reason: 'not-temp-file' };
  }

  // ── Resolve tempPath via realpath (catches symlink traversal) ─────────────
  let resolvedPath;
  try {
    resolvedPath = await fsp.realpath(normalized);
  } catch (e) {
    if (e.code === 'ENOENT') return { ok: true, reason: 'already-missing' };
    return { ok: false, reason: 'invalid-path' };
  }

  // ── Containment check against each resolved configured root ───────────────
  let insideRoot = false;
  for (const root of configuredRoots) {
    if (!root) continue;
    let resolvedRoot;
    try { resolvedRoot = await fsp.realpath(root); } catch { continue; }
    const rel = path.relative(resolvedRoot, resolvedPath);
    if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
      insideRoot = true;
      break;
    }
  }
  if (!insideRoot) return { ok: false, reason: 'outside-configured-root' };

  // ── Pre-flight lstat — must be a regular file, not a directory or symlink ──
  let stat;
  try {
    stat = await fsp.lstat(resolvedPath);
  } catch (e) {
    if (e.code === 'ENOENT') return { ok: true, reason: 'already-missing' };
    throw e;
  }

  if (stat.isDirectory())     return { ok: false, reason: 'is-directory' };
  if (stat.isSymbolicLink())  return { ok: false, reason: 'invalid-path' };

  // ── Re-verify resolved basename has a known temp suffix (defence-in-depth) ─
  if (!_isEligibleBasename(path.basename(resolvedPath))) {
    return { ok: false, reason: 'not-temp-file' };
  }

  // ── Delete ────────────────────────────────────────────────────────────────
  try {
    await fsp.unlink(resolvedPath);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  return { ok: true, reason: 'cleaned' };
}

module.exports = { cleanupTempFile };
