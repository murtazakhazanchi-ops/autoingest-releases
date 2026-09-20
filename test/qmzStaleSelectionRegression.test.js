'use strict';

// Regression test for the "Bug 2 second Preview STILL FAILS" forensic report:
// tester observed the QMZ sidebar, header, and center grid simultaneously
// showing THREE DIFFERENT, mutually-inconsistent states for the same open
// event —
//   sidebar:  "PC01-Husain Khokhri — 162"
//   header:   "PC01-Aliasger Suleimanji — Unsequenced"
//   grid:     "No media files here."
//
// Root cause: renderer/renderer.js's _qmzRefresh() re-fetches _qmzData (the
// live scan result) and re-renders the sidebar from it, but never
// re-validates _qmzActivePg (the currently-selected photographer) against
// the FRESH data. If the folder _qmzActivePg refers to is renamed, merged,
// or emptied by ANYTHING between two refreshes — a QMZ recovery adoption,
// a background metadata/import operation, or (as this codebase's own
// forensic evidence shows) a tester manually reorganizing folders in
// Explorer while troubleshooting — _qmzActivePg silently keeps pointing at
// a name that no longer exists in the new _qmzData:
//   - the SIDEBAR re-renders correctly from the fresh data (real keys)
//   - the HEADER (_renderQMZCenter) uses _qmzActivePg directly, unvalidated
//   - the GRID (_qmzGetActiveFiles) looks up
//     _qmzData.unsequenced[_qmzActivePg], finds nothing, returns []
// producing exactly the reported three-way mismatch — a UI-state bug, not a
// scanner/filesystem bug (confirmed separately: main/qmzService.js's
// scanRoot/initRoot were proven correct and idempotent against a
// reconstruction of the tester's exact reported directory shapes — see
// forensic report).
//
// Fix: _qmzRefresh() now re-validates _qmzActivePg against the freshly
// scanned data (in whichever scope — unsequenced or sequence — is active)
// immediately after refreshing _qmzData, and clears the stale selection
// (falling back to the neutral "Select a photographer" state) if it no
// longer resolves. Never fabricates a replacement selection.
//
// This test drives the REAL Electron UI: opens QMZ, selects a real
// photographer (setting _qmzActivePg via a real click), then renames that
// photographer's folder ON DISK from outside the UI's own action tracking
// (simulating exactly the kind of external filesystem change the forensic
// evidence points to), then triggers a real _qmzRefresh()-calling UI action
// (Quick Add Next Sequence) and asserts the UI cleanly resets instead of
// showing the three-way inconsistent state.
//
// Run: node test/qmzStaleSelectionRegression.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function log(...args) { console.log('[qmz-stale]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }
async function rawFile(p) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, Buffer.from('not-a-real-raw-file-just-bytes'));
}

(async () => {
  const userDataDir = await mkTmp('ai-qmz-stale-userdata-');
  const qmzRoot = await mkTmp('ai-qmz-stale-root-');
  log('qmzRoot =', qmzRoot);

  const pgDir = path.join(qmzRoot, '_Unsequenced', 'Jane Doe');
  await rawFile(path.join(pgDir, 'qmz1.cr2'));

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
    await window.fill('#splashInputName', 'QMZ Stale Test Operator');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn'); await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'QMZ Stale Test Operator'); await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) { await window.click('#splashContinueBtn'); }
  window = await mainWindowPromise;
  window.on('pageerror', err => log('[pageerror]', err.message));
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  // Dismiss the first-run onboarding tooltip overlay — it visually sits on top
  // of everything and intercepts Playwright's pointer-event actionability
  // checks even when the QMZ modal is what the operator actually sees/uses
  // (same handling as test/qmzLiveE2E.test.js).
  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));

  // Open QMZ directly via the real public entry point (mirrors qmzLiveE2E.test.js).
  await window.evaluate((root) => window.openQMZManager(root, { eventTitle: 'Stale Selection Test' }), qmzRoot);
  await window.waitForTimeout(600);

  check(await window.evaluate(() => !document.getElementById('qmzOverlay')?.classList.contains('hidden')), 'QMZ Sequence Manager overlay opens');

  // Real click — sets _qmzActivePg (internal, unexported) via the actual row
  // click handler. Verified purely through observable DOM state (the active
  // row's CSS class and the header text), matching how a real user/tester
  // would perceive this — not by reaching into renderer internals.
  await window.click('.qmz-pg-row[data-pg="Jane Doe"]');
  await window.waitForTimeout(300);
  const afterSelect = await window.evaluate(() => ({
    activeRowPg: document.querySelector('.qmz-pg-row.active')?.dataset.pg || null,
    title: document.getElementById('qmzCenterTitle')?.textContent,
  }));
  log('state after selecting Jane Doe:', JSON.stringify(afterSelect));
  check(afterSelect.activeRowPg === 'Jane Doe', 'clicking the row marks it active (selection took effect)');
  check(afterSelect.title === 'Jane Doe — Unsequenced', 'header reflects the selected photographer');

  // Simulate the external filesystem change the forensic evidence points to:
  // the selected photographer's folder gets renamed by something OUTSIDE
  // this UI action (a recovery adoption, another process, or manual Explorer
  // reorganization) while the QMZ session stays open with the old selection
  // still active in memory.
  await fsp.rename(pgDir, path.join(qmzRoot, '_Unsequenced', 'Jane Doe (renamed)'));

  // Trigger a real _qmzRefresh()-calling action — Quick Add Next Sequence —
  // exactly as a user would naturally do next, not a direct internal call.
  await window.click('#qmzAddNextBtn');
  await window.waitForTimeout(600);

  const afterRefresh = await window.evaluate(() => ({
    activeRowPg: document.querySelector('.qmz-pg-row.active')?.dataset.pg || null,
    title: document.getElementById('qmzCenterTitle')?.textContent,
    gridText: document.getElementById('qmzFileGrid')?.textContent,
    sidebarText: document.getElementById('qmzPhotographerList')?.textContent,
  }));
  log('state after external rename + refresh:', JSON.stringify(afterRefresh));

  check(afterRefresh.activeRowPg === null, 'no row is marked active — the stale selection was cleared, not silently kept pointing at a vanished folder');
  check(afterRefresh.title === 'Select a photographer', 'header falls back to the neutral state, not a stale/orphaned name');
  check(!afterRefresh.gridText?.includes('Jane Doe') || afterRefresh.gridText?.includes('Select a photographer'), 'grid does not reference the stale photographer as if it were still active');
  check(afterRefresh.sidebarText?.includes('Jane Doe (renamed)'), 'sidebar correctly shows the real, current photographer folder');

  await electronApp.close().catch(() => {});
  log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
  console.error('[qmz-stale] FATAL:', err);
  process.exit(1);
});
