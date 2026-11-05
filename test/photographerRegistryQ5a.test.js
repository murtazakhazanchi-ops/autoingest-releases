'use strict';

// AI-FEAT-063 / AI-RM-014 Q5a — read-only Photographer Registry foundation: the
// non-initializing inspector, the privacy-safe view models and the pure browsing functions.
// Registries are built with the REAL Q4 store and a FAKE secure storage in throw-away temp
// folders. Every photographer name, camera serial and computer ID here is synthetic.
//
// Run: node test/photographerRegistryQ5a.test.js

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createIdentityRegistryStore } = require('../services/identityRegistryStore');
const { createEvent } = require('../services/identityEvents');
const P = require('../services/photographerIdentity');
const { slugify } = require('../main/aliasEngine');
const { inspectRegistryFiles } = require('../services/identityRegistryInspector');
const V = require('../services/photographerRegistryView');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

const THIS = 'fake-computer-THIS-q5a';
const OTHER = 'fake-computer-OTHER-q5a';
const FAKE_SERIALS = ['FAKEQ5AR5-0001', 'FAKEQ5ASONY-0002', 'FAKEQ5ASPAN-0003'];
const digestOf = (s) => crypto.createHash('sha256').update(`fake-digest|${s}`).digest('hex');

function fakeSecureStorage(identity = 'q5a-test-app') {
  return {
    backend: 'fake-test', identity, isAvailable: () => true,
    encrypt: (buf) => Buffer.concat([Buffer.from('SEALED:'), Buffer.from(buf.map(b => b ^ 0x5a))]),
    decrypt: (c) => Buffer.from(c.subarray(7).map(b => b ^ 0x5a)),
  };
}
const tmp = (tag) => fsp.mkdtemp(path.join(os.tmpdir(), `ai-q5a-${tag}-`));

/** Recursive snapshot: relative path → size/mtime/mode (directories included). */
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

// ── Synthetic fixture ───────────────────────────────────────────────────────────────
const SHIPPED = ['Test Shipped Alpha', 'Test Shipped Beta', 'M. Testname'];
const OVERRIDE = ['Murtaza Testname', 'Local Gamma', 'Local Delta', 'Zed Same'];
const ID = {
  alpha: P.shippedPhotographerId('Test Shipped Alpha'),
  beta: P.shippedPhotographerId('Test Shipped Beta'),
  murtaza: P.shippedPhotographerId('M. Testname'),
  gamma: '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b',
  zed1: '11111111-2222-4333-8444-555555555555',
  zed2: '66666666-7777-4888-9999-aaaaaaaaaaaa',
  d1: 'd1d1d1d1-0000-4000-8000-000000000001',
  d2: 'd2d2d2d2-0000-4000-8000-000000000002',
  d3: 'd3d3d3d3-0000-4000-8000-000000000003',
  d4: 'd4d4d4d4-0000-4000-8000-000000000004',
};
const OPERATORS = [{ id: 'op-q5a-1', name: 'Operator One' }];

async function seedRegistry(dir, { identity = 'q5a-test-app', build } = {}) {
  const store = createIdentityRegistryStore({ dir, secureStorage: fakeSecureStorage(identity), computerId: THIS });
  const st = await store.open();
  assert.equal(st.state, 'ready');
  const keyId = JSON.parse(fs.readFileSync(path.join(dir, 'registry.json'), 'utf8')).keyIds[0];
  let n = 0;
  const ev = (type, payload, { at, computerId = THIS, operatorId = 'op-q5a-1', workflow = 'event-import' } = {}) =>
    createEvent(type, payload, { origin: { computerId, operatorId, workflow }, at: at || `2026-10-01T00:00:${String(n++ % 60).padStart(2, '0')}Z` });
  const idf = (ns, serial) => [{ ns, keyId, digest: digestOf(serial), trusted: true }];
  const events = build ? build({ ev, idf, keyId }) : [];
  if (events.length) assert.equal((await store.appendEvents(events)).ok, true);
  return { store, keyId };
}

