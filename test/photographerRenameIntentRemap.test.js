'use strict';

// AutoIngest-managed photographer-folder renames change destination-relative paths, so the durable
// intent keys must move with them — from the ACTUAL rename pairs produced by the rename operation
// (real photographerSequenceService.applyRenames on a real folder tree), never fuzzy matching.
// Run with: node test/photographerRenameIntentRemap.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const seq = require('../services/photographerSequenceService');
const I = require('../services/eventMetadataIntent');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}
const EMPTY = { eventTypes: [], additionalKeywords: [] };
const bucket = (et, ak, rel) => ({ eventTypes: et, additionalKeywords: ak, relPaths: rel });
const mkdirs = async (root, rels) => { for (const r of rels) await fsp.mkdir(path.join(root, ...r.split('/')), { recursive: true }); };
const remapAll = (doc, renames) => {
  const remap = I.prefixRemapper(I.prefixPairsFromRenames(renames));
  return { tr: I.remapTagRefinements(doc.tagRefinements, remap), mg: I.remapMetadataGroups(doc.metadataGroups, remap) };
};

console.log('photographerRenameIntentRemap');

(async () => {
  await t('applyRenames reports scope-aware pairs; remap moves BOTH intent fields for exactly those folders (single-component)', async () => {
    const ev = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-ren-'));
    await mkdirs(ev, ['Jane Doe', 'Ann Poe']);
    const res = await seq.applyRenames(ev, [{ scopeKey: seq.EVENT_ROOT_KEY, ordered: [{ canonical: 'Jane Doe', sequence: 1, folderName: 'PC01 Jane Doe' }, { canonical: 'Ann Poe', sequence: 2, folderName: 'PC02 Ann Poe' }] }]);
    assert.ok(res.ok); assert.deepEqual(res.renames.map(r => [r.scopeRel, r.from, r.to]).sort(), [['', 'Ann Poe', 'PC02 Ann Poe'], ['', 'Jane Doe', 'PC01 Jane Doe']]);
    assert.ok(fs.existsSync(path.join(ev, 'PC01 Jane Doe')) && !fs.existsSync(path.join(ev, 'Jane Doe')));
    const doc = { tagRefinements: [bucket([], [], ['Jane Doe/C.cr2', 'Ann Poe/D.cr2']), bucket(['Ziyarat'], [], ['Jane Doe\\B.cr2'])], metadataGroups: [{ metadataTags: [], relPaths: ['Jane Doe/Z.cr2'] }, { metadataTags: ['Waaz'], relPaths: ['Jane Doe/A.cr2', 'Other/keep.cr2'] }] };
    const { tr, mg } = remapAll(doc, res.renames);
    const trR = I._parseTagRefinements(tr.value).records, mgR = I._parseMetadataGroups(mg.value).records;
    assert.deepEqual(trR.get('PC01 Jane Doe/C.cr2'), EMPTY); assert.deepEqual(trR.get('PC02 Ann Poe/D.cr2'), EMPTY);
    assert.deepEqual(trR.get('PC01 Jane Doe/B.cr2'), { eventTypes: ['Ziyarat'], additionalKeywords: [] });                 // historical "\" key remapped too
    assert.deepEqual(mgR.get('PC01 Jane Doe/Z.cr2'), []); assert.deepEqual(mgR.get('PC01 Jane Doe/A.cr2'), ['Waaz']);
    assert.deepEqual(mgR.get('Other/keep.cr2'), ['Waaz'], 'a folder that was not renamed is untouched');
    for (const k of [...trR.keys(), ...mgR.keys()]) assert.ok(!k.startsWith('Jane Doe/') && !k.startsWith('Ann Poe/'), k);
  });
  await t('multi-component: each component scope remaps only its own photographer folders', async () => {
    const ev = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-ren-'));
    await mkdirs(ev, ['Comp-A/Jane Doe', 'Comp-B/Jane Doe']);
    const res = await seq.applyRenames(ev, [{ scopeKey: 'Comp-A', ordered: [{ canonical: 'Jane Doe', sequence: 1, folderName: 'PC01 Jane Doe' }] }]);   // only Comp-A renamed
    assert.deepEqual(res.renames.map(r => [r.scopeRel, r.from, r.to]), [['Comp-A', 'Jane Doe', 'PC01 Jane Doe']]);
    const { tr } = remapAll({ tagRefinements: [bucket([], [], ['Comp-A/Jane Doe/x.cr2', 'Comp-B/Jane Doe/y.cr2'])] }, res.renames);
    const r = I._parseTagRefinements(tr.value).records;
    assert.ok(r.has('Comp-A/PC01 Jane Doe/x.cr2')); assert.ok(r.has('Comp-B/Jane Doe/y.cr2'), 'other component untouched'); assert.equal(r.size, 2);
  });
  await t('A↔B swap: keys move independently — no chaining, no collision, nothing lost', async () => {
    const ev = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-ren-'));
    await mkdirs(ev, ['PC01 Ann', 'PC02 Jane']);
    const res = await seq.applyRenames(ev, [{ scopeKey: seq.EVENT_ROOT_KEY, ordered: [{ canonical: 'Jane', sequence: 1, folderName: 'PC01 Jane' }, { canonical: 'Ann', sequence: 2, folderName: 'PC02 Ann' }] }]);
    assert.ok(res.ok);
    const swapDoc = { tagRefinements: [bucket([], [], ['PC01 Ann/a.cr2']), bucket(['Z'], [], ['PC02 Jane/j.cr2'])] };
    const { tr } = remapAll(swapDoc, [{ scopeRel: '', from: 'PC01 Ann', to: 'PC02 Ann' }, { scopeRel: '', from: 'PC02 Jane', to: 'PC01 Jane' }]);
    const r = I._parseTagRefinements(tr.value); assert.equal(r.conflicts.size, 0);
    assert.deepEqual(r.records.get('PC02 Ann/a.cr2'), EMPTY); assert.deepEqual(r.records.get('PC01 Jane/j.cr2'), { eventTypes: ['Z'], additionalKeywords: [] });
    const pure = { tagRefinements: [bucket([], [], ['A/x.cr2']), bucket(['Z'], [], ['B/y.cr2'])] };
    const sw = remapAll(pure, [{ scopeRel: '', from: 'A', to: 'B' }, { scopeRel: '', from: 'B', to: 'A' }]);
    const sr = I._parseTagRefinements(sw.tr.value); assert.equal(sr.conflicts.size, 0);
    assert.deepEqual(sr.records.get('B/x.cr2'), EMPTY); assert.deepEqual(sr.records.get('A/y.cr2'), { eventTypes: ['Z'], additionalKeywords: [] });
  });
  await t('failure in a LATER scope: reported renames are exactly the ones still in effect (earlier scopes), so no key is left orphaned', async () => {
    const ev = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-ren-'));
    await mkdirs(ev, ['Comp-A/Jane Doe', 'Comp-B/Jane Doe']);
    await fsp.writeFile(path.join(ev, 'Comp-B', 'PC01 Jane Doe'), 'a FILE squatting on the target name');       // makes Comp-B's rename fail
    const res = await seq.applyRenames(ev, [
      { scopeKey: 'Comp-A', ordered: [{ canonical: 'Jane Doe', sequence: 1, folderName: 'PC01 Jane Doe' }] },
      { scopeKey: 'Comp-B', ordered: [{ canonical: 'Jane Doe', sequence: 1, folderName: 'PC01 Jane Doe' }] }]);
    assert.equal(res.ok, false);
    assert.ok(fs.existsSync(path.join(ev, 'Comp-A', 'PC01 Jane Doe')), 'setup: Comp-A rename really is in effect');
    assert.deepEqual(res.renames.map(r => [r.scopeRel, r.to]), [['Comp-A', 'PC01 Jane Doe']]);
    const { tr } = remapAll({ tagRefinements: [bucket([], [], ['Comp-A/Jane Doe/x.cr2', 'Comp-B/Jane Doe/y.cr2'])] }, res.renames);
    const r = I._parseTagRefinements(tr.value).records;
    assert.ok(r.has('Comp-A/PC01 Jane Doe/x.cr2')); assert.ok(r.has('Comp-B/Jane Doe/y.cr2'), 'Comp-B was not renamed, so its key stays');
  });
  await t('no fuzzy matching: a similarly named folder is never touched; a no-op rename set changes nothing', async () => {
    const doc = { tagRefinements: [bucket([], [], ['Jane Doe 2/a.cr2', 'Jane/b.cr2'])] };
    const { tr } = remapAll(doc, [{ scopeRel: '', from: 'Jane Doe', to: 'PC01 Jane Doe' }]);
    assert.equal(tr.changed, false); assert.equal(tr.value, doc.tagRefinements);
    assert.equal(remapAll(doc, []).tr.changed, false);
  });

  console.log(`${passed} passed`);
  if (process.exitCode) console.log('SOME TESTS FAILED');
})();
