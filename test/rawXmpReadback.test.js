'use strict';

// Proves — with real ExifTool, real files, isolated temp fixtures — that
// exifService's post-write read-back for RAW files reads the .xmp SIDECAR it
// wrote, never the RAW file's own embedded tags. This is the single easiest
// verification-correctness detail in the whole metadata pipeline to get wrong
// silently (exiftool-vendored happily reads whatever path it's pointed at).
// Run with the real Electron binary, not plain node — exifService.js transitively
// requires services/logger.js, which calls Electron's app.getPath('userData'):
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --no-sandbox test/rawXmpReadback.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { applyBatch, getBatchStatus, readFileTags, shutdown } = require('../main/exifService');

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

function mkTmp() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'ai-raw-xmp-'));
}

function context({ photographer = 'Jane', hijriDate = '1448-02-10', eventDescription = 'Waaz Mubarak', location = 'Hall B', city = 'Karachi', country = 'Pakistan', types = ['Majlis'] } = {}) {
  return {
    photographer, hijriDate, eventDescription,
    groups: [],
    diskComponents: [{ location, city, country, types, folderName: null }],
  };
}

async function runBatchAndWait(dest, ctxOverrides, srcOverride) {
  const batchId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const src = srcOverride || dest;
  applyBatch(batchId, [{ src, dest }], context(ctxOverrides), null);
  let status;
  for (let i = 0; i < 200; i++) {
    status = getBatchStatus(batchId);
    if (status && (status.done + status.skipped + status.failed) >= status.total) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  return status;
}

(async () => {
  console.log('rawXmpReadback (real ExifTool, isolated temp fixtures)');

  await t('RAW without sidecar: write creates the sidecar and read-back proves complete', async () => {
    const dir = await mkTmp();
    const raw = path.join(dir, 'photo.cr2');
    await fsp.writeFile(raw, Buffer.from('not-a-real-raw-file-just-bytes'));
    const sidecar = raw.slice(0, -path.extname(raw).length) + '.xmp';
    assert.ok(!fs.existsSync(sidecar), 'sidecar must not exist yet');

    const status = await runBatchAndWait(raw, {});
    assert.equal(status.done, 1);
    assert.equal(status.failed, 0);
    assert.ok(fs.existsSync(sidecar), 'sidecar must now exist');

    const sidecarTags = await readFileTags(sidecar);
    assert.equal(sidecarTags.Creator?.[0] || sidecarTags.Creator, 'Jane');
    assert.match(String(sidecarTags.Description ?? ''), /Waaz Mubarak/);
  });

  await t('reading the RAW path directly does NOT show the sidecar-only tags (the core claim under test)', async () => {
    const dir = await mkTmp();
    const raw = path.join(dir, 'photo.cr2');
    await fsp.writeFile(raw, Buffer.from('not-a-real-raw-file-just-bytes'));
    await runBatchAndWait(raw, { photographer: 'Ahmed' });

    const rawTagsDirect = await readFileTags(raw);
    // The RAW file's own bytes were never touched — no embedded Creator was ever
    // written to it, so reading the RAW path directly must NOT show it either.
    assert.notEqual(rawTagsDirect.Creator?.[0] || rawTagsDirect.Creator, 'Ahmed');
  });

  await t('RAW with a pre-existing sidecar containing unrelated metadata: unrelated fields survive the write', async () => {
    const dir = await mkTmp();
    const raw = path.join(dir, 'photo.cr2');
    const sidecar = raw.slice(0, -path.extname(raw).length) + '.xmp';
    await fsp.writeFile(raw, Buffer.from('not-a-real-raw-file-just-bytes'));

    const { ExifTool } = require('exiftool-vendored');
    const et = new ExifTool({ exiftoolArgs: ['-config', path.join(__dirname, '..', 'main', 'exiftool-config.pl'), '-stay_open', 'True', '-@', '-'] });
    try {
      const stub = '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/">\n</x:xmpmeta>\n<?xpacket end="w"?>\n';
      await fsp.writeFile(sidecar, stub, 'utf8');
      await et.write(sidecar, { 'XMP:Rating': '5', 'XMP-photoshop:Instructions': 'do-not-touch' }, ['-overwrite_original']);
    } finally {
      await et.end().catch(() => {});
    }

    await runBatchAndWait(raw, { photographer: 'Fatima' });

    const after = await readFileTags(sidecar);
    assert.equal(after.Creator?.[0] || after.Creator, 'Fatima');
    assert.equal(String(after.Rating ?? ''), '5');
    assert.equal(after.Instructions, 'do-not-touch');
  });

  await t('RAW after a second write (merge/repair-style rerun): app fields update, no duplicate sidecar, no keyword duplication', async () => {
    const dir = await mkTmp();
    const raw = path.join(dir, 'photo.cr2');
    const sidecar = raw.slice(0, -path.extname(raw).length) + '.xmp';
    await fsp.writeFile(raw, Buffer.from('not-a-real-raw-file-just-bytes'));

    await runBatchAndWait(raw, { photographer: 'Zainab', city: 'Karachi' });
    const first = await readFileTags(sidecar);
    const firstSubjectCount = (Array.isArray(first.Subject) ? first.Subject : [first.Subject]).filter(Boolean).length;

    await runBatchAndWait(raw, { photographer: 'Zainab', city: 'Karachi' }); // idempotent rerun, same expectation
    const second = await readFileTags(sidecar);
    const secondSubjectCount = (Array.isArray(second.Subject) ? second.Subject : [second.Subject]).filter(Boolean).length;

    assert.equal(secondSubjectCount, firstSubjectCount, 'keywords must not duplicate on rerun');
    assert.equal(second.Creator?.[0] || second.Creator, 'Zainab');

    const sidecarSiblings = (await fsp.readdir(dir)).filter((f) => f.endsWith('.xmp'));
    assert.equal(sidecarSiblings.length, 1, 'exactly one sidecar must exist, never a duplicate');
  });

  console.log(`${passed} passed`);
  await shutdown().catch(() => {});
  process.exit(process.exitCode || 0);
})();
