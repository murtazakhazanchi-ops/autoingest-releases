'use strict';

// Lifecycle proof that persisted operator metadata intent (event.json tagRefinements +
// metadataGroups) is honored by EVERY post-import workflow — Audit, Repair, restart/resume,
// the Reapply context path and Transfer verification — using the real ExifTool, the real
// persistent queue, and NO original source/card (only archive-side state exists here).
//
// Default (A), explicit subset (B) and explicit No Tags (C) are exercised for RAW/XMP and JPG,
// single-component (EVENT_SCOPE-style) and multi-component (group-style) events, plus a legacy
// MetaPicker event. Requires the Electron binary (exifService needs app.getPath):
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --no-sandbox \
//     --user-data-dir=<tmp> test/metadataIntentLifecycle.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const mkQ = p => fs.mkdtempSync(path.join(os.tmpdir(), p));
function freshDirs() {                                   // every test gets isolated queue / audit / repair dirs
  process.env.AUTOINGEST_METADATA_QUEUE_DIR = mkQ('ai-mil-queue-');
  process.env.AUTOINGEST_METADATA_AUDIT_DIR = mkQ('ai-mil-audit-');
  process.env.AUTOINGEST_METADATA_REPAIR_DIR = mkQ('ai-mil-repair-');
}
freshDirs();

const audit = require('../services/metadataAuditService');
const repair = require('../main/metadataRepairService');
const queueStore = require('../main/metadataQueueStore');
const { resumeInterruptedBatches } = require('../main/metadataQueueRecovery');
const exifService = require('../main/exifService');
const verification = require('../main/metadataVerificationService');
const { resolveExpectedMetadata } = require('../services/metadataExpectationService');
const { buildEventEvidenceContext } = require('../services/eventEvidenceReconstruction');
const intent = require('../services/eventMetadataIntent');
const { ExifTool } = require('exiftool-vendored');

