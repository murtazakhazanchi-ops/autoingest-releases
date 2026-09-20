'use strict';

// Unit tests for durable-intent evidence reconstruction — the single path Audit, Repair,
// resume, Reapply and Transfer verification all use. Pure (no Electron / ExifTool).
// Run with: node test/eventEvidenceReconstruction.test.js

const assert = require('node:assert/strict');
const path = require('node:path');
const { buildFileEvidence, buildEventEvidenceContext, resolvePhotographerFromPath, LABEL_DRIFT } = require('../services/eventEvidenceReconstruction');
const { resolveExpectedMetadata } = require('../services/metadataExpectationService');

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}
console.log('eventEvidenceReconstruction');

const EV = path.join('/arc', 'Coll', 'Event');
const at = (...p) => path.join(EV, ...p);
const J = x => JSON.stringify(x);
const EMPTY = { eventTypes: [], additionalKeywords: [] };
const bucket = (et, ak, rel) => ({ eventTypes: et, additionalKeywords: ak, relPaths: rel });
const ctx = ['Hall A', 'Surat', 'India'];

const compOne = { folderName: 'Ziyarat-Hall A', location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyarat'], additionalKeywords: [{ label: 'Quran Tilawat' }] };
const compTwo = { folderName: 'Ziyarat-Waaz-Hall A', location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyarat', 'Waaz'], additionalKeywords: [{ label: 'Quran Tilawat' }] };
const compB = { folderName: 'Waaz-Majlis-Hall B', location: 'Hall B', city: 'Surat', country: 'India', types: ['Waaz', 'Majlis'], additionalKeywords: [{ label: 'Children' }] };
const single = (extra = {}, comp = compOne) => ({ version: 1, hijriDate: '1448-01-01', eventName: 'Ev', components: [comp], imports: [{ photographer: 'Jane Doe' }], ...extra });
const multi = (extra = {}) => ({ version: 1, hijriDate: '1448-01-01', eventName: 'Ev', components: [compOne, compB], imports: [{ photographer: 'Jane Doe' }], ...extra });
const kw = (doc, file) => resolveExpectedMetadata(buildFileEvidence(EV, doc, file));

// ═══ oracle: verbatim ORIGINAL buildFileEvidence (stable 61eba47) ═══════════════════════
const photographerSeqService = require('../services/photographerSequenceService');
function oracleBuildFileEvidence(eventFolderPath, eventJson, filePath) {
  const components = Array.isArray(eventJson?.components) ? eventJson.components : [];
  const isMulti = components.length > 1;
  const imports = Array.isArray(eventJson?.imports) ? eventJson.imports : [];
  const fallbackPhotographer = imports.length > 0 ? (imports[imports.length - 1].photographer || '') : '';
  let component = null; let photographer;
  const rp = (fp, base, fb) => { const rel = path.relative(base, fp); const parts = rel.split(path.sep); const seg = parts.length > 1 ? parts[0] : ''; return photographerSeqService.canonicalName(seg || fb || ''); };
  if (!isMulti) photographer = rp(filePath, eventFolderPath, fallbackPhotographer);
  else {
    component = components.find(c => c.folderName && filePath.startsWith(path.join(eventFolderPath, c.folderName) + path.sep)) || null;
    photographer = component ? rp(filePath, path.join(eventFolderPath, component.folderName), fallbackPhotographer) : fallbackPhotographer;
  }
  const groups = isMulti ? (component ? [{ id: component.folderName, subEventId: component.folderName, files: [filePath] }] : []) : [{ id: 'root', subEventId: null, files: [filePath] }];
  return { filePath, photographer, hijriDate: eventJson?.hijriDate || null, eventDescription: eventJson?.eventName || null, groups, diskComponents: components };
}

t('NO intent fields ⇒ evidence is BYTE-IDENTICAL to the original implementation (single, multi, unresolvable, no imports, junk fields)', () => {
  const docs = [single(), multi(), single({ imports: [] }), multi({ imports: [] }), single({ tagRefinements: [], metadataGroups: [] }), single({ tagRefinements: undefined }), { components: [compOne] }, {}, single({ unrelated: { tagRefinements: 'nested is not the field' } })];
  const files = [at('Jane Doe', 'a.cr2'), at('Jane Doe', 'VIDEO', 'v.mp4'), at('Ziyarat-Hall A', 'Jane Doe', 'b.jpg'), at('Waaz-Majlis-Hall B', 'Ann', 'c.cr2'), at('stray.cr2'), at('Unknown-Comp', 'x', 'd.cr2')];
  for (const d of docs) for (const f of files) assert.equal(J(buildFileEvidence(EV, d, f)), J(oracleBuildFileEvidence(EV, d, f)), `${J(d).slice(0, 60)} / ${f}`);
});
t('NO intent ⇒ resolved metadata equals the original path for the same files (Audit/Repair/resume behavior for unrefined events is unchanged)', () => {
  for (const d of [single(), multi(), single({}, compTwo)]) for (const f of [at('Jane Doe', 'a.cr2'), at('Ziyarat-Hall A', 'Jane Doe', 'b.jpg'), at('stray.cr2')])
    assert.equal(J(resolveExpectedMetadata(buildFileEvidence(EV, d, f))), J(resolveExpectedMetadata(oracleBuildFileEvidence(EV, d, f))));
});

// ═══ Tier 0 ═════════════════════════════════════════════════════════════════════════════
const trDoc = () => single({ tagRefinements: [bucket(['Ziyarat'], [], ['Jane Doe/B.cr2']), bucket([], [], ['Jane Doe/C.cr2'])] });
t('Tier 0: Default / explicit subset / explicit None resolve exactly as intended (resolver is the authority)', () => {
  const d = trDoc();
  assert.deepEqual(kw(d, at('Jane Doe', 'A.cr2')).keywords, ['Ziyarat', 'Quran Tilawat', ...ctx]);
  assert.deepEqual(kw(d, at('Jane Doe', 'B.cr2')).keywords, ['Ziyarat', ...ctx]);
  assert.deepEqual(kw(d, at('Jane Doe', 'C.cr2')).keywords, ctx);
  assert.ok(kw(d, at('Jane Doe', 'C.cr2')).evidenceSource.includes('tagRefinements:explicit-override'));
});
t('explicit-empty attaches an EMPTY record; absence attaches nothing (the invariant, at reconstruction)', () => {
  const d = trDoc();
  const g = f => buildFileEvidence(EV, d, f).groups[0];
  assert.deepEqual(g(at('Jane Doe', 'C.cr2')).fileTagRefinements[path.normalize(at('Jane Doe', 'C.cr2'))], EMPTY);
  assert.equal('fileTagRefinements' in g(at('Jane Doe', 'A.cr2')), false);
  assert.equal('metadataTags' in g(at('Jane Doe', 'A.cr2')), false);
});
t('historical Windows-separator records and NFD names still match the file', () => {
  const d = single({ tagRefinements: [bucket([], [], ['Jane Doe\\C.cr2', 'Zoë\\D.cr2'.normalize('NFD')])] });
  assert.deepEqual(kw(d, at('Jane Doe', 'C.cr2')).keywords, ctx);
  assert.deepEqual(kw(d, at('Zoë', 'D.cr2'.normalize('NFC'))).keywords.filter(k => k === 'Ziyarat'), []);
});
t('multi-component: refinements apply per component file and resolve to that component\'s tags', () => {
  const d = multi({ tagRefinements: [bucket(['Waaz'], [], ['Waaz-Majlis-Hall B/Ann/B2.cr2']), bucket([], [], ['Ziyarat-Hall A/Jane Doe/C1.cr2'])] });
  assert.deepEqual(kw(d, at('Waaz-Majlis-Hall B', 'Ann', 'B2.cr2')).keywords, ['Waaz', 'Hall B', 'Surat', 'India']);
  assert.deepEqual(kw(d, at('Waaz-Majlis-Hall B', 'Ann', 'A2.cr2')).keywords, ['Waaz', 'Majlis', 'Children', 'Hall B', 'Surat', 'India']);
  assert.deepEqual(kw(d, at('Ziyarat-Hall A', 'Jane Doe', 'C1.cr2')).keywords, ctx);
});
t('EVENT_SCOPE-style single-component records need no group/scope info — the key alone is enough', () => {
  const d = single({ tagRefinements: [bucket(['Ziyarat'], ['Quran Tilawat'], ['Jane Doe/all.cr2'])] });
  assert.deepEqual(kw(d, at('Jane Doe', 'all.cr2')).keywords, ['Ziyarat', 'Quran Tilawat', ...ctx]);
});

// ═══ Tier 1 + precedence ═══════════════════════════════════════════════════════════════
t('Tier 1: metadataGroups tags apply; metadataTags [] is an EXPLICIT record (suppresses Event Type), not absence', () => {
  const d = single({ metadataGroups: [{ metadataTags: ['Waaz'], relPaths: ['Jane Doe/A.cr2'] }, { metadataTags: [], relPaths: ['Jane Doe/Z.cr2'] }] }, compTwo);
  assert.deepEqual(kw(d, at('Jane Doe', 'A.cr2')).keywords, ['Waaz', 'Quran Tilawat', ...ctx]);
  assert.deepEqual(kw(d, at('Jane Doe', 'Z.cr2')).keywords, ['Quran Tilawat', ...ctx]);
  const oneType = single({ metadataGroups: [{ metadataTags: [], relPaths: ['Jane Doe/Z.cr2'] }] });
  assert.deepEqual(kw(oneType, at('Jane Doe', 'Z.cr2')).keywords, ['Quran Tilawat', ...ctx]);                  // explicit [] removed Ziyarat…
  assert.deepEqual(kw(oneType, at('Jane Doe', 'Other.cr2')).keywords, ['Ziyarat', 'Quran Tilawat', ...ctx]);    // …while absence keeps the default
});
t('precedence (resolver-owned): per-photo refinement > metadataGroups > component default', () => {
  const d = single({ tagRefinements: [bucket(['Ziyarat'], [], ['Jane Doe/B.cr2'])], metadataGroups: [{ metadataTags: ['Waaz'], relPaths: ['Jane Doe/A.cr2', 'Jane Doe/B.cr2'] }] }, compTwo);
  assert.deepEqual(kw(d, at('Jane Doe', 'C.cr2')).keywords, ['Quran Tilawat', ...ctx]);                       // 3. default: ambiguous ⇒ no Event Type
  assert.deepEqual(kw(d, at('Jane Doe', 'A.cr2')).keywords, ['Waaz', 'Quran Tilawat', ...ctx]);               // 2. legacy MetaPicker
  assert.deepEqual(kw(d, at('Jane Doe', 'B.cr2')).keywords, ['Ziyarat', ...ctx]);                             // 1. refinement wins
});

// ═══ fail closed ═══════════════════════════════════════════════════════════════════════
const integrityCases = {
  'conflicting duplicate refinements': single({ tagRefinements: [bucket(['Ziyarat'], [], ['Jane Doe/X.cr2']), bucket([], [], ['Jane Doe/X.cr2'])] }),
  'malformed refinement record (arrays missing)': single({ tagRefinements: [{ relPaths: ['Jane Doe/X.cr2'] }] }),
  'malformed metadataGroups record': single({ metadataGroups: [{ metadataTags: 'Waaz', relPaths: ['Jane Doe/X.cr2'] }] }),
  'conflicting metadataGroups': single({ metadataGroups: [{ metadataTags: ['Waaz'], relPaths: ['Jane Doe/X.cr2'] }, { metadataTags: [], relPaths: ['Jane Doe/X.cr2'] }] }),
};
t('D3: malformed / conflicting records ⇒ ambiguous, NEVER Default keywords', () => {
  for (const [name, d] of Object.entries(integrityCases)) {
    const r = kw(d, at('Jane Doe', 'X.cr2'));
    assert.equal(r.status, 'ambiguous', name); assert.match(r.ambiguityReason, /record-(malformed|conflict)/, name);
    assert.deepEqual(r.keywords, [], name);                                                                    // no keywords ⇒ nothing for Repair/Reapply to write
    assert.ok(r.evidenceSource.includes('intent:integrity-error'));
  }
});
t('D3: only the affected file fails closed — unaffected files in the same event resolve normally', () => {
  const d = integrityCases['conflicting duplicate refinements'];
  assert.equal(kw(d, at('Jane Doe', 'Other.cr2')).status, 'resolved');
  assert.deepEqual(kw(d, at('Jane Doe', 'Other.cr2')).keywords, ['Ziyarat', 'Quran Tilawat', ...ctx]);
});
t('D3: a field that is not an array (or an unattributable bucket) fails every file in the event closed', () => {
  for (const d of [single({ tagRefinements: 'garbage' }), single({ metadataGroups: { a: 1 } }), single({ tagRefinements: [null] })])
    assert.equal(kw(d, at('Jane Doe', 'A.cr2')).status, 'ambiguous');
});
t('D3: the resolver hook is inert for every existing evidence shape (no group carries intentIntegrityError)', () => {
  const r = resolveExpectedMetadata({ filePath: '/x/a.cr2', groups: [{ id: 'root', subEventId: null, files: ['/x/a.cr2'] }], diskComponents: [compOne] });
  assert.equal(r.status, 'resolved');
});

// ═══ D4 vocabulary drift ═══════════════════════════════════════════════════════════════
t('D4: a persisted label the component no longer offers is HONORED verbatim and reported as advisory drift', () => {
  const d = single({ tagRefinements: [bucket(['Ziyarat', 'Old Renamed Type'], ['Retired Keyword'], ['Jane Doe/B.cr2'])] });
  const before = J(d);
  const ev = buildFileEvidence(EV, d, at('Jane Doe', 'B.cr2'));
  assert.deepEqual(ev.intentDiagnostics, [LABEL_DRIFT]);
  assert.equal(LABEL_DRIFT, 'tagRefinements:label-not-in-component');
  const r = resolveExpectedMetadata(ev);
  assert.equal(r.status, 'resolved');
  assert.deepEqual(r.keywords, ['Ziyarat', 'Old Renamed Type', 'Retired Keyword', ...ctx]);               // not deleted, not converted to Default, not remapped
  assert.equal(J(d), before);                                                                             // the record is never mutated
});
t('D4: no drift diagnostic when labels are valid; none for Default files; explicit-empty has nothing to drift', () => {
  const d = trDoc();
  assert.equal(buildFileEvidence(EV, d, at('Jane Doe', 'B.cr2')).intentDiagnostics, undefined);
  assert.equal(buildFileEvidence(EV, d, at('Jane Doe', 'C.cr2')).intentDiagnostics, undefined);
  assert.equal(buildFileEvidence(EV, d, at('Jane Doe', 'A.cr2')).intentDiagnostics, undefined);
});
t('D4: drift is judged against the file\'s OWN component (multi-component)', () => {
  const d = multi({ tagRefinements: [bucket(['Waaz'], [], ['Ziyarat-Hall A/Jane Doe/x.cr2'])] });      // Waaz is not a Ziyarat-Hall A tag
  assert.deepEqual(buildFileEvidence(EV, d, at('Ziyarat-Hall A', 'Jane Doe', 'x.cr2')).intentDiagnostics, [LABEL_DRIFT]);
});

// ═══ buildEventEvidenceContext + PARITY ════════════════════════════════════════════════
function contextEvidence(context, file) {                                                     // mirrors exifService._buildEvidence
  return { filePath: file.src, photographer: file.photographer, hijriDate: context.hijriDate, eventDescription: context.eventDescription, groups: context.groups, diskComponents: context.diskComponents };
}
const parityFiles = {
  single: [at('Jane Doe', 'A.cr2'), at('Jane Doe', 'B.cr2'), at('Jane Doe', 'C.cr2'), at('Jane Doe', 'X.cr2'), at('Ann', 'M1.jpg'), at('Ann', 'VIDEO', 'v.mp4')],
  multi: [at('Ziyarat-Hall A', 'Jane Doe', 'A1.cr2'), at('Ziyarat-Hall A', 'Jane Doe', 'C1.cr2'), at('Waaz-Majlis-Hall B', 'Ann', 'B2.cr2'), at('Waaz-Majlis-Hall B', 'Ann', 'A2.cr2'), at('Loose', 'stray.cr2')],
};
const parityDocs = [
  ['single, no intent', single(), 'single'], ['multi, no intent', multi(), 'multi'],
  ['single, refinements', trDoc(), 'single'],
  ['single, metadataGroups + refinements', single({ tagRefinements: [bucket(['Ziyarat'], [], ['Jane Doe/B.cr2'])], metadataGroups: [{ metadataTags: ['Waaz'], relPaths: ['Jane Doe/A.cr2', 'Jane Doe/B.cr2', 'Ann/M1.jpg'] }, { metadataTags: [], relPaths: ['Jane Doe/C.cr2'] }] }, compTwo), 'single'],
  ['single, conflict', single({ tagRefinements: [bucket(['Ziyarat'], [], ['Jane Doe/X.cr2']), bucket([], [], ['Jane Doe/X.cr2'])] }), 'single'],
  ['single, corrupt field', single({ metadataGroups: 'x' }), 'single'],
  ['multi, refinements', multi({ tagRefinements: [bucket(['Waaz'], [], ['Waaz-Majlis-Hall B/Ann/B2.cr2']), bucket([], [], ['Ziyarat-Hall A/Jane Doe/C1.cr2'])] }), 'multi'],
];
t('PARITY: buildEventEvidenceContext resolves EVERY file identically to per-file buildFileEvidence (Tier 0, Tier 1, defaults, ambiguity, fail-closed)', () => {
  for (const [name, doc, kind] of parityDocs) {
    const files = parityFiles[kind].map(f => ({ src: f, dest: f }));
    const { context, files: out } = buildEventEvidenceContext(EV, doc, files);
    for (const f of out) {
      const viaContext = resolveExpectedMetadata(contextEvidence(context, f));
      const viaFile = resolveExpectedMetadata(buildFileEvidence(EV, doc, f.dest));
      assert.equal(J(viaContext), J(viaFile), `${name}: ${f.dest}`);
    }
  }
});
t('context: groups compact by (component, Tier-1 tags, integrity); files carry photographers; unresolvable multi files have no group', () => {
  const doc = parityDocs[3][1];
  const { context, files } = buildEventEvidenceContext(EV, doc, parityFiles.single.map(f => ({ src: f, dest: f })));
  assert.ok(context.groups.length <= 4);                                                                    // none / ['Waaz'] / [] / integrity — not one group per file
  assert.equal(files.find(f => f.dest.endsWith('M1.jpg')).photographer, 'Ann');
  const m = buildEventEvidenceContext(EV, multi(), parityFiles.multi.map(f => ({ src: f, dest: f })));
  assert.equal(m.context.groups.flatMap(g => g.files).some(f => f.endsWith('stray.cr2')), false);
  assert.equal(resolveExpectedMetadata(contextEvidence(m.context, m.files.find(f => f.dest.endsWith('stray.cr2')))).status, 'ambiguous');
  assert.equal(m.context.eventJsonPath, path.join(EV, 'event.json'));
});
t('context: works with an empty file list and keeps event-level facts (components, fallback photographer)', () => {
  const { context, files } = buildEventEvidenceContext(EV, single(), []);
  assert.deepEqual(files, []); assert.equal(context.photographer, 'Jane Doe'); assert.equal(context.diskComponents.length, 1); assert.deepEqual(context.groups, []);
});
t('context: explicit-empty refinement and Tier-1 [] survive compaction', () => {
  const { context } = buildEventEvidenceContext(EV, trDoc(), [{ src: at('Jane Doe', 'C.cr2'), dest: at('Jane Doe', 'C.cr2') }]);
  assert.deepEqual(Object.values(context.groups[0].fileTagRefinements)[0], EMPTY);
  const m = buildEventEvidenceContext(EV, single({ metadataGroups: [{ metadataTags: [], relPaths: ['Jane Doe/Z.cr2'] }] }), [{ src: at('Jane Doe', 'Z.cr2'), dest: at('Jane Doe', 'Z.cr2') }]);
  assert.deepEqual(m.context.groups[0].metadataTags, []);
});

// ═══ performance ═══════════════════════════════════════════════════════════════════════
t('PERF: 2000 files / 400 records — index built once, per-file lookup O(1); reconstruct + resolve well inside budget', () => {
  const N = 2000; const rel = i => `Jane Doe/IMG_${String(i).padStart(4, '0')}.cr2`;
  const refined = []; const empties = [];
  for (let i = 0; i < N; i += 10) refined.push(rel(i));
  for (let i = 5; i < N; i += 10) empties.push(rel(i));
  const doc = single({ tagRefinements: [bucket(['Ziyarat'], [], refined), bucket([], [], empties)], metadataGroups: [{ metadataTags: ['Waaz'], relPaths: Array.from({ length: 200 }, (_, i) => rel(i * 10 + 1)) }] });
  const files = Array.from({ length: N }, (_, i) => at(...rel(i).split('/')));
  const t0 = process.hrtime.bigint();
  let n = 0; for (const f of files) { resolveExpectedMetadata(buildFileEvidence(EV, doc, f)); n++; }
  const perFileMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const t1 = process.hrtime.bigint();
  const { context, files: out } = buildEventEvidenceContext(EV, doc, files.map(f => ({ src: f, dest: f })));
  const ctxMs = Number(process.hrtime.bigint() - t1) / 1e6;
  console.log(`      [perf] buildFileEvidence+resolve ×${n}: ${perFileMs.toFixed(1)} ms | buildEventEvidenceContext(${out.length}): ${ctxMs.toFixed(1)} ms`);
  assert.ok(perFileMs < 3000, `per-file path too slow: ${perFileMs}ms`); assert.ok(ctxMs < 1500, `context path too slow: ${ctxMs}ms`);
  // baseline for comparison: the ORIGINAL evidence builder (no intent) over the same files
  const t2 = process.hrtime.bigint(); for (const f of files) resolveExpectedMetadata(oracleBuildFileEvidence(EV, single(), f));
  console.log(`      [perf] original evidence path (no intent) ×${N}: ${(Number(process.hrtime.bigint() - t2) / 1e6).toFixed(1)} ms`);
  assert.equal(context.groups.reduce((a, g) => a + g.files.length, 0), N);
});

console.log(`${passed} passed`);
if (process.exitCode) console.log('SOME TESTS FAILED');
