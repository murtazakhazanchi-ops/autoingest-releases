'use strict';
// LIVE (CAM-001): photographer recognition as soon as a card is read — no import first — with the
// registry key decrypted in a helper process so the main process never waits on the Keychain.
//
// A REAL encrypted registry is seeded on disk under the test identity: its key sealed by the
// in-process safeStorage path an older build used (launch 0), its events planned by the real Q4
// code. Then, each from a cold start of the isolated app:
//   1 key file missing     → honest "cannot match bodies", no key regenerated
//   2 corrupt registry     → honest "unavailable", nothing rewritten
//   3 Keychain refused     → honest "not granted", search still works         (helper test seam)
//   4 helper crash         → honest "retrying", app keeps running              (helper test seam)
//   5 Keychain stalled 20s → "waiting" while the main process stays responsive; card swapped while
//                            waiting; suggestions appear by themselves         (helper test seam)
//   6 card inserted right after launch → confirmed suggestion, no import, no splash
//   7 card attached before launch + four cards (confirmed / shared / unknown / model-only),
//     explicit confirmation, then an ordinary Event Dump import
// Registry files are compared byte-for-byte across launches 1–6 (only launch 7 imports).
//
// Isolation (test/support/liveTestHarness.js): test-only identity and Keychain item, temp profile,
// drivelist stub, external-Quit guard; synthetic JPEGs, names and serials; throwaway archive.
// Run: node test/cam001StartupRecognitionLive.test.js     AI_CAM001_SHOTS=<dir> keeps the screenshots

const { _electron: electron } = require('playwright-core');
const { ExifTool } = require('exiftool-vendored');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const H = require('./support/liveTestHarness');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_BIN = require(path.join(PROJECT_ROOT, 'node_modules', 'electron'));
const COLL = 'CollCAM001';
const EVENT = '1448-05-15 _01-Majlis-Testhall';
const PA = 'Testalpha Kharwala', PB = 'Testbeta Bhai', PC = 'Testgamma Bhai';
const SERIAL = { A: 'FAKECAMA0001', B: 'FAKECAMB0002', C: 'FAKECAMC0003' };
const KEY = crypto.randomBytes(32);   // test-only registry key, sealed under the test identity

let failures = 0;
const log = (...a) => console.log('[cam001-live]', ...a);
const check = (c, m) => { if (c) log('PASS —', m); else { failures++; log('FAIL —', m); } };
const J = (x) => JSON.stringify(x);
const { sleep, localDate, fakeDrive, waitFor, createHelpers, noiseJpeg: _noise, listFiles } = require('./support/eventDumpLiveHelpers');
const { mainRequire, diag, passSplash, withPopup, dumpView, setActiveEvent, enterDump, backToOverview } = createHelpers({ projectRoot: PROJECT_ROOT });
const noiseJpeg = () => _noise(PROJECT_ROOT);

async function shoot(page, dir, name) {
  const cur = await page.evaluate(() => document.documentElement.dataset.theme);
  for (const theme of [cur, cur === 'dark' ? 'light' : 'dark']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(dir, `${name}-${theme}.png`) });
  }
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, cur);
}

/** Every attached card's suggestion, by card label. */
async function suggestions(app) {
  const d = await diag(app);
  const out = {};
  for (const s of (d.snapshot && d.snapshot.sources) || []) out[s.label] = s.assessment && s.assessment.dump ? s.assessment.dump.suggestion : null;
  return out;
}
const startup = (app) => mainRequire(app, '../services/photographerLearningRuntime', 'return m._forTests.startup();');
const storeStatus = (app) => mainRequire(app, '../services/photographerLearningRuntime', 'const s = m._forTests.store(); return s ? s.getStatus() : null;');

