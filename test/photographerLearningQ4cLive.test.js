'use strict';
// AI-FEAT-063 / AI-RM-014 Q4c — LIVE: learning from real committed imports in the real app
// (main.js import:commitTransaction → photographerLearningRuntime → real Q4b store with REAL
// Electron safeStorage → real Q2/Q3 evidence: companion cache or bounded re-read).
//
// Isolation: temp userData / archive / sources; drivelist stubbed so a temp folder is a
// "card"; the real main.js is loaded through a test-only wrapper app named
// "autoingest-q4c-livetest", so its Keychain item is "autoingest-q4c-livetest Safe Storage" —
// never a production or development item. This test deletes it at the end. Synthetic JPEGs carry FAKE serials written by ExifTool.
//
// Requires playwright-core (npm install --no-save playwright-core).
// Run: node test/photographerLearningQ4cLive.test.js

const { _electron: electron } = require('playwright-core');
const { execFileSync } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { ExifTool } = require('exiftool-vendored');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_BIN = require(path.join(PROJECT_ROOT, 'node_modules', 'electron'));
const TEST_PKG_NAME = 'autoingest-q4c-livetest';
const KEYCHAIN_ITEM = `${TEST_PKG_NAME} Safe Storage`;
const FAKE = { A: 'FAKEQ4CLIVEA1', B: 'FAKEQ4CLIVEB2', C: 'FAKEQ4CLIVEC3', D: 'FAKEQ4CLIVED4' };

function log(...a) { console.log('[q4c-live]', ...a); }
let failures = 0;
function check(c, m) { if (c) log('PASS —', m); else { failures++; log('FAIL —', m); } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const today = () => { const d = new Date(); return `${d.getFullYear()}:${String(d.getMonth() + 1).padStart(2, '0')}:${String(d.getDate()).padStart(2, '0')}`; };
const keychainHas = (s) => { try { execFileSync('security', ['find-generic-password', '-s', s], { stdio: 'ignore' }); return true; } catch { return false; } };

const PRELOAD = `
'use strict';
const fs = require('fs');
const dl = require(require.resolve('drivelist', { paths: [process.env.AI_TEST_PROJECT_ROOT] }));
dl.list = async () => { try { return JSON.parse(fs.readFileSync(process.env.AI_TEST_DRIVES_FILE, 'utf8')); } catch { return []; } };
`;
// Test-only wrapper app: its package.json name is the identity Electron fixes at startup for
// safeStorage (Keychain item "<name> Safe Storage"); a -r preload's app.setName() is overwritten
// when package.json loads, and setName() after ready does not change the Keychain item (both
// measured). The wrapper then loads the worktree's real, unmodified main/main.js.
const WRAPPER_INDEX = `
'use strict';
const { app } = require('electron');
app.setPath('userData', process.env.AI_TEST_USERDATA);
require(process.env.AI_TEST_PROJECT_ROOT + '/main/main.js');
`;
const fakeDrive = (mountpoint, label) => ({ isSystem: false, isVirtual: false, isUSB: true, isRemovable: true, isCard: true, busType: 'SD', size: 64e9, description: 'Synthetic SD', mountpoints: [{ path: mountpoint, label }] });

async function snapshot(dir) {
  const out = {};
  async function walk(d) { for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else { const st = await fsp.stat(p); out[p] = `${st.size}:${st.mtimeMs}`; } } }
  await walk(dir);
  return out;
}

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
  try { await w.fill('#splashInputName', 'Q4c Operator', { timeout: 2000 }); await w.fill('#splashInputRole', 'QA'); await w.click('#splashCreateStartBtn'); } catch { /* existing profile */ }
  const main = await mainP;
  await main.waitForLoadState('domcontentloaded');
  await main.waitForTimeout(1500);
  return main;
}

async function launch(work, userDataDir, drivesFile, stubFile) {
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: ['-r', stubFile, path.join(work, 'wrapper-app'), '--no-sandbox'],
    cwd: PROJECT_ROOT, timeout: 60000,
    env: { ...process.env, AI_TEST_DRIVES_FILE: drivesFile, AI_TEST_PROJECT_ROOT: PROJECT_ROOT, AI_TEST_USERDATA: userDataDir },
  });
  const errors = [];
  app.on('window', p => p.on('pageerror', e => errors.push(e.message)));
  const main = await passSplash(app);
  return { app, main, errors };
}

