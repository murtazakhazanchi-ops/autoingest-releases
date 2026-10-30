'use strict';

// AI-FEAT-061 Q1 — live verification of the AUTOMATIC card popup, driving the real
// Electron app (real main.js, shared poller, tray, popup, IPC) in an isolated userData.
//
// Card fixtures are SYNTHETIC temp folders with a DCIM/ directory. The only stub is the
// OS enumeration call (drivelist.list), installed BEFORE main.js loads (Electron's -r
// flag) and fed from a JSON file this test rewrites — so the startup baseline is
// deterministic and no real card or volume is ever enumerated or touched.
//
// Covers: initial detection (baseline, no popup); new insertion opens once, inactive (no
// focus steal); repeated polling does not reopen; auto-dismiss; manual dismissal is not
// undone by polling; removal + reinsertion reopens; several cards → one popup; a card
// added while open updates it; non-camera drive ignored; suppression while an import /
// a native dialog is in flight and while an AutoIngest window is focused; companion
// disabled via settings.json.
//
// Run: node test/companionAutoPopupLive.test.js     (macOS)

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_BIN = require(path.join(PROJECT_ROOT, 'node_modules', 'electron'));
const MAIN_JS = path.join(PROJECT_ROOT, 'main', 'main.js');
const AUTO_DISMISS_MS = 15000;

function log(...args) { console.log('[companion-auto]', ...args); }
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

const STUB_SRC = `
'use strict';
const fs = require('fs');
const dl = require(require.resolve('drivelist', { paths: [process.env.AI_TEST_PROJECT_ROOT] }));
dl.list = async () => { try { return JSON.parse(fs.readFileSync(process.env.AI_TEST_DRIVES_FILE, 'utf8')); } catch { return []; } };
`;

function fakeDrive(mountpoint, label, size = 64e9) {
  return { isSystem: false, isVirtual: false, isUSB: true, isRemovable: true, isCard: true, busType: 'SD', size, description: 'Synthetic SD', mountpoints: [{ path: mountpoint, label }] };
}

async function makeCardDir(root, name, { dcim = true } = {}) {
  const dir = path.join(root, name);
  await fsp.mkdir(dcim ? path.join(dir, 'DCIM', '100CANON') : dir, { recursive: true });
  if (dcim) await fsp.writeFile(path.join(dir, 'DCIM', '100CANON', 'IMG_0001.JPG'), Buffer.alloc(512, 0xab));
  return dir;
}

const inMain = {
  diag: (app) => app.evaluate((_e, m) => process.getBuiltinModule('module').createRequire(m)('../services/companionService').getDiagnostics(), MAIN_JS),
  focused: (app) => app.evaluate(({ BrowserWindow }) => { const f = BrowserWindow.getFocusedWindow(); return f ? f.webContents.getURL().split('/').pop() : null; }),
  appWindows: (app) => app.evaluate((_e, m) => process.getBuiltinModule('module').createRequire(m)('../services/windowRegistry').getAppWindows().length, MAIN_JS),
  // Waits for the main window's 200 ms fade-in to finish first: closing it mid-fade trips a
  // pre-existing Stable race (the fade timer calls setOpacity on the destroyed window).
  closeMain: async (app) => {
    await waitFor(() => app.evaluate((_e, m) => { const w = process.getBuiltinModule('module').createRequire(m)('../services/windowRegistry').getMainWindow(); return !w || w.getOpacity() >= 1; }, MAIN_JS), 5000);
    await sleep(100);
    await app.evaluate((_e, m) => { const w = process.getBuiltinModule('module').createRequire(m)('../services/windowRegistry').getMainWindow(); if (w) w.close(); }, MAIN_JS);
  },
  call: (app, fn) => app.evaluate((_e, { m, fn }) => { process.getBuiltinModule('module').createRequire(m)('../services/companionService')[fn](); }, { m: MAIN_JS, fn }),
  activity: (app, op, arg) => app.evaluate((_e, { m, op, arg }) => {
    const a = process.getBuiltinModule('module').createRequire(m)('../services/operatorActivity');
    return op === 'begin' ? a.begin(arg) : op === 'end' ? a.end(arg) : { busy: a.isBusy(), kinds: a.activeKinds() };
  }, { m: MAIN_JS, op, arg }),
};

