'use strict';

// Live end-to-end verification of Defect 2 ("certain folders containing nested directories
// cannot be expanded") — a synthetic equivalent of the operator's reported
// "1448-04-04_02/02E": a Collection-shaped folder containing a non-Event sibling ("02E",
// an externalFolder) that itself has nested subdirectories and files. Any readable
// directory with accessible children must be expandable regardless of Collection/Event/
// Component/generic classification — never gated on event.json.
//
// Run: node test/transferImportExternalFolderExpansionLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[ti-ext-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

(async () => {
  const userDataDir  = await mkTmp('ai-e2e-tiext-userdata-');
  const archiveRoot   = await mkTmp('ai-e2e-tiext-archive-');
  const transferRoot  = await mkTmp('ai-e2e-tiext-transfer-');

  // ── Synthetic fixture: "1448-04-04_02" (Collection) with "02E" (non-Event external
  // sibling, nested directories/files, underscores/numeric prefixes/spaces in names) ──
  const collName = '1448-04-04_02';
  const collDir = path.join(transferRoot, collName);
  const evDir = path.join(collDir, '1448-04-04 _01-Waaz Mubarak');
  const evJson = JSON.stringify({
    version: 1, hijriDate: '1448-04-04', sequence: 1, eventName: 'Waaz Mubarak',
    components: [{ types: ['Majlis'], city: 'TestCity', location: null }],
  });
  await fsp.mkdir(evDir, { recursive: true });
  await fsp.writeFile(path.join(evDir, 'event.json'), evJson);
  await fsp.writeFile(path.join(evDir, 'photo.jpg'), 'photo bytes');

  const extDir = path.join(collDir, '02E');
  await fsp.mkdir(path.join(extDir, 'sub folder 1'), { recursive: true });
  await fsp.mkdir(path.join(extDir, 'sub_folder_2'), { recursive: true });
  await fsp.writeFile(path.join(extDir, 'top-level-02E-file.txt'), 'top level');
  await fsp.writeFile(path.join(extDir, 'sub folder 1', 'nested-01.dat'), 'nested bytes 1');
  await fsp.writeFile(path.join(extDir, 'sub_folder_2', 'nested-02.dat'), 'nested bytes 2');
  await fsp.mkdir(path.join(archiveRoot, collName), { recursive: true }); // pre-existing Collection

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
  // 1. Open the synthetic "1448-04-04_02" Collection
  // =============================================================================
  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === '1448-04-04_02');
    row.closest('.tx-tree-node').querySelector('.tx-tree-arrow').click();
  });
  await window.waitForTimeout(300);
  const ext02EVisible = await window.evaluate(() => !!Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === '02E'));
  check(ext02EVisible, '0. "1448-04-04_02" expands to reveal the "02E" external sibling folder');

  const arrowExists = await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === '02E');
    const arrow = row.closest('.tx-tree-row').querySelector('.tx-generic-arrow');
    return !!arrow && arrow.textContent === '▶';
  });
  check(arrowExists, '1. "02E" has a real, interactive expand arrow (not a dead end)');

  // =============================================================================
  // 2. Expand "02E" — must never require event.json to be expandable
  // =============================================================================
  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === '02E');
    row.closest('.tx-generic-node').querySelector('.tx-generic-arrow').click();
  });
  await window.waitForTimeout(400);
  const ext02EChildren = await window.evaluate(() => {
    const names = Array.from(document.querySelectorAll('.tx-tree-name')).map(n => n.textContent);
    return {
      hasSub1: names.includes('sub folder 1'),
      hasSub2: names.includes('sub_folder_2'),
      hasTopFile: names.includes('top-level-02E-file.txt'),
    };
  });
  log('02E children:', JSON.stringify(ext02EChildren));
  check(ext02EChildren.hasSub1 && ext02EChildren.hasSub2, '2. expanding "02E" reveals both nested subdirectories (underscore and space in names)');
  check(ext02EChildren.hasTopFile, '2b. expanding "02E" also reveals its own direct file');

  // =============================================================================
  // 3. Expand "sub folder 1" — a further nested descendant
  // =============================================================================
  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'sub folder 1');
    row.closest('.tx-generic-node').querySelector('.tx-generic-arrow').click();
  });
  await window.waitForTimeout(400);
  const nested01Visible = await window.evaluate(() => !!Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'nested-01.dat'));
  check(nested01Visible, '3. expanding "sub folder 1" reveals its nested file ("nested-01.dat")');

  // =============================================================================
  // 4. Select ONLY nested-01.dat (deselect everything else first)
  // =============================================================================
  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === '1448-04-04_02');
    row.closest('.tx-tree-node').querySelector('.ti-cb-coll').click();
  });
  await window.waitForTimeout(200);
  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'nested-01.dat');
    row.closest('.tx-tree-row').querySelector('input[type=checkbox]').click();
  });
  await window.waitForTimeout(200);

  const selectionState = await window.evaluate(() => {
    const get = (name) => {
      const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === name);
      return row.closest('.tx-tree-row').querySelector('input[type=checkbox]').checked;
    };
    return { nested01: get('nested-01.dat'), topFile: get('top-level-02E-file.txt'), sub2: get('sub_folder_2') };
  });
  check(selectionState.nested01 === true, '4a. the individually selected nested file is checked');
  check(selectionState.topFile === false, '4b. the sibling direct file in "02E" remains unselected');
  check(selectionState.sub2 === false, '4c. the sibling subdirectory in "02E" remains unselected');

  // =============================================================================
  // 5/6. Preview and Import — verify exact destination
  // =============================================================================
  await window.click('#tiPreviewBtn');
  await window.waitForTimeout(1000);
  const previewFiles = await window.evaluate(() => document.getElementById('tiPvFiles')?.textContent);
  check(previewFiles === '1', '5. Preview shows exactly the one selected nested file');

  await window.click('#tiImportBtn');
  let status = null;
  for (let i = 0; i < 100; i++) {
    status = await window.evaluate(async () => window.api.getTransferImportStatus());
    if (status && status.batchId && !status.running) break;
    await window.waitForTimeout(200);
  }
  check(status && status.batchId && !status.running, '6. import completes');

  // =============================================================================
  // 7/8. Verify filesystem — exact location, siblings absent
  // =============================================================================
  check(fs.existsSync(path.join(archiveRoot, collName, '02E', 'sub folder 1', 'nested-01.dat')), '7. the selected nested file lands at the correct destination, hierarchy preserved');
  check(!fs.existsSync(path.join(archiveRoot, collName, '02E', 'top-level-02E-file.txt')), '8a. the unselected sibling top-level file was never copied');
  check(!fs.existsSync(path.join(archiveRoot, collName, '02E', 'sub_folder_2')), '8b. the unselected sibling subdirectory was never copied');
  check(!fs.existsSync(path.join(archiveRoot, collName, '02E', 'sub folder 1', '02E.json'))
    && !fs.existsSync(path.join(archiveRoot, collName, '02E', 'event.json')), '8c. no event metadata was ever invented for "02E"');

  log(failures === 0 ? 'ALL CHECKS PASSED (final)' : `${failures} CHECK(S) FAILED (final)`);
  await electronApp.close().catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[ti-ext-e2e] FATAL', err);
  process.exit(1);
});
