'use strict';

// AI-FEAT-063 / AI-RM-014 Q4a — pure photographer & camera identity and learning foundation:
// keyed identifier digests, photographer IDs over the existing name list, camera device
// matching, the append-only event schema, association derivation, suggestion rules and
// offline merge planning. Pure Node; no Electron, no files written, no real keys.
//
// Camera evidence goes through the REAL Q3 pipeline (fileIdentity → assessCameras) from
// grouped tag sets. Every serial and every photographer below is FAKE; keys are fixed test bytes.
//
// Run: node test/photographerCameraLearningQ4a.test.js

const assert = require('node:assert/strict');
const util = require('node:util');
const { fileIdentity } = require('../services/cameraIdentityEvidence');
const { assessCameras } = require('../services/cameraAssessmentModel');
const { createKeyring } = require('../services/identityKeyring');
const P = require('../services/photographerIdentity');
const { createEvent, validateEvent } = require('../services/identityEvents');
const { protectCameraGroups, matchCamera } = require('../services/cameraDeviceIdentity');
const { deriveRegistryState, decisionContext, linkContext } = require('../services/associationModel');
const { planImportLearning } = require('../services/identityLearningPlan');
const { suggestForCamera, suggestForCameras } = require('../services/photographerSuggestion');
const { planMerge } = require('../services/identityMergePlan');

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

// ── Fixtures (fake serials) ──────────────────────────────────────────────────────
const F = {
  canonOrig1: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS 70D', 'ExifIFD:SerialNumber': 'FAKEC70D0001', 'Canon:InternalSerialNumber': 'FKC70I001' },
  canonExif1: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS 70D', 'ExifIFD:SerialNumber': 'FAKEC70D0001' },
  canonInt1: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS 70D', 'Canon:InternalSerialNumber': 'FKC70I001' },
  canonOrig2: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS 70D', 'ExifIFD:SerialNumber': 'FAKEC70D0002', 'Canon:InternalSerialNumber': 'FKC70I002' },
  // Canon internal value that happens to equal body 1's EXIF value: different namespace, never a match.
  canonCrossNs: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS 70D', 'Canon:InternalSerialNumber': 'FAKEC70D0001' },
  canonOtherModelSameSerial: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS 80D', 'ExifIFD:SerialNumber': 'FAKEC70D0001' },
  canonVideoZero: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS 70D', 'ExifIFD:SerialNumber': '000000000000' },
  sonyA: { 'IFD0:Make': 'SONY', 'IFD0:Model': 'ILCE-7M3', 'Sony:InternalSerialNumber': 'FAKESONYA009' },
  sonyB: { 'IFD0:Make': 'SONY', 'IFD0:Model': 'ILCE-7M3', 'Sony:InternalSerialNumber': 'FAKESONYB009' },
  sonyModelOnly: { 'IFD0:Make': 'SONY', 'IFD0:Model': 'ILCE-7M3' },
  nikon: { 'IFD0:Make': 'NIKON CORPORATION', 'IFD0:Model': 'NIKON D750', 'Nikon:SerialNumber': '7000001' },
  nikonConflict: { 'IFD0:Make': 'NIKON CORPORATION', 'IFD0:Model': 'NIKON D750', 'Nikon:SerialNumber': '7000001', 'ExifIFD:SerialNumber': '7000009' },
  iphone: { 'IFD0:Make': 'Apple', 'IFD0:Model': 'iPhone 6' },
  // Never camera identity: owner/artist/copyright/lens serial only.
  notIdentity: { 'IFD0:Artist': 'FAKE OWNER', 'IFD0:Copyright': 'FAKE', 'ExifIFD:LensSerialNumber': 'FAKELENS01', 'ExifIFD:OwnerName': 'FAKE OWNER' },
  stripped: {},
};
const FAKE_SERIALS = [...new Set(Object.values(F).flatMap(o => Object.entries(o).filter(([k]) => /Serial/.test(k)).map(([, v]) => String(v))).filter(v => !/^0+$/.test(v)))];

const KEY_A = Buffer.alloc(32, 0xa1), KEY_B = Buffer.alloc(32, 0xb2), KEY_ORG = Buffer.alloc(32, 0x0c);
const ringA = createKeyring([{ keyId: 'local-A', key: KEY_A }]);
const ringB = createKeyring([{ keyId: 'local-B', key: KEY_B }]);
const ringOrgA = createKeyring([{ keyId: 'local-A', key: KEY_A }, { keyId: 'org-1', key: KEY_ORG }]);
const ringOrgB = createKeyring([{ keyId: 'local-B', key: KEY_B }, { keyId: 'org-1', key: KEY_ORG }]);

