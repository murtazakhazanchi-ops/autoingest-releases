'use strict';

// "AutoIngest — QMZ Multi-Row PDF Parsing and Nikah Recognition Fix" — Phase 12: live
// Electron end-to-end coverage against a sanitized, entirely synthetic regression fixture,
// through the actual QMZ import-review UI (not just the parser in isolation — see
// test/qmzSanitizedFixtureAcceptance.test.js and test/qmzMultiRowNikahParsing.test.js for
// that). Isolated synthetic workspace; the fixture PDF itself is also fully synthetic — no
// real personal information anywhere in this test or its input.
//
// Run: node test/qmzMultiRowNikahLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');
const FIXTURE_PDF = path.join(__dirname, 'fixtures', 'qmz-synthetic-sample-route.pdf');

function log(...args) { console.log('[qmz-nikah-e2e]', ...args); }
let failures = 0;
function check(cond, msg) { if (cond) { log('PASS —', msg); } else { failures++; log('FAIL —', msg); } }

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

async function domClick(window, selector) {
  return window.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  }, selector);
}

(async () => {
  if (!fs.existsSync(FIXTURE_PDF)) {
    console.error(`FATAL: fixture not found at ${FIXTURE_PDF}`);
    process.exit(1);
  }

  const userDataDir = await mkTmp('ai-qmz-nikah-e2e-userdata-');
  const qmzRoot      = await mkTmp('ai-qmz-nikah-e2e-root-');

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));

  await electronApp.evaluate(async ({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dialog.__nextPath] });
  });
  async function setNextDialog(p) { await electronApp.evaluate(async ({ dialog }, pp) => { dialog.__nextPath = pp; }, p); }

  let window = await electronApp.firstWindow({ timeout: 60000 });
  window.on('console', msg => { if (msg.type() === 'error') log('[console.error]', msg.text()); });
  window.on('pageerror', err => log('[pageerror]', err.message, err.stack));
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));
  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'Nikah E2E Operator');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'Nikah E2E Operator');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  }
  window = await mainWindowPromise;
  window.on('console', msg => { if (msg.type() === 'error') log('[console.error]', msg.text()); });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);
  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));

  // ── 1. Open QMZ ──────────────────────────────────────────────────────────────────────────
  await window.evaluate((r) => window.openQMZManager(r, {
    component: { location: 'Hall A', city: null, country: 'India' },
    isMulti: false, eventTitle: 'Nikah Fix Verification Event', hijriDate: '1448-01-14',
    eventJsonPath: null, componentTitle: null,
  }), qmzRoot);
  await window.waitForTimeout(500);
  check(await window.evaluate(() => _qmzOpen === true), '1. QMZ opens against a real, synthetic workspace root');

  // ── 2-3. Open PDF import, select the sanitized synthetic PDF ────────────────────────────
  await setNextDialog(FIXTURE_PDF);
  await domClick(window, '#qmzImportPdfBtn');
  await window.waitForTimeout(1500);
  const reviewOpen = await window.evaluate(() => !document.getElementById('qmzPdfReviewOverlay')?.classList.contains('hidden'));
  check(reviewOpen === true, '2-3. the sanitized synthetic PDF is imported and the review UI opens');

  // ── 4. All 24 sequences appear ───────────────────────────────────────────────────────────
  const rowCount = await window.evaluate(() => document.querySelectorAll('#qprEntryList .qpr-entry-row').length);
  check(rowCount === 24, `4. all 24 sequences appear in the review list (got ${rowCount})`);

  // ── 5. Verify 02Z, 03Z, 04Q, 15Q, 23Q specifically ──────────────────────────────────────
  const foldersInList = await window.evaluate(() => [...document.querySelectorAll('#qprEntryList .qpr-folder-name')].map(el => el.textContent.replace('Nikah', '').trim()));
  for (const code of ['02Z', '03Z', '04Q', '15Q', '23Q']) {
    check(foldersInList.includes(code), `5. ${code} is present in the review list`);
  }
  check(foldersInList.length === 24, `5. exactly 24 folder codes rendered (got ${foldersInList.length})`);

  // ── 6. Five Nikah indicators, text-only, no emoji ───────────────────────────────────────
  const nikahBadges = await window.evaluate(() => [...document.querySelectorAll('#qprEntryList .qpr-nikah-badge')].map(el => el.textContent));
  check(nikahBadges.length === 5, `6. exactly five Nikah indicators are shown (got ${nikahBadges.length})`);
  check(nikahBadges.every(t => t === 'Nikah'), `6. every Nikah indicator reads exactly "Nikah" (got ${JSON.stringify(nikahBadges)})`);
  check(nikahBadges.every(t => !/[^\x00-\x7F]/.test(t)), '6. no emoji / non-ASCII character in the Nikah indicator');

  // ── 7. Warning text — informational Nikah summary, no false missing/unrecognized warnings ──
  const warningsText = await window.evaluate(() => document.getElementById('qprWarnings')?.textContent || '');
  check(warningsText.includes('5 sequences include Nikah'), `7a. the informational Nikah summary is shown (got: ${JSON.stringify(warningsText)})`);
  check(!warningsText.toLowerCase().includes('not applicable'), '7b. the incorrect "Not Applicable" interpretation is gone entirely');
  check(!warningsText.toLowerCase().includes('missing'), '7c. no false missing-sequence warning for this PDF');

  // ── 8. Select All ────────────────────────────────────────────────────────────────────────
  await domClick(window, '#qprSelectAllBtn');
  await window.waitForTimeout(200);
  let selCount = await window.evaluate(() => document.getElementById('qprSelCount')?.textContent || '');
  check(selCount.includes('24 of 24'), `8. Select All selects all 24 (got "${selCount}")`);

  // ── 9. Clear All ─────────────────────────────────────────────────────────────────────────
  await domClick(window, '#qprClearAllBtn');
  await window.waitForTimeout(200);
  selCount = await window.evaluate(() => document.getElementById('qprSelCount')?.textContent || '');
  check(selCount.includes('0 of 24'), `9. Clear All deselects everything (got "${selCount}")`);

  // Re-select all for the remaining steps.
  await domClick(window, '#qprSelectAllBtn');
  await window.waitForTimeout(200);

  // ── 10-11. Manual sequence editing + Sharaf editing preserves Nikah ─────────────────────
  const row02Z = await window.evaluate(() => {
    const row = [...document.querySelectorAll('#qprEntryList .qpr-entry-row')].find(r => r.querySelector('.qpr-folder-name')?.textContent.includes('02Z'));
    return row ? row.dataset.key : null;
  });
  check(!!row02Z, '10. the 02Z row is locatable for manual editing');
  if (row02Z) {
    await window.evaluate((key) => {
      const field = document.querySelector(`.qpr-type-field[data-key="${key}"]`);
      field.value = 'Q';
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }, row02Z);
    await window.waitForTimeout(400);
    const afterEdit = await window.evaluate((key) => {
      const row = document.querySelector(`.qpr-entry-row[data-key="${key}"]`);
      return { folder: row?.querySelector('.qpr-folder-name')?.textContent || '', hasNikahBadge: !!row?.querySelector('.qpr-nikah-badge') };
    }, row02Z);
    check(afterEdit.folder.includes('02Q'), `11a. editing the Sharaf type from Z to Q updates the folder code (got "${afterEdit.folder}")`);
    check(afterEdit.hasNikahBadge === true, '11b. Nikah remains associated with the sequence after a primary Sharaf edit');
    // Revert the manual edit back to Z so the rest of this test creates the real, correct 02Z.
    await window.evaluate((key) => {
      const field = document.querySelector(`.qpr-type-field[data-key="${key}"]`);
      field.value = 'Z';
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }, row02Z);
    await window.waitForTimeout(400);
  }

  // ── 12. Confirm selected sequences → create ──────────────────────────────────────────────
  const preCreateState = await window.evaluate(() => ({
    createDisabled: document.getElementById('qprCreateBtn')?.disabled,
    selCount: document.getElementById('qprSelCount')?.textContent,
  }));
  log('pre-create state:', JSON.stringify(preCreateState));
  await domClick(window, '#qprCreateBtn');
  await window.waitForTimeout(500);
  const previewState = await window.evaluate(() => ({
    confirmHidden: document.getElementById('qprConfirmCreateBtn')?.classList.contains('hidden'),
    confirmDisabled: document.getElementById('qprConfirmCreateBtn')?.disabled,
  }));
  log('preview state after clicking Create:', JSON.stringify(previewState));
  await domClick(window, '#qprConfirmCreateBtn');
  await window.waitForTimeout(2500);
  const createStatus = await window.evaluate(() => document.getElementById('qprStatus')?.textContent || '');
  log('create status text:', JSON.stringify(createStatus));

  // ── 13-14. Folders created in the synthetic destination, exact names ───────────────────
  const EXPECTED_CODES = ['01Q', '02Z', '03Z', '04Q', '05M', '06Q', '07Q', '08Q', '09Q', '10Q', '11Q', '12Z', '13M', '14Z', '15Q', '16Z', '17Z', '18Q', '19Q', '20Q', '21Q', '22Q', '23Q', '24Q'];
  const dirEntries = await fsp.readdir(qmzRoot).catch(() => []);
  for (const code of EXPECTED_CODES) {
    check(dirEntries.includes(code), `13-14. folder "${code}" was created`);
  }
  check(dirEntries.filter(d => EXPECTED_CODES.includes(d)).length === 24, '13-14. exactly 24 sequence folders exist');

  // ── 15. No N-only folders anywhere ───────────────────────────────────────────────────────
  check(!dirEntries.some(d => /^\d{1,2}[a-z]?N$/i.test(d)), `15. no separate "N" folder was ever created (entries: ${JSON.stringify(dirEntries)})`);

  // ── 16. Close and reopen the QMZ interface ───────────────────────────────────────────────
  await domClick(window, '#qprDoneBtn');
  await window.waitForTimeout(300);
  await window.evaluate(() => window._closeQMZManager());
  await window.waitForTimeout(300);
  check(await window.evaluate(() => document.getElementById('qmzOverlay')?.classList.contains('hidden')), '16a. QMZ closes cleanly');

  await window.evaluate((r) => window.openQMZManager(r, {
    component: { location: 'Hall A', city: null, country: 'India' },
    isMulti: false, eventTitle: 'Nikah Fix Verification Event', hijriDate: '1448-01-14',
    eventJsonPath: null, componentTitle: null,
  }), qmzRoot);
  await window.waitForTimeout(500);
  check(await window.evaluate(() => _qmzOpen === true), '16b. QMZ reopens cleanly against the same workspace');

  // ── 16c-16g. "Implement Durable QMZ Nikah Sequence Information" — the sequence browser's
  // chips (NOT the PDF-review table, already covered above) show a persisted Nikah badge after
  // a real close/reopen, exactly for the 5 sequences the PDF identified, and an operator can
  // remove a mistaken designation via the existing window.confirm() correction control.
  const chipNikahCodes = await window.evaluate(() => [...document.querySelectorAll('.qmz-seq-chip-nikah')].map(el => el.dataset.code).sort());
  check(JSON.stringify(chipNikahCodes) === JSON.stringify(['02Z', '03Z', '04Q', '15Q', '23Q']),
    `16c. the sequence browser shows a Nikah badge on exactly the 5 expected chips after reopening (got ${JSON.stringify(chipNikahCodes)})`);
  const chipBadgeText = await window.evaluate(() => document.querySelector('.qmz-seq-chip-nikah')?.textContent || '');
  check(chipBadgeText === 'Nikah', `16d. the chip's Nikah badge reads exactly "Nikah" (got "${chipBadgeText}")`);

  // Stub window.confirm so the removal control's existing confirmation dialog doesn't block
  // this automated run — same role as the dialog.showOpenDialog stub above, just for a native
  // renderer-side confirm() instead of a main-process file picker.
  await window.evaluate(() => { window.confirm = () => true; });
  await domClick(window, '.qmz-seq-chip-nikah[data-code="02Z"]');
  await window.waitForTimeout(500);
  let chipNikahCodesAfterRemove = await window.evaluate(() => [...document.querySelectorAll('.qmz-seq-chip-nikah')].map(el => el.dataset.code).sort());
  check(JSON.stringify(chipNikahCodesAfterRemove) === JSON.stringify(['03Z', '04Q', '15Q', '23Q']),
    `16e. clicking 02Z's Nikah badge removes only that one designation in the UI (got ${JSON.stringify(chipNikahCodesAfterRemove)})`);
  check(fs.existsSync(path.join(qmzRoot, '02Z')), '16f. the 02Z sequence folder itself still exists after removing its Nikah designation');

  // Close and reopen again — the removal must be DURABLE, not just an in-memory UI change.
  await window.evaluate(() => window._closeQMZManager());
  await window.waitForTimeout(300);
  await window.evaluate((r) => window.openQMZManager(r, {
    component: { location: 'Hall A', city: null, country: 'India' },
    isMulti: false, eventTitle: 'Nikah Fix Verification Event', hijriDate: '1448-01-14',
    eventJsonPath: null, componentTitle: null,
  }), qmzRoot);
  await window.waitForTimeout(500);
  chipNikahCodesAfterRemove = await window.evaluate(() => [...document.querySelectorAll('.qmz-seq-chip-nikah')].map(el => el.dataset.code).sort());
  check(JSON.stringify(chipNikahCodesAfterRemove) === JSON.stringify(['03Z', '04Q', '15Q', '23Q']),
    `16g. the Nikah removal from 02Z survives a second close/reopen — durable, not just in-memory (got ${JSON.stringify(chipNikahCodesAfterRemove)})`);

  // ── 17. Existing workflows still function (manual "Add Specific" sequence creation) ────
  await window.fill('#qmzSeqNumInput', '30');
  await window.fill('#qmzSeqSuffixInput', '');
  await window.selectOption('#qmzSeqLetterSelect', 'O');
  await domClick(window, '#qmzAddSpecificBtn');
  await window.waitForTimeout(500);
  check(fs.existsSync(path.join(qmzRoot, '30O')), '17. manual "Add Specific" sequence creation still works unaffected (30O created)');

  await electronApp.close().catch(() => {});

  log(failures === 0 ? 'ALL CHECKS PASSED (final)' : `${failures} CHECK(S) FAILED (final)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[qmz-nikah-e2e] FATAL', err);
  process.exit(1);
});
