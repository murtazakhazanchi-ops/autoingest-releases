'use strict';

// Regression tests for Creator/Artist/By-line PRESERVATION across ALL routine/
// automatic post-import processing — not only Reapply, and not only the fully-
// unresolved QMZ-container case already covered by qmzCreatorAttributionFix.test.js.
//
// Requirements under test (verbatim from the task):
//   1. "QMZ auto-queue is routine processing, not an authorized photographer-name
//      change. Preserve existing Creator, Artist, and By-line during QMZ assignment,
//      reassignment, moves, reapply, retries, and resume — even when the folder
//      resolves to a different photographer. Only initial import or an explicitly
//      requested attribution/name correction may set or replace attribution."
//   2. "Remove automatic 'self-healing' of existing sequence-like creator values from
//      routine processing. Report suspected corruption and propose the photographer
//      correction through the preview-only repair workflow. Apply it only after
//      explicit approval. Audit must remain read-only."
//
// Design: exifService._writeAndVerify applies ONE unconditional rule — if the file
// currently has a non-empty Creator, preserve it; only write when it's empty (first
// capture). This rule is NOT caller-flagged, so it automatically covers every path
// that calls it: QMZ auto-queue (applyBatch), Reapply (applyBatch), retry
// (retryFailed, reuses the same frozen expectation), and resume/Repair
// (resumeFrozenFile → this same function). The ONLY way to replace an existing
// value is exifService.applyExplicitAttributionCorrection — never called
// automatically. Audit (metadataAuditService.classifyOneFile) still detects and
// reports a suspected-corrupted value (CREATOR_SUSPECTED_CORRUPTION diagnostic) but
// never performs or authorizes a write — it stays read-only, and even Repair's own
// write (going through the same unconditional rule) cannot silently fix it.
//
// Uses REAL temp files + REAL ExifTool (via exiftool-vendored) and real `sharp`-
// generated JPEGs — no mocking of the write/read path. No Electron dependency: this
// exercises exifService's pure/IO functions directly (never the app-dependent logger)
// and metadataAuditService.classifyOneFile.
// Run with: node test/qmzAttributionPreservationFix.test.js

const assert = require('node:assert/strict');
const fsp    = require('node:fs/promises');
const os     = require('node:os');
const path   = require('node:path');

const exifService = require('../main/exifService');
const { resolveExpectedMetadata } = require('../services/metadataExpectationService');
const { classifyOneFile, CREATOR_SUSPECTED_CORRUPTION, CREATOR_ATTRIBUTION_CONFLICT, CREATOR_RAW_EMBEDDED_UNVERIFIED } = require('../services/metadataAuditService');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}
console.log('qmzAttributionPreservationFix');

const tmpDir = () => fsp.mkdtemp(path.join(os.tmpdir(), 'ai-attrpres-'));

async function makeJpeg(filePath) {
  const sharp = require('sharp');
  await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 10, g: 200, b: 10 } } })
    .jpeg().toFile(filePath);
}

// A real TIFF (sharp-generated) under a .cr2 extension — _writeMetadata only checks
// existence for RAW, but reading/writing the RAW's OWN embedded tags (requirement:
// "check existing embedded attribution as well as the sidecar") needs a container
// ExifTool actually accepts; plain placeholder bytes make it refuse the write.
async function makeRawWithSidecar(dir, { withSidecar = true } = {}) {
  const rawFile = path.join(dir, 'a.cr2');
  const sharp = require('sharp');
  await sharp({ create: { width: 2, height: 2, channels: 3, background: { r: 1, g: 2, b: 3 } } }).tiff().toFile(rawFile);
  const sidecar = path.join(dir, 'a.xmp');
  if (withSidecar) {
    await fsp.writeFile(sidecar,
      '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>\n<?xpacket end="w"?>\n');
  }
  return { rawFile, sidecar };
}

