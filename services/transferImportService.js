'use strict';

/**
 * transferImportService.js — Controlled import from a Transfer SSD/HDD
 * into the Main Archive Root.
 *
 * Rules:
 *  - Source (transfer root) is READ-ONLY. No source file is ever deleted or modified.
 *  - Destination uses no-overwrite semantics:
 *      missing         → copy (temp → verify size → rename to final)
 *      identical size  → skip
 *      different size  → incoming copy gets safe renamed (_1, _2, …)
 *  - Transfer metadata (.autoingest-transfer/) is excluded from import.
 *  - AutoIngest runtime artefacts (.autoingest/) are excluded from copy walks.
 *  - event.json, event.metadata.json, _Selected, XMP sidecars are always included.
 *  - Audit is written to {mainArchiveRoot}/.autoingest/transfer-imports/imports.audit.jsonl.
 *  - Only one import may run at a time; concurrent calls return { ok:false, reason:'busy' }.
 *  - Import runs in event-level batches with an atomic checkpoint after each batch.
 *  - Pause takes effect between files (within a batch) or between batches.
 */

const fsp    = require('fs').promises;
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const os     = require('os');

const { hidePathBestEffort, isAutoIngestInternalName } = require('./internalFileProtection');

// ── Constants ─────────────────────────────────────────────────────────────────

const TX_TMP_SUFFIX  = '.autoingest-tx-tmp';
const CHECKPOINT_JSON = 'import-checkpoint.json';
const MAX_ERRORS     = 200;

const _SKIP_SRC_DIRS = new Set(['.autoingest', '.autoingest-transfer', '__MACOSX']);

// ── Module-scope state ────────────────────────────────────────────────────────

let _state = {
  running:      false,
  paused:       false,
  batchId:      null,
  batchIndex:   0,
  batchCount:   0,
  batchName:    '',
  current:      '',
  copied:       0,
  skipped:      0,
  renamed:      0,
  copiedBytes:  0,
  errors:       [],
  total:        0,
  result:       null,
  verifyStatus: null,
  verifyTotal:  0,
  verifyDone:   0,
  verifyFailed: 0,
};

let _isPaused       = false;
let _pauseResolvers = [];

function _waitIfPaused() {
  if (!_isPaused) return Promise.resolve();
  return new Promise(resolve => _pauseResolvers.push(resolve));
}

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
    stats.copiedBytes = (stats.copiedBytes || 0) + srcStat.size;
  } catch (e) {
    await fsp.unlink(tmpPath).catch(() => {});
    throw e;
  }

  if (isAutoIngestInternalName(path.basename(finalDest))) {
    hidePathBestEffort(finalDest).catch(() => {});
  }

  return outcome;
}

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

      await _waitIfPaused();

      const srcPath  = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      _state.current = entry.name;

      try {
        await _copyFileSafe(srcPath, destPath, stats);
      } catch (e) {
        stats.errors.push({ file: srcPath, error: e.message });
      }

      _state.copied      = stats.copied;
      _state.skipped     = stats.skipped;
      _state.renamed     = stats.renamed;
      _state.errors      = [...stats.errors];
      _state.copiedBytes = stats.copiedBytes || 0;
    }
  }
}

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

// ── Checkpoint helpers ────────────────────────────────────────────────────────

function _checkpointPath(mainArchiveRoot) {
  return path.join(mainArchiveRoot, '.autoingest', 'transfer-imports', CHECKPOINT_JSON);
}

async function _writeCheckpoint(mainArchiveRoot, data) {
  const dest = _checkpointPath(mainArchiveRoot);
  const tmp  = dest + '.tmp';
  try {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fsp.rename(tmp, dest);
  } catch (e) {
    console.error('[transferImport] checkpoint write failed:', e.message);
  }
}

