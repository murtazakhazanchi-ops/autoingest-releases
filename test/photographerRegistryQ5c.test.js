'use strict';

// AI-FEAT-063 / AI-RM-014 Q5c — read-only Photographer Registry tab: the main-process browser
// session (opaque handles, privacy-scrubbed payloads), its IPC surface and its non-initializing
// data path. Registries are built with the REAL Q4 store and a FAKE secure storage in throw-away
// temp folders; every name, serial, computer ID and import ID is synthetic.
//
// Run: node test/photographerRegistryQ5c.test.js

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createIdentityRegistryStore } = require('../services/identityRegistryStore');
const { createEvent } = require('../services/identityEvents');
const P = require('../services/photographerIdentity');
const { slugify } = require('../main/aliasEngine');
const { inspectRegistryFiles } = require('../services/identityRegistryInspector');
const V = require('../services/photographerRegistryView');
const { createRegistryBrowser, assertRendererSafe, HANDLE_RE } = require('../services/photographerRegistryBrowser');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

const THIS = 'fake-computer-THIS-q5c';
const OTHER = 'fake-computer-OTHER-q5c';
const SERIALS = ['FAKEQ5CR5-0001', 'FAKEQ5CSONY-0002', 'FAKEQ5CSPAN-0003'];
const digestOf = (s) => crypto.createHash('sha256').update(`fake-digest|${s}`).digest('hex');
const fakeSecureStorage = () => ({
  backend: 'fake-test', identity: 'q5c-test-app', isAvailable: () => true,
  encrypt: (buf) => Buffer.concat([Buffer.from('SEALED:'), Buffer.from(buf.map(b => b ^ 0x5a))]),
  decrypt: (c) => Buffer.from(c.subarray(7).map(b => b ^ 0x5a)),
});
const tmp = (tag) => fsp.mkdtemp(path.join(os.tmpdir(), `ai-q5c-${tag}-`));

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

const SHIPPED = ['Test Shipped Alpha', 'Test Shipped Beta', 'Q. Testname'];
const OVERRIDE = ['Quentin Testname', 'Local Gamma', 'Zed Same'];
const ID = {
  alpha: P.shippedPhotographerId('Test Shipped Alpha'),
  beta: P.shippedPhotographerId('Test Shipped Beta'),
  quentin: P.shippedPhotographerId('Q. Testname'),
  gamma: '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5c',
  zed1: '11111111-2222-4333-8444-555555555556',
  zed2: '66666666-7777-4888-9999-aaaaaaaaaaab',
  d1: 'd1d1d1d1-0000-4000-8000-0000000000c1',
  d2: 'd2d2d2d2-0000-4000-8000-0000000000c2',
  d3: 'd3d3d3d3-0000-4000-8000-0000000000c3',
  d4: 'd4d4d4d4-0000-4000-8000-0000000000c4',
};
const OPERATORS = [{ id: 'op-q5c-1', name: 'Operator One' }];

