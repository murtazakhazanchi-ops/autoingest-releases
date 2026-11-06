'use strict';
// AI-FEAT-063 / AI-RM-014 Q5d — LIVE: camera-association decisions and conflict resolution in the
// real Photographer Registry tab (real main.js, preload, renderer, Electron, Q4 store).
//
// Isolation (same recipe as the Q5a/Q5c live tests): temp userData; drivelist stubbed; the real
// main.js loads through a test-only wrapper app named "autoingest-q5d-livetest", so nothing
// touches the production "auto-ingest" profile or its Keychain item. The registry is created
// INSIDE that isolated app with the real store and real safeStorage (as learning would), so its
// key lives in the test identity's own Keychain item, which the run deletes at the end.
// Synthetic names and FAKE identifiers only.
//
// Screenshots go to $AI_Q5D_SHOTS when set.
// Requires playwright-core (npm install --no-save playwright-core).
// Run: AI_Q5D_SHOTS=/some/dir node test/photographerRegistryQ5dLive.test.js

const { _electron: electron } = require('playwright-core');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_BIN = require(path.join(PROJECT_ROOT, 'node_modules', 'electron'));
const TEST_PKG_NAME = 'autoingest-q5d-livetest';
const KEYCHAIN_ITEM = `${TEST_PKG_NAME} Safe Storage`;
const SHOTS = process.env.AI_Q5D_SHOTS || null;
const SERIALS = ['FAKEQ5DLIVE-R5-0001', 'FAKEQ5DLIVE-SONY-0002', 'FAKEQ5DLIVE-Z8-0003'];
const NAMES = ['Testa Kay', 'Testa Lee', 'Testa Mo', 'Testa Same'];

function log(...a) { console.log('[q5d-live]', ...a); }
let failures = 0;
function check(c, m) { if (c) log('PASS —', m); else { failures++; log('FAIL —', m); } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
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
global.__aiTestRequire = require;
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
  try { await w.fill('#splashInputName', 'Q5d Operator', { timeout: 2000 }); await w.fill('#splashInputRole', 'QA'); await w.click('#splashCreateStartBtn'); } catch { /* existing profile */ }
  const main = await mainP;
  await main.waitForLoadState('domcontentloaded');
  await main.waitForTimeout(1800);
  return main;
}

async function launch(work, ud, drivesFile, stubFile) {
  const app = await electron.launch({
    executablePath: ELECTRON_BIN, args: ['-r', stubFile, path.join(work, 'wrapper-app'), '--no-sandbox'],
    cwd: PROJECT_ROOT, timeout: 60000,
    env: { ...process.env, AI_TEST_DRIVES_FILE: drivesFile, AI_TEST_PROJECT_ROOT: PROJECT_ROOT, AI_TEST_USERDATA: ud },
  });
  const main = await passSplash(app);
  return { app, main };
}

async function settleStartup(ud) {
  for (let i = 0; i < 100; i++) {
    try { if (JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).deviceId) break; } catch { /* not yet */ }
    await sleep(200);
  }
  await sleep(500);
}

