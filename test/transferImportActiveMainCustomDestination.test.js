'use strict';

// Live end-to-end verification of the "Active Archive Root & Custom Destination" brief:
// Transfer Import must default to the authoritative Active Archive Root (nasRoot), not
// automatically to Main Archive Root — the bug was that every Transfer Import IPC handler
// in main.js read settings.getMainArchiveRoot() directly, bypassing the app's own
// authoritative _resolveEffectiveArchiveRoot() resolution entirely. Also verifies the new
// "Change Destination" manual override (session-local, never persisted) and its
// invalidation behavior. Real Electron, synthetic fixtures only.
//
// Run: node test/transferImportActiveMainCustomDestination.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[ti-dest-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

async function buildSourceEvent(transferRoot, collName, evName) {
  const evJson = JSON.stringify({
    version: 1, hijriDate: '1448-01-01', sequence: 1, eventName: evName,
    components: [{ types: [], city: 'TestCity', location: null }],
  });
  const evDir = path.join(transferRoot, collName, evName);
  await fsp.mkdir(evDir, { recursive: true });
  await fsp.writeFile(path.join(evDir, 'event.json'), evJson);
  await fsp.writeFile(path.join(evDir, 'photo.jpg'), 'photo-bytes');
  return evDir;
}

async function launchApp(transferRoot, extraDialogPaths) {
  const userDataDir = await mkTmp('ai-e2e-tidest-userdata-');
  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));

  // Stub the native folder picker: route by dialog title so "Choose Transfer Drive" and
  // "Choose Destination Folder" (Change Destination) each resolve to their own fixture,
  // even though both go through the same dialog.showOpenDialog API.
  await electronApp.evaluate(async ({ dialog }, { transferRootArg, pathsByTitle }) => {
    dialog.showOpenDialog = async (_win, opts) => {
      const p = pathsByTitle[opts?.title] || transferRootArg;
      return { canceled: false, filePaths: [p] };
    };
  }, { transferRootArg: transferRoot, pathsByTitle: extraDialogPaths || {} });

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

