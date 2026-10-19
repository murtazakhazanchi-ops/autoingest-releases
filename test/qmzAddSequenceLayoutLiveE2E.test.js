'use strict';

// Live end-to-end verification of the "QMZ Add Sequence UI Overflow Fix": the Add Sequence
// section's second row ("Add Specific" — number + suffix + "+Suffix" + type select + Create)
// had grown to 5 controls once "QMZ Sequence Enhancements" added the suffix field, the
// "+Suffix" button, and three new type options (MZ/O/AQ) whose longer labels gave the
// type-select element no fixed width to size against — all five controls together exceeded
// the 240px right panel's ~224px usable content width, pushing the Create button off the
// right edge. Fixed by splitting the row into two (number/suffix/+Suffix, then type/Create)
// and giving the type select a fixed width — see renderer/index.html's own comment at the
// Add Sequence block for the full root-cause writeup. This file verifies, against the REAL
// Electron renderer (no CSS reasoned about in the abstract), that every control in the
// section is fully visible and usable at both a normal window size and the application's own
// documented minimum (1100x700, from main/main.js's BrowserWindow minWidth/minHeight), in
// both themes, and that the underlying sequence-creation/suggestion logic this fix must not
// touch still behaves identically.
//
// Requires playwright-core (see test/metadataPipelineLive.test.js for install notes).
// Uses only a synthetic, disposable QMZ workspace — never a real archive.
// Run: node test/qmzAddSequenceLayoutLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SHOTS = process.env.QMZ_LAYOUT_SHOTS || null; // optional: dir to save screenshots into

