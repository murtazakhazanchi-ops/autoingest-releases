'use strict';

// Live end-to-end UI verification of the CARD-source browsing fix, driving
// the REAL Electron renderer's own CARD-selection flow (selectSource(...) ->
// browseFolder(...) -> the real files:get IPC handler -> real DOM render),
// against isolated synthetic CARD fixtures. Never touches real data or real
// userData. Companion to test/cardFolderTreeBugfixLive.test.js (which
// exercises window.api.getFiles directly) — this file additionally proves
// the fix reaches the actual sidebar tree DOM, status text, and Media view,
// not just the IPC response payload.
//
// Run: node test/cardFolderTreeBugfixUiLive.test.js

const { _electron: electron } = require('playwright-core');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[e2e-card-ui]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

// scanMediaRecursive drops files under 50 KB as thumbnail/proxy stubs —
// fixture media must clear that bar to be recognized as real media.
const FAKE_MEDIA_BYTES = Buffer.alloc(60 * 1024, 0xab);

async function writeMedia(root, relFile) {
  const full = path.join(root, relFile);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, FAKE_MEDIA_BYTES);
}

async function mkEmptyDir(root, relDir) {
  await fsp.mkdir(path.join(root, relDir), { recursive: true });
}

(async () => {
  const userDataDir = await mkTmp('ai-e2e-card-ui-userdata-');

  const emptyCard = await mkTmp('ai-e2e-card-ui-empty-');
  await mkEmptyDir(emptyCard, 'DCIM/100CANON');
  await mkEmptyDir(emptyCard, 'MISC');

  const mixedCard = await mkTmp('ai-e2e-card-ui-mixed-');
  await writeMedia(mixedCard, 'DCIM/100CANON/IMG_0001.CR3');
  await mkEmptyDir(mixedCard, 'DCIM/101CANON');

  log('userDataDir =', userDataDir);
  log('emptyCard   =', emptyCard);
  log('mixedCard   =', mixedCard);

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
  log('window loaded, title =', await window.title().catch(() => '(no title)'));

  // Splash/operator screen — same handling as the other *Live.test.js files.
  // Logging in opens a SEPARATE BrowserWindow (the splash window then closes),
  // so the splash-panel window handle must not be reused afterward — see
  // test/eventManagementReliabilityLive.test.js for the identical pattern.
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
  window.on('pageerror', (err) => log('[pageerror]', err.message, err.stack));
  window.on('console', (msg) => { if (msg.type() === 'error') log('[console.error]', msg.text()); });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1000);
  await window.waitForFunction(() => typeof window.selectSource === 'function', { timeout: 15000 });

  // #viewFolderBtn / #viewMediaBtn are legacy elements kept `display:none`
  // in the DOM solely so their click handlers can be reused by the real,
  // visible #mediaFolderSwitch toggle (see renderer.js ~6602). Playwright's
  // .click() refuses to click a hidden element, so drive these directly via
  // in-page el.click() rather than a Playwright locator click.
  async function clickHidden(selector) {
    await window.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error('clickHidden: no element for ' + sel);
      el.click();
    }, selector);
  }

  // Finds a sidebar row by its visible name and clicks a child element inside
  // it (its own toggle, or the row itself) — find + click happen inside ONE
  // evaluate call so there is no Playwright round-trip between locating the
  // element and clicking it while the DOM is mid-render.
  async function clickFolderRowByName(name, { toggle = false } = {}) {
    return window.evaluate(({ name, toggle }) => {
      const row = [...document.querySelectorAll('#folderList .folder-item')]
        .find((el) => el.querySelector('.fi-name')?.textContent === name);
      if (!row) return { found: false };
      const target = toggle ? row.querySelector('.fi-toggle') : row;
      target && target.click();
      return { found: true };
    }, { name, toggle });
  }

  async function sidebarNames() {
    return window.evaluate(() =>
      [...document.querySelectorAll('#folderList .folder-item')].map((el) => el.querySelector('.fi-name')?.textContent || ''));
  }

  try {
    // ── EMPTY-OF-MEDIA CARD ────────────────────────────────────────────────
    await window.evaluate((p) => window.selectSource({ type: 'memory-card', path: p, label: 'EMPTY_CARD' }), emptyCard);
    await window.waitForTimeout(800);
    // CARD mode's selectSource() does not force viewModeType (unlike
    // external-drive/local-folder, which force 'folder') — default is
    // 'media', which hides the sidebar. Force Folder view explicitly so the
    // sidebar tree checks below interact with real, visible DOM.
    await clickHidden('#viewFolderBtn');
    await window.waitForTimeout(300);

    const emptyState = await window.evaluate(() => {
      const items = [...document.querySelectorAll('#folderList .folder-item')].map((el) => ({
        path: el.dataset.path,
        name: el.querySelector('.fi-name')?.textContent || '',
      }));
      return {
        workspaceVisible: document.getElementById('workspace')?.classList.contains('visible'),
        statusText: document.getElementById('statusFiles')?.textContent || '',
        items,
      };
    });
    log('EMPTY CARD folder sidebar items:', JSON.stringify(emptyState.items));
    log('EMPTY CARD status text:', emptyState.statusText);

    check(emptyState.workspaceVisible, 'EMPTY CARD: workspace becomes visible (Card is detected/browsable)');
    check(emptyState.items.some((i) => i.name === 'DCIM'), 'EMPTY CARD: DCIM appears in the sidebar tree');
    check(/\d+ folders?/.test(emptyState.statusText) && !emptyState.statusText.includes('0 folder'),
      'EMPTY CARD: status text reports the real (non-zero) folder count, not a misleading "0 folders"');

    // Expand DCIM to confirm 100CANON (the empty camera folder) is reachable.
    const expandEmpty = await clickFolderRowByName('DCIM', { toggle: true });
    check(expandEmpty.found, 'EMPTY CARD: DCIM row found and clickable');
    const afterExpandEmpty = await sidebarNames();
    log('EMPTY CARD sidebar after expanding DCIM:', JSON.stringify(afterExpandEmpty));
    check(afterExpandEmpty.includes('100CANON'), 'EMPTY CARD: expanding DCIM reveals 100CANON even though it is empty');

    // Media view — whole-card media list; must show an empty state, not an error.
    await clickHidden('#viewMediaBtn');
    await window.waitForTimeout(400);
    const emptyMediaView = await window.evaluate(() => ({
      sidebarHidden: document.getElementById('sidebar')?.style.display === 'none',
      gridHtml: document.getElementById('fileGrid')?.innerHTML || '',
      statusText: document.getElementById('statusFiles')?.textContent || '',
    }));
    check(emptyMediaView.sidebarHidden, 'EMPTY CARD Media view: sidebar hidden as expected in flat media list mode');
    check(!emptyMediaView.gridHtml.toLowerCase().includes('error'), 'EMPTY CARD Media view: no error state rendered');
    check(emptyMediaView.statusText.startsWith('0 files'), 'EMPTY CARD Media view: correctly reports 0 media files');

    // ── MIXED CARD (populated + empty sibling folder) ───────────────────────
    await clickHidden('#changeDriveBtn');
    await window.waitForTimeout(400);
    await window.evaluate((p) => window.selectSource({ type: 'memory-card', path: p, label: 'MIXED_CARD' }), mixedCard);
    await window.waitForTimeout(800);
    await clickHidden('#viewFolderBtn');
    await window.waitForTimeout(300);

    const mixedWorkspaceVisible = await window.evaluate(() => document.getElementById('workspace')?.classList.contains('visible'));
    check(mixedWorkspaceVisible, 'MIXED CARD: workspace visible');

    const expandMixed = await clickFolderRowByName('DCIM', { toggle: true });
    check(expandMixed.found, 'MIXED CARD: DCIM row found and clickable');
    const mixedNames = await sidebarNames();
    log('MIXED CARD sidebar after expanding DCIM:', JSON.stringify(mixedNames));

    const count100 = mixedNames.filter((n) => n === '100CANON').length;
    const count101 = mixedNames.filter((n) => n === '101CANON').length;
    check(count100 === 1, 'MIXED CARD: 100CANON (populated) appears exactly once — no duplicate tiles');
    check(count101 === 1, 'MIXED CARD: 101CANON (empty sibling) appears exactly once and remains navigable');

    // Click into 100CANON (populated) and confirm it shows its media.
    await clickFolderRowByName('100CANON');
    await window.waitForTimeout(400);
    const populatedLeaf = await window.evaluate(() => ({
      statusText: document.getElementById('statusFiles')?.textContent || '',
      gridHtml: document.getElementById('fileGrid')?.innerHTML || '',
    }));
    log('MIXED CARD 100CANON leaf status:', populatedLeaf.statusText);
    check(populatedLeaf.statusText.startsWith('1 files') || populatedLeaf.statusText.startsWith('1 file'),
      'MIXED CARD: 100CANON leaf view reports its 1 real media file');

    // Click into 101CANON (empty sibling) and confirm it is still navigable
    // and shows an appropriate empty-folder message rather than an error.
    await clickFolderRowByName('DCIM');
    await window.waitForTimeout(200);
    await clickFolderRowByName('101CANON');
    await window.waitForTimeout(400);
    const emptySiblingLeaf = await window.evaluate(() => ({
      gridHtml: document.getElementById('fileGrid')?.innerHTML || '',
    }));
    check(!emptySiblingLeaf.gridHtml.toLowerCase().includes('error'),
      'MIXED CARD: navigating into the empty sibling folder shows no error state');

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
  console.error('[e2e-card-ui] FATAL', err);
  process.exitCode = 1;
});
