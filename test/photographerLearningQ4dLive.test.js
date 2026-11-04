'use strict';
// AI-FEAT-063 / AI-RM-014 Q4d — LIVE: duplicate handling and interrupted-learning recovery in
// the real app (main.js import:commitTransaction → photographerLearningRuntime → real Q4b store
// with REAL Electron safeStorage → real ExifTool reads, image-data hashes and metadata writes).
//
// Isolation (same as the Q4c live test): temp userData / archive / sources; drivelist stubbed
// (no card is visible); the real main.js loads through a test-only wrapper app named
// "autoingest-q4d-livetest", so the only Keychain item touched is
// "autoingest-q4d-livetest Safe Storage", deleted at the end. Synthetic JPEGs, FAKE serials.
//
// Requires playwright-core (npm install --no-save playwright-core).
// Run: node test/photographerLearningQ4dLive.test.js

const { _electron: electron } = require('playwright-core');
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { ExifTool } = require('exiftool-vendored');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_BIN = require(path.join(PROJECT_ROOT, 'node_modules', 'electron'));
const TEST_PKG_NAME = 'autoingest-q4d-livetest';
const KEYCHAIN_ITEM = `${TEST_PKG_NAME} Safe Storage`;
const FAKE = { A: 'FAKEQ4DLIVEA1', B: 'FAKEQ4DLIVEB2', C: 'FAKEQ4DLIVEC3' };

function log(...a) { console.log('[q4d-live]', ...a); }
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
  try { await w.fill('#splashInputName', 'Q4d Operator', { timeout: 2000 }); await w.fill('#splashInputRole', 'QA'); await w.click('#splashCreateStartBtn'); } catch { /* existing profile */ }
  const main = await mainP;
  await main.waitForLoadState('domcontentloaded');
  await main.waitForTimeout(1500);
  return main;
}

