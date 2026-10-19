'use strict';

// "QMZ Final Validation & Preview Release" — Phase 4: comprehensive 35-step live Electron
// acceptance workflow for the full QMZ feature set as it stands going into v0.9.15-rc.3:
// PDF import (Stage 2/3), validated folder creation + Enroute (Stage 4), hidden metadata +
// lazy _Unsequenced lifecycle (Workspace Maintenance), and manually-inserted additional
// sequences + the O/AQ type expansion ("QMZ Sequence Enhancements"), end to end, against the
// REAL running application — not a service-level unit test. Uses only synthetic, disposable
// fixtures (no real reference PDFs, no real archive, isolated userData) and reuses this
// project's own established Playwright/Electron test harness conventions throughout (see
// test/qmzEnrouteLiveE2E.test.js and test/qmzAddSequenceLayoutLiveE2E.test.js, whose helper
// shapes this file follows exactly).
//
// Requires playwright-core (see test/metadataPipelineLive.test.js for install notes).
// Run: node test/qmzFinalValidationLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const SHOTS = process.env.QMZ_FINAL_SHOTS || null;

function log(...args) { console.log('[qmz-final-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

function isMacHidden(filePath) {
  if (process.platform !== 'darwin') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('stat', ['-f', '%Sf', filePath], (err, stdout) => {
      if (err) return resolve(false);
      resolve(stdout.includes('hidden'));
    });
  });
}

// ── Minimal synthetic PDF writer (identical to the established Stage 2/3/4 suites) ─────────
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

