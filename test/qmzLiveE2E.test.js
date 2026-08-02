'use strict';
// Live end-to-end verification of the QMZ metadata flow — driving the REAL Electron
// app and the real QMZ Sequence Manager UI (photographer selection, file checkboxes,
// sequence assignment via the number input), not a direct IPC call bypassing the UI.
//
// This is the single most important live test in the whole metadata-pipeline project:
// the ORIGINAL root-cause bug this entire redesign traces back to was a QMZ
// context-shape mismatch (renderer sent {component,isMulti,explicitTags}, the writer
// expected {groups,diskComponents} — silently resolved null, wrote Creator/Copyright
// but dropped keywords/Hijri date with status:'done', no error, ever). That was fixed
// and unit-tested early in this project, but never driven through the real UI end to
// end until this test.
//
// Requires playwright-core (see test/metadataPipelineLive.test.js for install notes).
// Run: node test/qmzLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = '/Users/funun_pa/Projects/_Auto-Ingest-Software/electron-app-v24';

function log(...args) { console.log('[qmz-e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }
async function rawFile(p) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, Buffer.from('not-a-real-raw-file-just-bytes'));
}

(async () => {
  const userDataDir = await mkTmp('ai-qmz-e2e-userdata-');
  const qmzRoot = await mkTmp('ai-qmz-e2e-root-');
  log('userDataDir =', userDataDir);
  log('qmzRoot =', qmzRoot);

  // Synthetic QMZ source structure: photographer folder under _Unsequenced, matching
  // main/qmzService.js's expected shape (scanRoot/initRoot adopt loose dirs into
  // _Unsequenced; files already there are picked up directly).
  const pgDir = path.join(qmzRoot, '_Unsequenced', 'Jane Doe');
  await rawFile(path.join(pgDir, 'qmz1.cr2'));
  await rawFile(path.join(pgDir, 'qmz2.cr2'));

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));
  electronApp.on('close', () => log('electronApp CLOSED unexpectedly'));

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
    await window.fill('#splashInputName', 'QMZ Test Operator');
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
      await window.fill('#splashInputName', 'QMZ Test Operator');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  }
  window = await mainWindowPromise;
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  // ── Open the real QMZ Sequence Manager via the real exposed entry point ────────
  // (window.openQMZManager is the same function both real UI buttons — the
  // post-import "Sort QMZ Photos" button and the Event List entry point — call.)
  const eventContext = {
    component: { location: 'Hall A', city: 'Mumbai', country: 'India' },
    isMulti: false,
    eventTitle: 'Waaz Mubarak',
    hijriDate: '1448-02-10',
    eventJsonPath: null, // no event.json for this synthetic QMZ-only fixture
    componentTitle: null,
  };
  // Dismiss the first-run onboarding tooltip overlay — it visually sits on top of
  // everything and intercepts Playwright's pointer-event actionability checks even
  // when the QMZ modal is the thing the operator actually sees/uses.
  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));

  await window.evaluate(({ root, ctx }) => window.openQMZManager(root, ctx), { root: qmzRoot, ctx: eventContext });
  await window.waitForTimeout(1000);
  const qmzOpen = await window.evaluate(() => !document.getElementById('qmzOverlay')?.classList.contains('hidden'));
  check(qmzOpen === true, 'QMZ Sequence Manager overlay opens');

  // Real click, dispatched at the DOM level — matches the established workaround in
  // test/metadataPipelineLive.test.js for a Playwright actionability false-negative
  // on custom-styled elements; still exercises the real addEventListener handler.
  async function domClick(selector) {
    return window.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.click();
      return true;
    }, selector);
  }

  // ── Select the photographer row (real click, real handler) ────────────────────
  await window.waitForTimeout(500);
  const pgRowExists = await window.evaluate(() => !!document.querySelector('.qmz-pg-row[data-pg="Jane Doe"]'));
  check(pgRowExists === true, 'Jane Doe photographer row renders in the QMZ left panel');
  if (pgRowExists) {
    await domClick('.qmz-pg-row[data-pg="Jane Doe"]');
    await window.waitForTimeout(500);
  }

  // ── Select both files via the real checkboxes in the file grid ────────────────
  const tileCount = await window.evaluate(() => document.querySelectorAll('#qmzFileGrid input[type="checkbox"][data-path]').length);
  log('QMZ file tiles rendered:', tileCount);
  check(tileCount === 2, 'both synthetic QMZ files render as selectable tiles');
  await window.evaluate(() => {
    document.querySelectorAll('#qmzFileGrid input[type="checkbox"][data-path]').forEach(cb => {
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  await window.waitForTimeout(300);

  // ── Pre-create sequence "01Q" via the real IPC (skips only the "create sequence"
  // chooser dialog, a separate feature from what's under test here), then assign
  // the selected files to it through the REAL number-input + Enter UI flow
  // (_qmzHandleAssignByNumber → _qmzAssignToSequence → real qmzMoveToSequence IPC
  // → real _qmzAutoQueueMetadata → real qmz:queueMetadata → real applyBatch). ──
  const createRes = await window.evaluate(async (root) => window.api.qmzCreateSequence({ qmzRoot: root, number: 1, letter: 'Q' }), qmzRoot);
  log('qmzCreateSequence result:', JSON.stringify(createRes));
  check(createRes?.ok === true, 'sequence 01Q created via the real backend');

  // Refresh the manager so the newly-created sequence is known to _qmzData before
  // the number-input lookup runs (mirrors what a real UI refresh cycle would do).
  await window.evaluate(async () => { if (typeof _qmzRefresh === 'function') await _qmzRefresh(); });
  await window.waitForTimeout(300);
  // Re-select photographer + files (a refresh can reset the grid selection state).
  await domClick('.qmz-pg-row[data-pg="Jane Doe"]');
  await window.waitForTimeout(300);
  await window.evaluate(() => {
    document.querySelectorAll('#qmzFileGrid input[type="checkbox"][data-path]').forEach(cb => {
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  await window.waitForTimeout(300);

  // Real keydown dispatch (not window.fill/press, to avoid the same actionability
  // false-negative) — still triggers the real 'keydown' listener → _qmzHandleAssignByNumber.
  await window.evaluate(() => {
    const input = document.getElementById('qmzAssignInput');
    input.value = '1';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });

  // Observe live progress: the QMZ status line should update, then the
  // onQmzMetadataProgress listener (wired for failure/ambiguous/partial surfacing)
  // should stay silent for a fully-successful batch — absence of an error status
  // string is itself the expected "no news is good news" signal for this listener.
  let qmzStatusText = null;
  for (let i = 0; i < 20; i++) {
    await window.waitForTimeout(500);
    qmzStatusText = await window.evaluate(() => document.querySelector('.qmz-status')?.textContent || null);
    if (qmzStatusText && /moved|queued/i.test(qmzStatusText)) break;
  }
  log('QMZ status after assign:', qmzStatusText);
  check(!!qmzStatusText && /moved/i.test(qmzStatusText), 'QMZ status line reflects the real move+queue action');

  // Give the fire-and-forget metadata batch (applyBatch, MAX_CONCURRENCY=2) time to
  // actually finish writing both real files' sidecars.
  await window.waitForTimeout(4000);

  const destDir = path.join(qmzRoot, '01Q', 'Jane Doe');
  const dest1 = path.join(destDir, 'qmz1.cr2');
  const dest2 = path.join(destDir, 'qmz2.cr2');
  check(fs.existsSync(dest1) && fs.existsSync(dest2), 'both files were physically moved to the 01Q sequence folder');

  // ── Final UI state: no visible error/ambiguous/partial status left showing ────
  const finalQmzStatus = await window.evaluate(() => ({
    text: document.querySelector('.qmz-status')?.textContent || null,
    cls: document.querySelector('.qmz-status')?.className || null,
  }));
  log('final QMZ UI status:', JSON.stringify(finalQmzStatus));
  check(!finalQmzStatus.cls || !finalQmzStatus.cls.includes('err'), 'no error state left showing in the QMZ UI after a fully-successful assignment');

  // ── Real ExifTool read-back — the actual point of this whole test ─────────────
  const { ExifTool } = require('exiftool-vendored');
  const et = new ExifTool();
  try {
    const sidecar1 = dest1.slice(0, -path.extname(dest1).length) + '.xmp';
    const sidecar2 = dest2.slice(0, -path.extname(dest2).length) + '.xmp';
    check(fs.existsSync(sidecar1) && fs.existsSync(sidecar2), 'XMP sidecars were created for both moved QMZ files');

    const tags1 = await et.read(sidecar1);
    log('qmz1.cr2 tags:', JSON.stringify({
      Creator: tags1.Creator, Rights: tags1.Rights, Subject: tags1.Subject,
      Location: tags1.Location, City: tags1.City, Country: tags1.Country, HijriDate: tags1.HijriDate,
    }));

    check((tags1.Creator?.[0] || tags1.Creator) === 'Jane Doe', 'QMZ write: Creator is correct');
    check(String(tags1.Rights || '').includes('Aljamea-tus-Saifiyah'), 'QMZ write: Copyright is correct');
    check(tags1.Location === 'Hall A', 'QMZ write: location is correct');
    check(tags1.City === 'Mumbai', 'QMZ write: city is correct');
    check(tags1.Country === 'India', 'QMZ write: country is correct');
    // exiftool-vendored returns a date-typed tag as a structured ExifDate object
    // ({_ctor, year, month, day, rawValue}), not a plain string — compare rawValue.
    const hijriRaw = tags1.HijriDate?.rawValue || tags1.HijriDate?.[0]?.rawValue || String(tags1.HijriDate || '');
    check(hijriRaw === '1448-02-10', 'QMZ write: Hijri date is correct — this field was SILENTLY DROPPED by the original root-cause bug');

    const subject1 = Array.isArray(tags1.Subject) ? tags1.Subject : (tags1.Subject ? [tags1.Subject] : []);
    log('QMZ keywords actually written:', subject1);
    check(subject1.length > 0, 'QMZ write: keywords are non-empty — the original root-cause bug silently dropped these to zero');
    check(!subject1.some(k => /^\d{2}[QMZ]$/i.test(String(k).trim())), 'QMZ write: sequence code (e.g. 01Q) is NEVER written as a keyword');
    check(subject1.includes('Hall A') && subject1.includes('Mumbai') && subject1.includes('India'), 'QMZ write: keywords include location/city/country');
  } finally {
    await et.end().catch(() => {});
  }

  log('=== SUMMARY:', failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`, '===');
  await electronApp.close().catch(() => {});
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[qmz-e2e] FATAL:', err);
  process.exit(1);
});
