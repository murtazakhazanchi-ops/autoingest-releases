'use strict';
// AI-FEAT-063 / AI-RM-014 Q5c — LIVE: the read-only Photographer Registry tab inside the real
// Metadata Management modal (real main.js, real preload, real renderer, real Electron).
//
// Isolation (same recipe as the Q5a live test): temp userData; drivelist stubbed; the real
// main.js loads through a test-only wrapper app named "autoingest-q5c-livetest", so nothing
// touches the production "auto-ingest" profile or its Keychain item. The registry is seeded
// OUTSIDE the app with a fake secure storage; viewing must create/decrypt nothing, so the run
// must leave no Keychain item behind. Synthetic names and FAKE identifiers only.
//
// Screenshots (dark, light, narrow/short, empty and error states) are written to
// $AI_Q5C_SHOTS when set.
//
// Requires playwright-core (npm install --no-save playwright-core).
// Run: AI_Q5C_SHOTS=/some/dir node test/photographerRegistryQ5cLive.test.js

const { _electron: electron } = require('playwright-core');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_BIN = require(path.join(PROJECT_ROOT, 'node_modules', 'electron'));
const TEST_PKG_NAME = 'autoingest-q5c-livetest';
const KEYCHAIN_ITEM = `${TEST_PKG_NAME} Safe Storage`;
const SHOTS = process.env.AI_Q5C_SHOTS || null;
const SERIAL = 'FAKEQ5CLIVE-0001';

function log(...a) { console.log('[q5c-live]', ...a); }
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
  try { await w.fill('#splashInputName', 'Q5c Operator', { timeout: 2000 }); await w.fill('#splashInputRole', 'QA'); await w.click('#splashCreateStartBtn'); } catch { /* existing profile */ }
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
  const secure = {
    backend: 'fake-test', identity: TEST_PKG_NAME, isAvailable: () => true,
    encrypt: (b) => Buffer.concat([Buffer.from('SEALED:'), Buffer.from(b.map(x => x ^ 0x5a))]),
    decrypt: (c) => Buffer.from(c.subarray(7).map(x => x ^ 0x5a)),
  };
  const store = createIdentityRegistryStore({ dir, secureStorage: secure, computerId: 'fake-computer-q5c-live' });
  await store.open();
  const keyId = JSON.parse(fs.readFileSync(path.join(dir, 'registry.json'), 'utf8')).keyIds[0];
  const ids = { kay: crypto.randomUUID(), lee: crypto.randomUUID(), sam1: crypto.randomUUID(), sam2: crypto.randomUUID(), d1: crypto.randomUUID(), d2: crypto.randomUUID() };
  const o = (at, extra = {}) => ({ origin: { computerId: 'fake-computer-q5c-live', operatorId: null, workflow: 'event-import', ...extra }, at });
  const dig = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const r = await store.appendEvents([
    createEvent('photographer-registered', { photographerId: ids.kay, name: 'Testa Kay', idOrigin: 'random' }, o('2026-09-01T00:00:00Z')),
    createEvent('photographer-renamed', { photographerId: ids.kay, fromName: 'Testa Kay', toName: 'Testa Kayani' }, o('2026-10-05T00:00:00Z', { workflow: 'registry' })),
    createEvent('photographer-alias-added', { photographerId: ids.kay, alias: 'T. Kayani', kind: 'abbreviation' }, o('2026-10-06T00:00:00Z', { workflow: 'registry' })),
    createEvent('photographer-registered', { photographerId: ids.lee, name: 'Testa Lee', idOrigin: 'random' }, o('2026-09-01T00:00:01Z')),
    createEvent('photographer-registered', { photographerId: ids.sam1, name: 'Testa Same', idOrigin: 'random' }, o('2026-09-02T00:00:00Z')),
    createEvent('photographer-registered', { photographerId: ids.sam2, name: 'Testa Same', idOrigin: 'random' }, o('2026-09-03T00:00:00Z', { computerId: 'fake-computer-q5c-other' })),
    createEvent('device-registered', { deviceId: ids.d1, make: 'Canon', modelKey: 'canon eos r5', modelDisplay: 'EOS R5', identifiers: [{ ns: 'exif.bodySerial', keyId, digest: dig(SERIAL), trusted: true }] }, o('2026-10-01T00:00:00Z')),
    createEvent('device-registered', { deviceId: ids.d2, make: 'SONY', modelKey: 'ilce-7m3', modelDisplay: 'ILCE-7M3', identifiers: [{ ns: 'sony.internal', keyId, digest: dig(`${SERIAL}-B`), trusted: true }] }, o('2026-10-01T00:00:01Z')),
    createEvent('import-observed', { importId: 'imp-fakeq5clive-1', photographerId: ids.kay, deviceId: ids.d1, fileCount: 5, day: '2026-10-02' }, o('2026-10-02T00:00:00Z')),
    createEvent('import-observed', { importId: 'imp-fakeq5clive-2', photographerId: ids.lee, deviceId: ids.d2, fileCount: 5, day: '2026-10-03' }, o('2026-10-03T00:00:00Z')),
    createEvent('association-confirmed', { photographerId: ids.kay, deviceId: ids.d2, resolves: [] }, o('2026-10-07T10:00:00Z', { computerId: 'fake-computer-q5c-other', workflow: 'registry' })),
    createEvent('association-rejected', { photographerId: ids.kay, deviceId: ids.d2, resolves: [] }, o('2026-10-07T11:00:00Z', { workflow: 'registry' })),
    createEvent('model-observed', { importId: 'imp-fakeq5clive-m', photographerId: ids.lee, make: 'FUJIFILM', modelKey: 'x-t5', fileCount: 3, day: '2026-10-08' }, o('2026-10-08T00:00:00Z')),
  ]);
  await store.close();
  return { ok: r.ok, ids, keyId };
}

