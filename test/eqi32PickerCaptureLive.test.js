'use strict';
// LIVE (AI-FEAT-064 EQI-3.2 hotfix): the "Move Photos to Another Event" destination picker with many events
// and realistic long names, and the Sort Dump grid's ORIGINAL CAPTURE time. Real main.js and renderer,
// isolated test identity, temp profile, synthetic archive.
//
//   P  capture time: a RAW captured 09:33:11 whose file was modified 22:31:51 shows 09:33 (grid, list,
//      timeline); date sort follows capture order (the opposite of modification order); a file with no
//      capture metadata says "Capture date unavailable"
//   Q  picker geometry: no row overlaps another, no text leaves its row, no horizontal overflow — at the
//      normal window, a small laptop window and 125 % zoom, dark and light
//   R  every row selectable by its own path; scrolling never changes the chosen event; keyboard; search
//   S  destination-type controls, component options of the chosen event, Review shows the chosen event,
//      Back keeps it, Create New Event (Back) returns unchanged, Cancel changes nothing
//
// Run: node test/eqi32PickerCaptureLive.test.js     AI_EQI32P_SHOTS=<dir> keeps the screenshots

const { _electron: electron } = require('playwright-core');
const { ExifTool } = require('exiftool-vendored');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const H = require('./support/liveTestHarness');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_BIN = require(path.join(PROJECT_ROOT, 'node_modules', 'electron'));
const COLL = 'CollEQI32Picker';
const P1 = 'Testali Bhai';
const A = '1448-06-01 _01-Majlis-Hall-Surat';
const LONG_COMPS = ['Majlis-Saifee-Mahal-Main-Hall-Ground-Floor', 'Waaz-Burhani-Masjid-Upper-Gallery', 'Ziyafat-Jamali-Garden-Marquee-North-Lawn',
  'Nikah-Mubarak-Ceremony-Mohammedi-Park-Auditorium', 'Ziyarat-Raudat-Tahera-Courtyard-Entrance', 'Misaq-Qutbi-Jubilee-Hall'];

let failures = 0;
const log = (...a) => console.log('[eqi32p-live]', ...a);
const check = (c, m) => { if (c) log('PASS —', m); else { failures++; log('FAIL —', m); } };
const J = (x) => JSON.stringify(x);
const { sleep, createHelpers } = require('./support/eventDumpLiveHelpers');
const { passSplash, setActiveEvent } = createHelpers({ projectRoot: PROJECT_ROOT });

// Destination events: long and short names, one component to six long ones.
function destinations() {
  const names = [
    ['_01-Majlis-Waaz-Ziyafat-Nikah-Mubarak-Saifee-Mahal-Burhani-Masjid-Jamali-Garden-Surat-Gujarat', 6],
    ['_01-Ziyafat', 1],
    ['_02-Urs-Mubarak-Syedi-Hakimuddin-Saheb-Raudat-Tahera-Courtyard-Burhanpur-Madhya-Pradesh', 5],
    ['_01-Waaz', 2],
    ['_01-ThisEventNameHasNoSpacesOrHyphensAtAllAndMustStillWrapSafelyInsideItsRowWithoutOverflowing', 3],
    ['_03-Milad-Mubarak-Majlis-and-Ziyafat-at-the-Qutbi-Jubilee-Hall-with-Children-Programme-Mumbai', 6],
  ];
  const out = [];
  for (let i = 0; i < 24; i++) {
    const [suffix, n] = names[i % names.length];
    out.push({ folder: `1448-06-${String(i + 2).padStart(2, '0')} ${suffix}`, comps: LONG_COMPS.slice(0, n) });
  }
  return out;
}

async function shoot(page, dir, name) {
  const cur = await page.evaluate(() => document.documentElement.dataset.theme);
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(dir, `${name}-${theme}.png`) });
  }
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, cur);
}

