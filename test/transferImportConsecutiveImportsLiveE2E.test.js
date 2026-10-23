'use strict';

// Live end-to-end verification of the "stuck after successful import" bug: after Import A
// completed successfully, _tiSetButtonPhase('done') hid BOTH Scan and Preview (with no way
// back short of closing the modal — and even reopening re-applied the SAME persisted
// backend result, since the main-process _state.result isn't cleared by closing the
// renderer). Root cause: 'done' phase hid Scan/Preview; 'failed' did not (an inconsistency
// that only manifested for a SUCCESSFUL completion, exactly matching the operator's report).
// Fixed by never hiding Scan/Preview for 'done', and by having a successful Preview call
// _tiSetButtonPhase('idle') (not just toggle .disabled) so Import's own .hidden also clears.
//
// Run: node test/transferImportConsecutiveImportsLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[ti-consec-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

async function buildFolder(transferRoot, name, fileCount) {
  const dir = path.join(transferRoot, name);
  await fsp.mkdir(dir, { recursive: true });
  for (let i = 0; i < fileCount; i++) {
    await fsp.writeFile(path.join(dir, `file-${i}.dat`), `bytes-${name}-${i}`);
  }
  return dir;
}

async function launchApp(transferRoot) {
  const userDataDir = await mkTmp('ai-e2e-ticonsec-userdata-');
  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));

  await electronApp.evaluate(async ({ dialog }, transferRootArg) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [transferRootArg] });
  }, transferRoot);

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

async function openImportModal(window) {
  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));
  await window.evaluate(() => _alocOpen());
  await window.waitForTimeout(300);
  await window.click('#alocTransferImportBtn');
  await window.waitForTimeout(800);
  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));
}

async function selectOnlyFolder(window, folderName) {
  // Select None, then check only the named top-level folder row.
  await window.click('#tiSelectNoneBtn');
  await window.waitForTimeout(200);
  await window.evaluate((name) => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === name);
    row.closest('.tx-tree-row').querySelector('input[type=checkbox]').click();
  }, folderName);
  await window.waitForTimeout(200);
}

// previousBatchId, when given, guards against a race where the FIRST poll right after
// clicking Import lands before the backend's async runImport() has actually mutated _state
// yet — that poll would otherwise see the PREVIOUS run's already-completed status (truthy
// batchId, running:false) and incorrectly report "done" immediately.
async function waitForImportDone(window, timeoutMs = 20000, previousBatchId = null) {
  const start = Date.now();
  let status = null;
  while (Date.now() - start < timeoutMs) {
    status = await window.evaluate(async () => window.api.getTransferImportStatus());
    if (status && status.batchId && !status.running && status.batchId !== previousBatchId) return status;
    await window.waitForTimeout(200);
  }
  return status;
}

