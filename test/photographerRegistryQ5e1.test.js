'use strict';

// AI-FEAT-063 / AI-RM-014 Q5e-1 — photographer profile management: search aliases (add, remove,
// keep a learned shortcut), retire / reactivate (photographer-status-set), explicit first
// registration, and the READ-ONLY rename preview with current-event folder detection.
// Real Q4 store + fake secure storage in temp folders; synthetic names, IDs and folders only.
//
// Run: node test/photographerRegistryQ5e1.test.js

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createIdentityRegistryStore } = require('../services/identityRegistryStore');
const { createEvent, validateEvent } = require('../services/identityEvents');
const { deriveRegistryState } = require('../services/associationModel');
const P = require('../services/photographerIdentity');
const N = require('../services/photographerNameModel');
const { slugify } = require('../main/aliasEngine');
const { inspectRegistryFiles } = require('../services/identityRegistryInspector');
const V = require('../services/photographerRegistryView');
const { suggestForCamera } = require('../services/photographerSuggestion');
const { createRegistryBrowser, assertRendererSafe } = require('../services/photographerRegistryBrowser');
const { createRegistryManager } = require('../services/photographerRegistryManager');
const { createProfileActions } = require('../services/photographerProfileActions');
const { resolveEventCopies } = require('../services/eventCopyResolver');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

const THIS = 'fake-computer-THIS-q5e1';
const OTHER = 'fake-computer-OTHER-q5e1';
const OP = { id: 'user_q5e1op_ab12', name: 'Operator Q5e1' };
const SERIAL = 'FAKEQ5E1-R5-0001';
const digestOf = (s) => crypto.createHash('sha256').update(`fake-digest|${s}`).digest('hex');
const IDENTITY = 'q5e1-test-app';
const fakeSecureStorage = () => ({
  backend: 'fake-test', identity: IDENTITY, isAvailable: () => true,
  encrypt: (buf) => Buffer.concat([Buffer.from('SEALED:'), Buffer.from(buf.map(b => b ^ 0x5a))]),
  decrypt: (c) => Buffer.from(c.subarray(7).map(b => b ^ 0x5a)),
});
const tmp = (tag) => fsp.mkdtemp(path.join(os.tmpdir(), `ai-q5e1-${tag}-`));

async function treeHash(root) {
  const out = {};
  async function walk(d) {
    let es; try { es = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      const st = await fsp.lstat(p);
      out[path.relative(root, p)] = e.isDirectory() ? `d:${st.mtimeMs}` : `f:${st.mtimeMs}:${crypto.createHash('sha256').update(await fsp.readFile(p)).digest('hex')}`;
      if (e.isDirectory()) await walk(p);
    }
  }
  await walk(root);
  return out;
}

const SHIPPED = ['Test Shipped Alpha', 'Test Shipped Beta'];
const OVERRIDE = ['Kay Current', 'Local Gamma', 'Zed Pending', 'Other Listname'];
const ID = {
  alpha: P.shippedPhotographerId('Test Shipped Alpha'),
  beta: P.shippedPhotographerId('Test Shipped Beta'),
  kay: '7a7a7a7a-1111-4222-8333-444444444441',
  gamma: '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5e',
  d1: 'd1d1d1d1-0000-4000-8000-0000000000e1',
};
const SHORTCUTS = { [slugify('Kay Current')]: ['kc', 'kayc'], [slugify('Local Gamma')]: ['lg', 'kayc'] };

async function seed(dir) {
  const store = createIdentityRegistryStore({ dir, secureStorage: fakeSecureStorage(), computerId: THIS });
  assert.equal((await store.open()).state, 'ready');
  const keyId = JSON.parse(fs.readFileSync(path.join(dir, 'registry.json'), 'utf8')).keyIds[0];
  const ev = (type, payload, at, extra = {}) => createEvent(type, payload, { origin: { computerId: THIS, operatorId: OP.id, workflow: 'event-import', ...extra }, at });
  assert.equal((await store.appendEvents([
    ev('photographer-registered', { photographerId: ID.kay, name: 'Kay Old', idOrigin: 'random' }, '2026-09-01T00:00:00Z'),
    ev('photographer-renamed', { photographerId: ID.kay, fromName: 'Kay Old', toName: 'Kay Current' }, '2026-09-10T00:00:00Z', { workflow: 'registry' }),
    ev('photographer-registered', { photographerId: ID.gamma, name: 'Local Gamma', idOrigin: 'random' }, '2026-09-02T00:00:00Z'),
    ev('device-registered', { deviceId: ID.d1, make: 'Canon', modelKey: 'canon eos r5', modelDisplay: 'EOS R5', identifiers: [{ ns: 'exif.bodySerial', keyId, digest: digestOf(SERIAL), trusted: true }] }, '2026-10-01T00:00:00Z'),
    ev('association-confirmed', { photographerId: ID.kay, deviceId: ID.d1, resolves: [] }, '2026-10-02T00:00:00Z', { workflow: 'registry' }),
  ])).ok, true);
  await store.close();
  return { keyId };
}

