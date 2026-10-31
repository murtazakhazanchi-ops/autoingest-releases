'use strict';

// AI-FEAT-061 Q2 — integration: the capture-date READER on real files, through the real
// fileBrowser discovery rules and the real shared ExifTool pool (main/exifService.js).
//   - the exifr fast path (non-RAW photos) and the ExifTool path give the SAME evidence;
//   - a JPEG without EXIF falls back to ExifTool and is uncertain (never a filesystem date);
//   - RAW (TIFF-based) and MP4 (moov after mdat, as cameras write it) are read via ExifTool;
//   - the full assessor on a fixture card equals the fixture truth, and the files are
//     unchanged afterwards (read-only).
//
// Run: node test/companionQ2CaptureReader.test.js

const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { ExifTool } = require('exiftool-vendored');
const { readCaptureTags } = require('../services/captureDateReader');
const { captureEvidence } = require('../services/captureDateEvidence');
const { createCardAssessor } = require('../services/cardAssessmentService');
const { summarize } = require('../services/dateAssessmentModel');
const { scanMediaRecursive } = require('../main/fileBrowser');
const exifService = require('../main/exifService');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

function mp4Bytes(utcSeconds) {
  const box = (type, body) => { const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length); h.write(type, 4, 'latin1'); return Buffer.concat([h, body]); };
  const mvhd = Buffer.alloc(100);
  const t = utcSeconds + 2082844800;
  mvhd.writeUInt32BE(t, 4); mvhd.writeUInt32BE(t, 8); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(1000, 16);
  mvhd.writeUInt32BE(0x00010000, 20); mvhd.writeUInt16BE(0x0100, 24);
  [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].forEach((v, i) => mvhd.writeUInt32BE(v >>> 0, 36 + i * 4));
  mvhd.writeUInt32BE(2, 96);
  const ftyp = box('ftyp', Buffer.concat([Buffer.from('isom'), Buffer.from([0, 0, 2, 0]), Buffer.from('isomiso2mp41')]));
  return Buffer.concat([ftyp, box('mdat', Buffer.alloc(80 * 1024)), box('moov', box('mvhd', mvhd))]);
}

(async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-q2-reader-'));
  const dcim = path.join(root, 'DCIM', '100TEST');
  await fsp.mkdir(dcim, { recursive: true });
  const noise = Buffer.alloc(240 * 240 * 3); for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919) % 251;
  const jpg = await sharp(noise, { raw: { width: 240, height: 240, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
  const tif = await sharp(noise, { raw: { width: 240, height: 240, channels: 3 } }).tiff({ compression: 'none' }).toBuffer();
  const et = new ExifTool({ maxProcs: 1 });
  const put = async (name, bytes, tags) => {
    const p = path.join(dcim, name);
    await fsp.writeFile(p, bytes);
    if (tags) await et.write(p, tags, { writeArgs: ['-overwrite_original'] });
    return p;
  };
  const files = {
    jpgOffset: await put('A.JPG', jpg, { DateTimeOriginal: '2026:10:31 23:30:00', SubSecTimeOriginal: '12', OffsetTimeOriginal: '-07:00', CreateDate: '2026:10:31 23:30:00' }),
    jpgPlain: await put('B.JPG', jpg, { DateTimeOriginal: '2026:10:29 08:00:00' }),
    jpgNone: await put('C.JPG', jpg, null),
    raw: await put('A.ARW', tif, { DateTimeOriginal: '2026:10:31 23:30:01' }),
    mp4: await put('V.MP4', mp4Bytes(Date.UTC(2026, 9, 31, 12, 0, 0) / 1000), null),
  };
  await et.end();
  const before = Object.fromEntries(await Promise.all(Object.values(files).map(async p => { const st = await fsp.stat(p); return [p, `${st.size}:${st.mtimeMs}`]; })));

  try {
    await t('exifr fast path and the ExifTool pool give identical evidence for JPEG', async () => {
      for (const p of [files.jpgOffset, files.jpgPlain]) {
        const fast = captureEvidence(await readCaptureTags(p, 'photo'), 'photo');
        const slow = captureEvidence(await exifService.readFileTags(p), 'photo');
        assert.deepEqual([fast.status, fast.date, fast.time, fast.offset], [slow.status, slow.date, slow.time, slow.offset], path.basename(p));
      }
      const a = captureEvidence(await readCaptureTags(files.jpgOffset, 'photo'), 'photo');
      assert.deepEqual([a.date, a.time, a.offset], ['2026-10-31', '23:30:00', '-07:00']);
    });

    await t('JPEG without EXIF: falls back to ExifTool, uncertain — the filesystem date is never used', async () => {
      const e = captureEvidence(await readCaptureTags(files.jpgNone, 'photo'), 'photo');
      assert.deepEqual([e.status, e.reason], ['uncertain', 'no-capture-metadata']);
    });

    await t('RAW and MP4 (moov after mdat) are read through the shared ExifTool pool', async () => {
      const r = captureEvidence(await readCaptureTags(files.raw, 'raw'), 'raw');
      assert.deepEqual([r.status, r.date, r.time], ['dated', '2026-10-31', '23:30:01']);
      const v = captureEvidence(await readCaptureTags(files.mp4, 'video'), 'video');
      assert.equal(v.source, 'CreateDate', 'QuickTime CreateDate found with the default -fast read');
      assert.ok(v.status === 'dated' ? v.confidence === 'low' : v.reason === 'video-timezone-ambiguous', JSON.stringify(v));
    });

    await t('assessor on a fixture card (real discovery + real reader) matches the fixture truth', async () => {
      const a = createCardAssessor({
        listMedia: scanMediaRecursive,
        readTags: readCaptureTags,
        statMount: async (mp) => { try { const st = await fsp.stat(mp); return { dev: st.dev, ino: st.ino }; } catch { return null; } },
      });
      a.sync([{ sourceId: 'src-1', mountpoint: root, label: 'TEST' }]);
      const end = Date.now() + 30000;
      while (a.get('src-1').state !== 'complete' && Date.now() < end) await new Promise(r => setTimeout(r, 50));
      const s = summarize(a.get('src-1').records, { today: '2026-10-31' });
      assert.equal(s.counts.total, 5);
      assert.equal(s.counts.earlier, 1, 'B.JPG on 29 Oct');
      assert.equal(s.counts.uncertain + s.counts.selected, 4);
      assert.ok(s.counts.selected >= 3, 'A.JPG + A.ARW pair (+ the MP4 when its day is unambiguous here)');
      assert.equal(s.selectedBreakdown.pairs, 1);
      a.shutdown();
    });

    await t('source files are unchanged after reading (read-only)', async () => {
      for (const [p, sig] of Object.entries(before)) {
        const st = await fsp.stat(p);
        assert.equal(`${st.size}:${st.mtimeMs}`, sig, path.basename(p));
      }
      assert.deepEqual(fs.readdirSync(dcim).sort(), ['A.ARW', 'A.JPG', 'B.JPG', 'C.JPG', 'V.MP4']);
    });
  } finally {
    await exifService.shutdown();
    await fsp.rm(root, { recursive: true, force: true });
  }
  console.log(`${passed} passed`);
})();