async function _readCheckpoint(mainArchiveRoot) {
  try {
    const raw = await fsp.readFile(_checkpointPath(mainArchiveRoot), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function _clearCheckpointFile(mainArchiveRoot) {
  try { await fsp.unlink(_checkpointPath(mainArchiveRoot)); } catch {}
}

// ── Inline SHA-256 ────────────────────────────────────────────────────────────

function _fileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash   = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    let done = false;
    const cleanup = () => { if (done) return; done = true; stream.removeAllListeners(); stream.destroy(); };
    stream.on('data',  chunk => hash.update(chunk));
    stream.on('end',   ()    => { cleanup(); resolve(hash.digest('hex')); });
    stream.on('error', err   => { cleanup(); reject(err); });
  });
}

// ── Import execution ──────────────────────────────────────────────────────────

async function _doImport(transferRoot, mainArchiveRoot, collectionPaths, meta, resumeBatches) {
  const startedAt = new Date().toISOString();

  // ── Build or restore batch list ───────────────────────────────────────────
  let batches;

  if (resumeBatches) {
    batches           = resumeBatches;
    _state.total      = batches.reduce((s, b) => s + (b.fileCount || 0), 0);
    _state.batchCount = batches.length;
  } else {
    batches = [];
    for (const collPath of collectionPaths) {
      const collName = path.basename(collPath);
      let collEntries;
      try { collEntries = await fsp.readdir(collPath, { withFileTypes: true }); } catch { continue; }
      for (const entry of collEntries) {
        if (!entry.isDirectory() || _skipDir(entry.name)) continue;
        batches.push({
          batchIdx:       batches.length,
          collectionName: collName,
          eventName:      entry.name,
          srcDir:         path.join(collPath, entry.name),
          destDir:        path.join(mainArchiveRoot, collName, entry.name),
          fileCount:      0,
          status:         'pending',
          copied: 0, skipped: 0, renamed: 0, errors: 0,
        });
      }
    }

    let totalFiles = 0;
    for (const batch of batches) {
      batch.fileCount = await _countFiles(batch.srcDir);
      totalFiles += batch.fileCount;
    }
    _state.total      = totalFiles;
    _state.batchCount = batches.length;
  }

  // ── Write initial checkpoint ──────────────────────────────────────────────
  await _writeCheckpoint(mainArchiveRoot, {
    importId:        meta.batchId,
    transferRoot,
    mainArchiveRoot,
    collectionPaths,
    createdAt:       startedAt,
    status:          'running',
    batches,
    currentBatchIdx: 0,
    totalFiles:      _state.total,
    totalCopied:     _state.copied,
    totalSkipped:    _state.skipped,
    totalRenamed:    _state.renamed,
    totalErrors:     _state.errors.length,
  });

  const stats = {
    copied:  _state.copied,
    skipped: _state.skipped,
    renamed: _state.renamed,
    copiedBytes: 0,
    errors:  [..._state.errors],
  };

  // ── Execute batches ───────────────────────────────────────────────────────
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    if (batch.status === 'complete') continue;

    await _waitIfPaused();
    if (!_state.running) break;

    batch.status      = 'exporting';
    _state.batchIndex = i;
    _state.batchName  = `${batch.collectionName} / ${batch.eventName}`;

    try { await fsp.mkdir(batch.destDir, { recursive: true }); } catch {}

    const beforeCopied  = stats.copied;
    const beforeSkipped = stats.skipped;
    const beforeRenamed = stats.renamed;
    const beforeErrors  = stats.errors.length;

    await _walkAndCopy(batch.srcDir, batch.destDir, stats);

    batch.copied  = stats.copied  - beforeCopied;
    batch.skipped = stats.skipped - beforeSkipped;
    batch.renamed = stats.renamed - beforeRenamed;
    batch.errors  = stats.errors.length - beforeErrors;
    batch.status  = 'complete';

    await _writeCheckpoint(mainArchiveRoot, {
      importId:        meta.batchId,
      transferRoot,
      mainArchiveRoot,
      collectionPaths,
      createdAt:       startedAt,
      status:          _state.paused ? 'paused' : 'running',
      batches,
      currentBatchIdx: i,
      totalFiles:      _state.total,
      totalCopied:     stats.copied,
      totalSkipped:    stats.skipped,
      totalRenamed:    stats.renamed,
      totalErrors:     stats.errors.length,
    });
  }

  const completedAt = new Date().toISOString();
  const finalStatus = stats.errors.length === 0 ? 'ok' : 'partial';

  await _writeCheckpoint(mainArchiveRoot, {
    importId:     meta.batchId,
    transferRoot,
    mainArchiveRoot,
    collectionPaths,
    createdAt:    startedAt,
    completedAt,
    status:       'complete',
    batches,
    totalFiles:   _state.total,
    totalCopied:  stats.copied,
    totalSkipped: stats.skipped,
    totalRenamed: stats.renamed,
    totalErrors:  stats.errors.length,
  });

  const auditEntry = {
    batchId:        meta.batchId,
    transferRoot,
    mainArchiveRoot,
    scope:          { collectionPaths },
    operatorName:   meta.operatorName || null,
    deviceName:     meta.deviceName,
    startedAt,
    completedAt,
    copied:         stats.copied,
    skipped:        stats.skipped,
    renamed:        stats.renamed,
    errorCount:     stats.errors.length,
    status:         finalStatus,
  };

  try {
    const auditDir  = path.join(mainArchiveRoot, '.autoingest', 'transfer-imports');
    await fsp.mkdir(auditDir, { recursive: true });
    const auditPath = path.join(auditDir, 'imports.audit.jsonl');
    await fsp.appendFile(auditPath, JSON.stringify(auditEntry) + '\n', 'utf8');
  } catch (e) {
    console.error('[transferImport] audit write failed:', e.message);
  }

  _state.running = false;
  _state.paused  = false;
  _state.copied  = stats.copied;
  _state.skipped = stats.skipped;
  _state.renamed = stats.renamed;
  _state.errors  = [...stats.errors];
  _state.result  = {
    ok:         true,
    batchId:    meta.batchId,
    copied:     stats.copied,
    skipped:    stats.skipped,
    renamed:    stats.renamed,
    errorCount: stats.errors.length,
    startedAt,
    completedAt,
    status:     finalStatus,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

async function scanCollections(transferRoot) {
  if (!transferRoot) return { ok: false, reason: 'transfer-root-not-set' };
  let entries;
  try {
    entries = await fsp.readdir(transferRoot, { withFileTypes: true });
  } catch (e) {
    return { ok: false, reason: 'transfer-root-unreadable', error: e.message };
  }
  const collections = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (_skipDir(entry.name)) continue;
    collections.push({ name: entry.name, path: path.join(transferRoot, entry.name) });
  }

  let exportPurpose = 'archive-transfer';
  try {
    const cpPath = path.join(transferRoot, '.autoingest-transfer', 'export-checkpoint.json');
    const raw    = await fsp.readFile(cpPath, 'utf8');
    const cp     = JSON.parse(raw);
    if (cp.exportPurpose) exportPurpose = cp.exportPurpose;
  } catch {}

  return { ok: true, collections, exportPurpose };
}

