'use strict';

/**
 * archiveSyncService.js — Copy-to-archive logic for Local First jobs.
 *
 * Strategy: temp-copy → verify-size → (checksum if same-size) → finalize.
 * No-overwrite is enforced at the rename step, not just the pre-copy check.
 * Sidecar conflicts (.xmp size/content mismatch) block with needs-attention;
 * regular file conflicts are copied under a safe renamed path.
 *
 * Depth: photographer-dir files + one level of subdirs (VIDEO etc.).
 */

const fsp    = require('fs').promises;
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const {
  acquireLock,
  releaseLock,
  renewLock,
  LOCK_HEARTBEAT_INTERVAL_MS,
} = require('./archiveLockService');

const { hidePathBestEffort } = require('./internalFileProtection');
const config = require('../config/app.config');

const SKIP_DIRS  = new Set(['.autoingest', '__MACOSX']);
const TMP_SUFFIX = '.autoingest-sync-tmp';

// RAW extension set for companion XMP discovery at sync time.
// Sourced from the authoritative config list so it stays in sync with the rest of the app.
const _RAW_EXTS = new Set(config.RAW_EXTENSIONS);

function _isSidecar(filename) {
  return path.extname(filename).toLowerCase() === '.xmp';
}

function _skipDir(name) {
  return SKIP_DIRS.has(name) || name.startsWith('.');
}

/**
 * Stream-based SHA-256. Avoids reading large RAW files into memory.
 */
function _streamChecksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash   = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end',  ()    => resolve(hash.digest('hex')));
    stream.on('error', err  => reject(err));
  });
}

/**
 * Find a free path by appending _1, _2, … before the extension.
 */
async function _safeRenamedPath(destPath) {
  const ext  = path.extname(destPath);
  const base = destPath.slice(0, destPath.length - ext.length);
  for (let n = 1; ; n++) {
    const candidate = `${base}_${n}${ext}`;
    try {
      await fsp.access(candidate);
    } catch (e) {
      if (e.code === 'ENOENT') return candidate;
      throw e;
    }
  }
}

/**
 * Copy srcPath to destPath atomically:
 *   1. Write to tmpPath (destPath + TMP_SUFFIX)
 *   2. Verify byte-size matches source
 *   3. Re-check destPath right before rename (concurrent creation guard)
 *   4. fsp.rename(tmp → finalDest)
 *
 * @returns {{ finalDest: string, wasRenamed: boolean }}
 */
