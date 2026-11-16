'use strict';

// AI-FEAT-064 EQI-3 — Sort Dump discovery, destination planning and the move transaction
// (services/dumpSortDiscovery.js, dumpSortPlanner.js, dumpSortJournal.js, dumpSortEngine.js).
// Real temporary folders only; crashes are injected at every step and recovered.
// Run: node test/eqi3DumpSortEngine.test.js

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { discoverDump, summarize } = require('../services/dumpSortDiscovery');
const { planSort } = require('../services/dumpSortPlanner');
const engine = require('../services/dumpSortEngine');
const journal = require('../services/dumpSortJournal');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

let root;
const bytes = (n, seed) => crypto.createHash('sha256').update(String(seed)).digest().toString('hex').repeat(Math.ceil(n / 64)).slice(0, n);
async function put(ev, rel, content) { const p = path.join(ev, ...rel.split('/')); await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, content); return p; }
async function tree(dir) {
  const out = [];
  async function walk(d, rel) {
    let es; try { es = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) await walk(path.join(d, e.name), r); else out.push(r); }
  }
  await walk(dir, '');
  return out.sort();
}
const media = (list) => list.filter(r => !r.startsWith('.autoingest') && r !== 'event.json');

/** An event with a two-photographer Dump: Ali (RAW+JPEG+XMP pair, nested folder, video), Bo (JPEGs). */
async function makeEvent(name, { components = [{ folderName: 'Majlis' }, { folderName: 'Waaz' }] } = {}) {
  const ev = path.join(root, name);
  await put(ev, 'event.json', JSON.stringify({ components }));
  await put(ev, 'Dump/Ali/IMG_0001.CR3', bytes(3000, 'a1r'));
  await put(ev, 'Dump/Ali/IMG_0001.JPG', bytes(900, 'a1j'));
  await put(ev, 'Dump/Ali/IMG_0001.xmp', '<xmp a1/>');
  await put(ev, 'Dump/Ali/card2/IMG_0002.JPG', bytes(800, 'a2'));
  await put(ev, 'Dump/Ali/VIDEO/MVI_0003.MP4', bytes(5000, 'a3'));
  await put(ev, 'Dump/Bo/DSC_0101.JPG', bytes(700, 'b1'));
  await put(ev, 'Dump/Bo/DSC_0102.JPG', bytes(700, 'b2'));
  return ev;
}

async function planFor(ev, selection, extra = {}) {
  const found = await discoverDump(ev);
  const doc = JSON.parse(await fsp.readFile(path.join(ev, 'event.json'), 'utf8'));
  const comps = doc.components;
  const scopeDirs = {};
  for (const c of comps.length > 1 ? comps.map(c => c.folderName) : ['__eventRoot__']) {
    const base = c === '__eventRoot__' ? ev : path.join(ev, c);
    scopeDirs[c] = (await fsp.readdir(base, { withFileTypes: true }).catch(() => [])).filter(e => e.isDirectory()).map(e => e.name);
  }
  const dumpRels = [...found.photographers.flatMap(p => p.files.map(f => f.rel)), ...found.sidecars];
  return planSort({ dumpDir: found.dumpDir, components: comps, photographerSequences: doc.photographerSequences, scopeDirs, dumpRels, selection, ...extra });
}

