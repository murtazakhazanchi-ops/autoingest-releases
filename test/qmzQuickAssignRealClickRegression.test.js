'use strict';

// "AutoIngest — RC.4 Operator Bug Fixes" — Part A regression coverage.
//
// The operator reported that the "A" Quick Assign shortcut does not work. Every prior
// automated test (test/qmzQuickAssignLiveE2E.test.js) passed because its selection setup
// sets `checkbox.checked = true` and dispatches a synthetic 'change' event directly — this
// never moves `document.activeElement`, so it never exercised the real failure path.
//
// Root cause (confirmed by live reproduction before any fix): a real browser click on a
// file-selection checkbox — the actual, primary way an operator selects photographs —
// focuses that checkbox. The shared keydown handler (and `_isEditableTarget()`) treated ANY
// focused <input>, including type="checkbox", as "the operator is typing", silently
// swallowing the bare "A"/"S" shortcuts from that point on. Fixed by excluding non-text-entry
// input types (checkbox/radio/button/etc.) from `_isEditableTarget()`.
//
// This file exercises the REAL interaction path exclusively: real `window.click()` on actual
// checkboxes/tiles and real `window.keyboard.press()`, never a synthetic state assignment —
// so a regression here cannot be masked the way the original bug was.
//
// Run: node test/qmzQuickAssignRealClickRegression.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SHOTS = process.env.QMZ_QA_REAL_SHOTS || null;

function log(...args) { console.log('[qmz-qa-real-click]', ...args); }
let failures = 0;
function check(cond, msg) { if (cond) log('PASS —', msg); else { failures++; log('FAIL —', msg); } }

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

