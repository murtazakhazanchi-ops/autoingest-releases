'use strict';
// Live end-to-end verification of Stage 4 ("Validated Folder Creation + First-Class Enroute
// Support") of "PDF-Assisted QMZ Workspace Folder Generation" — drives the REAL Electron app,
// the real QMZ Sequence Manager, and the real PDF review modal's creation preview/confirm
// flow end to end. Uses only SYNTHETIC fixtures — no real reference PDFs or personal data.
//
// Covers (subset of the Stage 4 brief's Phase 15 scenarios, chosen for live-UI coverage that
// test/qmzEnrouteRegression.test.js's service-level suite cannot exercise):
//   A. Enroute-only, no PDF (manual creation + assignment, independent of any sequence).
//   B/C. PDF import with numbered sequences only, and with numbered sequences + Enroute.
//   D. PDF review where Enroute already exists.
//   F. Multi-city PDF with a mismatched workspace — explicit acknowledgment required.
//   H. PDF review with a duplicate selection — blocked, reported, never created.
//   K. Repeated creation attempts are idempotent.
//   L. Cancel before confirmation — zero filesystem writes.
//
// Requires playwright-core (see test/metadataPipelineLive.test.js for install notes).
// Run: node test/qmzEnrouteLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function log(...args) { console.log('[qmz-enroute-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

