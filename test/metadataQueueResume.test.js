'use strict';

// Proves crash/restart recovery for the metadata queue: a hand-constructed manifest +
// partial journal (per plan §6's allowed fallback when a real SIGKILL-and-relaunch of
// the whole Electron app isn't practical inside a test harness) simulating exactly
// what an unclean exit leaves on disk — one file's journal already shows a terminal
// 'complete' entry, the other shows a non-terminal 'writing' entry (crash mid-write) —
// and asserts resumeInterruptedBatches() correctly: leaves the already-complete file
// untouched (no duplicate write), completes the interrupted file for real via ExifTool,
// and durably reflects the final state into event.json before compacting the batch.
//
// Run with the real Electron binary (exifService.js transitively needs Electron's
// app.getPath via services/logger.js and services/settings.js):
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --no-sandbox \
//     --user-data-dir=<isolated tmp dir> test/metadataQueueResume.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

process.env.AUTOINGEST_METADATA_QUEUE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-mq-resume-queue-'));

const queueStore = require('../main/metadataQueueStore');
const { resumeInterruptedBatches } = require('../main/metadataQueueRecovery');
const { resolveExpectedMetadata } = require('../services/metadataExpectationService');
const { readFileTags, shutdown } = require('../main/exifService');

let passed = 0;
async function t(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok — ${name}`);
  } catch (err) {
    console.error(`  FAIL — ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function mkFixture() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-mq-resume-'));
  const eventJsonPath = path.join(dir, 'event.json');
  await fsp.writeFile(eventJsonPath, JSON.stringify({
    version: 1, hijriDate: '1448-03-01', eventName: 'Waaz Mubarak', status: 'complete',
    components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
  }, null, 2), 'utf8');

  // Files live under a photographer folder, matching the real archive-naming
  // convention (and the same folder-structure convention resume's fresh-evidence
  // reconstruction relies on — see _resolvePhotographerFromPath in
  // metadataQueueRecovery.js, mirroring main.js's Transfer Import verification).
  const photoDir = path.join(dir, 'Fatema Rasheed');
  await fsp.mkdir(photoDir, { recursive: true });

  // .cr2 (RAW) so exifService writes to a fresh XMP sidecar it creates itself,
  // matching test/rawXmpReadback.test.js's proven pattern — sidesteps needing a
  // byte-valid JPEG, which real ExifTool refuses to rewrite in place.
  const file1 = path.join(photoDir, 'IMG_0001.cr2');
  const file2 = path.join(photoDir, 'IMG_0002.cr2');
  await fsp.writeFile(file1, Buffer.from('not-a-real-raw-file-just-bytes'));
  await fsp.writeFile(file2, Buffer.from('not-a-real-raw-file-just-bytes'));

  return { dir, eventJsonPath, file1, file2 };
}

function evidence(filePath, eventJson) {
  return {
    filePath, photographer: 'Fatema Rasheed', hijriDate: eventJson.hijriDate,
    eventDescription: eventJson.eventName,
    groups: [{ id: 'root', subEventId: null, files: [filePath] }],
    diskComponents: eventJson.components,
  };
}

