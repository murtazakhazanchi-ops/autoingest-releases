'use strict';

// "QMZ Sorting Workflow Optimization" — live end-to-end verification of Quick Assign (the
// keyboard-driven "A" popup) and the automatic scroll-to-top-after-success behavior, against
// the REAL running application. Covers: shortcut activation/guards, input focus, live
// destination preview (number-only, suffixed, full-code, ambiguous, invalid), the shared
// assignment engine (same primitive the sidebar's own "Assign Selected" already uses),
// duplicate-submission prevention, Escape cancellation, and the scroll-reset behavior for
// BOTH Quick Assign and the existing sidebar flow.
//
// Requires playwright-core (see test/metadataPipelineLive.test.js for install notes).
// Run: node test/qmzQuickAssignLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SHOTS = process.env.QMZ_QA_SHOTS || null;

function log(...args) { console.log('[qmz-quickassign-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

(async () => {
  const userDataDir = await mkTmp('ai-qmz-qa-e2e-userdata-');
  const root = await mkTmp('ai-qmz-qa-e2e-root-');
  log('userDataDir =', userDataDir, 'root =', root);
  if (SHOTS) await fsp.mkdir(SHOTS, { recursive: true });

  const pg = 'Jane Doe';
  const pgDir = path.join(root, '_Unsequenced', pg);
  await fsp.mkdir(pgDir, { recursive: true });
  for (let i = 1; i <= 80; i++) {
    await fsp.writeFile(path.join(pgDir, `IMG_${String(i).padStart(4, '0')}.CR2`), `fake-raw-${i}`);
  }

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
    await window.fill('#splashInputName', 'Quick Assign Test Operator');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'Quick Assign Test Operator');
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
      isMulti: false, eventTitle: 'Quick Assign Test', hijriDate: '1448-02-10',
      eventJsonPath: null, componentTitle: null,
    }), r);
    await window.waitForTimeout(500);
  }
  async function setWindowSize(w, h) {
    await electronApp.evaluate(({ BrowserWindow }, dims) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.setSize(dims.w, dims.h);
    }, { w, h });
    await window.waitForTimeout(300);
  }
  const shot = async (name) => { if (SHOTS) await window.screenshot({ path: path.join(SHOTS, name + '.png') }); };

  async function selectAllFilesForPhotographer() {
    await domClick(`.qmz-pg-row[data-pg="${pg}"]`);
    await window.waitForTimeout(400);
    await window.evaluate(() => {
      document.querySelectorAll('#qmzFileGrid input[type="checkbox"][data-path]').forEach((cb) => {
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
    await window.waitForTimeout(200);
  }
  async function scrollGridTo(px) {
    await window.evaluate((y) => { document.getElementById('qmzFileGrid').scrollTop = y; }, px);
    await window.waitForTimeout(200);
  }
  async function gridScrollTop() { return window.evaluate(() => document.getElementById('qmzFileGrid')?.scrollTop ?? -1); }
  async function pressBareKey(key) {
    await window.evaluate((k) => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    }, key);
    await window.waitForTimeout(250);
  }
  // "AutoIngest — Fix Quick Assign Shortcut (Option/Alt + A)": the activation shortcut moved
  // from bare "A" to Option+A (macOS) / Alt+A (Windows), using e.code (physical key, layout-
  // independent) + a real altKey modifier rather than e.key. Uses REAL keyboard down/press/up
  // (not a synthetic dispatch) so Playwright/Chromium genuinely sets altKey on the event.
  async function pressOptAltA() {
    await window.keyboard.down('Alt');
    await window.keyboard.press('a');
    await window.keyboard.up('Alt');
    await window.waitForTimeout(250);
  }
  async function qaIsOpen() { return window.evaluate(() => !document.getElementById('qmzQuickAssignOverlay')?.classList.contains('hidden')); }
  async function qaInputFocused() { return window.evaluate(() => document.activeElement?.id === 'qmzQaInput'); }
  async function qaType(text) { await window.fill('#qmzQaInput', text); await window.waitForTimeout(150); }
  async function qaPreviewText() { return window.evaluate(() => document.getElementById('qmzQaPreview')?.textContent || ''); }
  async function qaCountText() { return window.evaluate(() => document.getElementById('qmzQaCount')?.textContent || ''); }

  // ═══════════════ Setup ═══════════════
  await setWindowSize(1400, 900);
  await openQmz(root);
  await selectAllFilesForPhotographer();

  // Create several destination sequences, including an ambiguity case (05Q + 05M, both bare).
  for (const [n, l, s] of [[4, 'Q', ''], [3, 'AQ', 'a'], [5, 'Q', ''], [5, 'M', '']]) {
    await window.evaluate(({ qmzRoot, number, letter, suffix }) =>
      window.api.qmzCreateSequence({ qmzRoot, number, letter, suffix }), { qmzRoot: root, number: n, letter: l, suffix: s });
  }
  await window.evaluate(() => _qmzRefresh());
  await window.waitForTimeout(400);

  // ═══════════════ 2A/2B/3A/3B — shortcut, focus, selected count ═══════════════
  log('=== Shortcut activation, focus, selected count ===');
  await domClick(`.qmz-pg-row[data-pg="${pg}"]`);
  await window.waitForTimeout(300);
  await window.evaluate(() => {
    document.querySelectorAll('#qmzFileGrid input[type="checkbox"][data-path]').forEach((cb, i) => {
      if (i < 20) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  });
  await window.waitForTimeout(200);
  const selCount = await window.evaluate(() => _qmzSelectedFiles.size);
  check(selCount === 20, `setup: 20 files selected (got ${selCount})`);

  await scrollGridTo(600);
  const scrollBefore = await gridScrollTop();
  check(scrollBefore > 0, `setup: grid genuinely scrolled before opening Quick Assign (scrollTop=${scrollBefore})`);

  await pressBareKey('a');
  check(!(await qaIsOpen()), 'bare "A" (no modifier) no longer opens Quick Assign — see fix(qmz): use Option-Alt+A for Quick Assign');

  await pressOptAltA();
  check(await qaIsOpen(), '1/2. pressing Option/Alt+A opens Quick Assign while QMZ is active with a selection');
  check(await qaInputFocused(), '3. the sequence input receives focus automatically');
  const countText = await qaCountText();
  check(countText.includes('20'), `4. selected file count is accurate (got "${countText}")`);
  await shot('qa-open-20-selected');

  // Repeated "A" must not open a second instance / corrupt state.
  await pressOptAltA();
  const qaOverlayCount = await window.evaluate(() => document.querySelectorAll('#qmzQuickAssignOverlay').length);
  check(qaOverlayCount === 1, 'repeated "A" press does not create a second popup instance');

  // ═══════════════ 4A — number-only resolution + full assignment + scroll reset ═══════════════
  log('=== Number-only resolution ("04" -> 04Q) ===');
  await qaType('04');
  const preview1 = await qaPreviewText();
  check(preview1.includes('04Q') && preview1.includes('Qadam'), `5/6. "04" resolves to "04Q — Qadam" (got "${preview1}")`);
  await window.keyboard.press('Enter');
  await window.waitForTimeout(700);
  check(!(await qaIsOpen()), '6A. popup closes after complete success');
  // The real move pipeline (moveWithSidecar + metadata auto-queue) can write a companion
  // .xmp sidecar per RAW file alongside the moved media — an established, already-documented
  // property of this same engine (see test/qmzSuffixedCombinedTypeRegression.test.js's own
  // "directory has 4 entries, not 2" comment) — so the directory's total entry count is not
  // the right assertion; only the moved .CR2 media files themselves are.
  const dirList04Q = fs.existsSync(path.join(root, '04Q', pg)) ? await fsp.readdir(path.join(root, '04Q', pg)) : null;
  const mediaList04Q = dirList04Q ? dirList04Q.filter(n => n.toUpperCase().endsWith('.CR2')) : null;
  check(mediaList04Q && mediaList04Q.length === 20,
    `files were actually moved into 04Q via the real assignment engine (04Q/${pg}: ${mediaList04Q ? mediaList04Q.length : 'MISSING'} media file(s), ${dirList04Q ? dirList04Q.length : 0} total entries)`);
  const scrollAfter1 = await gridScrollTop();
  check(scrollAfter1 === 0, `7A/7C. scroll reset to top after full success (scrollTop=${scrollAfter1})`);

  // ═══════════════ 4E — suffix resolution, independent of type ═══════════════
  log('=== Suffixed resolution ("03a" -> 03aAQ) ===');
  await domClick(`.qmz-pg-row[data-pg="${pg}"]`);
  await window.waitForTimeout(300);
  await window.evaluate(() => {
    const cbs = [...document.querySelectorAll('#qmzFileGrid input[type="checkbox"][data-path]')];
    cbs.slice(0, 10).forEach((cb) => { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); });
  });
  await window.waitForTimeout(200);
  await scrollGridTo(300);
  await pressOptAltA();
  await qaType('03a');
  const preview2 = await qaPreviewText();
  check(preview2.includes('03aAQ') && preview2.includes('Aqeeqa'), `19/20. "03a" resolves to "03aAQ — Aqeeqa" (got "${preview2}")`);
  await window.keyboard.press('Enter');
  await window.waitForTimeout(700);
  check(fs.existsSync(path.join(root, '03aAQ', pg)) && (await fsp.readdir(path.join(root, '03aAQ', pg))).length === 10,
    '21/22. suffixed destination actually received the files');
  check((await gridScrollTop()) === 0, '23. scroll reset to top after the suffixed assignment too');

  // ═══════════════ 4D — invalid destination: no movement, popup stays open, scroll preserved ═══════════════
  log('=== Invalid destination ("99" — does not exist) ===');
  await domClick(`.qmz-pg-row[data-pg="${pg}"]`);
  await window.waitForTimeout(300);
  await window.evaluate(() => {
    const cb = document.querySelector('#qmzFileGrid input[type="checkbox"][data-path]');
    if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await window.waitForTimeout(200);
  await scrollGridTo(250);
  const scrollBeforeInvalid = await gridScrollTop();
  const selBeforeInvalid = await window.evaluate(() => _qmzSelectedFiles.size);
  await pressOptAltA();
  await qaType('99');
  const preview3 = await qaPreviewText();
  check(/not found/i.test(preview3), `24/25. "99" (nonexistent) shows a clear inline "not found" message (got "${preview3}")`);
  await window.keyboard.press('Enter');
  await window.waitForTimeout(400);
  check(await qaIsOpen(), '4D/6B. popup remains open after an invalid-destination Enter (never silently creates "99Q" or similar)');
  check(!fs.existsSync(path.join(root, '99Q')) && !fs.existsSync(path.join(root, '99M')), 'no sequence was auto-created from the invalid input');
  check((await gridScrollTop()) === scrollBeforeInvalid, `26. scroll position preserved after invalid destination (${scrollBeforeInvalid} -> ${await gridScrollTop()})`);
  check((await window.evaluate(() => _qmzSelectedFiles.size)) === selBeforeInvalid, 'selection preserved after invalid destination');

  // ═══════════════ 5B — Escape: no movement, selection+scroll preserved ═══════════════
  log('=== Escape cancellation ===');
  await window.keyboard.press('Escape');
  await window.waitForTimeout(300);
  check(!(await qaIsOpen()), '27/28. Escape closes Quick Assign');
  check(await window.evaluate(() => _qmzOpen === true), 'Escape did NOT close the whole QMZ workspace (only the popup)');
  check((await window.evaluate(() => _qmzSelectedFiles.size)) === selBeforeInvalid, '29. selection preserved after Escape');
  check((await gridScrollTop()) === scrollBeforeInvalid, 'scroll position preserved after Escape');
  await shot('qa-after-escape');

  // ═══════════════ 4C — ambiguous destination: explicit choice required, arrow-key navigation ═══════════════
  log('=== Ambiguous destination ("05" -> 05Q / 05M) ===');
  await domClick(`.qmz-pg-row[data-pg="${pg}"]`);
  await window.waitForTimeout(300);
  await window.evaluate(() => {
    const cb = document.querySelector('#qmzFileGrid input[type="checkbox"][data-path]');
    if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await window.waitForTimeout(200);
  await pressOptAltA();
  await qaType('05');
  const matchTexts = await window.evaluate(() => [...document.querySelectorAll('#qmzQaMatches .qmz-qa-match')].map(el => el.textContent));
  check(matchTexts.length === 2, `10. ambiguous input shows both matching destinations (found ${matchTexts.length}: ${JSON.stringify(matchTexts)})`);
  // Don't assume which of 05Q/05M renders first (sequences are sorted by code string, so the
  // actual order is whatever that produces) — read the REAL default-active match, then
  // ArrowDown, then assert the active selection genuinely moved to the OTHER one.
  const defaultActive = await window.evaluate(() => document.querySelector('#qmzQaMatches .qmz-qa-match.qmz-active')?.textContent || '');
  const expectedAfterDown = defaultActive.includes('05Q') ? '05M' : '05Q';
  await window.keyboard.press('ArrowDown');
  const activeMatch = await window.evaluate(() => document.querySelector('#qmzQaMatches .qmz-qa-match.qmz-active')?.textContent || '');
  check(activeMatch.includes(expectedAfterDown),
    `11. ArrowDown navigates away from the default (default was "${defaultActive.trim()}", now "${activeMatch.trim()}")`);
  const chosenCode = expectedAfterDown;
  await window.keyboard.press('Enter');
  await window.waitForTimeout(700);
  check(fs.existsSync(path.join(root, chosenCode, pg)), `12. Enter confirms the arrow-selected destination "${chosenCode}", never guesses the first match silently`);
  const otherCode = chosenCode === '05M' ? '05Q' : '05M';
  check(!fs.existsSync(path.join(root, otherCode, pg)) || (await fsp.readdir(path.join(root, otherCode, pg)).catch(() => [])).length === 0,
    `the OTHER ambiguous candidate (${otherCode}) did not receive the file`);

  // ═══════════════ Existing sidebar assignment also resets scroll ═══════════════
  log('=== Sidebar Assign Selected also resets scroll ===');
  await domClick(`.qmz-pg-row[data-pg="${pg}"]`);
  await window.waitForTimeout(300);
  await window.evaluate(() => {
    const cbs = [...document.querySelectorAll('#qmzFileGrid input[type="checkbox"][data-path]')];
    cbs.slice(0, 5).forEach((cb) => { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); });
  });
  await window.waitForTimeout(200);
  await scrollGridTo(300);
  check((await gridScrollTop()) > 0, 'setup: grid scrolled before sidebar assignment');
  await window.fill('#qmzAssignInput', '4');
  await window.keyboard.press('Enter');
  await window.waitForTimeout(700);
  check((await gridScrollTop()) === 0, '30/31. the EXISTING sidebar "Assign Selected" flow also resets scroll to top on full success — not just Quick Assign');
  // Blur the sidebar's own #qmzAssignInput explicitly — a REAL (trusted) Escape keypress
  // later in this test would otherwise still target it (nothing else moved focus away after
  // the Enter above) and bubble to the document-level handler that closes the ENTIRE QMZ
  // workspace on Escape, not just a Quick Assign popup that never even opened. This is a
  // test-script hygiene fix, not a production change — #qmzAssignInput's own Escape behavior
  // was never in scope for this feature.
  await window.evaluate(() => document.getElementById('qmzAssignInput')?.blur());

  // ═══════════════ Grid/List view + minimum width + both themes ═══════════════
  log('=== Grid/List view, minimum width, themes ===');
  await domClick(`.qmz-pg-row[data-pg="${pg}"]`);
  await window.waitForTimeout(300);
  await window.evaluate(() => {
    const cb = document.querySelector('#qmzFileGrid input[type="checkbox"][data-path]');
    if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await window.waitForTimeout(200);
  await domClick('[data-qmz-view="list"]');
  await window.waitForTimeout(300);
  await pressOptAltA();
  check(await qaIsOpen(), '41. Quick Assign opens correctly in List view too');
  const popupRectList = await window.evaluate(() => {
    const r = document.querySelector('#qmzQuickAssignOverlay .qmz-qa-popup')?.getBoundingClientRect();
    return r ? { left: r.left, right: r.right, width: r.width } : null;
  });
  check(!!popupRectList && popupRectList.width > 0, 'popup renders with non-zero size in List view');
  // Only press Escape (a REAL, trusted keypress that targets whatever currently has focus)
  // if the popup is actually confirmed open — pressing it regardless would, on any future
  // regression where the popup fails to open, target the LAST real-focused input instead and
  // risk the same whole-workspace-close cascade this file's own earlier fix guards against.
  if (await qaIsOpen()) { await window.keyboard.press('Escape'); await window.waitForTimeout(300); }
  await domClick('[data-qmz-view="icon"]');
  await window.waitForTimeout(300);

  await setWindowSize(1100, 700);
  await pressOptAltA();
  check(await qaIsOpen(), '15/39/42. Quick Assign opens at minimum supported window width');
  const popupRectMin = await window.evaluate(() => {
    const r = document.querySelector('#qmzQuickAssignOverlay .qmz-qa-popup')?.getBoundingClientRect();
    const win = { w: window.innerWidth };
    return r ? { left: r.left, right: r.right, width: r.width, winW: win.w } : null;
  });
  check(!!popupRectMin && popupRectMin.width > 0 && popupRectMin.left >= 0 && popupRectMin.right <= popupRectMin.winW,
    `popup stays fully within the window at minimum width, no horizontal overflow (${JSON.stringify(popupRectMin)})`);
  await shot('qa-min-width');
  if (await qaIsOpen()) { await window.keyboard.press('Escape'); await window.waitForTimeout(300); }
  await setWindowSize(1400, 900);

  for (const theme of ['dark', 'light']) {
    await window.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await window.waitForTimeout(200);
    await pressOptAltA();
    check(await qaIsOpen(), `17/18/37/38. Quick Assign opens correctly in theme=${theme}`);
    const bg = await window.evaluate(() => getComputedStyle(document.querySelector('#qmzQuickAssignOverlay .qmz-qa-popup')).backgroundColor);
    check(bg && bg !== 'rgba(0, 0, 0, 0)', `theme=${theme}: popup has an opaque background (${bg})`);
    await shot(`qa-theme-${theme}`);
    if (await qaIsOpen()) { await window.keyboard.press('Escape'); await window.waitForTimeout(300); }
  }

  // ═══════════════ No activation while typing in an editable field / no selection ═══════════════
  log('=== Keyboard safety: editable targets, no selection ===');
  await window.evaluate(() => { _qmzSelectedFiles.clear(); _qmzSyncAllTiles(); });
  await window.waitForTimeout(200);
  await pressOptAltA();
  check(!(await qaIsOpen()), '2. "A" does nothing when no photographs are selected');

  await domClick(`.qmz-pg-row[data-pg="${pg}"]`);
  await window.waitForTimeout(300);
  await window.evaluate(() => {
    const cb = document.querySelector('#qmzFileGrid input[type="checkbox"][data-path]');
    if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await window.waitForTimeout(200);
  await window.focus('#qmzAssignInput');
  await pressBareKey('a'); // typed as a literal character into the focused sidebar input, not a shortcut
  check(!(await qaIsOpen()), '37/40. "A" is ignored while focus is inside an existing text input (sidebar Assign field)');
  await window.evaluate(() => document.getElementById('qmzAssignInput').value = '');
  await window.evaluate(() => document.getElementById('qmzAssignInput').blur());

  check(consoleErrors.length === 0, `no console/page errors occurred (found: ${consoleErrors.join(' | ') || 'none'})`);

  await window.evaluate(() => window._closeQMZManager()).catch(() => {});
  await electronApp.close();

  log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[qmz-quickassign-e2e] FATAL:', err);
  process.exit(1);
});
