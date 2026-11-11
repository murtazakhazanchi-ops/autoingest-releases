'use strict';
// AI-FEAT-063 / AI-RM-014 Q5a — LIVE: the read-only registry accessor inside the real app
// (real main.js, real Electron, real safeStorage available but never touched).
//
// Isolation (same recipe as the Q4c/Q4d live tests): temp userData; drivelist stubbed; the real
// main.js loads through a test-only wrapper app named "autoingest-q5a-livetest". This test
// must leave NO Keychain item behind — not even the test one — because inspection never
// creates or decrypts a key. Synthetic names and FAKE identifiers only.
//
// Requires playwright-core (npm install --no-save playwright-core).
// Run: node test/photographerRegistryQ5aLive.test.js

const { _electron: electron } = require('playwright-core');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const H = require('./support/liveTestHarness');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_BIN = require(path.join(PROJECT_ROOT, 'node_modules', 'electron'));
const TEST_PKG_NAME = 'autoingest-q5a-livetest';
const KEYCHAIN_ITEM = `${TEST_PKG_NAME} Safe Storage`;

function log(...a) { console.log('[q5a-live]', ...a); }
let failures = 0;
function check(c, m) { if (c) log('PASS —', m); else { failures++; log('FAIL —', m); } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const keychainHas = (s) => { try { execFileSync('security', ['find-generic-password', '-s', s], { stdio: 'ignore' }); return true; } catch { return false; } };

const WRAPPER_INDEX = `
'use strict';
const { app } = require('electron');
app.setPath('userData', process.env.AI_TEST_USERDATA);
require(process.env.AI_TEST_PROJECT_ROOT + '/main/main.js');
`;

async function passSplash(app) {
  const w = await app.firstWindow({ timeout: 60000 });
  await w.waitForTimeout(1500);
  const mainP = app.waitForEvent('window', { predicate: p => p.url().endsWith('index.html'), timeout: 30000 });
  await w.evaluate(() => {
    const vis = id => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
    if (vis('splashSelect')) { const u = document.querySelector('.splash-user-item'); if (u) { u.click(); document.getElementById('splashSelectStartBtn').click(); } else document.getElementById('splashNewProfileBtn').click(); }
    if (vis('splashWelcome')) document.getElementById('splashContinueBtn').click();
  });
  await sleep(300);
  try { await w.fill('#splashInputName', 'Q5a Operator', { timeout: 2000 }); await w.fill('#splashInputRole', 'QA'); await w.click('#splashCreateStartBtn'); } catch { /* existing profile */ }
  const main = await mainP;
  await main.waitForLoadState('domcontentloaded');
  await main.waitForTimeout(1500);
  return main;
}

async function launch(work, userDataDir, drivesFile) {
  const app = await electron.launch({
    executablePath: ELECTRON_BIN, args: ['-r', H.PRELOAD, path.join(work, 'wrapper-app'), '--no-sandbox'],
    cwd: PROJECT_ROOT, timeout: 60000,
    env: { ...process.env, AI_TEST_ISO_LOG: path.join(path.dirname(drivesFile), 'live-iso.jsonl'), AI_TEST_DRIVES_FILE: drivesFile, AI_TEST_PROJECT_ROOT: PROJECT_ROOT, AI_TEST_USERDATA: userDataDir },
  });
  await passSplash(app);
  return app;
}
const inspect = (app) => app.evaluate((_e, root) => {
  const req = process.getBuiltinModule('module').createRequire(root + '/main/main.js');
  return req('../services/photographerLearningRuntime').inspectRegistry();
}, PROJECT_ROOT);
const appName = (app) => app.evaluate(({ app: a }) => a.getName());

/** Files AutoIngest itself owns in userData (Chromium's own caches change constantly). */
function ownFiles(ud) {
  const out = {};
  const walk = (d) => {
    let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      const st = fs.lstatSync(p);
      out[path.relative(ud, p)] = e.isDirectory() ? 'd' : `${st.size}:${st.mtimeMs}:${crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')}`;
      if (e.isDirectory()) walk(p);
    }
  };
  for (const f of ['settings.json', 'users.json', 'photographers.override.json', 'photographers.aliases.json']) {
    const p = path.join(ud, f);
    if (fs.existsSync(p)) out[f] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  }
  walk(path.join(ud, 'identity-registry'));
  return out;
}