function getImportStatus() {
  return { ..._state, errors: _state.errors.slice(0, 20) };
}

function pauseImport() {
  if (!_state.running || _state.paused) {
    return { ok: false, reason: _state.paused ? 'already-paused' : 'not-running' };
  }
  _isPaused     = true;
  _state.paused = true;
  return { ok: true };
}

function resumeImport() {
  if (!_state.paused) return { ok: false, reason: 'not-paused' };
  _isPaused     = false;
  _state.paused = false;
  const resolvers = _pauseResolvers;
  _pauseResolvers = [];
  resolvers.forEach(r => r());
  return { ok: true };
}

async function getImportCheckpoint(mainArchiveRoot) {
  if (!mainArchiveRoot) return null;
  return _readCheckpoint(mainArchiveRoot);
}

async function clearImportCheckpoint(mainArchiveRoot) {
  if (!mainArchiveRoot) return { ok: false, reason: 'no-archive-root' };
  await _clearCheckpointFile(mainArchiveRoot);
  return { ok: true };
}

async function previewImport(transferRoot, mainArchiveRoot, scope) {
  if (!transferRoot || !mainArchiveRoot) return { ok: false, reason: 'missing-roots' };
  if (transferRoot === mainArchiveRoot ||
      _isInsideDir(transferRoot, mainArchiveRoot) ||
      _isInsideDir(mainArchiveRoot, transferRoot)) {
    return { ok: false, reason: 'roots-overlap' };
  }
  if (!scope || !Array.isArray(scope.collectionPaths) || scope.collectionPaths.length === 0) {
    return { ok: false, reason: 'empty-scope' };
  }

  for (const cp of scope.collectionPaths) {
    if (!_isInsideDir(transferRoot, cp)) {
      return { ok: false, reason: 'scope-outside-transfer-root', path: cp };
    }
  }

  let collections = 0, events = 0, externalFolders = 0, files = 0;

  for (const collPath of scope.collectionPaths) {
    let collEntries;
    try { collEntries = await fsp.readdir(collPath, { withFileTypes: true }); } catch { continue; }
    collections++;

    for (const entry of collEntries) {
      if (!entry.isDirectory() || _skipDir(entry.name)) continue;
      const evPath = path.join(collPath, entry.name);
      let hasEventJson = false;
      try { await fsp.access(path.join(evPath, 'event.json')); hasEventJson = true; } catch {}
      if (hasEventJson) events++; else externalFolders++;
      files += await _countFiles(evPath);
    }
  }

  return { ok: true, transferRoot, mainArchiveRoot, scope, collections, events, externalFolders, files };
}

