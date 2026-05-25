'use strict';

/**
 * transferExportService.js — Controlled export from Active Archive Root
 * to a Transfer SSD/HDD.
 *
 * Rules:
 *  - Source (NAS root) is READ-ONLY. No source file is ever deleted or modified.
 *  - Destination uses no-overwrite semantics:
 *      missing         → copy (temp → verify size → rename to final)
 *      identical size  → skip
 *      different size  → incoming copy gets safe renamed (_1, _2, …)
 *  - AutoIngest runtime artefacts (.autoingest/, locks, sync queue, tmp) are excluded.
 *  - event.json, event.metadata.json, _Selected, XMP sidecars are always included.
 *  - Transfer metadata is written to {transferRoot}/.autoingest-transfer/ (hidden).
 *  - Only one export may run at a time; concurrent calls return { ok:false, reason:'busy' }.
 *  - Export runs in event-level batches with an atomic checkpoint after each batch.
 *  - Pause takes effect between files (within a batch) or between batches.
 */

const fsp    = require('fs').promises;
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const os     = require('os');

const { hidePathBestEffort, isAutoIngestInternalName } = require('./internalFileProtection');

// ── Constants ─────────────────────────────────────────────────────────────────

const TRANSFER_META_DIR  = '.autoingest-transfer';
const TRANSFER_ROOT_JSON = 'transfer-root.json';
const AUDIT_JSONL        = 'exports.audit.jsonl';
const CHECKPOINT_JSON    = 'export-checkpoint.json';
const TX_TMP_SUFFIX      = '.autoingest-tx-tmp';
const MAX_ERRORS         = 200;

const _SKIP_SRC_DIRS = new Set(['.autoingest', '.autoingest-transfer', '__MACOSX']);

// ── Module-scope state ────────────────────────────────────────────────────────