/** Bounding-box audit of the picker: rows vs rows, text vs its row, horizontal overflow. */
const geometry = () => {
  const list = document.getElementById('xemList');
  const modal = document.querySelector('#dumpSortOverlay .xem-modal');
  const rows = [...list.querySelectorAll('.xem-event')];
  const bad = [];
  const r = rows.map(e => e.getBoundingClientRect());
  for (let i = 1; i < r.length; i++) if (r[i].top < r[i - 1].bottom - 0.5) bad.push(`row ${i} overlaps row ${i - 1} by ${(r[i - 1].bottom - r[i].top).toFixed(1)}px`);
  rows.forEach((row, i) => {
    for (const el of row.querySelectorAll('.xem-event-name, .xem-event-meta, .xem-event-mark')) {
      const b = el.getBoundingClientRect();
      if (b.top < r[i].top - 0.5 || b.bottom > r[i].bottom + 0.5 || b.left < r[i].left - 0.5 || b.right > r[i].right + 0.5) bad.push(`row ${i}: ${el.className} leaves its row`);
      // the visible text (incl. the 2-line clamp) must fit the element's own box
      if (el.scrollWidth > el.clientWidth + 1 && !el.classList.contains('xem-event-meta')) bad.push(`row ${i}: ${el.className} overflows horizontally`);
    }
    const name = row.querySelector('.xem-event-name');
    const meta = row.querySelector('.xem-event-meta');
    if (name.getBoundingClientRect().bottom > meta.getBoundingClientRect().top + 0.5) bad.push(`row ${i}: name overlaps its component line`);
    const lines = Math.round(name.getBoundingClientRect().height / parseFloat(getComputedStyle(name).lineHeight));
    if (lines > 2) bad.push(`row ${i}: name uses ${lines} lines`);
  });
  for (const st of modal.querySelectorAll('.xem-radio strong')) {
    const lh = parseFloat(getComputedStyle(st).lineHeight) || 16;
    if (st.getBoundingClientRect().height > lh * 1.5) bad.push(`"${st.textContent}" in an option label broken across lines`);
  }
  if (list.scrollWidth > list.clientWidth + 1) bad.push('list scrolls horizontally');
  const body = modal.querySelector('.xem-body');
  if (body && body.scrollWidth > body.clientWidth + 1) bad.push('dialog body scrolls horizontally');
  const actions = modal.querySelector('.dup-actions').getBoundingClientRect();
  const m = modal.getBoundingClientRect();
  if (actions.bottom > m.bottom + 0.5 || m.bottom > window.innerHeight + 0.5 || m.top < -0.5) bad.push('dialog or its actions outside the window');
  return { bad, rows: rows.length, rowHeights: r.map(x => Math.round(x.height)), listScrolls: list.scrollHeight > list.clientHeight + 1,
    reviewVisible: !!document.getElementById('xemReview') && document.getElementById('xemReview').getBoundingClientRect().bottom <= window.innerHeight };
};