const mainRequire = (app, mod, fn, arg) => app.evaluate(({ app: a }, { root, mod, fn, arg }) => {
  const req = process.getBuiltinModule('module').createRequire(root + '/main/main.js');
  return new Function('m', 'arg', fn)(req(mod), arg);
}, { root: PROJECT_ROOT, mod, fn, arg });

const journal = (ud) => { try { return JSON.parse(fs.readFileSync(path.join(ud, 'identity-registry', 'learning-journal.json'), 'utf8')).entries; } catch { return []; } };
const registry = (ud) => { try { return JSON.parse(fs.readFileSync(path.join(ud, 'identity-registry', 'registry.json'), 'utf8')); } catch { return null; } };
const PENDING = new Set(['queued', 'started']); // not yet a final outcome
async function waitFinal(ud, n, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const e = journal(ud).filter(x => !PENDING.has(x.status));
    if (e.length >= n) return e;
    await sleep(200);
  }
  return journal(ud).filter(x => !PENDING.has(x.status));
}

(async () => {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-q4c-live-'));
  const stubFile = path.join(work, 'preload.js');
  const drivesFile = path.join(work, 'drives.json');
  await fsp.writeFile(stubFile, PRELOAD);
  await fsp.mkdir(path.join(work, 'wrapper-app'), { recursive: true });
  await fsp.writeFile(path.join(work, 'wrapper-app', 'package.json'), JSON.stringify({ name: TEST_PKG_NAME, version: require(path.join(PROJECT_ROOT, 'package.json')).version, main: 'index.js' }));
  await fsp.writeFile(path.join(work, 'wrapper-app', 'index.js'), WRAPPER_INDEX);
  fs.writeFileSync(drivesFile, '[]');
  const prodItemsBefore = ['auto-ingest Safe Storage', 'AutoIngest Safe Storage'].map(keychainHas);
  check(!keychainHas(KEYCHAIN_ITEM), 'no leftover test Keychain item before the run');

  // ── Synthetic media (FAKE serials) ───────────────────────────────────────────
  // ≥ 50 KB: card discovery (fileBrowser MIN_FILE_BYTES) ignores smaller files.
  const noise = Buffer.alloc(400 * 400 * 3); for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919) % 251;
  const jpg = await sharp(noise, { raw: { width: 400, height: 400, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
  const et = new ExifTool({ maxProcs: 2 });
  const stamp = `${today()} 10:00:00`;
  const put = async (dir, name, tags) => { await fsp.mkdir(dir, { recursive: true }); const p = path.join(dir, name); await fsp.writeFile(p, jpg); await et.write(p, { DateTimeOriginal: stamp, CreateDate: stamp, ...tags }, { writeArgs: ['-overwrite_original'] }); return p; };
  const r5 = (s) => ({ Make: 'Canon', Model: 'Canon EOS R5', ...(s ? { 'ExifIFD:SerialNumber': s } : {}) });
  const card = path.join(work, 'CARD_A'); const cardDcim = path.join(card, 'DCIM', '100CANON');
  const cardFiles = [await put(cardDcim, 'IMG_0001.JPG', r5(FAKE.A)), await put(cardDcim, 'IMG_0002.JPG', r5(FAKE.A)), await put(cardDcim, 'IMG_0003.JPG', r5(FAKE.A))];
  const folderB = path.join(work, 'folderB'); const filesB = [await put(folderB, 'B_0001.JPG', r5(FAKE.B)), await put(folderB, 'B_0002.JPG', r5(FAKE.B))];
  const mixed = path.join(work, 'mixed'); const filesMixed = [await put(mixed, 'M_0001.JPG', r5(FAKE.C)), await put(mixed, 'M_0002.JPG', { Make: 'Apple', Model: 'iPhone 6' })];
  const multi1 = path.join(work, 'multi1'); const filesM1 = [await put(multi1, 'S_0001.JPG', r5(FAKE.C))];
  const multi2 = path.join(work, 'multi2'); const filesM2 = [await put(multi2, 'T_0001.JPG', { Make: 'Apple', Model: 'iPhone 6' })];
  const gone = path.join(work, 'gone'); const filesGone = [await put(gone, 'G_0001.JPG', r5(FAKE.D))];
  const again = path.join(work, 'again'); const filesAgain = [await put(again, 'A_0001.JPG', r5(FAKE.A))];
  await et.end();
  const mediaRoots = [card, folderB, mixed, multi1, multi2, again];
  const snapMedia = async () => Object.assign({}, ...(await Promise.all(mediaRoots.map(snapshot))));
  const srcBefore = await snapMedia();

  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-q4c-live-ud-'));
  const archiveRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-q4c-live-archive-'));
  let session = await launch(work, userDataDir, drivesFile, stubFile);
  let { app, main } = session;
  let evN = 0;
  const mkEvent = async () => {
    const dir = path.join(archiveRoot, 'CollQ4c', `1448-03-0${++evN} _0${evN}-Majlis-Hall-Mumbai`);
    await main.evaluate(({ dir: d }) => window.api.writeEventJson(d, { version: 1, hijriDate: '1448-03-01', sequence: 1, eventName: 'Majlis', components: [{ location: 'Hall', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }] }), { dir });
    return dir;
  };
  const doImport = async (files, photographer, extra = {}) => {
    const ev = extra.eventDir || await mkEvent();
    return main.evaluate(({ files: fl, ev: e, ph, sid }) => window.api.commitImportTransaction(
      fl.map(src => ({ src, dest: e + '/' + ph + '/' + src.split('/').pop() })), e,
      { groups: [{ id: 0, files: fl, subEventId: null }], photographer: ph, liveComps: null, subEventNames: null, collName: 'CollQ4c', source: 'q4c-live', importedBy: { id: 'op-q4c', name: 'Q4c Operator' }, importSessionId: sid || null }),
    { files, ev, ph: photographer, sid: extra.sessionId }).then(r => ({ r, ev }));
  };

  try {
    await main.evaluate((root) => window.api.setMainArchiveRoot(root), archiveRoot);
    for (const n of ['Q4c Live Alpha', 'Q4c Live Beta']) await main.evaluate((v) => window.api.addToList('photographers', v), n);

    // Launch alone creates nothing.
    await sleep(1500);
    check(!fs.existsSync(path.join(userDataDir, 'identity-registry')), 'launch: no registry, key or journal created');
    check(!keychainHas(KEYCHAIN_ITEM), 'launch: no Keychain item created');

    // Card inserted: assessment runs, still nothing created.
    fs.writeFileSync(drivesFile, JSON.stringify([fakeDrive(card, 'CARD_A')]));
    const t0 = Date.now(); let assessed = false;
    while (Date.now() - t0 < 30000 && !assessed) {
      const d = await mainRequire(app, '../services/companionService', 'return m.getDiagnostics();');
      assessed = (d.assessment?.jobs || []).some(j => j.state === 'complete');
      if (!assessed) await sleep(300);
    }
    check(assessed, 'card assessed by the companion (Q2/Q3 cache ready)');
    check(!fs.existsSync(path.join(userDataDir, 'identity-registry')), 'card insert: no registry created');

    const sized = await Promise.all(cardFiles.map(async f => ({ src: f, size: (await fsp.stat(f)).size })));
    const hit = await mainRequire(app, '../services/companionService', 'return m.findAssessedRecords(arg).then(r => r.size);', sized);
    const wrongSize = await mainRequire(app, '../services/companionService', 'return m.findAssessedRecords(arg).then(r => r.size);', sized.map(f => ({ ...f, size: f.size + 1 })));
    check(hit === 3 && wrongSize === 0, `cache matches committed files by volume + path + size (hit ${hit}, size mismatch ${wrongSize})`);
    // 1) Single camera from the card → cache evidence.
    const t1 = Date.now();
    const imp1 = await doImport(cardFiles, 'Q4c Live Alpha');
    const commitMs = Date.now() - t1;
    check(imp1.r.copied === 3 && imp1.r.errors === 0, `import 1 committed (3 copied) in ${commitMs} ms`);
    let fin = await waitFinal(userDataDir, 1);
    check(fin[0]?.status === 'recorded' && fin[0]?.observation === 'single-body' && fin[0]?.evidence === 'cache', `import 1 learned from the assessment cache: ${fin[0]?.status}/${fin[0]?.observation}/${fin[0]?.evidence}`);
    check(fin[0]?.bodyMatching === true, 'real safeStorage key in use (body matching on)');
    check(keychainHas(KEYCHAIN_ITEM), 'Keychain item created under the TEST app name only on the first eligible import');
    const ej1 = JSON.parse(await fsp.readFile(path.join(imp1.ev, 'event.json'), 'utf8'));
    check(Array.isArray(ej1.imports) && ej1.imports.length === 1 && ej1.imports[0].photographer === 'Q4c Live Alpha' && ej1.status === 'complete', 'event.json import entry and status unchanged in shape');
    check(cardFiles.every(f => fs.existsSync(path.join(imp1.ev, 'Q4c Live Alpha', path.basename(f)))), 'files routed to Event/Photographer/ as before');

    // 2) Folder source (no cache) → bounded re-read.
    await doImport(filesB, 'Q4c Live Beta');
    fin = await waitFinal(userDataDir, 2);
    check(fin[1]?.status === 'recorded' && fin[1]?.observation === 'single-body' && fin[1]?.evidence === 'read', `import 2 learned by re-reading the committed files: ${fin[1]?.observation}/${fin[1]?.evidence}`);

    // 3) Mixed cameras → co-occurrence only.
    await doImport(filesMixed, 'Q4c Live Alpha');
    fin = await waitFinal(userDataDir, 3);
    check(fin[2]?.observation === 'multiple-cameras', `mixed import → co-occurrence only (${fin[2]?.observation})`);

    // 4) Multi-event session, distinct photographers → one association each.
    await doImport(filesM1, 'Q4c Live Beta', { sessionId: 'sess-q4c-1' });
    await doImport(filesM2, 'Q4c Live Alpha', { sessionId: 'sess-q4c-1' });
    fin = await waitFinal(userDataDir, 5);
    check(fin[3]?.observation === 'single-body' && fin[4]?.observation === 'single-model' && fin.slice(3, 5).every(e => e.workflow === 'multi-event-import'), 'multi-event: each event learned with its own files and photographer');

    // 5) Source removed immediately after commit (re-read held paused, source deleted, released).
    const tok = await mainRequire(app, '../services/operatorActivity', "return m.begin('checksum');");
    await doImport(filesGone, 'Q4c Live Alpha');
    await fsp.rm(gone, { recursive: true, force: true });
    await mainRequire(app, '../services/operatorActivity', 'm.end(arg); return true;', tok);
    fin = await waitFinal(userDataDir, 6);
    check(fin[5]?.status === 'nothing-to-record' && fin[5]?.unreadFiles === 1, `source removed → nothing guessed (${fin[5]?.status}, unread ${fin[5]?.unreadFiles})`);

    // 6) Rolled-back import (event.json cannot be written) → no learning.
    const badEv = path.join(archiveRoot, 'CollQ4c', 'broken-event');
    await fsp.mkdir(path.join(badEv, 'event.json'), { recursive: true }); // a directory where the file must be
    const before6 = journal(userDataDir).length;
    const rolled = await doImport(filesB, 'Q4c Live Alpha', { eventDir: badEv }).then(() => 'resolved', (e) => `rejected: ${String(e.message).slice(0, 60)}`);
    await sleep(2500);
    check(rolled.startsWith('rejected') && journal(userDataDir).length === before6, `rolled-back import records nothing (${rolled.slice(0, 40)}…)`);

    // Registry content: correct attribution, no confirmations, no raw serials.
    const reg = registry(userDataDir);
    const types = reg.events.map(e => e.type);
    check(!types.some(x => x.startsWith('association-')), 'no confirmed/rejected/retired events from imports');
    check(types.filter(x => x === 'import-observed').length === 3 && types.filter(x => x === 'import-cooccurred').length === 1 && types.filter(x => x === 'model-observed').length === 1, `event mix: ${JSON.stringify(types.reduce((a, x) => ({ ...a, [x]: (a[x] || 0) + 1 }), {}))}`);
    const allText = ['registry.json', 'keys.json', 'learning-journal.json'].map(f => fs.readFileSync(path.join(userDataDir, 'identity-registry', f), 'utf8')).join('\n');
    const logText = fs.readFileSync(path.join(userDataDir, 'app.log'), 'utf8');
    check(Object.values(FAKE).every(s => !allText.includes(s) && !logText.includes(s)), 'no raw serial in registry, keys, journal or app.log');

    // Metadata unchanged: Creator still written from the selected photographer.
    await sleep(3000);
    const et2 = new ExifTool();
    const tags = await et2.read(path.join(imp1.ev, 'Q4c Live Alpha', 'IMG_0001.JPG'));
    await et2.end();
    check((tags.Creator?.[0] || tags.Creator) === 'Q4c Live Alpha' && tags.Artist === 'Q4c Live Alpha', 'metadata writing unchanged (Creator / Artist)');

    // 7) Quit while learning is in progress (held paused) → clean exit; reported next run.
    const tok2 = await mainRequire(app, '../services/operatorActivity', "return m.begin('checksum');");
    await doImport(filesAgain, 'Q4c Live Alpha');
    await sleep(800);
    const exitP = new Promise(r => app.process().once('exit', (code) => r(code)));
    await main.evaluate(() => window.api.quitApp ? window.api.quitApp() : null).catch(() => {});
    await app.evaluate(({ app: a }) => a.quit()).catch(() => {});
    const code = await Promise.race([exitP, sleep(15000).then(() => 'timeout')]);
    check(code === 0, `quit during learning: clean exit (${code})`);
    check(!fs.existsSync(path.join(userDataDir, 'identity-registry', 'registry.lock')), 'registry lock released at quit');
    void tok2;

    // 8) Restart: same key (real safeStorage), same camera recognised; interrupted job reported.
    session = await launch(work, userDataDir, drivesFile, stubFile); ({ app, main } = session);
    const devicesBefore = new Set(registry(userDataDir).events.filter(e => e.type === 'device-registered').map(e => e.deviceId)).size;
    await doImport(filesAgain, 'Q4c Live Alpha');
    fin = await waitFinal(userDataDir, 8);
    const jAll = journal(userDataDir);
    check(jAll.some(e => e.status === 'interrupted'), 'the job cut off by quit is reported as interrupted');
    const last = jAll[jAll.length - 1];
    const devicesAfter = new Set(registry(userDataDir).events.filter(e => e.type === 'device-registered').map(e => e.deviceId)).size;
    check(last.status === 'recorded' && last.bodyMatching === true && devicesAfter === devicesBefore, `after restart the key decrypts and body A is recognised (devices ${devicesBefore} → ${devicesAfter})`);
    check(session.errors.length === 0, `no renderer page errors (${session.errors.length})`);
    await app.close();
  } catch (err) {
    failures++; log('FAIL — exception:', err.stack || err.message);
    try { await app.close(); } catch { /* ignore */ }
  }

  // 9) Learning switched off in settings.json → imports create nothing.
  try {
    const ud2 = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-q4c-live-ud-off-'));
    fs.writeFileSync(path.join(ud2, 'settings.json'), JSON.stringify({ photographerLearningEnabled: false }));
    const s2 = await launch(work, ud2, drivesFile, stubFile);
    main = s2.main;
    await main.evaluate((root) => window.api.setMainArchiveRoot(root), archiveRoot);
    await main.evaluate((v) => window.api.addToList('photographers', v), 'Q4c Live Alpha');
    const off = await doImport(filesB, 'Q4c Live Alpha');
    await sleep(3000);
    check(off.r.copied === 2, 'learning off: import works normally');
    check(!fs.existsSync(path.join(ud2, 'identity-registry')), 'learning off: no registry, key or journal');
    await s2.app.close();
    await fsp.rm(ud2, { recursive: true, force: true });
  } catch (err) { failures++; log('FAIL — learning-off phase:', err.message); }

  const srcAfter = await snapMedia();
  const changed = Object.keys(srcBefore).filter(p => srcBefore[p] !== srcAfter[p]);
  if (changed.length) log('changed:', changed.map(p => `${path.relative(work, p)} ${srcBefore[p]} → ${srcAfter[p]}`).join('; '));
  check(changed.length === 0, `source media unchanged by import + learning (${changed.length} changed)`);
  check(JSON.stringify(['auto-ingest Safe Storage', 'AutoIngest Safe Storage'].map(keychainHas)) === JSON.stringify(prodItemsBefore), 'production Keychain items untouched');
  try { execFileSync('security', ['delete-generic-password', '-s', KEYCHAIN_ITEM], { stdio: 'ignore' }); } catch { /* none */ }
  check(!keychainHas(KEYCHAIN_ITEM), 'test Keychain item removed');
  await fsp.rm(work, { recursive: true, force: true });
  await fsp.rm(userDataDir, { recursive: true, force: true });
  await fsp.rm(archiveRoot, { recursive: true, force: true });
  log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})();
