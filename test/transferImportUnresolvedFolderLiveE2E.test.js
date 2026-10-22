'use strict';

// Live end-to-end verification of the "Transfer Import Unresolved Folder Bug" fix, driving
// the REAL Electron app (real main process, real renderer, real IPC, real filesystem) through
// the actual operator workflow reported broken: every source folder showed a red "Unresolved"
// status with a permanently disabled checkbox. Synthetic fixtures only — never touches a real
// archive/NAS/card. No service-level shortcuts for the behavior under test: the Transfer
// Drive root is set via the real `archive:chooseTransferRoot` IPC handler (native dialog
// patched, same technique as test/metadataPipelineLive.test.js — the handler itself still
// runs for real), and the tree/preview/import all go through the real UI.
//
// Run: node test/transferImportUnresolvedFolderLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[ti-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

function evJson(seq, name, hijriDate = '1446-01-01') {
  return JSON.stringify({
    version: 1, hijriDate, sequence: seq, eventName: name,
    components: [{ types: ['Majlis'], city: 'TestCity', location: null }],
  });
}
// A real, minimal 2x2 JPEG (not placeholder text) — the real app's post-transfer metadata
// verification pass (AI-FEAT-032) reads this file through the renderer's actual image
// pipeline, which a text-content ".jpg" stub would fail in a way unrelated to this fix.
const MINIMAL_JPEG = Buffer.from(
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z',
  'base64'
);
async function mkEvent(dir, seq, name) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'event.json'), evJson(seq, name));
  await fsp.writeFile(path.join(dir, 'photo.jpg'), MINIMAL_JPEG);
}

