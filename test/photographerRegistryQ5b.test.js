'use strict';

// AI-FEAT-063 / AI-RM-014 Q5b — identity continuity, official name history, registry search
// aliases, gated profile commands and the read-only current-event folder rename planner.
// Registries use the REAL Q4 store with a FAKE secure storage; archives are synthetic temp
// folders. Every name, serial and computer ID here is synthetic.
//
// Run: node test/photographerRegistryQ5b.test.js

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
const N = require('../services/photographerNameModel');
const C = require('../services/photographerProfileCommands');
const { planCurrentEventFolderRename } = require('../services/photographerFolderRenamePlanner');
const { renameGate, PREREQUISITES, SAFETY_REQUIREMENTS } = require('../services/photographerRenameContract');
const V = require('../services/photographerRegistryView');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

const THIS = 'fake-computer-THIS-q5b';
const OTHER = 'fake-computer-OTHER-q5b';
const OP = 'op-q5b-1';
const ROOT = path.join(__dirname, '..');
const tmp = (tag) => fsp.mkdtemp(path.join(os.tmpdir(), `ai-q5b-${tag}-`));
const digestOf = (s) => crypto.createHash('sha256').update(`fake-digest|${s}`).digest('hex');
const fakeSecureStorage = () => ({
  backend: 'fake-test', identity: 'q5b-test-app', isAvailable: () => true,
  encrypt: (buf) => Buffer.concat([Buffer.from('SEALED:'), Buffer.from(buf.map(b => b ^ 0x5a))]),
  decrypt: (c) => Buffer.from(c.subarray(7).map(b => b ^ 0x5a)),
});

const SHIPPED = ['Test Shipped Alpha', 'Test Shipped Beta', 'M. Testname'];
const ALPHA = P.shippedPhotographerId('Test Shipped Alpha');
const MURTAZA = P.shippedPhotographerId('M. Testname');
const D1 = 'd1d1d1d1-0000-4000-8000-000000000001';
const D2 = 'd2d2d2d2-0000-4000-8000-000000000002';
const regOrigin = (computerId = THIS, operatorId = OP) => ({ computerId, operatorId, workflow: 'registry' });
let seq = 0;
const ev = (type, payload, { at, computerId = THIS, operatorId = OP, workflow = 'registry' } = {}) =>
  createEvent(type, payload, { origin: { computerId, operatorId, workflow }, at: at || `2026-10-01T00:${String(Math.floor(seq / 60) % 60).padStart(2, '0')}:${String(seq++ % 60).padStart(2, '0')}Z` });

async function openStore(dir) {
  const store = createIdentityRegistryStore({ dir: dir || await tmp('reg'), secureStorage: fakeSecureStorage(), computerId: THIS });
  assert.equal((await store.open()).state, 'ready');
  return store;
}
const keyIdOf = (store) => JSON.parse(fs.readFileSync(store.paths.registryFile, 'utf8')).keyIds[0];
const registryBytes = (store) => fs.readFileSync(store.paths.registryFile, 'utf8');
const ensure = (store, name, listNames, shippedNames = SHIPPED) => store.ensurePhotographerId(name, { listNames, shippedNames, origin: { computerId: THIS, operatorId: OP, workflow: 'event-import' }, at: '2026-10-02T00:00:00Z' });

async function snapshot(root) {
  const out = {};
  async function walk(d) {
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      const st = await fsp.lstat(p);
      out[path.relative(root, p)] = `${e.isDirectory() ? 'd' : 'f'}:${st.size}:${st.mtimeMs}:${st.mode}`;
      if (e.isDirectory()) await walk(p);
    }
  }
  await walk(root);
  return out;
}
/** fs.promises that allows ONLY readdir / readFile / stat; anything else fails the test. */
const READ_ONLY = new Set(['readdir', 'readFile', 'stat']);
const calls = [];
const readOnlyFs = new Proxy(fsp, {
  get(target, prop) {
    if (READ_ONLY.has(prop)) return (...a) => { calls.push(prop); return target[prop](...a); };
    return () => { throw new Error(`planner called fs.${String(prop)}`); };
  },
});
async function mkEvent(root, { components = [], dirs = [], files = {} } = {}) {
  await fsp.mkdir(root, { recursive: true });
  await fsp.writeFile(path.join(root, 'event.json'), JSON.stringify({ name: 'Synthetic Event', components: components.map(folderName => ({ folderName })) }));
  for (const d of dirs) { await fsp.mkdir(path.join(root, d), { recursive: true }); await fsp.writeFile(path.join(root, d, 'IMG_0001.JPG'), 'synthetic'); }
  for (const [f, body] of Object.entries(files)) await fsp.writeFile(path.join(root, f), body);
  return root;
}
const candidatesOf = (plan, copy = 0, scope = 0) => plan.copies[copy].scopes[scope].candidates;

