/**
 * photographerLearningRuntime.js — Electron wiring for photographer↔camera learning
 * (AI-FEAT-063, AI-RM-014 Q4c, recovery Q4d). Main process only. main.js calls:
 *   onImportCommitted(ctx)  at the very end of a SUCCESSFUL import:commitTransaction
 *   scheduleRecoveryAfterLaunch()  once at startup: if (and only if) an earlier run left
 *                           learning pending, a bounded recovery pass runs after a delay
 *   shutdown()              from will-quit
 * Nothing is created at launch or on card insert: the registry, its key, the journal and the
 * pending list are created lazily by the first eligible committed import.
 *
 * Camera evidence for the NEWLY COPIED files of a live import, read-only, never guessed:
 *  1. The companion's Q2/Q3 assessment, when EVERY committed file is in a completed job whose
 *     volume identity (dev/ino) still matches and whose recorded size equals the committed
 *     size (path alone is never trusted).
 *  2. Otherwise one bounded, cancellable re-read of exactly the committed source files with
 *     the same Q2/Q3 pipeline (cardAssessmentService: shared ExifTool pool, concurrency 2,
 *     paused while an import/sync/transfer/checksum runs). Never the archive.
 *  3. A source that is gone or unreadable yields "unread" files → incomplete attribution →
 *     no association.
 *     A live import whose source cannot be read stays pending; recovery decides later.
 * Recovery evidence (learningRecoveryEvidence.js): the committed ARCHIVE copies — read when
 * not rewritten since the commit, otherwise the source file only when its image-data hash
 * still equals the archive copy's. Anything else is unread.
 * Never filename prefixes, Artist, Owner, card labels or lens serials (Q3 does not read them).
 */

'use strict';

const path = require('path');
const fs = require('fs');

const MAX_REREAD_FILES = 5000;
const REREAD_CONCURRENCY = 2;
const POLL_MS = 100;
const RECOVERY_CONCURRENCY = 2;
const RECOVERY_LAUNCH_DELAY_MS = 90000;

let _service = null;
let _store = null;
let _fallback = null; // the running re-read assessor, if any

function _deps() {
  const { app } = require('electron');
  const settings = require('./settings');
  const dir = path.join(app.getPath('userData'), 'identity-registry');
  return { app, settings, dir };
}

function _mediaType(file) {
  const cfg = require('../config/app.config');
  const ext = path.extname(file).toLowerCase();
  if (cfg.RAW_EXTENSIONS.includes(ext)) return 'raw';
  if (cfg.VIDEO_EXTENSIONS.includes(ext)) return 'video';
  return 'photo';
}

function _commonDir(paths) {
  const split = paths.map(p => path.dirname(p).split(path.sep));
  const first = split[0];
  let n = first.length;
  for (const s of split) { let i = 0; while (i < n && s[i] === first[i]) i++; n = i; }
  return first.slice(0, n).join(path.sep) || path.sep;
}

const _statMount = (p) => fs.promises.stat(p).then(st => ({ dev: st.dev, ino: st.ino }), () => null);

/** Sizes for every committed file (copied files carry their verified copy size). */
async function _withSizes(files) {
  return Promise.all(files.map(async (f) => {
    if (Number.isFinite(f.size)) return f;
    const st = f.dest ? await fs.promises.stat(f.dest).catch(() => null) : null;
    return { ...f, size: st ? st.size : null };
  }));
}

const _operatorBusy = () => require('./operatorActivity').activeKinds().some(k => k !== 'dialog');

/**
 * Q2/Q3 assessment of exactly `files` (bounded, paused while the operator is busy).
 * Records are keyed by `f.key` (pairing uses its folder and name); tags are read from `f.read`.
 */
