'use strict';

// AI-FEAT-061 Q1 — popup lifecycle stress / regression test.
//
// Regression for the showPopup() race: on macOS, BrowserWindow#show()/#focus() can
// run a nested run loop, so a hide (tray click, blur, companion:hide IPC) can execute
// INSIDE the native call. The popup was destroyed mid-show; the next line threw
// "Object has been destroyed" (an uncaught main-process exception → modal error
// dialog that blocks the main process) or AppKit crashed the process (SIGTRAP).
//
// Each run launches the REAL app in an isolated userData dir and performs CYCLES
// open/close cycles with varied timing:
//   - hide before the page is ready, right after it appears, and after it settles,
//   - hide requested from inside the popup's own show() and focus() calls
//     (deterministic re-entrancy: runs while the native call is still on the stack),
//   - togglePopup() double-clicks.
// Every call is time-bounded (a modal error dialog shows up as a hang).
//
// Per run it asserts: process alive, no hang, no uncaught main-process exception,
// no popup left open / registered, webContents and process counts back to baseline.
//
// Run: node test/companionPopupStress.live.js [runs=20] [cycles=80]

const { _electron: electron } = require('playwright-core');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_BIN = require(path.join(PROJECT_ROOT, 'node_modules', 'electron'));
const MAIN_JS = path.join(PROJECT_ROOT, 'main', 'main.js');
const RUNS = Number(process.argv[2]) || 20;
const CYCLES = Number(process.argv[3]) || 80;
const CALL_TIMEOUT_MS = 10000;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function log(...args) { console.log('[popup-stress]', ...args); }

// Installed once per app: records uncaught main-process exceptions (a listener also
// suppresses Electron's blocking error dialog, so a regression fails fast instead of
// hanging) and arms the re-entrant hide hooks used by individual cycles.
function installProbes(app) {
  return app.evaluate(({ app: a }, mainJs) => {
    const req = process.getBuiltinModule('module').createRequire(mainJs);
    const svc = req('../services/companionService');
    globalThis.__stress = { errors: [], reentrantHides: 0, armed: null };
    process.on('uncaughtException', (err) => {
      globalThis.__stress.errors.push(String((err && err.stack) || err).split('\n').slice(0, 2).join(' | '));
    });
    // Re-entrancy is injected exactly where it was observed (stack: hidePopup() called
    // from inside win.show() at the ready-to-show handler): the popup instance's own
    // show()/focus() run hidePopup() before returning to the caller, as a hide delivered
    // by the nested run loop would. Instance-level only; Electron itself is untouched.
    a.on('browser-window-created', (_e, win) => {
      for (const method of ['show', 'focus']) {
        const native = win[method];
        win[method] = function (...args) {
          const result = native.apply(this, args);
          if (globalThis.__stress.armed === method) {
            globalThis.__stress.armed = null;
            globalThis.__stress.reentrantHides++;
            svc.hidePopup();
          }
          return result;
        };
      }
    });
  }, MAIN_JS);
}

const inMain = {
  call: (app, fn) => app.evaluate((_e, { mainJs, fn }) => {
    process.getBuiltinModule('module').createRequire(mainJs)('../services/companionService')[fn]();
  }, { mainJs: MAIN_JS, fn }),
  arm: (app, evt) => app.evaluate((_e, evt) => { globalThis.__stress.armed = evt; }, evt),
  state: (app) => app.evaluate(({ app: a, BrowserWindow, webContents }, mainJs) => {
    const req = process.getBuiltinModule('module').createRequire(mainJs);
    const reg = req('../services/windowRegistry');
    return {
      popupOpen: req('../services/companionService').getDiagnostics().popupOpen,
      auxWindows: BrowserWindow.getAllWindows().filter(w => reg.isAuxiliary(w)).length,
      webContents: webContents.getAllWebContents().length,
      processes: a.getAppMetrics().length,
      errors: globalThis.__stress.errors,
      reentrantHides: globalThis.__stress.reentrantHides,
    };
  }, MAIN_JS),
};

async function bounded(promise, what) {
  let timer;
  const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`HANG: ${what} did not return within ${CALL_TIMEOUT_MS} ms`)), CALL_TIMEOUT_MS); });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
}

async function waitForPopupPage(app, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (app.windows().some(p => !p.isClosed() && p.url().endsWith('companion.html'))) return true;
    await sleep(25);
  }
  return false;
}

async function waitUntil(fn, ms) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) { last = await fn(); if (last.ok) return last; await sleep(100); }
  return last;
}

