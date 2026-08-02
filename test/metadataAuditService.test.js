'use strict';

// Fixtures for the streaming metadata audit scanner (real ExifTool, real filesystem,
// isolated temp archive + isolated queue/audit dirs via env overrides). Requires the
// Electron binary (exifService.js transitively needs Electron's app.getPath via
// services/logger.js). Run with:
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --no-sandbox \
//     test/metadataAuditService.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

process.env.AUTOINGEST_METADATA_QUEUE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-audit-queue-'));
process.env.AUTOINGEST_METADATA_AUDIT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-audit-jobs-'));

const audit = require('../services/metadataAuditService');
const { shutdown, applyBatch, getBatchStatus } = require('../main/exifService');
const { ExifTool } = require('exiftool-vendored');

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

async function mkArchive() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'ai-audit-archive-'));
}

async function mkEvent(archiveRoot, collName, eventName, eventJson) {
  const eventDir = path.join(archiveRoot, collName, eventName);
  await fsp.mkdir(eventDir, { recursive: true });
  await fsp.writeFile(path.join(eventDir, 'event.json'), JSON.stringify(eventJson, null, 2), 'utf8');
  return eventDir;
}

async function rawFile(dir, name) {
  const p = path.join(dir, name);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(p, Buffer.from('not-a-real-raw-file-just-bytes'));
  return p;
}

async function writeSidecarDirect(rawPath, tags) {
  const sidecar = rawPath.slice(0, -path.extname(rawPath).length) + '.xmp';
  const et = new ExifTool({ exiftoolArgs: ['-config', path.join(__dirname, '..', 'main', 'exiftool-config.pl'), '-stay_open', 'True', '-@', '-'] });
  try {
    const stub = '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/">\n</x:xmpmeta>\n<?xpacket end="w"?>\n';
    if (!fs.existsSync(sidecar)) await fsp.writeFile(sidecar, stub, 'utf8');
    await et.write(sidecar, tags, ['-overwrite_original']);
  } finally {
    await et.end().catch(() => {});
  }
  return sidecar;
}

