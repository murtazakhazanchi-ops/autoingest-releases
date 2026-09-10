'use strict';

// Live end-to-end verification of the CARD-source browsing fix, driving the
// REAL Electron app (not an isolated helper call) via playwright-core's
// `_electron` API — same convention as test/eventManagementReliabilityLive.test.js
// and test/eventNamingConsecutiveCityRunLive.test.js. Never touches real
// data or real userData.
//
// Exercises the actual 'files:get' IPC handler in main/main.js end-to-end
// (renderer preload's window.api.getFiles -> ipcRenderer.invoke('files:get')
// -> the real handler -> buildCardFolderTree()), against isolated synthetic
// CARD fixtures on local disk — not just the fileBrowser.js helpers in
// isolation (see test/cardFolderTreeBugfix.test.js for those).
//
// Run: node test/cardFolderTreeBugfixLive.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[e2e-card]', ...args); }
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

function findChild(node, name) {
  return (node && node.children || []).find((c) => c.name === name);
}

(async () => {
  const userDataDir = await mkTmp('ai-e2e-card-userdata-');

  // Empty-of-media synthetic card: DCIM/100CANON/ and MISC/ both empty.
  const emptyCard = await mkTmp('ai-e2e-card-empty-');
  await mkEmptyDir(emptyCard, 'DCIM/100CANON');
  await mkEmptyDir(emptyCard, 'MISC');

  // Mixed synthetic card: one populated camera folder, one empty sibling —
  // the scenario a narrow "empty file list -> fallback" fix would miss.
  const mixedCard = await mkTmp('ai-e2e-card-mixed-');
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
  electronApp.on('close', () => log('electronApp CLOSED unexpectedly'));

  const window = await electronApp.firstWindow({ timeout: 60000 });
  window.on('pageerror', (err) => log('[pageerror]', err.message, err.stack));
  await window.waitForLoadState('domcontentloaded');
  log('window loaded, title =', await window.title().catch(() => '(no title)'));

  // window.api is exposed via contextBridge in preload.js at window creation
  // time — no need to navigate past the splash/operator screen to reach it.
  await window.waitForFunction(() => !!(window.api && window.api.getFiles), { timeout: 15000 });

  try {
    // ── TEST A: empty-of-media card via the real files:get IPC path ────────
    const resultA = await window.evaluate(async (drivePath) => {
      return window.api.getFiles(drivePath, null, 'e2e-card-empty-req');
    }, emptyCard);

    check(!!resultA && !!resultA.folders, 'TEST A: files:get returns a folders tree for an empty-of-media card');
    const dcimA = findChild(resultA.folders, 'DCIM');
    check(!!dcimA, 'TEST A: DCIM node present in the real IPC response');
    check(!!findChild(dcimA, '100CANON'), 'TEST A: 100CANON (empty) present in the real IPC response');
    check(!!findChild(resultA.folders, 'MISC'), 'TEST A: MISC (empty) present in the real IPC response');
    check(Array.isArray(resultA.files) && resultA.files.length === 0, 'TEST A: 0 media files reported (correct — card genuinely has none)');

    // ── TEST B: mixed populated+empty card via the real files:get IPC path ─
    const resultB = await window.evaluate(async (drivePath) => {
      return window.api.getFiles(drivePath, null, 'e2e-card-mixed-req');
    }, mixedCard);

    check(!!resultB && !!resultB.folders, 'TEST B: files:get returns a folders tree for a mixed card');
    const dcimB = findChild(resultB.folders, 'DCIM');
    check(!!dcimB, 'TEST B: DCIM node present');
    const populated = findChild(dcimB, '100CANON');
    const emptySibling = findChild(dcimB, '101CANON');
    check(!!populated, 'TEST B: 100CANON (populated) present');
    check(!!emptySibling, 'TEST B: 101CANON (empty sibling) present — the mixed-case regression this fix targets');
    check(Array.isArray(resultB.files) && resultB.files.length === 1 && resultB.files[0].name === 'IMG_0001.CR3',
      'TEST B: media view reports exactly the one real media file');

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
  console.error('[e2e-card] FATAL', err);
  process.exitCode = 1;
});