async function _copyFile(srcPath, destPath) {
  const tmpPath = destPath + TMP_SUFFIX;
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  await fsp.copyFile(srcPath, tmpPath);

  const [srcStat, tmpStat] = await Promise.all([
    fsp.stat(srcPath),
    fsp.stat(tmpPath),
  ]);
  if (srcStat.size !== tmpStat.size) {
    await fsp.unlink(tmpPath).catch(() => {});
    throw new Error(`Size mismatch after copy: ${path.basename(srcPath)} (${srcStat.size} vs ${tmpStat.size})`);
  }

  // No-overwrite guard at rename step
  let finalDest  = destPath;
  let wasRenamed = false;
  try {
    await fsp.access(destPath);
    finalDest  = await _safeRenamedPath(destPath);
    wasRenamed = true;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  await fsp.rename(tmpPath, finalDest);
  return { finalDest, wasRenamed };
}

/**
 * Sync all files in localDir into archiveDir.
 * depth=0  → photographer folder (files + recurse into subdirs with depth=1)
 * depth=1  → subdir such as VIDEO (files only, no further recursion)
 *
 * abortSignal — optional { aborted: boolean, reason: string|null }.
 * Checked before each entry; exits early without starting new file ops when set.
 */
async function _syncDir(localDir, archiveDir, result, depth = 0, abortSignal = null) {
  if (abortSignal?.aborted) return;

  let entries;
  try {
    entries = await fsp.readdir(localDir, { withFileTypes: true });
  } catch (err) {
    result.errors.push(`Cannot read dir ${localDir}: ${err.message}`);
    return;
  }

  for (const entry of entries) {
    if (abortSignal?.aborted) return;

    const localPath   = path.join(localDir, entry.name);
    const archivePath = path.join(archiveDir, entry.name);

    if (entry.isDirectory()) {
      if (_skipDir(entry.name)) continue;
      if (depth < 1) await _syncDir(localPath, archivePath, result, depth + 1, abortSignal);
      continue;
    }

    if (!entry.isFile()) continue;

    let destStat = null;
    try {
      destStat = await fsp.stat(archivePath);
    } catch (e) {
      if (e.code !== 'ENOENT') {
        result.errors.push(`Stat failed ${archivePath}: ${e.message}`);
        continue;
      }
    }

    if (destStat === null) {
      // Destination does not exist — copy
      try {
        const { wasRenamed } = await _copyFile(localPath, archivePath);
        if (_isSidecar(entry.name)) result.sidecarsCopied++;
        else result.copiedToArchive++;
        if (wasRenamed) result.renamedConflicts++;
      } catch (err) {
        result.errors.push(`Copy failed ${entry.name}: ${err.message}`);
      }
      continue;
    }

    // Destination exists — compare sizes
    let srcStat;
    try {
      srcStat = await fsp.stat(localPath);
    } catch (err) {
      result.errors.push(`Stat failed ${localPath}: ${err.message}`);
      continue;
    }

    if (srcStat.size !== destStat.size) {
      if (_isSidecar(entry.name)) {
        result.sidecarConflicts++;
      } else {
        try {
          const safeDest = await _safeRenamedPath(archivePath);
          await _copyFile(localPath, safeDest);
          result.renamedConflicts++;
          result.copiedToArchive++;
        } catch (err) {
          result.errors.push(`Conflict-rename failed ${entry.name}: ${err.message}`);
        }
      }
      continue;
    }

    // Same size — full checksum to confirm identity
    try {
      const [srcHash, destHash] = await Promise.all([
        _streamChecksum(localPath),
        _streamChecksum(archivePath),
      ]);
      if (srcHash === destHash) {
        result.skippedDuplicates++;
      } else if (_isSidecar(entry.name)) {
        result.sidecarConflicts++;
      } else {
        const safeDest = await _safeRenamedPath(archivePath);
        await _copyFile(localPath, safeDest);
        result.renamedConflicts++;
        result.copiedToArchive++;
      }
    } catch (err) {
      result.errors.push(`Checksum/copy failed ${entry.name}: ${err.message}`);
    }
  }
}

/**
 * Apply the full no-overwrite / size / checksum / sidecar-conflict rules to one file.
 * Returns without throwing; errors are recorded in result.errors.
 * Lock acquisition is the caller's responsibility.
 */
async function _syncOneFile(localPath, archivePath, filename, result, abortSignal = null) {
  if (abortSignal?.aborted) return;

  let destStat = null;
  try {
    destStat = await fsp.stat(archivePath);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      result.errors.push(`Stat failed ${archivePath}: ${e.message}`);
      return;
    }
  }

  if (destStat === null) {
    try {
      const { wasRenamed } = await _copyFile(localPath, archivePath);
      if (_isSidecar(filename)) result.sidecarsCopied++;
      else result.copiedToArchive++;
      if (wasRenamed) result.renamedConflicts++;
    } catch (err) {
      result.errors.push(`Copy failed ${filename}: ${err.message}`);
    }
    return;
  }

  let srcStat;
  try {
    srcStat = await fsp.stat(localPath);
  } catch (err) {
    result.errors.push(`Stat failed ${localPath}: ${err.message}`);
    return;
  }

  if (srcStat.size !== destStat.size) {
    if (_isSidecar(filename)) {
      result.sidecarConflicts++;
    } else {
      try {
        const safeDest = await _safeRenamedPath(archivePath);
        await _copyFile(localPath, safeDest);
        result.renamedConflicts++;
        result.copiedToArchive++;
      } catch (err) {
        result.errors.push(`Conflict-rename failed ${filename}: ${err.message}`);
      }
    }
    return;
  }

  try {
    const [srcHash, destHash] = await Promise.all([
      _streamChecksum(localPath),
      _streamChecksum(archivePath),
    ]);
    if (srcHash === destHash) {
      result.skippedDuplicates++;
    } else if (_isSidecar(filename)) {
      result.sidecarConflicts++;
    } else {
      const safeDest = await _safeRenamedPath(archivePath);
      await _copyFile(localPath, safeDest);
      result.renamedConflicts++;
      result.copiedToArchive++;
    }
  } catch (err) {
    result.errors.push(`Checksum/copy failed ${filename}: ${err.message}`);
  }
}

