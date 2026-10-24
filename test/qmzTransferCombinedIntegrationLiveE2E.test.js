'use strict';

// "AutoIngest — Combined QMZ + Transfer Preview Integration" — §6 item 18: a single live
// Electron session must be able to start up and navigate between the QMZ PDF-import
// workflow and the Transfer Import/Export workflow WITHOUT either one interfering with the
// other — no cross-contaminated module state, no leaked overlays, no console errors.
//
// This file does NOT re-verify each feature's own internal correctness in depth — the full
// QMZ and Transfer regression suites (qmz*.test.js / transfer*.test.js) already do that
// exhaustively and are run unmodified as part of this integration's regression pass. This
// file's only job is to prove both subsystems genuinely coexist in ONE combined build:
// open QMZ, perform one real write-path QMZ action, close it; open Transfer Import, perform
// one real write-path Import, close it; open Transfer Export, confirm it opens cleanly;
// reopen QMZ and confirm it still opens to a fresh, uncontaminated state. Synthetic
// fixtures only.
//
// Run: node test/qmzTransferCombinedIntegrationLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function log(...args) { console.log('[qmz-transfer-combined]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

async function domClick(window, selector) {
  return window.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  }, selector);
}

async function setDialogPaths(electronApp, pathsByTitle) {
  await electronApp.evaluate(async ({ dialog }, map) => {
    dialog.showOpenDialog = async (_win, opts) => {
      const p = map[opts?.title];
      return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] };
    };
  }, pathsByTitle);
}

async function launchApp() {
  const userDataDir = await mkTmp('ai-e2e-combined-userdata-');
  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));

  let window = await electronApp.firstWindow({ timeout: 60000 });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));
  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'Combined Integration Operator');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'Combined Integration Operator');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  }
  window = await mainWindowPromise;
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);
  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));

  return { electronApp, window };
}

async function waitForImportDone(window, timeoutMs = 20000) {
  const start = Date.now();
  let status = null;
  while (Date.now() - start < timeoutMs) {
    status = await window.evaluate(async () => window.api.getTransferImportStatus());
    if (status && status.batchId && !status.running) return status;
    await window.waitForTimeout(200);
  }
  return status;
}