(async () => {
  const transferRoot = await mkTmp('ai-e2e-ticonsec-transfer-');
  const destRoot      = await mkTmp('ai-e2e-ticonsec-dest-');
  const folderA = await buildFolder(transferRoot, 'FolderA', 5);
  const folderB = await buildFolder(transferRoot, 'FolderB', 7);

  const { electronApp, window } = await launchApp(transferRoot);
  await window.evaluate(async (root) => { await window.api.setNasRoot(root); }, destRoot);
  await window.evaluate(async () => window.api.chooseTransferRoot());

  await openImportModal(window);

  // ── Import A ────────────────────────────────────────────────────────────
  await selectOnlyFolder(window, 'FolderA');
  await window.click('#tiPreviewBtn');
  await window.waitForTimeout(1000);
  await window.click('#tiImportBtn');
  const statusA = await waitForImportDone(window);
  check(statusA && statusA.result?.status === 'ok' && statusA.copied === 5, 'A1. Import A completes successfully (5 files)');
  await window.waitForTimeout(1500); // let the renderer's own UI poll catch up

  const headlineAfterA = await window.evaluate(() => document.getElementById('tiStatusHeadline')?.textContent);
  check(headlineAfterA === 'Import complete', 'A2. completion headline shown for A');

  // ── THE BUG: without this fix, Scan/Preview stay hidden forever after a successful import ──
  const buttonsAfterA = await window.evaluate(() => ({
    scanHidden:    document.getElementById('tiScanBtn')?.hidden,
    previewHidden: document.getElementById('tiPreviewBtn')?.hidden,
  }));
  log('buttons after A (same modal session):', JSON.stringify(buttonsAfterA));
  check(buttonsAfterA.scanHidden === false, '1. Scan for New Data is visible again immediately after A completes, same modal session');
  check(buttonsAfterA.previewHidden === false, '2. Preview is visible again immediately after A completes, same modal session');

  // ── Select Folder B and run a fresh Scan (section 7, steps 6-9) ──────────
  await selectOnlyFolder(window, 'FolderB');
  await window.click('#tiScanBtn');
  await window.waitForTimeout(1500);

  const scanReviewVisible = await window.evaluate(() => !document.getElementById('tiScanReview')?.hasAttribute('hidden'));
  check(scanReviewVisible, '3. Scan for Folder B actually ran and produced a visible review (not stuck)');

  const importBtnAfterScanB = await window.evaluate(() => ({
    hidden:   document.getElementById('tiImportBtn')?.hidden,
    disabled: document.getElementById('tiImportBtn')?.disabled,
  }));
  check(importBtnAfterScanB.hidden === false && importBtnAfterScanB.disabled === false,
    '4. Import is visible AND enabled for Folder B after a fresh Scan (the old "done" phase no longer traps it hidden)');

  // ── Import B ──────────────────────────────────────────────────────────────
  await window.click('#tiImportBtn');
  const statusB = await waitForImportDone(window, 20000, statusA.batchId);
  check(statusB && statusB.batchId !== statusA.batchId, '5. Import B is a genuinely NEW batch, not a stale re-report of A');
  check(statusB && statusB.result?.status === 'ok' && statusB.copied === 7, '6. Import B completes successfully and reports ONLY its own 7 files, not A\'s 5');
  await window.waitForTimeout(1500);

  check(fs.existsSync(path.join(destRoot, 'FolderA')) && (await fsp.readdir(path.join(destRoot, 'FolderA'))).length === 5,
    '7. FolderA\'s files are still on disk, untouched by B\'s run');
  check(fs.existsSync(path.join(destRoot, 'FolderB')) && (await fsp.readdir(path.join(destRoot, 'FolderB'))).length === 7,
    '8. FolderB\'s files landed on disk from its own run');

  const headlineAfterB = await window.evaluate(() => document.getElementById('tiStatusHeadline')?.textContent);
  check(headlineAfterB === 'Import complete', '9. completion headline correctly reflects B\'s own completion');

  // ── Close and reopen — must NOT be stuck either (operator's bullet 5) ────
  await window.keyboard.press('Escape');
  await window.waitForTimeout(300);
  await openImportModal(window);

  const buttonsAfterReopen = await window.evaluate(() => ({
    scanHidden:    document.getElementById('tiScanBtn')?.hidden,
    previewHidden: document.getElementById('tiPreviewBtn')?.hidden,
  }));
  check(buttonsAfterReopen.scanHidden === false && buttonsAfterReopen.previewHidden === false,
    '10. closing and reopening the modal does not re-trap Scan/Preview behind the old completed state');

  // A third, consecutive import after reopen (mirrors mandatory scenario #2).
  await selectOnlyFolder(window, 'FolderA'); // reselecting A again (mandatory scenario #4)
  await window.click('#tiScanBtn');
  await window.waitForTimeout(1200);
  const importBtnAfterReopenScan = await window.evaluate(() => document.getElementById('tiImportBtn')?.hidden);
  check(importBtnAfterReopenScan === false, '11. a THIRD consecutive operation (after close/reopen) is reachable — reselecting A and scanning again works');

  await electronApp.close().catch(() => {});

  log(failures === 0 ? 'ALL CHECKS PASSED (final)' : `${failures} CHECK(S) FAILED (final)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[ti-consec-e2e] FATAL', err);
  process.exit(1);
});