/**
 * Sync a specific list of files (relative paths from localEventPath) to archiveEventPath.
 * Same no-overwrite / checksum / sidecar rules as _syncDir.
 *
 * For each RAW file in relPaths, also syncs its companion .xmp sidecar if one exists in
 * local staging. XMPs are written by metadata processing after import commit, so they are
 * never included in files[] — expansion happens here at sync time instead.
 *
 * Lock acquisition is the caller's responsibility.
 *
 * @param {string[]} relPaths  Paths relative to localEventPath, using '/' separator.
 * @param {string}   localEventPath
 * @param {string}   archiveEventPath
 * @param {object}   result   Mutable result counters.
 * @param {{ aborted: boolean, reason: string|null }|null} abortSignal
 */
async function _syncFileList(relPaths, localEventPath, archiveEventPath, result, abortSignal = null) {
  for (const relPath of relPaths) {
    if (abortSignal?.aborted) return;
    if (typeof relPath !== 'string' || !relPath) continue;

    const segments    = relPath.split('/').filter(Boolean);
    const localPath   = path.join(localEventPath,   ...segments);
    const archivePath = path.join(archiveEventPath, ...segments);
    const filename    = segments[segments.length - 1] || '';

    await _syncOneFile(localPath, archivePath, filename, result, abortSignal);

    // Companion XMP expansion: for RAW files, attempt to sync a same-folder .xmp sidecar.
    // Generated after import by metadata processing — not in files[] — discovered at sync time.
    const ext = path.extname(filename).toLowerCase();
    if (_RAW_EXTS.has(ext)) {
      const base        = filename.slice(0, filename.length - ext.length);
      const xmpFilename = base + '.xmp';
      const xmpLocal    = path.join(path.dirname(localPath),   xmpFilename);
      const xmpArchive  = path.join(path.dirname(archivePath), xmpFilename);
      try {
        await fsp.access(xmpLocal);
        await _syncOneFile(xmpLocal, xmpArchive, xmpFilename, result, abortSignal);
      } catch {
        // XMP absent or inaccessible — non-fatal, skip silently
      }
    }
  }
}

/**
 * Sync event.json from the staging event folder to the archive event folder.
 * Called at every successful sync exit point.
 *
 * Case A — archive event.json absent: copy staging version wholesale.
 * Case B — archive event.json present: merge new imports[] entries only.
 *   Only imports, lastImport, status, updatedAt are updated; all other archive
 *   fields (components, hijriDate, metadata) remain authoritative in the archive.
 *
 * Non-fatal: logs a warning and continues on any error.
 */
