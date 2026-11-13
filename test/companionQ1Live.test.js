'use strict';

// AI-FEAT-061 Q1 — live verification of the menu-bar/tray companion foundation,
// driving the REAL Electron app (real main.js, real driveDetector DCIM check, real
// shared poller, real Tray, real popup window and IPC) in an isolated userData dir.
//
// Card fixtures are SYNTHETIC: only the OS enumeration call (drivelist.list) is
// stubbed inside the running app, returning drives whose mountpoints are temp folders
// with a DCIM/ directory. Everything downstream of that call runs unmodified. No real
// card, archive, mount or userData is touched.
//
// Covers: tray presence/bounds; card detection before and after the main window
// closes; multiple cards; label collisions; disconnect/reconnect (new sourceId);
// one shared poller; progress targeting with the popup open (R1); popup Open/Quit;
// window-all-closed not re-run by popup closes; no listener/renderer leaks across
// repeated popup opens; second-instance handling (argv forwarded, no second app);
// a different profile is not blocked.
//
// Run: node test/companionQ1Live.test.js     (macOS; tray assertions are platform-aware)

const { _electron: electron } = require('playwright-core');
const { spawn } = require('child_process');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_BIN = require(path.join(PROJECT_ROOT, 'node_modules', 'electron'));
const MAIN_JS = path.join(PROJECT_ROOT, 'main', 'main.js');
const POLL_WAIT_MS = 12000;

function log(...args) { console.log('[companion-q1]', ...args); }
let failures = 0;
function check(cond, msg) { if (cond) log('PASS —', msg); else { failures++; log('FAIL —', msg); } }
const mkTmp = (prefix) => fsp.mkdtemp(path.join(os.tmpdir(), prefix));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

// Main-process helpers (run inside the app via app.evaluate).
const inMain = {
  diag: (app) => app.evaluate((_e, mainJs) => {
    const req = process.getBuiltinModule('module').createRequire(mainJs);
    return req('../services/companionService').getDiagnostics();
  }, MAIN_JS),
  setFakeDrives: (app, drives) => app.evaluate((_e, { mainJs, drives }) => {
    const req = process.getBuiltinModule('module').createRequire(mainJs);
    req('drivelist').list = async () => drives;
  }, { mainJs: MAIN_JS, drives }),
  call: (app, fnName) => app.evaluate((_e, { mainJs, fnName }) => {
    const req = process.getBuiltinModule('module').createRequire(mainJs);
    req('../services/companionService')[fnName]();
  }, { mainJs: MAIN_JS, fnName }),
  windows: (app) => app.evaluate(({ BrowserWindow }, mainJs) => {
    const req = process.getBuiltinModule('module').createRequire(mainJs);
    const reg = req('../services/windowRegistry');
    // A window that is already closing/destroyed is not part of the state under test;
    // reading its webContents would throw. Live windows are still all reported.
    const live = BrowserWindow.getAllWindows().filter(w => !w.isDestroyed() && !w.webContents.isDestroyed());
    return {
      all: live.map(w => ({ id: w.id, url: w.webContents.getURL().split('/').slice(-1)[0], aux: reg.isAuxiliary(w) })),
      mainId: reg.getMainWindow() ? reg.getMainWindow().id : null,
      progressTargetId: reg.getProgressTarget() ? reg.getProgressTarget().id : null,
      legacyFirstWindowId: (BrowserWindow.getAllWindows().find(w => !w.isDestroyed()) || {}).id || null,
      appWindowCount: reg.getAppWindows().length,
    };
  }, MAIN_JS),
  metrics: (app) => app.evaluate(({ app: a, webContents }) => ({
    processes: a.getAppMetrics().length,
    webContents: webContents.getAllWebContents().length,
  })),
};

function fakeDrive(mountpoint, label, size) {
  return { isSystem: false, isVirtual: false, isUSB: true, isRemovable: true, isCard: true, busType: 'SD', size, description: 'Synthetic SD', mountpoints: [{ path: mountpoint, label }] };
}