(async () => {
  // =============================================================================
  // SCENARIO A — Active (nasRoot) differs from Main; Import must default to Active.
  // =============================================================================
  {
    const transferRoot = await mkTmp('ai-e2e-tidest-a-transfer-');
    const activeRoot   = await mkTmp('ai-e2e-tidest-a-active-');
    const mainRoot     = await mkTmp('ai-e2e-tidest-a-main-');
    await buildSourceEvent(transferRoot, 'CollA', 'EventA');

    const { electronApp, window } = await launchApp(transferRoot);

    await window.evaluate(async (root) => { await window.api.initArchiveRoot(root); }, mainRoot);
    await window.evaluate(async (root) => { await window.api.setMainArchiveRoot(root); }, mainRoot);
    await window.evaluate(async (root) => { await window.api.setNasRoot(root); }, activeRoot);
    await window.evaluate(async () => window.api.chooseTransferRoot());

    await openImportModal(window);

    const destShown = await window.evaluate(() => document.getElementById('tiMainArchivePath')?.textContent);
    check(destShown === activeRoot, `A1. Transfer Import defaults to Active Archive Root, not Main (shown: "${destShown}")`);

    await window.click('#tiSelectAllBtn');
    await window.waitForTimeout(300);
    await window.click('#tiPreviewBtn');
    await window.waitForTimeout(1000);
    await window.click('#tiImportBtn');
    let status = null;
    for (let i = 0; i < 100; i++) {
      status = await window.evaluate(async () => window.api.getTransferImportStatus());
      if (status && status.batchId && !status.running) break;
      await window.waitForTimeout(200);
    }
    check(status && status.batchId && !status.running, 'A2. import completes');
    check(fs.existsSync(path.join(activeRoot, 'CollA', 'EventA', 'photo.jpg')), 'A3. the file actually landed under Active Archive Root');
    check(!fs.existsSync(path.join(mainRoot, 'CollA')), 'A4. nothing was ever copied to Main Archive Root');

    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);
    await electronApp.close().catch(() => {});
  }

  // =============================================================================
  // SCENARIO B — Active and Main are the SAME path; Import selects that shared root.
  // =============================================================================
  {
    const transferRoot = await mkTmp('ai-e2e-tidest-b-transfer-');
    const sharedRoot    = await mkTmp('ai-e2e-tidest-b-shared-');
    await buildSourceEvent(transferRoot, 'CollB', 'EventB');

    const { electronApp, window } = await launchApp(transferRoot);
    await window.evaluate(async (root) => { await window.api.initArchiveRoot(root); }, sharedRoot);
    await window.evaluate(async (root) => { await window.api.setMainArchiveRoot(root); }, sharedRoot);
    await window.evaluate(async (root) => { await window.api.setNasRoot(root); }, sharedRoot);
    await window.evaluate(async () => window.api.chooseTransferRoot());

    await openImportModal(window);
    const destShown = await window.evaluate(() => document.getElementById('tiMainArchivePath')?.textContent);
    check(destShown === sharedRoot, `B1. Active === Main — Transfer Import selects the shared root (shown: "${destShown}")`);

    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);
    await electronApp.close().catch(() => {});
  }

  // =============================================================================
  // SCENARIO C — Active is unavailable (set but does not exist), Main IS available.
  // Must show the unavailable destination, disable Import, and NEVER silently fall back.
  // =============================================================================
  {
    const transferRoot = await mkTmp('ai-e2e-tidest-c-transfer-');
    const mainRoot      = await mkTmp('ai-e2e-tidest-c-main-');
    const missingActive = path.join(os.tmpdir(), `ai-e2e-tidest-c-active-MISSING-${Date.now()}`);
    await buildSourceEvent(transferRoot, 'CollC', 'EventC');

    const { electronApp, window } = await launchApp(transferRoot);
    await window.evaluate(async (root) => { await window.api.initArchiveRoot(root); }, mainRoot);
    await window.evaluate(async (root) => { await window.api.setMainArchiveRoot(root); }, mainRoot);
    await window.evaluate(async (root) => { await window.api.setNasRoot(root); }, missingActive);
    await window.evaluate(async () => window.api.chooseTransferRoot());

    await openImportModal(window);
    const destShown = await window.evaluate(() => document.getElementById('tiMainArchivePath')?.textContent);
    check(destShown === missingActive, `C1. the unavailable Active destination is displayed, not silently swapped for Main (shown: "${destShown}")`);

    const noteVisible = await window.evaluate(() => {
      const el = document.getElementById('tiDestNote');
      return { hidden: el?.hasAttribute('hidden'), text: el?.textContent };
    });
    check(noteVisible.hidden === false, 'C2. an unavailable-destination warning is shown');

    const importDisabled = await window.evaluate(() => document.getElementById('tiImportBtn')?.disabled);
    check(importDisabled === true, 'C3. Import is disabled while the destination is unreachable');

    const changeBtnVisible = await window.evaluate(() => !!document.getElementById('tiChangeDestBtn') && !document.getElementById('tiChangeDestBtn').hidden);
    check(changeBtnVisible === true, 'C4. Change Destination remains available as the way forward');

    check(!fs.existsSync(path.join(mainRoot, 'CollC')), 'C5. nothing was copied into Main as an automatic fallback (no copy was even attempted)');

    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);
    await electronApp.close().catch(() => {});
  }

  // =============================================================================
  // SCENARIO D — Manual "Change Destination" override: choose, Preview/Import into it,
  // never touches saved settings, invalidates stale Preview, resets on modal reopen.
  // =============================================================================
  {
    const transferRoot  = await mkTmp('ai-e2e-tidest-d-transfer-');
    const activeRoot    = await mkTmp('ai-e2e-tidest-d-active-');
    const customDestRoot = await mkTmp('ai-e2e-tidest-d-custom-');
    await buildSourceEvent(transferRoot, 'CollD', 'EventD');

    const { electronApp, window } = await launchApp(transferRoot, { 'Choose Destination Folder': customDestRoot });
    await window.evaluate(async (root) => { await window.api.setNasRoot(root); }, activeRoot);
    await window.evaluate(async () => window.api.chooseTransferRoot());

    await openImportModal(window);

    // Before any Change Destination, it must default to Active.
    const before = await window.evaluate(() => document.getElementById('tiMainArchivePath')?.textContent);
    check(before === activeRoot, 'D1. defaults to Active before any manual override');

    // Build a Preview first, to prove changing destination invalidates it.
    await window.click('#tiSelectAllBtn');
    await window.waitForTimeout(300);
    await window.click('#tiPreviewBtn');
    await window.waitForTimeout(1000);
    const importEnabledBeforeChange = await window.evaluate(() => document.getElementById('tiImportBtn')?.disabled === false);
    check(importEnabledBeforeChange, 'D2. Preview against the default destination enables Import (sanity check before the override)');

    // Change Destination — picks customDestRoot (stubbed dialog keyed by title).
    await window.click('#tiChangeDestBtn');
    await window.waitForTimeout(800);

    const after = await window.evaluate(() => document.getElementById('tiMainArchivePath')?.textContent);
    check(after === customDestRoot, `D3. the custom destination is now shown (shown: "${after}")`);

    const importDisabledAfterChange = await window.evaluate(() => document.getElementById('tiImportBtn')?.disabled);
    check(importDisabledAfterChange === true, 'D4. changing destination invalidates the prior Preview (Import disabled until Preview runs again)');

    const opsStatus = await window.evaluate(async () => window.api.getArchiveOperationsStatus());
    check(opsStatus?.nasRoot === activeRoot, `D5. choosing a custom destination never overwrites the saved Active Archive Root setting (still: "${opsStatus?.nasRoot}")`);

    // Preview + Import against the custom destination.
    await window.click('#tiSelectAllBtn');
    await window.waitForTimeout(300);
    await window.click('#tiPreviewBtn');
    await window.waitForTimeout(1000);
    await window.click('#tiImportBtn');
    let status = null;
    for (let i = 0; i < 100; i++) {
      status = await window.evaluate(async () => window.api.getTransferImportStatus());
      if (status && status.batchId && !status.running) break;
      await window.waitForTimeout(200);
    }
    check(status && status.batchId && !status.running, 'D6. import into the custom destination completes');
    check(fs.existsSync(path.join(customDestRoot, 'CollD', 'EventD', 'photo.jpg')), 'D7. the file landed at the custom destination');
    check(!fs.existsSync(path.join(activeRoot, 'CollD')), 'D8. nothing was copied to the default Active Archive Root instead');

    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);

    // Reopen — the custom override must NOT survive a close/reopen (requirement 7).
    await openImportModal(window);
    const afterReopen = await window.evaluate(() => document.getElementById('tiMainArchivePath')?.textContent);
    check(afterReopen === activeRoot, `D9. closing and reopening restores Active Archive Root as the default (shown: "${afterReopen}")`);

    await electronApp.close().catch(() => {});
  }

  log(failures === 0 ? 'ALL CHECKS PASSED (final)' : `${failures} CHECK(S) FAILED (final)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[ti-dest-e2e] FATAL', err);
  process.exit(1);
});
