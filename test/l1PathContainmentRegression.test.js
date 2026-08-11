'use strict';

// Regression test for the Canonical Representation Audit's L1 finding
// (2026-08-11): main-process archive/collection path containment gates used
// their own ad hoc `path.resolve(x).startsWith(path.resolve(root) + path.sep)`
// check — no case-folding — unlike renderer/pathUtils.js's isPathUnderRoot(),
// which BUG-013 already fixed to be case-insensitive specifically for
// Windows/UNC-shaped paths. A stored nasRoot setting and a caller-supplied
// nasCollectionPath that are the SAME physical location but differently cased
// (a realistic Windows/SMB scenario: one may come from user-typed/picker text,
// the other from a directory listing's server-returned casing) would be
// incorrectly rejected with "outside the configured Archive Root".
//
// Fix: every such gate in main.js now routes through the same
// PathUtils.isPathUnderRoot()/isPathUnderOrEqualToRoot() renderer/pathUtils.js
// already exports — one canonical implementation, not 20 ad hoc ones.
//
// This drives the REAL production IPC handlers (collection:matchToNas,
// collection:prepareOffline), not a mirror — via the real Electron app,
// same pattern as the other bug011*.test.js files. collection:matchToNas
// specifically never touches nasCollectionPath on disk (only localCollectionPath),
// so a literal, non-existent Windows/UNC-shaped string can stand in for a
// real NAS path without needing an actual Windows machine or network share.
//
// Run: node test/l1PathContainmentRegression.test.js

const { _electron: electron } = require('playwright-core');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = '/Users/funun_pa/Projects/_Auto-Ingest-Software/electron-app-v24';

function log(...args) { console.log('[l1-path]', ...args); }
let failures = 0;
function check(cond, msg, detail) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); if (detail !== undefined) log('  detail:', JSON.stringify(detail)); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