// Deterministic IDs and clock.
let idN = 0;
const newId = () => `00000000-0000-4000-8000-${(++idN).toString(16).padStart(12, '0')}`;
let clock = Date.parse('2026-11-01T08:00:00Z');
const tick = () => new Date(clock += 60000).toISOString();

const PH = { alpha: newId(), beta: newId(), gamma: newId() }; // synthetic photographers
const origin = (computerId, workflow = 'event-import') => ({ computerId, operatorId: null, workflow });
const ev = (type, payload, computer = 'comp-A', workflow) => createEvent(type, payload, { origin: origin(computer, workflow), at: tick(), newId });

const card = (...tagSets) => {
  const records = tagSets.map((tags, i) => ({ path: `/fake/DCIM/F${i}.JPG`, name: `F${i}.JPG`, type: 'photo', pairKey: null, evidence: null, identity: fileIdentity(tags) }));
  return { records, result: assessCameras(records) };
};
const protect = (c, ring = ringA) => protectCameraGroups(c.records, c.result, ring);

/** Simulate one committed import on a computer: plan, then append the planned events. */
function learn(events, tagSets, photographerId, { importId = newId(), day = '2026-11-01', computer = 'comp-A', ring = ringA } = {}) {
  const state = deriveRegistryState(events);
  const plan = planImportLearning(protect(card(...tagSets), ring), state, { photographerId, importId, day, newDeviceId: newId });
  return { events: [...events, ...plan.events.map(p => ev(p.type, p.payload, computer))], plan };
}
const decide = (events, type, deviceId, photographerId, computer = 'comp-A', workflow = 'registry') => {
  const state = deriveRegistryState(events);
  return [...events, ev(type, { photographerId, deviceId, resolves: decisionContext(state, deviceId, photographerId) }, computer, workflow)];
};
const onlyDevice = (events) => { const s = deriveRegistryState(events); assert.equal(s.devices.size >= 1, true); return [...s.devices.keys()]; };
const assoc = (s, d, p) => s.associations.get(`${s.deviceCanonical(d)}|${s.photographerCanonical(p)}`);
const toJson = (x) => JSON.stringify(x, (_k, val) => (val instanceof Map ? Object.fromEntries(val) : val instanceof Set ? [...val] : typeof val === 'function' ? undefined : val));

console.log('Q4a — identity keyring');
t('digests are keyed, per namespace and per make; keys never serialise', () => {
  const d1 = ringA.digest('local-A', 'exif.bodySerial', 'Canon', 'FAKEC70D0001');
  assert.match(d1, /^[0-9a-f]{64}$/);
  assert.equal(d1, ringA.digest('local-A', 'exif.bodySerial', 'Canon', ' fakec70d0001 '), 'value normalised');
  assert.notEqual(d1, ringA.digest('local-A', 'canon.internal', 'Canon', 'FAKEC70D0001'), 'namespaces never equal');
  assert.notEqual(d1, ringA.digest('local-A', 'exif.bodySerial', 'Sony', 'FAKEC70D0001'), 'make is part of the digest');
  assert.notEqual(d1, ringB.digest('local-B', 'exif.bodySerial', 'Canon', 'FAKEC70D0001'), 'different keys → unrelated digests');
  assert.deepEqual(ringOrgA.digestAll('exif.bodySerial', 'Canon', 'X1234').map(x => x.keyId), ['local-A', 'org-1']);
  const shown = JSON.stringify(ringA) + util.inspect(ringA);
  assert.ok(!shown.includes(KEY_A.toString('hex')) && !shown.includes(KEY_A.toString('base64')));
  assert.throws(() => createKeyring([{ keyId: 'shrt-key', key: Buffer.alloc(16) }]), /at least 32/);
  assert.throws(() => createKeyring([]), /at least one key/);
  assert.throws(() => ringA.digest('nope', 'exif.bodySerial', 'Canon', 'X'), /unknown keyId/);
});

