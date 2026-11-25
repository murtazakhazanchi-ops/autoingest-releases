// test/eqi32CaptureTime.test.js — EQI-3.2 hotfix: the Import Workspace / Sort Dump capture time
// (services/captureTimeResolver.js). Pure policy cases, then real files written with the real ExifTool
// whose filesystem modification time is deliberately far from their capture time.
// Run: node test/eqi32CaptureTime.test.js

'use strict';

const assert = require('node:assert/strict');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { ExifTool } = require('exiftool-vendored');
const R = require('../services/captureTimeResolver');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

function mp4Bytes(utcSeconds) {
  const box = (type, body) => { const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length); h.write(type, 4, 'latin1'); return Buffer.concat([h, body]); };
  const mvhd = Buffer.alloc(100);
  const tt = utcSeconds + 2082844800;
  mvhd.writeUInt32BE(tt, 4); mvhd.writeUInt32BE(tt, 8); mvhd.writeUInt32BE(1000, 12); mvhd.writeUInt32BE(1000, 16);
  mvhd.writeUInt32BE(0x00010000, 20); mvhd.writeUInt16BE(0x0100, 24);
  [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].forEach((v, i) => mvhd.writeUInt32BE(v >>> 0, 36 + i * 4));
  mvhd.writeUInt32BE(2, 96);
  const ftyp = box('ftyp', Buffer.concat([Buffer.from('isom'), Buffer.from([0, 0, 2, 0]), Buffer.from('isomiso2mp41')]));
  return Buffer.concat([ftyp, box('mdat', Buffer.alloc(16 * 1024)), box('moov', box('mvhd', mvhd))]);
}