async function runImport(transferRoot, mainArchiveRoot, scope, meta = {}) {
  if (_state.running) return { ok: false, reason: 'busy' };

  if (!transferRoot || !mainArchiveRoot) return { ok: false, reason: 'missing-roots' };
  if (!scope || !Array.isArray(scope.collectionPaths) || scope.collectionPaths.length === 0) {
    return { ok: false, reason: 'empty-scope' };
  }
  for (const cp of scope.collectionPaths) {
    if (!_isInsideDir(transferRoot, cp)) {
      return { ok: false, reason: 'scope-outside-transfer-root', path: cp };
    }
  }
  if (transferRoot === mainArchiveRoot ||
      _isInsideDir(transferRoot, mainArchiveRoot) ||
      _isInsideDir(mainArchiveRoot, transferRoot)) {
    return { ok: false, reason: 'roots-overlap' };
  }

  const batchId    = crypto.randomBytes(8).toString('hex');
  const deviceName = meta.deviceName || os.hostname();

  _isPaused       = false;
  _pauseResolvers = [];

  _state = {
    running: true, paused: false, batchId,
    batchIndex: 0, batchCount: 0, batchName: '',
    current: '', copied: 0, skipped: 0, renamed: 0, errors: [],
    total: 0, result: null,
    verifyStatus: null, verifyTotal: 0, verifyDone: 0, verifyFailed: 0,
  };

  _doImport(transferRoot, mainArchiveRoot, scope.collectionPaths, { ...meta, batchId, deviceName }, null)
    .catch(e => {
      _state.running = false;
      _state.result  = { ok: false, reason: 'unexpected-error', error: e.message, completedAt: new Date().toISOString() };
    });

  return { ok: true, batchId };
}

async function resumeImportFromCheckpoint(transferRoot, mainArchiveRoot, meta = {}) {
  if (_state.running) return { ok: false, reason: 'busy' };

  const checkpoint = await _readCheckpoint(mainArchiveRoot);
  if (!checkpoint)                            return { ok: false, reason: 'no-checkpoint' };
  if (checkpoint.transferRoot !== transferRoot) return { ok: false, reason: 'checkpoint-mismatch' };
  if (checkpoint.status === 'complete')       return { ok: false, reason: 'already-complete' };
  if (!Array.isArray(checkpoint.batches))     return { ok: false, reason: 'checkpoint-invalid' };

  const batchId    = checkpoint.importId;
  const deviceName = meta.deviceName || os.hostname();

  _isPaused       = false;
  _pauseResolvers = [];

  _state = {
    running: true, paused: false, batchId,
    batchIndex:   checkpoint.currentBatchIdx || 0,
    batchCount:   checkpoint.batches.length,
    batchName:    '',
    current:      '',
    copied:       checkpoint.totalCopied  || 0,
    skipped:      checkpoint.totalSkipped || 0,
    renamed:      checkpoint.totalRenamed || 0,
    errors:       [],
    total:        checkpoint.totalFiles   || 0,
    result:       null,
    verifyStatus: null, verifyTotal: 0, verifyDone: 0, verifyFailed: 0,
  };

  _doImport(
    transferRoot, mainArchiveRoot,
    checkpoint.collectionPaths || [],
    { ...meta, batchId, deviceName },
    checkpoint.batches
  ).catch(e => {
    _state.running = false;
    _state.result  = { ok: false, reason: 'unexpected-error', error: e.message, completedAt: new Date().toISOString() };
  });

  return { ok: true, batchId, resuming: true };
}

