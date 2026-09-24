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
const eventMetadataIntent = require('./eventMetadataIntent');
const { updateEventJsonAtomic } = require('../main/eventJsonStore');
const crypto = require('crypto');

const {
  acquireLock,
  releaseLock,
  renewLock,
  LOCK_HEARTBEAT_INTERVAL_MS,
} = require('./archiveLockService');

const { hidePathBestEffort }    = require('./internalFileProtection');
const offlineRegistry           = require('./offlineCollectionRegistryService');
const { canonicalName: _phCanonical } = require('./photographerSequenceService');
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
 * Build the n-th suffixed candidate for destPath: A.CR2 with n=1 → A_1.CR2, etc.
 * n=0 returns destPath itself, unchanged — shared by the single-file and pair-aware
 * suffix searches so there is exactly one suffix-naming convention in this module.
 */
function _suffixed(destPath, n) {
  if (n === 0) return destPath;
  const ext  = path.extname(destPath);
  const base = destPath.slice(0, destPath.length - ext.length);
  return `${base}_${n}${ext}`;
}

async function _pathExists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
}

/**
 * Find a free path by appending _1, _2, … before the extension.
 */
async function _safeRenamedPath(destPath) {
  for (let n = 1; ; n++) {
    const candidate = _suffixed(destPath, n);
    if (!(await _pathExists(candidate))) return candidate;
  }
}

/**
 * Remember which local file landed at which archive path (the ACTUAL final destination — after any
 * conflict rename or photographer-folder remap). Durable metadata intent is keyed by event-relative
 * destination path, so the event.json merge needs this mapping. Non-enumerable: never serialized into
 * persisted sync results.
 */