async function popupState(app) {
  const page = app.windows().filter(p => !p.isClosed() && p.url().endsWith('companion.html')).pop();
  if (!page) return null;
  return page.evaluate(() => ({ heading: document.getElementById('status-heading').textContent, labels: [...document.querySelectorAll('.card-label')].map(n => n.textContent) })).catch(() => null);
}

async function passSplash(app) {
  const window = await app.firstWindow({ timeout: 60000 });
  await window.waitForTimeout(1500);
  const splash = await window.evaluate(() => {
    const vis = id => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  });
  const mainWindowPromise = app.waitForEvent('window', { predicate: p => p.url().endsWith('index.html'), timeout: 30000 });
  if (splash.create) {
    await window.fill('#splashInputName', 'Companion Auto Operator'); await window.fill('#splashInputRole', 'QA'); await window.click('#splashCreateStartBtn');
  } else if (splash.select) {
    await window.click('#splashNewProfileBtn'); await window.fill('#splashInputName', 'Companion Auto Operator'); await window.fill('#splashInputRole', 'QA'); await window.click('#splashCreateStartBtn');
  } else if (splash.welcome) { await window.click('#splashContinueBtn'); }
  const main = await mainWindowPromise;
  await main.waitForLoadState('domcontentloaded');
  return main;
}

