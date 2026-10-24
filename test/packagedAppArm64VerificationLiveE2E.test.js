'use strict';

// "AutoIngest — Combined Preview v0.9.16-rc.1: Native Module Packaging Fix" — Phase 5:
// launches the ACTUAL PACKAGED arm64 application (dist/mac-arm64/AutoIngest.app), never the
// dev source tree, and verifies the macOS native-module architecture fix actually works at
// runtime — not merely that the right files exist on disk (see
// test/qmzTransferCombinedIntegrationLiveE2E.test.js, which already covers the same
// navigation surface against the dev build; this file is specifically about the PACKAGED
// artifact and the native modules whose architecture this task corrected).
//
// Requires `dist/mac-arm64/AutoIngest.app` to already exist (run `npm run build:mac` first).
// Synthetic fixtures only; does not touch any real archive/NAS data.
//
// Run: node test/packagedAppArm64VerificationLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const APP_EXECUTABLE = path.join(PROJECT_ROOT, 'dist', 'mac-arm64', 'AutoIngest.app', 'Contents', 'MacOS', 'AutoIngest');

function log(...args) { console.log('[packaged-arm64-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

async function domClick(window, selector) {
  return window.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    return true;
  }, selector);
}

// ── Synthetic PDF writer (identical to the established QMZ test suites) ────────────────
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
function headerRow(y) { return [{ text: 'No', x: COL.no, y }, { text: 'Name', x: COL.name, y }, { text: 'Sharaf', x: COL.sharaf, y }, { text: 'Floor', x: COL.floor, y }, { text: 'Code', x: COL.code, y }]; }
function centeredNameX(text) { return COL.name - Math.min(30, Math.max(0, (text.length - 12) * 1.1)); }
function dataRow(y, seq, name, sharaf, code) { return [{ text: seq, x: COL.no, y }, { text: name, x: centeredNameX(name), y }, { text: sharaf, x: COL.sharaf, y }, { text: 'G', x: COL.floor, y }, { text: code, x: COL.code, y }]; }
function bannerRow(y, text) { return [{ text, x: COL.no + 60, y }]; }
function buildSingleCityPdf(cityLabel, rows) {
  const cells = [...headerRow(HEADER_Y)];
  const allRows = [y => bannerRow(y, cityLabel), ...rows];
  allRows.forEach((r, i) => cells.push(...r(HEADER_Y - ROW_H * (i + 1))));
  return makeSyntheticPdf(cells);
}

// ── Transfer Import fixtures (identical convention to the Collection-status suites) ────
function evJson(seq, name, hijriDate = '1446-01-01') {
  return JSON.stringify({
    version: 1, hijriDate, sequence: seq, eventName: name,
    components: [{ types: ['Majlis'], city: 'TestCity', location: null }],
  });
}
async function mkEvent(dir, seq, name, fileCount) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'event.json'), evJson(seq, name));
  for (let i = 0; i < fileCount; i++) await fsp.writeFile(path.join(dir, `photo-${i}.jpg`), `bytes-${name}-${i}`);
}

async function setDialogPaths(electronApp, pathsByTitle) {
  await electronApp.evaluate(async ({ dialog }, map) => {
    dialog.showOpenDialog = async (_win, opts) => {
      const p = map[opts?.title];
      return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] };
    };
  }, pathsByTitle);
}

async function waitForImportDone(window, timeoutMs, previousBatchId) {
  const start = Date.now();
  let status = null;
  while (Date.now() - start < timeoutMs) {
    status = await window.evaluate(async () => window.api.getTransferImportStatus());
    if (status && status.batchId && !status.running && status.batchId !== previousBatchId) return status;
    await window.waitForTimeout(200);
  }
  return status;
}
async function waitForExportDone(window, timeoutMs, previousBatchId) {
  const start = Date.now();
  let status = null;
  while (Date.now() - start < timeoutMs) {
    status = await window.evaluate(async () => window.api.getTransferExportStatus());
    if (status && status.batchId && !status.running && status.batchId !== previousBatchId) return status;
    await window.waitForTimeout(200);
  }
  return status;
}

async function newCollectionBadgeText(window, folderName) {
  return window.evaluate((name) => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === name);
    if (!row) return undefined;
    const badge = row.closest('.tx-tree-row')?.querySelector('.tx-tree-status[data-status="new"]');
    return badge ? badge.textContent : null;
  }, folderName);
}