async function fixture({ operator = OP, seedIt = true, eventRoots = null } = {}) {
  const root = await tmp('fx');
  const dir = path.join(root, 'identity-registry');
  const fx = { root, dir, store: null, operator };
  if (seedIt) Object.assign(fx, await seed(dir));
  // A learned-shortcut file next to the registry: it must never be written.
  fx.aliasesFile = path.join(root, 'photographers.aliases.json');
  fs.writeFileSync(fx.aliasesFile, JSON.stringify(SHORTCUTS));
  const names = () => ({ listNames: [...SHIPPED, ...OVERRIDE], shippedNames: SHIPPED, learnedShortcuts: JSON.parse(fs.readFileSync(fx.aliasesFile, 'utf8')) });
  fx.loadView = async () => {
    const st = fx.store && fx.store.getStatus();
    const registry = st && st.state === 'ready'
      ? { state: 'ready', reason: null, events: fx.store.getEvents(), keyStatus: st.keyStatus, keyVerified: true, heldCount: 0, unknownTypeEvents: 0 }
      : await inspectRegistryFiles({ dir, expectedIdentity: IDENTITY });
    const n = names();
    const view = V.buildRegistryView({ registry, listNames: n.listNames, shippedNames: SHIPPED, learnedShortcuts: n.learnedShortcuts, operators: [OP], thisComputerId: THIS, learning: { enabled: true, pendingCount: 0 } });
    return { view, events: registry.state === 'ready' || registry.state === 'locked' ? registry.events : [], shippedNames: SHIPPED };
  };
  fx.openStore = async () => {
    const reg = await inspectRegistryFiles({ dir, expectedIdentity: IDENTITY });
    if (!(fx.store && fx.store.getStatus().state === 'ready') && reg.state !== 'ready') return { ok: false, reason: reg.state === 'missing' ? 'no-registry' : `registry-${reg.state}` };
    if (!fx.store) fx.store = createIdentityRegistryStore({ dir, secureStorage: fakeSecureStorage(), computerId: THIS });
    if (fx.store.getStatus().state !== 'ready') { await fx.store.close(); await fx.store.open({ initialize: false }); }
    const st = fx.store.getStatus();
    return st.state === 'ready' ? { ok: true, store: fx.store } : { ok: false, reason: st.reason === 'locked-by-another-process' ? 'registry-locked' : 'registry-unavailable' };
  };
  let manager = null;
  fx.browser = createRegistryBrowser({ loadView: fx.loadView, manageStatus: (v) => manager.availability(v) });
  fx.manager = manager = createRegistryManager({
    browser: fx.browser, getOperator: () => fx.operator, getComputerId: () => THIS, openStore: fx.openStore,
    profile: createProfileActions({ getNames: names }), getListNames: () => names().listNames,
    resolveCopies: eventRoots ? (p) => resolveEventCopies(p, eventRoots) : null,
  });
  await fx.browser.load();
  fx.person = (name, nth = 0) => fx.browser.search({ query: name }).results.filter(r => r.name === name)[nth].handle;
  fx.profile = (name) => fx.browser.photographer(fx.person(name)).profile;
  fx.events = () => JSON.parse(fs.readFileSync(path.join(dir, 'registry.json'), 'utf8')).events;
  fx.state = () => deriveRegistryState(fx.events(), { shipped: P.bootstrapShippedIds(SHIPPED) });
  fx.close = async () => { if (fx.store) await fx.store.close(); };
  return fx;
}

const SECRETS = [...Object.values(ID), SERIAL, digestOf(SERIAL), THIS, OTHER, OP.id];
function clean(payload, fx, label) {
  const json = JSON.stringify(payload);
  for (const s of [...SECRETS, fx.keyId, fx.root, os.tmpdir()].filter(Boolean)) assert.ok(!json.includes(s), `${label}: leaked ${String(s).slice(0, 14)}…`);
  assertRendererSafe(payload);
  return payload;
}
async function act(fx, request, label = request.action) {
  const prep = clean(fx.manager.prepare(request), fx, `${label} prepare`);
  if (!prep.ok) return { prep };
  return { prep, res: clean(await fx.manager.commit(prep.token), fx, `${label} commit`) };
}