async function seedRegistry(dir) {
  const { createIdentityRegistryStore } = require(path.join(PROJECT_ROOT, 'services', 'identityRegistryStore'));
  const { createEvent } = require(path.join(PROJECT_ROOT, 'services', 'identityEvents'));
  const P = require(path.join(PROJECT_ROOT, 'services', 'photographerIdentity'));
  const secure = {
    backend: 'fake-test', identity: 'q5a-live-fake-identity', isAvailable: () => true,
    encrypt: (b) => Buffer.concat([Buffer.from('SEALED:'), Buffer.from(b.map(x => x ^ 0x5a))]),
    decrypt: (c) => Buffer.from(c.subarray(7).map(x => x ^ 0x5a)),
  };
  const store = createIdentityRegistryStore({ dir, secureStorage: secure, computerId: 'fake-computer-q5a-live' });
  await store.open();
  const keyId = JSON.parse(fs.readFileSync(path.join(dir, 'registry.json'), 'utf8')).keyIds[0];
  const shippedName = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'photographers.json'), 'utf8'))[0];
  const pid = P.shippedPhotographerId(shippedName);
  const o = (at) => ({ origin: { computerId: 'fake-computer-q5a-live', operatorId: null, workflow: 'event-import' }, at });
  const deviceId = crypto.randomUUID();
  const r = await store.appendEvents([
    createEvent('photographer-renamed', { photographerId: pid, fromName: shippedName, toName: 'Q5a Live Renamed' }, o('2026-10-05T00:00:00Z')),
    createEvent('device-registered', { deviceId, make: 'Canon', modelKey: 'canon eos r5', modelDisplay: 'EOS R5', identifiers: [{ ns: 'exif.bodySerial', keyId, digest: crypto.createHash('sha256').update('FAKEQ5ALIVE-1').digest('hex'), trusted: true }] }, o('2026-10-01T00:00:00Z')),
    createEvent('import-observed', { importId: 'imp-fakeq5alive', photographerId: pid, deviceId, fileCount: 5, day: '2026-10-02' }, o('2026-10-02T00:00:00Z')),
  ]);
  await store.close();
  return { ok: r.ok, shippedName };
}

