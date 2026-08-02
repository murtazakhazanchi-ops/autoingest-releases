'use strict';

// Proves the repair operation: exhaustive preview, ambiguous files never included,
// a genuine staleness guard (drift between audit-time and repair-time is a REAL
// filesystem comparison here, not the tautology Phase C's resume check originally
// had), execution via the shared apply engine (resumeFrozenFile), and a durable
// per-event result report. Requires the Electron binary. Run with:
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --no-sandbox \
//     test/metadataRepairService.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

process.env.AUTOINGEST_METADATA_QUEUE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-repair-queue-'));
process.env.AUTOINGEST_METADATA_AUDIT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-repair-jobs-'));
process.env.AUTOINGEST_METADATA_REPAIR_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-repair-results-'));

const audit = require('../services/metadataAuditService');
const repair = require('../main/metadataRepairService');
const queueStore = require('../main/metadataQueueStore');
const { resumeInterruptedBatches } = require('../main/metadataQueueRecovery');
const { shutdown, readFileTags } = require('../main/exifService');

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

async function mkEvent(archiveRoot, collName, eventName, eventJson) {
  const eventDir = path.join(archiveRoot, collName, eventName);
  await fsp.mkdir(eventDir, { recursive: true });
  await fsp.writeFile(path.join(eventDir, 'event.json'), JSON.stringify(eventJson, null, 2), 'utf8');
  return eventDir;
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

(async () => {
  console.log('metadataRepairService (real ExifTool, isolated fixtures)');

  await t('previewMetadataRepair: proposes writes for a partial file, includes exact field-level changes', async () => {
    const archiveRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-repair-archive-'));
    const eventDir = await mkEvent(archiveRoot, 'Coll', 'EventA', {
      version: 1, hijriDate: '1448-01-01', eventName: 'Waaz',
      components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
    });
    const f = path.join(eventDir, 'Jane Doe', 'IMG_0001.cr2');
    await fsp.mkdir(path.dirname(f), { recursive: true });
    await fsp.writeFile(f, Buffer.from('not-a-real-raw-file'));

    const jobId = await runAuditAndWait(archiveRoot);
    const preview = await repair.previewMetadataRepair(jobId);
    assert.ok(preview.ok);
    assert.equal(preview.items.length, 1);
    assert.equal(preview.items[0].proposedAction, 'write');
    assert.equal(preview.items[0].stale, false);
    const photographerChange = preview.items[0].fieldsToChange.find(c => c.field === 'photographer');
    assert.ok(photographerChange, 'photographer must be listed as a proposed change');
    assert.equal(photographerChange.to, 'Jane Doe');
  });

  await t('runMetadataRepair: writes the frozen expectation via the shared apply engine; read-back proves it', async () => {
    const archiveRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-repair-archive-'));
    const eventDir = await mkEvent(archiveRoot, 'Coll', 'EventB', {
      version: 1, hijriDate: '1448-01-01', eventName: 'Waaz',
      components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
    });
    const f = path.join(eventDir, 'Jane Doe', 'IMG_0002.cr2');
    await fsp.mkdir(path.dirname(f), { recursive: true });
    await fsp.writeFile(f, Buffer.from('not-a-real-raw-file'));
    const sidecar = f.slice(0, -path.extname(f).length) + '.xmp';
    assert.equal(fs.existsSync(sidecar), false);

    const jobId = await runAuditAndWait(archiveRoot);
    const result = await repair.runMetadataRepair(jobId);
    assert.ok(result.ok);
    assert.equal(result.result.total, 1);
    assert.equal(result.result.complete, 1);
    assert.ok(fs.existsSync(sidecar), 'repair must create the RAW sidecar');

    const tags = await readFileTags(sidecar);
    assert.equal(tags.Creator?.[0] || tags.Creator, 'Jane Doe');
    assert.match(String(tags.Subject || ''), /Majlis/);

    const stored = await repair.getMetadataRepairResult(result.batchId);
    assert.ok(stored, 'result report must be durably persisted, not only returned in-memory');
    assert.equal(stored.complete, 1);

    const finalEventJson = JSON.parse(await fsp.readFile(path.join(eventDir, 'event.json'), 'utf8'));
    assert.equal(finalEventJson.metadataState.state, 'metadata-complete');
  });

  await t('runMetadataRepair: result report carries traceability fields (item #7) — snapshot identity, timing, and honest preview-linkage', async () => {
    const archiveRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-repair-archive-'));
    const eventDir = await mkEvent(archiveRoot, 'Coll', 'EventTrace', {
      version: 1, hijriDate: '1448-01-01', eventName: 'Waaz',
      components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
    });
    const f = path.join(eventDir, 'Jane Doe', 'IMG_trace.cr2');
    await fsp.mkdir(path.dirname(f), { recursive: true });
    await fsp.writeFile(f, Buffer.from('not-a-real-raw-file'));

    const jobId = await runAuditAndWait(archiveRoot);

    // Repair WITHOUT ever calling previewMetadataRepair first for this job — the
    // honest case: previewedInThisSession must be false, previewGeneratedAt null.
    const before = Date.now();
    const noPreviewResult = await repair.runMetadataRepair(jobId);
    assert.ok(noPreviewResult.ok);
    assert.equal(noPreviewResult.result.previewedInThisSession, false, 'no preview was called for this job — must not fabricate a link');
    assert.equal(noPreviewResult.result.previewGeneratedAt, null);
    assert.equal(noPreviewResult.result.snapshotIdentity.auditJobId, jobId);
    assert.ok('metadataContractVersion' in noPreviewResult.result.snapshotIdentity);
    assert.ok('resolverVersion' in noPreviewResult.result.snapshotIdentity);
    assert.ok(Date.parse(noPreviewResult.result.startedAt) >= before);
    assert.ok(Date.parse(noPreviewResult.result.completedAt) >= Date.parse(noPreviewResult.result.startedAt));
    assert.equal(noPreviewResult.result.approved, 1);
    assert.equal(noPreviewResult.result.stale, 0);
    assert.equal(noPreviewResult.result.written, 1);

    // Second event: DO call previewMetadataRepair first — previewedInThisSession
    // must now be true and previewGeneratedAt must be a real, recent timestamp.
    const eventDir2 = await mkEvent(archiveRoot, 'Coll', 'EventTrace2', {
      version: 1, hijriDate: '1448-01-01', eventName: 'Waaz',
      components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
    });
    const f2 = path.join(eventDir2, 'Jane Doe', 'IMG_trace2.cr2');
    await fsp.mkdir(path.dirname(f2), { recursive: true });
    await fsp.writeFile(f2, Buffer.from('not-a-real-raw-file'));
    const jobId2 = await runAuditAndWait(archiveRoot);

    const previewBefore = Date.now();
    const preview = await repair.previewMetadataRepair(jobId2);
    assert.ok(preview.ok);
    const withPreviewResult = await repair.runMetadataRepair(jobId2);
    assert.ok(withPreviewResult.ok);
    assert.equal(withPreviewResult.result.previewedInThisSession, true);
    assert.ok(Date.parse(withPreviewResult.result.previewGeneratedAt) >= previewBefore, 'previewGeneratedAt must be a real timestamp from the actual preview call');

    // Persisted report must carry the same fields, not just the in-memory return value.
    const stored = await repair.getMetadataRepairResult(withPreviewResult.batchId);
    assert.equal(stored.previewedInThisSession, true);
    assert.equal(stored.snapshotIdentity.auditJobId, jobId2);
  });

  await t('runMetadataRepair: a file that drifted between audit and repair is skipped as stale, never overwritten', async () => {
    const archiveRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-repair-archive-'));
    const eventDir = await mkEvent(archiveRoot, 'Coll', 'EventC', {
      version: 1, hijriDate: '1448-01-01', eventName: 'Waaz',
      components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
    });
    const f = path.join(eventDir, 'Jane Doe', 'IMG_0003.cr2');
    await fsp.mkdir(path.dirname(f), { recursive: true });
    await fsp.writeFile(f, Buffer.from('not-a-real-raw-file'));

    const jobId = await runAuditAndWait(archiveRoot);

    // Drift: something else creates the sidecar with unrelated content AFTER the
    // audit ran but BEFORE repair executes — repair's snapshot (captured at audit
    // time: "no sidecar exists") no longer matches live state.
    const sidecar = f.slice(0, -path.extname(f).length) + '.xmp';
    const stub = '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/">\n</x:xmpmeta>\n<?xpacket end="w"?>\n';
    await fsp.writeFile(sidecar, stub, 'utf8');

    const preview = await repair.previewMetadataRepair(jobId);
    assert.equal(preview.items[0].stale, true);
    assert.match(preview.items[0].staleReason, /re-audit required/);

    const result = await repair.runMetadataRepair(jobId);
    assert.equal(result.reason, 'nothing-to-repair', 'the drifted file must not be queued for a write at all');

    const tags = await readFileTags(sidecar);
    assert.equal(tags.Creator, undefined, 'repair must never have written to a file it flagged as stale');
  });

  await t('runMetadataRepair: pre-existing unrelated XMP fields survive a REPAIR write (not just the original write path)', async () => {
    // test/rawXmpReadback.test.js already proves this for the primary applyBatch write
    // path. Repair writes through a different entry point (exifService.resumeFrozenFile,
    // not applyBatch) — both call the same underlying _writeAndVerify/_buildTags, so the
    // guarantee holds by construction, but it was previously unverified independently
    // for repair specifically.
    const archiveRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-repair-archive-'));
    const eventDir = await mkEvent(archiveRoot, 'Coll', 'EventUnrelated', {
      version: 1, hijriDate: '1448-01-01', eventName: 'Waaz',
      components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
    });
    const f = path.join(eventDir, 'Jane Doe', 'IMG_unrelated.cr2');
    await fsp.mkdir(path.dirname(f), { recursive: true });
    await fsp.writeFile(f, Buffer.from('not-a-real-raw-file'));
    const sidecar = f.slice(0, -path.extname(f).length) + '.xmp';

    const { ExifTool } = require('exiftool-vendored');
    const et = new ExifTool({ exiftoolArgs: ['-config', path.join(__dirname, '..', 'main', 'exiftool-config.pl'), '-stay_open', 'True', '-@', '-'] });
    try {
      const stub = '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/">\n</x:xmpmeta>\n<?xpacket end="w"?>\n';
      await fsp.writeFile(sidecar, stub, 'utf8');
      await et.write(sidecar, { 'XMP:Rating': '5', 'XMP-photoshop:Instructions': 'do-not-touch' }, ['-overwrite_original']);
    } finally {
      await et.end().catch(() => {});
    }

    const jobId = await runAuditAndWait(archiveRoot);
    const result = await repair.runMetadataRepair(jobId);
    assert.ok(result.ok);
    assert.equal(result.result.complete, 1);

    const after = await readFileTags(sidecar);
    assert.equal(after.Creator?.[0] || after.Creator, 'Jane Doe', 'repair must have written the frozen expectation');
    assert.equal(String(after.Rating ?? ''), '5', 'unrelated pre-existing field must survive a REPAIR write');
    assert.equal(after.Instructions, 'do-not-touch', 'unrelated pre-existing field must survive a REPAIR write');
  });

  await t('runMetadataRepair: ambiguous files are never included, even implicitly', async () => {
    const archiveRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-repair-archive-'));
    const eventDir = await mkEvent(archiveRoot, 'Coll', 'EventD', {
      version: 1, hijriDate: '1448-01-01', eventName: 'Waaz',
      components: [
        { folderName: 'Majlis-Hall A-Mumbai', location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'] },
        { folderName: 'Ziyafat-Hall B-Mumbai', location: 'Hall B', city: 'Mumbai', country: 'India', types: ['Ziyafat'] },
      ],
    });
    const f = path.join(eventDir, 'stray.cr2'); // outside every component folder → ambiguous
    await fsp.writeFile(f, Buffer.from('not-a-real-raw-file'));

    const jobId = await runAuditAndWait(archiveRoot);
    const preview = await repair.previewMetadataRepair(jobId);
    assert.equal(preview.items.length, 0);

    const result = await repair.runMetadataRepair(jobId);
    assert.equal(result.reason, 'nothing-to-repair');
    assert.equal(fs.existsSync(f.slice(0, -path.extname(f).length) + '.xmp'), false);
  });

  await t('runMetadataRepair: a genuine concurrent double-invocation is rejected, not silently double-queued', async () => {
    const archiveRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-repair-archive-'));
    const eventDir = await mkEvent(archiveRoot, 'Coll', 'EventGuard', {
      version: 1, hijriDate: '1448-01-01', eventName: 'Waaz',
      components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
    });
    const f = path.join(eventDir, 'Jane Doe', 'IMG_guard.cr2');
    await fsp.mkdir(path.dirname(f), { recursive: true });
    await fsp.writeFile(f, Buffer.from('not-a-real-raw-file'));

    const jobId = await runAuditAndWait(archiveRoot);
    const [first, second] = await Promise.all([
      repair.runMetadataRepair(jobId),
      repair.runMetadataRepair(jobId),
    ]);
    const results = [first, second];
    const busyCount = results.filter(r => r.reason === 'busy').length;
    const ranCount = results.filter(r => r.ok && r.reason !== 'busy').length;
    assert.equal(busyCount, 1, 'exactly one concurrent call must be rejected as busy');
    assert.equal(ranCount, 1, 'exactly one concurrent call must actually run');
  });

  await t('a repair batch interrupted mid-event is picked up and completed by the generic queue-recovery machinery, end to end', async () => {
    const archiveRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-repair-archive-'));
    const eventDir = await mkEvent(archiveRoot, 'Coll', 'EventE', {
      version: 1, hijriDate: '1448-01-01', eventName: 'Waaz',
      components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
    });
    const f1 = path.join(eventDir, 'Jane Doe', 'IMG_0004.cr2');
    const f2 = path.join(eventDir, 'Jane Doe', 'IMG_0005.cr2');
    await fsp.mkdir(path.dirname(f1), { recursive: true });
    await fsp.writeFile(f1, Buffer.from('not-a-real-raw-file'));
    await fsp.writeFile(f2, Buffer.from('not-a-real-raw-file'));

    const jobId = await runAuditAndWait(archiveRoot);
    const preview = await repair.previewMetadataRepair(jobId);
    assert.equal(preview.items.length, 2, 'sanity: both files need repair');

    // Hand-build a manifest in EXACTLY the shape runMetadataRepair itself produces
    // (one manifest per event, files carrying the audit-frozen `expectation` plus
    // freshly-rebuilt `evidence`) — using the real preview's data rather than
    // fabricating expectations, so this proves the real shape is recovery-compatible,
    // not just a shape asserted to match by inspection.
    const loaded = await audit.getMetadataAuditReport(jobId, { limit: 1000 });
    const records = new Map(loaded.items.map(r => [r.filePath, r]));
    const { buildFileEvidence } = require('../services/eventEvidenceReconstruction');
    const liveEventJson = JSON.parse(await fsp.readFile(path.join(eventDir, 'event.json'), 'utf8'));

    const batchId = `repair-crash-test-${Date.now()}`;
    const files = [f1, f2].map(f => {
      const rec = records.get(f);
      return {
        src: f, dest: f, relDestPath: path.relative(eventDir, f), size: rec.snapshot?.size ?? null,
        isRaw: rec.isRaw, isVideo: false,
        evidence: buildFileEvidence(eventDir, liveEventJson, f),
        expectation: rec.expectation,
      };
    });
    await queueStore.writeManifestOnce(batchId, {
      schemaVersion: 1, batchId, metadataContractVersion: 1, resolverVersion: 1,
      archiveRootIdentity: null, eventJsonPath: path.join(eventDir, 'event.json'),
      sourceAuditJobId: jobId, queuedAt: new Date().toISOString(), files,
    });

    // Simulate: f1 finished before the crash (real write, so resume must NOT touch it
    // again); f2 crashed mid-write (only a non-terminal 'writing' entry landed).
    const { applyBatch, getBatchStatus } = require('../main/exifService');
    const preId = `${batchId}-pre`;
    applyBatch(preId, [{ src: f1, dest: f1 }], {
      photographer: 'Jane Doe', hijriDate: liveEventJson.hijriDate, eventDescription: liveEventJson.eventName,
      groups: [], diskComponents: liveEventJson.components,
    }, null);
    for (let i = 0; i < 200; i++) {
      const s = getBatchStatus(preId);
      if (s && (s.done + s.skipped + s.failed) >= s.total) break;
      await new Promise(r => setTimeout(r, 50));
    }
    await queueStore.appendJournalEntry(batchId, { dest: f1, status: 'complete', classification: 'complete' });
    await queueStore.appendJournalEntry(batchId, { dest: f2, status: 'writing' });

    const summary = await resumeInterruptedBatches();
    assert.ok(summary.filesResumed >= 1, 'the mid-repair-crash file must be completed by the generic recovery path');

    const sidecar2 = f2.slice(0, -path.extname(f2).length) + '.xmp';
    const tags2 = await readFileTags(sidecar2);
    assert.equal(tags2.Creator?.[0] || tags2.Creator, 'Jane Doe', 'recovery must have actually written the frozen expectation for the crashed file');

    const finalEventJson = JSON.parse(await fsp.readFile(path.join(eventDir, 'event.json'), 'utf8'));
    assert.equal(finalEventJson.metadataState.state, 'metadata-complete');

    const active = await queueStore.listActiveBatchIds();
    assert.ok(!active.includes(batchId), 'the repair-shaped batch must be compacted after recovery, like any other batch');
  });

  console.log(`${passed} passed`);
  await shutdown().catch(() => {});
  process.exit(process.exitCode || 0);
})();
