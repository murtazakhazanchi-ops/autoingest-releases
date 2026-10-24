'use strict';

// Live end-to-end verification of "AutoIngest — Transfer Import Collection Status
// Correction": the "New Collection" indicator must reflect the SOURCE Collection's actual
// absence at the CURRENTLY SELECTED destination — re-evaluated from the real filesystem, not
// derived purely from source structure, and not merely assumed from a successful copy result.
//
// The real, reproducible defect this test captures: after a successful Transfer Import,
// renderer.js never reloaded the destination-aware scope tree. A Collection that was "New"
// before the run (and now genuinely exists on disk) kept showing "New Collection" until the
// modal was closed and reopened — _tiApplyStatus()/_tiStartPoll() applied button-phase state
// on every poll tick, but never re-fetched getTransferImportTree(). Fixed by reloading the
// destination-aware tree once polling observes the run has finished (see _tiStartPoll in
// renderer/renderer.js). The emoji-removal and failed-lookup-vs-absence fixes are covered by
// test/transferImportCollectionStatusCorrection.test.js (no Electron needed there); this file
// is reproduced live, through the actual UI, as the brief requires.
//
// Run: node test/transferImportCollectionStatusLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[ti-collstatus-e2e]', ...args); }
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
async function mkEvent(dir, seq, name, fileCount) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'event.json'), evJson(seq, name));
  for (let i = 0; i < fileCount; i++) {
    await fsp.writeFile(path.join(dir, `photo-${i}.jpg`), `bytes-${name}-${i}`);
  }
}

async function setDialogPaths(electronApp, pathsByTitle) {
  await electronApp.evaluate(async ({ dialog }, map) => {
    dialog.showOpenDialog = async (_win, opts) => {
      const p = map[opts?.title];
      return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] };
    };
  }, pathsByTitle);
}

async function launchApp() {
  const userDataDir = await mkTmp('ai-e2e-ticollstatus-userdata-');
  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));

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
  await window.click('#tiSelectNoneBtn');
  await window.waitForTimeout(200);
  await window.evaluate((name) => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === name);
    row.closest('.tx-tree-row').querySelector('input[type=checkbox]').click();
  }, folderName);
  await window.waitForTimeout(200);
}

