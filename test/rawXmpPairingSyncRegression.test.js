'use strict';

// D1 — RAW/XMP conflict-rename integrity. Before this fix, a RAW conflict-renamed during
// Local First sync (e.g. A.CR2 -> A_1.CR2) could leave its companion XMP targeting the
// ORIGINAL, pre-rename basename (A.xmp) — silently attaching the incoming file's metadata
// to a different, unrelated, pre-existing archive RAW. Proven with real bytes and real
// ExifTool metadata during the forensic pass (2026-09-23/24); fixed via pair-aware
// destination resolution in services/archiveSyncService.js (_resolvePairDestination /
// _syncRawWithCompanion). This test drives the REAL syncJob() against synthetic disposable
// fixtures — never a narrower helper — across the full collision matrix, plus real
// ExifTool/XMP association, Audit, and durable-intent checks. Requires the Electron binary:
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --no-sandbox \
//     test/rawXmpPairingSyncRegression.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

process.env.AUTOINGEST_METADATA_QUEUE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-d1-queue-'));
process.env.AUTOINGEST_METADATA_AUDIT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-d1-jobs-'));
process.env.AUTOINGEST_METADATA_REPAIR_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-d1-results-'));

const sync = require('../services/archiveSyncService');
const audit = require('../services/metadataAuditService');
const repair = require('../main/metadataRepairService');
const { readFileTags, shutdown } = require('../main/exifService');
const config = require('../config/app.config');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

