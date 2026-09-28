// renderer/importSessionRunner.js
// ── ImportSessionRunner — executes an N-event import plan ─────────────────────
//
// A multi-event source import is an ORCHESTRATION of independent per-event transactions,
// not one filesystem-atomic operation. Each event still goes through the existing, unchanged
// `import:commitTransaction` (copy engine, locks, atomic event.json commit, metadata batch);
// this module only decides ordering, failure isolation and stop conditions.
//
//   Single Event → a one-event plan       Multi Event → an N-event plan       (same runner)
//
// Failure policy
//   • Event-local failure (lock busy, destination/mirror problem, event.json transaction
//     failure, …)                → that event is 'failed'; later events still run.
//   • Source-wide fatal condition (explicit abort, source disconnected / no longer safely
//     readable, cancelled copy)  → the run stops; every remaining event is 'not-started'.
//   • Per-file errors inside a committed transaction keep the existing continue-on-error
//     behaviour; the event is 'completed-with-errors', never reported as fully successful.
//
// Abort state lives HERE. The copy engine resets its own abort/pause flags at the start of
// every copyFileJobs, so an abort requested between two events would otherwise be lost.
//
// Cleanup / retry contract (consumed by the caller)
//   completedKeys — events that finished with zero errors → cleared from the ImportSession.
//   retainedKeys  — failed / not-started / completed-with-errors → stay assigned for retry. Retry never
//                   overwrites (existing copy-engine rules). The CALLER narrows a completed-with-errors
//                   event to its failed files (release of copied/skipped ones): tagged JPEG/PNG/TIFF
//                   destinations change size in place, so a same-size skip cannot be relied on for them.
//   copiedFiles   — union of copiedFiles from events whose transaction RETURNED a summary,
//                   nothing broader: the existing source-cleanup safety semantics, per event.
'use strict';