console.log('Q4a — photographer identities');
t('shipped entries get deterministic bootstrap IDs; the real shipped list has no duplicates', () => {
  const a = P.shippedPhotographerId('Test Person One');
  assert.equal(a, P.shippedPhotographerId('  test   person-one '), 'same normalised name on every computer');
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const shipped = require('../data/photographers.json');
  const boot = P.bootstrapShippedIds(shipped);
  assert.equal(boot.byId.size, shipped.length);
  assert.deepEqual(boot.problems, []);
  const dup = P.bootstrapShippedIds(['Test Person', 'test-person', 'Other Person']);
  assert.equal(dup.byId.size, 1, 'two shipped names that normalise alike get no deterministic ID');
  assert.equal(dup.problems[0].kind, 'duplicate-shipped-name');
});
t('new photographers get immutable random v4 IDs', () => {
  const a = P.newPhotographerId(), b = P.newPhotographerId();
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4/);
  assert.throws(() => P.newPhotographerId(() => 'not-a-uuid'), /invalid UUID/);
});
t('pre-save collision check: names and former names block; aliases are hints only', () => {
  const ctx = {
    listNames: ['Test Alpha', 'Test Beta Person', 'Sample Gamma'],
    aliases: { 'test-alpha': ['ta', 'tbp'], 'test-beta-person': ['tbp'] },
    photographers: [{ photographerId: PH.alpha, name: 'Test Alpha', formerNames: ['Old Alpha'] }],
  };
  assert.equal(P.checkNameCollision('  test alpha ', ctx).blocking[0].kind, 'name-exists');
  assert.equal(P.checkNameCollision('Old Alpha', ctx).blocking[0].kind, 'former-name-of-another');
  const hint = P.checkNameCollision('TA', ctx);
  assert.equal(hint.ok, true);
  assert.equal(hint.warnings[0].kind, 'matches-search-alias');
  assert.equal(P.checkNameCollision('tbp', ctx).warnings[0].kind, 'matches-ambiguous-search-alias');
  assert.ok(P.checkNameCollision('Test Alpah', ctx).warnings.some(w => w.kind === 'similar-name' && w.how === 'spelling'));
  assert.ok(P.checkNameCollision('Test Beta', ctx).warnings.some(w => w.kind === 'similar-name' && w.how === 'name-parts'));
  assert.equal(P.checkNameCollision('Old Alpha', { ...ctx, selfPhotographerId: PH.alpha }).ok, true, 'renaming back to your own former name is allowed');
  assert.equal(P.checkNameCollision('', ctx).blocking[0].kind, 'empty-name');
});
t('renames are model-level: ID kept, old name resolves as a former name, concurrent renames conflict', () => {
  let events = [ev('photographer-registered', { photographerId: PH.alpha, name: 'Test Alpha', idOrigin: 'random' })];
  events.push(ev('photographer-renamed', { photographerId: PH.alpha, fromName: 'Test Alpha', toName: 'Test Alpha Senior' }));
  let s = deriveRegistryState(events);
  const rec = s.photographers.get(PH.alpha);
  assert.equal(rec.name, 'Test Alpha Senior');
  assert.deepEqual(rec.formerNames, ['Test Alpha']);
  const recs = [...s.photographers.values()];
  assert.deepEqual(P.resolvePhotographerName('test alpha', { photographers: recs }), { photographerIds: [PH.alpha], via: 'former-name', ambiguous: false });
  events.push(ev('photographer-renamed', { photographerId: PH.alpha, fromName: 'Test Alpha', toName: 'T. Alpha' }, 'comp-B'));
  s = deriveRegistryState(events);
  assert.ok(s.conflicts.some(c => c.kind === 'conflicting-renames' && c.photographerId === PH.alpha));
  const shipped = P.bootstrapShippedIds(['Shipped Person']);
  assert.equal(P.resolvePhotographerName('shipped person', { shipped }).via, 'shipped');
});

console.log('Q4a — events');
t('strict schema: raw serials, file names, card labels and Artist cannot ride in an event', () => {
  const dig = ringA.digest('local-A', 'exif.bodySerial', 'Canon', 'FAKEC70D0001');
  const base = { deviceId: newId(), make: 'Canon', modelKey: 'EOS70D', modelDisplay: 'Canon EOS 70D', identifiers: [{ ns: 'exif.bodySerial', keyId: 'local-A', digest: dig, trusted: true }] };
  assert.ok(ev('device-registered', base));
  assert.throws(() => ev('device-registered', { ...base, identifiers: [{ ...base.identifiers[0], value: 'FAKEC70D0001' }] }), /unexpected field/);
  assert.throws(() => ev('device-registered', { ...base, identifiers: [{ ...base.identifiers[0], digest: 'FAKEC70D0001' }] }), /64 hex/);
  assert.throws(() => ev('device-registered', { ...base, serial: 'FAKEC70D0001' }), /unexpected field serial/);
  for (const k of ['cardLabel', 'fileName', 'artist', 'lensSerial']) {
    assert.throws(() => ev('import-observed', { importId: 'imp-x', photographerId: PH.alpha, deviceId: base.deviceId, fileCount: 1, day: '2026-11-01', [k]: 'X' }), new RegExp(`unexpected field ${k}`));
  }
  assert.throws(() => ev('device-registered', { ...base, identifiers: [{ ...base.identifiers[0], trusted: false }] }), /trusted identifier/);
  assert.throws(() => ev('import-cooccurred', { importId: 'i', photographerId: PH.alpha, cameras: [{ deviceId: base.deviceId, fileCount: 2 }], conflictFiles: 0, day: '2026-11-01' }), /two cameras/);
  assert.equal(validateEvent({ schema: 1, eventId: newId(), type: 'future-thing', at: '2026-11-01T00:00:00Z', origin: origin('comp-A') }).known, false);
});

