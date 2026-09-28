'use strict';

// Pure unit tests for the durable metadata-intent module — no Electron, no I/O.
// Run with: node test/eventMetadataIntent.test.js

const assert = require('node:assert/strict');
const path = require('node:path');
const I = require('../services/eventMetadataIntent');

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}
const EMPTY = { eventTypes: [], additionalKeywords: [] };
const bucket = (eventTypes, additionalKeywords, relPaths) => ({ eventTypes, additionalKeywords, relPaths });
const mbucket = (metadataTags, relPaths) => ({ metadataTags, relPaths });

console.log('eventMetadataIntent');

// ═══ relKey / canonical identity ═══════════════════════════════════════════════════════
t('relKey: POSIX, Windows, mixed and redundant separators all canonicalize identically', () => {
  const want = 'Jane Doe/IMG_1.cr2';
  for (const s of ['Jane Doe/IMG_1.cr2', 'Jane Doe\\IMG_1.cr2', 'Jane Doe/\\IMG_1.cr2', './Jane Doe//IMG_1.cr2', 'Jane Doe/./IMG_1.cr2', 'Jane Doe/IMG_1.cr2/'])
    assert.equal(I.relKey(s), want, s);
});
t('relKey: component + photographer + VIDEO folders', () => {
  assert.equal(I.relKey('Waaz-Hall B\\Jane Doe\\VIDEO\\clip.mp4'), 'Waaz-Hall B/Jane Doe/VIDEO/clip.mp4');
});
t('relKey: NFC/NFD equivalents match; case is preserved (exact matching, no case guessing)', () => {
  assert.equal(I.relKey('Zoë/a.cr2'.normalize('NFD')), I.relKey('Zoë/a.cr2'.normalize('NFC')));
  assert.notEqual(I.relKey('Jane/IMG.cr2'), I.relKey('jane/IMG.cr2'));
});
t('relKey: absolute paths, drive letters, .. traversal, empty and non-strings are never an identity', () => {
  for (const bad of ['/abs/x.cr2', 'C:\\Users\\x.cr2', 'C:/x.cr2', '../x.cr2', 'a/../x.cr2', '', '.', '///', null, undefined, 5, {}])
    assert.equal(I.relKey(bad), null, String(bad));
});
t('fileRelKey derives the key from an event-relative destination (collision-renamed names included)', () => {
  const ev = path.join('/arc', 'Coll', 'Event');
  assert.equal(I.fileRelKey(ev, path.join(ev, 'Jane Doe', 'dup_1.cr2')), 'Jane Doe/dup_1.cr2');
  assert.equal(I.fileRelKey(ev, path.join('/arc', 'Elsewhere', 'x.cr2')), null);   // outside the event
});

// ═══ parser: absent vs explicit-empty ══════════════════════════════════════════════════
t('absent / null / [] tagRefinements ⇒ no records (Default), no errors', () => {
  for (const raw of [undefined, null, []]) {
    const st = I._parseTagRefinements(raw);
    assert.equal(st.records.size, 0); assert.equal(st.conflicts.size, 0); assert.equal(st.fieldError, null);
  }
});
t('explicit-empty record is PRESENT (Map.get !== undefined) and distinct from absence', () => {
  const st = I._parseTagRefinements([bucket([], [], ['Jane Doe/C.cr2']), bucket(['Ziyarat'], [], ['Jane Doe/B.cr2'])]);
  assert.notEqual(st.records.get('Jane Doe/C.cr2'), undefined);
  assert.deepEqual(st.records.get('Jane Doe/C.cr2'), EMPTY);
  assert.equal(st.records.get('Jane Doe/A.cr2'), undefined);
  assert.deepEqual(st.records.get('Jane Doe/B.cr2'), { eventTypes: ['Ziyarat'], additionalKeywords: [] });
});
t('partial-empty records keep their non-empty side', () => {
  const st = I._parseTagRefinements([bucket([], ['Quran Tilawat'], ['x/a.cr2'])]);
  assert.deepEqual(st.records.get('x/a.cr2'), { eventTypes: [], additionalKeywords: ['Quran Tilawat'] });
});
t('metadataGroups: metadataTags [] is an explicit record, not absence', () => {
  const st = I._parseMetadataGroups([mbucket([], ['Jane Doe/C.cr2']), mbucket(['Waaz'], ['Jane Doe/A.cr2'])]);
  assert.deepEqual(st.records.get('Jane Doe/C.cr2'), []);
  assert.equal(st.records.get('Jane Doe/Z.cr2'), undefined);
});
t('historical Windows-separator records resolve to canonical keys', () => {
  const st = I._parseTagRefinements([bucket([], [], ['Ziyarat-Hall A\\Jane Doe\\G1_C.cr2'])]);
  assert.ok(st.records.has('Ziyarat-Hall A/Jane Doe/G1_C.cr2'));
});