// Writes Creator/Artist/By-line together, matching the shape _buildTags itself
// produces at an original capture write — so a later preservation check can verify
// all three survive, not just XMP-dc:Creator. iptcExif:false for XMP sidecars, which
// carry XMP tags only.
async function writeCreator(filePath, creator, { iptcExif = true } = {}) {
  const ExifTool = require('exiftool-vendored').ExifTool;
  const inst = new ExifTool();
  const tags = { 'XMP-dc:Creator': [creator] };
  if (iptcExif) { tags['EXIF:Artist'] = creator; tags['IPTC:By-line'] = creator; }
  try { await inst.write(filePath, tags, ['-overwrite_original']); }
  finally { await inst.end(); }
}

async function readCreator(filePath) {
  const tags = await exifService.readFileTags(filePath);
  const v = tags.Creator ?? tags['XMP-dc:Creator'];
  return Array.isArray(v) ? v[0] : v;
}

function baseExpectation(photographer, extra = {}) {
  return {
    photographer, photographerUnresolved: false,
    component: null, keywords: ['Ziyarat'], hijriDate: null, eventDescription: 'Ev',
    copyright: '© Aljamea-tus-Saifiyah', ...extra,
  };
}

// Builds the expectation exactly the way the real QMZ auto-queue path does:
// exifService.buildEvidence(file, context) with a QMZ-shaped context (`component`
// present, no `diskComponents`) → resolveExpectedMetadata — i.e. Tier 2 explicit-QMZ
// evidence, the real shape `_qmzAutoQueueMetadata`'s IPC call produces.
function qmzAutoQueueExpectation(photographer) {
  const context = {
    component: { location: 'Hall A', city: 'Surat', country: 'India', types: ['Qadam'] },
    explicitTags: ['Qadam'], hijriDate: null, eventDescription: 'Ev',
  };
  const file = { dest: '/irrelevant', photographer };
  const evidence = exifService.buildEvidence(file, context);
  return resolveExpectedMetadata(evidence);
}