console.log('Q4a — camera identities');
t('protection boundary: Canon body with two identifiers → one camera, digests only', () => {
  const p = protect(card(F.canonOrig1, F.canonExif1, F.canonInt1));
  assert.equal(p.cameras.length, 1);
  assert.equal(p.cameras[0].kind, 'body');
  assert.deepEqual(p.cameras[0].identifiers.map(i => i.ns), ['canon.internal', 'exif.bodySerial']);
  const json = JSON.stringify(p);
  for (const s of FAKE_SERIALS) assert.ok(!json.includes(s), 'no raw serial');
  assert.ok(!json.includes('/fake/'), 'no paths');
});
t('same body across cards: EXIF-only and internal-only cards match the device the original registered', () => {
  let { events } = learn([], [F.canonOrig1], PH.alpha);
  const [dev] = onlyDevice(events);
  for (const tags of [F.canonExif1, F.canonInt1]) {
    const m = matchCamera(protect(card(tags)).cameras[0], deriveRegistryState(events));
    assert.equal(m.status, 'known');
    assert.equal(m.deviceId, dev);
  }
  // A card whose originals reveal a new identifier for a known body adds it (co-observed), never a new device.
  ({ events } = learn([], [F.canonExif1], PH.alpha));
  const res = learn(events, [F.canonOrig1], PH.alpha);
  assert.deepEqual(res.plan.events.map(e => e.type), ['device-identifiers-added', 'import-observed']);
  assert.equal(deriveRegistryState(res.events).devices.size, 1);
});
t('different bodies of one model stay separate; Canon namespaces never cross', () => {
  let { events } = learn([], [F.canonOrig1], PH.alpha);
  ({ events } = learn(events, [F.canonOrig2], PH.beta));
  assert.equal(deriveRegistryState(events).devices.size, 2);
  const cross = matchCamera(protect(card(F.canonCrossNs)).cameras[0], deriveRegistryState(events));
  assert.equal(cross.status, 'new', 'internal value equal to another body\'s EXIF value is not a match');
});
t('conflicts: model mismatch, identifier on two devices, conflicting files — never assigned', () => {
  const { events } = learn([], [F.canonExif1], PH.alpha);
  const mm = matchCamera(protect(card(F.canonOtherModelSameSerial)).cameras[0], deriveRegistryState(events));
  assert.deepEqual([mm.status, mm.reason], ['conflict', 'model-mismatch']);
  // Computer-local split: EXIF-only and internal-only registered separately, then an original links both.
  let e2 = learn([], [F.canonExif1], PH.alpha).events;
  e2 = learn(e2, [F.canonInt1], PH.alpha).events;
  const s2 = deriveRegistryState(e2);
  assert.equal(s2.devices.size, 2);
  const span = matchCamera(protect(card(F.canonOrig1)).cameras[0], s2);
  assert.deepEqual([span.status, span.reason], ['conflict', 'identifier-spans-devices']);
  const nik = protect(card(F.nikonConflict));
  assert.equal(nik.cameras.length, 0);
  assert.equal(nik.conflictFiles, 1);
  assert.equal(suggestForCamera(s2, { kind: 'conflict' }).level, 'none');
});
t('explicit device link resolves a split body; a "different" decision keeps them apart', () => {
  let e = learn([], [F.canonExif1], PH.alpha, { day: '2026-11-01' }).events;
  e = learn(e, [F.canonInt1], PH.alpha, { day: '2026-11-02' }).events;
  const [d1, d2] = onlyDevice(e);
  const linked = [...e, ev('device-linked', { deviceIds: [d1, d2], decision: 'same', resolves: [] }, 'comp-A', 'registry')];
  const s = deriveRegistryState(linked);
  assert.equal(s.devices.size, 1);
  assert.equal(matchCamera(protect(card(F.canonOrig1)).cameras[0], s).status, 'known');
  assert.equal(assoc(s, d2, PH.alpha).observedDays, 2, 'observations of both records aggregate on the linked device');
  const apart = deriveRegistryState([...e, ev('device-linked', { deviceIds: [d1, d2], decision: 'different', resolves: [] }, 'comp-A', 'registry')]);
  assert.equal(apart.devices.size, 2);
  // Concurrent opposite link decisions on two computers → disputed, not linked.
  const disputed = deriveRegistryState([...e,
    ev('device-linked', { deviceIds: [d1, d2], decision: 'same', resolves: [] }, 'comp-A', 'registry'),
    ev('device-linked', { deviceIds: [d1, d2], decision: 'different', resolves: [] }, 'comp-B', 'registry')]);
  assert.equal(disputed.devices.size, 2);
  assert.ok(disputed.conflicts.some(c => c.kind === 'device-link-disputed'));
  assert.deepEqual(linkContext(deriveRegistryState(linked), 'device-linked', [d2, d1]).length, 1);
});

