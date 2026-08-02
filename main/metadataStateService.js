'use strict';

/**
 * metadataStateService.js — durable, mutually-exclusive event-level metadata state.
 *
 * The event-level state is never a field one callback happens to overwrite last —
 * it is a pure derivation from durable per-file counts, recomputed fresh every time
 * it's needed. deriveState() below is a decision tree of genuinely mutually-exclusive
 * conditions (each condition, given the ones checked before it were false, is
 * exclusive of them by construction — not an arbitrary priority resolving real
 * overlaps). See docs/CLAUDE.md-routed plan section §4 for the full rationale.
 *
 * computeEventDurableCounts() derives those counts from the metadata-queue
 * manifest+journal records (metadataQueueStore) belonging to a given event.json path,
 * merged by destination path so a later batch (e.g. a retry or reapply) correctly
 * supersedes an earlier one's outcome for the same file — never double-counted.
 */

const path = require('path');
const queueStore = require('./metadataQueueStore');

/**
 * @param {{
 *   eligible: number,
 *   complete: number, failed: number, ambiguous: number, stale: number,
 *   verificationRequired: number, queued: number, active: number, interrupted: number,
 * }} counts Video-excluded files must never be included in `eligible` or any other count here.
 * @returns {string} one of the 9 mutually-exclusive event-level states.
 */
function deriveState(counts) {
  const c = {
    eligible: 0, complete: 0, failed: 0, ambiguous: 0, stale: 0,
    verificationRequired: 0, queued: 0, active: 0, interrupted: 0,
    ...counts,
  };

  if (c.eligible === 0) return 'metadata-not-required';                        // 1
  if (c.interrupted > 0) return 'metadata-interrupted';                        // 2
  if (c.active > 0) return 'metadata-in-progress';                            // 3
  if (c.complete === c.eligible) return 'metadata-complete';                  // 4

  const incomplete = c.failed + c.ambiguous + c.stale + c.verificationRequired + c.queued;
  if (c.complete > 0 && incomplete > 0) return 'metadata-partial';           // 5
  if (c.complete === 0 && c.failed > 0) return 'metadata-failed';            // 6

  // 7: nothing complete/failed/queued, but something unverified remains
  // (ambiguous/stale/verification-required — Transfer Import / same-size-skip land here).
  if (c.complete === 0 && c.failed === 0 && c.queued === 0
      && (c.ambiguous + c.stale + c.verificationRequired) > 0) {
    return 'metadata-verification-required';
  }
  if (c.queued > 0) return 'metadata-queued';                                // 8
  return 'metadata-not-attempted';                                           // 9
}

// Terminal per-file journal statuses (as written by exifService) mapped to the
// durable count bucket they contribute to. 'skipped' covers the classification-less
// legacy skip path defensively; real skips always carry a classification.
function _bucketForFileState(fileState) {
  const status = fileState.status;
  if (status === 'interrupted') return 'interrupted';
  if (status === 'writing' || status === 'queued') return 'active';
  const classification = fileState.lastEntry?.classification || null;
  if (status === 'complete' || classification === 'complete') return 'complete';
  // A 'partial' write landed some fields but read-back found mismatches — it did not
  // achieve verified compliance, so it must never count toward 'complete' (that would
  // durably report metadata-complete for a batch that silently wrote wrong values —
  // exactly the class of bug this whole redesign exists to make visible). Folded into
  // the same bucket as 'failed' rather than getting its own durable-state bucket: the
  // per-file classification detail ('partial' vs 'failed') remains recoverable from the
  // journal/manifest for audit; only the coarse 9-state rollup collapses them.
  if (status === 'partial' || classification === 'partial') return 'failed';
  if (status === 'failed' || classification === 'failed') return 'failed';
  if (status === 'ambiguous' || classification === 'ambiguous') return 'ambiguous';
  if (status === 'stale') return 'stale'; // resume's safety comparison found evidence drift — re-audit required.
  if (status === 'excluded' || classification === 'excluded') return null; // video-excluded — never eligible.
  return 'failed';
}

/**
 * Scans every metadata-queue manifest whose eventJsonPath matches, replays its
 * journal, and merges per-destination-path outcomes across batches (latest terminal
 * entry wins per dest — so a retry or reapply batch correctly supersedes an earlier
 * batch's outcome for the same file, never double-counted).
 * @param {string} eventJsonPath Absolute path to the event's event.json.
 * @param {{extraCounts?: object}} [opts] Additional counts to merge in (e.g. Transfer
 *   Import / same-size-skip verification-required files, which have no queue manifest
 *   until they're actually queued for repair).
 * @returns {Promise<object>} durable counts, ready for deriveState().
 */
async function computeEventDurableCounts(eventJsonPath, opts = {}) {
  const normEventPath = path.normalize(eventJsonPath);
  const batchIds = await queueStore.listActiveBatchIds();

  // dest -> { bucket, batchManifestWrittenAt }
  const latestByDest = new Map();

  for (const batchId of batchIds) {
    const manifest = await queueStore.readManifest(batchId);
    if (!manifest || path.normalize(manifest.eventJsonPath || '') !== normEventPath) continue;
    const journal = await queueStore.readJournal(batchId);
    const fileStates = queueStore.computeFileStates(manifest, journal);
    const writtenAt = manifest.queuedAt || '1970-01-01T00:00:00.000Z';

    for (const [dest, fileState] of fileStates) {
      const bucket = _bucketForFileState(fileState);
      if (bucket === null) continue; // video-excluded — not eligible, never counted.
      const prior = latestByDest.get(dest);
      if (!prior || writtenAt >= prior.writtenAt) {
        latestByDest.set(dest, { bucket, writtenAt });
      }
    }
  }

  const counts = {
    eligible: latestByDest.size, complete: 0, failed: 0, ambiguous: 0, stale: 0,
    verificationRequired: 0, queued: 0, active: 0, interrupted: 0,
  };
  for (const { bucket } of latestByDest.values()) {
    counts[bucket] = (counts[bucket] || 0) + 1;
  }

  // extraCounts (e.g. Transfer Import / same-size-skip verification-required files
  // with no queue manifest yet) must include its own `eligible` total — merged
  // additively into every bucket, never overwriting the manifest-derived counts.
  const extra = opts.extraCounts || {};
  for (const key of Object.keys(extra)) {
    counts[key] = (counts[key] || 0) + (extra[key] || 0);
  }

  return counts;
}

/**
 * Computes durable counts + derived state and persists both into event.json's
 * metadataState block via updateEventJsonAtomic — the state is always re-derivable
 * from the counts, never independently settable.
 * @param {string} eventJsonPath
 * @param {{extraCounts?: object}} [opts]
 */
async function persistEventMetadataState(eventJsonPath, opts = {}) {
  const { updateEventJsonAtomic } = require('./eventJsonStore');
  const counts = await computeEventDurableCounts(eventJsonPath, opts);
  const state = deriveState(counts);
  await updateEventJsonAtomic(eventJsonPath, () => ({
    metadataState: { counts, state, updatedAt: new Date().toISOString() },
  }));
  return { counts, state };
}

module.exports = { deriveState, computeEventDurableCounts, persistEventMetadataState };
