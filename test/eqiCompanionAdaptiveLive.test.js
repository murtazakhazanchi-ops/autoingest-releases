'use strict';
// LIVE (AI-FEAT-064 EQI-1.1): the adaptive menu-bar companion, measured on the REAL popup window —
// compact card overview ↔ expanded Event Dump (window bounds, anchoring, state kept), the full
// event name, the photographer search, the companion-owned Change Event picker, Import to Dump with
// the main window in the background, the busy-archive dialog still reaching the operator, and the
// sanitized real-world Dump event.json. Screenshots of each state are saved for inspection.
//
// Isolation (test/support/liveTestHarness.js): test-only app identity, temp profile, drivelist
// stub (synthetic cards are temp folders), external-Quit guard. Synthetic JPEGs, synthetic names
// and a throwaway archive only; production profile and Keychain are checked unchanged.
//
// Run: node test/eqiCompanionAdaptiveLive.test.js      (macOS)
//      AI_EQI11_SHOTS=<dir>  keeps the screenshots there (default: the temp work folder)

const { _electron: electron } = require('playwright-core');
const { ExifTool } = require('exiftool-vendored');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const H = require('./support/liveTestHarness');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_BIN = require(path.join(PROJECT_ROOT, 'node_modules', 'electron'));
const COLL = 'CollEQI11';
const P1 = 'M Testmurtaza Kharwala';           // the stored name carries an initial the operator leaves out
const P2 = 'Testhusain Bhai';
const FILLER = Array.from({ length: 300 }, (_, i) => `Testfill${String(i).padStart(3, '0')} Bhai`);

let failures = 0;
const log = (...a) => console.log('[eqi11-live]', ...a);
const check = (c, m) => { if (c) log('PASS —', m); else { failures++; log('FAIL —', m); } };
const J = (x) => JSON.stringify(x);
const { sleep, localDate, fakeDrive, waitFor, createHelpers, noiseJpeg: _noise, listFiles } = require('./support/eventDumpLiveHelpers');
const { mainRequire, passSplash, withPopup, dumpView, setActiveEvent, enterDump, backToOverview, pickPhotographer } = createHelpers({ projectRoot: PROJECT_ROOT });
const noiseJpeg = () => _noise(PROJECT_ROOT);

/** Every BrowserWindow, from the main process: which page, bounds, visible, focused. */
const windows = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => ({
  page: (w.webContents.getURL().split('/').pop() || ''), bounds: w.getBounds(), visible: w.isVisible(), focused: w.isFocused(),
})));
const popupWin = async (app) => (await windows(app)).find(w => w.page === 'companion.html') || null;
/** Screenshot in BOTH themes (the companion follows the app/system theme): <name>-light/-dark.png */
async function shoot(page, dir, name) {
  const cur = await page.evaluate(() => document.documentElement.dataset.theme);
  for (const theme of [cur, cur === 'dark' ? 'light' : 'dark']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(400);   // let the buttons' colour transitions settle
    await page.screenshot({ path: path.join(dir, `${name}-${theme}.png`) });
  }
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, cur);
}
const mainWin = async (app) => (await windows(app)).find(w => w.page === 'index.html') || null;

