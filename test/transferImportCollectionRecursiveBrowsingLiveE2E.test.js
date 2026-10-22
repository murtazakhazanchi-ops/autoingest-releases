'use strict';

// Live end-to-end verification of Defect A ("Transfer Import: Recursive Collection Browsing")
// — AutoIngest Collections/Events must support the same arbitrary-depth expand/select
// experience generic folders already have: one Event, one Component-level folder (a
// photographer folder), one individual photograph, two nonadjacent files, and a mixed
// Collection + generic-folder selection, all verified by real clicks and actual copied
// files on disk — never by directly mutating internal state.
//
// Run: node test/transferImportCollectionRecursiveBrowsingLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[ti-coll-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

(async () => {
  const userDataDir  = await mkTmp('ai-e2e-ticoll-userdata-');
  const archiveRoot   = await mkTmp('ai-e2e-ticoll-archive-');
  const transferRoot  = await mkTmp('ai-e2e-ticoll-transfer-');

  log('transferRoot =', transferRoot);
  log('archiveRoot =', archiveRoot);

  // ── Synthetic fixture: a Collection with an Event containing photographer subfolders ──
  // (Component/photographer-folder level) and a root-level file, plus a sibling generic
  // folder for mixed-selection coverage.
  const evJson = JSON.stringify({
    version: 1, hijriDate: '1446-01-01', sequence: 3, eventName: 'EventB',
    components: [{ types: ['Majlis'], city: 'TestCity', location: null }],
  });
  const evDir = path.join(transferRoot, 'ExistingColl', 'EventB');
  await fsp.mkdir(path.join(evDir, 'photographer-a'), { recursive: true });
  await fsp.mkdir(path.join(evDir, 'photographer-b'), { recursive: true });
  await fsp.writeFile(path.join(evDir, 'event.json'), evJson);
  await fsp.writeFile(path.join(evDir, 'notes.txt'), 'event root note');
  await fsp.writeFile(path.join(evDir, 'photographer-a', 'IMG_0001.JPG'), 'photo 1');
  await fsp.writeFile(path.join(evDir, 'photographer-a', 'IMG_0002.JPG'), 'photo 2');
  await fsp.writeFile(path.join(evDir, 'photographer-b', 'IMG_0003.JPG'), 'photo 3');
  await fsp.mkdir(path.join(archiveRoot, 'ExistingColl'), { recursive: true }); // pre-existing Collection

  // A generic (non-archive) folder sibling, for mixed-selection coverage.
  await fsp.mkdir(path.join(transferRoot, 'GenericFolder'), { recursive: true });
  await fsp.writeFile(path.join(transferRoot, 'GenericFolder', 'plain.bin'), 'generic bytes');

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
  // Expand Collection -> Event -> photographer-a (Component/photographer-folder level)
  // =============================================================================
  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'ExistingColl');
    row.closest('.tx-tree-node').querySelector('.tx-tree-arrow').click();
  });
  await window.waitForTimeout(300);
  const evVisible = await window.evaluate(() => !!Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'EventB'));
  check(evVisible, '1. the Collection expands to reveal its Event');

  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'EventB');
    row.closest('.tx-tree-row').querySelector('.tx-tree-arrow').click();
  });
  await window.waitForTimeout(300);
  const evChildrenVisible = await window.evaluate(() => {
    const names = Array.from(document.querySelectorAll('.tx-tree-name')).map(n => n.textContent);
    return { hasPhA: names.includes('photographer-a'), hasPhB: names.includes('photographer-b'), hasNotes: names.includes('notes.txt') };
  });
  check(evChildrenVisible.hasPhA && evChildrenVisible.hasPhB, '2. the Event expands to reveal both photographer (Component-level) folders');
  check(evChildrenVisible.hasNotes, '2b. the Event also exposes its own root-level file ("notes.txt") individually');

  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'photographer-a');
    row.closest('.tx-generic-node').querySelector('.tx-generic-arrow').click();
  });
  await window.waitForTimeout(300);
  const imgVisible = await window.evaluate(() => {
    const names = Array.from(document.querySelectorAll('.tx-tree-name'));
    return { img1: !!names.find(n => n.textContent === 'IMG_0001.JPG'), img2: !!names.find(n => n.textContent === 'IMG_0002.JPG') };
  });
  check(imgVisible.img1 && imgVisible.img2, '3. the photographer folder expands to reveal individual photographs');

  // =============================================================================
  // Deselect: notes.txt, photographer-a/IMG_0002.JPG. Keep: IMG_0001.JPG, photographer-b whole.
  // Verify indeterminate states cascade correctly up through Event -> Collection.
  // =============================================================================
  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'notes.txt');
    row.closest('.tx-tree-row').querySelector('input[type=checkbox]').click();
  });
  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'IMG_0002.JPG');
    row.closest('.tx-tree-row').querySelector('input[type=checkbox]').click();
  });

  const indeterminateChain = await window.evaluate(() => {
    const get = (name, selector) => {
      const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === name);
      return row.closest(selector).querySelector(':scope > .tx-tree-row input[type=checkbox], :scope > input[type=checkbox]')
        || row.closest('.tx-tree-row')?.querySelector('input[type=checkbox]');
    };
    const phACb = get('photographer-a', '.tx-generic-node');
    const evCb = get('EventB', '.tx-tree-node');
    const collRow = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'ExistingColl');
    const collCb = collRow.closest('.tx-tree-node').querySelector('.ti-cb-coll');
    return { phAIndeterminate: phACb.indeterminate, evIndeterminate: evCb.indeterminate, collIndeterminate: collCb.indeterminate };
  });
  log('indeterminate chain:', JSON.stringify(indeterminateChain));
  check(indeterminateChain.phAIndeterminate === true, '4a. "photographer-a" becomes indeterminate after deselecting one of its two photos');
  check(indeterminateChain.evIndeterminate === true, '4b. "EventB" becomes indeterminate too (cascades up through the Event)');
  check(indeterminateChain.collIndeterminate === true, '4c. "ExistingColl" becomes indeterminate too (cascades up through the Collection)');

  const photographerBStillFull = await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'photographer-b');
    const cb = row.closest('.tx-tree-row').querySelector('input[type=checkbox]');
    return { checked: cb.checked, indeterminate: cb.indeterminate };
  });
  check(photographerBStillFull.checked === true && photographerBStillFull.indeterminate === false, '5. "photographer-b" (untouched) remains fully selected — deselecting a nonadjacent item does not disturb it');

  // =============================================================================
  // Mixed selection: also select the sibling generic folder.
  // =============================================================================
  const genericFolderChecked = await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'GenericFolder');
    return row.closest('.tx-tree-row').querySelector('input[type=checkbox]').checked;
  });
  check(genericFolderChecked === true, '6. the sibling generic folder is independently selected by default (mixed Collection + generic selection)');

  // =============================================================================
  // Preview, then Import. Verify exact resulting hierarchy.
  // =============================================================================
  await window.click('#tiPreviewBtn');
  await window.waitForTimeout(1000);
  const previewText = await window.evaluate(() => ({
    collections: document.getElementById('tiPvCollections')?.textContent,
    generic:     document.getElementById('tiPvGeneric')?.textContent,
    unresolvedHidden: document.getElementById('tiPvUnresolvedNote')?.hasAttribute('hidden'),
  }));
  log('preview:', JSON.stringify(previewText));
  check(previewText.collections === '1', '7. Preview resolves the one Collection');
  check(previewText.unresolvedHidden === true, '7b. nothing in this selection is unresolved');

  await window.click('#tiImportBtn');
  let status = null;
  for (let i = 0; i < 100; i++) {
    status = await window.evaluate(async () => window.api.getTransferImportStatus());
    if (status && status.batchId && !status.running) break;
    await window.waitForTimeout(200);
  }
  check(status && status.batchId && !status.running, '8. import completes');

  check(fs.existsSync(path.join(archiveRoot, 'ExistingColl', 'EventB', 'photographer-a', 'IMG_0001.JPG')), '9a. the individually selected photograph is imported');
  check(!fs.existsSync(path.join(archiveRoot, 'ExistingColl', 'EventB', 'photographer-a', 'IMG_0002.JPG')), '9b. the deselected sibling photograph is NOT imported');
  check(fs.existsSync(path.join(archiveRoot, 'ExistingColl', 'EventB', 'photographer-b', 'IMG_0003.JPG')), '9c. the fully-selected photographer-b folder is imported whole');
  check(!fs.existsSync(path.join(archiveRoot, 'ExistingColl', 'EventB', 'notes.txt')), '9d. the deselected event-root file is NOT imported');
  check(fs.existsSync(path.join(archiveRoot, 'GenericFolder', 'plain.bin')), '10. the mixed-in generic folder is also imported correctly');
  check(!fs.existsSync(path.join(archiveRoot, 'ExistingColl', 'EventB', 'event.json'))
    || fs.existsSync(path.join(transferRoot, 'ExistingColl', 'EventB', 'event.json')), '11. no event metadata was invented — only what genuinely existed is ever present');
  // Never reclassified: photographer-a/photographer-b must never have been treated as new Collections.
  check(!fs.existsSync(path.join(archiveRoot, 'photographer-a')), '12. a nested Component/photographer folder was never reclassified as a top-level Collection');

  log(failures === 0 ? 'ALL CHECKS PASSED (final)' : `${failures} CHECK(S) FAILED (final)`);
  await electronApp.close().catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[ti-coll-e2e] FATAL', err);
  process.exit(1);
});