async function _assess(files, signal) {
  if (files.length > MAX_REREAD_FILES) return null;
  const { createCardAssessor } = require('./cardAssessmentService');
  const reader = require('./captureDateReader');
  const readPath = new Map(files.map(f => [f.key, f.read]));
  const root = _commonDir(files.map(f => f.key));
  const assessor = createCardAssessor({
    listMedia: async () => files.map(f => ({ path: f.key, name: path.basename(f.key), type: _mediaType(f.key), size: f.size })),
    readTags: (p, type) => reader.readCaptureMetadata(readPath.get(p) || p, type),
    readIdentity: (p) => reader.readIdentityTags(readPath.get(p) || p),
    statMount: _statMount,
    isPaused: _operatorBusy,
    concurrency: REREAD_CONCURRENCY,
  });
  _fallback = assessor;
  const onAbort = () => assessor.shutdown();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    assessor.sync([{ sourceId: 'learning', mountpoint: root, label: 'learning' }]);
    for (;;) {
      const job = assessor.get('learning');
      if (!job || signal.aborted) return null;
      if (job.state === 'complete') return job.records;
      if (job.state === 'error' || job.state === 'cancelled') return null;
      await new Promise(r => setTimeout(r, POLL_MS));
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    assessor.shutdown();
    if (_fallback === assessor) _fallback = null;
  }
}

const _hashIo = () => { const reader = require('./captureDateReader'); return { stat: p => fs.promises.stat(p), imageDataHash: p => reader.readImageDataHash(p) }; };

/** Drops copies that repeat a picture already in the archive (see findDuplicateCaptures). */
async function _withoutDuplicateCaptures(files) {
  const dups = await require('./learningRecoveryEvidence').findDuplicateCaptures(files.filter(f => f.dest), _hashIo()).catch(() => new Set());
  return { fresh: files.filter(f => !dups.has(f.dest)), duplicateCaptures: dups.size };
}

async function _resolveEvidence(allFiles, { signal }) {
  const { fresh: files, duplicateCaptures } = await _withoutDuplicateCaptures(allFiles);
  if (!files.length) return { records: [], unread: 0, source: 'duplicate-captures', duplicateCaptures };
  const dc = duplicateCaptures ? { duplicateCaptures } : {};
  const sized = await _withSizes(files);
  if (sized.some(f => !Number.isFinite(f.size))) return { records: [], unread: files.length, source: 'unavailable' };
  const companion = require('./companionService');
  const cached = await companion.findAssessedRecords(sized).catch(() => new Map());
  if (cached.size === sized.length) return { records: sized.map(f => cached.get(f.src)), unread: 0, source: 'cache', ...dc };
  const records = await _assess(sized.map(f => ({ key: f.src, read: f.src, size: f.size })), signal);
  if (!records || records.length !== sized.length) return { records: [], unread: files.length, source: 'unavailable' };
  return { records, unread: 0, source: 'read', ...dc };
}

async function _waitWhileBusy(signal) {
  while (_operatorBusy() && !signal.aborted) await new Promise(r => setTimeout(r, 500));
}

/** Recovery: archive-first, verified evidence for the committed files (see header). */
async function _resolveRecoveryEvidence(allFiles, { signal }) {
  if (allFiles.length > MAX_REREAD_FILES) return { records: [], unread: allFiles.length, source: 'unavailable', reason: 'too-many-files' };
  const { fresh: files, duplicateCaptures } = await _withoutDuplicateCaptures(allFiles);
  if (!files.length) return { records: [], unread: 0, source: 'duplicate-captures', duplicateCaptures };
  const none = (extra) => ({ records: [], unread: files.length, source: 'unavailable', ...extra });
  const ev = require('./learningRecoveryEvidence');
  const io = _hashIo();
  const classified = new Array(files.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= files.length || signal.aborted) return;
      await _waitWhileBusy(signal);
      classified[i] = { file: files[i], c: await ev.classifyCommittedFile(files[i], io) };
    }
  };
  await Promise.all(Array.from({ length: RECOVERY_CONCURRENCY }, worker));
  if (signal.aborted) return none();
  const sum = ev.summarize(classified);
  if (sum.transient) return none({ transient: sum.transient, counts: sum.counts });
  if (!sum.usable.length) return { ...none({ reason: 'no-trustworthy-evidence', counts: sum.counts }), unread: sum.unread, waitingForSource: sum.waitingForSource };
  const records = await _assess(sum.usable.map(u => ({ key: u.file.dest, read: u.path, size: u.file.size })), signal);
  if (signal.aborted) return none();
  if (!records || records.length !== sum.usable.length) return none({ transient: 'archive-read-failed', counts: sum.counts });
  // A file rewritten while it was being read is no longer the one that was verified.
  const changed = new Set();
  for (const u of sum.usable) {
    const st = await fs.promises.stat(u.path).catch(() => null);
    if (!st || st.size !== u.file.size) changed.add(u.file.dest);
  }
  return {
    records: records.filter(r => !changed.has(r.path)), unread: sum.unread + changed.size, waitingForSource: sum.waitingForSource,
    source: sum.counts.source ? 'archive+source' : 'archive', counts: { ...sum.counts, changedDuringRead: changed.size, duplicateCaptures },
  };
}

