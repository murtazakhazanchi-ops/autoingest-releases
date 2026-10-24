'use strict';

// Live end-to-end verification of "AUTOINGEST — RESTORE GENERAL-PURPOSE TRANSFER IMPORT",
// driving the REAL Electron app (real main process, real renderer, real IPC, real filesystem)
// through the actual operator workflow: selecting a legacy year folder, a VHS folder, and an
// individual file via the real checkboxes, Preview, Import, and verifying the resulting
// filesystem hierarchy. Synthetic fixtures only — never touches a real archive/NAS/card.
//
// Run: node test/transferImportGeneralPurposeLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[ti-gp-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

(async () => {
  const userDataDir  = await mkTmp('ai-e2e-tigp-userdata-');
  const archiveRoot   = await mkTmp('ai-e2e-tigp-archive-');
  const transferRoot  = await mkTmp('ai-e2e-tigp-transfer-');

  log('userDataDir =', userDataDir);
  log('archiveRoot (Main Archive Root) =', archiveRoot);
  log('transferRoot (Transfer Drive) =', transferRoot);

  // ── Synthetic Transfer Drive layout: Example B (legacy year folder) + Example C (VHS) ──
  // + an individual root file + a mixed-in AutoIngest Collection (archive-aware control).
  const yearRoot = path.join(transferRoot, '1441');
  await fsp.mkdir(path.join(yearRoot, '732'), { recursive: true });
  await fsp.writeFile(path.join(yearRoot, '732', '732-clip.mov'), 'legacy video bytes');
  await fsp.mkdir(path.join(yearRoot, 'From Sh Abdo B'), { recursive: true });
  await fsp.writeFile(path.join(yearRoot, 'From Sh Abdo B', 'note.txt'), 'handoff note');

  const vhsRoot = path.join(transferRoot, 'London VHS');
  await fsp.mkdir(path.join(vhsRoot, 'VHS LOT -01'), { recursive: true });
  await fsp.writeFile(path.join(vhsRoot, 'VHS LOT -01', 'tape.mpg'), 'vhs capture bytes');

  await fsp.writeFile(path.join(transferRoot, 'manifest.csv'), 'a,b,c');

  const evJson = JSON.stringify({
    version: 1, hijriDate: '1448-03-26', sequence: 1, eventName: 'Waaz Mubarak',
    components: [{ types: ['Majlis'], city: 'Bhuj', location: null }],
  });
  const collDir = path.join(transferRoot, '1448-03-26_Bhuj Atraaf Safar', '1448-03-26 _01-Waaz Mubarak');
  await fsp.mkdir(collDir, { recursive: true });
  await fsp.writeFile(path.join(collDir, 'event.json'), evJson);
  await fsp.writeFile(path.join(collDir, 'photo.jpg'), 'photo bytes');

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

  const initRes = await window.evaluate(async (root) => window.api.initArchiveRoot(root), archiveRoot);
  check(initRes?.ok === true, 'setup: archive-root marker initialized');
  await window.evaluate(async (root) => {
    await window.api.setNasRoot(root);
    await window.api.setMainArchiveRoot(root);
    await window.api.setArchiveRootSetting(root);
  }, archiveRoot);
  await window.waitForTimeout(300);

  const chosenRoot = await window.evaluate(async () => window.api.chooseTransferRoot());
  check(chosenRoot === transferRoot, '1. Transfer Drive is set via the real chooseTransferRoot IPC handler');

  // =============================================================================
  // 2. Open Transfer Import and inspect the tree
  // =============================================================================
  await window.evaluate(() => _alocOpen());
  await window.waitForTimeout(300);
  await window.click('#alocTransferImportBtn');
  await window.waitForTimeout(800);
  const modalOpen = await window.evaluate(() => document.getElementById('transferImportModal')?.classList.contains('open'));
  check(modalOpen === true, '2. Transfer Import modal opened');

  const treeState = await window.evaluate(() => {
    const names = Array.from(document.querySelectorAll('#tiScopeTree .tx-tree-name')).map(n => n.textContent);
    const genfolderCount = document.querySelectorAll('#tiScopeTree .ti-cb-genfolder').length;
    const genfileCount   = document.querySelectorAll('#tiScopeTree .ti-cb-genfile').length;
    const genfolderDisabled = Array.from(document.querySelectorAll('#tiScopeTree .ti-cb-genfolder')).some(cb => cb.disabled);
    const genfileDisabled   = Array.from(document.querySelectorAll('#tiScopeTree .ti-cb-genfile')).some(cb => cb.disabled);
    return { names, genfolderCount, genfileCount, genfolderDisabled, genfileDisabled };
  });
  log('tree names:', JSON.stringify(treeState.names));
  check(treeState.names.includes('1441'), '3a. the legacy year folder "1441" appears in the tree');
  check(treeState.names.includes('London VHS'), '3b. the VHS folder "London VHS" appears in the tree');
  check(treeState.names.includes('manifest.csv'), '3c. the root-level file "manifest.csv" appears in the tree');
  check(treeState.genfolderCount >= 2, '4a. generic-folder checkboxes exist for both "1441" and "London VHS"');
  check(treeState.genfileCount >= 1, '4b. a generic-file checkbox exists for "manifest.csv"');
  check(treeState.genfolderDisabled === false, '5a. generic-folder checkboxes are enabled, not disabled');
  check(treeState.genfileDisabled === false, '5b. the generic-file checkbox is enabled, not disabled');

  // =============================================================================
  // 6. Select All → Preview → Import (real operator workflow)
  // =============================================================================
  await window.click('#tiSelectAllBtn');
  await window.waitForTimeout(300);
  await window.click('#tiPreviewBtn');
  await window.waitForTimeout(1000);
  const previewText = await window.evaluate(() => ({
    collections: document.getElementById('tiPvCollections')?.textContent,
    events:      document.getElementById('tiPvEvents')?.textContent,
    generic:     document.getElementById('tiPvGeneric')?.textContent,
    files:       document.getElementById('tiPvFiles')?.textContent,
    unresolvedNoteHidden: document.getElementById('tiPvUnresolvedNote')?.hasAttribute('hidden'),
  }));
  log('preview:', JSON.stringify(previewText));
  check(previewText.collections === '1', '7a. Preview resolves the one AutoIngest Collection');
  check(Number(previewText.generic) >= 3, '7b. Preview counts the generic items (1441, London VHS, manifest.csv)');
  check(previewText.unresolvedNoteHidden === true, '7c. nothing is unresolved in this selection');

  const importBtnDisabled = await window.evaluate(() => document.getElementById('tiImportBtn')?.disabled);
  check(importBtnDisabled === false, '8. Import button is enabled after a non-empty Preview');

  await window.click('#tiImportBtn');
  // Require a real batchId before trusting running:false — the click handler is itself async,
  // so the very first poll can otherwise race ahead and see the pristine pre-run default.
  let status = null;
  for (let i = 0; i < 100; i++) {
    status = await window.evaluate(async () => window.api.getTransferImportStatus());
    if (status && status.batchId && !status.running) break;
    await window.waitForTimeout(200);
  }
  check(status && status.batchId && !status.running, '9. import completes');

  // =============================================================================
  // 10. Verify real filesystem outcome — hierarchy preserved, names unchanged
  // =============================================================================
  check(fs.existsSync(path.join(archiveRoot, '1441', '732', '732-clip.mov')), '10a. legacy numbered subfolder preserved exactly');
  check(fs.existsSync(path.join(archiveRoot, '1441', 'From Sh Abdo B', 'note.txt')), '10b. legacy named subfolder preserved exactly');
  check(fs.existsSync(path.join(archiveRoot, 'London VHS', 'VHS LOT -01', 'tape.mpg')), '10c. VHS lot folder preserved exactly');
  check(fs.existsSync(path.join(archiveRoot, 'manifest.csv')), '10d. root-level file copied to the Main Archive Root');
  check(fs.existsSync(path.join(archiveRoot, '1448-03-26_Bhuj Atraaf Safar', '1448-03-26 _01-Waaz Mubarak', 'photo.jpg')), '10e. the AutoIngest Collection still imports correctly alongside general-purpose content');
  check(!fs.existsSync(path.join(archiveRoot, '1441', 'event.json')), '10f. no event.json was ever invented for the legacy folder');

  // Source untouched.
  check(fs.existsSync(path.join(transferRoot, '1441', '732', '732-clip.mov')), '11. source files remain untouched — never deleted');

  log(failures === 0 ? 'ALL CHECKS PASSED (final)' : `${failures} CHECK(S) FAILED (final)`);
  await electronApp.close().catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[ti-gp-e2e] FATAL', err);
  process.exit(1);
});
