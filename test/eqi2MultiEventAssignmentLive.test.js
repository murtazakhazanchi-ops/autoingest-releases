'use strict';
// LIVE (AI-FEAT-064 EQI-2): Divide Photos Between Events from the REAL menu-bar companion popup,
// executed by the REAL main window's import machinery (ImportSessionRunner → commitImportTransaction
// with destination 'dump'), with real ExifTool metadata, event.json, import index and sync queue.
//
// Isolation (test/support/liveTestHarness.js): test-only app identity, temp profile, drivelist stub
// (synthetic cards are temp folders), external-Quit guard. Synthetic photos and a throwaway archive
// only; the production profile and Keychain are checked unchanged.
//
//   S1  default Event Dump unchanged · divide by time ranges (two events, intermediate event,
//       non-contiguous ranges, shared boundary, midnight, earlier date) · overlap conflict · Split Here ·
//       boundary move · gap suggestions · Create New Event (real Event Creator) · reopen · review ·
//       ONE import into several Dumps · files, event.json, metadata, source untouched · responsiveness
//   S2  card change during assignment (no stale state) · mixed cameras → per-camera photographers
//   S3  partial failure (one event unwritable) → other events valid → retry imports the rest once
//   S4  card removed during the import → stopped, nothing reported complete → retry, no duplicates
//   S5  Local First: staging + sync jobs per event · cleared-staging duplicate guard
//   S6  archive offline / event unavailable → import blocked with a specific reason
//
// Run: node test/eqi2MultiEventAssignmentLive.test.js     AI_EQI2_SHOTS=<dir> keeps the screenshots

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
const COLL = 'CollEQI2';
const P1 = 'Testali Bhai', P2 = 'Testhusain Bhai';
const E1 = '1448-05-01 _01-Waaz-Hall-Surat', E2 = '1448-05-01 _02-Ziyafat-Hall-Surat', E3 = '1448-05-01 _03-Majlis-Hall-Surat';

let failures = 0;
const log = (...a) => console.log('[eqi2-live]', ...a);
const check = (c, m) => { if (c) log('PASS —', m); else { failures++; log('FAIL —', m); } };
const J = (x) => JSON.stringify(x);
const { sleep, localDate, fakeDrive, waitFor, createHelpers, listFiles, noiseJpeg: _noise } = require('./support/eventDumpLiveHelpers');
const { mainRequire, diag, passSplash, withPopup, dumpView, setActiveEvent: _setActive, enterDump, pickPhotographer } = createHelpers({ projectRoot: PROJECT_ROOT });
const noiseJpeg = () => _noise(PROJECT_ROOT);
const addDays = (d, n) => { const [y, m, dd] = d.split('-').map(Number); return localDate(new Date(y, m - 1, dd + n)); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

async function shoot(page, dir, name) {
  const cur = await page.evaluate(() => document.documentElement.dataset.theme);
  for (const theme of [cur, cur === 'dark' ? 'light' : 'dark']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(dir, `${name}-${theme}.png`) });
  }
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, cur);
}

async function sampleRtt(app, untilFn) {
  const rtts = [];
  while (!(await untilFn())) {
    const t0 = Date.now();
    await app.evaluate(() => 1);
    rtts.push(Date.now() - t0);
    await sleep(100);
  }
  rtts.sort((a, b) => a - b);
  return { n: rtts.length, max: rtts[rtts.length - 1] || 0, p50: rtts[Math.floor(rtts.length / 2)] || 0 };
}

/** The first card's division view (names/times/counts only). */
async function dview(app) {
  const d = await diag(app);
  const src = (d.snapshot && d.snapshot.sources || [])[0];
  return { dv: src && src.assessment && src.assessment.divide, view: d.snapshot && d.snapshot.view, card: src && src.assessment && src.assessment.dump, src };
}