async function makeCardDir(root, name) {
  const dir = path.join(root, name);
  await fsp.mkdir(path.join(dir, 'DCIM', '100CANON'), { recursive: true });
  await fsp.writeFile(path.join(dir, 'DCIM', '100CANON', 'IMG_0001.JPG'), Buffer.alloc(1024, 0xab));
  return dir;
}

async function popupPage(app) {
  // Skip pages of popups already closed (the popup is destroyed on hide); the newest
  // live page is the current popup.
  return waitFor(async () => app.windows().filter(p => !p.isClosed() && p.url().endsWith('companion.html')).pop(), 10000);
}

// Closed means BOTH: the companion reports no popup AND its window/page is really gone
// (hidePopup() detaches at once and destroys on the next event-loop turn).
async function popupGone(app) {
  const d = await inMain.diag(app);
  const w = await inMain.windows(app);
  return !d.popupOpen && !w.all.some(x => x.aux) && !app.windows().some(p => !p.isClosed() && p.url().endsWith('companion.html'));
}

async function popupState(page) {
  return page.evaluate(() => ({
    heading: document.getElementById('status-heading').textContent,
    labels: [...document.querySelectorAll('.card-label')].map(n => n.textContent),
    disambiguators: [...document.querySelectorAll('.card-disambiguator')].map(n => n.textContent),
    sourceIds: [...document.querySelectorAll('.card-row')].map(n => n.dataset.sourceId),
    // Computed visibility, not just the attribute: CSS display rules can override [hidden].
    emptyVisible: getComputedStyle(document.getElementById('empty-state')).display !== 'none',
    listVisible: getComputedStyle(document.getElementById('card-list')).display !== 'none',
    hasMainApi: typeof window.api !== 'undefined',
    companionKeys: Object.keys(window.companion || {}).sort(),
  }));
}

async function passSplash(app) {
  let window = await app.firstWindow({ timeout: 60000 });
  await window.waitForTimeout(1500);
  const splash = await window.evaluate(() => {
    const vis = id => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  });
  const mainWindowPromise = app.waitForEvent('window', { predicate: p => p.url().endsWith('index.html'), timeout: 30000 });
  if (splash.create) {
    await window.fill('#splashInputName', 'Companion Q1 Operator'); await window.fill('#splashInputRole', 'QA'); await window.click('#splashCreateStartBtn');
  } else if (splash.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else { await window.click('#splashNewProfileBtn'); await window.fill('#splashInputName', 'Companion Q1 Operator'); await window.fill('#splashInputRole', 'QA'); await window.click('#splashCreateStartBtn'); }
  } else if (splash.welcome) { await window.click('#splashContinueBtn'); }
  window = await mainWindowPromise;
  await window.waitForLoadState('domcontentloaded');
  return window;
}

function spawnSecondInstance(userDataDir, marker) {
  return new Promise((resolve) => {
    const child = spawn(ELECTRON_BIN, [PROJECT_ROOT, '--user-data-dir=' + userDataDir, '--no-sandbox', marker], { cwd: PROJECT_ROOT, stdio: 'ignore' });
    const started = Date.now();
    const timer = setTimeout(() => { resolve({ exited: false, child }); }, 15000);
    child.on('exit', (code) => { clearTimeout(timer); resolve({ exited: true, code, ms: Date.now() - started, child }); });
  });
}

