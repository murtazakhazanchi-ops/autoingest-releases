'use strict';

// AI-FEAT-061 Q2 — live verification of the smart date-based card assessment in the
// real Electron app (real main.js, shared poller, real fileBrowser discovery, the real
// shared ExifTool pool, companion popup and the main-window workspace) in an isolated
// userData. Only the OS drive enumeration is stubbed (Electron -r, as in the Q1 live
// tests); card "volumes" are synthetic temp folders holding REAL media files whose
// capture metadata was written by ExifTool before the app starts.
//
// Covers: today / earlier / later / uncertain totals equal the fixture truth and the
// workspace's own file count; RAW+JPEG pairs (consistent and inconsistent); video;
// missing timestamps; wrong camera clock suggestion; date selection; cross-midnight
// range; Review Selected Date selects exactly that date's files in the existing
// workspace (no import); refusal while busy / while the workspace holds other work;
// multiple cards; removal during assessment (cancel) and reconnection (fresh result);
// responsiveness and throughput on a 1,000-file card; source files unchanged; the Q1
// automatic popup still opens.
//
// Run: node test/companionQ2Live.test.js     (macOS)

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
const BIG_CARD_PAIRS = 500; // RAW+JPEG: 1,000 files, half of them read through the ExifTool pool
const BIG_CARD_FILES = BIG_CARD_PAIRS * 2;

function log(...args) { console.log('[companion-q2]', ...args); }
let failures = 0;
function check(cond, msg) { if (cond) log('PASS —', msg); else { failures++; log('FAIL —', msg); } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const mkTmp = (prefix) => fsp.mkdtemp(path.join(os.tmpdir(), prefix));

async function waitFor(fn, timeoutMs, stepMs = 250) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(stepMs);
  }
  return last;
}