(async () => {
  console.log('=== policy (pure) ===');
  await t('DateTimeOriginal is used as written — a naive value is never converted', async () => {
    const r = R.resolveFromTags({ DateTimeOriginal: '2026:11:16 09:33:11', CreateDate: '2026:11:16 09:33:11' }, 'raw');
    assert.deepEqual([r.status, r.local, r.offset, r.source, r.confidence], ['dated', '2026-11-16T09:33:11', null, 'DateTimeOriginal', 'high']);
  });
  await t('subseconds and an explicit offset are kept (wall clock unchanged)', async () => {
    const r = R.resolveFromTags({ SubSecDateTimeOriginal: '2026:11:16 23:59:59.87+05:30', DateTimeOriginal: '2026:11:16 23:59:59' }, 'raw');
    assert.deepEqual([r.local, r.offset, r.source], ['2026-11-16T23:59:59.870', '+05:30', 'SubSecDateTimeOriginal']);
    const j = R.resolveFromTags({ DateTimeOriginal: '2026:11:16 00:00:05', SubSecTimeOriginal: '4', OffsetTimeOriginal: '-07:00' }, 'photo');
    assert.deepEqual([j.local, j.offset], ['2026-11-16T00:00:05.400', '-07:00'], 'a just-after-midnight photo stays on its own day');
  });
  await t('CreateDate only when DateTimeOriginal is missing (medium confidence)', async () => {
    const r = R.resolveFromTags({ CreateDate: '2026:11:16 09:33:11' }, 'photo');
    assert.deepEqual([r.status, r.local, r.source, r.confidence], ['dated', '2026-11-16T09:33:11', 'CreateDate', 'medium']);
  });
  await t('XMP / IPTC Date Created are used only without EXIF; a disagreeing tag is reported, never applied', async () => {
    const x = R.resolveFromTags({ 'XMP-photoshop:DateCreated': '2026:11:16 09:33:11' }, 'photo');
    assert.deepEqual([x.local, x.source, x.confidence], ['2026-11-16T09:33:11', 'XMP-photoshop:DateCreated', 'medium']);
    const i = R.resolveFromTags({ 'IPTC:DateCreated': '2026:11:16', 'IPTC:TimeCreated': '09:33:11+05:30' }, 'photo');
    assert.deepEqual([i.local, i.offset, i.source], ['2026-11-16T09:33:11', '+05:30', 'IPTC:DateCreated']);
    const c = R.resolveFromTags({ DateTimeOriginal: '2026:11:16 09:33:11', CreateDate: '2026:11:16 22:31:51', 'XMP-photoshop:DateCreated': '2026:11:17 10:00:00' }, 'raw');
    assert.equal(c.local, '2026-11-16T09:33:11');
    assert.deepEqual(c.conflict.map(x => x.source), ['CreateDate', 'XMP-photoshop:DateCreated']);
  });
  await t('no capture tag → unavailable; an invalid date is not a date', async () => {
    assert.equal(R.resolveFromTags({}, 'photo').status, 'unavailable');
    assert.equal(R.resolveFromTags({}, 'photo').reason, 'no-capture-metadata');
    assert.equal(R.resolveFromTags({ DateTimeOriginal: '0000:00:00 00:00:00' }, 'raw').reason, 'invalid-date');
    assert.equal(R.resolveFromTags(null, 'raw').status, 'unavailable');
  });
  await t('video: offset-bearing CreationDate is local time; a timezone-dependent day is uncertain', async () => {
    const v = R.resolveFromTags({ CreationDate: '2026:11:16 09:33:11+05:30', CreateDate: '2026:11:16 04:03:11' }, 'video');
    assert.deepEqual([v.status, v.local, v.offset, v.confidence], ['dated', '2026-11-16T09:33:11', '+05:30', 'high']);
    const lo = R.resolveFromTags({ CreateDate: '2026:11:16 12:00:00' }, 'video');
    assert.deepEqual([lo.status, lo.local, lo.confidence], ['dated', '2026-11-16T12:00:00', 'low']);
    assert.equal(R.resolveFromTags({}, 'video').status, 'unavailable');
  });
  await t('grouped read: EXIF wins over maker notes and XMP; XMP/IPTC keep their own keys', async () => {
    const view = R.viewFromGrouped({
      'XMP-exif:DateTimeOriginal': '2026:01:01 00:00:00', 'ExifIFD:DateTimeOriginal': '2026:11:16 09:33:11',
      'XMP-photoshop:DateCreated': '2026:11:16 09:33:11', 'IPTC:DateCreated': '2026:11:16', 'ExifIFD:CreateDate': '2026:11:16 09:33:11',
    });
    assert.equal(view.DateTimeOriginal, '2026:11:16 09:33:11');
    assert.equal(view['XMP-exif:DateTimeOriginal'], '2026:01:01 00:00:00');
    assert.equal(view['XMP-photoshop:DateCreated'], '2026:11:16 09:33:11');
    assert.equal(view['IPTC:DateCreated'], '2026:11:16');
  });

  console.log('=== real files: capture 09:33:11, modified 22:31:51, created otherwise ===');
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-eqi32-capture-'));
  const noise = Buffer.alloc(160 * 160 * 3); for (let i = 0; i < noise.length; i++) noise[i] = (i * 7919) % 251;
  const jpg = await sharp(noise, { raw: { width: 160, height: 160, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
  const tif = await sharp(noise, { raw: { width: 160, height: 160, channels: 3 } }).tiff({ compression: 'none' }).toBuffer();
  const et = new ExifTool({ maxProcs: 1 });
  const MODIFIED = new Date(2026, 10, 16, 22, 31, 51);
  const put = async (name, bytes, tags) => {
    const p = path.join(root, name);
    await fsp.writeFile(p, bytes);
    if (tags) await et.write(p, tags, { writeArgs: ['-overwrite_original'] });
    await fsp.utimes(p, MODIFIED, MODIFIED);
    return p;
  };
  const stamp = '2026:11:16 09:33:11';
  const F = {
    raw: await put('DH036958.ARW', tif, { DateTimeOriginal: stamp, CreateDate: stamp, SubSecTimeOriginal: '42' }),
    pairJpg: await put('DH036958.JPG', jpg, { DateTimeOriginal: '2026:11:16 09:33:11', CreateDate: stamp }),
    none: await put('NOEXIF.JPG', jpg, null),
    xmpOnly: await put('XMPONLY.JPG', jpg, { 'XMP-photoshop:DateCreated': '2026:11:16 09:33:11' }),
    conflict: await put('CONFLICT.JPG', jpg, { DateTimeOriginal: stamp, CreateDate: '2026:11:17 10:00:00' }),
    midnight: await put('MIDNIGHT.JPG', jpg, { DateTimeOriginal: '2026:11:16 23:59:58', OffsetTimeOriginal: '+05:30' }),
    video: await put('CLIP.MP4', mp4Bytes(Date.UTC(2026, 10, 16, 12, 0, 0) / 1000), null),
  };
  await et.end();
  const file = (p, type) => ({ path: p, type, size: 1, modifiedAt: MODIFIED.toISOString() });

  try {
    await t('RAW: 09:33:11.420 from DateTimeOriginal — not the 22:31:51 modification time', async () => {
      const r = await R.readCaptureTime(file(F.raw, 'raw'));
      assert.deepEqual([r.status, r.local, r.source], ['dated', '2026-11-16T09:33:11.420', 'SubSecDateTimeOriginal']);
    });
    await t('RAW/JPEG pair: each file read on its own, the same capture time', async () => {
      const out = await R.readCaptureTimes([file(F.raw, 'raw'), file(F.pairJpg, 'photo')]);
      assert.equal(out[F.pairJpg].local, '2026-11-16T09:33:11');
      assert.equal(out[F.raw].local.slice(0, 19), out[F.pairJpg].local);
    });
    await t('JPEG without capture metadata: unavailable — its filesystem dates are never used', async () => {
      const r = await R.readCaptureTime(file(F.none, 'photo'));
      assert.equal(r.status, 'unavailable');
    });
    await t('XMP Date Created only: used, marked medium confidence', async () => {
      const r = await R.readCaptureTime(file(F.xmpOnly, 'photo'));
      assert.deepEqual([r.status, r.local, r.source], ['dated', '2026-11-16T09:33:11', 'XMP-photoshop:DateCreated']);
    });
    await t('conflicting EXIF CreateDate: DateTimeOriginal kept, conflict reported', async () => {
      const r = await R.readCaptureTime(file(F.conflict, 'photo'));
      assert.equal(r.local, '2026-11-16T09:33:11');
      assert.equal(r.conflict[0].source, 'CreateDate');
    });
    await t('near midnight with an offset: the written wall clock and day are kept', async () => {
      const r = await R.readCaptureTime(file(F.midnight, 'photo'));
      assert.deepEqual([r.local, r.offset], ['2026-11-16T23:59:58', '+05:30']);
    });
    await t('MP4 with only the QuickTime (UTC) date: dated low-confidence, or uncertain when the day depends on the zone', async () => {
      const r = await R.readCaptureTime(file(F.video, 'video'));
      assert.ok(r.status === 'dated' ? r.confidence === 'low' : r.status === 'uncertain', JSON.stringify(r));
    });
    await t('a changed file is read again (cache keyed on path, size and modification time)', async () => {
      const a = await R.readCaptureTime(file(F.none, 'photo'));
      const b = await R.readCaptureTime({ ...file(F.none, 'photo'), modifiedAt: new Date(2027, 0, 1).toISOString() });
      assert.equal(a.status, 'unavailable'); assert.equal(b.status, 'unavailable');
      assert.ok([...R._cache.keys()].filter(k => k.startsWith(F.none)).length >= 2);
    });
    await t('reading never changes the file (bytes and modification time)', async () => {
      for (const p of Object.values(F)) assert.equal((await fsp.stat(p)).mtimeMs, MODIFIED.getTime(), path.basename(p));
    });
  } finally {
    await require('../main/exifService').shutdown?.().catch?.(() => {});
    await fsp.rm(root, { recursive: true, force: true });
  }
  console.log(`eqi32CaptureTime: ${passed} passed`);
  process.exit(process.exitCode || 0);
})();