function _get() {
  if (_service) return _service;
  const { createPhotographerLearningService } = require('./photographerLearningService');
  const { log } = require('./logger');
  _service = createPhotographerLearningService({
    isEnabled: () => _deps().settings.getPhotographerLearningEnabled(),
    journalDir: () => _deps().dir,
    getComputerId: () => _deps().settings.getDeviceId(),
    getNames: () => ({
      listNames: require('../main/listManager').getList('photographers'),
      shippedNames: JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'photographers.json'), 'utf8')),
    }),
    openStore: async () => {
      const { createIdentityRegistryStore } = require('./identityRegistryStore');
      const { createElectronSecureStorage } = require('./electronSecureStorage');
      const { settings, dir } = _deps();
      _store = createIdentityRegistryStore({ dir, secureStorage: createElectronSecureStorage(), computerId: settings.getDeviceId() });
      const st = await _store.open();
      log(`[identity-learning] registry ${st.state}${st.reason ? ` (${st.reason})` : ''}; body matching ${st.bodyMatching ? 'on' : `off (${st.keyStatus})`}`);
      return _store;
    },
    resolveEvidence: _resolveEvidence,
    resolveRecoveryEvidence: _resolveRecoveryEvidence,
    isBusy: _operatorBusy,
    log,
  });
  return _service;
}

/** Never throws; never awaited by the import. */
function onImportCommitted(ctx) {
  try { return _get().onImportCommitted(ctx); } catch { return 'error'; }
}

/**
 * Startup: a recovery pass after a delay, only when an earlier run left learning pending.
 * Reads one small file; creates nothing. AUTOINGEST_LEARNING_RECOVERY_DELAY_MS (1 s – 1 h)
 * shortens the delay for isolated tests.
 */
function scheduleRecoveryAfterLaunch() {
  try {
    const { settings, dir } = _deps();
    if (!settings.getPhotographerLearningEnabled()) return false;
    const { STATE_DIR, PENDING_FILE } = require('./learningStateStore');
    if (!fs.existsSync(path.join(dir, STATE_DIR, PENDING_FILE))) return false;
    const env = Number(process.env.AUTOINGEST_LEARNING_RECOVERY_DELAY_MS);
    const delay = Number.isFinite(env) && env > 0 ? Math.min(3600000, Math.max(1000, env)) : RECOVERY_LAUNCH_DELAY_MS;
    _get().scheduleRecovery(delay);
    return true;
  } catch { return false; }
}

/** will-quit: cancel learning work and release the registry lock. Synchronous, idempotent. */
function shutdown() {
  try { if (_service) _service.shutdown(); } catch { /* ignore */ }
  try { if (_fallback) _fallback.shutdown(); } catch { /* ignore */ }
  try { if (_store) _store.releaseLockSync(); } catch { /* ignore */ }
}

module.exports = {
  onImportCommitted, scheduleRecoveryAfterLaunch, shutdown,
  _forTests: { get: () => _service, store: () => _store, recoverNow: (opts) => _get().recoverPending(opts), whenIdle: () => _get().whenIdle() },
};
