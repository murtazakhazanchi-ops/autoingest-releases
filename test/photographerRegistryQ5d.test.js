'use strict';

// AI-FEAT-063 / AI-RM-014 Q5d — camera-association decisions and conflict resolution through the
// Photographer Registry: pure builders (cameraAssociationCommands), the main-process manager
// (prepare → confirm → commit, tokens, revisions, operator), the runtime's non-initializing
// management open, and the IPC boundary. Registries are built with the REAL Q4 store and a FAKE
// secure storage in throw-away temp folders; every name, serial and ID is synthetic.
//
// Run: node test/photographerRegistryQ5d.test.js

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createIdentityRegistryStore } = require('../services/identityRegistryStore');
const { createEvent } = require('../services/identityEvents');
const { deriveRegistryState } = require('../services/associationModel');
const P = require('../services/photographerIdentity');
const { inspectRegistryFiles } = require('../services/identityRegistryInspector');
const V = require('../services/photographerRegistryView');
const C = require('../services/cameraAssociationCommands');
const { createRegistryBrowser, assertRendererSafe } = require('../services/photographerRegistryBrowser');
const { createRegistryManager } = require('../services/photographerRegistryManager');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

const THIS = 'fake-computer-THIS-q5d';
const OTHER = 'fake-computer-OTHER-q5d';
const OP = { id: 'user_q5dop_ab12', name: 'Operator Q5d' };
const SERIALS = ['FAKEQ5DR5-0001', 'FAKEQ5DSONY-0002', 'FAKEQ5DSPAN-0003', 'FAKEQ5DZ9-0004', 'FAKEQ5DZ9-0005'];
const digestOf = (s) => crypto.createHash('sha256').update(`fake-digest|${s}`).digest('hex');
const IDENTITY = 'q5d-test-app';
const fakeSecureStorage = (identity = IDENTITY) => ({
  backend: 'fake-test', identity, isAvailable: () => true,
  encrypt: (buf) => Buffer.concat([Buffer.from('SEALED:'), Buffer.from(buf.map(b => b ^ 0x5a))]),
  decrypt: (c) => Buffer.from(c.subarray(7).map(b => b ^ 0x5a)),
});
const tmp = (tag) => fsp.mkdtemp(path.join(os.tmpdir(), `ai-q5d-${tag}-`));

async function snapshot(root) {
  const out = {};
  async function walk(d) {
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      const st = await fsp.lstat(p);
      out[path.relative(root, p)] = `${e.isDirectory() ? 'd' : 'f'}:${st.size}:${st.mtimeMs}`;
      if (e.isDirectory()) await walk(p);
    }
  }
  await walk(root);
  return out;
}

const SHIPPED = ['Test Shipped Alpha', 'Test Shipped Beta', 'Test Shipped Delta'];
const OVERRIDE = ['Local Gamma', 'Zed Same', 'Pending Person'];
const ID = {
  alpha: P.shippedPhotographerId('Test Shipped Alpha'),
  beta: P.shippedPhotographerId('Test Shipped Beta'),
  delta: P.shippedPhotographerId('Test Shipped Delta'),
  gamma: '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5d',
  zed1: '11111111-2222-4333-8444-555555555557',
  zed2: '66666666-7777-4888-9999-aaaaaaaaaaac',
  d1: 'd1d1d1d1-0000-4000-8000-0000000000d1', // Canon R5: observed for alpha; confirm + retire for delta unsettled
  d2: 'd2d2d2d2-0000-4000-8000-0000000000d2', // Sony: confirmed beta; disputed gamma
  d3: 'd3d3d3d3-0000-4000-8000-0000000000d3', // Nikon Z 8 — same serial as d4 (one body, two records)
  d4: 'd4d4d4d4-0000-4000-8000-0000000000d4',
  d5: 'd5d5d5d5-0000-4000-8000-0000000000d5', // Nikon Z 9 body A
  d6: 'd6d6d6d6-0000-4000-8000-0000000000d6', // Nikon Z 9 body B (same model, different body)
};

async function seed(dir, { identity = IDENTITY } = {}) {
  const store = createIdentityRegistryStore({ dir, secureStorage: fakeSecureStorage(identity), computerId: THIS });
  assert.equal((await store.open()).state, 'ready');
  const keyId = JSON.parse(fs.readFileSync(path.join(dir, 'registry.json'), 'utf8')).keyIds[0];
  const ev = (type, payload, { at, computerId = THIS, operatorId = OP.id, workflow = 'event-import' } = {}) =>
    createEvent(type, payload, { origin: { computerId, operatorId, workflow }, at });
  const idf = (ns, serial) => [{ ns, keyId, digest: digestOf(serial), trusted: true }];
  const events = [
    ev('photographer-registered', { photographerId: ID.gamma, name: 'Local Gamma', idOrigin: 'random' }, { at: '2026-09-01T00:00:00Z' }),
    ev('photographer-registered', { photographerId: ID.zed1, name: 'Zed Same', idOrigin: 'random' }, { at: '2026-09-02T00:00:00Z' }),
    ev('photographer-registered', { photographerId: ID.zed2, name: 'Zed Same', idOrigin: 'random' }, { at: '2026-09-03T00:00:00Z', computerId: OTHER }),
    ev('device-registered', { deviceId: ID.d1, make: 'Canon', modelKey: 'canon eos r5', modelDisplay: 'EOS R5', identifiers: idf('exif.bodySerial', SERIALS[0]) }, { at: '2026-10-01T08:00:00Z' }),
    ev('device-registered', { deviceId: ID.d2, make: 'SONY', modelKey: 'ilce-7m3', modelDisplay: 'ILCE-7M3', identifiers: idf('sony.internal', SERIALS[1]) }, { at: '2026-10-01T08:00:01Z' }),
    ev('device-registered', { deviceId: ID.d3, make: 'Nikon', modelKey: 'z 8', modelDisplay: 'Z 8', identifiers: idf('nikon.serial', SERIALS[2]) }, { at: '2026-10-01T08:00:02Z' }),
    ev('device-registered', { deviceId: ID.d4, make: 'Nikon', modelKey: 'z 8', modelDisplay: 'Z 8', identifiers: idf('nikon.serial', SERIALS[2]) }, { at: '2026-10-01T08:00:03Z', computerId: OTHER }),
    ev('device-registered', { deviceId: ID.d5, make: 'Nikon', modelKey: 'z 9', modelDisplay: 'Z 9', identifiers: idf('nikon.serial', SERIALS[3]) }, { at: '2026-10-01T08:00:04Z' }),
    ev('device-registered', { deviceId: ID.d6, make: 'Nikon', modelKey: 'z 9', modelDisplay: 'Z 9', identifiers: idf('nikon.serial', SERIALS[4]) }, { at: '2026-10-01T08:00:05Z' }),
    ...['2026-10-01', '2026-10-02'].map((day, i) => ev('import-observed', { importId: `imp-fakeq5d-${i}`, photographerId: ID.alpha, deviceId: ID.d1, fileCount: 10, day }, { at: `${day}T10:00:00Z` })),
    ev('import-observed', { importId: 'imp-fakeq5d-g1', photographerId: ID.gamma, deviceId: ID.d2, fileCount: 4, day: '2026-10-04' }, { at: '2026-10-04T10:00:00Z' }),
    ev('import-observed', { importId: 'imp-fakeq5d-z3', photographerId: ID.alpha, deviceId: ID.d3, fileCount: 2, day: '2026-10-04' }, { at: '2026-10-04T11:00:00Z' }),
    ev('association-confirmed', { photographerId: ID.beta, deviceId: ID.d2, resolves: [] }, { at: '2026-10-06T10:00:00Z', workflow: 'registry' }),
    ev('association-confirmed', { photographerId: ID.gamma, deviceId: ID.d2, resolves: [] }, { at: '2026-10-07T10:00:00Z', computerId: OTHER, workflow: 'registry' }),
    ev('association-rejected', { photographerId: ID.gamma, deviceId: ID.d2, resolves: [] }, { at: '2026-10-07T11:00:00Z', workflow: 'registry' }),
    ev('association-confirmed', { photographerId: ID.delta, deviceId: ID.d1, resolves: [] }, { at: '2026-10-08T10:00:00Z', computerId: OTHER, workflow: 'registry' }),
    ev('association-retired', { photographerId: ID.delta, deviceId: ID.d1, resolves: [] }, { at: '2026-10-08T11:00:00Z', workflow: 'registry' }),
  ];
  assert.equal((await store.appendEvents(events)).ok, true);
  await store.close();
  return { keyId };
}

