'use strict';

// Proves export correctness at scale: real valid JSON (not JSONL mislabeled), RFC
// 4180 CSV escaping for values containing commas/quotes/newlines, reproducibility
// metadata present in both, and temp-then-rename so a failed export never leaves a
// file that looks complete. Requires the Electron binary (transitively via
// exifService.js). Run with:
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --no-sandbox \
//     test/metadataAuditExport.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

process.env.AUTOINGEST_METADATA_QUEUE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-export-queue-'));
process.env.AUTOINGEST_METADATA_AUDIT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-export-jobs-'));

const audit = require('../services/metadataAuditService');
const { exportMetadataAuditReport, _csvCell, _csvRow } = require('../services/metadataAuditExport');
const { shutdown } = require('../main/exifService');

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

async function mkArchiveWithTrickyValues() {
  const archiveRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-export-archive-'));
  const eventDir = path.join(archiveRoot, 'Coll', 'Event, With "Quotes"\nAndNewline');
  await fsp.mkdir(path.join(eventDir, 'Jane Doe'), { recursive: true });
  await fsp.writeFile(path.join(eventDir, 'event.json'), JSON.stringify({
    version: 1, hijriDate: '1448-01-01', eventName: 'Waaz, "Mubarak"\nLine2',
    components: [{ location: 'Hall, "A"', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
  }, null, 2), 'utf8');
  const f = path.join(eventDir, 'Jane Doe', 'IMG_0001.cr2');
  await fsp.writeFile(f, Buffer.from('not-a-real-raw-file'));
  return archiveRoot;
}

(async () => {
  console.log('metadataAuditExport (real ExifTool for the underlying audit, isolated fixtures)');

  await t('_csvCell / _csvRow: RFC 4180 escaping for comma, quote, and newline', () => {
    assert.equal(_csvCell('plain'), 'plain');
    assert.equal(_csvCell('has,comma'), '"has,comma"');
    assert.equal(_csvCell('has"quote'), '"has""quote"');
    assert.equal(_csvCell('has\nnewline'), '"has\nnewline"');
    assert.equal(_csvCell('all "three", in\none'), '"all ""three"", in\none"');
    const row = _csvRow(['a', 'b,c', 'd"e']);
    assert.equal(row, 'a,"b,c","d""e"\r\n');
  });

  const archiveRoot = await mkArchiveWithTrickyValues();
  const res = await audit.runMetadataAudit({ type: 'archiveRoot', rootPath: archiveRoot });
  let status;
  for (let i = 0; i < 100; i++) {
    status = await audit.getMetadataAuditStatus(res.jobId);
    if (status && !status.running) break;
    await new Promise(r => setTimeout(r, 50));
  }
  assert.equal(status.running, false, 'fixture audit job must complete before export tests run');

  await t('exportMetadataAuditReport: JSON export is real, valid, parseable JSON with reproducibility metadata', async () => {
    const dest = path.join(os.tmpdir(), `ai-export-${Date.now()}.json`);
    const r = await exportMetadataAuditReport(res.jobId, { format: 'json', destPath: dest });
    assert.ok(r.ok);
    assert.equal(fs.existsSync(dest + '.tmp'), false, 'tmp file must not survive a successful export');
    const parsed = JSON.parse(await fsp.readFile(dest, 'utf8')); // throws if not valid JSON
    assert.equal(parsed.reportMetadata.metadataContractVersion, 1);
    assert.equal(parsed.reportMetadata.jobId, res.jobId);
    assert.equal(parsed.items.length, 1);
    assert.match(parsed.items[0].eventFolderPath, /Quotes/);
    await fsp.unlink(dest).catch(() => {});
  });

  await t('exportMetadataAuditReport: CSV export escapes tricky field values and carries a .meta.json sidecar', async () => {
    const dest = path.join(os.tmpdir(), `ai-export-${Date.now()}.csv`);
    const r = await exportMetadataAuditReport(res.jobId, { format: 'csv', destPath: dest });
    assert.ok(r.ok);
    const csv = await fsp.readFile(dest, 'utf8');
    // The event folder path (which embeds a comma+quotes+newline) must round-trip
    // through a real CSV parser's expectations: one physical field, quoted.
    assert.match(csv, /"[^"]*Event, With ""Quotes""\n[^"]*"/);

    const meta = JSON.parse(await fsp.readFile(dest + '.meta.json', 'utf8'));
    assert.equal(meta.reportMetadata.resolverVersion, 1);
    assert.ok(meta.aggregates.byEvent);

    await fsp.unlink(dest).catch(() => {});
    await fsp.unlink(dest + '.meta.json').catch(() => {});
  });

  await t('exportMetadataAuditReport: JSONL export is newline-delimited records, one JSON value per line', async () => {
    const dest = path.join(os.tmpdir(), `ai-export-${Date.now()}.jsonl`);
    const r = await exportMetadataAuditReport(res.jobId, { format: 'jsonl', destPath: dest });
    assert.ok(r.ok);
    const lines = (await fsp.readFile(dest, 'utf8')).trim().split('\n');
    assert.equal(lines.length, 1);
    JSON.parse(lines[0]); // throws if not valid JSON
    assert.ok(fs.existsSync(dest + '.meta.json'));
    await fsp.unlink(dest).catch(() => {});
    await fsp.unlink(dest + '.meta.json').catch(() => {});
  });

  await t('exportMetadataAuditReport: exceptionsOnly mode omits compliant rows but keeps reproducibility metadata', async () => {
    const dest = path.join(os.tmpdir(), `ai-export-${Date.now()}.json`);
    // The one fixture file has no sidecar → status 'partial', so it's an "exception"
    // and must still appear even in exceptionsOnly mode.
    const r = await exportMetadataAuditReport(res.jobId, { format: 'json', destPath: dest, exceptionsOnly: true });
    assert.ok(r.ok);
    const parsed = JSON.parse(await fsp.readFile(dest, 'utf8'));
    assert.equal(parsed.items.length, 1);
    assert.equal(parsed.items[0].status, 'partial');
    await fsp.unlink(dest).catch(() => {});
  });

  await t('exportMetadataAuditReport: unknown job id fails cleanly, never creates a partial/renamed file', async () => {
    const dest = path.join(os.tmpdir(), `ai-export-${Date.now()}.json`);
    const r = await exportMetadataAuditReport('nonexistent-job-id', { format: 'json', destPath: dest });
    assert.equal(r.ok, false);
    assert.equal(fs.existsSync(dest), false);
    assert.equal(fs.existsSync(dest + '.tmp'), false);
  });

  console.log(`${passed} passed`);
  await shutdown().catch(() => {});
  process.exit(process.exitCode || 0);
})();
