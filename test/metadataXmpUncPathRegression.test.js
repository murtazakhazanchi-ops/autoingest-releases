'use strict';

// Regression test for the "RAW/XMP metadata write failure" production bug: on a
// Windows client, importing RAW photos onto a NAS archive succeeded (241 copied,
// 0 failed) but the metadata-write step then reported "241 failed", with the
// Activity Log showing "Error creating file: //FQ_PhotoArchive/...". Windows
// Explorer showed .xmp sidecars physically present next to the .CR3 files, but
// their presence did NOT mean the write succeeded.
//
// Root cause (confirmed by direct code trace): archive destination paths are
// built by forward-slash string concatenation (renderer/importRouter.js), so a
// UNC root ("\\FQ_PhotoArchive\...") can reach main/exifService.js already
// reshaped as "//FQ_PhotoArchive/...". Node's own fs tolerates that shape on
// Windows (so the RAW copy and the pre-write XMP stub creation both succeed —
// exactly why Explorer showed the sidecar), but ExifTool's Perl child process
// does not resolve a "//server/share/..."-shaped path the way it resolves
// "\\server\share\...", and throws "Error creating file: ..." — matching the
// exact reported error. Because the stub was already written to disk before
// that failure, every "failed" file left behind an empty, misleading sidecar
// that looked like success. Both import-time metadata writing (applyBatch) and
// "Metadata Maintenance" repair (resumeFrozenFile) converge on the same shared
// writer (_writeMetadata) and inherited the identical malformed path from the
// durable manifest — explaining why repair also failed, with no code
// duplication between the two paths.
//
// Fix (main/exifService.js):
//   1. _normalizeArchivePath(filePath) — rewrites a UNC-shaped path ("\\..." or
//      "//...") to proper native "\\server\share\..." form via
//      path.win32.normalize, but leaves drive-letter and POSIX paths untouched
//      on every platform (path.win32.normalize would otherwise corrupt a real
//      POSIX path by turning every "/" into "\" — verified empirically; see
//      TEST 1). Applied at every shared read/write choke point: _writeMetadata,
//      readFileTags, classifyForVerification, and _writeAndVerify's read-back
//      path for non-RAW files.
//   2. Failure hygiene: a freshly-created XMP stub is deleted if the real
//      ExifTool write then fails, so a failed file never leaves behind a
//      misleading "sidecar exists" artifact and stays cleanly retryable. A
//      sidecar that already existed before the call (real prior content, or a
//      previous successful write) is never touched on a failed retry.
//
// TEST 1 — pure path-shape unit test of _normalizeArchivePath, extracted
//          directly from the real source (source-drift guarded — same
//          convention as test/l5ExifBatchContextSanitization.test.js).
// TEST 2 — real ExifTool integration: a normal local RAW/XMP write (no
//          existing sidecar) still succeeds end-to-end through applyBatch
//          after the fix, and the sidecar is valid/readable — proves the fix
//          does not regress the happy path.
// TEST 3 — real ExifTool integration: a RAW file that ALREADY has a valid
//          sidecar (prior successful write) is correctly re-verified/rewritten
//          without data loss.
// TEST 4 — real ExifTool integration with a monkey-patched ExifTool.write that
//          fails deterministically: proves (a) a freshly-created stub is
//          removed on failure — no empty "success-looking" artifact left
//          behind, (b) a batch that failed is retryable — the very next
//          attempt (failure removed) succeeds cleanly, producing a valid,
//          non-empty sidecar with the correct tags.
//
// Run with the real Electron binary (exifService.js transitively needs
// Electron's app.getPath via services/logger.js and services/settings.js):
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --no-sandbox \
//     --user-data-dir=<isolated tmp dir> test/metadataXmpUncPathRegression.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

process.env.AUTOINGEST_METADATA_QUEUE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-xmp-unc-queue-'));

const PROJECT_ROOT = path.resolve(__dirname, '..');

let passed = 0;
function ok(name) { passed++; console.log(`  ok — ${name}`); }
function fail(name, detail) {
  process.exitCode = 1;
  console.error(`  FAIL — ${name}`);
  if (detail !== undefined) console.error(detail);
}
async function t(name, fn) {
  try { await fn(); ok(name); }
  catch (err) { fail(name, err && err.stack || err); }
}