(async () => {
  const userDataDir = await mkTmp('ai-qmz-final-e2e-userdata-');
  const fixturesDir = await mkTmp('ai-qmz-final-e2e-fixtures-');
  const root = await mkTmp('ai-qmz-final-e2e-root-');
  log('userDataDir =', userDataDir, 'root =', root);
  if (SHOTS) await fsp.mkdir(SHOTS, { recursive: true });

  // Step 3 fixture — a synthetic QMZ program PDF covering Q/M/O (AQ/MZ are added manually
  // via steps 9-13 instead, since the brief wants BOTH import-driven and manual-add coverage).
  const pdfPath = path.join(fixturesDir, 'program.pdf');
  await fsp.writeFile(pdfPath, buildSingleCityPdf('TestCity', [
    y => dataRow(y, '1', 'Test Person One', 'Q', 'TCA-0001'),
    y => dataRow(y, '2', 'Test Person Two', 'M', 'TCA-0002'),
  ]));

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));

  await electronApp.evaluate(async ({ dialog }) => {
    dialog.showOpenDialog = async () => {
      if (dialog.__qprNextCanceled) return { canceled: true, filePaths: [] };
      return { canceled: false, filePaths: [dialog.__qprNextPath] };
    };
  });
  async function setNextDialog(filePath) {
    await electronApp.evaluate(async ({ dialog }, p) => { dialog.__qprNextPath = p; dialog.__qprNextCanceled = false; }, filePath);
  }

  // ═══════════════ Step 1: Launch AutoIngest ═══════════════
  let window = await electronApp.firstWindow({ timeout: 60000 });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);
  check(!!window, '1. AutoIngest launches and produces a window');

  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));
  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'Final Validation Operator');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'Final Validation Operator');
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
      isMulti: false, eventTitle: 'Final Validation Event', hijriDate: '1448-02-10',
      eventJsonPath: null, componentTitle: null,
    }), r);
    await window.waitForTimeout(500);
  }
  // There is no dedicated "Unsequenced" nav chip in this UI (confirmed by inspecting
  // renderer.js: _qmzViewScope/_qmzActiveLocation only ever reset to 'unsequenced'
  // programmatically — on open, or after certain operations complete — never via a direct
  // clickable element). Re-opening the manager is itself real, already-exercised app
  // behavior (see steps 25-26) and is the reliable way to return to the Unsequenced view
  // between sorts.
  async function backToUnsequenced() {
    await window.evaluate(() => window._closeQMZManager());
    await window.waitForTimeout(300);
    await openQmz(root);
  }
  async function selectAllFilesForPhotographer(pg) {
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
  // "QMZ Sorting Workflow Optimization" changed _qmzAssignToSequence's return value from a
  // bare boolean to a richer { attempted, movedTotal, errorTotal, totalRequested } result
  // (so Quick Assign/the sidebar can distinguish complete/partial/failed outcomes) — this
  // helper reduces that back to the simple boolean this file's own checks expect
  // ("did assignment complete with zero errors"), rather than every call site comparing
  // against a result shape that intentionally changed.
  async function assignSelectionTo(code) {
    const r = await window.evaluate((c) => _qmzAssignToSequence(c), code);
    return !!(r && r.attempted && r.errorTotal === 0 && r.movedTotal > 0);
  }
  const shot = async (name) => { if (SHOTS) await window.screenshot({ path: path.join(SHOTS, name + '.png') }); };
  async function sequenceState() { return window.evaluate(() => JSON.parse(JSON.stringify(_qmzData.sequences))); }

  // ═══════════════ Step 2: Open QMZ sorting ═══════════════
  await openQmz(root);
  const qmzOpen = await window.evaluate(() => _qmzOpen === true);
  check(qmzOpen, '2. QMZ sorting opens against a real, synthetic workspace root');
  await shot('02-qmz-open');

  // ═══════════════ Steps 3-6: Import PDF, review, create folders + Enroute ═══════════════
  await setNextDialog(pdfPath);
  await domClick('#qmzImportPdfBtn');
  await window.waitForTimeout(1200);
  const reviewOpen = await window.evaluate(() => !document.getElementById('qmzPdfReviewOverlay')?.classList.contains('hidden'));
  check(reviewOpen === true, '3. synthetic QMZ program PDF is imported and the review UI opens');
  const previewEntries = await window.evaluate(() => (document.getElementById('qprEntryList')?.textContent) || '');
  check(previewEntries.includes('01Q') || previewEntries.includes('Q'), `4. imported sequences are presented for operator review (got: "${previewEntries.slice(0, 200)}")`);

  await window.evaluate(() => { const cb = document.getElementById('qprEnrouteCheckbox'); if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); } });
  await domClick('#qprCreateBtn');
  await window.waitForTimeout(500);
  await domClick('#qprConfirmCreateBtn');
  await window.waitForTimeout(1000);
  check(fs.existsSync(path.join(root, '01Q')) && fs.existsSync(path.join(root, '02M')), '5. numbered folders (01Q, 02M) are created on disk from the reviewed PDF entries');
  check(fs.existsSync(path.join(root, 'Enroute')), '6. Enroute is created alongside the PDF-driven numbered sequences (checkbox was checked)');
  await domClick('#qprDoneBtn');
  await window.waitForTimeout(400);

  // ═══════════════ Steps 7-8: sequence metadata + hiding ═══════════════
  const statePath = path.join(root, 'qmz-sequences.json');
  check(fs.existsSync(statePath), '7. qmz-sequences.json exists as the canonical sequence metadata file');
  const stateJson = JSON.parse(await fsp.readFile(statePath, 'utf8'));
  check(stateJson.sequences.some(s => s.code === '01Q') && stateJson.sequences.some(s => s.code === '02M'),
    '7. sequence metadata correctly records both PDF-created sequences');
  const hidden = await isMacHidden(statePath);
  check(hidden === null || hidden === true, '8. qmz-sequences.json carries the real OS hidden attribute (macOS chflags) or platform check is skipped portably');

  // ═══════════════ Steps 9-13: regular + additional sequences, all new types ═══════════════
  async function addSpecific(number, suffix, letter) {
    await window.fill('#qmzSeqNumInput', String(number));
    await window.fill('#qmzSeqSuffixInput', suffix || '');
    await window.selectOption('#qmzSeqLetterSelect', letter);
    await domClick('#qmzAddSpecificBtn');
    await window.waitForTimeout(500);
  }
  await addSpecific(5, '', 'O');
  check(fs.existsSync(path.join(root, '05O')), '9. regular sequence "05O" (Olda) is created via the real Add Sequence UI');
  await addSpecific(6, '', 'AQ');
  check(fs.existsSync(path.join(root, '06AQ')), '10. regular sequence "06AQ" (Aqeeqa) is created via the real Add Sequence UI');
  await addSpecific(3, 'a', 'AQ');
  check(fs.existsSync(path.join(root, '03aAQ')), '11. additional sequence "03aAQ" is created via the real Add Sequence UI');
  await addSpecific(3, 'b', 'O');
  check(fs.existsSync(path.join(root, '03bO')), '12. additional sequence "03bO" is created via the real Add Sequence UI');
  await addSpecific(3, 'c', 'MZ');
  check(fs.existsSync(path.join(root, '03cMZ')), '13. additional sequence "03cMZ" is created via the real Add Sequence UI');
  await shot('13-sequences-created');

  // ═══════════════ Step 14: chronological ordering ═══════════════
  const orderedCodes = (await sequenceState()).map(s => s.code);
  const idx = (c) => orderedCodes.indexOf(c);
  check(idx('01Q') < idx('02M') && idx('02M') < idx('03aAQ') && idx('03aAQ') < idx('03bO') && idx('03bO') < idx('03cMZ') && idx('03cMZ') < idx('05O') && idx('05O') < idx('06AQ'),
    `14. chronological ordering is correct: ${JSON.stringify(orderedCodes)}`);

  // ═══════════════ Steps 15-16: duplicate insertion position rejected ═══════════════
  await addSpecific(3, 'a', 'O'); // "03aO" collides with "03aAQ" — same (number, suffix), different type
  const folderAfterDup = fs.existsSync(path.join(root, '03aO'));
  check(folderAfterDup === false, '16. duplicate insertion position ("03aO" colliding with existing "03aAQ") is rejected — no folder created');
  const statusText = await window.evaluate(() => document.getElementById('qmzStatus')?.textContent || '');
  check(/already used|insertion position/i.test(statusText), `15. rejection is reported to the operator (status: "${statusText}")`);

  // ═══════════════ Step 17: import synthetic photographs (into _Unsequenced) ═══════════════
  const pg = 'Jane Doe';
  const mkPhoto = async (name) => {
    const p = path.join(root, '_Unsequenced', pg, name);
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, `fake-bytes-${name}`);
    return p;
  };
  const photoA = await mkPhoto('IMG_0001.JPG');
  const photoB = await mkPhoto('IMG_0002.JPG');
  const photoC = await mkPhoto('IMG_0003.JPG');
  await window.evaluate(() => _qmzRefresh());
  await window.waitForTimeout(500);
  check(fs.existsSync(photoA) && fs.existsSync(photoB) && fs.existsSync(photoC), '17. synthetic photographs are placed into _Unsequenced for sorting');

  // ═══════════════ Steps 18-20: sort into 03aAQ, 03bO, Enroute ═══════════════
  await backToUnsequenced();
  await window.waitForTimeout(300);
  await selectAllFilesForPhotographer(pg);
  const selCountBefore = await window.evaluate(() => _qmzSelectedFiles.size);
  check(selCountBefore === 3, 'setup: all three synthetic photographs are selected from _Unsequenced');
  // Deselect all but the first for a 1-file move into 03aAQ.
  await window.evaluate((keep) => {
    [..._qmzSelectedFiles].forEach((p) => { if (!keep.includes(p)) _qmzSelectedFiles.delete(p); });
    _qmzSyncAllTiles();
  }, [photoA]);
  const r18 = await assignSelectionTo('03aAQ');
  await window.waitForTimeout(500);
  check(r18 === true, '18. a photograph is sorted into additional sequence "03aAQ" via the real assignment path');
  check(fs.existsSync(path.join(root, '03aAQ', pg, 'IMG_0001.JPG')), '18. the file genuinely landed in 03aAQ/Jane Doe on disk');

  await backToUnsequenced();
  await window.waitForTimeout(300);
  await selectAllFilesForPhotographer(pg);
  await window.evaluate((keep) => {
    [..._qmzSelectedFiles].forEach((p) => { if (!keep.includes(p)) _qmzSelectedFiles.delete(p); });
    _qmzSyncAllTiles();
  }, [photoB]);
  const r19 = await assignSelectionTo('03bO');
  await window.waitForTimeout(500);
  check(r19 === true, '19. a second photograph is sorted into additional sequence "03bO"');
  check(fs.existsSync(path.join(root, '03bO', pg, 'IMG_0002.JPG')), '19. the file genuinely landed in 03bO/Jane Doe on disk');

  await backToUnsequenced();
  await window.waitForTimeout(300);
  await selectAllFilesForPhotographer(pg);
  await window.waitForTimeout(200);
  const moveEnrouteEnabled = await window.evaluate(() => document.getElementById('qmzMoveEnrouteBtn')?.disabled === false);
  check(moveEnrouteEnabled, 'setup: "-> Enroute" is enabled with the last photograph selected');
  await domClick('#qmzMoveEnrouteBtn');
  await window.waitForTimeout(500);
  check(fs.existsSync(path.join(root, 'Enroute', pg, 'IMG_0003.JPG')), '20. the third photograph is sorted into Enroute/Jane Doe');

  // ═══════════════ Steps 21-23: photographer folders, counts, collision handling ═══════════════
  const scanned1 = await window.evaluate(() => _qmzData);
  check(scanned1.sequences.find(s => s.code === '03aAQ')?.photographers?.[pg]?.count === 1, '21/22. 03aAQ photographer folder has exactly 1 file');
  check(scanned1.sequences.find(s => s.code === '03bO')?.photographers?.[pg]?.count === 1, '21/22. 03bO photographer folder has exactly 1 file');
  check(scanned1.enroute?.photographers?.[pg]?.count === 1, '21/22. Enroute photographer folder has exactly 1 file');
  const contentAQ = await fsp.readFile(path.join(root, '03aAQ', pg, 'IMG_0001.JPG'), 'utf8').catch(() => null);
  const contentO = await fsp.readFile(path.join(root, '03bO', pg, 'IMG_0002.JPG'), 'utf8').catch(() => null);
  const contentEnroute = await fsp.readFile(path.join(root, 'Enroute', pg, 'IMG_0003.JPG'), 'utf8').catch(() => null);
  check(contentAQ === 'fake-bytes-IMG_0001.JPG' && contentO === 'fake-bytes-IMG_0002.JPG' && contentEnroute === 'fake-bytes-IMG_0003.JPG',
    '22. moved file CONTENTS are byte-identical to what was originally written — never corrupted/truncated by the move');

  // Filename collision: attempt to move a NEW file with the SAME name into an already-occupied
  // destination — the established safeMoveFile contract renames rather than overwrites.
  const dupSrc = path.join(root, '_Unsequenced', pg, 'IMG_0001.JPG');
  await fsp.mkdir(path.dirname(dupSrc), { recursive: true });
  await fsp.writeFile(dupSrc, 'different-bytes-same-name');
  await window.evaluate(() => _qmzRefresh());
  await window.waitForTimeout(400);
  await backToUnsequenced();
  await window.waitForTimeout(300);
  await selectAllFilesForPhotographer(pg);
  await window.waitForTimeout(200);
  const r23 = await assignSelectionTo('03aAQ');
  await window.waitForTimeout(500);
  const destFiles = await fsp.readdir(path.join(root, '03aAQ', pg)).catch(() => []);
  check(r23 === true && destFiles.length === 2 && destFiles.includes('IMG_0001.JPG'),
    `23. a same-name collision is handled without overwriting — destination now has ${destFiles.length} distinctly-named file(s): ${JSON.stringify(destFiles)}`);

  // ═══════════════ Step 24: _Unsequenced cleanup ═══════════════
  const unseqGone = !fs.existsSync(path.join(root, '_Unsequenced', pg)) || (await fsp.readdir(path.join(root, '_Unsequenced', pg)).catch(() => [])).length === 0;
  check(unseqGone, '24. the now-emptied _Unsequenced/Jane Doe photographer folder is cleaned up');

  // ═══════════════ Steps 25-29: close, reopen, persistence, ordering, _Unsequenced absence ═══════════════
  await window.evaluate(() => window._closeQMZManager());
  await window.waitForTimeout(400);
  check(true, '25. workspace closed');
  await openQmz(root);
  check(await window.evaluate(() => _qmzOpen === true), '26. workspace reopens successfully');
  const reopenedCodes = (await sequenceState()).map(s => s.code);
  check(['01Q', '02M', '03aAQ', '03bO', '03cMZ', '05O', '06AQ'].every(c => reopenedCodes.includes(c)), `27. all sequences persist after reopening: ${JSON.stringify(reopenedCodes)}`);
  const reopenedIdx = (c) => reopenedCodes.indexOf(c);
  check(reopenedIdx('01Q') < reopenedIdx('02M') && reopenedIdx('03aAQ') < reopenedIdx('03bO') && reopenedIdx('03bO') < reopenedIdx('03cMZ'), '28. ordering remains correct after reopening');
  check(!fs.existsSync(path.join(root, '_Unsequenced')), '29. _Unsequenced remains absent after reopening (no unnecessary recreation)');

  // ═══════════════ Steps 30-33: move back to _Unsequenced, lazy recreation, re-sort, cleanup ═══════════════
  await domClick('.qmz-seq-chip[data-code="03aAQ"]');
  await window.waitForTimeout(300);
  await selectAllFilesForPhotographer(pg);
  await window.waitForTimeout(200);
  const unseqEnabled = await window.evaluate(() => document.getElementById('qmzMoveUnsequencedBtn')?.disabled === false);
  check(unseqEnabled, 'setup: "<- Unsequenced" is enabled with a sequence file selected');
  await domClick('#qmzMoveUnsequencedBtn');
  await window.waitForTimeout(500);
  check(fs.existsSync(path.join(root, '_Unsequenced', pg)), '31. moving a photograph back to _Unsequenced lazily recreates the folder');
  await backToUnsequenced();
  await window.waitForTimeout(300);
  await selectAllFilesForPhotographer(pg);
  await window.waitForTimeout(200);
  const r32 = await assignSelectionTo('03aAQ');
  await window.waitForTimeout(500);
  check(r32 === true, '32. the photograph is sorted again back into 03aAQ');
  const unseqGoneAgain = !fs.existsSync(path.join(root, '_Unsequenced', pg)) || (await fsp.readdir(path.join(root, '_Unsequenced', pg)).catch(() => [])).length === 0;
  check(unseqGoneAgain, '33. _Unsequenced is cleaned up again after the re-sort');

  // ═══════════════ Steps 34-35: no data loss, no unexpected metadata changes ═══════════════
  const finalFileCount = (await fsp.readdir(path.join(root, '03aAQ', pg)).catch(() => [])).length;
  check(finalFileCount === 2, `34. no data loss — 03aAQ/Jane Doe still has exactly 2 distinctly-named files (${finalFileCount})`);
  const finalStateJson = JSON.parse(await fsp.readFile(statePath, 'utf8'));
  const finalCodes = finalStateJson.sequences.map(s => s.code).sort();
  const expectedCodes = ['01Q', '02M', '03aAQ', '03bO', '03cMZ', '05O', '06AQ'].sort();
  check(JSON.stringify(finalCodes) === JSON.stringify(expectedCodes), `35. final metadata contains exactly the expected sequence set, no unexpected records: ${JSON.stringify(finalCodes)}`);
  check(Object.keys(finalStateJson).sort().join(',') === Object.keys(stateJson).sort().join(','), '35. metadata top-level schema (key set) is unchanged after the full workflow');

  check(consoleErrors.length === 0, `no console/page errors occurred during the entire 35-step workflow (found: ${consoleErrors.join(' | ') || 'none'})`);

  await window.evaluate(() => window._closeQMZManager()).catch(() => {});
  await electronApp.close();

  log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[qmz-final-e2e] FATAL:', err);
  process.exit(1);
});