async function _copyEventJsonIfNeeded(localEventPath, archiveEventPath) {
  const localJsonPath   = path.join(localEventPath,  'event.json');
  const archiveJsonPath = path.join(archiveEventPath, 'event.json');

  let localDoc;
  try {
    localDoc = JSON.parse(await fsp.readFile(localJsonPath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.warn('[syncJob] event.json not found in staging event folder:', localEventPath);
    } else {
      console.warn('[syncJob] event.json parse failed in staging folder:', err.message);
    }
    return;
  }

  let archiveDoc;
  try {
    archiveDoc = JSON.parse(await fsp.readFile(archiveJsonPath, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('[syncJob] Cannot read archive event.json:', err.message);
      return;
    }
    // Case A: archive has no event.json — copy staging version
    try {
      await fsp.mkdir(path.dirname(archiveJsonPath), { recursive: true });
      await _copyFile(localJsonPath, archiveJsonPath);
      hidePathBestEffort(archiveJsonPath).catch(() => {});
    } catch (copyErr) {
      console.warn('[syncJob] event.json copy to archive failed:', copyErr.message);
    }
    return;
  }

  // Case B: archive already has event.json — merge imports by id-deduplication
  const localImports   = Array.isArray(localDoc.imports)   ? localDoc.imports   : [];
  const archiveImports = Array.isArray(archiveDoc.imports) ? archiveDoc.imports : [];

  if (localImports.length === 0) return; // nothing to merge

  const mergedMap = new Map();
  [...archiveImports, ...localImports].forEach(entry => {
    if (entry && typeof entry.id === 'string') mergedMap.set(entry.id, entry);
  });
  const merged = Array.from(mergedMap.values());

  if (merged.length === archiveImports.length) return; // no new entries added

  const updated = {
    ...archiveDoc,
    imports:    merged,
    lastImport: localDoc.lastImport ?? archiveDoc.lastImport,
    status:     localDoc.status     ?? archiveDoc.status,
    updatedAt:  localDoc.updatedAt  ?? archiveDoc.updatedAt,
  };

  const tmpPath = archiveJsonPath + '.tmp';
  try {
    await fsp.writeFile(tmpPath, JSON.stringify(updated, null, 2), 'utf8');
    await fsp.rename(tmpPath, archiveJsonPath);
    hidePathBestEffort(archiveJsonPath).catch(() => {});
  } catch (err) {
    try { await fsp.unlink(tmpPath); } catch {}
    console.warn('[syncJob] event.json import merge to archive failed:', err.message);
  }
}

/**
 * Sync one Local First job to the Active Archive.
 *
 * @param {{ jobId: string, batchId: string|null, collection: string, localEventPath: string }} job
 * @param {{ nasRoot: string, stagingRoot?: string }} options
 * @returns {Promise<{
 *   ok: boolean,
 *   status: 'synced'|'sync-failed'|'needs-attention'|'waiting-for-lock',
 *   copiedToArchive: number,
 *   skippedDuplicates: number,
 *   renamedConflicts: number,
 *   sidecarsCopied: number,
 *   sidecarConflicts: number,
 *   errors: string[],
 *   syncedAt: number|null,
 *   syncStartedAt: number,
 *   archiveEventPath: string|null,
 *   waitingForLock: boolean,
 * }>}
 */
async function syncJob(job, { nasRoot, stagingRoot }) {
  const syncStartedAt = Date.now();
  const result = {
    ok:                false,
    status:            'sync-failed',
    copiedToArchive:   0,
    skippedDuplicates: 0,
    renamedConflicts:  0,
    sidecarsCopied:    0,
    sidecarConflicts:  0,
    errors:            [],
    syncedAt:          null,
    syncStartedAt,
    archiveEventPath:  null,
    waitingForLock:    false,
  };

  const { localEventPath } = job;

  if (stagingRoot) {
    const rel      = path.relative(stagingRoot, localEventPath);
    const segments = rel.split(path.sep).filter(Boolean);
    if (segments.length !== 2) {
      result.errors.push(`Unexpected event path depth (${segments.length} segments): ${rel}`);
      return result;
    }
  }

  const collectionFolderName = path.basename(path.dirname(localEventPath));
  const eventFolderName      = path.basename(localEventPath);
  const archiveEventPath     = path.join(nasRoot, collectionFolderName, eventFolderName);
  result.archiveEventPath    = archiveEventPath;

  // Determine sync strategy:
  //   A — job.files[]  : copy exactly those files (grouped by top-level dir for locking)
  //   B — job.photographer (no files): sync that one photographer folder only
  //   C — legacy       : scan all photographer dirs under localEventPath
  const hasFilesHint   = Array.isArray(job.files) && job.files.length > 0;
  const targetPh       = (typeof job.photographer === 'string' && job.photographer.trim()) || null;

  let photographerEntries;          // [{ name: string }]
  let filesByPhotographer = null;   // Map<string, string[]> — only for Strategy A

  if (hasFilesHint) {
    // Strategy A: group relative paths by their top-level directory
    filesByPhotographer = new Map();
    for (const f of job.files) {
      if (typeof f !== 'string' || !f) continue;
      const ph = f.includes('/') ? f.split('/')[0] : null;
      if (!ph || _skipDir(ph)) continue;
      if (!filesByPhotographer.has(ph)) filesByPhotographer.set(ph, []);
      filesByPhotographer.get(ph).push(f);
    }
    photographerEntries = [...filesByPhotographer.keys()].map(name => ({ name }));
  } else if (targetPh) {
    // Strategy B: single photographer folder
    photographerEntries = [{ name: targetPh }];
  } else {
    // Strategy C: legacy — scan all photographer dirs
    try {
      const entries = await fsp.readdir(localEventPath, { withFileTypes: true });
      photographerEntries = entries.filter(e => e.isDirectory() && !_skipDir(e.name));
    } catch (err) {
      result.errors.push(`Cannot read event dir: ${err.message}`);
      return result;
    }
  }

  if (photographerEntries.length === 0) {
    await _copyEventJsonIfNeeded(localEventPath, archiveEventPath);
    result.ok      = true;
    result.status  = 'synced';
    result.syncedAt = Date.now();
    return result;
  }

  let anyLockBlocked = false;

  for (const phEntry of photographerEntries) {
    const phFolderName  = phEntry.name;
    const localPhPath   = path.join(localEventPath, phFolderName);
    const archivePhPath = path.join(archiveEventPath, phFolderName);

    let lockResult;
    try {
      lockResult = await acquireLock(nasRoot, {
        collection:             job.collection,
        eventFolderName,
        photographerFolderName: phFolderName,
        jobId:                  job.jobId,
        batchId:                job.batchId || null,
      });
    } catch (err) {
      result.errors.push(`Lock acquire error for ${phFolderName}: ${err.message}`);
      continue;
    }

    if (!lockResult.acquired) {
      anyLockBlocked = true;
      result.errors.push(`Lock held on ${phFolderName} by ${lockResult.lockedBy}`);
      continue;
    }

    const abortSignal   = { aborted: false, reason: null };
    const expectedOwner = {
      jobId:      lockResult.lockData.jobId,
      deviceName: lockResult.lockData.deviceName,
    };

    let heartbeatTimer = null;
    heartbeatTimer = setInterval(() => {
      renewLock(lockResult.lockPath, expectedOwner).then(r => {
        if (!r.renewed) {
          abortSignal.aborted = true;
          abortSignal.reason  = r.reason;
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      }).catch(() => {
        abortSignal.aborted = true;
        abortSignal.reason  = 'heartbeat-io-error';
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      });
    }, LOCK_HEARTBEAT_INTERVAL_MS);

    try {
      if (filesByPhotographer) {
        // Strategy A: sync only the exact files listed for this photographer
        await _syncFileList(
          filesByPhotographer.get(phFolderName) || [],
          localEventPath,
          archiveEventPath,
          result,
          abortSignal,
        );
      } else {
        // Strategy B or C: sync entire photographer folder
        await _syncDir(localPhPath, archivePhPath, result, 0, abortSignal);
      }
    } finally {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      await releaseLock(lockResult.lockPath);
    }

    if (abortSignal.aborted) {
      result.errors.push(`Sync aborted for ${phFolderName}: lock lost (${abortSignal.reason})`);
    }
  }

  const hasErrors = result.errors.length > 0;

  if (anyLockBlocked && !hasErrors) {
    result.status         = 'waiting-for-lock';
    result.waitingForLock = true;
    return result;
  }

  if (hasErrors) {
    result.status = 'sync-failed';
    return result;
  }

  await _copyEventJsonIfNeeded(localEventPath, archiveEventPath);

  if (result.sidecarConflicts > 0) {
    result.ok      = true;
    result.status  = 'needs-attention';
    result.syncedAt = Date.now();
    return result;
  }

  result.ok      = true;
  result.status  = 'synced';
  result.syncedAt = Date.now();
  return result;
}

module.exports = { syncJob };