/** Create the registry inside the isolated app (real store + real safeStorage), then release it. */
const seedInApp = (app) => app.evaluate(async (_e, { root, serials }) => {
  const req = global.__aiTestRequire;
  const crypto = req('crypto');
  const { app: a } = req('electron');
  const { createIdentityRegistryStore } = req(`${root}/services/identityRegistryStore`);
  const { createElectronSecureStorage } = req(`${root}/services/electronSecureStorage`);
  const { createEvent } = req(`${root}/services/identityEvents`);
  const settings = req(`${root}/services/settings`);
  const dir = req('path').join(a.getPath('userData'), 'identity-registry');
  const store = createIdentityRegistryStore({ dir, secureStorage: createElectronSecureStorage(), computerId: settings.getDeviceId() });
  const st = await store.open();
  const keyId = JSON.parse(req('fs').readFileSync(`${dir}/registry.json`, 'utf8')).keyIds[0];
  const ids = { kay: crypto.randomUUID(), lee: crypto.randomUUID(), mo: crypto.randomUUID(), sam1: crypto.randomUUID(), sam2: crypto.randomUUID(), d1: crypto.randomUUID(), d2: crypto.randomUUID(), d3: crypto.randomUUID(), d4: crypto.randomUUID() };
  const me = settings.getDeviceId();
  const o = (at, extra = {}) => ({ origin: { computerId: me, operatorId: null, workflow: 'event-import', ...extra }, at });
  const dig = (s) => crypto.createHash('sha256').update(`q5d-live|${s}`).digest('hex');
  const idf = (ns, s) => [{ ns, keyId, digest: dig(s), trusted: true }];
  const r = await store.appendEvents([
    createEvent('photographer-registered', { photographerId: ids.kay, name: 'Testa Kay', idOrigin: 'random' }, o('2026-09-01T00:00:00Z')),
    createEvent('photographer-registered', { photographerId: ids.lee, name: 'Testa Lee', idOrigin: 'random' }, o('2026-09-01T00:00:01Z')),
    createEvent('photographer-registered', { photographerId: ids.mo, name: 'Testa Mo', idOrigin: 'random' }, o('2026-09-01T00:00:02Z')),
    createEvent('photographer-registered', { photographerId: ids.sam1, name: 'Testa Same', idOrigin: 'random' }, o('2026-09-02T00:00:00Z')),
    createEvent('photographer-registered', { photographerId: ids.sam2, name: 'Testa Same', idOrigin: 'random' }, o('2026-09-03T00:00:00Z', { computerId: 'fake-computer-q5d-other' })),
    createEvent('device-registered', { deviceId: ids.d1, make: 'Canon', modelKey: 'canon eos r5', modelDisplay: 'EOS R5', identifiers: idf('exif.bodySerial', serials[0]) }, o('2026-10-01T00:00:00Z')),
    createEvent('device-registered', { deviceId: ids.d2, make: 'SONY', modelKey: 'ilce-7m3', modelDisplay: 'ILCE-7M3', identifiers: idf('sony.internal', serials[1]) }, o('2026-10-01T00:00:01Z')),
    createEvent('device-registered', { deviceId: ids.d3, make: 'Nikon', modelKey: 'z 8', modelDisplay: 'Z 8', identifiers: idf('nikon.serial', serials[2]) }, o('2026-10-01T00:00:02Z')),
    createEvent('device-registered', { deviceId: ids.d4, make: 'Nikon', modelKey: 'z 8', modelDisplay: 'Z 8', identifiers: idf('nikon.serial', serials[2]) }, o('2026-10-01T00:00:03Z', { computerId: 'fake-computer-q5d-other' })),
    createEvent('import-observed', { importId: 'imp-fakeq5dlive-1', photographerId: ids.kay, deviceId: ids.d1, fileCount: 5, day: '2026-10-02' }, o('2026-10-02T00:00:00Z')),
    createEvent('import-observed', { importId: 'imp-fakeq5dlive-2', photographerId: ids.lee, deviceId: ids.d2, fileCount: 5, day: '2026-10-03' }, o('2026-10-03T00:00:00Z')),
    createEvent('import-observed', { importId: 'imp-fakeq5dlive-3', photographerId: ids.mo, deviceId: ids.d3, fileCount: 2, day: '2026-10-04' }, o('2026-10-04T00:00:00Z')),
    createEvent('association-confirmed', { photographerId: ids.lee, deviceId: ids.d2, resolves: [] }, o('2026-10-06T10:00:00Z', { workflow: 'registry' })),
    createEvent('association-confirmed', { photographerId: ids.kay, deviceId: ids.d2, resolves: [] }, o('2026-10-07T10:00:00Z', { computerId: 'fake-computer-q5d-other', workflow: 'registry' })),
    createEvent('association-rejected', { photographerId: ids.kay, deviceId: ids.d2, resolves: [] }, o('2026-10-07T11:00:00Z', { workflow: 'registry' })),
  ]);
  await store.close();
  return { ok: st.state === 'ready' && st.bodyMatching && r.ok, ids, keyId, digests: serials.map(dig) };
}, { root: PROJECT_ROOT, serials: SERIALS });

const registryEvents = (ud) => JSON.parse(fs.readFileSync(path.join(ud, 'identity-registry', 'registry.json'), 'utf8')).events;

function ownFiles(ud) {
  const out = {};
  for (const f of ['users.json', 'photographers.override.json', 'photographers.aliases.json']) {
    const p = path.join(ud, f);
    if (fs.existsSync(p)) out[f] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  }
  return out;
}