const richBuild = ({ ev, idf }) => [
  ev('photographer-renamed', { photographerId: ID.murtaza, fromName: 'M. Testname', toName: 'Murtaza Testname' }, { at: '2026-10-05T09:00:00Z', workflow: 'registry' }),
  ev('photographer-registered', { photographerId: ID.gamma, name: 'Local Gamma', idOrigin: 'random' }, { at: '2026-09-01T00:00:00Z' }),
  ev('photographer-registered', { photographerId: ID.zed1, name: 'Zed Same', idOrigin: 'random' }, { at: '2026-09-02T00:00:00Z' }),
  ev('photographer-registered', { photographerId: ID.zed2, name: 'Zed Same', idOrigin: 'random' }, { at: '2026-09-03T00:00:00Z', computerId: OTHER }),
  ev('device-registered', { deviceId: ID.d1, make: 'Canon', modelKey: 'canon eos r5', modelDisplay: 'EOS R5', identifiers: idf('exif.bodySerial', FAKE_SERIALS[0]) }, { at: '2026-10-01T08:00:00Z' }),
  ev('device-registered', { deviceId: ID.d2, make: 'SONY', modelKey: 'ilce-7m3', modelDisplay: 'ILCE-7M3', identifiers: idf('sony.internal', FAKE_SERIALS[1]) }, { at: '2026-10-01T08:00:01Z' }),
  ev('device-registered', { deviceId: ID.d3, make: 'Nikon', modelKey: 'z 8', modelDisplay: 'Z 8', identifiers: idf('nikon.serial', FAKE_SERIALS[2]) }, { at: '2026-10-01T08:00:02Z' }),
  ev('device-registered', { deviceId: ID.d4, make: 'Nikon', modelKey: 'z 8', modelDisplay: 'Z 8', identifiers: idf('nikon.serial', FAKE_SERIALS[2]) }, { at: '2026-10-01T08:00:03Z', computerId: OTHER }),
  ...['2026-10-01', '2026-10-02', '2026-10-03'].map((day, i) => ev('import-observed', { importId: `imp-fakeq5a-${i}`, photographerId: ID.murtaza, deviceId: ID.d1, fileCount: 10, day }, { at: `${day}T10:00:00Z` })),
  ev('import-observed', { importId: 'imp-fakeq5a-g1', photographerId: ID.gamma, deviceId: ID.d2, fileCount: 4, day: '2026-10-04' }, { at: '2026-10-04T10:00:00Z' }),
  ev('association-confirmed', { photographerId: ID.beta, deviceId: ID.d2, resolves: [] }, { at: '2026-10-06T10:00:00Z', workflow: 'registry' }),
  ev('association-confirmed', { photographerId: ID.gamma, deviceId: ID.d2, resolves: [] }, { at: '2026-10-07T10:00:00Z', computerId: OTHER, workflow: 'registry', operatorId: 'op-unknown-elsewhere' }),
  ev('association-rejected', { photographerId: ID.gamma, deviceId: ID.d2, resolves: [] }, { at: '2026-10-07T11:00:00Z', workflow: 'registry' }),
  ev('model-observed', { importId: 'imp-fakeq5a-m1', photographerId: ID.gamma, make: 'FUJIFILM', modelKey: 'x-t5', fileCount: 3, day: '2026-10-08' }, { at: '2026-10-08T10:00:00Z' }),
];

async function richView({ registryState } = {}) {
  const dir = path.join(await tmp('rich'), 'identity-registry');
  const { store } = await seedRegistry(dir, { build: richBuild });
  await store.close();
  const registry = await inspectRegistryFiles({ dir, expectedIdentity: 'q5a-test-app' });
  return {
    dir,
    view: V.buildRegistryView({
      registry: registryState ? { ...registry, ...registryState } : registry,
      listNames: [...SHIPPED, ...OVERRIDE], shippedNames: SHIPPED,
      learnedShortcuts: { [slugify('M. Testname')]: ['mk', 'murt'], [slugify('Local Gamma')]: ['mk', 'lg'] },
      operators: OPERATORS, thisComputerId: THIS, learning: { enabled: true, pendingCount: 2 },
    }),
  };
}
const byName = (view, name) => view.photographers.find(p => p.name === name);