(async () => {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-q5a-live-'));
  const ud = path.join(work, 'userData');
  const drivesFile = path.join(work, 'drives.json');
  await fsp.mkdir(ud, { recursive: true });
  await fsp.mkdir(path.join(work, 'wrapper-app'), { recursive: true });
  await fsp.writeFile(path.join(work, 'wrapper-app', 'package.json'), JSON.stringify({ name: TEST_PKG_NAME, version: require(path.join(PROJECT_ROOT, 'package.json')).version, main: 'index.js' }));
  await fsp.writeFile(path.join(work, 'wrapper-app', 'index.js'), WRAPPER_INDEX);
  fs.writeFileSync(drivesFile, '[]');
  const prodBefore = ['auto-ingest Safe Storage', 'AutoIngest Safe Storage'].map(keychainHas);
  check(!keychainHas(KEYCHAIN_ITEM), 'no leftover test Keychain item before the run');

  let app;
  try {
    // ── Session 1: fresh profile, no registry ──────────────────────────────────
    app = await launch(work, ud, drivesFile);
    check(await appName(app) === TEST_PKG_NAME, `isolated app identity (${TEST_PKG_NAME}), not the production "auto-ingest"`);
    check(path.resolve(await app.evaluate(({ app: a }) => a.getPath('userData'))) === path.resolve(ud), 'temp userData in use');
    const before1 = ownFiles(ud);
    const v1 = await inspect(app);
    const v1b = await inspect(app);
    check(v1.status.state === 'missing', `fresh profile → "missing" (got ${v1.status.state})`);
    check(v1.photographers.length >= 312 && v1.cameras.length === 0, `shipped list browsable, no cameras (${v1.photographers.length})`);
    check(JSON.stringify(v1) === JSON.stringify(v1b), 'repeatable: two inspections give the same view');
    check(!fs.existsSync(path.join(ud, 'identity-registry')), 'no identity-registry folder created');
    check(JSON.stringify(ownFiles(ud)) === JSON.stringify(before1), 'settings, users, lists and aliases unchanged');
    check(!keychainHas(KEYCHAIN_ITEM), 'no Keychain item created by inspection');
    await app.close(); app = null;

    // ── Session 2: synthetic registry (key protected under another identity) ────
    const dir = path.join(ud, 'identity-registry');
    const seeded = await seedRegistry(dir);
    check(seeded.ok, 'synthetic registry seeded (fake secure storage, outside the app)');
    fs.writeFileSync(path.join(ud, 'photographers.aliases.json'), JSON.stringify({ [require(path.join(PROJECT_ROOT, 'main', 'aliasEngine')).slugify(seeded.shippedName)]: ['q5aqk'] }));
    app = await launch(work, ud, drivesFile);
    const before2 = ownFiles(ud);
    const v2 = await inspect(app);
    check(v2.status.state === 'ready', `seeded registry → "ready" (got ${v2.status.state})`);
    check(v2.status.keyStatus === 'key-protection-identity-mismatch' && v2.status.bodyMatching === 'unavailable', `key not decryptable here → reported, never replaced (${v2.status.keyStatus})`);
    const p = v2.photographers.filter(x => x.name === 'Q5a Live Renamed');
    check(p.length === 1 && p[0].formerNames.includes(seeded.shippedName) && p[0].nameHistory.length === 1, 'renamed shipped photographer: one profile, former name kept, history present');
    check(p.length === 1 && p[0].learnedShortcuts.some(s => s.text === 'q5aqk'), 'learned shortcut shown, separately labelled');
    check(v2.cameras.length === 1 && v2.cameras[0].model === 'EOS R5' && v2.cameras[0].lastObservedDay === '2026-10-02', 'camera view present');
    const text = JSON.stringify(v2);
    check(!text.includes('FAKEQ5ALIVE') && !/[0-9a-f]{64}/.test(text) && !text.includes('fake-computer') && !text.includes('imp-fakeq5alive') && !text.includes(ud), 'no serial, digest, computer ID, import ID or path in the view');
    check(JSON.stringify(ownFiles(ud)) === JSON.stringify(before2), 'registry, keys, settings, lists unchanged by inspection');
    check(!fs.existsSync(path.join(dir, 'quarantine')) || fs.readdirSync(path.join(dir, 'quarantine')).length === 0, 'nothing quarantined');

    // ── Corrupt registry while the app runs: reported, untouched ─────────────
    fs.writeFileSync(path.join(dir, 'registry.json'), '{ damaged');
    const before3 = ownFiles(ud);
    const v3 = await inspect(app);
    check(v3.status.state === 'corrupt' && v3.cameras.length === 0 && v3.photographers.length >= 312, 'corrupt registry → "corrupt", names still browsable');
    check(JSON.stringify(ownFiles(ud)) === JSON.stringify(before3), 'corrupt registry left exactly as found (no quarantine, no reset)');
    await app.close(); app = null;

    check(!keychainHas(KEYCHAIN_ITEM), 'no test Keychain item exists after the run');
    const prodAfter = ['auto-ingest Safe Storage', 'AutoIngest Safe Storage'].map(keychainHas);
    check(JSON.stringify(prodAfter) === JSON.stringify(prodBefore), 'production Keychain items untouched (presence unchanged)');
  } catch (err) {
    failures++; log('FAIL — exception:', err.message);
  } finally {
    if (app) await app.close().catch(() => {});
    { const q = H.quitGuardSummary({ isoLog: path.join(work, 'live-iso.jsonl') }); log(H.formatQuitGuardSummary(q)); check(q.isolated > 0 && q.failed === 0 && q.unguarded === 0 && q.endedWithoutExit === 0, `every launch isolated by the shared preload, ended by a deliberate quit; no external quit got through (${q.endedWithoutExit} ended without an exit record)`); }
    if (keychainHas(KEYCHAIN_ITEM)) { try { execFileSync('security', ['delete-generic-password', '-s', KEYCHAIN_ITEM], { stdio: 'ignore' }); } catch { /* ignore */ } }
    for (const d of [path.join(os.homedir(), 'Library', 'Logs', TEST_PKG_NAME)]) await fsp.rm(d, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
    process.exit(failures ? 1 : 0);
  }
})();