function _recordCopy(result, localPath, finalDest) {
  if (!result._copiedPairs) Object.defineProperty(result, '_copiedPairs', { value: [], enumerable: false });
  result._copiedPairs.push({ from: localPath, to: finalDest });
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

// ── RAW/XMP pair-aware destination resolution ───────────────────────────────────────
//
// PAIR INVARIANT: a RAW's companion XMP destination is resolved as part of the RAW's
// own basename decision, before either file is copied. Never derive it later from the
// original source basename, and never resolve it independently of the RAW — otherwise a
// conflict-renamed RAW can end up detached from, or mis-associated with, its sidecar
// (D1: an incoming XMP silently attaching to an unrelated pre-existing RAW).

/**
 * Resolve the archive destination for a RAW file that may have a companion XMP, choosing
 * a basename that is simultaneously safe for BOTH halves of the pair.
 *
 * True-duplicate short-circuit: if the archive's bare (unsuffixed) basename already holds
 * a byte-identical RAW, the RAW keeps that existing identity — no rename, matching the
 * existing single-file skip semantics exactly. The caller is expected to then run the
 * companion XMP through the ordinary single-file sidecar rules against that same
 * untouched basename (this function does not touch the XMP in that case).
 *
 * Otherwise, walks n = 0, 1, 2, … and returns the smallest n where BOTH the RAW candidate
 * and (if hasXmp) the XMP candidate are simultaneously free. A suffix is never chosen for
 * one half of the pair while leaving the other on a mismatched or already-occupied
 * basename — so the final RAW and XMP always share one basename.
 *
 * Performs only existence/size/checksum checks; the actual copy happens elsewhere.
 *
 * @returns {Promise<{ duplicate: boolean, rawDest: string, xmpDest: string|null }>}
 */
async function _resolvePairDestination(localRawPath, archiveRawPath, hasXmp, archiveXmpBase) {
  if (await _pathExists(archiveRawPath)) {
    const [srcStat, destStat] = await Promise.all([fsp.stat(localRawPath), fsp.stat(archiveRawPath)]);
    if (srcStat.size === destStat.size) {
      const [srcHash, destHash] = await Promise.all([
        _streamChecksum(localRawPath),
        _streamChecksum(archiveRawPath),
      ]);
      if (srcHash === destHash) {
        return { duplicate: true, rawDest: archiveRawPath, xmpDest: hasXmp ? archiveXmpBase : null };
      }
    }
  }

  for (let n = 0; ; n++) {
    const rawCandidate = _suffixed(archiveRawPath, n);
    if (await _pathExists(rawCandidate)) continue;
    if (!hasXmp) return { duplicate: false, rawDest: rawCandidate, xmpDest: null };
    const xmpCandidate = _suffixed(archiveXmpBase, n);
    if (await _pathExists(xmpCandidate)) continue;
    return { duplicate: false, rawDest: rawCandidate, xmpDest: xmpCandidate };
  }
}

/**
 * Sync a RAW file together with its companion XMP (if the source has one) as a single
 * naming pair. Falls through to the ordinary single-file _syncOneFile path when there is
 * no companion XMP at all (an unpaired RAW behaves exactly as before) or when the RAW
 * turns out to be a true duplicate at its existing bare basename (its XMP then follows
 * the existing, unchanged single-file sidecar rules against that same untouched
 * basename — never overwritten, never guessed at a different name).
 */
async function _syncRawWithCompanion(
  localRawPath, archiveRawPath, rawFilename,
  localXmpPath, archiveXmpPath, xmpFilename,
  hasXmp, result, abortSignal = null, onFileProgress = null,
) {
  if (!hasXmp) {
    await _syncOneFile(localRawPath, archiveRawPath, rawFilename, result, abortSignal, onFileProgress);
    return;
  }

  let resolved;
  try {
    resolved = await _resolvePairDestination(localRawPath, archiveRawPath, true, archiveXmpPath);
  } catch (err) {
    result.errors.push(`Pair resolution failed ${rawFilename}: ${err.message}`);
    onFileProgress?.(rawFilename, 'failed');
    return;
  }

  if (resolved.duplicate) {
    await _syncOneFile(localRawPath, archiveRawPath, rawFilename, result, abortSignal, onFileProgress);
    await _syncOneFile(localXmpPath, archiveXmpPath, xmpFilename, result, abortSignal, onFileProgress);
    return;
  }

  const wasRenamed = resolved.rawDest !== archiveRawPath;
  try {
    const { finalDest } = await _copyFile(localRawPath, resolved.rawDest);
    _recordCopy(result, localRawPath, finalDest);
    result.copiedToArchive++;
    if (wasRenamed) result.renamedConflicts++;
    onFileProgress?.(rawFilename, 'copied');
  } catch (err) {
    result.errors.push(`Copy failed ${rawFilename}: ${err.message}`);
    onFileProgress?.(rawFilename, 'failed');
    return; // RAW failed — do not attempt its XMP against a destination we can no longer trust.
  }

  try {
    const { finalDest: xmpFinal } = await _copyFile(localXmpPath, resolved.xmpDest);
    _recordCopy(result, localXmpPath, xmpFinal);
    result.sidecarsCopied++;
    onFileProgress?.(xmpFilename, 'copied');
  } catch (err) {
    result.errors.push(`Copy failed ${xmpFilename}: ${err.message}`);
    onFileProgress?.(xmpFilename, 'failed');
  }
}

/**
 * Sync all files in localDir into archiveDir.
 * depth=0  → photographer folder (files + recurse into subdirs with depth=1)
 * depth=1  → subdir such as VIDEO (files only, no further recursion)
 *
 * abortSignal  — optional { aborted: boolean, reason: string|null }
 *                Checked before each entry; exits early without starting new file ops when set.
 * pauseSignal  — optional { paused: boolean }
 *                Checked before each entry; exits loop cleanly so the job can resume later.
 * onFileProgress — optional (filename: string, action: 'copied'|'skipped'|'failed') => void
 */
async function _syncDir(localDir, archiveDir, result, depth = 0, abortSignal = null, pauseSignal = null, onFileProgress = null) {
  if (abortSignal?.aborted) return;
  if (pauseSignal?.paused)  return;

  let entries;
  try {
    entries = await fsp.readdir(localDir, { withFileTypes: true });
  } catch (err) {
    result.errors.push(`Cannot read dir ${localDir}: ${err.message}`);
    return;
  }

  // RAW files with a same-folder companion .xmp are synced as a pair (see the PAIR
  // INVARIANT comment above _resolvePairDestination) — pre-scan so the main loop below
  // can route paired RAWs through _syncRawWithCompanion and skip their claimed .xmp
  // entry rather than syncing it a second time as an unrelated generic file. Orphan
  // .xmp files (no sibling RAW here) fall through to the existing generic behavior.
  const localFileNames = new Set(entries.filter(e => e.isFile()).map(e => e.name));
  const claimedXmpNames = new Set();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!_RAW_EXTS.has(ext)) continue;
    const base = entry.name.slice(0, entry.name.length - ext.length);
    const xmpName = base + '.xmp';
    if (localFileNames.has(xmpName)) claimedXmpNames.add(xmpName);
  }

  for (const entry of entries) {
    if (abortSignal?.aborted) return;
    if (pauseSignal?.paused)  return;

    const localPath   = path.join(localDir, entry.name);
    const archivePath = path.join(archiveDir, entry.name);

    if (entry.isDirectory()) {
      if (_skipDir(entry.name)) continue;
      if (depth < 1) await _syncDir(localPath, archivePath, result, depth + 1, abortSignal, pauseSignal, onFileProgress);
      continue;
    }

    if (!entry.isFile()) continue;

    if (claimedXmpNames.has(entry.name)) continue; // handled by its RAW's pairing below

    const ext = path.extname(entry.name).toLowerCase();
    if (_RAW_EXTS.has(ext)) {
      const base        = entry.name.slice(0, entry.name.length - ext.length);
      const xmpFilename = base + '.xmp';
      if (claimedXmpNames.has(xmpFilename)) {
        await _syncRawWithCompanion(
          localPath, archivePath, entry.name,
          path.join(localDir, xmpFilename), path.join(archiveDir, xmpFilename), xmpFilename,
          true, result, abortSignal, onFileProgress,
        );
        continue;
      }
    }

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
        const { finalDest, wasRenamed } = await _copyFile(localPath, archivePath);
        _recordCopy(result, localPath, finalDest);
        if (_isSidecar(entry.name)) result.sidecarsCopied++;
        else result.copiedToArchive++;
        if (wasRenamed) result.renamedConflicts++;
        onFileProgress?.(entry.name, 'copied');
      } catch (err) {
        result.errors.push(`Copy failed ${entry.name}: ${err.message}`);
        onFileProgress?.(entry.name, 'failed');
      }
      continue;
    }

    // Destination exists — compare sizes
    let srcStat;
    try {
      srcStat = await fsp.stat(localPath);
    } catch (err) {
      result.errors.push(`Stat failed ${localPath}: ${err.message}`);
      onFileProgress?.(entry.name, 'failed');
      continue;
    }

    if (srcStat.size !== destStat.size) {
      if (_isSidecar(entry.name)) {
        result.sidecarConflicts++;
        onFileProgress?.(entry.name, 'skipped');
      } else {
        try {
          const safeDest = await _safeRenamedPath(archivePath);
          const { finalDest: renamedTo } = await _copyFile(localPath, safeDest);
          _recordCopy(result, localPath, renamedTo);
          result.renamedConflicts++;
          result.copiedToArchive++;
          onFileProgress?.(entry.name, 'copied');
        } catch (err) {
          result.errors.push(`Conflict-rename failed ${entry.name}: ${err.message}`);
          onFileProgress?.(entry.name, 'failed');
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
        onFileProgress?.(entry.name, 'skipped');
      } else if (_isSidecar(entry.name)) {
        result.sidecarConflicts++;
        onFileProgress?.(entry.name, 'skipped');
      } else {
        const safeDest = await _safeRenamedPath(archivePath);
        const { finalDest: renamedTo } = await _copyFile(localPath, safeDest);
        _recordCopy(result, localPath, renamedTo);
        result.renamedConflicts++;
        result.copiedToArchive++;
        onFileProgress?.(entry.name, 'copied');
      }
    } catch (err) {
      result.errors.push(`Checksum/copy failed ${entry.name}: ${err.message}`);
      onFileProgress?.(entry.name, 'failed');
    }
  }
}

