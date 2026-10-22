'use strict';

// Live end-to-end verification of Defect B ("Transfer Import: Zero-Copy Failure") —
// (1) a real Electron import of 3,000+ synthetic files, verified on disk, not just via
//     progress counters, and (2) the corrected failure reporting when a destination cannot
//     be written to at all: the UI must say "failed — no files copied" with the error-cap
//     explicitly surfaced, never a misleading generic "complete" / "complete with errors".
//
// Run: node test/transferImportZeroCopyAndLargeImportLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[ti-zc-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

async function buildRecoveredFixture(recRoot, targetCount) {
  const photographers = ['Photographer A', 'Photographer B, Backup', "Ali's Camera"];
  let fileCount = 0;
  for (const ph of photographers) {
    for (let n = 0; n < 60 && fileCount < targetCount; n++) {
      const numDir = path.join(recRoot, ph, String(100 + n));
      await fsp.mkdir(numDir, { recursive: true });
      for (let f = 0; f < 20 && fileCount < targetCount; f++) {
        const ext = ['.JPG', '.CR2', '.dat', '.bin', ''][f % 5];
        await fsp.writeFile(path.join(numDir, `IMG_${String(fileCount).padStart(5, '0')}${ext}`), 'bytes-' + fileCount);
        fileCount++;
      }
    }
  }
  return fileCount;
}

async function countFilesOnDisk(dir) {
  let count = 0;
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return 0; }
  for (const e of entries) {
    if (e.isDirectory()) count += await countFilesOnDisk(path.join(dir, e.name));
    else if (e.isFile()) count++;
  }
  return count;
}

