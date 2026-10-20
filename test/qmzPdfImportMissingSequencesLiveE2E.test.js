'use strict';

// "AutoIngest — QMZ PDF Import Missing Sequences" — live Electron end-to-end verification.
//
// A real operator reported that importing a real QMZ program PDF silently lost two numbered
// rows: one directly covered by a left-margin grouping label spanning several consecutive rows
// (e.g. "Fakhri Heights"/"Same Building" — shared-accommodation annotations in the real
// document), and a final row immediately followed by an unnumbered trailing note. Root-caused
// against the real PDF (not committed here — contains real names/phone numbers/ITS IDs;
// verified live, uncommitted, during development) in main/qmzProgramPdfParser.js's
// _extractLeadingSequence: a label's text item, positioned left of the sequence-number column,
// could land in the same Y-cluster as a data row and become its leftmost item, corrupting
// sequence extraction. Fixed generically (geometry nearest-neighbor + content check combined),
// not by hardcoding this document's layout.
//
// This file drives the REAL full workflow end to end — PDF import -> review -> selection ->
// Confirm & Create -> actual folder verification on disk — against a SYNTHETIC fixture that
// reproduces the exact structural shape of the real bug (never the real PDF or real personal
// data). Isolated temp folders only; the real QMZ archive/NAS is never touched.
//
// Run: node test/qmzPdfImportMissingSequencesLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function log(...args) { console.log('[qmz-pdf-missing-seq-e2e]', ...args); }
let failures = 0;
function check(cond, msg) { if (cond) log('PASS —', msg); else { failures++; log('FAIL —', msg); } }

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

// ── Synthetic PDF writer (identical approach to test/qmzProgramPdfParser.test.js) ──────────
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

const HEADER_Y = 560, ROW_H = 11;
const COL = { no: 50, name: 150, sharaf: 320, floor: 360, code: 460 };
function centeredNameX(text) { return COL.name - Math.min(30, Math.max(0, (text.length - 12) * 1.1)); }
function headerRow(y) { return [{ text: 'No', x: COL.no, y }, { text: 'Name', x: COL.name, y }, { text: 'Sharaf', x: COL.sharaf, y }, { text: 'Floor', x: COL.floor, y }, { text: 'Code', x: COL.code, y }]; }
function dataRow(y, seq, name, sharaf, code) { return [{ text: seq, x: COL.no, y }, { text: name, x: centeredNameX(name), y }, { text: sharaf, x: COL.sharaf, y }, { text: 'G', x: COL.floor, y }, { text: code, x: COL.code, y }]; }
function bannerRow(y, text) { return [{ text, x: COL.no + 60, y }]; }

/**
 * Reproduces the real reported document's exact structural shape (31 numbered rows, a
 * left-margin label colliding with row 14's own Y, a second left-margin label colliding with
 * row 30's own Y, a trailing unnumbered note directly beneath the final numbered row 31) —
 * with synthetic names/codes only, never real personal data.
 */
function buildReportedShapePdf() {
  const cells = [...headerRow(HEADER_Y)];
  const allRows = [y => bannerRow(y, 'TestCity')];
  for (let n = 1; n <= 31; n++) {
    const sharaf = n === 3 || n === 13 || n === 26 ? 'Z' : n === 31 ? 'M' : 'Q';
    allRows.push(y => dataRow(y, String(n), `Test Person ${n}`, sharaf, `TCA-${String(n).padStart(4, '0')}`));
  }
  allRows.push(y => bannerRow(y, 'Closing Note (Unnumbered)'));

  allRows.forEach((r, i) => {
    const y = HEADER_Y - ROW_H * (i + 1);
    cells.push(...r(y));
  });
  // Row index within allRows: index 0 is the city banner, so data row N (1-based) is at
  // allRows index N. Row 14 -> allRows index 14; row 30 -> allRows index 30.
  const yForAllRowsIndex = (idx) => HEADER_Y - ROW_H * (idx + 1);
  cells.push({ text: 'Fakhri Heights', x: COL.no - 15, y: yForAllRowsIndex(14) });
  cells.push({ text: 'Same', x: COL.no - 20, y: yForAllRowsIndex(30) });
  cells.push({ text: 'Building', x: COL.no - 13, y: yForAllRowsIndex(30) });
  return makeSyntheticPdf(cells);
}