console.log('Q4a — learning from imports');
t('an import selection is an observation; three days make it "likely" but never confirmed', () => {
  let e = learn([], [F.sonyA, F.sonyA], PH.alpha, { day: '2026-11-01' }).events;
  const [dev] = onlyDevice(e);
  let s = deriveRegistryState(e);
  assert.equal(assoc(s, dev, PH.alpha).state, 'observed');
  assert.equal(assoc(s, dev, PH.alpha).confirmations, 0);
  assert.equal(suggestForCamera(s, { kind: 'body', deviceId: dev }).level, 'possible');
  e = learn(e, [F.sonyA], PH.alpha, { day: '2026-11-01' }).events; // same day again
  assert.equal(suggestForCamera(deriveRegistryState(e), { kind: 'body', deviceId: dev }).level, 'possible', 'same-day imports do not add days');
  e = learn(e, [F.sonyA], PH.alpha, { day: '2026-11-02' }).events;
  e = learn(e, [F.sonyA], PH.alpha, { day: '2026-11-03' }).events;
  s = deriveRegistryState(e);
  const sug = suggestForCamera(s, { kind: 'body', deviceId: dev });
  assert.equal(sug.level, 'likely');
  assert.equal(sug.preselectable, false);
  assert.equal(sug.candidates[0].basis, 'observed');
  assert.equal(assoc(s, dev, PH.alpha).state, 'observed');
  assert.ok(sug.candidates[0].reasons.some(r => /observed, not confirmed/.test(r)));
});
t('one explicit confirmation of a uniquely identified camera → strong (preselectable, still confirmed by operator)', () => {
  let e = learn([], [F.nikon], PH.alpha).events;
  const [dev] = onlyDevice(e);
  e = decide(e, 'association-confirmed', dev, PH.alpha, 'comp-A', 'import-modal');
  const sug = suggestForCamera(deriveRegistryState(e), { kind: 'body', deviceId: dev });
  assert.equal(sug.level, 'strong');
  assert.equal(sug.preselectable, true);
  assert.equal(sug.candidates[0].basis, 'confirmed');
});
t('mixed-camera import: co-occurrence only — no camera gets an association', () => {
  const res = learn([], [F.canonOrig1, F.sonyA, F.sonyA], PH.alpha);
  assert.equal(res.plan.observation, 'multiple-cameras');
  assert.deepEqual(res.plan.events.map(e => e.type).sort(), ['device-registered', 'device-registered', 'import-cooccurred']);
  const s = deriveRegistryState(res.events);
  for (const dev of s.devices.keys()) {
    assert.equal(assoc(s, dev, PH.alpha).state, null);
    assert.equal(suggestForCamera(s, { kind: 'body', deviceId: dev }).level, 'none');
  }
  const withPhone = learn([], [F.sonyA, F.iphone], PH.alpha);
  assert.equal(withPhone.plan.observation, 'multiple-cameras', 'a phone is another camera');
  const withConflict = learn([], [F.sonyA, F.nikonConflict], PH.alpha);
  assert.equal(withConflict.plan.observation, 'multiple-cameras', 'conflicting files alongside a body block the observation');
  assert.equal(withConflict.plan.events.find(e => e.type === 'import-cooccurred').payload.conflictFiles, 1);
});
t('same-model files without a body serial do not count as another camera, and add nothing', () => {
  const res = learn([], [F.canonOrig1, F.canonVideoZero], PH.alpha);
  assert.equal(res.plan.observation, 'single-body');
  assert.ok(res.plan.outcomes.some(o => o.status === 'ambiguous-same-model'));
});
t('model-only evidence is a weak hint; unknown evidence teaches nothing', () => {
  let e = learn([], [F.sonyModelOnly], PH.alpha, { day: '2026-11-01' }).events;
  for (const d of ['2026-11-02', '2026-11-03', '2026-11-04']) e = learn(e, [F.sonyModelOnly], PH.alpha, { day: d }).events;
  const s = deriveRegistryState(e);
  assert.equal(s.devices.size, 0, 'model-only never creates a device');
  const sug = suggestForCamera(s, { kind: 'model', make: 'Sony', modelKey: fileIdentity(F.sonyModelOnly).model.key });
  assert.equal(sug.level, 'weak');
  assert.equal(sug.preselectable, false);
  assert.equal(sug.candidates[0].basis, 'model');
  const unknown = learn([], [F.stripped, F.notIdentity], PH.alpha);
  assert.deepEqual(unknown.plan.events, []);
  assert.equal(suggestForCamera(s, { kind: 'unknown' }).level, 'none');
});
t('learning inputs exclude names, card labels, file names, lens serials and Artist', () => {
  const state = deriveRegistryState([]);
  const pc = protect(card(F.notIdentity, F.stripped));
  const plan = planImportLearning(pc, state, { photographerId: PH.alpha, importId: 'imp-1', day: '2026-11-01', cardLabel: 'FAKE CARD', artist: 'FAKE OWNER', fileNames: ['F0.JPG'] });
  assert.deepEqual(plan.events, []);
  assert.throws(() => planImportLearning(pc, state, { photographerId: 'Test Alpha', importId: 'imp-1', day: '2026-11-01' }), /UUID/, 'a name is not an identity');
});

