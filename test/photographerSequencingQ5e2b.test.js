'use strict';

// AI-FEAT-063 / AI-RM-014 Q5e-2b — S5 groundwork: photographer sequencing writes event.json through
// the coordinated write chain, and a read-only identity guard refuses any sequencing that would
// rename (or collide with) a folder that has an S1 identity mapping, before anything is renamed.
// Legacy events (no S1 records) must behave exactly as before. Synthetic temp event trees only.
//
// Run: node test/photographerSequencingQ5e2b.test.js

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const seq = require('../services/photographerSequenceService');
const G = require('../services/photographerSequenceGuard');
const F = require('../services/eventPhotographerFolders');
const { updateEventJsonAtomic } = require('../main/eventJsonStore');
const intent = require('../services/eventMetadataIntent');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}
const tmp = (tag) => fsp.mkdtemp(path.join(os.tmpdir(), `ai-q5e2b-${tag}-`));
const KAY = '7a7a7a7a-1111-4222-8333-444444444443';
const LEE = '8b8b8b8b-1111-4222-8333-444444444444';
const ORIGIN = { computerId: 'fake-computer-q5e2b', operatorId: 'user_q5e2b_ab12' };
const AT = '2026-11-07T10:00:00.000Z';
const ROOT_KEY = seq.EVENT_ROOT_KEY;

function listTree(root) {
  const out = [];
  const walk = (d, rel) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const r = rel ? `${rel}/${e.name}` : e.name; out.push(e.isDirectory() ? `${r}/` : r); if (e.isDirectory()) walk(path.join(d, e.name), r); } };
  walk(root, '');
  return out;
}

/** Synthetic event: components → folders → one file each. */
async function makeEvent({ components = ['A-Day1', 'B-Day2'], folders = {}, doc = {} } = {}) {
  const ev = path.join(await tmp('event'), 'Event-Q5e2b');
  fs.mkdirSync(ev, { recursive: true });
  const multi = components.length > 1;
  for (const [scope, names] of Object.entries(folders)) {
    for (const n of names) {
      const dir = scope === ROOT_KEY ? path.join(ev, n) : path.join(ev, scope, n);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'IMG_0001.JPG'), `fake-${n}`);
    }
  }
  if (multi) for (const c of components) fs.mkdirSync(path.join(ev, c), { recursive: true });
  const base = {
    version: 1, hijriDate: '1448-05-02', sequence: 4, eventName: 'Event Q5e2b',
    components: components.map((folderName, i) => ({ id: i + 1, folderName, types: [], city: '' })),
    imports: [{ id: 'imp-1', photographer: 'Kay Current' }],
    tagRefinements: [{ eventTypes: ['Ziyarat'], additionalKeywords: [], relPaths: ['A-Day1/PC02-Kay Current/IMG_0001.JPG'] }],
    metadataGroups: [{ metadataTags: ['Waaz'], relPaths: ['A-Day1/PC02-Kay Current/IMG_0001.JPG', 'A-Day1/Other/keep.JPG'] }], futureField: { keep: 1 },
  };
  fs.writeFileSync(path.join(ev, 'event.json'), JSON.stringify({ ...base, ...doc }, null, 2));
  return ev;
}
const readDoc = (ev) => JSON.parse(fs.readFileSync(path.join(ev, 'event.json'), 'utf8'));

/** The scoped order the Event Creator sends, with folder names as main.js builds them. */
function ordered(scopes) {
  return Object.entries(scopes).map(([scopeKey, names]) => ({ scopeKey, ordered: names.map((canonical, i) => ({ canonical, sequence: i + 1, folderName: `${seq.seqPrefix(i + 1)}-${canonical}` })) }));
}

