'use strict';

/**
 * transferExportService.js — Controlled export from Active Archive Root
 * to a Transfer SSD/HDD.
 *
 * Rules:
 *  - Source (NAS root) is READ-ONLY. No source file is ever deleted or modified.
 *  - Destination (transfer root) uses no-overwrite semantics:
 *      missing  → copy (temp → verify size → rename to final)
 *      identical (same size)  → skip
 *      different (size mismatch) → incoming copy gets safe renamed (_1, _2, …)
 *  - AutoIngest runtime artefacts (.autoingest/, locks, sync queue, tmp) are excluded.
 *  - event.json, event.metadata.json, _Selected, XMP sidecars are always included.
 *  - Transfer metadata is written to {transferRoot}/.autoingest-transfer/ (hidden).
 *  - Only one export may run at a time; concurrent calls return { ok:false, reason:'busy' }.
 */

const fsp    = require('fs').promises;
const path   = require('path');
const crypto = require('crypto');
const os     = require('os');

const { hidePathBestEffort, isAutoIngestInternalName } = require('./internalFileProtection');

// ── Constants ─────────────────────────────────────────────────────────────────

const TRANSFER_META_DIR  = '.autoingest-transfer';
const TRANSFER_ROOT_JSON = 'transfer-root.json';
const AUDIT_JSONL        = 'exports.audit.jsonl';
const TX_TMP_SUFFIX      = '.autoingest-tx-tmp';
const MAX_ERRORS         = 200;

// Source dirs that must never be copied to the transfer drive
const _SKIP_SRC_DIRS = new Set(['.autoingest', '.autoingest-transfer', '__MACOSX']);

// ── Module-scope export state (single-active export) ─────────────────────────

let _state = {
  running:  false,
  batchId:  null,
  current:  '',
  copied:   0,
  skipped:  0,
  renamed:  0,
  errors:   [],
  total:    0,
  result:   null,
};

// ── Private helpers ───────────────────────────────────────────────────────────

function _isInsideDir(parent, child) {
  const base = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child.startsWith(base);
}

function _skipDir(name) {
  return _SKIP_SRC_DIRS.has(name) || name.startsWith('.');
}

function _skipFile(name) {
  if (name.startsWith('._') || name === '.DS_Store') return true;
  if (name.endsWith(TX_TMP_SUFFIX)) return true;
  if (name.endsWith('.autoingest-sync-tmp')) return true;
  return false;
}

async function _findSafeConflictPath(destPath) {
  const ext  = path.extname(destPath);
  const base = destPath.slice(0, destPath.length - ext.length);
  for (let n = 1; n < 200; n++) {
    const candidate = `${base}_${n}${ext}`;
    try { await fsp.access(candidate); } catch { return candidate; }
  }
  return `${base}_${Date.now()}${ext}`;
}

/**
 * Copy srcPath to a safe destination under destPath.
 * Returns 'copied' | 'skipped' | 'renamed'.
 * Never overwrites an existing destination file.
 * Uses temp-file-then-rename for atomicity and size verification.
 */
async function _copyFileSafe(srcPath, destPath, stats) {
  let srcStat;
  try { srcStat = await fsp.stat(srcPath); } catch (e) {
    throw new Error(`stat source: ${e.message}`);
  }

  let destStat = null;
  try { destStat = await fsp.stat(destPath); } catch {}

  let finalDest = destPath;
  let outcome;

  if (destStat) {
    if (destStat.size === srcStat.size) {
      stats.skipped++;
      return 'skipped';
    }
    // Destination exists with different size — write incoming to a safe conflict name
    finalDest = await _findSafeConflictPath(destPath);
    outcome = 'renamed';
  } else {
    outcome = 'copied';
  }

  await fsp.mkdir(path.dirname(finalDest), { recursive: true });

  const tmpPath = finalDest + TX_TMP_SUFFIX;
  try {
    await fsp.copyFile(srcPath, tmpPath);
    const tmpStat = await fsp.stat(tmpPath);
    if (tmpStat.size !== srcStat.size) {
      throw new Error(`size mismatch after copy (src=${srcStat.size} tmp=${tmpStat.size})`);
    }
    await fsp.rename(tmpPath, finalDest);
    if (outcome === 'renamed') stats.renamed++; else stats.copied++;
  } catch (e) {
    await fsp.unlink(tmpPath).catch(() => {});
    throw e;
  }

  // Re-apply hidden attribute to known internal files
  if (isAutoIngestInternalName(path.basename(finalDest))) {
    hidePathBestEffort(finalDest).catch(() => {});
  }

  return destStat ? 'renamed' : 'copied';
}

