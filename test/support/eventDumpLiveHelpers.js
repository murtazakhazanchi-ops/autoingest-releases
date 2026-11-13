'use strict';
// Shared helpers for the EQI-1 Event Dump live tests (test-only; never packaged — test/ is outside
// package.json build.files). They drive the REAL companion popup and the REAL main window.

const fsp = require('fs/promises');
const path = require('path');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fakeDrive = (mountpoint, label) => ({ isSystem: false, isVirtual: false, isUSB: true, isRemovable: true, isCard: true, busType: 'SD', size: 64e9, description: 'Synthetic SD', mountpoints: [{ path: mountpoint, label }] });

async function waitFor(fn, ms, step = 250) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(step); }
}

/**
 * @param {{ projectRoot: string, packaged?: boolean }} opts  packaged: use the packaged app's own
 *   module instances (process.mainModule.require) instead of the source tree
 */
function createHelpers({ projectRoot, packaged = false }) {
  const mainRequire = (app, mod, fn, arg) => app.evaluate(({ app: a }, { root, mod, fn, arg, packaged }) => {
    const req = packaged ? process.mainModule.require.bind(process.mainModule) : process.getBuiltinModule('module').createRequire(root + '/main/main.js');
    return new Function('m', 'arg', fn)(req(mod), arg);
  }, { root: projectRoot, mod, fn, arg, packaged });
  const diag = (app) => mainRequire(app, '../services/companionService', 'return m.getDiagnostics();');

  async function passSplash(app, operator = 'EQI Operator') {
    const w = await app.firstWindow({ timeout: 60000 });
    await w.waitForTimeout(1500);
    const mainP = app.waitForEvent('window', { predicate: p => p.url().endsWith('index.html'), timeout: 30000 });
    await w.evaluate(() => {
      const vis = id => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
      if (vis('splashSelect')) { const u = document.querySelector('.splash-user-item'); if (u) { u.click(); document.getElementById('splashSelectStartBtn').click(); } else document.getElementById('splashNewProfileBtn').click(); }
      if (vis('splashWelcome')) document.getElementById('splashContinueBtn').click();
    });
    await sleep(300);
    try { await w.fill('#splashInputName', operator, { timeout: 2000 }); await w.fill('#splashInputRole', 'QA'); await w.click('#splashCreateStartBtn'); } catch { /* existing profile */ }
    const main = await mainP;
    await main.waitForLoadState('domcontentloaded');
    await main.waitForFunction(() => typeof EventCreator !== 'undefined' && typeof EventDumpImport !== 'undefined', null, { timeout: 30000 });
    await main.waitForTimeout(1500);
    await main.evaluate(() => { if (typeof obFinish === 'function') obFinish(); document.getElementById('onboardingOverlay')?.classList.remove('visible'); });
    return main;
  }

  async function openPopup(app) {
    const existing = app.windows().find(p => p.url().endsWith('companion.html'));
    if (existing && !existing.isClosed()) return existing;
    const pageP = app.waitForEvent('window', { predicate: p => p.url().endsWith('companion.html'), timeout: 15000 });
    await mainRequire(app, '../services/companionService', 'm.showPopup(); return true;');
    const page = await pageP;
    await page.waitForLoadState('domcontentloaded');
    // EQI-1.1: the popup may reopen in the expanded view, where the card rows are hidden.
    await page.waitForSelector('.card-row', { state: 'attached', timeout: 30000 });
    return page;
  }

  /** The popup is destroyed on blur by design: an interaction that finds it closing reopens and retries. */
  async function withPopup(app, fn) {
    for (let attempt = 1; ; attempt++) {
      const page = await openPopup(app);
      try { return await fn(page); }
      catch (err) {
        if (attempt >= 3 || !/closed|Target page/i.test(String(err && err.message))) throw err;
        await sleep(500);
      }
    }
  }

  /** The first card's Dump view, the companion-wide view and the assessment (names/counts only). */
  async function dumpView(app) {
    const d = await diag(app);
    const src = (d.snapshot && d.snapshot.sources || [])[0];
    return { card: src && src.assessment && src.assessment.dump, global: d.snapshot && d.snapshot.dump, assessment: src && src.assessment, popupOpen: d.popupOpen };
  }

  /** EQI-1.1: from the compact card overview into the expanded Event Dump view (first card). */
  async function enterDump(page) {
    if (await page.evaluate(() => document.querySelector('.popup').dataset.view === 'expanded')) return;
    await page.click('.card-row .event-dump-btn');
    await page.waitForSelector('#xp:not([hidden])', { timeout: 10000 });
  }

  /** EQI-1.1: back from the expanded Event Dump view to the compact card overview. */
  async function backToOverview(page) {
    if (await page.evaluate(() => document.querySelector('.popup').dataset.view === 'compact')) return;
    await page.click('#back-btn');
    await page.waitForFunction(() => document.querySelector('.popup').dataset.view === 'compact', null, { timeout: 10000 });
  }

  /** Types into the photographer search and chooses the EXACT existing name from the suggestions. */
  async function pickPhotographer(page, name, query = name) {
    await page.fill('#xp-ph-input', '');
    await page.type('#xp-ph-input', query);
    await page.waitForSelector('#xp-ph-list .combo-item', { timeout: 5000 });
    const items = await page.$$eval('#xp-ph-list .combo-item', els => els.map(e => e.textContent));
    const i = items.indexOf(name);
    if (i < 0) throw new Error(`photographer "${name}" not offered for "${query}" (${items.slice(0, 5).join(' | ')})`);
    await page.locator('#xp-ph-list .combo-item').nth(i).dispatchEvent('mousedown');
  }

  /** Event Dump + photographer in the REAL expanded popup, then Import; waits for the outcome. */
  async function importViaPopup(app, photographer, { earlier = false, wait = true } = {}) {
    const label = await withPopup(app, async (page) => {
      await enterDump(page);
      if ((await dumpView(app)).card?.photographer !== photographer) {
        await pickPhotographer(page, photographer);
        await waitFor(async () => (await dumpView(app)).card?.photographer === photographer, 5000);
      }
      if (earlier && !(await page.isChecked('#xp-earlier'))) {
        await page.check('#xp-earlier');
        await waitFor(async () => (await dumpView(app)).card?.includeEarlier === true, 5000);
      }
      await page.waitForFunction(() => !document.getElementById('xp-import').disabled, null, { timeout: 10000 });
      const text = await page.textContent('#xp-import');
      await page.click('#xp-import');
      return text;
    });
    if (!wait) return { op: null, label };
    const op = await waitFor(async () => { const v = await dumpView(app); return v.card?.op && v.card.op.state !== 'pending' ? v.card.op : null; }, 120000);
    return { op, label };
  }

  async function setActiveEvent(main, collDir, collName, folder) {
    await main.evaluate(async ({ collDir, coll, folder }) => {
      await window.api.setLastEvent({ collectionPath: collDir, collectionName: coll, eventName: folder, safeEventName: folder });
      await EventCreator.restoreLastEvent();
    }, { collDir, coll: collName, folder });
  }

  return { mainRequire, diag, passSplash, openPopup, withPopup, dumpView, importViaPopup, setActiveEvent, enterDump, backToOverview, pickPhotographer };
}

const listFiles = async (dir) => {
  const out = [];
  async function walk(d) { for (const e of await fsp.readdir(d, { withFileTypes: true }).catch(() => [])) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else out.push(path.relative(dir, p)); } }
  await walk(dir);
  return out.sort();
};

// Real-sized photos: the workspace's discovery rules skip files under 50 KB as thumbnails.
const noiseJpeg = async (projectRoot, w = 400, h = 400) => require(path.join(projectRoot, 'node_modules', 'sharp'))(
  Buffer.from(Array.from({ length: w * h * 3 }, () => Math.floor(Math.random() * 256))), { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();

module.exports = { sleep, localDate, fakeDrive, waitFor, createHelpers, listFiles, noiseJpeg };