/** The main.js handler flow after validation: guard → renames → intent remap → sequences write. */
async function applyGuarded(ev, scopedOrdered) {
  let doc = null;
  try { doc = readDoc(ev); } catch { doc = null; }
  const plan = await seq.planRenames(ev, scopedOrdered);
  const guard = await G.checkSequencing({ eventPath: ev, doc, plan: plan.ok ? plan.renames : null });
  if (!guard.ok) return { ok: false, reason: guard.reason, code: guard.code };
  const r = await seq.applyRenames(ev, scopedOrdered);
  if (r.renames.length) {
    const remap = intent.prefixRemapper(intent.prefixPairsFromRenames(r.renames));
    await updateEventJsonAtomic(path.join(ev, 'event.json'), (d) => {
      const out = {};
      const tr = intent.remapTagRefinements(d.tagRefinements, remap); if (tr.changed) out.tagRefinements = tr.value;
      const mg = intent.remapMetadataGroups(d.metadataGroups, remap); if (mg.changed) out.metadataGroups = mg.value;
      return out;
    });
  }
  if (!r.ok) return { ok: false, reason: r.error };
  const sequences = Object.fromEntries(scopedOrdered.map(s => [s.scopeKey, Object.fromEntries(s.ordered.map(e => [e.canonical, { sequence: e.sequence, folderName: e.folderName }]))]));
  const w = await seq.writeSequencesToEventJson(ev, sequences);
  return w.ok ? { ok: true, renames: r.renames, sequences } : { ok: false, reason: w.error };
}

async function withMapping(ev, mappings) {
  const doc = readDoc(ev);
  const entries = mappings.map(m => ({ scope: m.scope, photographerId: m.id, folderName: m.folderName, sequencePrefix: (m.folderName.match(/^(PC\d{2,3})-/) || [])[1] || null, basis: 'operator-confirmed', establishedAt: AT, origin: ORIGIN, txId: crypto.randomUUID() }));
  const history = entries.map(e => ({ txId: e.txId, scope: e.scope, photographerId: e.photographerId, choice: 'mapped', fromFolderName: e.folderName, toFolderName: e.folderName, fromRegisteredName: 'Kay Current', toRegisteredName: 'Kay Current', at: AT, origin: ORIGIN }));
  doc.photographerFolders = { schema: 1, entries };
  doc.photographerFolderHistory = { schema: 1, entries: history };
  assert.equal(F.readPhotographerFolders(doc).state, 'ok', 'fixture mapping is valid');
  fs.writeFileSync(path.join(ev, 'event.json'), JSON.stringify(doc, null, 2));
  return doc;
}
const sA = { componentId: '1', componentFolder: 'A-Day1' };