(async () => {
  const userDataDir     = await mkTmp('ai-e2e-ti-userdata-');
  const archiveRoot      = await mkTmp('ai-e2e-ti-archive-');
  const transferRoot     = await mkTmp('ai-e2e-ti-transfer-');

  log('userDataDir =', userDataDir);
  log('archiveRoot (Main Archive Root) =', archiveRoot);
  log('transferRoot (Transfer Drive) =', transferRoot);

  // ── Synthetic Transfer Drive layout, mirroring the operator report's shape ──
  // Existing Collection — already has a destination counterpart.
  await mkEvent(path.join(transferRoot, 'ExistingColl', 'EventB'), 2, 'EventB');
  await fsp.mkdir(path.join(archiveRoot, 'ExistingColl'), { recursive: true });
  // New Collection — no destination counterpart yet (the real bug: this used to be
  // permanently unresolved/blocked).
  await mkEvent(path.join(transferRoot, 'Africa Data', 'EventA'), 1, 'EventA');
  // Windows OS junk — must not even appear.
  await fsp.mkdir(path.join(transferRoot, '$RECYCLE.BIN', 'S-1-5-21'), { recursive: true });
  await fsp.writeFile(path.join(transferRoot, '$RECYCLE.BIN', 'S-1-5-21', 'junk.dat'), 'x');
  await fsp.mkdir(path.join(transferRoot, 'System Volume Information'), { recursive: true });
  await fsp.writeFile(path.join(transferRoot, 'System Volume Information', 'IndexerVolumeGuid'), 'x');
  // Genuinely unsupported structure — must remain blocked.
  await fsp.mkdir(path.join(transferRoot, 'Random Notes', 'misc'), { recursive: true });
  await fsp.writeFile(path.join(transferRoot, 'Random Notes', 'misc', 'readme.txt'), 'hi');

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));
  electronApp.on('close', () => log('electronApp CLOSED unexpectedly'));

  // Patch the native "Choose Transfer Drive" dialog — Playwright can't drive a real OS
  // modal — so the real archive:chooseTransferRoot IPC handler still runs end to end.
  await electronApp.evaluate(async ({ dialog }, transferRootArg) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [transferRootArg] });
  }, transferRoot);

  let window = await electronApp.firstWindow({ timeout: 60000 });
  window.on('console', msg => { if (msg.type() === 'error') log('[console.error]', msg.text()); });
  window.on('pageerror', err => log('[pageerror]', err.message, err.stack));
  await window.waitForLoadState('domcontentloaded');

  // ── Splash / operator login ──────────────────────────────────────────────
  await window.waitForTimeout(1500);
  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));
  log('splash state:', JSON.stringify(splashState));

  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'E2E Test Operator');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) {
      await window.click('.splash-user-item');
      await window.click('#splashSelectStartBtn');
    } else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'E2E Test Operator');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  } else {
    log('WARNING: no recognizable splash panel visible — continuing anyway');
  }

  window = await mainWindowPromise;
  window.on('console', msg => { if (msg.type() === 'error') log('[console.error]', msg.text()); });
  window.on('pageerror', err => log('[pageerror]', err.message, err.stack));
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);

  // ── Configure Main Archive Root (real IPC, same pattern as eventManagementReliabilityLive) ──
  const initRes = await window.evaluate(async (root) => window.api.initArchiveRoot(root), archiveRoot);
  check(initRes?.ok === true, 'setup: archive-root marker initialized');
  await window.evaluate(async (root) => {
    await window.api.setNasRoot(root);
    await window.api.setMainArchiveRoot(root);
    await window.api.setArchiveRootSetting(root);
  }, archiveRoot);
  await window.waitForTimeout(300);

  // ── Configure Transfer Drive via the REAL "Choose Transfer Drive" flow ──────
  const chosenRoot = await window.evaluate(async () => window.api.chooseTransferRoot());
  check(chosenRoot === transferRoot, '1. Transfer Drive is set via the real chooseTransferRoot IPC handler');

  // =============================================================================
  // 2. Open Transfer Import (the real UI path: Archive Locations overlay → button)
  // =============================================================================
  await window.evaluate(() => _alocOpen());
  await window.waitForTimeout(300);
  await window.click('#alocTransferImportBtn');
  await window.waitForTimeout(800);
  const modalOpen = await window.evaluate(() => document.getElementById('transferImportModal')?.classList.contains('open'));
  check(modalOpen === true, '2. Transfer Import modal opened via the real UI trigger');

  // =============================================================================
  // 3. The tree reflects the fix: new Collection selectable, junk excluded, unsupported blocked
  // =============================================================================
  const treeState = await window.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#tiScopeTree .tx-tree-node, #tiScopeTree .tx-tree-row'));
    const names = Array.from(document.querySelectorAll('#tiScopeTree .tx-tree-name')).map(n => n.textContent);
    const existingCb = document.querySelector('#tiScopeTree .ti-cb-coll'); // first collection's own toggle (order not guaranteed)
    return {
      names,
      recycleBinPresent: names.includes('$RECYCLE.BIN'),
      sviPresent: names.includes('System Volume Information'),
      anyDisabledCheckbox: Array.from(document.querySelectorAll('#tiScopeTree input[type=checkbox]')).some(cb => cb.disabled),
      allCheckboxesDisabled: Array.from(document.querySelectorAll('#tiScopeTree input[type=checkbox]')).every(cb => cb.disabled),
    };
  });
  log('tree names:', JSON.stringify(treeState.names));
  check(!treeState.recycleBinPresent, '3a. $RECYCLE.BIN never appears as a row');
  check(!treeState.sviPresent, '3b. System Volume Information never appears as a row');
  check(treeState.allCheckboxesDisabled === false, '3c. not every checkbox is disabled — Transfer Import is usable (the reported bug)');

  const africaCbEnabled = await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'EventA');
    const nodeDiv = row?.closest('.tx-tree-node');
    const cb = nodeDiv?.querySelector('.ti-cb-ev');
    return cb ? !cb.disabled : null;
  });
  check(africaCbEnabled === true, "4. the new Collection's Event checkbox (Africa Data/EventA) is enabled/selectable");

  const newBadgePresent = await window.evaluate(() => {
    return Array.from(document.querySelectorAll('.tx-tree-status[data-status="new"]')).length > 0;
  });
  check(newBadgePresent, '5. a "New Collection" badge is shown for the new Collection (actionable explanation, not a scary generic Unresolved)');

  const randomNotesBlocked = await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'Random Notes');
    const container = row?.closest('.tx-tree-row');
    const cb = container?.querySelector('input[type=checkbox]');
    return cb ? cb.disabled : null;
  });
  check(randomNotesBlocked === true, '6. a genuinely unsupported folder ("Random Notes") remains correctly blocked');

  const existingCbEnabled = await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'EventB');
    const nodeDiv = row?.closest('.tx-tree-node');
    const cb = nodeDiv?.querySelector('.ti-cb-ev');
    return cb ? !cb.disabled : null;
  });
  check(existingCbEnabled === true, '7. the pre-existing Collection (ExistingColl/EventB) is still selectable — no regression');

  // =============================================================================
  // 8. Select All → Preview → Import (the real required operator workflow)
  // =============================================================================
  await window.click('#tiSelectAllBtn');
  await window.waitForTimeout(300);
  await window.click('#tiPreviewBtn');
  await window.waitForTimeout(1000);
  const previewText = await window.evaluate(() => ({
    collections: document.getElementById('tiPvCollections')?.textContent,
    events:      document.getElementById('tiPvEvents')?.textContent,
    files:       document.getElementById('tiPvFiles')?.textContent,
    unresolvedNoteHidden: document.getElementById('tiPvUnresolvedNote')?.hasAttribute('hidden'),
  }));
  log('preview:', JSON.stringify(previewText));
  check(previewText.collections === '2', '8a. Preview resolves both Collections (existing + new)');
  check(previewText.events === '2', '8b. Preview resolves both Events');

  const importBtnDisabled = await window.evaluate(() => document.getElementById('tiImportBtn')?.disabled);
  check(importBtnDisabled === false, '9. Import button is enabled after a non-empty Preview');

  await window.click('#tiImportBtn');

  // Poll the real IPC status until the import finishes.
  let status = null;
  for (let i = 0; i < 100; i++) {
    status = await window.evaluate(async () => window.api.getTransferImportStatus());
    if (status && !status.running) break;
    await window.waitForTimeout(200);
  }
  check(status && !status.running, '10. import completes (not left running/stuck)');

  // =============================================================================
  // 11. Verify real filesystem outcome — new Collection folder created, files copied
  // =============================================================================
  const newDestFile = path.join(archiveRoot, 'Africa Data', 'EventA', 'photo.jpg');
  const existingDestFile = path.join(archiveRoot, 'ExistingColl', 'EventB', 'photo.jpg');
  check(fs.existsSync(newDestFile), '11a. the new Collection ("Africa Data") was created and its file copied');
  check(fs.existsSync(existingDestFile), '11b. the pre-existing Collection also received its file');

  // Source is read-only — never deleted or modified.
  check(fs.existsSync(path.join(transferRoot, 'Africa Data', 'EventA', 'photo.jpg')), '12. source file for the new Collection still exists — never deleted');
  check(fs.existsSync(path.join(transferRoot, '$RECYCLE.BIN', 'S-1-5-21', 'junk.dat')), '13. excluded junk folder was left untouched on disk, not deleted');

  // =============================================================================
  // 14. Reopen and verify reimport/duplicate behavior — now resolved WITHOUT the new badge
  // =============================================================================
  await window.keyboard.press('Escape');
  await window.waitForTimeout(300);
  await window.evaluate(() => _alocOpen());
  await window.waitForTimeout(300);
  await window.click('#alocTransferImportBtn');
  await window.waitForTimeout(800);

  const reopenState = await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'Africa Data');
    const header = row?.closest('.tx-tree-row');
    return { stillMarkedNew: !!header?.querySelector('.tx-tree-status[data-status="new"]') };
  });
  check(reopenState.stillMarkedNew === false, '14. after import, "Africa Data" is no longer flagged as a new Collection (it now exists)');

  // Reimport/duplicate-safety (no duplication, no renaming on a second run) is already
  // proven directly against runImport() in test/transferImportUnresolvedClassification.test.js's
  // "end-to-end" case — not re-driven through the UI here, since a completed import leaves the
  // modal in its post-import "done" phase (Preview/Scan hidden until the operator explicitly
  // starts fresh), which is pre-existing UI state management unrelated to this fix.

  log(failures === 0 ? 'ALL CHECKS PASSED (final)' : `${failures} CHECK(S) FAILED (final)`);
  await electronApp.close().catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[ti-e2e] FATAL', err);
  process.exit(1);
});