/**
 * Apply the full no-overwrite / size / checksum / sidecar-conflict rules to one file.
 * Returns without throwing; errors are recorded in result.errors.
 * Lock acquisition is the caller's responsibility.
 *
 * onFileProgress — optional (filename: string, action: 'copied'|'skipped'|'failed') => void
 */
async function _syncOneFile(localPath, archivePath, filename, result, abortSignal = null, onFileProgress = null) {
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
      const { finalDest, wasRenamed } = await _copyFile(localPath, archivePath);
      _recordCopy(result, localPath, finalDest);
      if (_isSidecar(filename)) result.sidecarsCopied++;
      else result.copiedToArchive++;
      if (wasRenamed) result.renamedConflicts++;
      onFileProgress?.(filename, 'copied');
    } catch (err) {
      result.errors.push(`Copy failed ${filename}: ${err.message}`);
      onFileProgress?.(filename, 'failed');
    }
    return;
  }

  let srcStat;
  try {
    srcStat = await fsp.stat(localPath);
  } catch (err) {
    result.errors.push(`Stat failed ${localPath}: ${err.message}`);
    onFileProgress?.(filename, 'failed');
    return;
  }

  if (srcStat.size !== destStat.size) {
    if (_isSidecar(filename)) {
      result.sidecarConflicts++;
      onFileProgress?.(filename, 'skipped');
    } else {
      try {
        const safeDest = await _safeRenamedPath(archivePath);
        const { finalDest: renamedTo } = await _copyFile(localPath, safeDest);
        _recordCopy(result, localPath, renamedTo);
        result.renamedConflicts++;
        result.copiedToArchive++;
        onFileProgress?.(filename, 'copied');
      } catch (err) {
        result.errors.push(`Conflict-rename failed ${filename}: ${err.message}`);
        onFileProgress?.(filename, 'failed');
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
      onFileProgress?.(filename, 'skipped');
    } else if (_isSidecar(filename)) {
      result.sidecarConflicts++;
      onFileProgress?.(filename, 'skipped');
    } else {
      const safeDest = await _safeRenamedPath(archivePath);
      const { finalDest: renamedTo } = await _copyFile(localPath, safeDest);
      _recordCopy(result, localPath, renamedTo);
      result.renamedConflicts++;
      result.copiedToArchive++;
      onFileProgress?.(filename, 'copied');
    }
  } catch (err) {
    result.errors.push(`Checksum/copy failed ${filename}: ${err.message}`);
    onFileProgress?.(filename, 'failed');
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
 * pauseSignal  — optional { paused: boolean } — checked between files.
 * onFileProgress — optional (filename, action) => void
 *
 * @param {string[]} relPaths  Paths relative to localEventPath, using '/' separator.
 */
async function _syncFileList(relPaths, localEventPath, archiveEventPath, result, abortSignal = null, pauseSignal = null, onFileProgress = null, archivePathOverrides = null) {
  for (const relPath of relPaths) {
    if (abortSignal?.aborted) return;
    if (pauseSignal?.paused)  return;
    if (typeof relPath !== 'string' || !relPath) continue;

    const segments    = relPath.split('/').filter(Boolean);
    const localPath   = path.join(localEventPath, ...segments);

    // For multi-component paths the photographer segment may be remapped to its
    // canonical archive folder name (e.g. "M Murtaza" → "PC01-M Murtaza").
    const archiveRel  = archivePathOverrides?.get(relPath) ?? relPath;
    const archivePath = path.join(archiveEventPath, ...archiveRel.split('/').filter(Boolean));
    const filename    = segments[segments.length - 1] || '';

    // RAW files: resolve together with their companion .xmp (if the source has one) as
    // a single naming pair — see the PAIR INVARIANT comment above _resolvePairDestination.
    const ext = path.extname(filename).toLowerCase();
    if (_RAW_EXTS.has(ext)) {
      const base        = filename.slice(0, filename.length - ext.length);
      const xmpFilename = base + '.xmp';
      const xmpLocal    = path.join(path.dirname(localPath),   xmpFilename);
      const xmpArchive  = path.join(path.dirname(archivePath), xmpFilename);
      const hasXmp      = await _pathExists(xmpLocal);
      await _syncRawWithCompanion(
        localPath, archivePath, filename,
        xmpLocal, xmpArchive, xmpFilename,
        hasXmp, result, abortSignal, onFileProgress,
      );
      continue;
    }

    await _syncOneFile(localPath, archivePath, filename, result, abortSignal, onFileProgress);
  }
}

/**
 * Build a Map<localRelPath, archiveRelPath> for Strategy A multi-component sync.
 *
 * For paths with the structure compFolder/photographerFolder/file (>= 3 segments),
 * scans the archive component dir and remaps the photographer segment to whichever
 * existing archive folder shares the same canonical name (PC-prefix stripped).
 * Example: "01-Majlis/M Murtaza/photo.jpg" → "01-Majlis/PC01-M Murtaza/photo.jpg"
 *
 * Single-component paths (< 3 segments) are left unchanged — those are handled
 * by the existing top-level canonical lookup (lines ~694-704 in syncJob).
 *
 * Returns null when no overrides are needed.
 *
 * @param {string[]} relPaths
 * @param {string}   archiveEventPath
 * @returns {Promise<Map<string,string>|null>}
 */
async function _buildArchiveOverrides(relPaths, archiveEventPath) {
  // Cache: compFolder → Map<canonicalName, archiveFolderName>
  const compDirCache = new Map();
  const overrides    = new Map();

  for (const relPath of relPaths) {
    const parts = relPath.split('/').filter(Boolean);
    if (parts.length < 3) continue; // not a comp/ph/file path — no remapping needed

    const compFolder = parts[0];
    const localPh    = parts[1];

    if (!compDirCache.has(compFolder)) {
      const compArchivePath = path.join(archiveEventPath, compFolder);
      const cache = new Map(); // canonical → archiveFolderName
      try {
        const dirs = await fsp.readdir(compArchivePath, { withFileTypes: true });
        for (const d of dirs) {
          if (d.isDirectory() && !_skipDir(d.name)) {
            cache.set(_phCanonical(d.name), d.name);
          }
        }
      } catch { /* component dir absent in archive — no remapping possible yet */ }
      compDirCache.set(compFolder, cache);
    }

    const phCache   = compDirCache.get(compFolder);
    const canonical = _phCanonical(localPh);
    const archivePh = phCache.get(canonical);

    if (archivePh && archivePh !== localPh) {
      overrides.set(relPath, [compFolder, archivePh, ...parts.slice(2)].join('/'));
    }
  }

  return overrides.size > 0 ? overrides : null;
}

/**
 * Sync event.json from the staging event folder to the archive event folder.
 * Called at every successful sync exit point.
 *
 * Case A — archive event.json absent: copy staging version wholesale (staging is authoritative).
 * Case B — archive event.json present: the archive stays authoritative for components, hijriDate,
 *   metadata state etc. Only these change:
 *     • imports / lastImport / status / updatedAt — new import entries merged by id (unchanged rule)
 *     • durable metadata intent (tagRefinements + metadataGroups) — SCOPED to the files this sync
 *       job actually copied (`copiedPairs`, the real local→archive paths incl. conflict renames and
 *       photographer-folder remaps): staging is authoritative for exactly those files (its record,
 *       or its absence = Default), and the archive is authoritative for everything else — so a
 *       routine sync can never erase archive-side intent, and skipped duplicates / other devices'
 *       files are never touched. See eventMetadataIntent.syncMergeIntent.
 *   The write goes through updateEventJsonAtomic (in-process serialization with every other
 *   event.json writer). NOTE: that protects a single AutoIngest process only — two machines
 *   writing the same NAS event.json can still race (a separate, pre-existing limitation).
 *
 * Non-fatal: logs a warning and continues on any error.
 */
async function _copyEventJsonIfNeeded(localEventPath, archiveEventPath, copiedPairs = []) {
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

  // Case B: staging-relative → archive-relative keys for exactly the files this job copied.
  const pairs = [];
  for (const cp of copiedPairs || []) {
    const fromRel = eventMetadataIntent.fileRelKey(localEventPath, cp.from);
    const toRel   = eventMetadataIntent.fileRelKey(archiveEventPath, cp.to);
    if (fromRel !== null && toRel !== null) pairs.push({ fromRel, toRel });
  }

  // Pure function of the freshest archive document — evaluated once up front to skip a needless
  // rewrite (as before), and again inside the atomic update against the truly-latest document.
  const computeChanges = (doc) => {
    const changes = {};
    const localImports   = Array.isArray(localDoc.imports) ? localDoc.imports : [];
    const archiveImports = Array.isArray(doc.imports)      ? doc.imports      : [];
    if (localImports.length > 0) {
      const mergedMap = new Map();
      [...archiveImports, ...localImports].forEach(entry => {
        if (entry && typeof entry.id === 'string') mergedMap.set(entry.id, entry);
      });
      const merged = Array.from(mergedMap.values());
      if (merged.length !== archiveImports.length) {                       // new entries added
        changes.imports    = merged;
        changes.lastImport = localDoc.lastImport ?? doc.lastImport;
        changes.status     = localDoc.status     ?? doc.status;
        changes.updatedAt  = localDoc.updatedAt  ?? doc.updatedAt;
      }
    }
    if (pairs.length > 0) {
      const m = eventMetadataIntent.syncMergeIntent(doc, localDoc, pairs);
      if (m.tagRefinements.changed) changes.tagRefinements = m.tagRefinements.value;   // undefined drops the key
      if (m.metadataGroups.changed) changes.metadataGroups = m.metadataGroups.value;
      for (const note of m.notes) console.warn('[syncJob] intent merge:', note);
    }
    return changes;
  };

  if (Object.keys(computeChanges(archiveDoc)).length === 0) return;        // nothing to merge

  try {
    await updateEventJsonAtomic(archiveJsonPath, computeChanges);
    hidePathBestEffort(archiveJsonPath).catch(() => {});
  } catch (err) {
    console.warn('[syncJob] event.json merge to archive failed:', err.message);
  }
}

/**
 * Collect [{ localPath, archivePath, filename }] pairs by scanning a local dir.
 * Used by verifyJobChecksum for jobs without a files[] list.
 * Depth matches _syncDir: photographer dir + one level of subdirs.
 */
async function _collectFilePairs(localDir, archiveDir, depth = 0) {
  const pairs = [];
  let entries;
  try {
    entries = await fsp.readdir(localDir, { withFileTypes: true });
  } catch { return pairs; }

  for (const entry of entries) {
    if (_skipDir(entry.name)) continue;
    if (entry.isDirectory() && depth < 1) {
      const sub = await _collectFilePairs(
        path.join(localDir,   entry.name),
        path.join(archiveDir, entry.name),
        depth + 1,
      );
      pairs.push(...sub);
      continue;
    }
    if (!entry.isFile()) continue;
    pairs.push({
      localPath:   path.join(localDir,   entry.name),
      archivePath: path.join(archiveDir, entry.name),
      filename:    entry.name,
    });
  }
  return pairs;
}

/**
 * Write a new collection.link.json after a successful legacy-fallback sync.
 * Non-fatal — a write failure must not prevent the sync result from being returned.
 * Only writes if no link file already exists (never overwrites).
 */
async function _writeLegacyLink(localCollectionPath, collectionFolderName, nasRoot) {
  const nasCollectionPath = path.join(nasRoot, collectionFolderName);
  try {
    const { ok: alreadyLinked } = await offlineRegistry.readLink(localCollectionPath);
    if (alreadyLinked) return;
    const wr = await offlineRegistry.writeLink(localCollectionPath, {
      collectionName:             collectionFolderName,
      nasRoot,
      nasCollectionPath,
      localStagingCollectionPath: localCollectionPath,
      status:                     'linked',
    });
    if (wr.ok) {
      console.log(`[syncJob] legacy collection linked after sync: ${localCollectionPath} → ${nasCollectionPath}`);
    } else {
      console.warn(`[syncJob] legacy link write failed: ${wr.reason}`);
    }
  } catch (e) {
    console.warn(`[syncJob] legacy link write error (non-fatal): ${e.message}`);
  }
}

/**
 * Sync one Local First job to the Active Archive.
 *
 * @param {{ jobId: string, batchId: string|null, collection: string, localEventPath: string }} job
 * @param {{ nasRoot: string, stagingRoot?: string }} options
 * @param {{ progressCallback?: Function, pauseSignal?: { paused: boolean } }} [runtimeOpts]
 * @returns {Promise<{
 *   ok: boolean,
 *   status: 'synced'|'sync-failed'|'needs-attention'|'waiting-for-lock'|'paused',
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
async function syncJob(job, { nasRoot, stagingRoot }, { progressCallback, pauseSignal: externalPauseSignal } = {}) {
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
  const localCollectionPath  = path.dirname(localEventPath);

  // Resolve the NAS archive target via the collection link file.
  // Routing rules (strict precedence):
  //   1. not-found (no link file)        → name-identity fallback, backward compatible.
  //   2. unreadable/corrupt link         → BLOCK. Do not route to wrong NAS.
  //   3. status: provisional             → BLOCK. User must match to NAS first.
  //   4. nasRoot mismatch (stale link)   → BLOCK. Never fall back to name-identity.
  //   5. nasCollectionPath missing       → BLOCK. Treat as incomplete provisional.
  //   6. nasCollectionPath outside root  → BLOCK. Containment guard.
  //   7. Linked + nasRoot matches        → use link.nasCollectionPath.
  let archiveEventPath;
  let _legacyFallback = false;
  try {
    const { ok: hasLink, link, reason } = await offlineRegistry.readLink(localCollectionPath);
    if (!hasLink && reason === 'not-found') {
      // No link file — legacy collection; name-identity fallback for backward compatibility.
      archiveEventPath = path.join(nasRoot, collectionFolderName, eventFolderName);
      _legacyFallback  = true;
    } else if (!hasLink) {
      // Link file exists but is unreadable or corrupt — block rather than route blindly.
      console.warn(`[syncJob] collection link unreadable (${reason}): ${localCollectionPath}`);
      result.errors.push('Collection link is unreadable — fix or re-create the link before syncing.');
      result.status = 'stale-link-needs-rematch';
      return result;
    } else if (link.status === 'provisional') {
      result.errors.push('Collection is provisional — match it to a NAS collection before syncing.');
      result.status = 'provisional-needs-match';
      return result;
    } else if (link.nasRoot && link.nasRoot !== nasRoot) {
      // Stale link: stored NAS root no longer matches this device. Block — do not fall back.
      console.warn(`[syncJob] stale link — stored root "${link.nasRoot}" vs current "${nasRoot}": ${localCollectionPath}`);
      result.errors.push(`Stale collection link — linked NAS root does not match current device root. Re-link before syncing.`);
      result.status = 'stale-link-needs-rematch';
      return result;
    } else if (!link.nasCollectionPath) {
      // Link file present but no NAS path stored — treat as incomplete provisional.
      result.errors.push('Collection link is incomplete (no NAS collection path) — match it to a NAS collection before syncing.');
      result.status = 'provisional-needs-match';
      return result;
    } else {
      // Containment guard: linked collection path must be inside the stored nasRoot.
      const _realNasRoot = path.resolve(link.nasRoot || nasRoot);
      const _realNasColl = path.resolve(link.nasCollectionPath);
      if (_realNasColl !== _realNasRoot && !_realNasColl.startsWith(_realNasRoot + path.sep)) {
        console.warn(`[syncJob] link containment violation: "${link.nasCollectionPath}" not inside "${link.nasRoot || nasRoot}"`);
        result.errors.push('Collection link path is outside the NAS root — re-link before syncing.');
        result.status = 'stale-link-needs-rematch';
        return result;
      }
      archiveEventPath = path.join(link.nasCollectionPath, eventFolderName);
    }
  } catch {
    // Unexpected error reading registry — block rather than route blindly to wrong NAS.
    console.warn(`[syncJob] unexpected registry read error for: ${localCollectionPath}`);
    result.errors.push('Unexpected error reading collection link — retry or re-link before syncing.');
    result.status = 'stale-link-needs-rematch';
    return result;
  }
  result.archiveEventPath = archiveEventPath;

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
      // Normalize platform separator → forward slash so split('/') works on Windows.
      const fwd = f.split(path.sep).join('/');
      const ph = fwd.includes('/') ? fwd.split('/')[0] : null;
      if (!ph || _skipDir(ph)) continue;
      if (!filesByPhotographer.has(ph)) filesByPhotographer.set(ph, []);
      filesByPhotographer.get(ph).push(fwd);
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

  // Per-file progress tracking (totalFiles is approximate for Strategy A — excludes XMP companions)
  const totalFiles = hasFilesHint ? job.files.length : null;
  let completedFiles = 0;
  let copiedFiles    = 0;
  let skippedFiles   = 0;
  let failedFiles    = 0;

  const onFileProgress = progressCallback ? (filename, action) => {
    completedFiles++;
    if (action === 'copied')       copiedFiles++;
    else if (action === 'skipped') skippedFiles++;
    else if (action === 'failed')  failedFiles++;
    try {
      progressCallback({
        phase:          'syncing',
        totalFiles,
        completedFiles,
        copiedFiles,
        skippedFiles,
        failedFiles,
        currentFile:    filename,
      });
    } catch { /* progress push is non-critical; never abort sync on callback error */ }
  } : null;

  let anyLockBlocked = false;

  for (const phEntry of photographerEntries) {
    // Check pause before acquiring lock for next photographer folder
    if (externalPauseSignal?.paused) break;

    const phFolderName  = phEntry.name;
    const localPhPath   = path.join(localEventPath, phFolderName);

    // Canonical-name lookup: if the archive already has a sequenced folder for this
    // photographer (e.g. PC01-Name) and the local folder is unsequenced (e.g. Name),
    // sync into the existing sequenced folder rather than creating a duplicate.
    let archivePhFolderName = phFolderName;
    try {
      const phCanonical = _phCanonical(phFolderName);
      const archiveDirs = await fsp.readdir(archiveEventPath, { withFileTypes: true });
      const match = archiveDirs.find(
        d => d.isDirectory() && _phCanonical(d.name) === phCanonical
      );
      if (match && match.name !== phFolderName) {
        archivePhFolderName = match.name;
      }
    } catch { /* archive event dir may not exist yet — proceed with local name */ }
    const archivePhPath = path.join(archiveEventPath, archivePhFolderName);

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
        // Strategy A: sync only the exact files listed for this photographer/component.
        // For multi-component paths (comp/photographer/file), build an archive-path
        // override map so that local "M Murtaza" lands in archive "PC01-M Murtaza".
        const _stratAFiles     = filesByPhotographer.get(phFolderName) || [];
        const _archiveOverrides = await _buildArchiveOverrides(_stratAFiles, archiveEventPath);
        await _syncFileList(
          _stratAFiles,
          localEventPath,
          archiveEventPath,
          result,
          abortSignal,
          externalPauseSignal,
          onFileProgress,
          _archiveOverrides,
        );
      } else {
        // Strategy B or C: sync entire photographer folder
        await _syncDir(localPhPath, archivePhPath, result, 0, abortSignal, externalPauseSignal, onFileProgress);
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

  // Pause takes precedence: job was cleanly interrupted after the current file.
  // Lock is already released in the finally block. Files already copied are preserved.
  // Resume via syncJobNow — existing no-overwrite/checksum logic skips completed files.
  if (externalPauseSignal?.paused) {
    result.ok     = true;
    result.status = 'paused';
    return result;
  }

  const hasErrors = result.errors.length > 0;

  if (anyLockBlocked && !hasErrors) {
    result.status         = 'waiting-for-lock';
    result.waitingForLock = true;
    return result;
  }

  if (hasErrors) {
    const anySuccess = result.copiedToArchive > 0 || result.skippedDuplicates > 0;
    if (anySuccess) {
      result.ok      = true;
      result.status  = 'needs-attention';
      result.syncedAt = Date.now();
      if (_legacyFallback) await _writeLegacyLink(localCollectionPath, collectionFolderName, nasRoot);
    } else {
      result.status = 'sync-failed';
    }
    return result;
  }

  await _copyEventJsonIfNeeded(localEventPath, archiveEventPath, result._copiedPairs || []);

  if (result.sidecarConflicts > 0) {
    result.ok      = true;
    result.status  = 'needs-attention';
    result.syncedAt = Date.now();
    if (_legacyFallback) await _writeLegacyLink(localCollectionPath, collectionFolderName, nasRoot);
    return result;
  }

  result.ok      = true;
  result.status  = 'synced';
  result.syncedAt = Date.now();
  if (_legacyFallback) await _writeLegacyLink(localCollectionPath, collectionFolderName, nasRoot);
  return result;
}