// ── Minimal synthetic PDF writer (identical approach to the Stage 2/3 test suites) ─────────
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
  const userDataDir = await mkTmp('ai-qmz-enroute-e2e-userdata-');
  const fixturesDir = await mkTmp('ai-qmz-enroute-e2e-fixtures-');
  log('userDataDir =', userDataDir);

  const singleCityPdfPath = path.join(fixturesDir, 'surendranagar.pdf');
  await fsp.writeFile(singleCityPdfPath, buildSingleCityPdf('Surendranagar', [
    y => dataRow(y, '1', 'Test Person One', 'Q', 'TCA-0001'),
    y => dataRow(y, '2', 'Test Person Two', 'M', 'TCA-0002'),
  ]));
  const dupPdfPath = path.join(fixturesDir, 'duplicate.pdf');
  await fsp.writeFile(dupPdfPath, buildSingleCityPdf('TestCity', [
    y => dataRow(y, '3', 'Test Person Three', 'Q', 'TCD-0001'),
    y => dataRow(y, '3', 'Test Person Four', 'Z', 'TCD-0002'), // same number, DIFFERENT type -> only a
    // real duplicate once the operator corrects the type field to match — handled in Group H below.
  ]));
  const twoCityPdfPath = path.join(fixturesDir, 'dhrangadhra-lakhtar.pdf');
  await fsp.writeFile(twoCityPdfPath, buildTwoCityPdf(
    'Dhrangadhra', [y => dataRow(y, '1', 'Test Person Five', 'Q', 'TCB-0001')],
    'Lakhtar',     [y => dataRow(y, '1', 'Test Person Six', 'Q', 'TCC-0001')],
  ));

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));
  electronApp.on('close', () => log('electronApp CLOSED unexpectedly'));

  await electronApp.evaluate(async ({ dialog }) => {
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

  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'Enroute Test Operator');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'Enroute Test Operator');
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
  async function openQmz(root, eventContext) {
    await window.evaluate(({ r, ctx }) => window.openQMZManager(r, ctx), { r: root, ctx: eventContext });
    await window.waitForTimeout(500);
  }
  async function isHidden(id) { return window.evaluate((i) => document.getElementById(i)?.classList.contains('hidden'), id); }
  async function listedFolders(root) {
    try {
      const entries = await fsp.readdir(root, { withFileTypes: true });
      return entries.filter(e => e.isDirectory() && e.name !== '_Unsequenced').map(e => e.name);
    } catch { return []; }
  }
  const ctxFor = (city) => ({ component: { location: 'Hall A', city, country: 'India' }, isMulti: false, eventTitle: 'Waaz Mubarak', hijriDate: '1448-02-10', eventJsonPath: null, componentTitle: null });

  // ═══════════════ A: Enroute-only, no PDF ═══════════════
  log('=== A: Enroute-only, no PDF ===');
  const rootA = await mkTmp('ai-qmz-enroute-e2e-rootA-');
  const srcA  = path.join(rootA, '_Unsequenced', 'Jane Doe', 'a.jpg');
  await fsp.mkdir(path.dirname(srcA), { recursive: true });
  await fsp.writeFile(srcA, 'bytes');
  await openQmz(rootA, ctxFor('Surendranagar'));
  check((await listedFolders(rootA)).includes('Enroute') === false, 'A1: Enroute does not exist yet in a brand-new workspace');
  await domClick('#qmzCreateEnrouteBtn');
  await window.waitForTimeout(600);
  check(fs.existsSync(path.join(rootA, 'Enroute')), 'A2: manual "Create Enroute Folder" creates the folder with zero numbered sequences present');
  const btnLabelAfter = await window.evaluate(() => document.getElementById('qmzCreateEnrouteBtn')?.textContent || '');
  check(/available/i.test(btnLabelAfter), 'A3: button relabels once Enroute exists, without hiding/disabling the destination');

  // Navigate into the photographer row first — the file grid shows nothing (and has no
  // checkboxes at all) until a photographer is selected, exactly like the main workflow.
  await domClick('.qmz-pg-row[data-pg="Jane Doe"]');
  await window.waitForTimeout(400);
  await window.evaluate(() => {
    const cb = document.querySelector('#qmzFileGrid input[type="checkbox"][data-path]');
    if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
  });
  await window.waitForTimeout(300);
  const moveEnrouteEnabled = await window.evaluate(() => document.getElementById('qmzMoveEnrouteBtn')?.disabled === false);
  check(moveEnrouteEnabled === true, 'A4: "→ Enroute" action enables once a file is selected');
  await domClick('#qmzMoveEnrouteBtn');
  await window.waitForTimeout(600);
  check(fs.existsSync(path.join(rootA, 'Enroute', 'Jane Doe', 'a.jpg')), 'A5: selected file is actually moved into Enroute/<photographer>');
  check(!fs.existsSync(srcA), 'A6: source file is gone from _Unsequenced after the move');
  await window.evaluate(() => window._closeQMZManager());
  await window.waitForTimeout(300);

  // ═══════════════ B/C: PDF import — numbered sequences only, then + Enroute ═══════════════
  log('=== B/C: PDF-driven numbered creation, with and without Enroute ===');
  const rootB = await mkTmp('ai-qmz-enroute-e2e-rootB-');
  await openQmz(rootB, ctxFor('Surendranagar'));
  await setNextDialog(singleCityPdfPath);
  await domClick('#qmzImportPdfBtn');
  await window.waitForTimeout(1000);
  // Uncheck Enroute for this first pass — "numbered sequences only".
  await window.evaluate(() => { const cb = document.getElementById('qprEnrouteCheckbox'); cb.checked = false; cb.dispatchEvent(new Event('change', { bubbles: true })); });
  await domClick('#qprCreateBtn');
  await window.waitForTimeout(400);
  check(await isHidden('qprCreatePreview') === false, 'B1: preview opens with the two numbered entries selected');
  const previewToCreateB = await window.evaluate(() => document.getElementById('qprPreviewToCreate')?.textContent || '');
  check(previewToCreateB.includes('01Q') && previewToCreateB.includes('02M'), 'B2: preview lists both numbered folders under "To Create"');
  check(!previewToCreateB.includes('Enroute'), 'B3: Enroute is correctly absent from the preview when its checkbox was unchecked');
  await domClick('#qprConfirmCreateBtn');
  await window.waitForTimeout(800);
  check(fs.existsSync(path.join(rootB, '01Q')) && fs.existsSync(path.join(rootB, '02M')), 'C1: confirming creates both real numbered folders on disk');
  check(!fs.existsSync(path.join(rootB, 'Enroute')), 'C2: Enroute was NOT created when its checkbox was unchecked');
  const resultsTextB = await window.evaluate(() => document.getElementById('qprCreateResults')?.textContent || '');
  check(resultsTextB.includes('01Q') && resultsTextB.includes('Created'), 'C3: creation results report each folder\'s outcome');
  await domClick('#qprDoneBtn');
  await window.waitForTimeout(300);

  // Second import, same PDF: numbered folders now already exist — AND Enroute checked this time.
  await setNextDialog(singleCityPdfPath);
  await domClick('#qmzImportPdfBtn');
  await window.waitForTimeout(1000);
  await domClick('#qprCreateBtn'); // Enroute defaults to checked for a fresh import
  await window.waitForTimeout(400);
  const previewExistsC = await window.evaluate(() => document.getElementById('qprPreviewExists')?.textContent || '');
  check(previewExistsC.includes('01Q') && previewExistsC.includes('02M'), 'C4: preview correctly shows the already-created folders under "Already Exists", not "To Create"');
  const previewToCreateC = await window.evaluate(() => document.getElementById('qprPreviewToCreate')?.textContent || '');
  check(previewToCreateC.includes('Enroute'), 'C5: Enroute (checked, not yet created) appears under "To Create"');
  await domClick('#qprConfirmCreateBtn');
  await window.waitForTimeout(800);
  check(fs.existsSync(path.join(rootB, 'Enroute')), 'C6: confirming with Enroute checked creates it alongside the already-existing numbered folders');
  const seqContentsUnchanged = await fsp.readdir(path.join(rootB, '01Q')).catch(() => null);
  check(Array.isArray(seqContentsUnchanged), 'C7: the already-existing 01Q folder was not disturbed by this second creation pass');
  await window.evaluate(() => window._closeQMZManager());
  await window.waitForTimeout(300);

  // ═══════════════ D: PDF review where Enroute already exists ═══════════════
  log('=== D: PDF review when Enroute already exists in the workspace ===');
  const rootD = await mkTmp('ai-qmz-enroute-e2e-rootD-');
  await fsp.mkdir(path.join(rootD, 'Enroute'), { recursive: true });
  await openQmz(rootD, ctxFor('Surendranagar'));
  await setNextDialog(singleCityPdfPath);
  await domClick('#qmzImportPdfBtn');
  await window.waitForTimeout(1000);
  const enrouteStatusD = await window.evaluate(() => document.getElementById('qprEnrouteStatus')?.textContent || '');
  check(/already exists/i.test(enrouteStatusD), 'D1: review modal shows that Enroute already exists in the active workspace');
  await domClick('#qprCreateBtn');
  await window.waitForTimeout(400);
  const previewExistsD = await window.evaluate(() => document.getElementById('qprPreviewExists')?.textContent || '');
  check(previewExistsD.includes('Enroute'), 'D2: preview correctly shows Enroute under "Already Exists" rather than "To Create"');
  await domClick('#qprConfirmCreateBtn');
  await window.waitForTimeout(600);
  const entriesD = await fsp.readdir(rootD);
  check(entriesD.filter(e => e === 'Enroute').length === 1, 'D3: confirming again does not create a second Enroute folder');
  await domClick('#qprDoneBtn');
  await window.evaluate(() => window._closeQMZManager());
  await window.waitForTimeout(300);

  // ═══════════════ F: multi-city PDF, mismatched workspace ═══════════════
  log('=== F: multi-city PDF with a mismatched workspace requires explicit acknowledgment ===');
  const rootF = await mkTmp('ai-qmz-enroute-e2e-rootF-');
  await openQmz(rootF, ctxFor('SomeOtherCity')); // matches neither Dhrangadhra nor Lakhtar
  await setNextDialog(twoCityPdfPath);
  await domClick('#qmzImportPdfBtn');
  await window.waitForTimeout(1000);
  // No section was auto-suggested (no city match) — explicitly pick Dhrangadhra.
  await window.evaluate(() => {
    const sel = document.getElementById('qprSectionSelect');
    const opt = Array.from(sel.options).find(o => o.textContent.includes('Dhrangadhra'));
    sel.value = opt.value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await window.waitForTimeout(300);
  await domClick('#qprSelectAllBtn');
  await domClick('#qprCreateBtn');
  await window.waitForTimeout(400);
  const mismatchVisible = await isHidden('qprPreviewMismatchAck') === false;
  check(mismatchVisible === true, 'F1: the mismatch acknowledgment is shown for a workspace/section city mismatch');
  const confirmDisabledBeforeAck = await window.evaluate(() => document.getElementById('qprConfirmCreateBtn')?.disabled);
  check(confirmDisabledBeforeAck === true, 'F2: "Confirm & Create" stays disabled until the mismatch is explicitly acknowledged');
  await domClick('#qprConfirmCreateBtn'); // must be a no-op while disabled
  await window.waitForTimeout(300);
  check((await listedFolders(rootF)).length === 0, 'F3: clicking the still-disabled Confirm button creates nothing');
  await window.evaluate(() => { const cb = document.getElementById('qprMismatchAckCheckbox'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); });
  await window.waitForTimeout(200);
  const confirmEnabledAfterAck = await window.evaluate(() => document.getElementById('qprConfirmCreateBtn')?.disabled === false);
  check(confirmEnabledAfterAck === true, 'F4: acknowledging the mismatch enables "Confirm & Create"');
  await domClick('#qprConfirmCreateBtn');
  await window.waitForTimeout(600);
  check(fs.existsSync(path.join(rootF, '01Q')), 'F5: after acknowledgment, the folder is created in the ACTIVE workspace (rootF), not a different one');
  await domClick('#qprDoneBtn');
  await window.evaluate(() => window._closeQMZManager());
  await window.waitForTimeout(300);

  // ═══════════════ H: duplicate selection within one PDF-driven request ═══════════════
  log('=== H: a duplicate selection is blocked, reported, and never created ===');
  const rootH = await mkTmp('ai-qmz-enroute-e2e-rootH-');
  await openQmz(rootH, ctxFor('TestCity'));
  await setNextDialog(dupPdfPath);
  await domClick('#qmzImportPdfBtn');
  await window.waitForTimeout(1000);
  // Force a genuine duplicate: edit the second row's type to match the first (both become "03Q").
  await window.evaluate(() => {
    const rows = document.querySelectorAll('#qprEntryList .qpr-entry-row');
    const typeField = rows[1].querySelector('.qpr-type-field');
    typeField.value = 'Q';
    typeField.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await window.waitForTimeout(400);
  await domClick('#qprCreateBtn');
  await window.waitForTimeout(400);
  const previewBlockedH = await window.evaluate(() => document.getElementById('qprPreviewBlocked')?.textContent || '');
  check(previewBlockedH.includes('03Q') && /duplicate/i.test(previewBlockedH), 'H1: preview flags the duplicate selection under "Needs Attention"');
  await domClick('#qprConfirmCreateBtn');
  await window.waitForTimeout(600);
  check(!fs.existsSync(path.join(rootH, '03Q')), 'H2: a duplicate-in-request entry is never created on disk, even after confirming');
  const resultsTextH = await window.evaluate(() => document.getElementById('qprCreateResults')?.textContent || '');
  check(/duplicate/i.test(resultsTextH), 'H3: the creation results explicitly report the duplicate, not silence it');
  await domClick('#qprDoneBtn');
  await window.evaluate(() => window._closeQMZManager());
  await window.waitForTimeout(300);

  // ═══════════════ K: repeated creation attempts are idempotent ═══════════════
  log('=== K: repeated confirmed creation requests are idempotent ===');
  const rootK = await mkTmp('ai-qmz-enroute-e2e-rootK-');
  await openQmz(rootK, ctxFor('Surendranagar'));
  for (let i = 0; i < 2; i++) {
    await setNextDialog(singleCityPdfPath);
    await domClick('#qmzImportPdfBtn');
    await window.waitForTimeout(1000);
    await domClick('#qprCreateBtn');
    await window.waitForTimeout(400);
    await domClick('#qprConfirmCreateBtn');
    await window.waitForTimeout(700);
    await domClick('#qprDoneBtn');
    await window.waitForTimeout(300);
  }
  const foldersK = await listedFolders(rootK);
  check(foldersK.filter(f => f === '01Q').length === 1 && foldersK.filter(f => f === 'Enroute').length === 1,
    'K1: two full confirmed import/create cycles produce exactly one 01Q and one Enroute — no duplicates');
  await window.evaluate(() => window._closeQMZManager());
  await window.waitForTimeout(300);

  // ═══════════════ L: cancel before confirmation ═══════════════
  log('=== L: cancelling before confirmation writes nothing ===');
  const rootL = await mkTmp('ai-qmz-enroute-e2e-rootL-');
  await openQmz(rootL, ctxFor('Surendranagar'));
  await setNextDialog(singleCityPdfPath);
  await domClick('#qmzImportPdfBtn');
  await window.waitForTimeout(1000);
  await domClick('#qprCreateBtn');
  await window.waitForTimeout(400);
  await domClick('#qprBackToReviewBtn'); // back out of the preview without confirming
  await window.waitForTimeout(300);
  check(await isHidden('qprCreatePreview') === true, 'L1: "Back to Review" closes the preview');
  check((await listedFolders(rootL)).length === 0, 'L2: backing out of the preview creates nothing');
  await domClick('#qprCancelBtn'); // close the whole review without ever confirming
  await window.waitForTimeout(300);
  check((await listedFolders(rootL)).length === 0, 'L3: cancelling the review entirely still creates nothing');
  await window.evaluate(() => window._closeQMZManager());
  await window.waitForTimeout(300);

  await electronApp.close();

  log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[qmz-enroute-e2e] FATAL:', err);
  process.exit(1);
});
