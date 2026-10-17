'use strict';
// Stage 5 independent review — Logitech MX Creative Console compatibility with suffixed
// sequences and the combined MZ type.
//
// Root cause this test guards against: renderer/commandManager.js's 'qmz.assignToSequence'
// command carried its OWN independently-copied payload-shape regex (/^\d{2}[QMZ]$/), written
// before Stage 1 of "PDF-Assisted QMZ Workspace Folder Generation" added lowercase-suffix
// ("05aMZ") and combined-type ("06MZ") support to main/qmzService.js's own authoritative
// SEQ_RE. That copy was never updated when Stage 1 shipped, so an MX Console operator could
// never assign files to a suffixed or MZ sequence — the command's own isValid() gate rejected
// the payload before it ever reached the real assignment logic. Fixed by sharing ONE
// definition (renderer/qmzSequenceFormat.js) between qmzService.js and commandManager.js.
//
// Drives the REAL Electron renderer (window.AutoIngestCommands — the actual MX Console
// command registry) end to end, not a reimplementation of the regex.
//
// Requires playwright-core (see test/metadataPipelineLive.test.js for install notes).
// Run: node test/qmzMxConsoleCompatibilityLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function log(...args) { console.log('[qmz-mx-console-e2e]', ...args); }
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
  const userDataDir = await mkTmp('ai-qmz-mx-e2e-userdata-');
  const qmzRoot      = await mkTmp('ai-qmz-mx-e2e-root-');
  log('qmzRoot =', qmzRoot);

  await writeFile(path.join(qmzRoot, '_Unsequenced', 'Abbas Bhai', 'DSC001.jpg'), 'bytes');

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
    await window.fill('#splashInputName', 'MX Console Test Operator');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'MX Console Test Operator');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  }
  window = await mainWindowPromise;
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  // ═══════════════ Payload-shape validation (the actual regression) ═══════════════
  log('=== qmz.assignToSequence isValid() gate recognizes every current sequence shape ===');

  const registryExists = await window.evaluate(() => typeof window.AutoIngestCommands?.canExecute === 'function');
  check(registryExists, 'window.AutoIngestCommands (the real MX command registry) is present');

  const shapes = {
    '01Q (plain, pre-existing format)':  '01Q',
    '52Z (plain, upper ceiling)':        '52Z',
    '05aMZ (lowercase suffix + MZ)':     '05aMZ',
    '05bMZ (second suffix of same slot)': '05bMZ',
    '06MZ (combined MZ, no suffix)':     '06MZ',
    '99Q (2-digit format ceiling)':      '99Q',
  };
  for (const [label, code] of Object.entries(shapes)) {
    const r = await window.evaluate((c) => window.AutoIngestCommands.canExecute('qmz.assignToSequence', { sequenceCode: c }), code);
    check(r.reason !== 'invalid-payload', `${label}: isValid() accepts the payload shape (got reason="${r.reason}", ok=${r.ok})`);
  }

  const invalidShapes = {
    'empty string':            '',
    'missing letter':          '01',
    'lowercase type letter':   '01q',
    'three-letter type':       '01QQQ',
    'path-traversal shaped':   '../01Q',
    'null payload':            null,
  };
  for (const [label, code] of Object.entries(invalidShapes)) {
    const r = await window.evaluate((c) => window.AutoIngestCommands.canExecute('qmz.assignToSequence', c === null ? null : { sequenceCode: c }), code);
    check(r.reason === 'invalid-payload', `${label}: isValid() still correctly rejects this malformed shape (got reason="${r.reason}")`);
  }

  // ═══════════════ Full round trip — the command actually moves files for a suffixed/MZ code ═══
  log('=== Full MX Console command round trip for a suffixed/MZ sequence ===');

  await window.evaluate(({ root, number, letter, suffix }) =>
    window.api.qmzCreateSequence({ qmzRoot: root, number, letter, suffix }),
    { root: qmzRoot, number: 5, letter: 'MZ', suffix: 'a' });

  const eventContext = {
    component: { location: 'Hall A', city: 'Mumbai', country: 'India' },
    isMulti: false, eventTitle: 'Waaz Mubarak', hijriDate: '1448-02-10',
    eventJsonPath: null, componentTitle: null,
  };
  await window.evaluate(({ root, ctx }) => window.openQMZManager(root, ctx), { root: qmzRoot, ctx: eventContext });
  await window.waitForTimeout(800);
  check(await window.evaluate(() => !document.getElementById('qmzOverlay')?.classList.contains('hidden')), 'QMZ workspace opens with 05aMZ already created');

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

  const canExecuteNow = await window.evaluate(() => window.AutoIngestCommands.canExecute('qmz.assignToSequence', { sequenceCode: '05aMZ' }));
  check(canExecuteNow.ok === true, `qmz.assignToSequence is now fully executable for "05aMZ" with a real selection (got ${JSON.stringify(canExecuteNow)})`);

  const execResult = await window.evaluate(() => window.AutoIngestCommands.execute('qmz.assignToSequence', { sequenceCode: '05aMZ' }));
  await window.waitForTimeout(700);
  check(execResult.ok === true && execResult.executed === true, `the real MX Console command executed successfully (got ${JSON.stringify(execResult)})`);
  check(fs.existsSync(path.join(qmzRoot, '05aMZ', 'Abbas Bhai', 'DSC001.jpg')), 'the file physically moved to 05aMZ/Abbas Bhai/ via the actual MX command path, exactly as a plain-code assignment would');

  // ═══════════════ No regression to existing plain-code commands ═══════════════
  log('=== No regression to other command-layer behavior ===');

  const getCommandsResult = await window.evaluate(() => window.AutoIngestCommands.getCommands());
  check(Array.isArray(getCommandsResult) && getCommandsResult.includes('qmz.assignToSequence'), 'getCommands() still lists qmz.assignToSequence unchanged');
  const availableNow = await window.evaluate(() => window.AutoIngestCommands.getAvailableCommands());
  check(Array.isArray(availableNow), 'getAvailableCommands() still returns a plain array (no regression to command enumeration)');

  await electronApp.close();

  log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[qmz-mx-console-e2e] FATAL:', err);
  process.exit(1);
});
