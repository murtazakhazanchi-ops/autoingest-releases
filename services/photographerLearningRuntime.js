/**
 * photographerLearningRuntime.js — Electron wiring for photographer↔camera learning
 * (AI-FEAT-063, AI-RM-014 Q4c). Main process only. main.js calls:
 *   onImportCommitted(ctx)  at the very end of a SUCCESSFUL import:commitTransaction
 *   shutdown()              from will-quit
 * Nothing here runs at launch or on card insert: the registry, its key and the journal are
 * created lazily by the first eligible committed import (photographerLearningService.js).
 *
 * Camera evidence for the committed files, read-only, never guessed:
 *  1. The companion's Q2/Q3 assessment, when EVERY committed file is in a completed job whose
 *     volume identity (dev/ino) still matches and whose recorded size equals the committed
 *     size (path alone is never trusted).
 *  2. Otherwise one bounded, cancellable re-read of exactly the committed source files with
 *     the same Q2/Q3 pipeline (cardAssessmentService: shared ExifTool pool, concurrency 2,
 *     paused while an import/sync/transfer/checksum runs). Never the archive.
 *  3. A source that is gone or unreadable yields "unread" files → incomplete attribution →
 *     no association.
 * Never filename prefixes, Artist, Owner, card labels or lens serials (Q3 does not read them).
 */

'use strict';

const path = require('path');
const fs = require('fs');

const MAX_REREAD_FILES = 5000;
const REREAD_CONCURRENCY = 2;
const POLL_MS = 100;

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

/** Sizes for every committed file: copied → verified copy size; skipped → its archive copy. */
async function _withSizes(files) {
  return Promise.all(files.map(async (f) => {
    if (Number.isFinite(f.size)) return f;
    const st = f.dest ? await fs.promises.stat(f.dest).catch(() => null) : null;
    return { ...f, size: st ? st.size : null };
  }));
}

async function _reread(files, signal) {
  if (files.length > MAX_REREAD_FILES) return null;
  const { createCardAssessor } = require('./cardAssessmentService');
  const reader = require('./captureDateReader');
  const operatorActivity = require('./operatorActivity');
  const root = _commonDir(files.map(f => f.src));
  const assessor = createCardAssessor({
    listMedia: async () => files.map(f => ({ path: f.src, name: path.basename(f.src), type: _mediaType(f.src), size: f.size })),
    readTags: (p, type) => reader.readCaptureMetadata(p, type),
    readIdentity: (p) => reader.readIdentityTags(p),
    statMount: _statMount,
    isPaused: () => operatorActivity.activeKinds().some(k => k !== 'dialog'),
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

async function _resolveEvidence(files, { signal }) {
  const sized = await _withSizes(files);
  if (sized.some(f => !Number.isFinite(f.size))) return { records: [], unread: files.length, source: 'unavailable' };
  const companion = require('./companionService');
  const cached = await companion.findAssessedRecords(sized).catch(() => new Map());
  if (cached.size === sized.length) return { records: sized.map(f => cached.get(f.src)), unread: 0, source: 'cache' };
  const records = await _reread(sized, signal);
  if (!records || records.length !== sized.length) return { records: [], unread: files.length, source: 'unavailable' };
  return { records, unread: 0, source: 'read' };
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
    log,
  });
  return _service;
}

/** Never throws; never awaited by the import. */
function onImportCommitted(ctx) {
  try { return _get().onImportCommitted(ctx); } catch { return 'error'; }
}

/** will-quit: cancel learning work and release the registry lock. Synchronous, idempotent. */
function shutdown() {
  try { if (_service) _service.shutdown(); } catch { /* ignore */ }
  try { if (_fallback) _fallback.shutdown(); } catch { /* ignore */ }
  try { if (_store) _store.releaseLockSync(); } catch { /* ignore */ }
}

module.exports = { onImportCommitted, shutdown, _forTests: { get: () => _service, store: () => _store } };