const et = new ExifTool();
let passed = 0;
async function t(name, fn) {
  try { freshDirs(); await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}
const J = x => JSON.stringify(x);
const same = (a, b) => J([...(a || [])].sort()) === J([...(b || [])].sort());
const asArr = v => (v === undefined || v === null) ? [] : (Array.isArray(v) ? v : [v]);
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const CTX = ['Hall A', 'Surat', 'India'];
const compOne = { location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyarat'], folderName: 'Ziyarat-Hall A', additionalKeywords: [{ label: 'Quran Tilawat' }] };
const compTwo = { location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyarat', 'Waaz'], folderName: 'Ziyarat-Waaz-Hall A', additionalKeywords: [{ label: 'Quran Tilawat' }] };
const compB = { location: 'Hall B', city: 'Surat', country: 'India', types: ['Waaz', 'Majlis'], folderName: 'Waaz-Majlis-Hall B', additionalKeywords: [{ label: 'Children' }] };
const EMPTY = { eventTypes: [], additionalKeywords: [] };
const SUB = { eventTypes: ['Ziyarat'], additionalKeywords: [] };

const sidecarOf = f => f.slice(0, -path.extname(f).length) + '.xmp';
const targetOf = f => (path.extname(f).toLowerCase() === '.jpg' ? f : sidecarOf(f));
async function subjectOf(f) { const tags = await exifService.readFileTags(targetOf(f)); return asArr(tags.Subject).map(String); }

/** Builds an archive-side event exactly as a real import leaves it: files on disk, real metadata written by the
 *  real pipeline from an import-shaped payload, and event.json intent written by the SAME delta+merge the import uses. */
async function buildEvent({ components, files, tags, refinements }) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-mil-arc-'));
  const eventDir = path.join(root, 'Coll', 'Event');
  await fsp.mkdir(eventDir, { recursive: true });
  const eventJson = { version: 1, hijriDate: '1448-01-01', eventName: 'Lifecycle', status: 'complete', components, imports: [{ id: 'i1', photographer: 'Jane Doe' }] };
  const abs = {};
  for (const rel of files) {
    const f = path.join(eventDir, ...rel.split('/'));
    await fsp.mkdir(path.dirname(f), { recursive: true });
    await fsp.writeFile(f, path.extname(rel) === '.jpg' ? JPEG : Buffer.from('not-a-real-raw-' + rel));
    abs[rel] = f;
  }
  // import-shaped payload groups (src === dest: the copy step is out of scope for these tests)
  const fr = {}; for (const [rel, v] of Object.entries(refinements || {})) fr[abs[rel]] = v;
  const multi = components.length > 1;
  const groups = multi
    ? components.map(c => ({ id: c.folderName, subEventId: c.folderName, files: files.filter(r => r.startsWith(c.folderName + '/')).map(r => abs[r]),
        fileTagRefinements: Object.fromEntries(Object.entries(fr).filter(([k]) => k.includes(path.sep + c.folderName + path.sep))) }))
    : (tags
        ? Object.entries(tags).map(([g, spec], i) => ({ id: i + 1, subEventId: null, metadataTags: spec.tags, files: spec.files.map(r => abs[r]), fileTagRefinements: fr }))
        : [{ id: 0, subEventId: null, files: files.map(r => abs[r]), fileTagRefinements: fr }]);
  const copied = files.map(r => ({ src: abs[r], dest: abs[r] }));
  const delta = intent.buildImportIntentDelta({ eventFolderPath: eventDir, groups, copiedFiles: copied, skippedFiles: [] });
  const tr = intent.mergeTagRefinements(undefined, delta.refinements), mg = intent.mergeMetadataGroups(undefined, delta.metaTags);
  if (tr.value) eventJson.tagRefinements = tr.value;
  if (mg.value) eventJson.metadataGroups = mg.value;
  await fsp.writeFile(path.join(eventDir, 'event.json'), JSON.stringify(eventJson, null, 2));
  const context = { photographer: 'Jane Doe', hijriDate: eventJson.hijriDate, eventDescription: eventJson.eventName, groups, diskComponents: components };
  // photographer per file from its folder (as a real import does): <photographer>/… or <component>/<photographer>/…
  const photographerOf = rel => rel.split('/')[multi ? 1 : 0];
  const status = await runBatch(files.map(r => ({ src: abs[r], dest: abs[r], photographer: photographerOf(r) })), context);
  assert.equal(status.done, files.length, 'the real import-time write must succeed for the lifecycle test to mean anything');
  return { root, eventDir, eventJson, abs, groups, context, files };
}
let batchSeq = 0;
function runBatch(files, context) {
  return new Promise(resolve => {
    exifService.applyBatch(`mil-${++batchSeq}-${Date.now()}`, files, context, p => { if (p.event === 'batch_complete' || p.event === 'batch_error') resolve(p); });
  });
}
async function auditEvent(eventDir) {
  const res = await audit.runMetadataAudit({ type: 'event', rootPath: eventDir });
  for (let i = 0; i < 200; i++) { const s = await audit.getMetadataAuditStatus(res.jobId); if (s && !s.running) break; await new Promise(r => setTimeout(r, 50)); }
  const rep = await audit.getMetadataAuditReport(res.jobId, { offset: 0, limit: 500 });
  const byName = {}; for (const r of rep.items) byName[path.basename(r.filePath)] = r;
  return { jobId: res.jobId, rows: rep.items, byName };
}
const rec = (eventDir) => JSON.parse(fs.readFileSync(path.join(eventDir, 'event.json'), 'utf8'));

const ABC = ['Jane Doe/A_default.cr2', 'Jane Doe/A_default.jpg', 'Jane Doe/B_subset.cr2', 'Jane Doe/B_subset.jpg', 'Jane Doe/C_none.cr2', 'Jane Doe/C_none.jpg'];
const ABC_REF = { 'Jane Doe/B_subset.cr2': SUB, 'Jane Doe/B_subset.jpg': SUB, 'Jane Doe/C_none.cr2': EMPTY, 'Jane Doe/C_none.jpg': EMPTY };
const EXPECT_EV = { A: ['Ziyarat', 'Quran Tilawat', ...CTX], B: ['Ziyarat', ...CTX], C: [...CTX] };
const kindOf = f => path.basename(f)[0];

(async () => {
  console.log('metadataIntentLifecycle (real ExifTool + real queue; archive-side state only — no source/card exists)');

  // ═══ Initial write sanity (import-shaped) — the baseline every later workflow must preserve ═════
  await t('baseline: import-shaped write produces A/B/C exactly (RAW sidecar + JPG), event.json holds durable records incl. explicit-empty', async () => {
    const ev = await buildEvent({ components: [compOne], files: ABC, refinements: ABC_REF });
    for (const rel of ABC) assert.ok(same(await subjectOf(ev.abs[rel]), EXPECT_EV[kindOf(rel.split('/')[1])]), rel);
    const ej = rec(ev.eventDir);
    assert.ok(ej.tagRefinements.some(b => b.eventTypes.length === 0 && b.additionalKeywords.length === 0 && b.relPaths.includes('Jane Doe/C_none.cr2')), 'explicit-empty bucket persisted');
    assert.equal(ej.metadataGroups, undefined);
  });

  // ═══ Audit ═══════════════════════════════════════════════════════════════════════════════════
  await t('AUDIT: correctly refined B and explicit-None C audit CLEAN (single-component, RAW + JPG); nothing reported missing', async () => {
    const ev = await buildEvent({ components: [compOne], files: ABC, refinements: ABC_REF });
    const { rows } = await auditEvent(ev.eventDir);
    assert.equal(rows.length, 6);
    for (const r of rows) { assert.equal(r.status, 'complete', `${path.basename(r.filePath)}: ${J(r.keywords)}`); assert.equal(r.keywords.compliant, true); assert.deepEqual(r.keywords.missing, []); assert.deepEqual(r.keywords.unexpected, []); }
    const b = rows.find(r => r.filePath.endsWith('B_subset.cr2'));
    assert.ok(b.evidenceSource.includes('tagRefinements:explicit-override'));
  });
  await t('AUDIT: multi-component (group-style) refinements audit clean per component', async () => {
    const files = ['Ziyarat-Hall A/Jane Doe/A1.cr2', 'Ziyarat-Hall A/Jane Doe/B1.jpg', 'Ziyarat-Hall A/Jane Doe/C1.cr2', 'Waaz-Majlis-Hall B/Ann/A2.cr2', 'Waaz-Majlis-Hall B/Ann/B2.cr2', 'Waaz-Majlis-Hall B/Ann/C2.jpg'];
    const ev = await buildEvent({ components: [compOne, compB], files, refinements: { 'Ziyarat-Hall A/Jane Doe/B1.jpg': SUB, 'Ziyarat-Hall A/Jane Doe/C1.cr2': EMPTY, 'Waaz-Majlis-Hall B/Ann/B2.cr2': { eventTypes: ['Waaz'], additionalKeywords: [] }, 'Waaz-Majlis-Hall B/Ann/C2.jpg': EMPTY } });
    const { rows } = await auditEvent(ev.eventDir);
    for (const r of rows) assert.equal(r.status, 'complete', `${path.basename(r.filePath)}: ${J(r.keywords)}`);
    assert.ok(same(await subjectOf(ev.abs['Waaz-Majlis-Hall B/Ann/B2.cr2']), ['Waaz', 'Hall B', 'Surat', 'India']));
  });
  await t('AUDIT: legacy MetaPicker (Tier 1) files audit clean, and refinement still beats the group tag (Tier 0 > Tier 1)', async () => {
    const files = ['Jane Doe/M_A.cr2', 'Jane Doe/M_A.jpg', 'Jane Doe/M_B.cr2', 'Jane Doe/M_C.jpg'];
    const ev = await buildEvent({ components: [compTwo], files, tags: { g1: { tags: ['Waaz'], files: ['Jane Doe/M_A.cr2', 'Jane Doe/M_A.jpg', 'Jane Doe/M_B.cr2'] }, g2: { tags: [], files: ['Jane Doe/M_C.jpg'] } },
      refinements: { 'Jane Doe/M_B.cr2': SUB, 'Jane Doe/M_C.jpg': EMPTY } });
    assert.ok(same(await subjectOf(ev.abs['Jane Doe/M_A.cr2']), ['Waaz', 'Quran Tilawat', ...CTX]));
    assert.ok(same(await subjectOf(ev.abs['Jane Doe/M_B.cr2']), ['Ziyarat', ...CTX]));
    const { rows } = await auditEvent(ev.eventDir);
    for (const r of rows) assert.equal(r.status, 'complete', `${path.basename(r.filePath)}: ${J(r.keywords)}`);
    const a = rows.find(r => r.filePath.endsWith('M_A.cr2'));
    assert.ok(a.evidenceSource.includes('metadataGroups:explicit-tags'));
  });
  await t('AUDIT: a record with no persisted intent at all audits exactly as before (plain unrefined event)', async () => {
    const ev = await buildEvent({ components: [compOne], files: ['Jane Doe/P1.cr2', 'Jane Doe/P2.jpg'] });
    const ej = rec(ev.eventDir); assert.equal('tagRefinements' in ej, false); assert.equal('metadataGroups' in ej, false);
    for (const r of (await auditEvent(ev.eventDir)).rows) assert.equal(r.status, 'complete');
  });
  await t('AUDIT D4: label drift is HONORED and surfaced as advisory `tagRefinements:label-not-in-component` — status unaffected, record unchanged', async () => {
    const ev = await buildEvent({ components: [compOne], files: ['Jane Doe/D1.cr2'], refinements: { 'Jane Doe/D1.cr2': { eventTypes: ['Ziyarat'], additionalKeywords: [] } } });
    const edited = rec(ev.eventDir); edited.components[0].types = ['Renamed Type'];                         // Ziyarat no longer offered by the component
    await fsp.writeFile(path.join(ev.eventDir, 'event.json'), JSON.stringify(edited, null, 2));
    const before = J(rec(ev.eventDir).tagRefinements);
    const { rows } = await auditEvent(ev.eventDir);
    assert.deepEqual(rows[0].intentDiagnostics, ['tagRefinements:label-not-in-component']);
    assert.equal(rows[0].status, 'complete');                                                               // the file still carries the historical explicit label
    assert.equal(J(rec(ev.eventDir).tagRefinements), before);
  });
  await t('AUDIT D3: conflicting / malformed records ⇒ ambiguous (exposed), never Default; unaffected files audit normally', async () => {
    const ev = await buildEvent({ components: [compOne], files: ['Jane Doe/X.cr2', 'Jane Doe/OK.cr2'] });
    const ej = rec(ev.eventDir); ej.tagRefinements = [{ eventTypes: ['Ziyarat'], additionalKeywords: [], relPaths: ['Jane Doe/X.cr2'] }, { eventTypes: [], additionalKeywords: [], relPaths: ['Jane Doe/X.cr2'] }];
    await fsp.writeFile(path.join(ev.eventDir, 'event.json'), JSON.stringify(ej, null, 2));
    const { byName } = await auditEvent(ev.eventDir);
    assert.equal(byName['X.cr2'].status, 'ambiguous'); assert.match(byName['X.cr2'].ambiguityReason, /record-conflict/);
    assert.equal(byName['OK.cr2'].status, 'complete');
  });

  // ═══ Repair ══════════════════════════════════════════════════════════════════════════════════
  await t('REPAIR: an UNRELATED broken field is repaired while B/C keywords stay byte-identical (RAW + JPG); refined files alone need no repair', async () => {
    const ev = await buildEvent({ components: [compOne], files: ABC, refinements: ABC_REF });
    const before = {}; for (const rel of ABC) before[rel] = await subjectOf(ev.abs[rel]);
    // A correctly refined archive needs NO repair at all:
    assert.ok(!(await auditEvent(ev.eventDir)).rows.some(r => r.status !== 'complete'));
    // Break City on the refined B and C files only (RAW sidecar / JPG XMP):
    for (const rel of ABC.filter(r => /B_|C_/.test(r))) await et.write(targetOf(ev.abs[rel]), { 'XMP-photoshop:City': 'Wrongville' }, { writeArgs: ['-overwrite_original'] });
    const { jobId, rows } = await auditEvent(ev.eventDir);
    for (const r of rows.filter(r => /B_|C_/.test(r.filePath))) { assert.equal(r.status, 'partial'); assert.notEqual(r.fields.city.status, 'match'); assert.equal(r.keywords.compliant, true, 'keywords are NOT what is wrong'); }
    const run = await repair.runMetadataRepair(jobId);
    assert.ok(run.ok); assert.equal(run.result.complete, 4);
    for (const rel of ABC) {
      assert.deepEqual(await subjectOf(ev.abs[rel]), before[rel], `${rel}: Subject must be untouched (order included)`);
      const tags = await exifService.readFileTags(targetOf(ev.abs[rel]));
      assert.equal(tags.City, 'Surat', `${rel}: unrelated City repaired`);
    }
    const C = await subjectOf(ev.abs['Jane Doe/C_none.cr2']);
    assert.ok(!C.includes('Ziyarat') && !C.includes('Quran Tilawat'), 'explicit No Tags is NOT restored by Repair');
    for (const r of (await auditEvent(ev.eventDir)).rows) assert.equal(r.status, 'complete');
  });
  await t('REPAIR D3: conflicting records cannot make Repair restore default refinable keywords (file is ambiguous ⇒ not repairable ⇒ untouched)', async () => {
    const ev = await buildEvent({ components: [compOne], files: ['Jane Doe/X.cr2', 'Jane Doe/X.jpg'], refinements: { 'Jane Doe/X.cr2': EMPTY, 'Jane Doe/X.jpg': EMPTY } });
    const ej = rec(ev.eventDir);
    ej.tagRefinements = [{ eventTypes: [], additionalKeywords: [], relPaths: ['Jane Doe/X.cr2', 'Jane Doe/X.jpg'] }, { eventTypes: ['Ziyarat'], additionalKeywords: ['Quran Tilawat'], relPaths: ['Jane Doe/X.cr2', 'Jane Doe/X.jpg'] }];   // contradictory duplicates
    await fsp.writeFile(path.join(ev.eventDir, 'event.json'), JSON.stringify(ej, null, 2));
    for (const rel of ['Jane Doe/X.cr2', 'Jane Doe/X.jpg']) await et.write(targetOf(ev.abs[rel]), { 'XMP-photoshop:City': 'Wrongville' }, { writeArgs: ['-overwrite_original'] });   // also give Repair a reason to act
    const { jobId, rows } = await auditEvent(ev.eventDir);
    assert.ok(rows.every(r => r.status === 'ambiguous'));
    const run = await repair.runMetadataRepair(jobId);
    assert.ok(run.ok); assert.equal(run.batchId, null, 'nothing repairable');
    for (const rel of ['Jane Doe/X.cr2', 'Jane Doe/X.jpg']) {
      const s = await subjectOf(ev.abs[rel]);
      assert.ok(!s.includes('Ziyarat') && !s.includes('Quran Tilawat'), `${rel}: default refinable keywords must NOT be restored (${J(s)})`);
      assert.equal((await exifService.readFileTags(targetOf(ev.abs[rel]))).City, 'Wrongville', 'nothing was written at all');
    }
  });
  await t('REPAIR: Tier 1 — MetaPicker default file keeps its legacy tag through Audit → Repair (it used to be stripped)', async () => {
    const files = ['Jane Doe/M_A.cr2', 'Jane Doe/M_A.jpg'];
    const ev = await buildEvent({ components: [compTwo], files, tags: { g1: { tags: ['Waaz'], files } } });
    for (const rel of files) await et.write(targetOf(ev.abs[rel]), { 'XMP-photoshop:City': 'Wrongville' }, { writeArgs: ['-overwrite_original'] });
    const { jobId } = await auditEvent(ev.eventDir);
    const run = await repair.runMetadataRepair(jobId); assert.ok(run.ok);
    for (const rel of files) { assert.ok(same(await subjectOf(ev.abs[rel]), ['Waaz', 'Quran Tilawat', ...CTX]), rel); }
  });

  // ═══ Reapply / Transfer-verification context path ════════════════════════════════════════════
  await t('REAPPLY path: context from durable intent preserves subset + explicit None + Default (source/card absent); a previously-overwritten file with a surviving record is RESTORED', async () => {
    const ev = await buildEvent({ components: [compOne], files: ABC, refinements: ABC_REF });
    // 1. Reapply over correct metadata: nothing changes
    const files = ABC.map(rel => ({ src: ev.abs[rel], dest: ev.abs[rel] }));
    const { context, files: cf } = buildEventEvidenceContext(ev.eventDir, rec(ev.eventDir), files);
    await runBatch(cf, context);
    for (const rel of ABC) assert.ok(same(await subjectOf(ev.abs[rel]), EXPECT_EV[kindOf(rel.split('/')[1])]), `preserved: ${rel}`);
    // 2. Simulate the OLD destructive Reapply (no intent evidence) damaging B and C…
    const oldStyle = { photographer: 'Jane Doe', hijriDate: '1448-01-01', eventDescription: 'Lifecycle', groups: [{ id: 'root', subEventId: null, files: files.map(f => f.src) }], diskComponents: [compOne] };
    await runBatch(files.map(f => ({ ...f, photographer: 'Jane Doe' })), oldStyle);
    assert.ok(same(await subjectOf(ev.abs['Jane Doe/C_none.cr2']), EXPECT_EV.A), 'setup: C was overwritten with defaults');
    // …and the record survives in event.json ⇒ the corrected path restores the operator's intent
    const rebuilt = buildEventEvidenceContext(ev.eventDir, rec(ev.eventDir), files);
    await runBatch(rebuilt.files, rebuilt.context);
    for (const rel of ABC) assert.ok(same(await subjectOf(ev.abs[rel]), EXPECT_EV[kindOf(rel.split('/')[1])]), `restored: ${rel}`);
  });
  await t('REAPPLY path: MetaPicker + refinement — Tier 0 survives, Tier 1 no longer overwrites it', async () => {
    const files = ['Jane Doe/M_A.cr2', 'Jane Doe/M_B.cr2', 'Jane Doe/M_C.jpg'];
    const ev = await buildEvent({ components: [compTwo], files, tags: { g1: { tags: ['Waaz'], files: ['Jane Doe/M_A.cr2', 'Jane Doe/M_B.cr2'] }, g2: { tags: [], files: ['Jane Doe/M_C.jpg'] } }, refinements: { 'Jane Doe/M_B.cr2': SUB, 'Jane Doe/M_C.jpg': EMPTY } });
    const fl = files.map(rel => ({ src: ev.abs[rel], dest: ev.abs[rel] }));
    const { context, files: cf } = buildEventEvidenceContext(ev.eventDir, rec(ev.eventDir), fl);
    await runBatch(cf, context);
    assert.ok(same(await subjectOf(ev.abs['Jane Doe/M_A.cr2']), ['Waaz', 'Quran Tilawat', ...CTX]));
    assert.ok(same(await subjectOf(ev.abs['Jane Doe/M_B.cr2']), ['Ziyarat', ...CTX]), 'refinement beats the group tag (previously became Waaz)');
    assert.ok(same(await subjectOf(ev.abs['Jane Doe/M_C.jpg']), [...CTX]), 'explicit None survives (previously gained Quran Tilawat)');
  });
  await t('REAPPLY D3: conflicting records ⇒ the file is journaled ambiguous and NOT written (no default restored)', async () => {
    const ev = await buildEvent({ components: [compOne], files: ['Jane Doe/X.cr2'], refinements: { 'Jane Doe/X.cr2': EMPTY } });
    const ej = rec(ev.eventDir); ej.tagRefinements = [{ eventTypes: [], additionalKeywords: [], relPaths: ['Jane Doe/X.cr2'] }, { eventTypes: ['Ziyarat'], additionalKeywords: [], relPaths: ['Jane Doe/X.cr2'] }];
    const { context, files } = buildEventEvidenceContext(ev.eventDir, ej, [{ src: ev.abs['Jane Doe/X.cr2'], dest: ev.abs['Jane Doe/X.cr2'] }]);
    const st = await runBatch(files, context);
    assert.equal(st.ambiguous, 1);
    assert.ok(!(await subjectOf(ev.abs['Jane Doe/X.cr2'])).includes('Ziyarat'));
  });
  await t('TRANSFER VERIFICATION path: correctly refined files verify COMPLETE (they used to be flagged incomplete and re-queued)', async () => {
    const ev = await buildEvent({ components: [compOne], files: ABC, refinements: ABC_REF });
    const files = ABC.map(rel => ({ src: ev.abs[rel], dest: ev.abs[rel] }));
    const { context, files: cf } = buildEventEvidenceContext(ev.eventDir, rec(ev.eventDir), files);
    const results = await verification.verifyFiles(cf, context);
    assert.equal(results.length, 6);
    for (const r of results) assert.equal(r.status, 'complete', `${path.basename(r.dest)}: ${J(r.mismatches)}`);
    // …and it still detects a GENUINE mismatch (a refined-file keyword that differs from the intent):
    await et.write(sidecarOf(ev.abs['Jane Doe/C_none.cr2']), { 'XMP-dc:Subject': ['Ziyarat'] }, { writeArgs: ['-overwrite_original'] });
    const again = await verification.verifyFiles(cf, context);
    assert.equal(again.find(r => r.dest.endsWith('C_none.cr2')).status, 'incomplete');
  });

  // ═══ restart / resume (real persistent queue) ═════════════════════════════════════════════════
  async function queuedInterrupted(ev, mutateEventJsonAfterQueue) {
    // What an interrupted import leaves behind: manifest holding the FROZEN import-time expectation + evidence, journal 'writing', NOTHING written yet.
    for (const rel of ev.files) { await fsp.rm(sidecarOf(ev.abs[rel]), { force: true }); }
    const raw = ev.files.filter(r => r.endsWith('.cr2'));
    const evidenceFor = f => ({ filePath: f, photographer: 'Jane Doe', hijriDate: '1448-01-01', eventDescription: 'Lifecycle', groups: ev.groups, diskComponents: ev.context.diskComponents });
    const batchId = `resume-${Date.now()}-${++batchSeq}`;
    await queueStore.writeManifestOnce(batchId, { schemaVersion: 1, batchId, metadataContractVersion: 1, resolverVersion: 1, archiveRootIdentity: null, eventJsonPath: path.join(ev.eventDir, 'event.json'), queuedAt: new Date().toISOString(),
      files: raw.map(rel => { const f = ev.abs[rel]; return { src: f, dest: f, relDestPath: rel, size: 10, isRaw: true, isVideo: false, evidence: evidenceFor(f), expectation: resolveExpectedMetadata(evidenceFor(f)) }; }) });
    for (const rel of raw) await queueStore.appendJournalEntry(batchId, { dest: ev.abs[rel], status: 'writing' });
    if (mutateEventJsonAfterQueue) await mutateEventJsonAfterQueue(ev);
    return { batchId, raw };
  }
  async function journalOf(batchId) {
    const q = process.env.AUTOINGEST_METADATA_QUEUE_DIR;
    for (const p of [path.join(q, batchId + '.journal.jsonl'), path.join(q, 'compacted', batchId + '.journal.jsonl')]) if (fs.existsSync(p)) return (await fsp.readFile(p, 'utf8')).split('\n').filter(Boolean).map(l => JSON.parse(l));
    return [];
  }
  const finalStatus = (j, f) => [...j].reverse().find(e => e.dest === f)?.status;

  await t('RESUME: unchanged refined intent is ACCEPTED — B is not stale for being refined, C is not stale for being explicit None; metadata completes correctly', async () => {
    const ev = await buildEvent({ components: [compOne], files: ABC, refinements: ABC_REF });
    const { batchId, raw } = await queuedInterrupted(ev);
    for (const rel of raw) assert.equal(fs.existsSync(sidecarOf(ev.abs[rel])), false, 'setup: interrupted, nothing written');
    const summary = await resumeInterruptedBatches();
    assert.equal(summary.filesStale, 0, 'no file may be stale merely because it is refined');
    assert.equal(summary.filesResumed, 3);
    const j = await journalOf(batchId);
    for (const rel of raw) assert.equal(finalStatus(j, ev.abs[rel]), 'complete', rel);
    for (const rel of raw) assert.ok(same(await subjectOf(ev.abs[rel]), EXPECT_EV[kindOf(rel.split('/')[1])]), `resumed: ${rel}`);
  });
  await t('RESUME: MetaPicker + refinement resume accepted (Tier 0 and Tier 1 both reconstructed)', async () => {
    const files = ['Jane Doe/M_A.cr2', 'Jane Doe/M_B.cr2', 'Jane Doe/M_C.cr2'];
    const ev = await buildEvent({ components: [compTwo], files, tags: { g1: { tags: ['Waaz'], files: ['Jane Doe/M_A.cr2', 'Jane Doe/M_B.cr2'] }, g2: { tags: [], files: ['Jane Doe/M_C.cr2'] } }, refinements: { 'Jane Doe/M_B.cr2': SUB, 'Jane Doe/M_C.cr2': EMPTY } });
    await queuedInterrupted(ev);
    const summary = await resumeInterruptedBatches();
    assert.equal(summary.filesStale, 0); assert.equal(summary.filesResumed, 3);
    assert.ok(same(await subjectOf(ev.abs['Jane Doe/M_A.cr2']), ['Waaz', 'Quran Tilawat', ...CTX]));
    assert.ok(same(await subjectOf(ev.abs['Jane Doe/M_B.cr2']), ['Ziyarat', ...CTX]));
    assert.ok(same(await subjectOf(ev.abs['Jane Doe/M_C.cr2']), [...CTX]));
  });
  await t('RESUME: a GENUINE intent change since queuing is still detected as STALE (edited record, removed record, changed component); unchanged files still resume', async () => {
    const ev = await buildEvent({ components: [compOne], files: ABC.filter(r => r.endsWith('.cr2')), refinements: ABC_REF });
    const { batchId, raw } = await queuedInterrupted(ev, async e => {
      const ej = rec(e.eventDir);
      // B: operator later changed the decision to explicit None; C: record removed (back to Default). A untouched.
      const doc = { ...ej, tagRefinements: [{ eventTypes: [], additionalKeywords: [], relPaths: ['Jane Doe/B_subset.cr2'] }] };
      await fsp.writeFile(path.join(e.eventDir, 'event.json'), JSON.stringify(doc, null, 2));
    });
    const summary = await resumeInterruptedBatches();
    assert.equal(summary.filesStale, 2); assert.equal(summary.filesResumed, 1);
    const j = await journalOf(batchId);
    assert.equal(finalStatus(j, ev.abs['Jane Doe/A_default.cr2']), 'complete');
    assert.equal(finalStatus(j, ev.abs['Jane Doe/B_subset.cr2']), 'stale');
    assert.equal(finalStatus(j, ev.abs['Jane Doe/C_none.cr2']), 'stale');
    assert.equal(fs.existsSync(sidecarOf(ev.abs['Jane Doe/B_subset.cr2'])), false, 'stale files are NOT written');
  });
  await t('RESUME: component/event definition changed since queuing ⇒ everything stale (staleness protection intact)', async () => {
    const ev = await buildEvent({ components: [compOne], files: ABC.filter(r => r.endsWith('.cr2')), refinements: ABC_REF });
    await queuedInterrupted(ev, async e => { const ej = rec(e.eventDir); ej.components[0].city = 'Elsewhere'; await fsp.writeFile(path.join(e.eventDir, 'event.json'), JSON.stringify(ej, null, 2)); });
    const summary = await resumeInterruptedBatches();
    assert.equal(summary.filesStale, 3); assert.equal(summary.filesResumed, 0);
  });
  await t('RESUME D3: malformed / conflicting persisted intent ⇒ stale (fail closed) — nothing is written, nothing reinterpreted as Default', async () => {
    const ev = await buildEvent({ components: [compOne], files: ABC.filter(r => r.endsWith('.cr2')), refinements: ABC_REF });
    const { raw } = await queuedInterrupted(ev, async e => { const ej = rec(e.eventDir); ej.tagRefinements = 'corrupted'; await fsp.writeFile(path.join(e.eventDir, 'event.json'), JSON.stringify(ej, null, 2)); });
    const summary = await resumeInterruptedBatches();
    assert.equal(summary.filesStale, 3); assert.equal(summary.filesResumed, 0);
    for (const rel of raw) assert.equal(fs.existsSync(sidecarOf(ev.abs[rel])), false);
  });

  await et.end().catch(() => {});
  await exifService.shutdown().catch(() => {});
  console.log(`${passed} passed`);
  if (process.exitCode) console.log('SOME TESTS FAILED');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('FATAL', e.stack || e.message); process.exit(1); });
