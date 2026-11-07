'use strict';

// Regression tests for the "Creator becomes a QMZ sequence code" bug class: once photos
// pass through QMZ (moves/sorting/sequencing), a later metadata run (routine update,
// Reapply, Repair, restart-resume) must resolve the REAL photographer — never a QMZ
// sequence code, `_Unsequenced`, or `Enroute` — and when no real photographer can be
// found at all, it must leave existing Creator/Artist/By-line untouched rather than
// guessing or clearing them.
// Pure logic — no Electron, no ExifTool, no filesystem.
// Run with: node test/qmzCreatorAttributionFix.test.js

const assert = require('node:assert/strict');
const path   = require('node:path');

const { buildFileEvidence, buildEventEvidenceContext, resolvePhotographerFromPath, PHOTOGRAPHER_UNRESOLVED_QMZ } =
  require('../services/eventEvidenceReconstruction');
const { resolveExpectedMetadata } = require('../services/metadataExpectationService');
const exifService = require('../main/exifService');

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}
console.log('qmzCreatorAttributionFix');

const EV = path.join('/arc', 'Coll', 'Event');
const at = (...p) => path.join(EV, ...p);
const comp = (folderName) => ({ folderName, location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyarat'], additionalKeywords: [] });

// ═══ resolvePhotographerFromPath: the shared root-cause fix ════════════════════════════

t('single-component: a bare QMZ sequence folder is never resolved as the photographer — the real photographer one level deeper is used instead', () => {
  const r = resolvePhotographerFromPath(at('01Q', 'M Murtaza Khazanchi', 'photo.jpg'), EV, '');
  assert.deepEqual(r, { photographer: 'M Murtaza Khazanchi', unresolved: false });
});

t('single-component: _Unsequenced and Enroute are treated the same way as a sequence code', () => {
  assert.deepEqual(resolvePhotographerFromPath(at('_Unsequenced', 'Jane Doe', 'a.cr2'), EV, ''), { photographer: 'Jane Doe', unresolved: false });
  assert.deepEqual(resolvePhotographerFromPath(at('Enroute', 'Jane Doe', 'a.cr2'), EV, ''), { photographer: 'Jane Doe', unresolved: false });
});

t('a file sitting DIRECTLY inside a QMZ container, with no photographer sub-folder, is flagged unresolved — never guessed as the container name (the original bug)', () => {
  const r = resolvePhotographerFromPath(at('27Z', 'photo.jpg'), EV, 'Jane Doe');
  assert.deepEqual(r, { photographer: '', unresolved: true }, 'must NOT be "27Z", and must NOT silently fall back to the import-time fallback photographer either');
});

t('an existing PC-prefixed photographer folder inside a QMZ container still resolves to its bare canonical name', () => {
  const r = resolvePhotographerFromPath(at('01Q', 'PC01-Jane Doe', 'a.cr2'), EV, '');
  assert.deepEqual(r, { photographer: 'Jane Doe', unresolved: false });
});

t('an already-damaged container (mis-renamed with a PC prefix by the pre-fix bug) is still recognized as a container, not guessed as the photographer', () => {
  const r = resolvePhotographerFromPath(at('PC01-01Q', 'M Murtaza Khazanchi', 'a.cr2'), EV, '');
  assert.deepEqual(r, { photographer: 'M Murtaza Khazanchi', unresolved: false });
});

t('ordinary non-QMZ single-component resolution is unchanged — a plain photographer folder resolves exactly as before', () => {
  assert.deepEqual(resolvePhotographerFromPath(at('Jane Doe', 'a.cr2'), EV, ''), { photographer: 'Jane Doe', unresolved: false });
});

t('a file directly at the event root with no sub-folder at all falls back exactly as before (pre-existing behavior, untouched)', () => {
  assert.deepEqual(resolvePhotographerFromPath(at('stray.cr2'), EV, 'Fallback Name'), { photographer: 'Fallback Name', unresolved: false });
});

// ═══ buildFileEvidence / buildEventEvidenceContext: end-to-end through the real evidence path ═══

function singleDoc(extra = {}) {
  return { version: 1, hijriDate: '1448-01-01', eventName: 'Ev', components: [comp('Ziyarat-Hall A')], imports: [{ photographer: 'Jane Doe' }], ...extra };
}

t('buildFileEvidence: a QMZ-sequenced file resolves photographer correctly and carries no diagnostic', () => {
  const ev = buildFileEvidence(EV, singleDoc(), at('01Q', 'M Murtaza Khazanchi', 'photo.jpg'));
  assert.equal(ev.photographer, 'M Murtaza Khazanchi');
  assert.equal(ev.photographerUnresolved, false);
  assert.equal(ev.intentDiagnostics, undefined);
});

t('buildFileEvidence: a file directly inside a QMZ container (no photographer sub-folder) is flagged via intentDiagnostics, photographer is empty (never the container name)', () => {
  const ev = buildFileEvidence(EV, singleDoc(), at('27Z', 'photo.jpg'));
  assert.equal(ev.photographer, '', 'must never be "27Z"');
  assert.equal(ev.photographerUnresolved, true);
  assert.deepEqual(ev.intentDiagnostics, [PHOTOGRAPHER_UNRESOLVED_QMZ]);
});

t('buildEventEvidenceContext: per-file photographer/photographerUnresolved carried through for a batch (Reapply/Transfer-verification shape)', () => {
  const { files } = buildEventEvidenceContext(EV, singleDoc(), [
    { src: at('01Q', 'Jane Doe', 'a.cr2'), dest: at('01Q', 'Jane Doe', 'a.cr2') },
    { src: at('27Z', 'b.cr2'), dest: at('27Z', 'b.cr2') },
  ]);
  assert.equal(files[0].photographer, 'Jane Doe'); assert.equal(files[0].photographerUnresolved, false);
  assert.equal(files[1].photographer, '', 'must never be "27Z"'); assert.equal(files[1].photographerUnresolved, true);
});

// ═══ resolveExpectedMetadata: the flag survives into the resolved expectation ══════════

t('resolveExpectedMetadata carries photographerUnresolved through to the expectation the writer consumes', () => {
  const resolved = resolveExpectedMetadata(buildFileEvidence(EV, singleDoc(), at('27Z', 'photo.jpg')));
  assert.equal(resolved.status, 'resolved', 'component still resolves fine — only photographer is in question');
  assert.equal(resolved.photographer, null);
  assert.equal(resolved.photographerUnresolved, true);
});

// ═══ exifService._buildTags / _compareReadback: preserve existing attribution, don't guess ═══

t('_buildTags omits Creator/Artist/By-line entirely when photographerUnresolved — preserves whatever is already on the file instead of clearing it', () => {
  const tags = exifService._buildTags({ photographer: null, photographerUnresolved: true, component: null, keywords: [], hijriDate: null, eventDescription: null, copyright: 'c' }, false);
  assert.ok(!('XMP-dc:Creator' in tags), 'Creator must be entirely absent from the write, not an empty-clearing value');
  assert.ok(!('EXIF:Artist' in tags));
  assert.ok(!('IPTC:By-line' in tags));
});

t('_buildTags still writes Creator/Artist/By-line normally for a resolved photographer (no regression to the ordinary case)', () => {
  const tags = exifService._buildTags({ photographer: 'Jane Doe', photographerUnresolved: false, component: null, keywords: [], hijriDate: null, eventDescription: null, copyright: 'c' }, false);
  assert.deepEqual(tags['XMP-dc:Creator'], ['Jane Doe']);
  assert.equal(tags['EXIF:Artist'], 'Jane Doe');
  assert.equal(tags['IPTC:By-line'], 'Jane Doe');
});

t('_buildTags still writes empty-clearing Creator for the ORDINARY "no photographer at all" case (photographerUnresolved: false, photographer: null) — pre-existing behavior, untouched', () => {
  const tags = exifService._buildTags({ photographer: null, photographerUnresolved: false, component: null, keywords: [], hijriDate: null, eventDescription: null, copyright: 'c' }, false);
  assert.deepEqual(tags['XMP-dc:Creator'], []);
  assert.equal(tags['EXIF:Artist'], '');
  assert.equal(tags['IPTC:By-line'], '');
});

t('_compareReadback skips the photographer check when photographerUnresolved, so an untouched pre-existing Creator is never reported as a mismatch', () => {
  const expectation = { photographer: null, photographerUnresolved: true, component: null, keywords: [], hijriDate: null, eventDescription: '', copyright: 'c' };
  const actual = { Creator: 'Some Existing Photographer', Rights: 'c', Subject: [], Description: '' };
  const cmp = exifService.compareReadback(actual, expectation, false);
  assert.ok(!cmp.mismatches.includes('photographer'), `photographer should not be checked at all: ${cmp.mismatches}`);
});

t('_compareReadback still checks photographer normally when resolved (no regression)', () => {
  const expectation = { photographer: 'Jane Doe', photographerUnresolved: false, component: null, keywords: [], hijriDate: null, eventDescription: '', copyright: 'c' };
  const wrongActual = { Creator: 'Someone Else', Rights: 'c', Subject: [], Description: '' };
  const cmp = exifService.compareReadback(wrongActual, expectation, false);
  assert.ok(cmp.mismatches.includes('photographer'));
});

console.log(`${passed} passed`);
if (process.exitCode) console.log('SOME TESTS FAILED');
