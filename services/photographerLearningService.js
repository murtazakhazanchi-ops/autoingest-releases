/**
 * photographerLearningService.js — records photographer↔camera OBSERVATIONS from committed
 * imports (AI-FEAT-063, AI-RM-014 Q4c). Main process; Electron-free (everything external is
 * injected), so it is unit-testable.
 *
 * Contract with the import pipeline (main.js import:commitTransaction):
 *  - onImportCommitted() is called once the transaction has fully succeeded. It only queues
 *    work and returns immediately; it never throws and never changes the import's result.
 *  - Choosing a photographer is an observation. This service never writes a confirmation.
 *
 * Exactly-once: the learning key is derived from the committed import entries' IDs
 * (event.json imports[].id — unique per entry, not UUIDs) and this computer's
 * settings.deviceId: importId = "imp-" + sha256(computerId | sorted entry IDs)[0..32].
 * Event IDs and new device IDs are UUIDv5 of that importId, so a repeated callback, a retry
 * or a race appends identical events — idempotent in the registry. An importId already
 * present in the registry is skipped.
 *
 * Laziness: nothing is created on disk (registry, key, journal) until the first ELIGIBLE
 * committed import, and nothing at all while learning is switched off.
 *
 * Durable reporting: learning-journal.json (next to the registry) keeps the last N outcomes
 * — status, reason, counts — never identifiers, names, paths or digests. A job interrupted
 * by shutdown stays "started" and is reported as "interrupted" by the next run.
 */

'use strict';

const crypto = require('crypto');
const path = require('path');
const { createEvent } = require('./identityEvents');
const { assessCameras } = require('./cameraAssessmentModel');
const { protectCameraGroups } = require('./cameraDeviceIdentity');
const { planImportLearning } = require('./identityLearningPlan');
const { uuidV5 } = require('./photographerIdentity');
const { atomicWriteFile, readIfExists } = require('./identityFileOps');

/** Fixed namespace for deterministic per-import event and device IDs. Never change it. */
const LEARNING_NAMESPACE = '3f0c2b7e-8a51-4d2e-9b64-7c1d5e9a0f42';
const JOURNAL_FILE = 'learning-journal.json';
const JOURNAL_LIMIT = 200;
const DEFAULT_MAX_QUEUE = 20;

function learningKey(computerId, entryIds) {
  const h = crypto.createHash('sha256').update(`${computerId}\x00${[...entryIds].sort().join('\x00')}`).digest('hex');
  return `imp-${h.slice(0, 32)}`;
}

const _localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Without a usable key no body identity can be protected: bodies become model-only evidence. */
function _modelOnly(protectedCard) {
  return { ...protectedCard, cameras: protectedCard.cameras.map(c => ({ kind: 'model', make: c.make, modelKey: c.modelKey, modelDisplay: c.modelDisplay, fileCount: c.fileCount })) };
}

/**
 * @param {{
 *   isEnabled: () => boolean,
 *   openStore: () => Promise<object>,            // lazily creates/opens the Q4b registry store
 *   journalDir: () => string,
 *   getComputerId: () => string|null,
 *   getNames: () => { listNames: string[], shippedNames: string[] },
 *   resolveEvidence: (files: Array<{src:string,size:number|null,dest?:string}>, opts: {signal: AbortSignal}) => Promise<{records: object[], unread: number, source: string}>,
 *   fs?: typeof import('fs').promises, now?: () => Date, log?: (msg: string) => void, maxQueue?: number,
 * }} deps
 */