function viewOf(registry, extra = {}) {
  return V.buildRegistryView({
    registry, listNames: [...SHIPPED, ...OVERRIDE], shippedNames: SHIPPED,
    operators: [OP], thisComputerId: THIS, learning: { enabled: true, pendingCount: 0 }, ...extra,
  });
}

/**
 * A browser + manager pair wired like main.js, over a temp registry. The management store is opened
 * lazily (initialize:false) and, while open, is what the loader reads — as the runtime does.
 */
async function fixture({ seedIt = true, operator = OP, identity = IDENTITY, learningEnabled = true, storeFs } = {}) {
  const root = await tmp('fx');
  const dir = path.join(root, 'identity-registry');
  const fx = { root, dir, store: null, operator, opens: 0 };
  if (seedIt) Object.assign(fx, await seed(dir, { identity }));
  fx.loadView = async () => {
    const st = fx.store && fx.store.getStatus();
    const registry = st && st.state === 'ready'
      ? { state: 'ready', reason: null, events: fx.store.getEvents(), keyStatus: st.keyStatus, keyVerified: true, heldCount: 0, unknownTypeEvents: 0 }
      : await inspectRegistryFiles({ dir, expectedIdentity: IDENTITY });
    const view = viewOf(registry, { learning: { enabled: learningEnabled, pendingCount: 0 } });
    return { view, events: registry.state === 'ready' || registry.state === 'locked' ? registry.events : [], shippedNames: SHIPPED };
  };
  fx.openStore = async () => {
    fx.opens++;
    const reg = await inspectRegistryFiles({ dir, expectedIdentity: IDENTITY });
    if (!(fx.store && fx.store.getStatus().state === 'ready') && reg.state !== 'ready') return { ok: false, reason: reg.state === 'missing' ? 'no-registry' : `registry-${reg.state}` };
    if (!fx.store) fx.store = createIdentityRegistryStore({ dir, secureStorage: fakeSecureStorage(identity), computerId: THIS, ...(storeFs ? { fs: storeFs } : {}) });
    if (fx.store.getStatus().state !== 'ready') { await fx.store.close(); await fx.store.open({ initialize: false }); }
    const st = fx.store.getStatus();
    return st.state === 'ready' ? { ok: true, store: fx.store } : { ok: false, reason: st.reason === 'locked-by-another-process' ? 'registry-locked' : 'registry-unavailable' };
  };
  let manager = null;
  fx.browser = createRegistryBrowser({ loadView: fx.loadView, manageStatus: (v) => manager.availability(v) });
  fx.manager = manager = createRegistryManager({ browser: fx.browser, getOperator: () => fx.operator, getComputerId: () => THIS, openStore: fx.openStore });
  fx.overview = await fx.browser.load();
  fx.cam = (make, model, nth = 0) => fx.browser.overview().cameras.filter(c => c.make === make && c.model === model)[nth].handle;
  fx.person = (name, nth = 0) => fx.browser.search({ query: name }).results.filter(r => r.name === name)[nth].handle;
  fx.events = () => JSON.parse(fs.readFileSync(path.join(dir, 'registry.json'), 'utf8')).events;
  fx.state = () => deriveRegistryState(fx.events(), { shipped: P.bootstrapShippedIds(SHIPPED) });
  fx.assoc = (d, p) => fx.state().associations.get(`${fx.state().deviceCanonical(d)}|${fx.state().photographerCanonical(p)}`);
  fx.close = async () => { if (fx.store) await fx.store.close(); };
  return fx;
}

/** Every value that must never reach the renderer. */
function secrets(fx) {
  return [...Object.values(ID), ...SERIALS, ...SERIALS.map(digestOf), fx.keyId, THIS, OTHER, OP.id, 'imp-fakeq5d', fx.root, os.tmpdir()].filter(Boolean);
}
function clean(payload, fx, label) {
  const json = JSON.stringify(payload);
  for (const s of secrets(fx)) assert.ok(!json.includes(s), `${label}: leaked ${String(s).slice(0, 14)}…`);
  assertRendererSafe(payload);
  return payload;
}

async function act(fx, request, label = request.action) {
  const prep = clean(fx.manager.prepare(request), fx, `${label} prepare`);
  if (!prep.ok) return { prep };
  const res = clean(await fx.manager.commit(prep.token), fx, `${label} commit`);
  return { prep, res };
}