(async () => {
  console.log('metadataQueueResume (hand-constructed crash/restart simulation, real ExifTool)');

  await t('interrupted file is completed on resume; already-complete file is left untouched; event.json reflects final state; batch is compacted', async () => {
    const { dir, eventJsonPath, file1, file2 } = await mkFixture();
    const sidecar1 = file1.slice(0, -path.extname(file1).length) + '.xmp';
    const sidecar2 = file2.slice(0, -path.extname(file2).length) + '.xmp';
    const eventJson = JSON.parse(fs.readFileSync(eventJsonPath, 'utf8'));

    const exp1 = resolveExpectedMetadata(evidence(file1, eventJson));
    const exp2 = resolveExpectedMetadata(evidence(file2, eventJson));
    assert.equal(exp1.status, 'resolved');
    assert.equal(exp2.status, 'resolved');

    const batchId = `resume-test-${Date.now()}`;
    const manifest = {
      schemaVersion: 1, batchId, metadataContractVersion: 1, resolverVersion: 1,
      archiveRootIdentity: null, eventJsonPath, queuedAt: new Date().toISOString(),
      files: [
        { src: file1, dest: file1, relDestPath: 'IMG_0001.cr2', size: 4, isRaw: true, isVideo: false, evidence: evidence(file1, eventJson), expectation: exp1 },
        { src: file2, dest: file2, relDestPath: 'IMG_0002.cr2', size: 4, isRaw: true, isVideo: false, evidence: evidence(file2, eventJson), expectation: exp2 },
      ],
    };
    await queueStore.writeManifestOnce(batchId, manifest);

    // file1: simulate it finished successfully before the crash (real write, so we
    // can later prove resume does NOT touch it again).
    const { applyBatch, getBatchStatus } = require('../main/exifService');
    const preBatchId = `${batchId}-pre`;
    applyBatch(preBatchId, [{ src: file1, dest: file1 }], {
      photographer: 'Fatema Rasheed', hijriDate: eventJson.hijriDate, eventDescription: eventJson.eventName,
      groups: [], diskComponents: eventJson.components,
    }, null);
    for (let i = 0; i < 200; i++) {
      const s = getBatchStatus(preBatchId);
      if (s && (s.done + s.skipped + s.failed) >= s.total) break;
      await new Promise(r => setTimeout(r, 50));
    }
    assert.equal(getBatchStatus(preBatchId).done, 1, 'pre-write setup itself must succeed for this test to be meaningful');
    await queueStore.appendJournalEntry(batchId, { dest: file1, status: 'complete', classification: 'complete' });
    const mtimeAfterFirstWrite = (await fsp.stat(sidecar1)).mtimeMs;

    // file2: crash happened mid-write — only a non-terminal 'writing' entry landed.
    await queueStore.appendJournalEntry(batchId, { dest: file2, status: 'writing' });

    // Sanity: file2 has no sidecar yet (the crash happened before the real write).
    assert.equal(fs.existsSync(sidecar2), false);

    await new Promise(r => setTimeout(r, 20)); // ensure a distinguishable mtime if file1 were (wrongly) rewritten.
    const summary = await resumeInterruptedBatches();
    assert.ok(summary.batchesScanned >= 1);
    assert.equal(summary.filesResumed, 1);
    assert.equal(summary.filesStale, 0);

    // file2 was actually completed for real via ExifTool.
    const postTags = await readFileTags(sidecar2);
    assert.equal(postTags.Creator?.[0] || postTags.Creator, 'Fatema Rasheed');
    assert.ok(String(postTags.Subject || postTags.Keywords).includes('Majlis'));

    // file1 was never touched again — no duplicate write.
    const mtimeAfterResume = (await fsp.stat(sidecar1)).mtimeMs;
    assert.equal(mtimeAfterFirstWrite, mtimeAfterResume);

    // event.json durably reflects the final rolled-up state.
    const finalDoc = JSON.parse(fs.readFileSync(eventJsonPath, 'utf8'));
    assert.equal(finalDoc.metadataState.state, 'metadata-complete');
    assert.equal(finalDoc.metadataState.counts.eligible, 2);
    assert.equal(finalDoc.metadataState.counts.complete, 2);

    // Batch was compacted out of the active queue dir only after event.json was updated.
    const active = await queueStore.listActiveBatchIds();
    assert.ok(!active.includes(batchId));
  });

  await t('event.json edited since queueing (component location changed) → resume marks the file stale, never silently rewrites with fresh evidence', async () => {
    const { dir, eventJsonPath, file1 } = await mkFixture();
    const sidecar1 = file1.slice(0, -path.extname(file1).length) + '.xmp';
    const eventJson = JSON.parse(fs.readFileSync(eventJsonPath, 'utf8'));
    const frozenExpectation = resolveExpectedMetadata(evidence(file1, eventJson));

    const batchId = `resume-stale-test-${Date.now()}`;
    const manifest = {
      schemaVersion: 1, batchId, metadataContractVersion: 1, resolverVersion: 1,
      archiveRootIdentity: null, eventJsonPath, queuedAt: new Date().toISOString(),
      files: [{
        src: file1, dest: file1, relDestPath: 'Fatema Rasheed/IMG_0001.cr2', size: 4, isRaw: true, isVideo: false,
        // Frozen expectation + the evidence it was resolved from, exactly as the real
        // write path (_writeBatchManifest) records both together.
        expectation: frozenExpectation,
        evidence: evidence(file1, eventJson),
      }],
    };
    await queueStore.writeManifestOnce(batchId, manifest);
    await queueStore.appendJournalEntry(batchId, { dest: file1, status: 'writing' });

    // The world changed after queuing: an operator edited the event's component
    // location on disk (event-edit-after-import) before the app crashed/restarted.
    // Resume's staleness check must catch this by comparing against LIVE event.json —
    // re-resolving the frozen evidence object against itself (the pre-fix behavior)
    // could never have detected this, since it never reads live state at all.
    const editedEventJson = { ...eventJson, components: [{ ...eventJson.components[0], location: 'Hall B' }] };
    await fsp.writeFile(eventJsonPath, JSON.stringify(editedEventJson, null, 2), 'utf8');

    const summary = await resumeInterruptedBatches();
    assert.equal(summary.filesStale, 1);
    assert.equal(summary.filesResumed, 0);

    // Never written at all — a stale file must not produce even a partial/wrong write.
    assert.equal(fs.existsSync(sidecar1), false);

    const finalDoc = JSON.parse(fs.readFileSync(eventJsonPath, 'utf8'));
    assert.equal(finalDoc.metadataState.counts.stale, 1);
    assert.equal(finalDoc.metadataState.state, 'metadata-verification-required');
  });

  await t('resumeInterruptedBatches scales roughly linearly, not quadratically, in active-batch count (regression guard for a real measured 20s-at-500-batches bug)', async () => {
    // Independently reviewed and measured before this fix: persistEventMetadataState
    // was called once PER BATCH (not once per distinct event), and it internally
    // re-scans every active batch — making the whole function O(active-batches²).
    // 500 active batches across a single event measured ~20s before the fix; this
    // asserts a generous ceiling well above the ~400ms now observed, to catch a real
    // regression back to quadratic behavior without being flaky on a slow machine.
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-mq-resume-scale-'));
    const eventJsonPath = path.join(dir, 'event.json');
    await fsp.writeFile(eventJsonPath, JSON.stringify({ version: 1, status: 'complete', components: [] }, null, 2), 'utf8');

    const N = 300;
    for (let i = 0; i < N; i++) {
      const batchId = `scale-${i}`;
      await queueStore.writeManifestOnce(batchId, {
        schemaVersion: 1, batchId, eventJsonPath, queuedAt: new Date().toISOString(),
        files: [{ dest: `/fake/${i}.jpg`, isVideo: false, isRaw: false, expectation: {}, evidence: {} }],
      });
      // Already-complete — isolates the persist/compact cost this test targets,
      // no real ExifTool work needed for a scale probe.
      await queueStore.appendJournalEntry(batchId, { dest: `/fake/${i}.jpg`, status: 'complete', classification: 'complete' });
    }

    const t0 = Date.now();
    const summary = await resumeInterruptedBatches();
    const elapsed = Date.now() - t0;
    assert.equal(summary.batchesScanned, N);
    assert.equal(summary.eventsUpdated, 1, 'must persist state once for the one distinct event, not once per batch');
    assert.ok(elapsed < 8000, `resumeInterruptedBatches(${N} batches, 1 event) took ${elapsed}ms — expected well under 8000ms; quadratic regression suspected`);
  });

  await shutdown().catch(() => {});
  console.log(`${passed} passed`);
  if (process.exitCode) console.log('SOME TESTS FAILED');
  process.exit(process.exitCode || 0);
})();
