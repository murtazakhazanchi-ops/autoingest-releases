'use strict';

// AI-FEAT-064 EQI-3 — Sort Dump for one event (services/dumpSortService.js): guards, event.json
// records, Local First staging, empty photographer folders. Real temporary folders, the real
// event.json store and metadata-intent module; the regression fixture is the sanitized real-world
// Dump event (88 CR3 + 1 MP4 from one photographer, metadata audit complete).
// Run: node test/eqi3DumpSortService.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { updateEventJsonAtomic } = require('../main/eventJsonStore');
const intent = require('../services/eventMetadataIntent');
const { createDumpSortService } = require('../services/dumpSortService');
const journal = require('../services/dumpSortJournal');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'eqi11-realworld-dump-event.json'), 'utf8'));
const PH = FIXTURE.imports[0].photographer;   // sanitized photographer name
const MAJLIS = FIXTURE.components[0].folderName;
const WAAZ = FIXTURE.components[1].folderName;
const cr3 = (i) => `IMG_${String(i).padStart(4, '0')}.CR3`;

let root;
async function put(p, content) { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, content); return p; }
const readDoc = async (ev) => JSON.parse(await fsp.readFile(path.join(ev, 'event.json'), 'utf8'));
async function listTree(dir) {
  const out = [];
  async function walk(d, rel) {
    for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(d, e.name), r); else out.push(r);
    }
  }
  await walk(dir, '');
  return out.filter(r => !r.startsWith('.autoingest') && r !== 'event.json').sort();
}

/** The real-world shaped event in an archive (and optionally its staging copy). */
async function makeArchiveEvent(name, { staging = false } = {}) {
  const ev = path.join(root, 'archive', 'Coll', name);
  const doc = JSON.parse(JSON.stringify(FIXTURE));
  doc.tagRefinements = [{ eventTypes: ['Majlis'], additionalKeywords: ['Bayan'], relPaths: [`Dump/${PH}/${cr3(1)}`] }];
  doc.metadataGroups = [{ metadataTags: [], relPaths: [`Dump/${PH}/${cr3(2)}`, `Dump/${PH}/${cr3(3)}`] }];
  await put(path.join(ev, 'event.json'), JSON.stringify(doc, null, 1));
  for (let i = 1; i <= 88; i++) await put(path.join(ev, 'Dump', PH, cr3(i)), `cr3-${i}`.repeat(40));
  await put(path.join(ev, 'Dump', PH, 'VIDEO', 'MVI_0089.MP4'), 'video'.repeat(200));
  await put(path.join(ev, 'Dump', PH, `IMG_0001.xmp`), '<x:xmpmeta/>');
  if (staging) {
    const st = path.join(root, 'staging', 'Coll', name);
    await put(path.join(st, 'event.json'), JSON.stringify(doc, null, 1));
    for (let i = 1; i <= 4; i++) await put(path.join(st, 'Dump', PH, cr3(i)), `cr3-${i}`.repeat(40));
  }
  return ev;
}

function service(over = {}) {
  const calls = { verified: [], locks: [] };
  const svc = createDumpSortService({
    updateEventJsonAtomic, intent,
    roots: () => ({ archive: [fs.realpathSync(path.join(root, 'archive'))], staging: fs.realpathSync(path.join(root, 'staging')), nas: null }),
    pendingSyncFor: async () => [], activeMetadataFor: async () => 0, isImportRunning: () => false,
    acquireLocks: async (ev, rels) => { calls.locks.push(rels.length); return { ok: true, release: async () => {} }; },
    verifyMetadata: async (ev, files) => { calls.verified.push(...files); return { state: 'complete', checked: files.length, rewritten: 0 }; },
    ...over,
  });
  return { svc, calls };
}
const sel = (ev, names, comp) => names.map(n => ({ path: path.join(ev, 'Dump', PH, n), subEventId: comp }));