async function seed(dir) {
  const store = createIdentityRegistryStore({ dir, secureStorage: fakeSecureStorage(), computerId: THIS });
  assert.equal((await store.open()).state, 'ready');
  const keyId = JSON.parse(fs.readFileSync(path.join(dir, 'registry.json'), 'utf8')).keyIds[0];
  let n = 0;
  const ev = (type, payload, { at, computerId = THIS, operatorId = 'op-q5c-1', workflow = 'event-import' } = {}) =>
    createEvent(type, payload, { origin: { computerId, operatorId, workflow }, at: at || `2026-10-01T00:00:${String(n++ % 60).padStart(2, '0')}Z` });
  const idf = (ns, serial) => [{ ns, keyId, digest: digestOf(serial), trusted: true }];
  const events = [
    ev('photographer-renamed', { photographerId: ID.quentin, fromName: 'Q. Testname', toName: 'Quentin Testname' }, { at: '2026-10-05T09:00:00Z', workflow: 'registry' }),
    ev('photographer-registered', { photographerId: ID.gamma, name: 'Local Gamma', idOrigin: 'random' }, { at: '2026-09-01T00:00:00Z' }),
    ev('photographer-registered', { photographerId: ID.zed1, name: 'Zed Same', idOrigin: 'random' }, { at: '2026-09-02T00:00:00Z' }),
    ev('photographer-registered', { photographerId: ID.zed2, name: 'Zed Same', idOrigin: 'random' }, { at: '2026-09-03T00:00:00Z', computerId: OTHER }),
    ev('photographer-alias-added', { photographerId: ID.gamma, alias: 'Gamma L', kind: 'spelling' }, { at: '2026-10-09T00:00:00Z', workflow: 'registry' }),
    ev('device-registered', { deviceId: ID.d1, make: 'Canon', modelKey: 'canon eos r5', modelDisplay: 'EOS R5', identifiers: idf('exif.bodySerial', SERIALS[0]) }, { at: '2026-10-01T08:00:00Z' }),
    ev('device-registered', { deviceId: ID.d2, make: 'SONY', modelKey: 'ilce-7m3', modelDisplay: 'ILCE-7M3', identifiers: idf('sony.internal', SERIALS[1]) }, { at: '2026-10-01T08:00:01Z' }),
    ev('device-registered', { deviceId: ID.d3, make: 'Nikon', modelKey: 'z 8', modelDisplay: 'Z 8', identifiers: idf('nikon.serial', SERIALS[2]) }, { at: '2026-10-01T08:00:02Z' }),
    ev('device-registered', { deviceId: ID.d4, make: 'Nikon', modelKey: 'z 8', modelDisplay: 'Z 8', identifiers: idf('nikon.serial', SERIALS[2]) }, { at: '2026-10-01T08:00:03Z', computerId: OTHER }),
    ...['2026-10-01', '2026-10-02'].map((day, i) => ev('import-observed', { importId: `imp-fakeq5c-${i}`, photographerId: ID.quentin, deviceId: ID.d1, fileCount: 10, day }, { at: `${day}T10:00:00Z` })),
    ev('import-observed', { importId: 'imp-fakeq5c-g1', photographerId: ID.gamma, deviceId: ID.d2, fileCount: 4, day: '2026-10-04' }, { at: '2026-10-04T10:00:00Z' }),
    ev('association-confirmed', { photographerId: ID.beta, deviceId: ID.d2, resolves: [] }, { at: '2026-10-06T10:00:00Z', workflow: 'registry' }),
    ev('association-confirmed', { photographerId: ID.gamma, deviceId: ID.d2, resolves: [] }, { at: '2026-10-07T10:00:00Z', computerId: OTHER, workflow: 'registry' }),
    ev('association-rejected', { photographerId: ID.gamma, deviceId: ID.d2, resolves: [] }, { at: '2026-10-07T11:00:00Z', workflow: 'registry' }),
    ev('model-observed', { importId: 'imp-fakeq5c-m1', photographerId: ID.gamma, make: 'FUJIFILM', modelKey: 'x-t5', fileCount: 3, day: '2026-10-08' }, { at: '2026-10-08T10:00:00Z' }),
  ];
  assert.equal((await store.appendEvents(events)).ok, true);
  await store.close();
  return { keyId };
}

function viewFrom(registry, extra = {}) {
  return V.buildRegistryView({
    registry, listNames: [...SHIPPED, ...OVERRIDE], shippedNames: SHIPPED,
    learnedShortcuts: { [slugify('Q. Testname')]: ['qt', 'zz'], [slugify('Local Gamma')]: ['zz', 'lg'] },
    operators: OPERATORS, thisComputerId: THIS, learning: { enabled: true, pendingCount: 1 }, ...extra,
  });
}

async function fixture() {
  const root = await tmp('rich');
  const dir = path.join(root, 'identity-registry');
  const { keyId } = await seed(dir);
  let loads = 0;
  const loadView = async () => { loads++; return viewFrom(await inspectRegistryFiles({ dir, expectedIdentity: 'q5c-test-app' })); };
  const browser = createRegistryBrowser({ loadView });
  return { root, dir, keyId, browser, loads: () => loads };
}

/** Every value that must never reach the renderer. */
function secretsOf(fx) {
  return [...Object.values(ID), ...SERIALS, ...SERIALS.map(digestOf), fx.keyId, THIS, OTHER, 'op-q5c-1',
    'imp-fakeq5c-0', 'imp-fakeq5c-1', 'imp-fakeq5c-g1', 'imp-fakeq5c-m1', fx.root, os.tmpdir()];
}
function assertClean(payload, fx, label) {
  const json = JSON.stringify(payload);
  for (const s of secretsOf(fx)) assert.ok(!json.includes(s), `${label}: leaked ${s.slice(0, 12)}…`);
  assertRendererSafe(payload);
}