console.log('Q4a — shared cameras, corrections, rejections, retirement, disputes');
t('shared camera → alternatives, none chosen, confirmed first', () => {
  let e = learn([], [F.sonyB], PH.alpha, { day: '2026-11-01' }).events;
  const [dev] = onlyDevice(e);
  e = decide(e, 'association-confirmed', dev, PH.alpha);
  e = learn(e, [F.sonyB], PH.beta, { day: '2026-11-02' }).events;
  const sug = suggestForCamera(deriveRegistryState(e), { kind: 'body', deviceId: dev });
  assert.equal(sug.level, 'alternatives');
  assert.equal(sug.preselectable, false);
  assert.deepEqual(sug.candidates.map(c => c.photographerId), [PH.alpha, PH.beta]);
});
t('a correction is recorded, weakens the suggestion and keeps history', () => {
  let e = learn([], [F.sonyA], PH.alpha).events;
  const [dev] = onlyDevice(e);
  e = decide(e, 'association-confirmed', dev, PH.alpha);
  e = [...e, ev('suggestion-corrected', { deviceId: dev, suggestedPhotographerId: PH.alpha, chosenPhotographerId: PH.beta, day: '2026-11-05' }, 'comp-A', 'import-modal')];
  const s = deriveRegistryState(e);
  assert.equal(assoc(s, dev, PH.alpha).state, 'confirmed', 'history is not deleted');
  assert.equal(assoc(s, dev, PH.alpha).correctedAwaySinceConfirm, 1);
  assert.equal(assoc(s, dev, PH.beta).state, 'observed', 'the chosen photographer is observed, not confirmed');
  const sug = suggestForCamera(s, { kind: 'body', deviceId: dev });
  assert.equal(sug.level, 'alternatives');
  assert.ok(sug.candidates.find(c => c.photographerId === PH.alpha).reasons.some(r => /changed by the operator/.test(r)));
  // Single-photographer case: a confirmation contradicted since is no longer strong.
  let e2 = learn([], [F.sonyB], PH.gamma).events;
  const [d2] = onlyDevice(e2);
  e2 = decide(e2, 'association-confirmed', d2, PH.gamma);
  e2 = [...e2, ev('suggestion-corrected', { deviceId: d2, suggestedPhotographerId: PH.gamma, chosenPhotographerId: PH.beta, day: '2026-11-05' })];
  e2 = decide(e2, 'association-rejected', d2, PH.beta); // operator: that one was a one-off
  assert.equal(suggestForCamera(deriveRegistryState(e2), { kind: 'body', deviceId: d2 }).level, 'possible');
});
t('rejection excludes a photographer even if later observed; reconfirmation restores', () => {
  let e = learn([], [F.nikon], PH.alpha).events;
  const [dev] = onlyDevice(e);
  e = decide(e, 'association-rejected', dev, PH.alpha);
  e = learn(e, [F.nikon], PH.alpha, { day: '2026-11-02' }).events;
  let s = deriveRegistryState(e);
  assert.equal(assoc(s, dev, PH.alpha).state, 'rejected');
  let sug = suggestForCamera(s, { kind: 'body', deviceId: dev });
  assert.equal(sug.level, 'none');
  assert.equal(sug.excluded[0].state, 'rejected');
  e = decide(e, 'association-confirmed', dev, PH.alpha);
  s = deriveRegistryState(e);
  assert.equal(assoc(s, dev, PH.alpha).state, 'confirmed');
  assert.equal(assoc(s, dev, PH.alpha).rejections, 1, 'the rejection stays in history');
});
t('retirement removes a photographer from suggestions without deleting history', () => {
  let e = learn([], [F.sonyA], PH.alpha).events;
  const [dev] = onlyDevice(e);
  e = decide(e, 'association-confirmed', dev, PH.alpha);
  e = decide(e, 'association-retired', dev, PH.alpha);
  const s = deriveRegistryState(e);
  assert.equal(assoc(s, dev, PH.alpha).state, 'retired');
  assert.equal(assoc(s, dev, PH.alpha).confirmations, 1);
  assert.equal(suggestForCamera(s, { kind: 'body', deviceId: dev }).excluded[0].state, 'retired');
});
t('contradictory decisions made offline on two computers → disputed until resolved with knowledge', () => {
  let e = learn([], [F.canonOrig2], PH.alpha).events;
  const [dev] = onlyDevice(e);
  e = [...e,
    ev('association-confirmed', { photographerId: PH.alpha, deviceId: dev, resolves: [] }, 'comp-A', 'registry'),
    ev('association-rejected', { photographerId: PH.alpha, deviceId: dev, resolves: [] }, 'comp-B', 'registry')];
  let s = deriveRegistryState(e);
  assert.equal(assoc(s, dev, PH.alpha).state, 'disputed');
  assert.ok(s.conflicts.some(c => c.kind === 'association-disputed'));
  const sug = suggestForCamera(s, { kind: 'body', deviceId: dev });
  assert.notEqual(sug.level, 'strong');
  assert.equal(sug.preselectable, false);
  e = decide(e, 'association-confirmed', dev, PH.alpha, 'comp-B'); // decided seeing both
  s = deriveRegistryState(e);
  assert.equal(assoc(s, dev, PH.alpha).state, 'confirmed');
  assert.ok(!s.conflicts.some(c => c.kind === 'association-disputed'));
});
t('a card with cameras pointing at different photographers hands off', () => {
  let e = learn([], [F.sonyA], PH.alpha).events;
  e = learn(e, [F.nikon], PH.beta).events;
  const s = deriveRegistryState(e);
  const ids = [...s.devices.values()].map(d => ({ kind: 'body', deviceId: d.deviceId }));
  const res = suggestForCameras(s, ids);
  assert.equal(res.distinctSuggestedPhotographers, 2);
  assert.equal(res.handoff, true);
});

