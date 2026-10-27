'use strict';

// AI-FEAT-061 Q1 — popup lifecycle comparison (owner request, section 4):
//   A. create the popup on demand and destroy it when hidden  (companionService as shipped)
//   B. create one popup and hide/show it                       (same window options, kept alive)
//
// Measured in the REAL app, isolated userData: time-to-visible, process/memory cost
// while closed, staleness while hidden, and the app-lifecycle effect of a hidden window.
//
// Run: node test/companionPopupLifecycle.bench.js   (prints a table; exit 0 = measurements taken)

const { _electron: electron } = require('playwright-core');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_BIN = require(path.join(PROJECT_ROOT, 'node_modules', 'electron'));
const MAIN_JS = path.join(PROJECT_ROOT, 'main', 'main.js');
const ITERATIONS = 10;

(async () => {
  const userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-q1-bench-'));
  const app = await electron.launch({ executablePath: ELECTRON_BIN, args: [PROJECT_ROOT, '--user-data-dir=' + userDataDir, '--no-sandbox'], cwd: PROJECT_ROOT, timeout: 60000 });
  try {
    await app.firstWindow({ timeout: 60000 });
    await new Promise(r => setTimeout(r, 3000)); // let startup I/O settle

    const result = await app.evaluate(async ({ BrowserWindow, app: a, webContents }, { mainJs, iterations }) => {
      const req = process.getBuiltinModule('module').createRequire(mainJs);
      const path = req('path');
      const svc = req('../services/companionService');
      const reg = req('../services/windowRegistry');
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));
      const now = () => performance.now();
      const memMB = () => Math.round(a.getAppMetrics().reduce((s, m) => s + m.memory.workingSetSize, 0) / 1024);
      const procs = () => a.getAppMetrics().length;
      const popupVisible = () => BrowserWindow.getAllWindows().some(w => reg.isAuxiliary(w) && w.isVisible());
      async function until(fn, ms = 5000) { const end = now() + ms; while (now() < end) { if (fn()) return true; await sleep(2); } return false; }
      const median = (xs) => { const s = [...xs].sort((x, y) => x - y); return Math.round(s[Math.floor(s.length / 2)]); };

      await sleep(500);
      const baseline = { memMB: memMB(), procs: procs(), webContents: webContents.getAllWebContents().length };

      // ── A: on demand ──
      const aOpen = [];
      let aOpenMem = 0;
      for (let i = 0; i < iterations; i++) {
        const t0 = now();
        svc.showPopup();
        await until(popupVisible);
        aOpen.push(now() - t0);
        if (i === iterations - 1) { await sleep(300); aOpenMem = memMB(); }
        svc.hidePopup();
        await until(() => !popupVisible());
        await sleep(100);
      }
      await sleep(800);
      const aClosed = { memMB: memMB(), procs: procs(), webContents: webContents.getAllWebContents().length };

      // ── B: persistent, hide/show ──
      const tCold = now();
      const win = new BrowserWindow({
        width: 340, height: 320, show: false, frame: false, resizable: false, skipTaskbar: true, alwaysOnTop: true,
        webPreferences: { preload: path.join(path.dirname(mainJs), 'companionPreload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      win.loadFile(path.join(path.dirname(mainJs), '..', 'renderer', 'companion', 'companion.html'));
      await new Promise(r => win.once('ready-to-show', r));
      win.show();
      const bCold = now() - tCold;
      const bShow = [];
      for (let i = 0; i < iterations; i++) {
        win.hide();
        await sleep(100);
        const t0 = now();
        win.show();
        await until(() => win.isVisible());
        bShow.push(now() - t0);
      }
      win.hide();
      await sleep(800);
      const bHidden = { memMB: memMB(), procs: procs(), webContents: webContents.getAllWebContents().length };

      // Lifecycle: does a hidden persistent popup keep "windows open" after the app windows close?
      const hiddenBStillCounted = !win.isVisible() && BrowserWindow.getAllWindows().includes(win);
      win.destroy();
      await sleep(300);

      return {
        baseline, aClosed, bHidden, aOpenMem,
        aOpenMedianMs: median(aOpen), aOpenMaxMs: Math.round(Math.max(...aOpen)),
        bColdMs: Math.round(bCold), bShowMedianMs: median(bShow), bShowMaxMs: Math.round(Math.max(...bShow)),
        hiddenBStillCounted,
      };
    }, { mainJs: MAIN_JS, iterations: ITERATIONS });

    const extraB = result.bHidden.memMB - result.aClosed.memMB;
    console.log('\nPopup lifecycle comparison (real app, macOS, ' + ITERATIONS + ' iterations)\n');
    console.log('| Measure | A: on-demand (create/destroy) | B: persistent (hide/show) |');
    console.log('|---|---|---|');
    console.log(`| Time to visible (median / max) | ${result.aOpenMedianMs} / ${result.aOpenMaxMs} ms | ${result.bShowMedianMs} / ${result.bShowMaxMs} ms (first open ${result.bColdMs} ms) |`);
    console.log(`| Processes while popup closed | ${result.aClosed.procs} (baseline ${result.baseline.procs}) | ${result.bHidden.procs} |`);
    console.log(`| webContents while popup closed | ${result.aClosed.webContents} (baseline ${result.baseline.webContents}) | ${result.bHidden.webContents} |`);
    console.log(`| Total working set while closed | ${result.aClosed.memMB} MB | ${result.bHidden.memMB} MB (${extraB >= 0 ? '+' : ''}${extraB} MB) |`);
    console.log(`| Popup still in BrowserWindow.getAllWindows() while closed | no (destroyed) → window-all-closed and Windows quit-on-close unchanged | ${result.hiddenBStillCounted ? 'yes' : 'no'} → window-all-closed would never fire while it exists; Windows would stop quitting when the main window closes |`);
    console.log('\nRAW', JSON.stringify(result));
  } finally {
    await app.close().catch(() => {});
    await fsp.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  }
})().catch((err) => { console.error(err); process.exit(1); });