(async () => {
  console.log('Q5e-2b — the write race (root cause) and its fix');

  await t('old direct writer lost a concurrent chained update; the chained writer keeps both', async () => {
    // The pre-Q5e-2b algorithm, verbatim in effect: read → spread → tmp+rename, outside the chain.
    const oldWrite = async (ev, sequences) => {
      const p = path.join(ev, 'event.json');
      const existing = JSON.parse(await fsp.readFile(p, 'utf8'));
      const tmpP = `${p}.tmp`;
      await fsp.writeFile(tmpP, JSON.stringify({ ...existing, photographerSequences: sequences, updatedAt: Date.now() }, null, 2));
      await fsp.rename(tmpP, p);
    };
    const race = async (writer) => {
      const ev = await makeEvent();
      let release;
      const gate = new Promise(r => { release = r; });
      // An import commit that has read event.json and is still computing its merge.
      const importCommit = updateEventJsonAtomic(path.join(ev, 'event.json'), async (d) => { await gate; return { imports: [...d.imports, { id: 'imp-2', photographer: 'Lee' }] }; });
      await new Promise(r => setTimeout(r, 20));
      const seqWrite = writer(ev, { [ROOT_KEY]: { Lee: { sequence: 1, folderName: 'PC01-Lee' } } });
      await new Promise(r => setTimeout(r, 20));
      release();
      await Promise.all([importCommit, seqWrite]);
      const d = readDoc(ev);
      return { imports: d.imports.length, sequences: !!d.photographerSequences };
    };
    assert.deepEqual(await race(oldWrite), { imports: 2, sequences: false }, 'old writer: its sequences were overwritten by the stale import copy');
    assert.deepEqual(await race(seq.writeSequencesToEventJson), { imports: 2, sequences: true }, 'chained writer: both changes kept');
  });

  await t('result and error contracts unchanged: ok, unreadable, invalid JSON, failed write leaves the file intact', async () => {
    const ev = await makeEvent();
    assert.deepEqual(await seq.writeSequencesToEventJson(ev, { [ROOT_KEY]: {} }), { ok: true });
    const missing = await seq.writeSequencesToEventJson(path.join(ev, 'nope'), {});
    assert.equal(missing.ok, false);
    assert.match(missing.error, /^Cannot read event\.json: /);
    fs.writeFileSync(path.join(ev, 'event.json'), '{ broken');
    assert.match((await seq.writeSequencesToEventJson(ev, {})).error, /^Cannot read event\.json: /);
    fs.writeFileSync(path.join(ev, 'event.json'), '[1,2]');
    assert.match((await seq.writeSequencesToEventJson(ev, {})).error, /^Cannot read event\.json: /, 'a non-object event.json is refused, not replaced');
    assert.equal(fs.readFileSync(path.join(ev, 'event.json'), 'utf8'), '[1,2]');
    const ev2 = await makeEvent();
    const before = fs.readFileSync(path.join(ev2, 'event.json'));
    fs.chmodSync(ev2, 0o555);
    let r;
    try { r = await seq.writeSequencesToEventJson(ev2, { [ROOT_KEY]: {} }); } finally { fs.chmodSync(ev2, 0o755); }
    assert.match(r.error, /^Failed to write event\.json: /);
    assert.deepEqual(fs.readFileSync(path.join(ev2, 'event.json')), before, 'interrupted write: previous event.json intact');
    assert.ok(!fs.existsSync(path.join(ev2, 'event.json.tmp')));
  });

  await t('every other field survives a sequencing write: imports, intent, components, unknown and S1 fields', async () => {
    const ev = await makeEvent({ folders: { 'A-Day1': ['PC02-Kay Current'] } });
    const before = await withMapping(ev, [{ scope: sA, id: KAY, folderName: 'PC02-Kay Current' }]);
    assert.deepEqual(await seq.writeSequencesToEventJson(ev, { 'A-Day1': { 'Kay Current': { sequence: 2, folderName: 'PC02-Kay Current' } } }), { ok: true });
    const after = readDoc(ev);
    for (const k of ['imports', 'tagRefinements', 'metadataGroups', 'components', 'futureField', 'photographerFolders', 'photographerFolderHistory']) assert.deepEqual(after[k], before[k], k);
  });

  console.log('Q5e-2b — legacy events (no identity records) behave exactly as before');

  await t('planRenames predicts applyRenames exactly: multi-component, event root, unsequenced, re-sequencing, repeat, empty', async () => {
    const cases = [
      { components: ['A-Day1', 'B-Day2'], folders: { 'A-Day1': ['Kay Current', 'Lee Two'], 'B-Day2': ['PC01-Lee Two', 'PC02-Kay Current'] }, order: { 'A-Day1': ['Lee Two', 'Kay Current'], 'B-Day2': ['Kay Current', 'Lee Two'] } },
      { components: ['Only'], folders: { [ROOT_KEY]: ['PC02-Kay Current', 'PC01-Lee Two', 'Mo Three'] }, order: { [ROOT_KEY]: ['Kay Current', 'Lee Two', 'Mo Three'] } },
      { components: ['Only'], folders: { [ROOT_KEY]: ['PC01-Kay Current'] }, order: { [ROOT_KEY]: ['Kay Current'] } },
      { components: ['A-Day1', 'B-Day2'], folders: { 'A-Day1': [] }, order: { 'A-Day1': ['Nobody Here'] } },
    ];
    for (const c of cases) {
      const ev = await makeEvent(c);
      const so = ordered(c.order);
      const plan = await seq.planRenames(ev, so);
      const before = listTree(ev);
      const res = await applyGuarded(ev, so);
      assert.equal(res.ok, true, JSON.stringify(res));
      assert.deepEqual(res.renames.map(r => [r.scopeRel || ROOT_KEY, r.from, r.to]).sort(), plan.renames.map(r => [r.scopeKey, r.from, r.to]).sort(), 'plan = actual renames');
      const after = listTree(ev);
      assert.equal(after.filter(x => x.endsWith('.JPG')).length, before.filter(x => x.endsWith('.JPG')).length, 'no file lost');
      assert.ok(!after.some(x => x.includes('__seq_tmp_')), 'no temp folder left');
      const again = await applyGuarded(ev, so);
      assert.deepEqual(again.renames, [], 'repeating the same order renames nothing');
      assert.deepEqual(readDoc(ev).photographerSequences, again.sequences);
    }
  });

  await t('v0.9.17 QMZ-aware sequencing: plan = actual for nested QMZ scopes; containers are never renamed', async () => {
    const ev = await makeEvent({ components: ['C-Day3', 'D-Day4'], folders: { 'C-Day3': ['Kay Current'], 'C-Day3/01Q': ['Lee Two'], 'C-Day3/_Unsequenced': ['Mo Three'] } });
    const scopes = await seq.scanPhotographerFolders(ev, readDoc(ev).components);
    assert.deepEqual(scopes.map(s => [s.scopeKey, s.photographers.map(p => p.folderName)]), [['C-Day3', ['Kay Current']], ['C-Day3/01Q', ['Lee Two']], ['C-Day3/_Unsequenced', ['Mo Three']], ['D-Day4', []]], 'containers are scanned as their own nested scopes');
    const so = ordered({ 'C-Day3': ['Kay Current', '01Q'], 'C-Day3/01Q': ['Lee Two'], 'C-Day3/_Unsequenced': ['Mo Three'] });
    const plan = await seq.planRenames(ev, so);
    assert.deepEqual(plan.renames.map(r => [r.scopeKey, r.from, r.to]), [['C-Day3', 'Kay Current', 'PC01-Kay Current'], ['C-Day3/01Q', 'Lee Two', 'PC01-Lee Two'], ['C-Day3/_Unsequenced', 'Mo Three', 'PC01-Mo Three']], 'a container sent as an entry is skipped, like applyRenames does');
    const res = await applyGuarded(ev, so);
    assert.equal(res.ok, true);
    assert.deepEqual(res.renames.map(r => [r.scopeRel, r.from, r.to]), plan.renames.map(r => [r.scopeKey, r.from, r.to]));
    assert.ok(fs.existsSync(path.join(ev, 'C-Day3', '01Q', 'PC01-Lee Two')) && !fs.existsSync(path.join(ev, 'C-Day3', 'PC02-01Q')), 'the 01Q container keeps its name');
  });

  await t('legacy: intent paths remapped with the renames, imports and unknown fields kept, guard says not mapped', async () => {
    const ev = await makeEvent({ folders: { 'A-Day1': ['PC02-Kay Current', 'PC01-Lee Two'] } });
    const g = await G.checkSequencing({ eventPath: ev, doc: readDoc(ev), plan: [] });
    assert.deepEqual(g, { ok: true, mapped: false });
    const res = await applyGuarded(ev, ordered({ 'A-Day1': ['Kay Current', 'Lee Two'] }));
    assert.equal(res.ok, true);
    const d = readDoc(ev);
    assert.deepEqual(d.tagRefinements.flatMap(b => b.relPaths), ['A-Day1/PC01-Kay Current/IMG_0001.JPG'], 'tag refinement path follows the folder');
    assert.deepEqual(d.metadataGroups.flatMap(g => g.relPaths).sort(), ['A-Day1/Other/keep.JPG', 'A-Day1/PC01-Kay Current/IMG_0001.JPG'], 'unrelated paths untouched');
    assert.deepEqual(d.imports, [{ id: 'imp-1', photographer: 'Kay Current' }]);
    assert.deepEqual(d.futureField, { keep: 1 });
    assert.deepEqual(d.photographerSequences['A-Day1'], { 'Kay Current': { sequence: 1, folderName: 'PC01-Kay Current' }, 'Lee Two': { sequence: 2, folderName: 'PC02-Lee Two' } });
  });

  await t('legacy: sync manifest paths still follow the renames', async () => {
    const ev = await makeEvent({ components: ['Only'], folders: { [ROOT_KEY]: ['Kay Current'] } });
    const manifest = require('../services/localSyncManifest');
    await manifest.writeManifest(ev, { jobs: [{ id: 'j1', photographer: 'Kay Current', files: ['Kay Current/IMG_0001.JPG'] }] });
    const so = ordered({ [ROOT_KEY]: ['Kay Current'] });
    assert.equal((await applyGuarded(ev, so)).ok, true);
    await seq.updateManifestAfterRename(ev, new Map([[ROOT_KEY, new Map([['Kay Current', 'PC01-Kay Current']])]]));
    const m = await manifest.readManifest(ev);
    assert.deepEqual(m.jobs[0].files, ['PC01-Kay Current/IMG_0001.JPG']);
  });

  console.log('Q5e-2b — events with identity records');

  await t('mapped event: renames of unmapped folders proceed; mappings and history carried over byte-identical', async () => {
    const ev = await makeEvent({ folders: { 'A-Day1': ['PC01-Kay Current', 'Lee Two'] } });
    const doc = await withMapping(ev, [{ scope: sA, id: KAY, folderName: 'PC01-Kay Current' }]);
    const res = await applyGuarded(ev, ordered({ 'A-Day1': ['Kay Current', 'Lee Two'] }));
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.deepEqual(res.renames.map(r => [r.from, r.to]), [['Lee Two', 'PC02-Lee Two']]);
    const after = readDoc(ev);
    assert.deepEqual(after.photographerFolders, doc.photographerFolders);
    assert.deepEqual(after.photographerFolderHistory, doc.photographerFolderHistory);
    assert.deepEqual((await F.verifyMappingsOnDisk(ev, F.readPhotographerFolders(after).mappings)).map(x => x.state), ['present'], 'mapping still matches the disk');
  });

  await t('mapped event: renaming a mapped folder, or onto a mapped name, is refused before anything moves (needs S4)', async () => {
    const ev = await makeEvent({ folders: { 'A-Day1': ['PC02-Kay Current', 'PC01-Lee Two'] } });
    await withMapping(ev, [{ scope: sA, id: KAY, folderName: 'PC02-Kay Current' }]);
    const tree = listTree(ev);
    const json = fs.readFileSync(path.join(ev, 'event.json'));
    const res = await applyGuarded(ev, ordered({ 'A-Day1': ['Kay Current', 'Lee Two'] }));
    assert.deepEqual([res.ok, res.code], [false, 'mapped-folder-rename-requires-s4']);
    assert.match(res.reason, /archive-safe rename transaction, which is not available yet\. Nothing was changed\./);
    assert.deepEqual(listTree(ev), tree, 'no folder renamed');
    assert.deepEqual(fs.readFileSync(path.join(ev, 'event.json')), json, 'event.json untouched');
    // Lee would take PC02, the name of Kay's mapped folder: also refused.
    const ev2 = await makeEvent({ folders: { 'A-Day1': ['PC02-Kay Current', 'PC03-Lee Two'] } });
    await withMapping(ev2, [{ scope: sA, id: KAY, folderName: 'PC02-Kay Current' }]);
    const plan = [{ scopeKey: 'A-Day1', from: 'PC03-Lee Two', to: 'PC02-Kay Current' }];
    assert.equal((await G.checkSequencing({ eventPath: ev2, doc: readDoc(ev2), plan })).code, 'mapped-folder-rename-requires-s4');
  });

  await t('mapped event: stale, invalid, unsupported, duplicate or unreadable records block sequencing; nothing guessed', async () => {
    const mk = async () => { const ev = await makeEvent({ folders: { 'A-Day1': ['PC01-Kay Current', 'Lee Two'] } }); await withMapping(ev, [{ scope: sA, id: KAY, folderName: 'PC01-Kay Current' }]); return ev; };
    const so = ordered({ 'A-Day1': ['Kay Current', 'Lee Two'] });
    const stale = await mk();
    fs.renameSync(path.join(stale, 'A-Day1', 'PC01-Kay Current'), path.join(stale, 'A-Day1', 'PC01-Kay Renamed Elsewhere'));
    assert.equal((await applyGuarded(stale, so)).code, 'identity-records-disagree', 'mapping points at a folder that is gone');
    const caseOnly = await mk();
    fs.renameSync(path.join(caseOnly, 'A-Day1', 'PC01-Kay Current'), path.join(caseOnly, 'A-Day1', 'tmp-x'));
    fs.renameSync(path.join(caseOnly, 'A-Day1', 'tmp-x'), path.join(caseOnly, 'A-Day1', 'pc01-kay current'));
    assert.equal((await applyGuarded(caseOnly, so)).code, 'identity-records-disagree');
    for (const mutate of [
      (d) => { d.photographerFolders.schema = 2; },
      (d) => { d.photographerFolders.entries.push({ ...d.photographerFolders.entries[0], photographerId: LEE }); },
      (d) => { d.photographerFolders.entries[0].folderName = '../escape'; },
      (d) => { d.photographerFolders = 'garbage'; },
    ]) {
      const ev = await mk();
      const d = readDoc(ev); mutate(d); fs.writeFileSync(path.join(ev, 'event.json'), JSON.stringify(d));
      const tree = listTree(ev);
      assert.equal((await applyGuarded(ev, so)).code, 'identity-records-unreadable');
      assert.deepEqual(listTree(ev), tree);
    }
    const ev = await mk();
    assert.equal((await G.checkSequencing({ eventPath: ev, doc: readDoc(ev), plan: null })).code, 'sequence-plan-unavailable');
  });

  await t('a pending rename transaction (synthetic S4 journal) blocks sequencing on mapped and legacy events', async () => {
    for (const mapped of [true, false]) {
      const ev = await makeEvent({ folders: { 'A-Day1': ['Lee Two', 'PC01-Kay Current'] } });
      if (mapped) await withMapping(ev, [{ scope: sA, id: KAY, folderName: 'PC01-Kay Current' }]);
      fs.mkdirSync(path.join(ev, '.autoingest'), { recursive: true });
      fs.writeFileSync(path.join(ev, '.autoingest', `rename-${crypto.randomUUID()}.json`), '{"synthetic":true}');
      const tree = listTree(ev);
      const r = await applyGuarded(ev, ordered({ 'A-Day1': ['Kay Current', 'Lee Two'] }));
      assert.deepEqual([r.ok, r.code], [false, 'rename-transaction-pending'], `mapped=${mapped}`);
      assert.deepEqual(listTree(ev), tree);
    }
  });

  console.log('Q5e-2b — wiring, gates and contracts');

  await t('main.js runs the guard and a per-event lock before any rename; the pre-existing steps are unchanged', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'main', 'main.js'), 'utf8');
    const h = src.slice(src.indexOf("ipcMain.handle('event:applyPhotographerSequence'"), src.indexOf('// ── QMZ Sequence Manager'));
    const iGuard = h.indexOf('photographerSequenceGuard.checkSequencing'), iApply = h.indexOf('photographerSeqService.applyRenames');
    assert.ok(iGuard > 0 && iApply > iGuard, 'guard before renames');
    assert.ok(/_sequencingEvents\.has\(realEvent\)/.test(h) && /finally \{\s*_sequencingEvents\.delete\(realEvent\);/.test(h), 'one run per event, always released');
    assert.ok(h.indexOf('A sync job is active for this event') < iGuard, 'the existing sync-job check still runs first');
    for (const step of ['_remapEventIntentForRenames(realEvent', 'writeSequencesToEventJson(realEvent', 'updateManifestAfterRename(realEvent', 'syncQueueService.refreshQueue()']) assert.ok(h.includes(step), step);
  });

  await t('gates: mapping writes still off (S3, META, COMP); rename gate unchanged; component-scope contract reports orphans', async () => {
    assert.deepEqual(F.writeGate(), { enabled: false, unmet: ['S3', 'META', 'COMP'] });
    const { renameGate } = require('../services/photographerRenameContract');
    assert.deepEqual(renameGate().unmet, ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8'], 'S5 is not complete: mapped renames still need S4');
    const ev = await makeEvent({ folders: { 'A-Day1': ['PC01-Kay Current'] } });
    const doc = await withMapping(ev, [{ scope: sA, id: KAY, folderName: 'PC01-Kay Current' }]);
    const renamed = doc.components.map(c => (c.id === 1 ? { ...c, folderName: 'A-Day1-Renamed' } : c));
    assert.deepEqual(F.componentScopeImpact(doc, renamed).affected, [{ index: 0, componentId: '1', from: 'A-Day1', to: 'A-Day1-Renamed' }]);
    assert.deepEqual(F.componentScopeImpact(doc, doc.components.filter(c => c.id !== 1)).affected[0].to, null, 'a removed component orphans its mappings');
    assert.equal(F.componentScopeImpact(doc, [doc.components[0]]).layoutChanges, true, 'multi → single component changes the layout');
    assert.deepEqual(F.componentScopeImpact(doc, doc.components).affected, []);
  });

  console.log(`${passed} passed`);
})();