// ── TEST 1: _normalizeArchivePath, extracted from the real source ───────────
(function test1() {
  console.log('=== TEST 1: _normalizeArchivePath (real source, direct eval) ===');

  const src = fs.readFileSync(path.join(PROJECT_ROOT, 'main', 'exifService.js'), 'utf8');
  const m = /function _normalizeArchivePath\(filePath\) \{[\s\S]*?\n\}/.exec(src);
  if (!m) {
    fail('TEST 1: _normalizeArchivePath function found in main/exifService.js source', 'Function not found — was it renamed or removed?');
    return;
  }
  ok('TEST 1: _normalizeArchivePath found in source');

  // eslint-disable-next-line no-new-func
  const _normalizeArchivePath = new Function('path', `${m[0]}\nreturn _normalizeArchivePath;`)(path);

  // The exact malformed shape from the bug report's Activity Log.
  assert.equal(
    _normalizeArchivePath('//FQ_PhotoArchive/02-Working-AJSS/Event/Photographer/ALI43043.CR3'),
    '\\\\FQ_PhotoArchive\\02-Working-AJSS\\Event\\Photographer\\ALI43043.CR3'
  );
  ok('TEST 1: forward-slash UNC ("//server/share/...") repaired to proper "\\\\server\\share\\..." form');

  // Already-correct backslash UNC must round-trip unchanged (idempotent).
  assert.equal(
    _normalizeArchivePath('\\\\FQ_PhotoArchive\\02-Working-AJSS\\Event\\Photographer\\ALI43043.CR3'),
    '\\\\FQ_PhotoArchive\\02-Working-AJSS\\Event\\Photographer\\ALI43043.CR3'
  );
  ok('TEST 1: an already-correct backslash UNC path is unchanged (idempotent)');

  // A UNC path containing spaces (real archive event/photographer names do).
  assert.equal(
    _normalizeArchivePath('//FQ_PhotoArchive/02-Working-AJSS/Waaz Mubarak/Ali Husain Jamali/IMG 001.CR3'),
    '\\\\FQ_PhotoArchive\\02-Working-AJSS\\Waaz Mubarak\\Ali Husain Jamali\\IMG 001.CR3'
  );
  ok('TEST 1: UNC path with spaces in event/photographer names is repaired correctly');

  // Critical safety property: a REAL POSIX path (this test's own tmp fixtures,
  // and any Mac-mounted archive) must be returned byte-for-byte unchanged.
  // path.win32.normalize applied unconditionally would corrupt this by turning
  // every "/" into "\", breaking real fs I/O off-Windows — this is exactly the
  // defect this test guards against.
  const posixPath = '/private/var/folders/xx/tmp/Event/Photographer/IMG_0001.CR3';
  assert.equal(_normalizeArchivePath(posixPath), posixPath);
  ok('TEST 1: an ordinary POSIX path is returned untouched (not corrupted into backslash form)');

  // A local Windows drive-letter path is untouched (already correct; not UNC-shaped).
  const drivePath = 'C:\\Archive\\Event Name\\Photographer\\IMG001.CR3';
  assert.equal(_normalizeArchivePath(drivePath), drivePath);
  ok('TEST 1: a Windows drive-letter path is left untouched');

  assert.equal(_normalizeArchivePath(null), null);
  assert.equal(_normalizeArchivePath(undefined), undefined);
  ok('TEST 1: null/undefined input handled without throwing');
})();

// Guards against the fix existing but not actually being wired into every
// shared read/write choke point (source-drift guarded, like TEST 0 in
// l5ExifBatchContextSanitization.test.js).
(function test1b() {
  console.log('=== TEST 1b: call-site wiring (source-drift guarded) ===');
  const src = fs.readFileSync(path.join(PROJECT_ROOT, 'main', 'exifService.js'), 'utf8');
  const sites = [
    ['_writeMetadata',            /filePath = _normalizeArchivePath\(filePath\);/],
    ['readFileTags',              /_getExifTool\(\)\.read\(_normalizeArchivePath\(filePath\)\);/],
    ['classifyForVerification',   /destPath = _normalizeArchivePath\(destPath\);/],
    ['_writeAndVerify read-back', /sidecar \|\| _normalizeArchivePath\(file\.dest\);/],
  ];
  for (const [label, re] of sites) {
    if (re.test(src)) ok(`TEST 1b: ${label} normalizes its path before use`);
    else fail(`TEST 1b: ${label} normalizes its path before use`, 'Expected pattern not found — fix may have been reverted or refactored');
  }
})();