function log(...args) { console.log('[qmz-add-seq-layout-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

(async () => {
  const userDataDir = await mkTmp('ai-qmz-layout-e2e-userdata-');
  const root = await mkTmp('ai-qmz-layout-e2e-root-');
  log('userDataDir =', userDataDir, 'root =', root);

  if (SHOTS) await fsp.mkdir(SHOTS, { recursive: true });

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
    await window.fill('#splashInputName', 'Layout Test Operator');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'Layout Test Operator');
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

  const consoleErrors = [];
  window.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  window.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message));

  async function domClick(selector) {
    return window.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    }, selector);
  }
  async function openQmz(r) {
    await window.evaluate((rr) => window.openQMZManager(rr, {
      component: { location: 'Hall A', city: 'TestCity', country: 'India' },
      isMulti: false, eventTitle: 'Layout Test Event', hijriDate: '1448-02-10',
      eventJsonPath: null, componentTitle: null,
    }), r);
    await window.waitForTimeout(500);
  }
  async function getRects(selectors) {
    return window.evaluate((sels) => {
      const out = {};
      for (const s of sels) {
        const el = document.querySelector(s);
        out[s] = el ? (({ x, y, width, height, top, bottom, left, right }) => ({ x, y, width, height, top, bottom, left, right }))(el.getBoundingClientRect()) : null;
      }
      return out;
    }, selectors);
  }
  async function setWindowSize(w, h) {
    await electronApp.evaluate(({ BrowserWindow }, dims) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.setSize(dims.w, dims.h);
    }, { w, h });
    await window.waitForTimeout(400);
  }
  const shot = async (name) => { if (SHOTS) await window.screenshot({ path: path.join(SHOTS, name + '.png') }); };

  const ADD_SEQ_SELECTORS = [
    '#qmzSeqNumInput', '#qmzSeqSuffixInput', '#qmzSeqSuggestSuffixBtn',
    '#qmzSeqLetterSelect', '#qmzAddSpecificBtn', '#qmzLetterSelect', '#qmzAddNextBtn',
    '.qmz-panel-right',
  ];

  // Verifies no control's right edge exceeds the window's inner width or the right panel's
  // own right edge, and that no two controls believed to share a row actually overlap.
  async function verifyNoOverflow(label) {
    const rects = await getRects(ADD_SEQ_SELECTORS);
    const innerWidth = await window.evaluate(() => window.innerWidth);
    const panel = rects['.qmz-panel-right'];
    check(!!panel, `${label}: right panel element is present`);

    for (const sel of ['#qmzSeqNumInput', '#qmzSeqSuffixInput', '#qmzSeqSuggestSuffixBtn', '#qmzSeqLetterSelect', '#qmzAddSpecificBtn', '#qmzLetterSelect', '#qmzAddNextBtn']) {
      const r = rects[sel];
      check(!!r && r.width > 0 && r.height > 0, `${label}: ${sel} is present and has a non-zero rendered size (not collapsed/hidden)`);
      if (!r) continue;
      check(r.right <= innerWidth + 0.5, `${label}: ${sel}'s right edge (${r.right.toFixed(1)}) is within the window's inner width (${innerWidth})`);
      if (panel) {
        check(r.right <= panel.right + 0.5, `${label}: ${sel}'s right edge (${r.right.toFixed(1)}) is within the right panel's own right edge (${panel.right.toFixed(1)})`);
      }
    }

    // Row-mate overlap checks (controls on the same visual row must not horizontally overlap).
    const row1 = ['#qmzSeqNumInput', '#qmzSeqSuffixInput', '#qmzSeqSuggestSuffixBtn'].map(s => rects[s]);
    const row2 = ['#qmzSeqLetterSelect', '#qmzAddSpecificBtn'].map(s => rects[s]);
    for (const row of [row1, row2]) {
      for (let i = 0; i < row.length - 1; i++) {
        const a = row[i], b = row[i + 1];
        if (a && b) check(a.right <= b.left + 0.5, `${label}: adjacent controls do not overlap (${a.right.toFixed(1)} <= ${b.left.toFixed(1)})`);
      }
    }
    return rects;
  }

  // ═══════════════ Phase 4/5: layout verification at normal window size ═══════════════
  log('=== Normal window size ===');
  await setWindowSize(1400, 900);
  await openQmz(root);
  await window.waitForTimeout(300);
  await shot('normal-width');
  await verifyNoOverflow('normal (1400x900)');

  // ═══════════════ Minimum supported window size (main.js BrowserWindow minWidth/minHeight) ═══════════════
  log('=== Minimum supported window size (1100x700) ===');
  await setWindowSize(1100, 700);
  await window.waitForTimeout(300);
  await shot('minimum-width');
  await verifyNoOverflow('minimum (1100x700)');

  // ═══════════════ Both themes, explicitly — never inferred from whatever the default happens
  // to be on a fresh profile (a prior version of this check only re-verified the ALREADY-
  // active default theme twice when that default happened to be "light", never actually
  // exercising "dark" at all; fixed to force both explicitly). ═══════════════
  log('=== Theme verification ===');
  const themeBefore = await window.evaluate(() => document.documentElement.getAttribute('data-theme'));
  log('default theme attribute =', themeBefore);
  for (const theme of ['dark', 'light']) {
    await window.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await window.waitForTimeout(200);
    await shot(`theme-${theme}`);
    await verifyNoOverflow(`theme=${theme} (minimum width)`);
  }
  await window.evaluate((t) => document.documentElement.setAttribute('data-theme', t || 'dark'), themeBefore);
  await window.waitForTimeout(200);

  await setWindowSize(1400, 900); // back to a comfortable size for the functional checks below

  // ═══════════════ All six event types present, correct labels ═══════════════
  log('=== All six event types present ===');
  const specificOptions = await window.evaluate(() => [...document.querySelectorAll('#qmzSeqLetterSelect option')].map(o => o.value));
  check(JSON.stringify(specificOptions) === JSON.stringify(['Q', 'M', 'Z', 'MZ', 'O', 'AQ']), 'specific-add type select offers exactly the six QMZ types, in order');
  const quickAddOptions = await window.evaluate(() => [...document.querySelectorAll('#qmzLetterSelect option')].map(o => o.value));
  check(JSON.stringify(quickAddOptions) === JSON.stringify(['Q', 'M', 'Z', 'MZ', 'O', 'AQ']), 'quick-add type select offers exactly the six QMZ types, in order');

  // ═══════════════ Phase 3: underlying sequence logic unchanged — full functional workflow ═══════════════
  log('=== Functional workflow: create 03aAQ via the real UI ===');
  await window.fill('#qmzSeqNumInput', '3');
  await window.fill('#qmzSeqSuffixInput', 'a');
  await window.selectOption('#qmzSeqLetterSelect', 'AQ');
  await window.waitForTimeout(150);
  const preview1 = await window.evaluate(() => document.getElementById('qmzSeqCodePreview')?.textContent);
  check(preview1 === '03aAQ', `live code preview reads "03aAQ" before creation (got "${preview1}")`);
  await domClick('#qmzAddSpecificBtn');
  await window.waitForTimeout(600);
  check(fs.existsSync(path.join(root, '03aAQ')), 'real folder "03aAQ" was created on disk by the real IPC handler');
  const statusAfterCreate = await window.evaluate(() => document.getElementById('qmzStatus')?.textContent || '');
  check(statusAfterCreate.includes('03aAQ') || statusAfterCreate.toLowerCase().includes('created'), `status line reports the created sequence (got "${statusAfterCreate}")`);

  // ═══════════════ Next suffix suggestion ═══════════════
  log('=== Next suffix suggestion ===');
  await window.fill('#qmzSeqNumInput', '3');
  await window.fill('#qmzSeqSuffixInput', '');
  await domClick('#qmzSeqSuggestSuffixBtn');
  await window.waitForTimeout(200);
  const suggested = await window.evaluate(() => document.getElementById('qmzSeqSuffixInput')?.value);
  check(suggested === 'b', `suggest button fills the next unused suffix "b" after "a" is taken (got "${suggested}")`);

  // ═══════════════ Enter-key behavior unchanged ═══════════════
  log('=== Enter-key behavior ===');
  await window.fill('#qmzSeqNumInput', '7');
  await window.fill('#qmzSeqSuffixInput', '');
  await window.selectOption('#qmzSeqLetterSelect', 'O');
  await window.focus('#qmzSeqSuffixInput');
  await window.keyboard.press('Enter');
  await window.waitForTimeout(600);
  check(fs.existsSync(path.join(root, '07O')), 'pressing Enter in the suffix field still triggers Create, exactly as before this fix');

  // ═══════════════ Keyboard navigation / dropdown opens correctly ═══════════════
  log('=== Keyboard navigation and dropdown ===');
  const selectFocusable = await window.evaluate(() => {
    const el = document.getElementById('qmzSeqLetterSelect');
    el.focus();
    return document.activeElement === el;
  });
  check(selectFocusable, 'the type select can receive keyboard focus');

  await window.evaluate(() => window._closeQMZManager());
  await window.waitForTimeout(300);

  check(consoleErrors.length === 0, `no console errors or page errors occurred (found: ${consoleErrors.join(' | ') || 'none'})`);

  await electronApp.close();

  log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[qmz-add-seq-layout-e2e] FATAL:', err);
  process.exit(1);
});
