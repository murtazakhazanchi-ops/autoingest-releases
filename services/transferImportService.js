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
 *  - Import runs in batches with an atomic checkpoint after each batch.
 *  - Pause takes effect between files (within a batch) or between batches.
 *  - A Transfer Drive root may contain Event folders directly (not just nested under a
 *    Collection). Direct Events are classified structurally (event.json presence) and their
 *    destination Collection is resolved separately from source classification — see
 *    _resolveEventDestination. A direct Event is never imported to a guessed or synthesized
 *    Collection; if its destination cannot be resolved with real evidence it is left
 *    unresolved and excluded from the operation.
 *  - Update Import (scope.backupUpdate) copies only files approved by a prior Scan for New
 *    Data: never overwrites, never renames, and refuses to run if the reviewed file
 *    inventory or destination resolution has changed since the scan (scanFingerprint
 *    mismatch → reason:'scan-stale', nothing copied, never falls back to plain-Import
 *    semantics).
 */

const fsp    = require('fs').promises;
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const os     = require('os');

const { hidePathBestEffort, isAutoIngestInternalName } = require('./internalFileProtection');

// ── Constants ─────────────────────────────────────────────────────────────────

const TX_TMP_SUFFIX          = '.autoingest-tx-tmp';
const CHECKPOINT_JSON        = 'import-checkpoint.json';
const EXPORT_CHECKPOINT_JSON = 'export-checkpoint.json';
const MAX_ERRORS             = 200;

const _SKIP_SRC_DIRS = new Set(['.autoingest', '.autoingest-transfer', '__MACOSX']);

// Operating-system junk directories a Transfer Drive may legitimately carry (Windows
// recycle bin / volume-indexing metadata, seen on any external drive previously used
// outside AutoIngest). Excluded the same way as _SKIP_SRC_DIRS — never read, never
// classified as a candidate, never deleted or touched. Matched case-insensitively:
// Windows filesystems are case-insensitive, so the exact casing on disk can vary.
const _OS_JUNK_DIRS_LOWER = new Set(['$recycle.bin', 'system volume information']);

// ── Module-scope state ────────────────────────────────────────────────────────

let _state = {
  running:        false,
  paused:         false,
  batchId:        null,
  batchIndex:     0,
  batchCount:     0,
  batchName:      '',
  current:        '',
  copied:         0,
  skipped:        0,
  renamed:        0,
  changedSkipped: 0,
  copiedBytes:    0,
  errors:         [],
  neverAttempted: 0,
  total:          0,
  result:         null,
  verifyStatus:   null,
  verifyTotal:    0,
  verifyDone:     0,
  verifyFailed:   0,
  // checkpointHealthy reflects the outcome of the MOST RECENT checkpoint write
  // attempt (not sticky-forever-broken) — a later successful write genuinely does
  // restore resumability, since a fresh valid checkpoint is then on disk. false
  // means: if the app is interrupted right now, this transfer cannot be safely
  // resumed from where it left off (already-completed copies are never affected —
  // this only concerns resume capability after a restart).
  checkpointHealthy: true,
  checkpointError:   null,
};

// Set once per run (reset in runImport/resumeImportFromCheckpoint) so a checkpoint
// write failing repeatedly during one import only records ONE audit-log entry and
// surfaces ONE operator-facing warning transition, not a flood of identical ones —
// per-attempt detail still goes to console.error for debugging, just not repeated
// into the durable audit trail or re-triggering renderer-side alert state.
let _checkpointFailureLoggedThisRun = false;

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

// Maps a raw OS error code to the semantic reason an operator-facing message should use.
// Exists because "destination may be unwritable" was previously a guess applied uniformly
// to every copy failure — EPERM/EACCES (permission denied, e.g. a macOS Privacy & Security
// access grant never given to this app for an external volume), ENOENT (the path genuinely
// doesn't exist, e.g. the drive isn't connected), EROFS (truly read-only filesystem), and
// ENOSPC (disk full) are different problems with different fixes, and conflating them
// under one vague message is exactly what sent the original zero-copy report in the wrong
// direction (the destination tested "writable" by shallow checks while being rejected by
// the OS on every real file operation).
function _classifyFsErrorCode(code) {
  switch (code) {
    case 'EPERM':
    case 'EACCES':  return 'permission-denied';
    case 'ENOENT':  return 'destination-missing';
    case 'ENOTDIR': return 'destination-not-a-directory';
    case 'EROFS':   return 'read-only-filesystem';
    case 'ENOSPC':  return 'disk-full';
    default:        return code ? 'other' : 'unknown';
  }
}

// A real reachability+write probe against the destination, scoped to the app's own
// .autoingest/transfer-imports/ directory (the same directory checkpoints and the audit
// log already live in — never a file dropped into the operator's actual archive content).
// This is a preflight, not a guarantee: a drive can still disconnect mid-run after this
// passes. Its job is only to fail fast, with the real OS error attached, instead of
// burning through MAX_ERRORS identical per-file failures before anything is reported.
async function _checkDestinationReachable(mainArchiveRoot) {
  // Stat the root itself first, without creating anything. mkdir({recursive:true}) would
  // otherwise silently CREATE a genuinely-missing mount point as an ordinary directory
  // whenever its own parent happens to be writable — masking "the drive isn't actually
  // there" as success. A disconnected external volume's mount point does not exist in the
  // filesystem namespace at all; stat must see that directly, not have mkdir paper over it.
  try {
    const rootStat = await fsp.stat(mainArchiveRoot);
    if (!rootStat.isDirectory()) {
      return { ok: false, code: 'ENOTDIR', message: `${mainArchiveRoot} exists but is not a directory`, reason: 'destination-not-a-directory' };
    }
  } catch (e) {
    return { ok: false, code: e.code || null, message: e.message, reason: _classifyFsErrorCode(e.code) };
  }

  const internalDir = path.join(mainArchiveRoot, '.autoingest', 'transfer-imports');
  try {
    await fsp.mkdir(internalDir, { recursive: true });
  } catch (e) {
    return { ok: false, code: e.code || null, message: e.message, reason: _classifyFsErrorCode(e.code) };
  }
  const probePath = path.join(internalDir, `.reachability-probe-${process.pid}-${Date.now()}`);
  try {
    await fsp.writeFile(probePath, '');
    await fsp.unlink(probePath);
  } catch (e) {
    return { ok: false, code: e.code || null, message: e.message, reason: _classifyFsErrorCode(e.code) };
  }
  return { ok: true };
}