async function launch(userDataDir, drivesFile, stubFile) {
  return electron.launch({
    executablePath: ELECTRON_BIN,
    // Electron's own -r: the stub is loaded into the main process before main.js runs.
    args: ['-r', stubFile, PROJECT_ROOT, '--user-data-dir=' + userDataDir, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
    env: { ...process.env, AI_TEST_DRIVES_FILE: drivesFile, AI_TEST_PROJECT_ROOT: PROJECT_ROOT },
  });
}

(async () => {
  const work = await mkTmp('ai-q1-auto-');
  const stubFile = path.join(work, 'drivelist-stub.js');
  const drivesFile = path.join(work, 'drives.json');
  await fsp.writeFile(stubFile, STUB_SRC);
  const setDrives = (list) => fs.writeFileSync(drivesFile, JSON.stringify(list));
  const cards = {};
  for (const n of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'Z']) cards[n] = await makeCardDir(work, 'card' + n);
  const plainDrive = await makeCardDir(work, 'plainUsb', { dcim: false });
  const drive = (n) => fakeDrive(cards[n], 'AUTO_' + n);
  const userDataDir = await mkTmp('ai-q1-auto-userdata-');
  log('work =', work);

  // Waits until the poller has completed `n` more polls.
  const polls = async (app, n) => {
    const start = (await inMain.diag(app)).monitor.pollCount;
    return waitFor(async () => (await inMain.diag(app)).monitor.pollCount >= start + n, 8000 * n);
  };

  // ═══ Initial detection: card present at launch ═══
  setDrives([drive('A')]);
  const app = await launch(userDataDir, drivesFile, stubFile);
  const pageErrors = [];
  app.on('window', p => p.on('pageerror', err => pageErrors.push(`${p.url().split('/').pop()}: ${err.message}`)));
  try {
    await passSplash(app);
    await polls(app, 2);
    let d = await inMain.diag(app);
    check(d.snapshot && d.snapshot.sources.some(s => s.label === 'AUTO_A'), 'initial detection: card present at launch is detected');
    check(d.autoOpenCount === 0 && !d.popupOpen, 'initial detection: a card already connected at startup does not open the popup (baseline)');

    // ═══ New insertion (main window closed, nothing of AutoIngest focused) ═══
    await inMain.closeMain(app);
    await waitFor(async () => (await inMain.appWindows(app)) === 0, 5000);
    check((await inMain.focused(app)) === null, 'precondition: no AutoIngest window focused');
    setDrives([drive('A'), drive('B')]);
    d = await waitFor(async () => { const x = await inMain.diag(app); return x.popupOpen && x.autoOpenCount === 1 ? x : null; }, 15000);
    check(!!d, 'new card insertion opens the popup automatically');
    await sleep(800);
    d = await inMain.diag(app);
    check(d.popupOpen && !d.popupFocused && (await inMain.focused(app)) === null, 'automatic popup does not take focus (shown inactive)');
    check(d.autoDismissPending, 'automatic popup has its auto-dismiss pending');
    const st = await waitFor(async () => { const s = await popupState(app); return s && s.labels.length === 2 ? s : null; }, 5000);
    check(st && st.labels.includes('AUTO_A') && st.labels.includes('AUTO_B'), `popup lists the connected cards (${JSON.stringify(st)})`);

    // ═══ Repeated polling ═══
    const openCountBefore = d.popupOpenCount;
    await polls(app, 2);
    d = await inMain.diag(app);
    check(d.autoOpenCount === 1 && d.popupOpenCount === openCountBefore, 'repeated polling of the same cards does not reopen/duplicate the popup');

    // ═══ Auto-dismiss, then not reopened by polling ═══
    d = await waitFor(async () => { const x = await inMain.diag(app); return !x.popupOpen ? x : null; }, AUTO_DISMISS_MS + 6000);
    check(!!d, 'an automatic popup the operator ignores hides itself');
    await polls(app, 2);
    d = await inMain.diag(app);
    check(!d.popupOpen && d.autoOpenCount === 1, 'an auto-dismissed popup is not reopened while the same cards stay connected');

    // ═══ Removal + reinsertion; then manual dismissal ═══
    setDrives([drive('A')]);
    await polls(app, 1);
    d = await inMain.diag(app);
    check(!d.popupOpen && d.autoOpenCount === 1, 'card removal does not open the popup');
    setDrives([drive('A'), drive('B')]);
    d = await waitFor(async () => { const x = await inMain.diag(app); return x.popupOpen && x.autoOpenCount === 2 ? x : null; }, 15000);
    check(!!d, 'removing and reinserting a card opens the popup again');
    const page = app.windows().filter(p => !p.isClosed() && p.url().endsWith('companion.html')).pop();
    // hide() destroys the popup page, so the evaluate itself may report the page closed.
    await page.evaluate(() => window.companion.hide()).catch(() => {});
    await waitFor(async () => !(await inMain.diag(app)).popupOpen, 5000);
    await polls(app, 2);
    d = await inMain.diag(app);
    check(!d.popupOpen && d.autoOpenCount === 2, 'a manually dismissed popup is not reopened by polling');

    // ═══ Several cards at once → one popup; another card while open → update, no reopen ═══
    setDrives([drive('A'), drive('B'), drive('C'), drive('D')]);
    d = await waitFor(async () => { const x = await inMain.diag(app); return x.popupOpen && x.autoOpenCount === 3 ? x : null; }, 15000);
    check(!!d, 'two cards connected in the same poll open ONE popup');
    const countWithCD = d && d.popupOpenCount;
    setDrives([drive('A'), drive('B'), drive('C'), drive('D'), drive('E')]);
    const st2 = await waitFor(async () => { const s = await popupState(app); return s && s.labels.includes('AUTO_E') ? s : null; }, 15000);
    d = await inMain.diag(app);
    check(!!st2 && d.autoOpenCount === 3 && d.popupOpenCount === countWithCD, 'a card connected while the popup is open updates it in place (no second popup)');
    await inMain.call(app, 'hidePopup');
    await waitFor(async () => !(await inMain.diag(app)).popupOpen, 5000);

    // ═══ Unrelated (non-camera) drive ═══
    setDrives([drive('A'), drive('B'), drive('C'), drive('D'), drive('E'), fakeDrive(plainDrive, 'PLAIN_USB')]);
    await polls(app, 2);
    d = await inMain.diag(app);
    check(!d.popupOpen && d.autoOpenCount === 3, 'a drive without DCIM (not a camera source) does not open the popup');

    // ═══ Suppression: import in progress ═══
    const token = await inMain.activity(app, 'begin', 'import');
    setDrives([drive('A'), drive('F')]);
    await polls(app, 2);
    d = await inMain.diag(app);
    check(!d.popupOpen && d.autoOpenCount === 3 && d.autoOpenSuppressedCount === 1, 'no automatic popup while an import is in progress');
    await inMain.activity(app, 'end', token);
    await polls(app, 1);
    d = await inMain.diag(app);
    check(!d.popupOpen, 'the suppressed card does not pop up later (event consumed, not queued)');

    // ═══ Suppression: native dialog in flight (real main.js handler registration) ═══
    const dialogWired = await app.evaluate(async ({ ipcMain, dialog }) => {
      const h = ipcMain._invokeHandlers && ipcMain._invokeHandlers.get('dest:choose');
      if (!h) return 'no-handler-access';
      globalThis.__aiReleaseDialog = null;
      dialog.showOpenDialog = () => new Promise(r => { globalThis.__aiReleaseDialog = () => r({ canceled: true, filePaths: [] }); });
      globalThis.__aiDialogDone = Promise.resolve(h({ sender: null }));
      return 'ok';
    });
    if (dialogWired === 'ok') {
      const a1 = await inMain.activity(app, 'state');
      check(a1.busy && a1.kinds.includes('dialog'), `a dialog-opening IPC handler marks the operator busy (${JSON.stringify(a1)})`);
      setDrives([drive('A'), drive('F'), drive('G')]);
      await polls(app, 2);
      d = await inMain.diag(app);
      check(!d.popupOpen && d.autoOpenSuppressedCount === 2, 'no automatic popup while a native dialog is open');
      await app.evaluate(async () => { globalThis.__aiReleaseDialog(); await globalThis.__aiDialogDone; });
      const a2 = await inMain.activity(app, 'state');
      check(!a2.busy, 'busy state clears when the dialog closes');
    } else {
      log('PARTIAL — dialog wiring check skipped:', dialogWired);
    }

    // ═══ Suppression: an AutoIngest window is focused ═══
    const reopened = app.waitForEvent('window', { predicate: p => /splash\.html|index\.html/.test(p.url()), timeout: 20000 }).catch(() => null);
    await app.evaluate((_e, m) => { process.getBuiltinModule('module').createRequire(m)('../services/companionService').showPopup(); }, MAIN_JS);
    const pp = await waitFor(async () => app.windows().filter(p => !p.isClosed() && p.url().endsWith('companion.html')).pop(), 8000);
    if (pp) await pp.evaluate(() => window.companion.openAutoIngest()).catch(() => {});
    const appWin = await reopened;
    const focusedName = await waitFor(async () => { const f = await inMain.focused(app); return f && f !== 'companion.html' ? f : null; }, 8000);
    if (appWin && focusedName) {
      const before = (await inMain.diag(app)).autoOpenSuppressedCount;
      setDrives([drive('A'), drive('F'), drive('G'), drive('H')]);
      await polls(app, 2);
      d = await inMain.diag(app);
      check(!d.popupOpen && d.autoOpenSuppressedCount === before + 1, `no automatic popup while an AutoIngest window (${focusedName}) is focused`);
    } else {
      log(`PARTIAL — could not focus an AutoIngest window in this session (window=${!!appWin}, focused=${focusedName}); focused-window suppression not exercised`);
    }

    check(pageErrors.length === 0, `no renderer page errors (${JSON.stringify(pageErrors)})`);
  } catch (err) {
    failures++;
    log('FATAL', err && err.stack);
  } finally {
    await app.close().catch(() => {});
  }

  // ═══ Companion disabled via settings.json ═══
  const disabledDir = await mkTmp('ai-q1-auto-disabled-');
  await fsp.writeFile(path.join(disabledDir, 'settings.json'), JSON.stringify({ companionEnabled: false }));
  setDrives([]);
  const app2 = await launch(disabledDir, drivesFile, stubFile);
  try {
    await passSplash(app2);
    await inMain.closeMain(app2);
    await sleep(1500);
    setDrives([drive('Z')]);
    await sleep(12000);
    const d2 = await inMain.diag(app2);
    const companionWindows = app2.windows().filter(p => !p.isClosed() && p.url().endsWith('companion.html')).length;
    check(!d2.trayActive && d2.popupOpenCount === 0 && d2.autoOpenCount === 0 && companionWindows === 0, 'companionEnabled:false — no tray and no automatic popup on card insertion');
  } catch (err) {
    failures++;
    log('FATAL (disabled)', err && err.stack);
  } finally {
    await app2.close().catch(() => {});
  }

  for (const dir of [work, userDataDir, disabledDir]) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