const envFor = (drivesFile, userDataDir, extra = {}) => ({ ...process.env, AI_TEST_DRIVES_FILE: drivesFile, AI_TEST_PROJECT_ROOT: PROJECT_ROOT, AI_TEST_USERDATA: userDataDir, ...extra });
async function launch(work, userDataDir, drivesFile, stubFile, extraEnv = {}) {
  const app = await electron.launch({
    executablePath: ELECTRON_BIN, args: ['-r', stubFile, path.join(work, 'wrapper-app'), '--no-sandbox'],
    cwd: PROJECT_ROOT, timeout: 60000, env: envFor(drivesFile, userDataDir, extraEnv),
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

const stateFile = (ud, f) => path.join(ud, 'identity-registry', 'learning', f);
const journal = (ud) => { try { return JSON.parse(fs.readFileSync(stateFile(ud, 'learning-journal.json'), 'utf8')).entries; } catch { return []; } };
const pending = (ud) => { try { return JSON.parse(fs.readFileSync(stateFile(ud, 'learning-pending.json'), 'utf8')).items; } catch { return []; } };
const registry = (ud) => { try { return JSON.parse(fs.readFileSync(path.join(ud, 'identity-registry', 'registry.json'), 'utf8')); } catch { return null; } };
const IN_FLIGHT = new Set(['queued', 'started', 'recovering']);
async function waitFor(fn, ms = 60000) { const t0 = Date.now(); for (;;) { const v = fn(); if (v || Date.now() - t0 > ms) return v; await sleep(200); } }
/** The journal entry of the import committed into event folder `ev` (key recomputed from event.json). */
function keyOf(ev, computerId) {
  const { learningKey } = require(path.join(PROJECT_ROOT, 'services', 'photographerLearningService'));
  const ids = JSON.parse(fs.readFileSync(path.join(ev, 'event.json'), 'utf8')).imports.map(i => i.id);
  return learningKey(computerId, ids);
}
/** Key of the most recent import committed into `ev` (one entry per commit in these tests). */
function lastKey(ev, computerId) {
  const { learningKey } = require(path.join(PROJECT_ROOT, 'services', 'photographerLearningService'));
  const ids = JSON.parse(fs.readFileSync(path.join(ev, 'event.json'), 'utf8')).imports.map(i => i.id);
  return learningKey(computerId, [ids[ids.length - 1]]);
}
const settled = (ud, key, statuses) => waitFor(() => { const e = journal(ud).find(x => x.key === key); return e && !IN_FLIGHT.has(e.status) && (!statuses || statuses.includes(e.status)) ? e : null; });

(async () => {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-q4d-live-'));
  const stubFile = path.join(work, 'preload.js');
  const drivesFile = path.join(work, 'drives.json');
  await fsp.writeFile(stubFile, PRELOAD);
  await fsp.mkdir(path.join(work, 'wrapper-app'), { recursive: true });
  await fsp.writeFile(path.join(work, 'wrapper-app', 'package.json'), JSON.stringify({ name: TEST_PKG_NAME, version: require(path.join(PROJECT_ROOT, 'package.json')).version, main: 'index.js' }));
  await fsp.writeFile(path.join(work, 'wrapper-app', 'index.js'), WRAPPER_INDEX);
  fs.writeFileSync(drivesFile, '[]');
  const prodItemsBefore = ['auto-ingest Safe Storage', 'AutoIngest Safe Storage'].map(keychainHas);
  check(!keychainHas(KEYCHAIN_ITEM), 'no leftover test Keychain item before the run');

  // ── Synthetic media (FAKE serials). Each image has distinct pixels. ───────────
  const et = new ExifTool({ maxProcs: 2 });
  const stamp = `${today()} 10:00:00`;
  let seed = 1;
  const jpeg = async () => { const s = seed++; const b = Buffer.alloc(300 * 300 * 3); for (let i = 0; i < b.length; i++) b[i] = (i * 7919 + s * 104729) % 251; return sharp(b, { raw: { width: 300, height: 300, channels: 3 } }).jpeg({ quality: 100 }).toBuffer(); };
  const put = async (dir, name, tags) => { await fsp.mkdir(dir, { recursive: true }); const p = path.join(dir, name); await fsp.writeFile(p, await jpeg()); await et.write(p, { DateTimeOriginal: stamp, CreateDate: stamp, ...tags }, { writeArgs: ['-overwrite_original'] }); return p; };
  const r5 = (s) => ({ Make: 'Canon', Model: 'Canon EOS R5', 'ExifIFD:SerialNumber': s });
  const src = (n) => path.join(work, 'src', n);
  const A = [await put(src('a'), 'IMG_0001.JPG', r5(FAKE.A)), await put(src('a'), 'IMG_0002.JPG', r5(FAKE.A)), await put(src('a'), 'IMG_0003.JPG', r5(FAKE.A))];
  const A2 = [await put(src('a'), 'IMG_0004.JPG', r5(FAKE.A)), await put(src('a'), 'IMG_0005.JPG', r5(FAKE.A))];
  const B = [await put(src('b'), 'B_0001.JPG', r5(FAKE.B)), await put(src('b'), 'B_0002.JPG', r5(FAKE.B))];
  const C = [await put(src('c'), 'C_0001.JPG', r5(FAKE.C))];
  const C2 = [await put(src('c'), 'C_0002.JPG', r5(FAKE.C))];
  const X = [await put(src('x'), 'X_0001.JPG', r5(FAKE.A)), await put(src('x'), 'X_0002.JPG', r5(FAKE.A))];
  const Y = [await put(src('y'), 'Y_0001.JPG', r5(FAKE.B))];
  const Z = [await put(src('z'), 'Z_0001.JPG', r5(FAKE.A))];
  const W = [await put(src('w'), 'W_0001.JPG', r5(FAKE.A))];
  const V = [await put(src('v'), 'V_0001.JPG', r5(FAKE.C))];
  const R = [await put(src('r'), 'R_0001.JPG', r5(FAKE.B)), await put(src('r'), 'R_0002.JPG', r5(FAKE.B))];
  const otherPicture = path.join(work, 'other.jpg'); await fsp.writeFile(otherPicture, await jpeg());
  await et.write(otherPicture, { Make: 'Canon', Model: 'Canon EOS R5', 'ExifIFD:SerialNumber': FAKE.A }, { writeArgs: ['-overwrite_original'] });
  await et.end();

  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-q4d-live-ud-'));
  const archiveRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-q4d-live-archive-'));
  let session = null, main = null, app = null, computerId = null;
  let evN = 0;
  const mkEvent = async () => {
    const dir = path.join(archiveRoot, 'CollQ4d', `1448-04-0${++evN} _0${evN}-Majlis-Hall-Mumbai`);
    await main.evaluate(({ dir: d }) => window.api.writeEventJson(d, { version: 1, hijriDate: '1448-04-01', sequence: 1, eventName: 'Majlis', components: [{ location: 'Hall', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }] }), { dir });
    return dir;
  };
  const doImport = async (files, photographer, extra = {}) => {
    const ev = extra.eventDir || await mkEvent();
    return main.evaluate(({ files: fl, ev: e, ph, sid }) => window.api.commitImportTransaction(
      fl.map(s => ({ src: s, dest: e + '/' + ph + '/' + s.split('/').pop() })), e,
      { groups: [{ id: 0, files: fl, subEventId: null }], photographer: ph, liveComps: null, subEventNames: null, collName: 'CollQ4d', source: 'q4d-live', importedBy: { id: 'op-q4d', name: 'Q4d Operator' }, importSessionId: sid || null }),
    { files, ev, ph: photographer, sid: extra.sessionId }).then(r => ({ r, ev }));
  };
  const start = async (extraEnv) => {
    session = await launch(work, userDataDir, drivesFile, stubFile, extraEnv); ({ app, main } = session);
    await main.evaluate((root) => window.api.setMainArchiveRoot(root), archiveRoot);
    for (const n of ['Q4d Alpha', 'Q4d Beta', 'Q4d Gamma']) await main.evaluate((v) => window.api.addToList('photographers', v), n);
    computerId = await mainRequire(app, '../services/settings', 'return m.getDeviceId();');
  };
  const quit = async () => {
    const exitP = new Promise(r => app.process().once('exit', (code) => r(code)));
    await app.evaluate(({ app: a }) => a.quit()).catch(() => {});
    return Promise.race([exitP, sleep(15000).then(() => 'timeout')]);
  };
  const observedFor = (key) => (registry(userDataDir)?.events || []).filter(e => e.importId === key);
  const archiveOf = (ev, ph, s) => path.join(ev, ph, path.basename(s));
  const metadataWritten = (ev, ph, files) => waitFor(() => files.every(s => { try { return fs.statSync(archiveOf(ev, ph, s)).size !== fs.statSync(s).size; } catch { return false; } }), 30000);

  try {
    const sf = path.join(userDataDir, 'settings.json');
    const setSetting = (k, v) => { let cur = {}; try { cur = JSON.parse(fs.readFileSync(sf, 'utf8')); } catch { /* new */ } fs.writeFileSync(sf, JSON.stringify({ ...cur, [k]: v })); };
    const deviceId = () => mainRequire(app, '../services/settings', 'return m.getDeviceId();');

    // ═══ Session 1 — metadata writing OFF: the engine's same-size skips ═══════════
    setSetting('autoMetadataEnabled', false);
    await start();
    check(await mainRequire(app, '../services/photographerLearningRuntime', 'return m._forTests.get() === null;'), 'fresh profile: launch starts no learning service and schedules nothing');

    const i1 = await doImport(A, 'Q4d Alpha');
    computerId = await deviceId();
    const k1 = keyOf(i1.ev, computerId);
    const e1 = await settled(userDataDir, k1);
    check(i1.r.copied === 3 && e1?.status === 'recorded' && observedFor(k1).find(e => e.type === 'import-observed')?.fileCount === 3, `import 1: 3 copied → observed 3 (${e1?.status})`);

    const i2 = await doImport([...A, ...A2], 'Q4d Alpha', { eventDir: i1.ev }); // partially resumed: 3 already there
    const k2 = lastKey(i2.ev, computerId);
    const e2 = await settled(userDataDir, k2);
    check(i2.r.copied === 2 && i2.r.skipped === 3, `import 2: copy/skip semantics unchanged (copied ${i2.r.copied}, skipped ${i2.r.skipped})`);
    check(e2?.status === 'recorded' && e2?.files === 2 && observedFor(k2).find(e => e.type === 'import-observed')?.fileCount === 2, `import 2: only the 2 newly copied files are evidence (journal files ${e2?.files}, observed ${observedFor(k2).find(e => e.type === 'import-observed')?.fileCount})`);

    const before3 = journal(userDataDir).length;
    const i3 = await doImport([...A, ...A2], 'Q4d Alpha', { eventDir: i1.ev }); // everything already imported
    await sleep(2500);
    check(i3.r.copied === 0 && i3.r.skipped === 5 && journal(userDataDir).length === before3, 'import 3: all skipped → no learning, no journal entry');

    const ev3 = await mkEvent();
    await doImport(C, 'Q4d Gamma', { eventDir: ev3 }); // C_0001 already in event 3
    await settled(userDataDir, lastKey(ev3, computerId));
    const mb = await doImport(B, 'Q4d Beta', { sessionId: 'sess-q4d-1' });
    const mc = await doImport([...C, ...C2], 'Q4d Gamma', { eventDir: ev3, sessionId: 'sess-q4d-1' });
    const eb = await settled(userDataDir, lastKey(mb.ev, computerId)); const ec = await settled(userDataDir, lastKey(ev3, computerId));
    check(mc.r.copied === 1 && mc.r.skipped === 1, 'multi-event: event with a skipped file copied 1, skipped 1');
    check(eb?.workflow === 'multi-event-import' && eb?.files === 2 && ec?.workflow === 'multi-event-import' && ec?.files === 1 && observedFor(lastKey(ev3, computerId)).find(e => e.type === 'import-observed')?.fileCount === 1,
      `multi-event: each event counts only its newly copied files (Beta ${eb?.files}, Gamma ${ec?.files})`);

    // V: cut off during evidence extraction; its archive copy stays camera-original.
    await mainRequire(app, '../services/operatorActivity', "return m.begin('checksum');");
    const iv = await doImport(V, 'Q4d Gamma');
    const kv = keyOf(iv.ev, computerId);
    await waitFor(() => journal(userDataDir).find(e => e.key === kv)?.status === 'started', 15000);
    check(pending(userDataDir).some(i => i.importId === kv), 'V pending while its evidence read is held');
    check(await quit() === 0, 'quit during evidence extraction: clean exit');
    await fsp.rm(src('v'), { recursive: true, force: true }); // card ejected

    // ═══ Session 2 — metadata writing ON; V recovered by itself after the launch delay ═══
    setSetting('autoMetadataEnabled', true);
    await start({ AUTOINGEST_LEARNING_RECOVERY_DELAY_MS: '3000' });
    const ev4 = await settled(userDataDir, kv, ['recorded']);
    check(ev4?.recovered && ev4?.evidence === 'archive' && ev4?.observation === 'single-body', `card ejected, archive copy unmodified → recovered from the archive (${ev4?.evidence}, ${ev4?.observation})`);

    // Re-import after AutoIngest rewrote the archive JPEGs: the engine copies them again as
    // NAME_1.JPG (size differs); learning must not count the same pictures twice.
    const ir = await doImport(R, 'Q4d Beta');
    const kr = keyOf(ir.ev, computerId);
    await settled(userDataDir, kr, ['recorded']);
    check(await metadataWritten(ir.ev, 'Q4d Beta', R), 'metadata written into R\'s archive copies');
    const ir2 = await doImport(R, 'Q4d Beta', { eventDir: ir.ev });
    const kr2 = lastKey(ir.ev, computerId);
    const er2 = await settled(userDataDir, kr2);
    check(ir2.r.copied === 2 && fs.existsSync(path.join(ir.ev, 'Q4d Beta', 'R_0001_1.JPG')), `engine behaviour unchanged: re-copied as renamed files (copied ${ir2.r.copied})`);
    check(er2?.status === 'nothing-to-record' && er2?.duplicateCaptures === 2 && observedFor(kr2).length === 0, `renamed copies of already-archived pictures are not new evidence (${er2?.status}, duplicates ${er2?.duplicateCaptures})`);

    // Four committed imports wait while learning is held paused; then quit.
    await mainRequire(app, '../services/operatorActivity', "return m.begin('checksum');");
    const ix = await doImport(X, 'Q4d Alpha'); const iy = await doImport(Y, 'Q4d Beta');
    const iz = await doImport(Z, 'Q4d Alpha'); const iw = await doImport(W, 'Q4d Alpha');
    const kx = keyOf(ix.ev, computerId), ky = keyOf(iy.ev, computerId), kz = keyOf(iz.ev, computerId), kw = keyOf(iw.ev, computerId);
    check(await metadataWritten(ix.ev, 'Q4d Alpha', X) && await metadataWritten(iy.ev, 'Q4d Beta', Y) && await metadataWritten(iz.ev, 'Q4d Alpha', Z) && await metadataWritten(iw.ev, 'Q4d Alpha', W),
      'AutoIngest metadata written into the archive JPEGs (bytes now differ from the card)');
    check(pending(userDataDir).length === 4 && journal(userDataDir).find(e => e.key === kx)?.status === 'started', 'four committed imports durably pending while learning is paused');
    const code1 = await quit();
    check(code1 === 0 && !fs.existsSync(path.join(userDataDir, 'identity-registry', 'registry.lock')), `quit with learning unfinished: clean exit (${code1}), registry lock released`);

    // Between runs: Z's card is ejected; W's archive copy is replaced by a different picture.
    await fsp.rm(src('z'), { recursive: true, force: true });
    await fsp.copyFile(otherPicture, archiveOf(iw.ev, 'Q4d Alpha', W[0]));

    // ═══ Session 3 — recovery runs by itself after the launch delay ═══════════════
    await start({ AUTOINGEST_LEARNING_RECOVERY_DELAY_MS: '3000' });
    const jx = journal(userDataDir).find(e => e.key === kx), jy = journal(userDataDir).find(e => e.key === ky);
    check(['interrupted', 'recovering', 'recorded'].includes(jx?.status), `X taken over by the next run, not left "started" (${jx?.status})`);
    const ex = await settled(userDataDir, kx, ['recorded']);
    const ey = await settled(userDataDir, ky, ['recorded']);
    check(ex?.recovered && ex?.observation === 'single-body' && ex?.evidence === 'archive+source' && ex?.evidenceCounts?.source === 2, `X (cut off mid-read): recovered from hash-verified card originals (${ex?.evidence}, ${ex?.observation})`);
    check(ey?.recovered && ey?.observation === 'single-body', `Y (still waiting at quit, was ${jy?.status}): recovered (${ey?.observation})`);
    const ez = await settled(userDataDir, kz, ['deferred']);
    check(ez?.reason === 'source-card-not-available' && pending(userDataDir).find(i => i.importId === kz)?.attempts === 1, `Z (card ejected, archive JPEG rewritten): waits for the card, attempt 1 (${ez?.reason})`);
    const ew = await settled(userDataDir, kw, ['evidence-unavailable']);
    check(ew?.evidenceCounts?.uncertain === 1, `W (archive copy replaced by another picture): evidence-unavailable, never guessed (${ew?.status})`);
    check(observedFor(kz).length === 0 && observedFor(kw).length === 0, 'no observation of any kind for Z or W');
    const regCount = registry(userDataDir).events.length;
    for (let i = 0; i < 2; i++) { await mainRequire(app, '../services/photographerLearningRuntime', 'return m._forTests.recoverNow({ force: true }).then(() => m._forTests.whenIdle());'); }
    const ez3 = journal(userDataDir).find(e => e.key === kz);
    check(ez3?.status === 'evidence-unavailable' && ez3?.attempt === 3 && pending(userDataDir).length === 0, `Z: final after 3 attempts (${ez3?.status}, attempt ${ez3?.attempt}); nothing left pending`);
    check(registry(userDataDir).events.length === regCount, 'retries added no events');
    const reg = registry(userDataDir);
    check(reg.events.filter(e => e.importId === kx && e.type === 'import-observed').length === 1, 'X observed exactly once');
    check(!reg.events.some(e => e.type.startsWith('association-')), 'no confirmation written by imports or recovery');

    // A second AutoIngest on the same profile: Electron's single-instance lock sends it away.
    const second = spawn(ELECTRON_BIN, ['-r', stubFile, path.join(work, 'wrapper-app'), '--no-sandbox'], { cwd: PROJECT_ROOT, env: envFor(drivesFile, userDataDir), stdio: 'ignore' });
    const code2 = await Promise.race([new Promise(r => second.on('exit', r)), sleep(20000).then(() => { second.kill('SIGKILL'); return 'still-running'; })]);
    check(code2 !== 'still-running', `a second process on the same profile exits immediately (single-instance, ${code2})`);

    const texts = ['registry.json', 'keys.json', 'learning/learning-journal.json', 'learning/learning-pending.json'].map(f => { try { return fs.readFileSync(path.join(userDataDir, 'identity-registry', f), 'utf8'); } catch { return ''; } }).join('\n');
    const appLog = fs.readFileSync(path.join(userDataDir, 'app.log'), 'utf8');
    check(Object.values(FAKE).every(s => !texts.includes(s) && !appLog.includes(s)), 'no raw serial in registry, keys, journal, pending or app.log');
    const jText = fs.readFileSync(stateFile(userDataDir, 'learning-journal.json'), 'utf8');
    check(!jText.includes('Q4d Alpha') && !jText.includes(archiveRoot) && !/[0-9a-f]{64}/.test(jText), 'journal: no names, paths or digests');
    check(session.errors.length === 0, `no renderer page errors (${session.errors.length})`);
    check(await quit() === 0, 'clean quit');
  } catch (err) {
    failures++; log('FAIL — exception:', err.stack || err.message);
    try { await app.close(); } catch { /* ignore */ }
  }

  if (failures) { try { log('app.log (learning lines):\n' + fs.readFileSync(path.join(userDataDir, 'app.log'), 'utf8').split('\n').filter(l => /identity-learning|learning|Error/i.test(l)).slice(-40).join('\n')); } catch { /* none */ } }
  check(JSON.stringify(['auto-ingest Safe Storage', 'AutoIngest Safe Storage'].map(keychainHas)) === JSON.stringify(prodItemsBefore), 'production Keychain items untouched');
  try { execFileSync('security', ['delete-generic-password', '-s', KEYCHAIN_ITEM], { stdio: 'ignore' }); } catch { /* none */ }
  check(!keychainHas(KEYCHAIN_ITEM), 'test Keychain item removed');
  await fsp.rm(work, { recursive: true, force: true });
  await fsp.rm(userDataDir, { recursive: true, force: true });
  await fsp.rm(archiveRoot, { recursive: true, force: true });
  log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})();