let _state = {
  running:       false,
  paused:        false,
  batchId:       null,
  batchIndex:    0,
  batchCount:    0,
  batchName:     '',
  current:       '',
  copied:        0,
  skipped:       0,
  renamed:       0,
  errors:        [],
  total:         0,
  result:        null,
  verifyStatus:  null,
  verifyTotal:   0,
  verifyDone:    0,
  verifyFailed:  0,
  verifyMissing: 0,
  verifyCurrent: '',
  verifyResult:  null,
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

      _state.copied  = stats.copied;
      _state.skipped = stats.skipped;
      _state.renamed = stats.renamed;
      _state.errors  = [...stats.errors];
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

async function _appendAudit(transferRoot, entry) {
  const auditPath = path.join(transferRoot, TRANSFER_META_DIR, AUDIT_JSONL);
  try {
    await fsp.appendFile(auditPath, JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    console.error('[transferExport] audit append failed:', e.message);
  }
}

// ── Checkpoint helpers ────────────────────────────────────────────────────────

async function _writeCheckpoint(transferRoot, data) {
  const dir  = path.join(transferRoot, TRANSFER_META_DIR);
  const dest = path.join(dir, CHECKPOINT_JSON);
  const tmp  = dest + '.tmp';
  try {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
    await fsp.rename(tmp, dest);
  } catch (e) {
    console.error('[transferExport] checkpoint write failed:', e.message);
  }
}

async function _readCheckpoint(transferRoot) {
  const dest = path.join(transferRoot, TRANSFER_META_DIR, CHECKPOINT_JSON);
  try {
    const raw = await fsp.readFile(dest, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function _clearCheckpointFile(transferRoot) {
  const dest = path.join(transferRoot, TRANSFER_META_DIR, CHECKPOINT_JSON);
  try { await fsp.unlink(dest); } catch {}
}

// ── Three-level tree scan for UI ──────────────────────────────────────────────

async function scanExportTree(nasRoot) {
  if (!nasRoot) return { ok: false, reason: 'nas-not-set' };

  let collEntries;
  try { collEntries = await fsp.readdir(nasRoot, { withFileTypes: true }); } catch {
    return { ok: false, reason: 'nas-unreadable' };
  }

  const tree = [];
  for (const collEntry of collEntries) {
    if (!collEntry.isDirectory() || _skipDir(collEntry.name)) continue;
    const collPath = path.join(nasRoot, collEntry.name);

    let evEntries;
    try { evEntries = await fsp.readdir(collPath, { withFileTypes: true }); } catch { continue; }

    const events = [];
    for (const evEntry of evEntries) {
      if (!evEntry.isDirectory() || _skipDir(evEntry.name)) continue;
      const evPath = path.join(collPath, evEntry.name);

      let subEntries;
      try { subEntries = await fsp.readdir(evPath, { withFileTypes: true }); } catch { continue; }

      const folders = [];
      let hasRootFiles = false;

      for (const sub of subEntries) {
        if (sub.isDirectory() && !_skipDir(sub.name)) {
          folders.push({ name: sub.name, path: path.join(evPath, sub.name) });
        } else if (sub.isFile() && !_skipFile(sub.name)) {
          hasRootFiles = true;
        }
      }

      if (hasRootFiles) {
        folders.unshift({ name: '(event root files)', path: evPath, isEventRoot: true });
      }

      events.push({ name: evEntry.name, path: evPath, folders });
    }

    tree.push({ name: collEntry.name, path: collPath, events });
  }

  return { ok: true, tree };
}

// ── Inline SHA-256 (avoids importing fileManager which has side-effect state) ─

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

// ── Export execution ──────────────────────────────────────────────────────────

async function _doExport(nasRoot, transferRoot, scope, meta, resumeBatches) {
  const startedAt = new Date().toISOString();
  const { collectionPaths = [], folderPaths = null } = scope || {};

  try {
    await _initTransferMeta(transferRoot, meta.deviceName);
  } catch (e) {
    _state.running = false;
    _state.result  = { ok: false, reason: 'meta-init-failed', error: e.message, completedAt: new Date().toISOString() };
    return;
  }

  // ── Build or restore batch list ───────────────────────────────────────────
  let batches;

  if (resumeBatches) {
    batches           = resumeBatches;
    _state.total      = batches.reduce((s, b) => s + (b.fileCount || 0), 0);
    _state.batchCount = batches.length;
  } else if (folderPaths && folderPaths.length > 0) {
    // Photographer-folder-level batches from explicit selection
    batches = [];
    for (const fp of folderPaths) {
      const rel   = path.relative(nasRoot, fp);
      const parts = rel.split(path.sep);
      batches.push({
        batchIdx:       batches.length,
        collectionName: parts[0] || '',
        eventName:      parts[1] || '',
        folderName:     parts.slice(2).join('/') || '',
        batchLabel:     parts.join(' / '),
        srcDir:         fp,
        destDir:        path.join(transferRoot, rel),
        fileCount:      0,
        status:         'pending',
        copied: 0, skipped: 0, renamed: 0, errors: 0,
      });
    }

    let totalFiles = 0;
    for (const batch of batches) {
      batch.fileCount = await _countFiles(batch.srcDir);
      totalFiles += batch.fileCount;
    }
    _state.total      = totalFiles;
    _state.batchCount = batches.length;
  } else {
    // Event-level batches from collection paths (original behaviour)
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
          folderName:     '',
          batchLabel:     `${collName} / ${entry.name}`,
          srcDir:         path.join(collPath, entry.name),
          destDir:        path.join(transferRoot, collName, entry.name),
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
  await _writeCheckpoint(transferRoot, {
    exportId:        meta.batchId,
    nasRoot,
    transferRoot,
    collectionPaths,
    folderPaths:     folderPaths || null,
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
    _state.batchName  = batch.batchLabel || `${batch.collectionName} / ${batch.eventName}`;

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

    await _writeCheckpoint(transferRoot, {
      exportId:        meta.batchId,
      nasRoot,
      transferRoot,
      collectionPaths,
      folderPaths:     folderPaths || null,
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

  await _writeCheckpoint(transferRoot, {
    exportId:     meta.batchId,
    nasRoot,
    transferRoot,
    collectionPaths,
    folderPaths:  folderPaths || null,
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
    batchId:      meta.batchId,
    nasRoot,
    transferRoot,
    scope:        { collectionPaths, folderPaths: folderPaths || null },
    operatorName: meta.operatorName || null,
    deviceName:   meta.deviceName,
    startedAt,
    completedAt,
    copied:       stats.copied,
    skipped:      stats.skipped,
    renamed:      stats.renamed,
    errorCount:   stats.errors.length,
    status:       finalStatus,
  };
  await _appendAudit(transferRoot, auditEntry);

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

function getExportStatus() {
  return { ..._state, errors: _state.errors.slice(0, 20) };
}

function pauseExport() {
  if (!_state.running || _state.paused) {
    return { ok: false, reason: _state.paused ? 'already-paused' : 'not-running' };
  }
  _isPaused     = true;
  _state.paused = true;
  return { ok: true };
}

function resumeExport() {
  if (!_state.paused) return { ok: false, reason: 'not-paused' };
  _isPaused     = false;
  _state.paused = false;
  const resolvers = _pauseResolvers;
  _pauseResolvers = [];
  resolvers.forEach(r => r());
  return { ok: true };
}

async function getExportCheckpoint(transferRoot) {
  if (!transferRoot) return null;
  return _readCheckpoint(transferRoot);
}

async function clearExportCheckpoint(transferRoot) {
  if (!transferRoot) return { ok: false, reason: 'no-transfer-root' };
  await _clearCheckpointFile(transferRoot);
  return { ok: true };
}

async function previewExport(nasRoot, transferRoot, scope) {
  if (!nasRoot || !transferRoot) return { ok: false, reason: 'missing-roots' };
  if (nasRoot === transferRoot || _isInsideDir(nasRoot, transferRoot) || _isInsideDir(transferRoot, nasRoot)) {
    return { ok: false, reason: 'roots-overlap' };
  }
  const hasFoldPaths = Array.isArray(scope?.folderPaths) && scope.folderPaths.length > 0;
  const hasCollPaths = Array.isArray(scope?.collectionPaths) && scope.collectionPaths.length > 0;
  if (!scope || (!hasCollPaths && !hasFoldPaths)) {
    return { ok: false, reason: 'empty-scope' };
  }

  for (const cp of (scope.collectionPaths || [])) {
    if (!_isInsideDir(nasRoot, cp)) {
      return { ok: false, reason: 'scope-outside-nas-root', path: cp };
    }
  }

  // Folder-level preview (photographer-folder selection)
  if (scope.folderPaths && scope.folderPaths.length > 0) {
    for (const fp of scope.folderPaths) {
      if (!_isInsideDir(nasRoot, fp)) return { ok: false, reason: 'scope-outside-nas-root', path: fp };
    }
    const collectionSet = new Set(), eventSet = new Set();
    let folders = 0, files = 0;
    for (const fp of scope.folderPaths) {
      const rel   = path.relative(nasRoot, fp);
      const parts = rel.split(path.sep);
      if (parts[0]) collectionSet.add(parts[0]);
      if (parts[0] && parts[1]) eventSet.add(parts[0] + '/' + parts[1]);
      folders++;
      files += await _countFiles(fp);
    }
    return { ok: true, nasRoot, transferRoot, scope,
      collections: collectionSet.size, events: eventSet.size,
      folders, externalFolders: 0, files };
  }

  // Collection-level preview (legacy / collection-only scope)
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

  return { ok: true, nasRoot, transferRoot, scope, collections, events, externalFolders, files };
}

async function runExport(nasRoot, transferRoot, scope, meta = {}) {
  if (_state.running) return { ok: false, reason: 'busy' };

  if (!nasRoot || !transferRoot) return { ok: false, reason: 'missing-roots' };
  const hasFoldPaths = Array.isArray(scope?.folderPaths) && scope.folderPaths.length > 0;
  const hasCollPaths = Array.isArray(scope?.collectionPaths) && scope.collectionPaths.length > 0;
  if (!scope || (!hasCollPaths && !hasFoldPaths)) {
    return { ok: false, reason: 'empty-scope' };
  }
  for (const cp of (scope.collectionPaths || [])) {
    if (!_isInsideDir(nasRoot, cp)) return { ok: false, reason: 'scope-outside-nas-root', path: cp };
  }
  if (nasRoot === transferRoot || _isInsideDir(nasRoot, transferRoot) || _isInsideDir(transferRoot, nasRoot)) {
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
    verifyStatus: null, verifyTotal: 0, verifyDone: 0,
    verifyFailed: 0, verifyMissing: 0, verifyCurrent: '', verifyResult: null,
  };

  _doExport(nasRoot, transferRoot, scope, { ...meta, batchId, deviceName }, null)
    .catch(e => {
      _state.running = false;
      _state.result  = { ok: false, reason: 'unexpected-error', error: e.message, completedAt: new Date().toISOString() };
    });

  return { ok: true, batchId };
}

async function resumeExportFromCheckpoint(nasRoot, transferRoot, meta = {}) {
  if (_state.running) return { ok: false, reason: 'busy' };

  const checkpoint = await _readCheckpoint(transferRoot);
  if (!checkpoint)                         return { ok: false, reason: 'no-checkpoint' };
  if (checkpoint.nasRoot !== nasRoot)      return { ok: false, reason: 'checkpoint-mismatch' };
  if (checkpoint.status === 'complete')    return { ok: false, reason: 'already-complete' };
  if (!Array.isArray(checkpoint.batches)) return { ok: false, reason: 'checkpoint-invalid' };

  const batchId    = checkpoint.exportId;
  const deviceName = meta.deviceName || os.hostname();

  _isPaused       = false;
  _pauseResolvers = [];

  _state = {
    running: true, paused: false, batchId,
    batchIndex:    checkpoint.currentBatchIdx || 0,
    batchCount:    checkpoint.batches.length,
    batchName:     '',
    current:       '',
    copied:        checkpoint.totalCopied  || 0,
    skipped:       checkpoint.totalSkipped || 0,
    renamed:       checkpoint.totalRenamed || 0,
    errors:        [],
    total:         checkpoint.totalFiles   || 0,
    result:        null,
    verifyStatus:  null, verifyTotal: 0, verifyDone: 0,
    verifyFailed:  0, verifyMissing: 0, verifyCurrent: '', verifyResult: null,
  };

  _doExport(
    nasRoot, transferRoot,
    { collectionPaths: checkpoint.collectionPaths || [], folderPaths: checkpoint.folderPaths || null },
    { ...meta, batchId, deviceName },
    checkpoint.batches
  ).catch(e => {
    _state.running = false;
    _state.result  = { ok: false, reason: 'unexpected-error', error: e.message, completedAt: new Date().toISOString() };
  });

  return { ok: true, batchId, resuming: true };
}

async function verifyExport(nasRoot, transferRoot, scope) {
  if (!nasRoot || !transferRoot || !scope) return { ok: false, reason: 'missing-params' };

  _state.verifyStatus  = 'verifying';
  _state.verifyTotal   = 0;
  _state.verifyDone    = 0;
  _state.verifyFailed  = 0;
  _state.verifyMissing = 0;
  _state.verifyCurrent = '';
  _state.verifyResult  = null;

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
        _state.verifyCurrent = entry.name;

        const srcPath  = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);

        let srcStat;
        try { srcStat = await fsp.stat(srcPath); } catch {
          results.missing++;
          _state.verifyMissing++;
          _state.verifyDone++;
          continue;
        }

        let destStat = null;
        try { destStat = await fsp.stat(destPath); } catch {}

        // Also check for a conflict-renamed copy (_1, _2 …)
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
          _state.verifyMissing++;
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

  // Folder-level verify (photographer-folder selection)
  if (scope.folderPaths && scope.folderPaths.length > 0) {
    for (const fp of scope.folderPaths) {
      const rel = path.relative(nasRoot, fp);
      await verifyDir(fp, path.join(transferRoot, rel));
    }
  } else {
    // Collection-level verify (legacy)
    for (const collPath of scope.collectionPaths) {
      const collName = path.basename(collPath);
      let collEntries;
      try { collEntries = await fsp.readdir(collPath, { withFileTypes: true }); } catch { continue; }
      for (const entry of collEntries) {
        if (!entry.isDirectory() || _skipDir(entry.name)) continue;
        await verifyDir(
          path.join(collPath, entry.name),
          path.join(transferRoot, collName, entry.name)
        );
      }
    }
  }

  _state.verifyStatus = (results.failed > 0 || results.missing > 0) ? 'failed' : 'verified';
  _state.verifyCurrent = '';

  const verifyResult = {
    ok:       true,
    verified: results.verified,
    failed:   results.failed,
    missing:  results.missing,
    status:   _state.verifyStatus,
    errors:   results.errors.slice(0, 20),
  };
  _state.verifyResult = verifyResult;
  return verifyResult;
}

module.exports = {
  scanExportTree,
  previewExport,
  runExport,
  resumeExportFromCheckpoint,
  getExportStatus,
  pauseExport,
  resumeExport,
  getExportCheckpoint,
  clearExportCheckpoint,
  verifyExport,
};
