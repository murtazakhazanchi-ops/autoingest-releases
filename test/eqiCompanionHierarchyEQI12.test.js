'use strict';

// AI-FEAT-064 EQI-1.2 — camera-based photographer suggestions for the companion's Event Dump,
// composed from the EXISTING Q3–Q5 pieces (assessCameras → protectCameraGroups → matchCamera →
// suggestForCameras, retired profiles), and the runtime's read-only registry peek that never
// opens the registry (no Keychain access from the menu bar). Synthetic serials and names only.
// Run: node test/eqiCompanionHierarchyEQI12.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { fileIdentity } = require('../services/cameraIdentityEvidence');
const { assessCameras } = require('../services/cameraAssessmentModel');
const { createKeyring } = require('../services/identityKeyring');
const { createEvent } = require('../services/identityEvents');
const { protectCameraGroups } = require('../services/cameraDeviceIdentity');
const { deriveRegistryState, decisionContext } = require('../services/associationModel');
const { planImportLearning } = require('../services/identityLearningPlan');
const { retiredIds } = require('../services/photographerNameModel');
const P = require('../services/photographerIdentity');
const { suggestForCard } = require('../services/companionPhotographerSuggestion');
const { createEventDumpController } = require('../services/eventDumpCompanion');

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

// ── Fixtures (fake serials, synthetic names) ──────────────────────────────
const F = {
  nikon1: { 'IFD0:Make': 'NIKON CORPORATION', 'IFD0:Model': 'NIKON D750', 'Nikon:SerialNumber': '7000001' },
  nikon2: { 'IFD0:Make': 'NIKON CORPORATION', 'IFD0:Model': 'NIKON D750', 'Nikon:SerialNumber': '7000002' },
  canon1: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS 70D', 'ExifIFD:SerialNumber': 'FAKEC70D0001' },
  modelOnly: { 'IFD0:Make': 'SONY', 'IFD0:Model': 'ILCE-7M3' },
};
const ring = createKeyring([{ keyId: 'local-A', key: Buffer.alloc(32, 0xa1) }]);
const otherRing = createKeyring([{ keyId: 'local-B', key: Buffer.alloc(32, 0xb2) }]);
let idN = 0;
const newId = () => `00000000-0000-4000-8000-${(++idN).toString(16).padStart(12, '0')}`;
let clock = Date.parse('2026-11-01T08:00:00Z');
const tick = () => new Date(clock += 60000).toISOString();
const ev = (type, payload, workflow = 'event-import') => createEvent(type, payload, { origin: { computerId: 'comp-A', operatorId: null, workflow }, at: tick(), newId });
const PH = { alpha: newId(), beta: newId(), gamma: newId() };
const NAMES = { [PH.alpha]: 'Testalpha Bhai', [PH.beta]: 'Testbeta Bhai', [PH.gamma]: 'Testgamma Bhai' };
const LIST = ['Testalpha Bhai', 'Testbeta Bhai', 'Testgamma Bhai', 'Other Person'];

const card = (...tagSets) => {
  const records = tagSets.map((tags, i) => ({ path: `/fake/DCIM/F${i}.JPG`, name: `F${i}.JPG`, type: 'photo', pairKey: null, evidence: null, identity: fileIdentity(tags) }));
  return { records, assessed: assessCameras(records) };
};
const registered = () => Object.entries(NAMES).map(([photographerId, name]) => ev('photographer-registered', { photographerId, name, idOrigin: 'random' }));
function learn(events, tagSets, photographerId, day = '2026-11-01') {
  const c = card(...tagSets);
  const plan = planImportLearning(protectCameraGroups(c.records, c.assessed, ring), deriveRegistryState(events), { photographerId, importId: newId(), day, newDeviceId: newId });
  return [...events, ...plan.events.map(p => ev(p.type, p.payload))];
}
const decide = (events, type, deviceId, photographerId) =>
  [...events, ev(type, { photographerId, deviceId, resolves: decisionContext(deriveRegistryState(events), deviceId, photographerId) }, 'registry')];
const statusSet = (events, photographerId, status) => [...events, ev('photographer-status-set', { photographerId, status, resolves: [] }, 'registry')];
const registry = (events, keyring = ring) => {
  const state = deriveRegistryState(events);
  return { ok: true, keyring, state, retired: retiredIds(events, { state }), shipped: P.bootstrapShippedIds([]), revision: String(events.length) };
};
const onlyDevice = (events) => [...deriveRegistryState(events).devices.keys()][0];
const suggest = (c, reg, listNames = LIST) => suggestForCard({ records: c.records, assessed: c.assessed, registry: reg, listNames });

console.log('eqiCompanionHierarchyEQI12');

