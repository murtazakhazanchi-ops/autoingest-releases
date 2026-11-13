'use strict';
// LIVE (AI-FEAT-064 EQI-1.2): the companion's visual hierarchy and camera-based photographer
// suggestions, on the REAL popup with REAL card assessment (ExifTool camera identity) —
// confirmed / shared (multiple) / unrecognised / registry-not-open / last-used states, explicit
// confirmation before import, card switching, reopening, and an Event Dump import attributed to
// the confirmed photographer with the main window kept in the background. Screenshots of each
// state in both themes are saved for inspection.
//
// The identity registry is an IN-MEMORY "already open" store installed in the isolated app's main
// process (the runtime's test hook), with events planned by the real Q4 code from the same fake
// serials — so no registry file, key or Keychain item is involved in the suggestion phases.
//
// Isolation (test/support/liveTestHarness.js): test-only identity, temp profile, drivelist stub,
// external-Quit guard; synthetic JPEGs, synthetic names, throwaway archive.
// Run: node test/eqiCompanionHierarchyLive.test.js     AI_EQI12_SHOTS=<dir> keeps the screenshots

const { _electron: electron } = require('playwright-core');
const { ExifTool } = require('exiftool-vendored');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const H = require('./support/liveTestHarness');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_BIN = require(path.join(PROJECT_ROOT, 'node_modules', 'electron'));
const COLL = 'CollEQI12';
const PA = 'Testalpha Kharwala', PB = 'Testbeta Bhai', PC = 'Testgamma Bhai';
const SERIAL = { A: 'FAKER5A0001', B: 'FAKER5B0002', C: 'FAKER5C0003' };
const KEY_HEX = 'a1'.repeat(32);   // test-only keyring key (in memory only)

let failures = 0;
const log = (...a) => console.log('[eqi12-live]', ...a);
const check = (c, m) => { if (c) log('PASS —', m); else { failures++; log('FAIL —', m); } };
const J = (x) => JSON.stringify(x);
const { sleep, localDate, fakeDrive, waitFor, createHelpers, noiseJpeg: _noise, listFiles } = require('./support/eventDumpLiveHelpers');
const { mainRequire, passSplash, withPopup, dumpView, setActiveEvent, enterDump, backToOverview } = createHelpers({ projectRoot: PROJECT_ROOT });
const noiseJpeg = () => _noise(PROJECT_ROOT);

const windows = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({
  page: (w.webContents.getURL().split('/').pop() || ''), bounds: w.getBounds(), visible: w.isVisible(), focused: w.isFocused(),
})));
const popupWin = async (app) => (await windows(app)).find(w => w.page === 'companion.html') || null;
const mainWin = async (app) => (await windows(app)).find(w => w.page === 'index.html') || null;
const hideMain = (app) => app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().endsWith('index.html')) w.hide(); });

async function shoot(page, dir, name) {
  const cur = await page.evaluate(() => document.documentElement.dataset.theme);
  for (const theme of [cur, cur === 'dark' ? 'light' : 'dark']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(dir, `${name}-${theme}.png`) });
  }
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, cur);
}

