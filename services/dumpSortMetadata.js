/**
 * dumpSortMetadata.js — background metadata for completed Sort Dump moves (AI-FEAT-064 EQI-3.1). Main process.
 *
 * A sort's file move is finished — and the operator is released — once its photos are at their final
 * folders, event.json points at them and the Dump copies are removed. Verifying the moved photos against
 * their new component's tags (and rewriting the incomplete ones) then runs here, in the background:
 *
 *   record    <event>/.autoingest/dump-sort/metadata/<txId>.json — the moved photos (event-relative), written
 *             durably BEFORE the move journal is finished, so no crash point loses the metadata work. It
 *             travels with the event folder; a userData index lists the events that have one (startup resume).
 *   verify    the existing read-only verification + the existing metadata batch (exifService.applyBatch —
 *             itself durable and resumed by metadataQueueRecovery). Files already owned by an active batch
 *             are left to it, so the same file is never written by two metadata tasks at once.
 *   locks     the photographer folders being written stay locked (re-entrant on this computer, so the next
 *             Sort Dump of the same event is not blocked) until the batch finishes. A folder locked elsewhere
 *             (or left locked by an interrupted run) is WAITED for — retried, never cleared from here.
 *   finish    the record is removed only after verification AND the rewrite batch finished. A failure keeps
 *             it (retried when Sort Dump next opens the event or AutoIngest restarts) and never touches the
 *             moved files.
 */

'use strict';

const path = require('path');
const fsp = require('fs').promises;
const journal = require('./dumpSortJournal');

const SCHEMA = 'autoingest.dumpSortMetadata';
const VERSION = 1;
const SUBDIR = 'metadata';

const recordDir = (eventPath) => path.join(journal.journalDir(eventPath), SUBDIR);
const toAbs = (root, rel) => path.join(root, ...rel.split('/'));
const TX_RE = /^ds-[a-z0-9-]+\.json$/;

/**
 * @param {object} deps
 * @param {(real: string, files: string[], hooks: { onBatchProgress: Function }) => Promise<{ checked: number, complete: number,
 *   failed: number, verificationRequired: number, queued: number, batchDone: Promise<object|null> }>} deps.verify
 * @param {(real: string, rels: string[]) => Promise<{ ok: boolean, release: Function }>} deps.holdLocks
 * @param {(real: string) => Promise<Set<string>>} deps.activeQueuedFiles   absolute paths owned by active metadata batches
 * @param {string|(() => string)|null} deps.indexFile
 * @param {(state: object) => void} [deps.emit]
 * @param {(batchProgress: object, real: string) => void} [deps.forwardBatch]
 * @param {Function} [deps.log]
 * @param {number} [deps.retryMs]   lock retry interval while waiting (default 15 s)
 */