function createPhotographerLearningService(deps) {
  const { isEnabled, openStore, journalDir, getComputerId, getNames, resolveEvidence,
    fs: fsx = require('fs').promises, now = () => new Date(), log = () => {}, maxQueue = DEFAULT_MAX_QUEUE } = deps;
  const runId = crypto.randomBytes(6).toString('hex');
  const queue = [];
  const keysSeen = new Set();
  let running = null, stopped = false, storePromise = null, journalQueue = Promise.resolve(), journalSwept = false;
  const outcomes = []; // in-memory copy for diagnostics/tests

  function _store() {
    if (!storePromise) storePromise = openStore().catch(() => null);
    return storePromise;
  }

  // ── Journal (no identifiers) ─────────────────────────────────────────────────
  function _journal(entry) {
    journalQueue = journalQueue.then(async () => {
      const file = path.join(journalDir(), JOURNAL_FILE);
      let doc = { format: 'autoingest-learning-journal', version: 1, entries: [] };
      try { const buf = await readIfExists(fsx, file); if (buf) { const p = JSON.parse(buf.toString('utf8')); if (Array.isArray(p.entries)) doc = p; } } catch { /* damaged journal: start over, it is diagnostics only */ }
      if (!journalSwept) {
        journalSwept = true;
        doc.entries = doc.entries.map(e => (e.status === 'started' && e.runId !== runId ? { ...e, status: 'interrupted', reason: 'app-closed-before-learning-finished' } : e));
      }
      const i = doc.entries.findIndex(e => e.key === entry.key && e.runId === entry.runId);
      if (i >= 0) doc.entries[i] = { ...doc.entries[i], ...entry }; else doc.entries.push(entry);
      doc.entries = doc.entries.slice(-JOURNAL_LIMIT);
      await fsx.mkdir(journalDir(), { recursive: true, mode: 0o700 });
      await atomicWriteFile(fsx, file, `${JSON.stringify(doc, null, 2)}\n`);
    }).catch((err) => log(`[identity-learning] journal write failed: ${err.code || 'error'}`));
    return journalQueue;
  }

  function _finish(job, status, reason, extra = {}) {
    const o = { key: job.importId, runId, at: now().toISOString(), workflow: job.workflow, status, reason: reason || null, files: job.files.length, durationMs: Date.now() - job.startedMs, ...extra };
    outcomes.push(o);
    log(`[identity-learning] ${job.importId.slice(0, 12)} ${status}${reason ? ` (${reason})` : ''}`);
    if (job.journaled) return _journal(o);
    return Promise.resolve();
  }

  // ── Processing ───────────────────────────────────────────────────────────────
  async function _process(job) {
    const store = await _store();
    if (!store) return _finish(job, 'registry-unavailable', 'open-failed');
    job.journaled = true;
    await _journal({ key: job.importId, runId, at: now().toISOString(), workflow: job.workflow, status: 'started', reason: null, files: job.files.length });
    const st = store.getStatus();
    if (!st.learning) return _finish(job, 'registry-unavailable', st.reason);
    if (store.getEvents().some(e => e.importId === job.importId)) return _finish(job, 'duplicate', 'already-recorded');

    const names = getNames();
    const ph = await store.ensurePhotographerId(job.photographer, { ...names, origin: job.origin, at: now().toISOString() });
    if (!ph.ok) return _finish(job, 'skipped', `photographer-${ph.reason}`);

    let evidence;
    try { evidence = await resolveEvidence(job.files, { signal: job.abort.signal }); }
    catch { evidence = { records: [], unread: job.files.length, source: 'unavailable' }; }
    if (job.abort.signal.aborted) return _finish(job, 'interrupted', 'shutdown');

    const keyring = store.getKeyring();
    const assessed = assessCameras(evidence.records);
    let protectedCard;
    if (keyring) protectedCard = protectCameraGroups(evidence.records, assessed, keyring);
    else protectedCard = _modelOnly(protectCameraGroups(evidence.records, assessed, { digestAll: () => [] }));

    const derived = store.deriveState({ shippedNames: names.shippedNames });
    let deviceN = 0;
    const plan = planImportLearning(protectedCard, derived, {
      photographerId: ph.photographerId, importId: job.importId, day: job.day, unreadFiles: evidence.unread,
      newDeviceId: () => uuidV5(`${job.importId}:device:${deviceN++}`, LEARNING_NAMESPACE),
    });
    const at = now().toISOString();
    const events = plan.events.map((p, i) => createEvent(p.type, p.payload, { origin: job.origin, at, newId: () => uuidV5(`${job.importId}:event:${i}`, LEARNING_NAMESPACE) }));
    const counts = {
      observation: plan.observation, evidence: evidence.source, bodyMatching: !!keyring,
      cameras: { bodies: protectedCard.cameras.filter(c => c.kind === 'body').length, models: protectedCard.cameras.filter(c => c.kind === 'model').length },
      unknownFiles: protectedCard.unknownFiles, conflictFiles: protectedCard.conflictFiles, unreadFiles: evidence.unread,
    };
    if (!events.length) return _finish(job, 'nothing-to-record', plan.observation, counts);
    const res = await store.appendEvents(events);
    if (!res.ok) return _finish(job, 'write-failed', res.reason, counts);
    return _finish(job, 'recorded', null, { ...counts, eventsAdded: res.added.length, eventsDuplicate: res.duplicates.length });
  }

  function _pump() {
    if (running || stopped || !queue.length) return;
    const job = queue.shift();
    running = job;
    _process(job)
      .catch(() => _finish(job, 'failed', 'internal-error'))
      .finally(() => { running = null; if (!stopped) setImmediate(_pump); });
  }

  /**
   * Called after a SUCCESSFUL import commit. Never throws; returns a short status.
   * @param {{ entryIds: string[], photographer: string, files: Array<{src:string,size?:number,dest?:string}>,
   *           copied: number, workflow: 'event-import'|'multi-event-import', operatorId?: string|null }} ctx
   */
  function onImportCommitted(ctx) {
    try {
      if (stopped) return 'stopped';
      if (!isEnabled()) return 'disabled';
      const computerId = getComputerId();
      const entryIds = Array.isArray(ctx && ctx.entryIds) ? ctx.entryIds.filter(x => typeof x === 'string' && x) : [];
      const photographer = typeof ctx.photographer === 'string' ? ctx.photographer.trim() : '';
      const files = Array.isArray(ctx.files) ? ctx.files.filter(f => f && typeof f.src === 'string') : [];
      if (!computerId || !entryIds.length || !photographer || !files.length || !(ctx.copied > 0)) return 'ineligible';
      if (!['event-import', 'multi-event-import'].includes(ctx.workflow)) return 'ineligible';
      const importId = learningKey(computerId, entryIds);
      if (keysSeen.has(importId)) return 'duplicate';
      if (queue.length >= maxQueue) return 'queue-full';
      keysSeen.add(importId);
      const d = now();
      queue.push({
        importId, photographer, files, workflow: ctx.workflow, day: _localDay(d), startedMs: Date.now(), journaled: false,
        origin: { computerId, operatorId: typeof ctx.operatorId === 'string' && ctx.operatorId ? ctx.operatorId : null, workflow: ctx.workflow },
        abort: new AbortController(),
      });
      setImmediate(_pump);
      return 'queued';
    } catch {
      return 'error';
    }
  }

  /** Stop accepting work, cancel the running job. Pending jobs are dropped (journal says why). */
  function shutdown() {
    stopped = true;
    if (running) running.abort.abort();
    queue.length = 0;
  }

  /** Resolves when queued work (and journal writes) have settled — for tests and orderly quit. */
  async function whenIdle() {
    while (running || queue.length) await new Promise(r => setTimeout(r, 20));
    await journalQueue;
  }

  return { onImportCommitted, shutdown, whenIdle, outcomes: () => outcomes.slice(), storeIfOpen: () => storePromise };
}

module.exports = { createPhotographerLearningService, learningKey, LEARNING_NAMESPACE, JOURNAL_FILE };