/** Registry events for the fake bodies, planned by the real Q4 code (test process). */
function plannedRegistryEvents() {
  const { fileIdentity } = require('../services/cameraIdentityEvidence');
  const { assessCameras } = require('../services/cameraAssessmentModel');
  const { createKeyring } = require('../services/identityKeyring');
  const { createEvent } = require('../services/identityEvents');
  const { protectCameraGroups } = require('../services/cameraDeviceIdentity');
  const { deriveRegistryState, decisionContext } = require('../services/associationModel');
  const { planImportLearning } = require('../services/identityLearningPlan');
  const ring = createKeyring([{ keyId: 'local-T', key: Buffer.from(KEY_HEX, 'hex') }]);
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

/** Installs an already-open, in-memory registry store in the app (no file, no key store, no Keychain). */
const installOpenRegistry = (app, events) => mainRequire(app, '../services/photographerLearningRuntime', `
  const req = process.getBuiltinModule('module').createRequire(arg.root + '/main/main.js');
  const { createKeyring } = req('./../services/identityKeyring');
  const { deriveRegistryState } = req('./../services/associationModel');
  const P = req('./../services/photographerIdentity');
  const ring = createKeyring([{ keyId: 'local-T', key: Buffer.from(arg.key, 'hex') }]);
  m._forTests.useStore({
    getStatus: () => ({ state: 'ready', keyStatus: 'ready', bodyMatching: true }),
    getKeyring: () => ring,
    getEvents: () => arg.events.slice(),
    deriveState: ({ shippedNames = [] } = {}) => deriveRegistryState(arg.events, { shipped: P.bootstrapShippedIds(shippedNames) }),
  });
  return true;`, { root: PROJECT_ROOT, key: KEY_HEX, events });
const removeOpenRegistry = (app) => mainRequire(app, '../services/photographerLearningRuntime', 'm._forTests.useStore(null); return true;');

(async () => {
  if (process.platform !== 'darwin') { log('SKIP — macOS only'); return; }
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-eqi12-live-'));
  const shots = process.env.AI_EQI12_SHOTS || path.join(work, 'shots');
  await fsp.mkdir(shots, { recursive: true });
  const ud = path.join(work, 'userData'); await fsp.mkdir(ud);
  const archiveRoot = path.join(work, 'archive'); await fsp.mkdir(archiveRoot);
  const collDir = path.join(archiveRoot, COLL);
  const iso = H.prepareIsolatedApp({ tag: 'eqi12', work, projectRoot: PROJECT_ROOT });
  const prodBefore = H.prodKeychainSnapshot();
  const testKcBefore = H.keychainHas(iso.keychainItem);
  const et = new ExifTool({ maxProcs: 2 });
  const today = localDate();
  const stamp = `${today.replace(/-/g, ':')} 10:00:00`;
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
    A: await makeCard('CARD_A', 6, { 'ExifIFD:SerialNumber': SERIAL.A }),
    B: await makeCard('CARD_B', 4, { 'ExifIFD:SerialNumber': SERIAL.B }),
    C: await makeCard('CARD_C', 3, { 'ExifIFD:SerialNumber': SERIAL.C }),
  };
  const LONG = '1448-05-14 _01-Urs Mubarak-Majlis-Waaz-Raudat Tahera-Testcity';

  let app;
  try {
    app = await electron.launch({ executablePath: ELECTRON_BIN, args: [...iso.args, '--user-data-dir=' + ud, '--no-sandbox'], cwd: PROJECT_ROOT, env: iso.env(ud), timeout: 60000 });
    await H.verifyIsolation(app, iso, ud);
    check(true, 'isolation proven (test identity, temp profile, drivelist stub, quit guard)');
    const main = await passSplash(app);
    await main.evaluate(async (a) => {
      await window.api.initArchiveRoot(a.archiveRoot);
      await window.api.setNasRoot(a.archiveRoot);
      await window.api.setMainArchiveRoot(a.archiveRoot);
      await window.api.setDefaultImportMode('direct-nas');
      if (typeof EventCreator.setSessionArchiveRoot === 'function') EventCreator.setSessionArchiveRoot(a.archiveRoot);
      for (const n of a.names) await window.api.addToList('photographers', n);
    }, { archiveRoot, names: [PA, PB, PC] });
    const comp = (id, folderName, types) => ({ id, folderName, location: 'Raudat Tahera', city: 'Testcity', country: 'India', types, additionalKeywords: [] });
    await main.evaluate((d) => window.api.writeEventJson(d.dir, d.data), { dir: path.join(collDir, LONG), data: { version: 1, hijriDate: '1448-05-14', sequence: 1, eventName: LONG.slice(14), components: [comp(1, 'Majlis-Raudat Tahera', ['Majlis']), comp(2, 'Waaz-Raudat Tahera', ['Waaz'])] } });
    await setActiveEvent(main, collDir, COLL, LONG);
    check(!!(await waitFor(async () => (await dumpView(app)).global?.event?.eventName === LONG, 15000)), 'companion shows the active event');
    await installOpenRegistry(app, plannedRegistryEvents());
    await hideMain(app);

    const insert = async (key, label) => {
      fs.writeFileSync(iso.drivesFile, J([]));
      await waitFor(async () => !(await dumpView(app)).card, 15000);
      fs.writeFileSync(iso.drivesFile, J([fakeDrive(cards[key], label)]));
      return waitFor(async () => { const v = await dumpView(app); return v.assessment?.state === 'complete' && v.card?.suggestion && v.card.suggestion.reason !== 'assessing' ? v.card : null; }, 60000);
    };

    // ═══ 1. Confirmed association (CARD_A) ═══
    const a = await insert('A', 'CARD_A');
    check(a && a.suggestion.status === 'confirmed' && a.suggestion.candidates[0]?.name === PA, `confirmed camera association recognised (${J(a && a.suggestion)})`);
    check(a && a.photographer === null, 'nothing is selected by the suggestion');
    await withPopup(app, async (page) => {
      await page.waitForSelector('.card-row .recog:not([hidden])', { timeout: 10000 });
      const c = await page.evaluate(() => { const r = document.querySelector('.card-row'); return {
        newNum: r.querySelector('.new-num').textContent, recog: r.querySelector('.recog').textContent, status: r.querySelector('.recog').dataset.status,
        camera: r.querySelector('.camera-name')?.textContent, actions: [...r.querySelectorAll('.card-actions .btn')].map(b => b.textContent),
        heroSize: parseFloat(getComputedStyle(r.querySelector('.new-num')).fontSize), bodySize: parseFloat(getComputedStyle(r.querySelector('.selected-caption')).fontSize),
        hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth }; });
      check(c.newNum === '6' && c.heroSize >= 2 * c.bodySize, `compact: the NEW count is the largest figure (${c.newNum} at ${c.heroSize}px vs ${c.bodySize}px)`);
      check(c.status === 'confirmed' && c.recog.includes(PA), `compact: concise recognition indicator ("${c.recog}")`);
      check(/Canon EOS R5/.test(c.camera || ''), `compact: camera identity shown ("${c.camera}")`);
      check(J(c.actions) === J(['Quick Import', 'Event Dump']) && !c.hScroll, 'compact: Quick Import and Event Dump side by side; no horizontal scroll');
      check((await popupWin(app)).bounds.width <= 380, `compact width unchanged (${(await popupWin(app)).bounds.width}px)`);
      await shoot(page, shots, '1-compact-confirmed');
    });
    await withPopup(app, async (page) => {
      await enterDump(page);
      await page.waitForSelector('#xp-ph-camera:not([hidden]) .ph-choice', { timeout: 10000 });
      const x = await page.evaluate(() => ({
        box: document.getElementById('xp-ph-camera').dataset.status, text: document.getElementById('xp-ph-camera-text').textContent,
        choices: [...document.querySelectorAll('#xp-ph-camera-choices .ph-choice')].map(b => b.textContent),
        input: document.getElementById('xp-ph-input').value, importDisabled: document.getElementById('xp-import').disabled,
        name: document.getElementById('xp-event-name').textContent, date: document.querySelector('#xp-event-name .ev-date')?.textContent, seq: document.querySelector('#xp-event-name .ev-seq')?.textContent,
        tags: [...document.querySelectorAll('#xp-event-tags li')].map(l => `${l.dataset.kind}:${l.textContent}`),
        eventBorder: getComputedStyle(document.querySelector('.xp-event')).borderLeftWidth, nameSize: parseFloat(getComputedStyle(document.getElementById('xp-event-name')).fontSize),
        hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth }));
      check(x.box === 'confirmed' && /Confirm the photographer/.test(x.text) && J(x.choices) === J([`Use ${PA}`]), `expanded: confirmed suggestion offered as a choice (${J({ text: x.text, choices: x.choices })})`);
      check(x.input === '' && x.importDisabled, 'expanded: not selected, Import disabled until the operator confirms');
      check(x.name === LONG && x.date === '1448-05-14' && x.seq === '01', 'event name: complete canonical text; date and sequence styled apart');
      check(x.tags.includes('type:Majlis') && x.tags.includes('type:Waaz') && x.tags.includes('place:Raudat Tahera, Testcity'), `event details: types and place as separate tags (${x.tags.join(', ')})`);
      check(x.eventBorder === '3px' && x.nameSize >= 16 && !x.hScroll, 'selected event panel is visually distinguished; no horizontal scroll');
      await shoot(page, shots, '2-expanded-confirmed-unchosen');
      await page.click('#xp-ph-camera-choices .ph-choice');
      await page.waitForFunction((n) => document.getElementById('xp-ph-state').textContent.includes(n), PA, { timeout: 5000 });
      const after = await page.evaluate(() => ({ importDisabled: document.getElementById('xp-import').disabled, ready: document.getElementById('xp-ready').textContent,
        dest: document.getElementById('xp-dest').textContent, full: document.getElementById('xp-dest-full').textContent }));
      check(!after.importDisabled && after.ready.includes(PA) && after.ready.includes('6 files'), `explicit confirmation enables Import ("${after.ready}")`);
      check(after.dest.includes(`/ Dump / ${PA}`) && after.full === `${COLL} / ${LONG} / Dump / ${PA}`, `destination: concise line + full canonical path ("${after.dest}")`);
      await shoot(page, shots, '3-expanded-confirmed-chosen');
    });
    check((await dumpView(app)).card?.photographer === PA, 'the confirmed choice is the operator\'s, held by main');

    // ═══ 2. Reopen keeps the view and the choice ═══
    await mainRequire(app, '../services/companionService', 'm.hidePopup(); return true;');
    await waitFor(async () => !(await popupWin(app)), 5000);
    await withPopup(app, async (page) => {
      await page.waitForFunction(() => document.querySelector('.popup').dataset.view === 'expanded', null, { timeout: 5000 });
      check(await page.inputValue('#xp-ph-input') === PA, 'reopened: still expanded, photographer still confirmed');
    });

    // ═══ 3. Card switch → shared camera (CARD_B): stale choice and suggestion gone ═══
    const b = await insert('B', 'CARD_B');
    check(b && b.suggestion.status === 'multiple' && J(b.suggestion.candidates.map(c => c.name).sort()) === J([PB, PC].sort()), `shared camera: both photographers offered (${J(b && b.suggestion)})`);
    check(b && b.photographer === null, 'card switch: the previous card\'s photographer is not carried over');
    await withPopup(app, async (page) => {
      await enterDump(page);
      await page.waitForSelector('#xp-ph-camera:not([hidden]) .ph-choice', { timeout: 10000 });
      const x = await page.evaluate(() => ({ choices: [...document.querySelectorAll('.ph-choice')].map(b => b.textContent), primary: document.querySelectorAll('.ph-choice.btn-primary').length,
        input: document.getElementById('xp-ph-input').value, importDisabled: document.getElementById('xp-import').disabled }));
      check(x.choices.length === 2 && x.primary === 0 && x.input === '' && x.importDisabled, `multiple: two equal choices, none chosen, Import disabled (${J(x)})`);
      await shoot(page, shots, '4-expanded-multiple');
    });

    // ═══ 4. Unrecognised camera (CARD_C) — autocomplete still works ═══
    const c = await insert('C', 'CARD_C');
    check(c && c.suggestion.status === 'unknown' && c.suggestion.reason === 'camera-not-recognised' && c.suggestion.candidates.length === 0, `unknown camera: nothing asserted (${J(c && c.suggestion)})`);
    await withPopup(app, async (page) => {
      await enterDump(page);
      await page.waitForSelector('#xp-ph-camera:not([hidden])', { timeout: 10000 });
      check(await page.$$eval('.ph-choice', els => els.length) === 0, 'unknown: no photographer named');
      await page.click('#xp-ph-input');
      await page.type('#xp-ph-input', 'gamma');
      await page.waitForSelector('#xp-ph-list:not([hidden]) .combo-item', { timeout: 5000 });
      const offered = await page.$$eval('#xp-ph-list .combo-item', els => els.map(e => e.textContent));
      check(offered[0] === PC, 'autocomplete still finds names by part of a word');
      await page.keyboard.press('Escape');
      check((await dumpView(app)).card?.photographer == null, 'typing alone selects nothing');
      await shoot(page, shots, '5-expanded-unknown');
    });

    // ═══ 5. No registry on this computer yet (CAM-001: startup found none and created nothing) ═══
    await removeOpenRegistry(app);
    const c2 = await waitFor(async () => { const v = await dumpView(app); return v.card?.suggestion?.reason === 'no-registry' ? v.card : null; }, 10000);
    check(!!c2 && c2.suggestion.status === 'unknown', 'no registry: honest "unknown" with its reason, nothing asserted');
    check(!H.keychainHas(iso.keychainItem), 'no Keychain item was created by any suggestion phase (no registry → no key access)');
    await withPopup(app, async (page) => {
      await enterDump(page);
      // The open popup refreshes on the next snapshot push (card poll), not instantly.
      await page.waitForFunction(() => /No camera history yet/i.test(document.getElementById('xp-ph-camera-text').textContent), null, { timeout: 15000 }).catch(() => {});
      const txt = await page.textContent('#xp-ph-camera-text');
      check(/No camera history yet/i.test(txt), `no-registry explained ("${txt}")`);
      await shoot(page, shots, '6-expanded-registry-not-open');
    });

    // ═══ 6. Import to Dump with the confirmed photographer (CARD_A), main window in the background ═══
    await installOpenRegistry(app, plannedRegistryEvents());
    await insert('A', 'CARD_A');
    await removeOpenRegistry(app);   // learning after the import uses its own (test-identity) store
    await withPopup(app, async (page) => {
      await enterDump(page);
      await page.fill('#xp-ph-input', '');
      await page.type('#xp-ph-input', 'kharwala');
      await page.waitForSelector('#xp-ph-list .combo-item', { timeout: 5000 });
      await page.locator('#xp-ph-list .combo-item').first().dispatchEvent('mousedown');
      await waitFor(async () => (await dumpView(app)).card?.photographer === PA, 5000);
      await page.waitForFunction(() => !document.getElementById('xp-import').disabled, null, { timeout: 10000 });
      await page.click('#xp-import');
    });
    const op = await waitFor(async () => { const v = await dumpView(app); return v.card?.op && v.card.op.state !== 'pending' ? v.card.op : null; }, 120000);
    check(op && op.state === 'completed' && op.result.copied === 6 && op.result.errors === 0, `import completed (${J(op && op.result)})`);
    const mw = await mainWin(app);
    check(!mw.visible && !mw.focused, 'Import to Dump did not bring the main window forward');
    const dumpDir = path.join(collDir, LONG, 'Dump', PA);
    check((await listFiles(dumpDir)).length === 6, 'files in Event/Dump/<confirmed photographer>, unsequenced');
    const ej = JSON.parse(await fsp.readFile(path.join(collDir, LONG, 'event.json'), 'utf8'));
    const rec = (ej.imports || []).find(i => i.destination === 'dump');
    check(rec && rec.photographer === PA && rec.componentName === 'Dump', 'event.json Dump import record attributed to the confirmed photographer');
    const meta = await waitFor(async () => { const v = await dumpView(app); return v.card?.op?.metadata?.state && v.card.op.metadata.state !== 'writing' ? v.card.op.metadata : null; }, 60000);
    const creator = [].concat((await et.read(path.join(dumpDir, 'CARD_A_001.JPG'), ['-G1']))['XMP-dc:Creator'] || []);
    check(meta && meta.state === 'complete' && creator.includes(PA), `metadata written with the confirmed photographer (${meta && meta.state})`);

    // ═══ 7. Last used — labelled separately from camera recognition ═══
    await insert('C', 'CARD_C');
    await withPopup(app, async (page) => {
      await enterDump(page);
      await page.waitForSelector('#xp-ph-last:not([hidden])', { timeout: 10000 });
      const x = await page.evaluate(() => ({ last: document.getElementById('xp-ph-last').textContent, camera: document.getElementById('xp-ph-camera-text').textContent, input: document.getElementById('xp-ph-input').value }));
      check(/Last used this session/.test(x.last) && x.last.includes(PA) && !x.camera.includes(PA) && x.input === '', `last-used offered separately, not as camera evidence, not preselected (${J(x)})`);
      await shoot(page, shots, '7-expanded-last-used');
      await backToOverview(page);
      await shoot(page, shots, '8-compact-after-import');
    });
  } catch (err) {
    failures++; log('FAIL — exception:', err && (err.stack || err.message));
  } finally {
    await et.end().catch(() => {});
    if (app) await app.close().catch(() => {});
    const qg = H.quitGuardSummary(iso);
    check(qg.endedWithoutExit === 0, `the app ended only by the test's deliberate quit (${qg.endedWithoutExit})`);
    check(H.removeTestKeychainItem(iso, testKcBefore), 'test Keychain item absent after the run');
    check(J(H.prodKeychainSnapshot()) === J(prodBefore), 'production Keychain items unchanged (presence only)');
    await fsp.rm(path.join(os.homedir(), 'Library', 'Logs', iso.name), { recursive: true, force: true }).catch(() => {});
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    log('screenshots:', process.env.AI_EQI12_SHOTS ? shots : '(temp, removed)');
    log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