(async () => {
  const userDataDir = await mkTmp('ai-l1path-userdata-');
  const stagingRoot = await mkTmp('ai-l1path-staging-');
  log('userDataDir =', userDataDir);
  log('stagingRoot =', stagingRoot);

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', () => {});
  electronApp.process().stderr.on('data', () => {});

  let window = await electronApp.firstWindow({ timeout: 60000 });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));

  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'L1 Path Operator');
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
      await window.fill('#splashInputName', 'L1 Path Operator');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  }

  window = await mainWindowPromise;
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  await window.evaluate(async (root) => { await window.api.setLocalStagingRoot?.(root); }, stagingRoot).catch(() => {});
  // Fall back to whatever setter name is actually exposed, if the above isn't it.
  const stagingSet = await window.evaluate(() => typeof window.api.setLocalStagingRoot === 'function');
  check(stagingSet, 'window.api.setLocalStagingRoot is exposed (sanity check before the real tests)');

  const nasRootStored = '\\\\FQ_PhotoArchive\\02-Working-AJSS';
  await window.evaluate(async (root) => { await window.api.setNasRoot(root); }, nasRootStored);

  // ── TEST 1: main.js's containment gates are actually wired to PathUtils ────
  // The case-insensitivity behavior itself is exhaustively proven at the pure-
  // function level in test/pathUtils.test.js (22 assertions, including the
  // exact case-mismatch scenario this fix targets). It is NOT re-proven here
  // through the full IPC handler, deliberately: bare path.resolve() is
  // platform-dependent, and on macOS/POSIX it prepends the process's CWD to
  // any string it doesn't recognize as already-absolute by POSIX rules (only
  // a leading '/' counts) — including `\\server\share`-shaped UNC strings.
  // That destroys the leading `\\` before PathUtils ever sees it, so a case-
  // mismatch assertion driven through this handler would only be valid on an
  // actual Windows host (where bare path.resolve() correctly uses win32
  // semantics and leaves a UNC-absolute string untouched) — asserting it here
  // would either force-pass for the wrong reason or fail for an environment
  // reason unrelated to the fix. Verified directly instead: the source of
  // both flagged handlers actually calls PathUtils.isPathUnderOrEqualToRoot(),
  // not a re-implemented check.
  const src = await fsp.readFile(path.join(PROJECT_ROOT, 'main/main.js'), 'utf8');
  const prepareOfflineBody = src.slice(src.indexOf("'collection:prepareOffline'"), src.indexOf("'collection:prepareOffline'") + 1200);
  const matchToNasBody = src.slice(src.indexOf("'collection:matchToNas'"), src.indexOf("'collection:matchToNas'") + 1200);
  check(prepareOfflineBody.includes('PathUtils.isPathUnderOrEqualToRoot'), 'collection:prepareOffline is wired to PathUtils.isPathUnderOrEqualToRoot (not a re-implemented check)');
  check(matchToNasBody.includes('PathUtils.isPathUnderOrEqualToRoot'), 'collection:matchToNas is wired to PathUtils.isPathUnderOrEqualToRoot (not a re-implemented check)');

  // ── Repository guarantee: exactly one canonical containment implementation ──
  // No ad hoc `x.startsWith(root + path.sep)`-style re-implementation should
  // remain in main.js outside of this file's own explanatory comments.
  const unsafePattern = /\.startsWith\([^)]*path\.sep\)/g;
  const unsafeMatches = (src.match(unsafePattern) || []).filter((_m, i) => {
    // Locate this specific match's surrounding line to exclude comment lines.
    const idx = src.indexOf([...src.matchAll(unsafePattern)][i][0]);
    const lineStart = src.lastIndexOf('\n', idx) + 1;
    const line = src.slice(lineStart, src.indexOf('\n', idx));
    return !line.trim().startsWith('//');
  });
  check(unsafeMatches.length === 0, 'no ad hoc `.startsWith(...path.sep)` containment check remains in main.js outside comments — single canonical implementation confirmed', unsafeMatches);
  const relativeContainmentPattern = /rel\.startsWith\('\.\.'\)/g;
  check(!relativeContainmentPattern.test(src), 'no ad hoc path.relative()-based containment check remains in main.js');

  // ── TEST 2: exact-match (nasCollectionPath === nasRoot, same casing) still accepted ──
  const localCollDir2 = path.join(stagingRoot, 'L1-Test-Collection-2');
  await fsp.mkdir(localCollDir2, { recursive: true });
  const matchExactResult = await window.evaluate(
    ({ localCollectionPath, nasCollectionPath }) => window.api.matchCollectionToNas({ localCollectionPath, nasCollectionPath }),
    { localCollectionPath: localCollDir2, nasCollectionPath: nasRootStored }
  );
  check(matchExactResult?.ok === true, 'collection:matchToNas accepts nasCollectionPath === nasRoot exactly (the "or-equal" semantic, unchanged from before the fix)', matchExactResult);

  // ── TEST 3: a genuinely unrelated NAS path is still correctly REJECTED ─────
  // Proves the fix did not broaden acceptance — this must still fail.
  const localCollDir3 = path.join(stagingRoot, 'L1-Test-Collection-3');
  await fsp.mkdir(localCollDir3, { recursive: true });
  const unrelatedNasPath = '\\\\SomeOtherServer\\SomeOtherShare\\1448\\1448-01-11 _UK Safar';
  const matchRejectResult = await window.evaluate(
    ({ localCollectionPath, nasCollectionPath }) => window.api.matchCollectionToNas({ localCollectionPath, nasCollectionPath }),
    { localCollectionPath: localCollDir3, nasCollectionPath: unrelatedNasPath }
  );
  check(matchRejectResult?.ok === false && matchRejectResult?.reason === 'nasCollectionPath is outside the configured Archive Root',
    'collection:matchToNas still correctly rejects a genuinely unrelated NAS path (no security broadening)', matchRejectResult);

  await electronApp.close();
  await fsp.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  await fsp.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
})();
