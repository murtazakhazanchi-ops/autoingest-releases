'use strict';
// Live end-to-end verification of Stage 3 ("PDF Import, City Selection & Operator Review UI")
// of "PDF-Assisted QMZ Workspace Folder Generation" — drives the REAL Electron app, the real
// QMZ Sequence Manager, and the real PDF review modal end to end. Uses only SYNTHETIC PDF
// fixtures (same hand-rolled writer as test/qmzProgramPdfParser.test.js) — no real reference
// PDFs or personal data are read by this test.
//
// Covers Test Groups A–F from the Stage 3 brief:
//   A. PDF import (button → native dialog patched to a fixture path → review modal opens)
//   B. City selection (single-section auto-select, multi-section suggestion, mismatch banner)
//   C. Sequence selection (default pre-check on the suggested section only, Select All/Clear All,
//      independent per-section selection state)
//   D. Corrections (manual edit validated via the real qmz:validateSequenceInput IPC, invalid
//      input preserved verbatim and marked unselectable, duplicate recomputation on edit)
//   E. Safety (Create Selected Folders stays disabled and does nothing; nothing is ever written
//      to qmzRoot by any review-UI action; Escape closes the review modal first, not the
//      workspace; closing/reopening resets state; a fatal/no-text PDF shows a message, not a
//      silent empty success)
//   F. Regressions (manual "Add Next"/"Bulk Create" sequence creation still works unaffected
///     by this feature's presence)
//
// Requires playwright-core (see test/metadataPipelineLive.test.js for install notes).
// Run: node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --no-sandbox \
//        --user-data-dir=<isolated tmp dir> test/qmzPdfReviewLiveE2E.test.js
// (or simply: node test/qmzPdfReviewLiveE2E.test.js, which spawns Electron itself via playwright)

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname ? path.resolve(__dirname, '..') : process.cwd();

