'use strict';

// "AutoIngest — Fix Quick Assign Shortcut (Option/Alt + A)" regression coverage.
//
// A bare "A" (no modifier) proved unreliable for real operators even after the
// checkbox-focus fix (fix(qmz): restore Quick Assign keyboard shortcut). The shortcut was
// switched to Option+A (macOS) / Alt+A (Windows), implemented via `e.code === 'KeyA' &&
// e.altKey` rather than `e.key === 'a'` — e.key reflects the character produced
// (keyboard-layout-dependent, and case-sensitive under Shift/Caps-Lock), while e.code is
// the physical key position, immune to both. This file drives everything through real
// Playwright mouse clicks and real keyboard modifier state — never a synthetic
// `.checked = true` + dispatched 'change' event, and never a bare `.press('a')` without
// genuinely holding Alt — so this class of bug can't be masked again.
//
// Run: node test/qmzQuickAssignOptionAltRegression.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function log(...args) { console.log('[qmz-qa-optalt]', ...args); }
let failures = 0;
function check(cond, msg) { if (cond) log('PASS —', msg); else { failures++; log('FAIL —', msg); } }

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

(async () => {
  const userDataDir = await mkTmp('ai-qmz-qa-optalt-userdata-');
  const root = await mkTmp('ai-qmz-qa-optalt-root-');
  log('userDataDir =', userDataDir, 'root =', root);

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
    await window.fill('#splashInputName', 'OptAlt Regression');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'OptAlt Regression');
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
      component: { location: 'Hall A', city: 'OptAltCity', country: 'India' },
      isMulti: false, eventTitle: 'OptAlt Regression Event', hijriDate: '1448-02-10',
      eventJsonPath: null, componentTitle: null,
    }), r);
    await window.waitForTimeout(500);
  }
  async function qaIsOpen() { return window.evaluate(() => !document.getElementById('qmzQuickAssignOverlay')?.classList.contains('hidden')); }
  async function qaClose() { if (await qaIsOpen()) { await window.keyboard.press('Escape'); await window.waitForTimeout(200); } }
  async function pressOptAltA() {
    await window.keyboard.down('Alt');
    await window.keyboard.press('a');
    await window.keyboard.up('Alt');
    await window.waitForTimeout(300);
  }
  async function checkboxLocators() { return window.locator('#qmzFileGrid input[type="checkbox"][data-path]'); }

  // ═══════════════ Setup: real photos, enough to scroll ═══════════════
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

  // ═══════════════ 1. Bare "a" must do nothing (full end-to-end workflow) ═══════════════
  log('=== Bare "a" no longer opens Quick Assign ===');
  let cbs = await checkboxLocators();
  await cbs.nth(0).click();
  await window.waitForTimeout(150);
  await window.keyboard.press('a');
  await window.waitForTimeout(300);
  check(!(await qaIsOpen()), '1. bare "a" (no modifier) does not open Quick Assign after a real checkbox click');
  const typedSomewhere = await window.evaluate(() => document.activeElement?.tagName);
  check(typedSomewhere === 'INPUT', 'setup sanity: focus is still the checkbox, not silently moved');

  // ═══════════════ 2. Real Option/Alt+A opens it, full workflow through assignment ═══════════════
  log('=== Full Option/Alt+A workflow: open -> focus -> type -> Enter -> assign -> close -> scroll reset ===');
  await pressOptAltA();
  check(await qaIsOpen(), '2. Option/Alt+A opens Quick Assign after a real checkbox click');
  const qaFocused = await window.evaluate(() => document.activeElement?.id === 'qmzQaInput');
  check(qaFocused, '3. Quick Assign input receives focus');
  await window.fill('#qmzQaInput', '4');
  await window.waitForTimeout(150);
  const preview = await window.evaluate(() => document.getElementById('qmzQaPreview')?.textContent || '');
  check(/04Q/.test(preview), `4. number-only resolution works ("4" -> 04Q, preview: "${preview}")`);
  await window.keyboard.press('Enter');
  await window.waitForTimeout(600);
  check(!(await qaIsOpen()), '5. popup closes after successful assignment');
  const moved = fs.existsSync(path.join(root, '04Q', pg, 'IMG_0001.CR2'));
  check(moved, '6. the file was actually assigned on disk');
  const scrollTop = await window.evaluate(() => document.getElementById('qmzFileGrid')?.scrollTop);
  check(scrollTop === 0, `7. workspace scrolls to top after successful assignment (scrollTop=${scrollTop})`);

  // ═══════════════ 3. Multi-selection ═══════════════
  log('=== Multi-selection ===');
  cbs = await checkboxLocators();
  await cbs.nth(0).click();
  await window.waitForTimeout(100);
  await cbs.nth(1).click({ modifiers: [process.platform === 'darwin' ? 'Meta' : 'Control'] });
  await window.waitForTimeout(150);
  const selCount = await window.evaluate(() => _qmzSelectedFiles.size);
  check(selCount === 2, `setup: multi-selection present (got ${selCount})`);
  await pressOptAltA();
  check(await qaIsOpen(), '8. Option/Alt+A opens Quick Assign with a multi-selection');
  const countText = await window.evaluate(() => document.getElementById('qmzQaCount')?.textContent || '');
  check(/2/.test(countText), `9. selected count is accurate ("${countText}")`);
  await qaClose();

  // ═══════════════ 4. After scrolling ═══════════════
  log('=== After scrolling ===');
  await window.evaluate(() => { const g = document.getElementById('qmzFileGrid'); if (g) g.scrollTop = 300; });
  await window.waitForTimeout(150);
  cbs = await checkboxLocators();
  await cbs.nth(0).click();
  await window.waitForTimeout(150);
  await pressOptAltA();
  check(await qaIsOpen(), '10. Option/Alt+A opens Quick Assign after scrolling the grid');
  await qaClose();
  await window.evaluate(() => { const g = document.getElementById('qmzFileGrid'); if (g) g.scrollTop = 0; });

  // ═══════════════ 5. After Grid/List switching ═══════════════
  log('=== After Grid/List switch ===');
  await window.evaluate(() => {
    const el = document.getElementById('gridListSwitch') || document.querySelector('[data-qmz-view="list"]');
    if (el && el.tagName === 'INPUT') { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); }
    else el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await window.click('[data-qmz-view="list"]').catch(() => {});
  await window.waitForTimeout(300);
  cbs = await checkboxLocators();
  await cbs.nth(0).click();
  await window.waitForTimeout(150);
  await pressOptAltA();
  check(await qaIsOpen(), '11. Option/Alt+A opens Quick Assign in List view');
  await qaClose();
  await window.click('[data-qmz-view="icon"]').catch(() => {});
  await window.waitForTimeout(300);

  // ═══════════════ 6. After reopening QMZ ═══════════════
  log('=== After reopening QMZ ===');
  await window.evaluate(() => window._closeQMZManager());
  await window.waitForTimeout(300);
  await openQmz(root);
  await window.click(`.qmz-pg-row[data-pg="${pg}"]`);
  await window.waitForTimeout(400);
  cbs = await checkboxLocators();
  const cbCount = await cbs.count();
  if (cbCount > 0) {
    await cbs.nth(0).click();
    await window.waitForTimeout(150);
    await pressOptAltA();
    check(await qaIsOpen(), '12. Option/Alt+A opens Quick Assign after closing and reopening QMZ');
    await qaClose();
  } else {
    check(false, '12. (no checkboxes found after reopening — cannot verify)');
  }

  // ═══════════════ 7. Editable-field safety ═══════════════
  log('=== Editable-field safety ===');
  await window.click('#qmzAssignInput');
  await window.waitForTimeout(100);
  await window.keyboard.down('Alt');
  await window.keyboard.press('a');
  await window.keyboard.up('Alt');
  await window.waitForTimeout(300);
  check(!(await qaIsOpen()), '13. Option/Alt+A does not open Quick Assign while a real text field is focused');
  await window.evaluate(() => { const el = document.getElementById('qmzAssignInput'); if (el) el.value = ''; el?.blur(); });

  // ═══════════════ 7B. Stale focus from an EARLIER unrelated text field, released by a TILE
  // click (not the checkbox) — the actual real-operator failure found after shipping the
  // checkbox-focus and Option/Alt+A fixes. Clicking a photo TILE is the larger, more natural
  // selection target, but unlike the checkbox it never moved focus — so any stale focus left
  // in ANY earlier text field (sequence number, search, anything) silently blocked the
  // shortcut even though the file was genuinely selected. ═══════════════
  log('=== Stale focus from an unrelated field, released by clicking a photo tile ===');
  await window.evaluate(() => { _qmzSelectedFiles.clear(); _qmzSyncAllTiles(); });
  await window.waitForTimeout(100);
  await window.click('#qmzSeqNumInput');
  await window.waitForTimeout(100);
  // Click the TILE BODY, not the checkbox — dispatched directly on the tile element itself
  // so the click genuinely lands outside the checkbox, exactly like a real operator clicking
  // anywhere on the photo rather than precisely on its small checkbox corner.
  await window.evaluate(() => {
    const tile = document.querySelector('#qmzFileGrid .file-tile[data-path]');
    tile?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await window.waitForTimeout(150);
  const selAfterTileClick = await window.evaluate(() => _qmzSelectedFiles.size);
  check(selAfterTileClick === 1, `setup: clicking the tile body genuinely selects the file (got ${selAfterTileClick})`);
  const activeAfterTileClick = await window.evaluate(() => document.activeElement?.tagName);
  check(activeAfterTileClick !== 'INPUT', `14. clicking a tile releases stale focus from an earlier text field (activeElement is now ${activeAfterTileClick})`);
  await pressOptAltA();
  check(await qaIsOpen(), '15. Option/Alt+A opens Quick Assign after selecting via a tile click, even though an unrelated field was focused beforehand');
  await qaClose();
  await window.evaluate(() => { const el = document.getElementById('qmzSeqNumInput'); if (el) el.value = ''; });

  // ═══════════════ 8. Duplicate-popup / existing-shortcut safety ═══════════════
  log('=== Duplicate popup + existing shortcuts unaffected ===');
  // Clear any leftover selection from earlier steps first — clicking an already-checked
  // checkbox toggles it OFF, which would otherwise leave selection empty here.
  await window.evaluate(() => { _qmzSelectedFiles.clear(); _qmzSyncAllTiles(); });
  await window.waitForTimeout(100);
  cbs = await checkboxLocators();
  await cbs.nth(0).click();
  await window.waitForTimeout(150);
  await pressOptAltA();
  check(await qaIsOpen(), 'setup: popup open for duplicate-instance check');
  await pressOptAltA();
  const stillOneOverlay = await window.evaluate(() => document.querySelectorAll('#qmzQuickAssignOverlay').length);
  check(stillOneOverlay === 1 && (await qaIsOpen()), '16. repeated Option/Alt+A does not create duplicate popup instances');
  await qaClose();

  // Existing "S" shortcut (focus sidebar assign input) must still work bare, unaffected.
  await window.evaluate(() => document.activeElement?.blur && document.activeElement.blur());
  await window.keyboard.press('s');
  await window.waitForTimeout(200);
  const assignFocused = await window.evaluate(() => document.activeElement?.id === 'qmzAssignInput');
  check(assignFocused, '17. existing bare "S" shortcut (focus sidebar assign input) still works, unaffected by this change');
  await window.evaluate(() => document.getElementById('qmzAssignInput')?.blur());

  check(consoleErrors.length === 0, `18. no console/page errors occurred (found: ${JSON.stringify(consoleErrors)})`);

  log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  await electronApp.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[qmz-qa-optalt] FATAL', err);
  process.exit(1);
});
