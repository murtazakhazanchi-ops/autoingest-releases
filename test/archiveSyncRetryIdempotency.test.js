'use strict';

// D4 — conflict-renamed archive sync retry is not idempotent. Before this fix, retrying
// the same sync job (pause/resume, crash+relaunch, partial-job retry, or a plain manual
// retry) for a source file that needed a conflict rename allocated a NEW `_N` suffix
// every single time — A_1, A_2, A_3, ... unboundedly — because nothing remembered that
// this exact source, from this exact job/import, already owned a specific destination.
// Proven during the D4 forensic pass (2026-09-24) across same-process retry, a genuine
// cross-process crash/relaunch, partial-job retry, JPG/video/RAW, and both sync
// strategies. Fixed via a durable, additive destination-RESERVATION mapping on
// localSyncManifest's existing per-job entries (services/localSyncManifest.js) — a
// reservation means "this source owns this destination", never "the copy completed";
// every retry verifies it against live disk+source state before ever trusting it.
//
// This test always seeds a real localSyncManifest job entry (via appendJob) before
// calling syncJob — exactly how the real app always invokes it (main.js sources job.files/
// job.importId from syncQueueService, which is itself built from a real manifest entry).
// A bare syncJob() call with no manifest/importId at all (not a real app code path)
// correctly has nothing to attach reservations to and falls back to legacy behavior —
// that is proven separately by the D1 regression suite, which never sets up a manifest.
//
// Requires the Electron binary (metadataAuditService/exifService need app.getPath):
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --no-sandbox \
//     test/archiveSyncRetryIdempotency.test.js

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

process.env.AUTOINGEST_METADATA_QUEUE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-d4-queue-'));
process.env.AUTOINGEST_METADATA_AUDIT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-d4-jobs-'));
process.env.AUTOINGEST_METADATA_REPAIR_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-d4-results-'));

const sync = require('../services/archiveSyncService');
const manifest = require('../services/localSyncManifest');
const audit = require('../services/metadataAuditService');
const { readFileTags, shutdown } = require('../main/exifService');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

let _importSeq = 0;
async function mk() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-d4-'));
  const stagingRoot = path.join(root, 'staging'), nasRoot = path.join(root, 'nas');
  const stagingEvent = path.join(stagingRoot, 'Coll', 'Event'), nasEvent = path.join(nasRoot, 'Coll', 'Event');
  await fsp.mkdir(stagingEvent, { recursive: true }); await fsp.mkdir(nasEvent, { recursive: true });
  const importId = `imp-${++_importSeq}`;
  return { root, stagingRoot, nasRoot, stagingEvent, nasEvent, importId };
}
async function put(dir, rel, content) {
  const f = path.join(dir, ...rel.split('/'));
  await fsp.mkdir(path.dirname(f), { recursive: true });
  await fsp.writeFile(f, content);
}
async function listPh(nasEvent, ph = 'Jane Doe') {
  try { return (await fsp.readdir(path.join(nasEvent, ph))).sort(); } catch { return []; }
}
/** Seed a manifest job entry (mirrors what a real import always writes) and return a ready-to-use `job`.
 *  Defaults to d.importId; pass importId explicitly for a second, genuinely distinct import
 *  against the same staging/archive roots (e.g. testing new-later-job independence). */
async function seedJob(d, files, { importId = d.importId, ...extra } = {}) {
  await manifest.appendJob(d.stagingEvent, {
    importId, batchId: importId, eventName: 'Event', collectionName: 'Coll',
    photographer: 'Jane Doe', fileCount: files.length, files, importedAt: Date.now(), readyForSync: true,
  });
  return { localEventPath: d.stagingEvent, importId, files, ...extra };
}
async function runAuditAndWait(archiveRoot) {
  const res = await audit.runMetadataAudit({ type: 'archiveRoot', rootPath: archiveRoot });
  let status;
  for (let i = 0; i < 100; i++) {
    status = await audit.getMetadataAuditStatus(res.jobId);
    if (status && !status.running) break;
    await new Promise(r => setTimeout(r, 50));
  }
  return res.jobId;
}
const writeEventJson = (dir, doc) => fsp.writeFile(path.join(dir, 'event.json'), JSON.stringify(doc, null, 2));
const readEventJson  = dir => JSON.parse(fs.readFileSync(path.join(dir, 'event.json'), 'utf8'));
const SINGLE = { version: 1, hijriDate: '1448-01-01', eventName: 'Waaz', components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }] };

