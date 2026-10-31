'use strict';

// AI-FEAT-061 Q2 — live verification of the Review Selected Date handoff's EXACT file
// selection and its operation states, in the real app (real main.js, companion, shared
// ExifTool pool, real main-window workspace). Only drivelist.list() is stubbed (Electron
// -r); card "volumes" are temp folders with real media whose capture dates ExifTool wrote.
//
// Card fixture: the selected date's files are spread over several folders, one nested
// two levels deep and one outside DCIM (Sony-style PRIVATE/M4ROOT/CLIP), so a correct
// handoff must select across the whole card, not just the visible folder.
//
// Covers: folder view with the card already open in a different folder; nested folders;
// multiple selected-date folders; the visible folder and view mode left unchanged; media
// view; exact selected-file count reported back; existing work-in-progress selection
// refused and left untouched (and the same selection asked again is not a change);
// pending state with heartbeat during a slow open; repeated clicks start one operation.
//
// Run: node test/companionQ2HandoffLive.test.js     (macOS)

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { ExifTool } = require('exiftool-vendored');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_BIN = require(path.join(PROJECT_ROOT, 'node_modules', 'electron'));
const MAIN_JS = path.join(PROJECT_ROOT, 'main', 'main.js');
const BIG_FILES = 1500;

function log(...args) { console.log('[companion-q2-handoff]', ...args); }
let failures = 0;
function check(cond, msg) { if (cond) log('PASS —', msg); else { failures++; log('FAIL —', msg); } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitFor(fn, timeoutMs, stepMs = 200) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(stepMs);
  }
  return last;
}