(async () => {
  const userDataDir = await mkTmp('ai-q1-userdata-');
  const cardRoot = await mkTmp('ai-q1-cards-');
  const shotDir = path.join(os.tmpdir(), 'ai-q1-screens');
  await fsp.mkdir(shotDir, { recursive: true });
  log('userDataDir =', userDataDir, '| cardRoot =', cardRoot, '| screenshots =', shotDir);

  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [PROJECT_ROOT, '--user-data-dir=' + userDataDir, '--no-sandbox'], cwd: PROJECT_ROOT, timeout: 60000 });
  const pageErrors = [];
  app.on('window', p => p.on('pageerror', err => { pageErrors.push(`${p.url().split('/').pop()}: ${err.message}`); }));
  try {
    // Stub ONLY the OS enumeration before the first real poll result matters.
    await inMain.setFakeDrives(app, []);
    const main = await passSplash(app);
    await main.evaluate(() => { if (typeof obFinish === 'function') obFinish(); });

    // ── Tray + single poller ───────────────────────────────────────────────
    let d = await inMain.diag(app);
    check(d.trayActive, 'tray/menu-bar item created');
    if (process.platform === 'darwin') check(d.trayBounds && d.trayBounds.width > 0 && d.trayBounds.height > 0, `menu-bar item has on-screen bounds ${JSON.stringify(d.trayBounds)}`);
    check(JSON.stringify(d.monitor.consumers) === JSON.stringify(['companion', 'main-window']), `one poller, two consumers: ${JSON.stringify(d.monitor.consumers)}`);
    check(d.monitor.subscriberCount === 1, 'exactly one companion subscriber');
    const p0 = d.monitor.pollCount; await sleep(11000);
    d = await inMain.diag(app);
    const rate = d.monitor.pollCount - p0;
    check(rate >= 1 && rate <= 3, `poll rate over 11 s is ${rate} (one 5 s interval, not two)`);

    // ── Main window receives the unchanged drives broadcast ────────────────
    await main.evaluate(() => { window.__q1Drives = []; window.api.onDrivesUpdated(c => window.__q1Drives.push(c.map(x => x.label))); });

    // ── One card ───────────────────────────────────────────────────────────
    const cardA = await makeCardDir(cardRoot, 'AI_Q1_TEST');
    const cardB = await makeCardDir(cardRoot, 'AI_Q1_TEST 1');
    await inMain.setFakeDrives(app, [fakeDrive(cardA, 'AI_Q1_TEST', 64e9)]);
    d = await waitFor(async () => { const x = await inMain.diag(app); return x.snapshot.sources.length === 1 ? x : null; }, POLL_WAIT_MS);
    check(!!d, 'card detected by the shared poller (real driveDetector DCIM check)');
    const idA1 = d && d.snapshot.sources[0].sourceId;
    const gotBroadcast = await waitFor(() => main.evaluate(() => window.__q1Drives.some(l => l.includes('AI_Q1_TEST'))), POLL_WAIT_MS);
    check(gotBroadcast, 'main window still receives drives:updated with the card (broadcast contract unchanged)');

    // ── Popup: card-present state; R1 progress targeting while it is open ──
    await inMain.call(app, 'showPopup');
    let popup = await popupPage(app);
    check(!!popup, 'popup window opened');
    await popup.waitForSelector('.card-row', { timeout: 5000 });
    let st = await popupState(popup);
    check(st.heading === '1 card connected' && st.labels[0] === 'AI_Q1_TEST', `popup shows the card: ${JSON.stringify(st)}`);
    check(!st.emptyVisible && st.listVisible, 'card state: empty-state is NOT rendered, list is');
    check(!st.hasMainApi, 'popup has NO access to the main window API (window.api undefined)');
    check(JSON.stringify(st.companionKeys) === JSON.stringify(['chooseEvent', 'dumpImport', 'getSnapshot', 'hide', 'listEvents', 'onSnapshot', 'openAutoIngest', 'openEventPicker', 'quit', 'reviewEarlier', 'reviewSelected', 'selectDate', 'setDumpOptions', 'setView']), `popup API is exactly the companion surface (Q1 + Q2 date assessment + EQI-1 Event Dump: setDumpOptions/dumpImport/openEventPicker + EQI-1.1 adaptive view: setView/listEvents/chooseEvent): ${st.companionKeys}`);
    check(!JSON.stringify(st).includes(cardRoot), 'no filesystem path reached the popup');
    await popup.screenshot({ path: path.join(shotDir, 'popup-one-card.png') });

    let w = await inMain.windows(app);
    log('windows with popup open:', JSON.stringify(w));
    check(w.progressTargetId === w.mainId && w.mainId !== null, 'progress target is the main window while the popup is open');
    check(w.all.some(x => x.aux && x.url === 'companion.html'), 'popup is registered as auxiliary');
    if (w.legacyFirstWindowId !== w.mainId) log('NOTE — the pre-Q1 expression getAllWindows().find(...) would have picked window', w.legacyFirstWindowId, '(not the main window) here: R1 reproduced');
    const checksum = await main.evaluate(() => new Promise((resolve) => {
      const off = window.api.onChecksumComplete((r) => { off && off(); resolve({ received: true, r }); });
      window.api.runChecksumVerification();
      setTimeout(() => resolve({ received: false }), 5000);
    }));
    check(checksum.received, 'checksum:complete delivered to the MAIN window while the popup is open');

    // ── Multiple cards + label collision ───────────────────────────────────
    await inMain.setFakeDrives(app, [fakeDrive(cardA, 'AI_Q1_TEST', 64e9), fakeDrive(cardB, 'AI_Q1_TEST', 128e9)]);
    st = await waitFor(async () => { const s = await popupState(popup); return s.labels.length === 2 ? s : null; }, POLL_WAIT_MS);
    check(st && st.heading === '2 cards connected', 'popup live-updates to 2 cards');
    check(st && new Set(st.sourceIds).size === 2, 'same-label cards get distinct sourceIds');
    check(st && JSON.stringify(st.disambiguators) === JSON.stringify(['64 GB', '128 GB']), `collision disambiguated by capacity: ${st && st.disambiguators}`);
    await popup.screenshot({ path: path.join(shotDir, 'popup-two-cards-collision.png') });
    await popup.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await popup.waitForTimeout(500); // let the 120 ms row-background transition settle
    await popup.screenshot({ path: path.join(shotDir, 'popup-two-cards-dark.png') });

    // ── Disconnect / reconnect ────────────────────────────────────────────
    await inMain.setFakeDrives(app, [fakeDrive(cardB, 'AI_Q1_TEST', 128e9)]);
    st = await waitFor(async () => { const s = await popupState(popup); return s.labels.length === 1 ? s : null; }, POLL_WAIT_MS);
    check(st && st.disambiguators[0] === '', 'card A removed; collision cleared');
    await inMain.setFakeDrives(app, [fakeDrive(cardA, 'AI_Q1_TEST', 64e9), fakeDrive(cardB, 'AI_Q1_TEST', 128e9)]);
    d = await waitFor(async () => { const x = await inMain.diag(app); return x.snapshot.sources.length === 2 ? x : null; }, POLL_WAIT_MS);
    const idA2 = d && d.snapshot.sources.find(s => s.disambiguator === '64 GB').sourceId;
    check(idA2 && idA2 !== idA1, `reinserted card is a new attachment (${idA1} → ${idA2})`);

    // ── Popup open/close repeatedly: no leaks ──────────────────────────────
    await inMain.call(app, 'hidePopup');
    check(await waitFor(() => popupGone(app), 3000), 'popup window destroyed after hide');
    const base = await inMain.metrics(app);
    for (let i = 0; i < 8; i++) {
      await inMain.call(app, 'showPopup');
      await popupPage(app);
      await inMain.call(app, 'hidePopup');
      if (!(await waitFor(() => popupGone(app), 3000))) check(false, `popup not destroyed after hide (cycle ${i + 1})`);
    }
    await sleep(1500);
    const after = await inMain.metrics(app);
    d = await inMain.diag(app);
    check(after.webContents === base.webContents, `no leaked webContents after 8 open/close cycles (${base.webContents} → ${after.webContents})`);
    check(after.processes <= base.processes, `no leaked renderer processes (${base.processes} → ${after.processes})`);
    check(d.monitor.subscriberCount === 1 && JSON.stringify(d.monitor.consumers) === JSON.stringify(['companion', 'main-window']), 'subscribers/consumers unchanged by popup cycles');

    // ── No-card state screenshot ───────────────────────────────────────────
    await inMain.setFakeDrives(app, []);
    await waitFor(async () => (await inMain.diag(app)).snapshot.sources.length === 0, POLL_WAIT_MS);
    await inMain.call(app, 'showPopup');
    popup = await popupPage(app);
    await popup.waitForFunction(() => document.getElementById('status-heading').textContent === 'No card connected', null, { timeout: 5000 });
    st = await popupState(popup);
    check(st.emptyVisible && !st.listVisible && st.labels.length === 0, 'no-card state rendered (empty-state shown, list hidden)');
    await popup.screenshot({ path: path.join(shotDir, 'popup-no-card.png') });

    // ── Window routing with the popup FOCUSED ──────────────────────────────
    // A main-window dialog must not be parented to the popup, and main-window
    // minimize must not be applied to it. The dialog is stubbed: none opens.
    const focusedIsPopup = await app.evaluate(async ({ app: a, BrowserWindow, dialog }, mainJs) => {
      const reg = process.getBuiltinModule('module').createRequire(mainJs)('../services/windowRegistry');
      globalThis.__q1DialogParents = [];
      dialog.showOpenDialog = async (w) => { globalThis.__q1DialogParents.push(w && !w.isDestroyed() ? (reg.isAuxiliary(w) ? 'popup' : w.webContents.getURL().split('/').pop()) : 'none'); return { canceled: true, filePaths: [] }; };
      a.focus({ steal: true });
      const p = BrowserWindow.getAllWindows().find(w => reg.isAuxiliary(w) && !w.isDestroyed());
      if (p) p.focus();
      await new Promise(r => setTimeout(r, 300));
      const f = BrowserWindow.getFocusedWindow();
      return !!f && reg.isAuxiliary(f);
    }, MAIN_JS);
    if (focusedIsPopup) {
      await main.evaluate(() => window.electronAPI.invoke('dest:choose'));
      const parents = await app.evaluate(() => globalThis.__q1DialogParents);
      check(JSON.stringify(parents) === JSON.stringify(['index.html']), `main-window dialog parented to the main window while the popup is focused: ${JSON.stringify(parents)}`);
      await main.evaluate(() => window.api.minimize());
      const minimized = await waitFor(() => app.evaluate(({}, mainJs) => process.getBuiltinModule('module').createRequire(mainJs)('../services/windowRegistry').getMainWindow().isMinimized(), MAIN_JS), 3000);
      check(minimized, 'main-window minimize applies to the main window while the popup is focused');
      await app.evaluate(({}, mainJs) => { const w = process.getBuiltinModule('module').createRequire(mainJs)('../services/windowRegistry').getMainWindow(); if (w.isMinimized()) w.restore(); }, MAIN_JS);
      await sleep(800);
    } else {
      log('NOTE — could not give the popup focus in this session; focused-window routing not exercised live');
    }
    await inMain.call(app, 'hidePopup');

    // ── Second instance (same profile): forwarded, exits, no second app ────
    await app.evaluate(({ app: a }) => { globalThis.__q1Second = []; a.on('second-instance', (_e, argv, _cwd, data) => globalThis.__q1Second.push({ argv, data })); });
    const second = await spawnSecondInstance(userDataDir, '--q1-marker=hello');
    check(second.exited && second.code === 0, `second instance exited cleanly (code ${second.code}, ${second.ms} ms)`);
    if (!second.exited) second.child.kill('SIGKILL');
    const forwarded = await waitFor(() => app.evaluate(() => globalThis.__q1Second), 5000);
    check(Array.isArray(forwarded) && forwarded.length === 1 && forwarded[0].data.argv.includes('--q1-marker=hello'), 'launch arguments forwarded to the running instance (additionalData.argv)');
    w = await inMain.windows(app);
    check(w.appWindowCount === 1, 'second launch created no extra window');

    // ── Different profile is NOT blocked (isolated test runs keep working) ─
    const otherProfile = await mkTmp('ai-q1-other-');
    const third = await spawnSecondInstance(otherProfile, '--q1-other');
    check(!third.exited, 'a different userData profile runs independently (not blocked by the lock)');
    if (!third.exited) { third.child.kill('SIGTERM'); await sleep(1500); }
    await fsp.rm(otherProfile, { recursive: true, force: true }).catch(() => {});

    // ── Close the main window: polling continues (macOS keeps the app) ─────
    if (process.platform === 'darwin') {
      await app.evaluate(({ BrowserWindow }, mainJs) => {
        const req = process.getBuiltinModule('module').createRequire(mainJs);
        req('../services/windowRegistry').getMainWindow().close();
      }, MAIN_JS);
      await waitFor(async () => (await inMain.windows(app)).appWindowCount === 0, 8000);
      // window-all-closed (which releases the main-window consumer) fires just after the last 'closed'.
      d = await waitFor(async () => { const x = await inMain.diag(app); return JSON.stringify(x.monitor.consumers) === JSON.stringify(['companion']) ? x : null; }, 8000) || await inMain.diag(app);
      check(JSON.stringify(d.monitor.consumers) === JSON.stringify(['companion']) && d.monitor.running, `after main-window close the poller keeps running for the companion only: ${JSON.stringify(d.monitor)}`);
      await inMain.setFakeDrives(app, [fakeDrive(cardA, 'AI_Q1_TEST', 64e9)]);
      d = await waitFor(async () => { const x = await inMain.diag(app); return x.snapshot.sources.length === 1 ? x : null; }, POLL_WAIT_MS);
      check(!!d, 'card detected AFTER the main window closed');
      check(d && d.trayActive, 'tray still present with no windows open');

      // Popup closing as the last window fires window-all-closed again; the guarded
      // handler must leave the companion consumer and the tray alone.
      await inMain.call(app, 'showPopup');
      await popupPage(app);
      await inMain.call(app, 'hidePopup');
      await sleep(800);
      d = await inMain.diag(app);
      check(d.trayActive && JSON.stringify(d.monitor.consumers) === JSON.stringify(['companion']), 'popup closing as the last window leaves tray and poller intact');

      // Open AutoIngest from the popup with no windows → reopens via the Dock path.
      await inMain.call(app, 'showPopup');
      popup = await popupPage(app);
      const reopened = app.waitForEvent('window', { predicate: p => p.url().endsWith('splash.html'), timeout: 15000 }).catch(() => null);
      await popup.click('#open-btn');
      check(!!(await reopened), '"Open AutoIngest" with no window reopens AutoIngest (splash, same as Dock click)');
      check(await waitFor(() => popupGone(app), 3000), 'popup closed after Open AutoIngest');
      // The reopened splash takes focus when it is shown; a popup opened before that
      // closes on blur by design. Let the splash appear before the Quit step.
      await waitFor(() => app.evaluate(({}, mainJs) => process.getBuiltinModule('module').createRequire(mainJs)('../services/windowRegistry').getAppWindows().some(w => w.isVisible()), MAIN_JS), 10000);
      await sleep(500);
    }

    // ── Explicit Quit from the popup ───────────────────────────────────────
    await inMain.call(app, 'showPopup');
    popup = await popupPage(app);
    const exited = new Promise(resolve => app.process().once('exit', (code) => resolve(code)));
    await popup.click('#quit-btn');
    const code = await Promise.race([exited, sleep(15000).then(() => 'timeout')]);
    check(code !== 'timeout', `Quit AutoIngest exits the app (exit ${code})`);
    check(pageErrors.length === 0, `no renderer page errors (${pageErrors.join(' | ')})`);
  } catch (err) {
    failures++;
    log('FAIL — unexpected error:', err.stack || err.message);
    await app.close().catch(() => {});
  } finally {
    await fsp.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    await fsp.rm(cardRoot, { recursive: true, force: true }).catch(() => {});
  }
  log(failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