(async () => {
  console.log('Q5b — permanent identity resolution (F1/F2)');

  await t('frozen shipped-ID map covers every shipped name with the UUIDv5 it already had; IDs unique', async () => {
    const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'photographer-ids.frozen.json'), 'utf8'));
    const shipped = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'photographers.json'), 'utf8'));
    assert.equal(doc.namespace, P.SHIPPED_PHOTOGRAPHER_NAMESPACE);
    const frozen = P.loadFrozenShippedIds(doc);
    assert.deepEqual(frozen.problems, []);
    for (const e of doc.entries) assert.equal(e.photographerId, P.shippedPhotographerId(e.names[0]), 'frozen ID = original deterministic ID');
    assert.equal(new Set(doc.entries.map(e => e.photographerId)).size, doc.entries.length);
    for (const name of shipped) assert.ok(frozen.byNormalized.has(P.normalizeName(name)), `shipped name without a frozen ID: add it to data/photographer-ids.frozen.json`);
    const withMap = P.bootstrapShippedIds(shipped);
    const without = P.bootstrapShippedIds(shipped, { frozen: { byNormalized: new Map() } });
    for (const [n, rec] of without.byNormalized) assert.equal(withMap.byNormalized.get(n).photographerId, rec.photographerId, 'no current shipped ID changed');
  });

  await t('a later shipped spelling correction keeps the ID: corrected and original spellings resolve to one identity', async () => {
    const original = P.shippedPhotographerId('Test Shipped Alfa');
    const frozen = P.loadFrozenShippedIds({ format: 'autoingest-shipped-photographer-ids', version: 1, entries: [{ photographerId: original, names: ['Test Shipped Alfa', 'Test Shipped Alpha'] }] });
    const s = P.bootstrapShippedIds(['Test Shipped Alpha'], { frozen });
    assert.equal(s.byNormalized.get(P.normalizeName('Test Shipped Alpha')).photographerId, original);
    assert.equal(s.byNormalized.get(P.normalizeName('Test Shipped Alfa')).photographerId, original, 'old spelling still resolves');
    const rec = s.byId.get(original);
    assert.equal(rec.name, 'Test Shipped Alpha'); assert.equal(rec.originalName, 'Test Shipped Alfa'); assert.deepEqual(rec.formerNames, ['Test Shipped Alfa']);
    const both = P.bootstrapShippedIds(['Test Shipped Alfa', 'Test Shipped Alpha'], { frozen });
    assert.equal(both.byId.size, 1); assert.equal(both.byId.get(original).name, 'Test Shipped Alpha', 'latest frozen spelling is current');
    assert.equal(both.problems[0].kind, 'shipped-spellings-share-id');
    // Without the map the corrected spelling would have become a different person.
    assert.notEqual(P.shippedPhotographerId('Test Shipped Alpha'), original);
  });

  await t('shipped photographer renamed: current and former names → the shipped ID; nothing new registered', async () => {
    const store = await openStore();
    await store.appendEvents([ev('photographer-renamed', { photographerId: MURTAZA, fromName: 'M. Testname', toName: 'Murtaza Testname' })]);
    const before = store.getEvents().length;
    const list = [...SHIPPED, 'Murtaza Testname'];
    assert.deepEqual(await ensure(store, 'Murtaza Testname', list), { ok: true, photographerId: MURTAZA, via: 'shipped' });
    assert.deepEqual(await ensure(store, 'M. Testname', list), { ok: true, photographerId: MURTAZA, via: 'former-name' });
    assert.equal((await ensure(store, 'Test Shipped Alpha', list)).photographerId, ALPHA);
    assert.equal(store.getEvents().length, before, 'Q4 bug F1 created a random ID for the new name');
    await store.close();
  });

  await t('local photographer renamed: keeps its random ID under old and new names (F2); repeated A→B→C→A stays one identity', async () => {
    const store = await openStore();
    const list = [...SHIPPED, 'Local Gamma', 'Local Gamma Renamed', 'Local Gamma Third'];
    const first = await ensure(store, 'Local Gamma', list);
    assert.equal(first.via, 'new'); const R = first.photographerId;
    await store.appendEvents([
      ev('photographer-renamed', { photographerId: R, fromName: 'Local Gamma', toName: 'Local Gamma Renamed' }, { at: '2026-10-03T00:00:00Z' }),
      ev('photographer-renamed', { photographerId: R, fromName: 'Local Gamma Renamed', toName: 'Local Gamma Third' }, { at: '2026-10-04T00:00:00Z', computerId: OTHER, operatorId: null }),
    ]);
    for (const n of ['Local Gamma', 'Local Gamma Renamed', 'Local Gamma Third']) assert.equal((await ensure(store, n, list)).photographerId, R, n);
    await store.appendEvents([ev('photographer-renamed', { photographerId: R, fromName: 'Local Gamma Third', toName: 'Local Gamma' }, { at: '2026-10-05T00:00:00Z' })]);
    for (const n of ['Local Gamma', 'Local Gamma Renamed', 'Local Gamma Third']) assert.equal((await ensure(store, n, list)).photographerId, R, `after renaming back: ${n}`);
    assert.equal(store.getEvents().filter(e => e.type === 'photographer-registered').length, 1, 'never a second identity');
    const shipped = P.bootstrapShippedIds(SHIPPED);
    const state = deriveRegistryState(store.getEvents(), { shipped });
    const h = N.deriveNameHistory(store.getEvents(), { state, shipped }).get(R);
    assert.equal(h.originalName, 'Local Gamma'); assert.equal(h.currentName, 'Local Gamma');
    assert.deepEqual([...h.formerNames].sort(), ['Local Gamma Renamed', 'Local Gamma Third']);
    assert.deepEqual(h.history.map(x => [x.fromName, x.toName, x.computerId, x.operatorId, x.stale]), [
      ['Local Gamma', 'Local Gamma Renamed', THIS, OP, false],
      ['Local Gamma Renamed', 'Local Gamma Third', OTHER, null, false],
      ['Local Gamma Third', 'Local Gamma', THIS, OP, false],
    ]);
    await store.close();
  });

  await t('search aliases and learned shortcuts never establish identity', async () => {
    const store = await openStore();
    const list = [...SHIPPED, 'Local Gamma', 'LG'];
    const R = (await ensure(store, 'Local Gamma', list)).photographerId;
    await store.appendEvents([ev('photographer-alias-added', { photographerId: R, alias: 'LG', kind: 'abbreviation' })]);
    const lg = await ensure(store, 'LG', list);
    assert.equal(lg.ok, true); assert.notEqual(lg.photographerId, R, 'an alias is not an official name');
    const shipped = P.bootstrapShippedIds(SHIPPED);
    const state = deriveRegistryState(store.getEvents(), { shipped });
    assert.ok(!N.buildOfficialNameIndex(state, shipped).get('lg').former.has(R));
    assert.ok(!N.buildOfficialNameIndex(state, shipped).get('lg').current.has(R));
    await store.close();
  });

  await t('ambiguous official names are refused, never guessed; Q4 shipped precedence kept for a current shipped name', async () => {
    const store = await openStore();
    const A = '11111111-2222-4333-8444-555555555555', B = '66666666-7777-4888-9999-aaaaaaaaaaaa', R = '77777777-7777-4777-8777-777777777777';
    await store.appendEvents([
      ev('photographer-registered', { photographerId: A, name: 'Zed Same', idOrigin: 'random' }),
      ev('photographer-registered', { photographerId: B, name: 'Zed Same', idOrigin: 'random' }, { computerId: OTHER }),
      ev('photographer-registered', { photographerId: R, name: 'Shared Former', idOrigin: 'random' }),
      ev('photographer-renamed', { photographerId: R, fromName: 'Shared Former', toName: 'Now Different' }),
      ev('photographer-registered', { photographerId: '88888888-8888-4888-8888-888888888888', name: 'Shared Former', idOrigin: 'random' }, { computerId: OTHER }),
      ev('photographer-registered', { photographerId: '99999999-9999-4999-8999-999999999999', name: 'Test Shipped Alpha', idOrigin: 'random' }, { computerId: OTHER }),
    ]);
    const list = [...SHIPPED, 'Zed Same', 'Shared Former', 'Now Different'];
    const before = store.getEvents().length;
    const z = await ensure(store, 'Zed Same', list);
    assert.equal(z.ok, false); assert.equal(z.reason, 'ambiguous'); assert.deepEqual(z.photographerIds, [A, B].sort());
    const sf = await ensure(store, 'Shared Former', list);
    assert.equal(sf.reason, 'ambiguous', 'current name of one + former name of another');
    assert.equal((await ensure(store, 'Now Different', list)).photographerId, R);
    const alpha = await ensure(store, 'Test Shipped Alpha', list);
    assert.equal(alpha.photographerId, ALPHA); assert.equal(alpha.via, 'shipped');
    assert.equal(store.getEvents().length, before, 'refusals write nothing');
    await store.close();
  });

  await t('camera associations and import observations stay attached; learning after a rename lands on the original ID', async () => {
    const store = await openStore();
    const kid = keyIdOf(store);
    const list = [...SHIPPED, 'Local Gamma', 'Local Gamma Renamed'];
    const R = (await ensure(store, 'Local Gamma', list)).photographerId;
    const learnOrigin = { computerId: THIS, operatorId: OP, workflow: 'event-import' };
    await store.appendEvents([
      createEvent('device-registered', { deviceId: D1, make: 'Canon', modelKey: 'EOSR5', modelDisplay: 'Canon EOS R5', identifiers: [{ ns: 'exif.bodySerial', keyId: kid, digest: digestOf('FAKEQ5B-0001'), trusted: true }] }, { origin: learnOrigin, at: '2026-10-02T01:00:00Z' }),
      createEvent('import-observed', { importId: 'imp-q5b-1', photographerId: R, deviceId: D1, fileCount: 10, day: '2026-10-02' }, { origin: learnOrigin, at: '2026-10-02T01:00:01Z' }),
      createEvent('association-confirmed', { photographerId: R, deviceId: D1, resolves: [] }, { origin: regOrigin(), at: '2026-10-02T01:00:02Z' }),
      ev('photographer-renamed', { photographerId: R, fromName: 'Local Gamma', toName: 'Local Gamma Renamed' }, { at: '2026-10-03T00:00:00Z' }),
    ]);
    // What photographerLearningService does for the next import under the NEW name:
    const after = await ensure(store, 'Local Gamma Renamed', list);
    assert.equal(after.photographerId, R);
    await store.appendEvents([createEvent('import-observed', { importId: 'imp-q5b-2', photographerId: after.photographerId, deviceId: D1, fileCount: 4, day: '2026-10-04' }, { origin: learnOrigin, at: '2026-10-04T00:00:00Z' })]);
    const state = deriveRegistryState(store.getEvents(), { shipped: P.bootstrapShippedIds(SHIPPED) });
    const a = state.associationsForDevice(D1).find(x => x.photographerId === R);
    assert.equal(a.state, 'confirmed');
    assert.equal(a.provenance.filter(pv => pv.type === 'import-observed').length, 2);
    const view = V.buildRegistryView({ registry: { state: 'ready', events: store.getEvents(), keyStatus: 'ready', keyVerified: true }, listNames: list, shippedNames: SHIPPED, operators: [{ id: OP, name: 'Operator One' }], thisComputerId: THIS });
    const profiles = view.photographers.filter(p => p.photographerId === R);
    assert.equal(profiles.length, 1, 'one profile for old and new name');
    assert.equal(profiles[0].name, 'Local Gamma Renamed'); assert.deepEqual(profiles[0].formerNames, ['Local Gamma']);
    assert.equal(profiles[0].cameras[0].observedImports, 2);
    await store.close();
  });

  console.log('Q5b — official name history and cross-computer conflicts');

  await t('conflicting offline renames (same from-name) and a stale rename are both flagged; names still resolve to one ID', async () => {
    const R = '12121212-1212-4121-8121-121212121212';
    const events = [
      ev('photographer-registered', { photographerId: R, name: 'Offline Person', idOrigin: 'random' }, { at: '2026-10-01T00:00:00Z' }),
      ev('photographer-renamed', { photographerId: R, fromName: 'Offline Person', toName: 'Offline Person B' }, { at: '2026-10-02T00:00:00Z' }),
      ev('photographer-renamed', { photographerId: R, fromName: 'Offline Person', toName: 'Offline Person C' }, { at: '2026-10-03T00:00:00Z', computerId: OTHER, operatorId: 'op-other' }),
    ];
    const shipped = P.bootstrapShippedIds(SHIPPED);
    const state = deriveRegistryState(events, { shipped });
    assert.ok(state.conflicts.some(c => c.kind === 'conflicting-renames'));
    const h = N.deriveNameHistory(events, { state, shipped }).get(R);
    assert.deepEqual(h.history.map(x => x.stale), [false, true]);
    assert.equal(h.conflicts[0].kind, 'stale-rename');
    for (const n of ['Offline Person', 'Offline Person B', 'Offline Person C']) assert.equal(N.resolveOfficialName(n, { state, shipped }).photographerId, R, n);
    const view = V.buildRegistryView({ registry: { state: 'ready', events }, listNames: ['Offline Person'], shippedNames: SHIPPED, thisComputerId: THIS });
    const kinds = view.reviewItems.map(r => r.kind);
    assert.ok(kinds.includes('conflicting-renames') && kinds.includes('stale-rename'));
    const p = view.photographers.find(x => x.photographerId === R);
    assert.deepEqual(p.nameHistory.map(x => [x.computer, x.stale]), [['this', false], ['another', true]]);
  });

  await t('a rename from a frozen former shipped spelling is not mistaken for a stale rename', async () => {
    const original = P.shippedPhotographerId('Test Shipped Alfa');
    const frozen = P.loadFrozenShippedIds({ format: 'autoingest-shipped-photographer-ids', version: 1, entries: [{ photographerId: original, names: ['Test Shipped Alfa', 'Test Shipped Alpha'] }] });
    const shipped = P.bootstrapShippedIds(['Test Shipped Alpha'], { frozen });
    const events = [ev('photographer-renamed', { photographerId: original, fromName: 'Test Shipped Alpha', toName: 'Alpha Renamed' })];
    const state = deriveRegistryState(events, { shipped });
    const h = N.deriveNameHistory(events, { state, shipped }).get(original);
    assert.equal(h.originalName, 'Test Shipped Alfa'); assert.equal(h.currentName, 'Alpha Renamed');
    assert.deepEqual(h.conflicts, []);
  });

  console.log('Q5b — registry search aliases');

  await t('alias events are validated strictly; old registries with them still open (unknown types are preserved by Q4)', async () => {
    const R = '13131313-1313-4131-8131-131313131313';
    assert.throws(() => ev('photographer-alias-added', { photographerId: R, alias: ' padded', kind: 'spelling' }));
    assert.throws(() => ev('photographer-alias-added', { photographerId: R, alias: 'ok', kind: 'nickname' }));
    assert.throws(() => ev('photographer-alias-added', { photographerId: R, alias: 'ok', kind: 'other', folder: 'x' }), /unexpected field/);
    assert.throws(() => ev('photographer-alias-removed', { photographerId: R, alias: 'ok', resolves: [] }), /resolves/);
  });

  await t('add / remove is an observed-remove set: a removal only removes the additions it saw', async () => {
    const R = '14141414-1414-4141-8141-141414141414';
    const add1 = ev('photographer-alias-added', { photographerId: R, alias: 'Mus', kind: 'abbreviation' });
    const add2 = ev('photographer-alias-added', { photographerId: R, alias: 'mus', kind: 'abbreviation' }, { computerId: OTHER });
    const rem1 = ev('photographer-alias-removed', { photographerId: R, alias: 'Mus', resolves: [add1.eventId] });
    const base = [ev('photographer-registered', { photographerId: R, name: 'Alias Person', idOrigin: 'random' }), add1, add2];
    const live = (events) => { const state = deriveRegistryState(events, {}); return (N.deriveSearchAliases(events, { state }).get(R) || []).map(a => a.alias); };
    assert.deepEqual(live(base), ['mus'], 'two additions of one alias are one alias');
    assert.deepEqual(live([...base, rem1]), ['mus'], 'the other computer\'s addition survives');
    const rem2 = ev('photographer-alias-removed', { photographerId: R, alias: 'mus', resolves: [add1.eventId, add2.eventId] });
    assert.deepEqual(live([...base, rem1, rem2]), []);
  });

  await t('an alias shared by two photographers: search returns both, selects none, and a review item is raised', async () => {
    const A = '15151515-1515-4151-8151-151515151515', B = '16161616-1616-4161-8161-161616161616';
    const events = [
      ev('photographer-registered', { photographerId: A, name: 'Huzaifa One', idOrigin: 'random' }),
      ev('photographer-registered', { photographerId: B, name: 'Huzaifa Two', idOrigin: 'random' }),
      ev('photographer-alias-added', { photographerId: A, alias: 'HZ', kind: 'abbreviation' }),
      ev('photographer-alias-added', { photographerId: B, alias: 'HZ', kind: 'abbreviation' }),
    ];
    const view = V.buildRegistryView({ registry: { state: 'ready', events }, listNames: ['Huzaifa One', 'Huzaifa Two'], shippedNames: [], thisComputerId: THIS });
    const r = V.searchPhotographers(view, 'hz');
    assert.equal(r.ambiguous, true); assert.equal(r.selected, null);
    assert.ok(r.results.filter(x => x.matchedOn === 'search-alias').length === 2);
    assert.ok(view.reviewItems.some(i => i.kind === 'shared-search-alias'));
    assert.deepEqual(view.photographers.find(p => p.photographerId === A).searchAliases, [{ text: 'HZ', kind: 'abbreviation', addedDay: events[2].at.slice(0, 10) }]);
    assert.equal(view.capabilities.searchAliases, false, 'no alias editing is exposed');
  });

  console.log('Q5b — backend profile commands');

  await t('proposed names: exact stored spelling preview and Windows/SMB folder validity', async () => {
    const ok = C.validateProposedName('  Shk   Mohammed́  McDonald ');
    assert.equal(ok.ok, true); assert.equal(ok.storedName, 'Shk Mohammed́ McDonald'.normalize('NFC'));
    assert.ok(ok.notes.includes('photographer-list-would-recapitalise'), 'listManager would store "Mcdonald"');
    const bad = (raw, kind) => { const v = C.validateProposedName(raw); assert.ok(v.errors.includes(kind), `${JSON.stringify(raw)} → ${kind}, got ${v.errors}`); };
    bad('Name: Two', 'invalid-folder-characters'); bad('A/B', 'invalid-folder-characters'); bad('Who?', 'invalid-folder-characters'); bad('Pipe|Name', 'invalid-folder-characters');
    bad('CON', 'reserved-windows-name'); bad('lpt1.txt', 'reserved-windows-name'); bad('Trailing.', 'trailing-dot-or-space');
    bad('Bell\u0007Name', 'control-characters');
    assert.equal(C.validateProposedName('Tab\tName').storedName, 'Tab Name', 'whitespace is collapsed, not rejected'); bad('Zero​Width', 'invisible-characters');
    bad('PC01-Someone', 'looks-like-sequence-prefix'); bad('_Unsequenced', 'structural-folder-name'); bad('VIDEO', 'structural-folder-name');
    bad('01Q', 'qmz-sequence-code'); bad('.hidden', 'hidden-or-ignored-folder-prefix'); bad('#tag', 'hidden-or-ignored-folder-prefix');
    bad('x'.repeat(81), 'too-long'); bad('', 'empty-name'); bad('X', 'too-short');
    assert.deepEqual(C.validateProposedName(42).errors, ['not-text']);
  });

  await t('collision checks: another person\'s current or former name blocks; own former name allowed; aliases only warn', async () => {
    const R = '17171717-1717-4171-8171-171717171717', S = '18181818-1818-4181-8181-181818181818';
    const events = [
      ev('photographer-registered', { photographerId: R, name: 'Person Arr', idOrigin: 'random' }),
      ev('photographer-renamed', { photographerId: R, fromName: 'Person Arr', toName: 'Person Are' }),
      ev('photographer-registered', { photographerId: S, name: 'Person Ess', idOrigin: 'random' }),
      ev('photographer-renamed', { photographerId: S, fromName: 'Person Ess', toName: 'Person Esse' }),
      ev('photographer-alias-added', { photographerId: S, alias: 'Pee Ess', kind: 'other' }),
    ];
    const ctx = { events, shippedNames: SHIPPED, listNames: ['Person Arr', 'Person Esse'], selfPhotographerId: R };
    assert.equal(C.checkProposedName('Person Esse', ctx).blocking[0].kind, 'name-exists');
    assert.equal(C.checkProposedName('Person Ess', ctx).blocking[0].kind, 'former-name-of-another');
    assert.equal(C.checkProposedName('test shipped alpha', ctx).blocking[0].kind, 'name-exists');
    assert.equal(C.checkProposedName('Person Arr', ctx).ok, true, 'renaming back to an own former name');
    const w = C.checkProposedName('Pee Ess', ctx);
    assert.equal(w.ok, true); assert.equal(w.warnings[0].kind, 'matches-registry-search-alias');
    assert.ok(C.checkProposedName('Person Esso', ctx).warnings.some(x => x.kind === 'similar-name'));
  });

  await t('rename builder: stale revision, operator provenance, unknown identity and unchanged name are refused', async () => {
    const R = '19191919-1919-4191-8191-191919191919';
    const events = [ev('photographer-registered', { photographerId: R, name: 'Builder Person', idOrigin: 'random' })];
    const rev = C.getProfileRevision(events, { shippedNames: SHIPPED, photographerId: R });
    const base = { shippedNames: SHIPPED, listNames: ['Builder Person'], photographerId: R, proposedName: 'Builder Persona', expectedRevision: rev, origin: regOrigin(), at: '2026-10-10T00:00:00Z' };
    const okRes = C.buildRenameEvent(events, base);
    assert.equal(okRes.ok, true);
    assert.deepEqual({ ...okRes.events[0] }.origin, { computerId: THIS, operatorId: OP, workflow: 'registry' });
    assert.equal(okRes.events[0].fromName, 'Builder Person'); assert.equal(okRes.events[0].toName, 'Builder Persona');
    assert.equal(C.buildRenameEvent(events, { ...base, expectedRevision: 'stale' }).reason, 'stale-revision');
    assert.equal(C.buildRenameEvent(events, { ...base, origin: regOrigin(THIS, null) }).reason, 'operator-required');
    assert.equal(C.buildRenameEvent(events, { ...base, origin: { ...regOrigin(), workflow: 'event-import' } }).reason, 'registry-workflow-required');
    assert.equal(C.buildRenameEvent(events, { ...base, photographerId: '20202020-2020-4202-8202-202020202020' }).reason, 'unknown-photographer');
    assert.equal(C.buildRenameEvent(events, { ...base, proposedName: 'Builder  Person ' }).reason, 'unchanged');
    assert.equal(C.buildRenameEvent(events, { ...base, proposedName: 'Bad:Name' }).reason, 'name-rejected');
    const caseOnly = C.buildRenameEvent(events, { ...base, proposedName: 'Builder PERSON' });
    assert.equal(caseOnly.ok, true); assert.equal(caseOnly.result.caseOnly, true);
    // The revision moves with any name/alias change, so a command prepared before it is stale.
    const later = [...events, ev('photographer-alias-added', { photographerId: R, alias: 'BP', kind: 'abbreviation' })];
    assert.equal(C.buildRenameEvent(later, base).reason, 'stale-revision');
  });

  await t('alias builders: official names refused as aliases, duplicates refused, removal lists what it removes', async () => {
    const R = '21212121-2121-4212-8212-212121212121', S = '22222222-2121-4212-8212-212121212121';
    const events = [
      ev('photographer-registered', { photographerId: R, name: 'Alias Owner', idOrigin: 'random' }),
      ev('photographer-registered', { photographerId: S, name: 'Other Owner', idOrigin: 'random' }),
    ];
    const rev = (evs) => C.getProfileRevision(evs, { shippedNames: [], photographerId: R });
    const args = (evs, alias) => ({ shippedNames: [], photographerId: R, alias, kind: 'spelling', expectedRevision: rev(evs), origin: regOrigin(), at: '2026-10-10T00:00:00Z' });
    assert.equal(C.buildAliasAddEvent(events, args(events, 'alias owner')).blocking[0].kind, 'alias-is-official-name');
    assert.equal(C.buildAliasAddEvent(events, args(events, 'Other Owner')).blocking[0].kind, 'alias-is-official-name-of-another');
    const added = C.buildAliasAddEvent(events, args(events, 'Alias O.'));
    assert.equal(added.ok, true);
    const ev2 = [...events, ...added.events];
    assert.equal(C.buildAliasAddEvent(ev2, args(ev2, 'alias o')).reason, 'alias-exists');
    const removed = C.buildAliasRemoveEvent(ev2, { ...args(ev2, 'ALIAS O'), kind: undefined });
    assert.equal(removed.ok, true); assert.deepEqual(removed.events[0].resolves, [added.events[0].eventId]);
    assert.equal(C.buildAliasRemoveEvent(ev2, args(ev2, 'never added')).reason, 'alias-not-found');
  });

  await t('command service: rename and alias commands are OFF by default and write nothing; photographers.aliases.json untouched', async () => {
    const userData = await tmp('userdata');
    const shortcuts = path.join(userData, 'photographers.aliases.json');
    fs.writeFileSync(shortcuts, JSON.stringify({ 'local-gamma': ['lg'] }));
    const store = await openStore(path.join(userData, 'identity-registry'));
    const R = (await ensure(store, 'Local Gamma', [...SHIPPED, 'Local Gamma'])).photographerId;
    const before = registryBytes(store);
    const svc = C.createProfileCommandService({ store, getNames: () => ({ shippedNames: SHIPPED, listNames: [...SHIPPED, 'Local Gamma'] }) });
    const rev = C.getProfileRevision(store.getEvents(), { shippedNames: SHIPPED, photographerId: R });
    const r = await svc.renamePhotographer({ photographerId: R, proposedName: 'Local Gamma Two', expectedRevision: rev, origin: regOrigin() });
    assert.equal(r.reason, 'rename-disabled'); assert.deepEqual(r.unmet, ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']);
    assert.equal((await svc.addSearchAlias({ photographerId: R, alias: 'Gam', expectedRevision: rev, origin: regOrigin() })).reason, 'aliases-disabled');
    assert.equal(registryBytes(store), before);
    assert.equal(fs.readFileSync(shortcuts, 'utf8'), JSON.stringify({ 'local-gamma': ['lg'] }));
    await store.close();
  });

  await t('command service with gates opened (tests only): atomic revision check + append; stale command writes nothing', async () => {
    const store = await openStore();
    const R = (await ensure(store, 'Local Gamma', [...SHIPPED, 'Local Gamma'])).photographerId;
    const open = () => ({ enabled: true, unmet: [] });
    const svc = C.createProfileCommandService({ store, getNames: () => ({ shippedNames: SHIPPED, listNames: [...SHIPPED, 'Local Gamma'] }), gates: { rename: open, aliases: open }, now: () => new Date('2026-10-11T00:00:00Z') });
    const rev = C.getProfileRevision(store.getEvents(), { shippedNames: SHIPPED, photographerId: R });
    const [a, b] = await Promise.all([
      svc.renamePhotographer({ photographerId: R, proposedName: 'Gamma First', expectedRevision: rev, origin: regOrigin() }),
      svc.renamePhotographer({ photographerId: R, proposedName: 'Gamma Second', expectedRevision: rev, origin: regOrigin() }),
    ]);
    assert.equal(a.ok, true); assert.equal(b.ok, false); assert.equal(b.reason, 'stale-revision', 'the second command saw the first');
    assert.equal(store.getEvents().filter(e => e.type === 'photographer-renamed').length, 1);
    assert.equal((await ensure(store, 'Local Gamma', [...SHIPPED, 'Local Gamma', 'Gamma First'])).photographerId, R);
    assert.equal((await ensure(store, 'Gamma First', [...SHIPPED, 'Local Gamma', 'Gamma First'])).photographerId, R);
    await store.close();
  });

  await t('rename contract: every S1–S8 prerequisite unmet, seven safety requirements tracked', async () => {
    assert.deepEqual(renameGate(), { enabled: false, unmet: PREREQUISITES.map(p => p.id) });
    assert.deepEqual(PREREQUISITES.map(p => p.id), ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']);
    assert.equal(SAFETY_REQUIREMENTS.length, 7);
    assert.equal(renameGate(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']).enabled, true);
  });

  console.log('Q5b — read-only current-event folder rename planner (synthetic archives)');

  const R = '23232323-2323-4232-8232-232323232323', OTHERP = '24242424-2424-4242-8242-242424242424';
  const plannerEvents = [
    ev('photographer-registered', { photographerId: R, name: 'Old Spelling', idOrigin: 'random' }, { at: '2026-09-01T00:00:00Z' }),
    ev('photographer-renamed', { photographerId: R, fromName: 'Old Spelling', toName: 'Current Spelling' }, { at: '2026-09-02T00:00:00Z' }),
    ev('photographer-alias-added', { photographerId: R, alias: 'Spelly', kind: 'abbreviation' }, { at: '2026-09-03T00:00:00Z' }),
    ev('photographer-registered', { photographerId: OTHERP, name: 'Someone Else', idOrigin: 'random' }, { at: '2026-09-01T00:00:01Z' }),
  ];
  const plan = (copies, extra = {}) => planCurrentEventFolderRename({ events: plannerEvents, shippedNames: SHIPPED, photographerId: R, newName: 'New Spelling', copies, fs: readOnlyFs, ...extra });

  await t('single-component event: former-name folder proposed with its PCxx kept; preview only; archive untouched', async () => {
    const root = await mkEvent(path.join(await tmp('ev1'), 'Synthetic Event'), { dirs: ['PC03-Old Spelling', 'PC01-Someone Else', '_Selected', 'VIDEO'] });
    const before = await snapshot(root);
    calls.length = 0;
    const p = await plan([{ copyId: 'local', kind: 'local-staging', root }]);
    assert.equal(p.previewOnly, true); assert.equal(p.applied, false); assert.equal(p.canApply, false);
    assert.deepEqual(p.applyBlockedBy, ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8']);
    assert.deepEqual(p.blockers, []);
    const c = candidatesOf(p);
    assert.deepEqual(c.map(x => [x.folderName, x.match, x.proposedFolderName, x.proposed, x.sequencePrefix]), [['PC03-Old Spelling', 'former-name', 'PC03-New Spelling', true, 'PC03']]);
    assert.equal(p.proposedCount, 1);
    assert.deepEqual(await snapshot(root), before);
    assert.ok(calls.every(x => READ_ONLY.has(x)));
    assert.ok(!JSON.stringify(p).includes(root), 'no absolute paths in the plan');
  });

  await t('several old-name folders in one scope: none proposed, operator must choose', async () => {
    const root = await mkEvent(path.join(await tmp('ev2'), 'E'), { dirs: ['PC02-Old Spelling', 'PC05-Current Spelling'] });
    const p = await plan([{ copyId: 'local', kind: 'local-staging', root }]);
    assert.ok(p.blockers.includes('multiple-candidate-folders'));
    assert.deepEqual(candidatesOf(p).map(x => [x.match, x.proposed]).sort(), [['current-name', false], ['former-name', false]]);
  });

  await t('multi-component event: each component scope is planned separately; a missing component is reported', async () => {
    const root = await mkEvent(path.join(await tmp('ev3'), 'E'), { components: ['01-Majlis', '02-Jaman', '03-Missing'], dirs: ['01-Majlis/PC01-Current Spelling', '02-Jaman/PC04-Old Spelling', '02-Jaman/PC02-Someone Else'] });
    const p = await plan([{ copyId: 'local', kind: 'local-staging', root }]);
    const scopes = p.copies[0].scopes;
    assert.deepEqual(scopes.map(s => [s.scopeKey, s.state, s.candidates.map(x => x.proposedFolderName)]), [
      ['01-Majlis', 'ok', ['PC01-New Spelling']], ['02-Jaman', 'ok', ['PC04-New Spelling']], ['03-Missing', 'missing', []],
    ]);
    assert.equal(p.proposedCount, 2);
  });

  await t('local staging and NAS copies: both planned and labelled; an unreachable copy blocks; differing copies warn', async () => {
    const base = await tmp('ev4');
    const local = await mkEvent(path.join(base, 'local', 'E'), { dirs: ['PC03-Old Spelling'] });
    const nas = await mkEvent(path.join(base, 'nas', 'E'), { dirs: ['PC03-Old Spelling', 'PC06-Current Spelling'] });
    const both = await plan([{ copyId: 'local', kind: 'local-staging', root: local }, { copyId: 'nas-1', kind: 'nas', root: nas }]);
    assert.deepEqual(both.copies.map(c => [c.copyId, c.kind, c.state]), [['local', 'local-staging', 'available'], ['nas-1', 'nas', 'available']]);
    assert.ok(both.warnings.includes('event-copies-differ'));
    const off = await plan([{ copyId: 'local', kind: 'local-staging', root: local }, { copyId: 'nas-1', kind: 'nas', root: path.join(base, 'unmounted', 'E') }, { copyId: 'nas-2', kind: 'nas', root: null }]);
    assert.ok(off.blockers.includes('event-copy-unavailable'));
    assert.deepEqual(off.copies.map(c => c.state), ['available', 'unavailable', 'unavailable']);
  });

  await t('case-insensitive collisions and case-only renames are detected', async () => {
    const root = await mkEvent(path.join(await tmp('ev5'), 'E'), { dirs: ['PC03-Old Spelling', 'PC07-new spelling'] });
    const p = await plan([{ copyId: 'local', kind: 'local-staging', root }]);
    const c = candidatesOf(p).find(x => x.folderName === 'PC03-Old Spelling');
    assert.deepEqual(c.blockers, ['new-name-folder-exists']); assert.equal(c.proposed, false);
    assert.ok(p.blockers.includes('target-collision'));
    const root2 = await mkEvent(path.join(await tmp('ev6'), 'E'), { dirs: ['PC03-Old Spelling', 'pc03-new spelling'] });
    const p2 = await plan([{ copyId: 'local', kind: 'local-staging', root: root2 }]);
    assert.ok(candidatesOf(p2).find(x => x.folderName === 'PC03-Old Spelling').blockers.includes('target-folder-exists'));
    const root3 = await mkEvent(path.join(await tmp('ev7'), 'E'), { dirs: ['PC03-Current Spelling'] });
    const p3 = await plan([{ copyId: 'local', kind: 'local-staging', root: root3 }], { newName: 'Current SPELLING' });
    assert.deepEqual(candidatesOf(p3).map(x => [x.caseOnly, x.proposed, x.proposedFolderName]), [[true, true, 'PC03-Current SPELLING']]);
  });

  await t('invalid Windows/SMB target name blocks the plan', async () => {
    const root = await mkEvent(path.join(await tmp('ev8'), 'E'), { dirs: ['PC03-Old Spelling'] });
    const p = await plan([{ copyId: 'local', kind: 'local-staging', root }], { newName: 'New: Spelling?' });
    assert.ok(p.blockers.includes('invalid-new-name'));
    assert.ok(p.photographer.newNameErrors.includes('invalid-folder-characters'));
  });

  await t('similar spellings, search-alias-only and ambiguous folders are listed but never proposed', async () => {
    const S2 = '25252525-2525-4252-8252-252525252525';
    const events = [...plannerEvents, ev('photographer-registered', { photographerId: S2, name: 'Old Spelling', idOrigin: 'random' }, { computerId: OTHER, at: '2026-09-05T00:00:00Z' })];
    const root = await mkEvent(path.join(await tmp('ev9'), 'E'), { dirs: ['PC01-Old Speling', 'PC02-Spelly', 'PC03-Old Spelling', 'PC04-Unrelated Person'] });
    const p = await plan([{ copyId: 'local', kind: 'local-staging', root }], { events });
    const byName = Object.fromEntries(candidatesOf(p).map(x => [x.folderName, [x.match, x.proposed]]));
    assert.deepEqual(byName, { 'PC01-Old Speling': ['similar-spelling', false], 'PC02-Spelly': ['search-alias-only', false], 'PC03-Old Spelling': ['ambiguous', false] });
  });

  await t('QMZ structures are excluded: a QMZ root blocks, QMZ folders inside a scope are never candidates', async () => {
    const root = await mkEvent(path.join(await tmp('ev10'), 'E'), { dirs: ['01Q', '_Unsequenced/Old Spelling', 'Enroute'], files: { 'qmz-sequences.json': '{"version":1,"sequences":[]}' } });
    const before = await snapshot(root);
    const p = await plan([{ copyId: 'local', kind: 'local-staging', root }]);
    assert.ok(p.blockers.includes('qmz-structure-excluded')); assert.equal(p.copies[0].state, 'qmz-excluded');
    assert.deepEqual(await snapshot(root), before);
    const root2 = await mkEvent(path.join(await tmp('ev11'), 'E'), { dirs: ['01Q', '_Unsequenced', 'Enroute', 'PC03-Old Spelling'] });
    const p2 = await plan([{ copyId: 'local', kind: 'local-staging', root: root2 }]);
    assert.deepEqual(p2.copies[0].scopes[0].excluded.map(x => x.folderName).sort(), ['01Q', 'Enroute', '_Unsequenced']);
    assert.deepEqual(candidatesOf(p2).map(x => x.folderName), ['PC03-Old Spelling']);
  });

  await t('unknown photographer, missing event.json and no copies are reported, not guessed', async () => {
    assert.deepEqual((await plan([], { photographerId: '26262626-2626-4262-8262-262626262626' })).blockers, ['unknown-photographer']);
    assert.ok((await plan([])).blockers.includes('no-event-copies'));
    const bare = await tmp('ev12');
    await fsp.mkdir(path.join(bare, 'PC03-Old Spelling'));
    assert.ok((await plan([{ copyId: 'local', kind: 'local-staging', root: bare }])).blockers.includes('event-json-missing'));
  });

  console.log('Q5b — boundaries');

  await t('nothing new is reachable from IPC, preload, renderer, startup or import routing', async () => {
    const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
    const surfaces = ['main/main.js', 'main/preload.js', 'main/companionPreload.js'];
    for (const f of surfaces) {
      for (const needle of ['photographerProfileCommands', 'photographerFolderRenamePlanner', 'photographerRenameContract', 'photographerNameModel', 'renamePhotographer', 'addSearchAlias']) {
        assert.ok(!read(f).includes(needle), `${f} references ${needle}`);
      }
    }
    // Q5c (authorized) wires the read-only accessor to the Photographer Registry tab — once, in
    // main.js, as the view loader of the read-only browser. Never in a preload.
    for (const f of ['main/preload.js', 'main/companionPreload.js']) assert.ok(!read(f).includes('inspectRegistry'), `${f} references inspectRegistry`);
    const inspectRefs = read('main/main.js').split('\n').filter(l => l.includes('inspectRegistry') && !/^\s*\/\//.test(l));
    assert.ok(inspectRefs.length <= 1 && inspectRefs.every(l => /createRegistryBrowser\(\{ loadView: \(\) => photographerLearning\.inspectRegistry\(\) \}\)/.test(l)), 'main.js uses inspectRegistry only as the read-only browser loader');
    const rendererFiles = fs.readdirSync(path.join(ROOT, 'renderer')).filter(f => f.endsWith('.js') || f.endsWith('.html'));
    for (const f of rendererFiles) assert.ok(!/photographerProfileCommands|photographerFolderRenamePlanner|photographer-alias-/.test(read(`renderer/${f}`)), `renderer/${f}`);
    const users = fs.readdirSync(path.join(ROOT, 'services')).filter(f => f.endsWith('.js') && /require\(['"]\.\/photographer(ProfileCommands|FolderRenamePlanner)['"]\)/.test(read(`services/${f}`)));
    assert.deepEqual(users, ['photographerFolderRenamePlanner.js'], 'only the planner uses the command module; the runtime uses neither');
    assert.ok(!/ProfileCommands|FolderRenamePlanner/.test(read('services/photographerLearningRuntime.js')));
  });

  console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES above' : ''}`);
})();