(async () => {
  console.log('Q5c — registry browser (main process)');
  const fx = await fixture();
  const ov = await fx.browser.load();

  await t('load: overview carries status, counts, cameras and review items — no identity material', async () => {
    assert.equal(ov.ok, true);
    assert.equal(ov.status.state, 'ready');
    assert.equal(ov.status.readOnly, true);
    assert.equal(ov.status.pendingLearning, 1);
    assert.equal(ov.status.keyStatus, 'present-unverified');
    assert.equal(ov.status.bodyMatching, 'unknown');
    assert.deepEqual(Object.values(ov.capabilities).filter(Boolean), [], 'every management capability still off');
    assert.equal(ov.counts.cameras, 4);
    assert.ok(ov.cameras.every(c => HANDLE_RE.test(c.handle) && c.handle.startsWith('c-')));
    assertClean(ov, fx, 'overview');
  });

  await t('review queue: ambiguous name, disputed camera, overlapping camera records — all explained', async () => {
    const kinds = new Set(ov.reviewItems.map(r => r.kind));
    for (const k of ['ambiguous-name', 'association-disputed', 'identifier-spans-devices']) assert.ok(kinds.has(k), `has ${k}`);
    for (const r of ov.reviewItems) {
      assert.ok(r.title && r.explanation, 'plain-language title and explanation');
      assert.ok(/^r-[0-9a-f]{16}$/.test(r.id));
      for (const p of r.photographers) assert.ok(p.handle === null || HANDLE_RE.test(p.handle));
    }
    const amb = ov.reviewItems.find(r => r.kind === 'ambiguous-name');
    assert.ok(amb.photographers.some(p => p.name === 'Zed Same'));
  });

  await t('held registry evidence surfaces as a review item and a status count', async () => {
    const b = createRegistryBrowser({ loadView: async () => viewFrom({ ...(await inspectRegistryFiles({ dir: fx.dir })), heldCount: 2 }) });
    const o = await b.load();
    assert.equal(o.status.integrityConflicts, 2);
    assert.ok(o.reviewItems.some(r => r.kind === 'integrity-conflicts'));
  });

  await t('search: rows use opaque handles; former names, aliases and shortcuts match; shared shortcut is ambiguous', async () => {
    const all = fx.browser.search({});
    assert.equal(all.ok, true);
    assert.ok(all.results.every(r => HANDLE_RE.test(r.handle) && r.handle.startsWith('p-')));
    const former = fx.browser.search({ query: 'Q. Testname' });
    assert.equal(former.results[0].name, 'Quentin Testname');
    assert.equal(former.results[0].matchedOn, 'former-name');
    const alias = fx.browser.search({ query: 'Gamma L' });
    assert.equal(alias.results[0].name, 'Local Gamma');
    assert.equal(alias.results[0].matchedOn, 'search-alias');
    const shared = fx.browser.search({ query: 'zz' });
    assert.equal(shared.ambiguous, true, 'a shortcut shared by two people selects neither');
    assert.equal(shared.results.length, 2);
    assertClean([all, former, alias, shared], fx, 'search');
  });

  await t('search: filters and sorts are allow-listed; unknown values fall back; long queries are bounded', async () => {
    const review = fx.browser.search({ filter: 'needs-review' });
    assert.ok(review.results.length > 0 && review.results.every(r => r.needsReview));
    const cams = fx.browser.search({ filter: 'with-cameras', sort: 'camera-count' });
    assert.ok(cams.results.every((r, i, a) => i === 0 || a[i - 1].cameraCount >= r.cameraCount));
    const bogus = fx.browser.search({ filter: '__proto__', sort: 'constructor' });
    assert.equal(bogus.filter, 'all');
    assert.equal(bogus.sort, 'name');
    const long = fx.browser.search({ query: 'x'.repeat(10000) });
    assert.equal(long.ok, true);
    assert.equal(fx.browser.search({ query: { toString: () => 'boom' } }).ok, true, 'non-string query ignored');
  });

  await t('photographer profile: names, history, aliases vs shortcuts, cameras, models, review — handles only', async () => {
    const h = fx.browser.search({ query: 'Quentin Testname' }).results[0].handle;
    const d = fx.browser.photographer(h);
    assert.equal(d.ok, true);
    const p = d.profile;
    assert.equal(p.name, 'Quentin Testname');
    assert.equal(p.originalName, 'Q. Testname');
    assert.ok(p.formerNames.includes('Q. Testname'));
    assert.equal(p.nameHistory.length, 1);
    assert.equal(p.nameHistory[0].operator, 'Operator One');
    assert.equal(p.nameHistory[0].computer, 'this');
    assert.deepEqual(p.searchAliases, []);
    assert.deepEqual(p.learnedShortcuts.map(s => s.text).sort(), ['qt', 'zz']);
    assert.equal(p.cameras.length, 1);
    assert.ok(HANDLE_RE.test(p.cameras[0].handle));
    assertClean(d, fx, 'photographer');

    const g = fx.browser.photographer(fx.browser.search({ query: 'Local Gamma' }).results[0].handle);
    assert.deepEqual(g.profile.searchAliases.map(a => a.text), ['Gamma L'], 'registry alias listed separately from shortcuts');
    assert.deepEqual(g.profile.modelsUsed.map(m => m.make), ['FUJIFILM']);
    assert.ok(g.reviewItems.some(r => r.kind === 'association-disputed'));
    assertClean(g, fx, 'photographer gamma');
  });

  await t('camera detail: readable identifier labels, relationship states, plain-language reasons, history', async () => {
    const sony = ov.cameras.find(c => c.make === 'SONY');
    const d = fx.browser.camera(sony.handle);
    assert.equal(d.ok, true);
    const c = d.camera;
    assert.deepEqual(c.identifierTypes, ['Sony internal ID']);
    const states = c.associations.map(a => a.state).sort();
    assert.ok(states.every(s => ['confirmed', 'observed', 'disputed', 'rejected', 'retired'].includes(s)));
    assert.ok(c.associations.some(a => a.state === 'disputed'));
    assert.ok(c.associations.every(a => a.explanation && (a.photographer.handle === null || HANDLE_RE.test(a.photographer.handle))));
    assert.ok(c.suggestion.reasons.every(r => typeof r === 'string' && /[a-z] [a-z]/i.test(r)));
    assert.ok(c.history.length >= 3);
    assert.ok(c.history.every(h => !('importId' in h) && ['this', 'another'].includes(h.computer)));
    assertClean(d, fx, 'camera');
    // a camera's photographer link resolves to the same profile handle the list uses
    const beta = c.associations.find(a => a.photographer.name === 'Test Shipped Beta');
    assert.equal(fx.browser.photographer(beta.photographer.handle).profile.name, 'Test Shipped Beta');
  });

  await t('handles: malformed, unknown and non-string handles are refused; nothing resolves by name', async () => {
    for (const bad of [undefined, null, 42, {}, 'Quentin Testname', ID.quentin, 'p-zzzz', 'p-0000000000000000', 'c-0000000000000000', '../registry.json']) {
      assert.deepEqual(fx.browser.photographer(bad), { ok: false, reason: 'unknown-record' });
      assert.deepEqual(fx.browser.camera(bad), { ok: false, reason: 'unknown-record' });
    }
    const pHandle = fx.browser.search({}).results[0].handle;
    assert.deepEqual(fx.browser.camera(pHandle), { ok: false, reason: 'unknown-record' }, 'a photographer handle is not a camera handle');
  });

  await t('handles belong to one snapshot: a reload invalidates them and issues new ones', async () => {
    const before = fx.browser.search({}).results[0].handle;
    const camBefore = ov.cameras[0].handle;
    await fx.browser.load();
    assert.equal(fx.browser.photographer(before).ok, false);
    assert.equal(fx.browser.camera(camBefore).ok, false);
    const after = fx.browser.search({}).results[0].handle;
    assert.notEqual(after, before);
    assert.equal(fx.browser.photographer(after).ok, true);
  });

  await t('concurrent loads share one inspection', async () => {
    const n = fx.loads();
    const [a, b] = await Promise.all([fx.browser.load(), fx.browser.load()]);
    assert.equal(fx.loads(), n + 1);
    assert.equal(a.ok && b.ok, true);
  });

  await t('assertRendererSafe rejects IDs, digests, paths and identity fields; the browser refuses such payloads', async () => {
    assert.throws(() => assertRendererSafe({ x: ID.gamma }));
    assert.throws(() => assertRendererSafe({ x: digestOf('a') }));
    assert.throws(() => assertRendererSafe({ x: '/Users/someone/Archive' }));
    assert.throws(() => assertRendererSafe({ x: 'C:\\Archive' }));
    assert.throws(() => assertRendererSafe({ x: '\\\\nas\\share' }));
    for (const k of ['photographerId', 'deviceId', 'importId', 'computerId', 'keyId', 'digest', 'identifiers']) assert.throws(() => assertRendererSafe({ [k]: 'x' }));
    assert.doesNotThrow(() => assertRendererSafe({ name: 'Murtaza M. Testname', day: '2026-10-01', handle: 'p-0123456789abcdef', id: 'r-0123456789abcdef' }));
    const leaky = createRegistryBrowser({ loadView: async () => { const v = viewFrom({ state: 'missing' }); v.photographers[0].name = '/Users/leak/path'; return v; } });
    await leaky.load();
    assert.deepEqual(leaky.search({}), { ok: false, reason: 'unsafe-payload' }, 'a leaking payload is replaced, not sent');
  });

  await t('failure and empty states: loader failure, missing, corrupt and incompatible registries', async () => {
    const failing = createRegistryBrowser({ loadView: async () => { throw new Error('boom'); } });
    const f = await failing.load();
    assert.equal(f.ok, false);
    assert.equal(f.status.state, 'unreadable');
    assert.equal(failing.search({}).ok, false);
    for (const reg of [{ state: 'missing' }, { state: 'corrupt', reason: 'registry-not-json' }, { state: 'incompatible', reason: 'newer-schema-version' }, { state: 'missing-backups-present' }, { state: 'unreadable', reason: 'io-error:EACCES' }]) {
      const b = createRegistryBrowser({ loadView: async () => viewFrom(reg, { learning: { enabled: false, pendingCount: 0 } }) });
      const o = await b.load();
      assert.equal(o.ok, true);
      assert.equal(o.status.state, reg.state);
      assert.equal(o.status.learningEnabled, false);
      assert.equal(o.counts.cameras, 0, `${reg.state}: no camera history from an unusable registry`);
      assert.ok(b.search({}).results.length >= SHIPPED.length, `${reg.state}: photographers still browsable`);
    }
  });

  await t('non-initializing: browsing a missing registry creates nothing; browsing an existing one changes nothing', async () => {
    const root = await tmp('missing');
    const dir = path.join(root, 'identity-registry');
    const b = createRegistryBrowser({ loadView: async () => viewFrom(await inspectRegistryFiles({ dir, expectedIdentity: 'q5c-test-app' })) });
    const o = await b.load();
    assert.equal(o.status.state, 'missing');
    b.search({ query: 'a' });
    b.photographer(b.search({}).results[0].handle);
    assert.equal(fs.existsSync(dir), false);
    assert.deepEqual(await snapshot(root), {});

    const before = await snapshot(fx.root);
    await fx.browser.load();
    for (const r of fx.browser.search({}).results) fx.browser.photographer(r.handle);
    for (const c of fx.browser.overview().cameras) fx.browser.camera(c.handle);
    assert.deepEqual(await snapshot(fx.root), before, 'no registry, key, lock, backup or quarantine file touched');
  });

  console.log('Q5c — IPC and module boundaries');

  await t('main.js: four read-only photographerRegistry channels (+ the Q5d decision channels), each limited to the main window', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'main', 'main.js'), 'utf8');
    const channels = [...src.matchAll(/ipcMain\.(?:handle|on)\('(photographerRegistry:[A-Za-z]+)'/g)].map(m => m[1]);
    // Q5d (authorized) adds exactly the three decision channels; reads stay as Q5c shipped them.
    assert.deepEqual(channels.sort(), ['photographerRegistry:camera', 'photographerRegistry:cancel', 'photographerRegistry:commit', 'photographerRegistry:load', 'photographerRegistry:photographer', 'photographerRegistry:prepare', 'photographerRegistry:renamePreview', 'photographerRegistry:search']);
    const block = src.slice(src.indexOf('Photographer Registry tab (AI-FEAT-063'), src.indexOf("ipcMain.handle('keywords:saveCityCountry'"));
    assert.ok(/event\.sender !== main\.webContents/.test(block), 'sender must be the main window');
    assert.equal((block.match(/= _photographerRegistry\(event\)/g) || []).length, 8, 'every handler validates the sender');
    assert.ok(!/appendEvents|createIdentityRegistryStore|\.open\(|writeFile|buildRenameEvent|createProfileCommandService|planCurrentEventFolderRename/.test(block), 'no direct store write, naming or folder path in main.js');
  });

  await t('main.js / preload.js change since Q5b is additions only, confined to the Q5c block', async () => {
    let base;
    try { base = execFileSync('git', ['rev-parse', '--verify', 'aa58eb1^{commit}'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { console.log('    (Q5b commit not available — skipped)'); return; }
    for (const f of ['main/main.js', 'main/preload.js']) {
      const lines = execFileSync('git', ['diff', '-U0', base, '--', f], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
      assert.deepEqual(lines.filter(l => l.startsWith('-')), [], `${f}: nothing removed`);
    }
    const pre = execFileSync('git', ['diff', '-U0', base, '--', 'main/preload.js'], { cwd: ROOT, encoding: 'utf8' });
    const exposed = [...pre.matchAll(/^\+\s+(\w+):/gm)].map(m => m[1]);
    assert.deepEqual(exposed.sort(), ['photographerRegistryCamera', 'photographerRegistryCancel', 'photographerRegistryCommit', 'photographerRegistryLoad', 'photographerRegistryPhotographer', 'photographerRegistryPrepare', 'photographerRegistryRenamePreview', 'photographerRegistrySearch']);
  });

  await t('Q5c/Q5d touch no import, routing, sync, metadata or autocomplete module', async () => {
    let base;
    try { base = execFileSync('git', ['rev-parse', '--verify', 'aa58eb1^{commit}'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return; }
    const changed = [
      ...execFileSync('git', ['diff', '--name-only', base], { cwd: ROOT, encoding: 'utf8' }).split('\n'),
      ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' }).split('\n'),
    ].filter(Boolean).filter(f => !f.startsWith('graphify-out/'));
    const allowed = new Set([
      'main/main.js', 'main/preload.js', 'renderer/index.html', 'renderer/renderer.js', 'renderer/photographerRegistryUI.js',
      'services/photographerRegistryBrowser.js', 'test/photographerRegistryQ5c.test.js', 'test/photographerRegistryQ5cLive.test.js',
      'test/companionQ1UiFreeze.test.js', 'test/photographerRegistryQ5b.test.js',
      // Q5d: decisions (builders, manager, actions UI), the view's history/unsettled labels, the
      // runtime's non-initializing management open, the store's opt-in non-initializing open and the
      // key store's identity check before any secure-storage (Keychain) access.
      'services/cameraAssociationCommands.js', 'services/photographerRegistryManager.js', 'services/photographerRegistryView.js',
      'services/photographerLearningRuntime.js', 'services/identityRegistryStore.js', 'services/identityKeyStore.js', 'renderer/photographerRegistryActions.js',
      'test/photographerRegistryQ5d.test.js', 'test/photographerRegistryQ5dLive.test.js',
      // Q5e-1: profile status event + derivation, suggestion exclusion of retired profiles, profile
      // actions, the read-only event-copy resolver for the rename preview, and the profile UI.
      'services/identityEvents.js', 'services/photographerNameModel.js', 'services/photographerSuggestion.js', 'services/photographerProfileCommands.js',
      'services/photographerProfileActions.js', 'services/eventCopyResolver.js', 'renderer/photographerRegistryProfile.js',
      'test/photographerRegistryQ5e1.test.js', 'test/photographerRegistryQ5e1Live.test.js',
      // Q5e-2a: S1 event-folder identity foundation (not connected to import, sync or UI).
      'services/eventPhotographerFolders.js', 'services/photographerRenameContract.js', 'test/eventPhotographerFoldersQ5e2a.test.js',
    ]);
    assert.deepEqual(changed.filter(f => !allowed.has(f) && !f.startsWith('.claude/')), []);
  });

  console.log(`${passed} passed`);
})();