// ── Dates relative to this computer's local "today" (the app uses the same clock) ──
const pad = (n) => String(n).padStart(2, '0');
function localDay(offsetDays) {
  const d = new Date(); d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const exifStamp = (day, time) => `${day.replace(/-/g, ':')} ${time}`;
const T = localDay(0), YESTERDAY = localDay(-1), T_MINUS_3 = localDay(-3), T_PLUS_2 = localDay(2);

// ── Fixture media ───────────────────────────────────────────────────────────────
const NOISE = (() => { const b = Buffer.alloc(240 * 240 * 3); for (let i = 0; i < b.length; i++) b[i] = (i * 7919) % 251; return b; })();
const jpegBytes = () => sharp(NOISE, { raw: { width: 240, height: 240, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
const tiffBytes = () => sharp(NOISE, { raw: { width: 240, height: 240, channels: 3 } }).tiff({ compression: 'none' }).toBuffer(); // TIFF-based RAW stand-in, > the 50 KB discovery minimum

/** Minimal MP4 (ftyp, mdat, moov/mvhd AFTER mdat as cameras write it); mvhd time = QuickTime CreateDate. */
function mp4Bytes(day, time) {
  const box = (type, body) => { const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length); h.write(type, 4, 'latin1'); return Buffer.concat([h, body]); };
  const [y, mo, d] = day.split('-').map(Number);
  const [hh, mi] = time.split(':').map(Number);
  const t = Date.UTC(y, mo - 1, d, hh, mi) / 1000 + 2082844800;
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(t, 4); mvhd.writeUInt32BE(t, 8); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(1000, 16);
  mvhd.writeUInt32BE(0x00010000, 20); mvhd.writeUInt16BE(0x0100, 24);
  [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].forEach((v, i) => mvhd.writeUInt32BE(v >>> 0, 36 + i * 4));
  mvhd.writeUInt32BE(2, 96);
  const ftyp = box('ftyp', Buffer.concat([Buffer.from('isom'), Buffer.from([0, 0, 2, 0]), Buffer.from('isomiso2mp41')]));
  return Buffer.concat([ftyp, box('mdat', Buffer.alloc(80 * 1024)), box('moov', box('mvhd', mvhd))]);
}

const STUB_SRC = `
'use strict';
const fs = require('fs');
const dl = require(require.resolve('drivelist', { paths: [process.env.AI_TEST_PROJECT_ROOT] }));
dl.list = async () => { try { return JSON.parse(fs.readFileSync(process.env.AI_TEST_DRIVES_FILE, 'utf8')); } catch { return []; } };
`;

function fakeDrive(mountpoint, label, size = 64e9) {
  return { isSystem: false, isVirtual: false, isUSB: true, isRemovable: true, isCard: true, busType: 'SD', size, description: 'Synthetic SD', mountpoints: [{ path: mountpoint, label }] };
}

async function snapshotTree(dir) {
  const out = {};
  async function walk(d) {
    for (const e of await fsp.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else { const st = await fsp.stat(p); out[p] = `${st.size}:${st.mtimeMs}`; }
    }
  }
  await walk(dir);
  return out;
}

const inMain = {
  diag: (app) => app.evaluate((_e, m) => process.getBuiltinModule('module').createRequire(m)('../services/companionService').getDiagnostics(), MAIN_JS),
  appWindows: (app) => app.evaluate((_e, m) => process.getBuiltinModule('module').createRequire(m)('../services/windowRegistry').getAppWindows().length, MAIN_JS),
  closeMain: async (app) => {
    await waitFor(() => app.evaluate((_e, m) => { const w = process.getBuiltinModule('module').createRequire(m)('../services/windowRegistry').getMainWindow(); return !w || w.getOpacity() >= 1; }, MAIN_JS), 5000);
    await sleep(100);
    await app.evaluate((_e, m) => { const w = process.getBuiltinModule('module').createRequire(m)('../services/windowRegistry').getMainWindow(); if (w) w.close(); }, MAIN_JS);
  },
  showPopup: (app) => app.evaluate((_e, m) => { process.getBuiltinModule('module').createRequire(m)('../services/companionService').showPopup(); }, MAIN_JS),
  activity: (app, op, arg) => app.evaluate((_e, { m, op, arg }) => {
    const a = process.getBuiltinModule('module').createRequire(m)('../services/operatorActivity');
    return op === 'begin' ? a.begin(arg) : a.end(arg);
  }, { m: MAIN_JS, op, arg }),
  // Main-process event-loop lag sampler (ms), to show the tray stays responsive.
  lagStart: (app) => app.evaluate(() => {
    globalThis.__q2Lag = { max: 0, samples: 0 };
    let last = Date.now();
    globalThis.__q2LagTimer = setInterval(() => { const now = Date.now(); const lag = now - last - 50; last = now; globalThis.__q2Lag.max = Math.max(globalThis.__q2Lag.max, lag); globalThis.__q2Lag.samples++; }, 50);
  }),
  lagStop: (app) => app.evaluate(() => { clearInterval(globalThis.__q2LagTimer); return globalThis.__q2Lag; }),
};

const sourceIdOf = (d, label) => (d.snapshot.sources.find(s => s.label === label) || {}).sourceId;
const jobOf = (d, id) => (d.assessment.jobs.find(j => j.sourceId === id) || null);

function popupPage(app) {
  return app.windows().filter(p => !p.isClosed() && p.url().endsWith('companion.html')).pop() || null;
}

async function popupRows(app) {
  const page = popupPage(app);
  if (!page) return null;
  return page.evaluate(() => [...document.querySelectorAll('.card-row')].map(r => {
    const q = (s) => r.querySelector(s);
    return {
      id: r.dataset.sourceId,
      label: q('.card-label').textContent,
      resultShown: !q('.assess-result').hidden,
      progressShown: !q('.assess-progress').hidden,
      progressText: q('.progress-text').textContent,
      selected: q('.selected-num').textContent,
      caption: q('.selected-caption').textContent,
      breakdown: q('.selected-breakdown').textContent,
      earlier: q('.earlier-count').textContent,
      later: q('.later-count').textContent,
      laterHidden: q('.later-bucket').hidden,
      uncertain: q('.uncertain-count').textContent,
      note: q('.assess-note').hidden ? '' : q('.assess-note').textContent,
      suggestion: q('.suggestion').hidden ? '' : q('.suggestion-text').textContent,
      notice: q('.assess-notice').hidden ? '' : q('.assess-notice').textContent,
      options: [...q('.date-select').options].map(o => o.value),
      dateValue: q('.date-select').value,
      reviewSelectedDisabled: q('.review-selected').disabled,
      reviewEarlierDisabled: q('.review-earlier').disabled,
    };
  })).catch(() => null);
}

async function passSplash(app, window) {
  await window.waitForTimeout(1500);
  const splash = await window.evaluate(() => {
    const vis = id => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  });
  const mainWindowPromise = app.waitForEvent('window', { predicate: p => p.url().endsWith('index.html'), timeout: 30000 });
  if (splash.create) {
    await window.fill('#splashInputName', 'Companion Q2 Operator'); await window.fill('#splashInputRole', 'QA'); await window.click('#splashCreateStartBtn');
  } else if (splash.select) {
    await window.click('#splashNewProfileBtn'); await window.fill('#splashInputName', 'Companion Q2 Operator'); await window.fill('#splashInputRole', 'QA'); await window.click('#splashCreateStartBtn');
  } else if (splash.welcome) { await window.click('#splashContinueBtn'); }
  const main = await mainWindowPromise;
  await main.waitForLoadState('domcontentloaded');
  return main;
}

/** After the main window was closed: the handoff reopens it through the normal splash. */
async function reopenedMain(app) {
  const end = Date.now() + 60000;
  while (Date.now() < end) {
    const main = app.windows().find(p => !p.isClosed() && p.url().endsWith('index.html'));
    if (main) { await main.waitForLoadState('domcontentloaded'); return main; }
    const splash = app.windows().find(p => !p.isClosed() && p.url().endsWith('splash.html'));
    if (splash) {
      await splash.evaluate(() => {
        const vis = id => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
        if (vis('splashWelcome')) document.getElementById('splashContinueBtn').click();
        if (vis('splashSelect')) {
          const user = document.querySelector('.splash-user-item');
          const start = document.getElementById('splashSelectStartBtn');
          if (user && !user.classList.contains('selected')) user.click();
          else if (start && !start.disabled) start.click();
        }
      }).catch(() => {});
    }
    await sleep(500);
  }
  throw new Error('main window did not reopen');
}

/** Fresh profile: dismiss first-run onboarding exactly as its own Skip button does. */
async function skipOnboarding(page) {
  await waitFor(() => page.evaluate(() => typeof _registerCompanionHandoff === 'function').catch(() => false), 15000);
  await page.evaluate(() => { if (document.getElementById('onboardingOverlay')?.classList.contains('visible')) document.getElementById('onboardingSkip').click(); }).catch(() => {});
}

async function workspaceState(page) {
  return page.evaluate(() => ({
    visible: document.getElementById('workspace').classList.contains('visible'),
    source: activeSource ? activeSource.path : null,
    files: currentFiles.length,
    selected: [...selectedFiles].sort(),
    importRunning,
  }));
}

(async () => {
  const work = await mkTmp('ai-q2-live-');
  const stubFile = path.join(work, 'drivelist-stub.js');
  const drivesFile = path.join(work, 'drives.json');
  await fsp.writeFile(stubFile, STUB_SRC);
  const setDrives = (list) => fs.writeFileSync(drivesFile, JSON.stringify(list));
  log('work =', work, '| today =', T);

  // ── Build fixture cards (ExifTool writes metadata BEFORE the app starts) ───────
  const et = new ExifTool({ maxProcs: 2 });
  const jpg = await jpegBytes();
  const tif = await tiffBytes();
  async function media(dir, name, bytes, tags) {
    const p = path.join(dir, name);
    await fsp.writeFile(p, bytes);
    if (tags) await et.write(p, tags, { writeArgs: ['-overwrite_original'] });
    return p;
  }

  const cardA = path.join(work, 'cardA');
  const dcimA = path.join(cardA, 'DCIM', '100CANON');
  await fsp.mkdir(dcimA, { recursive: true });
  const dto = (day, time) => ({ DateTimeOriginal: exifStamp(day, time), CreateDate: exifStamp(day, time) });
  const A = {
    today: [
      await media(dcimA, 'IMG_0001.JPG', jpg, dto(T, '10:00:00')),
      await media(dcimA, 'IMG_0001.CR2', tif, dto(T, '10:00:01')),
      await media(dcimA, 'IMG_0002.JPG', jpg, dto(T, '11:30:00')),
      await media(dcimA, 'MVI_0003.MP4', mp4Bytes(T, '12:00')),          // QuickTime UTC-ambiguous, same day both ways
      await media(dcimA, 'IMG_0041.JPG', jpg, dto(T, '00:30:00')),       // just after midnight
    ],
    earlier: [
      await media(dcimA, 'IMG_0010.JPG', jpg, dto(YESTERDAY, '21:00:00')),
      await media(dcimA, 'IMG_0011.JPG', jpg, dto(T_MINUS_3, '09:00:00')),
      await media(dcimA, 'IMG_0012.JPG', jpg, dto(T_MINUS_3, '09:05:00')),
    ],
    later: [await media(dcimA, 'IMG_0020.JPG', jpg, dto(T_PLUS_2, '10:00:00'))],
    uncertain: [
      await media(dcimA, 'IMG_0030.JPG', jpg, null),                             // no capture metadata
      await media(dcimA, 'IMG_0031.JPG', jpg, dto(T, '09:00:00')),             // pair members disagree
      await media(dcimA, 'IMG_0031.CR2', tif, dto(T_MINUS_3, '09:00:00')),
    ],
  };
  await fsp.writeFile(path.join(dcimA, 'NOTES.TXT'), 'not media');            // unsupported: not counted
  await fsp.writeFile(path.join(dcimA, 'TINY.JPG'), Buffer.alloc(1024, 1));    // < 50 KB: workspace rule skips it
  await fsp.writeFile(path.join(dcimA, '._IMG_0001.JPG'), Buffer.alloc(60 * 1024, 2)); // AppleDouble junk

  const cardB = path.join(work, 'cardB');
  const dcimB = path.join(cardB, 'DCIM', '100NIKON');
  await fsp.mkdir(dcimB, { recursive: true });
  for (let i = 1; i <= 3; i++) await media(dcimB, `DSC_000${i}.JPG`, jpg, dto('2000-01-01', `00:0${i}:00`)); // camera clock never set

  const cardC = path.join(work, 'cardC');
  const dcimC = path.join(cardC, 'DCIM', '100MSDCF');
  await fsp.mkdir(dcimC, { recursive: true });
  const seedJ = await media(dcimC, 'DSC00000.JPG', jpg, dto(T, '08:00:00'));
  const seedR = await media(dcimC, 'DSC00000.ARW', tif, dto(T, '08:00:00'));
  for (let i = 1; i < BIG_CARD_PAIRS; i++) {
    const stem = `DSC${String(i).padStart(5, '0')}`;
    await fsp.copyFile(seedJ, path.join(dcimC, `${stem}.JPG`));
    await fsp.copyFile(seedR, path.join(dcimC, `${stem}.ARW`));
  }
  await et.end();

  const before = { ...(await snapshotTree(cardA)), ...(await snapshotTree(cardB)) };
  const drive = { A: fakeDrive(cardA, 'Q2_EOS'), B: fakeDrive(cardB, 'Q2_NIKON'), C: fakeDrive(cardC, 'Q2_SONY') };

  const userDataDir = await mkTmp('ai-q2-live-userdata-');
  setDrives([]);
  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: ['-r', stubFile, PROJECT_ROOT, '--user-data-dir=' + userDataDir, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
    env: { ...process.env, AI_TEST_DRIVES_FILE: drivesFile, AI_TEST_PROJECT_ROOT: PROJECT_ROOT },
  });
  const pageErrors = [];
  app.on('window', p => p.on('pageerror', err => pageErrors.push(`${p.url().split('/').pop()}: ${err.message}`)));

  try {
    let main = await passSplash(app, await app.firstWindow({ timeout: 60000 }));
    await skipOnboarding(main);
    await waitFor(async () => (await inMain.diag(app)).monitor.pollCount >= 2, 15000);

    // ═══ Q1 automatic popup still opens on a new card; assessment runs ═══
    await inMain.closeMain(app);
    await waitFor(async () => (await inMain.appWindows(app)) === 0, 5000);
    setDrives([drive.A]);
    let d = await waitFor(async () => { const x = await inMain.diag(app); return x.popupOpen && x.autoOpenCount === 1 ? x : null; }, 15000);
    check(!!d, 'Q1 behaviour kept: a newly connected card opens the popup automatically');
    const idA = sourceIdOf(await inMain.diag(app), 'Q2_EOS');
    await inMain.showPopup(app); // focused, so it stays open while the test reads it
    let row = await waitFor(async () => { const r = await popupRows(app); return r && r[0] && r[0].resultShown ? r[0] : null; }, 30000);
    check(!!row, 'assessment completes and the popup shows its result');

    // ═══ Totals equal the fixture truth ═══
    check(row && row.label === 'Q2_EOS', 'popup shows the connected card name');
    check(row && row.dateValue === T && row.caption.includes('today'), `default selection is today (${row && row.dateValue}, "${row && row.caption}")`);
    check(row && row.selected === '5', `today's count = 5 (JPEG+CR2 pair, JPEG, MP4, 00:30 JPEG) — got ${row && row.selected}`);
    check(row && row.earlier === '3', `earlier files = 3 — got ${row && row.earlier}`);
    check(row && row.later === '1' && !row.laterHidden, `later (future-dated) files = 1, shown — got ${row && row.later}`);
    check(row && row.uncertain === '3', `uncertain = 3 (no metadata + disagreeing RAW/JPEG pair) — got ${row && row.uncertain}`);
    check(row && /3 photos · 1 RAW · 1 video · 1 RAW\+JPEG pair/.test(row.breakdown), `selected breakdown accounts for RAW and JPEG individually + the pair ("${row && row.breakdown}")`);
    check(row && row.note.includes('RAW/JPEG pair disagrees 2') && row.note.includes('no capture date 1'), `uncertain reasons are visible ("${row && row.note}")`);
    check(row && row.note.includes('after today') && row.note.includes('no time zone'), 'future date and video time-zone uncertainty are called out');
    check(row && JSON.stringify(row.options) === JSON.stringify([T_PLUS_2, T, YESTERDAY, T_MINUS_3]), `date selector offers the dates present (${row && row.options})`);
    check(row && !row.reviewSelectedDisabled && !row.reviewEarlierDisabled, 'both Review actions are available');

    // ═══ Date selection changes; cross-midnight range ═══
    const page = popupPage(app);
    await page.selectOption(`.card-row[data-source-id="${idA}"] .date-select`, T_MINUS_3);
    row = await waitFor(async () => { const r = (await popupRows(app))[0]; return r.dateValue === T_MINUS_3 && r.selected === '2' ? r : null; }, 5000);
    check(!!row && row.earlier === '0' && row.later === '7' && row.uncertain === '3', `choosing ${T_MINUS_3} updates every count (${row && [row.selected, row.earlier, row.later, row.uncertain]})`);
    await page.selectOption(`.card-row[data-source-id="${idA}"] .date-select`, YESTERDAY);
    await waitFor(async () => (await popupRows(app))[0].dateValue === YESTERDAY, 5000);
    await page.selectOption(`.card-row[data-source-id="${idA}"] .midnight-select`, '01:00');
    row = await waitFor(async () => { const r = (await popupRows(app))[0]; return r.selected === '2' ? r : null; }, 5000);
    check(!!row && row.caption.includes('after midnight until 01:00'), `range ${YESTERDAY} + until 01:00 includes the 00:30 file (selected ${row && row.selected}, "${row && row.caption}")`);
    await page.selectOption(`.card-row[data-source-id="${idA}"] .midnight-select`, '');
    await page.selectOption(`.card-row[data-source-id="${idA}"] .date-select`, T);
    row = await waitFor(async () => { const r = (await popupRows(app))[0]; return r.selected === '5' ? r : null; }, 5000);
    check(!!row, 'back to today: 5 selected');

    // ═══ Refusal while busy: nothing opens ═══
    const token = await inMain.activity(app, 'begin', 'import');
    await page.click(`.card-row[data-source-id="${idA}"] .review-selected`);
    row = await waitFor(async () => { const r = await popupRows(app); return r && r[0].notice ? r[0] : null; }, 5000);
    check(!!row && row.notice.includes('busy'), `Review is refused while an import runs ("${row && row.notice}")`);
    check((await inMain.appWindows(app)) === 0, 'refusal opened no window');
    await inMain.activity(app, 'end', token);

    // ═══ Review Selected Date → workspace opens the card with exactly today's files selected ═══
    await page.click(`.card-row[data-source-id="${idA}"] .review-selected`);
    main = await reopenedMain(app); // the closed main window reopens through its normal splash
    await skipOnboarding(main);
    const ws = await waitFor(async () => { const s = await workspaceState(main).catch(() => null); return s && s.visible && s.selected.length ? s : null; }, 60000);
    check(!!ws && ws.source === cardA, 'handoff opened the card in the existing workspace');
    check(!!ws && JSON.stringify(ws.selected) === JSON.stringify([...A.today].sort()), `exactly today's 5 files are selected (${ws && ws.selected.map(p => path.basename(p))})`);
    check(!!ws && ws.files === 12, `workspace lists the same 12 media files the assessment counted (${ws && ws.files})`);
    check(!!ws && !ws.importRunning, 'nothing was imported (import is still the operator\'s step)');
    d = await inMain.diag(app);
    check(d.handoff && !d.handoff.inFlight && d.handoff.workspaceReady, 'handoff finished; workspace announced ready');

    // ═══ Another card: refused while the workspace holds this selection ═══
    setDrives([drive.A, drive.B]);
    await waitFor(async () => !!sourceIdOf(await inMain.diag(app), 'Q2_NIKON'), 15000);
    const idB = sourceIdOf(await inMain.diag(app), 'Q2_NIKON');
    await inMain.showPopup(app);
    let rows = await waitFor(async () => { const r = await popupRows(app); return r && r.length === 2 && r.every(x => x.resultShown) ? r : null; }, 30000);
    const rowB = rows && rows.find(r => r.id === idB);
    check(!!rows, 'multiple cards: each card has its own assessment');
    check(!!rowB && rowB.selected === '0' && rowB.earlier === '3' && rowB.suggestion.includes('2000'), `wrong camera clock: no files today, suggestion offered ("${rowB && rowB.suggestion}")`);
    check(rows && rows.find(r => r.id === idA).selected === '5', 'card A keeps its own counts beside card B');
    await popupPage(app).click(`.card-row[data-source-id="${idB}"] .review-earlier`);
    row = await waitFor(async () => { const r = await popupRows(app); const x = r && r.find(y => y.id === idB); return x && x.notice ? x : null; }, 15000);
    check(!!row && row.notice.includes('files in progress'), `opening another card is refused while the workspace holds a selection ("${row && row.notice}")`);
    const ws2 = await workspaceState(main);
    check(ws2.source === cardA && ws2.selected.length === 5, 'the operator\'s workspace and selection were left untouched');

    // ═══ A dialog open in the workspace (Settings) → refused, nothing changes ═══
    await main.evaluate(() => _clearSelection());
    await main.evaluate(() => document.getElementById('settingsModal').classList.add('visible'));
    await inMain.showPopup(app);
    await popupPage(app).click(`.card-row[data-source-id="${idB}"] .review-earlier`);
    row = await waitFor(async () => { const r = await popupRows(app); const x = r && r.find(y => y.id === idB); return x && x.notice ? x : null; }, 15000);
    check(!!row && row.notice.includes('busy'), `refused while a workspace dialog is open ("${row && row.notice}")`);
    check((await workspaceState(main)).source === cardA, 'the workspace kept its card while the dialog was open');
    await main.evaluate(() => { document.getElementById('settingsModal').classList.remove('visible'); });
    await main.evaluate((ps) => { ps.forEach(p => selectedFiles.add(p)); syncAllTiles(); updateSelectionBar(); }, A.today);

    // ═══ Use the suggestion, then Review Earlier Files after clearing the selection ═══
    await inMain.showPopup(app);
    await popupPage(app).click(`.card-row[data-source-id="${idB}"] .use-suggestion`);
    row = await waitFor(async () => { const r = await popupRows(app); const x = r && r.find(y => y.id === idB); return x && x.selected === '3' ? x : null; }, 5000);
    check(!!row && row.dateValue === '2000-01-01', 'suggested date selected: its 3 files counted, dates unchanged');
    check(!!row && row.reviewEarlierDisabled, 'with the suggested date selected there are no earlier files: Review Earlier Files is disabled');
    await popupPage(app).selectOption(`.card-row[data-source-id="${idB}"] .date-select`, T);
    row = await waitFor(async () => { const r = await popupRows(app); const x = r && r.find(y => y.id === idB); return x && x.earlier === '3' && !x.reviewEarlierDisabled ? x : null; }, 5000);
    check(!!row, 'back on today: card B\'s 3 files are earlier files');
    await main.evaluate(() => _clearSelection());
    await inMain.showPopup(app);
    await popupPage(app).click(`.card-row[data-source-id="${idB}"] .review-earlier`);
    const ws3 = await waitFor(async () => { const s = await workspaceState(main); return s.source === cardB && s.visible && s.files > 0 ? s : null; }, 30000);
    check(!!ws3 && ws3.files === 3 && ws3.selected.length === 0, `Review Earlier Files opens the whole card with no preselection (${JSON.stringify(ws3 && { files: ws3.files, selected: ws3.selected.length })})`);

    // ═══ Large card: throughput, responsiveness, removal mid-assessment, reconnection ═══
    await inMain.lagStart(app);
    setDrives([drive.A, drive.B, drive.C]);
    const idC = await waitFor(async () => sourceIdOf(await inMain.diag(app), 'Q2_SONY'), 15000);
    await waitFor(async () => { const j = jobOf(await inMain.diag(app), idC); return j && j.state === 'reading' && j.done > 50 ? j : null; }, 30000, 50);
    const t0 = Date.now();
    await inMain.showPopup(app);
    const popupVisibleMs = (await waitFor(async () => (await inMain.diag(app)).popupOpen, 5000, 20)) ? Date.now() - t0 : null;
    setDrives([drive.A, drive.B]); // pulled mid-assessment
    d = await waitFor(async () => { const x = await inMain.diag(app); return !jobOf(x, idC) && !sourceIdOf(x, 'Q2_SONY') ? x : null; }, 15000);
    check(!!d, 'card removed during assessment: job cancelled and dropped');
    const removedAt = Date.now();
    const stopped = await waitFor(async () => (await inMain.diag(app)).assessment.running !== idC, 2000, 20);
    check(!!stopped, `the removed card's assessment stops promptly (${Date.now() - removedAt} ms after removal was polled)`);
    setDrives([drive.A, drive.B, drive.C]); // reconnected
    const idC2 = await waitFor(async () => sourceIdOf(await inMain.diag(app), 'Q2_SONY'), 15000);
    check(idC2 && idC2 !== idC, 'reconnection is a new attachment (fresh sourceId)');
    const jobC = await waitFor(async () => { const j = jobOf(await inMain.diag(app), idC2); return j && j.state === 'complete' ? j : null; }, 180000, 200);
    const elapsed = jobC ? jobC.durationMs : NaN;
    const lag = await inMain.lagStop(app);
    check(!!jobC && jobC.total === BIG_CARD_FILES, `reconnected card assessed afresh: ${jobC && jobC.total} files`);
    log(`PERF — ${BIG_CARD_FILES} files (${BIG_CARD_PAIRS} RAW+JPEG pairs) assessed in ${elapsed} ms (${(BIG_CARD_FILES / (elapsed / 1000)).toFixed(0)} files/s); main-process max event-loop lag ${lag.max} ms over ${lag.samples} samples; popup shown in ${popupVisibleMs} ms during assessment`);
    check(lag.max < 500, `main process stays responsive during assessment (max lag ${lag.max} ms)`);
    await inMain.showPopup(app);
    rows = await waitFor(async () => { const r = await popupRows(app); const x = r && r.find(y => y.id === idC2); return x && x.resultShown ? r : null; }, 10000);
    const rowC = rows && rows.find(r => r.id === idC2);
    check(rowC && rowC.selected.replace(/\D/g, '') === String(BIG_CARD_FILES), `large card: all files counted under today (${rowC && rowC.selected})`);

    // ═══ Source cards are read-only ═══
    const after = { ...(await snapshotTree(cardA)), ...(await snapshotTree(cardB)) };
    check(JSON.stringify(after) === JSON.stringify(before), 'card files and folders are unchanged (no write, rename or new file)');
    check(pageErrors.length === 0, `no renderer page errors (${JSON.stringify(pageErrors)})`);
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
