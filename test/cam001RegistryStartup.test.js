'use strict';

// CAM-001 — immediate photographer recognition: the registry key is decrypted through a helper
// process (secureStorageHelper.js ↔ secureStorageHelperProcess.js), so the main process never waits
// on the Keychain. Covers the helper protocol (ready / stall / crash / refusal / identity mismatch /
// garbage / spawn failure / recovery), the key store and registry store over an asynchronous
// adapter (no key regenerated, no file rewritten, transient failures retried), the companion's
// reasons, and static guards (no safeStorage in the main process on macOS).
// Uses a fake helper (plain Node) with reversible fake sealing — no Electron, no Keychain.
// Run: node test/cam001RegistryStartup.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const { PassThrough } = require('node:stream');

const { createHelperSecureStorage } = require('../services/secureStorageHelper');
const { runKeyHelper, LINE_PREFIX, HELPER_FLAG, IDENTITY_ARG } = require('../services/secureStorageHelperProcess');
const { createIdentityKeyStore } = require('../services/identityKeyStore');
const { createIdentityRegistryStore } = require('../services/identityRegistryStore');
const { suggestForCard } = require('../services/companionPhotographerSuggestion');
const { fileIdentity } = require('../services/cameraIdentityEvidence');
const { assessCameras } = require('../services/cameraAssessmentModel');

const ROOT_DIR = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cam001-unit-'));
let passed = 0;
const queue = [];
const t = (name, fn) => queue.push({ name, fn });

// ── Fake helper: same protocol, reversible fake sealing, failure modes via argv ──────────────
const FAKE = path.join(TMP, 'fake-helper.js');
fs.writeFileSync(FAKE, `'use strict';
const mode = process.argv[2];
const P = ${JSON.stringify(LINE_PREFIX)};
const send = (m) => process.stdout.write(P + JSON.stringify(m) + '\\n');
const seal = (b) => Buffer.concat([Buffer.from('SEALED:'), Buffer.from(b.map(x => x ^ 0x5a))]);
const unseal = (c) => { if (!c.subarray(0, 7).equals(Buffer.from('SEALED:'))) throw new Error('bad'); return Buffer.from(c.subarray(7).map(x => x ^ 0x5a)); };
if (mode === 'fatal') { send({ type: 'fatal', reason: 'identity-mismatch' }); process.exit(3); }
if (mode !== 'noready') { if (mode === 'garbage') process.stdout.write('Chromium says hello\\n' + P + '{not json\\n'); send({ type: 'ready' }); }
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  buf += c; let nl;
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const req = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1);
    if (mode === 'stall') continue;
    if (mode === 'crash') process.exit(70);
    try {
      if (req.op === 'isAvailable') send({ id: req.id, ok: true, value: mode !== 'deny' });
      else if (mode === 'opfail') send({ id: req.id, ok: false, error: 'failed' });
      else {
        const input = Buffer.from(req.data, 'base64');
        send({ id: req.id, ok: true, value: (req.op === 'encrypt' ? seal(input) : unseal(input)).toString('base64') });
      }
    } catch { send({ id: req.id, ok: false, error: 'failed' }); }
  }
});
process.stdin.on('end', () => process.exit(0));
`);

const spawned = [];
function helper(modes, extra = {}) {
  const list = Array.isArray(modes) ? modes.slice() : [modes];
  const events = [];
  const ss = createHelperSecureStorage({
    identity: 'cam001-test', backend: 'fake-helper',
    spawnHelper: () => {
      const mode = list.length > 1 ? list.shift() : list[0];
      if (mode === 'spawn-throws') throw new Error('ENOENT');
      const p = cp.spawn(process.execPath, [FAKE, mode], { stdio: ['pipe', 'pipe', 'ignore'] });
      spawned.push(p);
      return p;
    },
    onWaiting: (w) => events.push(w),
    startTimeoutMs: 3000, requestTimeoutMs: 1500, waitingAfterMs: 300, idleCloseMs: 200, ...extra,
  });
  return { ss, events };
}
const exited = (p) => new Promise(r => (p.exitCode !== null || p.signalCode !== null ? r() : p.once('exit', r)));
const codeOf = async (promise) => { try { await promise; return 'resolved'; } catch (e) { return e.code; } };