// ═══ parser: fail closed ═══════════════════════════════════════════════════════════════
t('malformed record (arrays missing/non-string) with usable paths ⇒ per-key conflict, NEVER Default and never empty', () => {
  const st = I._parseTagRefinements([{ relPaths: ['a/x.cr2'] }, { eventTypes: null, additionalKeywords: null, relPaths: ['a/y.cr2'] }, { eventTypes: [1], additionalKeywords: [], relPaths: ['a/z.cr2'] }]);
  for (const k of ['a/x.cr2', 'a/y.cr2', 'a/z.cr2']) { assert.equal(st.records.has(k), false); assert.match(st.conflicts.get(k), /malformed/); }
});
t('same key in two buckets with DIFFERENT intent ⇒ conflict; identical duplicate is benign', () => {
  const conflict = I._parseTagRefinements([bucket(['Z'], [], ['a/x.cr2']), bucket([], [], ['a/x.cr2'])]);
  assert.match(conflict.conflicts.get('a/x.cr2'), /conflict/); assert.equal(conflict.records.has('a/x.cr2'), false);
  const benign = I._parseTagRefinements([bucket(['Z'], [], ['a/x.cr2']), bucket(['Z'], [], ['a\\x.cr2'])]);
  assert.equal(benign.conflicts.size, 0); assert.deepEqual(benign.records.get('a/x.cr2'), { eventTypes: ['Z'], additionalKeywords: [] });
});
t('a duplicate with explicit-empty vs default-looking value is a conflict, not a silent pick', () => {
  const st = I._parseTagRefinements([bucket([], [], ['a/x.cr2']), bucket(['Z'], ['K'], ['a/x.cr2'])]);
  assert.ok(st.conflicts.has('a/x.cr2'));
});
t('field not an array, or a bucket that cannot be attributed ⇒ field error (whole event fails closed)', () => {
  assert.match(I._parseTagRefinements({ nope: 1 }).fieldError, /field-malformed/);
  assert.match(I._parseTagRefinements([bucket([], [], ['a/x.cr2']), null]).fieldError, /unattributable/);
  assert.match(I._parseTagRefinements([{ eventTypes: [], additionalKeywords: [] }]).fieldError, /unattributable/);
});
t('unusable path strings are diagnosed and preserved, never attributed to a file', () => {
  const st = I._parseTagRefinements([bucket([], [], ['../evil.cr2', 'ok/a.cr2', 7])]);
  assert.ok(st.records.has('ok/a.cr2')); assert.equal(st.records.size, 1);
  assert.equal(st.diagnostics.filter(d => d.kind === 'unusable-path').length, 1);
  assert.equal(st.preserve.length, 1);
});
t('getIntent + integrityErrorFor: conflicts and field errors block a file; others are unaffected', () => {
  const doc = { tagRefinements: [bucket(['Z'], [], ['a/x.cr2']), bucket([], [], ['a/x.cr2']), bucket([], [], ['a/ok.cr2'])] };
  const intent = I.getIntent(doc);
  assert.match(I.integrityErrorFor(intent, 'a/x.cr2'), /conflict/);
  assert.equal(I.integrityErrorFor(intent, 'a/ok.cr2'), null);
  assert.equal(I.integrityErrorFor(intent, 'a/none.cr2'), null);
  const bad = I.getIntent({ metadataGroups: 'garbage' });
  assert.match(I.integrityErrorFor(bad, 'a/anything.cr2'), /field-malformed/);
});
t('getIntent is O(records) once: cached per document, rebuilt if a field is reassigned', () => {
  const doc = { tagRefinements: [bucket([], [], ['a/x.cr2'])] };
  const a = I.getIntent(doc); assert.equal(I.getIntent(doc), a);
  doc.tagRefinements = [bucket(['Z'], [], ['a/x.cr2'])];
  const b = I.getIntent(doc); assert.notEqual(b, a); assert.deepEqual(b.refinements.get('a/x.cr2').eventTypes, ['Z']);
  assert.equal(I.getIntent(null).refinements.size, 0); assert.equal(I.getIntent(undefined).conflicts.size, 0);
});