console.log('Q4a — replay and offline merge');
t('derivation is idempotent and order-independent', () => {
  let e = learn([], [F.sonyA], PH.alpha, { day: '2026-11-01' }).events;
  const [dev] = onlyDevice(e);
  e = learn(e, [F.sonyA, F.nikon], PH.beta).events;
  e = decide(e, 'association-confirmed', dev, PH.alpha);
  const summary = (s) => toJson({ p: [...s.photographers.values()], d: [...s.devices.values()], a: [...s.associations.values()], c: s.conflicts });
  const shuffled = [...e, ...e.slice(0, 3)].reverse();
  assert.equal(summary(deriveRegistryState(shuffled)), summary(deriveRegistryState(e)));
});
t('merge is additive, repeatable, order-independent and never removes local records', () => {
  const a = learn([], [F.sonyA], PH.alpha, { computer: 'comp-A', ring: ringOrgA }).events;
  const b = learn([], [F.nikon], PH.beta, { computer: 'comp-B', ring: ringOrgB }).events;
  const ab = planMerge(a, b), ba = planMerge(b, a);
  assert.deepEqual(ab.merged.map(x => x.eventId), ba.merged.map(x => x.eventId));
  for (const x of a) assert.ok(ab.merged.some(y => y.eventId === x.eventId), 'every local event survives');
  assert.equal(ab.summary.added, b.length);
  const again = planMerge(ab.merged, b);
  assert.equal(again.summary.added, 0);
  assert.equal(again.summary.alreadyPresent, b.length);
  const fromEmpty = planMerge(a, []);
  assert.equal(fromEmpty.merged.length, a.length, 'absence from the incoming set removes nothing');
});
t('merge rejects invalid events, keeps local on eventId collisions, flags cloned-origin events, keeps unknown types', () => {
  const a = learn([], [F.sonyA], PH.alpha).events;
  const tampered = { ...a[0], make: 'Other' };
  const bad = { ...a[0], eventId: newId(), identifiers: [{ ns: 'exif.bodySerial', keyId: 'local-A', digest: 'zz', trusted: true }] };
  const future = { schema: 1, eventId: newId(), type: 'future-thing', at: tick(), origin: origin('comp-B') };
  const claimsA = ev('photographer-registered', { photographerId: PH.gamma, name: 'Test Gamma', idOrigin: 'random' }, 'comp-A');
  const plan = planMerge(a, [tampered, bad, future, claimsA], { localComputerId: 'comp-A' });
  assert.equal(plan.summary.invalid, 1);
  assert.deepEqual(plan.idCollisions, [a[0].eventId]);
  assert.equal(plan.merged.find(x => x.eventId === a[0].eventId).make, a[0].make, 'local wins');
  assert.ok(plan.merged.some(x => x.eventId === future.eventId), 'forward-compatible events are kept');
  assert.deepEqual(plan.foreignWithLocalOrigin, [claimsA.eventId]);
});
t('same body on two computers: matched only under a shared key, surfaced for operator review', () => {
  const a = learn([], [F.canonOrig1], PH.alpha, { computer: 'comp-A', ring: ringA }).events;
  const b = learn([], [F.canonOrig1], PH.alpha, { computer: 'comp-B', ring: ringB }).events;
  const separate = planMerge(a, b);
  assert.equal(deriveRegistryState(separate.merged).devices.size, 2, 'local keys cannot match each other');
  assert.equal(separate.newConflicts.length, 0);
  const ao = learn([], [F.canonOrig1], PH.alpha, { computer: 'comp-A', ring: ringOrgA }).events;
  const bo = learn([], [F.canonOrig1], PH.beta, { computer: 'comp-B', ring: ringOrgB }).events;
  const shared = planMerge(ao, bo);
  assert.ok(shared.newConflicts.some(c => c.kind === 'identifier-spans-devices'), 'same body registered twice → review, not auto-merge');
  const s = deriveRegistryState(shared.merged);
  const [d1, d2] = [...s.devices.keys()];
  const linked = deriveRegistryState([...shared.merged, ev('device-linked', { deviceIds: [d1, d2], decision: 'same', resolves: [] }, 'comp-A', 'registry')]);
  assert.equal(linked.devices.size, 1);
  assert.equal(suggestForCamera(linked, { kind: 'body', deviceId: d1 }).level, 'alternatives', 'two computers saw two photographers on this body');
});
t('same name on two computers: two IDs, flagged — never merged by name; operator decides', () => {
  const id1 = P.newPhotographerId(newId), id2 = P.newPhotographerId(newId);
  const a = [ev('photographer-registered', { photographerId: id1, name: 'Test Delta', idOrigin: 'random' }, 'comp-A')];
  const b = [ev('photographer-registered', { photographerId: id2, name: 'test  delta', idOrigin: 'random' }, 'comp-B')];
  const plan = planMerge(a, b);
  assert.ok(plan.newConflicts.some(c => c.kind === 'same-name-different-ids'));
  const s = deriveRegistryState(plan.merged);
  assert.equal(s.photographers.size, 2);
  const diff = deriveRegistryState([...plan.merged, ev('photographer-linked', { photographerIds: [id1, id2], decision: 'different', resolves: [] }, 'comp-A', 'registry')]);
  assert.ok(!diff.conflicts.some(c => c.kind === 'same-name-different-ids'));
  const same = deriveRegistryState([...plan.merged, ev('photographer-linked', { photographerIds: [id1, id2], decision: 'same', resolves: [] }, 'comp-A', 'registry')]);
  assert.equal(same.photographers.size, 1);
  // A local addition with the same name as a shipped entry is also flagged, not merged.
  const shipped = P.bootstrapShippedIds(['Test Epsilon']);
  const s2 = deriveRegistryState([ev('photographer-registered', { photographerId: id1, name: 'Test Epsilon', idOrigin: 'random' })], { shipped });
  assert.ok(s2.conflicts.some(c => c.kind === 'same-name-different-ids'));
});

console.log('Q4a — privacy');
t('no raw serial appears in any output: cards, events, state, suggestions, merge plans', () => {
  let e = learn([], [F.canonOrig1, F.canonExif1], PH.alpha, { ring: ringOrgA }).events;
  e = learn(e, [F.sonyA, F.sonyB, F.nikon, F.canonOrig2], PH.beta, { ring: ringOrgA }).events;
  const s = deriveRegistryState(e);
  const outputs = [
    protect(card(...Object.values(F)), ringOrgA), e, s,
    [...s.devices.keys()].map(d => suggestForCamera(s, { kind: 'body', deviceId: d })),
    planMerge(e, learn([], [F.nikon], PH.gamma, { computer: 'comp-B', ring: ringOrgB }).events),
  ];
  const json = toJson(outputs);
  for (const serial of FAKE_SERIALS) assert.ok(!json.includes(serial), `raw serial leaked: ${serial.length} chars`);
  assert.ok(!json.includes(KEY_ORG.toString('hex')));
  assert.ok(!/"value"\s*:/.test(json), 'no identifier value fields');
});

console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES above' : ''}`);