const openTab = async (main) => {
  await main.evaluate(() => {
    const tile = document.getElementById('ovMetadataSync');
    if (tile && tile.offsetParent) tile.click(); else openMetadataSyncModal();
  });
  await main.waitForSelector('#metadataSyncModal.open', { timeout: 10000 });
  await main.click('#msTab-photographers');
  await main.waitForFunction(() => !document.getElementById('msTabPhotographers').hasAttribute('aria-busy') && document.querySelectorAll('#prList .pr-row, #prList .pr-list-empty').length > 0, null, { timeout: 15000 });
  await main.waitForTimeout(300);
};
const closeModal = (main) => main.evaluate(() => document.getElementById('msCloseFooterBtn').click());
const shot = async (main, name) => {
  if (!SHOTS) return;
  await main.waitForTimeout(250);
  const b64 = await shot.app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().endsWith('index.html'));
    return (await w.webContents.capturePage()).toPNG().toString('base64');
  });
  fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'));
};
const setTheme = (main, t) => main.evaluate((th) => document.documentElement.setAttribute('data-theme', th), t);
const view = async (main, v) => { await main.click(`[data-pr-view="${v}"]`); await main.waitForTimeout(350); };
const clickRow = (main, name) => main.evaluate((n) => {
  const row = [...document.querySelectorAll('#prList .pr-row')].find(r => r.querySelector('.pr-row-title').textContent === n);
  if (row) row.click();
  return !!row;
}, name);
const waitDetail = (main, title) => main.waitForFunction((t) => (document.querySelector('#prDetail .pr-detail-title') || {}).textContent === t, title, { timeout: 8000 });
const openCamera = async (main, title) => { await view(main, 'cameras'); check(await clickRow(main, title), `camera "${title}" listed`); await waitDetail(main, title); await main.waitForTimeout(150); };
/** Actions drawn for one photographer row of the open camera. */
const rowActions = (main, name) => main.evaluate((n) => {
  const row = [...document.querySelectorAll('#prDetail .pr-assoc-row')].find(r => r.querySelector('.pr-assoc-top').textContent.startsWith(n));
  return row ? [...row.querySelectorAll('.pr-action')].map(b => b.textContent) : null;
}, name);
const clickAction = (main, name, label) => main.evaluate(({ n, l }) => {
  const row = [...document.querySelectorAll('#prDetail .pr-assoc-row')].find(r => r.querySelector('.pr-assoc-top').textContent.startsWith(n));
  const b = row && [...row.querySelectorAll('.pr-action')].find(x => x.textContent === l);
  if (b) b.click();
  return !!b;
}, { n: name, l: label });
const clickButton = (main, scope, label) => main.evaluate(({ s, l }) => {
  const b = [...document.querySelectorAll(`${s} button`)].find(x => x.textContent === l && !x.disabled);
  if (b) b.click();
  return !!b;
}, { s: scope, l: label });
const waitPreview = (main) => main.waitForFunction(() => { const p = document.querySelector('#prDetail .pr-decision'); return p && !p.hasAttribute('aria-busy') && (p.querySelector('.pr-change') || p.querySelector('.pr-decision-error')); }, null, { timeout: 8000 });
const previewText = (main) => main.evaluate(() => document.querySelector('#prDetail .pr-decision')?.innerText || '');
const waitResult = (main) => main.waitForFunction(() => !!document.querySelector('#prDetail .pr-result'), null, { timeout: 10000 }).then(() => main.evaluate(() => ({ text: document.querySelector('#prDetail .pr-result').textContent, ok: document.querySelector('#prDetail .pr-result').classList.contains('pr-result--ok'), focused: document.activeElement === document.querySelector('#prDetail .pr-result') })));
const saveDecision = async (main) => { check(await clickButton(main, '#prDetail .pr-decision', 'Confirm and save'), '"Confirm and save" pressed'); return waitResult(main); };
const pick = async (main, query, name) => {
  await main.fill('#prDetail .pr-decision .pr-search', query);
  await main.waitForFunction((n) => [...document.querySelectorAll('#prDetail .pr-picker-option')].some(o => o.textContent === n), name, { timeout: 5000 });
  await main.evaluate((n) => [...document.querySelectorAll('#prDetail .pr-picker-option')].find(o => o.textContent === n).click(), name);
};
const chooseRadio = (main, startsWith) => main.evaluate((t) => {
  const l = [...document.querySelectorAll('#prDetail .pr-choice-option')].find(x => x.textContent.startsWith(t));
  if (l) l.querySelector('input').click();
  return !!l;
}, startsWith);

