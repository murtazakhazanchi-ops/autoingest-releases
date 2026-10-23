'use strict';

// Live end-to-end verification of Defect 1 ("Select None and parent deselection do not clear
// nested selections"). Root cause: _tiPropagateGenericCheckedDown used
// cb.closest('.tx-generic-node') to decide whether to recurse into a child — but a LEAF FILE
// checkbox has no node of its own, so closest() silently matched its ENCLOSING PARENT's node
// instead, re-entering the same parent forever (a real stack overflow). The resulting
// exception silently aborted the whole cascade mid-flight, leaving every sibling queued after
// the crash point (including root-level files like event.json, processed later in the same
// enclosing loop) still checked. Fixed by only recursing when the checkbox being processed is
// itself directory-shaped (data-isdir="1" — only those own a .tx-generic-node wrapper).
//
// Run: node test/transferImportSelectNoneLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[ti-selnone-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

async function allCheckboxStates(window) {
  return window.evaluate(() => Array.from(document.querySelectorAll('#tiScopeTree input[type=checkbox]')).map(cb => ({
    name: cb.closest('.tx-tree-row')?.querySelector('.tx-tree-name')?.textContent,
    checked: cb.checked, indeterminate: cb.indeterminate, disabled: cb.disabled,
  })));
}

(async () => {
  const userDataDir  = await mkTmp('ai-e2e-tisn-userdata-');
  const archiveRoot   = await mkTmp('ai-e2e-tisn-archive-');
  const transferRoot  = await mkTmp('ai-e2e-tisn-transfer-');

  // ── Fixture: a Collection with a deeply nested Event (JSON sidecar + photographer
  // subfolder containing a further "raw" subfolder) AND a sibling generic folder ──
  const evJson = JSON.stringify({
    version: 1, hijriDate: '1446-01-01', sequence: 3, eventName: 'EventB',
    components: [{ types: ['Majlis'], city: 'TestCity', location: null }],
  });
  const evDir = path.join(transferRoot, 'ExistingColl', 'EventB');
  await fsp.mkdir(path.join(evDir, 'photographer-a', 'raw'), { recursive: true });
  await fsp.writeFile(path.join(evDir, 'event.json'), evJson);
  await fsp.writeFile(path.join(evDir, 'notes.txt'), 'note');
  await fsp.writeFile(path.join(evDir, 'photographer-a', 'IMG_0001.JPG'), 'photo 1');
  await fsp.writeFile(path.join(evDir, 'photographer-a', 'raw', 'IMG_0001.RAW'), 'raw 1');
  await fsp.mkdir(path.join(archiveRoot, 'ExistingColl'), { recursive: true });

  const genRoot = path.join(transferRoot, 'GenericBatch');
  await fsp.mkdir(path.join(genRoot, 'Sub-A', 'Deeper'), { recursive: true });
  await fsp.writeFile(path.join(genRoot, 'Sub-A', 'Deeper', 'f.txt'), 'x');
  await fsp.mkdir(path.join(genRoot, 'Sub-B'), { recursive: true });
  await fsp.writeFile(path.join(genRoot, 'Sub-B', 'g.txt'), 'y');

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

  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));
  await window.evaluate(() => _alocOpen());
  await window.waitForTimeout(300);
  await window.click('#alocTransferImportBtn');
  await window.waitForTimeout(800);
  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));

  // =============================================================================
  // 1-2. Select the entire Collection (default), expand several nested levels
  // =============================================================================
  for (const name of ['ExistingColl', 'EventB', 'photographer-a', 'raw']) {
    await window.evaluate((n) => {
      const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(el => el.textContent === n);
      const node = row.closest('.tx-tree-node') || row.closest('.tx-generic-node');
      node.querySelector('.tx-tree-arrow, .tx-generic-arrow').click();
    }, name);
    await window.waitForTimeout(300);
  }
  const eventJsonVisible = await window.evaluate(() => !!Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'event.json'));
  check(eventJsonVisible, '1. "EventB" expands to reveal its event.json sidecar');

  // =============================================================================
  // 3. Verify JSON files (and everything else loaded) are checked
  // =============================================================================
  const before = await allCheckboxStates(window);
  const allCheckedBefore = before.every(c => c.disabled || c.checked);
  check(allCheckedBefore, '3. every loaded checkbox (including event.json) starts checked');
  check(before.some(c => c.name === 'event.json' && c.checked), '3b. specifically, event.json is checked before Select None');

  // =============================================================================
  // 4-5. Press Select None. Verify EVERY loaded checkbox is unchecked.
  // =============================================================================
  await window.click('#tiSelectNoneBtn');
  await window.waitForTimeout(300);
  const after = await allCheckboxStates(window);
  log('after Select None:', JSON.stringify(after));
  const stillChecked = after.filter(c => c.checked && !c.disabled);
  check(stillChecked.length === 0, `5. every loaded checkbox is unchecked after Select None (found ${stillChecked.length} still checked: ${stillChecked.map(c => c.name).join(', ')})`);
  const anyIndeterminate = after.some(c => c.indeterminate);
  check(anyIndeterminate === false, '5b. no checkbox is left indeterminate either — a full deselection is unambiguous');

  // =============================================================================
  // 6-7. Expand a previously unopened folder — newly loaded descendants must inherit unchecked
  // =============================================================================
  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'GenericBatch');
    row.closest('.tx-generic-node').querySelector('.tx-generic-arrow').click();
  });
  await window.waitForTimeout(300);
  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'Sub-A');
    row.closest('.tx-generic-node').querySelector('.tx-generic-arrow').click();
  });
  await window.waitForTimeout(300);
  const newlyLoaded = await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'Deeper');
    return row ? row.closest('.tx-tree-row').querySelector('input[type=checkbox]').checked : null;
  });
  check(newlyLoaded === false, '7. a descendant loaded for the first time AFTER Select None inherits the cleared (unchecked) state, not a stale default-checked state');

  // =============================================================================
  // 8. Preview and confirm zero selected files
  // =============================================================================
  await window.click('#tiPreviewBtn');
  await window.waitForTimeout(1000);
  const msgShown = await window.evaluate(() => {
    const importBtn = document.getElementById('tiImportBtn');
    const previewBox = document.getElementById('tiPreviewBox');
    return { importDisabled: importBtn?.disabled, previewHidden: previewBox?.hasAttribute('hidden') };
  });
  log('after Preview on empty selection:', JSON.stringify(msgShown));
  check(msgShown.importDisabled !== false || msgShown.previewHidden === true, '8. Preview on a fully-cleared selection never enables Import with zero files');

  // =============================================================================
  // 9-10. Repeat with generic folders + partial selections, then Select None again
  // =============================================================================
  await window.click('#tiSelectAllBtn');
  await window.waitForTimeout(300);
  let treeNamesAfterSelectAll = await window.evaluate(() => Array.from(document.querySelectorAll('.tx-tree-name')).map(n => n.textContent));
  log('tree names after Select All (pre-partial-dup):', JSON.stringify(treeNamesAfterSelectAll));
  if (!treeNamesAfterSelectAll.includes('Deeper')) {
    // "GenericBatch" > "Sub-A" collapsed back (or re-rendered) after the empty-selection Preview — re-expand.
    await window.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'GenericBatch');
      row.closest('.tx-generic-node').querySelector('.tx-generic-arrow').click();
    });
    await window.waitForTimeout(300);
    await window.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'Sub-A');
      row.closest('.tx-generic-node').querySelector('.tx-generic-arrow').click();
    });
    await window.waitForTimeout(300);
  }
  treeNamesAfterSelectAll = await window.evaluate(() => Array.from(document.querySelectorAll('.tx-tree-name')).map(n => n.textContent));
  if (!treeNamesAfterSelectAll.includes('f.txt')) {
    // "Deeper" itself (one level below "Sub-A") still needs expanding to reveal "f.txt".
    await window.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'Deeper');
      row.closest('.tx-generic-node').querySelector('.tx-generic-arrow').click();
    });
    await window.waitForTimeout(300);
  }
  // Make a partial selection: deselect one nested file inside GenericBatch/Sub-A/Deeper.
  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'f.txt');
    row.closest('.tx-tree-row').querySelector('input[type=checkbox]').click();
  });
  await window.waitForTimeout(200);
  const partialState = await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'GenericBatch');
    const cb = row.closest('.tx-generic-node').querySelector(':scope > .tx-tree-row input[type=checkbox]');
    return { indeterminate: cb.indeterminate };
  });
  check(partialState.indeterminate === true, '9. "GenericBatch" shows indeterminate after a partial nested deselection (setup for repeat test)');

  await window.click('#tiSelectNoneBtn');
  await window.waitForTimeout(300);
  const afterSecond = await allCheckboxStates(window);
  const stillCheckedSecond = afterSecond.filter(c => c.checked && !c.disabled);
  const stillIndeterminateSecond = afterSecond.filter(c => c.indeterminate);
  check(stillCheckedSecond.length === 0, `10. Select None clears everything again even starting from a partial/indeterminate selection (found ${stillCheckedSecond.length} still checked)`);
  check(stillIndeterminateSecond.length === 0, '10b. no indeterminate states remain either');

  log(failures === 0 ? 'ALL CHECKS PASSED (final)' : `${failures} CHECK(S) FAILED (final)`);
  await electronApp.close().catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[ti-selnone-e2e] FATAL', err);
  process.exit(1);
});
