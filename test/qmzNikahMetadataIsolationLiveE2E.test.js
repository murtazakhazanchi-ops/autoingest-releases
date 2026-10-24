'use strict';
// "AutoIngest — Sanitize QMZ Fixture and Publish Combined Preview v0.9.16-rc.3" — Phase 3's
// strict release requirement, verified BEHAVIORALLY (not just by static source inspection —
// see test/qmzNikahPersistence.test.js's checks 12-13 for that): drives the REAL QMZ
// automatic metadata-tagging path (real UI assignment → real qmz:queueMetadata IPC → real
// exiftool-vendored write) against a genuinely Nikah-flagged sequence, then reads back the
// ACTUAL written file metadata and proves "Nikah" never appears in it anywhere, while the
// ordinary Q/M/Z-derived tags are still written correctly (so this is a real behavioral
// negative, not an accidentally-broken pipeline that writes nothing at all).
//
// Modeled directly on test/qmzLiveE2E.test.js's own real-ExifTool-read-back pattern.
// Run: node test/qmzNikahMetadataIsolationLiveE2E.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[qmz-nikah-metadata-e2e]', ...args); }
let failures = 0;
function check(cond, msg) { if (cond) { log('PASS —', msg); } else { failures++; log('FAIL —', msg); } }

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }
async function rawFile(p) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, Buffer.from('not-a-real-raw-file-just-bytes'));
}
async function domClick(window, selector) {
  return window.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return false; el.click(); return true; }, selector);
}