const pad = (n) => String(n).padStart(2, '0');
function localDay(offsetDays) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())}`;
}
const TODAY = localDay(0), EARLIER = localDay(-2);

const STUB_SRC = `
'use strict';
const fs = require('fs');
const dl = require(require.resolve('drivelist', { paths: [process.env.AI_TEST_PROJECT_ROOT] }));
dl.list = async () => { try { return JSON.parse(fs.readFileSync(process.env.AI_TEST_DRIVES_FILE, 'utf8')); } catch { return []; } };
`;
const fakeDrive = (mountpoint, label) => ({ isSystem: false, isVirtual: false, isUSB: true, isRemovable: true, isCard: true, busType: 'SD', size: 64e9, description: 'Synthetic SD', mountpoints: [{ path: mountpoint, label }] });

function mp4Bytes(day) {
  const box = (type, body) => { const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length); h.write(type, 4, 'latin1'); return Buffer.concat([h, body]); };
  const [y, mo, d] = day.split(':').map(Number);
  const t = Date.UTC(y, mo - 1, d, 12, 0) / 1000 + 2082844800; // noon: same day as written and as UTC
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(t, 4); mvhd.writeUInt32BE(t, 8); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(1000, 16);
  mvhd.writeUInt32BE(0x00010000, 20); mvhd.writeUInt16BE(0x0100, 24);
  [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].forEach((v, i) => mvhd.writeUInt32BE(v >>> 0, 36 + i * 4));
  mvhd.writeUInt32BE(2, 96);
  const ftyp = box('ftyp', Buffer.concat([Buffer.from('isom'), Buffer.from([0, 0, 2, 0]), Buffer.from('isomiso2mp41')]));
  return Buffer.concat([ftyp, box('mdat', Buffer.alloc(80 * 1024)), box('moov', box('mvhd', mvhd))]);
}

const inMain = {
  diag: (app) => app.evaluate((_e, m) => process.getBuiltinModule('module').createRequire(m)('../services/companionService').getDiagnostics(), MAIN_JS),
  showPopup: (app) => app.evaluate((_e, m) => { process.getBuiltinModule('module').createRequire(m)('../services/companionService').showPopup(); }, MAIN_JS),
};
const sourceIdOf = (d, label) => (d.snapshot.sources.find(s => s.label === label) || {}).sourceId;
const jobOf = (d, id) => d.assessment.jobs.find(j => j.sourceId === id) || null;
const popupPage = (app) => app.windows().filter(p => !p.isClosed() && p.url().endsWith('companion.html')).pop() || null;

async function passSplash(app) {
  const window = await app.firstWindow({ timeout: 60000 });
  await window.waitForTimeout(1500);
  const mainWindowPromise = app.waitForEvent('window', { predicate: p => p.url().endsWith('index.html'), timeout: 30000 });
  await window.evaluate(() => {
    const vis = id => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
    if (vis('splashSelect')) document.getElementById('splashNewProfileBtn').click();
    if (vis('splashWelcome')) document.getElementById('splashContinueBtn').click();
  });
  await sleep(300);
  const needsProfile = await window.evaluate(() => !!document.getElementById('splashInputName') && getComputedStyle(document.getElementById('splashCreate')).display !== 'none').catch(() => false);
  if (needsProfile) { await window.fill('#splashInputName', 'Q2 Handoff Operator'); await window.fill('#splashInputRole', 'QA'); await window.click('#splashCreateStartBtn'); }
  const main = await mainWindowPromise;
  await main.waitForLoadState('domcontentloaded');
  await waitFor(() => main.evaluate(() => typeof _registerCompanionHandoff === 'function').catch(() => false), 15000);
  await main.evaluate(() => { if (document.getElementById('onboardingOverlay')?.classList.contains('visible')) document.getElementById('onboardingSkip').click(); });
  return main;
}

/** Review via the popup's own API (exactly what its buttons call). */
async function review(app, sourceId, kind) {
  await inMain.showPopup(app);
  const page = await waitFor(async () => popupPage(app), 8000, 50);
  await sleep(100);
  const clickedAt = Date.now();
  page.evaluate(({ id, kind }) => (kind === 'selected' ? window.companion.reviewSelected(id) : window.companion.reviewEarlier(id)), { id: sourceId, kind }).catch(() => {});
  // Only an outcome recorded AFTER this click counts (an earlier outcome may still be on show).
  const d = await waitFor(async () => {
    const x = await inMain.diag(app);
    const h = x.snapshot.sources.find(s => s.sourceId === sourceId)?.assessment?.handoff;
    return h && h.at >= clickedAt && h.state !== 'pending' && !x.handoff.inFlight ? x : null;
  }, 120000, 100);
  return d && d.snapshot.sources.find(s => s.sourceId === sourceId).assessment.handoff;
}

const ws = (main) => main.evaluate(() => ({
  source: activeSource ? activeSource.path : null,
  view: viewModeType,
  folder: currentFolderContext.path,
  visible: currentFiles.length,
  selected: [...selectedFiles].sort(),
  selectedTilesVisible: [...document.querySelectorAll('.file-tile.selected, [data-path].selected')].length,
}));

(async () => {
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-q2-handoff-'));
  const stubFile = path.join(work, 'drivelist-stub.js');
  const drivesFile = path.join(work, 'drives.json');
  await fsp.writeFile(stubFile, STUB_SRC);
  const setDrives = (list) => fs.writeFileSync(drivesFile, JSON.stringify(list));

  const noise = Buffer.alloc(240 * 240 * 3); for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919) % 251;
  const jpg = await sharp(noise, { raw: { width: 240, height: 240, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
  const tif = await sharp(noise, { raw: { width: 240, height: 240, channels: 3 } }).tiff({ compression: 'none' }).toBuffer();
  const et = new ExifTool({ maxProcs: 2 });
  const put = async (dir, name, bytes, day) => {
    await fsp.mkdir(dir, { recursive: true });
    const p = path.join(dir, name);
    await fsp.writeFile(p, bytes);
    if (day && !name.endsWith('.MP4')) await et.write(p, { DateTimeOriginal: `${day} 10:00:00` }, { writeArgs: ['-overwrite_original'] });
    return p;
  };

  // ── Card H: today's files in 4 folders (one nested, one outside DCIM) ──
  const H = path.join(work, 'cardH');
  const f100 = path.join(H, 'DCIM', '100CANON'), f101 = path.join(H, 'DCIM', '101CANON');
  const fNested = path.join(H, 'DCIM', '102CANON', 'NESTED', 'DEEP'), fClip = path.join(H, 'PRIVATE', 'M4ROOT', 'CLIP');
  const today = [
    await put(f100, 'IMG_0001.JPG', jpg, TODAY), await put(f100, 'IMG_0001.CR2', tif, TODAY), await put(f100, 'IMG_0002.JPG', jpg, TODAY),
    await put(f101, 'IMG_0101.JPG', jpg, TODAY), await put(f101, 'IMG_0102.JPG', jpg, TODAY),
    await put(fNested, 'IMG_0201.JPG', jpg, TODAY), await put(fNested, 'IMG_0202.JPG', jpg, TODAY),
    await put(fClip, 'C0001.MP4', mp4Bytes(TODAY), TODAY),
  ].sort();
  const earlier = [await put(f100, 'IMG_0003.JPG', jpg, EARLIER), await put(f101, 'IMG_0103.JPG', jpg, EARLIER), await put(fNested, 'IMG_0203.JPG', jpg, EARLIER)];

  // ── Card BIG: a slow-to-open card (whole-card scan in the workspace) ──
  const BIG = path.join(work, 'cardBIG');
  const seed = await put(path.join(BIG, 'DCIM', '100MSDCF'), 'DSC00000.JPG', jpg, TODAY);
  for (let i = 1; i < BIG_FILES; i++) await fsp.copyFile(seed, path.join(BIG, 'DCIM', '100MSDCF', `DSC${String(i).padStart(5, '0')}.JPG`));
  await et.end();

  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-q2-handoff-ud-'));
  setDrives([]);
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: ['-r', stubFile, PROJECT_ROOT, '--user-data-dir=' + userDataDir, '--no-sandbox'],
    cwd: PROJECT_ROOT, timeout: 60000,
    env: { ...process.env, AI_TEST_DRIVES_FILE: drivesFile, AI_TEST_PROJECT_ROOT: PROJECT_ROOT },
  });
  const pageErrors = [];
  app.on('window', p => p.on('pageerror', err => pageErrors.push(`${p.url().split('/').pop()}: ${err.message}`)));

  try {
    const main = await passSplash(app);
    setDrives([fakeDrive(H, 'Q2_NESTED'), fakeDrive(BIG, 'Q2_BIG')]);
    const d0 = await waitFor(async () => { const d = await inMain.diag(app); const a = sourceIdOf(d, 'Q2_NESTED'), b = sourceIdOf(d, 'Q2_BIG'); return a && b && jobOf(d, a)?.state === 'complete' && jobOf(d, b)?.state === 'complete' ? d : null; }, 120000, 250);
    const idH = sourceIdOf(d0, 'Q2_NESTED'), idBig = sourceIdOf(d0, 'Q2_BIG');
    const sumH = d0.snapshot.sources.find(s => s.sourceId === idH).assessment.summary;
    check(sumH.counts.selected === today.length && sumH.counts.earlier === earlier.length, `assessment: ${today.length} today across 4 folders, ${earlier.length} earlier (${JSON.stringify(sumH.counts)})`);

    // ═══ Card open in FOLDER view, in a DIFFERENT folder (101CANON) ═══
    let h = await review(app, idH, 'card');
    check(h && h.state === 'completed', `Review Earlier Files opened the card (${h && h.state})`);
    await main.evaluate(() => document.getElementById('viewFolderBtn').click());
    await main.evaluate((p) => enterFolderView(p), f101);
    let s = await ws(main);
    check(s.view === 'folder' && s.folder === f101 && s.visible === 3 && s.selected.length === 0, `precondition: folder view inside 101CANON (3 files visible), nothing selected (${JSON.stringify({ view: s.view, folder: path.basename(s.folder || ''), visible: s.visible })})`);

    h = await review(app, idH, 'selected');
    s = await ws(main);
    check(h && h.state === 'completed', `handoff completed (${JSON.stringify(h)})`);
    check(JSON.stringify(s.selected) === JSON.stringify(today), `exact selection across the whole card — 100CANON, 101CANON, nested 102CANON/NESTED/DEEP and PRIVATE/M4ROOT/CLIP (${s.selected.map(p => path.relative(H, p)).join(', ')})`);
    check(s.selected.length === today.length && h && h.message.includes(`${today.length} files selected`), `exact count reported back to the companion ("${h && h.message}")`);
    check(s.view === 'folder' && s.folder === f101 && s.visible === 3, 'the visible folder and view mode were left exactly as the operator had them');
    check(s.selectedTilesVisible === 2, `the 2 visible today-files in 101CANON show as selected (${s.selectedTilesVisible})`);
    await main.evaluate((p) => enterFolderView(p), fNested);
    s = await ws(main);
    check(s.folder === fNested && s.selected.length === today.length && s.selectedTilesVisible === 2, `nested folder: its 2 today-files are selected on arrival, selection intact (${s.selectedTilesVisible} tiles, ${s.selected.length} selected)`);

    // ═══ Existing work in progress is never replaced ═══
    await main.evaluate(() => { _clearSelection(); });
    const wip = earlier[1];
    await main.evaluate((p) => { selectedFiles.add(p); syncAllTiles(); updateSelectionBar(); }, wip);
    h = await review(app, idH, 'selected');
    s = await ws(main);
    check(h && h.state === 'refused' && h.message.includes('files in progress'), `operator's own selection → refused ("${h && h.message}")`);
    check(JSON.stringify(s.selected) === JSON.stringify([wip]), 'the operator\'s selection was left exactly as it was');

    // Asking again for exactly the same files is not a change.
    await main.evaluate(() => { _clearSelection(); });
    h = await review(app, idH, 'selected');
    const h2 = await review(app, idH, 'selected');
    s = await ws(main);
    check(h && h.state === 'completed' && h2 && h2.state === 'completed' && s.selected.length === today.length, `repeating the same Review keeps the same ${today.length} files (no duplication, no refusal)`);

    // ═══ MEDIA view ═══
    await main.evaluate(() => { _clearSelection(); document.getElementById('viewMediaBtn').click(); });
    s = await ws(main);
    check(s.view === 'media', 'precondition: media view');
    h = await review(app, idH, 'selected');
    s = await ws(main);
    check(h && h.state === 'completed' && JSON.stringify(s.selected) === JSON.stringify(today), `media view: exactly the ${today.length} files selected (${JSON.stringify({ h, n: s.selected.length, view: s.view, visible: s.visible })})`);

    // ═══ Pending state + repeated clicks on a slow open ═══
    await main.evaluate(() => { _clearSelection(); });
    await inMain.showPopup(app);
    const page = await waitFor(async () => popupPage(app), 8000, 50);
    const before = (await inMain.diag(app)).handoff.operationsStarted;
    const answers = page.evaluate((id) => Promise.all([window.companion.reviewSelected(id), window.companion.reviewSelected(id), window.companion.reviewSelected(id)]), idBig).catch(() => null);
    const pending = await waitFor(async () => { const x = await inMain.diag(app); const a = x.handoff.active; return a && a.phase === 'opening' ? x : null; }, 20000, 50);
    check(!!pending, 'while the workspace opens the large card the operation is pending and acknowledged (heartbeat)');
    check(pending && pending.snapshot.sources.find(x => x.sourceId === idBig).assessment.handoff.state === 'pending' && pending.snapshot.sources.every(x => !x.assessment || x.assessment.handoffPending), 'the popup snapshot shows it pending and disables Review on every card');
    const final = await waitFor(async () => { const x = await inMain.diag(app); return !x.handoff.inFlight ? x : null; }, 180000, 200);
    const hb = final && final.snapshot.sources.find(x => x.sourceId === idBig).assessment.handoff;
    check(final && final.handoff.operationsStarted === before + 1, `three rapid clicks started exactly one operation (${final && final.handoff.operationsStarted - before})`);
    check(hb && hb.state === 'completed' && hb.message.includes(`${BIG_FILES.toLocaleString()} files selected`), `slow open completed, not reported as failed ("${hb && hb.message}")`);
    await answers; // the popup closes on the first click, so the extra replies may not be readable here
    s = await ws(main);
    check(s.source === BIG && s.selected.length === BIG_FILES, `large card open with all ${BIG_FILES} today-files selected`);

    check(pageErrors.length === 0, `no renderer page errors (${JSON.stringify(pageErrors)})`);
    if (failures) { const lf = path.join(userDataDir, 'app.log'); log('LOG', fs.existsSync(lf) ? fs.readFileSync(lf, 'utf8').split('\n').filter(l => /handoff/.test(l)).join(' | ') : 'no log'); }
  } catch (err) {
    failures++;
    log('FAIL — exception:', err && err.stack || err);
  } finally {
    await app.close().catch(() => {});
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
  log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
