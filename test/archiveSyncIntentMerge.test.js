'use strict';

// Local First sync must merge durable metadata intent (event.json tagRefinements + metadataGroups)
// into an EXISTING archive event.json — scoped to the files the sync job actually copied — without
// ever erasing archive-side intent. Drives the REAL syncJob against isolated staging/NAS fixtures,
// so the actual local→archive pairs (conflict renames, photographer-folder remaps) are what is
// verified. Requires the Electron binary if the service graph needs app.getPath:
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --no-sandbox \
//     --user-data-dir=<tmp> test/archiveSyncIntentMerge.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const sync = require('../services/archiveSyncService');
const { updateEventJsonAtomic } = require('../main/eventJsonStore');
const intent = require('../services/eventMetadataIntent');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}
const EMPTY = { eventTypes: [], additionalKeywords: [] };
const SUB = { eventTypes: ['Ziyarat'], additionalKeywords: [] };
const bucket = (et, ak, rel) => ({ eventTypes: et, additionalKeywords: ak, relPaths: rel });

async function mk() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-sync-intent-'));
  const stagingRoot = path.join(root, 'staging'), nasRoot = path.join(root, 'nas');
  const stagingEvent = path.join(stagingRoot, 'CollX', 'EventY'), nasEvent = path.join(nasRoot, 'CollX', 'EventY');
  await fsp.mkdir(stagingEvent, { recursive: true }); await fsp.mkdir(nasEvent, { recursive: true });
  return { root, stagingRoot, nasRoot, stagingEvent, nasEvent };
}
const writeJson = (dir, doc) => fsp.writeFile(path.join(dir, 'event.json'), JSON.stringify(doc, null, 2));
const readJson = dir => JSON.parse(fs.readFileSync(path.join(dir, 'event.json'), 'utf8'));
async function put(dir, rel, content) { const f = path.join(dir, ...rel.split('/')); await fsp.mkdir(path.dirname(f), { recursive: true }); await fsp.writeFile(f, content); }
const base = { version: 1, hijriDate: '1448-01-01', sequence: 1, eventName: 'X', components: [{ types: ['Ziyarat'], folderName: 'C' }] };
const imp = id => ({ id, timestamp: '2026-01-01T00:00:00Z', componentIndex: 0, counts: { photos: 1, videos: 0 } });
const recs = (doc, f = 'tagRefinements') => intent[f === 'tagRefinements' ? '_parseTagRefinements' : '_parseMetadataGroups'](doc[f]).records;

console.log('archiveSyncIntentMerge (real syncJob)');