function createDumpSortMetadata(deps) {
  const io = deps.io || fsp;
  const log = deps.log || (() => {});
  const emit = deps.emit || (() => {});
  const runs = new Map();   // txId → state (active and recently finished)
  const retries = new Map();   // txId → timer while waiting for a folder lock
  const retryMs = deps.retryMs || 15000;
  let indexChain = Promise.resolve();
  const indexFile = () => (typeof deps.indexFile === 'function' ? deps.indexFile() : deps.indexFile) || null;

  // ── userData index (startup resume only; the per-event record is authoritative) ─────────
  async function _readIndex() {
    if (!indexFile()) return [];
    try { const d = JSON.parse(await io.readFile(indexFile(), 'utf8')); return Array.isArray(d.entries) ? d.entries : []; } catch { return []; }
  }
  function _editIndex(fn) {
    if (!indexFile()) return Promise.resolve();
    indexChain = indexChain.then(async () => {
      const next = fn(await _readIndex());
      await io.mkdir(path.dirname(indexFile()), { recursive: true });
      await journal.atomicWrite(io, indexFile(), JSON.stringify({ schema: `${SCHEMA}.index`, entries: next }));
    }).catch(err => log(`[dump-sort] metadata index not updated (${err.code || 'error'})`));
    return indexChain;
  }

  /** Durably records the moved photos of one sort (idempotent per txId). Called before the journal is finished. */
  async function record(real, txId, rels, { eventName = null } = {}) {
    const dir = recordDir(real);
    await io.mkdir(dir, { recursive: true });
    const doc = { schema: SCHEMA, version: VERSION, txId, eventName: eventName || path.basename(real), files: rels, createdAt: new Date().toISOString() };
    await journal.atomicWrite(io, path.join(dir, `${txId}.json`), JSON.stringify(doc));
    await _editIndex(list => [...list.filter(e => !(e.txId === txId)), { eventPath: real, txId }]);
    return { state: 'queued', files: rels.length };
  }

  async function _records(real) {
    let names;
    try { names = await io.readdir(recordDir(real)); } catch { return []; }
    const out = [];
    for (const n of names.filter(x => TX_RE.test(x)).sort()) {
      try {
        const d = JSON.parse(await io.readFile(path.join(recordDir(real), n), 'utf8'));
        if (d && d.schema === SCHEMA && d.version === VERSION && Array.isArray(d.files)) out.push(d);
      } catch { /* unreadable: left in place, reported by busyFor */ }
    }
    return out;
  }

  function _state(txId) { return runs.get(txId); }
  function _publish(st) { emit({ ...st }); }

  /**
   * Starts the background metadata of one recorded sort. Resolves once its folder locks are held (so the
   * sort can release its own); the work itself continues in the background.
   */
  async function start(real, txId) {
    const cur = _state(txId);
    if (cur && cur.active) return { started: false, reason: 'running' };
    const rec = (await _records(real)).find(r => r.txId === txId);
    if (!rec) return { started: false, reason: 'no record' };
    clearTimeout(retries.get(txId)); retries.delete(txId);
    const hold = await deps.holdLocks(real, rec.files);
    const st = { txId, eventPath: real, eventName: rec.eventName, total: rec.files.length, verified: 0, complete: 0, queued: 0, written: 0, failed: 0, missing: 0, pending: rec.files.length, state: 'queued', active: true, message: null, at: Date.now() };
    runs.set(txId, st);
    if (!hold.ok) {
      Object.assign(st, {
        state: 'waiting', active: false, lock: { lockedBy: hold.lockedBy || null, self: !!hold.self, lockPath: hold.lockPath || null, lockPaths: hold.lockPaths || (hold.lockPath ? [hold.lockPath] : []) },
        message: hold.self
          ? 'Waiting for an archive folder lock left by an interrupted AutoIngest run on this computer. Release it to continue.'
          : `Waiting for the archive folder${hold.lockedBy ? ` (in use by ${hold.lockedBy})` : ''}. Metadata verification starts when it is free.`,
      });
      _publish(st);
      const timer = setTimeout(() => { retries.delete(txId); start(real, txId).catch(() => {}); }, retryMs);
      if (timer.unref) timer.unref();
      retries.set(txId, timer);
      return { started: false, reason: 'locked', lock: st.lock };
    }
    _publish(st);
    _process(real, rec, st, hold).catch(() => {});
    return { started: true };
  }

  async function _process(real, rec, st, hold) {
    try {
      const owned = await deps.activeQueuedFiles(real).catch(() => new Set());
      const abs = [];
      let handedOff = 0;
      for (const rel of rec.files) {
        const f = toAbs(real, rel);
        if (owned.has(path.resolve(f))) { handedOff++; continue; }   // an interrupted batch already owns it
        if (await io.stat(f).then(s => s.isFile(), () => false)) abs.push(f); else st.missing++;
      }
      Object.assign(st, { state: 'verifying', pending: abs.length });
      _publish(st);
      const r = abs.length ? await deps.verify(real, abs, {
        onBatchProgress: (p) => {
          if (p && p.event === 'file_done') { st.written = p.done || 0; st.failed = (st.verifyFailed || 0) + (p.failed || 0); st.pending = Math.max(0, st.queued - st.written - (p.failed || 0)); _publish(st); }
          if (deps.forwardBatch) { try { deps.forwardBatch(p, real); } catch { /* observer only */ } }
        },
      }) : { checked: 0, complete: 0, failed: 0, verificationRequired: 0, queued: 0, batchDone: Promise.resolve(null) };
      st.verified = r.checked || 0;
      st.complete = r.complete || 0;
      st.verifyFailed = r.failed || 0;
      st.failed = st.verifyFailed;
      st.queued = r.queued || 0;
      st.verificationRequired = r.verificationRequired || 0;
      st.pending = st.queued;
      if (st.queued) {
        st.state = 'writing';
        _publish(st);
        const b = await r.batchDone;
        st.written = (b && b.done) || 0;
        st.failed = st.verifyFailed + ((b && b.failed) || 0);
        st.pending = 0;
      }
      st.handedOff = handedOff;
      const attention = st.failed > 0 || st.missing > 0 || st.verificationRequired > 0;
      st.state = attention ? 'attention' : 'complete';
      st.message = attention ? _attentionText(st) : null;
      // Done — the record goes only now. A failed file stays failed in Metadata Audit (the existing
      // repair path); it is never retried here forever and never undoes the move.
      await io.unlink(path.join(recordDir(real), `${rec.txId}.json`)).catch(() => {});
      await _editIndex(list => list.filter(e => e.txId !== rec.txId));
      log(`[dump-sort] metadata ${st.state}: verified=${st.verified} rewritten=${st.written} failed=${st.failed} missing=${st.missing}`);
    } catch (err) {
      Object.assign(st, { state: 'attention', message: 'Metadata verification could not run. It will be retried when Sort Dump next opens this event, or use Metadata Audit.' });
      log(`[dump-sort] metadata verification failed (${err.code || 'error'})`);
    } finally {
      st.active = false;
      st.at = Date.now();
      await Promise.resolve(hold.release()).catch(() => {});
      _publish(st);
    }
  }

  function _attentionText(st) {
    const parts = [];
    if (st.failed) parts.push(`${st.failed} could not be written`);
    if (st.missing) parts.push(`${st.missing} no longer at their folder`);
    if (st.verificationRequired) parts.push(`${st.verificationRequired} need verification (auto-metadata is off)`);
    return `Metadata requires attention: ${parts.join(', ')}. Open Metadata Audit to repair.`;
  }

  /** Starts every recorded, not-running sort of this event (Sort Dump opening it, or after a restart). */
  async function resume(real) {
    const out = [];
    for (const rec of await _records(real)) {
      const st = _state(rec.txId);
      if (st && st.active) continue;
      out.push(await start(real, rec.txId).catch(() => ({ started: false })));
    }
    return out;
  }

  /** Startup: resume every indexed event whose folder is still where it was. */
  async function resumeAll() {
    const entries = await _readIndex();
    const events = [...new Set(entries.map(e => e.eventPath))];
    for (const ev of events) {
      const real = await io.realpath(ev).catch(() => null);
      if (!real) continue;   // offline or renamed outside AutoIngest — resumed when Sort Dump opens it
      await resume(real);
    }
    return events.length;
  }

  /** Why this event's folders must not be renamed now (metadata still writing to them), or null. */
  async function busyFor(real) {
    for (const st of runs.values()) if (st.active && st.eventPath === real) return 'Metadata is still being written to photos this event\'s Sort Dump moved.';
    let names = [];
    try { names = (await io.readdir(recordDir(real))).filter(x => TX_RE.test(x)); } catch { /* none */ }
    if (names.length) return 'Metadata for photos moved by Sort Dump has not been verified yet. Open Sort Dump for this event to finish it.';
    return null;
  }

  function snapshot() { return [...runs.values()].map(s => ({ ...s })); }

  return { record, start, resume, resumeAll, busyFor, snapshot, recordDir };
}

module.exports = { createDumpSortMetadata, SCHEMA };
