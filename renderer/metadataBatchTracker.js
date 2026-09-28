// renderer/metadataBatchTracker.js
// ── Per-batch bookkeeping for post-import metadata batches ───────────────────
//
// A multi-event source import starts one metadata batch PER EVENT, and they overlap:
// event A's ExifTool work continues while event B is still copying. The renderer used to
// hold a single batch slot (`_metaBatchId`, `_pendingLfSyncManifest`) and to attribute a
// starting batch to "whichever event is currently active" — both wrong once the operator's
// Current Event and the event being imported can differ.
//
// This module keeps what must be per-batch, per-batch:
//   • which EVENT a batch belongs to — taken from the progress payload's own `eventPath`
//     (main echoes the identity the renderer supplied for that transaction). The fallback
//     (`fallbackEventPath`, the legacy "active event") is used ONLY when the payload carries
//     none — i.e. single-event imports and retry/reapply emitters — so their behaviour is
//     unchanged.
//   • the pending Local First sync manifest for each batch, keyed by batchId. One batch
//     finishing (or failing) can never consume, overwrite or delay another batch's manifest.
//
// Pure: no DOM, no IPC. renderer.js keeps its existing scalar `_metaBatch*` globals as a
// mirror of the most recently STARTED batch (all existing status consumers are already
// scoped by `_metaBatchEventPath`), and consults this tracker for everything batch-specific.
'use strict';

const MetadataBatchTracker = (() => {

  function create() {
    const batches   = new Map();   // batchId → record
    const manifests = new Map();   // batchId → pending Local First sync manifest
    let latestId = null;
    const MAX_FINISHED_BATCHES = 100;   // bound growth: only FINISHED batches with no pending manifest are dropped

    function _prune() {
      if (batches.size <= MAX_FINISHED_BATCHES) return;
      for (const [id, rec] of batches) {
        if (batches.size <= MAX_FINISHED_BATCHES) break;
        if (rec.finished && !manifests.has(id) && id !== latestId) batches.delete(id);
      }
    }

    /** batch_start: register the batch and its owning event. */
    function start(progress, fallbackEventPath = null) {
      const rec = {
        batchId:   progress.batchId,
        eventPath: progress.eventPath || fallbackEventPath || null,
        total:     progress.total || 0,
        done: 0, skipped: 0, failed: 0,
        errors: [],
        finished: false,
        outcome: null,           // 'complete' | 'failed' — set by the FIRST terminal event
        timestamp: null,
      };
      batches.set(rec.batchId, rec);
      latestId = rec.batchId;
      _prune();
      return rec;
    }

    /**
     * file_done / batch_complete / batch_error for a known batch.
     * @returns {{ rec, isLatest:boolean, terminal:boolean, firstTerminal:boolean }|null}  null for unknown batches
     */
    function apply(progress) {
      const rec = batches.get(progress.batchId);
      if (!rec) return null;
      let terminal = false;
      let firstTerminal = false;

      if (progress.event === 'file_done' || progress.event === 'batch_complete') {
        rec.done    = progress.done    || 0;
        rec.failed  = progress.failed  || 0;
        rec.skipped = progress.skipped || 0;
      }
      if (progress.event === 'batch_complete') {
        rec.timestamp = Date.now();
        terminal = true;
        if (!rec.finished) { rec.finished = true; rec.outcome = 'complete'; firstTerminal = true; }
      } else if (progress.event === 'batch_error') {
        rec.errors = progress.errors || [];
        terminal = true;
        if (!rec.finished) { rec.finished = true; rec.outcome = 'failed'; firstTerminal = true; }
      }
      return { rec, isLatest: rec.batchId === latestId, terminal, firstTerminal };
    }

    /**
     * Register a Local First sync manifest for its batch.
     * If that batch already reached a terminal state (metadata finished before the import's
     * IPC reply was processed), the manifest is not stored — the caller writes it now.
     * @returns {{ writeNow: null | { manifest:object, status:'complete'|'failed' } }}
     */
    function registerManifest(manifest) {
      const rec = batches.get(manifest.batchId);
      if (rec && rec.finished) return { writeNow: { manifest, status: rec.outcome } };
      manifests.set(manifest.batchId, manifest);
      return { writeNow: null };
    }

    /** Remove and return the pending manifest for exactly this batch (or null). */
    function takeManifest(batchId) {
      const m = manifests.get(batchId) || null;
      manifests.delete(batchId);
      return m;
    }

    function get(batchId)       { return batches.get(batchId) || null; }
    function getLatest()        { return latestId ? (batches.get(latestId) || null) : null; }
    function pendingManifestCount() { return manifests.size; }

    return { start, apply, registerManifest, takeManifest, get, getLatest, pendingManifestCount };
  }

  return { create };

})();

// Node.js / test compatibility — no effect in the browser.
if (typeof module !== 'undefined') module.exports = MetadataBatchTracker;
