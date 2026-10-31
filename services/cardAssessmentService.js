/**
 * cardAssessmentService.js — background capture-date assessment of connected camera
 * cards (AI-FEAT-061 Q2). Read-only: it lists media and reads metadata, nothing else.
 *
 * One job per card attachment (the sourceMonitorService sourceId):
 *   - a card stays assessed while it stays attached; repeated polls never rescan it;
 *   - removal cancels its job and drops its result; reinsertion is a new attachment
 *     and a fresh assessment, so another card's result can never be shown;
 *   - the mount's device identity is recorded at the start and re-checked, so a card
 *     swapped at the same mountpoint between two polls is assessed again, not reused.
 *
 * Bounded work: one card at a time (FIFO), `concurrency` metadata reads in flight (RAW
 * and video use the shared ExifTool pool, which keeps 4 processes; Q2 leaves headroom), and
 * reads pause while an import, sync, transfer or checksum is running. The main thread
 * only walks directories asynchronously and interprets small tag objects.
 *
 * Electron-free; every side effect is injected (unit-testable without a card).
 */

'use strict';

const { captureEvidence } = require('./captureDateEvidence');
const { resolvePairs } = require('./dateAssessmentModel');

const DEFAULT_CONCURRENCY = 3;
const PAUSE_POLL_MS = 500;
const READ_RETRY_DELAYS_MS = [300, 1000];
const PROGRESS_THROTTLE_MS = 250;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * @param {object} deps
 * @param {(mountpoint: string) => Promise<Array<{path: string, name: string, type: string, size: number}>>} deps.listMedia
 *   the workspace's own discovery rules (fileBrowser.scanMediaRecursive)
 * @param {(filePath: string, type: string) => Promise<object>} deps.readTags  captureDateReader.readCaptureTags
 * @param {(mountpoint: string) => Promise<{dev: number, ino: number}|null>} deps.statMount
 * @param {() => boolean} [deps.isPaused]
 * @param {() => void} [deps.onChange]  progress/state changed (throttled)
 * @param {(msg: string) => void} [deps.log]
 * @param {number} [deps.concurrency]
 */