(async () => {
  console.log('Q5a — non-initializing inspector');

  await t('missing registry: state "missing", and the folder is never created', async () => {
    const root = await tmp('missing');
    const dir = path.join(root, 'identity-registry');
    const r = await inspectRegistryFiles({ dir, expectedIdentity: 'x' });
    assert.equal(r.state, 'missing');
    assert.equal(r.readOnly, true);
    assert.deepEqual(r.events, []);
    assert.equal(fs.existsSync(dir), false, 'inspection must not create the registry folder');
    assert.deepEqual(await snapshot(root), {});
  });

  await t('missing registry with backups is a distinct state; nothing is restored', async () => {
    const dir = path.join(await tmp('mb'), 'identity-registry');
    await fsp.mkdir(path.join(dir, 'backups'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'backups', 'registry-20261001T000000000Z-abcdef01.json'), '{}');
    const before = await snapshot(dir);
    const r = await inspectRegistryFiles({ dir });
    assert.equal(r.state, 'missing-backups-present');
    assert.deepEqual(await snapshot(dir), before);
  });

  await t('valid registry: ready, events returned, no file touched (incl. a stale lock), keys never decrypted', async () => {
    const dir = path.join(await tmp('ready'), 'identity-registry');
    const { store } = await seedRegistry(dir, { build: richBuild });
    await store.close();
    // A stale lock left by a dead process: the WRITE path would quarantine it; inspection must not.
    await fsp.writeFile(path.join(dir, 'registry.lock'), JSON.stringify({ pid: 999999, token: 'x', at: '2026-01-01T00:00:00Z' }));
    const before = await snapshot(dir);
    const r = await inspectRegistryFiles({ dir, expectedIdentity: 'q5a-test-app', isPidAlive: () => false });
    assert.equal(r.state, 'ready');
    assert.equal(r.lock, 'stale');
    assert.equal(r.keyStatus, 'present-unverified');
    assert.equal(r.keyVerified, false);
    assert.ok(r.events.length >= 15);
    assert.deepEqual(await snapshot(dir), before, 'no file created, moved or modified');
  });

  await t('inspector module never loads Electron (no secure-storage / Keychain path)', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'services', 'identityRegistryInspector.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.ok(!/require\(['"]electron['"]\)/.test(src));
    assert.ok(!/\b(mkdir|writeFile|rename|unlink|copyFile|open)\s*\(/.test(src.replace(/fsx\.readFile|fsx\.readdir|readIfExists/g, '')), 'no write-capable fs call in the inspector');
  });

  await t('locked by another live process: distinct "locked" state, still readable, lock untouched', async () => {
    const dir = path.join(await tmp('locked'), 'identity-registry');
    const { store } = await seedRegistry(dir, { build: richBuild });
    await store.close();
    const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},30000)'], { stdio: 'ignore' });
    try {
      await fsp.writeFile(path.join(dir, 'registry.lock'), JSON.stringify({ pid: child.pid, token: 'other', at: new Date().toISOString() }));
      const before = await snapshot(dir);
      const r = await inspectRegistryFiles({ dir, expectedIdentity: 'q5a-test-app' });
      assert.equal(r.state, 'locked');
      assert.equal(r.reason, 'locked-by-another-process');
      assert.ok(r.events.length > 0);
      assert.deepEqual(await snapshot(dir), before);
    } finally { child.kill(); }
  });

  await t('corrupt registry (not JSON / invalid document): "corrupt", nothing quarantined or rewritten', async () => {
    for (const body of ['{ not json', JSON.stringify({ format: 'autoingest-identity-registry', schemaVersion: 1, events: 'nope' })]) {
      const dir = path.join(await tmp('corrupt'), 'identity-registry');
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, 'registry.json'), body);
      const before = await snapshot(dir);
      const r = await inspectRegistryFiles({ dir });
      assert.equal(r.state, 'corrupt');
      assert.deepEqual(r.events, []);
      assert.deepEqual(await snapshot(dir), before);
      assert.equal(fs.existsSync(path.join(dir, 'quarantine')), false);
    }
  });

  await t('newer schema: "incompatible", left untouched', async () => {
    const dir = path.join(await tmp('newer'), 'identity-registry');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'registry.json'), JSON.stringify({ format: 'autoingest-identity-registry', schemaVersion: 99, events: [] }));
    const before = await snapshot(dir);
    const r = await inspectRegistryFiles({ dir });
    assert.equal(r.state, 'incompatible');
    assert.equal(r.reason, 'newer-schema-version');
    assert.deepEqual(await snapshot(dir), before);
  });

  await t('unreadable registry (a directory where the file should be): "unreadable"', async () => {
    const dir = path.join(await tmp('unreadable'), 'identity-registry');
    await fsp.mkdir(path.join(dir, 'registry.json'), { recursive: true });
    const r = await inspectRegistryFiles({ dir });
    assert.equal(r.state, 'unreadable');
  });

  await t('key status without decryption: missing / corrupt / other registry / identity mismatch', async () => {
    const dir = path.join(await tmp('keys'), 'identity-registry');
    const { store } = await seedRegistry(dir, { build: richBuild });
    await store.close();
    const keys = path.join(dir, 'keys.json');
    const good = fs.readFileSync(keys, 'utf8');
    assert.equal((await inspectRegistryFiles({ dir, expectedIdentity: 'another-app' })).keyStatus, 'key-protection-identity-mismatch');
    fs.writeFileSync(keys, JSON.stringify({ ...JSON.parse(good), registryId: '00000000-0000-4000-8000-000000000000' }));
    assert.equal((await inspectRegistryFiles({ dir })).keyStatus, 'key-registry-mismatch');
    fs.writeFileSync(keys, '{ broken');
    assert.equal((await inspectRegistryFiles({ dir })).keyStatus, 'key-file-corrupt');
    fs.unlinkSync(keys);
    const r = await inspectRegistryFiles({ dir });
    assert.equal(r.keyStatus, 'key-file-missing');
    assert.equal(r.state, 'ready', 'a missing key never hides the registry');
    const view = V.buildRegistryView({ registry: r, listNames: SHIPPED, shippedNames: SHIPPED });
    assert.equal(view.status.bodyMatching, 'unavailable');
    assert.ok(view.cameras.length > 0, 'cameras stay viewable without a key');
  });

  await t('read-only access during learning: concurrent appends never yield a torn or corrupt read', async () => {
    const dir = path.join(await tmp('concurrent'), 'identity-registry');
    const { store } = await seedRegistry(dir);
    let last = 0, reads = 0;
    const writer = (async () => {
      for (let i = 0; i < 40; i++) {
        const e = createEvent('photographer-registered', { photographerId: crypto.randomUUID(), name: `Concurrent ${i}`, idOrigin: 'random' }, { origin: { computerId: THIS, operatorId: null, workflow: 'event-import' }, at: '2026-10-01T00:00:00Z' });
        assert.equal((await store.appendEvents([e])).ok, true);
      }
    })();
    let done = false; writer.finally(() => { done = true; });
    while (!done) {
      const r = await inspectRegistryFiles({ dir });
      assert.equal(r.state, 'ready', `read ${reads}: ${r.state}`);
      assert.equal(r.lock, 'this-process');
      assert.ok(r.events.length >= last);
      last = r.events.length; reads++;
    }
    await writer;
    assert.equal((await inspectRegistryFiles({ dir })).events.length, 40);
    assert.ok(reads > 3);
    await store.close();
  });

  console.log('Q5a — photographer view models');

  await t('every list name appears; shipped, registered and not-yet-used local names are distinguished', async () => {
    const { view } = await richView();
    for (const n of [...SHIPPED.filter(n => n !== 'M. Testname'), ...OVERRIDE.filter(n => n !== 'Zed Same')]) assert.ok(view.photographers.some(p => p.listNames.includes(n)), n);
    const alpha = byName(view, 'Test Shipped Alpha');
    assert.equal(alpha.identity, 'shipped');
    assert.equal(alpha.photographerId, ID.alpha);
    const gamma = byName(view, 'Local Gamma');
    assert.equal(gamma.identity, 'registered');
    assert.equal(gamma.photographerId, ID.gamma);
    const delta = byName(view, 'Local Delta');
    assert.equal(delta.identity, 'pending-first-use');
    assert.equal(delta.photographerId, null, 'no ID is invented for a name never used');
    assert.equal(delta.key, 'name:local delta');
  });

  await t('renamed shipped photographer is ONE profile: current, original, former names and dated, attributed history', async () => {
    const { view } = await richView();
    const m = view.photographers.filter(p => p.photographerId === ID.murtaza);
    assert.equal(m.length, 1);
    const p = m[0];
    assert.equal(p.name, 'Murtaza Testname');
    assert.equal(p.originalName, 'M. Testname');
    assert.deepEqual(p.formerNames, ['M. Testname']);
    assert.deepEqual(p.listNames.sort(), ['M. Testname', 'Murtaza Testname']);
    assert.deepEqual(p.nameHistory, [{ day: '2026-10-05', at: '2026-10-05T09:00:00Z', fromName: 'M. Testname', toName: 'Murtaza Testname', stale: false, operator: 'Operator One', computer: 'this' }]);
    assert.ok(!view.photographers.some(x => x.key === 'name:murtaza testname'), 'the new name is not a second identity');
  });

  await t('repeated renames (A→B→C→A) keep one ID; every former name is kept', async () => {
    const dir = path.join(await tmp('renames'), 'identity-registry');
    const { store } = await seedRegistry(dir, {
      build: ({ ev }) => [
        ev('photographer-renamed', { photographerId: ID.alpha, fromName: 'Test Shipped Alpha', toName: 'Alpha Two' }, { at: '2026-10-01T00:00:00Z' }),
        ev('photographer-renamed', { photographerId: ID.alpha, fromName: 'Alpha Two', toName: 'Alpha Three' }, { at: '2026-10-02T00:00:00Z' }),
        ev('photographer-renamed', { photographerId: ID.alpha, fromName: 'Alpha Three', toName: 'Test Shipped Alpha' }, { at: '2026-10-03T00:00:00Z' }),
      ],
    });
    await store.close();
    const view = V.buildRegistryView({ registry: await inspectRegistryFiles({ dir }), listNames: ['Test Shipped Alpha', 'Alpha Two', 'Alpha Three'], shippedNames: SHIPPED });
    const ps = view.photographers.filter(p => p.photographerId === ID.alpha);
    assert.equal(ps.length, 1);
    assert.equal(ps[0].name, 'Test Shipped Alpha');
    assert.deepEqual(ps[0].formerNames, ['Alpha Three', 'Alpha Two']);
    assert.equal(ps[0].nameHistory.length, 3);
    assert.deepEqual(ps[0].nameHistory.map(h => h.toName), ['Alpha Two', 'Alpha Three', 'Test Shipped Alpha']);
    assert.equal(view.photographers.filter(p => p.listNames.some(n => /^alpha/i.test(n))).length, 1);
  });

  await t('learned shortcuts are labelled separately and are never former names or identity', async () => {
    const { view } = await richView();
    const m = byName(view, 'Murtaza Testname');
    assert.deepEqual(m.learnedShortcuts.map(s => s.text).sort(), ['mk', 'murt']);
    assert.ok(m.learnedShortcuts.every(s => s.learnedFor === 'M. Testname'));
    assert.ok(!m.formerNames.includes('mk'));
    assert.deepEqual(m.searchAliases, [], 'registered search aliases do not exist before Q5b');
    const idx = V.buildNameIndex(require('../services/associationModel').deriveRegistryState([], { shipped: P.bootstrapShippedIds(SHIPPED) }), P.bootstrapShippedIds(SHIPPED));
    assert.equal(idx.has('mk'), false);
  });

  await t('empty registry / no camera history: all names browsable, unsupported features reported unavailable', async () => {
    const view = V.buildRegistryView({ registry: await inspectRegistryFiles({ dir: path.join(await tmp('none'), 'identity-registry') }), listNames: [...SHIPPED, ...OVERRIDE], shippedNames: SHIPPED });
    assert.equal(view.status.state, 'missing');
    assert.equal(view.status.bodyMatching, 'not-applicable');
    assert.equal(view.cameras.length, 0);
    assert.equal(view.counts.withCameraHistory, 0);
    assert.equal(view.photographers.length, SHIPPED.length + OVERRIDE.length);
    assert.ok(view.photographers.every(p => p.cameras.length === 0 && p.nameHistory.length === 0 && p.status === 'active'));
    assert.deepEqual(Object.values(view.capabilities), [false, false, false, false, false, false]);
  });

  await t('corrupt or incompatible registry: names still browsable, no evidence invented', async () => {
    for (const state of ['corrupt', 'incompatible', 'unreadable', 'missing-backups-present']) {
      const view = V.buildRegistryView({ registry: { state, reason: 'x', events: [{ junk: true }] }, listNames: OVERRIDE, shippedNames: SHIPPED });
      assert.equal(view.status.state, state);
      assert.equal(view.cameras.length, 0);
      assert.equal(view.reviewItems.length, 0);
      assert.ok(view.photographers.some(p => p.name === 'Local Gamma' && p.identity === 'pending-first-use'));
    }
  });

  console.log('Q5a — camera view models');

  await t('shared camera: confirmed for one, disputed for another → shared, "alternatives", both listed', async () => {
    const { view } = await richView();
    const c = view.cameras.find(x => x.deviceId === ID.d2);
    assert.equal(c.make, 'SONY'); assert.equal(c.model, 'ILCE-7M3');
    assert.equal(c.shared, true);
    assert.equal(c.suggestion.level, 'alternatives');
    assert.deepEqual(c.associations.map(a => [a.name, a.state, a.label]).sort(), [['Local Gamma', 'disputed', 'Needs review'], ['Test Shipped Beta', 'confirmed', 'Confirmed']]);
    assert.deepEqual(c.identifierTypes, ['Sony internal ID']);
    assert.equal(byName(view, 'Test Shipped Beta').cameraCounts.shared, 1);
  });

  await t('observed camera on 3 days → "likely"; first/last observation from imports, not registration', async () => {
    const { view } = await richView();
    const c = view.cameras.find(x => x.deviceId === ID.d1);
    assert.equal(c.suggestion.level, 'likely');
    assert.equal(c.registeredDay, '2026-10-01');
    assert.equal(c.firstObservedDay, '2026-10-01');
    assert.equal(c.lastObservedDay, '2026-10-03');
    assert.equal(c.associations[0].label, 'Observed');
    assert.equal(c.associations[0].observedDays, 3);
    const m = byName(view, 'Murtaza Testname');
    assert.equal(m.lastObservedDay, '2026-10-03');
    assert.equal(m.cameras[0].model, 'EOS R5');
  });

  await t('model-only usage is listed separately, never as an identified camera', async () => {
    const { view } = await richView();
    const g = byName(view, 'Local Gamma');
    assert.deepEqual(g.modelsUsed, [{ make: 'FUJIFILM', model: 'x-t5', imports: 1, days: 1, lastObservedDay: '2026-10-08' }]);
    assert.ok(!view.cameras.some(c => c.make === 'FUJIFILM'));
  });

  await t('camera history: dated, plain language, this/another computer, operator names only', async () => {
    const { view } = await richView();
    const h = view.cameras.find(x => x.deviceId === ID.d2).history;
    assert.ok(h.some(x => x.what === 'Confirmed for Test Shipped Beta' && x.computer === 'this' && x.operator === 'Operator One'));
    assert.ok(h.some(x => x.what === 'Confirmed for Local Gamma' && x.computer === 'another' && x.operator === 'Unknown operator'));
    assert.ok(h.some(x => x.what === "Marked as not Local Gamma's camera"));
  });

  console.log('Q5a — conflicts and review');

  await t('conflicts presented with names/models: same name different IDs, ambiguous list name, dispute, overlapping cameras', async () => {
    const { view } = await richView();
    const kinds = view.reviewItems.map(r => r.kind).sort();
    for (const k of ['ambiguous-name', 'association-disputed', 'identifier-spans-devices', 'same-name-different-ids']) assert.ok(kinds.includes(k), k);
    const amb = view.photographers.find(p => p.identity === 'ambiguous');
    assert.equal(amb.name, 'Zed Same');
    assert.equal(amb.photographerId, null, 'an ambiguous list name is linked to no one');
    assert.equal(view.photographers.filter(p => p.photographerId === ID.zed1 || p.photographerId === ID.zed2).length, 2);
    const spans = view.reviewItems.find(r => r.kind === 'identifier-spans-devices');
    assert.deepEqual(spans.cameras.map(c => c.model), ['Z 8', 'Z 8']);
    assert.ok(view.cameras.find(c => c.deviceId === ID.d3).conflict);
    assert.ok(view.reviewItems.every(r => /^r-[0-9a-f]{16}$/.test(r.key) && r.title && r.explanation));
    assert.ok(byName(view, 'Local Gamma').review.length > 0);
  });

  console.log('Q5a — browsing');

  await t('search by current and former name; former name found and labelled', async () => {
    const { view } = await richView();
    const r = V.searchPhotographers(view, 'm. testname');
    assert.equal(r.results[0].key, ID.murtaza);
    assert.equal(r.results[0].matchedOn, 'former-name');
    assert.equal(V.searchPhotographers(view, 'Murtaza').results[0].matchedOn, 'name');
    assert.equal(r.selected, null);
  });

  await t('a shortcut shared by two people returns both, flags ambiguity, selects no one', async () => {
    const { view } = await richView();
    const r = V.searchPhotographers(view, 'mk');
    assert.equal(r.ambiguous, true);
    assert.equal(r.selected, null);
    assert.deepEqual(r.results.filter(x => x.matchedOn === 'learned-shortcut').map(x => x.name).sort(), ['Local Gamma', 'Murtaza Testname']);
    const one = V.searchPhotographers(view, 'lg');
    assert.equal(one.ambiguous, false);
    assert.equal(one.selected, null, 'even a unique shortcut selects nothing');
  });

  await t('camera search by model/make; photographer search reaches cameras', async () => {
    const { view } = await richView();
    assert.deepEqual(V.searchCameras(view, 'ilce').map(c => c.deviceId), [ID.d2]);
    assert.equal(V.searchCameras(view, 'nikon').length, 2);
    assert.ok(V.searchPhotographers(view, 'eos r5').results.some(x => x.key === ID.murtaza && x.matchedOn === 'camera'));
  });

  await t('filters and sorts', async () => {
    const { view } = await richView();
    const withCams = V.searchPhotographers(view, '', { filter: 'with-cameras' }).results.map(x => x.name);
    assert.ok(withCams.includes('Murtaza Testname') && withCams.includes('Local Gamma') && !withCams.includes('Local Delta'));
    assert.ok(V.searchPhotographers(view, '', { filter: 'no-camera-history' }).results.some(x => x.name === 'Local Delta'));
    assert.ok(V.searchPhotographers(view, '', { filter: 'needs-review' }).results.every(x => view.photographers.find(p => p.key === x.key).review.length));
    assert.equal(V.searchPhotographers(view, '', { filter: 'retired' }).results.length, 0);
    const names = V.searchPhotographers(view, '').results.map(x => x.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));
    const recent = V.searchPhotographers(view, '', { sort: 'last-observed' }).results.map(x => x.name);
    assert.equal(recent[0], 'Local Gamma'); // 2026-10-08
    assert.equal(recent[1], 'Murtaza Testname'); // 2026-10-03
  });

  await t('details: photographer and camera detail resolve review items; unknown keys → null', async () => {
    const { view } = await richView();
    const d = V.getPhotographerDetail(view, ID.gamma);
    assert.ok(d.reviewItems.length >= 1);
    d.name = 'mutated';
    assert.notEqual(byName(view, 'Local Gamma'), undefined, 'detail is a copy');
    assert.equal(V.getCameraDetail(view, ID.d2).reviewItems[0].kind, 'association-disputed');
    assert.equal(V.getPhotographerDetail(view, 'nope'), null);
    assert.equal(V.getCameraDetail(view, 'nope'), null);
  });

  console.log('Q5a — privacy');

  await t('no serial, digest, key ID, computer ID, import ID, path or raw event field in any view output', async () => {
    const { view, dir } = await richView();
    const outputs = [view, ...view.photographers.map(p => V.getPhotographerDetail(view, p.key)), ...view.cameras.map(c => V.getCameraDetail(view, c.deviceId)),
      V.searchPhotographers(view, 'mk'), V.searchCameras(view, '')];
    const text = JSON.stringify(outputs);
    const keyIds = JSON.parse(fs.readFileSync(path.join(dir, 'registry.json'), 'utf8')).keyIds;
    for (const s of [...FAKE_SERIALS, ...FAKE_SERIALS.map(digestOf), ...keyIds, THIS, OTHER, 'imp-fakeq5a', dir, os.tmpdir(), 'op-q5a-1', 'op-unknown-elsewhere']) {
      assert.ok(!text.includes(s), `leaked: ${s.slice(0, 24)}`);
    }
    assert.ok(!/[0-9a-f]{64}/.test(text), 'no 64-hex value');
    assert.ok(!/local-[0-9a-f]{12}/.test(text), 'no key ID');
    const forbidden = new Set(['digest', 'keyId', 'identifiers', 'computerId', 'operatorId', 'importId', 'eventId', 'origin', 'memberIds', 'provenance', 'ns']);
    const walk = (o) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { assert.ok(!forbidden.has(k), `forbidden field ${k}`); walk(v); } };
    walk(outputs);
  });

  console.log('Q5a — runtime accessor (fake Electron module, temp userData)');

  await t('inspectRegistry(): no registry → "missing", and NOTHING is created in userData', async () => {
    const R = await loadRuntime();
    const before = await snapshot(R.userData);
    const view = await R.runtime.inspectRegistry();
    assert.equal(view.status.state, 'missing');
    assert.ok(view.photographers.length >= 312, 'shipped list + local override browsable');
    assert.ok(view.photographers.some(p => p.name === 'Runtime Local Name' && p.identity === 'pending-first-use'));
    assert.deepEqual(await snapshot(R.userData), before);
    assert.equal(R.safeStorageTouched(), false);
  });

  await t('inspectRegistry(): reuses the open learning store (authoritative key status), else reads files only', async () => {
    const R = await loadRuntime();
    const dir = path.join(R.userData, 'identity-registry');
    const { store } = await seedRegistry(dir, { identity: 'q5a-fake-app', build: richBuild });
    R.runtime._forTests.useStore(store);
    let view = await R.runtime.inspectRegistry();
    assert.equal(view.status.state, 'ready');
    assert.equal(view.status.keyVerified, true);
    assert.equal(view.status.bodyMatching, 'available');
    assert.equal(view.status.pendingLearning, 0);
    assert.ok(view.cameras.length === 4);
    const before = await snapshot(R.userData);
    R.runtime._forTests.useStore(null);
    await store.close();
    const afterClose = await snapshot(R.userData);
    view = await R.runtime.inspectRegistry();
    assert.equal(view.status.keyVerified, false);
    assert.equal(view.status.bodyMatching, 'unknown');
    assert.equal(view.cameras.length, 4);
    assert.deepEqual(await snapshot(R.userData), afterClose);
    assert.ok(Object.keys(before).length > 0);
    assert.equal(R.safeStorageTouched(), false);
  });

  await t('inspectRegistry(): key protected under another app identity → key unavailable, registry still shown', async () => {
    const R = await loadRuntime();
    const dir = path.join(R.userData, 'identity-registry');
    const { store } = await seedRegistry(dir, { identity: 'some-other-app', build: richBuild });
    await store.close();
    const view = await R.runtime.inspectRegistry();
    assert.equal(view.status.keyStatus, 'key-protection-identity-mismatch');
    assert.equal(view.status.bodyMatching, 'unavailable');
    assert.equal(view.cameras.length, 4);
  });

  console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES above' : ''}`);
})();

/** Load the real runtime with a fake `electron` module (userData = temp; safeStorage trapped). */
async function loadRuntime() {
  const userData = await tmp('runtime');
  let touched = false;
  const electronPath = require.resolve('electron');
  const fakeElectron = {
    app: { getPath: (k) => (k === 'userData' ? userData : os.tmpdir()), getName: () => 'q5a-fake-app' },
    safeStorage: new Proxy({}, { get: () => { touched = true; throw new Error('safeStorage must not be touched'); } }),
  };
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: fakeElectron };
  for (const m of ['../services/photographerLearningRuntime', '../services/settings', '../main/userManager', '../main/listManager']) delete require.cache[require.resolve(m)];
  fs.writeFileSync(path.join(userData, 'photographers.override.json'), JSON.stringify(['Runtime Local Name']));
  require('../main/listManager').init(userData);
  const runtime = require('../services/photographerLearningRuntime');
  return { userData, runtime, safeStorageTouched: () => touched };
}
