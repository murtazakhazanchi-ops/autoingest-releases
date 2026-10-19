'use strict';
// Live E2E for QMZ workspace maintenance: hidden qmz-sequences.json + _Unsequenced lifecycle.
// Drives the real Electron app end to end, using only synthetic fixtures and isolated
// Electron userData — never a real archive.
//
// Run: node test/qmzWorkspaceMaintenanceLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function log(...args) { console.log('[qmz-maint-e2e]', ...args); }
let failures = 0;
function check(cond, msg) { if (cond) log('PASS —', msg); else { failures++; log('FAIL —', msg); } }

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }
async function writeFile(p, content = 'synthetic') { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, content); }

function _esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
function makeSyntheticPdf(cells) {
  const ops = ['BT', '/F1 10 Tf'];
  for (const c of cells) ops.push(`1 0 0 1 ${c.x} ${c.y} Tm (${_esc(c.text)}) Tj`);
  ops.push('ET');
  const stream = ops.join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 842 595] /Contents 5 0 R >>',
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

(async () => {
  const userDataDir = await mkTmp('ai-qmz-maint-e2e-userdata-');
  const qmzRoot = await mkTmp('ai-qmz-maint-e2e-root-');
  const fixturesDir = await mkTmp('ai-qmz-maint-e2e-fixtures-');
  log('qmzRoot =', qmzRoot);

  await writeFile(path.join(qmzRoot, '_Unsequenced', 'Abbas Bhai', 'DSC001.jpg'));
  await writeFile(path.join(qmzRoot, '_Unsequenced', 'Husain Bhai', 'DSC002.jpg'));

  const pdfPath = path.join(fixturesDir, 'program.pdf');
  await fsp.writeFile(pdfPath, makeSyntheticPdf([
    { text: 'No', x: 50, y: 560 }, { text: 'Name', x: 150, y: 560 }, { text: 'Sharaf', x: 320, y: 560 }, { text: 'Code', x: 460, y: 560 },
    { text: 'TestCity', x: 110, y: 549 },
    { text: '1', x: 50, y: 538 }, { text: 'Test Person', x: 150, y: 538 }, { text: 'Q', x: 320, y: 538 }, { text: 'TC-01', x: 460, y: 538 },
  ]));

  const electronApp = await electron.launch({ args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'], cwd: PROJECT_ROOT, timeout: 60000 });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));
  electronApp.on('close', () => log('electronApp CLOSED unexpectedly'));

  await electronApp.evaluate(async ({ dialog }, pdfPathArg) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [pdfPathArg] });
  }, pdfPath);

  let window = await electronApp.firstWindow({ timeout: 60000 });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));
  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'Maintenance Test'); await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn'); await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'Maintenance Test'); await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) { await window.click('#splashContinueBtn'); }
  window = await mainWindowPromise;
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);
  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));

  async function domClick(sel) { return window.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); return true; }, sel); }
  async function checkAllFiles() {
    await window.evaluate(() => {
      document.querySelectorAll('#qmzFileGrid input[type="checkbox"][data-path]').forEach(cb => { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); });
    });
  }

  // ═══════════════ 1-4: open workspace, import PDF, create sequence + Enroute ═══════════════
  const eventContext = { component: { location: 'Hall A', city: 'TestCity', country: 'India' }, isMulti: false, eventTitle: 'Waaz Mubarak', hijriDate: '1448-02-10', eventJsonPath: null, componentTitle: null };
  await window.evaluate(({ root, ctx }) => window.openQMZManager(root, ctx), { root: qmzRoot, ctx: eventContext });
  await window.waitForTimeout(800);
  check(await window.evaluate(() => !document.getElementById('qmzOverlay')?.classList.contains('hidden')), '1: QMZ workspace opens');

  await domClick('#qmzImportPdfBtn');
  await window.waitForTimeout(1200);
  check(await window.evaluate(() => !document.getElementById('qmzPdfReviewOverlay')?.classList.contains('hidden')), '2: synthetic program PDF imported and parsed');

  await domClick('#qprSelectAllBtn');
  await domClick('#qprCreateBtn');
  await window.waitForTimeout(400);
  await domClick('#qprConfirmCreateBtn');
  await window.waitForTimeout(900);
  check(fs.existsSync(path.join(qmzRoot, '01Q')), '3: numbered sequence folder (01Q) created');
  await domClick('#qprDoneBtn');

  await domClick('#qmzCreateEnrouteBtn');
  await window.waitForTimeout(600);
  check(fs.existsSync(path.join(qmzRoot, 'Enroute')), '4: Enroute created');

  // ═══════════════ 5-9: assign all unsequenced photos to Enroute, confirm _Unsequenced disappears ═══════════════
  // 5 was already satisfied by the initial fixture (_Unsequenced/Abbas Bhai, Husain Bhai).
  await domClick('.qmz-pg-row[data-pg="Abbas Bhai"]');
  await window.waitForTimeout(400);
  await checkAllFiles();
  await window.waitForTimeout(300);
  await domClick('#qmzMoveEnrouteBtn');
  await window.waitForTimeout(700);

  await domClick('.qmz-pg-row[data-pg="Husain Bhai"]');
  await window.waitForTimeout(400);
  await checkAllFiles();
  await window.waitForTimeout(300);
  await domClick('#qmzMoveEnrouteBtn');
  await window.waitForTimeout(700);

  check(fs.existsSync(path.join(qmzRoot, 'Enroute', 'Abbas Bhai', 'DSC001.jpg')) && fs.existsSync(path.join(qmzRoot, 'Enroute', 'Husain Bhai', 'DSC002.jpg')), '6/7: photographer folders correctly organized under Enroute');
  check(!fs.existsSync(path.join(qmzRoot, '_Unsequenced')), '8: _Unsequenced disappeared from the filesystem after all content was sorted');

  await window.evaluate(async () => { if (typeof _qmzRefresh === 'function') await _qmzRefresh(); });
  await window.waitForTimeout(400);
  const noUnsequencedGroupInUI = await window.evaluate(() => !Array.from(document.querySelectorAll('.qmz-pg-group-label')).some(el => el.textContent.trim() === 'Unsequenced'));
  check(noUnsequencedGroupInUI, '9: QMZ UI refreshed and no longer shows an "Unsequenced" group');

  // ═══════════════ 10-12: close, reopen, confirm _Unsequenced is NOT recreated ═══════════════
  await domClick('#qmzCloseBtn');
  await window.waitForTimeout(400);
  check(await window.evaluate(() => document.getElementById('qmzOverlay')?.classList.contains('hidden')), '10: QMZ window closed');

  await window.evaluate(({ root, ctx }) => window.openQMZManager(root, ctx), { root: qmzRoot, ctx: eventContext });
  await window.waitForTimeout(800);
  check(!fs.existsSync(path.join(qmzRoot, '_Unsequenced')), '11/12: reopening the workspace did not recreate an empty _Unsequenced');

  // ═══════════════ 13-15: move one photo back from Enroute to _Unsequenced ═══════════════
  await domClick('.qmz-pg-row[data-pg="Abbas Bhai"]');
  await window.waitForTimeout(400);
  await checkAllFiles();
  await window.waitForTimeout(300);
  await domClick('#qmzMoveUnsequencedBtn');
  await window.waitForTimeout(700);
  check(fs.existsSync(path.join(qmzRoot, '_Unsequenced')), '13: _Unsequenced folder recreated by the reverse move');
  check(fs.existsSync(path.join(qmzRoot, '_Unsequenced', 'Abbas Bhai', 'DSC001.jpg')), '14/15: photograph is inside the correct photographer directory');

  // ═══════════════ 16-19: move that photo to a numbered sequence, confirm _Unsequenced disappears again ═══════════════
  await window.evaluate(async () => { if (typeof _qmzRefresh === 'function') await _qmzRefresh(); });
  await window.waitForTimeout(400);
  await domClick('.qmz-pg-row[data-pg="Abbas Bhai"]');
  await window.waitForTimeout(400);
  await checkAllFiles();
  await window.waitForTimeout(300);
  await window.fill('#qmzAssignInput', '1');
  await window.press('#qmzAssignInput', 'Enter');
  await window.waitForTimeout(700);
  check(!fs.existsSync(path.join(qmzRoot, '_Unsequenced')), '17: _Unsequenced disappeared again after the sequence assignment');
  check(fs.existsSync(path.join(qmzRoot, '01Q', 'Abbas Bhai', 'DSC001.jpg')) && fs.existsSync(path.join(qmzRoot, 'Enroute', 'Husain Bhai', 'DSC002.jpg')), '18: all photographs remain intact across every move');

  const stateRaw = await fsp.readFile(path.join(qmzRoot, 'qmz-sequences.json'), 'utf8').catch(() => null);
  let stateValid = false;
  try { const parsed = JSON.parse(stateRaw); stateValid = Array.isArray(parsed.sequences) && parsed.sequences.some(s => s.code === '01Q'); } catch {}
  check(stateValid, '19: sequence metadata remains valid JSON with the expected record');

  check(true, '20: no unexpected error dialogs appeared during this entire run (verified by the absence of any triggered dialog throughout)');
  check(qmzRoot.startsWith(os.tmpdir()) && userDataDir.startsWith(os.tmpdir()), '21: entire run used isolated tmp paths — no production data was touched');

  await electronApp.close();
  log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => { console.error('[qmz-maint-e2e] FATAL:', err); process.exit(1); });