function createCardAssessor({ listMedia, readTags, statMount, isPaused = () => false, onChange = () => {}, log = () => {}, concurrency = DEFAULT_CONCURRENCY }) {
  /** @type {Map<string, object>} sourceId -> job */
  const _jobs = new Map();
  const _queue = [];
  let _running = null;
  let _stopped = false;
  let _lastEmit = 0;
  let _emitTimer = null;
  let _jobsStarted = 0;

  function _emit(force = false) {
    if (_stopped) return;
    const now = Date.now();
    if (force || now - _lastEmit >= PROGRESS_THROTTLE_MS) {
      if (_emitTimer) { clearTimeout(_emitTimer); _emitTimer = null; }
      _lastEmit = now;
      try { onChange(); } catch (err) { log(`[assessment] onChange error: ${err.message}`); }
      return;
    }
    if (!_emitTimer) _emitTimer = setTimeout(() => { _emitTimer = null; _emit(true); }, PROGRESS_THROTTLE_MS);
  }

  function _newJob(card) {
    return {
      sourceId: card.sourceId, mountpoint: card.mountpoint, label: card.label,
      identity: null, state: 'pending', done: 0, total: 0, records: null, error: null,
      cancelled: false, startedAt: null, finishedAt: null,
    };
  }

  function _enqueue(job) {
    _jobs.set(job.sourceId, job);
    _queue.push(job);
    _pump();
  }

  function _cancel(job, why) {
    job.cancelled = true;
    if (job.state !== 'complete' && job.state !== 'error') job.state = 'cancelled';
    const i = _queue.indexOf(job);
    if (i >= 0) _queue.splice(i, 1);
    log(`[assessment] ${job.sourceId} cancelled (${why})`);
  }

  async function _readOne(job, file) {
    for (let attempt = 0; ; attempt++) {
      if (job.cancelled) return null;
      try {
        return captureEvidence(await readTags(file.path, file.type), file.type);
      } catch (err) {
        // The shared pool is restarted when the main window closes; retry briefly.
        if (attempt >= READ_RETRY_DELAYS_MS.length) {
          log(`[assessment] read failed ${file.name}: ${err && err.message}`);
          return captureEvidence(null, file.type);
        }
        await sleep(READ_RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  async function _waitWhilePaused(job) {
    while (!job.cancelled && isPaused()) {
      if (job.state !== 'paused') { job.state = 'paused'; _emit(true); }
      await sleep(PAUSE_POLL_MS);
    }
    if (!job.cancelled && job.state === 'paused') { job.state = 'reading'; _emit(true); }
  }

  async function _run(job) {
    _jobsStarted++;
    job.startedAt = Date.now();
    job.state = 'scanning';
    _emit(true);
    job.identity = await statMount(job.mountpoint);
    if (!job.identity) throw new Error('card not readable');
    const files = await listMedia(job.mountpoint);
    if (job.cancelled) return;
    job.total = files.length;
    job.state = 'reading';
    _emit(true);

    const evidence = new Array(files.length);
    let next = 0;
    const worker = async () => {
      while (!job.cancelled) {
        await _waitWhilePaused(job);
        const i = next++;
        if (i >= files.length || job.cancelled) return;
        evidence[i] = await _readOne(job, files[i]);
        job.done++;
        _emit();
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, files.length)) }, worker));
    if (job.cancelled) return;

    // A card pulled mid-scan leaves a partial listing; never present that as a result.
    const after = await statMount(job.mountpoint);
    if (!after || after.dev !== job.identity.dev || after.ino !== job.identity.ino) throw new Error('card removed during assessment');

    job.records = resolvePairs(files.map((f, i) => ({ path: f.path, name: f.name, type: f.type, size: f.size, evidence: evidence[i] })));
    job.state = 'complete';
    job.finishedAt = Date.now();
    log(`[assessment] ${job.sourceId} complete: ${files.length} file(s) in ${job.finishedAt - job.startedAt} ms`);
  }

  function _pump() {
    if (_running || _stopped) return;
    const job = _queue.shift();
    if (!job) return;
    _running = job;
    _run(job)
      .catch((err) => {
        if (job.cancelled) return;
        job.state = 'error';
        job.error = 'The card could not be read.';
        log(`[assessment] ${job.sourceId} error: ${err && err.message}`);
      })
      .finally(() => {
        _running = null;
        _emit(true);
        _pump();
      });
  }

  /**
   * Reconciles jobs with the current poll. Idempotent: an attached card keeps its job.
   * @param {Array<{sourceId: string, mountpoint: string, label: string}>} cards
   */
  function sync(cards) {
    if (_stopped) return;
    const present = new Map((cards || []).filter(c => c && c.sourceId && c.mountpoint).map(c => [c.sourceId, c]));
    let changed = false;
    for (const [id, job] of _jobs) {
      const card = present.get(id);
      if (!card || card.mountpoint !== job.mountpoint) {
        _cancel(job, 'card removed');
        _jobs.delete(id);
        changed = true;
      }
    }
    for (const card of present.values()) {
      if (!_jobs.has(card.sourceId)) { _enqueue(_newJob(card)); changed = true; }
    }
    if (changed) _emit(true);
    revalidate();
  }

  /** Re-checks finished jobs' mount identity; a different volume is assessed afresh. */
  function revalidate() {
    for (const job of _jobs.values()) {
      if (job.state !== 'complete' || !job.identity) continue;
      statMount(job.mountpoint).then((now) => {
        if (_jobs.get(job.sourceId) !== job) return;
        if (now && now.dev === job.identity.dev && now.ino === job.identity.ino) return;
        _cancel(job, 'volume changed');
        _jobs.delete(job.sourceId);
        _enqueue(_newJob(job));
        _emit(true);
      }).catch(() => {});
    }
  }

  /** @returns {object|null} the job for an attached card (records are main-only data) */
  function get(sourceId) { return _jobs.get(sourceId) || null; }

  /** Confirms the job is complete and its volume is still the one that was assessed. */
  async function verify(sourceId) {
    const job = _jobs.get(sourceId);
    if (!job || job.state !== 'complete') return null;
    const now = await statMount(job.mountpoint);
    if (!now || now.dev !== job.identity.dev || now.ino !== job.identity.ino) return null;
    return _jobs.get(sourceId) === job ? job : null;
  }

  function shutdown() {
    _stopped = true;
    if (_emitTimer) { clearTimeout(_emitTimer); _emitTimer = null; }
    for (const job of _jobs.values()) _cancel(job, 'shutdown');
    _jobs.clear();
    _queue.length = 0;
  }

  function getDiagnostics() {
    return {
      jobsStarted: _jobsStarted,
      running: _running ? _running.sourceId : null,
      queued: _queue.map(j => j.sourceId),
      jobs: [..._jobs.values()].map(j => ({
        sourceId: j.sourceId, state: j.state, done: j.done, total: j.total,
        durationMs: j.finishedAt && j.startedAt ? j.finishedAt - j.startedAt : null,
      })),
    };
  }

  return { sync, revalidate, get, verify, shutdown, getDiagnostics };
}

module.exports = { createCardAssessor, DEFAULT_CONCURRENCY };