/** A synthetic event with a local staging copy and a NAS copy (same structure). */
async function eventTree({ qmz = false } = {}) {
  const base = await tmp('archive');
  const stagingRoot = path.join(base, 'staging');
  const nasRoot = path.join(base, 'nas');
  const comps = ['A-Day1', 'B-Day2', 'C-Day3'];
  for (const r of [stagingRoot, nasRoot]) {
    const ev = path.join(r, 'Coll-2026', 'Event-Q5e1');
    for (const c of comps) fs.mkdirSync(path.join(ev, c), { recursive: true });
    fs.writeFileSync(path.join(ev, 'event.json'), JSON.stringify({ name: 'Event-Q5e1', components: comps.map(folderName => ({ folderName })) }));
    fs.mkdirSync(path.join(ev, 'A-Day1', 'PC03-Kay Current'));
    fs.writeFileSync(path.join(ev, 'A-Day1', 'PC03-Kay Current', 'IMG_0001.JPG'), 'x');
    fs.mkdirSync(path.join(ev, 'B-Day2', 'PC05-Kay Old'));
    fs.mkdirSync(path.join(ev, 'B-Day2', 'PC06-Kay Curent'));       // similar spelling — never chosen
    fs.mkdirSync(path.join(ev, 'C-Day3', 'PC01-Kay Current'));      // two candidates in one scope
    fs.mkdirSync(path.join(ev, 'C-Day3', 'PC02-Kay Old'));
    fs.mkdirSync(path.join(ev, 'C-Day3', '_Unsequenced'));           // QMZ structure, excluded
    if (qmz) fs.writeFileSync(path.join(ev, 'qmz-sequences.json'), '{}');
  }
  return { base, stagingRoot, nasRoot, eventPath: path.join(stagingRoot, 'Coll-2026', 'Event-Q5e1') };
}
const notFoundLink = async () => ({ ok: false, link: null, reason: 'not-found' });