(async () => {
  console.log('eqi3DumpSortService');
  root = fs.realpathSync(await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-eqi3-svc-')));
  await fsp.mkdir(path.join(root, 'staging'), { recursive: true });

  await t('status: 89 unsorted (88 CR3 + MP4), Sort Dump offered; plan reviews destinations and sizes', async () => {
    const ev = await makeArchiveEvent('E1');
    const { svc } = service();
    const st = await svc.status(ev);
    assert.equal(st.ok, true);
    assert.equal(st.unsorted, 89);
    assert.equal(st.showSortDump, true);
    assert.deepEqual(st.photographers.map(p => [p.name, p.count]), [[PH, 89]]);
    const p = await svc.plan(ev, [...sel(ev, [cr3(1), cr3(2)], MAJLIS), ...sel(ev, ['VIDEO/MVI_0089.MP4'], WAAZ)]);
    assert.equal(p.ok, true);
    assert.equal(p.review.files, 3);
    assert.equal(p.review.sidecars, 1);
    assert.deepEqual(p.review.destinations.map(d => [d.component, d.folder, d.files]), [[MAJLIS, PH, 2], [WAAZ, PH, 1]]);
    assert.equal(p.review.remaining, 86);
  });

  await t('real-world fixture: partial sort into two components — intent keys move with the files, imports[] untouched, audit entry kept', async () => {
    const ev = await makeArchiveEvent('E2');
    await fsp.mkdir(path.join(ev, WAAZ, `PC01-Other Photographer`), { recursive: true });
    const before = await readDoc(ev);
    const { svc, calls } = service();
    const majlis = Array.from({ length: 40 }, (_, i) => cr3(i + 1));
    const waaz = Array.from({ length: 10 }, (_, i) => cr3(i + 41));
    const groups = [{ metadataTags: null, files: sel(ev, [cr3(5)], MAJLIS).map(s => s.path), fileTagRefinements: { [path.join(ev, 'Dump', PH, cr3(5))]: { eventTypes: ['Majlis'], additionalKeywords: ['Shahadat'] } } }];
    const r = await svc.run(ev, { selection: [...sel(ev, majlis, MAJLIS), ...sel(ev, [...waaz, 'VIDEO/MVI_0089.MP4'], WAAZ)], groups });
    assert.equal(r.ok, true, JSON.stringify(r.attention || r.blockers));
    assert.equal(r.movedFiles, 51);
    const tree = await listTree(ev);
    assert.equal(tree.filter(x => x.startsWith(`${MAJLIS}/${PH}/`)).length, 41, '40 CR3 + their XMP');
    assert.equal(tree.filter(x => x.startsWith(`${WAAZ}/PC02-${PH}/`)).length, 11, 'sequenced component: next PC number');
    assert.equal(tree.filter(x => x.startsWith(`Dump/${PH}/`)).length, 38, '38 CR3 still unsorted');
    assert.ok(!tree.some(x => /_1\.CR3$/.test(x)), 'no _1 duplicates');
    const doc = await readDoc(ev);
    assert.deepEqual(doc.imports, before.imports, 'a sort is never a new import');
    assert.deepEqual(doc.metadataState, before.metadataState);
    assert.deepEqual(doc.tagRefinements.map(b => b.relPaths).flat().sort(), [`${MAJLIS}/${PH}/${cr3(1)}`, `${MAJLIS}/${PH}/${cr3(5)}`].sort());
    assert.ok(doc.tagRefinements.some(b => b.additionalKeywords.includes('Shahadat') && b.relPaths.includes(`${MAJLIS}/${PH}/${cr3(5)}`)), 'sort-time refinement recorded at the final path');
    assert.deepEqual(doc.metadataGroups[0].relPaths.sort(), [`${MAJLIS}/${PH}/${cr3(2)}`, `${MAJLIS}/${PH}/${cr3(3)}`]);
    assert.deepEqual(doc.photographerSequences[WAAZ][PH], { sequence: 2, folderName: `PC02-${PH}` });
    assert.equal(doc.dumpSorts.length, 1);
    assert.equal(doc.dumpSorts[0].movedFiles, 51);
    assert.ok(!JSON.stringify(doc).includes(`Dump/${PH}/${cr3(1)}`), 'no stale Dump path for a moved photo');
    assert.equal(calls.verified.length, 50, 'metadata verified for every moved photo (videos excluded)');
    assert.ok(calls.verified.every(f => !f.includes(`${path.sep}Dump${path.sep}`)));
    const st = await svc.status(ev);
    assert.equal(st.unsorted, 38);
  });

  await t('Local First: a synced staging copy gets the same moves, so no later sync can bring Dump copies back', async () => {
    const ev = await makeArchiveEvent('E3', { staging: true });
    const { svc } = service();
    const r = await svc.run(ev, { selection: sel(ev, [cr3(1), cr3(2), cr3(3)], MAJLIS) });
    assert.equal(r.ok, true);
    assert.deepEqual(r.staging, { moved: 3, alreadyThere: 0, kept: [] });
    const st = await listTree(path.join(root, 'staging', 'Coll', 'E3'));
    assert.deepEqual(st, [`Dump/${PH}/${cr3(4)}`, `${MAJLIS}/${PH}/${cr3(1)}`, `${MAJLIS}/${PH}/${cr3(2)}`, `${MAJLIS}/${PH}/${cr3(3)}`]);
    const sdoc = await readDoc(path.join(root, 'staging', 'Coll', 'E3'));
    assert.deepEqual(sdoc.tagRefinements[0].relPaths, [`${MAJLIS}/${PH}/${cr3(1)}`]);
  });

  await t('guards: unsynced Local First imports, metadata still writing, an import running, a staging event, an event outside the archive — nothing moves', async () => {
    const ev = await makeArchiveEvent('E4');
    const one = sel(ev, [cr3(1)], MAJLIS);
    for (const [label, over, expect] of [
      ['pending sync', { pendingSyncFor: async () => ['job-1'] }, /not yet synced/],
      ['metadata', { activeMetadataFor: async () => 1 }, /Metadata is still being written/],
      ['import', { isImportRunning: () => true }, /An import is running/],
      ['locks', { acquireLocks: async () => ({ ok: false, lockedBy: 'OTHER-MAC' }) }, /busy \(in use by OTHER-MAC\)/],
    ]) {
      const { svc } = service(over);
      const r = await svc.run(ev, { selection: one });
      assert.equal(r.ok, false, label);
      assert.match(r.blockers.join(' '), expect, label);
    }
    const stagingEv = path.join(root, 'staging', 'Coll', 'E4s');
    await put(path.join(stagingEv, 'event.json'), JSON.stringify(FIXTURE));
    await put(path.join(stagingEv, 'Dump', PH, cr3(1)), 'x');
    const { svc } = service();
    assert.match((await svc.plan(stagingEv, [])).blockers[0], /Local Staging/);
    const outside = path.join(root, 'elsewhere', 'E5');
    await put(path.join(outside, 'event.json'), JSON.stringify(FIXTURE));
    assert.match((await svc.plan(outside, [])).blockers[0], /not inside a configured archive/);
    assert.equal((await listTree(ev)).filter(x => x.startsWith('Dump/')).length, 90, 'nothing moved');
  });

  await t('empty photographer folders: reported only when genuinely empty; Keep leaves it; Delete removes only the empty folder (and an empty Dump)', async () => {
    const ev = await makeArchiveEvent('E6');
    const { svc } = service();
    const all = [...Array.from({ length: 88 }, (_, i) => cr3(i + 1)), 'VIDEO/MVI_0089.MP4'];
    const r = await svc.run(ev, { selection: sel(ev, all, MAJLIS) });
    assert.equal(r.ok, true);
    assert.equal((await svc.status(ev)).showSortDump, false, 'Sort Dump hidden — nothing unsorted');
    await put(path.join(ev, 'Dump', PH, '.DS_Store'), 'finder');
    await put(path.join(ev, 'Dump', 'Keeper', 'notes.txt'), 'operator notes');
    const e = await svc.emptyPhotographerFolders(ev);
    assert.deepEqual(e.folders, [PH], 'VIDEO subfolder empty + Finder state = empty; a folder with a file is not');
    // Keep Folder = no call; it stays
    assert.ok(fs.existsSync(path.join(ev, 'Dump', PH)));
    // a file appearing between the prompt and the click → refused, nothing deleted
    await put(path.join(ev, 'Dump', PH, 'late.JPG'), 'late');
    const refusedDel = await svc.deleteEmptyPhotographerFolder(ev, PH);
    assert.equal(refusedDel.ok, false);
    assert.ok(fs.existsSync(path.join(ev, 'Dump', PH, 'late.JPG')));
    await fsp.unlink(path.join(ev, 'Dump', PH, 'late.JPG'));
    const del = await svc.deleteEmptyPhotographerFolder(ev, PH);
    assert.equal(del.ok, true);
    assert.equal(del.dumpRemoved, false, 'Dump still holds Keeper');
    assert.ok(!fs.existsSync(path.join(ev, 'Dump', PH)) && fs.existsSync(path.join(ev, 'Dump', 'Keeper', 'notes.txt')));
    assert.equal((await svc.deleteEmptyPhotographerFolder(ev, 'Keeper')).ok, false, 'never a non-empty folder');
    assert.equal((await svc.deleteEmptyPhotographerFolder(ev, '../Coll')).ok, false, 'never outside Dump');
    await fsp.rm(path.join(ev, 'Dump', 'Keeper'), { recursive: true });
    await fsp.mkdir(path.join(ev, 'Dump', 'Last'), { recursive: true });
    const last = await svc.deleteEmptyPhotographerFolder(ev, 'Last');
    assert.equal(last.dumpRemoved, true, 'an empty Dump is removed with its last empty folder');
    assert.ok(!fs.existsSync(path.join(ev, 'Dump')));
  });

  await t('an interrupted sort is completed before the next plan, and Event Management reports it meanwhile', async () => {
    const ev = await makeArchiveEvent('E7');
    const failing = service({ verifyMetadata: async () => { throw new Error('x'); } }).svc;   // metadata failure is reported, not fatal
    const r1 = await failing.run(ev, { selection: sel(ev, [cr3(7)], MAJLIS) });
    assert.equal(r1.ok, true);
    assert.equal(r1.metadata.state, 'failed');
    // simulate a crash right after the journal was written (nothing moved yet)
    await journal.write(ev, { txId: 'ds-test-pending', phase: 'placing', dumpDir: 'Dump', assets: [{ id: 1, photographer: PH, scopeKey: MAJLIS, folder: PH, members: [{ role: 'media', kind: 'raw', src: `Dump/${PH}/${cr3(8)}`, dest: `${MAJLIS}/${PH}/${cr3(8)}`, size: 1 }] }], newFolders: [] });
    await fsp.link(path.join(ev, 'Dump', PH, cr3(8)), path.join(ev, MAJLIS, PH, cr3(8)));   // placed (hard link) when the power went
    const { svc } = service();
    const st = await svc.status(ev);
    assert.equal(st.pending, 1);
    assert.equal(st.showSortDump, true);
    const p = await svc.plan(ev, []);
    assert.equal(p.recovered.length, 1);
    assert.equal(p.recovered[0].ok, true);
    assert.ok(!fs.existsSync(path.join(ev, 'Dump', PH, cr3(8))) && fs.existsSync(path.join(ev, MAJLIS, PH, cr3(8))));
    assert.equal((await svc.status(ev)).pending, 0);
  });

  await fsp.rm(root, { recursive: true, force: true });
  console.log(`eqi3DumpSortService: ${passed} passed${process.exitCode ? ', FAILURES above' : ''}`);
})();