(async () => {
  const userDataDir = await mkTmp('ai-qmz-nikah-meta-e2e-userdata-');
  const qmzRoot = await mkTmp('ai-qmz-nikah-meta-e2e-root-');

  const pgDir = path.join(qmzRoot, '_Unsequenced', 'Jane Doe');
  await rawFile(path.join(pgDir, 'metadata-check.cr2'));

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
    await window.fill('#splashInputName', 'Nikah Metadata E2E Operator');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'Nikah Metadata E2E Operator');
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

  const eventContext = {
    component: { location: 'Hall A', city: 'Mumbai', country: 'India' },
    isMulti: false, eventTitle: 'Metadata Isolation Regression Check', hijriDate: '1448-02-10',
    eventJsonPath: null, componentTitle: null,
  };
  await window.evaluate(({ root, ctx }) => window.openQMZManager(root, ctx), { root: qmzRoot, ctx: eventContext });
  await window.waitForTimeout(1000);
  check(await window.evaluate(() => !document.getElementById('qmzOverlay')?.classList.contains('hidden')), '1. QMZ opens');

  // ── Create a genuinely Nikah-flagged sequence via the real reviewed-sequences IPC
  // (the same backend call the PDF-review "Confirm & Create" flow uses) — NOT the plain
  // manual qmz:createSequence IPC, which deliberately has no hasNikah parameter at all
  // (adding Nikah manually was never requested — see main/qmzService.js's own comments).
  const createRes = await window.evaluate((root) => window.api.qmzCreateReviewedSequences({
    qmzRoot: root, entries: [{ number: 1, letter: 'Z', suffix: '', hasNikah: true }], includeEnroute: false,
  }), qmzRoot);
  log('qmzCreateReviewedSequences result:', JSON.stringify(createRes));
  check(createRes?.ok === true && createRes?.results?.[0]?.code === '01Z', '2. sequence 01Z is created via the real reviewed-sequences backend, with Nikah positively identified');

  const stateAfterCreate = JSON.parse(await fsp.readFile(path.join(qmzRoot, 'qmz-sequences.json'), 'utf8'));
  const rec = stateAfterCreate.sequences.find(s => s.code === '01Z');
  check(!!rec?.additionalActivities?.includes('Nikah'), '3. qmz-sequences.json actually persisted additionalActivities: ["Nikah"] for 01Z before any file is tagged');

  // ── Assign the synthetic file to 01Z via the REAL UI flow (number input + Enter →
  // _qmzHandleAssignByNumber → real qmzMoveToSequence IPC → real _qmzAutoQueueMetadata →
  // real qmz:queueMetadata → real applyBatch/exiftool-vendored write) ───────────────────
  await window.evaluate(async () => { if (typeof _qmzRefresh === 'function') await _qmzRefresh(); });
  await window.waitForTimeout(300);
  await domClick(window, '.qmz-pg-row[data-pg="Jane Doe"]');
  await window.waitForTimeout(300);
  await window.evaluate(() => {
    document.querySelectorAll('#qmzFileGrid input[type="checkbox"][data-path]').forEach(cb => {
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  await window.waitForTimeout(300);
  await window.evaluate(() => {
    const input = document.getElementById('qmzAssignInput');
    input.value = '1';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });

  let qmzStatusText = null;
  for (let i = 0; i < 20; i++) {
    await window.waitForTimeout(500);
    qmzStatusText = await window.evaluate(() => document.querySelector('.qmz-status')?.textContent || null);
    if (qmzStatusText && /moved|queued/i.test(qmzStatusText)) break;
  }
  check(!!qmzStatusText && /moved/i.test(qmzStatusText), '4. the file is actually assigned to 01Z via the real UI flow');
  await window.waitForTimeout(4000); // let the fire-and-forget metadata batch finish writing

  const destFile = path.join(qmzRoot, '01Z', 'Jane Doe', 'metadata-check.cr2');
  check(fs.existsSync(destFile), '5. the file was physically moved into the Nikah-flagged 01Z sequence folder');

  // ── Real ExifTool read-back — the actual point of this test ───────────────────────────
  const { ExifTool } = require('exiftool-vendored');
  const et = new ExifTool();
  try {
    const sidecar = destFile.slice(0, -path.extname(destFile).length) + '.xmp';
    check(fs.existsSync(sidecar), '6. an XMP sidecar was written for the Nikah-flagged sequence\'s file, same as any ordinary sequence');

    const tags = await et.read(sidecar);
    const subject = Array.isArray(tags.Subject) ? tags.Subject : (tags.Subject ? [tags.Subject] : []);
    log('actual written keywords/Subject:', JSON.stringify(subject));

    // The positive case first — prove the pipeline actually ran and wrote real tags,
    // so an absence of "Nikah" below is a genuine isolation proof, not a broken write.
    check(subject.length > 0, '7. real Q/M/Z-derived keywords WERE written (the pipeline genuinely ran, not silently no-op)');
    check(subject.includes('Ziyafat'), '8. the Z-type\'s own "Ziyafat" keyword is present, exactly as it would be for any Z sequence with no Nikah at all');

    // The actual isolation proof — every CONTENT tag ExifTool read back (excluding
    // filesystem-path bookkeeping fields like SourceFile/Directory/FileName, which
    // reflect this test's own temp-dir naming, not written photo content), searched
    // case-insensitively for "nikah". Broader than just Subject/Keywords: also covers
    // Caption/Description/UserComment/any other field a future change might route through.
    const PATH_FIELDS = new Set(['SourceFile', 'Directory', 'FileName', 'errors', 'warnings']);
    const allStrings = Object.entries(tags).filter(([k]) => !PATH_FIELDS.has(k)).flatMap(([, v]) => {
      if (typeof v === 'string') return [v];
      if (Array.isArray(v)) return v.filter(x => typeof x === 'string');
      return [];
    });
    const leaked = allStrings.filter(s => /nikah/i.test(s));
    check(leaked.length === 0, `9. "Nikah" appears NOWHERE in the actual written file metadata, across every string-valued tag ExifTool read back (found: ${JSON.stringify(leaked)})`);
  } finally {
    await et.end();
  }

  await electronApp.close().catch(() => {});

  log(failures === 0 ? 'ALL CHECKS PASSED (final)' : `${failures} CHECK(S) FAILED (final)`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('[qmz-nikah-metadata-e2e] FATAL', err);
  process.exit(1);
});