// Synchronous fake with the SAME sealing — what an older, in-process build wrote.
const syncSecure = () => ({
  backend: 'fake-helper', identity: 'cam001-test', isAvailable: () => true,
  encrypt: (b) => Buffer.concat([Buffer.from('SEALED:'), Buffer.from(b.map(x => x ^ 0x5a))]),
  decrypt: (c) => Buffer.from(c.subarray(7).map(x => x ^ 0x5a)),
});

let dirN = 0;
const freshDir = () => path.join(TMP, `ud-${++dirN}`, 'identity-registry');
const snapshot = async (dir) => {
  const out = {};
  for (const f of ['registry.json', 'keys.json']) { try { out[f] = await fsp.readFile(path.join(dir, f), 'utf8'); } catch { out[f] = null; } }
  return out;
};
async function existingRegistry() {
  const dir = freshDir();
  const s = createIdentityRegistryStore({ dir, secureStorage: syncSecure(), computerId: 'comp-cam' });
  const st = await s.open();
  assert.equal(st.state, 'ready'); assert.equal(st.bodyMatching, true);
  await s.close();
  return dir;
}

// ── A. Helper adapter ─────────────────────────────────────────────────────
t('A1 healthy helper: available, encrypt → decrypt round-trip, closes itself when idle', async () => {
  const { ss } = helper('ok');
  assert.equal(await ss.isAvailable(), true);
  const key = Buffer.alloc(32, 0x33);
  const sealed = await ss.encrypt(key);
  assert.ok(sealed.subarray(0, 7).equals(Buffer.from('SEALED:')));
  assert.ok((await ss.decrypt(sealed)).equals(key));
  await exited(spawned[spawned.length - 1]);   // stdin closed after idleCloseMs
});

t('A2 stalled Keychain call: times out, reports waiting then not waiting, kills the helper', async () => {
  const { ss, events } = helper('stall');
  const started = Date.now();
  // The event loop keeps running while the helper is stalled (the old freeze blocked it).
  let ticks = 0;
  const timer = setInterval(() => ticks++, 50);
  assert.equal(await codeOf(ss.isAvailable()), 'secure-storage-timeout');
  clearInterval(timer);
  assert.ok(Date.now() - started >= 1400, 'waited for the request timeout');
  assert.ok(ticks >= 20, `event loop kept running (${ticks} ticks)`);
  assert.deepEqual(events, [true, false]);
  await exited(spawned[spawned.length - 1]);
});

t('A3 helper crashes mid-request → helper-failed; a later call starts a new helper and succeeds', async () => {
  const { ss } = helper(['crash', 'ok']);
  assert.equal(await codeOf(ss.isAvailable()), 'secure-storage-helper-failed');
  assert.equal(await ss.isAvailable(), true);
  ss.close();
});

t('A4 identity mismatch (fatal), no ready line, spawn failure → failures with codes only', async () => {
  assert.equal(await codeOf(helper('fatal').ss.isAvailable()), 'secure-storage-helper-failed');
  assert.equal(await codeOf(helper('noready').ss.isAvailable()), 'secure-storage-timeout');
  assert.equal(await codeOf(helper('spawn-throws').ss.isAvailable()), 'secure-storage-helper-failed');
});

t('A5 refusal and failed operations; unrelated output lines are ignored', async () => {
  const d = helper('deny').ss;
  assert.equal(await d.isAvailable(), false);
  d.close();
  const o = helper('opfail').ss;
  assert.equal(await codeOf(o.decrypt(Buffer.from('SEALED:xx'))), 'secure-storage-op-failed');
  o.close();
  const g = helper('garbage').ss;
  assert.equal(await g.isAvailable(), true);
  g.close();
});

t('A6 errors carry a code only — never key material or input', async () => {
  const { ss } = helper('opfail');
  const secret = Buffer.alloc(32, 0x7e);
  try { await ss.encrypt(secret); assert.fail('should fail'); } catch (e) {
    assert.equal(e.message, 'secure-storage-op-failed');
    assert.ok(!JSON.stringify({ m: e.message, s: e.stack }).includes(secret.toString('base64')));
  }
  ss.close();
});