function log(...args) { console.log('[qmz-pdf-review-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

// ── Minimal synthetic PDF writer (identical approach to test/qmzProgramPdfParser.test.js) ──
function _esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
function makeSyntheticPdf(cells, { width = 842, height = 595 } = {}) {
  const ops = ['BT', '/F1 10 Tf'];
  for (const c of cells) ops.push(`1 0 0 1 ${c.x} ${c.y} Tm (${_esc(c.text)}) Tj`);
  ops.push('ET');
  const stream = ops.join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 ${width} ${height}] /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objs.length; i++) { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`; }
  const xrefOffset = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
function makeBlankPagePdf({ width = 842, height = 595 } = {}) {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /Resources << >> /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R >>`,
    '<< /Length 0 >>\nstream\n\nendstream',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objs.length; i++) { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`; }
  const xrefOffset = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) out += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

const HEADER_Y = 560, ROW_H = 11;
const COL = { no: 50, name: 150, sharaf: 320, floor: 360, code: 460 };
function centeredNameX(text) { return COL.name - Math.min(30, Math.max(0, (text.length - 12) * 1.1)); }
function headerRow(y) { return [{ text: 'No', x: COL.no, y }, { text: 'Name', x: COL.name, y }, { text: 'Sharaf', x: COL.sharaf, y }, { text: 'Floor', x: COL.floor, y }, { text: 'Code', x: COL.code, y }]; }
function dataRow(y, seq, name, sharaf, code) { return [{ text: seq, x: COL.no, y }, { text: name, x: centeredNameX(name), y }, { text: sharaf, x: COL.sharaf, y }, { text: 'G', x: COL.floor, y }, { text: code, x: COL.code, y }]; }
function bannerRow(y, text) { return [{ text, x: COL.no + 60, y }]; }
// A bare-word banner row is only ever recognized as a city label when it appears AFTER the
// header row (rows at or before the header's own row index are skipped entirely — see
// main/qmzProgramPdfParser.js's header-row-and-above skip, which exists to avoid
// misclassifying a document title line as table content). So the banner must be the first
// thing in the row stream following the single shared header, exactly as the real reference
// PDFs and test/qmzProgramPdfParser.test.js's own GROUP B fixture do it.
function buildSingleCityPdf(cityLabel, rows) {
  const cells = [...headerRow(HEADER_Y)];
  const allRows = [y => bannerRow(y, cityLabel), ...rows];
  allRows.forEach((r, i) => cells.push(...r(HEADER_Y - ROW_H * (i + 1))));
  return makeSyntheticPdf(cells);
}
function buildTwoCityPdf(cityA, rowsA, cityB, rowsB) {
  const cells = [...headerRow(HEADER_Y)];
  const allRows = [y => bannerRow(y, cityA), ...rowsA, y => bannerRow(y, cityB), ...rowsB];
  allRows.forEach((r, i) => cells.push(...r(HEADER_Y - ROW_H * (i + 1))));
  return makeSyntheticPdf(cells);
}

(async () => {
  const userDataDir = await mkTmp('ai-qmz-pdf-e2e-userdata-');
  const qmzRoot = await mkTmp('ai-qmz-pdf-e2e-root-');
  const fixturesDir = await mkTmp('ai-qmz-pdf-e2e-fixtures-');
  log('userDataDir =', userDataDir);
  log('qmzRoot =', qmzRoot);

  const singleCityPdfPath = path.join(fixturesDir, 'surendranagar.pdf');
  await fsp.writeFile(singleCityPdfPath, buildSingleCityPdf('Surendranagar', [
    y => dataRow(y, '1', 'Test Person One', 'Q', 'TCA-0001'),
    y => dataRow(y, '2', 'Test Person Two', 'Q', 'TCA-0002'),
    y => dataRow(y, '3', 'Test Person Three', 'Z', 'TCA-0003'),
  ]));

  const twoCityPdfPath = path.join(fixturesDir, 'dhrangadhra-lakhtar.pdf');
  await fsp.writeFile(twoCityPdfPath, buildTwoCityPdf(
    'Dhrangadhra', [
      y => dataRow(y, '1', 'Test Person Four', 'Q', 'TCB-0001'),
      y => dataRow(y, '2', 'Test Person Five', 'M', 'TCB-0002'),
    ],
    'Lakhtar', [
      y => dataRow(y, '1', 'Test Person Six', 'Q', 'TCC-0001'),
      y => dataRow(y, '2', 'Test Person Seven', 'Z', 'TCC-0002'),
    ],
  ));

  const blankPdfPath = path.join(fixturesDir, 'blank.pdf');
  await fsp.writeFile(blankPdfPath, makeBlankPagePdf());

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));
  electronApp.on('close', () => log('electronApp CLOSED unexpectedly'));

  // Patch the native open dialog — Playwright can't drive OS-native file pickers. The handler
  // under test (qmz:importProgramPdf) is otherwise fully real: it still calls the real parser,
  // still returns the real structured result, still runs through the real IPC round-trip.
  let nextDialogPath = null;
  let nextDialogCanceled = false;
  await electronApp.evaluate(async ({ dialog }) => {
    dialog.__qprPatched = true;
    dialog.showOpenDialog = async () => {
      if (dialog.__qprNextCanceled) return { canceled: true, filePaths: [] };
      return { canceled: false, filePaths: [dialog.__qprNextPath] };
    };
  });
  async function setNextDialog(filePath, { canceled = false } = {}) {
    await electronApp.evaluate(async ({ dialog }, { p, c }) => {
      dialog.__qprNextPath = p;
      dialog.__qprNextCanceled = c;
    }, { p: filePath, c: canceled });
  }

  let window = await electronApp.firstWindow({ timeout: 60000 });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));
  log('splash state:', JSON.stringify(splashState));

  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'QMZ PDF Review Test Operator');
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
      await window.fill('#splashInputName', 'QMZ PDF Review Test Operator');
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

  async function domClick(selector) {
    return window.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return true;
    }, selector);
  }
  async function openQmz(eventContext) {
    await window.evaluate(({ root, ctx }) => window.openQMZManager(root, ctx), { root: qmzRoot, ctx: eventContext });
    await window.waitForTimeout(500);
  }
  async function isHidden(id) {
    return window.evaluate((i) => document.getElementById(i)?.classList.contains('hidden'), id);
  }
  async function entryRowCount() {
    return window.evaluate(() => document.querySelectorAll('#qprEntryList .qpr-entry-row').length);
  }
  async function listedFolders() {
    try {
      const entries = await fsp.readdir(qmzRoot, { withFileTypes: true });
      return entries.filter(e => e.isDirectory() && e.name !== '_Unsequenced').map(e => e.name);
    } catch { return []; }
  }

  // ═══════════════ GROUP A — PDF import ═══════════════
  log('=== GROUP A: PDF import ===');
  await openQmz({ component: { location: 'Hall A', city: 'Surendranagar', country: 'India' }, isMulti: false, eventTitle: 'Waaz Mubarak', hijriDate: '1448-02-10', eventJsonPath: null, componentTitle: null });
  check(await isHidden('qmzOverlay') === false, 'A1: QMZ Sequence Manager overlay opens');
  check(await isHidden('qmzPdfReviewOverlay') === true, 'A2: PDF review modal starts hidden');

  await setNextDialog(singleCityPdfPath);
  await domClick('#qmzImportPdfBtn');
  await window.waitForTimeout(1200);
  check(await isHidden('qmzPdfReviewOverlay') === false, 'A3: review modal opens after a successful PDF import');
  const pdfInfoText = await window.evaluate(() => document.getElementById('qprPdfInfo')?.textContent || '');
  check(pdfInfoText.includes('surendranagar.pdf'), 'A4: PDF info shows the imported filename');
  check(pdfInfoText.includes('3 valid sequence'), 'A5: PDF info shows the correct valid-sequence count');
  check(await entryRowCount() === 3, 'A6: entry table shows exactly the 3 extracted rows');

  // Cancel (not Done) closes the modal without side effects, and a second import starts clean.
  await domClick('#qprCancelBtn');
  await window.waitForTimeout(300);
  check(await isHidden('qmzPdfReviewOverlay') === true, 'A7: Cancel closes the review modal');

  // A user-cancelled native dialog must leave the workspace untouched, not show an empty review.
  await setNextDialog(null, { canceled: true });
  await domClick('#qmzImportPdfBtn');
  await window.waitForTimeout(800);
  check(await isHidden('qmzPdfReviewOverlay') === true, 'A8: cancelling the native file picker does not open the review modal');

  // ═══════════════ GROUP B — city selection ═══════════════
  log('=== GROUP B: city selection ===');
  await setNextDialog(singleCityPdfPath);
  await domClick('#qmzImportPdfBtn');
  await window.waitForTimeout(1000);
  const banner1 = await window.evaluate(() => document.getElementById('qprWorkspaceBanner')?.className || '');
  check(banner1.includes('match'), 'B1: workspace city "Surendranagar" matches the single PDF section — match banner shown');
  await domClick('#qprCancelBtn');
  await window.waitForTimeout(300);

  // Re-open the workspace with a DIFFERENT city than the PDF section to exercise the mismatch banner.
  await window.evaluate(() => window._closeQMZManager());
  await window.waitForTimeout(300);
  await openQmz({ component: { location: 'Hall B', city: 'Dhrangadhra', country: 'India' }, isMulti: false, eventTitle: 'Waaz Mubarak', hijriDate: '1448-02-10', eventJsonPath: null, componentTitle: null });
  await setNextDialog(singleCityPdfPath); // this PDF's section is "Surendranagar" — mismatches the active workspace
  await domClick('#qmzImportPdfBtn');
  await window.waitForTimeout(1000);
  const bannerText = await window.evaluate(() => document.getElementById('qprWorkspaceBanner')?.textContent || '');
  const bannerClass = await window.evaluate(() => document.getElementById('qprWorkspaceBanner')?.className || '');
  check(bannerClass.includes('mismatch'), 'B2: mismatched workspace/section city shows the mismatch banner style');
  check(bannerText.includes('Surendranagar') && bannerText.includes('Dhrangadhra'), 'B3: mismatch banner names both the PDF section city and the active workspace city');
  await domClick('#qprCancelBtn');
  await window.waitForTimeout(300);

  // Multi-section PDF: the section selector must list both, and only an exact city match gets
  // a default pre-selection (asserted in Group C below using this same import).
  await setNextDialog(twoCityPdfPath);
  await domClick('#qmzImportPdfBtn');
  await window.waitForTimeout(1200);
  const sectionOptions = await window.evaluate(() => Array.from(document.querySelectorAll('#qprSectionSelect option')).map(o => o.textContent));
  check(sectionOptions.length === 2, 'B4: multi-city PDF lists two sections in the selector');
  check(sectionOptions.some(t => t.includes('Dhrangadhra')) && sectionOptions.some(t => t.includes('Lakhtar')), 'B5: both detected city labels appear in the section selector');
  const suggestedTag = await window.evaluate(() => document.querySelector('.qpr-section-suggested-tag')?.textContent || '');
  check(suggestedTag.includes('Dhrangadhra'), 'B6: the section matching the active workspace city ("Dhrangadhra") is marked as suggested');

  // ═══════════════ GROUP C — sequence selection ═══════════════
  log('=== GROUP C: sequence selection ===');
  const selCountSuggested = await window.evaluate(() => document.getElementById('qprSelCount')?.textContent || '');
  check(selCountSuggested.includes('Selected: 2 of 2'), 'C1: the suggested ("Dhrangadhra") section starts with all valid entries pre-selected');

  // Switch to the non-suggested section manually — it must start with NOTHING pre-selected
  // (navigation alone must never implicitly select rows for a section that wasn't suggested).
  await window.evaluate(() => {
    const sel = document.getElementById('qprSectionSelect');
    const lakhtarOpt = Array.from(sel.options).find(o => o.textContent.includes('Lakhtar'));
    sel.value = lakhtarOpt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await window.waitForTimeout(300);
  const selCountLakhtar = await window.evaluate(() => document.getElementById('qprSelCount')?.textContent || '');
  check(selCountLakhtar.includes('Selected: 0 of 2'), 'C2: manually navigating to a non-suggested section starts with zero rows pre-selected');

  await domClick('#qprSelectAllBtn');
  await window.waitForTimeout(200);
  check((await window.evaluate(() => document.getElementById('qprSelCount')?.textContent || '')).includes('Selected: 2 of 2'), 'C3: Select All checks every eligible row in the active section');
  await domClick('#qprClearAllBtn');
  await window.waitForTimeout(200);
  check((await window.evaluate(() => document.getElementById('qprSelCount')?.textContent || '')).includes('Selected: 0 of 2'), 'C4: Clear All unchecks every row in the active section');

  // Switch back to Dhrangadhra — its own independent selection state (still all-selected from
  // the suggested-section default) must not have been touched by Lakhtar's Select All/Clear All.
  await window.evaluate(() => {
    const sel = document.getElementById('qprSectionSelect');
    const dOpt = Array.from(sel.options).find(o => o.textContent.includes('Dhrangadhra'));
    sel.value = dOpt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await window.waitForTimeout(300);
  check((await window.evaluate(() => document.getElementById('qprSelCount')?.textContent || '')).includes('Selected: 2 of 2'), 'C5: per-section selection state is independent — Dhrangadhra was unaffected by Lakhtar\'s Select/Clear All');

  // ═══════════════ GROUP D — corrections ═══════════════
  log('=== GROUP D: corrections ===');
  // Edit the first row's sequence number AND type to match the second row's folder name
  // exactly (Dhrangadhra's two entries are "01Q" and "02M" — both the number and the letter
  // must change to actually collide), and confirm the duplicate status appears live.
  const firstRowOrigCode = await window.evaluate(() => document.querySelector('#qprEntryList .qpr-entry-row .qpr-folder-name')?.textContent || '');
  log('first row original folder name text:', firstRowOrigCode);
  await window.evaluate(() => {
    const rows = document.querySelectorAll('#qprEntryList .qpr-entry-row');
    const seqField  = rows[0].querySelector('.qpr-seq-field');
    const typeField = rows[0].querySelector('.qpr-type-field');
    typeField.value = 'M';
    typeField.dispatchEvent(new Event('change', { bubbles: true }));
    seqField.value = '2';
    seqField.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await window.waitForTimeout(400);
  const pillsAfterDup = await window.evaluate(() => Array.from(document.querySelectorAll('#qprEntryList .qpr-status-pill')).map(p => p.textContent));
  check(pillsAfterDup.filter(t => t === 'Duplicate').length === 2, 'D1: editing a sequence number to collide with another row marks BOTH rows as Duplicate');
  const editedFlag = await window.evaluate(() => document.querySelector('#qprEntryList .qpr-seq-field')?.classList.contains('edited'));
  check(editedFlag === true, 'D2: an edited field is visually marked as edited');

  // Fix it back to a non-colliding value — duplicate status must clear on both rows.
  await window.evaluate(() => {
    const rows = document.querySelectorAll('#qprEntryList .qpr-entry-row');
    const seqField = rows[0].querySelector('.qpr-seq-field');
    seqField.value = '1';
    seqField.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await window.waitForTimeout(400);
  const pillsAfterFix = await window.evaluate(() => Array.from(document.querySelectorAll('#qprEntryList .qpr-status-pill')).map(p => p.textContent));
  check(pillsAfterFix.every(t => t === 'Valid'), 'D3: resolving the collision clears the Duplicate status on both rows');

  // Enter malformed input — the real qmz:validateSequenceInput IPC must reject it, the row must
  // show Invalid, become unselectable, and its typed value must be preserved verbatim (not
  // silently reverted or truncated).
  await window.evaluate(() => {
    const rows = document.querySelectorAll('#qprEntryList .qpr-entry-row');
    const seqField = rows[0].querySelector('.qpr-seq-field');
    seqField.value = '999';
    seqField.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await window.waitForTimeout(400);
  const firstPillInvalid = await window.evaluate(() => document.querySelector('#qprEntryList .qpr-status-pill')?.textContent || '');
  check(firstPillInvalid === 'Invalid', 'D4: an out-of-range sequence number is rejected by the real validation IPC and shown as Invalid');
  const firstCheckboxDisabled = await window.evaluate(() => document.querySelector('#qprEntryList .qpr-entry-check')?.disabled);
  check(firstCheckboxDisabled === true, 'D5: an Invalid row\'s checkbox is disabled — it can never be "selected" for creation');
  const preservedValue = await window.evaluate(() => document.querySelector('#qprEntryList .qpr-seq-field')?.value || '');
  check(preservedValue === '999', 'D6: the operator\'s invalid typed value is preserved verbatim, not truncated or reverted');

  // ═══════════════ GROUP E — safety ═══════════════
  log('=== GROUP E: safety ===');
  // Stage 4 ("validated folder creation") intentionally changes this exact button's behavior:
  // it is no longer permanently disabled — it is disabled only when nothing creatable is
  // selected, and clicking it now opens a creation PREVIEW, never creates anything by itself.
  // The real safety boundary moved to an explicit, separate "Confirm & Create" step — see
  // test/qmzEnrouteLiveE2E.test.js for that full flow. This only re-confirms that nothing in
  // the Stage 3 review surface itself (selection, correction, section switching) ever creates
  // a folder, which remains true after Stage 4 exactly as it was before it.
  const createBtnEnabled = await window.evaluate(() => document.getElementById('qprCreateBtn')?.disabled === false);
  check(createBtnEnabled === true, 'E1: "Create Selected Folders" is enabled once a valid entry is selected (Stage 4 behavior)');
  const foldersBeforeClick = await listedFolders();
  await domClick('#qprCreateBtn'); // Stage 4: now opens the preview panel, not a no-op click
  await window.waitForTimeout(300);
  const previewShown = await isHidden('qprCreatePreview') === false;
  check(previewShown === true, 'E2: clicking "Create Selected Folders" opens the creation preview panel');
  const foldersAfterClick = await listedFolders();
  check(JSON.stringify(foldersBeforeClick) === JSON.stringify(foldersAfterClick), 'E2b: opening the preview alone creates zero folders on disk');
  check(foldersAfterClick.length === 0, 'E3: no QMZ sequence folders exist anywhere under qmzRoot after reviewing/previewing (before any explicit confirmation)');
  await domClick('#qprBackToReviewBtn'); // back to normal review state for the rest of Group E
  await window.waitForTimeout(200);

  // Escape must close the review modal first, leaving the underlying QMZ workspace open.
  await window.keyboard.press('Escape');
  await window.waitForTimeout(300);
  check(await isHidden('qmzPdfReviewOverlay') === true, 'E4: Escape closes the PDF review modal');
  check(await isHidden('qmzOverlay') === false, 'E5: Escape that closed the review modal does NOT also close the underlying QMZ workspace');

  // A fatal (image-only/no-text) PDF must show a message, never a silent empty success.
  await setNextDialog(blankPdfPath);
  await domClick('#qmzImportPdfBtn');
  await window.waitForTimeout(1000);
  const fatalInfoText = await window.evaluate(() => document.getElementById('qprPdfInfo')?.textContent || '');
  check(/could not|no text|scanned/i.test(fatalInfoText), 'E6: a no-extractable-text PDF shows an explanatory message in the review modal, not a blank success state');
  check(await entryRowCount() === 0, 'E7: a fatal PDF import shows zero sequence rows');
  await domClick('#qprCancelBtn');
  await window.waitForTimeout(300);

  // Re-importing after closing must start from a clean state (no state bleed from the prior import).
  await setNextDialog(singleCityPdfPath);
  await domClick('#qmzImportPdfBtn');
  await window.waitForTimeout(1000);
  const reimportCheckboxes = await window.evaluate(() => Array.from(document.querySelectorAll('#qprEntryList .qpr-entry-check')).map(c => c.checked));
  check(reimportCheckboxes.length === 3 && reimportCheckboxes.every(Boolean), 'E8: re-importing after a prior fatal import starts clean with fresh defaults, no leftover state');
  await domClick('#qprDoneBtn');
  await window.waitForTimeout(300);
  check(await isHidden('qmzPdfReviewOverlay') === true, 'E9: "Done" closes the review modal');

  // ═══════════════ GROUP F — regressions ═══════════════
  log('=== GROUP F: regressions (existing QMZ functionality unaffected) ===');
  // Open a FRESH workspace for this check so the folder this creates doesn't interact with
  // anything from the earlier groups' qmzRoot state.
  await window.evaluate(() => window._closeQMZManager());
  await window.waitForTimeout(300);
  const regressionRoot = await mkTmp('ai-qmz-pdf-e2e-regression-root-');
  await window.evaluate(({ root, ctx }) => window.openQMZManager(root, ctx), {
    root: regressionRoot,
    ctx: { component: { location: 'Hall C', city: 'Surendranagar', country: 'India' }, isMulti: false, eventTitle: 'Waaz Mubarak', hijriDate: '1448-02-10', eventJsonPath: null, componentTitle: null },
  });
  await window.waitForTimeout(500);
  check(await isHidden('qmzOverlay') === false, 'F1: QMZ workspace still opens normally in a session where the PDF review feature exists');

  // Existing manual "Add Specific" creation flow (unrelated to, and untouched by, Stage 3) must
  // still work end to end: number + letter → real qmz:createSequence IPC → real folder on disk.
  await window.fill('#qmzSeqNumInput', '7');
  await window.evaluate(() => { const sel = document.getElementById('qmzSeqLetterSelect'); if (sel) sel.value = 'Q'; });
  await domClick('#qmzAddSpecificBtn');
  await window.waitForTimeout(600);
  const regressionFolders = await fsp.readdir(regressionRoot).catch(() => []);
  check(regressionFolders.includes('07Q'), 'F2: manual "Add Specific" sequence creation still works unaffected by this feature\'s presence');

  await window.evaluate(() => window._closeQMZManager());
  await window.waitForTimeout(300);
  check(await isHidden('qmzOverlay') === true, 'F3: QMZ workspace still closes normally via _closeQMZManager()');

  await electronApp.close();

  log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[qmz-pdf-review-e2e] FATAL:', err);
  process.exit(1);
});