(async () => {
  const userDataDir = await mkTmp('ai-qmz-pdf-missing-seq-userdata-');
  const qmzRoot = await mkTmp('ai-qmz-pdf-missing-seq-root-');
  const fixturesDir = await mkTmp('ai-qmz-pdf-missing-seq-fixtures-');
  log('userDataDir =', userDataDir, 'qmzRoot =', qmzRoot);

  const pdfPath = path.join(fixturesDir, 'reported-shape.pdf');
  await fsp.writeFile(pdfPath, buildReportedShapePdf());

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
    await window.fill('#splashInputName', 'PDF Missing Seq Test');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'PDF Missing Seq Test');
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
  async function setNextDialog(filePath) {
    await electronApp.evaluate(async ({ dialog }, p) => { dialog.__qprNextPath = p; dialog.__qprNextCanceled = false; }, filePath);
  }
  await electronApp.evaluate(async ({ dialog }) => {
    dialog.showOpenDialog = async () => {
      if (dialog.__qprNextCanceled) return { canceled: true, filePaths: [] };
      return { canceled: false, filePaths: [dialog.__qprNextPath] };
    };
  });

  // ═══════════════ Open QMZ against an isolated synthetic workspace ═══════════════
  await window.evaluate((r) => window.openQMZManager(r, {
    component: { location: 'Hall A', city: 'TestCity', country: 'India' },
    isMulti: false, eventTitle: 'PDF Missing Seq Test Event', hijriDate: '1448-02-10',
    eventJsonPath: null, componentTitle: null,
  }), qmzRoot);
  await window.waitForTimeout(600);
  const qmzOpen = await window.evaluate(() => _qmzOpen === true);
  check(qmzOpen, '1. QMZ sorting opens against a real, isolated synthetic workspace root');

  // ═══════════════ Import the PDF ═══════════════
  await setNextDialog(pdfPath);
  await domClick('#qmzImportPdfBtn');
  await window.waitForTimeout(1200);
  const reviewOpen = await window.evaluate(() => !document.getElementById('qmzPdfReviewOverlay')?.classList.contains('hidden'));
  check(reviewOpen === true, '2. the synthetic program PDF is imported and the review UI opens');

  // ═══════════════ Review: all 31 entries present, no gaps, 14 and 30 (the real-world
  // equivalents of 14Q/31M's neighbor) specifically present ═══════════════
  const entryRowCount = await window.evaluate(() => document.querySelectorAll('#qprEntryList .qpr-entry-row').length);
  check(entryRowCount === 31, `3. all 31 reviewed entries are shown (got ${entryRowCount}) — none lost to the left-margin label collision`);

  const folderNames = await window.evaluate(() => {
    const el = document.getElementById('qprEntryList');
    return [...el.querySelectorAll('.qpr-folder-name')].map(e => e.textContent.trim());
  });
  check(folderNames.includes('14Q'), `4. the row directly collided with by "Fakhri Heights" (14Q) is present in review — got: ${JSON.stringify(folderNames)}`);
  check(folderNames.includes('30Q'), '5. the row directly collided with by "Same Building" (30Q) is present in review');
  check(folderNames.includes('31M'), '6. the final numbered row (31M), immediately followed by an unnumbered closing note, is present in review');
  check(folderNames.length === 31 && new Set(folderNames).size === 31, '7. exactly 31 distinct folder names, no duplicates, no omissions');

  const warningsText = await window.evaluate(() => document.getElementById('qprWarnings')?.textContent || '');
  check(!/missing sequence number/i.test(warningsText), `8. no numbering-gap warning is shown — the review is genuinely contiguous 1-31 (warnings: "${warningsText}")`);

  // ═══════════════ Select all, Create, Confirm ═══════════════
  await domClick('#qprSelectAllBtn');
  await window.waitForTimeout(200);
  const selCountText = await window.evaluate(() => document.getElementById('qprSelCount')?.textContent || '');
  check(/31 of 31/.test(selCountText), `9. Select All selects all 31 entries (got "${selCountText}")`);

  await domClick('#qprCreateBtn');
  await window.waitForTimeout(500);
  await domClick('#qprConfirmCreateBtn');
  await window.waitForTimeout(1500);

  // ═══════════════ Verify actual folders on disk ═══════════════
  const expectedFolders = [];
  for (let n = 1; n <= 31; n++) {
    const sharaf = n === 3 || n === 13 || n === 26 ? 'Z' : n === 31 ? 'M' : 'Q';
    expectedFolders.push(`${String(n).padStart(2, '0')}${sharaf}`);
  }
  const actualDirEntries = await fsp.readdir(qmzRoot).catch(() => []);
  const missing = expectedFolders.filter(f => !actualDirEntries.includes(f));
  check(missing.length === 0, `10. all 31 expected sequence folders exist on disk — missing: ${JSON.stringify(missing)}`);
  check(fs.existsSync(path.join(qmzRoot, '14Q')), '11. 14Q specifically was actually created on disk (the real operator-reported loss)');
  check(fs.existsSync(path.join(qmzRoot, '30Q')), '12. 30Q specifically was actually created on disk (the second, previously-unreported loss)');
  check(fs.existsSync(path.join(qmzRoot, '31M')), '13. 31M was actually created on disk (confirmed never actually lost)');

  const statePath = path.join(qmzRoot, 'qmz-sequences.json');
  const state = JSON.parse(await fsp.readFile(statePath, 'utf8').catch(() => '{"sequences":[]}'));
  const stateCodes = (state.sequences || []).map(s => s.code).sort();
  check(stateCodes.length === 31, `14. qmz-sequences.json metadata records exactly 31 sequences (got ${stateCodes.length})`);
  check(JSON.stringify(stateCodes) === JSON.stringify(expectedFolders.slice().sort()),
    '15. metadata sequence codes exactly match the expected 01Q..31M set, no omissions or extras');

  check(consoleErrors.length === 0, `16. no console/page errors occurred during the entire workflow (found: ${JSON.stringify(consoleErrors)})`);

  log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  await electronApp.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[qmz-pdf-missing-seq-e2e] FATAL', err);
  process.exit(1);
});
