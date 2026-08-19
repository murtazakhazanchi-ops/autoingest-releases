'use strict';
// Phase C4, Part R -- real performance/RAM measurement inside the actual
// Electron app process. Not shipped, not wired, not run in CI.
// Run with: node_modules/.bin/electron main/askAutoIngestPerfCheck.js

const path = require('path');
const fs = require('fs');
const os = require('os');

const FIXTURE_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-c4-perf-userdata-'));
const { app, BrowserWindow } = require('electron');
app.setPath('userData', FIXTURE_USER_DATA);

async function setUpRealModel() {
  const modelManager = require('../services/localJudge/modelManager');
  const REAL_MODEL_PATH = path.join(__dirname, '..', 'scripts', 'product-docs', 'bench', 'models', 'phi-4-mini-instruct-Q4_K_M.gguf');
  if (!fs.existsSync(REAL_MODEL_PATH)) return false;
  const { finalPath } = modelManager.resolvePaths(path.join(FIXTURE_USER_DATA, 'local-judge-models'));
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  fs.symlinkSync(REAL_MODEL_PATH, finalPath);
  const v = await modelManager.verify(path.join(FIXTURE_USER_DATA, 'local-judge-models'));
  return v.status === modelManager.STATUS.READY;
}

function mainProcessMemMB() {
  const m = process.memoryUsage();
  return Math.round(m.rss / 1024 / 1024);
}
function childMemMB(pid) {
  if (!pid) return null;
  const entry = app.getAppMetrics().find((m) => m.pid === pid);
  if (!entry) return null;
  return Math.round(entry.memory.workingSetSize / 1024);
}

async function main() {
  const hasRealModel = await setUpRealModel();
  require('./askAutoIngest').registerIpcHandlers();

  const win = new BrowserWindow({
    width: 1280, height: 860, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await new Promise((r) => setTimeout(r, 400));

  const ejs = (s) => win.webContents.executeJavaScript(s, true);
  const report = {};

  report.appBaselineRamMB = mainProcessMemMB();
  console.log('[perf] app baseline RAM (main process RSS):', report.appBaselineRamMB, 'MB');

  // Deterministic-only
  let t0 = Date.now();
  await ejs(`window.api.askQuestion('How do I import photographs from an SD card?')`);
  report.deterministicMs = Date.now() - t0;

  // Boundary
  t0 = Date.now();
  await ejs(`window.api.askQuestion('Does AutoIngest support face recognition?')`);
  report.boundaryMs = Date.now() - t0;

  // Workflow-primary
  t0 = Date.now();
  await ejs(`window.api.askQuestion('How do I create a new event?')`);
  report.workflowMs = Date.now() - t0;

  // Model-unavailable authority question (model IS present in this run --
  // measure this BEFORE setup would make it truly unavailable; instead
  // remove the symlink temporarily to get a genuine model-unavailable
  // timing, matching the real "not installed" first-run experience).
  const modelManager = require('../services/localJudge/modelManager');
  const { finalPath, sidecarPath } = modelManager.resolvePaths(path.join(FIXTURE_USER_DATA, 'local-judge-models'));
  fs.renameSync(finalPath, finalPath + '.movedaway');
  fs.renameSync(sidecarPath, sidecarPath + '.movedaway');
  t0 = Date.now();
  await ejs(`window.api.askQuestion('Does AutoIngest support drone footage import with GPS flight paths?')`);
  report.modelUnavailableMs = Date.now() - t0;
  fs.renameSync(finalPath + '.movedaway', finalPath);
  fs.renameSync(sidecarPath + '.movedaway', sidecarPath);

  if (hasRealModel) {
    // Cold semantic query (first real judge invocation this run)
    t0 = Date.now();
    const coldResult = await ejs(`window.api.askQuestion('Does AutoIngest support drone footage import with GPS flight paths?')`);
    report.coldSemanticMs = Date.now() - t0;
    report.coldSemanticStatus = coldResult && coldResult.status;

    const runtime = require('../services/localJudge/runtime');
    report.loadedModelRamMB = childMemMB(runtime.getLoadState().pid);
    console.log('[perf] loaded-model utilityProcess RAM:', report.loadedModelRamMB, 'MB');

    // Warm semantic query
    t0 = Date.now();
    const warmResult = await ejs(`window.api.askQuestion('Does AutoIngest support telemetry?')`);
    report.warmSemanticMs = Date.now() - t0;
    report.warmSemanticStatus = warmResult && warmResult.status;

    const pidBefore = runtime.getLoadState().pid;
    await runtime.unload();
    await new Promise((r) => setTimeout(r, 400));
    report.ramAfterUnloadMB = childMemMB(pidBefore);
    console.log('[perf] RAM after unload():', report.ramAfterUnloadMB, 'MB');
    runtime.terminate();
  }

  win.destroy();
  fs.rmSync(FIXTURE_USER_DATA, { recursive: true, force: true });

  console.log('\n[perf] FULL REPORT:');
  console.log(JSON.stringify(report, null, 2));
  app.exit(0);
}

app.whenReady().then(() => main().catch((err) => { console.error('[perf] FATAL', err); app.exit(1); }));