(async () => {
  console.log('Q5e-1 — status model (pure)');

  await t('photographer-status-set: valid event, derived status, disputed when unsettled, retired excluded from suggestions', async () => {
    const o = (at, c = THIS) => ({ origin: { computerId: c, operatorId: OP.id, workflow: 'registry' }, at });
    const reg = createEvent('photographer-registered', { photographerId: ID.kay, name: 'Kay Current', idOrigin: 'random' }, o('2026-09-01T00:00:00Z'));
    const dev = createEvent('device-registered', { deviceId: ID.d1, make: 'Canon', modelKey: 'canon eos r5', modelDisplay: 'EOS R5', identifiers: [{ ns: 'exif.bodySerial', keyId: 'local-0123456789abcdef', digest: digestOf(SERIAL), trusted: true }] }, o('2026-09-01T00:00:01Z'));
    const conf = createEvent('association-confirmed', { photographerId: ID.kay, deviceId: ID.d1, resolves: [] }, o('2026-09-02T00:00:00Z'));
    const r1 = createEvent('photographer-status-set', { photographerId: ID.kay, status: 'retired', resolves: [] }, o('2026-09-03T00:00:00Z'));
    assert.equal(validateEvent(r1).ok, true);
    assert.equal(validateEvent({ ...r1, status: 'deleted' }).ok, false, 'only active/retired');
    let evs = [reg, dev, conf, r1];
    let state = deriveRegistryState(evs, { shipped: P.bootstrapShippedIds([]) });
    assert.equal(N.deriveProfileStatus(evs, { state }).get(ID.kay).status, 'retired');
    const sug = suggestForCamera(state, { kind: 'body', deviceId: ID.d1 }, { retired: N.retiredIds(evs, { state }) });
    assert.equal(sug.level, 'none', 'a retired photographer is not suggested');
    assert.deepEqual(sug.excluded.map(x => x.reason), ['Photographer profile is retired']);
    assert.equal(state.associations.get(`${ID.d1}|${ID.kay}`).state, 'confirmed', 'the association itself is unchanged');
    assert.equal(suggestForCamera(state, { kind: 'body', deviceId: ID.d1 }).level, 'strong', 'without the option Q4 behaviour is unchanged');
    const a2 = createEvent('photographer-status-set', { photographerId: ID.kay, status: 'active', resolves: [] }, o('2026-09-04T00:00:00Z', OTHER));
    evs = [...evs, a2];
    state = deriveRegistryState(evs, { shipped: P.bootstrapShippedIds([]) });
    assert.equal(N.deriveProfileStatus(evs, { state }).get(ID.kay).status, 'disputed', 'opposite statuses that never saw each other');
    const settle = createEvent('photographer-status-set', { photographerId: ID.kay, status: 'active', resolves: [r1.eventId, a2.eventId] }, o('2026-09-05T00:00:00Z'));
    evs = [...evs, settle];
    const st = N.deriveProfileStatus(evs, { state });
    assert.equal(st.get(ID.kay).status, 'active');
    assert.equal(st.get(ID.kay).history.at(-1).settles, true);
  });

  console.log('Q5e-1 — search aliases');

  await t('add alias: preview, durable append with operator provenance, visible with history; autocomplete file untouched', async () => {
    const fx = await fixture();
    const aliasBefore = fs.readFileSync(fx.aliasesFile, 'utf8');
    const p = fx.profile('Kay Current');
    assert.ok(p.actions.includes('alias-add') && p.actions.includes('retire') && p.actions.includes('rename-preview'));
    const { prep, res } = await act(fx, { action: 'alias-add', photographer: p.handle, alias: '  K.  Curr ', kind: 'abbreviation' });
    assert.equal(prep.preview.title, 'Add this search alias?');
    assert.ok(prep.preview.consequences.some(c => /never a name, never a folder name/.test(c)));
    assert.ok(prep.preview.consequences.some(c => /autocomplete and learned typing shortcuts are not changed/.test(c)));
    assert.equal(res.ok, true);
    assert.equal(res.message, 'Saved. “K. Curr” is now a search alias of Kay Current.');
    const e = fx.events().at(-1);
    assert.equal(e.type, 'photographer-alias-added');
    assert.equal(e.alias, 'K. Curr', 'stored trimmed, inner whitespace collapsed');
    assert.deepEqual(e.origin, { computerId: THIS, operatorId: OP.id, workflow: 'registry' });
    assert.ok(res.focus.photographer, 'the profile stays selected');
    const again = fx.browser.photographer(res.focus.photographer).profile;
    assert.deepEqual(again.searchAliases.map(a => [a.text, a.operator, a.removable]), [['K. Curr', 'Operator Q5e1', true]]);
    assert.equal(again.aliasHistory.at(-1).action, 'added');
    assert.ok(fx.browser.search({ query: 'K. Curr' }).results.some(r => r.name === 'Kay Current' && r.matchedOn === 'search-alias'), 'registry search finds it');
    assert.equal(fs.readFileSync(fx.aliasesFile, 'utf8'), aliasBefore, 'photographers.aliases.json unchanged');
    await fx.close();
  });

  await t('remove alias: leaves the active list, history keeps both the addition and the removal', async () => {
    const fx = await fixture();
    const h = fx.person('Kay Current');
    const r1 = await act(fx, { action: 'alias-add', photographer: h, alias: 'KC Alias', kind: 'other' });
    const added = fx.events().at(-1);
    const r2 = await act(fx, { action: 'alias-remove', photographer: r1.res.focus.photographer, alias: 'KC Alias' });
    assert.equal(r2.prep.preview.title, 'Remove this search alias?');
    assert.equal(r2.res.ok, true);
    const rm = fx.events().at(-1);
    assert.equal(rm.type, 'photographer-alias-removed');
    assert.deepEqual(rm.resolves, [added.eventId]);
    assert.ok(fx.events().some(e => e.eventId === added.eventId), 'the addition is still in the log');
    const p = fx.browser.photographer(r2.res.focus.photographer).profile;
    assert.deepEqual(p.searchAliases, []);
    assert.deepEqual(p.aliasHistory.map(x => [x.action, x.text]), [['added', 'KC Alias'], ['removed', 'KC Alias']]);
    await fx.close();
  });

  await t('keep a learned shortcut as a search alias through the normal alias path; shortcut file unchanged', async () => {
    const fx = await fixture();
    const before = fs.readFileSync(fx.aliasesFile, 'utf8');
    const p = fx.profile('Kay Current');
    assert.deepEqual(p.learnedShortcuts.map(s => [s.text, s.promotable]), [['kc', true], ['kayc', true]]);
    const { prep, res } = await act(fx, { action: 'alias-add', photographer: p.handle, alias: 'kayc', kind: 'abbreviation' });
    assert.ok(prep.preview.consequences.some(c => /typed this as a shortcut for Local Gamma/.test(c)), 'the other person\'s identical shortcut is pointed out');
    assert.equal(res.ok, true);
    const after = fx.browser.photographer(res.focus.photographer).profile;
    assert.equal(after.learnedShortcuts.find(s => s.text === 'kayc').promotable, false, 'already an alias now');
    assert.deepEqual(after.learnedShortcuts.map(s => s.text), ['kc', 'kayc'], 'shortcuts are still shown separately');
    assert.equal(fs.readFileSync(fx.aliasesFile, 'utf8'), before);
    await fx.close();
  });

  await t('identical alias on two photographers: allowed with a warning, both shown, search selects none, review item raised', async () => {
    const fx = await fixture();
    await act(fx, { action: 'alias-add', photographer: fx.person('Kay Current'), alias: 'TS', kind: 'abbreviation' });
    const { prep, res } = await act(fx, { action: 'alias-add', photographer: fx.person('Local Gamma'), alias: 'ts', kind: 'abbreviation' });
    assert.ok(prep.preview.consequences.some(c => /Also a search alias of Kay Current.*select none/.test(c)));
    assert.equal(res.ok, true);
    const g = fx.profile('Local Gamma');
    assert.deepEqual(g.searchAliases[0].sharedWith.map(x => x.name), ['Kay Current']);
    const s = fx.browser.search({ query: 'ts' });
    assert.equal(s.ambiguous, true);
    assert.ok(fx.browser.overview().reviewItems.some(r => r.kind === 'shared-search-alias'));
    await fx.close();
  });

  await t('alias validation: own/other official names, another list name, empty, too long, invisible characters', async () => {
    const fx = await fixture();
    const h = fx.person('Kay Current');
    const r = (alias) => fx.manager.prepare({ action: 'alias-add', photographer: h, alias, kind: 'spelling' });
    assert.equal(r('Kay Old').blocking[0].kind, 'alias-is-official-name', 'own former name');
    const other = r('Local Gamma');
    assert.equal(other.reason, 'alias-rejected');
    assert.ok(other.blocking.some(b => /another photographer/.test(b.text)));
    assert.equal(r('Zed Pending').blocking[0].kind, 'alias-is-list-name-of-another', 'another photographer-list name, even without a record');
    assert.equal(r('   ').blocking[0].kind, 'empty-alias');
    assert.equal(r('x'.repeat(81)).blocking[0].kind, 'too-long');
    assert.equal(r('K​C').blocking[0].kind, 'invisible-or-control-characters');
    clean(other, fx, 'refusal');
    await fx.close();
  });

  console.log('Q5e-1 — retire / reactivate');

  await t('retire: status event, history, camera suggestions stop, names/aliases/cameras/list unchanged; reactivate restores', async () => {
    const fx = await fixture();
    const listBefore = JSON.stringify(fx.browser.search({}).results.map(r => r.name).sort());
    const cam = fx.browser.overview().cameras[0].handle;
    assert.equal(fx.browser.camera(cam).camera.suggestion.level, 'strong');
    const { prep, res } = await act(fx, { action: 'status', photographer: fx.person('Kay Current'), status: 'retired' });
    assert.equal(prep.preview.title, 'Retire this photographer profile?');
    assert.ok(prep.preview.consequences.some(c => /not a deletion/.test(c)) && prep.preview.consequences.some(c => /autocomplete and photographer selection are not changed/.test(c)));
    assert.equal(res.ok, true);
    assert.equal(res.message, 'Saved. Kay Current is retired. Nothing was deleted.');
    const e = fx.events().at(-1);
    assert.deepEqual([e.type, e.status, e.resolves, e.origin.operatorId], ['photographer-status-set', 'retired', [], OP.id]);
    const p = fx.browser.photographer(res.focus.photographer).profile;
    assert.equal(p.status, 'retired');
    assert.ok(p.actions.includes('reactivate') && !p.actions.includes('retire'));
    assert.deepEqual(p.statusHistory.map(h => [h.status, h.operator]), [['retired', 'Operator Q5e1']]);
    assert.deepEqual([p.name, p.formerNames, p.cameras.length], ['Kay Current', ['Kay Old'], 1], 'names and cameras kept');
    assert.ok(fx.browser.search({ filter: 'retired' }).results.some(r => r.name === 'Kay Current'), 'retired filter works');
    assert.equal(JSON.stringify(fx.browser.search({}).results.map(r => r.name).sort()), listBefore, 'still in the photographer list');
    const camAfter = fx.browser.camera(fx.browser.overview().cameras[0].handle).camera;
    assert.equal(camAfter.suggestion.level, 'none', 'no longer suggested from camera evidence');
    assert.equal(camAfter.associations[0].state, 'confirmed', 'association unchanged');
    const back = await act(fx, { action: 'status', photographer: res.focus.photographer, status: 'active' });
    assert.equal(back.prep.preview.title, 'Reactivate this photographer profile?');
    assert.equal(back.res.ok, true);
    assert.deepEqual(fx.events().at(-1).resolves, [e.eventId], 'the reactivation settles the retirement it saw');
    assert.equal(fx.browser.camera(fx.browser.overview().cameras[0].handle).camera.suggestion.level, 'strong');
    assert.equal(fx.manager.prepare({ action: 'status', photographer: back.res.focus.photographer, status: 'active' }).reason, 'status-unchanged');
    await fx.close();
  });

  await t('disputed status (retired here, active elsewhere) is listed for review and settled with resolves = both', async () => {
    const fx = await fixture();
    await fx.openStore();
    const o = (at, c) => ({ origin: { computerId: c, operatorId: OP.id, workflow: 'registry' }, at });
    const a = createEvent('photographer-status-set', { photographerId: ID.gamma, status: 'retired', resolves: [] }, o('2026-10-05T00:00:00Z', THIS));
    const b = createEvent('photographer-status-set', { photographerId: ID.gamma, status: 'active', resolves: [] }, o('2026-10-05T01:00:00Z', OTHER));
    assert.equal((await fx.store.appendEvents([a, b])).ok, true);
    await fx.browser.load();
    const item = fx.browser.overview().reviewItems.find(r => r.kind === 'photographer-status-disputed');
    assert.ok(item);
    assert.deepEqual(item.resolution.options.map(x => x.id), ['active', 'retired']);
    const g = fx.profile('Local Gamma');
    assert.equal(g.statusDisputed, true);
    assert.ok(!g.actions.includes('retire') && !g.actions.includes('reactivate'), 'settled from the review item, not by a plain toggle');
    const { res } = await act(fx, { action: 'resolve-review', review: item.id, outcome: 'retired' });
    assert.equal(res.ok, true);
    assert.deepEqual([...fx.events().at(-1).resolves].sort(), [a.eventId, b.eventId].sort());
    assert.equal(fx.profile('Local Gamma').status, 'retired');
    await fx.close();
  });

  console.log('Q5e-1 — safety');

  await t('stale revision, duplicate commits, missing or changed operator', async () => {
    const fx = await fixture();
    const h = fx.person('Kay Current');
    const prep = fx.manager.prepare({ action: 'alias-add', photographer: h, alias: 'Stale One', kind: 'other' });
    await fx.openStore();
    const other = createEvent('photographer-alias-added', { photographerId: ID.kay, alias: 'Someone Else Added', kind: 'other' }, { origin: { computerId: OTHER, operatorId: null, workflow: 'registry' }, at: '2026-11-01T00:00:00Z' });
    assert.equal((await fx.store.appendEvents([other])).ok, true);
    const n = fx.events().length;
    const stale = clean(await fx.manager.commit(prep.token), fx, 'stale');
    assert.equal(stale.reason, 'registry-changed');
    assert.equal(fx.events().length, n, 'nothing appended over the other change');
    const h2 = stale.focus.photographer;
    const p2 = fx.manager.prepare({ action: 'alias-add', photographer: h2, alias: 'Once Only', kind: 'other' });
    const [x, y] = await Promise.all([fx.manager.commit(p2.token), fx.manager.commit(p2.token)]);
    assert.equal(x.ok, true);
    assert.equal(y.duplicate, true);
    assert.equal(fx.events().filter(e => e.alias === 'Once Only').length, 1);
    fx.operator = null;
    await fx.browser.load();
    const p = fx.profile('Kay Current');
    assert.deepEqual(p.actions, ['rename-preview'], 'without an operator only the read-only preview remains');
    assert.equal(fx.manager.prepare({ action: 'status', photographer: p.handle, status: 'retired' }).reason, 'no-operator');
    fx.operator = OP;
    await fx.browser.load();
    const p3 = fx.manager.prepare({ action: 'status', photographer: fx.person('Kay Current'), status: 'retired', operatorId: 'forged' });
    fx.operator = { id: 'user_other_9999', name: 'Other' };
    assert.equal((await fx.manager.commit(p3.token)).reason, 'operator-changed');
    assert.ok(!fx.events().some(e => e.origin.operatorId === 'forged'));
    await fx.close();
  });

  await t('unregistered list name: browsable, no ID invented by viewing; explicit registration creates one record, then aliases work', async () => {
    const fx = await fixture();
    const n0 = fx.events().length;
    const p = fx.profile('Zed Pending');
    assert.equal(p.identity, 'pending-first-use');
    assert.equal(p.registered, false);
    assert.deepEqual(p.actions, ['register'], 'only registration is offered');
    assert.equal(fx.events().length, n0, 'opening the profile wrote nothing');
    assert.equal(fx.manager.prepare({ action: 'alias-add', photographer: p.handle, alias: 'ZP', kind: 'other' }).reason, 'registration-required');
    assert.equal(fx.manager.prepare({ action: 'status', photographer: p.handle, status: 'retired' }).reason, 'registration-required');
    const { prep, res } = await act(fx, { action: 'register', photographer: p.handle });
    assert.equal(prep.preview.title, 'Create a registry record for this photographer?');
    assert.ok(prep.preview.consequences.some(c => /photographer list, its spelling and existing archives are not changed/.test(c)));
    assert.equal(res.ok, true);
    assert.equal(res.message, 'Saved. Zed Pending now has a registry record.');
    const e = fx.events().at(-1);
    assert.deepEqual([e.type, e.name, e.idOrigin, e.origin.operatorId, e.origin.workflow], ['photographer-registered', 'Zed Pending', 'random', OP.id, 'registry']);
    const reg = fx.browser.photographer(res.focus.photographer).profile;
    assert.equal(reg.identity, 'registered');
    assert.ok(reg.actions.includes('alias-add'));
    assert.equal((await act(fx, { action: 'alias-add', photographer: reg.handle, alias: 'ZP', kind: 'abbreviation' })).res.ok, true);
    await fx.close();
  });

  await t('missing, corrupt and locked registries: no profile changes, nothing created or replaced', async () => {
    const none = await fixture({ seedIt: false });
    assert.deepEqual(none.profile('Test Shipped Alpha').actions, ['rename-preview'], 'read-only preview only');
    assert.deepEqual(none.profile('Kay Current').actions, [], 'without a registry this list name has no record, and none is offered');
    assert.equal(none.manager.prepare({ action: 'register', photographer: none.person('Zed Pending') }).reason, 'no-registry');
    assert.equal(fs.existsSync(none.dir), false, 'no registry created by profile actions');
    const bad = await fixture();
    fs.writeFileSync(path.join(bad.dir, 'registry.json'), '{ broken');
    const before = await treeHash(bad.dir);
    await bad.browser.load();
    assert.equal(bad.browser.overview().management.reason, 'registry-corrupt');
    assert.equal(bad.manager.prepare({ action: 'alias-add', photographer: bad.person('Local Gamma'), alias: 'LG2' }).reason, 'registry-corrupt');
    assert.deepEqual(await treeHash(bad.dir), before);
    const lk = await fixture();
    const prep = lk.manager.prepare({ action: 'alias-add', photographer: lk.person('Local Gamma'), alias: 'LG Locked', kind: 'other' });
    fs.writeFileSync(path.join(lk.dir, 'registry.lock'), JSON.stringify({ pid: process.ppid, token: 'x', at: '2026-11-01T00:00:00Z' }));
    assert.equal((await lk.manager.commit(prep.token)).reason, 'registry-locked');
    assert.ok(!lk.events().some(e => e.alias === 'LG Locked'));
  });

  console.log('Q5e-1 — rename preview (read-only)');

  await t('rename validation: exact stored spelling, list spelling, collisions with current and former names, never applied', async () => {
    const fx = await fixture();
    const pv = async (name) => clean(await fx.manager.renamePreview({ photographer: fx.person('Kay Current'), name }), fx, 'preview');
    const a = await pv('  kay   newname ');
    assert.equal(a.previewOnly, true);
    assert.equal(a.canApply, false);
    assert.match(a.notice, /^Preview only — applying photographer name changes will be available after archive safety checks are completed\.$/);
    assert.deepEqual(a.proposed, { typed: '  kay   newname ', storedName: 'kay newname', listSpelling: 'Kay Newname', recapitalised: true });
    assert.equal(a.valid, true);
    assert.deepEqual(a.formerNames, ['Kay Old']);
    assert.deepEqual(a.unmet.map(u => u.id), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']);
    assert.equal(a.folders.reason, 'no-current-event', 'no event → profile-only preview');
    const taken = await pv('Local Gamma');
    assert.equal(taken.valid, false);
    assert.ok(taken.blocking.some(b => b.kind === 'name-exists'));
    const ownFormer = await pv('Kay Old');
    assert.equal(ownFormer.blocking.some(b => b.kind === 'former-name-of-another' || b.kind === 'name-exists'), false, 'returning to its own former name is allowed');
    await act(fx, { action: 'register', photographer: fx.person('Zed Pending') });
    // Make "Gamma Old" a former name of another person, then try it.
    await fx.openStore();
    await fx.store.appendEvents([createEvent('photographer-renamed', { photographerId: ID.gamma, fromName: 'Local Gamma', toName: 'Gamma Newer' }, { origin: { computerId: THIS, operatorId: OP.id, workflow: 'registry' }, at: '2026-11-03T00:00:00Z' })]);
    await fx.browser.load();
    const former = clean(await fx.manager.renamePreview({ photographer: fx.person('Kay Current'), name: 'Local Gamma' }), fx, 'former');
    assert.ok(former.blocking.some(b => b.kind === 'former-name-of-another'), 'another photographer\'s former name is blocked');
    const bad = await pv('PC07-Kay');
    assert.ok(bad.blocking.some(b => b.kind === 'looks-like-sequence-prefix'));
    const slash = clean(await fx.manager.renamePreview({ photographer: fx.person('Kay Current'), name: 'Kay/Name.' }), fx, 'slash');
    assert.ok(slash.blocking.some(b => b.kind === 'invalid-folder-characters') && slash.blocking.some(b => b.kind === 'trailing-dot-or-space'));
    assert.equal(fx.manager.prepare({ action: 'rename', photographer: fx.person('Kay Current'), name: 'X' }).reason, 'unsupported-action', 'no rename action exists');
    assert.ok(!fx.events().some(e => e.type === 'photographer-renamed' && e.photographerId === ID.kay && e.at > '2026-10-01'), 'no effective profile rename');
    await fx.close();
  });

  await t('current-event folders: components, local + NAS copies, PCxx kept, similar and multiple candidates never chosen, QMZ excluded, nothing written', async () => {
    const tree = await eventTree();
    const fx = await fixture({ eventRoots: { stagingRoot: tree.stagingRoot, nasRoot: tree.nasRoot, archiveRoots: [], readLink: notFoundLink } });
    const before = await treeHash(tree.base);
    const h = fx.person('Kay Current');
    const r = clean(await fx.manager.renamePreview({ photographer: h, name: 'Kay Newname', eventPath: tree.eventPath }), fx, 'folders');
    assertRendererSafe(r);
    assert.ok(!JSON.stringify(r).includes(tree.base), 'no absolute path in the payload');
    const f = r.folders;
    assert.equal(f.available, true);
    assert.deepEqual(f.copies.map(c => [c.label, c.state]), [['Local staging copy', 'available'], ['NAS copy', 'available']], 'same event on staging and NAS');
    for (const cp of f.copies) {
      const byScope = Object.fromEntries(cp.scopes.map(s => [s.scope, s]));
      const a = byScope['A-Day1'].candidates;
      assert.deepEqual(a.map(c => [c.folderName, c.proposedFolderName, c.match, c.proposed, c.sequencePrefix]), [['PC03-Kay Current', 'PC03-Kay Newname', 'current-name', true, 'PC03']], 'definite match keeps PC03');
      const b = byScope['B-Day2'].candidates;
      assert.deepEqual(b.find(c => c.folderName === 'PC05-Kay Old').proposed, true, 'a former-name folder is a definite match');
      assert.deepEqual(b.find(c => c.folderName === 'PC06-Kay Curent').match, 'similar-spelling');
      assert.equal(b.find(c => c.folderName === 'PC06-Kay Curent').proposed, false, 'similar spelling never chosen');
      const c = byScope['C-Day3'];
      assert.equal(c.multipleCandidates, true);
      assert.ok(c.candidates.every(x => !x.proposed), 'two candidates in one scope: none chosen');
      assert.deepEqual(c.excluded, [{ folderName: '_Unsequenced', reason: 'qmz-structure' }]);
    }
    assert.ok(f.blockers.includes('multiple-candidate-folders'));
    assert.deepEqual(await treeHash(tree.base), before, 'no folder, event.json or file changed');
    const noEvent = clean(await fx.manager.renamePreview({ photographer: h, name: 'Kay Newname', eventPath: null }), fx, 'no event');
    assert.equal(noEvent.folders.reason, 'no-current-event');
    const outside = clean(await fx.manager.renamePreview({ photographer: h, name: 'Kay Newname', eventPath: os.homedir() }), fx, 'outside');
    assert.equal(outside.folders.reason, 'outside-archive-roots', 'an event outside the configured roots is never scanned');
    const invalidName = clean(await fx.manager.renamePreview({ photographer: h, name: 'Local Gamma', eventPath: tree.eventPath }), fx, 'invalid');
    assert.equal(invalidName.folders.reason, 'name-not-valid');
    await fx.close();
  });

  await t('QMZ event and unreachable NAS copy are reported, never guessed', async () => {
    const tree = await eventTree({ qmz: true });
    const fx = await fixture({ eventRoots: { stagingRoot: tree.stagingRoot, nasRoot: tree.nasRoot, archiveRoots: [], readLink: notFoundLink } });
    const r = await fx.manager.renamePreview({ photographer: fx.person('Kay Current'), name: 'Kay Newname', eventPath: tree.eventPath });
    assert.ok(r.folders.copies.every(c => c.state === 'qmz-excluded'));
    assert.ok(r.folders.blockers.includes('qmz-structure-excluded'));
    // Provisional collection link: the NAS copy is not derived.
    const tree2 = await eventTree();
    const prov = await resolveEventCopies(tree2.eventPath, { stagingRoot: tree2.stagingRoot, nasRoot: tree2.nasRoot, readLink: async () => ({ ok: true, link: { status: 'provisional' } }) });
    assert.deepEqual(prov.copies.map(c => [c.kind, c.root === null, c.reason]), [['local-staging', false, null], ['nas', true, 'collection-not-matched-to-nas']]);
    const stale = await resolveEventCopies(tree2.eventPath, { stagingRoot: tree2.stagingRoot, nasRoot: tree2.nasRoot, readLink: async () => ({ ok: true, link: { status: 'linked', nasRoot: '/elsewhere', nasCollectionPath: '/elsewhere/C' } }) });
    assert.equal(stale.copies[1].reason, 'collection-link-stale');
    const linked = await resolveEventCopies(tree2.eventPath, { stagingRoot: tree2.stagingRoot, nasRoot: tree2.nasRoot, readLink: async () => ({ ok: true, link: { status: 'linked', nasRoot: tree2.nasRoot, nasCollectionPath: path.join(tree2.nasRoot, 'Coll-2026') } }) });
    assert.equal(linked.copies[1].root, path.join(tree2.nasRoot, 'Coll-2026', 'Event-Q5e1'));
    fs.rmSync(path.join(tree2.nasRoot, 'Coll-2026'), { recursive: true });
    const gone = await resolveEventCopies(tree2.eventPath, { stagingRoot: tree2.stagingRoot, nasRoot: tree2.nasRoot, readLink: notFoundLink });
    assert.equal(gone.copies[1].reason, 'nas-copy-unreachable');
    const fx2 = await fixture({ eventRoots: { stagingRoot: tree2.stagingRoot, nasRoot: tree2.nasRoot, archiveRoots: [], readLink: notFoundLink } });
    const r2 = await fx2.manager.renamePreview({ photographer: fx2.person('Kay Current'), name: 'Kay Newname', eventPath: tree2.eventPath });
    assert.ok(r2.folders.blockers.includes('event-copy-unavailable'), 'an unreachable copy blocks a future rename');
    await fx.close(); await fx2.close();
  });

  console.log(`${passed} passed`);
})();