// One cycle; the pattern rotates so every run covers every timing.
async function cycle(app, i) {
  switch (i % 6) {
    case 0: // hide before ready-to-show
      await bounded(inMain.call(app, 'showPopup'), 'showPopup');
      await bounded(inMain.call(app, 'hidePopup'), 'hidePopup');
      break;
    case 1: // hide as soon as the page exists
      await bounded(inMain.call(app, 'showPopup'), 'showPopup');
      await waitForPopupPage(app, 5000);
      await bounded(inMain.call(app, 'hidePopup'), 'hidePopup');
      break;
    case 2: // hide re-entrantly from inside win.show()
      await bounded(inMain.arm(app, 'show'), 'arm');
      await bounded(inMain.call(app, 'showPopup'), 'showPopup');
      await waitForPopupPage(app, 5000);
      await sleep(150);
      break;
    case 3: // hide after the popup has settled
      await bounded(inMain.call(app, 'showPopup'), 'showPopup');
      await waitForPopupPage(app, 5000);
      await sleep(120);
      await bounded(inMain.call(app, 'hidePopup'), 'hidePopup');
      break;
    case 4: // hide re-entrantly from inside win.focus()
      await bounded(inMain.arm(app, 'focus'), 'arm');
      await bounded(inMain.call(app, 'showPopup'), 'showPopup');
      await waitForPopupPage(app, 5000);
      await sleep(150);
      await bounded(inMain.arm(app, null), 'disarm');
      await bounded(inMain.call(app, 'hidePopup'), 'hidePopup'); // in case focus never fired
      break;
    default: // tray double-click: open, then toggle closed straight away
      await bounded(inMain.call(app, 'togglePopup'), 'togglePopup');
      await waitForPopupPage(app, 5000);
      await bounded(inMain.call(app, 'togglePopup'), 'togglePopup');
      break;
  }
  await sleep(i % 2 ? 40 : 200);
}

async function oneRun(run) {
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-q1-stress-'));
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [PROJECT_ROOT, '--user-data-dir=' + userDataDir, '--no-sandbox'], cwd: PROJECT_ROOT, timeout: 60000 });
  let exitInfo = null;
  app.process().on('exit', (code, signal) => { exitInfo = { code, signal }; });
  const problems = [];
  let done = 0;
  try {
    await app.firstWindow({ timeout: 60000 });
    await sleep(2500); // let startup I/O settle before taking the baseline
    await installProbes(app);
    const base = await inMain.state(app);
    for (let i = 0; i < CYCLES; i++) {
      await cycle(app, i);
      done = i + 1;
    }
    const end = await waitUntil(async () => {
      const s = await inMain.state(app);
      return { ...s, ok: !s.popupOpen && s.auxWindows === 0 && s.webContents === base.webContents && s.processes <= base.processes };
    }, 8000);
    if (end.errors.length) problems.push(`uncaught main-process exception(s): ${[...new Set(end.errors)].join(' || ')}`);
    if (end.popupOpen || end.auxWindows) problems.push(`leaked popup: popupOpen=${end.popupOpen} auxWindows=${end.auxWindows}`);
    if (end.webContents !== base.webContents) problems.push(`leaked webContents ${base.webContents} → ${end.webContents}`);
    if (end.processes > base.processes) problems.push(`leaked processes ${base.processes} → ${end.processes}`);
    if (end.reentrantHides < 1) problems.push('re-entrant hide path was never exercised');
    log(`run ${run}: ${done}/${CYCLES} cycles, re-entrant hides ${end.reentrantHides}, webContents ${base.webContents}→${end.webContents}, processes ${base.processes}→${end.processes}`);
  } catch (err) {
    problems.push(exitInfo ? `main process died (code ${exitInfo.code}, signal ${exitInfo.signal}) at cycle ${done + 1}` : `${err.message.split('\n')[0]} (cycle ${done + 1})`);
  } finally {
    if (exitInfo) { /* already gone */ } else if (problems.some(p => p.startsWith('HANG'))) app.process().kill('SIGKILL');
    else await Promise.race([app.close(), sleep(15000)]).catch(() => {});
    await fsp.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
  return { run, done, problems };
}

(async () => {
  log(`${RUNS} runs × ${CYCLES} cycles = ${RUNS * CYCLES} popup open/close cycles`);
  const results = [];
  for (let r = 1; r <= RUNS; r++) {
    const res = await oneRun(r);
    results.push(res);
    for (const p of res.problems) log(`FAIL — run ${r}: ${p}`);
  }
  const failed = results.filter(r => r.problems.length);
  const cycles = results.reduce((s, r) => s + r.done, 0);
  log(`${cycles} cycles completed; ${RUNS - failed.length}/${RUNS} runs clean`);
  log(failed.length === 0 ? 'ALL PASS' : `${failed.length} RUN(S) FAILED`);
  process.exit(failed.length === 0 ? 0 : 1);
})();