async function runBatchAndWait(files, context) {
  const batchId = `audit-fixture-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  applyBatch(batchId, files, context, null);
  for (let i = 0; i < 200; i++) {
    const s = getBatchStatus(batchId);
    if (s && (s.done + s.skipped + s.failed) >= s.total) break;
    await new Promise(r => setTimeout(r, 50));
  }
  return getBatchStatus(batchId);
}

(async () => {
  console.log('metadataAuditService (real ExifTool, isolated fixtures)');

  // ── Pure field/keyword diff ────────────────────────────────────────────────

  await t('_fieldDiff: match, missing, incorrect, unexpected', () => {
    assert.equal(audit._fieldDiff('Jane', 'Jane').status, 'match');
    assert.equal(audit._fieldDiff('Jane', '').status, 'missing');
    assert.equal(audit._fieldDiff('Jane', 'John').status, 'incorrect');
    assert.equal(audit._fieldDiff('', 'Jane').status, 'unexpected');
    assert.equal(audit._fieldDiff('', '').status, 'match');
  });

  await t('_keywordDiff: fully compliant', () => {
    const d = audit._keywordDiff(['Majlis', 'Mumbai'], ['Majlis', 'Mumbai']);
    assert.equal(d.compliant, true);
  });

  await t('_keywordDiff: missing + unexpected (legacy QMZ sequence code), no special-cased detector needed', () => {
    const d = audit._keywordDiff(['Majlis', 'Mumbai'], ['01Q', 'Mumbai']);
    assert.deepEqual(d.missing, ['Majlis']);
    assert.deepEqual(d.unexpected, ['01Q']);
    assert.equal(d.compliant, false);
  });

  await t('_keywordDiff: duplicate keyword (expected exactly once, appears twice)', () => {
    const d = audit._keywordDiff(['Majlis', 'Mumbai'], ['Majlis', 'Majlis', 'Mumbai']);
    assert.deepEqual(d.duplicates, [{ keyword: 'Majlis', count: 2 }]);
    assert.equal(d.compliant, false);
  });

  await t('_keywordDiff: case-only variant is distinguished from a whitespace variant', () => {
    const caseOnly = audit._keywordDiff(['Majlis'], ['majlis']);
    assert.deepEqual(caseOnly.caseVariants, [{ expected: 'Majlis', actual: 'majlis' }]);
    assert.deepEqual(caseOnly.missing, []);

    const whitespace = audit._keywordDiff(['Majlis'], [' Majlis ']);
    assert.deepEqual(whitespace.whitespaceVariants, [{ expected: 'Majlis', actual: ' Majlis ' }]);
  });

  await t('_keywordDiff: two near-duplicate expected keys must not both claim the same single actual token as a variant', () => {
    const r = audit._keywordDiff(['Ahmed', 'AHMED'], ['ahmed']);
    assert.equal(r.caseVariants.length, 1, 'only one expected key may consume the single actual token as a variant');
    assert.deepEqual(r.missing, ['AHMED'], 'the second expected key must be reported missing, not double-matched');
  });

  // ── classifyOneFile: real ExifTool round trips ─────────────────────────────

  await t('classifyOneFile: RAW with no sidecar at all → partial, every field missing (not a read-error)', async () => {
    const archiveRoot = await mkArchive();
    const eventDir = await mkEvent(archiveRoot, 'Coll', 'Event1', {
      version: 1, hijriDate: '1448-01-01', eventName: 'Waaz',
      components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
    });
    const f = await rawFile(path.join(eventDir, 'Jane Doe'), 'IMG_0001.cr2');
    const eventJson = JSON.parse(await fsp.readFile(path.join(eventDir, 'event.json'), 'utf8'));

    const rec = await audit.classifyOneFile(eventDir, eventJson, f);
    assert.equal(rec.status, 'partial');
    assert.equal(rec.fields.photographer.status, 'missing');
    assert.equal(rec.keywords.missing.length > 0, true);
    assert.ok(rec.expectation, 'repair needs the frozen expectation even for a fully-missing file');
  });

  await t('classifyOneFile: correctly-tagged RAW (via a real write) → complete', async () => {
    const archiveRoot = await mkArchive();
    const eventDir = await mkEvent(archiveRoot, 'Coll', 'Event2', {
      version: 1, hijriDate: '1448-01-01', eventName: 'Waaz',
      components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
    });
    const f = await rawFile(path.join(eventDir, 'Jane Doe'), 'IMG_0002.cr2');
    const eventJson = JSON.parse(await fsp.readFile(path.join(eventDir, 'event.json'), 'utf8'));
    await runBatchAndWait([{ src: f, dest: f }], {
      photographer: 'Jane Doe', hijriDate: eventJson.hijriDate, eventDescription: eventJson.eventName,
      groups: [], diskComponents: eventJson.components,
    });

    const rec = await audit.classifyOneFile(eventDir, eventJson, f);
    assert.equal(rec.status, 'complete');
    assert.equal(rec.fields.photographer.status, 'match');
    assert.equal(rec.keywords.compliant, true);
  });

  await t('classifyOneFile: RAW tagged with the WRONG photographer → partial, field marked incorrect', async () => {
    const archiveRoot = await mkArchive();
    const eventDir = await mkEvent(archiveRoot, 'Coll', 'Event3', {
      version: 1, hijriDate: '1448-01-01', eventName: 'Waaz',
      components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
    });
    const f = await rawFile(path.join(eventDir, 'Jane Doe'), 'IMG_0003.cr2');
    const eventJson = JSON.parse(await fsp.readFile(path.join(eventDir, 'event.json'), 'utf8'));
    // Written under a DIFFERENT photographer folder name than expected — simulates
    // e.g. a file moved after being tagged, or tagged under the pre-fix QMZ bug.
    await writeSidecarDirect(f, { 'XMP-dc:Creator': ['Someone Else'] });

    const rec = await audit.classifyOneFile(eventDir, eventJson, f);
    assert.equal(rec.status, 'partial');
    assert.equal(rec.fields.photographer.status, 'incorrect');
    assert.equal(rec.fields.photographer.expected, 'Jane Doe');
    assert.equal(rec.fields.photographer.actual, 'Someone Else');
  });

  await t('classifyOneFile: duplicate keyword already on disk is detected, not masked by set comparison', async () => {
    const archiveRoot = await mkArchive();
    const eventDir = await mkEvent(archiveRoot, 'Coll', 'Event4', {
      version: 1, hijriDate: '1448-01-01', eventName: 'Waaz',
      components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
    });
    const f = await rawFile(path.join(eventDir, 'Jane Doe'), 'IMG_0004.cr2');
    const eventJson = JSON.parse(await fsp.readFile(path.join(eventDir, 'event.json'), 'utf8'));
    await writeSidecarDirect(f, {
      'XMP-dc:Creator': ['Jane Doe'], 'XMP-dc:Subject': ['Majlis', 'Majlis', 'Hall A', 'Mumbai', 'India'],
    });

    const rec = await audit.classifyOneFile(eventDir, eventJson, f);
    assert.equal(rec.status, 'partial');
    assert.deepEqual(rec.keywords.duplicates, [{ keyword: 'Majlis', count: 2 }]);
  });

  await t('classifyOneFile: multi-component event, file outside every component folder → ambiguous, never read', async () => {
    const archiveRoot = await mkArchive();
    const eventDir = await mkEvent(archiveRoot, 'Coll', 'Event5', {
      version: 1, hijriDate: '1448-01-01', eventName: 'Waaz',
      components: [
        { folderName: 'Majlis-Hall A-Mumbai', location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'] },
        { folderName: 'Ziyafat-Hall B-Mumbai', location: 'Hall B', city: 'Mumbai', country: 'India', types: ['Ziyafat'] },
      ],
    });
    // File sits directly under the event root, not under either component folder.
    const f = await rawFile(eventDir, 'stray.cr2');
    const eventJson = JSON.parse(await fsp.readFile(path.join(eventDir, 'event.json'), 'utf8'));

    const rec = await audit.classifyOneFile(eventDir, eventJson, f);
    assert.equal(rec.status, 'ambiguous');
    assert.equal(rec.ambiguityReason, 'component-unresolved-multi-event');
  });

  await t('classifyOneFile: video file is excluded, never read', async () => {
    const archiveRoot = await mkArchive();
    const eventDir = await mkEvent(archiveRoot, 'Coll', 'Event6', {
      version: 1, hijriDate: '1448-01-01', eventName: 'Waaz',
      components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
    });
    const videoDir = path.join(eventDir, 'Jane Doe', 'VIDEO');
    await fsp.mkdir(videoDir, { recursive: true });
    const f = path.join(videoDir, 'clip.mp4');
    await fsp.writeFile(f, Buffer.from('not-a-real-video'));
    const eventJson = JSON.parse(await fsp.readFile(path.join(eventDir, 'event.json'), 'utf8'));

    const rec = await audit.classifyOneFile(eventDir, eventJson, f);
    assert.equal(rec.status, 'excluded');
  });

  // ── Deterministic enumeration ───────────────────────────────────────────────

  await t('enumerateEvents / enumerateFiles are lexicographically sorted regardless of creation order', async () => {
    const archiveRoot = await mkArchive();
    await mkEvent(archiveRoot, 'Coll', 'Zebra', { version: 1, components: [] });
    await mkEvent(archiveRoot, 'Coll', 'Alpha', { version: 1, components: [] });
    const events = await audit.enumerateEvents({ type: 'archiveRoot', rootPath: archiveRoot });
    assert.deepEqual(events.map(e => path.basename(e)), ['Alpha', 'Zebra']);

    const evDir = events[0];
    await fsp.mkdir(path.join(evDir, 'Jane Doe'), { recursive: true });
    await fsp.writeFile(path.join(evDir, 'Jane Doe', 'z.cr2'), 'x');
    await fsp.writeFile(path.join(evDir, 'Jane Doe', 'a.cr2'), 'x');
    const files = await audit.enumerateFiles(evDir);
    assert.deepEqual(files.map(f => path.basename(f)), ['a.cr2', 'z.cr2']);
  });

  // ── Full job lifecycle ───────────────────────────────────────────────────────

  await t('runMetadataAudit: end-to-end over a small archive, status + report + aggregates', async () => {
    const archiveRoot = await mkArchive();
    const ev1 = await mkEvent(archiveRoot, 'CollX', 'EventOne', {
      version: 1, hijriDate: '1448-01-01', eventName: 'Waaz',
      components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
    });
    const ev2 = await mkEvent(archiveRoot, 'CollX', 'EventTwo', {
      version: 1, hijriDate: '1448-01-02', eventName: 'Majlis',
      components: [{ location: 'Hall B', city: 'Surat', country: 'India', types: ['Majlis'], folderName: null }],
    });
    await rawFile(path.join(ev1, 'Jane Doe'), 'a.cr2');   // no sidecar → partial
    await rawFile(path.join(ev2, 'John Smith'), 'b.cr2'); // no sidecar → partial

    const res = await audit.runMetadataAudit({ type: 'archiveRoot', rootPath: archiveRoot });
    assert.ok(res.ok);
    const jobId = res.jobId;

    let status;
    for (let i = 0; i < 100; i++) {
      status = await audit.getMetadataAuditStatus(jobId);
      if (status && !status.running) break;
      await new Promise(r => setTimeout(r, 50));
    }
    assert.equal(status.running, false);
    assert.equal(status.eventsTotal, 2);
    assert.equal(status.eventsScanned, 2);
    assert.equal(status.scannedCount, 2);
    assert.equal(status.exceptionCount, 2); // both partial

    const report = await audit.getMetadataAuditReport(jobId, { limit: 50 });
    assert.equal(report.items.length, 2);
    assert.equal(report.reportMetadata.metadataContractVersion, 1);
    assert.ok(report.aggregates.byEvent);
  });

  await t('runMetadataAudit: cancellation mid-scan is reflected, not silently reported as complete', async () => {
    const archiveRoot = await mkArchive();
    // Enough events with sidecar-bearing files (real ExifTool round trips) to create
    // a wide-enough window for a cancel issued immediately after start to land first.
    for (let i = 0; i < 15; i++) {
      const evDir = await mkEvent(archiveRoot, 'CollCancel', `Event${String(i).padStart(2, '0')}`, {
        version: 1, hijriDate: '1448-01-01', eventName: 'Waaz',
        components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
      });
      const f1 = await rawFile(path.join(evDir, 'Jane Doe'), 'a.cr2');
      const f2 = await rawFile(path.join(evDir, 'Jane Doe'), 'b.cr2');
      await writeSidecarDirect(f1, { 'XMP-dc:Creator': ['Jane Doe'] });
      await writeSidecarDirect(f2, { 'XMP-dc:Creator': ['Jane Doe'] });
    }

    const res = await audit.runMetadataAudit({ type: 'archiveRoot', rootPath: archiveRoot });
    assert.ok(res.ok);
    const cancelRes = audit.cancelMetadataAudit(res.jobId);
    assert.equal(cancelRes.ok, true);

    let status;
    for (let i = 0; i < 100; i++) {
      status = await audit.getMetadataAuditStatus(res.jobId);
      if (status && !status.running) break;
      await new Promise(r => setTimeout(r, 50));
    }
    assert.equal(status.running, false);
    assert.equal(status.cancelled, true);
    assert.ok(status.eventsScanned < status.eventsTotal, `expected a partial scan (cancelled early), got ${status.eventsScanned}/${status.eventsTotal}`);
  });

  await t('resumeMetadataAudit: hand-simulated interruption resumes without omitting or duplicating events', async () => {
    const archiveRoot = await mkArchive();
    const ev1 = await mkEvent(archiveRoot, 'CollResume', 'EventA', {
      version: 1, hijriDate: '1448-01-01', eventName: 'Waaz',
      components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
    });
    const ev2 = await mkEvent(archiveRoot, 'CollResume', 'EventB', {
      version: 1, hijriDate: '1448-01-01', eventName: 'Waaz',
      components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
    });
    await rawFile(path.join(ev1, 'Jane Doe'), 'a.cr2');
    await rawFile(path.join(ev2, 'Jane Doe'), 'b.cr2');

    // Run once to completion to get a real jobId with real state/report files...
    const first = await audit.runMetadataAudit({ type: 'archiveRoot', rootPath: archiveRoot });
    let status;
    for (let i = 0; i < 100; i++) {
      status = await audit.getMetadataAuditStatus(first.jobId);
      if (status && !status.running) break;
      await new Promise(r => setTimeout(r, 50));
    }

    // ...then hand-roll the interruption: rewrite state.json as if only EventA had
    // committed, and truncate report.jsonl to just EventA's record.
    const statePath = audit._statePath(first.jobId);
    const reportPath = audit._reportPath(first.jobId);
    const state = JSON.parse(await fsp.readFile(statePath, 'utf8'));
    const lines = (await fsp.readFile(reportPath, 'utf8')).trim().split('\n');
    const ev1Line = lines.find(l => JSON.parse(l).eventFolderPath === ev1);
    await fsp.writeFile(reportPath, ev1Line + '\n', 'utf8');
    await fsp.writeFile(statePath, JSON.stringify({ ...state, cursorIndex: 1, completedAt: null, running: false }, null, 2), 'utf8');

    const resumeRes = await audit.resumeMetadataAudit(first.jobId);
    assert.ok(resumeRes.ok);
    for (let i = 0; i < 100; i++) {
      status = await audit.getMetadataAuditStatus(first.jobId);
      if (status && !status.running) break;
      await new Promise(r => setTimeout(r, 50));
    }
    assert.equal(status.eventsScanned, 2);

    const finalLines = (await fsp.readFile(reportPath, 'utf8')).trim().split('\n');
    const forEv1 = finalLines.filter(l => JSON.parse(l).eventFolderPath === ev1);
    const forEv2 = finalLines.filter(l => JSON.parse(l).eventFolderPath === ev2);
    assert.equal(forEv1.length, 1, 'EventA must not be duplicated on resume');
    assert.equal(forEv2.length, 1, 'EventB must be scanned exactly once on resume');
  });

  await t('resumeMetadataAudit: interruption landing MID-EVENT (not a clean event boundary) does not duplicate or double-count the files already scanned before the crash', async () => {
    const archiveRoot = await mkArchive();
    // ONE event with 3 files, so a hand-simulated interruption can land between two
    // of that event's files rather than only ever between two whole events.
    const ev1 = await mkEvent(archiveRoot, 'CollMidEvent', 'EventA', {
      version: 1, hijriDate: '1448-01-01', eventName: 'Waaz',
      components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
    });
    await rawFile(path.join(ev1, 'Jane Doe'), 'a.cr2');
    await rawFile(path.join(ev1, 'Jane Doe'), 'b.cr2');
    await rawFile(path.join(ev1, 'Jane Doe'), 'c.cr2');

    const first = await audit.runMetadataAudit({ type: 'archiveRoot', rootPath: archiveRoot });
    let status;
    for (let i = 0; i < 100; i++) {
      status = await audit.getMetadataAuditStatus(first.jobId);
      if (status && !status.running) break;
      await new Promise(r => setTimeout(r, 50));
    }
    assert.equal(status.scannedCount, 3, 'sanity: all 3 files scanned on the first run');

    // Hand-simulate a MID-EVENT crash: 2 of the event's 3 files were durably appended
    // before the process died. cursorIndex still points AT this event (it only ever
    // advances after every file of an event lands) — exactly what a real interruption
    // between two files of the same event leaves on disk.
    const statePath = audit._statePath(first.jobId);
    const reportPath = audit._reportPath(first.jobId);
    const state = JSON.parse(await fsp.readFile(statePath, 'utf8'));
    const lines = (await fsp.readFile(reportPath, 'utf8')).trim().split('\n');
    await fsp.writeFile(reportPath, lines.slice(0, 2).join('\n') + '\n', 'utf8');
    await fsp.writeFile(statePath, JSON.stringify({
      ...state, cursorIndex: 0, scannedCount: 2, completedAt: null, running: false,
    }, null, 2), 'utf8');

    const resumeRes = await audit.resumeMetadataAudit(first.jobId);
    assert.ok(resumeRes.ok);
    for (let i = 0; i < 100; i++) {
      status = await audit.getMetadataAuditStatus(first.jobId);
      if (status && !status.running) break;
      await new Promise(r => setTimeout(r, 50));
    }

    assert.equal(status.scannedCount, 3, 'must report exactly 3, not 5 (2 stale + 3 fresh)');
    const finalLines = (await fsp.readFile(reportPath, 'utf8')).trim().split('\n');
    assert.equal(finalLines.length, 3, 'report.jsonl must have exactly one record per file, not duplicates');
    const perFile = new Map();
    for (const l of finalLines) {
      const r = JSON.parse(l);
      perFile.set(r.filePath, (perFile.get(r.filePath) || 0) + 1);
    }
    for (const count of perFile.values()) assert.equal(count, 1, 'no file may have more than one record after resume');
  });

  await t('getMetadataAuditReport: a corrupt/torn report.jsonl line is quarantined, not silently dropped or fatal', async () => {
    const archiveRoot = await mkArchive();
    const ev = await mkEvent(archiveRoot, 'CollCorrupt', 'EventCorrupt', { version: 1, components: [] });
    await rawFile(path.join(ev, 'Jane Doe'), 'a.cr2');
    await rawFile(path.join(ev, 'Jane Doe'), 'b.cr2');

    const res = await audit.runMetadataAudit({ type: 'archiveRoot', rootPath: archiveRoot });
    let status;
    for (let i = 0; i < 100; i++) {
      status = await audit.getMetadataAuditStatus(res.jobId);
      if (status && !status.running) break;
      await new Promise(r => setTimeout(r, 50));
    }
    assert.equal(status.scannedCount, 2, 'sanity: both files scanned');

    // Hand-corrupt a trailing line, simulating a crash mid-append.
    const reportPath = audit._reportPath(res.jobId);
    const lines = (await fsp.readFile(reportPath, 'utf8')).trim().split('\n');
    lines.push('{"filePath":"/broken", "status": incomplete-json');
    await fsp.writeFile(reportPath, lines.join('\n') + '\n', 'utf8');

    const report = await audit.getMetadataAuditReport(res.jobId, { limit: 100 });
    assert.ok(report, 'a corrupt trailing line must not make the whole report unreadable');
    assert.equal(report.items.length, 2, 'the two valid records must still be returned');

    const quarantinePath = reportPath + '.quarantine';
    const quarantined = await fsp.readFile(quarantinePath, 'utf8');
    assert.match(quarantined, /incomplete-json/, 'the corrupt line must be quarantined, not silently discarded with no trace');
  });

  console.log(`${passed} passed`);
  await shutdown().catch(() => {});
  process.exit(process.exitCode || 0);
})();