(async () => {
  if (process.platform !== 'darwin') { log('SKIP — macOS only'); return; }
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-eqi11-live-'));
  const shots = process.env.AI_EQI11_SHOTS || path.join(work, 'shots');
  await fsp.mkdir(shots, { recursive: true });
  const ud = path.join(work, 'userData'); await fsp.mkdir(ud);
  const archiveRoot = path.join(work, 'archive'); await fsp.mkdir(archiveRoot);
  const collDir = path.join(archiveRoot, COLL);
  const iso = H.prepareIsolatedApp({ tag: 'eqi11', work, projectRoot: PROJECT_ROOT });
  const prodBefore = H.prodKeychainSnapshot();
  const testKcBefore = H.keychainHas(iso.keychainItem);
  const et = new ExifTool({ maxProcs: 2 });

  const today = localDate();
  const put = async (dir, name, date) => {
    await fsp.mkdir(dir, { recursive: true });
    const p = path.join(dir, name);
    await fsp.writeFile(p, await noiseJpeg());
    await et.write(p, { DateTimeOriginal: `${date.replace(/-/g, ':')} 10:00:00`, CreateDate: `${date.replace(/-/g, ':')} 10:00:00`, Make: 'Canon', Model: 'Canon EOS R5' }, { writeArgs: ['-overwrite_original'] });
    return p;
  };
  const cardA = path.join(work, 'CARD_A'), dcimA = path.join(cardA, 'DCIM', '100CANON');
  for (let i = 1; i <= 24; i++) await put(dcimA, `IMG_${String(i).padStart(4, '0')}.JPG`, today);
  const cardBefore = await listFiles(cardA);

  // Two events on the SAME Hijri date — the names differ only at the end, so a truncated name
  // could not tell them apart.
  const LONG_A = '1448-05-14 _01-Urs Mubarak-Majlis-Waaz-Raudat Tahera-Testcity';
  const LONG_B = '1448-05-14 _02-Urs Mubarak-Majlis-Waaz-Ziyafat-Raudat Tahera-Testcity-Saifee Masjid-Eastern Courtyard-Jamea Grounds';
  const REAL = '1448-05-13 _01-Urs Mubarak-Majlis-Waaz-Raudat Tahera-Testcity';
  const fixture = JSON.parse(await fsp.readFile(path.join(__dirname, 'fixtures', 'eqi11-realworld-dump-event.json'), 'utf8'));

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
    }, { archiveRoot, names: [P1, P2, ...FILLER] });
    const comp = (id, folderName, types) => ({ id, folderName, location: 'Raudat Tahera', city: 'Testcity', country: 'India', types, additionalKeywords: [] });
    await main.evaluate(async ({ defs }) => { for (const [d, data] of defs) await window.api.writeEventJson(d, data); }, { defs: [
      [path.join(collDir, LONG_A), { version: 1, hijriDate: '1448-05-14', sequence: 1, eventName: LONG_A.slice(14), components: [comp(1, 'Majlis-Raudat Tahera', ['Majlis']), comp(2, 'Waaz-Raudat Tahera', ['Waaz'])] }],
      [path.join(collDir, LONG_B), { version: 1, hijriDate: '1448-05-14', sequence: 2, eventName: LONG_B.slice(14), components: [comp(1, 'Ziyafat-Raudat Tahera', ['Ziyafat'])] }],
    ] });
    // The sanitized real-world Dump event: its event.json as found, plus its Dump folder (88 CR3 + 1 MP4).
    const realDir = path.join(collDir, REAL);
    const realDump = path.join(realDir, 'Dump', fixture.imports[0].photographer);
    await fsp.mkdir(realDump, { recursive: true });
    for (let i = 1; i <= 88; i++) await fsp.writeFile(path.join(realDump, `_MK_${String(i).padStart(4, '0')}.CR3`), 'cr3');
    await fsp.writeFile(path.join(realDump, 'MVI_0001.MP4'), 'mp4');
    await fsp.writeFile(path.join(realDir, 'event.json'), JSON.stringify(fixture, null, 2));
    const realBytes = await fsp.readFile(path.join(realDir, 'event.json'));

    await setActiveEvent(main, collDir, COLL, LONG_A);
    check(!!(await waitFor(async () => (await dumpView(app)).global?.event?.eventName === LONG_A, 15000)), 'companion shows the active event');
    fs.writeFileSync(iso.drivesFile, J([fakeDrive(cardA, 'CARD_A')]));
    const assessed = await waitFor(async () => { const v = await dumpView(app); return v.assessment?.state === 'complete' && v.card ? v.card : null; }, 60000);
    check(assessed && assessed.counts.selectedNew === 24, `card assessed: 24 new files today (${J(assessed && assessed.counts)})`);

    // ═══ 1. Compact card overview ═══
    await withPopup(app, async (page) => {
      await page.waitForSelector('.card-row .event-dump-btn:not([hidden])', { timeout: 20000 });
      const pw = await popupWin(app);
      check(pw && pw.bounds.width >= 340 && pw.bounds.width <= 380, `compact popup width ${pw && pw.bounds.width} px (340–380)`);
      check(await page.evaluate(() => document.querySelector('.popup').dataset.view) === 'compact', 'opens in the compact card overview');
      const sb = await page.evaluate(() => { const el = document.getElementById('card-list'); const cs = getComputedStyle(el, '::-webkit-scrollbar'); return { w: cs.width, ox: getComputedStyle(el).overflowX, hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth }; });
      check(sb.ox === 'hidden' && !sb.hScroll, `no horizontal scroll in the compact view (${J(sb)})`);
      await shoot(page, shots, '1-compact');
    });

    // ═══ 2. Expanded Event Dump ═══
    let compactBounds = null;
    await withPopup(app, async (page) => {
      compactBounds = (await popupWin(app)).bounds;
      await enterDump(page);
      await waitFor(async () => (await popupWin(app))?.bounds.width >= 580, 5000);
      const pw = await popupWin(app);
      const tray = (await mainRequire(app, '../services/companionService', 'return m.getDiagnostics();')).trayBounds;
      check(pw.bounds.width >= 580 && pw.bounds.width <= 650, `expanded popup width ${pw.bounds.width} px (580–650), height ${pw.bounds.height}`);
      check(pw.bounds.y === compactBounds.y, `expanded keeps the same top edge under the menu bar (y ${compactBounds.y} → ${pw.bounds.y})`);
      if (tray && tray.width > 0) {
        const cx = tray.x + tray.width / 2;
        check(cx >= pw.bounds.x && cx <= pw.bounds.x + pw.bounds.width, `stays anchored to the menu-bar icon (icon centre ${cx} within ${pw.bounds.x}…${pw.bounds.x + pw.bounds.width})`);
      }
      const name = await page.evaluate(() => { const el = document.getElementById('xp-event-name'); const cs = getComputedStyle(el); return { text: el.textContent, to: cs.textOverflow, ws: cs.whiteSpace, over: el.scrollWidth > el.clientWidth + 1, lines: Math.round(el.getBoundingClientRect().height / parseFloat(cs.lineHeight)) }; });
      check(name.text === LONG_A && name.to !== 'ellipsis' && !name.over, `the complete canonical event name is shown, never truncated (${J(name)})`);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'no horizontal scroll in the expanded view');
      check(await page.isVisible('#xp-import') && await page.isVisible('#back-btn') && await page.isVisible('#open-btn'), 'Import, Back to Card Overview and Open AutoIngest are on screen');
      await shoot(page, shots, '2-expanded');
    });

    // ═══ 3. Photographer search ═══
    // The app's own seed list is present too: queries below only ever match synthetic names, and
    // no photographer name is logged.
    const listBefore = (await dumpView(app)).global.photographers;
    await withPopup(app, async (page) => {
      await enterDump(page);
      await page.click('#xp-ph-input');
      await page.type('#xp-ph-input', 'testmurtaza khar');
      await page.waitForSelector('#xp-ph-list:not([hidden]) .combo-item', { timeout: 5000 });
      const offered = await page.$$eval('#xp-ph-list .combo-item', els => els.map(e => e.textContent));
      check(offered[0] === P1, `"testmurtaza khar" finds "${P1}" (the stored initial left out) first among ${offered.length}`);
      await shoot(page, shots, '3-photographer-search');
      await page.keyboard.press('Escape');
      check(await page.isHidden('#xp-ph-list'), 'Escape closes the suggestions (popup stays open)');
      check((await dumpView(app)).card?.photographer == null, 'typed text alone selects nothing');
      await page.fill('#xp-ph-input', '');
      await page.type('#xp-ph-input', 'testfill00');
      await page.waitForSelector('#xp-ph-list:not([hidden]) .combo-item', { timeout: 5000 });
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('Enter');
      const kb = await waitFor(async () => (await dumpView(app)).card?.photographer, 5000);
      check(!!kb && FILLER.includes(kb), 'keyboard: ArrowDown + Enter chooses an existing (synthetic) name');
      check(await page.$eval('#xp-import', b => b.disabled) === false, 'Import enabled once a photographer is chosen');
    });
    await withPopup(app, async (page) => {
      await enterDump(page);
      await pickPhotographer(page, P1, 'kharwala');
      check(!!(await waitFor(async () => (await dumpView(app)).card?.photographer === P1, 5000)), 'mouse: choosing a suggestion sets the photographer');
    });
    const listAfter = (await dumpView(app)).global.photographers;
    check(J(listAfter) === J(listBefore), `no photographer was created by searching (${listBefore.length} → ${listAfter.length} names)`);

    // ═══ 4. State kept across close / reopen and view switches ═══
    await mainRequire(app, '../services/companionService', 'm.hidePopup(); return true;');
    await waitFor(async () => !(await popupWin(app)), 5000);
    await withPopup(app, async (page) => {
      await page.waitForFunction(() => document.querySelector('.popup').dataset.view === 'expanded', null, { timeout: 5000 });
      check(await page.inputValue('#xp-ph-input') === P1 && (await popupWin(app)).bounds.width >= 580, 'reopened: still expanded, same card and photographer');
      await backToOverview(page);
      await waitFor(async () => (await popupWin(app))?.bounds.width <= 380, 5000);
      check((await popupWin(app)).bounds.width <= 380, 'Back to Card Overview returns to the compact size');
      await enterDump(page);
      check(await page.inputValue('#xp-ph-input') === P1, 'back in Event Dump: the photographer is still chosen');
    });

    // ═══ 5. One-click Change Event — main window hidden ═══
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().endsWith('index.html')) w.hide(); });
    await withPopup(app, async (page) => {
      await enterDump(page);
      await page.click('#xp-change-event');
      await page.waitForSelector(`#xp-picker-list [data-folder="${LONG_B}"]`, { timeout: 15000 });
      const listed = await page.$$eval('#xp-picker-list .picker-item', els => els.map(e => e.dataset.folder));
      check(listed.includes(LONG_A) && listed.includes(LONG_B) && listed.includes(REAL), `companion picker lists the collection's events with full names (${listed.length})`);
      await page.fill('#xp-picker-search', 'ziyafat');
      check(J(await page.$$eval('#xp-picker-list .picker-item', els => els.map(e => e.dataset.folder))) === J([LONG_B]), 'event search narrows the list');
      await shoot(page, shots, '4-change-event');
      await page.click('#xp-picker-cancel');
      check(await page.isHidden('#xp-picker'), 'Cancel closes the picker');
    });
    check((await dumpView(app)).global.event.eventName === LONG_A, 'cancelled: the event is unchanged');
    await withPopup(app, async (page) => {
      await enterDump(page);
      await page.click('#xp-change-event');
      await page.waitForSelector(`#xp-picker-list [data-folder="${LONG_B}"]`, { timeout: 15000 });
      await page.click(`#xp-picker-list [data-folder="${LONG_B}"]`);
      await page.click('#xp-picker-use');
      await page.waitForFunction((n) => document.getElementById('xp-event-name').textContent === n, LONG_B, { timeout: 15000 });
      const nm = await page.evaluate(() => { const el = document.getElementById('xp-event-name'); const cs = getComputedStyle(el); return { over: el.scrollWidth > el.clientWidth + 1, lines: Math.round(el.getBoundingClientRect().height / parseFloat(cs.lineHeight)) }; });
      check(nm.lines >= 2 && !nm.over, `a very long event name wraps onto ${nm.lines} lines, nothing cut off`);
      await shoot(page, shots, '4b-long-name-wrapped');
    });
    const mw5 = await mainWin(app);
    check(!mw5.visible && !mw5.focused, `Change Event did not bring the main window forward (${J({ visible: mw5.visible, focused: mw5.focused })})`);
    check(await main.evaluate(() => EventCreator.getActiveEventData()?.event?.name) === LONG_B && !(await main.evaluate(() => EventMgmt.isOpen())), 'the workspace adopted the chosen event without opening the Event Creator');
    check((await dumpView(app)).card?.photographer === P1, 'photographer kept across the event change');
    check(await main.evaluate((n) => (document.querySelector('.hero-body')?.textContent || '').replace(/\s+/g, ' ').includes(n), LONG_B), 'the main window\'s home card shows the event chosen in the companion (no stale event)');

    // ═══ 6. Import to Dump — main window stays in the background ═══
    let sawProgress = false;
    await withPopup(app, async (page) => {
      await enterDump(page);
      await page.waitForFunction(() => !document.getElementById('xp-import').disabled, null, { timeout: 10000 });
      await page.click('#xp-import');
      sawProgress = !!(await page.waitForSelector('#xp-progress:not([hidden])', { timeout: 10000 }).catch(() => null));
      if (sawProgress) await shoot(page, shots, '5-importing');
    });
    const op = await waitFor(async () => { const v = await dumpView(app); return v.card?.op && v.card.op.state !== 'pending' ? v.card.op : null; }, 120000);
    check(op && op.state === 'completed' && op.result.copied === 24 && op.result.errors === 0, `import completed (${J(op && op.result)})`);
    check(sawProgress, 'progress was shown in the companion while importing');
    const mw6 = await mainWin(app);
    check(!mw6.visible && !mw6.focused, `Import to Dump did not bring the main window forward (${J({ visible: mw6.visible, focused: mw6.focused })})`);
    const dumpB = path.join(collDir, LONG_B, 'Dump', P1);
    check((await listFiles(dumpB)).length === 24 && !(await fsp.readdir(path.join(collDir, LONG_B, 'Dump'))).some(n => /^PC\d+-/.test(n)), 'files in Event/Dump/<photographer>, unsequenced');
    check(J(await listFiles(cardA)) === J(cardBefore), 'source card unchanged');
    await withPopup(app, async (page) => {
      await enterDump(page);
      await page.waitForSelector('#xp-result:not([hidden])', { timeout: 10000 });
      const res = await page.textContent('#xp-result');
      check(/24/.test(res), `completion shown in the companion ("${res.trim().slice(0, 120)}")`);
      await shoot(page, shots, '6-complete');
    });

    // ═══ 7. A safety dialog still reaches the operator ═══
    // Another computer holds the photographer folder's archive lock (synthetic lock, temp archive).
    const lockPath = await mainRequire(app, '../services/archiveLockService', 'return m.getLockPath(arg.root, arg.scope);', { root: archiveRoot, scope: { collection: COLL, eventFolderName: LONG_A, photographerFolderName: P2 } });
    await fsp.mkdir(path.dirname(lockPath), { recursive: true });
    await fsp.writeFile(lockPath, J({ lockType: 'photographer-archive-write', collection: COLL, eventFolderName: LONG_A, photographerFolderName: P2, deviceName: 'EQI11-OTHER-MAC', operation: 'background-archive-sync', jobId: 'eqi11', createdAt: Date.now(), lastHeartbeatAt: Date.now(), expiresAt: Date.now() + 3600e3, status: 'active' }));
    await setActiveEvent(main, collDir, COLL, LONG_A);
    await waitFor(async () => (await dumpView(app)).global?.event?.eventName === LONG_A, 10000);
    fs.writeFileSync(iso.drivesFile, J([]));
    await waitFor(async () => !(await dumpView(app)).card, 15000);
    const cardC = path.join(work, 'CARD_C');
    await put(path.join(cardC, 'DCIM', '100CANON'), 'IMG_0900.JPG', today);
    fs.writeFileSync(iso.drivesFile, J([fakeDrive(cardC, 'CARD_C')]));
    await waitFor(async () => { const v = await dumpView(app); return v.assessment?.state === 'complete' && v.card?.counts?.selectedNew === 1; }, 60000);
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().endsWith('index.html')) w.hide(); });
    await withPopup(app, async (page) => {
      await enterDump(page);
      if ((await dumpView(app)).card?.photographer !== P2) await pickPhotographer(page, P2, 'testhusain');
      await page.waitForFunction(() => !document.getElementById('xp-import').disabled, null, { timeout: 10000 });
      await page.click('#xp-import');
    });
    const dlg = await main.waitForSelector('.ec-modal-overlay .dab-cancel-btn', { timeout: 20000 }).then(() => true, () => false);
    const mw7 = await mainWin(app);
    check(dlg && mw7.visible, `busy-archive dialog appears and the main window comes forward for it (${J({ dialog: dlg, visible: mw7.visible })})`);
    await main.waitForTimeout(600);   // the modal's fade-in
    await main.screenshot({ path: path.join(shots, '7-busy-dialog.png') });
    if (dlg) await main.click('.ec-modal-overlay .dab-cancel-btn');
    const op7 = await waitFor(async () => { const v = await dumpView(app); return v.card?.op && v.card.op.state !== 'pending' ? v.card.op : null; }, 20000);
    check(op7 && op7.state !== 'completed' && op7.reason === 'archive-busy', `cancelled: nothing imported, reason shown (${J(op7 && { state: op7.state, reason: op7.reason })})`);
    check(fs.existsSync(lockPath) && JSON.parse(fs.readFileSync(lockPath, 'utf8')).deviceName === 'EQI11-OTHER-MAC', 'the other computer\'s lock was NOT cleared');
    check(!fs.existsSync(path.join(collDir, LONG_A, 'Dump', P2)), 'nothing written behind the lock');
    await fsp.rm(lockPath, { force: true });

    // ═══ 8. Sanitized real-world Dump event (88 CR3 + 1 MP4) ═══
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if (w.webContents.getURL().endsWith('index.html')) w.hide(); });
    await withPopup(app, async (page) => {
      await enterDump(page);
      await page.click('#xp-change-event');
      await page.waitForSelector(`#xp-picker-list [data-folder="${REAL}"]`, { timeout: 15000 });
      await page.click(`#xp-picker-list [data-folder="${REAL}"]`);
      await page.click('#xp-picker-use');
      await page.waitForFunction((n) => document.getElementById('xp-event-name').textContent === n, REAL, { timeout: 15000 });
      // EQI-1.2: the visible destination is the short form; the canonical path is under "Full path".
      const dest = await page.textContent('#xp-dest-full');
      check(dest.includes(`${COLL} / ${REAL} / Dump / `), 'real-world event adopted from the companion; full destination is the canonical Event/Dump path');
    });
    check((await fsp.readFile(path.join(realDir, 'event.json'))).equals(realBytes), 'real-world event.json byte-identical after listing and adopting it');
    const realFiles = await listFiles(realDump);
    check(realFiles.filter(f => f.endsWith('.CR3')).length === 88 && realFiles.filter(f => f.endsWith('.MP4')).length === 1 && !(await fsp.readdir(path.join(realDir, 'Dump'))).some(n => /^PC\d+-/.test(n)), 'its Dump folder intact: 88 CR3 + 1 MP4, unsequenced');

    log('screenshots:', shots);
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
    // Screenshots kept only when AI_EQI11_SHOTS points outside the temp work folder.
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