(async () => {
  if (process.platform !== 'darwin') { log('SKIP — macOS only'); return; }
  const work = fs.realpathSync(await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-eqi32p-live-')));
  const shots = process.env.AI_EQI32P_SHOTS || path.join(work, 'shots');
  await fsp.mkdir(shots, { recursive: true });
  const ud = path.join(work, 'userData'); await fsp.mkdir(ud);
  const archiveRoot = path.join(work, 'archive'); await fsp.mkdir(archiveRoot);
  const stagingRoot = path.join(work, 'staging'); await fsp.mkdir(stagingRoot);
  const collDir = path.join(archiveRoot, COLL);
  const evA = path.join(collDir, A);
  const iso = H.prepareIsolatedApp({ tag: 'eqi32p', work, projectRoot: PROJECT_ROOT });
  const prodBefore = H.prodKeychainSnapshot();
  const testKcBefore = H.keychainHas(iso.keychainItem);
  const et = new ExifTool({ maxProcs: 2 });
  const launch = () => electron.launch({ executablePath: ELECTRON_BIN, args: [...iso.args, '--user-data-dir=' + ud, '--no-sandbox'], cwd: PROJECT_ROOT, env: iso.env(ud), timeout: 60000 });

  // ── synthetic Dump: capture time ≠ modification time ──
  const dump = path.join(evA, 'Dump', P1);
  await fsp.mkdir(dump, { recursive: true });
  const noise = Buffer.alloc(480 * 360 * 3); for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919) % 251;   // above fileBrowser MIN_FILE_BYTES
  const tif = await sharp(noise, { raw: { width: 480, height: 360, channels: 3 } }).tiff({ compression: 'none' }).toBuffer();
  const jpg = await sharp(noise, { raw: { width: 480, height: 360, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
  const MOD = (h, m, s) => new Date(2026, 10, 16, h, m, s);
  // name, bytes, capture (EXIF), modification time. Capture order C1 < C2 < C3 is the REVERSE of mtime order.
  const media = [
    ['DH036958.CR3', tif, '2026:11:16 09:33:11', MOD(22, 31, 51)],
    ['DH036958.JPG', jpg, '2026:11:16 09:33:11', MOD(22, 31, 52)],
    ['C1_0001.JPG', jpg, '2026:11:16 07:05:00', MOD(23, 50, 0)],
    ['C2_0002.JPG', jpg, '2026:11:16 12:40:00', MOD(21, 0, 0)],
    ['C3_0003.JPG', jpg, '2026:11:16 23:59:30', MOD(8, 0, 0)],
    ['NOEXIF_0001.JPG', jpg, null, MOD(10, 31, 0)],
  ];
  for (const [name, bytes, dto] of media) {
    const p = path.join(dump, name);
    await fsp.writeFile(p.replace(/\.CR3$/, '.tif'), bytes);
    if (dto) await et.write(p.replace(/\.CR3$/, '.tif'), { Make: 'Canon', Model: 'Canon EOS R5', DateTimeOriginal: dto, CreateDate: dto }, { writeArgs: ['-overwrite_original'] });
    if (p.endsWith('.CR3')) await fsp.rename(p.replace(/\.CR3$/, '.tif'), p);
  }
  for (let i = 1; i <= 8; i++) await fsp.writeFile(path.join(dump, `F_${String(i).padStart(4, '0')}.JPG`), jpg).then(() => et.write(path.join(dump, `F_${String(i).padStart(4, '0')}.JPG`), { DateTimeOriginal: `2026:11:16 1${i % 10}:00:00` }, { writeArgs: ['-overwrite_original'] }));
  for (const [name, , , mtime] of media) await fsp.utimes(path.join(dump, name), mtime, mtime);
  const comp = (id, folderName, types) => ({ id, folderName, location: 'Hall', city: 'Surat', country: 'India', types, additionalKeywords: [] });
  const DEST = destinations();
  const docs = [[evA, { version: 1, hijriDate: '1448-06-01', sequence: 1, eventName: 'Majlis-Hall-Surat', components: [comp(1, 'Majlis-Hall', ['Majlis'])],
    imports: [{ id: 'imp-a', timestamp: new Date().toISOString(), photographer: P1, destination: 'dump', counts: { photos: 14, videos: 0 } }] }]];
  for (const d of DEST) {
    const ev = path.join(collDir, d.folder);
    for (const c of d.comps) await fsp.mkdir(path.join(ev, c), { recursive: true });
    docs.push([ev, { version: 1, hijriDate: d.folder.slice(0, 10), sequence: 1, eventName: d.folder.slice(15), components: d.comps.map((c, i) => comp(i + 1, c, [c.split('-')[0]])), imports: [] }]);
  }
  const snapshot = async () => {
    const out = {};
    const walk = async (d) => { for (const e of await fsp.readdir(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else { const st = await fsp.stat(p); out[path.relative(archiveRoot, p)] = `${st.size}:${st.mtimeMs}:${e.name === 'event.json' ? crypto.createHash('sha256').update(await fsp.readFile(p)).digest('hex') : ''}`; } } };
    await walk(archiveRoot);
    return out;
  };

  let app, main;
  const setWindow = (w, h) => app.evaluate(({ BrowserWindow }, s) => { const win = BrowserWindow.getAllWindows().find(x => /index\.html/.test(x.webContents.getURL())); win.setSize(s.w, s.h); }, { w, h });
  const zoom = (f) => app.evaluate(({ BrowserWindow }, z) => { BrowserWindow.getAllWindows().find(x => /index\.html/.test(x.webContents.getURL())).webContents.setZoomFactor(z); }, f);
  const geo = () => main.evaluate(geometry);
  const chosen = () => main.evaluate(() => ({ sel: [...document.querySelectorAll('.xem-event.selected')].map(e => e.dataset.path), text: document.getElementById('xemChosen')?.textContent.replace(/\s+/g, ' ') || '' }));

  try {
    app = await launch();
    await H.verifyIsolation(app, iso, ud);
    check(true, 'isolation proven (test identity, temp profile, drivelist stub, quit guard)');
    main = await passSplash(app);
    main.on('dialog', (d) => d.accept().catch(() => {}));
    main.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') log('console', m.type(), m.text().slice(0, 300)); });
    main.on('pageerror', (e) => log('pageerror', e.message.slice(0, 300)));
    await main.evaluate(async (a) => {
      await window.api.initArchiveRoot(a.archiveRoot);
      await window.api.setNasRoot(a.archiveRoot);
      await window.api.setMainArchiveRoot(a.archiveRoot);
      await window.api.setLocalStagingRoot(a.stagingRoot);
      await window.api.setDefaultImportMode('direct-nas');
      if (typeof EventCreator.setSessionArchiveRoot === 'function') EventCreator.setSessionArchiveRoot(a.archiveRoot);
      await window.api.addToList('photographers', a.p1);
    }, { archiveRoot, stagingRoot, p1: P1 });
    await main.evaluate(async ({ defs }) => { for (const [d, data] of defs) await window.api.writeEventJson(d, data); }, { defs: docs });
    for (const [name, , , mtime] of media) await fsp.utimes(path.join(dump, name), mtime, mtime);
    await setActiveEvent(main, collDir, COLL, A);
    await setWindow(1440, 900);

    // ═══ P: Sort Dump shows the original capture time ═══
    await main.evaluate(() => { if (!EventMgmt.isOpen()) { EventMgmt.open({ mode: 'select' }); EventCreator.start(); } });
    await main.waitForSelector(`.ec-coll-card[data-name="${COLL}"]`, { timeout: 15000 }).catch(() => {});
    if (await main.$(`.ec-coll-card[data-name="${COLL}"]`)) { await main.click(`.ec-coll-card[data-name="${COLL}"]`); await main.click('#ecMasterContinue'); }
    await main.waitForSelector(`.ec-evl-item[data-folder="${A}"] .ec-evl-dump-btn`, { timeout: 20000 });
    await main.click(`.ec-evl-item[data-folder="${A}"] .ec-evl-dump-btn`);
    await main.waitForFunction(() => window.DumpSortMode && DumpSortMode.isActive() && document.querySelectorAll('#fileGrid .file-tile').length >= 14, null, { polling: 100, timeout: 60000 });
    await main.evaluate(() => { sortKey = 'date'; sortDir = 'asc'; resetViewCache(); renderCurrentView(); });
    await main.waitForFunction(() => !CaptureTime.busy && !document.querySelector('#fileGrid .capture-pending'), null, { polling: 100, timeout: 60000 });
    await sleep(500);
    const tiles = await main.evaluate(() => [...document.querySelectorAll('#fileGrid .file-tile[data-path]')].map(t => [t.dataset.path.split('/').pop(), t.querySelector('.file-date')?.textContent.trim(), t.querySelector('.file-date')?.title || '']));
    const expect0933 = await main.evaluate(() => new Date(2000, 0, 1, 9, 33).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
    const expect2231 = await main.evaluate(() => new Date(2000, 0, 1, 22, 31).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
    const raw = tiles.find(t => t[0] === 'DH036958.CR3');
    check(raw && raw[1] === `16 Nov 2026, ${expect0933}` && !raw[1].includes(expect2231), `CR3 shows its capture time ${J(raw && raw[1])}, not its modification time ${expect2231}`);
    check(raw && /09:33:11/.test(raw[2]) && /DateTimeOriginal/.test(raw[2]), `the tooltip names the full time and its tag (${J(raw && raw[2])})`);
    const pairJ = tiles.find(t => t[0] === 'DH036958.JPG');
    check(pairJ && pairJ[1] === raw[1], 'RAW and JPEG of the pair show the same capture time');
    const none = tiles.find(t => t[0] === 'NOEXIF_0001.JPG');
    check(none && none[1] === 'Capture date unavailable', `a file without capture metadata says so (${J(none && none[1])}) — its filesystem time is not shown`);
    const order = tiles.map(t => t[0]).filter(n => /^C\d_/.test(n));
    check(J(order) === J(['C1_0001.JPG', 'C2_0002.JPG', 'C3_0003.JPG']), `date sort (ascending) follows capture order, not modification order (${J(order)})`);
    const lastDated = tiles.map(t => t[0]);
    check(lastDated[lastDated.length - 1] === 'NOEXIF_0001.JPG', 'the undated file sorts after the dated ones');
    await shoot(main, shots, 'p1-grid-capture-time');
    await main.evaluate(() => { sortDir = 'desc'; resetViewCache(); renderCurrentView(); });
    const desc = await main.evaluate(() => [...document.querySelectorAll('#fileGrid .file-tile[data-path]')].map(t => t.dataset.path.split('/').pop()).filter(n => /^C\d_/.test(n)));
    check(J(desc) === J(['C3_0003.JPG', 'C2_0002.JPG', 'C1_0001.JPG']), `descending date sort (${J(desc)})`);
    await main.evaluate(() => { viewMode = 'list'; resetViewCache(); renderCurrentView(); });
    const listCell = await main.evaluate(() => [...document.querySelectorAll('#fileGrid tr.file-tile')].find(r => r.dataset.path.endsWith('DH036958.CR3'))?.querySelector('.lt-date')?.textContent.trim());
    check(listCell === raw[1], `list view shows the same capture time (${J(listCell)})`);
    await main.evaluate(() => { viewMode = 'icon'; sortDir = 'asc'; timelineMode = true; resetViewCache(); renderCurrentView(); });
    const tl = await main.evaluate(() => [...document.querySelectorAll('#fileGrid .timeline-group')].map(g => [g.querySelector('.timeline-label').textContent.trim(), [...g.querySelectorAll('.file-tile[data-path]')].map(t => t.dataset.path.split('/').pop())]));
    const g09 = tl.find(g => g[1].includes('DH036958.CR3'));
    check(g09 && /Nov 16 2026\s+·\s+09:00/.test(g09[0]), `timeline groups the CR3 at its capture hour (${J(g09 && g09[0])})`);
    check(tl.some(g => g[0] === 'Capture date unavailable' && g[1].includes('NOEXIF_0001.JPG')), 'timeline: the undated file is in "Capture date unavailable"');
    const c3 = tl.find(g => g[1].includes('C3_0003.JPG'));
    check(c3 && /Nov 16 2026\s+·\s+23:00/.test(c3[0]), `23:59:30 stays on its own day (${J(c3 && c3[0])})`);
    await shoot(main, shots, 'p2-timeline-capture-time');
    await main.evaluate(() => { timelineMode = false; resetViewCache(); renderCurrentView(); });

    // ═══ Q: the picker with 24 long-named destination events ═══
    const before = await snapshot();
    const pick = await main.evaluate((p) => { selectedFiles.clear(); for (const f of p) selectedFiles.add(f); updateSelectionBar(); return selectedFiles.size; }, ['C1_0001.JPG', 'C2_0002.JPG'].map(n => path.join(dump, n)));
    check(pick === 2, '2 photos selected');
    await main.click('#dsbMoveOther');
    await main.waitForSelector('#dumpSortOverlay.visible #xemSearch', { timeout: 15000 });
    await main.waitForFunction(() => document.querySelectorAll('.xem-event').length >= 24, null, { timeout: 15000 });
    await shoot(main, shots, 'q1-picker-1440x900');
    const g1 = await geo();
    check(g1.rows === 24 && g1.bad.length === 0, `1440×900: 24 rows, no overlap (${J(g1.bad.slice(0, 5))}; heights ${J(g1.rowHeights.slice(0, 6))})`);
    check(g1.listScrolls, 'the long list scrolls inside its own bounded box');
    const paths = await main.evaluate(() => [...document.querySelectorAll('.xem-event')].map(e => e.dataset.path));
    check(paths.every(p => !p.endsWith(A)) && new Set(paths).size === 24, 'source event excluded; every row a distinct event');
    const titles = await main.evaluate(() => [...document.querySelectorAll('.xem-event')].map(e => [e.dataset.path.split('/').pop(), e.title.split('\n')[0], e.getAttribute('aria-label')]));
    check(titles.every(([f, t, a]) => t === f && a.startsWith(f)), 'each row\'s tooltip and accessible name carry the full event name');

    // ═══ R: every row selectable by its own identity; scrolling never changes it ═══
    let mism = [];
    for (const p of paths) {
      await main.evaluate((x) => document.querySelector(`.xem-event[data-path="${CSS.escape(x)}"]`).scrollIntoView({ block: 'center' }), p);
      await main.click(`.xem-event[data-path="${p.replace(/"/g, '\\"')}"]`);
      const c = await chosen();
      if (c.sel.length !== 1 || c.sel[0] !== p || !c.text.includes(p.split('/').pop())) mism.push(p.split('/').pop());
    }
    check(mism.length === 0, `each of the 24 rows selects exactly its own event, shown in full under the list (${J(mism.slice(0, 3))})`);
    const k = paths[3];
    await main.click(`.xem-event[data-path="${k.replace(/"/g, '\\"')}"]`);
    await main.evaluate(() => { const l = document.getElementById('xemList'); l.scrollTop = l.scrollHeight; });
    await sleep(200);
    let c = await chosen();
    check(c.sel[0] === k && c.text.includes(k.split('/').pop()), 'scrolling the list does not change the chosen event');
    const nearEnd = paths[22];
    await main.click(`.xem-event[data-path="${nearEnd.replace(/"/g, '\\"')}"]`);
    const kept = await main.evaluate(() => document.getElementById('xemList').scrollTop);
    c = await chosen();
    check(c.sel[0] === nearEnd && kept > 100, `choosing a row low in the list keeps the list where it was (scrollTop ${kept})`);
    // keyboard
    await main.focus('#xemSearch');
    await main.keyboard.press('ArrowDown');
    await main.keyboard.press('ArrowDown');
    await main.keyboard.press('ArrowDown');
    const focused = await main.evaluate(() => document.activeElement?.dataset?.path || '');
    await main.keyboard.press('Enter');
    c = await chosen();
    check(focused === paths[2] && c.sel[0] === paths[2], `keyboard: ↓ from search, ↓↓, Enter chooses the third row (${focused.split('/').pop()})`);
    await main.keyboard.press('End');
    const endF = await main.evaluate(() => document.activeElement?.dataset?.path || '');
    check(endF === paths[23], 'keyboard: End moves to the last row');
    // search
    await main.fill('#xemSearch', 'NoSpacesOrHyphens');
    let n = await main.evaluate(() => [...document.querySelectorAll('.xem-event')].map(e => e.dataset.path.split('/').pop()));
    check(n.length === 4 && n.every(x => x.includes('NoSpacesOrHyphens')), `search inside long names (${n.length} matches)`);
    const gS = await geo();
    check(gS.bad.length === 0, `filtered list: no overlap (${J(gS.bad.slice(0, 3))})`);
    await main.fill('#xemSearch', 'zz-nothing-here');
    check(await main.evaluate(() => /No event matches/.test(document.getElementById('xemList').textContent)), 'no results: "No event matches."');
    await main.fill('#xemSearch', '');
    n = await main.evaluate(() => document.querySelectorAll('.xem-event').length);
    check(n === 24, 'empty search: all 24 events again');

    // ═══ Q (cont.): small laptop window and display scaling ═══
    for (const [w, h, z, tag] of [[1100, 700, 1, 'q2-picker-1100x700'], [1280, 800, 1.25, 'q3-picker-1280x800-zoom125'], [900, 600, 1, 'q4-picker-900x600']]) {
      await setWindow(w, h);
      await zoom(z);
      await sleep(600);
      const g = await geo();
      check(g.bad.length === 0 && g.reviewVisible, `${w}×${h} at ${z * 100}%: no overlap, Review Move reachable (${J(g.bad.slice(0, 3))})`);
      // The whole window as Electron draws it (Playwright's page capture crops a zoomed page).
      for (const theme of ['dark', 'light']) {
        await main.evaluate((th) => { document.documentElement.dataset.theme = th; }, theme);
        await sleep(300);
        const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find(x => /index\.html/.test(x.webContents.getURL())).webContents.capturePage()).toPNG().toString('base64'));
        await fsp.writeFile(path.join(shots, `${tag}-${theme}.png`), Buffer.from(png, 'base64'));
      }
    }
    await zoom(1);
    await setWindow(1440, 900);
    await sleep(400);

    // ═══ S: destination type, components, review, back, create (back), cancel ═══
    const six = paths.find(p => p.includes('Majlis-Waaz-Ziyafat-Nikah'));
    await main.click(`.xem-event[data-path="${six.replace(/"/g, '\\"')}"]`);
    const st = await main.evaluate(() => ({ fsDisabled: document.querySelectorAll('fieldset.xem-field')[1]?.disabled, dump: document.querySelector('input[name="xemKind"][value="dump"]').checked, select: !!document.getElementById('xemComponent'), review: document.getElementById('xemReview').disabled }));
    check(!st.fsDisabled && st.dump && !st.select && !st.review, `after choosing: controls enabled, Dump default, no component selector, Review enabled (${J(st)})`);
    await main.click('input[name="xemKind"][value="component"]');
    const comps = await main.evaluate(() => ({ opts: [...document.querySelectorAll('#xemComponent option')].map(o => o.value).filter(Boolean), review: document.getElementById('xemReview').disabled, chosen: document.querySelector('.xem-event.selected')?.dataset.path }));
    check(J(comps.opts) === J(LONG_COMPS) && comps.review && comps.chosen === six, `component kind: the chosen event's 6 components offered; Review waits for one (${comps.opts.length})`);
    const gC = await geo();
    check(gC.bad.length === 0, 'with the component selector shown: no overlap');
    await shoot(main, shots, 's1-picker-component');
    await main.selectOption('#xemComponent', LONG_COMPS[4]);
    await main.click('#xemReview');
    await main.waitForFunction(() => !!document.querySelector('#dumpSortOverlay.visible .xem-statement'), null, { timeout: 30000 });
    const rv = await main.evaluate(() => [...document.querySelectorAll('.xem-facts dt')].map(d => [d.textContent.trim(), d.nextElementSibling.textContent.trim()]));
    const fact = (k2) => (rv.find(x => x[0] === k2) || [])[1];
    check(fact('From') === A && fact('To') === six.split('/').pop() && fact('Destination').includes(LONG_COMPS[4]), `review shows the chosen source and destination (${J(rv.slice(0, 3))})`);
    check(await main.evaluate(() => !!document.getElementById('xemGo')), 'Move Photos offered only on the review');
    await shoot(main, shots, 's2-review');
    await main.click('#xemBack');
    await main.waitForSelector('#dumpSortOverlay.visible #xemSearch', { timeout: 10000 });
    c = await chosen();
    check(c.sel[0] === six, 'Back from the review keeps the chosen event');
    await main.click('#xemCreate');
    await main.waitForFunction(() => EventMgmt.isOpen(), null, { timeout: 8000 });
    await main.waitForSelector('#ecNewEventFromList', { timeout: 15000 });
    await main.click('#emmBackBtn');
    await main.waitForSelector('#dumpSortOverlay.visible #xemSearch', { timeout: 15000 });
    const back = await main.evaluate((a) => ({ active: DumpSortMode.isActive(), em: EventMgmt.isOpen(), sel: selectedFiles.size, ev: EventCreator.getActiveEventData()?.eventPath?.endsWith(a), chosen: document.querySelector('.xem-event.selected')?.dataset.path, rows: document.querySelectorAll('.xem-event').length }), A);
    check(back.active && !back.em && back.sel === 2 && back.ev && back.chosen === six && back.rows === 24, `Create New Event → Back returns to the same dialog, choice and selection kept (${J(back)})`);
    await main.click('#xemCancel');
    await sleep(500);
    const after = await snapshot();
    const changed = Object.keys({ ...before, ...after }).filter(k2 => before[k2] !== after[k2] && !k2.includes('.autoingest'));
    check(!(await main.evaluate(() => document.getElementById('dumpSortOverlay').classList.contains('visible'))) && changed.length === 0, `Cancel closes the dialog; no archive file or event.json changed (${J(changed.slice(0, 3))})`);
    check(await main.evaluate((a) => DumpSortMode.isActive() && EventCreator.getActiveEventData()?.eventPath?.endsWith(a) && selectedFiles.size === 2, A), 'Sort Dump still open on the source event with its selection');
    check(J(H.prodKeychainSnapshot()) === J(prodBefore), 'production Keychain items unchanged (presence only)');
  } catch (err) {
    failures++;
    log('FAIL — exception:', err && err.stack ? err.stack.split('\n').slice(0, 6).join('\n') : err);
    try { log('DIAG:', J(await main.evaluate(() => ({ ct: typeof CaptureTime, busy: window.CaptureTime && CaptureTime.busy, pend: document.querySelectorAll('#fileGrid .capture-pending').length, dates: [...document.querySelectorAll('#fileGrid .file-date')].slice(0, 4).map(e => e.outerHTML), n: (currentFiles || []).length, names: (currentFiles || []).map(f => f.name).join(','), vm: viewModeType, ctx: currentFolderContext && currentFolderContext.path, banner: document.getElementById('dumpSortBanner')?.textContent.replace(/\s+/g, ' ').slice(0, 300), tiles: document.querySelectorAll('#fileGrid .file-tile').length, files: (currentFiles || []).slice(0, 3).map(f => [f.name, f.type, JSON.stringify(f.capture)]) })).catch(e => e.message))); } catch { /* gone */ }
    try { log('app.log tail:\n' + fs.readFileSync(path.join(ud, 'app.log'), 'utf8').split('\n').slice(-30).join('\n')); } catch { /* none */ }
  } finally {
    await et.end().catch(() => {});
    if (app) {
      await Promise.race([app.close().catch(() => {}), sleep(15000)]);
      try { if (app.process() && app.process().exitCode === null) app.process().kill('SIGKILL'); } catch { /* gone */ }
    }
    check(H.removeTestKeychainItem(iso, testKcBefore), 'test Keychain item absent after the run');
    if (!process.env.AI_EQI32P_KEEP) await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
  log(failures ? `${failures} FAILURE(S)` : 'ALL CHECKS PASSED');
  process.exitCode = failures ? 1 : 0;
})();
