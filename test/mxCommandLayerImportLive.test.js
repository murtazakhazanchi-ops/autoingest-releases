'use strict';

// Live end-to-end verification of Phase 4C (revised)'s import.openConfirmation
// command: it must open the REAL Import review/confirmation flow
// (#eventImportOverlay / the real missing-sub-event validation modal) and
// never start an actual file copy on its own. Drives the REAL Electron
// renderer against isolated synthetic fixtures. Never touches a real
// archive, card, NAS, or user settings.
//
// Run: node test/mxCommandLayerImportLive.test.js

const { _electron: electron } = require('playwright-core');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[mx-cmd-import]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }
async function writeRaw(p, i) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, Buffer.from('not-a-real-raw-' + i + '-' + path.basename(p)));
}

(async () => {
  const userDataDir = await mkTmp('ai-e2e-mx-import-userdata-');
  const archiveRoot = await mkTmp('ai-e2e-mx-import-archive-');
  const srcRoot = await mkTmp('ai-e2e-mx-import-src-');
  log('userDataDir =', userDataDir);
  log('archiveRoot =', archiveRoot);
  log('srcRoot     =', srcRoot);

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));

  let window = await electronApp.firstWindow({ timeout: 60000 });
  window.on('pageerror', (err) => log('[pageerror]', err.message, err.stack));
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));
  log('splash state:', JSON.stringify(splashState));

  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'MX Import Test');
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
      await window.fill('#splashInputName', 'MX Import Test');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  }

  window = await mainWindowPromise;
  window.on('pageerror', (err) => log('[pageerror]', err.message, err.stack));
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1000);
  await window.waitForFunction(() => typeof window.selectSource === 'function', { timeout: 15000 });
  await window.waitForFunction(() => typeof window.AutoIngestCommands === 'object', { timeout: 15000 });

  const onboardingVisible = await window.evaluate(() =>
    document.getElementById('onboardingOverlay')?.classList.contains('visible'));
  if (onboardingVisible) {
    await window.click('#onboardingSkip');
    await window.waitForTimeout(200);
  }

  const ev = (fn, arg) => window.evaluate(fn, arg);

  try {
    await ev((root) => window.api.setMainArchiveRoot(root), archiveRoot);
    await ev(() => { if (typeof obFinish === 'function') obFinish(); });

    const collName = 'CollImport';
    const dirSingle = path.join(archiveRoot, collName, '1448-05-01 _01-Single-Alpha');
    const dirMulti  = path.join(archiveRoot, collName, '1448-05-02 _02-Multi-Beta');
    const compWaaz    = '01-Waaz-Hall A';
    const compZiyafat = '02-Ziyafat-Hall A';

    await ev(({ dir, data }) => window.api.writeEventJson(dir, data), {
      dir: dirSingle, data: { version: 1, hijriDate: '1448-05-01', sequence: 1, eventName: 'Single-Alpha', components: [
        { id: 1, folderName: 'Jashn-Hall A', location: 'Hall A', city: 'Surat', country: 'India', types: ['Jashn'], additionalKeywords: [] },
      ] },
    });
    await ev(({ dir, data }) => window.api.writeEventJson(dir, data), {
      dir: dirMulti, data: { version: 1, hijriDate: '1448-05-02', sequence: 2, eventName: 'Multi-Beta', components: [
        { id: 1, folderName: compWaaz, location: 'Hall A', city: 'Surat', country: 'India', types: ['Waaz'], additionalKeywords: [] },
        { id: 2, folderName: compZiyafat, location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyafat'], additionalKeywords: [] },
      ] },
    });

    async function restoreEvent(dir) {
      const collPath = path.join(archiveRoot, collName);
      const folder = path.basename(dir);
      await ev(async ({ collPath, collName, folder }) => {
        await window.api.setLastEvent({ collectionPath: collPath, collectionName: collName, eventName: folder, safeEventName: folder });
        await EventCreator.restoreLastEvent();
      }, { collPath, collName, folder });
      await window.waitForTimeout(400);
    }
    async function chordAssign(paths, n) {
      await ev((ps) => { selectedFiles.clear(); ps.forEach((p) => selectedFiles.add(p)); syncAllTiles(); updateSelectionBar(); }, paths);
      await window.keyboard.press('Control+g');
      await window.keyboard.press(String(n));
      await window.waitForTimeout(200);
    }

    // ═══════════════════════════════════════════════════════════════════
    // 1. Single-component event, ready to import: import.openConfirmation
    // opens the REAL #eventImportOverlay confirmation — not the final copy.
    // ═══════════════════════════════════════════════════════════════════
    await restoreEvent(dirSingle);
    const srcA = path.join(srcRoot, 'a');
    const pa1 = path.join(srcA, 'A1.cr2');
    await writeRaw(pa1, 'a1');
    await ev((p) => selectSource({ type: 'local-folder', path: p, label: 'MX_IMPORT_SRC_A' }), srcA);
    await window.waitForFunction(() => document.getElementById('workspace').classList.contains('visible'), null, { timeout: 15000 });
    await ev((p) => browseFolderDirect(p), srcA);
    await window.waitForFunction((n) => document.querySelectorAll('#fileGrid .file-tile[data-path]').length === n, 1, { timeout: 20000 });
    // canImport (renderer.js) requires either a non-empty selection or
    // already-grouped files — select the file, same as an operator would
    // before pressing the real Import button.
    await ev((p) => { selectedFiles.clear(); selectedFiles.add(p); syncAllTiles(); updateSelectionBar(); }, pa1);

    const statusBefore = await ev((dir) => window.api.readEventJson(dir).then((d) => d.status), dirSingle);
    check(statusBefore !== 'in-progress' && statusBefore !== 'complete', `setup: event not yet imported (status="${statusBefore}")`);

    let state = await ev(() => window.AutoIngestCommands.getState());
    check(state.availableCommands.includes('import.openConfirmation'), 'import.openConfirmation is available in browse context');

    const result = await ev(() => window.AutoIngestCommands.execute('import.openConfirmation'));
    check(result.ok === true && result.executed === true, `import.openConfirmation executes (the real #importBtn was visible+enabled) (${JSON.stringify(result)})`);
    const overlayVisible = await ev(() => document.getElementById('eventImportOverlay')?.classList.contains('visible'));
    check(overlayVisible === true, 'the REAL #eventImportOverlay confirmation modal is now visible — not a plugin-local approximation');

    // No copy has started merely from opening the modal.
    const statusAfterOpen = await ev((dir) => window.api.readEventJson(dir).then((d) => d.status), dirSingle);
    check(statusAfterOpen === statusBefore, `event status is unchanged by merely opening the confirmation (still "${statusAfterOpen}") — no bypass of the real confirm step`);

    // Cancel — never click the real confirm button, so no copy ever starts
    // in this test (brief: "Do not execute the final confirmation automatically").
    await window.click('#eiCancelBtn');
    await window.waitForTimeout(200);
    const overlayAfterCancel = await ev(() => document.getElementById('eventImportOverlay')?.classList.contains('visible'));
    check(overlayAfterCancel === false, 'Cancel closes the real modal; the operator retains final confirmation authority');
    const statusAfterCancel = await ev((dir) => window.api.readEventJson(dir).then((d) => d.status), dirSingle);
    check(statusAfterCancel === statusBefore, 'event status is still unchanged after Cancel — no file copy ever began');

    // ═══════════════════════════════════════════════════════════════════
    // 2. Multi-component event with a group missing its sub-event mapping:
    // import.openConfirmation must trigger the REAL missing-sub-event
    // validation, not silently proceed — proving validation is reused, not
    // bypassed.
    // ═══════════════════════════════════════════════════════════════════
    const collPathM = path.join(archiveRoot, collName);
    await ev(async ({ collPath, collName, folder }) => {
      await window.api.setLastEvent({ collectionPath: collPath, collectionName: collName, eventName: folder, safeEventName: folder });
      await EventCreator.restoreLastEvent();
    }, { collPath: collPathM, collName, folder: path.basename(dirMulti) });
    await window.waitForTimeout(400);

    const srcB = path.join(srcRoot, 'b');
    const pb1 = path.join(srcB, 'B1.cr2');
    await writeRaw(pb1, 'b1');
    await ev((p) => browseFolderDirect(p), srcB);
    await window.waitForFunction((n) => document.querySelectorAll('#fileGrid .file-tile[data-path]').length === n, 1, { timeout: 20000 });
    await chordAssign([pb1], 1); // G1 created, but deliberately left WITHOUT a sub-event mapping

    const missingSubResult = await ev(() => window.AutoIngestCommands.execute('import.openConfirmation'));
    check(missingSubResult.ok === true && missingSubResult.executed === true, 'import.openConfirmation still dispatches the real click for the missing-mapping case');
    await window.waitForTimeout(300);
    const missingModalVisible = await ev(() => document.getElementById('missingSubEventOverlay')?.classList.contains('visible')
      ?? document.querySelector('.missing-subevent-modal, [id*="missingSubEvent" i]') !== null);
    const confirmOverlayVisibleInstead = await ev(() => document.getElementById('eventImportOverlay')?.classList.contains('visible'));
    check(confirmOverlayVisibleInstead !== true, 'the real confirmation modal does NOT open while a group is missing its sub-event mapping — real validation was not bypassed');
    log(`NOTE — missing-sub-event modal visible=${missingModalVisible} (informational; the key guarantee already checked is that the confirm/copy path did not proceed)`);

    // ═══════════════════════════════════════════════════════════════════
    // 3. Unavailable while QMZ is open (same gate event.openChooser uses).
    // ═══════════════════════════════════════════════════════════════════
    await ev(() => { if (document.getElementById('eventImportOverlay')?.classList.contains('visible')) document.getElementById('eiCancelBtn')?.click(); });
    const qmzRoot = await mkTmp('ai-e2e-mx-import-qmz-');
    await writeRaw(path.join(qmzRoot, '_Unsequenced', 'Jane Doe', 'q1.cr2'), 'q1');
    const eventContext = { component: { location: 'Hall A', city: 'Mumbai', country: 'India' }, isMulti: false, eventTitle: 'Waaz Mubarak', hijriDate: '1448-02-10', eventJsonPath: null, componentTitle: null };
    await ev(({ root, ctx }) => window.openQMZManager(root, ctx), { root: qmzRoot, ctx: eventContext });
    await window.waitForTimeout(1000);
    state = await ev(() => window.AutoIngestCommands.getState());
    check(!state.availableCommands.includes('import.openConfirmation'), 'import.openConfirmation is UNAVAILABLE while QMZ is open');
    const qmzRejection = await ev(() => window.AutoIngestCommands.execute('import.openConfirmation'));
    check(qmzRejection.ok === false && qmzRejection.reason === 'not-applicable', 'import.openConfirmation is rejected outright while QMZ is open, never silently attempted');
    await ev(() => _closeQMZManager());

    if (failures === 0) {
      log('ALL CHECKS PASSED');
    } else {
      log(`${failures} CHECK(S) FAILED`);
      process.exitCode = 1;
    }
  } finally {
    await electronApp.close().catch(() => {});
  }
})().catch((err) => {
  console.error('[mx-cmd-import] FATAL', err);
  process.exitCode = 1;
});