// ═══ merge ═════════════════════════════════════════════════════════════════════════════
const rec = (b, k) => I._parseTagRefinements(b).records.get(k);
t('merge: an import touching some keys preserves every unrelated record', () => {
  const existing = [bucket([], [], ['Jane/J1.cr2']), bucket(['Ziyarat'], [], ['Jane/J2.cr2'])];
  const r = I.mergeTagRefinements(existing, new Map([['John/R1.cr2', EMPTY]]));
  assert.equal(r.changed, true);
  const p = I._parseTagRefinements(r.value);
  assert.deepEqual([...p.records.keys()].sort(), ['Jane/J1.cr2', 'Jane/J2.cr2', 'John/R1.cr2']);
  assert.deepEqual(p.records.get('Jane/J1.cr2'), EMPTY);
});
t('merge: refined → refined replaces THAT key only', () => {
  const r = I.mergeTagRefinements([bucket(['Ziyarat'], [], ['a/x.cr2', 'a/y.cr2'])], new Map([['a/x.cr2', { eventTypes: ['Waaz'], additionalKeywords: ['K'] }]]));
  const p = I._parseTagRefinements(r.value);
  assert.deepEqual(p.records.get('a/x.cr2'), { eventTypes: ['Waaz'], additionalKeywords: ['K'] });
  assert.deepEqual(p.records.get('a/y.cr2'), { eventTypes: ['Ziyarat'], additionalKeywords: [] });
});
t('merge: refined → Default (undefined) DELETES that key\'s record and only that', () => {
  const r = I.mergeTagRefinements([bucket([], [], ['a/x.cr2', 'a/y.cr2'])], new Map([['a/x.cr2', undefined]]));
  const p = I._parseTagRefinements(r.value);
  assert.equal(p.records.has('a/x.cr2'), false); assert.ok(p.records.has('a/y.cr2'));
});
t('merge: Default → explicit empty CREATES a record (empty is not "nothing")', () => {
  const r = I.mergeTagRefinements(undefined, new Map([['a/x.cr2', EMPTY]]));
  assert.equal(r.changed, true); assert.deepEqual(r.value, [bucket([], [], ['a/x.cr2'])]);
});
t('merge: explicit-empty survives re-bucketing next to non-empty and other-empty records', () => {
  const r = I.mergeTagRefinements([bucket([], [], ['a/e1.cr2']), bucket(['Z'], [], ['a/z.cr2'])], new Map([['a/e2.cr2', EMPTY], ['a/z2.cr2', { eventTypes: ['Z'], additionalKeywords: [] }]]));
  const p = I._parseTagRefinements(r.value);
  assert.deepEqual(p.records.get('a/e1.cr2'), EMPTY); assert.deepEqual(p.records.get('a/e2.cr2'), EMPTY);
  const emptyBuckets = r.value.filter(b => b.eventTypes.length === 0 && b.additionalKeywords.length === 0);
  assert.equal(emptyBuckets.length, 1); assert.deepEqual(emptyBuckets[0].relPaths, ['a/e1.cr2', 'a/e2.cr2']);
});
t('merge: removing the last record yields value undefined (key dropped — "absent when none")', () => {
  const r = I.mergeTagRefinements([bucket([], [], ['a/x.cr2'])], new Map([['a/x.cr2', undefined]]));
  assert.equal(r.changed, true); assert.equal(r.value, undefined);
});
t('merge: no-op deltas return the SAME reference and changed=false (no rewrite, no churn)', () => {
  const existing = [bucket([], [], ['Jane\\C.cr2'])];                       // historical Windows-form stays as-is when nothing changes
  const same = I.mergeTagRefinements(existing, new Map([['Jane/C.cr2', EMPTY]]));
  assert.equal(same.changed, false); assert.equal(same.value, existing);
  const remDefault = I.mergeTagRefinements(existing, new Map([['other/none.cr2', undefined]]));
  assert.equal(remDefault.changed, false); assert.equal(remDefault.value, existing);
  assert.equal(I.mergeTagRefinements(undefined, new Map([['a/x.cr2', undefined]])).changed, false);
  assert.equal(I.mergeTagRefinements(existing, new Map()).value, existing);
});
t('merge: a rewrite canonicalizes separators to "/" (D1) and dedupes Windows-form keys against touched keys', () => {
  const r = I.mergeTagRefinements([bucket([], [], ['Jane\\C.cr2', 'Jane\\D.cr2'])], new Map([['Jane/C.cr2', { eventTypes: ['Z'], additionalKeywords: [] }]]));
  const all = r.value.flatMap(b => b.relPaths);
  assert.deepEqual(all.sort(), ['Jane/C.cr2', 'Jane/D.cr2']);
  assert.equal(all.length, new Set(all).size);
});
t('merge: untouched conflicting / malformed / unusable evidence is preserved verbatim; a touched conflict is superseded', () => {
  const existing = [bucket(['Z'], [], ['a/c.cr2']), bucket([], [], ['a/c.cr2']), { eventTypes: null, relPaths: ['a/m.cr2'] }, bucket([], [], ['a/ok.cr2', '../junk'])];
  const r = I.mergeTagRefinements(existing, new Map([['a/new.cr2', EMPTY]]));
  const p = I._parseTagRefinements(r.value);
  assert.match(p.conflicts.get('a/c.cr2'), /conflict/); assert.match(p.conflicts.get('a/m.cr2'), /malformed/);
  assert.equal(p.preserve.length, 1);                                       // junk path kept
  assert.deepEqual(p.records.get('a/new.cr2'), EMPTY); assert.deepEqual(p.records.get('a/ok.cr2'), EMPTY);
  const r2 = I.mergeTagRefinements(existing, new Map([['a/c.cr2', { eventTypes: ['W'], additionalKeywords: [] }]]));
  const p2 = I._parseTagRefinements(r2.value);
  assert.equal(p2.conflicts.has('a/c.cr2'), false); assert.deepEqual(p2.records.get('a/c.cr2'), { eventTypes: ['W'], additionalKeywords: [] });
  assert.ok(p2.conflicts.has('a/m.cr2'));
  const r3 = I.mergeTagRefinements(existing, new Map([['a/c.cr2', undefined]]));                 // Default import supersedes the corrupt entry
  assert.equal(I._parseTagRefinements(r3.value).conflicts.has('a/c.cr2'), false);
});
t('merge: a field that cannot be parsed as an array is never rewritten', () => {
  const r = I.mergeTagRefinements('corrupt', new Map([['a/x.cr2', EMPTY]]));
  assert.equal(r.changed, false); assert.equal(r.value, 'corrupt'); assert.match(r.skipped, /field-malformed/);
});
t('merge output is deterministic: same logical state ⇒ identical serialization regardless of history', () => {
  const a = I.mergeTagRefinements(undefined, new Map([['b/2.cr2', EMPTY], ['a/1.cr2', { eventTypes: ['Z'], additionalKeywords: [] }], ['c/3.cr2', EMPTY]]));
  const b = I.mergeTagRefinements(undefined, new Map([['c/3.cr2', EMPTY], ['a/1.cr2', { eventTypes: ['Z'], additionalKeywords: [] }], ['b/2.cr2', EMPTY]]));
  assert.equal(JSON.stringify(a.value), JSON.stringify(b.value));
});
t('metadataGroups merge: same semantics, metadataTags [] survives, Default removes', () => {
  const r = I.mergeMetadataGroups([mbucket(['Waaz'], ['a/A.cr2', 'a/B.cr2'])], new Map([['a/C.cr2', []], ['a/B.cr2', undefined]]));
  const p = I._parseMetadataGroups(r.value);
  assert.deepEqual(p.records.get('a/C.cr2'), []); assert.deepEqual(p.records.get('a/A.cr2'), ['Waaz']); assert.equal(p.records.has('a/B.cr2'), false);
});