(async () => {
  console.log('eqi3DumpSortEngine');
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-eqi3-engine-'));

  // ── discovery ──
  await t('discovery: every photographer and nested folder, sidecars/partials/hidden/unsupported kept apart', async () => {
    const ev = await makeEvent('E-disc');
    await put(ev, 'Dump/Ali/IMG_0004.JPG.aiimport-partial', 'x');
    await put(ev, 'Dump/Bo/.DS_Store', 'x');
    await put(ev, 'Dump/Bo/notes.txt', 'x');
    await put(ev, 'Dump/stray.JPG', 'x');
    await fsp.symlink('/etc', path.join(ev, 'Dump', 'Bo', 'escape'));
    await put(ev, 'Dump/PC01-Zed/IMG_9.JPG', 'x');
    const f = await discoverDump(ev);
    assert.deepEqual(f.photographers.map(p => [p.name, p.files.length]), [['Ali', 4], ['Bo', 2]]);
    assert.equal(f.media, 6);
    assert.deepEqual(f.sidecars, ['Dump/Ali/IMG_0001.xmp']);
    assert.deepEqual(f.partials, ['Dump/Ali/IMG_0004.JPG.aiimport-partial']);
    assert.deepEqual(f.hidden, ['Dump/Bo/.DS_Store']);
    assert.deepEqual(f.unsupported.map(u => u.reason).sort(), ['PC-sequenced folder inside Dump', 'file directly in Dump (no photographer folder)', 'symbolic link', 'unsupported file type'].sort());
    const s = summarize(f);
    assert.ok(s.showSortDump && s.unsorted === 6 && s.attention === 5);
  });

  await t('discovery: an empty Dump (even with kept empty photographer folders) offers no Sort Dump', async () => {
    const ev = path.join(root, 'E-empty');
    await fsp.mkdir(path.join(ev, 'Dump', 'Ali', 'VIDEO'), { recursive: true });
    await put(ev, 'Dump/Ali/.DS_Store', 'x');
    const s = summarize(await discoverDump(ev));
    assert.equal(s.showSortDump, false);
    assert.equal(summarize(await discoverDump(path.join(root, 'no-such-event'))).showSortDump, false);
  });

  // ── planner ──
  await t('planner: selecting one file of a RAW/JPEG pair moves the whole shot with its XMP; videos go to VIDEO/', async () => {
    const ev = await makeEvent('E-plan1');
    const p = await planFor(ev, [{ rel: 'Dump/Ali/IMG_0001.JPG', subEventId: 'Majlis' }, { rel: 'Dump/Ali/VIDEO/MVI_0003.MP4', subEventId: 'Waaz' }]);
    assert.deepEqual(p.problems, []);
    assert.deepEqual(p.assets[0].members.map(m => m.dest), ['Majlis/Ali/IMG_0001.CR3', 'Majlis/Ali/IMG_0001.JPG', 'Majlis/Ali/IMG_0001.xmp']);
    assert.deepEqual(p.assets[1].members.map(m => m.dest), ['Waaz/Ali/VIDEO/MVI_0003.MP4']);
    assert.deepEqual(p.newFolders.map(f => [f.scopeKey, f.folderName, f.sequence]), [['Majlis', 'Ali', null], ['Waaz', 'Ali', null]]);
  });

  await t('planner: PC sequence only at the final destination — next number in a sequenced component, reuse of an existing PC folder, never inside Dump', async () => {
    const ev = await makeEvent('E-plan2');
    await fsp.mkdir(path.join(ev, 'Majlis', 'PC01-Zed'), { recursive: true });
    await fsp.mkdir(path.join(ev, 'Majlis', 'PC02-Ali'), { recursive: true });
    const p = await planFor(ev, [{ rel: 'Dump/Ali/card2/IMG_0002.JPG', subEventId: 'Majlis' }, { rel: 'Dump/Bo/DSC_0101.JPG', subEventId: 'Majlis' }, { rel: 'Dump/Bo/DSC_0102.JPG', subEventId: 'Waaz' }]);
    assert.deepEqual(p.assets.map(a => a.members[0].dest), ['Majlis/PC02-Ali/IMG_0002.JPG', 'Majlis/PC03-Bo/DSC_0101.JPG', 'Waaz/Bo/DSC_0102.JPG']);
    assert.deepEqual(p.newFolders.map(f => [f.scopeKey, f.folderName, f.sequence]), [['Majlis', 'PC03-Bo', 3], ['Waaz', 'Bo', null]]);
    assert.ok(p.assets.every(a => a.members.every(m => !m.dest.startsWith('Dump'))));
  });

  await t('planner: a pair split across two components, an unmapped group, two matching folders and a non-Dump path are refused', async () => {
    const ev = await makeEvent('E-plan3');
    await fsp.mkdir(path.join(ev, 'Waaz', 'Bo'), { recursive: true });
    await fsp.mkdir(path.join(ev, 'Waaz', 'PC01-Bo'), { recursive: true });
    const p = await planFor(ev, [
      { rel: 'Dump/Ali/IMG_0001.CR3', subEventId: 'Majlis' }, { rel: 'Dump/Ali/IMG_0001.JPG', subEventId: 'Waaz' },
      { rel: 'Dump/Ali/card2/IMG_0002.JPG', subEventId: null }, { rel: 'Dump/Bo/DSC_0101.JPG', subEventId: 'Waaz' }, { rel: 'Majlis/x.JPG', subEventId: 'Majlis' },
    ]);
    assert.equal(p.assets.length, 0);
    assert.deepEqual(p.problems.map(x => x.reason).sort(), ['RAW/JPEG pair assigned to two different components', 'RAW/JPEG pair assigned to two different components', 'no component assigned', 'not inside a Dump photographer folder', 'two folders for this photographer already exist (Bo, PC01-Bo)'].sort());
  });

  await t('planner: single-component event routes to <event>/<photographer>/', async () => {
    const ev = await makeEvent('E-plan4', { components: [{ folderName: 'Majlis' }] });
    const p = await planFor(ev, [{ rel: 'Dump/Bo/DSC_0101.JPG', subEventId: null }]);
    assert.deepEqual(p.assets[0].members.map(m => m.dest), ['Bo/DSC_0101.JPG']);
  });

  // ── engine ──
  const recorded = [];
  const hooks = (extra = {}) => ({
    applyRecords: async ({ pairs }) => { recorded.push(pairs.map(p => `${p.src}>${p.dest}`)); },
    mirrorStaging: async () => null,
    verifyMetadata: async ({ pairs }) => ({ state: 'complete', files: pairs.length }),
    ...extra,
  });

  await t('move: files leave Dump only after they are at the destination; content unchanged; journal kept in done/', async () => {
    const ev = await makeEvent('E-move1');
    const before = { cr3: await fsp.readFile(path.join(ev, 'Dump/Ali/IMG_0001.CR3')), mp4: await fsp.readFile(path.join(ev, 'Dump/Ali/VIDEO/MVI_0003.MP4')) };
    const plan = await planFor(ev, [{ rel: 'Dump/Ali/IMG_0001.JPG', subEventId: 'Majlis' }, { rel: 'Dump/Ali/VIDEO/MVI_0003.MP4', subEventId: 'Waaz' }]);
    const r = await engine.run({ eventPath: ev, dumpDir: 'Dump', plan, hooks: hooks() });
    assert.equal(r.ok, true);
    assert.equal(r.movedFiles, 3);
    assert.equal(r.sidecars, 1);
    assert.deepEqual(media(await tree(ev)), ['Dump/Ali/card2/IMG_0002.JPG', 'Dump/Bo/DSC_0101.JPG', 'Dump/Bo/DSC_0102.JPG', 'Majlis/Ali/IMG_0001.CR3', 'Majlis/Ali/IMG_0001.JPG', 'Majlis/Ali/IMG_0001.xmp', 'Waaz/Ali/VIDEO/MVI_0003.MP4']);
    assert.ok((await fsp.readFile(path.join(ev, 'Majlis/Ali/IMG_0001.CR3'))).equals(before.cr3));
    assert.ok((await fsp.readFile(path.join(ev, 'Waaz/Ali/VIDEO/MVI_0003.MP4'))).equals(before.mp4));
    assert.equal((await journal.listPending(ev)).journals.length, 0);
    assert.equal((await fsp.readdir(path.join(journal.journalDir(ev), 'done'))).length, 1);
  });

  await t('collisions: same bytes at the destination → no second copy; different photo → "_1" for the whole shot; same photo with other metadata → stays in Dump', async () => {
    const ev = await makeEvent('E-coll');
    await put(ev, 'Majlis/Bo/DSC_0101.JPG', bytes(700, 'b1'));                         // identical
    await put(ev, 'Majlis/Ali/IMG_0001.JPG', bytes(900, 'other photo'));               // different photo, same name
    await put(ev, 'Majlis/Bo/DSC_0102.JPG', bytes(705, 'b2-retagged'));                // same photo, metadata rewritten
    const imageHash = async (p) => path.basename(p) === 'DSC_0102.JPG' ? 'same-image-data' : crypto.createHash('md5').update(p).digest('hex');
    const plan = await planFor(ev, [{ rel: 'Dump/Bo/DSC_0101.JPG', subEventId: 'Majlis' }, { rel: 'Dump/Ali/IMG_0001.CR3', subEventId: 'Majlis' }, { rel: 'Dump/Bo/DSC_0102.JPG', subEventId: 'Majlis' }]);
    const r = await engine.run({ eventPath: ev, dumpDir: 'Dump', plan, hooks: hooks(), imageHash });
    assert.equal(r.ok, true);
    const all = media(await tree(ev));
    assert.ok(!all.includes('Dump/Bo/DSC_0101.JPG') && !all.includes('Majlis/Bo/DSC_0101_1.JPG'), 'identical file: Dump copy removed, no _1');
    assert.ok(['Majlis/Ali/IMG_0001_1.CR3', 'Majlis/Ali/IMG_0001_1.JPG', 'Majlis/Ali/IMG_0001_1.xmp'].every(x => all.includes(x)), 'whole shot renamed together');
    assert.ok(all.includes('Majlis/Ali/IMG_0001.JPG') && (await fsp.readFile(path.join(ev, 'Majlis/Ali/IMG_0001.JPG'), 'utf8')) === bytes(900, 'other photo'), 'existing file never overwritten');
    assert.ok(all.includes('Dump/Bo/DSC_0102.JPG') && !all.includes('Majlis/Bo/DSC_0102_1.JPG'), 'same photo: stays in Dump, no duplicate');
    assert.deepEqual(r.refused.map(x => x.src), ['Dump/Bo/DSC_0102.JPG']);
  });

  await t('NAS shares without hard links: no-overwrite rename; across volumes: verified copy, then the Dump copy is removed', async () => {
    for (const code of ['EPERM', 'EXDEV']) {
      const ev = await makeEvent(`E-${code}`);
      const io = { ...fsp, link: async () => { const e = new Error(code); e.code = code; throw e; } };
      const plan = await planFor(ev, [{ rel: 'Dump/Ali/IMG_0001.CR3', subEventId: 'Majlis' }]);
      const r = await engine.run({ eventPath: ev, dumpDir: 'Dump', plan, hooks: hooks(), io });
      assert.equal(r.ok, true, code);
      const all = media(await tree(ev));
      assert.ok(['Majlis/Ali/IMG_0001.CR3', 'Majlis/Ali/IMG_0001.JPG', 'Majlis/Ali/IMG_0001.xmp'].every(x => all.includes(x)) && !all.some(x => x.startsWith('Dump/Ali/IMG_0001')), code);
      assert.ok(!all.some(x => x.endsWith('.aiimport-partial')), `${code}: no partial left`);
    }
  });

  await t('safety: a symlink in Dump and a destination inside Dump are refused before anything moves', async () => {
    const ev = await makeEvent('E-safe');
    const outside = await put(root, 'outside/secret.JPG', 'x');
    await fsp.symlink(outside, path.join(ev, 'Dump', 'Bo', 'LINK.JPG'));
    const plan = { assets: [
      { id: 1, photographer: 'Bo', scopeKey: 'Majlis', folder: 'Bo', members: [{ role: 'media', kind: 'photo', src: 'Dump/Bo/LINK.JPG', dest: 'Majlis/Bo/LINK.JPG' }] },
      { id: 2, photographer: 'Bo', scopeKey: 'Majlis', folder: 'Bo', members: [{ role: 'media', kind: 'photo', src: 'Dump/Bo/DSC_0101.JPG', dest: 'Dump/Bo2/DSC_0101.JPG' }] },
    ], newFolders: [] };
    const r = await engine.run({ eventPath: ev, dumpDir: 'Dump', plan, hooks: hooks() });
    assert.equal(r.ok, false);
    assert.deepEqual(r.refused.map(x => x.reason), ['not a regular file', 'destination is outside the event or inside Dump']);
    assert.ok(fs.existsSync(outside) && fs.existsSync(path.join(ev, 'Dump/Bo/DSC_0101.JPG')));
  });

  // Crash injection: the run throws at a step; recover() must leave each shot whole in exactly one place.
  const crashes = [
    ['during the move (2nd shot)', (n) => ({ io: { ...fsp, link: async (a, b) => { if (++n.c === 4) throw Object.assign(new Error('power cut'), { code: 'EIO' }); return fsp.link(a, b); } } })],
    ['before event.json records', () => ({ hooks: { applyRecords: async () => { throw new Error('power cut'); } } })],
    ['during Local First staging', () => ({ hooks: { mirrorStaging: async () => { throw new Error('power cut'); } } })],
    ['during source cleanup', (n) => ({ io: { ...fsp, unlink: async (p) => { if (p.includes(`${path.sep}Dump${path.sep}`) && ++n.c === 2) throw Object.assign(new Error('power cut'), { code: 'EIO' }); return fsp.unlink(p); } } })],
    ['before completion is reported', (n) => ({ io: { ...fsp, rename: async (a, b) => { if (b.includes(`${path.sep}done${path.sep}`) && ++n.c === 1) throw Object.assign(new Error('power cut'), { code: 'EIO' }); return fsp.rename(a, b); } } })],
  ];
  for (const [label, inject] of crashes) {
    await t(`crash ${label}: recovery completes the move — no loss, no duplicate, pairs whole, records applied`, async () => {
      const ev = await makeEvent(`E-crash-${label.replace(/\W+/g, '-')}`);
      const plan = await planFor(ev, [{ rel: 'Dump/Ali/IMG_0001.CR3', subEventId: 'Majlis' }, { rel: 'Dump/Bo/DSC_0101.JPG', subEventId: 'Majlis' }, { rel: 'Dump/Bo/DSC_0102.JPG', subEventId: 'Waaz' }]);
      const bad = inject({ c: 0 });
      recorded.length = 0;
      await assert.rejects(engine.run({ eventPath: ev, dumpDir: 'Dump', plan, hooks: { ...hooks(), ...(bad.hooks || {}) }, io: bad.io || fsp }));
      assert.equal((await journal.listPending(ev)).journals.length, 1, 'journal left pending');
      recorded.length = 0;
      const rec = await engine.recover({ eventPath: ev, hooks: hooks() });
      assert.equal(rec.results.length, 1);
      assert.equal(rec.results[0].ok, true);
      const all = media(await tree(ev));
      const shots = [['Dump/Ali/IMG_0001.CR3', 'Majlis/Ali/IMG_0001.CR3'], ['Dump/Ali/IMG_0001.JPG', 'Majlis/Ali/IMG_0001.JPG'], ['Dump/Ali/IMG_0001.xmp', 'Majlis/Ali/IMG_0001.xmp'], ['Dump/Bo/DSC_0101.JPG', 'Majlis/Bo/DSC_0101.JPG'], ['Dump/Bo/DSC_0102.JPG', 'Waaz/Bo/DSC_0102.JPG']];
      for (const [src, dest] of shots) assert.equal(all.includes(src) + all.includes(dest), 1, `${src}: exactly one place`);
      const pairPlace = ['Dump/Ali/IMG_0001.CR3', 'Dump/Ali/IMG_0001.JPG', 'Dump/Ali/IMG_0001.xmp'].map(x => all.includes(x));
      assert.ok(pairPlace.every(x => x === pairPlace[0]), 'RAW/JPEG/XMP never split');
      const movedNow = shots.filter(([, d]) => all.includes(d)).map(([s, d]) => `${s}>${d}`).sort();
      assert.deepEqual([...recorded[0]].sort(), movedNow, 'records name exactly the moved files');
      assert.equal((await journal.listPending(ev)).journals.length, 0);
    });
  }

  await t('crash recovery never deletes a Dump file whose destination holds different content', async () => {
    const ev = await makeEvent('E-attn');
    const plan = await planFor(ev, [{ rel: 'Dump/Bo/DSC_0101.JPG', subEventId: 'Majlis' }]);
    await assert.rejects(engine.run({ eventPath: ev, dumpDir: 'Dump', plan, hooks: { ...hooks(), applyRecords: async () => { throw new Error('power cut'); } } }));
    // someone replaces the destination before recovery
    await fsp.unlink(path.join(ev, 'Majlis/Bo/DSC_0101.JPG'));
    await put(ev, 'Majlis/Bo/DSC_0101.JPG', 'something else');
    const rec = await engine.recover({ eventPath: ev, hooks: hooks() });
    assert.equal(rec.results[0].ok, false);
    assert.equal(rec.results[0].phase, 'needs-attention');
    assert.ok(fs.existsSync(path.join(ev, 'Dump/Bo/DSC_0101.JPG')), 'Dump copy kept');
    assert.equal((await journal.listPending(ev)).journals.length, 1, 'kept pending for the operator');
  });

  await fsp.rm(root, { recursive: true, force: true });
  console.log(`eqi3DumpSortEngine: ${passed} passed${process.exitCode ? ', FAILURES above' : ''}`);
})();