// ── B. Key store and registry store over the asynchronous adapter ───────────
t('B1 keys written by an older in-process build are read through the helper; nothing rewritten', async () => {
  const dir = await existingRegistry();
  const before = await snapshot(dir);
  const { ss } = helper('ok');
  const s = createIdentityRegistryStore({ dir, secureStorage: ss, computerId: 'comp-cam' });
  const st = await s.open({ initialize: false });
  assert.equal(st.state, 'ready'); assert.equal(st.bodyMatching, true); assert.equal(st.keyStatus, 'ready');
  assert.ok(s.getKeyring());
  await s.close(); ss.close();
  assert.deepEqual(await snapshot(dir), before);
});

t('B2 stalled helper: registry opens without body matching (transient); reloadKeys recovers; files unchanged', async () => {
  const dir = await existingRegistry();
  const before = await snapshot(dir);
  const { ss } = helper(['stall', 'ok']);
  const s = createIdentityRegistryStore({ dir, secureStorage: ss, computerId: 'comp-cam' });
  let st = await s.open({ initialize: false });
  assert.equal(st.state, 'ready'); assert.equal(st.bodyMatching, false); assert.equal(st.keyStatus, 'secure-storage-timeout');
  st = await s.reloadKeys();
  assert.equal(st.bodyMatching, true);
  await s.close(); ss.close();
  assert.deepEqual(await snapshot(dir), before);
});

t('B3 refused access: secure-storage-unavailable, NOT retried by reloadKeys, no key generated', async () => {
  const dir = await existingRegistry();
  const before = await snapshot(dir);
  let spawns = 0;
  const { ss } = helper('deny', {});
  const counting = { ...ss, isAvailable: () => { spawns++; return ss.isAvailable(); } };
  const s = createIdentityRegistryStore({ dir, secureStorage: counting, computerId: 'comp-cam' });
  let st = await s.open({ initialize: false });
  assert.equal(st.keyStatus, 'secure-storage-unavailable');
  st = await s.reloadKeys();
  assert.equal(st.keyStatus, 'secure-storage-unavailable');
  assert.equal(spawns, 1, 'a refusal is not asked again automatically');
  await s.close(); ss.close();
  assert.deepEqual(await snapshot(dir), before);
});

t('B4 helper crash during decryption → helper-failed (transient), registry data unchanged', async () => {
  const dir = await existingRegistry();
  const before = await snapshot(dir);
  const { ss } = helper('crash');
  const s = createIdentityRegistryStore({ dir, secureStorage: ss, computerId: 'comp-cam' });
  const st = await s.open({ initialize: false });
  assert.equal(st.keyStatus, 'secure-storage-helper-failed');
  await s.close(); ss.close();
  assert.deepEqual(await snapshot(dir), before);
});

t('B5 missing key file: body matching off, no key generated or replaced, registry untouched', async () => {
  const dir = await existingRegistry();
  await fsp.rm(path.join(dir, 'keys.json'));
  const before = await snapshot(dir);
  const { ss } = helper('ok');
  const s = createIdentityRegistryStore({ dir, secureStorage: ss, computerId: 'comp-cam' });
  const st = await s.open({ initialize: false });
  assert.equal(st.keyStatus, 'key-file-missing');
  await s.reloadKeys();
  await s.close(); ss.close();
  assert.deepEqual(await snapshot(dir), before);
  assert.equal(before['keys.json'], null);
});

t('B6 corrupt registry: disabled, quarantined copy, original left in place', async () => {
  const dir = await existingRegistry();
  await fsp.writeFile(path.join(dir, 'registry.json'), '{ not json');
  const { ss } = helper('ok');
  const s = createIdentityRegistryStore({ dir, secureStorage: ss, computerId: 'comp-cam' });
  const st = await s.open({ initialize: false });
  assert.equal(st.state, 'disabled'); assert.equal(st.reason, 'registry-corrupt');
  assert.equal(await fsp.readFile(path.join(dir, 'registry.json'), 'utf8'), '{ not json');
  await s.close(); ss.close();
});

t('B7 no registry yet: startup open (initialize:false) creates nothing and never asks the helper', async () => {
  const dir = freshDir();
  let calls = 0;
  const { ss } = helper('ok');
  const counting = { ...ss, isAvailable: () => { calls++; return ss.isAvailable(); }, decrypt: (c) => { calls++; return ss.decrypt(c); } };
  const s = createIdentityRegistryStore({ dir, secureStorage: counting, computerId: 'comp-cam' });
  const st = await s.open({ initialize: false });
  assert.equal(st.reason, 'registry-missing');
  assert.equal(calls, 0);
  assert.equal(fs.existsSync(dir), false);
  ss.close();
});