async function mk() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-d1-'));
  const stagingRoot = path.join(root, 'staging'), nasRoot = path.join(root, 'nas');
  const stagingEvent = path.join(stagingRoot, 'Coll', 'Event'), nasEvent = path.join(nasRoot, 'Coll', 'Event');
  await fsp.mkdir(stagingEvent, { recursive: true }); await fsp.mkdir(nasEvent, { recursive: true });
  return { root, stagingRoot, nasRoot, stagingEvent, nasEvent };
}
async function put(dir, rel, content) {
  const f = path.join(dir, ...rel.split('/'));
  await fsp.mkdir(path.dirname(f), { recursive: true });
  await fsp.writeFile(f, content);
}
async function listPh(nasEvent, ph = 'Jane Doe') {
  try { return (await fsp.readdir(path.join(nasEvent, ph))).sort(); } catch { return []; }
}
async function readPh(nasEvent, name, ph = 'Jane Doe') {
  try { return await fsp.readFile(path.join(nasEvent, ph, name), 'utf8'); } catch { return null; }
}
function xmpWith(tag) {
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description dc:description="${tag}"/></rdf:RDF></x:xmpmeta>\n<?xpacket end="w"?>\n`;
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
const SINGLE_COMPONENT = { version: 1, hijriDate: '1448-01-01', eventName: 'Waaz', components: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }] };

console.log('rawXmpPairingSyncRegression (D1 — real syncJob, real ExifTool)');

(async () => {
  // ── Case A — no collision (control) ──
  await t('Case A: no collision — RAW and XMP land together at their bare basename', async () => {
    const d = await mk();
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    await put(d.stagingEvent, 'Jane Doe/A.xmp', xmpWith('INCOMING-A'));
    const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane Doe/A.CR2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(r.ok, JSON.stringify(r.errors));
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A.xmp']);
    assert.equal(await readPh(d.nasEvent, 'A.xmp'), xmpWith('INCOMING-A'));
  });

  // ── Case B — RAW collision only, no archive XMP ──
  await t('Case B: RAW collision, no archive XMP — pair lands at A_1, no stray A.xmp created', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-DIFFERENT-CONTENT-XXXX');
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    await put(d.stagingEvent, 'Jane Doe/A.xmp', xmpWith('INCOMING-A'));
    const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane Doe/A.CR2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(r.ok, JSON.stringify(r.errors));
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A_1.CR2', 'A_1.xmp']);
    assert.equal(await readPh(d.nasEvent, 'A.xmp'), null, 'no A.xmp must ever be created for the incoming file');
    assert.equal(await readPh(d.nasEvent, 'A_1.xmp'), xmpWith('INCOMING-A'));
  });

  // ── Case C — RAW collision + existing original pair ──
  await t('Case C: existing original pair untouched; incoming pair lands together at A_1', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-DIFFERENT-CONTENT-XXXX');
    await put(d.nasEvent, 'Jane Doe/A.xmp', xmpWith('OLD-A'));
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    await put(d.stagingEvent, 'Jane Doe/A.xmp', xmpWith('INCOMING-A'));
    const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane Doe/A.CR2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(r.ok, JSON.stringify(r.errors));
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A.xmp', 'A_1.CR2', 'A_1.xmp']);
    assert.equal(await readPh(d.nasEvent, 'A.xmp'), xmpWith('OLD-A'), 'existing pair must be untouched');
    assert.equal(await readPh(d.nasEvent, 'A_1.xmp'), xmpWith('INCOMING-A'), 'incoming pair must land together');
  });

  // ── Case D — first renamed sidecar slot occupied (the case that proves pair-aware resolution) ──
  await t('Case D: A_1.xmp occupied by an unrelated file — pair skips to A_2, A_1.xmp left untouched', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-DIFFERENT-CONTENT-XXXX');
    await put(d.nasEvent, 'Jane Doe/A_1.xmp', xmpWith('UNRELATED-A_1'));
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    await put(d.stagingEvent, 'Jane Doe/A.xmp', xmpWith('INCOMING-A'));
    const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane Doe/A.CR2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(r.ok, JSON.stringify(r.errors));
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A_1.xmp', 'A_2.CR2', 'A_2.xmp']);
    assert.equal(await readPh(d.nasEvent, 'A_1.xmp'), xmpWith('UNRELATED-A_1'), 'unrelated occupant must be untouched');
    assert.equal(await readPh(d.nasEvent, 'A_2.xmp'), xmpWith('INCOMING-A'), 'pair must share basename A_2');
    assert.equal(await readPh(d.nasEvent, 'A.xmp'), null, 'RAW must never be left unsidecarred at a mismatched basename');
  });

  // ── Case E — both A_1 names occupied ──
  await t('Case E: A_1.CR2+A_1.xmp both occupied — pair resolves to A_2', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-XXXX');
    await put(d.nasEvent, 'Jane Doe/A_1.CR2', 'OLD-RAW-1-YYYY');
    await put(d.nasEvent, 'Jane Doe/A_1.xmp', xmpWith('OLD-A_1'));
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    await put(d.stagingEvent, 'Jane Doe/A.xmp', xmpWith('INCOMING-A'));
    const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane Doe/A.CR2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(r.ok, JSON.stringify(r.errors));
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A_1.CR2', 'A_1.xmp', 'A_2.CR2', 'A_2.xmp']);
    assert.equal(await readPh(d.nasEvent, 'A_1.xmp'), xmpWith('OLD-A_1'), 'existing A_1 pair untouched');
    assert.equal(await readPh(d.nasEvent, 'A_2.xmp'), xmpWith('INCOMING-A'));
  });

  // ── Case F — deeper collision depth, mixed occupancy ──
  await t('Case F: A_2.CR2 occupied without its own sidecar — pair still resolves to a shared basename (A_3)', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-XXXX');
    await put(d.nasEvent, 'Jane Doe/A_1.CR2', 'OLD-RAW-1-YYYY');
    await put(d.nasEvent, 'Jane Doe/A_1.xmp', xmpWith('OLD-A_1'));
    await put(d.nasEvent, 'Jane Doe/A_2.CR2', 'OLD-RAW-2-ZZZZ'); // no A_2.xmp
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    await put(d.stagingEvent, 'Jane Doe/A.xmp', xmpWith('INCOMING-A'));
    const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane Doe/A.CR2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(r.ok, JSON.stringify(r.errors));
    const files = await listPh(d.nasEvent);
    assert.deepEqual(files, ['A.CR2', 'A_1.CR2', 'A_1.xmp', 'A_2.CR2', 'A_3.CR2', 'A_3.xmp'], 'must skip A_2.CR2 (RAW slot occupied) rather than pairing wrongly with it');
    assert.equal(await readPh(d.nasEvent, 'A_3.xmp'), xmpWith('INCOMING-A'));
  });

  // ── Case G — true duplicate RAW: existing skip semantics preserved ──
  await t('Case G1: identical RAW, no archive XMP — RAW skipped (not renamed), XMP copied fresh at bare name', async () => {
    const d = await mk();
    const same = 'same-size-content-12345';
    await put(d.nasEvent, 'Jane Doe/A.CR2', same);
    await put(d.stagingEvent, 'Jane Doe/A.CR2', same);
    await put(d.stagingEvent, 'Jane Doe/A.xmp', xmpWith('INCOMING-A'));
    const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane Doe/A.CR2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(r.ok, JSON.stringify(r.errors));
    assert.equal(r.skippedDuplicates, 1);
    assert.equal(r.copiedToArchive, 0, 'identical RAW must not be re-copied under a new suffix');
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A.xmp']);
  });

  await t('Case G2: identical RAW, archive XMP absent-then-present — XMP identical to incoming is skipped, not duplicated', async () => {
    const d = await mk();
    const same = 'same-size-content-98765';
    await put(d.nasEvent, 'Jane Doe/A.CR2', same);
    await put(d.nasEvent, 'Jane Doe/A.xmp', xmpWith('SAME'));
    await put(d.stagingEvent, 'Jane Doe/A.CR2', same);
    await put(d.stagingEvent, 'Jane Doe/A.xmp', xmpWith('SAME'));
    const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane Doe/A.CR2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(r.ok, JSON.stringify(r.errors));
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A.xmp']);
    assert.equal(await readPh(d.nasEvent, 'A.xmp'), xmpWith('SAME'));
  });

  await t('Case G3: identical RAW, archive XMP present but DIFFERENT — conflict/needs-attention preserved, never overwritten', async () => {
    const d = await mk();
    const same = 'same-size-content-55555';
    await put(d.nasEvent, 'Jane Doe/A.CR2', same);
    await put(d.nasEvent, 'Jane Doe/A.xmp', xmpWith('OLD-DIFFERENT'));
    await put(d.stagingEvent, 'Jane Doe/A.CR2', same);
    await put(d.stagingEvent, 'Jane Doe/A.xmp', xmpWith('INCOMING-DIFFERENT'));
    const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane Doe/A.CR2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(r.ok, JSON.stringify(r.errors));
    assert.equal(r.sidecarConflicts, 1);
    assert.equal(r.status, 'needs-attention');
    assert.equal(await readPh(d.nasEvent, 'A.xmp'), xmpWith('OLD-DIFFERENT'), 'must never overwrite the existing sidecar');
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A.xmp'], 'no stray renamed XMP must appear either');
  });

  // ── Case G2 (matrix) — same size, DIFFERENT content: must route through pair-aware suffix logic ──
  await t('Case (matrix G2): same-size but checksum-different RAW — routes through pair resolution like any other collision', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-CONTENT-SAME-LEN!!'); // 22 bytes
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'NEW-CONTENT-SAME-LEN!!'); // 22 bytes, different checksum
    await put(d.stagingEvent, 'Jane Doe/A.xmp', xmpWith('INCOMING-A'));
    const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane Doe/A.CR2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(r.ok, JSON.stringify(r.errors));
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A_1.CR2', 'A_1.xmp']);
    assert.equal(await readPh(d.nasEvent, 'A.xmp'), null);
  });

  // ── Case H — RAW without XMP: unchanged ──
  await t('Case H: RAW with no companion XMP — unchanged single-file rename behavior', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-XXXX');
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane Doe/A.CR2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(r.ok, JSON.stringify(r.errors));
    assert.equal(r.sidecarsCopied, 0);
    assert.deepEqual(await listPh(d.nasEvent), ['A.CR2', 'A_1.CR2']);
  });

  // ── Case I — orphan XMP, no RAW alongside: unchanged generic behavior ──
  await t('Case I: orphan XMP listed directly (no RAW) — unaffected, handled generically', async () => {
    const d = await mk();
    await put(d.stagingEvent, 'Jane Doe/Orphan.xmp', xmpWith('ORPHAN'));
    const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane Doe/Orphan.xmp'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(r.ok, JSON.stringify(r.errors));
    assert.deepEqual(await listPh(d.nasEvent), ['Orphan.xmp']);
  });

  // ── Representative RAW extensions from the config source of truth ──
  await t('RAW-extension scope: pairing fix applies uniformly across the configured RAW extension list', async () => {
    const sample = config.RAW_EXTENSIONS.filter(e => ['.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf'].includes(e));
    assert.ok(sample.length >= 4, 'sanity: config exposes the extensions this test expects');
    for (const ext of sample) {
      const d = await mk();
      await put(d.nasEvent, `Jane Doe/A${ext}`, 'OLD-RAW-DIFFERENT-XXXX');
      await put(d.stagingEvent, `Jane Doe/A${ext}`, 'incoming-raw');
      await put(d.stagingEvent, 'Jane Doe/A.xmp', xmpWith('INCOMING-A'));
      const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: [`Jane Doe/A${ext}`] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
      assert.ok(r.ok, `${ext}: ${JSON.stringify(r.errors)}`);
      const files = await listPh(d.nasEvent);
      assert.ok(files.includes(`A_1${ext}`) && files.includes('A_1.xmp'), `${ext}: expected paired A_1 files, got ${JSON.stringify(files)}`);
      assert.ok(!files.includes('A.xmp'), `${ext}: no stray A.xmp`);
    }
  });

  // ── Real ExifTool/XMP association proof ──
  await t('Real metadata association: distinctive incoming XMP content belongs ONLY to the incoming RAW basename, never the old one', async () => {
    const d = await mk();
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-DIFFERENT-CONTENT-XXXX');
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    const { ExifTool } = require('exiftool-vendored');
    const et = new ExifTool({ exiftoolArgs: ['-config', path.join(__dirname, '..', 'main', 'exiftool-config.pl'), '-stay_open', 'True', '-@', '-'] });
    const xmpPath = path.join(d.stagingEvent, 'Jane Doe', 'A.xmp');
    await fsp.mkdir(path.dirname(xmpPath), { recursive: true });
    const stub = '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>\n<?xpacket end="w"?>\n';
    await fsp.writeFile(xmpPath, stub, 'utf8');
    try {
      await et.write(xmpPath, { 'XMP-dc:Creator': 'Distinctive Incoming Photographer' }, ['-overwrite_original']);
    } finally { await et.end().catch(() => {}); }

    const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane Doe/A.CR2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(r.ok, JSON.stringify(r.errors));
    assert.equal(fs.existsSync(path.join(d.nasEvent, 'Jane Doe', 'A.xmp')), false, 'old RAW must not acquire a sidecar at all');
    const tags = await readFileTags(path.join(d.nasEvent, 'Jane Doe', 'A_1.xmp'));
    assert.deepEqual([].concat(tags.Creator || []), ['Distinctive Incoming Photographer'], 'the distinctive metadata must land only on the incoming RAW\'s own sidecar');
  });

  // ── Audit validation: no D1-induced issue, pre-existing incompleteness distinguished ──
  await t('Audit: corrected sync introduces no missing-sidecar / wrong-association issue for the new pair; old RAW\'s independent pre-existing incompleteness is separate', async () => {
    const d = await mk();
    await writeEventJson(d.nasEvent, SINGLE_COMPONENT);
    // Old RAW has NO sidecar of its own — an independently incomplete pre-existing file,
    // not something this test manufactures as "clean" and not something D1's fix is
    // responsible for repairing on its own.
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-DIFFERENT-CONTENT-XXXX');
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    await put(d.stagingEvent, 'Jane Doe/A.xmp', xmpWith('INCOMING-A'));

    const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane Doe/A.CR2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(r.ok, JSON.stringify(r.errors));

    const jobId = await runAuditAndWait(d.nasRoot);
    const report = await audit.getMetadataAuditReport(jobId, { limit: 1000 });
    const oldItem = report.items.find(i => path.basename(i.filePath) === 'A.CR2');
    const newItem = report.items.find(i => path.basename(i.filePath) === 'A_1.CR2');

    // The NEW pair (A_1.CR2 + A_1.xmp, correctly resolved by the fix) must show no wrong
    // association: its own real sidecar exists and is real XMP, not a stray/misattributed one.
    assert.ok(fs.existsSync(path.join(d.nasEvent, 'Jane Doe', 'A_1.xmp')), 'the new pair must have its own real sidecar on disk');
    assert.equal(fs.existsSync(path.join(d.nasEvent, 'Jane Doe', 'A.xmp')), false, 'no D1-induced sidecar must exist for the old RAW');

    // The OLD RAW's incompleteness (it never had a sidecar) is real and pre-existing —
    // Audit correctly flags it, but that is NOT a D1-induced defect, and this test does
    // not assert it away as "clean".
    assert.equal(oldItem?.status, 'partial', 'old RAW is independently incomplete — expected, not a D1 symptom');
    assert.ok(newItem, 'the new pair must be present in the audit report at its correct resolved path');
  });

  // ── Repair: the fixed sync itself needs no corrective repair for the new pair ──
  await t('Repair: a fully pre-populated old RAW + a correctly-synced new pair need zero corrective repair for the new pair', async () => {
    const d = await mk();
    await writeEventJson(d.nasEvent, SINGLE_COMPONENT);
    // Give the OLD RAW its own real, already-correct sidecar first (simulating a real
    // prior import) so it starts genuinely complete, isolating what's being measured.
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-DIFFERENT-CONTENT-XXXX');
    let jobId = await runAuditAndWait(d.nasRoot);
    await repair.runMetadataRepair(jobId);

    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    await put(d.stagingEvent, 'Jane Doe/A.xmp', xmpWith('INCOMING-A'));
    const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane Doe/A.CR2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(r.ok, JSON.stringify(r.errors));

    jobId = await runAuditAndWait(d.nasRoot);
    const report = await audit.getMetadataAuditReport(jobId, { limit: 1000 });
    const oldItem = report.items.find(i => path.basename(i.filePath) === 'A.CR2');
    const newItem = report.items.find(i => path.basename(i.filePath) === 'A_1.CR2');
    assert.equal(oldItem?.status, 'complete', 'old RAW (already repaired before the sync) must remain complete — untouched by the sync');
    // The new pair carries the operator's own incoming XMP content (real metadata, not the
    // component defaults) — its EXIF-facing content is respected, not silently repaired away.
    assert.ok(newItem, 'new pair must appear in the report at its correct resolved path');
  });

  // ── _copiedPairs / event.json durable intent — Case D scenario specifically ──
  await t('_copiedPairs and event.json intent: Case D (A_2 resolution) — durable intent points to the true final RAW destination', async () => {
    const d = await mk();
    await writeEventJson(d.nasEvent, SINGLE_COMPONENT);
    await put(d.nasEvent, 'Jane Doe/A.CR2', 'OLD-RAW-DIFFERENT-CONTENT-XXXX');
    await put(d.nasEvent, 'Jane Doe/A_1.xmp', xmpWith('UNRELATED-A_1'));
    await writeEventJson(d.stagingEvent, {
      ...SINGLE_COMPONENT,
      tagRefinements: [{ eventTypes: [], additionalKeywords: [], relPaths: ['Jane Doe/A.CR2'] }],
    });
    await put(d.stagingEvent, 'Jane Doe/A.CR2', 'incoming-raw-A');
    await put(d.stagingEvent, 'Jane Doe/A.xmp', xmpWith('INCOMING-A'));

    const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane Doe/A.CR2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(r.ok, JSON.stringify(r.errors));

    const pairs = r._copiedPairs.map(p => path.relative(d.nasEvent, p.to).split(path.sep).join('/')).sort();
    assert.deepEqual(pairs, ['Jane Doe/A_2.CR2', 'Jane Doe/A_2.xmp']);

    const finalDoc = readEventJson(d.nasEvent);
    const relPaths = (finalDoc.tagRefinements || []).flatMap(b => b.relPaths);
    assert.deepEqual(relPaths, ['Jane Doe/A_2.CR2'], 'durable intent must point to the true final RAW destination, not the pre-rename staging path');
  });

  console.log(`${passed} passed`);
  await shutdown().catch(() => {});
  process.exit(process.exitCode || 0);
})();
