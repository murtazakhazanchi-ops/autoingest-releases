'use strict';

/**
 * metadataQueueRecovery.js — startup resume for interrupted metadata batches.
 *
 * Replays every active manifest+journal (metadataQueueStore), re-attempts any file
 * left non-terminal by an unclean exit, and durably reflects the outcome into the
 * owning event's event.json before compacting the batch out of the active queue dir.
 *
 * Per plan §6: recovery may re-resolve a file's evidence only as a safety comparison
 * against the frozen expectation recorded in the manifest. If they materially differ,
 * the file is marked 'stale' (re-audit required) — never silently rewritten with a
 * freshly-resolved value in place of the one the original queue decision recorded.
 */

const fsp = require('fs/promises');
const path = require('path');
const queueStore = require('./metadataQueueStore');
const exifService = require('./exifService');
const { resolveExpectedMetadata } = require('../services/metadataExpectationService');
const metadataStateService = require('./metadataStateService');
const { buildFileEvidence } = require('../services/eventEvidenceReconstruction');

const RESUME_CONCURRENCY = 2;

function _expectationsEqual(a, b) {
  if (!a || !b) return a === b;
  const norm = e => JSON.stringify({
    status: e.status, photographer: e.photographer,
    component: e.component ? {
      location: e.component.location || '', city: e.component.city || '', country: e.component.country || '',
      types: Array.isArray(e.component.types) ? [...e.component.types].sort() : e.component.types,
      folderName: e.component.folderName || null,
    } : null,
    keywords: Array.isArray(e.keywords) ? [...e.keywords].sort() : e.keywords,
    hijriDate: e.hijriDate, eventDescription: e.eventDescription, copyright: e.copyright,
  });
  return norm(a) === norm(b);
}

async function _readLiveEventJson(eventJsonPath) {
  try {
    return JSON.parse(await fsp.readFile(eventJsonPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Rebuilds evidence from CURRENT event.json ground truth — the same folder-structure
 * reconstruction (services/eventEvidenceReconstruction.js) main.js's Transfer Import
 * verification and the Phase E audit scanner also use — so the resume staleness check
 * compares against live state, not a replay of the very evidence object being checked
 * (which would trivially always match itself: `entry.expectation` was itself computed
 * as `resolveExpectedMetadata(entry.evidence)`, so re-resolving `entry.evidence` again
 * can only ever reproduce it identically).
 *
 * QMZ-shape evidence (`qmzComponent`) has no independent live source to re-derive from
 * — the sequence-component assignment isn't stored in event.json and no UI edits it
 * after assignment — so there's no realistic drift vector; returns null to signal
 * "trust the frozen value, nothing to compare against" rather than a tautology.
 */
function _buildFreshEvidenceForFile(entry, liveEventJson, eventJsonPath) {
  const frozen = entry.evidence;
  if (!frozen || frozen.qmzComponent !== undefined || !liveEventJson) return null;
  return buildFileEvidence(path.dirname(eventJsonPath), liveEventJson, entry.dest);
}

async function _mapLimit(items, limit, fn) {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * @returns {Promise<{batchesScanned:number, filesResumed:number, filesStale:number, eventsUpdated:number}>}
 */
async function resumeInterruptedBatches() {
  const batchIds = await queueStore.listActiveBatchIds();
  const summary = { batchesScanned: batchIds.length, filesResumed: 0, filesStale: 0, eventsUpdated: 0 };

  // eventJsonPath -> batchId[] whose file-level recovery is done and are waiting on
  // that event's single state persist before they can compact. Batches with no
  // eventJsonPath have nothing to persist and compact immediately.
  const batchesByEvent = new Map();
  const noEventBatchIds = [];

  for (const batchId of batchIds) {
    const manifest = await queueStore.readManifest(batchId);
    if (!manifest || !Array.isArray(manifest.files)) continue;

    const journal = await queueStore.readJournal(batchId);
    const fileStates = queueStore.computeFileStates(manifest, journal);

    const interrupted = manifest.files.filter(f => fileStates.get(f.dest)?.status === 'interrupted');
    const liveEventJson = manifest.eventJsonPath ? await _readLiveEventJson(manifest.eventJsonPath) : null;

    await _mapLimit(interrupted, RESUME_CONCURRENCY, async (entry) => {
      if (entry.isVideo) {
        // Never written in the first place; a crash before the original 'excluded'
        // journal entry landed must not leave this file permanently 'interrupted'.
        await queueStore.appendJournalEntry(batchId, { dest: entry.dest, status: 'excluded', classification: 'excluded' });
        return;
      }
      const freshEvidence = _buildFreshEvidenceForFile(entry, liveEventJson, manifest.eventJsonPath);
      const fresh = freshEvidence ? resolveExpectedMetadata(freshEvidence) : null;
      if (fresh && !_expectationsEqual(fresh, entry.expectation)) {
        await queueStore.appendJournalEntry(batchId, {
          dest: entry.dest, status: 'stale',
          error: 'Evidence changed since this file was queued for metadata — re-audit required, not silently re-resolved.',
        });
        summary.filesStale++;
        return;
      }
      await exifService.resumeFrozenFile(batchId, { dest: entry.dest, isRaw: entry.isRaw, expectation: entry.expectation });
      summary.filesResumed++;
    });

    if (manifest.eventJsonPath) {
      if (!batchesByEvent.has(manifest.eventJsonPath)) batchesByEvent.set(manifest.eventJsonPath, []);
      batchesByEvent.get(manifest.eventJsonPath).push(batchId);
    } else {
      noEventBatchIds.push(batchId);
    }
  }

  // Persist state ONCE per distinct event, not once per batch. computeEventDurableCounts
  // already re-scans every active batch internally on each call — calling it once per
  // batch (the original shape) made this whole function O(active-batch-count²): measured
  // ~20s at 500 active batches vs. ~60ms at 0. Compacting every batch for an event only
  // after that event's single persist call succeeds preserves the original ordering
  // guarantee (never compact before event.json durably reflects the outcome).
  for (const [eventJsonPath, ids] of batchesByEvent) {
    try {
      await metadataStateService.persistEventMetadataState(eventJsonPath);
      summary.eventsUpdated++;
    } catch (err) {
      console.error(`[metadataQueueRecovery] Failed to persist metadata state for ${eventJsonPath}: ${err.message}`);
      continue; // event.json doesn't durably reflect these batches yet — do not compact any of them.
    }
    for (const batchId of ids) {
      await queueStore.compactBatch(batchId);
    }
  }

  for (const batchId of noEventBatchIds) {
    await queueStore.compactBatch(batchId);
  }

  return summary;
}

module.exports = {
  resumeInterruptedBatches,
  // Test-only: exposes the staleness comparator so test/fieldSpecsConsistency.test.js
  // can behaviorally verify it stays in sync with the resolver's field set (closure
  // item #10's interim guardrail). Not part of the module's real public API.
  _expectationsEqual,
};
