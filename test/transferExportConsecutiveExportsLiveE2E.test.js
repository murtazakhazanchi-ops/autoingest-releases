'use strict';

// Live end-to-end verification of whether Transfer Export has the same "stuck after
// successful completion" defect just fixed in Transfer Import (a68aa1c): does
// _txSetButtonPhase('done') also permanently hide Scan/Preview, blocking a second,
// consecutive export in the same session or after closing/reopening the modal?
//
// This test is written to FAIL against the current (unfixed) Export code if the defect is
// real, and is run once before any Export-side code change to capture that evidence, then
// again after the fix to confirm it. Real Electron, custom source/destination mode (plain
// folder-to-folder), synthetic fixtures only.
//
// Run: node test/transferExportConsecutiveExportsLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[tx-consec-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

async function buildFolder(baseDir, name, fileCount) {
  // Custom-mode export copies the chosen source root's CONTENTS directly into the
  // destination (no wrapper subdirectory named after the source folder) — unlike Import's
  // generic-folder semantics, which preserve the source folder name as part of the
  // destination path. Filenames must therefore be distinct across fixtures sharing one
  // flat destination, or a same-name/same-size file from a later export is correctly
  // (and harmlessly) treated as "already present" and skipped — exactly what happened
  // when this fixture originally used identical file-0.dat..file-N.dat names for both.
  const dir = path.join(baseDir, name);
  await fsp.mkdir(dir, { recursive: true });
  for (let i = 0; i < fileCount; i++) {
    await fsp.writeFile(path.join(dir, `${name}-file-${i}.dat`), `bytes-${name}-${i}`);
  }
  return dir;
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
  const userDataDir = await mkTmp('ai-e2e-txconsec-userdata-');
  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));

  let window = await electronApp.firstWindow({ timeout: 60000 });
  window.on('console', msg => { if (msg.type() === 'error') log('[console.error]', msg.text()); });
  window.on('pageerror', err => log('[pageerror]', err.message, err.stack));
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));
  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'E2E Test Operator');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'E2E Test Operator');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  }
  window = await mainWindowPromise;
  window.on('console', msg => { if (msg.type() === 'error') log('[console.error]', msg.text()); });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);

  return { electronApp, window };
}

async function openExportModal(window) {
  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));
  await window.evaluate(() => _alocOpen());
  await window.waitForTimeout(300);
  await window.click('#alocTransferExportBtn');
  await window.waitForTimeout(800);
  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));
}

async function switchToCustomSourceMode(window) {
  await window.click('#txSrcModeCustom');
  await window.waitForTimeout(200);
}

async function pickCustomSrcAndDest(window) {
  await window.click('#txChooseCustomSrcBtn');
  await window.waitForTimeout(300);
  await window.click('#txChooseCustomDestBtn');
  await window.waitForTimeout(300);
}

async function waitForExportDone(window, timeoutMs = 20000, previousBatchId = null) {
  const start = Date.now();
  let status = null;
  while (Date.now() - start < timeoutMs) {
    status = await window.evaluate(async () => window.api.getTransferExportStatus());
    if (status && status.batchId && !status.running && status.batchId !== previousBatchId) return status;
    await window.waitForTimeout(200);
  }
  return status;
}