// ── Outcomes ──────────────────────────────────────────────────────────────
t('confirmed association → "confirmed" with that one photographer (never a selection)', () => {
  let e = learn(registered(), [F.nikon1], PH.alpha);
  e = decide(e, 'association-confirmed', onlyDevice(e), PH.alpha);
  const s = suggest(card(F.nikon1), registry(e));
  assert.deepEqual(s, { status: 'confirmed', reason: null, candidates: [{ name: 'Testalpha Bhai', basis: 'confirmed' }] });
  assert.ok(!('photographer' in s) && !('selected' in s), 'the result carries no choice');
});

t('observed only (never confirmed) → "observed", labelled not confirmed', () => {
  const e = learn(registered(), [F.nikon1], PH.alpha);
  const s = suggest(card(F.nikon1), registry(e));
  assert.equal(s.status, 'observed');
  assert.deepEqual(s.candidates, [{ name: 'Testalpha Bhai', basis: 'observed' }]);
});

t('shared camera (two photographers) → "multiple", both offered, none chosen', () => {
  let e = learn(registered(), [F.nikon1], PH.alpha, '2026-11-01');
  e = learn(e, [F.nikon1], PH.beta, '2026-11-02');
  const s = suggest(card(F.nikon1), registry(e));
  assert.equal(s.status, 'multiple');
  assert.deepEqual(s.candidates.map(c => c.name).sort(), ['Testalpha Bhai', 'Testbeta Bhai']);
});

t('two cameras on one card pointing at different photographers → "multiple"', () => {
  let e = learn(registered(), [F.nikon1], PH.alpha);
  e = learn(e, [F.canon1], PH.gamma);
  const s = suggest(card(F.nikon1, F.canon1), registry(e));
  assert.equal(s.status, 'multiple');
  assert.deepEqual(s.candidates.map(c => c.name).sort(), ['Testalpha Bhai', 'Testgamma Bhai']);
});

t('unknown: new body, model-only evidence, no camera evidence — nothing asserted', () => {
  const e = learn(registered(), [F.nikon1], PH.alpha);
  assert.deepEqual(suggest(card(F.nikon2), registry(e)), { status: 'unknown', reason: 'camera-not-recognised', candidates: [] });
  // Model-only: the registry's "weak" model usage never names a photographer here.
  const em = learn(registered(), [F.modelOnly], PH.alpha);
  assert.deepEqual(suggest(card(F.modelOnly), registry(em)), { status: 'unknown', reason: 'model-only', candidates: [] });
  assert.equal(suggestForCard({ records: [], assessed: null, registry: registry(e), listNames: LIST }).reason, 'no-camera-evidence');
});

t('unknown: registry not open / unavailable / no key → honest reason, nothing asserted', () => {
  const c = card(F.nikon1);
  assert.deepEqual(suggest(c, { ok: false, reason: 'registry-not-open' }), { status: 'unknown', reason: 'registry-not-open', candidates: [] });
  assert.equal(suggest(c, { ok: false, reason: 'registry-unavailable' }).reason, 'registry-unavailable');
  assert.equal(suggest(c, null).reason, 'registry-not-open');
  const e = decide(learn(registered(), [F.nikon1], PH.alpha), 'association-confirmed', onlyDevice(learn(registered(), [F.nikon1], PH.alpha)), PH.alpha);
  assert.equal(suggest(c, registry(e, null)).reason, 'body-matching-unavailable');
  // A different registry key: the same body cannot be recognised (digests are keyed).
  assert.equal(suggest(c, registry(e, otherRing)).status, 'unknown');
});

t('rejected, retired association and retired profile are never suggested', () => {
  let e = learn(registered(), [F.nikon1], PH.alpha);
  const dev = onlyDevice(e);
  assert.equal(suggest(card(F.nikon1), registry(decide(e, 'association-rejected', dev, PH.alpha))).status, 'unknown');
  assert.equal(suggest(card(F.nikon1), registry(decide(e, 'association-retired', dev, PH.alpha))).status, 'unknown');
  e = decide(e, 'association-confirmed', dev, PH.alpha);
  const r = suggest(card(F.nikon1), registry(statusSet(e, PH.alpha, 'retired')));
  assert.equal(r.status, 'unknown');
  assert.equal(r.candidates.length, 0);
});

t('only names on the photographer list are offered (the companion selects listed names only)', () => {
  let e = learn(registered(), [F.nikon1], PH.alpha);
  e = decide(e, 'association-confirmed', onlyDevice(e), PH.alpha);
  assert.deepEqual(suggest(card(F.nikon1), registry(e), ['Other Person']), { status: 'unknown', reason: 'photographer-not-in-list', candidates: [] });
  // Case / spacing differences still map to the list's own spelling.
  assert.equal(suggest(card(F.nikon1), registry(e), ['testalpha  bhai']).candidates[0].name, 'testalpha  bhai');
});

t('card switching: each card is judged on its own cameras only', () => {
  let e = learn(registered(), [F.nikon1], PH.alpha);
  e = decide(e, 'association-confirmed', onlyDevice(e), PH.alpha);
  e = learn(e, [F.canon1], PH.gamma);
  const reg = registry(e);
  assert.equal(suggest(card(F.nikon1), reg).candidates[0].name, 'Testalpha Bhai');
  assert.equal(suggest(card(F.canon1), reg).candidates[0].name, 'Testgamma Bhai');
  assert.equal(suggest(card(F.nikon2), reg).status, 'unknown');
});