const ImportSessionRunner = (() => {

  const STATUS = Object.freeze({
    COMPLETED:             'completed',
    COMPLETED_WITH_ERRORS: 'completed-with-errors',
    FAILED:                'failed',
    NOT_STARTED:           'not-started',
  });

  /** Strip Electron's IPC wrapper ("Error invoking remote method 'X': Error: Y"). */
  function cleanMessage(err) {
    const raw = (err && err.message) || String(err);
    return raw.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || raw;
  }

  /** main.js throws this text when copyFileJobs reports wasAborted (abort or source loss). */
  function isCancelMessage(msg) {
    return /^Import was cancelled/i.test(msg || '');
  }

  function newSessionId() {
    return `ims-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * @param {object} plan  frozen plan from ImportSession.buildPlan() (must not be blocking)
   * @param {object} deps
   * @param {() => Promise<string|null>} deps.shouldStop     reason to stop before starting the next event, or null
   * @param {() => Promise<boolean>}     deps.isSourceAlive  is the source still safely readable?
   * @param {(item) => Promise<{ok:boolean, prepared?:any, error?:string}>} deps.prepareEvent
   *        per-event, non-interactive setup (e.g. Local First mirror + dest remap)
   * @param {(item, prepared, ctx:{index:number,total:number,importSessionId:string}) => Promise<object>} deps.commit
   *        runs the existing commitImportTransaction; resolves with its summary or throws
   * @param {(item, prepared) => Promise<void>} [deps.markInProgress]
   * @param {(item, prepared, err) => Promise<void>} [deps.onEventFailed]  e.g. restore status 'created'
   * @param {(item, index:number, total:number) => void} [deps.onEventStart]
   * @param {(entry) => void} [deps.onEventEnd]
   */
  async function run(plan, deps) {
    if (!plan || !Array.isArray(plan.events)) throw new Error('ImportSessionRunner.run: a plan is required');
    if (plan.hasBlocking) throw new Error('ImportSessionRunner.run: refusing to run a plan with blocking validation errors');

    const importSessionId = newSessionId();
    const total = plan.events.length;
    const entries = [];
    let fatal = null;

    // UI callbacks are advisory: a DOM exception in one must never abort the run after earlier events
    // have already committed (which would skip the session cleanup that follows).
    const notify = (fn, ...args) => {
      if (typeof fn !== 'function') return;
      try { fn(...args); } catch (err) { console.error('[ImportSessionRunner] UI callback failed:', err); }
    };

    const notStarted = (item, reason) => {
      const entry = { eventKey: item.eventKey, ordinal: item.ordinal, name: item.name, status: STATUS.NOT_STARTED, reason };
      entries.push(entry);
      notify(deps.onEventEnd, entry);
    };

    for (let index = 0; index < total; index++) {
      const item = plan.events[index];

      if (!fatal) fatal = await deps.shouldStop();
      if (fatal) { notStarted(item, fatal); continue; }

      notify(deps.onEventStart, item, index, total);

      let prepared = null;
      let entry;
      try {
        const prep = await deps.prepareEvent(item);
        if (!prep || !prep.ok) {
          entry = { eventKey: item.eventKey, ordinal: item.ordinal, name: item.name, status: STATUS.FAILED, error: (prep && prep.error) || 'Event could not be prepared for import.', fatal: false };
        } else {
          prepared = prep.prepared;
          if (deps.markInProgress) await deps.markInProgress(item, prepared);
          const summary = await deps.commit(item, prepared, { index, total, importSessionId });
          const errors = Number(summary && summary.errors) || 0;
          entry = {
            eventKey: item.eventKey, ordinal: item.ordinal, name: item.name,
            status: errors > 0 ? STATUS.COMPLETED_WITH_ERRORS : STATUS.COMPLETED,
            summary,
          };
        }
      } catch (err) {
        const message = cleanMessage(err);
        if (deps.onEventFailed) {
          try { await deps.onEventFailed(item, prepared, err); } catch { /* best effort — main already rolled back */ }
        }
        // Source-wide conditions stop everything; anything else is local to this event.
        let isFatal = isCancelMessage(message);
        if (!isFatal) {
          const stop = await deps.shouldStop();
          if (stop) { isFatal = true; fatal = stop; }
        }
        if (!isFatal) {
          let alive = true;
          try { alive = await deps.isSourceAlive(); } catch { alive = false; }
          if (!alive) { isFatal = true; fatal = 'source-disconnected'; }
        }
        if (isFatal && !fatal) fatal = 'aborted';
        entry = { eventKey: item.eventKey, ordinal: item.ordinal, name: item.name, status: STATUS.FAILED, error: message, fatal: isFatal };
      }
      entries.push(entry);
      notify(deps.onEventEnd, entry);
    }

    return _aggregate(entries, fatal, importSessionId);
  }

  function _aggregate(entries, fatal, importSessionId) {
    const totals = { copied: 0, skipped: 0, errors: 0, duration: 0 };
    const copiedFiles = [];
    const completedKeys = [];
    const retainedKeys = [];

    for (const e of entries) {
      if (e.summary) {
        totals.copied   += Number(e.summary.copied)   || 0;
        totals.skipped  += Number(e.summary.skipped)  || 0;
        totals.errors   += Number(e.summary.errors)   || 0;
        totals.duration += Number(e.summary.duration) || 0;
        // Cleanup eligibility: only files a transaction actually reported as copied.
        if (Array.isArray(e.summary.copiedFiles)) copiedFiles.push(...e.summary.copiedFiles);
      }
      if (e.status === STATUS.COMPLETED) completedKeys.push(e.eventKey);
      else retainedKeys.push(e.eventKey);
    }

    const count = (s) => entries.filter(e => e.status === s).length;
    const unfinished = count(STATUS.FAILED) + count(STATUS.NOT_STARTED);
    let status;
    if (entries.length > 0 && count(STATUS.COMPLETED) === entries.length) status = 'completed';
    else if (fatal) status = 'aborted';
    else if (unfinished === 0) status = 'completed-with-errors';   // every transaction committed; some files failed
    else if (count(STATUS.FAILED) === entries.length) status = 'failed';
    else status = 'partial';

    return { status, fatal: fatal || null, importSessionId, events: entries, totals, copiedFiles, completedKeys, retainedKeys };
  }

  return { run, STATUS, cleanMessage, newSessionId };

})();

// Node.js / test compatibility — no effect in the browser.
if (typeof module !== 'undefined') module.exports = ImportSessionRunner;