t('B8 first registry with a helper that cannot answer: nothing created, lock released, next attempt succeeds', async () => {
  const dir = freshDir();
  const { ss } = helper(['stall', 'ok']);
  const s = createIdentityRegistryStore({ dir, secureStorage: ss, computerId: 'comp-cam' });
  let st = await s.open();
  assert.equal(st.state, 'disabled'); assert.equal(st.reason, 'secure-storage-timeout');
  assert.equal(fs.existsSync(path.join(dir, 'registry.json')), false, 'no key-less registry');
  assert.equal(fs.existsSync(path.join(dir, 'keys.json')), false);
  assert.equal(fs.existsSync(path.join(dir, 'registry.lock')), false, 'lock released');
  await s.close();
  st = await s.open();
  assert.equal(st.state, 'ready'); assert.equal(st.bodyMatching, true);
  await s.close(); ss.close();
});

t('B9 key store with the async adapter: identity mismatch refused before the helper is asked', async () => {
  const dir = await existingRegistry();
  let calls = 0;
  const ks = createIdentityKeyStore({ dir, secureStorage: { identity: 'another-app', backend: 'x', isAvailable: async () => { calls++; return true; }, decrypt: async () => { calls++; return Buffer.alloc(32); } } });
  const doc = JSON.parse(await fsp.readFile(path.join(dir, 'registry.json'), 'utf8'));
  const r = await ks.load(doc.registryId, doc.keyIds);
  assert.equal(r.reason, 'key-protection-identity-mismatch');
  assert.equal(calls, 0);
});