async function newCollectionBadgeText(window, folderName) {
  return window.evaluate((name) => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === name);
    if (!row) return undefined; // name not found in the tree at all
    const badge = row.closest('.tx-tree-row')?.querySelector('.tx-tree-status[data-status="new"]');
    return badge ? badge.textContent : null; // null = row exists, no badge
  }, folderName);
}

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
  const transferRoot = await mkTmp('ai-e2e-ticollstatus-transfer-');
  const destRoot      = await mkTmp('ai-e2e-ticollstatus-dest-');

  // Source: CollA (existing at dest, plus one genuinely new Event inside it), CollB
  // (existing at dest, untouched), CollC (entirely new — brief §7's exact A/B/C matrix),
  // and a plain generic folder with no event.json anywhere inside it.
  await mkEvent(path.join(transferRoot, 'CollA', 'Ev1'),    1, 'Ev1',    2);
  await mkEvent(path.join(transferRoot, 'CollA', 'Ev2New'), 2, 'Ev2New', 2);
  await mkEvent(path.join(transferRoot, 'CollB', 'Ev1'),    1, 'Ev1',    2);
  await mkEvent(path.join(transferRoot, 'CollC', 'Ev1'),    1, 'Ev1',    3);
  await fsp.mkdir(path.join(transferRoot, 'Legacy VHS'), { recursive: true });
  await fsp.writeFile(path.join(transferRoot, 'Legacy VHS', 'tape1.mov'), 'x');

  // Destination already has CollA/Ev1 and CollB/Ev1 (matching exactly) — CollA/Ev2New and
  // CollC do not exist there yet.
  await mkEvent(path.join(destRoot, 'CollA', 'Ev1'), 1, 'Ev1', 2);
  await mkEvent(path.join(destRoot, 'CollB', 'Ev1'), 1, 'Ev1', 2);

  const { electronApp, window } = await launchApp();
  await setDialogPaths(electronApp, { 'Choose Destination Folder': null });
  await electronApp.evaluate(async ({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
  }, transferRoot);

  await window.evaluate(async (root) => { await window.api.setNasRoot(root); }, destRoot);
  await window.evaluate(async () => window.api.chooseTransferRoot());

  await openImportModal(window);

  // ── Primary matrix (brief §7 / §10.1-3): A,B existing → no badge; C new → badge ──
  check((await newCollectionBadgeText(window, 'CollA')) === null, '1. CollA (existing at destination) has no New Collection badge');
  check((await newCollectionBadgeText(window, 'CollB')) === null, '2. CollB (existing at destination) has no New Collection badge');
  const collCBadge = await newCollectionBadgeText(window, 'CollC');
  check(collCBadge === 'New Collection', '3. CollC (absent at destination) shows the New Collection badge, exactly "New Collection"');
  check(collCBadge !== null && !/[^\x00-\x7F]/.test(collCBadge), '4. the badge text contains no emoji / non-ASCII character');

  // ── §10.7/§10.8: generic folders get no Collection label; existing Collections with new
  // files inside remain importable (not re-flagged new, Scan still detects the addition) ──
  check((await newCollectionBadgeText(window, 'Legacy VHS')) === null, '5. a generic (non-Collection) folder carries no Collection badge at all');

  const scanAll = await window.evaluate(async (root) => {
    return window.api.scanImportSync({
      folderPaths: [
        `${root}/CollA`.replace('//', '/'),
      ],
    });
  }, transferRoot);
  check(scanAll.ok === true, '6a. Scan for New Data runs against an existing Collection with a new Event inside it');
  check(scanAll.totals && scanAll.totals.newFiles >= 3, '6b. Scan detects the new Event\'s files (event.json + 2 photos) as new, not as a blocked/skipped Collection');

  // ── §10.9 — THE PRIMARY DEFECT: importing C must remove its New Collection status in the
  // SAME session, without relying on the copy result alone (re-evaluated from disk) ──
  await selectOnlyFolder(window, 'CollC');
  await window.click('#tiPreviewBtn');
  await window.waitForTimeout(1000);
  await window.click('#tiImportBtn');
  const statusC = await waitForImportDone(window);
  check(statusC && statusC.result?.status === 'ok' && statusC.copied === 4, '7. Import of CollC completes successfully (event.json + 3 photos = 4 files)');
  await window.waitForTimeout(1500); // let the renderer's own status poll observe completion and refresh

  const collCBadgeAfterImport = await newCollectionBadgeText(window, 'CollC');
  check(collCBadgeAfterImport === null, '8. CollC no longer shows New Collection in the SAME session, right after import completes (not just after closing/reopening)');
  check((await newCollectionBadgeText(window, 'CollA')) === null, '9. CollA is unaffected by CollC\'s import');
  check((await newCollectionBadgeText(window, 'CollB')) === null, '10. CollB is unaffected by CollC\'s import');

  check(fs.existsSync(path.join(destRoot, 'CollC', 'Ev1', 'event.json')), '11. CollC actually landed on disk at the destination');

  // ── §6/§10.5 — changing destination re-evaluates ALL statuses against the new target ──
  const destRoot2 = await mkTmp('ai-e2e-ticollstatus-dest2-'); // empty — everything is new there
  await setDialogPaths(electronApp, { 'Choose Destination Folder': destRoot2 });
  await window.click('#tiChangeDestBtn');
  await window.waitForTimeout(800);
  check((await newCollectionBadgeText(window, 'CollA')) === 'New Collection', '12. after Change Destination, CollA is re-evaluated as New against the new (empty) destination');
  check((await newCollectionBadgeText(window, 'CollB')) === 'New Collection', '13. CollB is likewise re-evaluated as New against the new destination');
  check((await newCollectionBadgeText(window, 'CollC')) === 'New Collection', '14. CollC (just imported into the OLD destination) is correctly New again against the different destination — never a stale carryover');

  // ── §10.6 — an unreachable/unavailable destination must not falsely mark everything new ──
  const nonexistentDest = path.join(os.tmpdir(), 'ai-e2e-ticollstatus-does-not-exist-xyz');
  await setDialogPaths(electronApp, { 'Choose Destination Folder': nonexistentDest });
  await window.click('#tiChangeDestBtn');
  await window.waitForTimeout(800);
  const treeBlockedMsg = await window.evaluate(() => document.getElementById('tiScopeTree')?.textContent || '');
  check(treeBlockedMsg.includes('reachable'), '15. an unreachable destination blocks the scope tree with a clear message, instead of silently marking everything New');
  check((await newCollectionBadgeText(window, 'CollA')) === undefined, '16. with the tree blocked, CollA does not even render (not falsely shown New either)');
  const importBtnDisabledUnreachable = await window.evaluate(() => document.getElementById('tiImportBtn')?.disabled);
  check(importBtnDisabledUnreachable === true, '17. Import stays disabled while the destination is unreachable');

  // ── §10.10 — close and reopen must not restore stale labels (back to the real, reachable
  // Active Archive Root default, reflecting CollC\'s now-completed import) ──
  await window.keyboard.press('Escape');
  await window.waitForTimeout(300);
  await openImportModal(window);

  check((await newCollectionBadgeText(window, 'CollA')) === null, '18. after close/reopen, CollA correctly shows no badge against the restored default destination');
  check((await newCollectionBadgeText(window, 'CollB')) === null, '19. after close/reopen, CollB correctly shows no badge');
  check((await newCollectionBadgeText(window, 'CollC')) === null, '20. after close/reopen, CollC (imported earlier this session) still correctly shows no stale New Collection badge');

  await electronApp.close().catch(() => {});

  log(failures === 0 ? 'ALL CHECKS PASSED (final)' : `${failures} CHECK(S) FAILED (final)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[ti-collstatus-e2e] FATAL', err);
  process.exit(1);
});