/**
 * Startup settles first: realtimeOperationsService generates and saves the per-device ID on its
 * first presence update after launch (pre-existing, unrelated to the registry). Snapshots are
 * taken after that write so they measure only what browsing the registry does.
 */
async function settleStartup(ud) {
  for (let i = 0; i < 100; i++) {
    try { if (JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8')).deviceId) break; } catch { /* not yet */ }
    await sleep(200);
  }
  await sleep(500);
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
  // Electron's own capture of the main window (true pixels, unaffected by zoom).
  const b64 = await shot.app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().endsWith('index.html'));
    return (await w.webContents.capturePage()).toPNG().toString('base64');
  });
  fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'));
};
/** Rough relative lightness (0–1) of a computed CSS colour: rgb()/rgba() or color(srgb …). */
const lum = (css) => {
  const srgb = css.match(/color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/);
  const ch = srgb ? srgb.slice(1, 4).map(Number) : (css.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(n => Number(n) / 255);
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
};
const setTheme = (main, t) => main.evaluate((th) => document.documentElement.setAttribute('data-theme', th), t);
const clickRow = (main, name) => main.evaluate((n) => {
  const row = [...document.querySelectorAll('#prList .pr-row')].find(r => r.querySelector('.pr-row-title').textContent === n);
  if (row) row.click();
  return !!row;
}, name);
const waitDetail = (main, title) => main.waitForFunction((t) => (document.querySelector('#prDetail .pr-detail-title') || {}).textContent === t, title, { timeout: 8000 });

/** Layout facts for the tab row, panel, list/detail and footer. */
const layout = (main) => main.evaluate(() => {
  const r = (el) => el.getBoundingClientRect();
  const tabs = document.querySelector('#metadataSyncModal .ms-tabs');
  const box = document.querySelector('#metadataSyncModal .emm-box');
  const tabRects = [...tabs.querySelectorAll('.ms-tab')].map(t => ({ label: t.textContent, right: r(t).right, left: r(t).left, clipped: t.scrollWidth > t.clientWidth + 1 }));
  const list = document.getElementById('prList'), detail = document.getElementById('prDetail'), close = document.getElementById('msCloseFooterBtn');
  const cs = (el) => getComputedStyle(el);
  return {
    viewport: { w: innerWidth, h: innerHeight },
    tabRowOverflow: tabs.scrollWidth > tabs.clientWidth + 1,
    tabsInside: tabRects.every(t => t.left >= r(tabs).left - 1 && t.right <= r(tabs).right + 1 && !t.clipped),
    tabCount: tabRects.length, tabLabels: tabRects.map(t => t.label),
    boxInside: r(box).bottom <= innerHeight + 1 && r(box).right <= innerWidth + 1,
    footerVisible: r(close).bottom <= innerHeight && r(close).top >= 0 && r(close).height > 0,
    listScrolls: cs(list).overflowY === 'auto', detailScrolls: cs(detail).overflowY === 'auto',
    listHeight: r(list).height, detailHeight: r(detail).height,
    listOverflowing: list.scrollHeight > list.clientHeight,
    rowTitleClipVertical: [...document.querySelectorAll('#prList .pr-row-title')].slice(0, 20).some(e => e.scrollHeight > e.clientHeight + 2),
  };
});

(async () => {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-q5c-live-'));
  const ud = path.join(work, 'userData');
  const stubFile = path.join(work, 'preload.js');
  const drivesFile = path.join(work, 'drives.json');
  await fsp.mkdir(ud, { recursive: true });
  await fsp.writeFile(stubFile, PRELOAD);
  await fsp.mkdir(path.join(work, 'wrapper-app'), { recursive: true });
  await fsp.writeFile(path.join(work, 'wrapper-app', 'package.json'), JSON.stringify({ name: TEST_PKG_NAME, version: require(path.join(PROJECT_ROOT, 'package.json')).version, main: 'index.js' }));
  await fsp.writeFile(path.join(work, 'wrapper-app', 'index.js'), WRAPPER_INDEX);
  fs.writeFileSync(drivesFile, '[]');
  if (SHOTS) await fsp.mkdir(SHOTS, { recursive: true });
  const prodBefore = ['auto-ingest Safe Storage', 'AutoIngest Safe Storage'].map(keychainHas);
  check(!keychainHas(KEYCHAIN_ITEM), 'no leftover test Keychain item before the run');

  let app, main;
  try {
    // ── Session 1: fresh profile, no registry — empty states ─────────────────────
    ({ app, main } = await launch(work, ud, drivesFile, stubFile));
    shot.app = app;
    check(await app.evaluate(({ app: a }) => a.getName()) === TEST_PKG_NAME, `isolated app identity (${TEST_PKG_NAME})`);
    await settleStartup(ud);
    const before1 = ownFiles(ud);
    await setTheme(main, 'dark');
    await openTab(main);
    const tabs1 = await layout(main);
    check(tabs1.tabCount === 4 && tabs1.tabLabels[3] === 'Photographer Registry', `fourth tab after Keyword Registry (${tabs1.tabLabels.join(' | ')})`);
    const s1 = await main.evaluate(() => ({ status: document.getElementById('prStatus').textContent, hidden: document.getElementById('prStatus').hidden, rows: document.querySelectorAll('#prList .pr-row').length }));
    check(!s1.hidden && /No camera or name history has been recorded yet/.test(s1.status), 'missing registry → neutral "nothing recorded yet" notice');
    check(s1.rows >= 312, `photographer list still browsable without a registry (${s1.rows} rows)`);
    await main.click('[data-pr-view="cameras"]');
    await main.waitForTimeout(300);
    const emptyCams = await main.evaluate(() => document.querySelector('#prList .pr-list-empty')?.textContent || '');
    check(/No cameras recorded yet/.test(emptyCams), 'no camera history → empty-state text, not an error');
    await shot(main, '01-empty-dark-cameras');
    await main.click('[data-pr-view="photographers"]');
    await main.waitForTimeout(300);
    await closeModal(main);
    check(!fs.existsSync(path.join(ud, 'identity-registry')), 'viewing created no identity-registry folder');
    const after1 = ownFiles(ud);
    const diff1 = Object.keys({ ...before1, ...after1 }).filter(k => before1[k] !== after1[k]);
    check(diff1.length === 0, `viewing changed no settings, users, lists or aliases${diff1.length ? ` (changed: ${diff1.join(', ')})` : ''}`);
    check(!keychainHas(KEYCHAIN_ITEM), 'viewing created no Keychain item');
    await app.close(); app = null;

    // ── Session 2: seeded synthetic registry ─────────────────────────────────────
    const dir = path.join(ud, 'identity-registry');
    const seeded = await seedRegistry(dir);
    check(seeded.ok, 'synthetic registry seeded outside the app (fake secure storage)');
    const listFile = path.join(ud, 'photographers.override.json');
    fs.writeFileSync(listFile, JSON.stringify(['Testa Kayani', 'Testa Lee', 'Testa Same']));
    fs.writeFileSync(path.join(ud, 'photographers.aliases.json'), JSON.stringify({ [require(path.join(PROJECT_ROOT, 'main', 'aliasEngine')).slugify('Testa Kayani')]: ['tkay'] }));
    ({ app, main } = await launch(work, ud, drivesFile, stubFile));
    shot.app = app;
    await settleStartup(ud);
    const before2 = ownFiles(ud);
    const settingsBefore2 = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));

    // Main window stays responsive while the tab loads: rAF keeps ticking.
    await main.evaluate(() => { window.__q5cGaps = []; let last = performance.now(); const tick = (t) => { window.__q5cGaps.push(t - last); last = t; if (window.__q5cGaps.length < 400) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
    await setTheme(main, 'dark');
    await openTab(main);
    const maxGap = await main.evaluate(() => Math.max(...window.__q5cGaps));
    check(maxGap < 250, `main window not frozen while loading (longest frame gap ${Math.round(maxGap)} ms)`);

    await main.selectOption('#prFilter', 'with-cameras');
    await main.waitForTimeout(400);
    const withCams = await main.evaluate(() => [...document.querySelectorAll('#prList .pr-row-title')].map(e => e.textContent));
    check(withCams.includes('Testa Kayani') && withCams.includes('Testa Lee'), `filter "has cameras" (${withCams.join(', ')})`);
    await main.selectOption('#prSort', 'camera-count');
    await main.waitForTimeout(300);
    const sorted = await main.evaluate(() => document.querySelector('#prList .pr-row-title').textContent);
    check(sorted === 'Testa Kayani', `sort by camera count puts the two-camera photographer first (${sorted})`);
    check(await clickRow(main, 'Testa Kayani'), 'row selectable by click');
    await waitDetail(main, 'Testa Kayani');
    const prof = await main.evaluate(() => document.getElementById('prDetail').innerText);
    check(/Original registered name\s+Testa Kay\b/.test(prof) && /Former official names\s+Testa Kay\b/.test(prof), 'profile: original and former official names');
    check(/Testa Kay → Testa Kayani/.test(prof), 'profile: name-change history');
    check(/T\. Kayani/.test(prof) && /tkay/.test(prof) && /Search aliases/i.test(prof) && /Learned typing shortcuts/i.test(prof), 'profile: registry search alias and learned shortcut, in separate sections');
    check(/EOS R5/.test(prof) && /ILCE-7M3/.test(prof) && /does not prove who took a particular photo/.test(prof), 'profile: camera associations with the attribution caveat');
    check(/Needs review/i.test(prof) && /Camera confirmation disputed/.test(prof), 'profile: related conflict shown');
    const buttons = await main.evaluate(() => [...document.querySelectorAll('#msTabPhotographers button')].filter(b => !b.disabled).map(b => b.textContent.trim()));
    // Q5d/Q5e-1 (authorized) add decision and profile controls; merging, deleting, resetting,
    // folder renames and applying a rename must still not exist.
    check(!buttons.some(t => /merge|delete|reset|rename folder|apply rename/i.test(t)), `no merge, delete, reset, folder-rename or apply-rename control (${buttons.length} enabled buttons)`);
    await shot(main, '02-profile-dark');

    // Keyboard navigation
    await main.focus('#prList');
    await main.keyboard.press('Home');
    await main.waitForTimeout(250);
    const firstSel = await main.evaluate(() => document.querySelector('#prList .pr-row-selected .pr-row-title')?.textContent);
    await main.keyboard.press('ArrowDown');
    await main.waitForTimeout(350);
    const kb = await main.evaluate(() => ({ sel: document.querySelector('#prList .pr-row-selected .pr-row-title')?.textContent, ad: document.getElementById('prList').getAttribute('aria-activedescendant'), title: document.querySelector('#prDetail .pr-detail-title')?.textContent, modalOpen: document.getElementById('metadataSyncModal').classList.contains('open') }));
    check(firstSel && kb.sel && kb.sel !== firstSel && kb.title === kb.sel && !!kb.ad && kb.modalOpen, `keyboard: Home/ArrowDown move selection and update the profile (${firstSel} → ${kb.sel})`);

    // Search: former name and alias resolve to the profile
    await main.selectOption('#prFilter', 'all');
    await main.fill('#prSearch', 'Testa Kay');
    await main.waitForTimeout(500);
    const sr = await main.evaluate(() => document.querySelector('#prList .pr-row .pr-row-title')?.textContent);
    check(sr === 'Testa Kayani', 'search by former name finds the renamed photographer');
    await main.fill('#prSearch', 'zzzz-no-such-q5c');
    await main.waitForTimeout(400);
    check(/No photographer matches this search/.test(await main.evaluate(() => document.getElementById('prList').textContent)), 'search with no result → empty state');
    await main.fill('#prSearch', '');
    await main.waitForTimeout(400);

    // Camera detail
    await main.click('[data-pr-view="cameras"]');
    await main.waitForTimeout(300);
    check(await clickRow(main, 'SONY ILCE-7M3'), 'camera row selectable');
    await waitDetail(main, 'SONY ILCE-7M3');
    const cam = await main.evaluate(() => document.getElementById('prDetail').innerText);
    check(/Identified by\s+Sony internal ID/.test(cam), 'camera: identifier type as a readable label only');
    check(/Needs review/.test(cam) && /Observed/.test(cam), 'camera: relationship states shown');
    check(/does not prove who took a particular photo/.test(cam), 'camera: attribution caveat');
    check(/Seen in an import by Testa Lee/.test(cam) && /this computer|another computer/.test(cam), 'camera: non-sensitive evidence history');
    await shot(main, '03-camera-dark');

    // Review queue
    await main.click('[data-pr-view="review"]');
    await main.waitForTimeout(300);
    const review = await main.evaluate(() => ({ titles: [...document.querySelectorAll('#prList .pr-row-title')].map(e => e.textContent), count: document.querySelector('[data-pr-view="review"] .pr-view-count').textContent }));
    check(review.titles.includes('Name matches several photographers') && review.titles.includes('Camera confirmation disputed'), `review queue lists conflicts (${review.titles.join('; ')})`);
    check(Number(review.count) === review.titles.length, 'review count badge matches the queue');
    await clickRow(main, 'Name matches several photographers');
    await waitDetail(main, 'Name matches several photographers');
    check(/not linked to any of them/.test(await main.evaluate(() => document.getElementById('prDetail').innerText)), 'review item explained in plain language, nothing chosen');
    await shot(main, '04-review-dark');

    // Light theme
    await setTheme(main, 'light');
    await main.click('[data-pr-view="photographers"]');
    await main.waitForTimeout(300);
    await main.fill('#prSearch', 'Testa Kayani');
    await main.waitForTimeout(400);
    await clickRow(main, 'Testa Kayani');
    await waitDetail(main, 'Testa Kayani');
    const colors = await main.evaluate(() => ({ bg: getComputedStyle(document.querySelector('#metadataSyncModal .emm-box')).backgroundColor, text: getComputedStyle(document.querySelector('#prDetail .pr-detail-title')).color }));
    check(lum(colors.bg) > 0.85 && lum(colors.text) < 0.3, `light theme renders with light surfaces and dark text (${colors.bg} / ${colors.text})`);
    await shot(main, '05-profile-light');
    await main.click('[data-pr-view="cameras"]');
    await main.waitForTimeout(300);
    await clickRow(main, 'Canon EOS R5');
    await waitDetail(main, 'Canon EOS R5');
    await shot(main, '06-camera-light');
    await setTheme(main, 'dark');

    // Desktop and narrow/short layouts (minimum window, then zoomed to emulate a narrower screen)
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().endsWith('index.html')); w.setSize(1440, 900); });
    await main.waitForTimeout(500);
    const wide = await layout(main);
    check(wide.tabsInside && !wide.tabRowOverflow && wide.footerVisible && wide.listScrolls && wide.detailScrolls, `desktop ${wide.viewport.w}×${wide.viewport.h}: tabs fit, footer reachable, list/detail scroll independently`);
    await main.click('[data-pr-view="photographers"]');
    await main.fill('#prSearch', '');
    await main.waitForTimeout(400);
    const wide2 = await layout(main);
    check(wide2.listOverflowing && wide2.listHeight > 150, `long list scrolls inside its own pane (${Math.round(wide2.listHeight)} px)`);
    await shot(main, '07-desktop-1440');
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().endsWith('index.html')); w.setSize(1100, 700); w.webContents.setZoomFactor(1.3); });
    await main.waitForTimeout(700);
    const narrow = await layout(main);
    check(narrow.tabCount === 4 && narrow.tabsInside && !narrow.tabRowOverflow, `narrow ${narrow.viewport.w}×${narrow.viewport.h} CSS px: all four tab labels visible, unclipped`);
    check(narrow.boxInside && narrow.footerVisible, 'narrow/short: modal and footer Close button stay reachable');
    check(!narrow.rowTitleClipVertical && narrow.listHeight > 60, `narrow/short: list text not clipped (${Math.round(narrow.listHeight)} px list)`);
    await clickRow(main, 'Testa Kayani').catch(() => {});
    await main.fill('#prSearch', 'Testa');
    await main.waitForTimeout(400);
    await clickRow(main, 'Testa Kayani');
    await waitDetail(main, 'Testa Kayani').catch(() => {});
    await shot(main, '08-narrow-zoomed-dark');
    await setTheme(main, 'light');
    await shot(main, '09-narrow-zoomed-light');
    await setTheme(main, 'dark');
    await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows().find(x => x.webContents.getURL().endsWith('index.html')); w.webContents.setZoomFactor(1); w.setSize(1440, 900); });
    await main.waitForTimeout(400);

    // Renderer payload privacy: everything the four channels return
    const payloads = await main.evaluate(async () => {
      const out = [await window.api.photographerRegistryLoad()];
      const s = await window.api.photographerRegistrySearch({ query: '', filter: 'all', sort: 'name' });
      out.push(s);
      for (const r of s.results.filter(x => x.cameraCount || x.needsReview).slice(0, 10)) out.push(await window.api.photographerRegistryPhotographer(r.handle));
      for (const c of out[0].cameras) out.push(await window.api.photographerRegistryCamera(c.handle));
      out.push(await window.api.photographerRegistryPhotographer('../../registry.json'));
      out.push(await window.api.photographerRegistryCamera({ evil: true }));
      return out;
    });
    const text = JSON.stringify(payloads);
    const leaks = [SERIAL, seeded.keyId, 'fake-computer-q5c', 'imp-fakeq5clive', ud, ...Object.values(seeded.ids)].filter(s => text.includes(s));
    check(leaks.length === 0 && !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text) && !/[0-9a-f]{64}/.test(text), 'renderer payloads carry no serial, digest, key ID, computer ID, import ID, path or identity UUID');
    check(payloads.at(-2).reason === 'unknown-record' && payloads.at(-1).reason === 'unknown-record', 'invalid record handles refused');

    // Sender validation: a second window with the same preload is refused
    const denied = await app.evaluate(async ({ BrowserWindow }, root) => {
      const w = new BrowserWindow({ show: false, webPreferences: { preload: root + '/main/preload.js', contextIsolation: true, sandbox: false } });
      await w.loadURL('data:text/html,<p>q5c</p>');
      const r = await w.webContents.executeJavaScript('Promise.all([window.api.photographerRegistryLoad(), window.api.photographerRegistrySearch({}), window.api.photographerRegistryPhotographer("p-0000000000000000"), window.api.photographerRegistryCamera("c-0000000000000000")])');
      w.destroy();
      return r;
    }, PROJECT_ROOT);
    check(denied.every(r => r && r.ok === false && r.reason === 'not-permitted'), 'requests from any window other than the main window are refused');

    // Other tabs unaffected; rapid tab switching stays consistent
    for (const [tab, panel] of [['msTab-metadata', 'msTabMetadata'], ['msTab-audit', 'msTabAudit'], ['msTab-registry', 'msTabRegistry']]) {
      await main.click(`#${tab}`);
      await main.waitForTimeout(200);
      const vis = await main.evaluate((p) => ({ own: getComputedStyle(document.getElementById(p)).display !== 'none', pr: getComputedStyle(document.getElementById('msTabPhotographers')).display === 'none' }), panel);
      check(vis.own && vis.pr, `${panel} still shows on its own; Photographer Registry panel hidden`);
    }
    for (let i = 0; i < 30; i++) {
      await main.evaluate((n) => document.getElementById(n % 2 ? 'msTab-photographers' : 'msTab-registry').click(), i);
      await sleep(15);
    }
    await main.click('#msTab-photographers');
    await main.waitForFunction(() => !document.getElementById('msTabPhotographers').hasAttribute('aria-busy'), null, { timeout: 10000 });
    await main.waitForTimeout(500);
    const stress = await main.evaluate(() => ({ rows: document.querySelectorAll('#prList .pr-row').length, panels: ['msTabMetadata', 'msTabAudit', 'msTabRegistry', 'msTabPhotographers'].filter(id => getComputedStyle(document.getElementById(id)).display !== 'none') }));
    check(stress.rows > 0 && stress.panels.length === 1 && stress.panels[0] === 'msTabPhotographers', `30 rapid tab switches: one panel visible, list intact (${stress.rows} rows)`);
    await closeModal(main);
    const after2 = ownFiles(ud);
    const diff2 = Object.keys({ ...before2, ...after2 }).filter(k => before2[k] !== after2[k]);
    if (diff2.includes('settings.json')) {
      const sa = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
      log('settings keys changed:', Object.keys({ ...settingsBefore2, ...sa }).filter(k => JSON.stringify(settingsBefore2[k]) !== JSON.stringify(sa[k])).join(', '));
    }
    check(diff2.length === 0, `browsing changed no registry, key, settings, list or alias file${diff2.length ? ` (changed: ${diff2.join(', ')})` : ''}`);
    check(!keychainHas(KEYCHAIN_ITEM), 'no Keychain item created while browsing');

    // ── Error states while running: locked, corrupt (file left exactly as found) ────
    fs.writeFileSync(path.join(dir, 'registry.lock'), JSON.stringify({ pid: process.pid, token: 'q5c-live', at: new Date().toISOString() }));
    await openTab(main);
    const locked = await main.evaluate(() => document.getElementById('prStatus').textContent);
    check(/Another AutoIngest process is updating the registry/.test(locked), 'registry locked by another live process → read-only notice, data still shown');
    await shot(main, '10-locked-dark');
    await closeModal(main);
    fs.unlinkSync(path.join(dir, 'registry.lock'));
    const good = fs.readFileSync(path.join(dir, 'registry.json'));
    fs.writeFileSync(path.join(dir, 'registry.json'), '{ damaged');
    const before3 = ownFiles(ud);
    await openTab(main);
    const corrupt = await main.evaluate(() => ({ text: document.getElementById('prStatus').textContent, cls: document.querySelector('#prStatus .pr-notice')?.className }));
    check(/could not be read as a valid registry/.test(corrupt.text) && /attention/.test(corrupt.cls), 'corrupt registry → attention notice without any reset control');
    await shot(main, '11-corrupt-light-check');
    await closeModal(main);
    check(JSON.stringify(ownFiles(ud)) === JSON.stringify(before3), 'corrupt registry left exactly as found');
    fs.writeFileSync(path.join(dir, 'registry.json'), good);
    const importable = await main.evaluate(() => !!document.getElementById('workspace') && typeof window.api.importFiles === 'function' && typeof window.api.commitImportTransaction === 'function');
    check(importable, 'main import workspace still present and wired after browsing the registry');
    await app.close(); app = null;

    check(!keychainHas(KEYCHAIN_ITEM), 'no test Keychain item exists after the run');
    const prodAfter = ['auto-ingest Safe Storage', 'AutoIngest Safe Storage'].map(keychainHas);
    check(JSON.stringify(prodAfter) === JSON.stringify(prodBefore), 'production Keychain items untouched (presence unchanged)');
  } catch (err) {
    failures++; log('FAIL — exception:', err.stack || err.message);
  } finally {
    if (app) await app.close().catch(() => {});
    if (keychainHas(KEYCHAIN_ITEM)) { try { execFileSync('security', ['delete-generic-password', '-s', KEYCHAIN_ITEM], { stdio: 'ignore' }); } catch { /* ignore */ } }
    await fsp.rm(path.join(os.homedir(), 'Library', 'Logs', TEST_PKG_NAME), { recursive: true, force: true }).catch(() => {});
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    log(failures ? `${failures} FAILURE(S)` : 'ALL PASS');
    process.exit(failures ? 1 : 0);
  }
})();