(async () => {
  const qmzRoot       = await mkTmp('ai-e2e-combined-qmzroot-');
  const transferRoot  = await mkTmp('ai-e2e-combined-transfer-');
  const destRoot      = await mkTmp('ai-e2e-combined-dest-');
  const folderA = path.join(transferRoot, 'FolderA');
  await fsp.mkdir(folderA, { recursive: true });
  await fsp.writeFile(path.join(folderA, 'file-0.dat'), 'bytes-0');
  await fsp.writeFile(path.join(folderA, 'file-1.dat'), 'bytes-1');

  const { electronApp, window } = await launchApp();

  const consoleErrors = [];
  window.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  window.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message));

  // ── 1. Application startup lands on the main UI, not stuck on splash/onboarding ──
  const startupOk = await window.evaluate(() => typeof window.selectSource === 'function' && typeof window.openQMZManager === 'function' && typeof window._alocOpen === 'function');
  check(startupOk, '1. app startup exposes both QMZ (openQMZManager) and Transfer (_alocOpen) entry points on the same window');

  // ── 2. Open QMZ workspace, perform one real write-path action ───────────────────
  await window.evaluate((r) => window.openQMZManager(r, {
    component: { location: 'Hall A', city: 'TestCity', country: 'India' },
    isMulti: false, eventTitle: 'Combined Integration Event', hijriDate: '1448-02-10',
    eventJsonPath: null, componentTitle: null,
  }), qmzRoot);
  await window.waitForTimeout(500);
  const qmzOpenState = await window.evaluate(() => ({
    hidden: document.getElementById('qmzOverlay')?.classList.contains('hidden'),
    subtitle: document.getElementById('qmzSubtitle')?.textContent,
  }));
  check(qmzOpenState.hidden === false, '2. QMZ overlay opens (not hidden) from a cold app start');
  check(qmzOpenState.subtitle === 'Combined Integration Event', '3. QMZ subtitle reflects the real event context passed in');

  await window.fill('#qmzSeqNumInput', '3');
  await window.fill('#qmzSeqSuffixInput', 'a');
  await window.selectOption('#qmzSeqLetterSelect', 'AQ');
  await window.waitForTimeout(150);
  await domClick(window, '#qmzAddSpecificBtn');
  await window.waitForTimeout(600);
  check(fs.existsSync(path.join(qmzRoot, '03aAQ')), '4. a real QMZ sequence folder ("03aAQ") was created on disk via the real IPC handler, in the SAME build as Transfer');

  // ── 3. Close QMZ cleanly ─────────────────────────────────────────────────────────
  await window.evaluate(() => window._closeQMZManager());
  await window.waitForTimeout(300);
  const qmzClosedState = await window.evaluate(() => document.getElementById('qmzOverlay')?.classList.contains('hidden'));
  check(qmzClosedState === true, '5. QMZ overlay closes cleanly (hidden again)');

  // ── 4. Navigate to Transfer Import, perform one real write-path action ──────────
  await setDialogPaths(electronApp, {});
  await electronApp.evaluate(async ({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
  }, transferRoot);
  await window.evaluate(async (root) => { await window.api.setNasRoot(root); }, destRoot);
  await window.evaluate(async () => window.api.chooseTransferRoot());

  await window.evaluate(() => window._alocOpen());
  await window.waitForTimeout(300);
  await window.click('#alocTransferImportBtn');
  await window.waitForTimeout(800);
  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));

  const tiModalOpen = await window.evaluate(() => document.getElementById('transferImportModal')?.classList.contains('open'));
  check(tiModalOpen === true, '6. Transfer Import modal opens cleanly right after closing QMZ, in the same session');

  // FolderA is the only item in the tree and its checkbox is already checked by default
  // (the tree's established "everything selected" default — see .ti-cb-genfolder's
  // `checked` attribute in renderer.js) — no selection action needed.
  await window.click('#tiPreviewBtn');
  await window.waitForTimeout(1000);
  await window.click('#tiImportBtn');
  const importStatus = await waitForImportDone(window);
  check(importStatus && importStatus.result?.status === 'ok' && importStatus.copied === 2, '7. a real Transfer Import (2 files) completes successfully in the combined build');
  check(fs.existsSync(path.join(destRoot, 'FolderA', 'file-0.dat')), '8. the imported file actually landed on disk at the destination');

  // ── 5. Close Transfer Import, open Transfer Export, confirm it opens cleanly ─────
  await window.keyboard.press('Escape');
  await window.waitForTimeout(300);
  const tiModalClosed = await window.evaluate(() => !document.getElementById('transferImportModal')?.classList.contains('open'));
  check(tiModalClosed === true, '9. Transfer Import modal closes cleanly');

  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));
  await window.evaluate(() => window._alocOpen());
  await window.waitForTimeout(300);
  await window.click('#alocTransferExportBtn');
  await window.waitForTimeout(800);
  const txModalOpen = await window.evaluate(() => document.getElementById('transferExportModal')?.classList.contains('open'));
  check(txModalOpen === true, '10. Transfer Export modal also opens cleanly in the same session (no residual QMZ/Import state blocking it)');
  await window.keyboard.press('Escape');
  await window.waitForTimeout(300);

  // ── 6. Reopen QMZ — must be a genuinely fresh session, not contaminated by Transfer ──
  const qmzRoot2 = await mkTmp('ai-e2e-combined-qmzroot2-');
  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));
  await window.evaluate((r) => window.openQMZManager(r, {
    component: { location: 'Hall B', city: 'TestCity2', country: 'India' },
    isMulti: false, eventTitle: 'Second QMZ Session After Transfer', hijriDate: '1448-02-11',
    eventJsonPath: null, componentTitle: null,
  }), qmzRoot2);
  await window.waitForTimeout(500);
  const qmzReopenState = await window.evaluate(() => ({
    hidden: document.getElementById('qmzOverlay')?.classList.contains('hidden'),
    subtitle: document.getElementById('qmzSubtitle')?.textContent,
  }));
  check(qmzReopenState.hidden === false, '11. QMZ reopens cleanly after a full Transfer Import/Export round-trip');
  check(qmzReopenState.subtitle === 'Second QMZ Session After Transfer', '12. QMZ\'s new session reflects its OWN fresh context, not anything left over from the first QMZ session or from Transfer');

  const specificOptions = await window.evaluate(() => [...document.querySelectorAll('#qmzSeqLetterSelect option')].map(o => o.value));
  check(JSON.stringify(specificOptions) === JSON.stringify(['Q', 'M', 'Z', 'MZ', 'O', 'AQ']), '13. QMZ\'s own UI (type select options) renders correctly after navigating away and back');

  // ── 7. No console/page errors across the entire combined session ────────────────
  check(consoleErrors.length === 0, `14. zero console/page errors across the whole combined QMZ+Transfer session (found: ${consoleErrors.length}${consoleErrors.length ? ' — ' + consoleErrors.slice(0, 3).join(' | ') : ''})`);

  await electronApp.close().catch(() => {});

  log(failures === 0 ? 'ALL CHECKS PASSED (final)' : `${failures} CHECK(S) FAILED (final)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[qmz-transfer-combined] FATAL', err);
  process.exit(1);
});