(async () => {
  console.log('Q5d — decision builders (pure)');

  await t('action availability follows the association state; disputed/unsettled pairs only offer "resolve"', async () => {
    const fx = await fixture();
    const st = fx.state();
    assert.deepEqual(C.associationActions(st, ID.d1, ID.alpha), ['confirm', 'reject', 'retire', 'correct'], 'observed');
    assert.deepEqual(C.associationActions(st, ID.d2, ID.beta), ['reject', 'retire', 'correct'], 'confirmed');
    assert.deepEqual(C.associationActions(st, ID.d2, ID.gamma), ['resolve'], 'disputed (confirm vs reject)');
    assert.equal(C.associationStatus(st, ID.d1, ID.delta).state, 'retired', 'Q4 shows the latest of the two');
    assert.equal(C.associationStatus(st, ID.d1, ID.delta).unsettled, true, 'confirm vs retire without seeing each other is unsettled');
    assert.deepEqual(C.associationActions(st, ID.d1, ID.delta), ['resolve']);
    assert.ok(C.unsettledPairs(st).has(`${ID.d1}|${ID.delta}`));
    assert.equal(C.unsettledPairs(st).has(`${ID.d2}|${ID.gamma}`), false, 'a Q4 dispute is not double-reported');
    await fx.close();
  });

  await t('builders refuse: missing operator, wrong workflow, stale revision, unknown records, wrong state', async () => {
    const fx = await fixture();
    const events = fx.events();
    const origin = { computerId: THIS, operatorId: OP.id, workflow: 'registry' };
    const args = { shippedNames: SHIPPED, action: 'confirm', deviceId: ID.d1, photographerId: ID.alpha, at: '2026-11-01T00:00:00Z' };
    const rev = C.revisionOf(events, args);
    assert.equal(C.planAssociationDecision(events, { ...args, origin: { ...origin, operatorId: null }, expectedRevision: rev }).reason, 'operator-required');
    assert.equal(C.planAssociationDecision(events, { ...args, origin: { ...origin, workflow: 'event-import' }, expectedRevision: rev }).reason, 'registry-workflow-required');
    assert.equal(C.planAssociationDecision(events, { ...args, origin, expectedRevision: 'x' }).reason, 'stale-revision');
    assert.equal(C.planAssociationDecision(events, { ...args, origin, deviceId: crypto.randomUUID(), expectedRevision: rev }).reason, 'unknown-camera');
    const pendingArgs = { ...args, photographerId: 'name:pending person' };
    assert.equal(C.planAssociationDecision(events, { ...pendingArgs, origin, expectedRevision: C.revisionOf(events, pendingArgs) }).reason, 'unknown-photographer');
    const rRev = C.revisionOf(events, { ...args, photographerId: ID.beta, deviceId: ID.d2 });
    assert.equal(C.planAssociationDecision(events, { ...args, origin, photographerId: ID.beta, deviceId: ID.d2, expectedRevision: rRev }).reason, 'not-available-for-state', 'already confirmed');
    const ok = C.planAssociationDecision(events, { ...args, origin, expectedRevision: rev });
    assert.equal(ok.ok, true);
    assert.equal(ok.events[0].type, 'association-confirmed');
    assert.deepEqual(ok.events[0].resolves, [], 'nothing to settle on a merely observed pair');
    await fx.close();
  });

  console.log('Q5d — manager: decisions');

  await t('confirm: explicit preview, durable append with operator + computer provenance, observations untouched', async () => {
    const fx = await fixture();
    const cam = fx.cam('Canon', 'EOS R5');
    const detail = clean(fx.browser.camera(cam), fx, 'camera');
    const row = detail.camera.associations.find(a => a.photographer.name === 'Test Shipped Alpha');
    assert.deepEqual(row.actions, ['confirm', 'reject', 'retire', 'correct']);
    assert.deepEqual(detail.camera.actions, ['add-photographer']);
    const before = fx.events().length;
    const { prep, res } = await act(fx, { action: 'confirm', camera: cam, photographer: row.photographer.handle });
    assert.equal(prep.ok, true);
    assert.equal(prep.preview.title, 'Confirm that this camera is associated with this photographer?');
    assert.deepEqual(prep.preview.camera, { make: 'Canon', model: 'EOS R5', nickname: null });
    assert.deepEqual(prep.preview.rows, [{ label: 'Test Shipped Alpha', current: 'Observed', proposed: 'Confirmed' }]);
    assert.match(prep.preview.consequences[0], /may suggest this photographer.*operator still makes the final selection/);
    assert.match(prep.preview.caveat, /does not prove who took a particular photo/);
    assert.equal(prep.operator, OP.name);
    assert.equal(res.ok, true);
    assert.match(res.message, /^Saved\. Canon EOS R5 is confirmed for Test Shipped Alpha\.$/);
    const evs = fx.events();
    assert.equal(evs.length, before + 1, 'exactly one event, written to disk before success was reported');
    const e = evs[evs.length - 1];
    assert.equal(e.type, 'association-confirmed');
    assert.deepEqual(e.origin, { computerId: THIS, operatorId: OP.id, workflow: 'registry' });
    const a = fx.assoc(ID.d1, ID.alpha);
    assert.equal(a.state, 'confirmed');
    assert.equal(a.observedImports, 2, 'observations preserved');
    assert.ok(res.focus.camera, 'fresh handle for the same camera');
    const again = clean(fx.browser.camera(res.focus.camera), fx, 'camera after');
    assert.equal(again.camera.associations.find(x => x.photographer.name === 'Test Shipped Alpha').state, 'confirmed');
    assert.equal(again.camera.history[again.camera.history.length - 1].kind, 'confirmation');
    assert.match(again.camera.history[again.camera.history.length - 1].operator, /Operator Q5d/);
    await fx.close();
  });

  await t('reject and retire keep every earlier observation and decision in the log', async () => {
    for (const action of ['reject', 'retire']) {
      const fx = await fixture();
      const cam = fx.cam('Canon', 'EOS R5');
      const before = fx.events();
      const p = clean(fx.browser.camera(cam), fx, 'camera').camera.associations.find(a => a.photographer.name === 'Test Shipped Alpha').photographer.handle;
      const { prep, res } = await act(fx, { action, camera: cam, photographer: p });
      assert.equal(prep.preview.rows[0].proposed, action === 'reject' ? 'Not this photographer' : 'No longer used');
      assert.equal(res.ok, true, action);
      const after = fx.events();
      assert.deepEqual(after.slice(0, before.length), before, 'append-only: nothing removed or rewritten');
      assert.equal(after[after.length - 1].type, action === 'reject' ? 'association-rejected' : 'association-retired');
      const a = fx.assoc(ID.d1, ID.alpha);
      assert.equal(a.state, action === 'reject' ? 'rejected' : 'retired');
      assert.equal(a.observedImports, 2);
      await fx.close();
    }
  });

  await t('correction A → B: two decisions appended together; A\'s original decision and provenance kept; one history row', async () => {
    const fx = await fixture();
    // First confirm alpha on the R5, then correct it to gamma.
    let cam = fx.cam('Canon', 'EOS R5');
    let p = fx.browser.camera(cam).camera.associations.find(a => a.photographer.name === 'Test Shipped Alpha').photographer.handle;
    const first = await act(fx, { action: 'confirm', camera: cam, photographer: p });
    const confirmId = fx.events().slice(-1)[0].eventId;
    cam = first.res.focus.camera;
    p = fx.browser.camera(cam).camera.associations.find(a => a.photographer.name === 'Test Shipped Alpha').photographer.handle;
    const target = fx.person('Local Gamma');
    assert.equal(fx.browser.search({ query: 'Local Gamma' }).results[0].assignable, true);
    const noPrior = fx.manager.prepare({ action: 'correct', camera: cam, photographer: p, target });
    assert.equal(noPrior.reason, 'invalid-outcome', 'the operator must say what happened with the first photographer');
    const { prep, res } = await act(fx, { action: 'correct', camera: cam, photographer: p, target, priorOutcome: 'reject' });
    assert.deepEqual(prep.preview.rows, [
      { label: 'Test Shipped Alpha', current: 'Confirmed', proposed: 'Not this photographer' },
      { label: 'Local Gamma', current: 'No association', proposed: 'Confirmed' },
    ]);
    assert.ok(prep.preview.consequences.some(c => /earlier decision for Test Shipped Alpha stays/.test(c)));
    assert.equal(res.ok, true);
    assert.match(res.message, /now confirmed for Local Gamma instead of Test Shipped Alpha/);
    const evs = fx.events();
    const [rej, conf] = evs.slice(-2);
    assert.equal(rej.type, 'association-rejected');
    assert.deepEqual(rej.resolves, [confirmId], 'the rejection settles exactly the confirmation the operator saw');
    assert.equal(conf.type, 'association-confirmed');
    assert.equal(conf.photographerId, ID.gamma);
    assert.equal(rej.at, conf.at, 'one atomic step');
    assert.ok(evs.some(e => e.eventId === confirmId), 'the original confirmation is still in the log');
    assert.equal(fx.assoc(ID.d1, ID.alpha).state, 'rejected');
    assert.equal(fx.assoc(ID.d1, ID.alpha).confirmations, 1);
    assert.equal(fx.assoc(ID.d1, ID.gamma).state, 'confirmed');
    const hist = fx.browser.camera(res.focus.camera).camera.history;
    const corr = hist.filter(h => h.kind === 'correction');
    assert.equal(corr.length, 1);
    assert.equal(corr[0].what, "Corrected: marked as not Test Shipped Alpha's camera and confirmed for Local Gamma");
    assert.ok(hist.some(h => h.kind === 'confirmation' && /Confirmed for Test Shipped Alpha/.test(h.what)), 'the first decision stays visible');
    await fx.close();
  });

  await t('shared camera: "add another photographer" keeps the existing confirmation', async () => {
    const fx = await fixture();
    const cam = fx.cam('SONY', 'ILCE-7M3');
    const { prep, res } = await act(fx, { action: 'add-photographer', camera: cam, target: fx.person('Test Shipped Alpha') });
    assert.equal(prep.preview.title, 'Add another photographer to this camera?');
    assert.ok(prep.preview.consequences.some(c => /already associated with this camera stay associated/.test(c)));
    assert.equal(res.ok, true);
    assert.equal(fx.assoc(ID.d2, ID.beta).state, 'confirmed', 'Beta untouched');
    assert.equal(fx.assoc(ID.d2, ID.alpha).state, 'confirmed');
    const again = fx.manager.prepare({ action: 'add-photographer', camera: res.focus.camera, target: fx.person('Test Shipped Beta') });
    assert.equal(again.reason, 'already-associated');
    const pending = fx.browser.search({ query: 'Pending Person' }).results[0];
    assert.equal(pending.assignable, false, 'a list name with no identity yet cannot be associated');
    assert.equal(fx.manager.prepare({ action: 'add-photographer', camera: res.focus.camera, target: pending.handle }).reason, 'unknown-photographer');
    await fx.close();
  });

  console.log('Q5d — manager: conflicts');

  await t('disputed confirm/reject and unsettled confirm/retire are settled with resolves = every decision seen', async () => {
    const fx = await fixture();
    const items = fx.browser.overview().reviewItems;
    const disputed = items.find(r => r.kind === 'association-disputed');
    const unsettled = items.find(r => r.kind === 'association-unsettled');
    assert.ok(unsettled, 'confirm vs retire is surfaced for review');
    assert.equal(unsettled.title, 'Camera decisions disagree');
    for (const r of [disputed, unsettled]) assert.deepEqual(r.resolution.options.map(o => o.id), ['confirm', 'reject', 'retire']);
    const before = fx.events();
    const decided = (d, p) => before.filter(e => /^association-(confirmed|rejected|retired)$/.test(e.type) && e.deviceId === d && e.photographerId === p).map(e => e.eventId).sort();
    const r1 = await act(fx, { action: 'resolve-review', review: disputed.id, outcome: 'confirm' });
    assert.equal(r1.prep.preview.title, 'Settle this review item?');
    assert.equal(r1.res.ok, true);
    assert.deepEqual([...fx.events().slice(-1)[0].resolves].sort(), decided(ID.d2, ID.gamma));
    assert.equal(fx.assoc(ID.d2, ID.gamma).state, 'confirmed');
    const u2 = r1.res.overview.reviewItems.find(r => r.kind === 'association-unsettled');
    const r2 = await act(fx, { action: 'resolve-review', review: u2.id, outcome: 'retire' });
    assert.equal(r2.res.ok, true);
    assert.deepEqual([...fx.events().slice(-1)[0].resolves].sort(), decided(ID.d1, ID.delta));
    assert.equal(C.associationStatus(fx.state(), ID.d1, ID.delta).unsettled, false);
    const left = r2.res.overview.reviewItems.map(r => r.kind);
    assert.ok(!left.includes('association-disputed') && !left.includes('association-unsettled'), 'both review items settled');
    const hist = fx.browser.camera(r2.res.focus.camera).camera.history;
    assert.ok(hist.some(h => h.kind === 'resolution' && /^Review settled: marked as no longer used by Test Shipped Delta/.test(h.what)));
    await fx.close();
  });

  await t('camera records: link only with shared reliable identifier; same-model different bodies never linkable', async () => {
    const fx = await fixture();
    const span = fx.browser.overview().reviewItems.find(r => r.kind === 'identifier-spans-devices');
    assert.deepEqual(span.resolution.options.map(o => o.id), ['link-same']);
    // Two Z 9 bodies: same model, different serials — no conflict, nothing to link.
    assert.equal(fx.browser.overview().reviewItems.filter(r => r.cameras.some(c => c.model === 'Z 9')).length, 0);
    const st = fx.state();
    assert.equal(C.sharedTrustedIdentifiers(st, ID.d5, ID.d6), 0);
    const origin = { computerId: THIS, operatorId: OP.id, workflow: 'registry' };
    const z9 = { shippedNames: SHIPPED, kind: 'link-same-cameras', ids: [ID.d5, ID.d6], bodyMatching: true, origin, at: '2026-11-01T00:00:00Z' };
    assert.equal(C.planIdentityResolution(fx.events(), { ...z9, expectedRevision: C.revisionOf(fx.events(), z9) }).reason, 'no-matching-conflict');
    const { prep, res } = await act(fx, { action: 'resolve-review', review: span.id, outcome: 'link-same' });
    assert.equal(prep.preview.title, 'Link these camera records as one camera?');
    assert.ok(prep.preview.consequences.some(c => /Different camera bodies of the same model are never linked/.test(c)));
    assert.equal(res.ok, true);
    const e = fx.events().slice(-1)[0];
    assert.equal(e.type, 'device-linked');
    assert.equal(e.decision, 'same');
    assert.deepEqual(e.deviceIds, [ID.d3, ID.d4]);
    assert.equal(res.overview.reviewItems.filter(r => r.kind === 'identifier-spans-devices').length, 0);
    assert.equal(res.overview.cameras.filter(c => c.model === 'Z 8').length, 1, 'one camera now');
    assert.equal(res.overview.cameras.filter(c => c.model === 'Z 9').length, 2, 'two different Z 9 bodies stay separate');
    const hist = fx.browser.camera(res.focus.camera).camera.history;
    assert.ok(hist.some(h => h.kind === 'link'));
    await fx.close();
  });

  await t('camera link refused when body matching is unavailable; association decisions still allowed', async () => {
    const fx = await fixture({ identity: 'another-app-identity' });
    const ov = fx.browser.overview();
    assert.equal(ov.status.bodyMatching, 'unavailable');
    const span = ov.reviewItems.find(r => r.kind === 'identifier-spans-devices');
    assert.equal(span.resolution.supported, false);
    assert.match(span.resolution.note, /Camera-body matching is unavailable/);
    assert.equal(fx.manager.prepare({ action: 'resolve-review', review: span.id, outcome: 'link-same' }).reason, 'key-unavailable');
    const cam = fx.cam('Canon', 'EOS R5');
    const p = fx.browser.camera(cam).camera.associations.find(a => a.photographer.name === 'Test Shipped Alpha').photographer.handle;
    const { res } = await act(fx, { action: 'confirm', camera: cam, photographer: p });
    assert.equal(res.ok, true);
    await fx.close();
  });

  await t('same name, different records: only "different people" is offered; merging is not', async () => {
    const fx = await fixture();
    const item = fx.browser.overview().reviewItems.find(r => r.kind === 'same-name-different-ids');
    assert.deepEqual(item.resolution.options.map(o => o.id), ['mark-different']);
    assert.match(item.resolution.note, /Merging the two records into one person is not available/);
    assert.equal(fx.manager.prepare({ action: 'resolve-review', review: item.id, outcome: 'link-same' }).reason, 'unsupported-action', 'an option of another conflict kind is refused');
    assert.equal(fx.manager.prepare({ action: 'resolve-review', review: item.id, outcome: 'confirm' }).reason, 'unsupported-action');
    const { prep, res } = await act(fx, { action: 'resolve-review', review: item.id, outcome: 'mark-different' });
    assert.ok(prep.preview.consequences.some(c => /Nothing is merged and no name or folder changes/.test(c)));
    assert.equal(res.ok, true);
    const e = fx.events().slice(-1)[0];
    assert.equal(e.type, 'photographer-linked');
    assert.equal(e.decision, 'different');
    assert.equal(res.overview.reviewItems.filter(r => r.kind === 'same-name-different-ids').length, 0);
    assert.equal(fx.state().photographers.has(ID.zed1) && fx.state().photographers.has(ID.zed2), true, 'both identities remain');
    await fx.close();
  });

  await t('naming and damaged-record review items stay read-only with an explanation', async () => {
    const fx = await fixture();
    for (const r of fx.browser.overview().reviewItems.filter(x => x.kind === 'ambiguous-name')) {
      assert.equal(r.resolution.supported, false);
      assert.match(r.resolution.note, /photographer names/);
      assert.ok(fx.manager.prepare({ action: 'resolve-review', review: r.id, outcome: 'mark-different' }).ok === false);
    }
    await fx.close();
  });

  console.log('Q5d — manager: safety, revisions, concurrency');

  await t('stale revision: a change to the camera between preview and commit is refused, nothing appended, fresh view returned', async () => {
    const fx = await fixture();
    const cam = fx.cam('Canon', 'EOS R5');
    const p = fx.browser.camera(cam).camera.associations.find(a => a.photographer.name === 'Test Shipped Alpha').photographer.handle;
    const prep = fx.manager.prepare({ action: 'confirm', camera: cam, photographer: p });
    // Another operator (or a learning job) records a decision on the same camera meanwhile.
    await fx.openStore();
    const other = createEvent('association-rejected', { photographerId: ID.alpha, deviceId: ID.d1, resolves: [] }, { origin: { computerId: THIS, operatorId: 'user_other_0001', workflow: 'registry' }, at: '2026-11-02T00:00:00Z' });
    assert.equal((await fx.store.appendEvents([other])).ok, true);
    const before = fx.events().length;
    const res = clean(await fx.manager.commit(prep.token), fx, 'stale commit');
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'registry-changed');
    assert.equal(fx.events().length, before, 'nothing appended — the other decision is not overwritten');
    assert.ok(res.overview && res.focus.camera, 'fresh snapshot to review');
    assert.equal(fx.assoc(ID.d1, ID.alpha).state, 'rejected');
    // An unrelated camera changing does not block a decision.
    const cam2 = fx.cam('SONY', 'ILCE-7M3');
    const p2 = fx.browser.camera(cam2).camera.associations.find(a => a.photographer.name === 'Test Shipped Beta').photographer.handle;
    const prep2 = fx.manager.prepare({ action: 'retire', camera: cam2, photographer: p2 });
    const obs = createEvent('import-observed', { importId: 'imp-fakeq5d-late', photographerId: ID.alpha, deviceId: ID.d5, fileCount: 1, day: '2026-11-02' }, { origin: { computerId: THIS, operatorId: null, workflow: 'event-import' }, at: '2026-11-02T01:00:00Z' });
    assert.equal((await fx.store.appendEvents([obs])).ok, true);
    assert.equal((await fx.manager.commit(prep2.token)).ok, true);
    await fx.close();
  });

  await t('expired handles and tokens: reloaded snapshot, unknown handle, malformed input, old token', async () => {
    let clock = Date.parse('2026-11-01T00:00:00Z');
    const fx = await fixture();
    const mgr = createRegistryManager({ browser: fx.browser, getOperator: () => OP, getComputerId: () => THIS, openStore: fx.openStore, now: () => new Date(clock) });
    const cam = fx.cam('Canon', 'EOS R5');
    const p = fx.browser.camera(cam).camera.associations[0].photographer.handle;
    const prep = mgr.prepare({ action: 'confirm', camera: cam, photographer: p });
    assert.equal(prep.ok, true);
    await fx.browser.load(); // the tab reloaded: every handle of the old snapshot is invalid
    assert.equal(mgr.prepare({ action: 'confirm', camera: cam, photographer: p }).reason, 'stale-view');
    const stale = await mgr.commit(prep.token);
    assert.equal(stale.reason, 'stale-view');
    assert.ok(stale.overview, 'stale-view refusal carries a fresh snapshot');
    assert.equal(mgr.prepare({ action: 'confirm', camera: 'c-zzzz', photographer: p }).reason, 'stale-view');
    assert.equal(mgr.prepare({ action: 'drop-table' }).reason, 'unsupported-action');
    assert.equal((await mgr.commit('t-nope')).reason, 'invalid-request');
    assert.equal((await mgr.commit(`t-${'0'.repeat(24)}`)).reason, 'expired-confirmation');
    const cam2 = fx.cam('Canon', 'EOS R5');
    const p2 = fx.browser.camera(cam2).camera.associations.find(a => a.photographer.name === 'Test Shipped Alpha').photographer.handle;
    const prep2 = mgr.prepare({ action: 'confirm', camera: cam2, photographer: p2 });
    clock += 6 * 60000;
    assert.equal((await mgr.commit(prep2.token)).reason, 'expired-confirmation');
    await fx.close();
  });

  await t('operator: required at preview and commit, resolved in main, a changed operator is refused', async () => {
    const fx = await fixture({ operator: null });
    const ov = fx.browser.overview();
    assert.deepEqual(ov.management, { available: false, reason: 'no-operator', operatorName: null });
    assert.equal(ov.capabilities.associationDecisions, false);
    const cam = fx.cam('Canon', 'EOS R5');
    const det = fx.browser.camera(cam).camera;
    assert.deepEqual(det.actions, []);
    assert.ok(det.associations.every(a => a.actions.length === 0), 'no action offered without an operator');
    assert.equal(fx.manager.prepare({ action: 'confirm', camera: cam, photographer: det.associations[0].photographer.handle }).reason, 'no-operator');
    fx.operator = OP;
    await fx.browser.load();
    const cam2 = fx.cam('Canon', 'EOS R5');
    const p2 = fx.browser.camera(cam2).camera.associations.find(a => a.photographer.name === 'Test Shipped Alpha').photographer.handle;
    const prep = fx.manager.prepare({ action: 'confirm', camera: cam2, photographer: p2, operatorId: 'user_forged_0000' });
    assert.equal(prep.ok, true);
    fx.operator = { id: 'user_someone_ffff', name: 'Someone Else' };
    assert.equal((await fx.manager.commit(prep.token)).reason, 'operator-changed');
    fx.operator = null;
    const prep2 = (fx.operator = OP, fx.manager.prepare({ action: 'confirm', camera: cam2, photographer: p2 }));
    fx.operator = null;
    assert.equal((await fx.manager.commit(prep2.token)).reason, 'no-operator');
    assert.ok(!fx.events().some(e => e.origin.operatorId === 'user_forged_0000' || e.origin.operatorId === 'user_someone_ffff'));
    await fx.close();
  });

  await t('computer provenance: without this computer\'s ID yet, decisions wait (nothing written)', async () => {
    const fx = await fixture();
    let computer = null;
    const mgr = createRegistryManager({ browser: fx.browser, getOperator: () => OP, getComputerId: () => computer, openStore: fx.openStore });
    assert.deepEqual(mgr.availability(fx.browser.internals.snapshot().view), { available: false, reason: 'computer-not-ready', operatorName: OP.name });
    computer = THIS;
    const cam = fx.cam('Canon', 'EOS R5');
    const p = fx.browser.camera(cam).camera.associations.find(a => a.photographer.name === 'Test Shipped Alpha').photographer.handle;
    const prep = mgr.prepare({ action: 'confirm', camera: cam, photographer: p });
    computer = null;
    const before = fx.events().length;
    assert.equal((await mgr.commit(prep.token)).reason, 'computer-not-ready');
    assert.equal(fx.events().length, before);
    await fx.close();
  });

  await t('duplicate requests: one token commits once, even when sent twice at the same time', async () => {
    const fx = await fixture();
    const cam = fx.cam('Canon', 'EOS R5');
    const p = fx.browser.camera(cam).camera.associations.find(a => a.photographer.name === 'Test Shipped Alpha').photographer.handle;
    const prep = fx.manager.prepare({ action: 'confirm', camera: cam, photographer: p });
    const before = fx.events().length;
    const [a, b] = await Promise.all([fx.manager.commit(prep.token), fx.manager.commit(prep.token)]);
    const c = await fx.manager.commit(prep.token);
    assert.equal(a.ok, true);
    assert.equal(b.duplicate, true);
    assert.equal(c.duplicate, true);
    assert.equal(fx.events().length, before + 1, 'exactly one decision recorded');
    await fx.close();
  });

  await t('atomic correction: a failed registry write appends neither decision and reports failure', async () => {
    let failWrites = false;
    const failing = new Proxy(fsp, { get: (t0, k) => (k === 'rename' ? async (...a) => { if (failWrites && String(a[1]).endsWith('registry.json')) { const e = new Error('disk full'); e.code = 'ENOSPC'; throw e; } return fsp.rename(...a); } : t0[k]) });
    const fx = await fixture({ storeFs: failing });
    const cam = fx.cam('SONY', 'ILCE-7M3');
    const p = fx.browser.camera(cam).camera.associations.find(a => a.photographer.name === 'Test Shipped Beta').photographer.handle;
    const prep = fx.manager.prepare({ action: 'correct', camera: cam, photographer: p, target: fx.person('Test Shipped Alpha'), priorOutcome: 'retire' });
    await fx.openStore();
    const before = fs.readFileSync(path.join(fx.dir, 'registry.json'), 'utf8');
    failWrites = true;
    const res = clean(await fx.manager.commit(prep.token), fx, 'failed commit');
    failWrites = false;
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'write-failed');
    assert.equal(fs.readFileSync(path.join(fx.dir, 'registry.json'), 'utf8'), before, 'registry unchanged');
    assert.equal(fx.store.getEvents().length, JSON.parse(before).events.length, 'memory unchanged');
    assert.equal(fx.assoc(ID.d2, ID.beta).state, 'confirmed');
    assert.equal((await fx.manager.commit(prep.token)).reason, 'expired-confirmation', 'a refused token cannot be replayed');
    await fx.close();
  });

  await t('registry locked by another process: refused, nothing written; read-only registry reported as such', async () => {
    const fx = await fixture();
    const cam = fx.cam('Canon', 'EOS R5');
    const p = fx.browser.camera(cam).camera.associations.find(a => a.photographer.name === 'Test Shipped Alpha').photographer.handle;
    const prep = fx.manager.prepare({ action: 'confirm', camera: cam, photographer: p });
    const holder = process.ppid; // a live process that is not us
    fs.writeFileSync(path.join(fx.dir, 'registry.lock'), JSON.stringify({ pid: holder, token: 'other', at: '2026-11-01T00:00:00Z' }));
    const before = await snapshot(fx.dir);
    const res = await fx.manager.commit(prep.token);
    assert.equal(res.reason, 'registry-locked');
    assert.deepEqual(await snapshot(fx.dir), before);
    fs.unlinkSync(path.join(fx.dir, 'registry.lock'));
    await fx.close();

    const ro = await fixture({ storeFs: new Proxy(fsp, { get: (t0, k) => (k === 'rename' ? async (...a) => { if (String(a[1]).endsWith('.json') && String(a[1]).includes('identity-registry')) { const e = new Error('read-only'); e.code = 'EROFS'; throw e; } return fsp.rename(...a); } : t0[k]) }) });
    const cam2 = ro.cam('Canon', 'EOS R5');
    const p2 = ro.browser.camera(cam2).camera.associations.find(a => a.photographer.name === 'Test Shipped Alpha').photographer.handle;
    const r2 = await ro.manager.commit(ro.manager.prepare({ action: 'confirm', camera: cam2, photographer: p2 }).token);
    assert.equal(r2.reason, 'registry-read-only');
    await ro.close();
  });

  await t('no registry, corrupt or newer registry: decisions unavailable, nothing created or changed', async () => {
    const fx = await fixture({ seedIt: false });
    assert.equal(fx.browser.overview().management.reason, 'no-registry');
    assert.equal(fx.manager.prepare({ action: 'confirm', camera: 'c-0123456789abcdef' }).reason, 'no-registry');
    assert.equal((await fx.openStore()).reason, 'no-registry');
    assert.equal(fs.existsSync(fx.dir), false, 'no registry folder, key or file created');

    const bad = await fixture();
    fs.writeFileSync(path.join(bad.dir, 'registry.json'), '{ not json');
    const before = await snapshot(bad.dir);
    await bad.browser.load();
    assert.equal(bad.browser.overview().management.reason, 'registry-corrupt');
    assert.equal((await bad.openStore()).reason, 'registry-corrupt');
    assert.deepEqual(await snapshot(bad.dir), before, 'corrupt registry neither opened, quarantined nor replaced');

    const newer = await fixture();
    const doc = JSON.parse(fs.readFileSync(path.join(newer.dir, 'registry.json'), 'utf8'));
    fs.writeFileSync(path.join(newer.dir, 'registry.json'), JSON.stringify({ ...doc, schemaVersion: 99 }));
    await newer.browser.load();
    assert.equal(newer.browser.overview().management.reason, 'registry-incompatible');
  });

  await t('store.open({ initialize: false }) never creates a registry, folder, lock or key', async () => {
    const root = await tmp('noinit');
    const dir = path.join(root, 'identity-registry');
    let encrypts = 0;
    const ss = { ...fakeSecureStorage(), encrypt: (b) => { encrypts++; return fakeSecureStorage().encrypt(b); } };
    const store = createIdentityRegistryStore({ dir, secureStorage: ss, computerId: THIS });
    const st = await store.open({ initialize: false });
    assert.equal(st.state, 'disabled');
    assert.equal(st.reason, 'registry-missing');
    assert.equal(fs.existsSync(dir), false);
    assert.equal(encrypts, 0);
  });

  await t('a key sealed under another app identity is refused before secure storage is even queried', async () => {
    const root = await tmp('kc');
    const dir = path.join(root, 'identity-registry');
    await seed(dir, { identity: 'seed-only-identity' });
    let touched = 0;
    const ss = { backend: 'fake-test', identity: IDENTITY, isAvailable: () => { touched++; return true; }, encrypt: () => { touched++; throw new Error('no'); }, decrypt: () => { touched++; throw new Error('no'); } };
    const store = createIdentityRegistryStore({ dir, secureStorage: ss, computerId: THIS });
    const st = await store.open({ initialize: false });
    assert.equal(st.state, 'ready', 'registry still opens for decisions');
    assert.equal(st.keyStatus, 'key-protection-identity-mismatch');
    assert.equal(touched, 0, 'no isAvailable/decrypt call — on macOS that would create this app\'s Keychain item');
    await store.close();
  });

  await t('learning switched off: manual decisions still recorded; persisted across a restart', async () => {
    const fx = await fixture({ learningEnabled: false });
    assert.equal(fx.browser.overview().status.learningEnabled, false);
    const cam = fx.cam('Canon', 'EOS R5');
    const p = fx.browser.camera(cam).camera.associations.find(a => a.photographer.name === 'Test Shipped Alpha').photographer.handle;
    assert.equal((await act(fx, { action: 'confirm', camera: cam, photographer: p })).res.ok, true);
    await fx.close();
    // "Restart": a new store and browser over the same files.
    const store = createIdentityRegistryStore({ dir: fx.dir, secureStorage: fakeSecureStorage(), computerId: THIS });
    assert.equal((await store.open({ initialize: false })).state, 'ready');
    const st = deriveRegistryState(store.getEvents(), { shipped: P.bootstrapShippedIds(SHIPPED) });
    assert.equal(st.associations.get(`${ID.d1}|${ID.alpha}`).state, 'confirmed');
    await store.close();
  });

  await t('privacy: every payload of a full session is free of IDs, digests, serials, operator/computer IDs and paths', async () => {
    const fx = await fixture();
    const payloads = [fx.browser.overview()];
    for (const c of fx.browser.overview().cameras) payloads.push(fx.browser.camera(c.handle));
    for (const r of fx.browser.search({}).results) payloads.push(fx.browser.photographer(r.handle));
    const cam = fx.cam('Canon', 'EOS R5');
    const p = fx.browser.camera(cam).camera.associations.find(a => a.photographer.name === 'Test Shipped Alpha').photographer.handle;
    const prep = fx.manager.prepare({ action: 'correct', camera: cam, photographer: p, target: fx.person('Local Gamma'), priorOutcome: 'retire' });
    payloads.push(prep, await fx.manager.commit(prep.token));
    payloads.forEach((x, i) => clean(x, fx, `payload ${i}`));
    assert.ok(!JSON.stringify(payloads).includes('"revision"'), 'revisions stay in the main process');
    await fx.close();
  });

  console.log('Q5d — runtime and IPC boundaries');

  await t('runtime.openRegistryForManagement: shares the one store, refuses missing/corrupt, never initializes', async () => {
    const userData = await tmp('runtime');
    const electronPath = require.resolve('electron');
    const xor = (s) => Buffer.from(Buffer.from(s).map(b => b ^ 0x33));
    const fakeElectron = {
      app: { getPath: (k) => (k === 'userData' ? userData : os.tmpdir()), getName: () => IDENTITY },
      safeStorage: { isEncryptionAvailable: () => true, encryptString: (s) => xor(s), decryptString: (b) => xor(b).toString() },
    };
    require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fakeElectron };
    for (const m of ['../services/photographerLearningRuntime', '../services/settings', '../main/userManager', '../main/listManager', '../services/electronSecureStorage']) delete require.cache[require.resolve(m)];
    require('../main/listManager').init(userData);
    const runtime = require('../services/photographerLearningRuntime');
    const dir = path.join(userData, 'identity-registry');
    assert.deepEqual(await runtime.openRegistryForManagement(), { ok: false, reason: 'no-registry' });
    assert.equal(fs.existsSync(dir), false, 'missing registry is not created');
    // Seed with the same secure storage the runtime will use.
    const { createElectronSecureStorage } = require('../services/electronSecureStorage');
    const seedStore = createIdentityRegistryStore({ dir, secureStorage: createElectronSecureStorage(fakeElectron), computerId: THIS });
    await seedStore.open();
    await seedStore.close();
    const a = await runtime.openRegistryForManagement();
    assert.equal(a.ok, true);
    assert.equal(a.store.getStatus().bodyMatching, true);
    const b = await runtime.openRegistryForManagement();
    assert.equal(b.store, a.store, 'one shared store instance (one lock holder)');
    assert.equal(runtime._forTests.store(), a.store, 'the same instance learning uses');
    const view = await runtime.inspectRegistry({ withEvents: true });
    assert.ok(view.view && Array.isArray(view.events) && Array.isArray(view.shippedNames));
    runtime.shutdown();
    assert.deepEqual(await runtime.openRegistryForManagement(), { ok: false, reason: 'shutting-down' });
  });

  await t('main.js: four read + three decision channels (+ Q5e-1 read-only rename preview), main-window only; no rename/folder write reachable', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'main', 'main.js'), 'utf8');
    const channels = [...src.matchAll(/ipcMain\.(?:handle|on)\('(photographerRegistry:[A-Za-z]+)'/g)].map(m => m[1]).sort();
    assert.deepEqual(channels, ['photographerRegistry:camera', 'photographerRegistry:cancel', 'photographerRegistry:commit', 'photographerRegistry:load', 'photographerRegistry:photographer', 'photographerRegistry:prepare', 'photographerRegistry:renamePreview', 'photographerRegistry:search']);
    const block = src.slice(src.indexOf('Photographer Registry tab (AI-FEAT-063'), src.indexOf("ipcMain.handle('keywords:saveCityCountry'"));
    assert.equal((block.match(/= _photographerRegistry\(event\)/g) || []).length, 8, 'every handler validates the sender');
    assert.ok(/event\.sender !== main\.webContents/.test(block));
    assert.ok(/getOperator: \(\) => userManager\.getActiveUser\(\)/.test(block), 'operator comes from main, never the renderer');
    assert.ok(!/buildRenameEvent|createProfileCommandService|planCurrentEventFolderRename|photographerProfileCommands|renamePhotographer|addSearchAlias|recoverFromBackup|appendEvents\(/.test(block), 'no naming, folder or recovery path');
    for (const f of ['services/photographerRegistryManager.js', 'services/cameraAssociationCommands.js', 'services/photographerProfileActions.js']) {
      const s = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      // Q5e-1: the manager may use the READ-ONLY folder planner for the rename preview; nothing builds a rename.
      assert.ok(!/buildRenameEvent|createProfileCommandService|renamePhotographer|photographer-renamed|recoverFromBackup|require\(['"]electron['"]\)|require\(['"]fs['"]\)/.test(s), `${f} builds no rename and does no direct I/O`);
    }
    const companion = fs.readFileSync(path.join(ROOT, 'main', 'companionPreload.js'), 'utf8');
    assert.ok(!/photographerRegistry/.test(companion), 'the companion popup has no registry channel');
  });

  console.log(`${passed} passed`);
})();