(async () => {
  if (process.platform !== 'darwin') { log('SKIP — macOS only'); return; }
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-eqi2-live-'));
  const shots = process.env.AI_EQI2_SHOTS || path.join(work, 'shots');
  await fsp.mkdir(shots, { recursive: true });
  const ud = path.join(work, 'userData'); await fsp.mkdir(ud);
  const archiveRoot = path.join(work, 'archive'); await fsp.mkdir(archiveRoot);
  const stagingRoot = path.join(work, 'staging'); await fsp.mkdir(stagingRoot);
  const collDir = path.join(archiveRoot, COLL);
  const evDir = (f) => path.join(collDir, f);
  const iso = H.prepareIsolatedApp({ tag: 'eqi2', work, projectRoot: PROJECT_ROOT });
  const prodBefore = H.prodKeychainSnapshot();
  const testKcBefore = H.keychainHas(iso.keychainItem);
  const et = new ExifTool({ maxProcs: 2 });
  const today = localDate(), tomorrow = addDays(today, 1), earlier = addDays(today, -4);

  const put = async (dir, name, date, time, cam = { Make: 'Canon', Model: 'Canon EOS R5', 'ExifIFD:SerialNumber': '0123EQI2A' }) => {
    await fsp.mkdir(dir, { recursive: true });
    const p = path.join(dir, name);
    await fsp.writeFile(p, await noiseJpeg());
    const stamp = date ? `${date.replace(/-/g, ':')} ${time}` : null;
    await et.write(p, { ...cam, ...(stamp ? { DateTimeOriginal: stamp, CreateDate: stamp } : {}) }, { writeArgs: ['-overwrite_original'] });
    return p;
  };
  const fakeRaw = async (dir, name) => { const p = path.join(dir, name); await fsp.writeFile(p, crypto.randomBytes(80 * 1024)); return p; };
  const hashTree = async (root) => { const out = {}; for (const f of await listFiles(root)) out[f] = sha(await fsp.readFile(path.join(root, f))); return out; };

  // ── card A: one camera, one day with several events ──
  const cardA = path.join(work, 'CARD_A'), a100 = path.join(cardA, 'DCIM', '100CANON'), a101 = path.join(cardA, 'DCIM', '101CANON');
  await put(a100, 'IMG_0001.JPG', today, '09:05:00');
  await put(a100, 'IMG_0002.JPG', today, '09:30:00'); await fakeRaw(a100, 'IMG_0002.CR3');   // RAW/JPEG pair
  await put(a100, 'IMG_0003.JPG', today, '11:45:00');                                        // intermediate event
  await put(a100, 'IMG_0004.JPG', today, '12:10:00');
  await put(a100, 'IMG_0005.JPG', today, '12:30:00');                                        // exactly on a boundary
  await put(a101, 'IMG_0001.JPG', today, '13:00:00');                                        // duplicate file name
  await put(a100, 'IMG_0006.JPG', today, '14:00:00');
  await put(a100, 'IMG_0007.JPG', today, '15:30:00');                                        // → new event
  await put(a100, 'IMG_0008.JPG', today, '19:00:00');                                        // left unassigned
  await put(a100, 'IMG_0009.JPG', today, '21:30:00');                                        // midnight event
  await put(a100, 'IMG_0010.JPG', tomorrow, '00:30:00');
  await put(a100, 'IMG_0011.JPG', earlier, '10:00:00');                                      // earlier date
  await put(a100, 'IMG_0012.JPG', null, null);                                               // no capture date
  const cardABefore = await hashTree(cardA);

  let app;
  try {
    app = await electron.launch({ executablePath: ELECTRON_BIN, args: [...iso.args, '--user-data-dir=' + ud, '--no-sandbox'], cwd: PROJECT_ROOT, env: iso.env(ud), timeout: 60000 });
    await H.verifyIsolation(app, iso, ud);
    check(true, 'isolation proven (test identity, temp profile, drivelist stub, quit guard)');
    const main = await passSplash(app);
    main.on('dialog', (d) => { d.accept().catch(() => {}); });
    await main.evaluate(async (a) => {
      await window.api.initArchiveRoot(a.archiveRoot);
      await window.api.setNasRoot(a.archiveRoot);
      await window.api.setMainArchiveRoot(a.archiveRoot);
      await window.api.setDefaultImportMode('direct-nas');
      if (typeof EventCreator.setSessionArchiveRoot === 'function') EventCreator.setSessionArchiveRoot(a.archiveRoot);
      for (const n of a.names) await window.api.addToList('photographers', n);
      await window.api.keywordsAddKeyword({ label: 'Ziyarat', category: 'event', parentPath: ['Majlis'], parentId: 'event' });
      await window.api.keywordsAddKeyword({ label: 'Mundra', category: 'city', parentPath: ['Mundra'], parentId: 'city' });
    }, { archiveRoot, names: [P1, P2] });
    const comp = (id, folderName, types, city) => ({ id, folderName, location: 'Hall', city, country: 'India', types, additionalKeywords: [] });
    await main.evaluate(async ({ defs }) => { for (const [d, data] of defs) await window.api.writeEventJson(d, data); }, { defs: [
      [evDir(E1), { version: 1, hijriDate: '1448-05-01', sequence: 1, eventName: 'Waaz-Hall-Surat', components: [comp(1, 'Waaz-Hall', ['Waaz'], 'Surat')] }],
      [evDir(E2), { version: 1, hijriDate: '1448-05-01', sequence: 2, eventName: 'Ziyafat-Hall-Surat', components: [comp(1, 'Ziyafat-Hall', ['Ziyafat'], 'Surat')] }],
      [evDir(E3), { version: 1, hijriDate: '1448-05-01', sequence: 3, eventName: 'Majlis-Hall-Surat', components: [comp(1, 'Majlis-Hall', ['Majlis'], 'Surat'), comp(2, 'Ziyafat-Hall', ['Ziyafat'], 'Surat')] }],
    ] });
    await _setActive(main, collDir, COLL, E1);
    await waitFor(async () => (await dumpView(app)).global?.event?.eventName === E1, 15000);

    // ═══ S1 ══════════════════════════════════════════════════════════════
    fs.writeFileSync(iso.drivesFile, J([fakeDrive(cardA, 'CARD_A')]));
    const assessed = await waitFor(async () => { const v = await dumpView(app); return v.assessment?.state === 'complete' && v.card ? v.card : null; }, 60000);
    check(!!assessed && assessed.counts.selectedNew === 11 && assessed.counts.toImport === 11 && assessed.counts.earlierNew === 1 && assessed.counts.uncertain === 1,
      `default unchanged: today's 11 new files selected for ONE event, earlier/undated left out (${J(assessed && assessed.counts)})`);
    check((await dview(app)).view.mode === 'compact' && !(await dview(app)).dv, 'the division never opens by itself');

    const shotsTaken = [];
    await withPopup(app, async (page) => {
      await enterDump(page);
      await pickPhotographer(page, P1);
      await waitFor(async () => (await dumpView(app)).card?.photographer === P1, 5000);
      await page.waitForFunction(() => !document.getElementById('xp-import').disabled, null, { timeout: 10000 });
      const importBtn = await page.$eval('#xp-import', b => ({ text: b.textContent, w: b.getBoundingClientRect().width, cls: b.className }));
      const divBtn = await page.$eval('#xp-divide', b => ({ text: b.textContent, cls: b.className, disabled: b.disabled }));
      check(/Import 11 files to Dump/.test(importBtn.text) && /btn-primary/.test(importBtn.cls) && importBtn.w > 400, `the one-step Import stays the prominent primary action (${J(importBtn)})`);
      check(divBtn.text === 'Divide Photos Between Events' && /link-btn/.test(divBtn.cls) && !divBtn.disabled, 'Divide Photos Between Events is offered as a secondary action');
      await shoot(page, shots, '1-expanded-with-divide'); shotsTaken.push('1-expanded-with-divide');
      await page.click('#xp-divide');
      await page.waitForSelector('#dv:not([hidden])', { timeout: 10000 });
    });
    let dv = (await waitFor(async () => { const v = await dview(app); return v.dv && v.dv.ready ? v : null; }, 10000)).dv;
    const size = await mainRequire(app, '../services/companionService', 'const d = m.getDiagnostics(); return d.popupOpen;');
    check(size && dv.ranges.length === 0 && dv.events.length === 0 && dv.unassigned.assets === 12 && dv.unassigned.files === 13 && dv.undated.assets === 1 && dv.viewDate === today,
      `division opened on the card's date with nothing assigned (12 assets / 13 files incl. 1 RAW/JPEG pair; 1 undated) (${J({ un: dv.unassigned, undated: dv.undated, date: dv.viewDate })})`);

    // gap suggestions — offered only when asked, never assign
    await withPopup(app, async (page) => { await page.selectOption('#dv-gap-min', '60'); });
    dv = (await waitFor(async () => { const v = await dview(app); return v.dv && v.dv.gapMinutes === 60 ? v : null; }, 5000)).dv;
    check(J(dv.gaps.map(g => g.time)) === J(['11:45', '14:00', '15:30', '19:00', '21:30']) && dv.events.length === 0,
      `gap suggestions are possible boundaries only (${J(dv.gaps.map(g => `${g.time}/${g.gapMinutes}m`))}); nothing assigned`);
    await withPopup(app, async (page) => { await page.selectOption('#dv-gap-min', ''); });

    // time ranges through the real UI
    const rangeIds = async () => (await dview(app)).dv.ranges.map(r => r.id);
    const addRange = async (page) => { const n = (await rangeIds()).length; await page.click('#dv-add-range'); return (await waitFor(async () => { const ids = await rangeIds(); return ids.length === n + 1 ? ids[n] : null; }, 5000)); };
    const setTimes = async (page, id, start, end) => {
      const inputs = page.locator(`.dv-range[data-id="${id}"] input.dv-time`);
      await inputs.nth(0).fill(start); await inputs.nth(0).dispatchEvent('change');
      await inputs.nth(1).fill(end); await inputs.nth(1).dispatchEvent('change');
      await waitFor(async () => { const r = (await dview(app)).dv.ranges.find(x => x.id === id); return r && r.start === start.slice(0, 5) && r.end === end.slice(0, 5); }, 5000);
      await page.click('#dv-sub');   // leave the inputs so the list may re-render
    };
    const chooseEvent = async (page, id, folder) => {
      await page.click(`.dv-range[data-id="${id}"] .dv-event-btn`);
      await page.waitForSelector('#dv-chooser:not([hidden]) #dv-chooser-list .picker-item', { timeout: 10000 });
      await page.locator('#dv-chooser-list .picker-item', { hasText: folder }).first().click();
      await page.click('#dv-chooser-use');
      await waitFor(async () => (await dview(app)).dv.ranges.find(x => x.id === id)?.eventId === folder, 5000);
    };
    const R = {};
    await withPopup(app, async (page) => {
      R.a = await addRange(page); await setTimes(page, R.a, '09:00:00', '11:30:00'); await chooseEvent(page, R.a, E1);
      R.b = await addRange(page); await setTimes(page, R.b, '11:30:00', '12:30:00'); await chooseEvent(page, R.b, E2);
      R.c = await addRange(page); await setTimes(page, R.c, '12:30:00', '15:00:00'); await chooseEvent(page, R.c, E1);
      R.d = await addRange(page); await setTimes(page, R.d, '21:00:00', '02:00:00'); await chooseEvent(page, R.d, E3);
      R.e = await addRange(page);
      await page.selectOption(`.dv-range[data-id="${R.e}"] .dv-range-date`, earlier);
      await waitFor(async () => (await dview(app)).dv.ranges.find(x => x.id === R.e)?.date === earlier, 5000);
      await setTimes(page, R.e, '09:00:00', '11:00:00'); await chooseEvent(page, R.e, E2);
    });
    dv = (await dview(app)).dv;
    const ev = (id) => dv.events.find(e => e.eventId === id) || { assets: 0, files: 0 };
    check(ev(E1).assets === 5 && ev(E1).files === 6, `E1: two non-contiguous ranges consolidate — 5 assets / 6 files incl. the pair and the boundary photo (${J(ev(E1))})`);
    check(ev(E2).assets === 3 && ev(E2).files === 3, `E2: intermediate 30-min event + earlier-date range (${J(ev(E2))})`);
    check(ev(E3).assets === 2, `E3: the range past midnight takes 21:30 and next-day 00:30 (${J(ev(E3))})`);
    check(dv.unassigned.assets === 2 && dv.conflicts.assets === 0, `unassigned between ranges: 15:30 and 19:00 (${J(dv.unassigned)})`);
    check(dv.ranges.find(r => r.id === R.d).nextDay === true, 'the midnight range is shown as running into the next day');

    // overlap → conflict → blocked; then corrected
    await withPopup(app, async (page) => { await setTimes(page, R.b, '11:00:00', '12:30:00'); });
    dv = (await dview(app)).dv;
    check(dv.conflicts.assets === 0 && dv.ranges.find(r => r.id === R.a).overlaps.length === 1,
      `overlap with no photo inside it is reported on both ranges but blocks nothing (${J(dv.ranges.find(r => r.id === R.a).overlaps)})`);
    await withPopup(app, async (page) => { await setTimes(page, R.b, '09:20:00', '12:30:00'); });
    dv = (await dview(app)).dv;
    check(dv.conflicts.assets === 1 && dv.review.blockers.includes('conflicts'), `a photo in two ranges with different events is a conflict and blocks the import (${J(dv.conflicts)})`);
    await withPopup(app, async (page) => {
      await page.waitForSelector('.dv-range-warn[data-kind="bad"]', { timeout: 5000 });
      await page.waitForFunction(() => /different events|Adjust/.test(document.getElementById('dv-ready').textContent), null, { timeout: 5000 });
      await shoot(page, shots, '2-divide-conflict'); shotsTaken.push('2-divide-conflict');
      await page.click('#dv-review');
      await page.waitForSelector('#dv-review-panel:not([hidden])', { timeout: 5000 });
      const blocked = await page.$eval('#dv-review-import', b => b.disabled);
      check(blocked && /different events/.test(await page.textContent('#dv-review-block')), 'the review blocks Import with a specific explanation');
      await page.click('#dv-review-cancel');
      await setTimes(page, R.b, '11:30:00', '12:30:00');
    });
    check((await dview(app)).dv.conflicts.assets === 0, 'conflict resolved by correcting the time');

    // Split Here on a photo, then undo by removing the new range; boundary move keeps ranges adjacent
    await withPopup(app, async (page) => {
      await page.locator('.dv-row', { hasText: 'IMG_0004.JPG' }).first().click();
      await page.click('#dv-split');
      await waitFor(async () => (await dview(app)).dv.ranges.length === 6, 5000);
    });
    dv = (await dview(app)).dv;
    const split = dv.ranges[dv.ranges.findIndex(r => r.id === R.b) + 1];
    check(split && split.start === '12:10' && split.end === '12:30' && split.eventId === null && dv.ranges.find(r => r.id === R.b).end === '12:10',
      `Split Here: range ${J(dv.ranges.find(r => r.id === R.b))} + new unassigned ${J(split)}`);
    await withPopup(app, async (page) => {
      await shoot(page, shots, '3-split-here'); shotsTaken.push('3-split-here');
      await page.click(`.dv-range[data-id="${split.id}"] .dv-remove`);
      await waitFor(async () => (await dview(app)).dv.ranges.length === 5, 5000);
      await setTimes(page, R.b, '11:30:00', '12:30:00');
      // R.c starts exactly where R.b ends: R.b end ▶ takes the 12:30 boundary photo and R.c follows
      await page.click(`.dv-range[data-id="${R.b}"] button[aria-label$="end one photo later"]`);
      await waitFor(async () => (await dview(app)).dv.ranges.find(r => r.id === R.b).end === '12:30', 5000).catch(() => null);
    });
    dv = (await dview(app)).dv;
    const rb = dv.ranges.find(r => r.id === R.b), rc = dv.ranges.find(r => r.id === R.c);
    check(rb.end !== '12:30' && rb.end === rc.start && ev(E2).assets >= 3,
      `boundary ▶ moved R2's end past the 12:30 photo and R3's start moved with it (${rb.end} / ${rc.start})`);
    await withPopup(app, async (page) => { await page.click(`.dv-range[data-id="${R.b}"] button[aria-label$="end one photo earlier"]`); });
    await waitFor(async () => (await dview(app)).dv.ranges.find(r => r.id === R.b).end === '12:30', 5000);
    dv = (await dview(app)).dv;
    check(ev(E1).assets === 5 && ev(E2).assets === 3, 'boundary ◀ restores the shared 12:30 boundary');

    // Create New Event with the REAL Event Creator, for a 15:00–16:00 range
    let NEW = null;
    await withPopup(app, async (page) => {
      R.f = await addRange(page); await setTimes(page, R.f, '15:00:00', '16:00:00');
      await page.click(`.dv-range[data-id="${R.f}"] .dv-event-btn`);
      await page.waitForSelector('#dv-chooser:not([hidden]) #dv-chooser-list .picker-item', { timeout: 10000 });
      await shoot(page, shots, '4-event-chooser'); shotsTaken.push('4-event-chooser');
      await page.click('#dv-chooser-new');
    });
    const opened = await main.waitForFunction(() => EventMgmt.isOpen() && EventMgmt.getMode() === 'create', null, { timeout: 20000 }).then(() => true, () => false);
    check(opened, 'Create New Event opens the existing Event Creator form in the main window');
    if (opened) {
      await main.waitForSelector('#evHijriYear', { timeout: 10000 });
      await main.fill('#evHijriYear', '1448'); await main.fill('#evHijriMonth', '05'); await main.fill('#evHijriDay', '01');
      const compId = await main.evaluate(() => document.querySelector('.ec-comp-row').dataset.compId);
      const t1 = main.locator(`#ecET-${compId}`); await t1.locator('input').click(); await t1.locator('input').fill('Ziyarat');
      await t1.locator('.tac-item').first().waitFor({ state: 'visible', timeout: 5000 }); await t1.locator('.tac-item').first().click();
      const c1 = main.locator('#ecGlobalCityDD'); await c1.locator('input').click(); await c1.locator('input').fill('Mundra');
      await c1.locator('.tac-item').first().waitFor({ state: 'visible', timeout: 5000 }); await c1.locator('.tac-item').first().click();
      await main.waitForTimeout(400);
      await main.click('#emmCreateBtn');
      await main.waitForFunction(() => !EventMgmt.isOpen(), null, { timeout: 20000 });
    }
    const afterNew = await waitFor(async () => { const v = await dview(app); const r = v.dv && v.dv.ranges.find(x => x.id === R.f); return r && r.eventId ? v : null; }, 20000);
    NEW = afterNew && afterNew.dv.ranges.find(x => x.id === R.f).eventId;
    check(!!NEW && fs.existsSync(path.join(evDir(NEW), 'event.json')) && afterNew.dv.notice === 'new-event-selected',
      `back from the Event Creator: the new event "${NEW}" is selected for its range`);
    check(afterNew && afterNew.view.mode === 'divide' && afterNew.dv.ranges.length === 6 && [R.a, R.b, R.c, R.d, R.e].every(id => afterNew.dv.ranges.find(r => r.id === id).eventId),
      'every other range and destination is preserved; the companion returned to the division');
    check(!fs.existsSync(path.join(evDir(NEW), 'Dump')), 'nothing imported automatically after creating the event');

    // reopen the companion: the division is restored
    await mainRequire(app, '../services/companionService', 'm.hidePopup(); return true;');
    await sleep(800);
    await withPopup(app, async (page) => {
      await page.waitForSelector('#dv:not([hidden]) .dv-range', { timeout: 10000 });
      const n = await page.$$eval('.dv-range', els => els.length);
      check(n === 6, `reopening the popup restores the division (${n} ranges)`);
      await page.waitForFunction(() => document.querySelectorAll('.dv-thumb img').length > 3, null, { timeout: 15000 }).catch(() => null);
      const imgs = await page.$$eval('.dv-thumb img', els => els.length);
      check(imgs > 3, `thumbnails from the existing preview pipeline, visible rows only (${imgs})`);
      await shoot(page, shots, '5-divide-ready'); shotsTaken.push('5-divide-ready');
    });
    dv = (await dview(app)).dv;
    check(dv.review.blockers.length === 0 && dv.review.totalFiles === 12 && dv.unassigned.assets === 1,
      `ready: 12 files into 4 events; 19:00 photo stays unassigned (${J({ batches: dv.review.batches, un: dv.unassigned.assets })})`);

    // review → import, with a responsiveness probe
    await withPopup(app, async (page) => {
      await page.click('#dv-review');
      await page.waitForSelector('#dv-review-panel:not([hidden]) .dv-review-event', { timeout: 10000 });
      const rv = await page.evaluate(() => ({ events: [...document.querySelectorAll('.dv-review-event')].map(e => e.textContent), meta: document.getElementById('dv-review-meta').textContent, note: document.getElementById('dv-review-note').textContent, btn: document.getElementById('dv-review-import').textContent }));
      check(rv.events.length === 4 && /Direct Archive/.test(rv.meta) && /Testali Bhai/.test(rv.meta) && /not assigned/.test(rv.note) && /12 files/.test(rv.btn),
        `review: events, photographer, archive mode, unassigned and total (${J(rv).slice(0, 400)})`);
      await shoot(page, shots, '6-review'); shotsTaken.push('6-review');
      await page.click('#dv-review-import');
    });
    const toDump = async (page) => {
      if (await page.evaluate(() => document.querySelector('.popup').dataset.view === 'divide')) {
        await page.click('#dv-back');
        await page.waitForFunction(() => document.querySelector('.popup').dataset.view === 'expanded', null, { timeout: 10000 });
      }
      await enterDump(page);
    };
    const done1 = async () => { const v = await dview(app); return v.dv && v.dv.op && v.dv.op.state !== 'pending'; };
    /** Review → Import in the real popup, then wait for THIS import's outcome (never a previous one). */
    const reviewAndImport = async (ms = 90000) => {
      const before = (await dview(app)).dv?.op?.at || 0;
      await withPopup(app, async (page) => { await page.click('#dv-review'); await page.waitForSelector('#dv-review-panel:not([hidden]) .dv-review-event'); await page.click('#dv-review-import'); });
      return waitFor(async () => { const v = await dview(app); const o = v.dv && v.dv.op; return o && o.at !== before && o.state !== 'pending' ? o : null; }, ms);
    };
    const rtt = await sampleRtt(app, done1);
    const op1 = (await dview(app)).dv.op;
    check(rtt.max < 500, `main process responsive during the 12-file multi-event import (${rtt.n} round trips, max ${rtt.max} ms)`);
    check(op1.state === 'completed' && op1.events.length === 4 && op1.events.every(e => e.status === 'completed'),
      `ONE plan, four event transactions, each completed (${J(op1.events.map(e => [e.eventId.slice(0, 14), e.status, e.copied]))})`);
    const dumpOf = (f, ph = P1) => path.join(evDir(f), 'Dump', ph);
    const e1Files = await listFiles(dumpOf(E1));
    check(e1Files.length === 6 && e1Files.includes('IMG_0002.CR3') && e1Files.includes('IMG_0002.JPG') && e1Files.filter(f => /^IMG_0001/.test(f)).length === 2,
      `E1/Dump/${P1}: pair together, boundary photo, both IMG_0001 (second renamed, not overwritten) (${J(e1Files)})`);
    check(J(await listFiles(dumpOf(E2))) === J(['IMG_0003.JPG', 'IMG_0004.JPG', 'IMG_0011.JPG']), `E2/Dump/${P1}: 11:45, 12:10 and the earlier-date photo`);
    check(J(await listFiles(dumpOf(E3))) === J(['IMG_0009.JPG', 'IMG_0010.JPG']), `E3/Dump/${P1}: 21:30 and next-day 00:30`);
    check(J(await listFiles(dumpOf(NEW))) === J(['IMG_0007.JPG']), 'new event/Dump: its 15:30 photo');
    const everywhere = (await listFiles(collDir)).filter(f => /IMG_0008|IMG_0012/.test(f));
    check(everywhere.length === 0, 'unassigned and undated photos were not imported anywhere');
    const noPc = (await listFiles(collDir)).every(f => !/(^|\/)PC\d+-/.test(f) && !/Dump\/[^/]+\/[^/]+\/[^/]+$/.test(f.replace(/\/VIDEO\//, '/')));
    check(noPc, 'no PC sequence and no component folder inside any Dump');
    for (const f of [E1, E2, E3, NEW]) {
      const ej = JSON.parse(await fsp.readFile(path.join(evDir(f), 'event.json'), 'utf8'));
      const dumps = (ej.imports || []).filter(i => i.destination === 'dump');
      check(ej.status === 'complete' && dumps.length === 1 && dumps[0].photographer === P1 && dumps[0].source && dumps[0].source.type === 'memory-card' && !(ej.components || []).some(c => /dump/i.test(c.folderName || '')),
        `${f.slice(0, 18)}…: event.json has one Dump import entry for ${P1}; Dump is not a component`);
    }
    await waitFor(async () => (await dview(app)).dv.op.events.every(e => e.metadata && e.metadata.state !== 'writing'), 90000);
    const op1m = (await dview(app)).dv.op;
    check(op1m.events.every(e => e.metadata.state === 'complete'), `metadata outcome per event (${J(op1m.events.map(e => e.metadata))})`);
    for (const [f, file, kw] of [[E1, 'IMG_0005.JPG', 'Waaz'], [E2, 'IMG_0003.JPG', 'Ziyafat'], [E3, 'IMG_0010.JPG', null]]) {
      const tags = await et.read(path.join(dumpOf(f), file), ['-G1']);
      const creator = [].concat(tags['XMP-dc:Creator'] || tags.Creator || []);
      const subj = [].concat(tags['XMP-dc:Subject'] || tags.Subject || []);
      check(creator.includes(P1) && (!kw || subj.includes(kw)) && !creator.some(c => /dump/i.test(c)), `${file} in ${f.slice(0, 18)}…: Creator ${P1}${kw ? `, keyword ${kw}` : ' (multi-component: no component keyword)'}`);
    }
    check(J(await hashTree(cardA)) === J(cardABefore), 'card A untouched: nothing deleted, renamed or modified on the source');
    await withPopup(app, async (page) => {
      await page.waitForSelector('#dv-results:not([hidden]) .dv-result', { timeout: 5000 });
      await shoot(page, shots, '7-results'); shotsTaken.push('7-results');
    });
    dv = (await dview(app)).dv;
    check(dv.review.totalFiles === 0 && dv.imported.files === 12 && dv.unassigned.assets === 1, `after import: assigned files are "already imported", nothing re-planned (${J({ total: dv.review.totalFiles, imported: dv.imported })})`);
    const journal = fs.readdirSync(path.join(ud, 'event-dump-plans')).filter(f => f.endsWith('.json'));
    const jrec = journal.length ? JSON.parse(fs.readFileSync(path.join(ud, 'event-dump-plans', journal[0]), 'utf8')) : null;
    check(jrec && jrec.state === 'completed' && jrec.batches.length === 4 && !J(jrec).includes(work), `durable plan record in the profile (${journal.length} file; no source path)`);

    // ═══ S2: card change during assignment · mixed cameras ═══════════════════════
    const cardB = path.join(work, 'CARD_B'), b100 = path.join(cardB, 'DCIM', '100MIXED');
    await put(b100, 'CAN_0001.JPG', today, '10:00:00');
    await put(b100, 'CAN_0002.JPG', today, '10:05:00');
    await put(b100, 'NIK_0001.JPG', today, '10:10:00', { Make: 'NIKON CORPORATION', Model: 'NIKON Z 9' });
    await put(b100, 'NIK_0002.JPG', today, '10:15:00', { Make: 'NIKON CORPORATION', Model: 'NIKON Z 9' });
    fs.writeFileSync(iso.drivesFile, J([fakeDrive(cardB, 'CARD_B')]));
    const bReady = await waitFor(async () => { const v = await dview(app); return v.src && v.src.label === 'CARD_B' && v.src.assessment?.state === 'complete' ? v : null; }, 60000);
    check(bReady && bReady.view.mode === 'compact' && !bReady.dv, 'card swapped: the division of card A is gone; card B starts in the overview');
    await withPopup(app, async (page) => {
      await toDump(page);
      if ((await dumpView(app)).card?.photographer !== P1) { await pickPhotographer(page, P1); await waitFor(async () => (await dumpView(app)).card?.photographer === P1, 5000); }
      await page.click('#xp-divide');
      await page.waitForSelector('#dv:not([hidden])', { timeout: 10000 });
    });
    dv = (await waitFor(async () => { const v = await dview(app); return v.dv && v.dv.ready ? v : null; }, 10000)).dv;
    check(dv.ranges.length === 0 && dv.events.length === 0, 'no ranges or destinations carried over from card A');
    check(dv.cameraMode === 'per-camera' && dv.cameras.length === 2 && dv.cameras.every(c => c.photographer === null),
      `two cameras: each camera's photographer must be chosen — never all as the card's first camera (${J(dv.cameras.map(c => c.label))})`);
    await withPopup(app, async (page) => {
      const id = await addRange(page); await setTimes(page, id, '09:00:00', '11:00:00'); await chooseEvent(page, id, E2);
      const sels = page.locator('#dv-ph-body select');
      const labels = await page.$$eval('#dv-ph-body .dv-cam-name', els => els.map(e => e.textContent));
      for (let i = 0; i < labels.length; i++) await sels.nth(i).selectOption(/Canon/.test(labels[i]) ? P1 : P2);
      await waitFor(async () => (await dview(app)).dv.review.blockers.length === 0, 5000);
      await shoot(page, shots, '8-per-camera'); shotsTaken.push('8-per-camera');
    });
    dv = (await dview(app)).dv;
    check(J(dv.review.batches.map(b => [b.photographer, b.files]).sort()) === J([[P1, 2], [P2, 2]]), `per-camera batches into one event (${J(dv.review.batches)})`);
    check((await reviewAndImport())?.state === 'completed', 'mixed-camera plan imported');
    check(J(await listFiles(dumpOf(E2, P1))).includes('CAN_0001.JPG') && J(await listFiles(dumpOf(E2, P2))) === J(['NIK_0001.JPG', 'NIK_0002.JPG']) && !(await listFiles(dumpOf(E2, P1))).some(f => /NIK/.test(f)),
      `E2/Dump/${P1} has the Canon photos, E2/Dump/${P2} the Nikon photos`);

    // ═══ S3: partial failure → retry ══════════════════════════════════════
    const cardC = path.join(work, 'CARD_C'), c100 = path.join(cardC, 'DCIM', '100CANON');
    for (let i = 1; i <= 3; i++) await put(c100, `C1_${i}.JPG`, today, `08:0${i}:00`);
    for (let i = 1; i <= 3; i++) await put(c100, `C2_${i}.JPG`, today, `16:0${i}:00`);
    fs.writeFileSync(iso.drivesFile, J([fakeDrive(cardC, 'CARD_C')]));
    await waitFor(async () => { const v = await dview(app); return v.src && v.src.label === 'CARD_C' && v.src.assessment?.state === 'complete'; }, 60000);
    await withPopup(app, async (page) => {
      await toDump(page);
      if ((await dumpView(app)).card?.photographer !== P1) { await pickPhotographer(page, P1); await waitFor(async () => (await dumpView(app)).card?.photographer === P1, 5000); }
      await page.click('#xp-divide'); await page.waitForSelector('#dv:not([hidden])');
      const x = await addRange(page); await setTimes(page, x, '08:00:00', '09:00:00'); await chooseEvent(page, x, E1);
      const y = await addRange(page); await setTimes(page, y, '16:00:00', '17:00:00'); await chooseEvent(page, y, E3);
    });
    // E3's Dump/<photographer> folder cannot be written: an event-local failure
    const lockedDir = dumpOf(E3);
    await fsp.chmod(lockedDir, 0o555);
    const op3 = await reviewAndImport();
    check(op3.state !== 'completed' && op3.events.find(e => e.eventId === E1).status === 'completed' && op3.events.find(e => e.eventId === E3).status !== 'completed',
      `partial failure is never reported as complete (${op3.state}: ${J(op3.events.map(e => [e.eventId.slice(0, 14), e.status, e.copied, e.errors]))})`);
    check(J((await listFiles(dumpOf(E1))).filter(f => /^C1_/.test(f))) === J(['C1_1.JPG', 'C1_2.JPG', 'C1_3.JPG']), 'the successful event stays valid');
    await withPopup(app, async (page) => { await shoot(page, shots, '9-partial-failure'); shotsTaken.push('9-partial-failure'); });
    await fsp.chmod(lockedDir, 0o755);
    dv = (await dview(app)).dv;
    check(dv.ranges.length === 2 && dv.review.totalFiles === 3, `ranges kept for the retry; only the failed event's 3 files are planned (${dv.review.totalFiles})`);
    const op3r = await reviewAndImport();
    const e1c = (await listFiles(dumpOf(E1))).filter(f => /^C1_/.test(f)), e3c = (await listFiles(dumpOf(E3))).filter(f => /^C2_/.test(f));
    check(op3r?.state === 'completed' && J(e3c) === J(['C2_1.JPG', 'C2_2.JPG', 'C2_3.JPG']) && e1c.length === 3,
      `retry imported the rest once — no duplicates (${J({ e1c, e3c })})`);

    // ═══ S4: card removed during the import ═══════════════════════════════
    const cardD = path.join(work, 'CARD_D'), d100 = path.join(cardD, 'DCIM', '100CANON');
    for (let i = 1; i <= 40; i++) await put(d100, `D1_${String(i).padStart(2, '0')}.JPG`, today, `07:${String(i).padStart(2, '0')}:00`);
    for (let i = 1; i <= 40; i++) await put(d100, `D2_${String(i).padStart(2, '0')}.JPG`, today, `18:${String(i).padStart(2, '0')}:00`);
    fs.writeFileSync(iso.drivesFile, J([fakeDrive(cardD, 'CARD_D')]));
    await waitFor(async () => { const v = await dview(app); return v.src && v.src.label === 'CARD_D' && v.src.assessment?.state === 'complete'; }, 90000);
    const setupD = async () => withPopup(app, async (page) => {
      await toDump(page);
      if ((await dumpView(app)).card?.photographer !== P1) { await pickPhotographer(page, P1); await waitFor(async () => (await dumpView(app)).card?.photographer === P1, 5000); }
      await page.click('#xp-divide'); await page.waitForSelector('#dv:not([hidden])');
      const x = await addRange(page); await setTimes(page, x, '07:00:00', '08:00:00'); await chooseEvent(page, x, E2);
      const y = await addRange(page); await setTimes(page, y, '18:00:00', '19:00:00'); await chooseEvent(page, y, E3);
    });
    await setupD();
    await withPopup(app, async (page) => { await page.click('#dv-review'); await page.waitForSelector('#dv-review-panel:not([hidden])'); await page.click('#dv-review-import'); });
    await waitFor(async () => { const v = await dview(app); return v.dv && v.dv.op && v.dv.op.state === 'pending' && v.dv.op.events[0].status !== 'waiting'; }, 20000, 50);
    const hidden = path.join(work, 'CARD_D_removed');
    await fsp.rename(cardD, hidden);
    const op4 = await waitFor(async () => { const v = await dview(app); if (!v.dv) return { gone: true }; return v.dv.op && v.dv.op.state !== 'pending' ? v.dv.op : null; }, 60000);
    const e3dEvent = JSON.parse(await fsp.readFile(path.join(evDir(E3), 'event.json'), 'utf8'));
    check(!!op4 && (op4.gone || op4.state !== 'completed'), `card removed mid-import: not reported complete (${J(op4 && (op4.gone ? 'card gone' : op4.events.map(e => e.status)))})`);
    check(e3dEvent.status !== 'in-progress', `no event left "in progress" (${e3dEvent.status})`);
    await fsp.rename(hidden, cardD);
    fs.writeFileSync(iso.drivesFile, J([]));
    check(!!(await waitFor(async () => ((await diag(app)).snapshot.sources || []).length === 0, 20000)), 'card D detached: its division is forgotten');
    fs.writeFileSync(iso.drivesFile, J([fakeDrive(cardD, 'CARD_D')]));
    await waitFor(async () => { const v = await dview(app); return v.src && v.src.label === 'CARD_D' && v.src.assessment?.state === 'complete'; }, 90000);
    await setupD();
    let probing = true;
    const probe = (async () => { const r = await sampleRtt(app, async () => !probing); return r; })();
    const op4r = await reviewAndImport();
    probing = false;
    const rtt4 = await probe;
    check(rtt4.n >= 3 && rtt4.max < 500, `main process responsive throughout an 80-file, two-event import (${rtt4.n} round trips, max ${rtt4.max} ms, median ${rtt4.p50} ms)`);
    const d1 = (await listFiles(dumpOf(E2))).filter(f => /^D1_/.test(f)), d2 = (await listFiles(dumpOf(E3))).filter(f => /^D2_/.test(f));
    check(op4r?.state === 'completed' && d1.length === 40 && d2.length === 40 && [...d1, ...d2].every(f => /^D[12]_\d\d\.JPG$/.test(f)),
      `retry after removal: every photo imported exactly once (${d1.length} + ${d2.length}, no "_1" copies)`);

    // ═══ S5: Local First ═════════════════════════════════════════════════
    await main.evaluate(async (s) => { await window.api.setLocalStagingRoot(s); await window.api.setDefaultImportMode('local-first'); }, stagingRoot);
    const cardE = path.join(work, 'CARD_E'), e100 = path.join(cardE, 'DCIM', '100CANON');
    await put(e100, 'LF_0001.JPG', today, '10:00:00'); await put(e100, 'LF_0002.JPG', today, '17:00:00');
    fs.writeFileSync(iso.drivesFile, J([fakeDrive(cardE, 'CARD_E')]));
    await waitFor(async () => { const v = await dview(app); return v.src && v.src.label === 'CARD_E' && v.src.assessment?.state === 'complete'; }, 60000);
    await withPopup(app, async (page) => {
      await toDump(page);
      if ((await dumpView(app)).card?.photographer !== P2) { await pickPhotographer(page, P2); await waitFor(async () => (await dumpView(app)).card?.photographer === P2, 5000); }
      await page.click('#xp-divide'); await page.waitForSelector('#dv:not([hidden])');
      const x = await addRange(page); await setTimes(page, x, '09:00:00', '12:00:00'); await chooseEvent(page, x, E1);
      const y = await addRange(page); await setTimes(page, y, '16:00:00', '18:00:00'); await chooseEvent(page, y, E2);
      await page.click('#dv-review'); await page.waitForSelector('#dv-review-panel:not([hidden]) .dv-review-event');
      check(/Local First/.test(await page.textContent('#dv-review-meta')), 'review states Local First');
      await page.click('#dv-review-cancel');
    });
    const op5 = await reviewAndImport();
    const st1 = path.join(stagingRoot, COLL, E1, 'Dump', P2, 'LF_0001.JPG'), st2 = path.join(stagingRoot, COLL, E2, 'Dump', P2, 'LF_0002.JPG');
    check(op5?.state === 'completed' && fs.existsSync(st1) && fs.existsSync(st2) && !fs.existsSync(dumpOf(E1, P2)), 'Local First: each event staged in its own staging Dump; the archive is not written directly');
    const jobs = await waitFor(async () => { const sq = await main.evaluate(() => window.api.getSyncQueue()); const js = (sq.jobs || []).filter(j => [E1, E2].includes(j.event || '')); return js.length >= 2 ? js : null; }, 30000, 500);
    check(!!jobs && jobs.length >= 2, `a sync job per event (${J((jobs || []).map(j => j.event))})`);
    // The staging copy is cleared after a sync; the same photos offered again (as after the import
    // history rolled off) must not be staged — and so synced — a second time.
    for (const [st, f] of [[st1, E1], [st2, E2]]) { const dest = path.join(dumpOf(f, P2), path.basename(st)); await fsp.mkdir(path.dirname(dest), { recursive: true }); await fsp.copyFile(st, dest); await fsp.rm(st); }
    const dumpsBefore = J([await hashTree(dumpOf(E1, P2)), await hashTree(dumpOf(E2, P2))]);
    const g = await main.evaluate((req) => EventDumpImport.runPlan(req), { collectionPath: path.join(archiveRoot, COLL), batches: [
      { folderName: E1, eventPath: path.join(archiveRoot, COLL, E1), photographer: P2, files: [path.join(e100, 'LF_0001.JPG')] },
      { folderName: E2, eventPath: path.join(archiveRoot, COLL, E2), photographer: P2, files: [path.join(e100, 'LF_0002.JPG')] },
    ], source: { label: 'CARD_E', path: cardE } }).catch(e => ({ ok: false, error: String(e) }));
    check(g && g.ok && g.e0_copied === 0 && g.e0_skipped === 1 && g.e1_copied === 0 && g.e1_skipped === 1 && !fs.existsSync(st1) && !fs.existsSync(st2),
      `Local First duplicate guard: already in the archive Dump → skipped, not staged again (${J(g).slice(0, 220)})`);
    check(J([await hashTree(dumpOf(E1, P2)), await hashTree(dumpOf(E2, P2))]) === dumpsBefore, 'the archive Dump folders were only read by the guard (byte-identical)');
    await main.evaluate(async () => { await window.api.setDefaultImportMode('direct-nas'); });

    // ═══ S6: refusals ════════════════════════════════════════════════════
    const cardF = path.join(work, 'CARD_F'), f100 = path.join(cardF, 'DCIM', '100CANON');
    await put(f100, 'RF_0001.JPG', today, '10:00:00');
    fs.writeFileSync(iso.drivesFile, J([fakeDrive(cardF, 'CARD_F')]));
    await waitFor(async () => { const v = await dview(app); return v.src && v.src.label === 'CARD_F' && v.src.assessment?.state === 'complete'; }, 60000);
    await withPopup(app, async (page) => {
      await toDump(page);
      if ((await dumpView(app)).card?.photographer !== P1) { await pickPhotographer(page, P1); await waitFor(async () => (await dumpView(app)).card?.photographer === P1, 5000); }
      await page.click('#xp-divide'); await page.waitForSelector('#dv:not([hidden])');
      const x = await addRange(page); await setTimes(page, x, '09:00:00', '11:00:00'); await chooseEvent(page, x, E3);
    });
    await main.evaluate(async (bad) => { await window.api.setNasRoot(bad); await window.api.setMainArchiveRoot(bad); }, path.join(work, 'offline-nas'));
    const off = await withPopup(app, (page) => page.evaluate(async () => { const s = (await window.companion.getSnapshot()).sources[0].sourceId; return [await window.companion.divideReview(s), await window.companion.divideImport(s)]; }));
    check(off[0].archive.problem === 'archive-offline' && off[1].reason === 'archive-offline', `archive offline: review explains, import refused (${J(off[0].archive)} / ${off[1].reason})`);
    await main.evaluate(async (r) => { await window.api.setNasRoot(r); await window.api.setMainArchiveRoot(r); }, archiveRoot);
    await fsp.rename(path.join(evDir(E3), 'event.json'), path.join(evDir(E3), 'event.json.away'));
    const gone = await withPopup(app, (page) => page.evaluate(async () => { const s = (await window.companion.getSnapshot()).sources[0].sourceId; return window.companion.divideImport(s); }));
    check(gone.reason === 'event-unavailable', `assigned event no longer valid: import refused (${gone.reason})`);
    await fsp.rename(path.join(evDir(E3), 'event.json.away'), path.join(evDir(E3), 'event.json'));
    check(!fs.existsSync(dumpOf(E3)) || !(await listFiles(dumpOf(E3))).includes('RF_0001.JPG'), 'nothing imported by a refused plan');

    log('screenshots:', shotsTaken.join(', '), process.env.AI_EQI2_SHOTS ? `→ ${shots}` : '(temp, removed)');
    const qg = H.quitGuardSummary(iso);
    log(H.formatQuitGuardSummary(qg));
    check(qg.failed === 0 && qg.unguarded === 0, 'no external quit got through');
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
    await fsp.chmod(path.join(work, 'archive'), 0o755).catch(() => {});
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
