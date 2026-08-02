'use strict';

// Proves the read-only verification pass (Transfer Import / same-size-skip scope):
// never writes, correctly classifies excluded/ambiguous/incomplete/complete, and
// reads RAW sidecars (not the RAW file's own embedded tags) — real ExifTool,
// isolated temp fixtures.
//
// Run with the real Electron binary (transitively needs app.getPath via exifService.js):
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --no-sandbox \
//     --user-data-dir=<isolated tmp dir> test/metadataVerificationService.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { verifyFiles } = require('../main/metadataVerificationService');
const { applyBatch, getBatchStatus, shutdown } = require('../main/exifService');

let passed = 0;
async function t(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok — ${name}`);
  } catch (err) {
    console.error(`  FAIL — ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function mkTmp() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'ai-mvs-'));
}

function context(diskComponents) {
  return {
    photographer: 'Zainab', hijriDate: '1448-05-01', eventDescription: 'Test Event',
    groups: [], diskComponents,
  };
}

async function runBatchAndWait(dest, ctx) {
  const batchId = `mvs-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  applyBatch(batchId, [{ src: dest, dest }], ctx, null);
  for (let i = 0; i < 200; i++) {
    const s = getBatchStatus(batchId);
    if (s && (s.done + s.skipped + s.failed) >= s.total) return s;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('batch did not finish in time');
}

(async () => {
  console.log('metadataVerificationService (real ExifTool, isolated fixtures)');

  await t('video files are excluded, never read or flagged incomplete', async () => {
    const dir = await mkTmp();
    const video = path.join(dir, 'clip.mp4');
    await fsp.writeFile(video, 'not-a-real-video');
    const results = await verifyFiles([{ src: video, dest: video }], context([{ location: 'Hall', city: 'X', country: 'Y', types: ['Majlis'], folderName: null }]));
    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'excluded');
  });

  await t('no matching component → ambiguous, never read', async () => {
    const dir = await mkTmp();
    const img = path.join(dir, 'photo.cr2');
    await fsp.writeFile(img, 'not-a-real-raw');
    const results = await verifyFiles([{ src: img, dest: img }], context([])); // zero components → ambiguous
    assert.equal(results[0].status, 'ambiguous');
  });

  await t('RAW without a sidecar yet → incomplete (not-yet-tagged), never creates one', async () => {
    const dir = await mkTmp();
    const raw = path.join(dir, 'photo.cr2');
    await fsp.writeFile(raw, 'not-a-real-raw');
    const results = await verifyFiles([{ src: raw, dest: raw }], context([{ location: 'Hall', city: 'X', country: 'Y', types: ['Majlis'], folderName: null }]));
    assert.equal(results[0].status, 'incomplete');
    assert.deepEqual(results[0].mismatches, ['not-yet-tagged']);
    const sidecar = raw.slice(0, -path.extname(raw).length) + '.xmp';
    assert.equal(fs.existsSync(sidecar), false, 'verification must never write, not even a stub sidecar');
  });

  await t('correctly-tagged RAW (via a real write) verifies complete', async () => {
    const dir = await mkTmp();
    const raw = path.join(dir, 'photo.cr2');
    await fsp.writeFile(raw, 'not-a-real-raw');
    const comps = [{ location: 'Hall B', city: 'Karachi', country: 'Pakistan', types: ['Majlis'], folderName: null }];
    await runBatchAndWait(raw, context(comps));

    const results = await verifyFiles([{ src: raw, dest: raw }], context(comps));
    assert.equal(results[0].status, 'complete');
  });

  await t('tagged-but-wrong-expectation RAW verifies incomplete with real mismatches', async () => {
    const dir = await mkTmp();
    const raw = path.join(dir, 'photo.cr2');
    await fsp.writeFile(raw, 'not-a-real-raw');
    const originalComps = [{ location: 'Hall B', city: 'Karachi', country: 'Pakistan', types: ['Majlis'], folderName: null }];
    await runBatchAndWait(raw, context(originalComps));

    // Verify against a DIFFERENT expected city — must be flagged incomplete, and the
    // real on-disk tags must be unaffected by verification itself.
    const differentComps = [{ location: 'Hall B', city: 'Lahore', country: 'Pakistan', types: ['Majlis'], folderName: null }];
    const results = await verifyFiles([{ src: raw, dest: raw }], context(differentComps));
    assert.equal(results[0].status, 'incomplete');
    assert.ok(results[0].mismatches.includes('city'));
  });

  await shutdown().catch(() => {});
  console.log(`${passed} passed`);
  if (process.exitCode) console.log('SOME TESTS FAILED');
  process.exit(process.exitCode || 0);
})();