// ═══ property test: merge vs a plain reference model ═══════════════════════════════════
function prng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let x = Math.imul(seed ^ seed >>> 15, 1 | seed); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; }; }
t('property: 300 random import sequences — matches the model, no relPath in two buckets, explicit-empty never collapses', () => {
  const rnd = prng(20260920);
  const keys = ['Jane/a.cr2', 'Jane/b.cr2', 'Jane/c.jpg', 'John/d.cr2', 'Comp/Ann/e.cr2', 'Comp/Ann/VIDEO/f.mp4'];
  const values = [EMPTY, { eventTypes: ['Ziyarat'], additionalKeywords: [] }, { eventTypes: [], additionalKeywords: ['Quran'] }, { eventTypes: ['Waaz'], additionalKeywords: ['Q', 'C'] }];
  for (let run = 0; run < 300; run++) {
    let doc; const model = new Map();
    for (let step = 0; step < 6; step++) {
      const delta = new Map(); const n = 1 + Math.floor(rnd() * keys.length);
      for (let i = 0; i < n; i++) {
        const k = keys[Math.floor(rnd() * keys.length)];
        const pick = Math.floor(rnd() * (values.length + 1));
        delta.set(k, pick === values.length ? undefined : values[pick]);
      }
      const r = I.mergeTagRefinements(doc, delta);
      if (r.changed) doc = r.value;
      for (const [k, v] of delta) { if (v === undefined) model.delete(k); else model.set(k, v); }
      const parsed = I._parseTagRefinements(doc);
      assert.equal(parsed.conflicts.size, 0); assert.equal(parsed.fieldError, null);
      assert.deepEqual([...parsed.records.keys()].sort(), [...model.keys()].sort());
      for (const [k, v] of model) assert.deepEqual(parsed.records.get(k), v);           // explicit-empty stays {[],[]}, never undefined
      const all = (doc || []).flatMap(b => b.relPaths);
      assert.equal(all.length, new Set(all).size);                                     // no duplicate relPath across buckets
      if (doc) assert.ok(doc.every(b => b.relPaths.length > 0));                        // no empty buckets
    }
  }
});