(async () => {
  await t('syncJob records the ACTUAL destination of every copy (incl. conflict rename) — non-enumerable, so persisted results are not bloated', async () => {
    const d = await mk();
    await writeJson(d.stagingEvent, { ...base, imports: [imp('i1')] }); await writeJson(d.nasEvent, { ...base, imports: [] });
    await put(d.stagingEvent, 'Jane/new.cr2', 'NEW'); await put(d.stagingEvent, 'Jane/clash.cr2', 'STAGING-CONTENT-longer');
    await put(d.nasEvent, 'Jane/clash.cr2', 'OLD');
    const result = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane/new.cr2', 'Jane/clash.cr2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(result.ok, JSON.stringify(result.errors));
    assert.equal(result.renamedConflicts, 1);
    assert.equal(Object.keys(result).includes('_copiedPairs'), false);                                   // not enumerable
    assert.equal(JSON.stringify(result).includes('_copiedPairs'), false);
    const pairs = result._copiedPairs.map(p => [path.relative(d.stagingEvent, p.from), path.relative(d.nasEvent, p.to)].join(' → ')).sort();
    assert.deepEqual(pairs, ['Jane/clash.cr2 → Jane/clash_1.cr2', 'Jane/new.cr2 → Jane/new.cr2']);
  });

  await t('Case B: archive-only intent survives; copied files take staging intent; conflict rename maps to the real _1 destination; skipped duplicates cannot overwrite archive intent', async () => {
    const d = await mk();
    await writeJson(d.stagingEvent, { ...base, imports: [imp('i1')], status: 'complete', updatedAt: 9,
      tagRefinements: [bucket(['Ziyarat'], [], ['Jane/B.cr2']), bucket([], [], ['Jane/C.cr2', 'Jane/D.cr2', 'Jane/S.cr2'])],
      metadataGroups: [{ metadataTags: ['Waaz'], relPaths: ['Jane/A.cr2'] }] });
    await writeJson(d.nasEvent, { ...base, imports: [imp('i0')], status: 'created', metadataState: { state: 'metadata-complete' },
      tagRefinements: [bucket([], [], ['Jane/OLD.cr2']), bucket(['Ziyarat'], ['Quran Tilawat'], ['Jane/D.cr2', 'Jane/S.cr2'])],      // D.cr2 + S.cr2 are the ARCHIVE's own, different files/records
      metadataGroups: [{ metadataTags: ['Legacy'], relPaths: ['Jane/OLD.cr2'] }] });
    for (const n of ['A', 'B', 'C']) await put(d.stagingEvent, `Jane/${n}.cr2`, `staging-${n}`);
    await put(d.stagingEvent, 'Jane/D.cr2', 'STAGING-D-different-and-longer'); await put(d.nasEvent, 'Jane/D.cr2', 'ARCHIVE-D');       // conflict ⇒ archive D_1.cr2
    await put(d.stagingEvent, 'Jane/S.cr2', 'IDENTICAL'); await put(d.nasEvent, 'Jane/S.cr2', 'IDENTICAL');                            // skipped duplicate
    await put(d.nasEvent, 'Jane/OLD.cr2', 'old');
    const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane/A.cr2', 'Jane/B.cr2', 'Jane/C.cr2', 'Jane/D.cr2', 'Jane/S.cr2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(r.ok, JSON.stringify(r.errors)); assert.equal(r.skippedDuplicates, 1); assert.equal(r.renamedConflicts, 1);
    const arch = readJson(d.nasEvent); const tr = recs(arch);
    assert.deepEqual(tr.get('Jane/B.cr2'), SUB, 'copied ⇒ staging subset lands');
    assert.deepEqual(tr.get('Jane/C.cr2'), EMPTY, 'copied ⇒ staging explicit-empty lands');
    assert.deepEqual(tr.get('Jane/D_1.cr2'), EMPTY, 'conflict rename ⇒ staging intent mapped to the ACTUAL archive destination');
    assert.deepEqual(tr.get('Jane/D.cr2'), { eventTypes: ['Ziyarat'], additionalKeywords: ['Quran Tilawat'] }, 'the archive\'s own D.cr2 keeps ITS record');
    assert.deepEqual(tr.get('Jane/OLD.cr2'), EMPTY, 'archive-only intent survives');
    assert.deepEqual(tr.get('Jane/S.cr2'), { eventTypes: ['Ziyarat'], additionalKeywords: ['Quran Tilawat'] }, 'skipped duplicate: staging cannot overwrite archive intent');
    const mg = recs(arch, 'metadataGroups');
    assert.deepEqual(mg.get('Jane/A.cr2'), ['Waaz']); assert.deepEqual(mg.get('Jane/OLD.cr2'), ['Legacy']);
    assert.equal(arch.imports.length, 2, 'imports still merge by id'); assert.equal(arch.status, 'complete');
    assert.deepEqual(arch.metadataState, { state: 'metadata-complete' }, 'archive-authoritative fields untouched');
  });

  await t('Case B: a copied file with NO staging record (Default) removes its prior archive record; other archive records survive', async () => {
    const d = await mk();
    await writeJson(d.stagingEvent, { ...base, imports: [imp('i1')] });                                       // staging: no intent at all
    await writeJson(d.nasEvent, { ...base, imports: [], tagRefinements: [bucket([], [], ['Jane/x.cr2', 'Jane/keep.cr2'])] });
    await put(d.stagingEvent, 'Jane/y.cr2', 'y'); await put(d.stagingEvent, 'Jane/x.cr2', 'x-new'); await put(d.nasEvent, 'Jane/keep.cr2', 'k');
    // x.cr2 did not exist in the archive as a file (stale record); staging copies a fresh x with Default intent
    const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane/x.cr2', 'Jane/y.cr2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(r.ok, JSON.stringify(r.errors));
    const tr = recs(readJson(d.nasEvent));
    assert.equal(tr.has('Jane/x.cr2'), false, 'staging Default supersedes the stale archive record for a file it copied');
    assert.deepEqual(tr.get('Jane/keep.cr2'), EMPTY);
  });

  await t('Case B: nothing copied ⇒ archive intent is byte-for-byte untouched (a routine sync cannot erase it), even if staging carries different intent', async () => {
    const d = await mk();
    const archiveDoc = { ...base, imports: [imp('i0')], tagRefinements: [bucket([], [], ['Jane/a.cr2'])], metadataGroups: [{ metadataTags: ['Waaz'], relPaths: ['Jane/a.cr2'] }] };
    await writeJson(d.nasEvent, archiveDoc);
    await writeJson(d.stagingEvent, { ...base, imports: [imp('i0')], tagRefinements: [bucket(['Ziyarat'], [], ['Jane/a.cr2'])] });        // same import id, different intent
    await put(d.stagingEvent, 'Jane/a.cr2', 'IDENTICAL'); await put(d.nasEvent, 'Jane/a.cr2', 'IDENTICAL');
    const before = fs.readFileSync(path.join(d.nasEvent, 'event.json'), 'utf8'); const mtime = fs.statSync(path.join(d.nasEvent, 'event.json')).mtimeMs;
    await new Promise(r => setTimeout(r, 15));
    const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane/a.cr2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(r.ok); assert.equal(r.skippedDuplicates, 1); assert.equal(r.copiedToArchive, 0);
    assert.equal(fs.readFileSync(path.join(d.nasEvent, 'event.json'), 'utf8'), before);
    assert.equal(fs.statSync(path.join(d.nasEvent, 'event.json')).mtimeMs, mtime, 'no needless rewrite');
  });

  await t('Case A: no archive event.json ⇒ staging copied whole (intent included)', async () => {
    const d = await mk();
    await writeJson(d.stagingEvent, { ...base, imports: [imp('i1')], tagRefinements: [bucket([], [], ['Jane/a.cr2'])], metadataGroups: [{ metadataTags: [], relPaths: ['Jane/a.cr2'] }] });
    await put(d.stagingEvent, 'Jane/a.cr2', 'a');
    const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane/a.cr2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(r.ok);
    const arch = readJson(d.nasEvent);
    assert.deepEqual(recs(arch).get('Jane/a.cr2'), EMPTY); assert.deepEqual(recs(arch, 'metadataGroups').get('Jane/a.cr2'), []);
  });

  await t('Case B: unparseable / conflicting STAGING intent never erases archive intent (fail safe)', async () => {
    const d = await mk();
    await writeJson(d.nasEvent, { ...base, imports: [], tagRefinements: [bucket([], [], ['Jane/a.cr2', 'Jane/b.cr2'])] });
    await writeJson(d.stagingEvent, { ...base, imports: [imp('i1')], tagRefinements: 'corrupt' });
    await put(d.stagingEvent, 'Jane/a.cr2', 'a');
    const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane/a.cr2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(r.ok);
    const tr = recs(readJson(d.nasEvent)); assert.deepEqual(tr.get('Jane/a.cr2'), EMPTY); assert.deepEqual(tr.get('Jane/b.cr2'), EMPTY);
  });

  await t('Case B: legacy behavior preserved when nothing about intent applies — new imports still merge, old imports untouched', async () => {
    const d = await mk();
    await writeJson(d.stagingEvent, { ...base, imports: [imp('i0'), imp('i2')], lastImport: { fileCount: 7 }, status: 'complete', updatedAt: 5 });
    await writeJson(d.nasEvent, { ...base, imports: [imp('i0')], status: 'created', updatedAt: 1, custom: 'archive-only-field' });
    await put(d.stagingEvent, 'Jane/a.cr2', 'a');
    await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane/a.cr2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    const arch = readJson(d.nasEvent);
    assert.deepEqual(arch.imports.map(i => i.id).sort(), ['i0', 'i2']); assert.equal(arch.status, 'complete'); assert.equal(arch.custom, 'archive-only-field');
    assert.equal('tagRefinements' in arch, false); assert.equal('metadataGroups' in arch, false);
  });

  await t('Case B goes through the ATOMIC writer: a concurrent event.json update is not clobbered', async () => {
    const d = await mk();
    await writeJson(d.stagingEvent, { ...base, imports: [imp('i1')], tagRefinements: [bucket([], [], ['Jane/a.cr2'])] });
    await writeJson(d.nasEvent, { ...base, imports: [] });
    await put(d.stagingEvent, 'Jane/a.cr2', 'a');
    const jsonPath = path.join(d.nasEvent, 'event.json');
    const [r] = await Promise.all([
      sync.syncJob({ localEventPath: d.stagingEvent, files: ['Jane/a.cr2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot }),
      updateEventJsonAtomic(jsonPath, () => ({ metadataState: { state: 'metadata-complete', from: 'concurrent-writer' } })),
    ]);
    assert.ok(r.ok);
    const arch = readJson(d.nasEvent);
    assert.deepEqual(arch.metadataState, { state: 'metadata-complete', from: 'concurrent-writer' }, 'concurrent writer survived');
    assert.deepEqual(recs(arch).get('Jane/a.cr2'), EMPTY, 'and the intent merge landed too');
  });

  await t('Case B: routine photographer-folder remap on the archive ("M Murtaza" → "PC01-M Murtaza") — intent lands under the ARCHIVE-side key', async () => {
    const d = await mk();
    const multi = { ...base, components: [{ types: ['Ziyarat'], folderName: 'Comp-A' }, { types: ['Waaz'], folderName: 'Comp-B' }] };
    await writeJson(d.stagingEvent, { ...multi, imports: [imp('i1')],
      tagRefinements: [bucket([], [], ['Comp-A/M Murtaza/x.cr2']), bucket(['Ziyarat'], [], ['Comp-A/M Murtaza/y.cr2'])],
      metadataGroups: [{ metadataTags: [], relPaths: ['Comp-A/M Murtaza/x.cr2'] }] });
    await writeJson(d.nasEvent, { ...multi, imports: [], tagRefinements: [bucket([], [], ['Comp-A/PC01-M Murtaza/earlier.cr2'])] });
    await put(d.nasEvent, 'Comp-A/PC01-M Murtaza/earlier.cr2', 'earlier');                       // the archive already knows this photographer as PC01-…
    await put(d.stagingEvent, 'Comp-A/M Murtaza/x.cr2', 'x'); await put(d.stagingEvent, 'Comp-A/M Murtaza/y.cr2', 'y');
    const r = await sync.syncJob({ localEventPath: d.stagingEvent, files: ['Comp-A/M Murtaza/x.cr2', 'Comp-A/M Murtaza/y.cr2'] }, { nasRoot: d.nasRoot, stagingRoot: d.stagingRoot });
    assert.ok(r.ok, JSON.stringify(r.errors));
    assert.ok(fs.existsSync(path.join(d.nasEvent, 'Comp-A', 'PC01-M Murtaza', 'x.cr2')), 'setup: the archive-side folder remap really happened');
    const arch = readJson(d.nasEvent); const tr = recs(arch);
    assert.deepEqual(tr.get('Comp-A/PC01-M Murtaza/x.cr2'), EMPTY);
    assert.deepEqual(tr.get('Comp-A/PC01-M Murtaza/y.cr2'), SUB);
    assert.deepEqual(tr.get('Comp-A/PC01-M Murtaza/earlier.cr2'), EMPTY, 'earlier archive intent survives');
    assert.equal(tr.has('Comp-A/M Murtaza/x.cr2'), false, 'no stale staging-relative key is written');
    assert.deepEqual(recs(arch, 'metadataGroups').get('Comp-A/PC01-M Murtaza/x.cr2'), []);
  });

  console.log(`${passed} passed`);
  if (process.exitCode) console.log('SOME TESTS FAILED');
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('FATAL', e.stack || e.message); process.exit(1); });