function _skipDir(name) {
  return _SKIP_SRC_DIRS.has(name) || name.startsWith('.') || _OS_JUNK_DIRS_LOWER.has(name.toLowerCase());
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

// ── Per-file outcome manifest ─────────────────────────────────────────────────
// Purely additive recording of the outcome _copyFileSafe already decides — never
// itself a decision point. Consumed read-only by main.js's post-transfer metadata
// verification step (plan §7) to scope which destination files belong to this
// completed transfer, since a destination-folder walk can't tell.

function _transferOutcomesPath(mainArchiveRoot, batchId) {
  return path.join(mainArchiveRoot, '.autoingest', 'transfer-imports', `transfer-outcomes-${batchId}.jsonl`);
}

async function _recordTransferOutcome(outcomeCtx, outcome, srcPath, destPath) {
  if (!outcomeCtx) return;
  const entry = {
    batchId:              outcomeCtx.batchId,
    transferRootIdentity: outcomeCtx.transferRootIdentity || null,
    eventPath:            outcomeCtx.eventPath || null,
    srcRelPath:           path.relative(outcomeCtx.transferRoot, srcPath),
    destPath,
    outcome,
  };
  try {
    await fsp.appendFile(_transferOutcomesPath(outcomeCtx.mainArchiveRoot, outcomeCtx.batchId), JSON.stringify(entry) + '\n', 'utf8');
  } catch (e) {
    console.error('[transferImport] outcome manifest append failed:', e.message);
  }
}

async function _readTransferRootIdentity(transferRoot) {
  try {
    const raw = await fsp.readFile(path.join(transferRoot, '.autoingest-transfer', 'transfer-root.json'), 'utf8');
    const marker = JSON.parse(raw);
    return marker.createdAt || null;
  } catch {
    return null;
  }
}

async function _copyFileSafe(srcPath, destPath, stats, opts = {}) {
  let srcStat;
  try { srcStat = await fsp.stat(srcPath); } catch (e) {
    await _recordTransferOutcome(opts.outcomeCtx, 'failed', srcPath, destPath);
    throw new Error(`stat source: ${e.message}`);
  }

  let destStat = null;
  try { destStat = await fsp.stat(destPath); } catch {}

  let finalDest = destPath;
  let outcome;

  if (destStat) {
    if (destStat.size === srcStat.size) {
      stats.skipped++;
      await _recordTransferOutcome(opts.outcomeCtx, 'same-size-skipped', srcPath, destPath);
      return 'skipped';
    }
    if (opts.backupUpdate) {
      // Update Import: never overwrite, never create _1/_2. The changed/new-file decision
      // was already made once by the Scan's inventory snapshot — this branch only guards
      // the narrow race between that snapshot and this copy (see _scanUnitsInventory).
      stats.changedSkipped = (stats.changedSkipped || 0) + 1;
      await _recordTransferOutcome(opts.outcomeCtx, 'changed-skipped', srcPath, destPath);
      return 'skipped-changed';
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
    await _recordTransferOutcome(opts.outcomeCtx, 'failed', srcPath, destPath);
    throw e;
  }

  if (isAutoIngestInternalName(path.basename(finalDest))) {
    hidePathBestEffort(finalDest).catch(() => {});
  }

  await _recordTransferOutcome(opts.outcomeCtx, outcome, srcPath, finalDest);
  return outcome;
}

async function _walkAndCopy(srcDir, destDir, stats, opts = {}) {
  let entries;
  try { entries = await fsp.readdir(srcDir, { withFileTypes: true }); } catch { return; }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (_skipDir(entry.name)) continue;
      if (opts.rootFilesOnly) continue;
      const destSubDir = path.join(destDir, entry.name);
      // Create the destination directory unconditionally, before recursing — not only as a
      // side effect of copying a file into it. Previously, a directory with no files
      // anywhere inside it (at any depth) was silently never created at the destination,
      // since directory creation only ever happened inside _copyFileSafe's own
      // mkdir(dirname(finalDest)). An empty directory is real source structure; dropping it
      // was never a deliberate decision, just an unhandled case.
      try { await fsp.mkdir(destSubDir, { recursive: true }); } catch {}
      await _walkAndCopy(
        path.join(srcDir, entry.name),
        destSubDir,
        stats,
        opts
      );
    } else if (entry.isFile()) {
      if (_skipFile(entry.name)) continue;
      if (stats.errors.length >= MAX_ERRORS) {
        // The error cap stops ATTEMPTS, not just display — every file reaching this branch
        // is never copied, never skipped, never recorded as a failure. Counted separately
        // (stats.neverAttempted) so the final result can say so explicitly instead of letting
        // copied+skipped+renamed+errors silently fall short of the file count the operator
        // was shown in Preview/Scan.
        stats.neverAttempted = (stats.neverAttempted || 0) + 1;
        continue;
      }

      await _waitIfPaused();

      const srcPath  = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      _state.current = entry.name;

      try {
        await _copyFileSafe(srcPath, destPath, stats, opts);
      } catch (e) {
        stats.errors.push({ file: srcPath, error: e.message, code: e.code || null });
      }

      _state.copied         = stats.copied;
      _state.skipped        = stats.skipped;
      _state.renamed        = stats.renamed;
      _state.changedSkipped = stats.changedSkipped || 0;
      _state.errors         = [...stats.errors];
      _state.copiedBytes    = stats.copiedBytes || 0;
      _state.neverAttempted = stats.neverAttempted || 0;
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
    // A later successful write genuinely restores resumability (a fresh valid
    // checkpoint is now on disk) — never leave the operator-facing flag stuck on a
    // transient failure that has since self-corrected.
    _state.checkpointHealthy = true;
    _state.checkpointError   = null;
  } catch (e) {
    console.error('[transferImport] checkpoint write failed:', e.message);
    _state.checkpointHealthy = false;
    _state.checkpointError   = e.message;
    if (!_checkpointFailureLoggedThisRun) {
      _checkpointFailureLoggedThisRun = true;
      const auditDir = path.join(mainArchiveRoot, '.autoingest', 'transfer-imports');
      try {
        await fsp.mkdir(auditDir, { recursive: true });
        await fsp.appendFile(path.join(auditDir, 'imports.audit.jsonl'), JSON.stringify({
          type: 'checkpoint-failure', batchId: _state.batchId, mainArchiveRoot,
          ts: new Date().toISOString(), error: e.message, errorCode: e.code || null,
        }) + '\n', 'utf8');
      } catch (auditErr) {
        console.error('[transferImport] failed to record checkpoint-failure audit entry:', auditErr.message);
      }
    }
  }
}

// Canonical Representation Audit, L2 (2026-08-11): checkpoint.batches already
// gets an explicit Array.isArray guard before use (resumeImportFromCheckpoint,
// below); these numeric progress counters did not — a checkpoint value that
// somehow wasn't a genuine number (a hand-edited file, a future format, a
// producer bug not yet written) would pass the `|| 0` fallback unchanged if
// truthy, silently turning later `+=` progress arithmetic into string
// concatenation instead of failing visibly — the same defect class as
// BUG-011, just not yet triggered by any current writer. Normalized once,
// here, at the single point every checkpoint read goes through. The on-disk
// checkpoint format itself is never touched — only the in-memory object this
// function returns.
const CHECKPOINT_NUMERIC_FIELDS = ['currentBatchIdx', 'totalCopied', 'totalSkipped', 'totalRenamed', 'totalChangedSkipped', 'totalFiles'];

function _normalizeCheckpointNumericFields(checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object') return checkpoint;
  const normalized = { ...checkpoint };
  for (const field of CHECKPOINT_NUMERIC_FIELDS) {
    const raw = normalized[field];
    // Only a genuine number, or a non-blank string that looks like one, is a
    // legitimate producer output (the BUG-011-class case this closes). Every
    // other type — including booleans, which JS's own Number() would happily
    // coerce to 0/1 — falls through to the same 0 default as missing/falsy
    // values, rather than being silently accepted as real progress data.
    let n = NaN;
    if (typeof raw === 'number') n = raw;
    else if (typeof raw === 'string' && raw.trim() !== '') n = Number(raw);
    normalized[field] = Number.isFinite(n) ? n : 0;
  }
  return normalized;
}

async function _readCheckpoint(mainArchiveRoot) {
  try {
    const raw = await fsp.readFile(_checkpointPath(mainArchiveRoot), 'utf8');
    return _normalizeCheckpointNumericFields(JSON.parse(raw));
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

// ── Event validation ──────────────────────────────────────────────────────────
// A folder is only ever classified as an Event when its event.json parses AND passes the
// app's real schema validator (injected by the caller — see main.js's isValidEventJson,
// main.js:1533). A malformed or unrelated event.json never classifies a folder as an Event.

async function _readValidEventJson(dirPath, isValidEventJsonFn) {
  try {
    const raw  = await fsp.readFile(path.join(dirPath, 'event.json'), 'utf8');
    const data = JSON.parse(raw);
    if (!isValidEventJsonFn(data)) return null;
    return data;
  } catch {
    return null;
  }
}

// Strong composite identity — hijriDate+sequence alone is never sufficient for a match.
// components is compared order-sensitive: the archive-naming standard forbids reordering,
// so two event.json for the same real event are guaranteed to already agree on order.
function _eventIdentityKey(eventData) {
  return JSON.stringify({
    version:    eventData.version,
    hijriDate:  eventData.hijriDate,
    sequence:   eventData.sequence,
    eventName:  eventData.eventName,
    components: eventData.components,
  });
}

async function _buildEventNode(name, evPath) {
  let subEntries;
  try { subEntries = await fsp.readdir(evPath, { withFileTypes: true }); } catch { subEntries = []; }
  const folders = [];
  const files = [];
  for (const sub of subEntries) {
    if (sub.isDirectory() && !_skipDir(sub.name)) {
      folders.push({ name: sub.name, path: path.join(evPath, sub.name) });
    } else if (sub.isFile() && !_skipFile(sub.name)) {
      // Individually selectable, in addition to the existing hasEventRootFiles-driven
      // "whole event, including all root files" bundle — see the Import Scope tree's
      // recursive-selection comment for why both representations coexist.
      files.push({ name: sub.name, path: path.join(evPath, sub.name), isDir: false });
    }
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { name, path: evPath, folders, files, hasEventRootFiles: files.length > 0 };
}

// ── Destination resolution ────────────────────────────────────────────────────

async function _buildArchiveIndex(mainArchiveRoot, isValidEventJsonFn) {
  const index = new Map(); // identityKey -> [{ collectionName, eventPath }]
  let collEntries;
  try { collEntries = await fsp.readdir(mainArchiveRoot, { withFileTypes: true }); } catch { return index; }
  for (const collEntry of collEntries) {
    if (!collEntry.isDirectory() || _skipDir(collEntry.name)) continue;
    const collPath = path.join(mainArchiveRoot, collEntry.name);
    let evEntries;
    try { evEntries = await fsp.readdir(collPath, { withFileTypes: true }); } catch { continue; }
    for (const evEntry of evEntries) {
      if (!evEntry.isDirectory() || _skipDir(evEntry.name)) continue;
      const data = await _readValidEventJson(path.join(collPath, evEntry.name), isValidEventJsonFn);
      if (!data) continue;
      const key  = _eventIdentityKey(data);
      const list = index.get(key) || [];
      list.push({ collectionName: collEntry.name, eventPath: path.join(collPath, evEntry.name) });
      index.set(key, list);
    }
  }
  return index;
}

async function _readExportCheckpoint(transferRoot) {
  try {
    const raw = await fsp.readFile(
      path.join(transferRoot, '.autoingest-transfer', EXPORT_CHECKPOINT_JSON), 'utf8'
    );
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Resolves the destination Collection for a direct Event (one found at the Transfer Drive
// root, not nested under a Collection folder there). `caches` is call-scoped — never
// module-level — so nothing leaks across calls, drives, or modal re-opens.
async function _resolveEventDestination(transferRoot, mainArchiveRoot, eventName, eventData, isValidEventJsonFn, caches) {
  if (!caches.archiveIndex) {
    caches.archiveIndex = await _buildArchiveIndex(mainArchiveRoot, isValidEventJsonFn);
  }
  const identityKey = _eventIdentityKey(eventData);

  if (caches.checkpoint === undefined) {
    caches.checkpoint = await _readExportCheckpoint(transferRoot);
  }
  const checkpoint = caches.checkpoint;

  // Step 1 — checkpoint recovery. A stale or wrong checkpoint must never win over the
  // archive's own evidence; every branch either confirms with live evidence or falls
  // through to the unscoped archive search in Step 2.
  if (checkpoint && checkpoint.sourceMode === 'custom' &&
      typeof checkpoint.nasRoot === 'string' && path.isAbsolute(checkpoint.nasRoot)) {
    const candidateCollectionName = path.basename(checkpoint.nasRoot);
    const candidateCollectionPath = path.join(mainArchiveRoot, candidateCollectionName);
    let candidateExists = false;
    try { candidateExists = (await fsp.stat(candidateCollectionPath)).isDirectory(); } catch {}

    if (candidateExists) {
      const originalEventData = await _readValidEventJson(checkpoint.nasRoot, isValidEventJsonFn);

      if (!originalEventData) {
        // checkpoint.nasRoot itself is not an Event — Collection-shaped, good. But that alone
        // doesn't prove THIS specific direct-Event folder was part of that export (e.g. an
        // unrelated Event could have been dropped onto the drive's root afterward, outside the
        // app). Strongest possible evidence: does a folder with this exact event's identity
        // still exist as a live child of the recorded original Collection? That is direct,
        // per-event proof — not an inference from reachability/sibling-count/basename alone —
        // and, critically, does not require the event to already be archived (this is exactly
        // the first-time-import case checkpoint recovery exists for).
        let originalChildMatch = false;
        try {
          const originalChildData = await _readValidEventJson(path.join(checkpoint.nasRoot, eventName), isValidEventJsonFn);
          originalChildMatch = !!originalChildData && _eventIdentityKey(originalChildData) === identityKey;
        } catch { /* checkpoint.nasRoot unreachable or child absent — fall through below */ }

        if (originalChildMatch) {
          return {
            destinationStatus: 'resolved',
            collectionKey:     candidateCollectionName,
            destDir:           path.join(candidateCollectionPath, eventName),
            destinationReason: 'checkpoint-recovered',
          };
        }

        // No direct per-event confirmation at the source (unreachable, or this specific event
        // is no longer/never was there). basename(nasRoot) is still only a candidate — never
        // accepted on its own. Sibling direct-Event count on the current drive is explicitly
        // not evidence either. Only a real archive-identity match inside the named Collection
        // counts as fallback confirmation.
        const matchesInCandidate = (caches.archiveIndex.get(identityKey) || [])
          .filter(m => m.collectionName === candidateCollectionName);
        if (matchesInCandidate.length === 1) {
          return {
            destinationStatus: 'resolved',
            collectionKey:     candidateCollectionName,
            destDir:           path.join(candidateCollectionPath, eventName),
            destinationReason: 'checkpoint-candidate-archive-confirmed',
          };
        }
        if (matchesInCandidate.length > 1) {
          return { destinationStatus: 'unresolved', collectionKey: null, destDir: null, destinationReason: 'ambiguous-archive-match' };
        }
        // zero matches in candidate — fall through to the unscoped Step 2 search below.
      }
      // originalEventData present → the custom source was itself a valid Event, never a
      // Collection — reject outright, fall through to Step 2.
    }
  }

  // Step 2 — global archive search by strong composite identity.
  const globalMatches = caches.archiveIndex.get(identityKey) || [];
  if (globalMatches.length === 1) {
    const m = globalMatches[0];
    return {
      destinationStatus: 'resolved',
      collectionKey:     m.collectionName,
      destDir:           path.join(mainArchiveRoot, m.collectionName, eventName),
      destinationReason: 'archive-match',
    };
  }
  if (globalMatches.length > 1) {
    return { destinationStatus: 'unresolved', collectionKey: null, destDir: null, destinationReason: 'ambiguous-archive-match' };
  }

  return { destinationStatus: 'unresolved', collectionKey: null, destDir: null, destinationReason: 'no-existing-collection-found' };
}

// A Collection-shaped folder's own name is its deterministic destination Collection name (see
// the big comment above the 'collection' tree-node push below) — but "does a directory with
// that name already exist at the destination" must distinguish a clean, genuine absence from
// a failed lookup (a permission error, a transient I/O fault, a disconnected mount). Only
// 'absent' is evidence a Collection is new; 'unknown' must never be silently treated as
// absence (see "Transfer Import Collection Status Correction" §4/§9 — a failed lookup is not
// proof of absence, and an unresolved state must stay distinct from a confirmed new Collection).
async function _checkDestinationCollectionState(mainArchiveRoot, name) {
  let st;
  try { st = await fsp.stat(path.join(mainArchiveRoot, name)); }
  catch (e) { return (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) ? 'absent' : 'unknown'; }
  return st.isDirectory() ? 'exists' : 'occupied'; // a file, not a folder, already sits at that name
}

// ── Structure-aware tree scan (for the UI scope picker) ───────────────────────

async function scanImportTree(transferRoot, mainArchiveRoot, isValidEventJsonFn) {
  if (!transferRoot)    return { ok: false, reason: 'transfer-root-not-set' };
  if (!mainArchiveRoot) return { ok: false, reason: 'main-archive-not-set' };

  let topEntries;
  try { topEntries = await fsp.readdir(transferRoot, { withFileTypes: true }); } catch {
    return { ok: false, reason: 'transfer-root-unreadable' };
  }

  const caches = { checkpoint: undefined, archiveIndex: null };
  const tree = [];

  for (const topEntry of topEntries) {
    if (topEntry.isFile()) {
      // General-purpose transfer: an ordinary file sitting directly at the Transfer Drive
      // root is just as legitimate a transfer unit as a folder — AutoIngest Collection
      // structure is for photographic archive content, not a gate on what can be moved.
      if (_skipFile(topEntry.name)) continue;
      tree.push({
        type: 'generic-file', name: topEntry.name, path: path.join(transferRoot, topEntry.name),
        destinationStatus: 'resolved', destinationReason: null, collectionKey: null,
      });
      continue;
    }
    if (!topEntry.isDirectory() || _skipDir(topEntry.name)) continue;
    const topPath = path.join(transferRoot, topEntry.name);

    const directEventData = await _readValidEventJson(topPath, isValidEventJsonFn);
    if (directEventData) {
      const node = await _buildEventNode(topEntry.name, topPath);
      const dest = await _resolveEventDestination(transferRoot, mainArchiveRoot, topEntry.name, directEventData, isValidEventJsonFn, caches);
      tree.push({
        type: 'event',
        ...node,
        destinationStatus: dest.destinationStatus,
        destinationReason: dest.destinationReason,
        collectionKey:     dest.collectionKey,
      });
      continue;
    }

    let childEntries;
    try { childEntries = await fsp.readdir(topPath, { withFileTypes: true }); } catch { continue; }

    const events = [];
    const externalFolders = [];
    for (const childEntry of childEntries) {
      if (!childEntry.isDirectory() || _skipDir(childEntry.name)) continue;
      const childPath = path.join(topPath, childEntry.name);
      const childEventData = await _readValidEventJson(childPath, isValidEventJsonFn);
      if (childEventData) events.push({ name: childEntry.name, path: childPath, isEvent: true });
      else externalFolders.push({ name: childEntry.name, path: childPath });
    }

    if (events.length === 0) {
      // General-purpose transfer: no AutoIngest Event anywhere inside this folder (a legacy
      // year folder, a VHS lot, a recovered-files dump — anything that isn't photographic
      // archive content) is NOT an invalid transfer source. It is an ordinary folder, copied
      // recursively, preserving its name and internal structure under the Main Archive Root —
      // the exact same deterministic name-based destination the Collection branch below already
      // uses, just without requiring Event-shaped children. Never reinterpreted as a Collection
      // or Event, never given an event.json, never fed into archive-identity resolution.
      tree.push({
        type: 'generic-folder',
        name: topEntry.name,
        path: topPath,
        destinationStatus: 'resolved',
        destinationReason: null,
        collectionKey: null,
      });
      continue;
    }

    // A Collection-shaped top-level folder (has real Event children, proven by event.json
    // presence — never guessed) names its own destination Collection unambiguously: the
    // operator's own folder name IS the destination, the same deterministic name-based
    // mapping _resolveLegacyCollectionUnits and Transfer Export already use. This is not the
    // "trust mere reachability" problem DEC-012 forbids — DEC-012 is about not guessing WHICH
    // of several candidates an ambiguous item resolves to (see _resolveEventDestination for
    // that real ambiguity, still fully unresolved/blocked when no identity match exists).
    // Here there is exactly one candidate because the name itself is the evidence. A Collection
    // that doesn't exist yet at the destination is therefore a normal, selectable, resolved
    // outcome — not a validation failure — with destinationReason carrying 'new-collection'
    // purely as informational UI context (so the operator sees it will be created, same
    // confirm-before-import gate every other resolved item already goes through). Nothing is
    // created here; the destination folder is created on demand, idempotently, at actual copy
    // time (see the fsp.mkdir(..., {recursive:true}) calls in the copy/batch functions below).
    const collState       = await _checkDestinationCollectionState(mainArchiveRoot, topEntry.name);
    const collectionExists = collState === 'exists';
    const collUncertain     = collState === 'unknown' || collState === 'occupied';
    const collDestStatus = collUncertain ? 'unresolved' : 'resolved';
    const collDestReason = collUncertain
      ? (collState === 'occupied' ? 'destination-name-conflict' : 'destination-lookup-failed')
      : (collectionExists ? null : 'new-collection');

    const eventNodes = [];
    for (const ev of events) {
      const node = await _buildEventNode(ev.name, ev.path);
      eventNodes.push({ ...node, destinationStatus: collDestStatus, destinationReason: collDestReason, collectionKey: topEntry.name });
    }
    const externalNodes = externalFolders.map(f => ({
      ...f, destinationStatus: collDestStatus, destinationReason: collDestReason, collectionKey: topEntry.name,
    }));

    tree.push({
      type: 'collection', name: topEntry.name, path: topPath, events: eventNodes, externalFolders: externalNodes,
      // Never claimed true under uncertainty — only a clean, confirmed absence is "new".
      isNewCollection: !collUncertain && !collectionExists,
    });
  }

  return { ok: true, tree };
}

// Lazy, one-level child listing for a generic (non-archive-shaped) folder's nested-selection
// tree. Intentionally shallow — the Import Scope tree fetches one level at a time, on first
// expansion of each node, so a Transfer Drive with thousands of nested files never gets
// eagerly walked or rendered in full. `dirPath` must be a real descendant of transferRoot
// (never transferRoot itself — the top level is already enumerated by scanImportTree) to
// prevent a crafted path from escaping the Transfer Drive. A child is never reclassified as
// an AutoIngest Collection/Event here — nesting inside an already-generic folder stays
// generic at every depth, exactly as scanImportTree's own generic-folder branch intends.
async function listGenericFolderChildren(transferRoot, dirPath) {
  if (!transferRoot || !dirPath) return { ok: false, reason: 'missing-params' };
  if (dirPath === transferRoot || !_isInsideDir(transferRoot, dirPath)) {
    return { ok: false, reason: 'path-outside-transfer-root' };
  }
  let entries;
  try { entries = await fsp.readdir(dirPath, { withFileTypes: true }); } catch {
    return { ok: false, reason: 'unreadable' };
  }
  const folders = [];
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (_skipDir(entry.name)) continue;
      folders.push({ name: entry.name, path: path.join(dirPath, entry.name), isDir: true });
    } else if (entry.isFile()) {
      if (_skipFile(entry.name)) continue;
      files.push({ name: entry.name, path: path.join(dirPath, entry.name), isDir: false });
    }
    // Symlinks (and any other non-regular dirent type) are neither isDirectory() nor isFile()
    // for a readdir() Dirent — silently excluded here, the same safe-by-omission posture
    // _walkAndCopy/_countFiles already rely on for the actual copy.
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, children: [...folders, ...files] };
}

// ── Shared unit resolver (Preview / Scan / Import / Verify all use this) ─────

function _dedupResolvedUnits(units) {
  const depth  = p => p.split(path.sep).length;
  const sorted = [...units].sort((a, b) => depth(a.srcDir) - depth(b.srcDir));
  const kept   = [];
  for (const u of sorted) {
    if (!u.rootFilesOnly) {
      const coveredByAncestor = kept.some(k => !k.rootFilesOnly && _isInsideDir(k.srcDir, u.srcDir));
      if (coveredByAncestor) continue;
    }
    kept.push(u);
  }
  return kept;
}

// Legacy Collection-scoped resolution (predates direct-Event support). Preserves the
// pre-existing mkdir -p auto-create side effect in _doImportPlain — not extended to the
// tree-driven scope below, which requires the destination Collection to already exist.
async function _resolveLegacyCollectionUnits(transferRoot, mainArchiveRoot, collectionPaths) {
  const resolvedUnits = [];
  for (const collPath of collectionPaths) {
    const collName = path.basename(collPath);
    let collEntries;
    try { collEntries = await fsp.readdir(collPath, { withFileTypes: true }); } catch { continue; }
    for (const entry of collEntries) {
      if (!entry.isDirectory() || _skipDir(entry.name)) continue;
      resolvedUnits.push({
        srcDir:             path.join(collPath, entry.name),
        destDir:            path.join(mainArchiveRoot, collName, entry.name),
        rootFilesOnly:      false,
        sourceType:         'collection-event',
        collectionKey:      collName,
        eventKey:           `${collName}/${entry.name}`,
        destinationStatus:  'resolved',
        destinationReason:  null,
      });
    }
  }
  return { resolvedUnits, unresolvedUnits: [] };
}

async function _resolveImportUnits(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn) {
  const {
    folderPaths = [], eventRootPaths = [], externalPaths = [], collectionPaths = [], filePaths = [],
  } = scope || {};

  if (folderPaths.length === 0 && eventRootPaths.length === 0 && externalPaths.length === 0 &&
      filePaths.length === 0 && collectionPaths.length > 0) {
    return _resolveLegacyCollectionUnits(transferRoot, mainArchiveRoot, collectionPaths);
  }

  const destCaches   = { checkpoint: undefined, archiveIndex: null };
  const topInfoCache = new Map(); // topName -> { eventData, hasEventChildren }
  const resolvedUnits   = [];
  const unresolvedUnits = [];

  async function topInfo(topName) {
    if (topInfoCache.has(topName)) return topInfoCache.get(topName);
    const topPath   = path.join(transferRoot, topName);
    const eventData = await _readValidEventJson(topPath, isValidEventJsonFn);
    let hasEventChildren = false;
    if (!eventData) {
      let children;
      try { children = await fsp.readdir(topPath, { withFileTypes: true }); } catch { children = []; }
      for (const c of children) {
        if (!c.isDirectory() || _skipDir(c.name)) continue;
        if (await _readValidEventJson(path.join(topPath, c.name), isValidEventJsonFn)) { hasEventChildren = true; break; }
      }
    }
    const info = { eventData, hasEventChildren };
    topInfoCache.set(topName, info);
    return info;
  }

  // `isFile` is handled uniformly across every branch below, rather than as a separate
  // resolver, precisely because a file nested inside a direct Event or a Collection-shaped
  // folder must go through the SAME archive-aware/name-based destination math as its
  // enclosing folder — a file's destination is never computed independently of the rules
  // that already govern where its parent lands. Below the Event level (or anywhere under a
  // folder with no Event at all), that math is already correct for arbitrary depth, since
  // `rel`/`restRel` naturally carry the full relative path including the filename.
  async function resolveOne(absPath, rootFilesOnly, isExternal, isFile = false) {
    const rel     = path.relative(transferRoot, absPath);
    const parts   = rel.split(path.sep);
    const topName = parts[0];
    const info    = await topInfo(topName);

    if (info.eventData) {
      const dest = await _resolveEventDestination(transferRoot, mainArchiveRoot, topName, info.eventData, isValidEventJsonFn, destCaches);
      if (dest.destinationStatus !== 'resolved') {
        unresolvedUnits.push({ path: absPath, name: topName, reason: dest.destinationReason });
        return;
      }
      const restRel = parts.slice(1).join(path.sep);
      resolvedUnits.push({
        srcDir:             absPath,
        destDir:            restRel ? path.join(dest.destDir, restRel) : dest.destDir,
        rootFilesOnly, isFile,
        sourceType:         'direct-event',
        collectionKey:      dest.collectionKey,
        eventKey:           topName,
        destinationStatus:  'resolved',
        destinationReason:  dest.destinationReason,
      });
      return;
    }

    if (!info.hasEventChildren) {
      if (isExternal) {
        // A non-Event sibling folder inside a Collection-shaped parent — kept as 'external'
        // (an existing, archive-aware concept: it rides along with its Collection's destination,
        // not a standalone general-purpose transfer unit).
        resolvedUnits.push({
          srcDir: absPath, destDir: path.join(mainArchiveRoot, rel), rootFilesOnly, isFile,
          sourceType: 'external', collectionKey: topName, eventKey: parts[0],
          destinationStatus: 'resolved', destinationReason: null,
        });
        return;
      }
      // General-purpose transfer: no Event anywhere under this top-level folder — it is not
      // AutoIngest archive content at all (a legacy year folder, a VHS lot, a recovered-files
      // dump), so it is never reinterpreted as a Collection or Event, never given an event.json,
      // never fed into archive-identity resolution. It is an ordinary folder/file, copied to
      // the same deterministic, name-preserving destination (mainArchiveRoot/<relative path>)
      // every other unit here already uses — not a guess, since the name and position IS the
      // destination. Handled as its own unit — never swept into a sibling's rootFilesOnly walk —
      // so selecting one file never pulls in unselected siblings.
      resolvedUnits.push({
        srcDir:             absPath,
        destDir:            path.join(mainArchiveRoot, rel),
        rootFilesOnly, isFile,
        sourceType:         isFile ? 'generic-file' : 'generic-folder',
        collectionKey:      null,
        eventKey:           null,
        destinationStatus:  'resolved',
        destinationReason:  null,
      });
      return;
    }

    // See scanImportTree's identical check for the full DEC-012 reasoning: a Collection-shaped
    // folder names its own destination deterministically (the folder name itself), so a
    // missing destination Collection is a normal "will be created" outcome, not an unresolved
    // one — never a guess, since there is exactly one candidate. The destination directory is
    // created on demand, idempotently, by the copy functions below; nothing is created here.
    const collState = await _checkDestinationCollectionState(mainArchiveRoot, topName);
    if (collState === 'unknown' || collState === 'occupied') {
      // A failed lookup or a name occupied by a non-directory is never evidence of absence —
      // kept out of both the "confirmed new" and "confirmed existing" buckets, same as
      // scanImportTree's identical branch.
      unresolvedUnits.push({
        path: absPath, name: topName,
        reason: collState === 'occupied' ? 'destination-name-conflict' : 'destination-lookup-failed',
      });
      return;
    }
    const collectionExists = collState === 'exists';

    resolvedUnits.push({
      srcDir:             absPath,
      destDir:            path.join(mainArchiveRoot, rel),
      rootFilesOnly, isFile,
      sourceType:         'collection-event',
      collectionKey:      topName,
      eventKey:           parts.length > 1 ? `${parts[0]}/${parts[1]}` : parts[0],
      destinationStatus:  'resolved',
      destinationReason:  collectionExists ? null : 'new-collection',
      isNewCollection:    !collectionExists,
    });
  }

  for (const p of folderPaths)    await resolveOne(p, false, false);
  for (const p of eventRootPaths) await resolveOne(p, true,  false);
  for (const p of externalPaths)  await resolveOne(p, false, true);
  for (const p of filePaths)      await resolveOne(p, false, false, true);

  return { resolvedUnits: _dedupResolvedUnits(resolvedUnits), unresolvedUnits };
}

function _scopePaths(scope) {
  return [
    ...(scope?.folderPaths     || []),
    ...(scope?.eventRootPaths  || []),
    ...(scope?.externalPaths   || []),
    ...(scope?.collectionPaths || []),
    ...(scope?.filePaths       || []),
  ];
}

// ── Shared file-inventory scanner + scan fingerprint ──────────────────────────

async function _scanUnitsInventory(resolvedUnits) {
  const entries = [];
  const groups  = { newFiles: 0, alreadyImported: 0, changed: 0, errors: 0 };
  let newBytes  = 0;

  async function walk(unitSrcDir, unitDestDir, rootFilesOnly, srcDir, destDir) {
    let dirEntries;
    try { dirEntries = await fsp.readdir(srcDir, { withFileTypes: true }); } catch (e) {
      groups.errors++;
      entries.push({ unitSrcDir, unitDestDir, rootFilesOnly, relativeFilePath: path.relative(unitSrcDir, srcDir) || '.', sourceSize: 0, destinationState: 'error', destinationSize: null });
      return;
    }
    for (const entry of dirEntries) {
      if (entry.isDirectory()) {
        if (_skipDir(entry.name) || rootFilesOnly) continue;
        await walk(unitSrcDir, unitDestDir, rootFilesOnly, path.join(srcDir, entry.name), path.join(destDir, entry.name));
      } else if (entry.isFile()) {
        if (_skipFile(entry.name)) continue;
        const srcPath = path.join(srcDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        const relativeFilePath = path.relative(unitSrcDir, srcPath);

        let srcStat;
        try { srcStat = await fsp.stat(srcPath); } catch {
          groups.errors++;
          entries.push({ unitSrcDir, unitDestDir, rootFilesOnly, relativeFilePath, sourceSize: 0, destinationState: 'error', destinationSize: null });
          continue;
        }
        let destStat = null;
        try { destStat = await fsp.stat(destPath); } catch {}

        let destinationState, destinationSize;
        if (!destStat) {
          destinationState = 'missing'; destinationSize = null;
          groups.newFiles++; newBytes += srcStat.size;
        } else if (destStat.size === srcStat.size) {
          destinationState = 'same-size'; destinationSize = destStat.size;
          groups.alreadyImported++;
        } else {
          destinationState = 'changed-size'; destinationSize = destStat.size;
          groups.changed++;
        }

        entries.push({ unitSrcDir, unitDestDir, rootFilesOnly, relativeFilePath, sourceSize: srcStat.size, destinationState, destinationSize });
      }
    }
  }

  // A file-shaped unit (unit.isFile) is a single leaf, never a directory to readdir() —
  // inventory it directly via one stat, same destination-state rules as any other file.
  async function walkFile(unit) {
    let srcStat;
    try { srcStat = await fsp.stat(unit.srcDir); } catch {
      groups.errors++;
      entries.push({ unitSrcDir: unit.srcDir, unitDestDir: unit.destDir, rootFilesOnly: false, relativeFilePath: '.', sourceSize: 0, destinationState: 'error', destinationSize: null });
      return;
    }
    let destStat = null;
    try { destStat = await fsp.stat(unit.destDir); } catch {}

    let destinationState, destinationSize;
    if (!destStat) {
      destinationState = 'missing'; destinationSize = null;
      groups.newFiles++; newBytes += srcStat.size;
    } else if (destStat.size === srcStat.size) {
      destinationState = 'same-size'; destinationSize = destStat.size;
      groups.alreadyImported++;
    } else {
      destinationState = 'changed-size'; destinationSize = destStat.size;
      groups.changed++;
    }
    entries.push({ unitSrcDir: unit.srcDir, unitDestDir: unit.destDir, rootFilesOnly: false, relativeFilePath: '.', sourceSize: srcStat.size, destinationState, destinationSize });
  }

  for (const unit of resolvedUnits) {
    if (unit.isFile) await walkFile(unit);
    else await walk(unit.srcDir, unit.destDir, unit.rootFilesOnly, unit.srcDir, unit.destDir);
  }

  return { entries, groups, newBytes };
}

// Covers the file inventory, not just destination resolution — any file added, removed,
// resized, or renamed on either side of a unit shows up as a different fingerprint.
function _computeScanFingerprint({ transferRoot, mainArchiveRoot, scope, resolvedUnits, unresolvedUnits, inventoryEntries }) {
  const normalizedScope = {
    folderPaths:     [...(scope?.folderPaths     || [])].sort(),
    eventRootPaths:  [...(scope?.eventRootPaths  || [])].sort(),
    externalPaths:   [...(scope?.externalPaths   || [])].sort(),
    collectionPaths: [...(scope?.collectionPaths || [])].sort(),
    filePaths:       [...(scope?.filePaths       || [])].sort(),
  };
  const unitsSummary = resolvedUnits
    .map(u => ({ srcDir: u.srcDir, destDir: u.destDir, sourceType: u.sourceType, collectionKey: u.collectionKey, eventKey: u.eventKey, destinationReason: u.destinationReason }))
    .sort((a, b) => a.srcDir.localeCompare(b.srcDir));
  const unresolvedSummary = unresolvedUnits
    .map(u => ({ path: u.path, reason: u.reason }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const entriesSummary = inventoryEntries
    .map(e => ({ unitSrcDir: e.unitSrcDir, relativeFilePath: e.relativeFilePath, sourceSize: e.sourceSize, destinationState: e.destinationState, destinationSize: e.destinationSize }))
    .sort((a, b) => (a.unitSrcDir + '\0' + a.relativeFilePath).localeCompare(b.unitSrcDir + '\0' + b.relativeFilePath));

  const canonical = JSON.stringify({ transferRoot, mainArchiveRoot, normalizedScope, unitsSummary, unresolvedSummary, entriesSummary });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

// ── Import execution ──────────────────────────────────────────────────────────

async function _finishImport(transferRoot, mainArchiveRoot, meta, startedAt, batches, stats, mode) {
  const completedAt = new Date().toISOString();
  const neverAttempted = stats.neverAttempted || 0;
  const errorsCapped   = stats.errors.length >= MAX_ERRORS;
  const succeeded      = stats.copied + stats.skipped + stats.renamed + (stats.changedSkipped || 0);
  // 'failed' — the error cap or a uniform failure (e.g. an unwritable destination) meant
  // NOTHING landed on disk; never silently reported as a routine "completed with errors".
  // 'partial' — some files succeeded, some failed. 'ok' — no errors at all.
  const finalStatus = stats.errors.length === 0
    ? 'ok'
    : (succeeded === 0 ? 'failed' : 'partial');

  // When every recorded error shares the same OS error code, this was one underlying
  // problem repeated, not many unrelated file issues — classify it so the operator sees
  // the real cause (e.g. "permission-denied") instead of a generic unwritable-destination
  // guess. A mixed set of codes is left unclassified; that's genuinely ambiguous.
  let uniformErrorCode = null;
  if (stats.errors.length > 0) {
    const codes = new Set(stats.errors.map(e => e.code || null));
    if (codes.size === 1) {
      const [only] = codes;
      if (only) uniformErrorCode = only;
    }
  }
  const uniformErrorReason = uniformErrorCode ? _classifyFsErrorCode(uniformErrorCode) : null;

  await _writeCheckpoint(mainArchiveRoot, {
    importId: meta.batchId, transferRoot, mainArchiveRoot, mode,
    scope: meta.scope, createdAt: startedAt, completedAt, status: 'complete',
    batches,
    totalFiles:          _state.total,
    totalCopied:         stats.copied,
    totalSkipped:        stats.skipped,
    totalRenamed:        stats.renamed,
    totalChangedSkipped: stats.changedSkipped || 0,
    totalErrors:         stats.errors.length,
    totalNeverAttempted: neverAttempted,
  });

  const auditEntry = {
    batchId: meta.batchId, transferRoot, mainArchiveRoot, mode,
    scope: meta.scope, operatorName: meta.operatorName || null, deviceName: meta.deviceName,
    startedAt, completedAt,
    copied: stats.copied, skipped: stats.skipped, renamed: stats.renamed,
    changedSkipped: stats.changedSkipped || 0, errorCount: stats.errors.length, status: finalStatus,
    neverAttempted, errorsCapped, uniformErrorCode, uniformErrorReason,
  };
  try {
    const auditDir = path.join(mainArchiveRoot, '.autoingest', 'transfer-imports');
    await fsp.mkdir(auditDir, { recursive: true });
    await fsp.appendFile(path.join(auditDir, 'imports.audit.jsonl'), JSON.stringify(auditEntry) + '\n', 'utf8');
  } catch (e) {
    console.error('[transferImport] audit write failed:', e.message);
  }

  _state.running        = false;
  _state.paused         = false;
  _state.copied         = stats.copied;
  _state.skipped        = stats.skipped;
  _state.renamed        = stats.renamed;
  _state.changedSkipped = stats.changedSkipped || 0;
  _state.errors         = [...stats.errors];
  _state.neverAttempted = neverAttempted;
  _state.result = {
    ok: true, batchId: meta.batchId,
    copied: stats.copied, skipped: stats.skipped, renamed: stats.renamed,
    changedSkipped: stats.changedSkipped || 0,
    errorCount: stats.errors.length, startedAt, completedAt, status: finalStatus,
    neverAttempted, errorsCapped, uniformErrorCode, uniformErrorReason,
  };

  // Fire-and-forget completion signal for main.js's IPC layer to orchestrate
  // post-transfer metadata verification (plan §7). This module never verifies or
  // queues metadata itself — it only announces "this batch finished" and hands back
  // its own id, mirroring the additive, decision-free nature of the outcome manifest.
  if (typeof meta.onComplete === 'function') {
    try { meta.onComplete(_state.result); } catch (e) { console.error('[transferImport] onComplete callback failed:', e.message); }
  }
}

/**
 * Reads a batch's per-file outcome manifest (plan §7). Returns [] if the batch never
 * wrote one (e.g. nothing was copied) or the file is missing/corrupt.
 * @param {string} mainArchiveRoot
 * @param {string} batchId
 * @returns {Promise<Array<{batchId:string, transferRootIdentity:string|null, eventPath:string|null, srcRelPath:string, destPath:string, outcome:string}>>}
 */
async function readTransferOutcomes(mainArchiveRoot, batchId) {
  let raw;
  try {
    raw = await fsp.readFile(_transferOutcomesPath(mainArchiveRoot, batchId), 'utf8');
  } catch {
    return [];
  }
  const entries = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* corrupt line — skip, not fatal for a read-only consumer */ }
  }
  return entries;
}

// Plain Import — unchanged from prior behaviour: live recursive walk, same-size skip,
// diff-size safe rename with _1/_2.
async function _doImportPlain(transferRoot, mainArchiveRoot, resolvedUnits, meta, resumeBatches) {
  const startedAt = new Date().toISOString();

  let batches;
  if (resumeBatches) {
    batches = resumeBatches;
    _state.total      = batches.reduce((s, b) => s + (b.fileCount || 0), 0);
    _state.batchCount = batches.length;
  } else {
    batches = resolvedUnits.map((u, idx) => ({
      batchIdx:   idx,
      batchLabel: path.relative(transferRoot, u.srcDir).split(path.sep).join(' / '),
      srcDir: u.srcDir, destDir: u.destDir, rootFilesOnly: !!u.rootFilesOnly, isFile: !!u.isFile,
      fileCount: 0, status: 'pending',
      copied: 0, skipped: 0, renamed: 0, errors: 0,
    }));
    let totalFiles = 0;
    for (const batch of batches) {
      // A file-shaped unit (batch.isFile) is a single leaf — never readdir()'d as a directory.
      batch.fileCount = batch.isFile ? 1 : await _countFiles(batch.srcDir, { rootFilesOnly: batch.rootFilesOnly });
      totalFiles += batch.fileCount;
    }
    _state.total      = totalFiles;
    _state.batchCount = batches.length;
  }

  await _writeCheckpoint(mainArchiveRoot, {
    importId: meta.batchId, transferRoot, mainArchiveRoot, mode: 'plain',
    scope: meta.scope, createdAt: startedAt, status: 'running',
    batches, currentBatchIdx: 0,
    totalFiles: _state.total, totalCopied: 0, totalSkipped: 0, totalRenamed: 0, totalChangedSkipped: 0, totalErrors: 0,
  });

  const stats = { copied: 0, skipped: 0, renamed: 0, changedSkipped: 0, copiedBytes: 0, errors: [], neverAttempted: 0 };
  const transferRootIdentity = await _readTransferRootIdentity(transferRoot);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    if (batch.status === 'complete') continue;

    await _waitIfPaused();
    if (!_state.running) break;

    batch.status      = 'importing';
    _state.batchIndex = i;
    _state.batchName  = batch.batchLabel;

    const outcomeCtx = { batchId: meta.batchId, transferRoot, mainArchiveRoot, transferRootIdentity, eventPath: batch.destDir };
    const before = { copied: stats.copied, skipped: stats.skipped, renamed: stats.renamed, errors: stats.errors.length };
    if (batch.isFile) {
      // A single ordinary file at the Transfer Drive root — destDir IS the destination file
      // path, so only its parent directory is created, never a directory at destDir itself.
      try { await fsp.mkdir(path.dirname(batch.destDir), { recursive: true }); } catch {}
      _state.current = path.basename(batch.srcDir);
      try { await _copyFileSafe(batch.srcDir, batch.destDir, stats, { outcomeCtx }); }
      catch (e) { stats.errors.push({ file: batch.srcDir, error: e.message, code: e.code || null }); }
    } else {
      try { await fsp.mkdir(batch.destDir, { recursive: true }); } catch {}
      await _walkAndCopy(batch.srcDir, batch.destDir, stats, { rootFilesOnly: batch.rootFilesOnly, outcomeCtx });
    }
    batch.copied  = stats.copied  - before.copied;
    batch.skipped = stats.skipped - before.skipped;
    batch.renamed = stats.renamed - before.renamed;
    batch.errors  = stats.errors.length - before.errors;
    batch.status  = 'complete';

    await _writeCheckpoint(mainArchiveRoot, {
      importId: meta.batchId, transferRoot, mainArchiveRoot, mode: 'plain',
      scope: meta.scope, createdAt: startedAt, status: _state.paused ? 'paused' : 'running',
      batches, currentBatchIdx: i,
      totalFiles: _state.total, totalCopied: stats.copied, totalSkipped: stats.skipped,
      totalRenamed: stats.renamed, totalChangedSkipped: 0, totalErrors: stats.errors.length,
    });
  }

  await _finishImport(transferRoot, mainArchiveRoot, meta, startedAt, batches, stats, 'plain');
}

// Update Import — worklist-driven: copies exactly the files the reviewed Scan classified as
// 'missing', never a fresh unrestricted recursive walk. changed/alreadyImported counts come
// from the inventory snapshot, not from re-deciding per file during copy.
async function _doImportUpdate(transferRoot, mainArchiveRoot, resolvedUnits, inventoryEntries, meta, resumeBatches) {
  const startedAt = new Date().toISOString();

  let batches;
  let seedSkipped = 0;
  let seedChanged = 0;

  if (resumeBatches) {
    batches      = resumeBatches;
    _state.total = batches.reduce((s, b) => s + (b.fileList ? b.fileList.length : 0), 0);
    _state.batchCount = batches.length;
    seedSkipped = 0; // checkpoint totals already reflect prior progress; restored below.
  } else {
    const byUnit = new Map();
    for (const e of inventoryEntries) {
      if (e.destinationState !== 'missing') continue;
      const list = byUnit.get(e.unitSrcDir) || [];
      list.push({
        relativeFilePath: e.relativeFilePath,
        srcPath:  path.join(e.unitSrcDir, e.relativeFilePath),
        destPath: path.join(e.unitDestDir, e.relativeFilePath),
        sourceSize: e.sourceSize,
      });
      byUnit.set(e.unitSrcDir, list);
    }

    batches = resolvedUnits.map((u, idx) => ({
      batchIdx:   idx,
      batchLabel: path.relative(transferRoot, u.srcDir).split(path.sep).join(' / '),
      srcDir: u.srcDir, destDir: u.destDir, rootFilesOnly: !!u.rootFilesOnly, isFile: !!u.isFile,
      fileList: byUnit.get(u.srcDir) || [],
      status: 'pending', copied: 0, errors: 0,
    }));
    _state.total       = batches.reduce((s, b) => s + b.fileList.length, 0);
    _state.batchCount  = batches.length;
    seedSkipped = inventoryEntries.filter(e => e.destinationState === 'same-size').length;
    seedChanged = inventoryEntries.filter(e => e.destinationState === 'changed-size').length;
  }

  const stats = {
    copied: 0,
    skipped: resumeBatches ? 0 : seedSkipped,
    renamed: 0,
    changedSkipped: resumeBatches ? 0 : seedChanged,
    copiedBytes: 0, errors: [], neverAttempted: 0,
  };
  _state.skipped        = stats.skipped;
  _state.changedSkipped = stats.changedSkipped;

  const transferRootIdentity = await _readTransferRootIdentity(transferRoot);

  if (!resumeBatches) {
    await _writeCheckpoint(mainArchiveRoot, {
      importId: meta.batchId, transferRoot, mainArchiveRoot, mode: 'update',
      scope: meta.scope, createdAt: startedAt, status: 'running',
      batches, currentBatchIdx: 0,
      totalFiles: _state.total, totalCopied: 0, totalSkipped: stats.skipped,
      totalRenamed: 0, totalChangedSkipped: stats.changedSkipped, totalErrors: 0,
    });

    // Pre-classified same-size / changed-size files (from the Scan's inventory
    // snapshot) never go through _copyFileSafe in Update Import — record their
    // outcome here so the verification step can still see them.
    for (const e of inventoryEntries) {
      if (e.destinationState !== 'same-size' && e.destinationState !== 'changed-size') continue;
      const unit = resolvedUnits.find(u => u.srcDir === e.unitSrcDir);
      await _recordTransferOutcome(
        { batchId: meta.batchId, transferRoot, mainArchiveRoot, transferRootIdentity, eventPath: unit?.destDir || null },
        e.destinationState === 'same-size' ? 'same-size-skipped' : 'changed-skipped',
        path.join(e.unitSrcDir, e.relativeFilePath), path.join(e.unitDestDir, e.relativeFilePath)
      );
    }
  }

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    if (batch.status === 'complete') continue;

    await _waitIfPaused();
    if (!_state.running) break;

    batch.status      = 'importing';
    _state.batchIndex = i;
    _state.batchName  = batch.batchLabel;

    // batch.destDir is an exact destination FILE path for a file-shaped unit — only its
    // parent directory is created, same as _doImportPlain's equivalent branch.
    try { await fsp.mkdir(batch.isFile ? path.dirname(batch.destDir) : batch.destDir, { recursive: true }); } catch {}

    const outcomeCtx = { batchId: meta.batchId, transferRoot, mainArchiveRoot, transferRootIdentity, eventPath: batch.destDir };
    const before = { copied: stats.copied, errors: stats.errors.length };
    for (let fi = 0; fi < batch.fileList.length; fi++) {
      if (stats.errors.length >= MAX_ERRORS) {
        // Same rule as _walkAndCopy: the error cap stops attempts, not just display. Every
        // remaining file in this batch is counted explicitly as never attempted rather than
        // silently vanishing from copied+skipped+renamed+errors.
        stats.neverAttempted = (stats.neverAttempted || 0) + (batch.fileList.length - fi);
        _state.neverAttempted = stats.neverAttempted;
        break;
      }
      const f = batch.fileList[fi];
      await _waitIfPaused();
      _state.current = path.basename(f.srcPath);
      try {
        await _copyFileSafe(f.srcPath, f.destPath, stats, { backupUpdate: true, outcomeCtx });
      } catch (e) {
        stats.errors.push({ file: f.srcPath, error: e.message, code: e.code || null });
      }
      _state.copied         = stats.copied;
      _state.skipped        = stats.skipped;
      _state.changedSkipped = stats.changedSkipped;
      _state.errors         = [...stats.errors];
      _state.copiedBytes    = stats.copiedBytes || 0;
    }
    batch.copied = stats.copied - before.copied;
    batch.errors = stats.errors.length - before.errors;
    batch.status = 'complete';

    await _writeCheckpoint(mainArchiveRoot, {
      importId: meta.batchId, transferRoot, mainArchiveRoot, mode: 'update',
      scope: meta.scope, createdAt: startedAt, status: _state.paused ? 'paused' : 'running',
      batches, currentBatchIdx: i,
      totalFiles: _state.total, totalCopied: stats.copied, totalSkipped: stats.skipped,
      totalRenamed: stats.renamed, totalChangedSkipped: stats.changedSkipped, totalErrors: stats.errors.length,
    });
  }

  await _finishImport(transferRoot, mainArchiveRoot, meta, startedAt, batches, stats, 'update');
}

// ── Public API ────────────────────────────────────────────────────────────────

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

async function previewImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn) {
  if (!transferRoot || !mainArchiveRoot) return { ok: false, reason: 'missing-roots' };
  if (transferRoot === mainArchiveRoot ||
      _isInsideDir(transferRoot, mainArchiveRoot) ||
      _isInsideDir(mainArchiveRoot, transferRoot)) {
    return { ok: false, reason: 'roots-overlap' };
  }
  const hasNewScope    = (scope?.folderPaths?.length > 0) || (scope?.eventRootPaths?.length > 0) || (scope?.externalPaths?.length > 0) || (scope?.filePaths?.length > 0);
  const hasLegacyScope = scope?.collectionPaths?.length > 0;
  if (!scope || (!hasNewScope && !hasLegacyScope)) {
    return { ok: false, reason: 'empty-scope' };
  }
  for (const p of _scopePaths(scope)) {
    if (!_isInsideDir(transferRoot, p)) {
      return { ok: false, reason: 'scope-outside-transfer-root', path: p };
    }
  }

  const { resolvedUnits, unresolvedUnits } = await _resolveImportUnits(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn);

  const collectionSet = new Set();
  const eventSet      = new Set();
  let externalFolders = 0, folders = 0, files = 0, genericItems = 0;

  for (const unit of resolvedUnits) {
    if (unit.sourceType === 'generic-folder' || unit.sourceType === 'generic-file') {
      genericItems++;
      if (!unit.isFile) folders++;
    } else if (unit.sourceType === 'external') {
      externalFolders++;
    } else {
      if (unit.collectionKey) collectionSet.add(unit.collectionKey);
      eventSet.add(unit.eventKey);
      if (!unit.rootFilesOnly) folders++;
    }
    files += unit.isFile ? 1 : await _countFiles(unit.srcDir, { rootFilesOnly: unit.rootFilesOnly });
  }

  return {
    ok: true, transferRoot, mainArchiveRoot, scope,
    collections: collectionSet.size, events: eventSet.size, externalFolders, folders, files, genericItems,
    unresolvedCount: unresolvedUnits.length,
    unresolvedItems: unresolvedUnits.map(u => ({ path: u.path, name: u.name, reason: u.reason })),
  };
}

async function runImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn, meta = {}) {
  if (_state.running) return { ok: false, reason: 'busy' };
  if (!transferRoot || !mainArchiveRoot) return { ok: false, reason: 'missing-roots' };
  if (transferRoot === mainArchiveRoot ||
      _isInsideDir(transferRoot, mainArchiveRoot) ||
      _isInsideDir(mainArchiveRoot, transferRoot)) {
    return { ok: false, reason: 'roots-overlap' };
  }
  const hasNewScope    = (scope?.folderPaths?.length > 0) || (scope?.eventRootPaths?.length > 0) || (scope?.externalPaths?.length > 0) || (scope?.filePaths?.length > 0);
  const hasLegacyScope = scope?.collectionPaths?.length > 0;
  if (!scope || (!hasNewScope && !hasLegacyScope)) {
    return { ok: false, reason: 'empty-scope' };
  }
  for (const p of _scopePaths(scope)) {
    if (!_isInsideDir(transferRoot, p)) {
      return { ok: false, reason: 'scope-outside-transfer-root', path: p };
    }
  }

  const isUpdate = !!scope.backupUpdate;
  if (isUpdate && !scope.expectedFingerprint) {
    return { ok: false, reason: 'missing-fingerprint' };
  }

  // Fail fast with the real OS error, before resolving units or starting the batch loop —
  // never let a destination that is unreachable from the first file onward burn through
  // MAX_ERRORS identical failures first (see _checkDestinationReachable).
  const reach = await _checkDestinationReachable(mainArchiveRoot);
  if (!reach.ok) {
    return { ok: false, reason: 'destination-unreachable', detail: reach.reason, code: reach.code, message: reach.message };
  }

  const { resolvedUnits, unresolvedUnits } = await _resolveImportUnits(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn);
  if (resolvedUnits.length === 0) return { ok: false, reason: 'empty-scope' };

  let inventoryEntries = null;
  if (isUpdate) {
    const inv = await _scanUnitsInventory(resolvedUnits);
    inventoryEntries = inv.entries;
    const freshFingerprint = _computeScanFingerprint({ transferRoot, mainArchiveRoot, scope, resolvedUnits, unresolvedUnits, inventoryEntries });
    if (freshFingerprint !== scope.expectedFingerprint) {
      return { ok: false, reason: 'scan-stale' };
    }
  }

  const batchId    = crypto.randomBytes(8).toString('hex');
  const deviceName = meta.deviceName || os.hostname();

  _isPaused       = false;
  _pauseResolvers = [];
  _checkpointFailureLoggedThisRun = false;

  _state = {
    running: true, paused: false, batchId,
    batchIndex: 0, batchCount: 0, batchName: '',
    current: '', copied: 0, skipped: 0, renamed: 0, changedSkipped: 0, errors: [],
    copiedBytes: 0, neverAttempted: 0, total: 0, result: null,
    verifyStatus: null, verifyTotal: 0, verifyDone: 0, verifyFailed: 0,
    checkpointHealthy: true, checkpointError: null,
  };

  const runMeta = { ...meta, batchId, deviceName, scope };

  const runner = isUpdate
    ? _doImportUpdate(transferRoot, mainArchiveRoot, resolvedUnits, inventoryEntries, runMeta, null)
    : _doImportPlain(transferRoot, mainArchiveRoot, resolvedUnits, runMeta, null);

  runner.catch(e => {
    _state.running = false;
    _state.result  = { ok: false, reason: 'unexpected-error', error: e.message, completedAt: new Date().toISOString() };
  });

  return { ok: true, batchId };
}

async function resumeImportFromCheckpoint(transferRoot, mainArchiveRoot, meta = {}) {
  if (_state.running) return { ok: false, reason: 'busy' };

  const checkpoint = await _readCheckpoint(mainArchiveRoot);
  if (!checkpoint)                              return { ok: false, reason: 'no-checkpoint' };
  if (checkpoint.transferRoot !== transferRoot) return { ok: false, reason: 'checkpoint-mismatch' };
  if (checkpoint.status === 'complete')         return { ok: false, reason: 'already-complete' };
  if (!Array.isArray(checkpoint.batches))       return { ok: false, reason: 'checkpoint-invalid' };

  const reach = await _checkDestinationReachable(mainArchiveRoot);
  if (!reach.ok) {
    return { ok: false, reason: 'destination-unreachable', detail: reach.reason, code: reach.code, message: reach.message };
  }

  const batchId    = checkpoint.importId;
  const deviceName = meta.deviceName || os.hostname();
  const isUpdate   = checkpoint.mode === 'update';

  _isPaused       = false;
  _pauseResolvers = [];
  _checkpointFailureLoggedThisRun = false;

  _state = {
    running: true, paused: false, batchId,
    batchIndex:     checkpoint.currentBatchIdx || 0,
    batchCount:     checkpoint.batches.length,
    batchName:      '',
    current:        '',
    copied:         checkpoint.totalCopied         || 0,
    skipped:        checkpoint.totalSkipped        || 0,
    renamed:        checkpoint.totalRenamed        || 0,
    changedSkipped: checkpoint.totalChangedSkipped || 0,
    errors:         [],
    copiedBytes:    0,
    neverAttempted: checkpoint.totalNeverAttempted || 0,
    total:          checkpoint.totalFiles || 0,
    result:         null,
    verifyStatus: null, verifyTotal: 0, verifyDone: 0, verifyFailed: 0,
    checkpointHealthy: true, checkpointError: null,
  };

  const runMeta = { ...meta, batchId, deviceName, scope: checkpoint.scope };

  const runner = isUpdate
    ? _doImportUpdate(transferRoot, mainArchiveRoot, null, null, runMeta, checkpoint.batches)
    : _doImportPlain(transferRoot, mainArchiveRoot, null, runMeta, checkpoint.batches);

  runner.catch(e => {
    _state.running = false;
    _state.result  = { ok: false, reason: 'unexpected-error', error: e.message, completedAt: new Date().toISOString() };
  });

  return { ok: true, batchId, resuming: true };
}

async function scanImportSync(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn) {
  if (!transferRoot || !mainArchiveRoot) return { ok: false, reason: 'missing-roots' };
  if (transferRoot === mainArchiveRoot ||
      _isInsideDir(transferRoot, mainArchiveRoot) ||
      _isInsideDir(mainArchiveRoot, transferRoot)) {
    return { ok: false, reason: 'roots-overlap' };
  }
  const hasNewScope = (scope?.folderPaths?.length > 0) || (scope?.eventRootPaths?.length > 0) || (scope?.externalPaths?.length > 0) || (scope?.filePaths?.length > 0);
  if (!scope || !hasNewScope) return { ok: false, reason: 'empty-scope' };
  for (const p of _scopePaths(scope)) {
    if (!_isInsideDir(transferRoot, p)) {
      return { ok: false, reason: 'scope-outside-transfer-root', path: p };
    }
  }

  const { resolvedUnits, unresolvedUnits } = await _resolveImportUnits(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn);
  if (resolvedUnits.length === 0 && unresolvedUnits.length === 0) return { ok: false, reason: 'empty-scope' };

  const { entries, groups, newBytes } = await _scanUnitsInventory(resolvedUnits);

  const collectionSet = new Set();
  const eventSet      = new Set();
  let externalFolders = 0, genericItems = 0;
  for (const unit of resolvedUnits) {
    if (unit.sourceType === 'generic-folder' || unit.sourceType === 'generic-file') genericItems++;
    else if (unit.sourceType === 'external') externalFolders++;
    else {
      if (unit.collectionKey) collectionSet.add(unit.collectionKey);
      eventSet.add(unit.eventKey);
    }
  }

  const folderStats = {};
  for (const e of entries) {
    if (!folderStats[e.unitSrcDir]) folderStats[e.unitSrcDir] = { new: 0, same: 0, changed: 0 };
    if      (e.destinationState === 'missing')      folderStats[e.unitSrcDir].new++;
    else if (e.destinationState === 'same-size')    folderStats[e.unitSrcDir].same++;
    else if (e.destinationState === 'changed-size') folderStats[e.unitSrcDir].changed++;
  }

  const scanFingerprint = _computeScanFingerprint({ transferRoot, mainArchiveRoot, scope, resolvedUnits, unresolvedUnits, inventoryEntries: entries });

  return {
    ok: true,
    totals: {
      collections: collectionSet.size, events: eventSet.size, externalFolders, genericItems,
      alreadyImported: groups.alreadyImported, newFiles: groups.newFiles, changed: groups.changed,
      totalFiles: entries.length, newBytes, unresolvedCount: unresolvedUnits.length,
    },
    groups, folderStats,
    unresolvedUnits: unresolvedUnits.map(u => ({ path: u.path, name: u.name, reason: u.reason })),
    scanFingerprint, transferRoot, mainArchiveRoot,
  };
}

async function verifyImport(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn) {
  if (!transferRoot || !mainArchiveRoot || !scope) return { ok: false, reason: 'missing-params' };

  const { resolvedUnits } = await _resolveImportUnits(transferRoot, mainArchiveRoot, scope, isValidEventJsonFn);

  _state.verifyStatus = 'verifying';
  _state.verifyTotal  = 0;
  _state.verifyDone   = 0;
  _state.verifyFailed = 0;

  const results = { verified: 0, failed: 0, missing: 0, errors: [] };

  async function verifyDir(srcDir, destDir, rootFilesOnly) {
    let entries;
    try { entries = await fsp.readdir(srcDir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (_skipDir(entry.name) || rootFilesOnly) continue;
        await verifyDir(path.join(srcDir, entry.name), path.join(destDir, entry.name), false);
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

  // A file-shaped unit (unit.isFile) is a single leaf — verified directly, never readdir()'d.
  async function verifyFile(srcPath, destPath) {
    _state.verifyTotal++;
    let srcStat;
    try { srcStat = await fsp.stat(srcPath); } catch {
      results.missing++; _state.verifyFailed++; _state.verifyDone++;
      return;
    }
    let destStat = null;
    try { destStat = await fsp.stat(destPath); } catch {}
    if (!destStat) {
      results.missing++; _state.verifyFailed++;
      results.errors.push({ file: path.basename(srcPath), reason: 'missing-at-destination' });
      _state.verifyDone++;
      return;
    }
    if (destStat.size !== srcStat.size) {
      results.failed++; _state.verifyFailed++;
      results.errors.push({ file: path.basename(srcPath), reason: 'size-mismatch' });
      _state.verifyDone++;
      return;
    }
    try {
      const [srcHash, destHash] = await Promise.all([_fileHash(srcPath), _fileHash(destPath)]);
      if (srcHash !== destHash) {
        results.failed++; _state.verifyFailed++;
        results.errors.push({ file: path.basename(srcPath), reason: 'hash-mismatch' });
      } else {
        results.verified++;
      }
    } catch (e) {
      results.failed++; _state.verifyFailed++;
      results.errors.push({ file: path.basename(srcPath), reason: e.message });
    }
    _state.verifyDone++;
  }

  for (const unit of resolvedUnits) {
    if (unit.isFile) await verifyFile(unit.srcDir, unit.destDir);
    else await verifyDir(unit.srcDir, unit.destDir, unit.rootFilesOnly);
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
  scanImportTree,
  listGenericFolderChildren,
  previewImport,
  runImport,
  resumeImportFromCheckpoint,
  getImportStatus,
  pauseImport,
  resumeImport,
  getImportCheckpoint,
  clearImportCheckpoint,
  verifyImport,
  scanImportSync,
  readTransferOutcomes,
  // Exported so main.js's IPC layer can check a candidate destination's live reachability
  // (e.g. for the Transfer Import modal's "Change Destination" flow) using the exact same
  // probe runImport()/resumeImportFromCheckpoint() apply internally — never a second,
  // duplicate reachability check reimplemented at the IPC layer.
  checkDestinationReachable: _checkDestinationReachable,
};