// ═══ delta from an import ══════════════════════════════════════════════════════════════
const EVDIR = path.join('/arc', 'Coll', 'Ev');
const dest = (...p) => path.join(EVDIR, ...p);
t('delta: copied + same-size-skipped files carry this import\'s intent; Default files delete', () => {
  const groups = [{ id: 0, subEventId: null, files: ['/card/A.cr2', '/card/B.cr2', '/card/C.cr2', '/card/S.cr2'],
    fileTagRefinements: { '/card/B.cr2': { eventTypes: ['Ziyarat'], additionalKeywords: [] }, '/card/C.cr2': { eventTypes: [], additionalKeywords: [] }, '/card/S.cr2': { eventTypes: [], additionalKeywords: [] } } }];
  const d = I.buildImportIntentDelta({ eventFolderPath: EVDIR, groups,
    copiedFiles: [{ src: '/card/A.cr2', dest: dest('J', 'A.cr2') }, { src: '/card/B.cr2', dest: dest('J', 'B.cr2') }, { src: '/card/C.cr2', dest: dest('J', 'C_1.cr2') }],
    skippedFiles: [{ src: '/card/S.cr2', dest: dest('J', 'S.cr2') }] });
  assert.ok(d.refinements.has('J/A.cr2')); assert.equal(d.refinements.get('J/A.cr2'), undefined);          // Default ⇒ delete
  assert.deepEqual(d.refinements.get('J/B.cr2'), { eventTypes: ['Ziyarat'], additionalKeywords: [] });
  assert.deepEqual(d.refinements.get('J/C_1.cr2'), EMPTY);                                                 // keyed by the ACTUAL (collision-renamed) destination
  assert.deepEqual(d.refinements.get('J/S.cr2'), EMPTY);                                                   // same-size skip still records intent (D2)
});
t('delta: group metadataTags (incl. []) become Tier-1 records; null/absent tags do not', () => {
  const groups = [{ id: 1, files: new Set(['/c/a.cr2']), metadataTags: ['Waaz'] }, { id: 2, files: ['/c/b.cr2'], metadataTags: [] }, { id: 3, files: ['/c/c.cr2'], metadataTags: null }];
  const d = I.buildImportIntentDelta({ eventFolderPath: EVDIR, groups, copiedFiles: ['a', 'b', 'c'].map(n => ({ src: `/c/${n}.cr2`, dest: dest('J', `${n}.cr2`) })), skippedFiles: [] });
  assert.deepEqual(d.metaTags.get('J/a.cr2'), ['Waaz']); assert.deepEqual(d.metaTags.get('J/b.cr2'), []);
  assert.equal(d.metaTags.get('J/c.cr2'), undefined); assert.ok(d.metaTags.has('J/c.cr2'));
});
t('delta: no groups payload ⇒ touches nothing; malformed refinement entry ⇒ that key is not touched', () => {
  assert.equal(I.buildImportIntentDelta({ eventFolderPath: EVDIR, groups: undefined, copiedFiles: [{ src: '/a', dest: dest('J', 'a.cr2') }] }).refinements.size, 0);
  const d = I.buildImportIntentDelta({ eventFolderPath: EVDIR, groups: [{ files: ['/c/a.cr2'], fileTagRefinements: { '/c/a.cr2': { eventTypes: 'nope' } } }], copiedFiles: [{ src: '/c/a.cr2', dest: dest('J', 'a.cr2') }] });
  assert.equal(d.refinements.has('J/a.cr2'), false); assert.equal(d.invalid, 1);
});