(async () => {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-q5d-live-'));
  const ud = path.join(work, 'userData');
  const stubFile = path.join(work, 'preload.js');
  const drivesFile = path.join(work, 'drives.json');
  await fsp.mkdir(ud, { recursive: true });
  await fsp.writeFile(stubFile, PRELOAD);
  await fsp.mkdir(path.join(work, 'wrapper-app'), { recursive: true });
  await fsp.writeFile(path.join(work, 'wrapper-app', 'package.json'), JSON.stringify({ name: TEST_PKG_NAME, version: require(path.join(PROJECT_ROOT, 'package.json')).version, main: 'index.js' }));
  await fsp.writeFile(path.join(work, 'wrapper-app', 'index.js'), WRAPPER_INDEX);
  fs.writeFileSync(drivesFile, '[]');
  fs.writeFileSync(path.join(ud, 'photographers.override.json'), JSON.stringify(NAMES));
  if (SHOTS) await fsp.mkdir(SHOTS, { recursive: true });
  const prodBefore = ['auto-ingest Safe Storage', 'AutoIngest Safe Storage'].map(keychainHas);
  check(!keychainHas(KEYCHAIN_ITEM), 'no leftover test Keychain item before the run');

  let app, main, seeded;
  const payloads = [];
  try {
    // ── Session 1: registry created in the isolated app, decisions through the UI ──
    ({ app, main } = await launch(work, ud, drivesFile, stubFile));
    shot.app = app;
    check(await app.evaluate(({ app: a }) => a.getName()) === TEST_PKG_NAME, `isolated app identity (${TEST_PKG_NAME})`);
    await settleStartup(ud);
    seeded = await seedInApp(app);
    check(seeded.ok, 'synthetic registry created inside the isolated app (real store, test-identity safeStorage, body matching on)');
    const operator = JSON.parse(fs.readFileSync(path.join(ud, 'users.json'), 'utf8')).find(u => u.name === 'Q5d Operator');
    check(!!operator, 'operator profile created on the splash');
    // Pre-existing: creating the first profile on the splash does not make it active (no
    // setActiveUser call). Select it through the same IPC the splash's "select" screen uses.
    await main.evaluate((id) => window.api.setActiveUser(id), operator.id);
    const filesBeforeDecisions = ownFiles(ud);

    await setTheme(main, 'dark');
    await openTab(main);
    await openCamera(main, 'Canon EOS R5');
    check(JSON.stringify(await rowActions(main, 'Testa Kay')) === JSON.stringify(['Confirm', 'Not this photographer', 'No longer associated', 'Correct association']), 'observed association: Confirm / Not this photographer / No longer associated / Correct association');
    check(await main.evaluate(() => [...document.querySelectorAll('#prDetail .pr-action')].some(b => b.textContent === 'Add photographer' || b.textContent === 'Add another photographer')), 'camera offers adding a photographer');
    await shot(main, '01-camera-actions-dark');

    // Confirm
    check(await clickAction(main, 'Testa Kay', 'Confirm'), 'Confirm opens the decision panel');
    await waitPreview(main);
    const pv1 = await previewText(main);
    check(/Confirm that this camera is associated with this photographer\?/.test(pv1) && /Canon EOS R5/.test(pv1), 'preview: question and camera');
    check(/Testa Kay\s+Observed\s+Confirmed/.test(pv1), 'preview: photographer, current state and proposed state');
    check(/AutoIngest may suggest this photographer.*operator still makes the final selection/s.test(pv1), 'preview: consequence for future suggestions');
    check(/does not prove who took a particular photo/.test(pv1) && /Recorded as Q5d Operator/.test(pv1), 'preview: attribution caveat and operator');
    const focusOnSave = await main.evaluate(() => document.activeElement && document.activeElement.textContent);
    check(focusOnSave === 'Confirm and save', 'keyboard focus moves to "Confirm and save"');
    await shot(main, '02-confirm-preview-dark');
    const n0 = registryEvents(ud).length;
    await main.evaluate(() => { window.__gaps = []; let last = performance.now(); const tick = (t) => { window.__gaps.push(t - last); last = t; if (window.__gaps.length < 200) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    const r1 = await saveDecision(main);
    check(r1.ok && r1.text === 'Saved. Canon EOS R5 is confirmed for Testa Kay.' && r1.focused, `success message after durable save (${r1.text})`);
    const maxGap = await main.evaluate(() => Math.max(...window.__gaps));
    check(maxGap < 250, `window responsive while saving (longest frame gap ${Math.round(maxGap)} ms)`);
    const ev1 = registryEvents(ud);
    const last1 = ev1[ev1.length - 1];
    check(ev1.length === n0 + 1 && last1.type === 'association-confirmed' && last1.photographerId === seeded.ids.kay && last1.deviceId === seeded.ids.d1, 'registry.json on disk holds exactly the confirmation');
    check(last1.origin.operatorId === operator.id && last1.origin.workflow === 'registry' && typeof last1.origin.computerId === 'string', 'provenance: active operator, this computer, registry workflow');
    const hist1 = await main.evaluate(() => document.getElementById('prDetail').innerText);
    check(/Confirmed\s*Confirmed for Testa Kay/.test(hist1) && /Q5d Operator/.test(hist1), 'history shows the confirmation with the operator');

    // Shared camera: add another photographer (Kay stays)
    check(await clickButton(main, '#prDetail', 'Add another photographer'), 'Add another photographer opens');
    await pick(main, 'Testa M', 'Testa Mo');
    check(await clickButton(main, '#prDetail .pr-decision', 'Review'), 'Review after choosing a photographer');
    await waitPreview(main);
    const pv2 = await previewText(main);
    check(/Add another photographer to this camera\?/.test(pv2) && /already associated with this camera stay associated/.test(pv2), 'shared-camera preview keeps the existing photographer');
    const r2 = await saveDecision(main);
    check(r2.ok, `shared camera saved (${r2.text})`);
    const people2 = await main.evaluate(() => [...document.querySelectorAll('#prDetail .pr-assoc-top')].map(r => r.textContent));
    check(people2.some(t => /^Testa Kay.*Confirmed/.test(t)) && people2.some(t => /^Testa Mo.*Confirmed/.test(t)), 'both photographers confirmed; Kay untouched');

    // Correction Kay → Lee (Kay "used it before")
    await setTheme(main, 'light');
    check(await clickAction(main, 'Testa Kay', 'Correct association'), 'Correct association opens');
    await pick(main, 'Testa L', 'Testa Lee');
    check(await chooseRadio(main, 'Testa Kay used it before'), 'operator chooses what happened with Testa Kay');
    await shot(main, '03-correction-choose-light');
    check(await clickButton(main, '#prDetail .pr-decision', 'Review'), 'Review the correction');
    await waitPreview(main);
    const pv3 = await previewText(main);
    check(/Testa Kay\s+Confirmed\s+No longer used/.test(pv3) && /Testa Lee\s+No association\s+Confirmed/.test(pv3), 'correction preview shows both associations and both changes');
    await shot(main, '04-correction-preview-light');
    const n3 = registryEvents(ud).length;
    const r3 = await saveDecision(main);
    check(r3.ok && /now confirmed for Testa Lee instead of Testa Kay/.test(r3.text), `correction saved (${r3.text})`);
    const ev3 = registryEvents(ud).slice(n3);
    check(ev3.length === 2 && ev3[0].type === 'association-retired' && ev3[1].type === 'association-confirmed' && ev3[0].at === ev3[1].at, 'correction = retirement + confirmation appended together');
    check(ev3[0].resolves.length === 1 && ev3[0].resolves[0] === last1.eventId, 'the retirement settles exactly the confirmation shown');
    const hist3 = await main.evaluate(() => [...document.querySelectorAll('#prDetail .pr-history-what')].map(e => e.textContent));
    check(hist3.some(t => /^CorrectionCorrected: marked as no longer used by Testa Kay and confirmed for Testa Lee$/.test(t)) && hist3.some(t => /^ConfirmedConfirmed for Testa Kay$/.test(t)), 'history: one correction row, original confirmation still visible');
    await shot(main, '05-after-correction-light');
    await setTheme(main, 'dark');

    // Escape closes only the decision panel
    await clickAction(main, 'Testa Lee', 'Not this photographer');
    await waitPreview(main);
    await main.focus('#prDetail .pr-decision .emm-btn-primary');
    await main.keyboard.press('Escape');
    await main.waitForTimeout(250);
    const esc = await main.evaluate(() => ({ panel: !!document.querySelector('#prDetail .pr-decision'), modal: document.getElementById('metadataSyncModal').classList.contains('open') }));
    check(!esc.panel && esc.modal, 'Escape cancels the decision panel; the modal stays open');

    // Stale revision: something else changes this camera between preview and save
    await clickAction(main, 'Testa Lee', 'Not this photographer');
    await waitPreview(main);
    const appended = await app.evaluate(async (_e, { root, d1, mo }) => {
      const req = global.__aiTestRequire;
      const rt = req(`${root}/services/photographerLearningRuntime`);
      const { createEvent } = req(`${root}/services/identityEvents`);
      const o = await rt.openRegistryForManagement();
      if (!o.ok) return o.reason;
      const r = await o.store.appendEvents([createEvent('import-observed', { importId: 'imp-fakeq5dlive-late', photographerId: mo, deviceId: d1, fileCount: 1, day: '2026-11-02' }, { origin: { computerId: 'fake-computer-q5d-other', operatorId: null, workflow: 'event-import' }, at: '2026-11-02T00:00:00Z' })]);
      return r.ok ? 'ok' : r.reason;
    }, { root: PROJECT_ROOT, d1: seeded.ids.d1, mo: seeded.ids.mo });
    check(appended === 'ok', 'a concurrent observation lands on the same camera (shared store)');
    const n4 = registryEvents(ud).length;
    const r4 = await saveDecision(main);
    check(!r4.ok && /registry changed since this was shown/.test(r4.text), `stale decision refused with refresh-and-review (${r4.text})`);
    check(registryEvents(ud).length === n4, 'nothing appended by the refused decision');
    check(await main.evaluate(() => (document.querySelector('#prDetail .pr-detail-title') || {}).textContent === 'Canon EOS R5'), 'refreshed camera shown again for review');
    await shot(main, '06-stale-refused-dark');

    // Review queue: disputed confirmation, overlapping camera records, same-name records
    await view(main, 'review');
    const titles = await main.evaluate(() => [...document.querySelectorAll('#prList .pr-row-title')].map(e => e.textContent));
    check(titles.includes('Camera confirmation disputed') && titles.includes('Camera records overlap') && titles.includes('Same name, different photographer records'), `review queue (${titles.join('; ')})`);
    await clickRow(main, 'Camera confirmation disputed');
    await waitDetail(main, 'Camera confirmation disputed');
    check(await clickButton(main, '#prDetail', 'Not this photographer'), 'resolve option offered for the dispute');
    await waitPreview(main);
    check(/Settle this review item\?/.test(await previewText(main)), 'dispute preview');
    await shot(main, '07-review-resolve-dark');
    const r5 = await saveDecision(main);
    check(r5.ok, `dispute settled (${r5.text})`);
    const last5 = registryEvents(ud).slice(-1)[0];
    check(last5.type === 'association-rejected' && last5.resolves.length === 2, 'settling decision lists both disagreeing decisions in resolves');

    await clickRow(main, 'Camera records overlap');
    await waitDetail(main, 'Camera records overlap');
    check(await clickButton(main, '#prDetail', 'Same camera — link the records'), 'link option offered (shared reliable identifier, key available)');
    await waitPreview(main);
    check(/Different camera bodies of the same model are never linked/.test(await previewText(main)), 'link preview explains body distinction');
    const camsBefore = await main.evaluate(() => document.querySelector('[data-pr-view="cameras"] .pr-view-count').textContent);
    const r6 = await saveDecision(main);
    const camsAfter = await main.evaluate(() => document.querySelector('[data-pr-view="cameras"] .pr-view-count').textContent);
    check(r6.ok && Number(camsAfter) === Number(camsBefore) - 1, `camera records linked (${camsBefore} → ${camsAfter} cameras)`);

    await clickRow(main, 'Same name, different photographer records');
    await waitDetail(main, 'Same name, different photographer records');
    const sameNote = await main.evaluate(() => document.getElementById('prDetail').innerText);
    check(/Merging the two records into one person is not available here/.test(sameNote), 'merging people is not offered');
    check(await clickButton(main, '#prDetail', 'Different people — keep separate'), '"different people" offered');
    await waitPreview(main);
    const r7 = await saveDecision(main);
    check(r7.ok, `same-name records recorded as different people (${r7.text})`);
    const left = await main.evaluate(() => [...document.querySelectorAll('#prList .pr-row-title')].map(e => e.textContent));
    check(!left.includes('Camera confirmation disputed') && !left.includes('Camera records overlap') && !left.includes('Same name, different photographer records'), `settled items leave the queue (${left.join('; ') || 'empty'})`);
    const amb = left.includes('Name matches several photographers');
    if (amb) {
      await clickRow(main, 'Name matches several photographers');
      await waitDetail(main, 'Name matches several photographers');
      const t = await main.evaluate(() => ({ text: document.getElementById('prDetail').innerText, actions: document.querySelectorAll('#prDetail .pr-action').length }));
      check(t.actions === 0 && /changes photographer names, which is not available yet/.test(t.text), 'naming conflicts stay read-only with an explanation');
    }

    // Narrow / short layout with a decision panel open
    await openCamera(main, 'Canon EOS R5');
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().endsWith('index.html')); w.setSize(1100, 700); w.webContents.setZoomFactor(1.3); });
    await main.waitForTimeout(700);
    await clickAction(main, 'Testa Lee', 'Correct association');
    await main.waitForTimeout(300);
    await main.evaluate(() => document.querySelector('#prDetail .pr-decision').scrollIntoView({ block: 'end' }));
    await main.waitForTimeout(250);
    const narrow = await main.evaluate(() => {
      const r = (e) => e.getBoundingClientRect();
      const d = document.getElementById('prDetail'), p = document.querySelector('#prDetail .pr-decision');
      const btns = [...p.querySelectorAll('.pr-decision-buttons button')];
      return {
        inside: r(p).left >= r(d).left - 1 && r(p).right <= r(d).right + 1,
        buttonsVisible: btns.length === 2 && btns.every(b => r(b).bottom <= r(d).bottom + 1 && r(b).top >= r(d).top - 1 && b.scrollWidth <= b.clientWidth + 1),
        hscroll: d.scrollWidth > d.clientWidth + 1,
        footer: r(document.getElementById('msCloseFooterBtn')).bottom <= innerHeight,
      };
    });
    check(narrow.inside && narrow.buttonsVisible && !narrow.hscroll && narrow.footer, `narrow/short (zoom 1.3): panel fits, buttons reachable, no horizontal scroll, footer visible (${JSON.stringify(narrow)})`);
    await shot(main, '08-narrow-decision-dark');
    await setTheme(main, 'light');
    await shot(main, '09-narrow-decision-light');
    await setTheme(main, 'dark');
    await main.keyboard.press('Escape');
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().endsWith('index.html')); w.webContents.setZoomFactor(1); w.setSize(1440, 900); });
    await main.waitForTimeout(400);
    await shot(main, '10-desktop-camera-dark');

    // IPC: privacy of every decision payload; forged/unknown input; other windows refused
    const ipc = await main.evaluate(async () => {
      const out = [];
      const ov = await window.api.photographerRegistryLoad();
      out.push(ov);
      const cam = ov.cameras.find(c => c.make === 'SONY');
      const det = await window.api.photographerRegistryCamera(cam.handle);
      out.push(det);
      const lee = det.camera.associations.find(a => a.photographer.name === 'Testa Lee');
      const prep = await window.api.photographerRegistryPrepare({ action: 'retire', camera: cam.handle, photographer: lee.photographer.handle, operatorId: 'forged', photographerId: 'forged' });
      out.push(prep);
      out.push(await window.api.photographerRegistryCancel(prep.token));
      out.push(await window.api.photographerRegistryCommit(prep.token));
      out.push(await window.api.photographerRegistryPrepare({ action: 'rename', camera: cam.handle }));
      out.push(await window.api.photographerRegistryPrepare({ action: 'confirm', camera: 'c-0000000000000000', photographer: 'p-0000000000000000' }));
      out.push(await window.api.photographerRegistryCommit({ token: 'x' }));
      return out;
    });
    payloads.push(...ipc);
    check(ipc[2].ok && !('revision' in ipc[2]) && ipc[2].operator === 'Q5d Operator', 'prepare returns a preview and an opaque token only');
    check(ipc[4].reason === 'expired-confirmation', 'a cancelled confirmation cannot be committed');
    check(ipc[5].reason === 'unsupported-action' && ipc[6].reason === 'stale-view' && ipc[7].reason === 'invalid-request', 'unsupported action, unknown handles and malformed tokens refused');
    const denied = await app.evaluate(async ({ BrowserWindow }, root) => {
      const w = new BrowserWindow({ show: false, webPreferences: { preload: root + '/main/preload.js', contextIsolation: true, sandbox: false } });
      await w.loadURL('data:text/html,<p>q5d</p>');
      const r = await w.webContents.executeJavaScript('Promise.all([window.api.photographerRegistryPrepare({ action: "confirm" }), window.api.photographerRegistryCommit("t-000000000000000000000000"), window.api.photographerRegistryCancel("t-000000000000000000000000")])');
      w.destroy();
      return r;
    }, PROJECT_ROOT);
    check(denied.every(r => r && r.ok === false && r.reason === 'not-permitted'), 'decision requests from any other window are refused');
    const popupApi = await app.evaluate(async ({ BrowserWindow }, root) => {
      const w = new BrowserWindow({ show: false, webPreferences: { preload: root + '/main/companionPreload.js', contextIsolation: true, sandbox: false } });
      await w.loadURL('data:text/html,<p>popup</p>');
      const r = await w.webContents.executeJavaScript('JSON.stringify({ companion: Object.keys(window.companion || {}), api: typeof window.api })');
      w.destroy();
      return JSON.parse(r);
    }, PROJECT_ROOT);
    check(!popupApi.companion.some(k => /registry|photographer/i.test(k)) && popupApi.api === 'undefined', 'the companion popup preload exposes no registry channel');

    // Missing operator: no controls, prepare refused
    await app.evaluate(async (_e, root) => { await global.__aiTestRequire(`${root}/services/settings`).setLastActiveUserId(null); }, PROJECT_ROOT);
    await closeModal(main);
    await openTab(main);
    await openCamera(main, 'SONY ILCE-7M3');
    const noOp = await main.evaluate(() => ({ actions: document.querySelectorAll('#prDetail .pr-action').length, text: document.getElementById('prDetail').innerText }));
    check(noOp.actions === 0 && /Select the active operator in AutoIngest to record camera decisions/.test(noOp.text), 'no active operator → explanation, no decision controls');
    await shot(main, '11-no-operator-dark');
    const noOpPrep = await main.evaluate(async () => { const ov = await window.api.photographerRegistryLoad(); return window.api.photographerRegistryPrepare({ action: 'add-photographer', camera: ov.cameras[0].handle }); });
    check(noOpPrep.reason === 'no-operator', 'prepare without an operator refused by the main process');
    await app.evaluate(async (_e, { root, id }) => { await global.__aiTestRequire(`${root}/services/settings`).setLastActiveUserId(id); }, { root: PROJECT_ROOT, id: operator.id });
    await closeModal(main);
    const filesAfter = ownFiles(ud);
    check(filesAfter['photographers.override.json'] === filesBeforeDecisions['photographers.override.json'] && filesAfter['photographers.aliases.json'] === filesBeforeDecisions['photographers.aliases.json'], 'photographer list and learned shortcuts unchanged by decisions');
    const touched = fs.readdirSync(ud).filter(f => /event|archive|staging|import/i.test(f));
    check(touched.length === 0, `no archive, event or import data written (${touched.join(', ') || 'none'})`);
    await app.close(); app = null;

    // ── Session 2: restart with learning off and a lock held elsewhere ─────────────
    const sPath = path.join(ud, 'settings.json');
    fs.writeFileSync(sPath, JSON.stringify({ ...JSON.parse(fs.readFileSync(sPath, 'utf8')), photographerLearningEnabled: false }, null, 2));
    fs.writeFileSync(path.join(ud, 'identity-registry', 'registry.lock'), JSON.stringify({ pid: process.pid, token: 'q5d-live-other', at: new Date().toISOString() }));
    ({ app, main } = await launch(work, ud, drivesFile, stubFile));
    shot.app = app;
    await settleStartup(ud);
    await openTab(main);
    const st2 = await main.evaluate(() => document.getElementById('prStatus').textContent);
    check(/Photographer learning is turned off/.test(st2) && /Another AutoIngest process is updating the registry/.test(st2), 'learning off and registry locked are both explained');
    await openCamera(main, 'Canon EOS R5');
    const persisted = await main.evaluate(() => [...document.querySelectorAll('#prDetail .pr-history-what')].map(e => e.textContent));
    check(persisted.some(t => /^Correction/.test(t)) && persisted.some(t => /^ConfirmedConfirmed for Testa Mo/.test(t)), 'decisions persisted across the restart, with history');
    const lockedNote = await main.evaluate(() => ({ actions: document.querySelectorAll('#prDetail .pr-action').length, text: document.getElementById('prDetail').innerText }));
    check(lockedNote.actions === 0 && /Another AutoIngest process is updating the registry/.test(lockedNote.text), 'locked registry → no decision controls');
    fs.unlinkSync(path.join(ud, 'identity-registry', 'registry.lock'));
    await closeModal(main);
    await openTab(main);
    await openCamera(main, 'SONY ILCE-7M3');
    const nL = registryEvents(ud).length;
    check(await clickAction(main, 'Testa Lee', 'No longer associated'), 'decisions available again once the lock is released (learning still off)');
    await waitPreview(main);
    const r8 = await saveDecision(main);
    check(r8.ok && registryEvents(ud).length === nL + 1, `manual decision recorded with learning off (${r8.text})`);
    await closeModal(main);

    // Corrupt registry: no controls, file left exactly as found
    const good = fs.readFileSync(path.join(ud, 'identity-registry', 'registry.json'));
    await app.close(); app = null;
    fs.writeFileSync(path.join(ud, 'identity-registry', 'registry.json'), '{ damaged');
    ({ app, main } = await launch(work, ud, drivesFile, stubFile));
    shot.app = app;
    await settleStartup(ud);
    await openTab(main);
    const corrupt = await main.evaluate(async () => {
      const ov = await window.api.photographerRegistryLoad();
      return { reason: ov.management && ov.management.reason, text: document.getElementById('prStatus').textContent, cameras: ov.cameras.length };
    });
    check(corrupt.reason === 'registry-corrupt' && /could not be read as a valid registry/.test(corrupt.text) && corrupt.cameras === 0, 'corrupt registry → decisions unavailable, nothing offered');
    await closeModal(main);
    check(fs.readFileSync(path.join(ud, 'identity-registry', 'registry.json'), 'utf8') === '{ damaged', 'corrupt registry neither replaced nor reset');
    await app.close(); app = null;
    fs.writeFileSync(path.join(ud, 'identity-registry', 'registry.json'), good);

    const text = JSON.stringify(payloads);
    const leaks = [...SERIALS, ...seeded.digests, seeded.keyId, 'fake-computer-q5d', 'imp-fakeq5dlive', operator.id, ud, ...Object.values(seeded.ids)].filter(s => text.includes(s));
    check(leaks.length === 0 && !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text) && !/[0-9a-f]{64}/.test(text), 'decision payloads carry no serial, digest, key ID, computer/operator ID, import ID, path or UUID');
    const prodAfter = ['auto-ingest Safe Storage', 'AutoIngest Safe Storage'].map(keychainHas);
    check(JSON.stringify(prodAfter) === JSON.stringify(prodBefore), 'production Keychain items untouched (presence unchanged)');
  } catch (err) {
    failures++; log('FAIL — exception:', err.stack || err.message);
  } finally {
    if (app) await app.close().catch(() => {});
    if (keychainHas(KEYCHAIN_ITEM)) { try { execFileSync('security', ['delete-generic-password', '-s', KEYCHAIN_ITEM], { stdio: 'ignore' }); } catch { /* ignore */ } }
    check(!keychainHas(KEYCHAIN_ITEM), 'test Keychain item removed after the run');
    await fsp.rm(path.join(os.homedir(), 'Library', 'Logs', TEST_PKG_NAME), { recursive: true, force: true }).catch(() => {});
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
    process.exit(failures ? 1 : 0);
  }
})();