// ── C. Companion reasons ──────────────────────────────────────────────────
t('C1 registry ready without a usable key: the suggestion states the key reason, names nobody', async () => {
  const records = [{ path: '/fake/A.JPG', name: 'A.JPG', type: 'photo', pairKey: null, evidence: null, identity: fileIdentity({ 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS R5', 'ExifIFD:SerialNumber': 'FAKECAM0001' }) }];
  for (const keyReason of ['keychain-denied', 'keychain-helper-failed', 'body-matching-unavailable']) {
    const r = suggestForCard({ records, assessed: assessCameras(records), registry: { ok: true, keyring: null, keyReason, state: {}, retired: new Set(), shipped: {} }, listNames: ['Testalpha Bhai'] });
    assert.deepEqual(r, { status: 'unknown', reason: keyReason, candidates: [] });
  }
});

// ── D. Helper child (fake Electron) ───────────────────────────────────────
function fakeElectron(name, { available = true } = {}) {
  const calls = [];
  const app = {
    exitCode: null, getName: () => name, on: () => {}, setActivationPolicy: (p) => calls.push(`policy:${p}`), disableHardwareAcceleration: () => {},
    whenReady: () => Promise.resolve(), exit: (c) => { app.exitCode = c; },
  };
  const safeStorage = {
    isEncryptionAvailable: () => { calls.push('isAvailable'); return available; },
    encryptString: (s) => { calls.push('encrypt'); return Buffer.concat([Buffer.from('v10'), Buffer.from(s)]); },
    decryptString: (c) => { calls.push('decrypt'); return c.subarray(3).toString(); },
  };
  return { electron: { app, safeStorage }, calls };
}
async function childRun(name, argvIdentity, env = {}, requests = []) {
  const { electron, calls } = fakeElectron(name);
  const stdin = new PassThrough(), stdout = new PassThrough();
  let out = '';
  stdout.on('data', (c) => { out += c; });
  runKeyHelper({ electron, argv: ['x', HELPER_FLAG, `${IDENTITY_ARG}${argvIdentity}`], env, stdin, stdout });
  await new Promise(r => setImmediate(r));
  for (const q of requests) stdin.write(`${JSON.stringify(q)}\n`);
  await new Promise(r => setTimeout(r, 30));
  stdin.end();
  await new Promise(r => setTimeout(r, 10));
  const msgs = out.split('\n').filter(Boolean).map(l => JSON.parse(l.slice(LINE_PREFIX.length)));
  return { msgs, calls, exitCode: electron.app.exitCode };
}

t('D1 helper child refuses another identity before touching secure storage', async () => {
  const r = await childRun('autoingest-x-livetest', 'auto-ingest', {}, [{ id: 1, op: 'isAvailable' }]);
  assert.deepEqual(r.msgs, [{ type: 'fatal', reason: 'identity-mismatch' }]);
  assert.ok(!r.calls.includes('isAvailable'));
  assert.equal(r.exitCode, 3);
});

t('D2 helper child round-trip; no Dock icon; exits when stdin closes', async () => {
  const plain = Buffer.alloc(32, 9).toString('base64');
  const r = await childRun('autoingest-x-livetest', 'autoingest-x-livetest', {}, [{ id: 1, op: 'isAvailable' }, { id: 2, op: 'encrypt', data: plain }]);
  assert.deepEqual(r.msgs[0], { type: 'ready' });
  assert.deepEqual(r.msgs[1], { id: 1, ok: true, value: true });
  assert.equal(r.msgs[2].ok, true);
  assert.ok(r.calls.includes('policy:accessory'));
  assert.equal(r.exitCode, 0);
});

t('D3 test seam is honoured for a test identity and IGNORED for the production identities', async () => {
  const env = { AUTOINGEST_KEY_HELPER_TEST: JSON.stringify({ result: 'deny' }) };
  const test = await childRun('autoingest-x-livetest', 'autoingest-x-livetest', env, [{ id: 1, op: 'isAvailable' }]);
  assert.deepEqual(test.msgs[1], { id: 1, ok: true, value: false });
  for (const prod of ['auto-ingest', 'AutoIngest']) {
    const p = await childRun(prod, prod, env, [{ id: 1, op: 'isAvailable' }]);
    assert.deepEqual(p.msgs[1], { id: 1, ok: true, value: true }, prod);
  }
});

// ── E. Static guards ──────────────────────────────────────────────────────
const read = (rel) => fs.readFileSync(path.join(ROOT_DIR, rel), 'utf8');
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

t('E1 safeStorage is called only by the adapter module and the helper child', () => {
  const offenders = [];
  for (const dir of ['main', 'services', 'renderer']) {
    const walk = (d) => {
      for (const e of fs.readdirSync(path.join(ROOT_DIR, d), { withFileTypes: true })) {
        const rel = path.join(d, e.name);
        if (e.isDirectory()) walk(rel);
        else if (/\.js$/.test(e.name) && /safeStorage/.test(code(rel))) offenders.push(rel);
      }
    };
    walk(dir);
  }
  assert.deepEqual(offenders.sort(), ['services/electronSecureStorage.js', 'services/secureStorageHelperProcess.js']);
});

t('E2 on macOS the runtime uses the helper; the in-process adapter only on other platforms', () => {
  const src = code('services/photographerLearningRuntime.js');
  const fn = src.slice(src.indexOf('function _secureStorage()'), src.indexOf('function _setPhase('));
  const darwin = fn.slice(fn.indexOf("process.platform === 'darwin'"), fn.indexOf('} else {'));
  assert.match(darwin, /createHelperSecureStorage/);
  assert.doesNotMatch(darwin, /electronSecureStorage/);
  assert.equal((src.match(/electronSecureStorage/g) || []).length, 1, 'required in exactly one (non-macOS) place');
  assert.doesNotMatch(src.slice(src.indexOf('function _sharedStore')), /createElectronSecureStorage\(\)/);
});

t('E3 main.js enters helper mode before the single-instance lock and any service', () => {
  const src = code('main/main.js');
  const helper = src.indexOf('HELPER_FLAG');
  assert.ok(helper > 0 && helper < src.indexOf('requestSingleInstanceLock'));
  assert.ok(helper < src.indexOf("require('./driveDetector')"));
  assert.match(src, /photographerLearning\.startRegistryForSuggestions\(\)/);
});

t('E4 the companion and the menu bar never open the registry or touch secure storage', () => {
  for (const rel of ['services/companionService.js', 'services/companionPhotographerSuggestion.js', 'renderer/companion/companion.js', 'services/eventDumpCompanion.js']) {
    const src = code(rel);
    assert.doesNotMatch(src, /safeStorage|identityKeyStore|electronSecureStorage|secureStorageHelper|openRegistryForManagement|createIdentityRegistryStore|startRegistryForSuggestions/, rel);
  }
});

(async () => {
  for (const { name, fn } of queue) {
    try { await fn(); passed++; console.log(`  ok — ${name}`); }
    catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
  }
  for (const p of spawned) { try { p.kill('SIGKILL'); } catch { /* gone */ } }
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${passed}/${queue.length} passed`);
})();