async function verifyImport(transferRoot, mainArchiveRoot, scope) {
  if (!transferRoot || !mainArchiveRoot || !scope) return { ok: false, reason: 'missing-params' };

  _state.verifyStatus = 'verifying';
  _state.verifyTotal  = 0;
  _state.verifyDone   = 0;
  _state.verifyFailed = 0;

  const results = { verified: 0, failed: 0, missing: 0, errors: [] };

  async function verifyDir(srcDir, destDir) {
    let entries;
    try { entries = await fsp.readdir(srcDir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (_skipDir(entry.name)) continue;
        await verifyDir(path.join(srcDir, entry.name), path.join(destDir, entry.name));
      } else if (entry.isFile()) {
        if (_skipFile(entry.name)) continue;
        _state.verifyTotal++;

        const srcPath  = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);

        let srcStat;
        try { srcStat = await fsp.stat(srcPath); } catch {
          results.missing++;
          _state.verifyFailed++;
          _state.verifyDone++;
          continue;
        }

        let destStat = null;
        try { destStat = await fsp.stat(destPath); } catch {}

        if (!destStat) {
          const ext  = path.extname(entry.name);
          const base = destPath.slice(0, destPath.length - ext.length);
          for (let n = 1; n <= 20; n++) {
            try {
              const s = await fsp.stat(`${base}_${n}${ext}`);
              if (s.size === srcStat.size) { destStat = s; break; }
            } catch { break; }
          }
        }

        if (!destStat) {
          results.missing++;
          _state.verifyFailed++;
          results.errors.push({ file: entry.name, reason: 'missing-at-destination' });
          _state.verifyDone++;
          continue;
        }

        if (destStat.size !== srcStat.size) {
          results.failed++;
          _state.verifyFailed++;
          results.errors.push({ file: entry.name, reason: 'size-mismatch' });
          _state.verifyDone++;
          continue;
        }

        try {
          const [srcHash, destHash] = await Promise.all([_fileHash(srcPath), _fileHash(destPath)]);
          if (srcHash !== destHash) {
            results.failed++;
            _state.verifyFailed++;
            results.errors.push({ file: entry.name, reason: 'hash-mismatch' });
          } else {
            results.verified++;
          }
        } catch (e) {
          results.failed++;
          _state.verifyFailed++;
          results.errors.push({ file: entry.name, reason: e.message });
        }
        _state.verifyDone++;
      }
    }
  }

  for (const collPath of scope.collectionPaths) {
    const collName = path.basename(collPath);
    let collEntries;
    try { collEntries = await fsp.readdir(collPath, { withFileTypes: true }); } catch { continue; }
    for (const entry of collEntries) {
      if (!entry.isDirectory() || _skipDir(entry.name)) continue;
      await verifyDir(
        path.join(collPath, entry.name),
        path.join(mainArchiveRoot, collName, entry.name)
      );
    }
  }

  _state.verifyStatus = (results.failed > 0 || results.missing > 0) ? 'failed' : 'verified';

  return {
    ok:       true,
    verified: results.verified,
    failed:   results.failed,
    missing:  results.missing,
    status:   _state.verifyStatus,
    errors:   results.errors.slice(0, 20),
  };
}

module.exports = {
  scanCollections,
  previewImport,
  runImport,
  resumeImportFromCheckpoint,
  getImportStatus,
  pauseImport,
  resumeImport,
  getImportCheckpoint,
  clearImportCheckpoint,
  verifyImport,
};