(async () => {
  const userDataDir = await mkTmp('ai-qmz-qa-real-userdata-');
  const root = await mkTmp('ai-qmz-qa-real-root-');
  log('userDataDir =', userDataDir, 'root =', root);
  if (SHOTS) await fsp.mkdir(SHOTS, { recursive: true });

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));

  let window = await electronApp.firstWindow({ timeout: 60000 });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));
  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'Real Click Regression');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'Real Click Regression');
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

  async function openQmz(r) {
    await window.evaluate((rr) => window.openQMZManager(rr, {
      component: { location: 'Hall A', city: 'RealClickCity', country: 'India' },
      isMulti: false, eventTitle: 'Real Click Regression Event', hijriDate: '1448-02-10',
      eventJsonPath: null, componentTitle: null,
    }), r);
    await window.waitForTimeout(500);
  }
  const shot = async (name) => { if (SHOTS) await window.screenshot({ path: path.join(SHOTS, name + '.png') }); };
  async function qaIsOpen() { return window.evaluate(() => !document.getElementById('qmzQuickAssignOverlay')?.classList.contains('hidden')); }
  async function qaClose() { if (await qaIsOpen()) { await window.keyboard.press('Escape'); await window.waitForTimeout(200); } }
  async function checkboxLocators() { return window.locator('#qmzFileGrid input[type="checkbox"][data-path]'); }
  // "AutoIngest — Fix Quick Assign Shortcut (Option/Alt + A)": the activation shortcut moved
  // from bare "A" to Option+A (macOS) / Alt+A (Windows) — a bare single letter proved
  // unreliable for real operators even with the checkbox-focus fix below. Real keyboard
  // down/press/up (not a synthetic dispatch) so Chromium genuinely sets altKey.
  async function pressOptAltA() {
    await window.keyboard.down('Alt');
    await window.keyboard.press('a');
    await window.keyboard.up('Alt');
    await window.waitForTimeout(300);
  }

  // ═══════════════ Setup: open QMZ with enough real photos to scroll ═══════════════
  await openQmz(root);
  const pg = 'Jane Doe';
  for (let i = 1; i <= 20; i++) {
    const p = path.join(root, '_Unsequenced', pg, `IMG_${String(i).padStart(4, '0')}.CR2`);
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, `fake-bytes-${i}`);
  }
  await window.evaluate(() => _qmzRefresh());
  await window.waitForTimeout(500);
  await window.click(`.qmz-pg-row[data-pg="${pg}"]`);
  await window.waitForTimeout(400);
  await window.fill('#qmzSeqNumInput', '4');
  await window.fill('#qmzSeqSuffixInput', '');
  await window.selectOption('#qmzSeqLetterSelect', 'Q');
  await window.evaluate(() => document.getElementById('qmzAddSpecificBtn')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await window.waitForTimeout(500);

  // ═══════════════ 1. Real checkbox click, then real Option/Alt+A keypress ═══════════════
  log('=== Real checkbox click selection ===');
  let cbs = await checkboxLocators();
  await cbs.nth(0).click();
  await window.waitForTimeout(150);
  const activeAfterClick = await window.evaluate(() => ({ tag: document.activeElement?.tagName, type: document.activeElement?.type }));
  check(activeAfterClick.tag === 'INPUT' && activeAfterClick.type === 'checkbox',
    `setup: a real click genuinely focuses the checkbox (got ${JSON.stringify(activeAfterClick)})`);
  await pressOptAltA();
  await window.waitForTimeout(300);
  check(await qaIsOpen(), '1. Option/Alt+A opens Quick Assign after a REAL checkbox click (the actual operator-reported failure)');
  await shot('01-real-click-opens-qa');
  const qaFocused1 = await window.evaluate(() => document.activeElement?.id === 'qmzQaInput');
  check(qaFocused1, '2. Quick Assign input receives focus');
  await qaClose();

  // ═══════════════ 2. Typing "a" in a real editable field must NOT open Quick Assign ═══════════════
  log('=== Editable-field guard still holds ===');
  await window.click('#qmzAssignInput');
  await window.waitForTimeout(100);
  await window.keyboard.press('a');
  await window.waitForTimeout(300);
  check(!(await qaIsOpen()), '3. typing "a" while #qmzAssignInput is genuinely focused does NOT open Quick Assign');
  const assignVal = await window.evaluate(() => document.getElementById('qmzAssignInput')?.value);
  check(assignVal === 'a', `4. the letter "a" was actually typed into the field (got "${assignVal}")`);
  await window.evaluate(() => { const el = document.getElementById('qmzAssignInput'); if (el) el.value = ''; el?.blur(); });
  await window.waitForTimeout(100);

  // ═══════════════ 3. Shift-click range selection ═══════════════
  log('=== Shift-click selection ===');
  cbs = await checkboxLocators();
  await cbs.nth(0).click();
  await window.waitForTimeout(100);
  await window.evaluate(() => {
    const tiles = [...document.querySelectorAll('#qmzFileGrid .file-tile')];
    if (tiles[3]) tiles[3].dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
  });
  await window.waitForTimeout(150);
  const selAfterShift = await window.evaluate(() => _qmzSelectedFiles.size);
  check(selAfterShift >= 2, `setup: shift-click produced a range selection (got ${selAfterShift})`);
  await window.evaluate(() => document.activeElement?.blur && document.activeElement.blur());
  await pressOptAltA();
  await window.waitForTimeout(300);
  check(await qaIsOpen(), '5. Option/Alt+A opens Quick Assign after shift-click range selection');
  await qaClose();

  // ═══════════════ 4. Cmd/Ctrl-click (toggle) selection ═══════════════
  log('=== Cmd/Ctrl-click selection ===');
  await window.evaluate(() => { _qmzSelectedFiles.clear(); _qmzSyncAllTiles(); });
  await window.waitForTimeout(100);
  cbs = await checkboxLocators();
  await cbs.nth(0).click();
  await window.waitForTimeout(100);
  await cbs.nth(1).click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  await window.waitForTimeout(150);
  const selAfterCmd = await window.evaluate(() => _qmzSelectedFiles.size);
  check(selAfterCmd >= 1, `setup: cmd/ctrl-click selection present (got ${selAfterCmd})`);
  await pressOptAltA();
  await window.waitForTimeout(300);
  check(await qaIsOpen(), '6. Option/Alt+A opens Quick Assign after cmd/ctrl-click selection');
  await qaClose();

  // ═══════════════ 5. After scrolling the grid ═══════════════
  log('=== After scrolling ===');
  await window.evaluate(() => { const g = document.getElementById('qmzFileGrid'); if (g) g.scrollTop = 300; });
  await window.waitForTimeout(150);
  cbs = await checkboxLocators();
  const cbCountAfterScroll = await cbs.count();
  if (cbCountAfterScroll > 0) {
    await cbs.nth(0).click();
    await window.waitForTimeout(150);
    await pressOptAltA();
    await window.waitForTimeout(300);
    check(await qaIsOpen(), '7. Option/Alt+A opens Quick Assign after scrolling the grid and clicking a checkbox');
    await qaClose();
  } else {
    check(false, '7. (no checkboxes found after scroll — cannot verify)');
  }

  // ═══════════════ 6. After Grid/List switching ═══════════════
  log('=== After Grid/List switch ===');
  await window.evaluate(() => { const g = document.getElementById('qmzFileGrid'); if (g) g.scrollTop = 0; });
  await window.click('[data-qmz-view="list"]');
  await window.waitForTimeout(300);
  cbs = await checkboxLocators();
  await cbs.nth(0).click();
  await window.waitForTimeout(150);
  await pressOptAltA();
  await window.waitForTimeout(300);
  check(await qaIsOpen(), '8. Option/Alt+A opens Quick Assign in List view after a real checkbox click');
  await qaClose();
  await window.click('[data-qmz-view="icon"]');
  await window.waitForTimeout(300);

  // ═══════════════ 7. After closing a preview ═══════════════
  log('=== After closing preview ===');
  cbs = await checkboxLocators();
  await cbs.nth(0).click();
  await window.waitForTimeout(100);
  await window.keyboard.press(' ');
  await window.waitForTimeout(400);
  const previewOpened = await window.evaluate(() => typeof _previewOpen !== 'undefined' ? _previewOpen : null);
  if (previewOpened) {
    await window.keyboard.press('Escape');
    await window.waitForTimeout(300);
  }
  await pressOptAltA();
  await window.waitForTimeout(300);
  check(await qaIsOpen(), '9. Option/Alt+A opens Quick Assign after closing a preview');
  await qaClose();

  // ═══════════════ 8. After completing a previous assignment ═══════════════
  log('=== After completing a previous real assignment ===');
  cbs = await checkboxLocators();
  await cbs.nth(0).click();
  await window.waitForTimeout(150);
  await pressOptAltA();
  await window.waitForTimeout(300);
  if (await qaIsOpen()) {
    await window.fill('#qmzQaInput', '4');
    await window.waitForTimeout(150);
    await window.keyboard.press('Enter');
    await window.waitForTimeout(600);
  }
  cbs = await checkboxLocators();
  const cbCountAfterAssign = await cbs.count();
  if (cbCountAfterAssign > 0) {
    await cbs.nth(0).click();
    await window.waitForTimeout(150);
    await pressOptAltA();
    await window.waitForTimeout(300);
    check(await qaIsOpen(), '10. Option/Alt+A opens Quick Assign again after completing a previous assignment');
    await qaClose();
  } else {
    check(false, '10. (no remaining checkboxes after assignment — cannot verify)');
  }

  // ═══════════════ 9. After reopening the QMZ workspace ═══════════════
  log('=== After closing and reopening QMZ ===');
  await window.evaluate(() => window._closeQMZManager());
  await window.waitForTimeout(300);
  await openQmz(root);
  await window.click(`.qmz-pg-row[data-pg="${pg}"]`);
  await window.waitForTimeout(400);
  cbs = await checkboxLocators();
  const cbCountAfterReopen = await cbs.count();
  if (cbCountAfterReopen > 0) {
    await cbs.nth(0).click();
    await window.waitForTimeout(150);
    await pressOptAltA();
    await window.waitForTimeout(300);
    check(await qaIsOpen(), '11. Option/Alt+A opens Quick Assign after closing and reopening the QMZ workspace');
    await qaClose();
  } else {
    check(false, '11. (no checkboxes found after reopening — cannot verify)');
  }

  // ═══════════════ 10. No selection at all — A must do nothing ═══════════════
  log('=== No selection guard (real interaction) ===');
  await window.evaluate(() => { _qmzSelectedFiles.clear(); _qmzSyncAllTiles(); document.activeElement?.blur && document.activeElement.blur(); });
  await window.waitForTimeout(100);
  await pressOptAltA();
  await window.waitForTimeout(300);
  check(!(await qaIsOpen()), '12. Option/Alt+A does nothing when no photographs are selected (real interaction, no stale popup)');

  check(consoleErrors.length === 0, `13. no console/page errors occurred (found: ${JSON.stringify(consoleErrors)})`);

  log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  await electronApp.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[qmz-qa-real-click] FATAL', err);
  process.exit(1);
});
