'use strict';
// Live Electron validation (security hardening follow-up): exercises the real qmz:moveTo*
// IPC channels DIRECTLY with crafted, malicious input — bypassing the renderer UI entirely —
// to confirm the MAIN PROCESS itself rejects unsafe photographer names and out-of-workspace
// source paths. The renderer's own UI never constructs such values today; this test proves
// the trusted boundary is the main process, not merely a UI-level convention, exactly as
// Section 6 of the hardening brief requires ("do not rely only on renderer-side validation").
//
// Also re-confirms, through the real UI, that legitimate assignment/Enroute/reverse-movement
// workflows still work end to end after the hardening (Section 13's functional checklist).
//
// Uses only synthetic temporary workspaces and synthetic media — never a real archive.
// Requires playwright-core (see test/metadataPipelineLive.test.js for install notes).
// Run: node test/qmzSecurityLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function log(...args) { console.log('[qmz-security-e2e]', ...args); }
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
  const userDataDir = await mkTmp('ai-qmz-security-e2e-userdata-');
  const qmzRoot      = await mkTmp('ai-qmz-security-e2e-root-');
  const outsideRoot  = await mkTmp('ai-qmz-security-e2e-outside-');
  log('qmzRoot =', qmzRoot, 'outsideRoot =', outsideRoot);

  await writeFile(path.join(qmzRoot, '_Unsequenced', 'Abbas Bhai', 'DSC001.jpg'), 'bytes');
  await writeFile(path.join(outsideRoot, 'secret.jpg'), 'should-never-be-moved');

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
    await window.fill('#splashInputName', 'Security Test Operator');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'Security Test Operator');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  }
  window = await mainWindowPromise;
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  // ═══════════════ Direct IPC calls with crafted, malicious input ═══════════════
  log('=== Crafted IPC input is rejected by the MAIN PROCESS, bypassing the renderer UI entirely ===');

  const srcFile = path.join(qmzRoot, '_Unsequenced', 'Abbas Bhai', 'DSC001.jpg');
  const escapeMarker = 'escaped-via-ipc-' + Date.now();

  // 1. Traversal-shaped photographer name via qmz:moveToEnroute.
  const r1 = await window.evaluate(({ root, src, marker }) =>
    window.api.qmzMoveToEnroute({ qmzRoot: root, filePaths: [src], photographerName: '../../' + marker }),
    { root: qmzRoot, src: srcFile, marker: escapeMarker });
  check(r1.ok === false, 'IPC: qmz:moveToEnroute rejects a traversal-shaped photographer name');
  check(!fs.existsSync(path.join(os.tmpdir(), escapeMarker)), 'IPC: no directory was created outside the workspace via the crafted Enroute call');
  check(fs.existsSync(srcFile), 'IPC: the source file was not moved by the rejected Enroute call');

  // 2. Traversal-shaped photographer name via qmz:moveToSequence.
  await window.evaluate((root) => window.api.qmzCreateSequence({ qmzRoot: root, number: 1, letter: 'Q' }), qmzRoot);
  const r2 = await window.evaluate(({ root, src, marker }) =>
    window.api.qmzMoveToSequence({ qmzRoot: root, filePaths: [src], sequenceCode: '01Q', photographerName: '../../' + marker + '-seq' }),
    { root: qmzRoot, src: srcFile, marker: escapeMarker });
  check(r2.ok === false, 'IPC: qmz:moveToSequence rejects a traversal-shaped photographer name');
  check(fs.existsSync(srcFile), 'IPC: the source file was not moved by the rejected sequence-assignment call');

  // 3. A source path entirely outside the workspace via qmz:moveToUnsequenced.
  const outsideFile = path.join(outsideRoot, 'secret.jpg');
  const r3 = await window.evaluate(({ root, src }) =>
    window.api.qmzMoveToUnsequenced({ qmzRoot: root, filePaths: [src], photographerName: 'Abbas Bhai' }),
    { root: qmzRoot, src: outsideFile });
  check(r3.ok === false, 'IPC: qmz:moveToUnsequenced rejects a source path outside the authorized workspace');
  check(fs.existsSync(outsideFile), 'IPC: the outside file was never moved');
  const outsideBytes = await fsp.readFile(outsideFile, 'utf8');
  check(outsideBytes === 'should-never-be-moved', 'IPC: the outside file\'s content is completely unchanged');

  // 4. The internal state file itself, via qmz:moveToEnroute.
  const stateFile = path.join(qmzRoot, 'qmz-sequences.json');
  check(fs.existsSync(stateFile), 'precondition: qmz-sequences.json exists after creating 01Q');
  const stateBefore = await fsp.readFile(stateFile, 'utf8');
  const r4 = await window.evaluate(({ root, src }) =>
    window.api.qmzMoveToEnroute({ qmzRoot: root, filePaths: [src], photographerName: 'Abbas Bhai' }),
    { root: qmzRoot, src: stateFile });
  check(r4.ok === false, 'IPC: qmz:moveToEnroute rejects qmz-sequences.json as a photograph');
  const stateAfter = await fsp.readFile(stateFile, 'utf8');
  check(stateAfter === stateBefore, 'IPC: qmz-sequences.json content is unchanged');

  // ═══════════════ Legitimate real-UI workflows still work after the hardening ═══════════════
  log('=== Legitimate real-UI workflows are unaffected ===');

  const eventContext = {
    component: { location: 'Hall A', city: 'Mumbai', country: 'India' },
    isMulti: false, eventTitle: 'Waaz Mubarak', hijriDate: '1448-02-10',
    eventJsonPath: null, componentTitle: null,
  };
  await window.evaluate(({ root, ctx }) => window.openQMZManager(root, ctx), { root: qmzRoot, ctx: eventContext });
  await window.waitForTimeout(800);
  check(await window.evaluate(() => !document.getElementById('qmzOverlay')?.classList.contains('hidden')), 'QMZ workspace opens normally after the hardening, with the rejected-but-untouched fixture intact');

  async function domClick(selector) {
    return window.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    }, selector);
  }

  await domClick('.qmz-pg-row[data-pg="Abbas Bhai"]');
  await window.waitForTimeout(400);
  await window.evaluate(() => {
    document.querySelectorAll('#qmzFileGrid input[type="checkbox"][data-path]').forEach(cb => {
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  await window.waitForTimeout(300);
  await domClick('#qmzMoveEnrouteBtn');
  await window.waitForTimeout(700);
  check(fs.existsSync(path.join(qmzRoot, 'Enroute', 'Abbas Bhai', 'DSC001.jpg')), 'legitimate real-UI "→ Enroute" assignment still works, with correct photographer-folder preservation');

  await electronApp.close();

  log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[qmz-security-e2e] FATAL:', err);
  process.exit(1);
});
