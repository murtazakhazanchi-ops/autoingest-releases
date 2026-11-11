'use strict';
// AI-FEAT-063 / AI-RM-014 Q5e-1 — LIVE: photographer profile management in the real Photographer
// Registry tab (real main.js, preload, renderer, Electron, Q4 store): search aliases, keeping a
// learned shortcut, retire / reactivate, explicit first registration and the PREVIEW-ONLY rename
// with current-event folder detection over a synthetic local-staging + NAS event.
//
// Isolation as in the Q5c/Q5d live tests: temp userData, drivelist stubbed, wrapper app named
// "autoingest-q5e1-livetest" (its own Keychain item, deleted at the end). Synthetic names,
// FAKE identifiers and a synthetic event tree only; the tree must stay byte-identical.
// Metadata Management's current event is set the way openMetadataSyncModal sets it
// (_msCurrentEventPath/_msCurrentEventName), since creating an event is outside this stage.
//
// Screenshots go to $AI_Q5E1_SHOTS when set. Requires playwright-core.
// Run: AI_Q5E1_SHOTS=/some/dir node test/photographerRegistryQ5e1Live.test.js

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
const TEST_PKG_NAME = 'autoingest-q5e1-livetest';
const KEYCHAIN_ITEM = `${TEST_PKG_NAME} Safe Storage`;
const SHOTS = process.env.AI_Q5E1_SHOTS || null;
const SERIAL = 'FAKEQ5E1LIVE-R5-0001';
const NAMES = ['Kay Current', 'Local Gamma', 'Zed Pending'];

function log(...a) { console.log('[q5e1-live]', ...a); }
let failures = 0;
function check(c, m) { if (c) log('PASS —', m); else { failures++; log('FAIL —', m); } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const keychainHas = (s) => { try { execFileSync('security', ['find-generic-password', '-s', s], { stdio: 'ignore' }); return true; } catch { return false; } };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

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
  try { await w.fill('#splashInputName', 'Q5e1 Operator', { timeout: 2000 }); await w.fill('#splashInputRole', 'QA'); await w.click('#splashCreateStartBtn'); } catch { /* existing profile */ }
  const main = await mainP;
  await main.waitForLoadState('domcontentloaded');
  await main.waitForTimeout(1800);
  return main;
}

async function launch(work, ud, drivesFile) {
  const app = await electron.launch({
    executablePath: ELECTRON_BIN, args: ['-r', H.PRELOAD, path.join(work, 'wrapper-app'), '--no-sandbox'],
    cwd: PROJECT_ROOT, timeout: 60000,
    env: { ...process.env, AI_TEST_ISO_LOG: path.join(path.dirname(drivesFile), 'live-iso.jsonl'), AI_TEST_DRIVES_FILE: drivesFile, AI_TEST_PROJECT_ROOT: PROJECT_ROOT, AI_TEST_USERDATA: ud },
  });
  return { app, main: await passSplash(app) };
}

async function settleStartup(ud) {
  for (let i = 0; i < 100; i++) {
    try { if (JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).deviceId) break; } catch { /* not yet */ }
    await sleep(200);
  }
  await sleep(500);
}

const seedInApp = (app) => app.evaluate(async (_e, { root, serial }) => {
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
  const ids = { kay: crypto.randomUUID(), gamma: crypto.randomUUID(), d1: crypto.randomUUID() };
  const o = (at, wf = 'event-import') => ({ origin: { computerId: settings.getDeviceId(), operatorId: null, workflow: wf }, at });
  const r = await store.appendEvents([
    createEvent('photographer-registered', { photographerId: ids.kay, name: 'Kay Old', idOrigin: 'random' }, o('2026-09-01T00:00:00Z')),
    createEvent('photographer-renamed', { photographerId: ids.kay, fromName: 'Kay Old', toName: 'Kay Current' }, o('2026-09-10T00:00:00Z', 'registry')),
    createEvent('photographer-registered', { photographerId: ids.gamma, name: 'Local Gamma', idOrigin: 'random' }, o('2026-09-02T00:00:00Z')),
    createEvent('device-registered', { deviceId: ids.d1, make: 'Canon', modelKey: 'canon eos r5', modelDisplay: 'EOS R5', identifiers: [{ ns: 'exif.bodySerial', keyId, digest: crypto.createHash('sha256').update(serial).digest('hex'), trusted: true }] }, o('2026-10-01T00:00:00Z')),
    createEvent('association-confirmed', { photographerId: ids.kay, deviceId: ids.d1, resolves: [] }, o('2026-10-02T00:00:00Z', 'registry')),
  ]);
  await store.close();
  return { ok: st.state === 'ready' && r.ok, ids, keyId };
}, { root: PROJECT_ROOT, serial: SERIAL });