/** Main-process round trips while `ms` passes: the main process answers or it is frozen. */
async function sampleRtt(app, ms) {
  const rtts = [];
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const t0 = Date.now();
    await app.evaluate(() => 1);
    rtts.push(Date.now() - t0);
    await sleep(100);
  }
  rtts.sort((a, b) => a - b);
  return { n: rtts.length, max: rtts[rtts.length - 1], p50: rtts[Math.floor(rtts.length / 2)] };
}

/** Registry events for the fake bodies, planned by the real Q4 code with the registry's own key. */
function plannedRegistryEvents(keyId) {
  const { fileIdentity } = require('../services/cameraIdentityEvidence');
  const { assessCameras } = require('../services/cameraAssessmentModel');
  const { createKeyring } = require('../services/identityKeyring');
  const { createEvent } = require('../services/identityEvents');
  const { protectCameraGroups } = require('../services/cameraDeviceIdentity');
  const { deriveRegistryState, decisionContext } = require('../services/associationModel');
  const { planImportLearning } = require('../services/identityLearningPlan');
  const ring = createKeyring([{ keyId, key: KEY }]);
  let n = 0, clock = Date.parse('2026-11-01T08:00:00Z');
  const newId = () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`;
  const ev = (type, payload, workflow = 'event-import') => createEvent(type, payload, { origin: { computerId: 'comp-T', operatorId: null, workflow }, at: new Date(clock += 60000).toISOString(), newId });
  const ids = { [PA]: newId(), [PB]: newId(), [PC]: newId() };
  let events = Object.entries(ids).map(([name, photographerId]) => ev('photographer-registered', { photographerId, name, idOrigin: 'random' }));
  const tags = (serial) => ({ 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS R5', 'ExifIFD:SerialNumber': serial });
  const learn = (serial, name, day) => {
    const records = [{ path: '/fake/A.JPG', name: 'A.JPG', type: 'photo', pairKey: null, evidence: null, identity: fileIdentity(tags(serial)) }];
    const plan = planImportLearning(protectCameraGroups(records, assessCameras(records), ring), deriveRegistryState(events), { photographerId: ids[name], importId: newId(), day, newDeviceId: newId });
    events = [...events, ...plan.events.map(p => ev(p.type, p.payload))];
  };
  learn(SERIAL.A, PA, '2026-11-01');
  const devA = [...deriveRegistryState(events).devices.keys()][0];
  events.push(ev('association-confirmed', { photographerId: ids[PA], deviceId: devA, resolves: decisionContext(deriveRegistryState(events), devA, ids[PA]) }, 'registry'));
  learn(SERIAL.B, PB, '2026-11-02');
  learn(SERIAL.B, PC, '2026-11-03');
  return events;
}

(async () => {
  if (process.platform !== 'darwin') { log('SKIP — macOS only'); return; }
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-cam001-live-'));
  const shots = process.env.AI_CAM001_SHOTS || path.join(work, 'shots');
  await fsp.mkdir(shots, { recursive: true });
  const ud = path.join(work, 'userData'); await fsp.mkdir(ud);
  const regDir = path.join(ud, 'identity-registry');
  const archiveRoot = path.join(work, 'archive'); await fsp.mkdir(archiveRoot);
  const collDir = path.join(archiveRoot, COLL);
  const iso = H.prepareIsolatedApp({ tag: 'cam001', work, projectRoot: PROJECT_ROOT });
  const prodBefore = H.prodKeychainSnapshot();
  const testKcBefore = H.keychainHas(iso.keychainItem);
  const et = new ExifTool({ maxProcs: 2 });
  const stamp = `${localDate().replace(/-/g, ':')} 10:00:00`;
  const makeCard = async (label, n, extra) => {
    const dir = path.join(work, label, 'DCIM', '100CANON');
    await fsp.mkdir(dir, { recursive: true });
    for (let i = 1; i <= n; i++) {
      const p = path.join(dir, `${label}_${String(i).padStart(3, '0')}.JPG`);
      await fsp.writeFile(p, await noiseJpeg());
      await et.write(p, { Make: 'Canon', Model: 'Canon EOS R5', DateTimeOriginal: stamp, CreateDate: stamp, ...extra }, { writeArgs: ['-overwrite_original'] });
    }
    return path.join(work, label);
  };
  const cards = {
    A: await makeCard('CARD_A', 5, { 'ExifIFD:SerialNumber': SERIAL.A }),
    B: await makeCard('CARD_B', 3, { 'ExifIFD:SerialNumber': SERIAL.B }),
    C: await makeCard('CARD_C', 3, { 'ExifIFD:SerialNumber': SERIAL.C }),
    D: await makeCard('CARD_D', 2, {}),   // make/model only — no body serial
  };
  const drive = (k) => fakeDrive(cards[k], `CARD_${k}`);
  const setDrives = (keys) => fs.writeFileSync(iso.drivesFile, J(keys.map(drive)));
  const regFiles = async () => {
    const out = {};
    for (const f of ['registry.json', 'keys.json']) { try { out[f] = crypto.createHash('sha256').update(await fsp.readFile(path.join(regDir, f))).digest('hex'); } catch { out[f] = null; } }
    return out;
  };

  let app = null;
  const launch = async (extraEnv = {}) => {
    const t0 = Date.now();
    app = await electron.launch({ executablePath: ELECTRON_BIN, args: [...iso.args, '--user-data-dir=' + ud, '--no-sandbox'], cwd: PROJECT_ROOT, env: { ...iso.env(ud), ...extraEnv }, timeout: 60000 });
    await H.verifyIsolation(app, iso, ud);
    return t0;
  };
  const quit = async () => { if (app) { await app.close().catch(() => {}); app = null; } await sleep(500); };
  const waitSug = (label, pred, ms = 60000) => waitFor(async () => { const s = (await suggestions(app))[label]; return s && pred(s) ? s : null; }, ms);
  const seam = (x) => ({ AUTOINGEST_KEY_HELPER_TEST: J(x) });

  try {
    // ═══ 0. Seed: profile, list, event, and a registry whose key an older (in-process) build sealed ═══
    setDrives([]);
    await launch();
    check(true, 'isolation proven (test identity, temp profile, drivelist stub, quit guard)');
    const st0 = await waitFor(async () => { const s = await startup(app); return s.phase !== 'idle' && s.phase !== 'starting' ? s : null; }, 20000);
    check(st0 && st0.phase === 'unavailable' && st0.reason === 'no-registry', `no registry yet: startup reports no-registry and creates nothing (${J(st0)})`);
    check(!fs.existsSync(regDir) && !H.keychainHas(iso.keychainItem), 'startup without a registry created no folder and no Keychain item');
    const main = await passSplash(app);
    await main.evaluate(async (a) => {
      await window.api.initArchiveRoot(a.archiveRoot);
      await window.api.setNasRoot(a.archiveRoot);
      await window.api.setMainArchiveRoot(a.archiveRoot);
      await window.api.setDefaultImportMode('direct-nas');
      if (typeof EventCreator.setSessionArchiveRoot === 'function') EventCreator.setSessionArchiveRoot(a.archiveRoot);
      for (const n of a.names) await window.api.addToList('photographers', n);
    }, { archiveRoot, names: [PA, PB, PC] });
    await main.evaluate((d) => window.api.writeEventJson(d.dir, d.data), { dir: path.join(collDir, EVENT), data: { version: 1, hijriDate: '1448-05-15', sequence: 1, eventName: EVENT.slice(14), components: [{ id: 1, folderName: 'Majlis-Testhall', location: 'Testhall', city: 'Testcity', country: 'India', types: ['Majlis'], additionalKeywords: [] }] } });
    const keyIds = await mainRequire(app, '../services/identityRegistryStore', `return (async () => {
      const req = process.getBuiltinModule('module').createRequire(arg.root + '/main/main.js');
      const { createElectronSecureStorage } = req('./../services/electronSecureStorage');
      const crypto = req('crypto');
      const key = Buffer.from(arg.key, 'hex');
      const s = m.createIdentityRegistryStore({ dir: arg.dir, secureStorage: createElectronSecureStorage(req('electron')), computerId: 'comp-T',
        randomBytes: (n) => (n === 32 ? Buffer.from(key) : crypto.randomBytes(n)) });
      const st = await s.open();
      await s.close();
      if (!st.bodyMatching) return null;
      return JSON.parse(req('fs').readFileSync(arg.dir + '/keys.json', 'utf8')).keys.map(k => k.keyId);
    })();`, { root: PROJECT_ROOT, key: KEY.toString('hex'), dir: regDir });
    check(Array.isArray(keyIds) && keyIds.length === 1, 'seed registry created; key sealed by the in-process safeStorage path (as older builds did)');
    const doc = JSON.parse(await fsp.readFile(path.join(regDir, 'registry.json'), 'utf8'));
    await fsp.writeFile(path.join(regDir, 'registry.json'), `${JSON.stringify({ ...doc, events: plannedRegistryEvents(keyIds[0]) }, null, 2)}\n`);
    await quit();
    const seeded = await regFiles();
    const keysBackup = await fsp.readFile(path.join(regDir, 'keys.json'));
    const regBackup = await fsp.readFile(path.join(regDir, 'registry.json'));

    // ═══ 1. Key file missing ═══
    await fsp.rm(path.join(regDir, 'keys.json'));
    setDrives(['A']);
    await launch();
    let s = await waitSug('CARD_A', x => x.reason !== 'assessing' && x.reason !== 'registry-starting' && x.reason !== 'keychain-waiting');
    check(s && s.status === 'unknown' && s.reason === 'body-matching-unavailable', `missing key file: honest unknown, nobody named (${J(s)})`);
    await quit();
    check(!fs.existsSync(path.join(regDir, 'keys.json')), 'missing key was NOT regenerated or replaced');
    await fsp.writeFile(path.join(regDir, 'keys.json'), keysBackup);

    // ═══ 2. Corrupt registry ═══
    await fsp.writeFile(path.join(regDir, 'registry.json'), '{ "format": "autoingest-identity-registry", truncated');
    await launch();
    s = await waitSug('CARD_A', x => x.reason !== 'assessing' && x.reason !== 'registry-starting');
    check(s && s.status === 'unknown' && s.reason === 'registry-unavailable', `corrupt registry: honest unknown (${J(s)})`);
    await quit();
    check((await fsp.readFile(path.join(regDir, 'registry.json'), 'utf8')).endsWith('truncated'), 'corrupt registry left in place, not rewritten');
    await fsp.writeFile(path.join(regDir, 'registry.json'), regBackup);
    check(J(await regFiles()) === J(seeded), 'registry restored to the seeded bytes');

    // ═══ 3. Keychain access refused ═══
    await launch(seam({ result: 'deny' }));
    s = await waitSug('CARD_A', x => x.reason === 'keychain-denied', 60000);
    check(!!s && s.candidates.length === 0, `refused Keychain access: "keychain-denied", nobody named (${J(s)})`);
    await withPopup(app, async (page) => {
      await enterDump(page);
      await page.waitForFunction(() => /not granted/i.test(document.getElementById('xp-ph-camera-text').textContent), null, { timeout: 15000 }).catch(() => {});
      const txt = await page.textContent('#xp-ph-camera-text');
      check(/not granted/i.test(txt), `refusal explained ("${txt}")`);
      await page.click('#xp-ph-input');
      await page.type('#xp-ph-input', 'gamma');
      await page.waitForSelector('#xp-ph-list:not([hidden]) .combo-item', { timeout: 5000 });
      check((await page.$$eval('#xp-ph-list .combo-item', els => els.map(e => e.textContent)))[0] === PC, 'manual photographer search still works');
      await page.keyboard.press('Escape');
      await shoot(page, shots, '3-keychain-denied');
    });
    await quit();

    // ═══ 4. Helper crash ═══
    await launch(seam({ result: 'crash' }));
    s = await waitSug('CARD_A', x => x.reason === 'keychain-helper-failed', 60000);
    check(!!s, `helper crash: "keychain-helper-failed" (${J(s)})`);
    check(await app.evaluate(() => 1) === 1 && (await diag(app)).trayActive, 'app and tray keep running after the helper crashed');
    await quit();
    check(J(await regFiles()) === J(seeded), 'registry files unchanged by refused / crashed key access');

    // ═══ 5. Stalled Keychain (20 s): responsiveness, card swap while waiting, automatic update ═══
    setDrives(['A']);
    const tStall = await launch(seam({ stallMs: 20000 }));
    s = await waitSug('CARD_A', x => x.reason === 'keychain-waiting', 30000);
    check(!!s, `card inserted before the registry is ready: "keychain-waiting" (${J(s)})`);
    const rtt = await sampleRtt(app, 4000);
    check(rtt.max < 500, `main process responsive while the helper is blocked: ${rtt.n} round trips, max ${rtt.max} ms, median ${rtt.p50} ms`);
    await withPopup(app, async (page) => {
      const t0 = Date.now();
      await page.waitForSelector('.card-row .recog:not([hidden])', { timeout: 10000 });
      const c = await page.evaluate(() => ({ recog: document.querySelector('.card-row .recog').textContent, quick: document.querySelector('.card-row .review-selected').disabled, dump: document.querySelector('.card-row .event-dump-btn').disabled }));
      check(/Waiting for Keychain/i.test(c.recog) && !c.quick && !c.dump, `tray popup opens and works while waiting (${Date.now() - t0} ms; "${c.recog}"; Quick Import and Event Dump enabled)`);
      await shoot(page, shots, '5a-compact-keychain-waiting');
      await enterDump(page);
      await page.waitForFunction(() => /Waiting for Keychain/i.test(document.getElementById('xp-ph-camera-text').textContent), null, { timeout: 10000 }).catch(() => {});
      await page.click('#xp-ph-input');
      await page.type('#xp-ph-input', 'beta');
      await page.waitForSelector('#xp-ph-list:not([hidden]) .combo-item', { timeout: 5000 });
      check((await page.$$eval('#xp-ph-list .combo-item', els => els.map(e => e.textContent)))[0] === PB, 'manual search works while waiting');
      await page.keyboard.press('Escape');
      await shoot(page, shots, '5b-expanded-keychain-waiting');
    });
    // Disconnect the card during the lookup and attach another.
    setDrives([]);
    await waitFor(async () => !(await dumpView(app)).card, 15000);
    setDrives(['B']);
    const sb = await waitSug('CARD_B', x => x.status === 'multiple', 60000);
    const waited = Date.now() - tStall;
    check(!!sb && J(sb.candidates.map(c => c.name).sort()) === J([PB, PC].sort()), `after the stall the swapped-in card is recognised by itself (${Math.round(waited / 1000)} s after launch; ${J(sb)})`);
    check(!J(await suggestions(app)).includes(PA), 'no stale suggestion from the disconnected card');
    setDrives(['A']);
    await waitFor(async () => (await suggestions(app)).CARD_A, 30000);
    await withPopup(app, async (page) => {
      // The popup stays open and updates itself: no reopen needed.
      s = await waitSug('CARD_A', x => x.status === 'confirmed', 60000);
      await page.waitForFunction((n) => (document.querySelector('.card-row .recog')?.textContent || '').includes(n), PA, { timeout: 15000 }).catch(() => {});
      const recog = await page.evaluate(() => document.querySelector('.card-row .recog').textContent);
      check(!!s && recog.includes(PA), `the open popup updated to the confirmed photographer ("${recog}")`);
    });
    // Control: the same measurement DOES see a frozen main process.
    const freeze = app.evaluate(() => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500); return true; });
    await sleep(100);
    const ctl = await sampleRtt(app, 1500);
    await freeze;
    check(ctl.max >= 1500, `control: a main-thread block of 2.5 s is detected by the same probe (max ${ctl.max} ms)`);
    await quit();
    check(J(await regFiles()) === J(seeded), 'registry files unchanged after the stalled run');

    // ═══ 6. Card inserted right after launch (no splash, no import) ═══
    setDrives([]);
    const t6 = await launch();
    setDrives(['A']);
    s = await waitSug('CARD_A', x => x.status === 'confirmed', 60000);
    check(!!s && s.candidates[0]?.name === PA && s.candidates[0]?.basis === 'confirmed', `card inserted right after launch: confirmed photographer before any import (${Math.round((Date.now() - t6) / 100) / 10} s after launch)`);
    const ss6 = await storeStatus(app);
    check(ss6 && ss6.bodyMatching === true && ss6.keyStatus === 'ready', `registry opened at startup with its key, through the helper (${J(ss6 && { state: ss6.state, keyStatus: ss6.keyStatus })})`);
    check((await dumpView(app)).card?.photographer == null, 'nothing selected automatically');
    await quit();
    check(J(await regFiles()) === J(seeded), 'registry files unchanged by recognition');

    // ═══ 7. Cold start with cards already attached; four cards; confirm; Event Dump import ═══
    setDrives(['A', 'B', 'C', 'D']);
    const t7 = await launch();
    const all = await waitFor(async () => {
      const x = await suggestions(app);
      return ['CARD_A', 'CARD_B', 'CARD_C', 'CARD_D'].every(k => x[k] && !['assessing', 'registry-starting', 'keychain-waiting'].includes(x[k].reason)) ? x : null;
    }, 90000);
    check(!!all, `all four cards assessed and matched after a cold start (${Math.round((Date.now() - t7) / 100) / 10} s)`);
    check(all && all.CARD_A.status === 'confirmed' && all.CARD_A.candidates.map(c => c.name).join() === PA, `CARD_A (confirmed body): ${J(all && all.CARD_A)}`);
    check(all && all.CARD_B.status === 'multiple' && all.CARD_B.candidates.length === 2, `CARD_B (shared body): ${J(all && all.CARD_B)}`);
    check(all && all.CARD_C.status === 'unknown' && all.CARD_C.reason === 'camera-not-recognised', `CARD_C (unknown body): ${J(all && all.CARD_C)}`);
    check(all && all.CARD_D.status === 'unknown' && all.CARD_D.candidates.length === 0 && all.CARD_D.reason === 'model-only', `CARD_D (make/model only): nobody named (${J(all && all.CARD_D)})`);
    const imp0 = fs.existsSync(path.join(collDir, EVENT, 'Dump'));
    check(!imp0, 'recognised before any import (no Dump folder exists yet)');
    await withPopup(app, async (page) => {
      await page.waitForFunction(() => document.querySelectorAll('.card-row .recog:not([hidden])').length >= 4, null, { timeout: 15000 }).catch(() => {});
      const rows = await page.$$eval('.card-row', els => els.map(r => ({ status: r.querySelector('.recog')?.dataset.status, text: r.querySelector('.recog')?.textContent })));
      check(rows.length === 4 && rows.filter(r => r.status === 'confirmed').length === 1, `compact: one row per card with its own recognition line (${J(rows.map(r => r.text))})`);
      await shoot(page, shots, '7a-compact-four-cards');
    });
    setDrives(['A']);
    await waitFor(async () => Object.keys(await suggestions(app)).length === 1, 15000);
    const main7 = await passSplash(app);
    await setActiveEvent(main7, collDir, COLL, EVENT);
    await waitFor(async () => (await dumpView(app)).global?.event?.eventName === EVENT, 15000);
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().endsWith('index.html')) w.hide(); });
    await withPopup(app, async (page) => {
      await enterDump(page);
      await page.waitForSelector('#xp-ph-camera:not([hidden]) .ph-choice', { timeout: 15000 });
      const x = await page.evaluate(() => ({ text: document.getElementById('xp-ph-camera-text').textContent, choices: [...document.querySelectorAll('.ph-choice')].map(b => b.textContent), importDisabled: document.getElementById('xp-import').disabled, input: document.getElementById('xp-ph-input').value }));
      check(x.choices.join() === `Use ${PA}` && x.importDisabled && x.input === '', `expanded: confirmed suggestion offered, not selected, Import disabled (${J(x)})`);
      await shoot(page, shots, '7b-expanded-confirmed-before-import');
      await page.click('#xp-ph-camera-choices .ph-choice');
      await page.waitForFunction(() => !document.getElementById('xp-import').disabled, null, { timeout: 10000 });
      check((await dumpView(app)).card?.photographer === PA, 'explicit one-click confirmation selects the photographer');
      await page.click('#xp-import');
    });
    const op = await waitFor(async () => { const v = await dumpView(app); return v.card?.op && v.card.op.state !== 'pending' ? v.card.op : null; }, 120000);
    check(op && op.state === 'completed' && op.result.copied === 5 && op.result.errors === 0, `ordinary Event Dump import after recognition (${J(op && op.result)})`);
    const dumpDir = path.join(collDir, EVENT, 'Dump', PA);
    check((await listFiles(dumpDir)).length === 5, 'files in Event/Dump/<confirmed photographer>');
    const ej = JSON.parse(await fsp.readFile(path.join(collDir, EVENT, 'event.json'), 'utf8'));
    const rec = (ej.imports || []).find(i => i.destination === 'dump');
    check(rec && rec.photographer === PA, 'event.json Dump record attributed to the confirmed photographer');
    const meta = await waitFor(async () => { const v = await dumpView(app); return v.card?.op?.metadata?.state && v.card.op.metadata.state !== 'writing' ? v.card.op.metadata : null; }, 60000);
    const creator = [].concat((await et.read(path.join(dumpDir, 'CARD_A_001.JPG'), ['-G1']))['XMP-dc:Creator'] || []);
    check(meta && meta.state === 'complete' && creator.includes(PA), `metadata Creator = confirmed photographer (${meta && meta.state})`);
    const mw = (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({ page: w.webContents.getURL().split('/').pop(), visible: w.isVisible() })))).find(w => w.page === 'index.html');
    check(mw && !mw.visible, 'the import did not bring the main window forward');
    await quit();
    const after = await regFiles();
    check(after['keys.json'] === seeded['keys.json'], 'the registry key file is byte-identical after everything (no migration, no regeneration)');
  } catch (err) {
    failures++; log('FAIL — exception:', err && (err.stack || err.message));
  } finally {
    await et.end().catch(() => {});
    if (app) await app.close().catch(() => {});
    const qg = H.quitGuardSummary(iso);
    check(qg.endedWithoutExit === 0, `the app ended only by the test's deliberate quits (${qg.endedWithoutExit})`);
    check(H.removeTestKeychainItem(iso, testKcBefore), 'test Keychain item absent after the run');
    check(J(H.prodKeychainSnapshot()) === J(prodBefore), 'production Keychain items unchanged (presence only)');
    const leftovers = fs.readdirSync(os.tmpdir()).filter(n => n.startsWith('autoingest-keyhelper-'));
    check(leftovers.length === 0, `helper temp profiles removed (${leftovers.length} left)`);
    await fsp.rm(path.join(os.homedir(), 'Library', 'Logs', iso.name), { recursive: true, force: true }).catch(() => {});
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    log('screenshots:', process.env.AI_CAM001_SHOTS ? shots : '(temp, removed)');
    log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
