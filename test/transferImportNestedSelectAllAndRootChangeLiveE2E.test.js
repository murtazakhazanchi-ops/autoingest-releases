'use strict';

// Live end-to-end coverage for the remaining "Transfer Import Nested Selection Parity" items
// not exercised by transferImportNestedSelectionLiveE2E.test.js: Select All / Select None
// cascading correctly into an already-expanded nested tree, and changing the Transfer Drive
// root resetting stale nested selection state cleanly. Real Electron UI interaction only.
//
// Run: node test/transferImportNestedSelectAllAndRootChangeLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[ti-nest-sa-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

(async () => {
  const userDataDir  = await mkTmp('ai-e2e-tisa-userdata-');
  const archiveRoot   = await mkTmp('ai-e2e-tisa-archive-');
  const transferRoot  = await mkTmp('ai-e2e-tisa-transfer-');
  const transferRoot2 = await mkTmp('ai-e2e-tisa-transfer2-');

  log('transferRoot =', transferRoot);
  log('transferRoot2 (new root) =', transferRoot2);

  const genRoot = path.join(transferRoot, 'Batch');
  for (const n of ['A', 'B', 'C']) {
    await fsp.mkdir(path.join(genRoot, `Sub-${n}`), { recursive: true });
    await fsp.writeFile(path.join(genRoot, `Sub-${n}`, 'f.txt'), n);
  }
  // A completely different fixture on the second root, to prove stale selection is discarded.
  await fsp.mkdir(path.join(transferRoot2, 'OtherFolder'), { recursive: true });
  await fsp.writeFile(path.join(transferRoot2, 'OtherFolder', 'g.txt'), 'g');

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));
  electronApp.on('close', () => log('electronApp CLOSED unexpectedly'));

  let currentDialogTarget = transferRoot;
  await electronApp.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__e2eDialogTarget] });
  });
  await electronApp.evaluate((_e, root) => { globalThis.__e2eDialogTarget = root; }, currentDialogTarget);

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
  check(chosenRoot === transferRoot, 'setup: Transfer Drive set to the first root');

  await window.evaluate(() => _alocOpen());
  await window.waitForTimeout(300);
  await window.click('#alocTransferImportBtn');
  await window.waitForTimeout(800);

  // Expand "Batch" to load its 3 nested Sub- folders, then deselect one.
  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'Batch');
    row.closest('.tx-generic-node').querySelector('.tx-generic-arrow').click();
  });
  await window.waitForTimeout(400);
  const subFoldersVisible = await window.evaluate(() => Array.from(document.querySelectorAll('.tx-tree-name')).filter(n => n.textContent.startsWith('Sub-')).length);
  check(subFoldersVisible === 3, '1. expanding "Batch" reveals its 3 nested Sub- folders');

  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'Sub-B');
    row.closest('.tx-tree-row').querySelector('input[type=checkbox]').click();
  });
  const afterDeselect = await window.evaluate(() => {
    const get = (name) => {
      const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === name);
      return row.closest('.tx-tree-row').querySelector('input[type=checkbox]').checked;
    };
    const batchRow = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'Batch');
    const batchCb = batchRow.closest('.tx-generic-node').querySelector(':scope > .tx-tree-row input[type=checkbox]');
    return { subB: get('Sub-B'), batchIndeterminate: batchCb.indeterminate };
  });
  check(afterDeselect.subB === false, 'setup: Sub-B deselected');
  check(afterDeselect.batchIndeterminate === true, 'setup: "Batch" is indeterminate after deselecting Sub-B');

  // ── 10. Select All — must re-check Sub-B too (cascading into the already-expanded tree) ──
  await window.click('#tiSelectAllBtn');
  await window.waitForTimeout(200);
  const afterSelectAll = await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'Sub-B');
    return row.closest('.tx-tree-row').querySelector('input[type=checkbox]').checked;
  });
  check(afterSelectAll === true, '10. Select All re-checks a previously-deselected nested folder (Sub-B)');

  // ── 11. Select None — must uncheck every nested folder too ──────────────────
  await window.click('#tiSelectNoneBtn');
  await window.waitForTimeout(200);
  const afterSelectNone = await window.evaluate(() => {
    return Array.from(document.querySelectorAll('.tx-tree-name'))
      .filter(n => n.textContent.startsWith('Sub-'))
      .every(n => n.closest('.tx-tree-row').querySelector('input[type=checkbox]').checked === false);
  });
  check(afterSelectNone === true, '11. Select None unchecks every nested folder (all 3 Sub- folders)');

  await window.keyboard.press('Escape');
  await window.waitForTimeout(200);

  // ── 12/13. Change the Transfer Drive root, reopen — stale nested selection is discarded ──
  currentDialogTarget = transferRoot2;
  await electronApp.evaluate((_e, root) => { globalThis.__e2eDialogTarget = root; }, currentDialogTarget);
  const chosenRoot2 = await window.evaluate(async () => window.api.chooseTransferRoot());
  check(chosenRoot2 === transferRoot2, '12. Transfer Drive root changed to the second root');

  await window.evaluate(() => _alocOpen());
  await window.waitForTimeout(300);
  await window.click('#alocTransferImportBtn');
  await window.waitForTimeout(800);

  const newTreeState = await window.evaluate(() => {
    const names = Array.from(document.querySelectorAll('.tx-tree-name')).map(n => n.textContent);
    return { names, hasBatch: names.includes('Batch'), hasOther: names.includes('OtherFolder') };
  });
  log('tree names after root change:', JSON.stringify(newTreeState.names));
  check(newTreeState.hasOther === true, '13a. reopening after a root change shows the NEW root\'s content ("OtherFolder")');
  check(newTreeState.hasBatch === false, '13b. the OLD root\'s stale nested selection/content ("Batch") is gone, not leaked across the root change');

  log(failures === 0 ? 'ALL CHECKS PASSED (final)' : `${failures} CHECK(S) FAILED (final)`);
  await electronApp.close().catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[ti-nest-sa-e2e] FATAL', err);
  process.exit(1);
});
