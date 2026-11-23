'use strict';

// AI-FEAT-064 EQI-3.2 — Move Selection to Another Event (services/crossEventMove*.js): planning, the
// two-event transaction, both event.json records, collisions, Local First staging, guards, locks and crash
// recovery at every phase. Real temporary folders, the real event.json store and metadata-intent module.
// Synthetic photographers and events only.
// Run: node test/eqi32CrossEventMove.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { updateEventJsonAtomic } = require('../main/eventJsonStore');
const intent = require('../services/eventMetadataIntent');
const { createCrossEventMoveService } = require('../services/crossEventMoveService');
const { createDumpSortService } = require('../services/dumpSortService');
const engine = require('../services/crossEventMoveEngine');
const { planTransfer } = require('../services/crossEventMovePlanner');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

const P1 = 'Testali Bhai';
const P2 = 'Synthetic Photog';
let root;
let n = 0;
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
const comp = (folderName, types = ['Majlis']) => ({ id: folderName, folderName, location: 'Hall', city: 'Surat', types, additionalKeywords: [] });

/** A fresh collection with Event A (Dump of two photographers) and Event B (two components). */
async function makeWorld({ bDump = false, staging = false, collection = 'Coll' } = {}) {
  const base = path.join(root, `w${++n}`);
  const coll = path.join(base, 'archive', collection);
  const A = path.join(coll, '1448-07-01 _01-Majlis-Synthetic-A');
  const B = path.join(coll, '1448-07-02 _01-Majlis-Synthetic-B');
  await put(path.join(A, 'event.json'), JSON.stringify({
    version: 1, eventName: 'Majlis-Synthetic-A', hijriDate: '1448-07-01', sequence: 1, components: [comp('Majlis-Hall'), comp('Waaz-Hall', ['Waaz'])],
    imports: [{ id: 'imp-a1', timestamp: 1, photographer: P1, destination: 'dump', counts: { photos: 6, videos: 1 } }, { id: 'imp-a2', timestamp: 2, photographer: P2, destination: 'dump', counts: { photos: 2, videos: 0 } }],
    tagRefinements: [{ eventTypes: ['Majlis'], additionalKeywords: ['Bayan'], relPaths: [`Dump/${P1}/IMG_0001.CR3`] }],
    metadataGroups: [{ metadataTags: [], relPaths: [`Dump/${P1}/IMG_0002.JPG`] }],
  }, null, 1));
  for (let i = 1; i <= 4; i++) await put(path.join(A, 'Dump', P1, `IMG_000${i}.JPG`), `jpg-a-${i}-`.repeat(30));
  await put(path.join(A, 'Dump', P1, 'IMG_0001.CR3'), 'raw-a-1-'.repeat(60));
  await put(path.join(A, 'Dump', P1, 'IMG_0001.xmp'), '<x:xmpmeta a1/>');
  await put(path.join(A, 'Dump', P1, 'card2', 'IMG_0101.JPG'), 'nested-'.repeat(30));
  await put(path.join(A, 'Dump', P1, 'VIDEO', 'MVI_0005.MP4'), 'video-'.repeat(80));
  await put(path.join(A, 'Dump', P2, 'DSC_0001.JPG'), 'p2-1-'.repeat(30));
  await put(path.join(A, 'Dump', P2, 'DSC_0002.JPG'), 'p2-2-'.repeat(30));
  await put(path.join(B, 'event.json'), JSON.stringify({
    version: 1, eventName: 'Majlis-Synthetic-B', hijriDate: '1448-07-02', sequence: 1, components: [comp('Majlis-Hall'), comp('QMZ-Hall', ['QMZ'])],
    imports: [{ id: 'imp-b1', timestamp: 3, photographer: 'Other Photog', destination: 'dump', counts: { photos: 1, videos: 0 } }],
    photographerSequences: { 'Majlis-Hall': { 'Other Photog': { sequence: 1, folderName: 'PC01-Other Photog' } } },
  }, null, 1));
  await fsp.mkdir(path.join(B, 'Majlis-Hall', 'PC01-Other Photog'), { recursive: true });
  if (bDump) await put(path.join(B, 'Dump', 'Other Photog', 'OTH_0001.JPG'), 'other-'.repeat(30));
  await fsp.mkdir(path.join(base, 'staging'), { recursive: true });
  if (staging) {
    const sA = path.join(base, 'staging', collection, path.basename(A));
    const sB = path.join(base, 'staging', collection, path.basename(B));
    await put(path.join(sA, 'event.json'), await fsp.readFile(path.join(A, 'event.json')));
    await put(path.join(sA, 'Dump', P1, 'IMG_0003.JPG'), await fsp.readFile(path.join(A, 'Dump', P1, 'IMG_0003.JPG')));
    await put(path.join(sB, 'event.json'), await fsp.readFile(path.join(B, 'event.json')));
  }
  return { base: fs.realpathSync(base), A: fs.realpathSync(A), B: fs.realpathSync(B) };
}