t('the result never carries identifiers, digests, device IDs or file paths', () => {
  let e = learn(registered(), [F.nikon1], PH.alpha);
  e = decide(e, 'association-confirmed', onlyDevice(e), PH.alpha);
  const out = JSON.stringify(suggest(card(F.nikon1), registry(e)));
  assert.ok(!/7000001|[0-9a-f]{64}|00000000-0000|\/fake\//.test(out), out);
});

// ── No Keychain from the menu bar ─────────────────────────────────────────
t('peekOpenRegistry never opens the registry: no store / not ready → registry-not-open, no open() call', () => {
  const rt = require('../services/photographerLearningRuntime');
  rt._forTests.useStore(null);
  assert.deepEqual(rt.peekOpenRegistry(), { ok: false, reason: 'registry-not-open' });
  let opened = 0, keyReads = 0;
  const closed = { getStatus: () => ({ state: 'closed' }), open: async () => { opened++; }, getKeyring: () => { keyReads++; return null; }, getEvents: () => [], deriveState: () => null };
  rt._forTests.useStore(closed);
  assert.deepEqual(rt.peekOpenRegistry(), { ok: false, reason: 'registry-not-open' });
  assert.equal(opened, 0, 'never opens (opening would read the key through the Keychain)');
  assert.equal(keyReads, 0);
  rt._forTests.useStore(null);
});

t('peekOpenRegistry uses an already-open store, caches per revision, and never throws', () => {
  const rt = require('../services/photographerLearningRuntime');
  let e = learn(registered(), [F.nikon1], PH.alpha);
  e = decide(e, 'association-confirmed', onlyDevice(e), PH.alpha);
  let derives = 0;
  const ready = { getStatus: () => ({ state: 'ready' }), open: async () => { throw new Error('must not open'); }, getKeyring: () => ring,
    getEvents: () => e.slice(), deriveState: () => { derives++; return deriveRegistryState(e); } };
  rt._forTests.useStore(ready);
  const a = rt.peekOpenRegistry(), b = rt.peekOpenRegistry();
  assert.equal(a.ok, true); assert.equal(a.keyring, ring); assert.equal(a, b); assert.equal(derives, 1, 'cached while the registry is unchanged');
  assert.equal(suggestForCard({ ...card(F.nikon1), registry: a, listNames: LIST }).status, 'confirmed');
  rt._forTests.useStore({ getStatus: () => { throw new Error('boom'); } });
  assert.deepEqual(rt.peekOpenRegistry(), { ok: false, reason: 'registry-unavailable' });
  rt._forTests.useStore(null);
});

t('static: the suggestion module and the companion never touch secure storage or open the registry', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  for (const f of ['services/companionPhotographerSuggestion.js', 'services/companionService.js', 'services/eventDumpCompanion.js', 'renderer/companion/companion.js']) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.ok(!/safeStorage|identityKeyStore|electronSecureStorage|openRegistryForManagement|_sharedStore|\.open\(\s*\{\s*initialize/.test(src), f);
  }
  const peek = read('services/photographerLearningRuntime.js').split('function peekOpenRegistry')[1].split('\nfunction ')[0];
  assert.ok(!/\.open\(|_sharedStore|safeStorage|inspectRegistryFiles/.test(peek), 'peek only reads the in-memory store');
});

// ── Event labels for the selected-event panel ─────────────────────────────
t('controller: event types and places are kept as bounded plain labels; the event name is unchanged', () => {
  const c = createEventDumpController({ handoff: { getActive: () => null }, getCard: () => null, verifyJob: async () => null, classify: () => 'selected',
    selectionFor: () => ({}), isImported: () => false, listPhotographers: () => [], isBusy: () => false, pushSnapshot: () => {}, showPopup: () => {}, hidePopup: () => {} });
  const name = '1448-05-14 _01-Urs Mubarak-Majlis-Waaz-Raudat Tahera-Testcity';
  c.onWorkspaceEvent({ eventPath: `/Arc/C/${name}`, eventName: name, collectionName: 'C', types: ['Majlis', 'Waaz', 42, '', 'x'.repeat(200)], places: ['Raudat Tahera, Testcity'] });
  const g = c.globalView().event;
  assert.equal(g.eventName, name);
  assert.deepEqual(g.types, ['Majlis', 'Waaz', 'x'.repeat(80)]);
  assert.deepEqual(g.places, ['Raudat Tahera, Testcity']);
  c.onWorkspaceEvent({ eventPath: `/Arc/C/${name}`, eventName: name, types: 'Majlis' });
  assert.deepEqual(c.globalView().event.types, []);
});

console.log(`\n${passed} passed`);