/**
 * Recursively walk srcDir, copying each eligible file to the mirror path under destDir.
 * Updates stats in-place. Updates _state.current for progress polling.
 */
async function _walkAndCopy(srcDir, destDir, stats) {
  let entries;
  try { entries = await fsp.readdir(srcDir, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (_skipDir(entry.name)) continue;
      await _walkAndCopy(
        path.join(srcDir, entry.name),
        path.join(destDir, entry.name),
        stats
      );
    } else if (entry.isFile()) {
      if (_skipFile(entry.name)) continue;
      if (stats.errors.length >= MAX_ERRORS) continue;

      const srcPath  = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      _state.current = entry.name;

      try {
        await _copyFileSafe(srcPath, destPath, stats);
      } catch (e) {
        stats.errors.push({ file: srcPath, error: e.message });
      }

      // Keep module-scope counters live for polling
      _state.copied  = stats.copied;
      _state.skipped = stats.skipped;
      _state.renamed = stats.renamed;
      _state.errors  = [...stats.errors];
    }
  }
}

/** Count files (no stat) in a source dir tree, respecting skip rules. */
async function _countFiles(dir) {
  let count = 0;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (_skipDir(entry.name)) continue;
      count += await _countFiles(path.join(dir, entry.name));
    } else if (entry.isFile()) {
      if (_skipFile(entry.name)) continue;
      count++;
    }
  }
  return count;
}

/** Init .autoingest-transfer/ on transfer root if not already present. */
async function _initTransferMeta(transferRoot, deviceName) {
  const metaDir    = path.join(transferRoot, TRANSFER_META_DIR);
  const markerPath = path.join(metaDir, TRANSFER_ROOT_JSON);

  await fsp.mkdir(metaDir, { recursive: true });
  hidePathBestEffort(metaDir).catch(() => {});

  try { await fsp.access(markerPath); return; } catch {}

  const marker = {
    type:      'autoingest-transfer-root',
    createdAt: new Date().toISOString(),
    deviceName,
  };
  const tmp = markerPath + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(marker, null, 2), 'utf8');
  await fsp.rename(tmp, markerPath);
}

