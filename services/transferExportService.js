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

const _SKIP_SRC_DIRS     = new Set(['.autoingest', '.autoingest-transfer', '__MACOSX']);
const _CONTROL_FILE_NAMES = new Set(['event.json', 'event.metadata.json', 'event.sync.json']);

// ── Module-scope state ────────────────────────────────────────────────────────

let _state = {
  running:       false,
  paused:        false,
  batchId:       null,
  batchIndex:    0,
  batchCount:    0,
  batchName:     '',
  current:       '',
  currentDir:    '',
  copied:        0,
  skipped:       0,
  renamed:       0,
  copiedBytes:   0,
  changedSkipped: 0,
  backupUpdate:  false,
  errors:        [],
  total:         0,
  totalBytes:    0,
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

function _skipControlFile(name) {
  return _CONTROL_FILE_NAMES.has(name);
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

async function _copyFileSafe(srcPath, destPath, stats, opts = {}) {
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
    // Backup-update mode (Backup Sync Check): NEVER overwrite and NEVER create _1/_2
    // duplicates. A same-path / different-size file is left untouched and surfaced by the
    // scan as "Changed / Needs Review" — only genuinely missing files are copied.
    if (opts.backupUpdate) {
      // Custom-source mode treats all files equally — no special archive control files.
      // Archive mode overwrites control files (event.json, etc.) since they are maintained
      // by the source archive and not user-editable on the transfer drive.
      if (opts.sourceMode === 'custom' || !_CONTROL_FILE_NAMES.has(path.basename(destPath))) {
        stats.skipped++;
        if (typeof stats.changedSkipped === 'number') stats.changedSkipped++;
        return 'skipped-changed';
      }
      // Archive mode control file: fall through to overwrite at destPath.
      outcome = 'copied';
    } else {
      finalDest = await _findSafeConflictPath(destPath);
      outcome = 'renamed';
    }
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

async function _walkAndCopy(srcDir, destDir, stats, opts = {}) {
  let entries;
  try { entries = await fsp.readdir(srcDir, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (_skipDir(entry.name)) continue;
      if (opts.rootFilesOnly) continue;
      await _walkAndCopy(
        path.join(srcDir, entry.name),
        path.join(destDir, entry.name),
        stats,
        opts
      );
    } else if (entry.isFile()) {
      if (_skipFile(entry.name)) continue;
      if (opts.skipControlFiles && _skipControlFile(entry.name)) continue;
      if (stats.errors.length >= MAX_ERRORS) continue;

      await _waitIfPaused();

      const srcPath  = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      _state.current    = entry.name;
      _state.currentDir = srcDir;

      try {
        await _copyFileSafe(srcPath, destPath, stats, opts);
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

async function _countFiles(dir, opts = {}) {
  let count = 0;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (_skipDir(entry.name)) continue;
      if (opts.rootFilesOnly) continue;
      count += await _countFiles(path.join(dir, entry.name), opts);
    } else if (entry.isFile()) {
      if (_skipFile(entry.name)) continue;
      if (opts.skipControlFiles && _skipControlFile(entry.name)) continue;
      count++;
    }
  }
  return count;
}

async function _sumBytes(dir, opts = {}) {
  let bytes = 0;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return 0; }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (_skipDir(entry.name)) continue;
      if (opts.rootFilesOnly) continue;
      bytes += await _sumBytes(path.join(dir, entry.name), opts);
    } else if (entry.isFile()) {
      if (_skipFile(entry.name)) continue;
      if (opts.skipControlFiles && _skipControlFile(entry.name)) continue;
      try { const st = await fsp.stat(path.join(dir, entry.name)); bytes += st.size; } catch {}
    }
  }
  return bytes;
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

async function _cleanExternalSharingMeta(transferRoot) {
  const metaDir = path.join(transferRoot, TRANSFER_META_DIR);
  try { await fsp.rm(metaDir, { recursive: true, force: true }); } catch (e) {
    console.error('[transferExport] external-sharing meta cleanup failed:', e.message);
  }
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

      events.push({ name: evEntry.name, path: evPath, folders, hasEventRootFiles: hasRootFiles });
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
  const { collectionPaths = [], folderPaths = null, eventRootPaths = null, purpose = 'archive-transfer', backupUpdate = false, updateTotalFiles, updateTotalBytes, sourceMode } = scope || {};
  const isCustom = sourceMode === 'custom';
  const copyOpts = { skipControlFiles: !isCustom && purpose === 'external-sharing', backupUpdate: !!backupUpdate, sourceMode: sourceMode || 'archive' };

  // Custom-source exports write no archive metadata (no .autoingest-transfer/ marker).
  if (!isCustom) {
    try {
      await _initTransferMeta(transferRoot, meta.deviceName);
    } catch (e) {
      _state.running = false;
      _state.result  = { ok: false, reason: 'meta-init-failed', error: e.message, completedAt: new Date().toISOString() };
      return;
    }
  }

  // ── Build or restore batch list ───────────────────────────────────────────
  let batches;

  if (resumeBatches) {
    batches           = resumeBatches;
    _state.total      = batches.reduce((s, b) => s + (b.fileCount || 0), 0);
    _state.batchCount = batches.length;
  } else if (isCustom) {
    // Custom-source: single flat batch from nasRoot (= customSrcRoot) → transferRoot (= customDestRoot).
    const batchLabel = path.basename(nasRoot) + ' → ' + path.basename(transferRoot);
    batches = [{
      batchIdx: 0, collectionName: '', eventName: '', folderName: '',
      batchLabel, srcDir: nasRoot, destDir: transferRoot,
      rootFilesOnly: false, fileCount: 0, status: 'pending',
      copied: 0, skipped: 0, renamed: 0, errors: 0,
    }];
    batches[0].fileCount = await _countFiles(nasRoot, copyOpts);
    _state.total      = batches[0].fileCount;
    _state.totalBytes = await _sumBytes(nasRoot, copyOpts);
    _state.batchCount = 1;
  } else if ((folderPaths && folderPaths.length > 0) || (eventRootPaths && eventRootPaths.length > 0)) {
    batches = [];
    for (const ep of (eventRootPaths || [])) {
      const rel   = path.relative(nasRoot, ep);
      const parts = rel.split(path.sep);
      batches.push({
        batchIdx:       batches.length,
        collectionName: parts[0] || '',
        eventName:      parts[1] || '',
        folderName:     '',
        batchLabel:     parts.join(' / ') + ' (root)',
        srcDir:         ep,
        destDir:        path.join(transferRoot, rel),
        rootFilesOnly:  true,
        fileCount:      0,
        status:         'pending',
        copied: 0, skipped: 0, renamed: 0, errors: 0,
      });
    }
    for (const fp of (folderPaths || [])) {
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
        rootFilesOnly:  false,
        fileCount:      0,
        status:         'pending',
        copied: 0, skipped: 0, renamed: 0, errors: 0,
      });
    }

    let totalFiles = 0;
    let totalBytes = 0;
    for (const batch of batches) {
      const batchOpts = { ...copyOpts, rootFilesOnly: !!batch.rootFilesOnly };
      batch.fileCount = await _countFiles(batch.srcDir, batchOpts);
      totalFiles += batch.fileCount;
      totalBytes += await _sumBytes(batch.srcDir, batchOpts);
    }
    _state.total      = totalFiles;
    _state.totalBytes = totalBytes;
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
    let totalBytes = 0;
    for (const batch of batches) {
      batch.fileCount = await _countFiles(batch.srcDir, copyOpts);
      totalFiles += batch.fileCount;
      totalBytes += await _sumBytes(batch.srcDir, copyOpts);
    }
    _state.total      = totalFiles;
    _state.totalBytes = totalBytes;
    _state.batchCount = batches.length;
  }

  // In backup-update mode the scan already measured the exact work queue.
  // Use those counts so progress reflects real queued work, not total source files.
  if (copyOpts.backupUpdate && updateTotalFiles != null) {
    _state.total = updateTotalFiles;
  }
  if (copyOpts.backupUpdate && updateTotalBytes != null) {
    _state.totalBytes = updateTotalBytes;
  }

  // ── Write initial checkpoint (archive mode only) ──────────────────────────
  if (!isCustom) await _writeCheckpoint(transferRoot, {
    exportId:        meta.batchId,
    nasRoot,
    transferRoot,
    collectionPaths,
    folderPaths:     folderPaths     || null,
    eventRootPaths:  eventRootPaths  || null,
    exportPurpose:   purpose,
    backupUpdate,
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
    changedSkipped: _state.changedSkipped || 0,
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
    _state.batchName  = batch.batchLabel || `${batch.collectionName} / ${batch.eventName}`;

    try { await fsp.mkdir(batch.destDir, { recursive: true }); } catch {}

    const beforeCopied  = stats.copied;
    const beforeSkipped = stats.skipped;
    const beforeRenamed = stats.renamed;
    const beforeErrors  = stats.errors.length;

    await _walkAndCopy(batch.srcDir, batch.destDir, stats, { ...copyOpts, rootFilesOnly: !!batch.rootFilesOnly });

    batch.copied  = stats.copied  - beforeCopied;
    batch.skipped = stats.skipped - beforeSkipped;
    batch.renamed = stats.renamed - beforeRenamed;
    batch.errors  = stats.errors.length - beforeErrors;
    batch.status  = 'complete';

    if (!isCustom) await _writeCheckpoint(transferRoot, {
      exportId:        meta.batchId,
      nasRoot,
      transferRoot,
      collectionPaths,
      folderPaths:     folderPaths    || null,
      eventRootPaths:  eventRootPaths || null,
      exportPurpose:   purpose,
      backupUpdate,
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

  if (!isCustom) await _writeCheckpoint(transferRoot, {
    exportId:       meta.batchId,
    nasRoot,
    transferRoot,
    collectionPaths,
    folderPaths:    folderPaths    || null,
    eventRootPaths: eventRootPaths || null,
    exportPurpose:  purpose,
    backupUpdate,
    createdAt:      startedAt,
    completedAt,
    status:         'complete',
    batches,
    totalFiles:     _state.total,
    totalCopied:    stats.copied,
    totalSkipped:   stats.skipped,
    totalRenamed:   stats.renamed,
    totalErrors:    stats.errors.length,
  });

  const auditEntry = {
    batchId:      meta.batchId,
    nasRoot,
    transferRoot,
    scope:        { collectionPaths, folderPaths: folderPaths || null, eventRootPaths: eventRootPaths || null },
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
  if (!isCustom) await _appendAudit(transferRoot, auditEntry);

  _state.running = false;
  _state.paused  = false;
  _state.copied  = stats.copied;
  _state.skipped = stats.skipped;
  _state.renamed = stats.renamed;
  _state.changedSkipped = stats.changedSkipped;
  _state.errors  = [...stats.errors];
  _state.result  = {
    ok:         true,
    batchId:    meta.batchId,
    copied:     stats.copied,
    skipped:    stats.skipped,
    renamed:    stats.renamed,
    changedSkipped: stats.changedSkipped,
    errorCount: stats.errors.length,
    startedAt,
    completedAt,
    status:     finalStatus,
  };

  if (!isCustom && purpose === 'external-sharing') {
    await _cleanExternalSharingMeta(transferRoot);
  }
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

  // Custom-source mode: count files in the source folder directly, skip archive validations.
  if (scope && scope.sourceMode === 'custom') {
    if (nasRoot === transferRoot || _isInsideDir(nasRoot, transferRoot) || _isInsideDir(transferRoot, nasRoot)) {
      return { ok: false, reason: 'roots-overlap' };
    }
    const files = await _countFiles(nasRoot, {});
    return { ok: true, custom: true, files, collections: 0, events: 0, folders: 0, externalFolders: 0 };
  }

  if (nasRoot === transferRoot || _isInsideDir(nasRoot, transferRoot) || _isInsideDir(transferRoot, nasRoot)) {
    return { ok: false, reason: 'roots-overlap' };
  }
  const hasFoldPaths  = Array.isArray(scope?.folderPaths)     && scope.folderPaths.length > 0;
  const hasEvRtPaths  = Array.isArray(scope?.eventRootPaths)  && scope.eventRootPaths.length > 0;
  const hasCollPaths  = Array.isArray(scope?.collectionPaths) && scope.collectionPaths.length > 0;
  if (!scope || (!hasCollPaths && !hasFoldPaths && !hasEvRtPaths)) {
    return { ok: false, reason: 'empty-scope' };
  }

  for (const cp of (scope.collectionPaths || [])) {
    if (!_isInsideDir(nasRoot, cp)) {
      return { ok: false, reason: 'scope-outside-nas-root', path: cp };
    }
  }

  const purpose  = scope.purpose  || 'archive-transfer';
  const fileOpts = { skipControlFiles: purpose === 'external-sharing' };

  // Folder-level preview (photographer-folder + optional event-root selection)
  if (hasFoldPaths || hasEvRtPaths) {
    for (const fp of (scope.folderPaths || [])) {
      if (!_isInsideDir(nasRoot, fp)) return { ok: false, reason: 'scope-outside-nas-root', path: fp };
    }
    for (const ep of (scope.eventRootPaths || [])) {
      if (!_isInsideDir(nasRoot, ep)) return { ok: false, reason: 'scope-outside-nas-root', path: ep };
    }
    const collectionSet = new Set(), eventSet = new Set();
    let folders = 0, files = 0;
    for (const fp of (scope.folderPaths || [])) {
      const rel   = path.relative(nasRoot, fp);
      const parts = rel.split(path.sep);
      if (parts[0]) collectionSet.add(parts[0]);
      if (parts[0] && parts[1]) eventSet.add(parts[0] + '/' + parts[1]);
      folders++;
      files += await _countFiles(fp, fileOpts);
    }
    for (const ep of (scope.eventRootPaths || [])) {
      const rel   = path.relative(nasRoot, ep);
      const parts = rel.split(path.sep);
      if (parts[0]) collectionSet.add(parts[0]);
      if (parts[0] && parts[1]) eventSet.add(parts[0] + '/' + parts[1]);
      files += await _countFiles(ep, { ...fileOpts, rootFilesOnly: true });
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
      files += await _countFiles(evPath, fileOpts);
    }
  }

  return { ok: true, nasRoot, transferRoot, scope, collections, events, externalFolders, files };
}

async function runExport(nasRoot, transferRoot, scope, meta = {}) {
  if (_state.running) return { ok: false, reason: 'busy' };

  if (!nasRoot || !transferRoot) return { ok: false, reason: 'missing-roots' };

  if (nasRoot === transferRoot || _isInsideDir(nasRoot, transferRoot) || _isInsideDir(transferRoot, nasRoot)) {
    return { ok: false, reason: 'roots-overlap' };
  }

  // Custom-source mode: roots are the custom src/dest — no archive scope validation needed.
  if (!(scope && scope.sourceMode === 'custom')) {
    const hasFoldPaths  = Array.isArray(scope?.folderPaths)     && scope.folderPaths.length > 0;
    const hasEvRtPaths  = Array.isArray(scope?.eventRootPaths)  && scope.eventRootPaths.length > 0;
    const hasCollPaths  = Array.isArray(scope?.collectionPaths) && scope.collectionPaths.length > 0;
    if (!scope || (!hasCollPaths && !hasFoldPaths && !hasEvRtPaths)) {
      return { ok: false, reason: 'empty-scope' };
    }
    for (const cp of (scope.collectionPaths || [])) {
      if (!_isInsideDir(nasRoot, cp)) return { ok: false, reason: 'scope-outside-nas-root', path: cp };
    }
  }

  const batchId    = crypto.randomBytes(8).toString('hex');
  const deviceName = meta.deviceName || os.hostname();

  _isPaused       = false;
  _pauseResolvers = [];

  _state = {
    running: true, paused: false, batchId,
    batchIndex: 0, batchCount: 0, batchName: '',
    current: '', currentDir: '', copied: 0, skipped: 0, renamed: 0, changedSkipped: 0, errors: [],
    copiedBytes: 0, totalBytes: 0, backupUpdate: !!(scope?.backupUpdate),
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
    currentDir:    '',
    copied:        checkpoint.totalCopied  || 0,
    skipped:       checkpoint.totalSkipped || 0,
    renamed:       checkpoint.totalRenamed || 0,
    changedSkipped: 0,
    errors:        [],
    copiedBytes:   0,
    totalBytes:    0,
    backupUpdate:  !!(checkpoint.backupUpdate),
    total:         checkpoint.totalFiles   || 0,
    result:        null,
    verifyStatus:  null, verifyTotal: 0, verifyDone: 0,
    verifyFailed:  0, verifyMissing: 0, verifyCurrent: '', verifyResult: null,
  };

  _doExport(
    nasRoot, transferRoot,
    {
      collectionPaths: checkpoint.collectionPaths || [],
      folderPaths:     checkpoint.folderPaths     || null,
      eventRootPaths:  checkpoint.eventRootPaths  || null,
      purpose:         checkpoint.exportPurpose   || 'archive-transfer',
      backupUpdate:    checkpoint.backupUpdate    || false,
    },
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

  const verifyPurpose  = scope.purpose || 'archive-transfer';
  const verifyOpts     = { skipControlFiles: verifyPurpose === 'external-sharing' };

  _state.verifyStatus  = 'verifying';
  _state.verifyTotal   = 0;
  _state.verifyDone    = 0;
  _state.verifyFailed  = 0;
  _state.verifyMissing = 0;
  _state.verifyCurrent = '';
  _state.verifyResult  = null;

  const results = { verified: 0, failed: 0, missing: 0, errors: [] };

  async function verifyDir(srcDir, destDir, dirOpts = {}) {
    let entries;
    try { entries = await fsp.readdir(srcDir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (_skipDir(entry.name)) continue;
        if (dirOpts.rootFilesOnly) continue;
        await verifyDir(path.join(srcDir, entry.name), path.join(destDir, entry.name));
      } else if (entry.isFile()) {
        if (_skipFile(entry.name)) continue;
        if (verifyOpts.skipControlFiles && _skipControlFile(entry.name)) continue;
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

  // Folder-level verify (photographer-folder and/or event-root selection)
  if ((scope.folderPaths?.length > 0) || (scope.eventRootPaths?.length > 0)) {
    for (const ep of (scope.eventRootPaths || [])) {
      const rel = path.relative(nasRoot, ep);
      await verifyDir(ep, path.join(transferRoot, rel), { rootFilesOnly: true });
    }
    for (const fp of (scope.folderPaths || [])) {
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

// ── Backup Sync Scan (read-only pre-copy diff) ──────────────────────────────────
// Compares the selected source scope against the connected external backup root by
// relative path, classifying each file WITHOUT copying anything. Filesystem comparison
// is the source of truth (no local userData dependency) — so a backup started on one
// device can be scanned/continued from another. Classification mirrors _copyFileSafe:
//   dest missing            → 'new'
//   dest present, same size → 'existing-same'
//   dest present, diff size → 'changed'   (Update Backup will safe-rename, never overwrite)
//   dest *.autoingest-tx-tmp → 'incomplete' (a copy that did not finish)
//   dest file with no source → 'destination-only' (display only — never deleted)
//   stat/readdir failure     → 'error'
// Size is the primary check; mtime is advisory only.
const SCAN_ITEM_CAP = 500; // per-group item cap for the IPC payload (counts/bytes stay exact)

// Extract a photographer sequence prefix from a folder name.
// Recognises PC001-, PC001_, PC01-, PC01_, A01-, A001_, etc. (separator required).
// Returns { letters, digits, full } or null.
function _extractSequencePrefix(name) {
  const m = /^([A-Z]{1,3})(\d{2,3})(?=[-_])/.exec(name);
  return m ? { letters: m[1], digits: m[2], full: m[0] } : null;
}

// Remove a leading sequence prefix (including its separator) from a folder name.
function _stripSequencePrefix(name) {
  return name.replace(/^[A-Z]{1,3}\d{2,3}[-_]/, '');
}

// Normalise a folder name for loose comparison: lowercase, collapse all
// hyphens/underscores/spaces to a single space, trim.
function _normalizeFolderName(name) {
  return name.toLowerCase().replace(/[-_\s]+/g, ' ').trim();
}

// Score a candidate dest-subfolder / src-subfolder rename pair.
// Returns -1 if disqualified, otherwise a score (0–130).
// Threshold for suggestion: ≥54.
// Scoring:
//   Both have same sequence prefix                    → +60
//   Both have prefix but they differ                  → disqualify (-1)
//   Only src has prefix; stripped src name ≈ dest name → +40 (prefix-added match)
//   File overlap (sample ≤30 dest files found in src) → round(ratio × 60), 0–60
//   Structure match (same immediate subdir count)     → +10
async function _scoreSubfolderMatch(destSubDir, srcSubDir) {
  const destName = path.basename(destSubDir);
  const srcName  = path.basename(srcSubDir);
  const destPfx  = _extractSequencePrefix(destName);
  const srcPfx   = _extractSequencePrefix(srcName);
  let score = 0;

  if (destPfx && srcPfx) {
    if (destPfx.letters === srcPfx.letters && destPfx.digits === srcPfx.digits) {
      score += 60;
    } else {
      return -1; // both have prefix but they differ — hard disqualify
    }
  } else if (!destPfx && srcPfx) {
    // "Prefix added" path: src gained a sequence prefix, dest still has the original name.
    // Add a bonus only when the normalized base names match after stripping the prefix.
    const srcBase  = _normalizeFolderName(_stripSequencePrefix(srcName));
    const destBase = _normalizeFolderName(destName);
    if (srcBase === destBase) score += 40;
    // If names differ, no bonus — file overlap alone must clear the threshold.
  }

  // File overlap: sample up to 30 dest files and check for them in src.
  let destFiles = [];
  try {
    const entries = await fsp.readdir(destSubDir, { withFileTypes: true });
    destFiles = entries.filter(e => e.isFile() && !e.name.startsWith('._') && e.name !== '.DS_Store').map(e => e.name);
  } catch {}
  if (destFiles.length > 0) {
    const sample = destFiles.length <= 30 ? destFiles : destFiles.slice(0, 30);
    let hits = 0;
    for (const fname of sample) {
      try { await fsp.access(path.join(srcSubDir, fname)); hits++; } catch {}
    }
    score += Math.round((hits / sample.length) * 60);
  }

  // Structure match: same count of non-skipped immediate subdirectories.
  let destSubs = 0;
  let srcSubs  = 0;
  try {
    const e = await fsp.readdir(destSubDir, { withFileTypes: true });
    destSubs = e.filter(x => x.isDirectory() && !_skipDir(x.name)).length;
  } catch {}
  try {
    const e = await fsp.readdir(srcSubDir, { withFileTypes: true });
    srcSubs = e.filter(x => x.isDirectory() && !_skipDir(x.name)).length;
  } catch {}
  if (destSubs === srcSubs) score += 10;

  return score;
}

// Resolve a scope object into walk units, mirroring _doExport's batch resolution exactly
// so the scan matches what runExport (Update Backup) will actually copy.
async function _resolveScanUnits(nasRoot, transferRoot, scope) {
  const { collectionPaths = [], folderPaths = null, eventRootPaths = null } = scope || {};
  const units = [];
  if ((folderPaths && folderPaths.length > 0) || (eventRootPaths && eventRootPaths.length > 0)) {
    for (const ep of (eventRootPaths || [])) {
      const rel = path.relative(nasRoot, ep);
      units.push({ srcDir: ep, destDir: path.join(transferRoot, rel), rootFilesOnly: true });
    }
    for (const fp of (folderPaths || [])) {
      const rel = path.relative(nasRoot, fp);
      units.push({ srcDir: fp, destDir: path.join(transferRoot, rel), rootFilesOnly: false });
    }
  } else {
    for (const collPath of collectionPaths) {
      const collName = path.basename(collPath);
      let collEntries;
      try { collEntries = await fsp.readdir(collPath, { withFileTypes: true }); } catch { continue; }
      for (const entry of collEntries) {
        if (!entry.isDirectory() || _skipDir(entry.name)) continue;
        units.push({
          srcDir:  path.join(collPath, entry.name),
          destDir: path.join(transferRoot, collName, entry.name),
          rootFilesOnly: false,
        });
      }
    }
  }
  return units;
}

async function scanBackupSync(nasRoot, transferRoot, scope) {
  if (!nasRoot || !transferRoot) return { ok: false, reason: 'missing-roots' };
  if (nasRoot === transferRoot || _isInsideDir(nasRoot, transferRoot) || _isInsideDir(transferRoot, nasRoot)) {
    return { ok: false, reason: 'roots-overlap' };
  }
  try {
    const st = await fsp.stat(transferRoot);
    if (!st.isDirectory()) return { ok: false, reason: 'transfer-root-not-directory' };
  } catch {
    return { ok: false, reason: 'transfer-root-unavailable' };
  }
  const isCustom = !!(scope && scope.sourceMode === 'custom');

  const groups = {
    newFiles:        { count: 0, bytes: 0, items: [], truncated: false },
    controlUpdates:  { count: 0, bytes: 0, items: [], truncated: false },
    changed:         { count: 0, bytes: 0, items: [], truncated: false },
    existingSame:    { count: 0, bytes: 0, items: [], truncated: false },
    incomplete:      { count: 0, bytes: 0, items: [], truncated: false },
    destinationOnly: { count: 0, bytes: 0, items: [], truncated: false },
    errors:          { count: 0, bytes: 0, items: [], truncated: false },
  };
  const add = (g, relPath, size, extra = {}) => {
    g.count++; g.bytes += (size || 0);
    if (g.items.length < SCAN_ITEM_CAP) g.items.push({ relPath, size: size || 0, ...extra });
    else g.truncated = true;
  };

  // Per-folder file counts (no item cap — used for tree status badges in renderer).
  const folderStats = {};  // relFolderPath → {new, same, changed}

  // Match _doExport: external-sharing exports exclude control files (event.json, etc.),
  // so the scan must exclude them too or it would over-count what the export will copy.
  const skipControlFiles = !!(scope && scope.purpose === 'external-sharing');

  // Source side: classify every source file as new / existing-same / changed / error.
  async function scanSource(srcDir, destDir, rootFilesOnly) {
    let entries;
    try { entries = await fsp.readdir(srcDir, { withFileTypes: true }); }
    catch (e) { add(groups.errors, path.relative(nasRoot, srcDir), 0, { error: `readdir source: ${e.message}` }); return; }
    const relDir = path.relative(nasRoot, srcDir).replace(/\\/g, '/') || '.';
    if (!folderStats[relDir]) folderStats[relDir] = { new: 0, same: 0, changed: 0, controlUpdate: 0 };
    const fst = folderStats[relDir];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (_skipDir(entry.name) || rootFilesOnly) continue;
        await scanSource(path.join(srcDir, entry.name), path.join(destDir, entry.name), false);
      } else if (entry.isFile()) {
        if (_skipFile(entry.name)) continue;
        if (skipControlFiles && _skipControlFile(entry.name)) continue;
        const srcPath  = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        const rel      = path.relative(nasRoot, srcPath);
        const ext      = path.extname(entry.name).toLowerCase();
        let srcStat;
        try { srcStat = await fsp.stat(srcPath); }
        catch (e) { add(groups.errors, rel, 0, { error: `stat source: ${e.message}` }); continue; }
        let destStat = null;
        try { destStat = await fsp.stat(destPath); } catch {}
        const meta = { ext, mtimeMs: Math.round(srcStat.mtimeMs) };
        if (!destStat) {
          add(groups.newFiles, rel, srcStat.size, meta); fst.new++;
        } else if (destStat.size === srcStat.size) {
          add(groups.existingSame, rel, srcStat.size, meta); fst.same++;
        } else if (_CONTROL_FILE_NAMES.has(entry.name)) {
          add(groups.controlUpdates, rel, srcStat.size, { ...meta, destSize: destStat.size }); fst.controlUpdate++;
        } else {
          add(groups.changed, rel, srcStat.size, { ...meta, destSize: destStat.size }); fst.changed++;
        }
      }
    }
  }

  // Destination side: find destination-only files and incomplete (.autoingest-tx-tmp) partials.
  async function scanDest(srcDir, destDir, rootFilesOnly) {
    let entries;
    try { entries = await fsp.readdir(destDir, { withFileTypes: true }); } catch { return; } // dest may not exist yet
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (_skipDir(entry.name) || rootFilesOnly) continue;
        await scanDest(path.join(srcDir, entry.name), path.join(destDir, entry.name), false);
      } else if (entry.isFile()) {
        if (entry.name.startsWith('._') || entry.name === '.DS_Store') continue;
        if (skipControlFiles && _skipControlFile(entry.name)) continue;
        const destPath = path.join(destDir, entry.name);
        const rel      = path.relative(transferRoot, destPath);
        let destStat = null;
        try { destStat = await fsp.stat(destPath); } catch {}
        const size = destStat ? destStat.size : 0;
        if (entry.name.endsWith(TX_TMP_SUFFIX)) { add(groups.incomplete, rel, size, { ext: path.extname(entry.name).toLowerCase() }); continue; }
        if (entry.name.endsWith('.autoingest-sync-tmp')) continue;
        // Destination-only: a clean dest file whose source counterpart does not exist.
        const srcPath = path.join(srcDir, entry.name);
        let hasSrc = false;
        try { await fsp.access(srcPath); hasSrc = true; } catch {}
        if (!hasSrc) add(groups.destinationOnly, rel, size, { ext: path.extname(entry.name).toLowerCase() });
      }
    }
  }

  let units;
  if (isCustom) {
    // Custom-source: single flat unit — the entire source folder mirrors to dest.
    units = [{ srcDir: nasRoot, destDir: transferRoot, rootFilesOnly: false }];
  } else {
    try { units = await _resolveScanUnits(nasRoot, transferRoot, scope); }
    catch (e) { return { ok: false, reason: 'scope-resolution-failed', error: e.message }; }
    if (!units.length) return { ok: false, reason: 'empty-scope' };
  }

  for (const u of units) {
    await scanSource(u.srcDir, u.destDir, u.rootFilesOnly);
    await scanDest(u.srcDir, u.destDir, u.rootFilesOnly);
  }

  // Rename detection: archive backup-update mode only (not applicable to custom-source).
  const renameMatches = [];
  if (!isCustom && scope && scope.backupUpdate) {
    const unitDestDirs = new Set(units.map(u => u.destDir));

    // Collect dest collection-level directories to search for orphan event folders.
    const destCollectionDirs = new Set();
    for (const u of units) {
      const rel = path.relative(transferRoot, u.destDir).split(path.sep);
      if (rel.length >= 2) destCollectionDirs.add(path.join(transferRoot, rel[0]));
    }

    // Find event-level dest folders not covered by any source unit.
    const orphanDestDirs = [];
    for (const collDir of destCollectionDirs) {
      let entries;
      try { entries = await fsp.readdir(collDir, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory() || _skipDir(entry.name)) continue;
        const evDir = path.join(collDir, entry.name);
        if (!unitDestDirs.has(evDir)) orphanDestDirs.push(evDir);
      }
    }

    // Identify source units at event-level (rel depth 2) whose dest does not yet exist.
    const unmatchedSrcUnits = [];
    for (const u of units) {
      const rel = path.relative(transferRoot, u.destDir).split(path.sep);
      if (rel.length !== 2) continue;
      let destExists = false;
      try { await fsp.access(u.destDir); destExists = true; } catch {}
      if (!destExists) unmatchedSrcUnits.push(u);
    }

    const readEventId = async (dir) => {
      try {
        const raw = await fsp.readFile(path.join(dir, 'event.json'), 'utf8');
        const d = JSON.parse(raw);
        const hd = d.hijriDate || null;
        const sq = d.sequence != null ? String(d.sequence) : null;
        if (!hd || sq === null) return null;
        return { hijriDate: hd, sequence: sq, key: `${hd}__${sq}` };
      } catch { return null; }
    };

    const orphanByKey = new Map();
    for (const orphanDir of orphanDestDirs) {
      const id = await readEventId(orphanDir);
      if (id) orphanByKey.set(id.key, orphanDir);
    }

    for (const u of unmatchedSrcUnits) {
      const id = await readEventId(u.srcDir);
      if (!id) continue;
      const orphanDir = orphanByKey.get(id.key);
      if (!orphanDir) continue;
      renameMatches.push({
        type:        'event',
        srcRelPath:  path.relative(nasRoot, u.srcDir).replace(/\\/g, '/'),
        destRelPath: path.relative(transferRoot, orphanDir).replace(/\\/g, '/'),
        srcAbsPath:  u.srcDir,
        destAbsPath: orphanDir,
        hijriDate:   id.hijriDate,
        sequence:    id.sequence,
        confidence:  'high',
        matchReason: `Matching event identity (${id.hijriDate}, #${id.sequence})`,
      });
    }

    // Nested subfolder rename detection: for each event-level unit whose dest EXISTS,
    // find orphan dest subfolders that have no same-named src counterpart and score them
    // against unmatched src subfolders. Only one candidate above threshold is suggested.
    for (const u of units) {
      const rel = path.relative(transferRoot, u.destDir).split(path.sep);
      if (rel.length !== 2) continue; // event-level units only (collection/event depth)

      let destExists = false;
      try { await fsp.access(u.destDir); destExists = true; } catch {}
      if (!destExists) continue; // dest doesn't exist — event itself may be a rename, handled above

      let destEntries;
      try { destEntries = await fsp.readdir(u.destDir, { withFileTypes: true }); } catch { continue; }
      let srcEntries;
      try { srcEntries = await fsp.readdir(u.srcDir, { withFileTypes: true }); } catch { continue; }

      const srcSubNames  = new Set(srcEntries.filter(e => e.isDirectory() && !_skipDir(e.name)).map(e => e.name));
      const destSubNames = new Set(destEntries.filter(e => e.isDirectory() && !_skipDir(e.name)).map(e => e.name));

      const orphanDestSubDirs   = destEntries.filter(e => e.isDirectory() && !_skipDir(e.name) && !srcSubNames.has(e.name)).map(e => path.join(u.destDir, e.name));
      const unmatchedSrcSubDirs = srcEntries.filter(e => e.isDirectory() && !_skipDir(e.name) && !destSubNames.has(e.name)).map(e => path.join(u.srcDir, e.name));

      if (!orphanDestSubDirs.length || !unmatchedSrcSubDirs.length) continue;

      for (const orphanDest of orphanDestSubDirs) {
        let bestScore = -1;
        let bestSrc   = null;
        let aboveThreshold = 0;

        for (const candidateSrc of unmatchedSrcSubDirs) {
          const score = await _scoreSubfolderMatch(orphanDest, candidateSrc);
          if (score >= 54) {
            aboveThreshold++;
            if (score > bestScore) { bestScore = score; bestSrc = candidateSrc; }
          }
        }

        // Only suggest when exactly one candidate clears the threshold — ambiguous matches are skipped.
        if (aboveThreshold === 1 && bestSrc !== null) {
          const destName = path.basename(orphanDest);
          const srcName  = path.basename(bestSrc);
          const destPfx  = _extractSequencePrefix(destName);
          const srcPfx   = _extractSequencePrefix(srcName);
          let matchReason;
          if (destPfx && srcPfx && destPfx.letters === srcPfx.letters && destPfx.digits === srcPfx.digits) {
            matchReason = `Matching sequence prefix (${destPfx.full}) within event`;
          } else if (!destPfx && srcPfx && _normalizeFolderName(_stripSequencePrefix(srcName)) === _normalizeFolderName(destName)) {
            matchReason = `Sequence prefix added; folder contents match`;
          } else {
            matchReason = `High file overlap within event`;
          }
          renameMatches.push({
            type:        'subfolder',
            srcRelPath:  path.relative(nasRoot, bestSrc).replace(/\\/g, '/'),
            destRelPath: path.relative(transferRoot, orphanDest).replace(/\\/g, '/'),
            srcAbsPath:  bestSrc,
            destAbsPath: orphanDest,
            confidence:  'high',
            matchReason,
          });
        }
      }
    }
  }

  const totals = {
    files:   groups.newFiles.count + groups.changed.count + groups.existingSame.count,
    toCopy:  groups.newFiles.count,
    bytesToCopy: groups.newFiles.bytes,
    controlUpdates: groups.controlUpdates.count,
    controlUpdateBytes: groups.controlUpdates.bytes,
    upToDate: groups.existingSame.count,
    changed:  groups.changed.count,
    incomplete: groups.incomplete.count,
    destinationOnly: groups.destinationOnly.count,
    errors: groups.errors.count,
  };

  return { ok: true, nasRoot, transferRoot, scope, groups, totals, folderStats, renameMatches, scannedAt: new Date().toISOString() };
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
  scanBackupSync,
};
