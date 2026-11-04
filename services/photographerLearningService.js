/**
 * photographerLearningService.js — records photographer↔camera OBSERVATIONS from committed
 * imports (AI-FEAT-063, AI-RM-014 Q4c, recovery Q4d). Main process; Electron-free (everything
 * external is injected), so it is unit-testable.
 *
 * Contract with the import pipeline (main.js import:commitTransaction):
 *  - onImportCommitted() is called once the transaction has fully succeeded. It only queues
 *    work and returns immediately; it never throws and never changes the import's result.
 *  - Choosing a photographer is an observation. This service never writes a confirmation.
 *  - Only NEWLY COPIED files are evidence. Files the engine skipped because the same file was
 *    already in the archive were counted by the import that copied them, and a copy the engine
 *    renamed (NAME_1.JPG) that repeats a picture already archived is not counted again.
 *
 * Exactly-once: the learning key is derived from the committed import entries' IDs
 * (event.json imports[].id) and this computer's settings.deviceId:
 * importId = "imp-" + sha256(computerId | sorted entry IDs)[0..32]. Event IDs and new device
 * IDs are UUIDv5 of that importId, so a repeated callback, a retry, a recovery or a race
 * appends identical events — idempotent in the registry. An importId already present in the
 * registry is never processed again.
 *
 * Durable recovery (Q4d): an accepted import is written to learning-pending.json (with its
 * committed archive paths) before any work starts, and removed only on a final outcome. A job
 * cut off by quit, by a registry that is locked/unavailable, by an unreachable archive or by a
 * source card that was removed before it could be read stays pending. A later run retries it
 * — never at launch itself, only after a delay and while no import/sync/transfer runs — after
 * re-verifying the commit and re-establishing trustworthy evidence from the archive copies
 * (learningRecoveryEvidence.js). Bounded: 3 attempts, 7 days, 20 pending imports; then it is
 * journaled as abandoned/expired. Uncertain evidence stays unread, never guessed.
 *
 * Laziness: nothing is created on disk (registry, key, journal, pending) until the first
 * ELIGIBLE committed import, and nothing at all while learning is switched off.
 *
 * Journal (learningStateStore.js, cross-process locked): one entry per import — status,
 * reason, counts — never identifiers, names, paths or digests. queued/started/recovering
 * entries of a process that is gone are reported as interrupted.
 */

'use strict';

const crypto = require('crypto');
const { createEvent } = require('./identityEvents');
const { assessCameras } = require('./cameraAssessmentModel');
const { protectCameraGroups } = require('./cameraDeviceIdentity');
const { planImportLearning } = require('./identityLearningPlan');
const { uuidV5 } = require('./photographerIdentity');
const { createLearningStateStore, JOURNAL_FILE, PENDING_FILE } = require('./learningStateStore');
const { verifyCommittedImport } = require('./learningRecoveryEvidence');

/** Fixed namespace for deterministic per-import event and device IDs. Never change it. */
const LEARNING_NAMESPACE = '3f0c2b7e-8a51-4d2e-9b64-7c1d5e9a0f42';
const JOURNAL_LIMIT = 200;
const DEFAULT_MAX_QUEUE = 20;
const LIMITS = Object.freeze({ maxPending: 20, maxAttempts: 3, maxAgeMs: 7 * 86400000, retryDelayMs: 5 * 60000, busyRetryMs: 60000, perPass: 5 });
const IN_FLIGHT = new Set(['queued', 'started', 'recovering']);
/** Outcomes a later callback or retry of the same import must never overwrite in the journal. */
const SETTLED = new Set(['recorded', 'nothing-to-record']);

function learningKey(computerId, entryIds) {
  const h = crypto.createHash('sha256').update(`${computerId}\x00${[...entryIds].sort().join('\x00')}`).digest('hex');
  return `imp-${h.slice(0, 32)}`;
}

const _localDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const _defaultPidAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } };

/** Without a usable key no body identity can be protected: bodies become model-only evidence. */
function _modelOnly(protectedCard) {
  return { ...protectedCard, cameras: protectedCard.cameras.map(c => ({ kind: 'model', make: c.make, modelKey: c.modelKey, modelDisplay: c.modelDisplay, fileCount: c.fileCount })) };
}

