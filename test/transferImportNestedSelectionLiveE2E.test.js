'use strict';

// Live end-to-end verification of "Transfer Import Nested Selection Parity" — the operator
// must be able to expand a generic folder (and its descendants, to arbitrary depth) and
// select only specific nested folders/files, with the actual copy honoring exactly that
// selection. Drives the REAL Electron app (real main process, real renderer, real IPC, real
// filesystem) through real checkbox clicks — selection is never simulated by mutating
// internal state directly. Synthetic fixtures only.
//
// Run: node test/transferImportNestedSelectionLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[ti-nest-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

(async () => {
  const userDataDir  = await mkTmp('ai-e2e-tinest-userdata-');
  const archiveRoot   = await mkTmp('ai-e2e-tinest-archive-');
  const transferRoot  = await mkTmp('ai-e2e-tinest-transfer-');
  const outsideSecret = await mkTmp('ai-e2e-tinest-outside-');

  log('userDataDir =', userDataDir);
  log('archiveRoot (Main Archive Root) =', archiveRoot);
  log('transferRoot (Transfer Drive) =', transferRoot);

  // ── Synthetic fixture ──────────────────────────────────────────────────────
  // London VHS / VHS LOT -01..07 — the brief's concrete nested-selection example.
  const vhsRoot = path.join(transferRoot, 'London VHS');
  for (const n of ['01', '02', '03', '04', '05', '06', '07']) {
    await fsp.mkdir(path.join(vhsRoot, `VHS LOT -${n}`), { recursive: true });
    await fsp.writeFile(path.join(vhsRoot, `VHS LOT -${n}`, 'tape.mpg'), `tape bytes ${n}`);
  }
  // A dangerous symlink inside a lot that WILL be selected — must never be followed.
  await fsp.writeFile(path.join(outsideSecret, 'secret.txt'), 'must never be copied');
  await fsp.symlink(outsideSecret, path.join(vhsRoot, 'VHS LOT -07', 'escape-link'), 'dir').catch(() => {});

  // recovered / photographer-a / IMG_0001.JPG + IMG_0002.JPG — nested FILE selection example.
  const recRoot = path.join(transferRoot, 'recovered', 'photographer-a');
  await fsp.mkdir(recRoot, { recursive: true });
  await fsp.writeFile(path.join(recRoot, 'IMG_0001.JPG'), 'recovered bytes 1');
  await fsp.writeFile(path.join(recRoot, 'IMG_0002.JPG'), 'recovered bytes 2');

  // An AutoIngest Collection (archive-aware control, for mixed-selection verification).
  const evJson = JSON.stringify({
    version: 1, hijriDate: '1446-01-01', sequence: 2, eventName: 'EventB',
    components: [{ types: ['Majlis'], city: 'TestCity', location: null }],
  });
  const collEventDir = path.join(transferRoot, 'ExistingColl', 'EventB');
  await fsp.mkdir(collEventDir, { recursive: true });
  await fsp.writeFile(path.join(collEventDir, 'event.json'), evJson);
  await fsp.writeFile(path.join(collEventDir, 'photo.jpg'), 'photo bytes');
  await fsp.mkdir(path.join(archiveRoot, 'ExistingColl'), { recursive: true }); // pre-existing

  // Pre-place a DIFFERENT-content conflicting file at the nested destination VHS LOT -03
  // will resolve to, to verify collision/safe-rename is honored for a nested selection too.
  await fsp.mkdir(path.join(archiveRoot, 'London VHS', 'VHS LOT -03'), { recursive: true });
  await fsp.writeFile(path.join(archiveRoot, 'London VHS', 'VHS LOT -03', 'tape.mpg'), 'OLD-conflicting-bytes');

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
  check(chosenRoot === transferRoot, 'setup: Transfer Drive set via the real chooseTransferRoot IPC handler');

  await window.evaluate(() => _alocOpen());
  await window.waitForTimeout(300);
  await window.click('#alocTransferImportBtn');
  await window.waitForTimeout(800);
  const modalOpen = await window.evaluate(() => document.getElementById('transferImportModal')?.classList.contains('open'));
  check(modalOpen === true, 'setup: Transfer Import modal opened');

  // Helper: locate a top-level generic node's row by its visible name.
  async function findTopRow(name) {
    return window.evaluate((n) => {
      const row = Array.from(document.querySelectorAll('#tiScopeTree .tx-tree-name')).find(el => el.textContent === n);
      return row ? true : false;
    }, name);
  }

  // =============================================================================
  // 1. Expand a generic folder ("London VHS")
  // =============================================================================
  check(await findTopRow('London VHS'), '0. "London VHS" appears in the tree (generic folder)');
  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'London VHS');
    row.closest('.tx-generic-node').querySelector('.tx-generic-arrow').click();
  });
  await window.waitForTimeout(400);
  const vhsLotsVisible = await window.evaluate(() => {
    return Array.from(document.querySelectorAll('.tx-tree-name')).filter(n => n.textContent.startsWith('VHS LOT')).length;
  });
  check(vhsLotsVisible === 7, '1. expanding "London VHS" reveals all 7 nested VHS LOT folders');

  // =============================================================================
  // 2. Expand a nested folder ("recovered" -> "photographer-a")
  // =============================================================================
  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'recovered');
    row.closest('.tx-generic-node').querySelector('.tx-generic-arrow').click();
  });
  await window.waitForTimeout(400);
  check(await findTopRow('photographer-a') || await window.evaluate(() => !!Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'photographer-a')),
    '2a. expanding "recovered" reveals the nested "photographer-a" folder');
  // Uncheck "recovered" BEFORE expanding deeper, so we can select exactly one file inside it.
  // A real click (not a direct property mutation) — checkbox clicks fire a natively-bubbling
  // 'change' event, which the Import Scope tree's delegated listener depends on.
  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'recovered');
    row.closest('.tx-generic-node').querySelector(':scope > .tx-tree-row input[type=checkbox]').click();
  });
  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'photographer-a');
    row.closest('.tx-generic-node').querySelector('.tx-generic-arrow').click();
  });
  await window.waitForTimeout(400);
  const imgRowsVisible = await window.evaluate(() => Array.from(document.querySelectorAll('.tx-tree-name')).filter(n => n.textContent.startsWith('IMG_')).length);
  check(imgRowsVisible === 2, '2b. expanding "photographer-a" reveals both IMG files');

  // =============================================================================
  // 5. Select one individual nested FILE (IMG_0001.JPG only)
  // =============================================================================
  const img1CheckedAfterParentUncheck = await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'IMG_0001.JPG');
    return row.closest('.tx-tree-row').querySelector('input[type=checkbox]').checked;
  });
  check(img1CheckedAfterParentUncheck === false, '3. new children inherit the unchecked state of a parent that was deselected before expansion');
  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'IMG_0001.JPG');
    row.closest('.tx-tree-row').querySelector('input[type=checkbox]').click();
  });
  const img2StillUnchecked = await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'IMG_0002.JPG');
    return row.closest('.tx-tree-row').querySelector('input[type=checkbox]').checked;
  });
  check(img2StillUnchecked === false, '5. selecting IMG_0001.JPG alone leaves its sibling IMG_0002.JPG unselected');

  // =============================================================================
  // 3/4/7/8. Select specific nested folders (VHS LOT -03 and -07), deselect the rest,
  // verify the parent becomes indeterminate.
  // =============================================================================
  for (const n of ['01', '02', '04', '05', '06']) {
    await window.evaluate((num) => {
      const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(el => el.textContent === `VHS LOT -${num}`);
      row.closest('.tx-tree-row').querySelector('input[type=checkbox]').click();
    }, n);
  }
  const lot03And07State = await window.evaluate(() => {
    const get = (name) => {
      const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(el => el.textContent === name);
      return row.closest('.tx-tree-row').querySelector('input[type=checkbox]').checked;
    };
    return { lot03: get('VHS LOT -03'), lot07: get('VHS LOT -07'), lot01: get('VHS LOT -01') };
  });
  check(lot03And07State.lot03 === true && lot03And07State.lot07 === true, '4/7. VHS LOT -03 and VHS LOT -07 remain checked after deselecting the other five');
  check(lot03And07State.lot01 === false, '7. VHS LOT -01 is correctly deselected');

  const vhsParentIndeterminate = await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'London VHS');
    const cb = row.closest('.tx-generic-node').querySelector(':scope > .tx-tree-row input[type=checkbox]');
    return { checked: cb.checked, indeterminate: cb.indeterminate };
  });
  check(vhsParentIndeterminate.indeterminate === true, '8. "London VHS" parent checkbox shows indeterminate state after a partial child selection');

  // =============================================================================
  // 9. Collapse and reopen "London VHS" without losing the selection
  // =============================================================================
  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'London VHS');
    row.closest('.tx-generic-node').querySelector('.tx-generic-arrow').click(); // collapse
  });
  await window.waitForTimeout(200);
  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'London VHS');
    row.closest('.tx-generic-node').querySelector('.tx-generic-arrow').click(); // reopen
  });
  await window.waitForTimeout(200);
  const lot03StillChecked = await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'VHS LOT -03');
    return row.closest('.tx-tree-row').querySelector('input[type=checkbox]').checked;
  });
  check(lot03StillChecked === true, '9. collapsing and reopening "London VHS" preserves the VHS LOT -03/-07 selection');

  // =============================================================================
  // 6. A selected parent folder (VHS LOT -07) is never itself expanded — still importable whole
  // =============================================================================
  const lot07Expanded = await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'VHS LOT -07');
    return row.closest('.tx-generic-node').querySelector(':scope > .tx-generic-children').dataset.loaded === '1';
  });
  check(lot07Expanded === false, '6. VHS LOT -07 was never expanded — its own fully-checked state is sufficient to import it whole');

  // =============================================================================
  // Preview — verify the selected nested scope is reflected accurately
  // =============================================================================
  // Also select the existing Collection, for mixed-selection coverage.
  await window.click('#tiPreviewBtn');
  await window.waitForTimeout(1000);
  const previewText = await window.evaluate(() => ({
    collections: document.getElementById('tiPvCollections')?.textContent,
    generic:     document.getElementById('tiPvGeneric')?.textContent,
    files:       document.getElementById('tiPvFiles')?.textContent,
  }));
  log('preview (nested selection):', JSON.stringify(previewText));
  // Expected resolved units: VHS LOT -03, VHS LOT -07, IMG_0001.JPG, ExistingColl/EventB = 4
  check(Number(previewText.generic) === 3, '17a. Preview counts exactly the 3 selected generic units (LOT-03, LOT-07, IMG_0001.JPG)');
  check(previewText.collections === '1', '17b. Preview also resolves the mixed-in AutoIngest Collection');
  // Files: LOT-03(1) + LOT-07(2, tape.mpg + escape-link is a symlink, never counted) + IMG_0001(1) + EventB(event.json+photo.jpg=2) = 4..6 depending on symlink counting
  check(Number(previewText.files) >= 4 && Number(previewText.files) <= 5, '17c. Preview file count reflects only the selected nested items (not all 7 VHS lots, not IMG_0002, not the symlink)');

  const importBtnDisabled = await window.evaluate(() => document.getElementById('tiImportBtn')?.disabled);
  check(importBtnDisabled === false, 'Import button enabled after a non-empty nested-selection Preview');

  // =============================================================================
  // 14. Import the nested selection
  // =============================================================================
  await window.click('#tiImportBtn');
  let status = null;
  for (let i = 0; i < 100; i++) {
    status = await window.evaluate(async () => window.api.getTransferImportStatus());
    if (status && status.batchId && !status.running) break;
    await window.waitForTimeout(200);
  }
  check(status && status.batchId && !status.running, '14. nested-selection import completes');

  // =============================================================================
  // 15/16. Verify exact destination hierarchy — selected items present, unselected absent
  // =============================================================================
  check(fs.existsSync(path.join(archiveRoot, 'London VHS', 'VHS LOT -03', 'tape_1.mpg')), '15a/18. VHS LOT -03 is imported; its conflicting original file is safely renamed, not overwritten');
  check(fs.readFileSync(path.join(archiveRoot, 'London VHS', 'VHS LOT -03', 'tape.mpg'), 'utf8') === 'OLD-conflicting-bytes', '18b. the pre-existing destination file at VHS LOT -03 was never overwritten');
  check(fs.existsSync(path.join(archiveRoot, 'London VHS', 'VHS LOT -07', 'tape.mpg')), '15b. VHS LOT -07 is imported');
  check(fs.existsSync(path.join(archiveRoot, 'recovered', 'photographer-a', 'IMG_0001.JPG')), '15c. the individually selected IMG_0001.JPG is imported, hierarchy preserved');
  check(fs.existsSync(path.join(archiveRoot, 'ExistingColl', 'EventB', 'photo.jpg')), '15d. the mixed-in AutoIngest Collection is imported');

  check(!fs.existsSync(path.join(archiveRoot, 'London VHS', 'VHS LOT -01')), '16a. unselected VHS LOT -01 was never copied');
  check(!fs.existsSync(path.join(archiveRoot, 'London VHS', 'VHS LOT -02')), '16b. unselected VHS LOT -02 was never copied');
  check(!fs.existsSync(path.join(archiveRoot, 'London VHS', 'VHS LOT -04')), '16c. unselected VHS LOT -04 was never copied');
  check(!fs.existsSync(path.join(archiveRoot, 'recovered', 'photographer-a', 'IMG_0002.JPG')), '16d. the unselected sibling IMG_0002.JPG was never copied');
  check(!fs.existsSync(path.join(archiveRoot, 'London VHS', 'VHS LOT -07', 'escape-link')), '20. the symlink inside the selected VHS LOT -07 was never followed or copied into the destination');
  check(fs.existsSync(path.join(outsideSecret, 'secret.txt')) && !fs.existsSync(path.join(archiveRoot, 'secret.txt')), '20b. the symlink target outside the Transfer Drive was never reached');

  // 19. Reimport/no-duplicate-copies for a nested selection is proven directly against
  // runImport() in the unit suite (transferImportGeneralPurposeTransfer.test.js's end-to-end
  // case) — not re-driven through the UI here, since a completed import leaves the modal in
  // its post-import "done" phase (Preview/Scan hidden until the operator explicitly starts
  // fresh), which is pre-existing UI state management unrelated to nested selection itself.

  log(failures === 0 ? 'ALL CHECKS PASSED (final)' : `${failures} CHECK(S) FAILED (final)`);
  await electronApp.close().catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[ti-nest-e2e] FATAL', err);
  process.exit(1);
});