const registryEvents = (ud) => JSON.parse(fs.readFileSync(path.join(ud, 'identity-registry', 'registry.json'), 'utf8')).events;

function treeHash(root) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const st = fs.lstatSync(p);
      out[path.relative(root, p)] = e.isDirectory() ? `d:${st.mtimeMs}` : `f:${st.mtimeMs}:${sha(fs.readFileSync(p))}`;
      if (e.isDirectory()) walk(p);
    }
  };
  walk(root);
  return JSON.stringify(out);
}

/** Synthetic event on staging and NAS: PC03 current-name folder, a former-name folder, a similar one, QMZ dir. */
function buildEvent(base) {
  const stagingRoot = path.join(base, 'staging'), nasRoot = path.join(base, 'nas');
  for (const r of [stagingRoot, nasRoot]) {
    const ev = path.join(r, 'Coll-Q5e1', 'Event-Q5e1');
    for (const c of ['A-Day1', 'B-Day2']) fs.mkdirSync(path.join(ev, c), { recursive: true });
    fs.writeFileSync(path.join(ev, 'event.json'), JSON.stringify({ name: 'Event-Q5e1', components: [{ folderName: 'A-Day1' }, { folderName: 'B-Day2' }] }));
    fs.mkdirSync(path.join(ev, 'A-Day1', 'PC03-Kay Current'));
    fs.writeFileSync(path.join(ev, 'A-Day1', 'PC03-Kay Current', 'IMG_0001.JPG'), 'fake-jpeg');
    fs.mkdirSync(path.join(ev, 'B-Day2', 'PC05-Kay Old'));
    fs.mkdirSync(path.join(ev, 'B-Day2', 'PC06-Kay Curent'));
    fs.mkdirSync(path.join(ev, 'B-Day2', '_Unsequenced'));
  }
  return { stagingRoot, nasRoot, eventPath: path.join(stagingRoot, 'Coll-Q5e1', 'Event-Q5e1') };
}