// ═══ remap (renames) ═══════════════════════════════════════════════════════════════════
t('remap: photographer-folder rename moves both fields\' keys by exact prefix, nothing else', () => {
  const tr = [bucket([], [], ['Old Jane/C.cr2', 'Old Jane\\D.cr2', 'Other/E.cr2', 'Old Janet/F.cr2'])];
  const fn = I.prefixRemapper([{ fromPrefix: 'Old Jane', toPrefix: 'PC01 Jane' }]);
  const r = I.remapTagRefinements(tr, fn); assert.equal(r.changed, true);
  const keys = [...I._parseTagRefinements(r.value).records.keys()].sort();
  assert.deepEqual(keys, ['Old Janet/F.cr2', 'Other/E.cr2', 'PC01 Jane/C.cr2', 'PC01 Jane/D.cr2']);       // "Old Janet" untouched: no fuzzy matching
  const g = I.remapMetadataGroups([mbucket(['Waaz'], ['Comp/Old Jane/A.cr2'])], I.prefixRemapper([{ fromPrefix: 'Comp/Old Jane', toPrefix: 'Comp/PC01 Jane' }]));
  assert.deepEqual(I._parseMetadataGroups(g.value).records.get('Comp/PC01 Jane/A.cr2'), ['Waaz']);
});
t('remap: explicit-empty survives; no-op remap returns the same reference', () => {
  const tr = [bucket([], [], ['A/x.cr2'])];
  const r = I.remapTagRefinements(tr, I.prefixRemapper([{ fromPrefix: 'A', toPrefix: 'B' }]));
  assert.deepEqual(I._parseTagRefinements(r.value).records.get('B/x.cr2'), EMPTY);
  const same = I.remapTagRefinements(tr, I.prefixRemapper([{ fromPrefix: 'Z', toPrefix: 'Y' }]));
  assert.equal(same.changed, false); assert.equal(same.value, tr);
});
t('remap: colliding targets with different intent become a preserved conflict (fail closed), identical merge', () => {
  const tr = [bucket([], [], ['A/x.cr2']), bucket(['Z'], [], ['B/x.cr2'])];
  const r = I.remapTagRefinements(tr, I.prefixRemapper([{ fromPrefix: 'A', toPrefix: 'B' }]));
  assert.match(I._parseTagRefinements(r.value).conflicts.get('B/x.cr2'), /conflict/);
  const ok = I.remapTagRefinements([bucket([], [], ['A/x.cr2']), bucket([], [], ['B/x.cr2'])], I.prefixRemapper([{ fromPrefix: 'A', toPrefix: 'B' }]));
  assert.equal(I._parseTagRefinements(ok.value).conflicts.size, 0);
});
t('remap: exact file pairs (conflict renames)', () => {
  const r = I.remapMetadataGroups([mbucket([], ['J/a.cr2'])], I.exactPairRemapper([{ fromRel: 'J\\a.cr2', toRel: 'J/a_1.cr2' }]));
  assert.deepEqual(I._parseMetadataGroups(r.value).records.get('J/a_1.cr2'), []);
});