/** Append one JSON line to the audit log. Non-fatal. */
async function _appendAudit(transferRoot, entry) {
  const auditPath = path.join(transferRoot, TRANSFER_META_DIR, AUDIT_JSONL);
  try {
    await fsp.appendFile(auditPath, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    console.error('[transferExport] audit append failed:', e.message);
  }
}

/** Inner async export routine — runs in background after runExport returns. */
async function _doExport(nasRoot, transferRoot, scope, meta) {
  const startedAt = new Date().toISOString();

  try {
    await _initTransferMeta(transferRoot, meta.deviceName);
  } catch (e) {
    _state.running = false;
    _state.result  = { ok: false, reason: 'meta-init-failed', error: e.message, completedAt: new Date().toISOString() };
    return;
  }

  const stats = { copied: 0, skipped: 0, renamed: 0, errors: [] };

  for (const collPath of scope.collectionPaths) {
    const collName    = path.basename(collPath);
    const destCollDir = path.join(transferRoot, collName);

    let collEntries;
    try { collEntries = await fsp.readdir(collPath, { withFileTypes: true }); } catch { continue; }

    for (const entry of collEntries) {
      if (!entry.isDirectory()) continue;
      if (_skipDir(entry.name)) continue;

      const srcEvDir  = path.join(collPath, entry.name);
      const destEvDir = path.join(destCollDir, entry.name);

      try { await fsp.mkdir(destEvDir, { recursive: true }); } catch {}

      await _walkAndCopy(srcEvDir, destEvDir, stats);
    }
  }

  const completedAt = new Date().toISOString();

  const auditEntry = {
    batchId:      meta.batchId,
    nasRoot,
    transferRoot,
    scope:        { collectionPaths: scope.collectionPaths },
    operatorName: meta.operatorName || null,
    deviceName:   meta.deviceName,
    startedAt,
    completedAt,
    copied:       stats.copied,
    skipped:      stats.skipped,
    renamed:      stats.renamed,
    errorCount:   stats.errors.length,
    status:       stats.errors.length === 0 ? 'ok' : 'partial',
  };
  await _appendAudit(transferRoot, auditEntry);

  _state.running = false;
  _state.copied  = stats.copied;
  _state.skipped = stats.skipped;
  _state.renamed = stats.renamed;
  _state.errors  = [...stats.errors];
  _state.result  = {
    ok:          true,
    batchId:     meta.batchId,
    copied:      stats.copied,
    skipped:     stats.skipped,
    renamed:     stats.renamed,
    errorCount:  stats.errors.length,
    startedAt,
    completedAt,
    status:      auditEntry.status,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns a snapshot of the current export state (safe to send over IPC).
 * @returns {object}
 */
function getExportStatus() {
  return { ..._state, errors: _state.errors.slice(0, 20) };
}

/**
 * Dry-run: count files that would be exported. Does NOT copy anything.
 *
 * @param {string}   nasRoot
 * @param {string}   transferRoot
 * @param {{ collectionPaths: string[] }} scope
 * @returns {Promise<{ ok: boolean, collections, events, externalFolders, files }>}
 */
async function previewExport(nasRoot, transferRoot, scope) {
  if (!nasRoot || !transferRoot) return { ok: false, reason: 'missing-roots' };
  if (nasRoot === transferRoot || _isInsideDir(nasRoot, transferRoot) || _isInsideDir(transferRoot, nasRoot)) {
    return { ok: false, reason: 'roots-overlap' };
  }
  if (!scope || !Array.isArray(scope.collectionPaths) || scope.collectionPaths.length === 0) {
    return { ok: false, reason: 'empty-scope' };
  }

  for (const cp of scope.collectionPaths) {
    if (!_isInsideDir(nasRoot, cp)) {
      return { ok: false, reason: 'scope-outside-nas-root', path: cp };
    }
  }

  let collections = 0;
  let events = 0;
  let externalFolders = 0;
  let files = 0;

  for (const collPath of scope.collectionPaths) {
    let collEntries;
    try { collEntries = await fsp.readdir(collPath, { withFileTypes: true }); } catch { continue; }
    collections++;

    for (const entry of collEntries) {
      if (!entry.isDirectory()) continue;
      if (_skipDir(entry.name)) continue;

      const evPath = path.join(collPath, entry.name);
      let hasEventJson = false;
      try { await fsp.access(path.join(evPath, 'event.json')); hasEventJson = true; } catch {}
      if (hasEventJson) events++; else externalFolders++;

      files += await _countFiles(evPath);
    }
  }

  return { ok: true, nasRoot, transferRoot, scope, collections, events, externalFolders, files };
}

/**
 * Start an export in the background. Returns immediately with { ok, batchId }.
 * Poll getExportStatus() for progress.
 *
 * @param {string}   nasRoot
 * @param {string}   transferRoot
 * @param {{ collectionPaths: string[] }} scope
 * @param {{ operatorName?: string, deviceName?: string }} meta
 * @returns {Promise<{ ok: boolean, batchId?: string, reason?: string }>}
 */
async function runExport(nasRoot, transferRoot, scope, meta = {}) {
  if (_state.running) return { ok: false, reason: 'busy' };

  if (!nasRoot || !transferRoot) return { ok: false, reason: 'missing-roots' };
  if (!scope || !Array.isArray(scope.collectionPaths) || scope.collectionPaths.length === 0) {
    return { ok: false, reason: 'empty-scope' };
  }

  for (const cp of scope.collectionPaths) {
    if (!_isInsideDir(nasRoot, cp)) return { ok: false, reason: 'scope-outside-nas-root', path: cp };
  }

  if (nasRoot === transferRoot || _isInsideDir(nasRoot, transferRoot) || _isInsideDir(transferRoot, nasRoot)) {
    return { ok: false, reason: 'roots-overlap' };
  }

  const batchId    = crypto.randomBytes(8).toString('hex');
  const deviceName = meta.deviceName || os.hostname();

  _state = {
    running:  true,
    batchId,
    current:  '',
    copied:   0,
    skipped:  0,
    renamed:  0,
    errors:   [],
    total:    0,
    result:   null,
  };

  _doExport(nasRoot, transferRoot, scope, { ...meta, batchId, deviceName }).catch(e => {
    _state.running = false;
    _state.result  = { ok: false, reason: 'unexpected-error', error: e.message, completedAt: new Date().toISOString() };
  });

  return { ok: true, batchId };
}

module.exports = { previewExport, runExport, getExportStatus };