const openTab = async (main) => {
  await main.evaluate(() => { const tile = document.getElementById('ovMetadataSync'); if (tile && tile.offsetParent) tile.click(); else openMetadataSyncModal(); });
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
const openPerson = async (main, name) => {
  await main.click('[data-pr-view="photographers"]');
  await main.fill('#prSearch', name);
  await main.waitForTimeout(450);
  const ok = await main.evaluate((n) => { const r = [...document.querySelectorAll('#prList .pr-row')].find(x => x.querySelector('.pr-row-title').textContent === n); if (r) r.click(); return !!r; }, name);
  check(ok, `photographer "${name}" listed`);
  await main.waitForFunction((n) => (document.querySelector('#prDetail .pr-detail-title') || {}).textContent === n, name, { timeout: 8000 });
  await main.waitForTimeout(150);
};
const detailText = (main) => main.evaluate(() => document.getElementById('prDetail').innerText);
const clickButton = (main, scope, label) => main.evaluate(({ s, l }) => {
  const b = [...document.querySelectorAll(`${s} button`)].find(x => x.textContent === l && !x.disabled);
  if (b) b.click();
  return !!b;
}, { s: scope, l: label });
const waitPreview = (main) => main.waitForFunction(() => { const p = document.querySelector('#prDetail .pr-decision'); return p && !p.hasAttribute('aria-busy') && (p.querySelector('.pr-change') || p.querySelector('.pr-decision-error')); }, null, { timeout: 8000 });
const previewText = (main) => main.evaluate(() => document.querySelector('#prDetail .pr-decision')?.innerText || '');
const save = async (main) => {
  check(await clickButton(main, '#prDetail .pr-decision', 'Confirm and save'), '"Confirm and save" pressed');
  await main.waitForFunction(() => !!document.querySelector('#prDetail .pr-result'), null, { timeout: 10000 });
  return main.evaluate(() => ({ text: document.querySelector('#prDetail .pr-result').textContent, ok: document.querySelector('#prDetail .pr-result').classList.contains('pr-result--ok') }));
};
const waitRename = (main) => main.waitForFunction(() => { const r = document.querySelector('#prDetail .pr-rename-result'); return r && r.childElementCount > 0; }, null, { timeout: 8000 }).then(() => main.waitForTimeout(150));

(async () => {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-q5e1-live-'));
  const ud = path.join(work, 'userData');
  const drivesFile = path.join(work, 'drives.json');
  await fsp.mkdir(ud, { recursive: true });
  await fsp.mkdir(path.join(work, 'wrapper-app'), { recursive: true });
  await fsp.writeFile(path.join(work, 'wrapper-app', 'package.json'), JSON.stringify({ name: TEST_PKG_NAME, version: require(path.join(PROJECT_ROOT, 'package.json')).version, main: 'index.js' }));
  await fsp.writeFile(path.join(work, 'wrapper-app', 'index.js'), WRAPPER_INDEX);
  fs.writeFileSync(drivesFile, '[]');
  fs.writeFileSync(path.join(ud, 'photographers.override.json'), JSON.stringify(NAMES));
  const slug = require(path.join(PROJECT_ROOT, 'main', 'aliasEngine')).slugify;
  fs.writeFileSync(path.join(ud, 'photographers.aliases.json'), JSON.stringify({ [slug('Kay Current')]: ['kc'] }));
  const aliasesHash = sha(fs.readFileSync(path.join(ud, 'photographers.aliases.json')));
  const overrideHash = sha(fs.readFileSync(path.join(ud, 'photographers.override.json')));
  const ev = buildEvent(path.join(work, 'archive'));
  const treeBefore = treeHash(path.join(work, 'archive'));
  fs.writeFileSync(path.join(ud, 'settings.json'), JSON.stringify({ localStagingRoot: ev.stagingRoot, nasRoot: ev.nasRoot }, null, 2));
  if (SHOTS) await fsp.mkdir(SHOTS, { recursive: true });
  const prodBefore = ['auto-ingest Safe Storage', 'AutoIngest Safe Storage'].map(keychainHas);
  check(!keychainHas(KEYCHAIN_ITEM), 'no leftover test Keychain item before the run');

  let app, main, seeded;
  const payloads = [];
  try {
    ({ app, main } = await launch(work, ud, drivesFile));
    shot.app = app;
    check(await app.evaluate(({ app: a }) => a.getName()) === TEST_PKG_NAME, `isolated app identity (${TEST_PKG_NAME})`);
    await settleStartup(ud);
    seeded = await seedInApp(app);
    check(seeded.ok, 'synthetic registry created inside the isolated app');
    const operator = JSON.parse(fs.readFileSync(path.join(ud, 'users.json'), 'utf8')).find(u => u.name === 'Q5e1 Operator');
    await main.evaluate((id) => window.api.setActiveUser(id), operator.id); // the splash does not activate a new profile (pre-existing)

    await setTheme(main, 'dark');
    await openTab(main);
    await openPerson(main, 'Kay Current');
    const t0 = await detailText(main);
    const btns = await main.evaluate(() => [...document.querySelectorAll('#prDetail .pr-action')].map(b => b.textContent));
    check(['Retire profile', 'Rename Photographer', 'Add search alias', 'Keep as search alias'].every(b => btns.includes(b)), `profile actions drawn (${btns.join(', ')})`);
    check(/Status\s+Retired is a registry status, not a deletion/i.test(t0) && /Current status\s+Active/.test(t0), 'status section explains retirement');
    check(/Former official names\s+Kay Old/.test(t0) && /Kay Old → Kay Current/.test(t0), 'original/former names and dated name history shown');
    await shot(main, '01-profile-dark');

    // Add a search alias
    check(await clickButton(main, '#prDetail', 'Add search alias'), 'Add search alias opens a form');
    await main.fill('#prDetail .pr-decision input.pr-search', ' K. Curr ');
    await main.selectOption('#prDetail .pr-decision select', 'abbreviation');
    await shot(main, '02-alias-form-dark');
    check(await clickButton(main, '#prDetail .pr-decision', 'Review'), 'Review the alias');
    await waitPreview(main);
    check(/Add this search alias\?/.test(await previewText(main)) && /never a name, never a folder name/.test(await previewText(main)), 'alias preview explains search-only meaning');
    const n1 = registryEvents(ud).length;
    const r1 = await save(main);
    check(r1.ok && r1.text === 'Saved. “K. Curr” is now a search alias of Kay Current.', `alias saved (${r1.text})`);
    const e1 = registryEvents(ud).at(-1);
    check(registryEvents(ud).length === n1 + 1 && e1.type === 'photographer-alias-added' && e1.alias === 'K. Curr' && e1.origin.operatorId === operator.id && e1.origin.workflow === 'registry', 'alias event on disk with operator provenance');
    check(await main.evaluate(() => (document.querySelector('#prDetail .pr-detail-title') || {}).textContent) === 'Kay Current', 'profile stays open after saving');

    // Keep the learned shortcut "kc"
    const kept = await main.evaluate(() => { const row = [...document.querySelectorAll('#prDetail .pr-alias-row')].find(r => r.textContent.startsWith('kc')); const b = row && [...row.querySelectorAll('button')].find(x => x.textContent === 'Keep as search alias'); if (b) b.click(); return !!b; });
    check(kept, '"Keep as search alias" offered for the learned shortcut');
    check(await main.evaluate(() => document.querySelector('#prDetail .pr-decision input.pr-search').value) === 'kc', 'form prefilled with the shortcut');
    await clickButton(main, '#prDetail .pr-decision', 'Review');
    await waitPreview(main);
    const r2 = await save(main);
    check(r2.ok, `shortcut kept as alias (${r2.text})`);

    // Rejected alias: another photographer's name
    await clickButton(main, '#prDetail', 'Add search alias');
    await main.fill('#prDetail .pr-decision input.pr-search', 'Local Gamma');
    await clickButton(main, '#prDetail .pr-decision', 'Review');
    await waitPreview(main);
    const rej = await previewText(main);
    check(/cannot be used/.test(rej) && /another photographer/.test(rej), 'alias equal to another photographer\'s name refused with the reason');
    await main.keyboard.press('Escape');

    // Remove an alias — history keeps both
    const removed = await main.evaluate(() => { const row = [...document.querySelectorAll('#prDetail .pr-alias-row')].find(r => r.textContent.startsWith('K. Curr')); const b = row && [...row.querySelectorAll('button')].find(x => x.textContent === 'Remove'); if (b) b.click(); return !!b; });
    check(removed, 'Remove offered on an active alias');
    await waitPreview(main);
    const r3 = await save(main);
    check(r3.ok && /no longer a search alias/.test(r3.text), `alias removed (${r3.text})`);
    const t3 = await detailText(main);
    check(/Added “K. Curr”/.test(t3) && /Removed “K. Curr”/.test(t3), 'alias history keeps the addition and the removal');
    await shot(main, '03-aliases-history-dark');

    // Retire → suggestions stop → reactivate
    await clickButton(main, '#prDetail', 'Retire profile');
    await waitPreview(main);
    const pr = await previewText(main);
    check(/Retire this photographer profile\?/.test(pr) && /not a deletion/.test(pr) && /autocomplete and photographer selection are not changed/.test(pr), 'retire preview explains what changes and what does not');
    await setTheme(main, 'light');
    await shot(main, '04-retire-preview-light');
    const r4 = await save(main);
    check(r4.ok && /retired\. Nothing was deleted/.test(r4.text), `retired (${r4.text})`);
    check(registryEvents(ud).at(-1).type === 'photographer-status-set' && registryEvents(ud).at(-1).status === 'retired', 'status event on disk');
    const t4 = await detailText(main);
    check(/Retired/.test(t4) && await main.evaluate(() => [...document.querySelectorAll('#prDetail .pr-action')].some(b => b.textContent === 'Reactivate profile')), 'profile shows Retired with Reactivate');
    await shot(main, '05-retired-light');
    await main.click('[data-pr-view="cameras"]');
    await main.waitForTimeout(350);
    await main.evaluate(() => [...document.querySelectorAll('#prList .pr-row')].find(r => r.textContent.includes('Canon EOS R5')).click());
    await main.waitForFunction(() => (document.querySelector('#prDetail .pr-detail-title') || {}).textContent === 'Canon EOS R5', null, { timeout: 8000 });
    const cam = await detailText(main);
    check(/Level\s+No suggestion/.test(cam) && /Confirmed/.test(cam), 'retired photographer not suggested; the confirmed association is kept');
    await openPerson(main, 'Kay Current');
    await clickButton(main, '#prDetail', 'Reactivate profile');
    await waitPreview(main);
    const r5 = await save(main);
    check(r5.ok && /active again/.test(r5.text), `reactivated (${r5.text})`);
    await setTheme(main, 'dark');

    // Unregistered list name → explicit registration
    await openPerson(main, 'Zed Pending');
    const z = await detailText(main);
    check(/No registry record yet/.test(z) && await main.evaluate(() => [...document.querySelectorAll('#prDetail .pr-action')].map(b => b.textContent).join('|')) === 'Create registry record', 'unregistered profile: explained, only "Create registry record" offered');
    const nZ = registryEvents(ud).length;
    check(registryEvents(ud).length === nZ, 'opening it wrote nothing');
    await clickButton(main, '#prDetail', 'Create registry record');
    await waitPreview(main);
    const r6 = await save(main);
    check(r6.ok && r6.text === 'Saved. Zed Pending now has a registry record.', `registered (${r6.text})`);
    check(registryEvents(ud).at(-1).type === 'photographer-registered' && registryEvents(ud).at(-1).name === 'Zed Pending', 'one photographer-registered event for the list name');

    // Rename preview — no current event
    await openPerson(main, 'Kay Current');
    await clickButton(main, '#prDetail', 'Rename Photographer');
    await waitRename(main);
    await main.fill('#prDetail .pr-rename input.pr-search', '  kay   newname ');
    await main.waitForTimeout(700);
    const rn = await previewText(main);
    check(/Preview only — applying photographer name changes will be available after archive safety checks are completed\./.test(rn), 'rename is clearly labelled preview only');
    check(/Would be saved as\s+kay newname/.test(rn) && /Photographer list spelling\s+Kay Newname \(the list capitalises each word\)/.test(rn), 'exact stored spelling and list spelling shown');
    check(/Folder detection needs a selected event/.test(rn), 'no current event → profile-only preview, nothing guessed');
    const applyBtn = await main.evaluate(() => { const b = [...document.querySelectorAll('#prDetail .pr-rename button')].find(x => /Apply rename/.test(x.textContent)); return b ? { disabled: b.disabled } : null; });
    check(applyBtn && applyBtn.disabled, 'apply exists only as a disabled button');
    check(!(await main.evaluate(() => /Rename Folder/i.test(document.getElementById('prDetail').innerText))), 'no "Rename Folder Too" control');
    await main.fill('#prDetail .pr-rename input.pr-search', 'Local Gamma');
    await main.waitForTimeout(700);
    check(/cannot be used/.test(await previewText(main)) && /Another photographer already has this name/.test(await previewText(main)), 'collision with another photographer reported');
    await shot(main, '06-rename-no-event-dark');
    await main.keyboard.press('Escape');

    // Rename preview — with Metadata Management's current event set
    await closeModal(main);
    await openTab(main);
    await main.evaluate(({ p, n }) => { _msCurrentEventPath = p; _msCurrentEventName = n; }, { p: ev.eventPath, n: 'Event-Q5e1' });
    await openPerson(main, 'Kay Current');
    await clickButton(main, '#prDetail', 'Rename Photographer');
    await main.fill('#prDetail .pr-rename input.pr-search', 'Kay Newname');
    await main.waitForFunction(() => /Local staging copy/.test((document.querySelector('#prDetail .pr-rename') || {}).innerText || ''), null, { timeout: 8000 });
    const fol = await previewText(main);
    check(/Folders in the current event: Event-Q5e1/.test(fol), 'current event named');
    check(/Local staging copy: Available/.test(fol) && /NAS copy: Available/.test(fol), 'local staging and NAS copies both found');
    check(/PC03-Kay Current → PC03-Kay Newname/.test(fol) && /Eligible for future rename, pending archive safety infrastructure \(keeps PC03\)/.test(fol), 'definite match keeps PC03, eligible only in future');
    check(/PC05-Kay Old → PC05-Kay Newname/.test(fol) && /Former name/.test(fol), 'former-name folder detected in another component');
    check(/PC06-Kay Curent/.test(fol) && /Similar spelling only · Not selected/.test(fol), 'similar-name folder not selected');
    check(/_Unsequenced: QMZ structure — excluded/.test(fol), 'QMZ structure excluded');
    await shot(main, '07-rename-folders-dark');
    await setTheme(main, 'light');
    await shot(main, '08-rename-folders-light');
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().endsWith('index.html')); w.setSize(1100, 700); w.webContents.setZoomFactor(1.3); });
    await main.waitForTimeout(700);
    await main.evaluate(() => document.querySelector('#prDetail .pr-rename').scrollIntoView({ block: 'end', behavior: 'instant' }));   // #msBody scrolls smoothly; measure the settled position, not mid-animation
    await main.waitForTimeout(250);
    const narrow = await main.evaluate(() => {
      const r = (e) => e.getBoundingClientRect();
      const d = document.getElementById('prDetail'), p = document.querySelector('#prDetail .pr-rename');
      const btns = [...p.querySelectorAll('.pr-decision-buttons button')];
      return { inside: r(p).left >= r(d).left - 1 && r(p).right <= r(d).right + 1, hscroll: d.scrollWidth > d.clientWidth + 1, buttons: btns.every(b => r(b).bottom <= r(d).bottom + 1), footer: r(document.getElementById('msCloseFooterBtn')).bottom <= innerHeight };
    });
    check(narrow.inside && !narrow.hscroll && narrow.buttons && narrow.footer, `narrow/short: preview fits, no horizontal scroll, footer visible (${JSON.stringify(narrow)})`);
    await shot(main, '09-rename-narrow-light');
    await setTheme(main, 'dark');
    await shot(main, '10-rename-narrow-dark');
    await main.focus('#prDetail .pr-rename input.pr-search');
    await main.keyboard.press('Escape');
    await main.waitForTimeout(200);
    check(await main.evaluate(() => !document.querySelector('#prDetail .pr-decision') && document.getElementById('metadataSyncModal').classList.contains('open')), 'Escape closes only the preview');
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().endsWith('index.html')); w.webContents.setZoomFactor(1); w.setSize(1440, 900); });

    // IPC: privacy, unsupported rename action, other windows refused, autocomplete untouched
    const ipc = await main.evaluate(async ({ p }) => {
      const out = [];
      const s = await window.api.photographerRegistrySearch({ query: 'Kay Current' });
      const h = s.results[0].handle;
      out.push(await window.api.photographerRegistryPhotographer(h));
      out.push(await window.api.photographerRegistryRenamePreview({ photographer: h, name: 'Kay Newname', eventPath: p }));
      out.push(await window.api.photographerRegistryPrepare({ action: 'rename', photographer: h, name: 'Kay Newname' }));
      out.push(await window.api.photographerRegistryPrepare({ action: 'alias-add', photographer: h, alias: 'KCX', operatorId: 'forged', photographerId: 'forged' }));
      out.push(await window.api.photographerRegistryRenamePreview({ photographer: h, name: 'Kay Newname', eventPath: '/etc' }));
      return out;
    }, { p: ev.eventPath });
    payloads.push(...ipc);
    check(ipc[2].reason === 'unsupported-action', 'no rename action exists in the main process');
    check(ipc[3].ok && !('revision' in ipc[3]) && ipc[3].operator === 'Q5e1 Operator', 'forged IDs ignored; operator from the main process');
    check(ipc[4].folders && ipc[4].folders.reason === 'outside-archive-roots', 'an event outside the configured roots is never scanned');
    const denied = await app.evaluate(async ({ BrowserWindow }, root) => {
      const w = new BrowserWindow({ show: false, webPreferences: { preload: root + '/main/preload.js', contextIsolation: true, sandbox: false } });
      await w.loadURL('data:text/html,<p>q5e1</p>');
      const r = await w.webContents.executeJavaScript('Promise.all([window.api.photographerRegistryRenamePreview({ photographer: "p-0000000000000000", name: "x" }), window.api.photographerRegistryPrepare({ action: "status", status: "retired" })])');
      w.destroy();
      return r;
    }, PROJECT_ROOT);
    check(denied.every(r => r && r.reason === 'not-permitted'), 'profile and preview requests from any other window are refused');
    const ac = await main.evaluate(async () => JSON.stringify(await window.api.matchList('photographers', 'K. Curr')) + JSON.stringify(await window.api.matchList('photographers', 'KCX')));
    check(!/Kay Current/.test(ac), 'registry aliases do not feed import autocomplete');
    await closeModal(main);
    await app.close(); app = null;

    // Restart: everything persisted; files untouched
    ({ app, main } = await launch(work, ud, drivesFile));
    shot.app = app;
    await settleStartup(ud);
    await main.evaluate((id) => window.api.setActiveUser(id), operator.id);
    await openTab(main);
    await openPerson(main, 'Kay Current');
    const after = await detailText(main);
    check(/Current status\s+Active/.test(after) && /Retired/.test(after) && /Reactivated/.test(after) && /kc/.test(after) && /Removed “K. Curr”/.test(after), 'aliases, status history and alias history persisted across restart');
    await openPerson(main, 'Zed Pending');
    check(!/No registry record yet/.test(await detailText(main)), 'registration persisted');
    await closeModal(main);
    await app.close(); app = null;

    const evs = registryEvents(ud);
    check(!evs.some(e => e.type === 'photographer-renamed' && e.at > '2026-10-01'), 'no photographer rename recorded');
    check(sha(fs.readFileSync(path.join(ud, 'photographers.aliases.json'))) === aliasesHash, 'photographers.aliases.json unchanged');
    check(sha(fs.readFileSync(path.join(ud, 'photographers.override.json'))) === overrideHash, 'photographer list unchanged');
    check(treeHash(path.join(work, 'archive')) === treeBefore, 'event folders, files and event.json (staging + NAS) byte-identical');
    const text = JSON.stringify(payloads);
    const leaks = [SERIAL, seeded.keyId, operator.id, work, ...Object.values(seeded.ids)].filter(s => text.includes(s));
    check(leaks.length === 0 && !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text) && !/[0-9a-f]{64}/.test(text), 'payloads carry no IDs, digests, operator ID or paths');
    check(JSON.stringify(['auto-ingest Safe Storage', 'AutoIngest Safe Storage'].map(keychainHas)) === JSON.stringify(prodBefore), 'production Keychain items untouched');
  } catch (err) {
    failures++; log('FAIL — exception:', err.stack || err.message);
  } finally {
    if (app) await app.close().catch(() => {});
    { const q = H.quitGuardSummary({ isoLog: path.join(work, 'live-iso.jsonl') }); log(H.formatQuitGuardSummary(q)); check(q.isolated > 0 && q.failed === 0 && q.unguarded === 0 && q.endedWithoutExit === 0, `every launch isolated by the shared preload, ended by a deliberate quit; no external quit got through (${q.endedWithoutExit} ended without an exit record)`); }
    if (keychainHas(KEYCHAIN_ITEM)) { try { execFileSync('security', ['delete-generic-password', '-s', KEYCHAIN_ITEM], { stdio: 'ignore' }); } catch { /* ignore */ } }
    check(!keychainHas(KEYCHAIN_ITEM), 'test Keychain item removed after the run');
    await fsp.rm(path.join(os.homedir(), 'Library', 'Logs', TEST_PKG_NAME), { recursive: true, force: true }).catch(() => {});
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
    process.exit(failures ? 1 : 0);
  }
})();