// ── TESTS 2-4: real ExifTool integration ─────────────────────────────────────
(async () => {
  console.log('=== TESTS 2-4: live ExifTool integration ===');

  const { resolveExpectedMetadata } = require(path.join(PROJECT_ROOT, 'services/metadataExpectationService'));

  async function mkFixture() {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-xmp-unc-'));
    const photoDir = path.join(dir, 'Fatema Rasheed');
    await fsp.mkdir(photoDir, { recursive: true });
    return { dir, photoDir };
  }

  function evidence(filePath) {
    return {
      filePath, photographer: 'Fatema Rasheed', hijriDate: '1448-03-01',
      eventDescription: 'Waaz Mubarak',
      groups: [{ id: 'root', subEventId: null, files: [filePath] }],
      diskComponents: [{ location: 'Hall A', city: 'Mumbai', country: 'India', types: ['Majlis'], folderName: null }],
    };
  }

  async function waitDone(getBatchStatus, batchId, timeoutMs = 10000) {
    const start = Date.now();
    for (;;) {
      const s = getBatchStatus(batchId);
      if (s && (s.done + s.skipped + s.failed) >= s.total) return s;
      if (Date.now() - start > timeoutMs) throw new Error(`batch ${batchId} did not finish within ${timeoutMs}ms`);
      await new Promise(r => setTimeout(r, 50));
    }
  }

  // ── TEST 2: normal local write still works (no existing sidecar) ──────────
  await t('TEST 2: a normal RAW/XMP write with no existing sidecar succeeds and produces a valid, readable sidecar', async () => {
    const { applyBatch, getBatchStatus, readFileTags, shutdown: _s } = require(path.join(PROJECT_ROOT, 'main/exifService'));
    const { photoDir } = await mkFixture();
    const file = path.join(photoDir, 'IMG_0001.cr2');
    await fsp.writeFile(file, Buffer.from('not-a-real-raw-file-just-bytes'));
    const sidecar = file.slice(0, -path.extname(file).length) + '.xmp';

    const batchId = `unc-regress-normal-${Date.now()}`;
    applyBatch(batchId, [{ src: file, dest: file }], {
      photographer: 'Fatema Rasheed', hijriDate: '1448-03-01', eventDescription: 'Waaz Mubarak',
      groups: [], diskComponents: evidence(file).diskComponents,
    }, null);
    const status = await waitDone(getBatchStatus, batchId);
    assert.equal(status.done, 1, `expected 1 done, got status=${JSON.stringify(status)}`);
    assert.equal(status.failed, 0);

    assert.ok(fs.existsSync(sidecar), 'sidecar must exist after a successful write');
    const stat = await fsp.stat(sidecar);
    assert.ok(stat.size > 0, 'sidecar must be non-empty after a successful write');

    const tags = await readFileTags(sidecar);
    assert.equal(tags.Creator?.[0] || tags.Creator, 'Fatema Rasheed');
    assert.ok(String(tags.Subject || tags.Keywords || '').includes('Majlis'), 'expected fields readable back from the sidecar');
  });

  // ── TEST 3: existing valid sidecar is correctly handled ────────────────────
  await t('TEST 3: a RAW file with an already-existing valid sidecar is re-verified without data loss', async () => {
    const { applyBatch, getBatchStatus, readFileTags } = require(path.join(PROJECT_ROOT, 'main/exifService'));
    const { photoDir } = await mkFixture();
    const file = path.join(photoDir, 'IMG_0002.cr2');
    await fsp.writeFile(file, Buffer.from('not-a-real-raw-file-just-bytes'));
    const sidecar = file.slice(0, -path.extname(file).length) + '.xmp';

    const firstBatch = `unc-regress-existing-1-${Date.now()}`;
    applyBatch(firstBatch, [{ src: file, dest: file }], {
      photographer: 'Fatema Rasheed', hijriDate: '1448-03-01', eventDescription: 'Waaz Mubarak',
      groups: [], diskComponents: evidence(file).diskComponents,
    }, null);
    await waitDone(getBatchStatus, firstBatch);
    assert.ok(fs.existsSync(sidecar), 'setup: first write must produce a sidecar for this test to be meaningful');
    const mtimeAfterFirst = (await fsp.stat(sidecar)).mtimeMs;

    await new Promise(r => setTimeout(r, 20));

    const secondBatch = `unc-regress-existing-2-${Date.now()}`;
    applyBatch(secondBatch, [{ src: file, dest: file }], {
      photographer: 'Fatema Rasheed', hijriDate: '1448-03-01', eventDescription: 'Waaz Mubarak',
      groups: [], diskComponents: evidence(file).diskComponents,
    }, null);
    const status = await waitDone(getBatchStatus, secondBatch);
    assert.equal(status.done, 1);
    assert.equal(status.failed, 0);

    assert.ok(fs.existsSync(sidecar), 'sidecar must still exist after re-write');
    const tags = await readFileTags(sidecar);
    assert.equal(tags.Creator?.[0] || tags.Creator, 'Fatema Rasheed', 'metadata must still be correct after re-write over an existing sidecar');
  });

  // ── TEST 4: forced ExifTool write failure — stub cleanup + retryability ────
  await t('TEST 4: a freshly-created stub is removed on ExifTool write failure, and the file is cleanly retryable afterward', async () => {
    const { ExifTool } = require('exiftool-vendored');
    const origWrite = ExifTool.prototype.write;

    const { photoDir } = await mkFixture();
    const file = path.join(photoDir, 'IMG_0003.cr2');
    await fsp.writeFile(file, Buffer.from('not-a-real-raw-file-just-bytes'));
    const sidecar = file.slice(0, -path.extname(file).length) + '.xmp';

    let shouldFail = true;
    ExifTool.prototype.write = function (targetPath, tags, args) {
      if (shouldFail && targetPath === sidecar) {
        return Promise.reject(new Error('SIMULATED write failure (metadataXmpUncPathRegression test)'));
      }
      return origWrite.call(this, targetPath, tags, args);
    };

    try {
      const { applyBatch, getBatchStatus } = require(path.join(PROJECT_ROOT, 'main/exifService'));

      const failBatch = `unc-regress-fail-${Date.now()}`;
      applyBatch(failBatch, [{ src: file, dest: file }], {
        photographer: 'Fatema Rasheed', hijriDate: '1448-03-01', eventDescription: 'Waaz Mubarak',
        groups: [], diskComponents: evidence(file).diskComponents,
      }, null);
      const failStatus = await waitDone(getBatchStatus, failBatch);
      assert.equal(failStatus.failed, 1, `expected the simulated failure to be recorded, got status=${JSON.stringify(failStatus)}`);

      assert.equal(
        fs.existsSync(sidecar), false,
        'the freshly-created stub must be removed after a failed write — no misleading zero-byte "success" artifact should remain'
      );

      // Now let the write succeed — proves the file remains retryable, not
      // stuck because of leftover state from the failed attempt.
      shouldFail = false;
      const retryBatch = `unc-regress-retry-${Date.now()}`;
      applyBatch(retryBatch, [{ src: file, dest: file }], {
        photographer: 'Fatema Rasheed', hijriDate: '1448-03-01', eventDescription: 'Waaz Mubarak',
        groups: [], diskComponents: evidence(file).diskComponents,
      }, null);
      const retryStatus = await waitDone(getBatchStatus, retryBatch);
      assert.equal(retryStatus.done, 1, `expected the retry to succeed cleanly, got status=${JSON.stringify(retryStatus)}`);
      assert.equal(retryStatus.failed, 0);

      assert.ok(fs.existsSync(sidecar), 'sidecar must exist after the successful retry');
      const stat = await fsp.stat(sidecar);
      assert.ok(stat.size > 0, 'sidecar must be non-empty after the successful retry — not an orphaned/empty artifact');

      const { readFileTags } = require(path.join(PROJECT_ROOT, 'main/exifService'));
      const tags = await readFileTags(sidecar);
      assert.equal(tags.Creator?.[0] || tags.Creator, 'Fatema Rasheed', 'retried write must carry the correct metadata, not a stale/partial state');
    } finally {
      ExifTool.prototype.write = origWrite;
    }
  });

  const { shutdown } = require(path.join(PROJECT_ROOT, 'main/exifService'));
  await shutdown().catch(() => {});
  console.log(`\n${passed} check(s) passed.`);
  if (process.exitCode) console.log('SOME CHECKS FAILED');
  process.exit(process.exitCode || 0);
})().catch(err => {
  console.error('[metadataXmpUncPathRegression] FATAL:', err);
  process.exit(1);
});