(async () => {
  if (!fs.existsSync(APP_EXECUTABLE)) {
    console.error(`FATAL: packaged app not found at ${APP_EXECUTABLE} — run "npm run build:mac" first.`);
    process.exit(1);
  }

  const userDataDir  = await mkTmp('ai-pkg-arm64-userdata-');
  const qmzRoot       = await mkTmp('ai-pkg-arm64-qmzroot-');
  const transferRoot  = await mkTmp('ai-pkg-arm64-transfer-');
  const destRoot      = await mkTmp('ai-pkg-arm64-dest-');
  const destRoot2     = await mkTmp('ai-pkg-arm64-dest2-');

  await mkEvent(path.join(transferRoot, 'CollA', 'Ev1'), 1, 'Ev1', 2);
  await mkEvent(path.join(transferRoot, 'CollB', 'Ev1'), 1, 'Ev1', 2);
  await mkEvent(path.join(destRoot, 'CollA', 'Ev1'), 1, 'Ev1', 2); // CollA already exists at destination
  await fsp.mkdir(path.join(transferRoot, 'GenericLegacyFolder'), { recursive: true });
  await fsp.writeFile(path.join(transferRoot, 'GenericLegacyFolder', 'tape.mov'), 'legacy-bytes');

  const pdfPath = path.join(await mkTmp('ai-pkg-arm64-pdf-'), 'program.pdf');
  await fsp.writeFile(pdfPath, buildSingleCityPdf('TestCity', [
    y => dataRow(y, '1', 'First Person', 'Q', 'TCA-0001'),
    y => dataRow(y, '2', 'Second Person', 'M', 'TCA-0002'),
  ]));

  // ── Launch the ACTUAL PACKAGED app (not the dev source tree) ────────────────────────
  const electronApp = await electron.launch({
    executablePath: APP_EXECUTABLE,
    args: [`--user-data-dir=${userDataDir}`, '--no-sandbox'],
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[packaged-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[packaged-stderr] ' + d));

  // ── 1. Native-module architecture proof: directly require + exercise sharp and
  // @napi-rs/canvas inside the packaged app's actual main process, under its actual
  // process.arch. This is the real test of the fix — a UI thumbnail check would not catch
  // a broken sharp binary, since thumbnailer.js silently falls back to Electron's own
  // nativeImage on any sharp failure. ──
  // Playwright's electronApp.evaluate() runs in a context with no bare `require` (it is a
  // per-module local, not a global, in Node's CJS wrapper) — process.mainModule.require is
  // the main process's own real module loader, reached without adding any test-only hook to
  // production code.
  let sharpResult;
  try {
    sharpResult = await electronApp.evaluate(async () => {
      const sharp = process.mainModule.require('sharp');
      const buf = await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } } })
        .jpeg({ quality: 80 }).toBuffer();
      return { ok: true, arch: process.arch, bytes: buf.length };
    });
  } catch (e) { sharpResult = { ok: false, error: e.message }; }
  check(sharpResult.ok === true && sharpResult.arch === 'arm64' && sharpResult.bytes > 0,
    `1. sharp's native binary loads and actually encodes a real image inside the packaged app's own main process (arch=${sharpResult.arch}, bytes=${sharpResult.bytes}, error=${sharpResult.error || 'none'})`);

  let canvasResult;
  try {
    canvasResult = await electronApp.evaluate(async () => {
      const { createCanvas } = process.mainModule.require('@napi-rs/canvas');
      const c = createCanvas(16, 16);
      const ctx = c.getContext('2d');
      ctx.fillStyle = 'red';
      ctx.fillRect(0, 0, 16, 16);
      const buf = c.toBuffer('image/png');
      return { ok: true, arch: process.arch, bytes: buf.length };
    });
  } catch (e) { canvasResult = { ok: false, error: e.message }; }
  check(canvasResult.ok === true && canvasResult.arch === 'arm64' && canvasResult.bytes > 0,
    `2. @napi-rs/canvas's native binary loads and actually renders inside the packaged app's own main process (arch=${canvasResult.arch}, bytes=${canvasResult.bytes}, error=${canvasResult.error || 'none'})`);

  // ── 2. App starts without native-module errors, reaches the real UI ────────────────
  let window = await electronApp.firstWindow({ timeout: 60000 });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  const consoleErrors = [];
  window.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  window.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message));

  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));
  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'Packaged Verification Operator');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'Packaged Verification Operator');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  }
  window = await mainWindowPromise;
  window.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  window.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message));
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);
  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));

  check(await window.evaluate(() => typeof window.openQMZManager === 'function' && typeof window._alocOpen === 'function'),
    '3. the packaged app starts without native-module errors and reaches the real UI (both QMZ and Transfer entry points present)');

  // ── 3. QMZ: open, PDF import + review + Enroute + folder creation (real canvas-backing
  // dependency, pdfjs-dist, actually parses this synthetic PDF) ──
  await electronApp.evaluate(async ({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dialog.__nextPath] });
  });
  async function setNextDialog(p) { await electronApp.evaluate(async ({ dialog }, pp) => { dialog.__nextPath = pp; }, p); }

  await window.evaluate((r) => window.openQMZManager(r, {
    component: { location: 'Hall A', city: 'TestCity', country: 'India' },
    isMulti: false, eventTitle: 'Packaged Verification Event', hijriDate: '1448-02-10',
    eventJsonPath: null, componentTitle: null,
  }), qmzRoot);
  await window.waitForTimeout(500);
  check(await window.evaluate(() => _qmzOpen === true), '4. QMZ opens against the packaged app\'s real, synthetic workspace root');

  await setNextDialog(pdfPath);
  await domClick(window, '#qmzImportPdfBtn');
  await window.waitForTimeout(1200);
  const reviewOpen = await window.evaluate(() => !document.getElementById('qmzPdfReviewOverlay')?.classList.contains('hidden'));
  check(reviewOpen === true, '5. a synthetic QMZ program PDF is imported and the review UI opens (pdfjs-dist parses correctly in the packaged build)');
  const previewEntries = await window.evaluate(() => (document.getElementById('qprEntryList')?.textContent) || '');
  log('review entries text:', JSON.stringify(previewEntries.slice(0, 300)));

  await window.evaluate(() => { const cb = document.getElementById('qprEnrouteCheckbox'); if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); } });
  await domClick(window, '#qprCreateBtn');
  await window.waitForTimeout(500);
  await domClick(window, '#qprConfirmCreateBtn');
  await window.waitForTimeout(1000);
  log('qmzRoot contents after create:', JSON.stringify(await fsp.readdir(qmzRoot)));
  check(fs.existsSync(path.join(qmzRoot, '01Q')) && fs.existsSync(path.join(qmzRoot, '02M')),
    '6. sequence creation works: numbered folders (01Q, 02M) created on disk from the reviewed PDF entries');
  check(fs.existsSync(path.join(qmzRoot, 'Enroute')), '7. Enroute is created alongside the PDF-driven sequences');
  await domClick(window, '#qprDoneBtn');
  await window.waitForTimeout(400);

  await window.evaluate(() => window._closeQMZManager());
  await window.waitForTimeout(300);
  check(await window.evaluate(() => document.getElementById('qmzOverlay')?.classList.contains('hidden')),
    '8. QMZ closes cleanly in the packaged build');

  // ── 4. Transfer Import: New Collection indicator correctness + generic folder import ──
  await setDialogPaths(electronApp, {});
  await electronApp.evaluate(async ({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] });
  }, transferRoot);
  await window.evaluate(async (root) => { await window.api.setNasRoot(root); }, destRoot);
  await window.evaluate(async () => window.api.chooseTransferRoot());

  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));
  await window.evaluate(() => window._alocOpen());
  await window.waitForTimeout(300);
  await window.click('#alocTransferImportBtn');
  await window.waitForTimeout(800);
  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));
  check(await window.evaluate(() => document.getElementById('transferImportModal')?.classList.contains('open')),
    '9. Transfer Import opens in the packaged build');

  check((await newCollectionBadgeText(window, 'CollA')) === null, '10a. CollA (already at destination) shows no New Collection badge');
  const collBBadge = await newCollectionBadgeText(window, 'CollB');
  check(collBBadge === 'New Collection', '10b. CollB (absent at destination) correctly shows the New Collection indicator');
  check((await newCollectionBadgeText(window, 'GenericLegacyFolder')) === null,
    '11. the generic (non-Collection) legacy folder carries no Collection label at all');

  // Consecutive imports: CollB then the generic folder, same session.
  await window.click('#tiSelectNoneBtn');
  await window.waitForTimeout(200);
  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'CollB');
    row?.closest('.tx-tree-row')?.querySelector('input[type=checkbox]')?.click();
  });
  await window.waitForTimeout(200);
  await window.click('#tiPreviewBtn');
  await window.waitForTimeout(1000);
  await window.click('#tiImportBtn');
  const importA = await waitForImportDone(window, 20000, null);
  check(importA && importA.result?.status === 'ok' && importA.copied === 3, '12. Transfer Import of CollB (3 files: event.json + 2 photos) completes in the packaged build');

  await window.click('#tiSelectNoneBtn');
  await window.waitForTimeout(200);
  await window.evaluate(() => {
    const row = Array.from(document.querySelectorAll('.tx-tree-name')).find(n => n.textContent === 'GenericLegacyFolder');
    row?.closest('.tx-tree-row')?.querySelector('input[type=checkbox]')?.click();
  });
  await window.waitForTimeout(200);
  await window.click('#tiPreviewBtn');
  await window.waitForTimeout(1000);
  await window.click('#tiImportBtn');
  const importB = await waitForImportDone(window, 20000, importA.batchId);
  check(importB && importB.batchId !== importA.batchId && importB.result?.status === 'ok' && importB.copied === 1,
    '13. a SECOND, consecutive Import (the generic folder) completes as a genuinely new batch, same session (no "stuck after success")');
  check(fs.existsSync(path.join(destRoot, 'GenericLegacyFolder', 'tape.mov')), 'generic folder content landed on disk');

  await window.keyboard.press('Escape');
  await window.waitForTimeout(300);

  // ── 5. Transfer Export: consecutive exports, same packaged session ──────────────────
  const exportSrcA = await mkTmp('ai-pkg-arm64-exportA-');
  const exportSrcB = await mkTmp('ai-pkg-arm64-exportB-');
  await fsp.mkdir(path.join(exportSrcA, 'ExpA'), { recursive: true });
  await fsp.writeFile(path.join(exportSrcA, 'ExpA', 'a-file-0.dat'), 'exp-a-0');
  await fsp.mkdir(path.join(exportSrcB, 'ExpB'), { recursive: true });
  await fsp.writeFile(path.join(exportSrcB, 'ExpB', 'b-file-0.dat'), 'exp-b-0');
  await fsp.writeFile(path.join(exportSrcB, 'ExpB', 'b-file-1.dat'), 'exp-b-1');

  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));
  await window.evaluate(() => window._alocOpen());
  await window.waitForTimeout(300);
  await window.click('#alocTransferExportBtn');
  await window.waitForTimeout(800);
  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));
  check(await window.evaluate(() => document.getElementById('transferExportModal')?.classList.contains('open')),
    '14. Transfer Export opens in the packaged build');

  await window.click('#txSrcModeCustom');
  await window.waitForTimeout(200);
  await setDialogPaths(electronApp, { 'Choose Source Folder': path.join(exportSrcA, 'ExpA'), 'Choose Destination Folder': destRoot2 });
  await window.click('#txChooseCustomSrcBtn');
  await window.waitForTimeout(200);
  await window.click('#txChooseCustomDestBtn');
  await window.waitForTimeout(200);
  await window.click('#txPreviewBtn');
  await window.waitForTimeout(1000);
  await window.click('#txExportBtn');
  const exportA = await waitForExportDone(window, 20000, null);
  check(exportA && exportA.result?.status === 'ok' && exportA.copied === 1, '15a. Export A completes in the packaged build');

  await setDialogPaths(electronApp, { 'Choose Source Folder': path.join(exportSrcB, 'ExpB'), 'Choose Destination Folder': destRoot2 });
  await window.click('#txChooseCustomSrcBtn');
  await window.waitForTimeout(300);
  await window.click('#txPreviewBtn');
  await window.waitForTimeout(1000);
  await window.click('#txExportBtn');
  const exportB = await waitForExportDone(window, 20000, exportA.batchId);
  check(exportB && exportB.batchId !== exportA.batchId && exportB.result?.status === 'ok' && exportB.copied === 2,
    '15b. a SECOND, consecutive Export completes as a genuinely new batch, same packaged session');

  await window.keyboard.press('Escape');
  await window.waitForTimeout(300);

  // ── 6. Close and reopen cleanly ───────────────────────────────────────────────────────
  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));
  await window.evaluate(() => window._alocOpen());
  await window.waitForTimeout(300);
  await window.click('#alocTransferImportBtn');
  await window.waitForTimeout(800);
  const reopenedOk = await window.evaluate(() => document.getElementById('transferImportModal')?.classList.contains('open'));
  check(reopenedOk === true, '16. the app closes and reopens its modals cleanly after a full QMZ + Transfer Import + Transfer Export round trip');
  await window.keyboard.press('Escape');

  check(consoleErrors.length === 0, `17. zero console/page errors across the entire packaged-app session (found: ${consoleErrors.length}${consoleErrors.length ? ' — ' + consoleErrors.slice(0, 3).join(' | ') : ''})`);

  await electronApp.close().catch(() => {});

  log(failures === 0 ? 'ALL CHECKS PASSED (final)' : `${failures} CHECK(S) FAILED (final)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[packaged-arm64-e2e] FATAL', err);
  process.exit(1);
});