(async () => {
  const srcBaseA  = await mkTmp('ai-e2e-txconsec-srcA-');
  const srcBaseB  = await mkTmp('ai-e2e-txconsec-srcB-');
  const destRoot  = await mkTmp('ai-e2e-txconsec-dest-');
  const folderA = await buildFolder(srcBaseA, 'FolderA', 5);
  const folderB = await buildFolder(srcBaseB, 'FolderB', 7);

  const { electronApp, window } = await launchApp();
  await setDialogPaths(electronApp, { 'Choose Source Folder': folderA, 'Choose Destination Folder': destRoot });

  await openExportModal(window);
  await switchToCustomSourceMode(window);
  await pickCustomSrcAndDest(window);

  // ── Export A ────────────────────────────────────────────────────────────
  await window.click('#txPreviewBtn');
  await window.waitForTimeout(1000);
  await window.click('#txExportBtn');
  const statusA = await waitForExportDone(window);
  check(statusA && statusA.result?.status === 'ok' && statusA.copied === 5, 'A1. Export A completes successfully (5 files)');
  await window.waitForTimeout(1500);

  const headlineAfterA = await window.evaluate(() => document.getElementById('txStatusHeadline')?.textContent);
  log('headline after A:', headlineAfterA);

  // ── THE SUSPECTED BUG: are Scan/Preview permanently hidden after a successful export? ──
  const buttonsAfterA = await window.evaluate(() => ({
    scanHidden:    document.getElementById('txScanBtn')?.hidden,
    previewHidden: document.getElementById('txPreviewBtn')?.hidden,
  }));
  log('buttons after A (same modal session):', JSON.stringify(buttonsAfterA));
  check(buttonsAfterA.scanHidden === false, '1. Scan is visible again immediately after A completes, same modal session');
  check(buttonsAfterA.previewHidden === false, '2. Preview is visible again immediately after A completes, same modal session');

  // ── Switch source/dest to Folder B and attempt a second export ──────────
  await setDialogPaths(electronApp, { 'Choose Source Folder': folderB, 'Choose Destination Folder': destRoot });
  await window.click('#txChooseCustomSrcBtn');
  await window.waitForTimeout(300);

  await window.click('#txPreviewBtn');
  await window.waitForTimeout(1000);

  const previewVisibleForB = await window.evaluate(() => !document.getElementById('txPreviewBox')?.hasAttribute('hidden'));
  check(previewVisibleForB, '3. a fresh Preview for Folder B actually ran and produced a visible result (not stuck)');

  const exportBtnAfterPreviewB = await window.evaluate(() => ({
    hidden:   document.getElementById('txExportBtn')?.hidden,
    disabled: document.getElementById('txExportBtn')?.disabled,
  }));
  log('export button state after Preview for B:', JSON.stringify(exportBtnAfterPreviewB));
  check(exportBtnAfterPreviewB.hidden === false && exportBtnAfterPreviewB.disabled === false,
    '4. Export is visible AND enabled for Folder B after a fresh Preview');

  await window.click('#txExportBtn');
  const statusB = await waitForExportDone(window, 20000, statusA.batchId);
  check(statusB && statusB.batchId !== statusA.batchId, '5. Export B is a genuinely NEW batch, not a stale re-report of A');
  check(statusB && statusB.result?.status === 'ok' && statusB.copied === 7, '6. Export B completes successfully and reports ONLY its own 7 files, not A\'s 5');
  await window.waitForTimeout(1500);

  check(fs.existsSync(destRoot), '7. sanity — destination directory exists');
  const destEntries = await fsp.readdir(destRoot).catch(() => []);
  log('destination entries after both exports:', JSON.stringify(destEntries));
  const countFiles = async (dir) => {
    let n = 0;
    const walk = async (d) => {
      const entries = await fsp.readdir(d, { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (e.name.startsWith('.autoingest')) continue; // internal checkpoint/audit state (.autoingest-transfer etc.), not exported content
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p); else n++;
      }
    };
    await walk(dir);
    return n;
  };
  const totalDestFiles = await countFiles(destRoot);
  check(totalDestFiles === 12, `8. both A's 5 files and B's 7 files exist at the destination (found ${totalDestFiles})`);

  // ── Close and reopen — must not re-trap the UI ───────────────────────────
  await window.keyboard.press('Escape');
  await window.waitForTimeout(300);
  await openExportModal(window);

  const buttonsAfterReopen = await window.evaluate(() => ({
    scanHidden:    document.getElementById('txScanBtn')?.hidden,
    previewHidden: document.getElementById('txPreviewBtn')?.hidden,
  }));
  check(buttonsAfterReopen.scanHidden === false && buttonsAfterReopen.previewHidden === false,
    '9. closing and reopening the modal does not re-trap Scan/Preview behind the old completed state');

  await electronApp.close().catch(() => {});

  log(failures === 0 ? 'ALL CHECKS PASSED (final)' : `${failures} CHECK(S) FAILED (final)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[tx-consec-e2e] FATAL', err);
  process.exit(1);
});
