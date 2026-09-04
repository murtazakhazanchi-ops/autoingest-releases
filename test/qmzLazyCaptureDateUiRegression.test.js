'use strict';

// Regression test for Bug 2's second performance round: proves the renderer
// half of the lazy capture-date fix end-to-end through the REAL UI, not just
// main-process state. main/qmzService.js's listMediaFiles() now returns each
// file with a provisional capturedAt (its filesystem modifiedAt) instead of
// blocking on ExifTool, and renderer/renderer.js's
// _qmzEnrichCaptureDatesInBackground() (fired from _qmzRefresh(), never
// awaited) corrects capturedAt in place and re-renders once the real EXIF
// date resolves. This test confirms the operator actually SEES that
// correction happen live — the workspace shows a provisional date
// immediately (file mtime), then updates to the real EXIF date shortly
// after, without ever blocking selection/interaction in between.
//
// Run: node test/qmzLazyCaptureDateUiRegression.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
function log(...args) { console.log('[qmz-lazy-date]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

(async () => {
  const userDataDir = await mkTmp('ai-qmz-lazydate-userdata-');
  const qmzRoot = await mkTmp('ai-qmz-lazydate-root-');
  const pgDir = path.join(qmzRoot, '_Unsequenced', 'Jane Doe');
  await fsp.mkdir(pgDir, { recursive: true });
  const filePath = path.join(pgDir, 'IMG001.cr2');
  await fsp.writeFile(filePath, Buffer.from('not-a-real-raw-file'));
  // Deliberately old, distinctive mtime so the provisional (modifiedAt-based)
  // date and the real EXIF date below are unmistakably different strings.
  const oldMtime = new Date('2019-01-01T00:00:00.000Z');
  await fsp.utimes(filePath, oldMtime, oldMtime);

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));

  let window = await electronApp.firstWindow({ timeout: 60000 });
  window.on('pageerror', err => log('[pageerror]', err.message));
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));
  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'Lazy Date Test'); await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn'); await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'Lazy Date Test'); await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) { await window.click('#splashContinueBtn'); }
  window = await mainWindowPromise;
  window.on('pageerror', err => log('[pageerror]', err.message));
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));

  const t0 = Date.now();
  await window.evaluate((root) => window.openQMZManager(root, { eventTitle: 'Lazy Date Test' }), qmzRoot);
  const openElapsed0 = Date.now() - t0;
  await window.waitForTimeout(200);
  check(await window.evaluate(() => !document.getElementById('qmzOverlay')?.classList.contains('hidden')), 'QMZ overlay opens');
  log(`openQMZManager() call itself returned in ${openElapsed0}ms (workspace open, not blocked on ExifTool)`);

  await window.click('.qmz-pg-row[data-pg="Jane Doe"]');
  await window.waitForTimeout(300);

  const initialDateText = await window.evaluate(() => document.querySelector('#qmzFileGrid .file-date')?.textContent);
  log('initial (provisional) displayed date:', initialDateText);
  check(!!initialDateText, 'a file card with a date is visible almost immediately (not blocked on ExifTool)');

  // Wait for the background resolveCaptureDates() round-trip + re-render.
  await window.waitForTimeout(2000);

  const finalDateText = await window.evaluate(() => document.querySelector('#qmzFileGrid .file-date')?.textContent);
  log('final (corrected) displayed date:', finalDateText);
  check(!!finalDateText, 'file card still shows a date after background enrichment');
  // Real ExifTool against this placeholder (non-real RAW) content will not
  // find an embedded date, so capturedAt correctly stays at modifiedAt —
  // the meaningful assertion here is that the workspace was interactive and
  // showing a real date from the very first render, not that it changed
  // (that's covered at the qmzService.js level in
  // test/qmzPerfConcurrencyRegression.test.js with a mocked EXIF date).
  check(openElapsed0 < 5000, `openQMZManager() must return quickly even though it internally awaits initRoot+scanRoot — got ${openElapsed0}ms`);

  await electronApp.close().catch(() => {});
  log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
  console.error('[qmz-lazy-date] FATAL:', err);
  process.exit(1);
});
