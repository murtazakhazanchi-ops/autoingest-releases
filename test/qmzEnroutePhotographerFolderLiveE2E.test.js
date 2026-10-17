'use strict';
// Follow-up live E2E verification for Stage 4's Enroute: drives the REAL "→ Enroute" / "↩
// Unsequenced" / "Assign Selected" controls in the real QMZ Sequence Manager UI (not the
// service functions directly — test/qmzEnroutePhotographerFolderRegression.test.js already
// covers those) to confirm photographer-folder preservation holds through the actual operator
// workflow: multiple photographers moved into Enroute, an existing Enroute photographer
// folder reused, and reverse movement back to _Unsequenced.
//
// Requires playwright-core (see test/metadataPipelineLive.test.js for install notes).
// Run: node test/qmzEnroutePhotographerFolderLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function log(...args) { console.log('[qmz-enroute-pg-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }
async function writeFile(p, content = 'synthetic') {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content);
}

(async () => {
  const userDataDir = await mkTmp('ai-qmz-enroute-pg-e2e-userdata-');
  const qmzRoot      = await mkTmp('ai-qmz-enroute-pg-e2e-root-');
  log('qmzRoot =', qmzRoot);

  // Synthetic fixture: two photographers, each with photographs already in _Unsequenced.
  await writeFile(path.join(qmzRoot, '_Unsequenced', 'Abbas Bhai', 'DSC001.jpg'), 'a1');
  await writeFile(path.join(qmzRoot, '_Unsequenced', 'Abbas Bhai', 'DSC002.jpg'), 'a2');
  await writeFile(path.join(qmzRoot, '_Unsequenced', 'Abbas Bhai', 'DSC003.jpg'), 'a3');
  await writeFile(path.join(qmzRoot, '_Unsequenced', 'Husain Bhai', 'DSC004.jpg'), 'h4');
  await writeFile(path.join(qmzRoot, '_Unsequenced', 'Husain Bhai', 'DSC005.jpg'), 'h5');
  // Pre-existing Enroute/Abbas Bhai folder with its own content, to exercise Scenario C.
  await writeFile(path.join(qmzRoot, 'Enroute', 'Abbas Bhai', 'already-here.jpg'), 'pre-existing');

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));
  electronApp.on('close', () => log('electronApp CLOSED unexpectedly'));

  let window = await electronApp.firstWindow({ timeout: 60000 });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));

  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'Enroute Photographer Folder Test');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'Enroute Photographer Folder Test');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  }
  window = await mainWindowPromise;
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);
  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));

  async function domClick(selector) {
    return window.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    }, selector);
  }
  async function selectAllFilesInGrid() {
    await window.evaluate(() => {
      document.querySelectorAll('#qmzFileGrid input[type="checkbox"][data-path]').forEach(cb => {
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  }
  async function listFileNames(dir) {
    try { return (await fsp.readdir(dir, { withFileTypes: true })).filter(e => e.isFile()).map(e => e.name).sort(); }
    catch { return []; }
  }
  async function listDirNames(dir) {
    try { return (await fsp.readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort(); }
    catch { return []; }
  }

  const eventContext = {
    component: { location: 'Hall A', city: 'Mumbai', country: 'India' },
    isMulti: false, eventTitle: 'Waaz Mubarak', hijriDate: '1448-02-10',
    eventJsonPath: null, componentTitle: null,
  };
  await window.evaluate(({ root, ctx }) => window.openQMZManager(root, ctx), { root: qmzRoot, ctx: eventContext });
  await window.waitForTimeout(800);
  check(await window.evaluate(() => !document.getElementById('qmzOverlay')?.classList.contains('hidden')), 'QMZ Sequence Manager overlay opens with the synthetic fixture');

  // ═══════════════ Scenario A — single photographer, two of three files ═══════════════
  log('=== Scenario A: Abbas Bhai — move 2 of 3 files to Enroute ===');
  await domClick('.qmz-pg-row[data-pg="Abbas Bhai"]');
  await window.waitForTimeout(400);
  const tileCount = await window.evaluate(() => document.querySelectorAll('#qmzFileGrid input[type="checkbox"][data-path]').length);
  check(tileCount === 3, 'Abbas Bhai\'s 3 unsequenced files render as selectable tiles');
  // Select DSC001/DSC002 explicitly by name — the grid's default sort (date desc) does not
  // guarantee write order, so positional slicing is not reliable here.
  await window.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll('#qmzFileGrid input[type="checkbox"][data-path]'))
      .filter(cb => /DSC001\.jpg$|DSC002\.jpg$/.test(cb.dataset.path));
    boxes.forEach(cb => { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); });
  });
  await window.waitForTimeout(300);
  await domClick('#qmzMoveEnrouteBtn');
  await window.waitForTimeout(700);

  const enrouteAbbasFiles = await listFileNames(path.join(qmzRoot, 'Enroute', 'Abbas Bhai'));
  check(enrouteAbbasFiles.includes('DSC001.jpg') && enrouteAbbasFiles.includes('DSC002.jpg'), 'A: the two selected files land in Enroute/Abbas Bhai/');
  check(enrouteAbbasFiles.includes('already-here.jpg'), 'C: the pre-existing Enroute/Abbas Bhai folder was REUSED, not duplicated/replaced');
  const abbasDirsUnderEnroute = await listDirNames(path.join(qmzRoot, 'Enroute'));
  check(abbasDirsUnderEnroute.filter(d => d === 'Abbas Bhai').length === 1, 'C: exactly one "Abbas Bhai" folder exists under Enroute — no "_1"/"(1)" duplicate');
  check(fs.existsSync(path.join(qmzRoot, '_Unsequenced', 'Abbas Bhai', 'DSC003.jpg')), 'A: the third, un-selected file remains in _Unsequenced/Abbas Bhai/');
  const enrouteRootFiles = await listFileNames(qmzRoot + '/Enroute');
  check(enrouteRootFiles.length === 0, 'E: no file sits directly inside Enroute/ itself after this real-UI move');

  // ═══════════════ Scenario B — second photographer, via the real UI ═══════════════
  log('=== Scenario B: Husain Bhai — move both files to Enroute ===');
  await domClick('.qmz-pg-row[data-pg="Husain Bhai"]');
  await window.waitForTimeout(400);
  await selectAllFilesInGrid();
  await window.waitForTimeout(300);
  await domClick('#qmzMoveEnrouteBtn');
  await window.waitForTimeout(700);

  const enrouteHusainFiles = await listFileNames(path.join(qmzRoot, 'Enroute', 'Husain Bhai'));
  check(enrouteHusainFiles.includes('DSC004.jpg') && enrouteHusainFiles.includes('DSC005.jpg'), 'B: Husain Bhai\'s files land in their OWN Enroute/Husain Bhai/ folder');
  const abbasFilesStillCorrect = await listFileNames(path.join(qmzRoot, 'Enroute', 'Abbas Bhai'));
  check(!abbasFilesStillCorrect.includes('DSC004.jpg') && !abbasFilesStillCorrect.includes('DSC005.jpg'), 'B: Husain Bhai\'s files were NOT mixed into Abbas Bhai\'s Enroute folder');
  check((await listDirNames(path.join(qmzRoot, 'Enroute'))).length === 2, 'B/C: Enroute now has exactly two photographer subfolders, never a shared/unnamed one');

  // ═══════════════ Scenario D — reverse movement, Enroute -> _Unsequenced ═══════════════
  log('=== Scenario D: reverse movement from Enroute back to _Unsequenced ===');
  await domClick('.qmz-pg-row[data-pg="Husain Bhai"]'); // Husain Bhai now lives under Enroute — row still resolves there
  await window.waitForTimeout(400);
  // _qmzActiveLocation is a plain top-level `let` in renderer.js, not a window property — read
  // the DOM instead (the center panel's title text reflects the active scope/photographer).
  const centerTitle = await window.evaluate(() => document.getElementById('qmzCenterTitle')?.textContent || '');
  check(centerTitle.includes('Enroute') && centerTitle.includes('Husain Bhai'), 'Husain Bhai\'s photographer row now correctly routes into the Enroute scope');
  await selectAllFilesInGrid();
  await window.waitForTimeout(300);
  await domClick('#qmzMoveUnsequencedBtn');
  await window.waitForTimeout(700);

  const unsequencedHusainFiles = await listFileNames(path.join(qmzRoot, '_Unsequenced', 'Husain Bhai'));
  check(unsequencedHusainFiles.includes('DSC004.jpg') && unsequencedHusainFiles.includes('DSC005.jpg'), 'D/G: reverse movement lands at _Unsequenced/Husain Bhai/, preserving photographer identity');
  const unsequencedRootFiles = await listFileNames(path.join(qmzRoot, '_Unsequenced'));
  check(unsequencedRootFiles.length === 0, 'D: no file was dropped directly inside _Unsequenced/ itself');
  check(!fs.existsSync(path.join(qmzRoot, 'Enroute', 'Husain Bhai')), 'the now-emptied Enroute/Husain Bhai leaf folder was cleaned up, matching existing behavior');

  // ═══════════════ Scenario K — numbered sequence assignment still works ═══════════════
  log('=== Scenario K: numbered sequence assignment is unaffected ===');
  const createRes = await window.evaluate((root) => window.api.qmzCreateSequence({ qmzRoot: root, number: 1, letter: 'Q' }), qmzRoot);
  check(createRes?.ok === true, 'K: creating a numbered sequence still works with Enroute present and populated');
  await window.evaluate(async () => { if (typeof _qmzRefresh === 'function') await _qmzRefresh(); });
  await window.waitForTimeout(300);
  await domClick('.qmz-pg-row[data-pg="Husain Bhai"]');
  await window.waitForTimeout(400);
  await selectAllFilesInGrid();
  await window.waitForTimeout(300);
  await window.fill('#qmzAssignInput', '1');
  await window.press('#qmzAssignInput', 'Enter');
  await window.waitForTimeout(700);
  check(fs.existsSync(path.join(qmzRoot, '01Q', 'Husain Bhai', 'DSC004.jpg')), 'K: files assign correctly into 01Q/Husain Bhai/ via the real number-input UI, unaffected by Enroute');

  await electronApp.close();

  log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[qmz-enroute-pg-e2e] FATAL:', err);
  process.exit(1);
});