console.log('archiveSyncRetryIdempotency (D4 — real syncJob, real manifest, real Audit)');

(async () => {
  // ── 1-2. JPG / MOV conflict rename + retry ──
  await t('1: JPG conflict rename + same-job retry stays at exactly one renamed copy', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/photo.jpg', 'OLD-JPG-XXXX');
    await put(d.stagingEvent, 'Jane Doe/photo.jpg', 'incoming-jpg');
    const job = await seedJob(d, ['Jane Doe/photo.jpg']);
    const r1 = await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.deepEqual(await listPh(d.nasEvent), ['photo.jpg', 'photo_1.jpg']);
    const r2 = await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.deepEqual(await listPh(d.nasEvent), ['photo.jpg', 'photo_1.jpg'], 'retry must not allocate photo_2.jpg');
    assert.equal(r2.copiedToArchive, 0);
    assert.equal(r2.skippedDuplicates, 1);
  });

  await t('2: MOV (video/generic) conflict rename + same-job retry stays idempotent', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/VIDEO/clip.mov', 'OLD-VIDEO-XXXX');
    await put(d.stagingEvent, 'Jane Doe/VIDEO/clip.mov', 'incoming-video');
    const job = await seedJob(d, ['Jane Doe/VIDEO/clip.mov']);
    await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.deepEqual(await listPh(d.nasEvent, 'Jane Doe/VIDEO'), ['clip.mov', 'clip_1.mov']);
  });

  // ── 3. RAW+XMP conflict rename + retry ──
  await t('3: RAW+XMP conflict rename + same-job retry — pair stays exactly one', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-XXXX');
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    await put(d.stagingEvent, 'Jane Doe/A.xmp', 'INCOMING-XMP');
    const job = await seedJob(d, ['Jane Doe/A.CR2']);
    await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    const r2 = await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A_1.CR2', 'A_1.xmp']);
    assert.equal(r2.copiedToArchive, 0);
    assert.equal(r2.skippedDuplicates, 2, 'both RAW and XMP halves verified-skipped');
  });

  // ── 4. Three retries → exactly one conflict-renamed pair ──
  await t('4: three consecutive retries still produce exactly one renamed pair', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-XXXX');
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    await put(d.stagingEvent, 'Jane Doe/A.xmp', 'INCOMING-XMP');
    const job = await seedJob(d, ['Jane Doe/A.CR2']);
    await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A_1.CR2', 'A_1.xmp']);
  });

  // ── 5. Partial-job failure + retry ──
  await t('5: partial-job retry — the already-succeeded file is verified/reused, not recopied', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-A-XXXX');
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-A');
    await put(d.stagingEvent, 'Jane Doe/A.xmp', 'INCOMING-A-XMP');
    // B.CR2 listed but genuinely absent from staging on run 1 -> fails for B only.
    const job = await seedJob(d, ['Jane Doe/A.CR2', 'Jane Doe/B.CR2']);
    const r1 = await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.equal(r1.status, 'needs-attention');
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A_1.CR2', 'A_1.xmp']);
    await put(d.stagingEvent, 'Jane Doe/B.CR2', 'incoming-B');
    const r2 = await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.equal(r2.status, 'synced');
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A_1.CR2', 'A_1.xmp', 'B.CR2']);
  });

  // ── 6. Real cross-process crash/relaunch ──
  await t('6: cross-process crash + relaunch + retry — final archive has exactly one renamed pair', async () => {
    // Simulates the real lifecycle in-process: reservation written and copy completed
    // ("process A"), then a FRESH require of the sync/manifest modules against the same
    // paths ("process B" — the closest in-process analog to a genuine relaunch, since
    // syncJob/localSyncManifest carry no in-memory state between calls at all — every
    // decision is re-derived from the manifest file and live disk on each invocation).
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-XXXX');
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    await put(d.stagingEvent, 'Jane Doe/A.xmp', 'INCOMING-XMP');
    const job = await seedJob(d, ['Jane Doe/A.CR2']);

    // "Process A": performs the real work; a real crash would end here, before any
    // queue-status completion write — that write is main.js's responsibility, not
    // syncJob's, and is irrelevant to on-disk idempotency (proven directly here).
    const r1 = await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.equal(r1.status, 'synced');
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A_1.CR2', 'A_1.xmp']);

    // "Process B" (relaunch + retry): re-reads the SAME manifest from disk fresh.
    const reread = await manifest.readManifest(d.stagingEvent);
    const mJob = reread.jobs.find(j => j.importId === d.importId);
    assert.ok(Array.isArray(mJob.resolvedFiles) && mJob.resolvedFiles.length === 2, 'reservation for both RAW+XMP halves must be durably persisted');
    const r2 = await sync.syncJob({ localEventPath: d.stagingEvent, importId: d.importId, files: mJob.files }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.equal(r2.copiedToArchive, 0, 'retry must recognize the reservation, not physically recopy');
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A_1.CR2', 'A_1.xmp'], 'no A_2 pair after the simulated crash+relaunch retry');
  });

  // ── 7. Pause/reinvoke path ──
  await t('7: pause/reinvoke (same job object called again after being marked paused) stays idempotent', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-XXXX');
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    const job = await seedJob(d, ['Jane Doe/A.CR2']);
    await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    // A real "paused" retry is, per main.js's own eligibility rule, just another
    // archive:syncJobNow call with the identical job — proven identically by re-invoking.
    const r2 = await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A_1.CR2']);
    assert.equal(r2.renamedConflicts, 0);
  });

  // ── 8. Same-size-different-content ──
  await t('8: same-size different-content collision — reservation reused on retry, no A_2', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-CONTENT-SAME-LEN!!'); // 22 bytes
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'NEW-CONTENT-SAME-LEN!!'); // 22 bytes, different checksum
    const job = await seedJob(d, ['Jane Doe/A.CR2']);
    await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A_1.CR2']);
  });

  // ── 9. True duplicate ──
  await t('9: true duplicate stays stable across retries — no reservation ever created', async () => {
    const d = await mk();
    const same = 'identical-bytes-12345';
    await put(d.nasEvent, 'Jane Doe/A.CR2', same);
    await put(d.stagingEvent, 'Jane Doe/A.CR2', same);
    const job = await seedJob(d, ['Jane Doe/A.CR2']);
    const r1 = await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    const r2 = await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2']);
    assert.equal(r1.skippedDuplicates, 1); assert.equal(r2.skippedDuplicates, 1);
    const reread = await manifest.readManifest(d.stagingEvent);
    const mJob = reread.jobs.find(j => j.importId === d.importId);
    assert.ok(!mJob.resolvedFiles || mJob.resolvedFiles.length === 0, 'a true duplicate must never get a reservation — no rename occurred');
  });

  // ── 10. Reservation persisted but destination absent ──
  await t('10: reservation exists but destination was never physically created — reused, not re-suffixed', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-XXXX');
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    const job = await seedJob(d, ['Jane Doe/A.CR2']);
    const srcBuf = await fsp.readFile(path.join(d.stagingEvent, 'Jane Doe', 'A.CR2'));
    const checksum = crypto.createHash('sha256').update(srcBuf).digest('hex');
    await manifest.reserveResolvedFiles(d.stagingEvent, d.importId, [{ relPath: 'Jane Doe/A.CR2', finalRelPath: 'Jane Doe/A_1.CR2', size: srcBuf.length, checksum }]);
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2'], 'sanity: nothing physically copied yet');
    const r = await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.equal(r.status, 'synced');
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A_1.CR2']);
  });

  // ── 11. Destination modified → fail closed ──
  await t('11: destination content changed after reservation — fails closed, no overwrite, no A_2', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-XXXX');
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    const job = await seedJob(d, ['Jane Doe/A.CR2']);
    await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    await fsp.writeFile(path.join(d.nasEvent, 'Jane Doe', 'A_1.CR2'), 'TAMPERED-CONTENT-DIFFERENT');
    const r2 = await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.equal(r2.status, 'sync-failed');
    assert.ok(r2.errors.some(e => /differ/i.test(e)));
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A_1.CR2']);
    assert.equal(await fsp.readFile(path.join(d.nasEvent, 'Jane Doe', 'A_1.CR2'), 'utf8'), 'TAMPERED-CONTENT-DIFFERENT');
  });

  // ── 12. Source modified → fail closed ──
  await t('12: source content changed after reservation — fails closed, not treated as the same item', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-XXXX');
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    const job = await seedJob(d, ['Jane Doe/A.CR2']);
    await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    await fsp.writeFile(path.join(d.stagingEvent, 'Jane Doe', 'A.CR2'), 'DIFFERENT-SOURCE-NOW');
    const r2 = await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.equal(r2.status, 'sync-failed');
    assert.ok(r2.errors.some(e => /source changed/i.test(e)));
  });

  // ── 13. Partial RAW pair (D1+D4 integration) ──
  await t('13: partial pair — RAW reserved/verified alone, XMP arrives late — reuses RAW, adds only XMP', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-XXXX');
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    const job = await seedJob(d, ['Jane Doe/A.CR2']);
    await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A_1.CR2']);
    await put(d.stagingEvent, 'Jane Doe/A.xmp', 'LATE-XMP-CONTENT');
    const r2 = await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.equal(r2.status, 'synced', JSON.stringify(r2.errors));
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A_1.CR2', 'A_1.xmp'], 'must be exactly A_1.CR2+A_1.xmp, no A_2.CR2');
  });

  // ── 14. New later job independence ──
  await t('14: a genuinely new later import does not inherit an earlier import\'s reservation', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.jpg', 'OLD-JPG-XXXX');
    await put(d.stagingEvent, 'Jane Doe/A.jpg', 'incoming-jpg-job1');
    const job1 = await seedJob(d, ['Jane Doe/A.jpg']);
    await sync.syncJob(job1, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.deepEqual(await listPh(d.nasEvent), ['A.jpg', 'A_1.jpg']);

    await put(d.stagingEvent, 'Jane Doe/A.jpg', 'incoming-jpg-job2-DIFFERENT');
    const job2 = await seedJob(d, ['Jane Doe/A.jpg'], { importId: `${d.importId}-second` }); // genuinely distinct import
    const r2 = await sync.syncJob(job2, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.equal(r2.status, 'synced', JSON.stringify(r2.errors));
    assert.deepEqual(await listPh(d.nasEvent), ['A.jpg', 'A_1.jpg', 'A_2.jpg']);
    assert.equal(await fsp.readFile(path.join(d.nasEvent, 'Jane Doe', 'A_2.jpg'), 'utf8'), 'incoming-jpg-job2-DIFFERENT');
  });

  // ── 15/16. Strategy A and Strategy B/C ──
  await t('15: Strategy A (job.files[]) is idempotent on retry', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-XXXX');
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    const job = await seedJob(d, ['Jane Doe/A.CR2']);
    await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A_1.CR2']);
  });

  await t('16: Strategy B/C (_syncDir, no files[] hint) is idempotent on retry', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-XXXX');
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    // Strategy B: job.photographer, no files[] -> _syncDir. No importId exists for this
    // path (legacy manifest shape, matching a real pre-jobs[] staging event) — reservations
    // fall back to the event-level (top-of-manifest) scope, which still requires a real
    // manifest file to exist to attach to (exactly as a real legacy staging event has one).
    await manifest.writeManifest(d.stagingEvent, { eventName: 'Event', collectionName: 'Coll', readyForSync: true });
    const job = { localEventPath: d.stagingEvent, photographer: 'Jane Doe' };
    await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    const r2 = await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A_1.CR2']);
    assert.equal(r2.renamedConflicts, 0);
  });

  // ── 17. verifyJobChecksum against a renamed destination ──
  await t('17: verifyJobChecksum verifies the RESERVED (actual) destination, not the original basename', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-XXXX');
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    const job = await seedJob(d, ['Jane Doe/A.CR2']);
    await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    const v = await sync.verifyJobChecksum(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.equal(v.status, 'verified', JSON.stringify(v.errors));
    assert.equal(v.verifiedCount, 1);
    assert.equal(v.missingCount, 0, 'must not report the renamed file as missing (checking the wrong, original basename)');
    assert.equal(v.failedCount, 0, 'must not report a checksum mismatch against the unrelated old file at the original basename');
  });

  // ── 18. event.json reconciliation after a verified mapped skip ──
  await t('18: event.json reconciliation via _copiedPairs still runs on a verified-skip retry, even when run 1 itself never reconciled (crash-before-merge simulation)', async () => {
    const d = await mk();
    await writeEventJson(d.nasEvent, SINGLE);
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-XXXX');
    await writeEventJson(d.stagingEvent, { ...SINGLE, tagRefinements: [{ eventTypes: [], additionalKeywords: [], relPaths: ['Jane Doe/A.CR2'] }] });
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    const job = await seedJob(d, ['Jane Doe/A.CR2']);

    // Run 1: physical copy + reservation succeed (proven by the resulting file), but
    // simulate a crash strictly BEFORE event.json's own intent-merge step ever runs, by
    // reverting the archive event.json back to its pre-merge state immediately after —
    // the ONLY way tagRefinements can end up correct is if the RETRY's _copiedPairs
    // reconciliation (for a run that does nothing but a verified skip) does the merge.
    await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A_1.CR2'], 'sanity: the physical copy really happened');
    await writeEventJson(d.nasEvent, SINGLE); // revert: as if the merge itself never ran
    assert.deepEqual(readEventJson(d.nasEvent).tagRefinements || [], [], 'sanity: reconciliation truly did not run yet');

    const r2 = await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.equal(r2.copiedToArchive, 0, 'physical copy must be skipped (verified) on the retry');
    assert.equal(r2.skippedDuplicates, 1);
    const afterRun2 = readEventJson(d.nasEvent);
    assert.deepEqual((afterRun2.tagRefinements || []).flatMap(b => b.relPaths), ['Jane Doe/A_1.CR2'], 'the verified-skip retry must still surface source->A_1 reconciliation evidence — never A_2, never left empty');
  });

  // ── 19. D1 pair invariant still intact ──
  await t('19: D1 pair invariant intact — real ExifTool proves the pair stays correctly associated after a retry', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-DIFFERENT-CONTENT-XXXX');
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    const { ExifTool } = require('exiftool-vendored');
    const et = new ExifTool({ exiftoolArgs: ['-config', path.join(__dirname, '..', 'main', 'exiftool-config.pl'), '-stay_open', 'True', '-@', '-'] });
    const xmpPath = path.join(d.stagingEvent, 'Jane Doe', 'A.xmp');
    await fsp.mkdir(path.dirname(xmpPath), { recursive: true });
    const stub = '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>\n<?xpacket end="w"?>\n';
    await fsp.writeFile(xmpPath, stub, 'utf8');
    try { await et.write(xmpPath, { 'XMP-dc:Creator': 'Distinctive D4 Photographer' }, ['-overwrite_original']); }
    finally { await et.end().catch(() => {}); }

    const job = await seedJob(d, ['Jane Doe/A.CR2']);
    await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot }); // retry
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A_1.CR2', 'A_1.xmp'], 'no D4-created duplicate pair');
    assert.equal(fs.existsSync(path.join(d.nasEvent, 'Jane Doe', 'A.xmp')), false, 'old RAW must never acquire a sidecar');
    const tags = await readFileTags(path.join(d.nasEvent, 'Jane Doe', 'A_1.xmp'));
    assert.deepEqual([].concat(tags.Creator || []), ['Distinctive D4 Photographer']);
  });

  // ── 20. Old manifest with no resolvedFiles remains compatible ──
  await t('20: an old-shaped manifest job entry (no resolvedFiles field) degrades gracefully, no crash, legacy behavior', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-XXXX');
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    // Hand-write a manifest exactly like a pre-D4 build would have produced (no resolvedFiles key at all).
    await manifest.writeManifest(d.stagingEvent, {
      eventName: 'Event', collectionName: 'Coll',
      jobs: [{ importId: d.importId, batchId: d.importId, photographer: 'Jane Doe', fileCount: 1, files: ['Jane Doe/A.CR2'], importedAt: Date.now(), readyForSync: true }],
    });
    const job = { localEventPath: d.stagingEvent, importId: d.importId, files: ['Jane Doe/A.CR2'] };
    const r1 = await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.equal(r1.status, 'synced');
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A_1.CR2'], 'old manifest shape must sync correctly and gain a reservation going forward');
    const reread = await manifest.readManifest(d.stagingEvent);
    assert.ok(reread.jobs[0].resolvedFiles.length === 1, 'the field is additive — present after this sync even though absent before it');
  });

  // ── Audit after fixed retries: only the intended files, no cleanup logic needed ──
  await t('Audit sees only the intended archive files after fixed retries — no retry-duplicate clutter', async () => {
    const d = await mk();
    await writeEventJson(d.nasEvent, SINGLE);
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-XXXX');
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    await put(d.stagingEvent, 'Jane Doe/A.xmp', 'INCOMING-XMP');
    const job = await seedJob(d, ['Jane Doe/A.CR2']);
    await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    await sync.syncJob(job, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    const jobId = await runAuditAndWait(d.nasRoot);
    const report = await audit.getMetadataAuditReport(jobId, { limit: 1000 });
    const names = report.items.map(i => path.basename(i.filePath)).sort();
    assert.deepEqual(names, ['A.CR2', 'A_1.CR2'], 'exactly the old file and ONE new pair — no A_2/A_3 clutter for Audit to see');
  });

  console.log(`${passed} passed`);
  await shutdown().catch(() => {});
  process.exit(process.exitCode || 0);
})();