/**
 * Verify checksums for a completed sync job.
 * Compares local staging source files against archive destination files.
 * Includes companion XMP sidecar expansion (same logic as _syncFileList).
 *
 * Does not re-copy files. Reports only. Safe to run at any time after sync.
 *
 * KNOWN LIMITATION (not fixed as part of D1 — recorded, not fixed): this function
 * reconstructs each file's expected archive path directly from job.files' relPaths and
 * has no access to the sync's actual conflict-rename decisions (_copiedPairs is
 * deliberately non-enumerable and never persisted — see _recordCopy). It already
 * mis-locates a RAW that was itself conflict-renamed during sync, independent of the
 * RAW/XMP pairing fix below; the same gap applies to its own companion-XMP expansion.
 * Correctly fixing this needs the sync's actual pair-destination mapping to be threaded
 * through durably (a real API/persistence change), which is out of scope here.
 *
 * @param {{ progressCallback?: Function }} [opts]
 * @returns {Promise<{
 *   ok: boolean,
 *   status: 'verified'|'failed'|'partial'|'error',
 *   verifiedCount: number,
 *   failedCount: number,
 *   missingCount: number,
 *   totalCount: number,
 *   errors: string[],
 *   verifiedAt: number|null,
 * }>}
 */
async function verifyJobChecksum(job, { nasRoot, stagingRoot, progressCallback } = {}) {
  const result = {
    ok:            false,
    status:        'error',
    verifiedCount: 0,
    failedCount:   0,
    missingCount:  0,
    totalCount:    0,
    errors:        [],
    verifiedAt:    null,
  };

  const { localEventPath } = job;
  if (!localEventPath || !nasRoot) {
    result.errors.push('Missing localEventPath or nasRoot');
    return result;
  }

  const collectionFolderName = path.basename(path.dirname(localEventPath));
  const eventFolderName      = path.basename(localEventPath);
  const localCollectionPath  = path.dirname(localEventPath);

  let archiveEventPath;
  try {
    const { ok: hasLink, link } = await offlineRegistry.readLink(localCollectionPath);
    if (!hasLink || !link) {
      archiveEventPath = path.join(nasRoot, collectionFolderName, eventFolderName);
    } else if (link.status === 'provisional') {
      result.errors.push('Collection is provisional — match it to a NAS collection before verifying.');
      result.status = 'provisional-needs-match';
      return result;
    } else if (link.nasRoot && link.nasRoot !== nasRoot) {
      result.errors.push('Stale collection link — stored NAS root does not match current. Re-link this collection before verifying.');
      result.status = 'stale-link-needs-rematch';
      return result;
    } else if (!link.nasCollectionPath) {
      result.errors.push('Collection link is incomplete (no NAS collection path) — match it to a NAS collection before verifying.');
      result.status = 'provisional-needs-match';
      return result;
    } else {
      archiveEventPath = path.join(link.nasCollectionPath, eventFolderName);
    }
  } catch {
    archiveEventPath = path.join(nasRoot, collectionFolderName, eventFolderName);
  }

  // Build file pairs: Strategy A (files[]) or Strategy B (photographer folder scan)
  let filePairs = [];

  if (Array.isArray(job.files) && job.files.length > 0) {
    // Strategy A: exact file list + XMP sidecar expansion (matches _syncFileList logic)
    for (const relPath of job.files) {
      if (typeof relPath !== 'string' || !relPath) continue;
      const segments    = relPath.split('/').filter(Boolean);
      const localPath   = path.join(localEventPath,   ...segments);
      const archivePath = path.join(archiveEventPath, ...segments);
      const filename    = segments[segments.length - 1] || '';
      filePairs.push({ localPath, archivePath, filename });

      const ext = path.extname(filename).toLowerCase();
      if (_RAW_EXTS.has(ext)) {
        const base        = filename.slice(0, filename.length - ext.length);
        const xmpFilename = base + '.xmp';
        const xmpLocal    = path.join(path.dirname(localPath),   xmpFilename);
        const xmpArchive  = path.join(path.dirname(archivePath), xmpFilename);
        try {
          await fsp.access(xmpLocal);
          filePairs.push({ localPath: xmpLocal, archivePath: xmpArchive, filename: xmpFilename });
        } catch { /* XMP absent — skip */ }
      }
    }
  } else if (typeof job.photographer === 'string' && job.photographer.trim()) {
    // Strategy B: scan single photographer folder
    const phName    = job.photographer.trim();
    const localPh   = path.join(localEventPath,   phName);
    const archivePh = path.join(archiveEventPath, phName);
    filePairs = await _collectFilePairs(localPh, archivePh);
  } else {
    result.errors.push('No files list and no photographer — cannot verify legacy job');
    return result;
  }

  result.totalCount = filePairs.length;

  for (let i = 0; i < filePairs.length; i++) {
    const { localPath, archivePath, filename } = filePairs[i];

    progressCallback?.({
      phase:          'verifying',
      totalFiles:     result.totalCount,
      completedFiles: i,
      currentFile:    filename,
    });

    let archiveStat;
    try {
      archiveStat = await fsp.stat(archivePath);
    } catch (e) {
      if (e.code === 'ENOENT') {
        result.missingCount++;
        result.errors.push(`Missing in archive: ${filename}`);
      } else {
        result.failedCount++;
        result.errors.push(`Stat error: ${filename}: ${e.message}`);
      }
      continue;
    }

    try {
      const [localHash, archiveHash] = await Promise.all([
        _streamChecksum(localPath),
        _streamChecksum(archivePath),
      ]);
      if (localHash === archiveHash) {
        result.verifiedCount++;
      } else {
        result.failedCount++;
        result.errors.push(`Mismatch: ${filename}`);
      }
    } catch (err) {
      result.failedCount++;
      result.errors.push(`Checksum error: ${filename}: ${err.message}`);
    }
  }

  progressCallback?.({
    phase:          'verifying',
    totalFiles:     result.totalCount,
    completedFiles: result.totalCount,
    currentFile:    null,
  });

  result.verifiedAt = Date.now();
  result.ok         = true;

  if (result.failedCount > 0 || result.missingCount > 0) {
    result.status = result.verifiedCount === 0 ? 'failed' : 'partial';
  } else {
    result.status = 'verified';
  }

  return result;
}

module.exports = {
  syncJob, verifyJobChecksum,
  // Test-only: exposes the event.json merge so the scoped intent-merge rules can be verified directly.
  _copyEventJsonIfNeeded,
};