/**
 * @param {{
 *   isEnabled: () => boolean,
 *   openStore: () => Promise<object>,            // lazily creates/opens the Q4b registry store
 *   journalDir: () => string,                    // the identity-registry folder
 *   getComputerId: () => string|null,
 *   getNames: () => { listNames: string[], shippedNames: string[] },
 *   resolveEvidence: (files, opts: {signal: AbortSignal}) => Promise<{records: object[], unread: number, source: string}>,
 *   resolveRecoveryEvidence?: (files, opts: {signal: AbortSignal}) => Promise<{records: object[], unread: number, source: string, transient?: string, waitingForSource?: number, counts?: object}>,
 *   isBusy?: () => boolean, limits?: Partial<typeof LIMITS>,
 *   fs?: typeof import('fs').promises, now?: () => Date, log?: (msg: string) => void, maxQueue?: number,
 *   isPidAlive?: (pid: number) => boolean, setTimer?: (fn: () => void, ms: number) => any, clearTimer?: (t: any) => void,
 * }} deps
 */
function createPhotographerLearningService(deps) {
  const { isEnabled, openStore, journalDir, getComputerId, getNames, resolveEvidence,
    resolveRecoveryEvidence = null, isBusy = () => false,
    fs: fsx = require('fs').promises, now = () => new Date(), log = () => {}, maxQueue = DEFAULT_MAX_QUEUE,
    isPidAlive = _defaultPidAlive,
    setTimer = (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; }, clearTimer = clearTimeout } = deps;
  const L = { ...LIMITS, ...(deps.limits || {}) };
  const runId = crypto.randomBytes(6).toString('hex');
  const owner = { pid: process.pid, runId };
  const queue = [];
  const keysSeen = new Set(); // live callbacks already accepted by this run
  const active = new Set();   // importIds queued or running in this run
  let running = null, stopped = false, storePromise = null, state = null, writes = Promise.resolve(), timer = null, timerDue = 0, passing = null;
  const outcomes = []; // in-memory copy for diagnostics/tests

  function _store() {
    if (!storePromise) storePromise = openStore().catch(() => null);
    return storePromise;
  }
  function _state() {
    if (!state) state = createLearningStateStore({ dir: journalDir(), fs: fsx, now, isPidAlive });
    return state;
  }

  // ── Durable state (journal + pending), one locked update at a time ──────────────
  const _staleOwner = (o) => !o || o.runId !== runId && (o.pid === process.pid || !Number.isInteger(o.pid) || !isPidAlive(o.pid));

  /** Reports in-flight entries of processes that are gone as interrupted. */
  function _sweep(journal) {
    return journal.map(e => (IN_FLIGHT.has(e.status) && _staleOwner({ pid: e.pid, runId: e.runId })
      ? { ...e, status: 'interrupted', reason: e.status === 'queued' ? 'app-closed-before-learning-started' : 'app-closed-before-learning-finished' }
      : e));
  }

  function _upsert(journal, entry, pendingKeys) {
    const i = journal.findIndex(e => e.key === entry.key);
    let next;
    if (i < 0) next = [...journal, entry];
    else if (SETTLED.has(journal[i].status) && entry.status === 'duplicate') next = journal.map((e, k) => (k === i ? { ...e, seenAgain: (e.seenAgain || 0) + 1 } : e));
    else if (SETTLED.has(journal[i].status) && IN_FLIGHT.has(entry.status)) next = journal;
    else next = journal.map((e, k) => (k === i ? { ...e, ...entry } : e));
    // Keep the last N, but never drop the entry of an import that is still pending.
    while (next.length > JOURNAL_LIMIT) {
      const drop = next.findIndex(e => !pendingKeys.has(e.key));
      if (drop < 0) break;
      next.splice(drop, 1);
    }
    return next;
  }

  /** @param {(s: {journal: object[], pending: object[]}) => object} fn */
  function _write(fn) {
    const p = _state().update((s) => {
      const journal = _sweep(s.journal);
      const r = fn({ journal, pending: s.pending }) || {};
      return { journal: r.journal || journal, pending: r.pending || s.pending, result: r.result };
    }).catch((err) => { log(`[identity-learning] state write failed: ${err.code || 'error'}`); return undefined; });
    writes = writes.then(() => p);
    return p;
  }

  const _entry = (job, status, reason, extra = {}) => ({
    key: job.importId, runId, pid: process.pid, at: now().toISOString(), workflow: job.workflow, status, reason: reason || null,
    files: job.files.length, ...(job.mode === 'recovery' ? { recovered: true, attempt: job.attempt } : {}), ...extra,
  });

  function _record(o) {
    outcomes.push(o);
    log(`[identity-learning] ${o.key.slice(0, 12)} ${o.status}${o.reason ? ` (${o.reason})` : ''}`);
  }

  /** Final outcome: journal it and drop the pending record. */
  function _finish(job, status, reason, extra = {}) {
    const o = { ..._entry(job, status, reason, extra), pending: false, durationMs: Date.now() - job.startedMs };
    _record(o);
    return _write(({ journal, pending }) => {
      const rest = pending.filter(i => i.importId !== job.importId);
      return { journal: _upsert(journal, o, new Set(rest.map(i => i.importId))), pending: rest };
    });
  }

  /** Not final: keep the pending record for a later, bounded attempt. */
  function _defer(job, status, reason, { retryNow = false, extra = {} } = {}) {
    const notBefore = new Date(now().getTime() + (retryNow ? 0 : L.retryDelayMs)).toISOString();
    return _write(({ journal, pending }) => {
      const held = pending.some(i => i.importId === job.importId);
      // Not held (not recoverable, or no room): nothing will retry it — say so.
      const o = { ..._entry(job, !held && status === 'deferred' ? 'dropped' : status, reason, extra), pending: held, durationMs: Date.now() - job.startedMs };
      _record(o);
      const next = pending.map(i => (i.importId === job.importId ? { ...i, owner: null, notBefore, lastReason: reason || status } : i));
      return { journal: _upsert(journal, o, new Set(next.map(i => i.importId))), pending: next };
    });
  }

  function _mark(job, status) {
    return _write(({ journal, pending }) => ({ journal: _upsert(journal, _entry(job, status, null), new Set(pending.map(i => i.importId))) }));
  }

  // ── Processing ───────────────────────────────────────────────────────────────
  async function _process(job) {
    if (job.accepted) await job.accepted; // durable before any work
    const store = await _store();
    if (!store) return _defer(job, 'registry-unavailable', 'open-failed');
    const st = store.getStatus();
    if (!st.learning) return _defer(job, 'registry-unavailable', st.reason);
    if (store.getEvents().some(e => e.importId === job.importId)) return _finish(job, 'duplicate', 'already-recorded');
    await _mark(job, job.mode === 'recovery' ? 'recovering' : 'started');

    if (job.mode === 'recovery') {
      const v = await verifyCommittedImport(job.item, { computerId: getComputerId(), learningKey, stat: p => fsx.stat(p), readFile: p => fsx.readFile(p) });
      if (!v.ok) return v.transient ? _defer(job, 'deferred', v.reason) : _finish(job, 'abandoned', `commit-not-verified:${v.reason}`);
    }

    const names = getNames();
    const ph = await store.ensurePhotographerId(job.photographer, { ...names, origin: job.origin, at: now().toISOString() });
    if (!ph.ok) return _finish(job, 'skipped', `photographer-${ph.reason}`);

    let evidence;
    const resolve = job.mode === 'recovery' ? resolveRecoveryEvidence : resolveEvidence;
    try { evidence = resolve ? await resolve(job.files, { signal: job.abort.signal }) : { records: [], unread: job.files.length, source: 'unavailable' }; }
    catch { evidence = { records: [], unread: job.files.length, source: 'unavailable' }; }
    if (job.abort.signal.aborted) return _defer(job, 'interrupted', 'shutdown', { retryNow: true });
    const ec = evidence.counts ? { evidenceCounts: evidence.counts } : {};
    if (evidence.transient) return _defer(job, 'deferred', evidence.transient, { extra: ec });
    // The source could not be read right after the commit (card removed): the archive copies
    // are verified later by recovery, once AutoIngest's own metadata writes have settled.
    if (job.mode === 'live' && evidence.source === 'unavailable') return _defer(job, 'deferred', 'source-unavailable');
    if (job.mode === 'recovery' && evidence.waitingForSource > 0 && job.attempt < L.maxAttempts) return _defer(job, 'deferred', 'source-card-not-available', { extra: ec });
    if (evidence.source === 'duplicate-captures') return _finish(job, 'nothing-to-record', 'all-copies-repeat-archived-pictures', { duplicateCaptures: evidence.duplicateCaptures });
    if (job.mode === 'recovery' && !evidence.records.length) return _finish(job, 'evidence-unavailable', evidence.reason || 'no-trustworthy-evidence', ec);

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
      unknownFiles: protectedCard.unknownFiles, conflictFiles: protectedCard.conflictFiles, unreadFiles: evidence.unread, ...ec,
      ...(evidence.duplicateCaptures ? { duplicateCaptures: evidence.duplicateCaptures } : {}),
    };
    if (!events.length) return _finish(job, 'nothing-to-record', plan.observation, counts);
    const res = await store.appendEvents(events);
    if (!res.ok) return _defer(job, 'write-failed', res.reason, { extra: counts });
    return _finish(job, 'recorded', null, { ...counts, eventsAdded: res.added.length, eventsDuplicate: res.duplicates.length });
  }

  function _pump() {
    if (running || stopped || !queue.length) return;
    const job = queue.shift();
    running = job;
    _process(job)
      .catch(() => _finish(job, 'failed', 'internal-error'))
      .finally(() => {
        running = null;
        active.delete(job.importId);
        if (stopped) return;
        if (queue.length) setImmediate(_pump);
        else scheduleRecovery(L.retryDelayMs);
      });
  }

  // ── Live imports ─────────────────────────────────────────────────────────────
  function _pendingItem(job, d) {
    const recoverable = typeof job.eventDir === 'string' && job.eventDir
      && job.files.every(f => typeof f.dest === 'string' && f.dest && Number.isFinite(f.size));
    if (!recoverable) return null;
    return {
      importId: job.importId, computerId: job.origin.computerId, entryIds: [...job.entryIds].sort(), eventDir: job.eventDir,
      photographer: job.photographer, workflow: job.workflow, operatorId: job.origin.operatorId, day: job.day,
      acceptedAt: d.toISOString(), attempts: 0, notBefore: null, lastReason: null, owner: null,
      files: job.files.map(f => ({ src: f.src, dest: f.dest, size: f.size })),
    };
  }

  /** Adds the pending record (bounded) and journals the job; returns whether it is recoverable. */
  function _accept(job, item, status, reason) {
    return _write(({ journal, pending }) => {
      const present = pending.some(i => i.importId === job.importId);
      const room = present || pending.length < L.maxPending;
      const next = !item || !room ? pending
        : present ? pending.map(i => (i.importId === job.importId && _staleOwner(i.owner) ? { ...i, owner: status === 'queued' ? owner : null } : i))
          : [...pending, { ...item, owner: status === 'queued' ? owner : null }];
      const finalStatus = status === 'deferred' && (!item || !room) ? 'dropped' : status;
      const o = _entry(job, finalStatus, finalStatus === 'dropped' ? reason : (item && !room ? 'pending-full' : reason), { recoverable: !!item && room });
      if (finalStatus !== 'queued') _record(o);
      return { journal: _upsert(journal, o, new Set(next.map(i => i.importId))), pending: next, result: !!item && room };
    });
  }

  /**
   * Called after a SUCCESSFUL import commit. Never throws; returns a short status.
   * @param {{ entryIds: string[], photographer: string, files: Array<{src:string,size?:number,dest?:string}>,
   *           copied: number, workflow: 'event-import'|'multi-event-import', operatorId?: string|null,
   *           eventDir?: string }} ctx   files = the NEWLY COPIED files only
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
      const d = now();
      const job = {
        importId, mode: 'live', photographer, files, entryIds, eventDir: typeof ctx.eventDir === 'string' ? ctx.eventDir : null,
        workflow: ctx.workflow, day: _localDay(d), startedMs: Date.now(),
        origin: { computerId, operatorId: typeof ctx.operatorId === 'string' && ctx.operatorId ? ctx.operatorId : null, workflow: ctx.workflow },
        abort: new AbortController(),
      };
      keysSeen.add(importId);
      const item = _pendingItem(job, d);
      if (queue.length >= maxQueue) {
        // Kept for recovery when there is room; journaled as dropped otherwise.
        _accept(job, item, 'deferred', 'queue-full').then(() => scheduleRecovery(L.retryDelayMs));
        return 'queue-full';
      }
      queue.push(job);
      active.add(importId);
      job.accepted = _accept(job, item, 'queued', null);
      setImmediate(_pump);
      return 'queued';
    } catch {
      return 'error';
    }
  }

  // ── Recovery ─────────────────────────────────────────────────────────────────
  /**
   * One bounded recovery pass. Never at launch (scheduleRecovery waits), never while another
   * learning job or an import/sync/transfer is running. `force` ignores the retry spacing only.
   * @returns {Promise<{ started: number, finalized: number, busy?: boolean }>}
   */
  function recoverPending({ force = false } = {}) {
    if (passing) return passing;
    passing = (async () => {
      if (stopped || !isEnabled() || !resolveRecoveryEvidence) return { started: 0, finalized: 0 };
      if (running || queue.length || isBusy()) return { started: 0, finalized: 0, busy: true };
      const snap = await _state().read();
      if (!snap.pending.length) return { started: 0, finalized: 0 };
      const store = await _store();
      if (!store || !store.getStatus().learning) return { started: 0, finalized: 0, registry: store ? store.getStatus().reason : 'open-failed' };
      const t = now().getTime();
      const iso = now().toISOString();
      const res = await _write(({ journal, pending }) => {
        const keep = [], finals = [], pick = [];
        for (const it of pending) {
          if (!_staleOwner(it.owner) || active.has(it.importId)) { keep.push(it); continue; }
          const age = t - Date.parse(it.acceptedAt);
          if (!(age <= L.maxAgeMs)) { finals.push([it, 'expired', 'older-than-recovery-window']); continue; }
          if (it.attempts >= L.maxAttempts) { finals.push([it, 'abandoned', `attempts-exhausted:${it.lastReason || 'unknown'}`]); continue; }
          if (!force && it.notBefore && Date.parse(it.notBefore) > t) { keep.push(it); continue; }
          if (pick.length >= L.perPass) { keep.push(it); continue; }
          const n = { ...it, attempts: it.attempts + 1, lastAttemptAt: iso, owner };
          pick.push(n); keep.push(n);
        }
        let j = journal;
        const keys = new Set(keep.map(i => i.importId));
        for (const [it, status, reason] of finals) {
          const o = { key: it.importId, runId, pid: process.pid, at: iso, workflow: it.workflow, status, reason, files: it.files.length, recovered: true, attempt: it.attempts };
          _record(o);
          j = _upsert(j, o, keys);
        }
        return { journal: j, pending: keep, result: { pick, finalized: finals.length } };
      });
      if (!res) return { started: 0, finalized: 0 };
      for (const it of res.pick) {
        keysSeen.add(it.importId);
        active.add(it.importId);
        queue.push({
          importId: it.importId, mode: 'recovery', item: it, attempt: it.attempts, photographer: it.photographer, files: it.files,
          workflow: it.workflow, day: it.day, startedMs: Date.now(), abort: new AbortController(),
          origin: { computerId: it.computerId, operatorId: it.operatorId || null, workflow: it.workflow },
        });
      }
      if (res.pick.length) setImmediate(_pump);
      return { started: res.pick.length, finalized: res.finalized };
    })().finally(() => { passing = null; });
    return passing;
  }

  /**
   * Runs a recovery pass after `delayMs`. One timer at a time; an earlier one is never pushed
   * back. While the operator is busy it waits and checks again.
   */
  function scheduleRecovery(delayMs) {
    if (stopped || !resolveRecoveryEvidence) return;
    const due = Date.now() + Math.max(0, delayMs);
    if (timer && timerDue <= due) return;
    if (timer) clearTimer(timer);
    timerDue = due;
    timer = setTimer(async () => {
      timer = null; timerDue = 0;
      try {
        const snap = await _state().read();
        if (!snap.pending.length) return;
        if (running || queue.length || isBusy()) { scheduleRecovery(L.busyRetryMs); return; }
        const r = await recoverPending();
        if (r.busy) { scheduleRecovery(L.busyRetryMs); return; }
        // Registry unavailable for this run (locked, corrupt): the next launch tries again.
        // Jobs started: the queue drain schedules the next pass.
        if (r.registry || r.started) return;
        const after = await _state().read();
        const t = now().getTime();
        const waits = after.pending.filter(i => _staleOwner(i.owner) && i.notBefore && Date.parse(i.notBefore) > t).map(i => Date.parse(i.notBefore) - t);
        if (waits.length) scheduleRecovery(Math.max(1000, Math.min(...waits)));
      } catch { /* never surfaces */ }
    }, Math.max(0, delayMs));
  }

  /** Stop accepting work, cancel the running job. Queued jobs stay pending for a later run. */
  function shutdown() {
    stopped = true;
    if (timer) { clearTimer(timer); timer = null; timerDue = 0; }
    if (running) running.abort.abort();
    for (const j of queue) active.delete(j.importId);
    queue.length = 0;
    if (state) state.releaseSync();
  }

  /** Resolves when queued work and state writes have settled — for tests and orderly quit. */
  async function whenIdle() {
    while (running || queue.length || passing) await new Promise(r => setTimeout(r, 20));
    let w;
    do { w = writes; await w; } while (w !== writes);
  }

  return {
    onImportCommitted, recoverPending, scheduleRecovery, shutdown, whenIdle,
    outcomes: () => outcomes.slice(), storeIfOpen: () => storePromise, stateFiles: () => _state().files,
  };
}

module.exports = { createPhotographerLearningService, learningKey, LEARNING_NAMESPACE, JOURNAL_FILE, PENDING_FILE, LIMITS };