function service(w, over = {}) {
  const calls = { locks: [], released: [], meta: [], started: [] };
  const svc = createCrossEventMoveService({
    updateEventJsonAtomic, intent,
    roots: () => ({ archive: [path.join(w.base, 'archive')], staging: path.join(w.base, 'staging'), nas: null }),
    pendingSyncFor: async () => [], activeMetadataFor: async () => 0, isImportRunning: () => false, sortBusyFor: async () => null,
    acquireLocks: async (ev, rels) => { calls.locks.push(path.basename(ev)); return { ok: true, release: async () => { calls.released.push(path.basename(ev)); } }; },
    scanEvents: async (coll) => (await fsp.readdir(coll)).map(f => ({ folderName: f, isFromJson: true, components: JSON.parse(fs.readFileSync(path.join(coll, f, 'event.json'), 'utf8')).components, _eventJson: { eventName: f } })),
    metadata: { record: async (real, txId, rels) => { calls.meta.push({ real, txId, rels }); return { state: 'queued', files: rels.length }; }, start: async (real, txId) => { calls.started.push(txId); return { started: true }; } },
    ...over,
  });
  return { svc, calls };
}
const abs = (ev, ...rels) => rels.map(r => path.join(ev, ...r.split('/')));

(async () => {
  console.log('eqi32CrossEventMove');
  root = fs.realpathSync(await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-eqi32-')));

  await t('planner: Dump → Dump keeps the photographer, pairs RAW+JPEG+XMP, preserves nested folders, no PC number', async () => {
    const rels = [`Dump/${P1}/IMG_0001.JPG`, `Dump/${P1}/IMG_0001.CR3`, `Dump/${P1}/IMG_0001.xmp`, `Dump/${P1}/card2/IMG_0101.JPG`, `Dump/${P2}/DSC_0001.JPG`];
    const p = planTransfer({ kind: 'dump', sourceDumpDir: 'Dump', sourceDumpRels: rels, selection: [`Dump/${P1}/IMG_0001.JPG`, `Dump/${P1}/card2/IMG_0101.JPG`, `Dump/${P2}/DSC_0001.JPG`], destination: { dumpDir: 'Dump', dumpFolders: ['testali-bhai'] } });
    assert.equal(p.problems.length, 0);
    assert.equal(p.assets.length, 3);
    const a1 = p.assets.find(a => a.members.some(m => m.src.endsWith('IMG_0001.JPG')));
    assert.deepEqual(a1.members.map(m => m.dest).sort(), ['Dump/testali-bhai/IMG_0001.CR3', 'Dump/testali-bhai/IMG_0001.JPG', 'Dump/testali-bhai/IMG_0001.xmp'], 'existing B Dump folder of the same photographer reused; whole shot moves');
    assert.ok(p.assets.some(a => a.members[0].dest === 'Dump/testali-bhai/card2/IMG_0101.JPG'));
    assert.ok(p.assets.some(a => a.photographer === P2 && a.members[0].dest === `Dump/${P2}/DSC_0001.JPG`), 'second photographer gets its own folder');
    const two = planTransfer({ kind: 'dump', sourceDumpDir: 'Dump', sourceDumpRels: rels, selection: [`Dump/${P1}/IMG_0001.JPG`], destination: { dumpFolders: ['Testali Bhai ', 'testali_bhai'] } });
    assert.ok(two.problems.length === 0 || /two Dump folders/.test(two.problems[0].reason));
  });

  await t('planner: → component reuses an existing sequence, allocates the next PC in a sequenced scope, none in QMZ', async () => {
    const rels = [`Dump/${P1}/IMG_0001.JPG`, `Dump/Other Photog/X_1.JPG`];
    const dest = { components: [comp('Majlis-Hall'), comp('QMZ-Hall', ['QMZ'])], photographerSequences: { 'Majlis-Hall': { 'Other Photog': { sequence: 1, folderName: 'PC01-Other Photog' } } }, scopeDirs: { 'Majlis-Hall': ['PC01-Other Photog'], 'QMZ-Hall': [] } };
    const p = planTransfer({ kind: 'component', sourceDumpDir: 'Dump', sourceDumpRels: rels, selection: rels, destination: dest, component: 'Majlis-Hall' });
    assert.deepEqual(p.assets.map(a => a.members[0].dest).sort(), [`Majlis-Hall/PC01-Other Photog/X_1.JPG`, `Majlis-Hall/PC02-${P1}/IMG_0001.JPG`]);
    assert.deepEqual(p.newFolders, [{ scopeKey: 'Majlis-Hall', photographer: P1, folderName: `PC02-${P1}`, sequence: 2 }]);
    const q = planTransfer({ kind: 'component', sourceDumpDir: 'Dump', sourceDumpRels: rels, selection: [rels[0]], destination: dest, component: 'QMZ-Hall' });
    assert.equal(q.assets[0].members[0].dest, `QMZ-Hall/${P1}/IMG_0001.JPG`, 'QMZ component: no PC number');
    const none = planTransfer({ kind: 'component', sourceDumpDir: 'Dump', sourceDumpRels: rels, selection: [rels[0]], destination: dest, component: null });
    assert.match(none.problems[0].reason, /choose one/);
  });

  await t('Dump → Dump: moved (pairs, sidecar, video, nested), both records reconciled, imports untouched, remaining intact', async () => {
    const w = await makeWorld();
    const { svc, calls } = service(w);
    const selection = abs(w.A, `Dump/${P1}/IMG_0001.JPG`, `Dump/${P1}/IMG_0002.JPG`, `Dump/${P1}/card2/IMG_0101.JPG`, `Dump/${P1}/VIDEO/MVI_0005.MP4`, `Dump/${P2}/DSC_0001.JPG`);
    const planned = await svc.plan(w.A, { destPath: w.B, kind: 'dump', selection });
    assert.equal(planned.ok, true, JSON.stringify(planned.blockers));
    assert.equal(planned.review.files, 6);            // JPG+CR3, JPG, nested JPG, MP4, DSC
    assert.equal(planned.review.raw, 1); assert.equal(planned.review.videos, 1); assert.equal(planned.review.sidecars, 1);
    assert.deepEqual(planned.review.photographers.sort(), [P2, P1].sort());
    assert.equal(planned.review.remaining, 9 - 6);
    const beforeA = await readDoc(w.A);
    const r = await svc.run(w.A, { destPath: w.B, kind: 'dump', selection });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.movedFiles, 6); assert.equal(r.sidecars, 1);
    assert.deepEqual(await listTree(w.A), [`Dump/${P2}/DSC_0002.JPG`, `Dump/${P1}/IMG_0003.JPG`, `Dump/${P1}/IMG_0004.JPG`]);
    assert.deepEqual(await listTree(w.B), [`Dump/${P1}/IMG_0001.CR3`, `Dump/${P1}/IMG_0001.JPG`, `Dump/${P1}/IMG_0001.xmp`, `Dump/${P1}/IMG_0002.JPG`, `Dump/${P1}/VIDEO/MVI_0005.MP4`, `Dump/${P1}/card2/IMG_0101.JPG`, `Dump/${P2}/DSC_0001.JPG`].sort());
    const dA = await readDoc(w.A), dB = await readDoc(w.B);
    assert.deepEqual(dA.imports, beforeA.imports, 'source imports[] untouched');
    assert.equal(dB.imports.length, 1, 'no import record added to the destination');
    assert.equal(dA.tagRefinements, undefined, 'source no longer holds intent for moved files');
    assert.equal(dA.metadataGroups, undefined);
    assert.deepEqual(dB.tagRefinements, [{ eventTypes: ['Majlis'], additionalKeywords: ['Bayan'], relPaths: [`Dump/${P1}/IMG_0001.CR3`] }], 'Dump → Dump carries the record to the new path');
    assert.deepEqual(dB.metadataGroups, [{ metadataTags: [], relPaths: [`Dump/${P1}/IMG_0002.JPG`] }]);
    assert.equal(dB.transfersIn.length, 1); assert.equal(dA.transfersOut.length, 1);
    const ti = dB.transfersIn[0];
    assert.equal(ti.id, r.txId); assert.equal(ti.fromEvent.folder, path.basename(w.A)); assert.equal(ti.movedFiles, 6);
    assert.deepEqual(ti.originalImports.map(i => i.id).sort(), ['imp-a1', 'imp-a2'], 'original import provenance preserved');
    assert.ok(ti.paths.some(p => p.from === `Dump/${P1}/IMG_0001.CR3` && p.to === `Dump/${P1}/IMG_0001.CR3`));
    assert.equal(calls.meta[0].real, w.B); assert.equal(calls.meta[0].rels.length, 5, 'metadata queued for B photos (not the video)');
    assert.deepEqual(calls.started, [r.txId]);
    assert.deepEqual(calls.locks, [path.basename(w.A), path.basename(w.B)].sort(), 'both events locked, in path order');
    assert.equal((await engine.listOutbound(w.A)).journals.length, 0); assert.equal((await engine.listInbound(w.B)).markers.length, 0);
    const done = await fsp.readdir(path.join(engine.outDir(w.A), 'done'));
    assert.equal(done.length, 1);
    const j = JSON.parse(await fsp.readFile(path.join(engine.outDir(w.A), 'done', done[0]), 'utf8'));
    assert.deepEqual(j.history.map(h => h.phase), ['planned', 'publishing', 'dest-records', 'source-records', 'staging', 'cleanup', 'metadata', 'done']);
    assert.ok(j.assets.every(a => a.members.every(m => m.verified)), 'verification evidence recorded per file');
    // Repeat: the files are gone from A — nothing is moved twice.
    const again = await svc.run(w.A, { destPath: w.B, kind: 'dump', selection });
    assert.equal(again.ok, false);
    assert.ok(again.problems.every(p => /no longer in Dump/.test(p.reason)));
  });

  await t('→ final component: sequence allocated in B, B photographerSequences recorded, Default intent, staging mirror', async () => {
    const w = await makeWorld({ staging: true });
    const { svc } = service(w);
    const selection = abs(w.A, `Dump/${P1}/IMG_0003.JPG`, `Dump/${P1}/IMG_0001.JPG`);
    const r = await svc.run(w.A, { destPath: w.B, kind: 'component', component: 'Majlis-Hall', selection });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual((await listTree(w.B)).filter(x => x.startsWith('Majlis-Hall/')), [`Majlis-Hall/PC02-${P1}/IMG_0001.CR3`, `Majlis-Hall/PC02-${P1}/IMG_0001.JPG`, `Majlis-Hall/PC02-${P1}/IMG_0001.xmp`, `Majlis-Hall/PC02-${P1}/IMG_0003.JPG`]);
    const dB = await readDoc(w.B);
    assert.deepEqual(dB.photographerSequences['Majlis-Hall'][P1], { sequence: 2, folderName: `PC02-${P1}` });
    assert.equal(dB.tagRefinements, undefined, 'A\'s Dump-time intent does not follow into B\'s component');
    assert.equal(dB.transfersIn[0].component, 'Majlis-Hall');
    const sA = path.join(w.base, 'staging', 'Coll', path.basename(w.A));
    const sB = path.join(w.base, 'staging', 'Coll', path.basename(w.B));
    assert.equal(fs.existsSync(path.join(sA, 'Dump', P1, 'IMG_0003.JPG')), false, 'staging copy no longer in A (no resurrection by sync)');
    assert.equal(fs.existsSync(path.join(sB, 'Majlis-Hall', `PC02-${P1}`, 'IMG_0003.JPG')), true, 'moved to B\'s staging copy');
    assert.equal(r.staging.moved, 1);
  });

  await t('collisions: identical reused (no duplicate), different file / different XMP / same photo under another photographer refused', async () => {
    const w = await makeWorld({ bDump: true });
    await put(path.join(w.B, 'Dump', P1, 'IMG_0003.JPG'), await fsp.readFile(path.join(w.A, 'Dump', P1, 'IMG_0003.JPG')));   // identical
    await put(path.join(w.B, 'Dump', P1, 'IMG_0004.JPG'), 'something else');                                                  // different
    await put(path.join(w.B, 'Dump', P1, 'IMG_0001.xmp'), '<x:xmpmeta different/>');                                          // different sidecar
    await fsp.copyFile(path.join(w.A, 'Dump', P2, 'DSC_0001.JPG'), path.join(w.B, 'Dump', 'Other Photog', 'DSC_0001.JPG'));  // same photo, other photographer
    const { svc } = service(w);
    const selection = abs(w.A, `Dump/${P1}/IMG_0003.JPG`, `Dump/${P1}/IMG_0004.JPG`, `Dump/${P1}/IMG_0001.JPG`, `Dump/${P2}/DSC_0001.JPG`);
    const planned = await svc.plan(w.A, { destPath: w.B, kind: 'dump', selection });
    assert.equal(planned.review.files, 1, 'only the identical one can go');
    assert.ok(planned.review.collisions.some(c => c.kind === 'identical'));
    assert.ok(planned.review.collisions.some(c => c.kind === 'different-file' && c.blocking));
    assert.ok(planned.review.collisions.some(c => c.kind === 'different-sidecar' && c.blocking));
    assert.ok(planned.review.collisions.some(c => c.kind === 'other-photographer' && c.blocking));
    const r = await svc.run(w.A, { destPath: w.B, kind: 'dump', selection });
    assert.equal(r.ok, true);
    assert.equal(fs.existsSync(path.join(w.A, 'Dump', P1, 'IMG_0003.JPG')), false, 'identical source removed — B already had it');
    assert.equal((await listTree(w.B)).filter(x => /IMG_0003/.test(x)).length, 1, 'no "_1" duplicate');
    for (const f of [`Dump/${P1}/IMG_0004.JPG`, `Dump/${P1}/IMG_0001.JPG`, `Dump/${P1}/IMG_0001.CR3`, `Dump/${P1}/IMG_0001.xmp`, `Dump/${P2}/DSC_0001.JPG`]) assert.ok(fs.existsSync(path.join(w.A, f)), `${f} stays in A`);
    assert.equal(await fsp.readFile(path.join(w.B, 'Dump', P1, 'IMG_0004.JPG'), 'utf8'), 'something else', 'destination never overwritten');
    assert.equal(await fsp.readFile(path.join(w.B, 'Dump', P1, 'IMG_0001.xmp'), 'utf8'), '<x:xmpmeta different/>');
  });

  for (const phase of ['publishing', 'dest-records', 'source-records', 'staging', 'cleanup', 'metadata', 'finish']) {
    await t(`crash at "${phase}" → recovery completes exactly once (no loss, no duplicate history, no orphaned intent)`, async () => {
      const w = await makeWorld();
      const selection = abs(w.A, `Dump/${P1}/IMG_0001.JPG`, `Dump/${P1}/IMG_0002.JPG`, `Dump/${P2}/DSC_0001.JPG`);
      const crashy = service(w, { testHooks: { crash: async (ph) => { if (ph === phase) { const e = new Error(`crash at ${phase}`); e.code = 'TEST_CRASH'; throw e; } } } }).svc;
      await assert.rejects(crashy.run(w.A, { destPath: w.B, kind: 'dump', selection }), /crash at/);
      assert.ok(await crashy.busyFor(w.A) && await crashy.busyFor(w.B), 'both events report the unfinished transfer (renames blocked)');
      // Every file exists somewhere — never lost.
      for (const f of [`Dump/${P1}/IMG_0001.JPG`, `Dump/${P1}/IMG_0001.CR3`, `Dump/${P1}/IMG_0001.xmp`, `Dump/${P1}/IMG_0002.JPG`, `Dump/${P2}/DSC_0001.JPG`]) {
        assert.ok(fs.existsSync(path.join(w.A, f)) || fs.existsSync(path.join(w.B, f)), `${f} exists after the crash`);
      }
      const { svc, calls } = service(w);   // "restart"
      const rec = await svc.recoverFor(phase === 'dest-records' ? w.B : w.A);   // from either side
      const dA = await readDoc(w.A), dB = await readDoc(w.B);
      if (phase === 'publishing') {
        assert.equal(rec[0].phase, 'cancelled', 'nothing reached B: closed as cancelled');
        assert.equal((await listTree(w.B)).filter(x => x.startsWith('Dump/')).length, 0);
        assert.equal(dB.transfersIn, undefined); assert.equal(dA.transfersOut, undefined);
        assert.ok(dA.tagRefinements, 'source intent untouched');
      } else {
        assert.equal(rec[0].phase, 'done', JSON.stringify(rec));
        assert.deepEqual((await listTree(w.A)).filter(x => /IMG_0001|IMG_0002|DSC_0001/.test(x)), [], 'nothing left behind in A');
        assert.equal((await listTree(w.B)).filter(x => /IMG_0001|IMG_0002|DSC_0001/.test(x)).length, 5, 'every file at B exactly once');
        assert.equal(dB.transfersIn.length, 1, 'one transfer entry'); assert.equal(dA.transfersOut.length, 1);
        assert.equal(dA.tagRefinements, undefined); assert.equal(dA.metadataGroups, undefined);
        assert.equal(dB.tagRefinements[0].relPaths[0], `Dump/${P1}/IMG_0001.CR3`, 'intent at the new path only');
        assert.equal(calls.meta.length, 1, 'metadata queued once on recovery');
      }
      assert.equal(dB.imports.length, 1, 'no import added');
      assert.equal(await svc.busyFor(w.A), null); assert.equal(await svc.busyFor(w.B), null);
      assert.equal((await engine.listInbound(w.B)).markers.length, 0, 'marker removed');
    });
  }

  await t('crash in the middle of publishing (one shot placed) → that shot completed, the rest stay in A', async () => {
    const w = await makeWorld();
    const selection = abs(w.A, `Dump/${P1}/IMG_0003.JPG`, `Dump/${P1}/IMG_0004.JPG`);
    const { svc } = service(w);
    let calls = 0;
    await assert.rejects(svc.run(w.A, { destPath: w.B, kind: 'dump', selection }, (p) => { if (p.stage === 'moving' && ++calls === 1) throw new Error('power cut'); }), /power cut/);
    const placed = (await listTree(w.B)).filter(x => x.startsWith('Dump/'));
    assert.equal(placed.length, 1);
    const rec = await service(w).svc.recoverFor(w.A);
    assert.equal(rec[0].phase, 'done');
    assert.equal(rec[0].movedFiles, 1, 'only the placed shot moves');
    assert.equal((await listTree(w.A)).filter(x => /IMG_000[34]/.test(x)).length, 1, 'the other stays in A');
  });

  await t('recovery: source and destination both present with different content → needs attention, nothing touched', async () => {
    const w = await makeWorld();
    const selection = abs(w.A, `Dump/${P1}/IMG_0003.JPG`);
    const crashy = service(w, { testHooks: { crash: async (ph) => { if (ph === 'dest-records') throw new Error('crash'); } } }).svc;
    await assert.rejects(crashy.run(w.A, { destPath: w.B, kind: 'dump', selection }));
    await fsp.unlink(path.join(w.B, 'Dump', P1, 'IMG_0003.JPG'));
    await put(path.join(w.B, 'Dump', P1, 'IMG_0003.JPG'), 'tampered');
    const rec = await service(w).svc.recoverFor(w.A);
    assert.equal(rec[0].phase, 'needs-attention');
    assert.equal(await fsp.readFile(path.join(w.B, 'Dump', P1, 'IMG_0003.JPG'), 'utf8'), 'tampered');
    assert.ok(fs.existsSync(path.join(w.A, 'Dump', P1, 'IMG_0003.JPG')), 'source kept');
    assert.match(await service(w).svc.busyFor(w.A), /needs attention/);
  });

  await t('stale marker (journal never written / already finished) is removed, not treated as pending work', async () => {
    const w = await makeWorld();
    await put(path.join(engine.inDir(w.B), 'ds-xezz-00000000.json'), JSON.stringify({ schema: `${engine.SCHEMA}.inbound`, version: 1, txId: 'ds-xezz-00000000', sourceEventFolder: path.basename(w.A) }));
    const { svc } = service(w);
    assert.ok(await svc.busyFor(w.B));
    await svc.recoverFor(w.B);
    assert.equal(await svc.busyFor(w.B), null);
  });

  await t('guards: other collection, Local Staging, same event, unsynced Local First, import/sort running, metadata on Dump, locks', async () => {
    const w = await makeWorld();
    const other = await makeWorld({ collection: 'Other' });
    const sel = abs(w.A, `Dump/${P1}/IMG_0003.JPG`);
    let r = await service(w, { roots: () => ({ archive: [path.join(w.base, 'archive'), path.join(other.base, 'archive')], staging: null, nas: null }) }).svc.plan(w.A, { destPath: other.B, kind: 'dump', selection: sel });
    assert.match(r.blockers[0], /another collection/);
    r = await service(w).svc.plan(w.A, { destPath: w.A, kind: 'dump', selection: sel });
    assert.match(r.blockers[0], /event being sorted/);
    r = await service(w, { roots: () => ({ archive: [path.join(w.base, 'archive')], staging: path.join(w.base, 'archive', 'Coll'), nas: null }) }).svc.plan(w.A, { destPath: w.B, kind: 'dump', selection: sel });
    assert.match(r.blockers[0], /Local Staging/);
    for (const [over, re] of [
      [{ pendingSyncFor: async (ev) => (ev === w.B ? ['job'] : []) }, /not yet synced/],
      [{ isImportRunning: () => true }, /import is running/],
      [{ sortBusyFor: async (ev) => (ev === w.B ? 'A Sort Dump is moving photos in this event.' : null) }, /destination event: A Sort Dump/],
      [{ activeMetadataFor: async () => 1 }, /Metadata is still being written/],
    ]) {
      r = await service(w, over).svc.plan(w.A, { destPath: w.B, kind: 'dump', selection: sel });
      assert.equal(r.ok, false); assert.ok(r.blockers.some(b => re.test(b)), JSON.stringify(r.blockers));
    }
    const { svc, calls } = service(w, { acquireLocks: async (ev) => (ev === w.B ? { ok: false, lockedBy: 'Other-Mac', self: false } : { ok: true, release: async () => { calls.released.push(path.basename(ev)); } }) });
    r = await svc.run(w.A, { destPath: w.B, kind: 'dump', selection: sel });
    assert.equal(r.ok, false); assert.match(r.blockers[0], /in use by Other-Mac/);
    assert.equal(r.lock.self, false, 'another computer\'s lock is never offered for release');
    assert.ok(fs.existsSync(sel[0]), 'nothing moved while locked');
    assert.equal((await engine.listOutbound(w.A)).journals.length, 0, 'no journal written when locks are refused');
  });

  await t('crash-left locks of this computer in BOTH events → one release prompt lists both; another computer\'s lock is never offered', async () => {
    const w = await makeWorld();
    const sel = abs(w.A, `Dump/${P1}/IMG_0003.JPG`);
    const selfLocked = { acquireLocks: async (ev) => ({ ok: false, self: true, lockedBy: 'this-mac', lockPaths: [`/locks/${path.basename(ev)}`] }) };
    let r = await service(w, selfLocked).svc.run(w.A, { destPath: w.B, kind: 'dump', selection: sel });
    assert.equal(r.lock.self, true);
    assert.deepEqual(r.lock.lockPaths.sort(), [`/locks/${path.basename(w.A)}`, `/locks/${path.basename(w.B)}`].sort());
    const mixed = { acquireLocks: async (ev) => (ev === w.B ? { ok: false, self: false, lockedBy: 'Other-Mac' } : { ok: false, self: true, lockedBy: 'this-mac', lockPaths: ['/locks/a'] }) };
    r = await service(w, mixed).svc.run(w.A, { destPath: w.B, kind: 'dump', selection: sel });
    assert.equal(r.lock.self, false, 'mixed with another computer\'s lock: no release offered');
  });

  await t('inconsistent source intent record → that photo refused (never silently dropped)', async () => {
    const w = await makeWorld();
    const d = await readDoc(w.A);
    d.tagRefinements.push({ eventTypes: ['Waaz'], additionalKeywords: [], relPaths: [`Dump/${P1}/IMG_0001.CR3`] });   // conflicting record
    await fsp.writeFile(path.join(w.A, 'event.json'), JSON.stringify(d));
    const r = await service(w).svc.plan(w.A, { destPath: w.B, kind: 'dump', selection: abs(w.A, `Dump/${P1}/IMG_0001.JPG`, `Dump/${P1}/IMG_0003.JPG`) });
    assert.equal(r.review.files, 1);
    assert.ok(r.problems.some(p => /inconsistent/.test(p.reason)));
  });

  await t('opposite transfers lock in the same (path) order — no deadlock', async () => {
    const w = await makeWorld();
    const order = [];
    const over = { acquireLocks: async (ev) => { order.push(path.basename(ev)); return { ok: true, release: async () => {} }; } };
    await service(w, over).svc.run(w.A, { destPath: w.B, kind: 'dump', selection: abs(w.A, `Dump/${P1}/IMG_0003.JPG`) });
    await service(w, over).svc.run(w.B, { destPath: w.A, kind: 'dump', selection: abs(w.B, `Dump/${P1}/IMG_0003.JPG`) });
    assert.deepEqual(order.slice(0, 2), order.slice(2, 4));
  });

  await t('transferred media then sorted normally in B by Sort Dump (no new import, Sort Dump audit only)', async () => {
    const w = await makeWorld();
    const { svc } = service(w);
    await svc.run(w.A, { destPath: w.B, kind: 'dump', selection: abs(w.A, `Dump/${P1}/IMG_0003.JPG`, `Dump/${P1}/IMG_0004.JPG`) });
    const sort = createDumpSortService({
      updateEventJsonAtomic, intent,
      roots: () => ({ archive: [path.join(w.base, 'archive')], staging: null, nas: null }),
      pendingSyncFor: async () => [], activeMetadataFor: async () => 0, isImportRunning: () => false,
      acquireLocks: async () => ({ ok: true, release: async () => {} }),
      verifyMetadata: async (ev, files) => ({ state: 'complete', checked: files.length }),
      transferBusyFor: (real) => svc.busyFor(real),
    });
    const st = await sort.status(w.B);
    assert.equal(st.showSortDump, true); assert.equal(st.unsorted, 2, 'B\'s Sort Dump is offered for the transferred photos');
    const r = await sort.run(w.B, { selection: abs(w.B, `Dump/${P1}/IMG_0003.JPG`, `Dump/${P1}/IMG_0004.JPG`).map(p => ({ path: p, subEventId: 'Majlis-Hall' })) });
    assert.equal(r.ok, true, JSON.stringify(r));
    const dB = await readDoc(w.B);
    assert.equal(dB.imports.length, 1); assert.equal(dB.dumpSorts.length, 1); assert.equal(dB.transfersIn.length, 1);
    assert.ok(fs.existsSync(path.join(w.B, 'Majlis-Hall', `PC02-${P1}`, 'IMG_0003.JPG')));
    assert.equal((await sort.status(w.A)).unsorted, 7, 'A keeps its remaining photos');
  });

  await t('Sort Dump of an event with an unfinished transfer is blocked (and its empty-folder delete refused)', async () => {
    const w = await makeWorld();
    const crashy = service(w, { testHooks: { crash: async (ph) => { if (ph === 'cleanup') throw new Error('crash'); } } }).svc;
    await assert.rejects(crashy.run(w.A, { destPath: w.B, kind: 'dump', selection: abs(w.A, `Dump/${P2}/DSC_0001.JPG`, `Dump/${P2}/DSC_0002.JPG`) }));
    const { svc } = service(w);
    const sort = createDumpSortService({
      updateEventJsonAtomic, intent, roots: () => ({ archive: [path.join(w.base, 'archive')], staging: null, nas: null }),
      pendingSyncFor: async () => [], activeMetadataFor: async () => 0, isImportRunning: () => false,
      acquireLocks: async () => ({ ok: true, release: async () => {} }), transferBusyFor: (real) => svc.busyFor(real),
    });
    const p = await sort.plan(w.B, []);
    assert.ok(p.blockers.some(b => /transfer/.test(b)));
    const del = await sort.deleteEmptyPhotographerFolder(w.A, P2);
    assert.equal(del.ok, false);
  });

  await fsp.rm(root, { recursive: true, force: true });
  console.log(`eqi32CrossEventMove: ${passed} passed`);
})();