// ═══ Local First scoped merge ══════════════════════════════════════════════════════════
t('sync: staging is authoritative ONLY for copied keys; archive-only intent survives; non-copied staging entries are ignored', () => {
  const archive = { tagRefinements: [bucket([], [], ['J/archiveOnly.cr2', 'J/copied.cr2'])], metadataGroups: [mbucket(['Waaz'], ['J/archiveOnly.cr2'])] };
  const staging = { tagRefinements: [bucket(['Z'], [], ['J/copied.cr2', 'J/notCopied.cr2'])], metadataGroups: [mbucket([], ['J/copied.cr2'])] };
  const r = I.syncMergeIntent(archive, staging, [{ fromRel: 'J/copied.cr2', toRel: 'J/copied.cr2' }]);
  const tr = I._parseTagRefinements(r.tagRefinements.value);
  assert.deepEqual(tr.records.get('J/copied.cr2'), { eventTypes: ['Z'], additionalKeywords: [] });        // copied ⇒ staging wins
  assert.deepEqual(tr.records.get('J/archiveOnly.cr2'), EMPTY);                                            // archive-only untouched
  assert.equal(tr.records.has('J/notCopied.cr2'), false);                                                  // staging-only, not copied ⇒ ignored
  const mg = I._parseMetadataGroups(r.metadataGroups.value);
  assert.deepEqual(mg.records.get('J/copied.cr2'), []); assert.deepEqual(mg.records.get('J/archiveOnly.cr2'), ['Waaz']);
});
t('sync: a copied key ABSENT in staging (Default) removes its prior archive record; a non-copied one cannot', () => {
  const archive = { tagRefinements: [bucket([], [], ['J/copied.cr2', 'J/skipped.cr2'])] };
  const r = I.syncMergeIntent(archive, { tagRefinements: [] }, [{ fromRel: 'J/copied.cr2', toRel: 'J/copied.cr2' }]);
  const tr = I._parseTagRefinements(r.tagRefinements.value);
  assert.equal(tr.records.has('J/copied.cr2'), false); assert.deepEqual(tr.records.get('J/skipped.cr2'), EMPTY);
});
t('sync: conflict rename maps the STAGING intent onto the actual archive destination', () => {
  const r = I.syncMergeIntent({}, { tagRefinements: [bucket([], [], ['J/x.cr2'])] }, [{ fromRel: 'J/x.cr2', toRel: 'J/x_1.cr2' }]);
  assert.deepEqual(r.tagRefinements.value, [bucket([], [], ['J/x_1.cr2'])]);
});
t('sync: untrustworthy staging (field error / key conflict) never erases archive intent', () => {
  const archive = { tagRefinements: [bucket([], [], ['J/a.cr2', 'J/b.cr2'])] };
  const bad = I.syncMergeIntent(archive, { tagRefinements: 'garbage' }, [{ fromRel: 'J/a.cr2', toRel: 'J/a.cr2' }]);
  assert.equal(bad.tagRefinements.changed, false); assert.ok(bad.notes.length);
  const stConflict = { tagRefinements: [bucket(['Z'], [], ['J/a.cr2']), bucket([], [], ['J/a.cr2'])] };
  const c = I.syncMergeIntent(archive, stConflict, [{ fromRel: 'J/a.cr2', toRel: 'J/a.cr2' }]);
  assert.equal(c.tagRefinements.changed, false);
});
t('sync: identical intent ⇒ no change (no needless event.json rewrite)', () => {
  const doc = { tagRefinements: [bucket([], [], ['J/a.cr2'])] };
  const r = I.syncMergeIntent(doc, doc, [{ fromRel: 'J/a.cr2', toRel: 'J/a.cr2' }]);
  assert.equal(r.tagRefinements.changed, false); assert.equal(r.metadataGroups.changed, false);
});

console.log(`${passed} passed`);
if (process.exitCode) console.log('SOME TESTS FAILED');