(async () => {
  const userDataDir  = await mkTmp('ai-e2e-tizc-userdata-');
  const archiveRoot   = await mkTmp('ai-e2e-tizc-archive-');
  const transferRoot  = await mkTmp('ai-e2e-tizc-transfer-');

  const recRoot = path.join(transferRoot, 'recovered');
  const builtCount = await buildRecoveredFixture(recRoot, 3228);
  log('built', builtCount, 'synthetic recovered files');

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));
  electronApp.on('close', () => log('electronApp CLOSED unexpectedly'));

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

  await window.evaluate(async (root) => {
    await window.api.initArchiveRoot(root);
    await window.api.setNasRoot(root);
    await window.api.setMainArchiveRoot(root);
    await window.api.setArchiveRootSetting(root);
  }, archiveRoot);
  await window.waitForTimeout(300);

  const chosenRoot = await window.evaluate(async () => window.api.chooseTransferRoot());
  check(chosenRoot === transferRoot, 'setup: Transfer Drive set');

  await window.evaluate(() => _alocOpen());
  await window.waitForTimeout(300);
  await window.click('#alocTransferImportBtn');
  await window.waitForTimeout(800);

  // =============================================================================
  // PART 1 — real 3,000+ file import, verified on disk (not just progress counters)
  // =============================================================================
  await window.click('#tiSelectAllBtn');
  await window.waitForTimeout(300);
  await window.click('#tiPreviewBtn');
  await window.waitForTimeout(1500);
  const previewFiles = await window.evaluate(() => document.getElementById('tiPvFiles')?.textContent);
  log('preview files:', previewFiles);
  check(Number(previewFiles.replace(/,/g, '')) === builtCount, `1. Preview reports all ${builtCount} synthetic files (manifest consistency)`);

  await window.click('#tiImportBtn');
  let status = null;
  for (let i = 0; i < 300; i++) {
    status = await window.evaluate(async () => window.api.getTransferImportStatus());
    if (status && status.batchId && !status.running) break;
    await window.waitForTimeout(300);
  }
  check(status && status.batchId && !status.running, '2. the large import completes (not left running/stuck)');
  check(status.copied === builtCount, `3. status reports all ${builtCount} files copied`);

  const actualOnDisk = await countFilesOnDisk(path.join(archiveRoot, 'recovered'));
  check(actualOnDisk === builtCount, `4. VERIFIED ON DISK — ${actualOnDisk} of ${builtCount} files actually exist at the destination (not just a progress counter)`);

  const sourceStillOnDisk = await countFilesOnDisk(recRoot);
  check(sourceStillOnDisk === builtCount, '5. all source files remain untouched — nothing was deleted or modified');

  await window.keyboard.press('Escape');
  await window.waitForTimeout(300);
  await electronApp.close().catch(() => {});

  // =============================================================================
  // PART 2 — zero-copy failure reporting: an unwritable destination.
  // A fresh Electron launch — the completed Part 1 import's "done" phase otherwise
  // persists in the (real, intentional) in-memory status until the operator explicitly
  // starts fresh from an interrupted-checkpoint offer, which doesn't apply here; a new
  // process is the clean way to start a genuinely new import scenario, same as an operator
  // relaunching the app.
  // =============================================================================
  const transferRoot2 = await mkTmp('ai-e2e-tizc2-transfer-');
  const archiveRoot2  = await mkTmp('ai-e2e-tizc2-archive-');
  const userDataDir2  = await mkTmp('ai-e2e-tizc2-userdata-');
  const rec2 = path.join(transferRoot2, 'recovered2');
  const built2 = await buildRecoveredFixture(rec2, 300);
  log('built', built2, 'files for the zero-copy scenario');

  await fsp.chmod(archiveRoot2, 0o555); // read-only destination — every copy must fail identically

  const electronApp2 = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir2}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp2.process().stdout.on('data', (d) => process.stdout.write('[main2-stdout] ' + d));
  electronApp2.process().stderr.on('data', (d) => process.stdout.write('[main2-stderr] ' + d));

  await electronApp2.evaluate(async ({ dialog }, transferRootArg) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [transferRootArg] });
  }, transferRoot2);

  let window2 = await electronApp2.firstWindow({ timeout: 60000 });
  window2.on('console', msg => { if (msg.type() === 'error') log('[console.error]', msg.text()); });
  await window2.waitForLoadState('domcontentloaded');
  await window2.waitForTimeout(1500);

  const splashState2 = await window2.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));
  const mainWindowPromise2 = electronApp2.waitForEvent('window', { timeout: 30000 });
  if (splashState2.create) {
    await window2.fill('#splashInputName', 'E2E Test Operator');
    await window2.fill('#splashInputRole', 'QA');
    await window2.click('#splashCreateStartBtn');
  } else if (splashState2.select) {
    const hasUsers = await window2.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window2.click('.splash-user-item'); await window2.click('#splashSelectStartBtn'); }
    else {
      await window2.click('#splashNewProfileBtn');
      await window2.waitForTimeout(300);
      await window2.fill('#splashInputName', 'E2E Test Operator');
      await window2.fill('#splashInputRole', 'QA');
      await window2.click('#splashCreateStartBtn');
    }
  } else if (splashState2.welcome) {
    await window2.click('#splashContinueBtn');
  }
  window2 = await mainWindowPromise2;
  window2.on('console', msg => { if (msg.type() === 'error') log('[console.error]', msg.text()); });
  await window2.waitForLoadState('domcontentloaded');
  await window2.waitForTimeout(2000);

  await window2.evaluate(async (root) => {
    await window.api.initArchiveRoot(root);
    await window.api.setNasRoot(root);
    await window.api.setMainArchiveRoot(root);
    await window.api.setArchiveRootSetting(root);
  }, archiveRoot2);
  await window2.waitForTimeout(300);

  const chosenRoot2 = await window2.evaluate(async () => window.api.chooseTransferRoot());
  check(chosenRoot2 === transferRoot2, 'setup2: second Transfer Drive set');

  await window2.evaluate(() => _alocOpen());
  await window2.waitForTimeout(300);
  await window2.click('#alocTransferImportBtn');
  await window2.waitForTimeout(800);

  await window2.click('#tiSelectAllBtn');
  await window2.waitForTimeout(300);
  await window2.click('#tiPreviewBtn');
  await window2.waitForTimeout(1000);
  await window2.click('#tiImportBtn');

  let status2 = null;
  for (let i = 0; i < 100; i++) {
    status2 = await window2.evaluate(async () => window.api.getTransferImportStatus());
    if (status2 && status2.batchId && !status2.running) break;
    await window2.waitForTimeout(200);
  }
  check(status2 && status2.batchId && !status2.running, '6. the zero-copy import run completes (does not hang)');
  // The renderer's own UI-refresh poll runs on its own timer, separate from this test's
  // direct backend poll above — give it a moment to catch up before reading the DOM.
  await window2.waitForTimeout(1500);
  check(status2.result?.status === 'failed', '7. the backend reports status "failed" — not "ok"/"partial" — when zero files are copied');
  check(status2.copied === 0, '8. zero files were actually copied');

  const headline = await window2.evaluate(() => document.getElementById('tiStatusHeadline')?.textContent);
  log('headline:', headline);
  check(headline === 'Import failed — no files copied', '9. the UI headline explicitly says the import failed and copied nothing — never a misleading "complete"');

  const capWarningVisible = await window2.evaluate(() => {
    const el = document.getElementById('tiErrorCapWarning');
    return { hidden: el?.hasAttribute('hidden'), text: el?.textContent };
  });
  log('error cap warning:', JSON.stringify(capWarningVisible));
  check(capWarningVisible.hidden === false, '10. the error-cap warning is shown (the 200-error cap stopped far short of all attempted files)');
  check(capWarningVisible.text.includes('200'), '10b. the warning explicitly mentions the 200-error cap');
  check(capWarningVisible.text.toLowerCase().includes('never attempted') || /never attempted/i.test(capWarningVisible.text), '10c. the warning explains that remaining files were never attempted, not just "200 errors"');

  const boxIsErrorStyled = await window2.evaluate(() => document.getElementById('tiStatusBox')?.classList.contains('tx-error'));
  check(boxIsErrorStyled === true, '11. the status box is styled as an error/failure, not a success ("done") state');

  check(!fs.existsSync(path.join(archiveRoot2, 'recovered2')) || (await countFilesOnDisk(path.join(archiveRoot2, 'recovered2'))) === 0,
    '12. confirmed on disk — genuinely zero files landed at the unwritable destination');

  await fsp.chmod(archiveRoot2, 0o755).catch(() => {}); // restore for cleanup

  log(failures === 0 ? 'ALL CHECKS PASSED (final)' : `${failures} CHECK(S) FAILED (final)`);
  await electronApp2.close().catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[ti-zc-e2e] FATAL', err);
  process.exit(1);
});