(async () => {
  // ═══ Requirement 1: QMZ auto-queue/reassignment preserves existing attribution ═══

  await t('QMZ auto-queue: Creator "A" survives when the folder resolves to a different photographer "B" (JPEG)', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'a.jpg');
    await makeJpeg(file);
    await writeCreator(file, 'A'); // already assigned once — e.g. a prior QMZ assignment

    const expectation = qmzAutoQueueExpectation('B'); // operator reassigns the file to a different photographer folder
    await exifService._writeAndVerify({ src: file, dest: file }, {}, expectation, false);

    assert.equal(await readCreator(file), 'A', 'reassignment/move must never overwrite existing attribution — that is routine processing, not an approved correction');
  });

  await t('QMZ auto-queue: Creator "A" survives reassignment for a RAW file\'s XMP sidecar', async () => {
    const dir = await tmpDir();
    const { rawFile, sidecar } = await makeRawWithSidecar(dir);
    await writeCreator(sidecar, 'A', { iptcExif: false });

    const expectation = qmzAutoQueueExpectation('B');
    await exifService._writeAndVerify({ src: rawFile, dest: rawFile }, {}, expectation, true);

    assert.equal(await readCreator(sidecar), 'A');
  });

  await t('QMZ auto-queue: IPTC By-line and EXIF Artist are preserved the same way as XMP Creator', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'a.jpg');
    await makeJpeg(file);
    await writeCreator(file, 'A');

    await exifService._writeAndVerify({ src: file, dest: file }, {}, qmzAutoQueueExpectation('B'), false);

    const tags = await exifService.readFileTags(file);
    assert.equal(tags.Artist, 'A');
    const byLine = Array.isArray(tags['By-line']) ? tags['By-line'][0] : tags['By-line'];
    assert.equal(byLine, 'A');
  });

  await t('QMZ auto-queue: an EMPTY current Creator (true first write — initial capture) still gets written', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'a.jpg');
    await makeJpeg(file); // fresh file, never assigned before

    await exifService._writeAndVerify({ src: file, dest: file }, {}, qmzAutoQueueExpectation('Jane Doe'), false);

    assert.equal(await readCreator(file), 'Jane Doe', 'initial import/first assignment is the one sanctioned capture moment');
  });

  await t('Reapply (routine): Creator "A" survives when the folder resolves to a different photographer "B" — unchanged from the earlier fix', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'a.jpg');
    await makeJpeg(file);
    await writeCreator(file, 'A');

    await exifService._writeAndVerify({ src: file, dest: file }, {}, baseExpectation('B'), false);

    assert.equal(await readCreator(file), 'A');
  });

  await t('retry/resume: re-applying the SAME frozen expectation twice in a row never drifts away from the preserved value', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'a.jpg');
    await makeJpeg(file);
    await writeCreator(file, 'A');

    const expectation = qmzAutoQueueExpectation('B');
    await exifService._writeAndVerify({ src: file, dest: file }, {}, expectation, false); // first attempt
    await exifService._writeAndVerify({ src: file, dest: file }, {}, expectation, false); // retry/resume re-applies the identical frozen expectation

    assert.equal(await readCreator(file), 'A');
  });

  // ═══ Requirement 2: suspected corruption is flagged, never self-healed ═══

  await t('a suspected-corrupted Creator ("27Z") is NOT self-healed by a routine write (JPEG) — it is left exactly as-is', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'a.jpg');
    await makeJpeg(file);
    await writeCreator(file, '27Z'); // residue of the original bug

    await exifService._writeAndVerify({ src: file, dest: file }, {}, baseExpectation('Jane Doe'), false);

    assert.equal(await readCreator(file), '27Z', 'automatic self-healing is removed — a corrupted value must be reported, not silently rewritten');
  });

  await t('a suspected-corrupted Creator ("27Z") is NOT self-healed for a RAW file\'s XMP sidecar', async () => {
    const dir = await tmpDir();
    const { rawFile, sidecar } = await makeRawWithSidecar(dir);
    await writeCreator(sidecar, '27Z', { iptcExif: false });

    await exifService._writeAndVerify({ src: rawFile, dest: rawFile }, {}, baseExpectation('Jane Doe'), true);

    assert.equal(await readCreator(sidecar), '27Z');
  });

  await t('_Unsequenced/Enroute-shaped current Creator is also left untouched, never self-healed', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'a.jpg');
    await makeJpeg(file);
    await writeCreator(file, '_Unsequenced');

    await exifService._writeAndVerify({ src: file, dest: file }, {}, baseExpectation('Jane Doe'), false);

    assert.equal(await readCreator(file), '_Unsequenced');
  });

  await t('retry/restart of a suspected-corrupted file still never self-heals, across repeated attempts', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'a.jpg');
    await makeJpeg(file);
    await writeCreator(file, '27Z');

    const expectation = baseExpectation('Jane Doe');
    await exifService._writeAndVerify({ src: file, dest: file }, {}, expectation, false);
    await exifService._writeAndVerify({ src: file, dest: file }, {}, expectation, false);

    assert.equal(await readCreator(file), '27Z');
  });

  // ═══ Audit: reports suspected corruption, stays read-only, Repair cannot fix it either ═══

  const singleDoc = () => ({
    version: 1, hijriDate: '1448-01-01', eventName: 'Ev',
    components: [{ folderName: 'Ziyarat-Hall A', location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyarat'], additionalKeywords: [] }],
    imports: [{ photographer: 'Jane Doe' }],
  });

  await t('classifyOneFile: a legitimate, different current Creator is NOT flagged as a mismatch (Audit correctly treats it as fine)', async () => {
    const dir = await tmpDir();
    const phDir = path.join(dir, 'Ann Poe');
    await fsp.mkdir(phDir, { recursive: true });
    const file = path.join(phDir, 'a.jpg');
    await makeJpeg(file);
    await writeCreator(file, 'Jane Doe'); // deliberately different from the folder ("Ann Poe")

    const record = await classifyOneFile(dir, singleDoc(), file);
    assert.equal(record.fields.photographer.status, 'match');
    assert.equal(record.intentDiagnostics, null);
  });

  await t('classifyOneFile: a suspected-corrupted Creator ("27Z") IS flagged as a mismatch with CREATOR_SUSPECTED_CORRUPTION — reported, not corrected', async () => {
    const dir = await tmpDir();
    const phDir = path.join(dir, 'Ann Poe');
    await fsp.mkdir(phDir, { recursive: true });
    const file = path.join(phDir, 'a.jpg');
    await makeJpeg(file);
    await writeCreator(file, '27Z');

    const record = await classifyOneFile(dir, singleDoc(), file);
    assert.equal(record.fields.photographer.status, 'incorrect', 'suspected corruption must be reported');
    assert.ok(record.intentDiagnostics.includes(CREATOR_SUSPECTED_CORRUPTION), `expected the suspected-corruption diagnostic: ${record.intentDiagnostics}`);

    // Audit stays read-only: it never wrote anything above. Confirm that even
    // Repair's own write (which freezes and later writes record.expectation
    // verbatim via resumeFrozenFile → _writeAndVerify) STILL cannot change this —
    // the unconditional preserve rule protects it regardless of what Repair's
    // frozen expectation says.
    await exifService._writeAndVerify({ src: file, dest: file }, {}, record.expectation, false);
    assert.equal(await readCreator(file), '27Z', 'Repair must not be able to silently "fix" a suspected-corrupted Creator — only the explicit correction channel may');
  });

  await t('classifyOneFile: an EMPTY current Creator is flagged "missing" (first real attribution still proposed for Repair/initial write)', async () => {
    const dir = await tmpDir();
    const phDir = path.join(dir, 'Ann Poe');
    await fsp.mkdir(phDir, { recursive: true });
    const file = path.join(phDir, 'a.jpg');
    await makeJpeg(file);

    const record = await classifyOneFile(dir, singleDoc(), file);
    assert.equal(record.fields.photographer.status, 'missing');
    assert.equal(record.expectation.photographer, 'Ann Poe');
  });

  await t('classifyOneFile: a photographerUnresolved file (QMZ container, no photographer sub-folder) is NEVER classified "complete" — stays visible for operator review', async () => {
    const dir = await tmpDir();
    const seqDir = path.join(dir, '27Z');
    await fsp.mkdir(seqDir, { recursive: true });
    const file = path.join(seqDir, 'photo.jpg');
    await makeJpeg(file);

    const record = await classifyOneFile(dir, singleDoc(), file);
    assert.equal(record.expectation.photographerUnresolved, true);
    assert.notEqual(record.status, 'complete', '"complete" records are filtered out of the Audit UI exceptions list entirely');
    assert.deepEqual(record.intentDiagnostics, ['photographer:qmz-container-unresolved']);
  });

  // ═══ The explicit, human-approved correction channel — the ONLY way to change it ═══

  await t('applyExplicitAttributionCorrection: an explicitly approved correction replaces "27Z" with the verified photographer (JPEG) — Creator, Artist, By-line', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'a.jpg');
    await makeJpeg(file);
    await writeCreator(file, '27Z');

    const result = await exifService.applyExplicitAttributionCorrection(file, false, 'Jane Doe');
    assert.ok(result.ok, JSON.stringify(result));

    assert.equal(await readCreator(file), 'Jane Doe');
    const tags = await exifService.readFileTags(file);
    assert.equal(tags.Artist, 'Jane Doe');
    const byLine = Array.isArray(tags['By-line']) ? tags['By-line'][0] : tags['By-line'];
    assert.equal(byLine, 'Jane Doe');
  });

  await t('applyExplicitAttributionCorrection: an explicitly approved correction replaces "27Z" in a RAW file\'s XMP sidecar', async () => {
    const dir = await tmpDir();
    const { rawFile, sidecar } = await makeRawWithSidecar(dir);
    await writeCreator(sidecar, '27Z', { iptcExif: false });

    const result = await exifService.applyExplicitAttributionCorrection(rawFile, true, 'Jane Doe');
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(await readCreator(sidecar), 'Jane Doe');
  });

  await t('applyExplicitAttributionCorrection does not touch keywords/copyright/other fields — only attribution', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'a.jpg');
    await makeJpeg(file);
    const ExifTool = require('exiftool-vendored').ExifTool;
    const inst = new ExifTool();
    try {
      await inst.write(file, { 'XMP-dc:Creator': ['27Z'], 'XMP-dc:Subject': ['Ziyarat', 'Surat'], 'XMP-dc:Rights': 'custom-rights' }, ['-overwrite_original']);
    } finally { await inst.end(); }

    await exifService.applyExplicitAttributionCorrection(file, false, 'Jane Doe');

    const tags = await exifService.readFileTags(file);
    assert.deepEqual([tags.Subject].flat(), ['Ziyarat', 'Surat']);
    assert.equal(tags.Rights, 'custom-rights');
  });

  // ═══ Edge cases: individual fields, conflicts, read failures, RAW-embedded checks ═══

  await t('XMP Creator empty but EXIF Artist has a photographer: that attribution is preserved, never replaced by the folder-derived name (JPEG)', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'a.jpg');
    await makeJpeg(file);
    const ExifTool = require('exiftool-vendored').ExifTool;
    const inst = new ExifTool();
    try { await inst.write(file, { 'EXIF:Artist': 'Jane Doe' }, ['-overwrite_original']); } finally { await inst.end(); }

    await exifService._writeAndVerify({ src: file, dest: file }, {}, baseExpectation('Ann Poe'), false);

    const tags = await exifService.readFileTags(file);
    assert.equal(tags.Artist, 'Jane Doe', 'existing Artist must survive untouched');
    assert.equal(await readCreator(file), undefined, 'Creator must stay empty — never backfilled with the folder-derived guess when ANY attribution field already exists');
  });

  await t('XMP Creator empty but IPTC By-line has a photographer: that attribution is preserved, never replaced by the folder-derived name (JPEG)', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'a.jpg');
    await makeJpeg(file);
    const ExifTool = require('exiftool-vendored').ExifTool;
    const inst = new ExifTool();
    try { await inst.write(file, { 'IPTC:By-line': 'Jane Doe' }, ['-overwrite_original']); } finally { await inst.end(); }

    await exifService._writeAndVerify({ src: file, dest: file }, {}, baseExpectation('Ann Poe'), false);

    const tags = await exifService.readFileTags(file);
    const byLine = Array.isArray(tags['By-line']) ? tags['By-line'][0] : tags['By-line'];
    assert.equal(byLine, 'Jane Doe');
    assert.equal(await readCreator(file), undefined);
  });

  await t('Creator and Artist disagree: both are preserved individually, untouched — never silently normalized to one value, never replaced by the folder-derived name', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'a.jpg');
    await makeJpeg(file);
    const ExifTool = require('exiftool-vendored').ExifTool;
    const inst = new ExifTool();
    try { await inst.write(file, { 'XMP-dc:Creator': ['Jane Doe'], 'EXIF:Artist': 'John Smith' }, ['-overwrite_original']); } finally { await inst.end(); }

    await exifService._writeAndVerify({ src: file, dest: file }, {}, baseExpectation('Ann Poe'), false);

    assert.equal(await readCreator(file), 'Jane Doe', 'Creator must not be normalized to match Artist');
    const tags = await exifService.readFileTags(file);
    assert.equal(tags.Artist, 'John Smith', 'Artist must not be normalized to match Creator');
  });

  await t('readCurrentAttribution: a genuine read failure (file exists but cannot be read) is reported as readFailed, never as absent', async () => {
    const dir = await tmpDir();
    const brokenPath = path.join(dir, 'broken.jpg');
    await fsp.mkdir(brokenPath); // exists at that path, but is not a readable image file
    const result = await exifService.readCurrentAttribution(brokenPath, false);
    assert.equal(result.status, 'readFailed', `must never be classified 'absent': ${JSON.stringify(result)}`);
    // _writeAndVerify's gate is `if (current.status !== 'absent')` — 'readFailed' takes
    // the identical "do not write" branch 'present' and 'conflict' already take above
    // (verified extensively), so a read failure can never be treated as license to
    // overwrite with the folder-derived guess.
  });

  await t('RAW: no XMP sidecar exists yet, but the RAW file itself already has embedded Artist — NOT treated as absent; the sidecar write is refused', async () => {
    const dir = await tmpDir();
    const { rawFile } = await makeRawWithSidecar(dir, { withSidecar: false });
    // Simulate pre-existing camera/externally-embedded attribution directly on the
    // RAW file (never written there by AutoIngest itself, but it can already exist).
    const ExifTool = require('exiftool-vendored').ExifTool;
    const inst = new ExifTool();
    try { await inst.write(rawFile, { 'EXIF:Artist': 'Jane Doe' }, ['-overwrite_original']); } finally { await inst.end(); }

    const current = await exifService.readCurrentAttribution(rawFile, true);
    assert.equal(current.status, 'present', 'embedded RAW attribution must count even with no sidecar yet');
    assert.equal(current.value, 'Jane Doe');

    await exifService._writeAndVerify({ src: rawFile, dest: rawFile }, {}, baseExpectation('Ann Poe'), true);
    const sidecar = path.join(dir, 'a.xmp');
    const sidecarCreator = await readCreator(sidecar).catch(() => undefined);
    assert.ok(!sidecarCreator, 'no sidecar Creator should be written — the RAW is already attributed');
  });

  await t('RAW: sidecar and the RAW file\'s own embedded tags disagree — reported as a conflict, both left untouched', async () => {
    const dir = await tmpDir();
    const { rawFile, sidecar } = await makeRawWithSidecar(dir);
    await writeCreator(sidecar, 'Jane Doe', { iptcExif: false });
    const ExifTool = require('exiftool-vendored').ExifTool;
    const inst = new ExifTool();
    try { await inst.write(rawFile, { 'EXIF:Artist': 'John Smith' }, ['-overwrite_original']); } finally { await inst.end(); }

    const current = await exifService.readCurrentAttribution(rawFile, true);
    assert.equal(current.status, 'conflict');

    await exifService._writeAndVerify({ src: rawFile, dest: rawFile }, {}, baseExpectation('Ann Poe'), true);
    assert.equal(await readCreator(sidecar), 'Jane Doe', 'sidecar value must survive unchanged');
    const rawTags = await exifService.readFileTags(rawFile);
    assert.equal(rawTags.Artist, 'John Smith', 'RAW-embedded value must also survive unchanged');
  });

  await t('genuinely absent attribution is populated only from the verified photographer association, never a sequence/container name', async () => {
    const dir = await tmpDir();
    const file = path.join(dir, 'a.jpg');
    await makeJpeg(file); // no Creator/Artist/By-line anywhere

    const current = await exifService.readCurrentAttribution(file, false);
    assert.equal(current.status, 'absent');

    await exifService._writeAndVerify({ src: file, dest: file }, {}, baseExpectation('Jane Doe'), false);
    assert.equal(await readCreator(file), 'Jane Doe', 'a verified photographer name may populate genuinely-absent attribution');
  });

  await t('classifyOneFile: a conflict is flagged with CREATOR_ATTRIBUTION_CONFLICT and keeps the record non-"complete" even when Creator alone happens to match the folder-derived expectation', async () => {
    const dir = await tmpDir();
    const phDir = path.join(dir, 'Ann Poe');
    await fsp.mkdir(phDir, { recursive: true });
    const file = path.join(phDir, 'a.jpg');
    await makeJpeg(file);
    const ExifTool = require('exiftool-vendored').ExifTool;
    const inst = new ExifTool();
    try {
      // Creator deliberately matches the folder-derived name ("Ann Poe") so the
      // photographer FIELD diff alone would show "match" — the conflict is only
      // visible via Artist disagreeing. Also sets every other field to the
      // resolver's expected value so nothing else could independently force
      // non-'complete' status — isolating this one diagnostic's effect.
      await inst.write(file, {
        'XMP-dc:Creator': ['Ann Poe'], 'EXIF:Artist': 'Someone Else',
        'XMP-dc:Rights': '© Aljamea-tus-Saifiyah', 'XMP-dc:Subject': ['Ziyarat', 'Quran Tilawat', 'Hall A', 'Surat', 'India'],
        'XMP-dc:Description': 'Ev',
      }, ['-overwrite_original']);
    } finally { await inst.end(); }

    const record = await classifyOneFile(dir, singleDoc(), file);
    assert.equal(record.fields.photographer.status, 'match', 'sanity check: Creator alone really does match the folder-derived guess');
    assert.notEqual(record.status, 'complete', 'a flagged conflict must never silently disappear from the Audit exceptions list');
    assert.ok(record.intentDiagnostics.includes(CREATOR_ATTRIBUTION_CONFLICT), `expected the conflict diagnostic: ${record.intentDiagnostics}`);
  });

  await t('classifyOneFile (RAW): a clean, fully-matching sidecar does NOT classify as "complete" when the RAW\'s own embedded attribution could not be read — the uncertainty stays visible, never silently resolved as verified', async () => {
    const dir = await tmpDir();
    const phDir = path.join(dir, 'Ann Poe');
    await fsp.mkdir(phDir, { recursive: true });
    // The RAW path itself is unreadable as a media file (a directory, not a real
    // RAW) — simulates a genuine read failure on the RAW-embedded check, while the
    // sidecar (what classifyOneFile actually reads for `actual`) is clean and fully
    // matches the resolver's expectation for every field.
    const rawPath = path.join(phDir, 'a.cr2');
    await fsp.mkdir(rawPath);
    const sidecar = path.join(phDir, 'a.xmp');
    await fsp.writeFile(sidecar,
      '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>\n<?xpacket end="w"?>\n');
    const ExifTool = require('exiftool-vendored').ExifTool;
    const inst = new ExifTool();
    try {
      await inst.write(sidecar, {
        'XMP-dc:Creator': ['Ann Poe'], 'XMP-dc:Rights': '© Aljamea-tus-Saifiyah',
        'XMP-dc:Subject': ['Ziyarat', 'Quran Tilawat', 'Hall A', 'Surat', 'India'],
        'XMP-dc:Description': 'Ev',
      }, ['-overwrite_original']);
    } finally { await inst.end(); }

    const record = await classifyOneFile(dir, singleDoc(), rawPath);
    assert.equal(record.fields.photographer.status, 'match', 'sanity check: the sidecar alone really does look clean and fully matching');
    assert.notEqual(record.status, 'complete', 'a RAW whose own embedded attribution could not be verified must never classify as complete merely because the sidecar looks fine');
    assert.ok(record.intentDiagnostics.includes(CREATOR_RAW_EMBEDDED_UNVERIFIED), `expected the unverified diagnostic: ${record.intentDiagnostics}`);
  });

  console.log(`${passed} passed`);
  if (process.exitCode) console.log('SOME TESTS FAILED');

  // exifService lazily spawns its own singleton ExifTool pool (via _getExifTool, used
  // by _writeAndVerify/readFileTags/applyExplicitAttributionCorrection above) which
  // otherwise keeps the event loop alive indefinitely — shut it down so this one-shot
  // test script actually exits.
  await exifService.shutdown();
})();
