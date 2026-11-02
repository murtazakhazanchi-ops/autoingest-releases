'use strict';

// AI-FEAT-061 Q3 — automatic camera identification: per-file identity evidence, card-level
// grouping (bodies, model-only, unknown, conflicts), RAW/JPEG inheritance, the maker-note
// follow-up decision, the two-phase assessor (bounded, cancellable) and serial privacy.
// Pure Node; no Electron, no card.
//
// Fixtures are grouped tag sets modelled on REAL reads (Q3 discovery, 2026-11: Canon 70D/
// 80D/R6 II/5D IV, Sony A7 III/FDR-AX43, Nikon D750/D850, DJI FC220/Osmo Pocket, Panasonic
// HC-VX870, Fujifilm X-T1, phones). Every serial below is FAKE.
//
// Run: node test/companionQ3CameraIdentity.test.js

const assert = require('node:assert/strict');
const { fileIdentity, needsMakerNoteRead, normalizeMake } = require('../services/cameraIdentityEvidence');
const { assessCameras, summarizeCameras } = require('../services/cameraAssessmentModel');
const { createCardAssessor } = require('../services/cardAssessmentService');
const { dateViewFromGrouped, identityFromGrouped } = require('../services/captureDateReader');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Fixtures (fake serials) ──────────────────────────────────────────────────────
const F = {
  canon70dOriginal: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS 70D', 'ExifIFD:SerialNumber': 'FAKEC70D0001', 'Canon:InternalSerialNumber': 'FKC70I001', 'Canon:CanonModelID': 'EOS 70D' },
  canon70dExifrJpeg: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS 70D', 'ExifIFD:SerialNumber': 'FAKEC70D0001' },
  canon70dInternalOnly: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS 70D', 'Canon:InternalSerialNumber': 'FKC70I001' },
  canon70dOtherBody: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS 70D', 'ExifIFD:SerialNumber': 'FAKEC70D0002', 'Canon:InternalSerialNumber': 'FKC70I002' },
  canonR6m2: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS R6m2', 'Canon:CanonModelID': 'EOS R6 Mark II', 'ExifIFD:SerialNumber': 'FAKER6M20001', 'Canon:InternalSerialNumber': 'FKR6I0001' },
  canon5d4: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS 5D Mark IV', 'ExifIFD:SerialNumber': 'FAKE5D40001', 'Canon:InternalSerialNumber2': 'FK5D4I001' },
  sonyArwA: { 'IFD0:Make': 'SONY', 'IFD0:Model': 'ILCE-7M3', 'Sony:SonyModelID': 'ILCE-7M3', 'Sony:InternalSerialNumber': 'FAKESONYA009' },
  sonyArwB: { 'IFD0:Make': 'SONY', 'IFD0:Model': 'ILCE-7M3', 'Sony:SonyModelID': 'ILCE-7M3', 'Sony:InternalSerialNumber': 'FAKESONYB009' },
  sonyJpegExifr: { 'IFD0:Make': 'SONY', 'IFD0:Model': 'ILCE-7M3' },
  sonyExportStripped: { 'IFD0:Make': 'SONY', 'IFD0:Model': 'ILCE-7M3', 'IFD0:Software': 'Adobe Photoshop Camera Raw 15.0' },
  sonyCamcorder: { 'IFD0:Make': 'SONY', 'IFD0:Model': 'FDR-AX43' },
  nikonNef: { 'IFD0:Make': 'NIKON CORPORATION', 'IFD0:Model': 'NIKON D750', 'Nikon:SerialNumber': '7000001' },
  nikonAdobeJpeg: { 'IFD0:Make': 'NIKON CORPORATION', 'IFD0:Model': 'NIKON D750', 'ExifIFD:SerialNumber': '7000001', 'XMP-aux:SerialNumber': '7000001', 'IFD0:Software': 'Adobe Photoshop Camera Raw 11.3.1 (Macintosh)' },
  nikonMismatch: { 'IFD0:Make': 'NIKON CORPORATION', 'IFD0:Model': 'NIKON D750', 'Nikon:SerialNumber': '7000001', 'ExifIFD:SerialNumber': '7000009' },
  nikonVideo: { 'Nikon:Make': 'NIKON CORPORATION', 'Nikon:Model': 'NIKON D750' },
  panasonicCamcorder: { 'Panasonic:Model': 'HC-VX870' },
  djiOsmo: { 'QuickTime:HandlerVendorID': 'Apple', 'ItemList:Encoder': 'DJI OsmoPocket3' },
  djiDng: { 'IFD0:Make': 'DJI', 'IFD0:Model': 'FC220', 'IFD0:CameraSerialNumber': 'FAKEDJI001', 'ExifIFD:SerialNumber': 'FAKEDJI001' },
  fujiJpeg: { 'IFD0:Make': 'FUJIFILM', 'IFD0:Model': 'X-T1', 'FujiFilm:InternalSerialNumber': 'FAKEFUJI-0001' },
  iphone: { 'IFD0:Make': 'Apple', 'IFD0:Model': 'iPhone 6' },
  placeholder: { 'IFD0:Make': 'Canon', 'IFD0:Model': 'Canon EOS 80D', 'ExifIFD:SerialNumber': '0000000000' }, // real: Canon 760D video writes zeros
  stripped: {},
};
const ALL_FAKE_SERIALS = Object.values(F).flatMap(o => Object.entries(o).filter(([k]) => /Serial/.test(k)).map(([, v]) => String(v)));

const dated = (date = '2026-11-02', time = '10:00:00') => ({ status: 'dated', date, time, offset: null, source: 'DateTimeOriginal', confidence: 'high', reason: null, candidates: null });
const rec = (path, type, id, extra = {}) => ({ path, name: path.split('/').pop(), type, pairKey: null, evidence: dated(), identity: fileIdentity(id), ...extra });
const keyFor = (ref) => `k${ref.length}`; // test stand-in; production uses a session HMAC
const summary = (records) => summarizeCameras(records, assessCameras(records), keyFor);

(async () => {
  // ── Per-file identity evidence ─────────────────────────────────────────────────
  await t('Canon original: EXIF body serial and Canon internal serial kept as DISTINCT namespaces', () => {
    const x = fileIdentity(F.canon70dOriginal);
    assert.equal(x.level, 'body');
    assert.deepEqual(x.identifiers.map(i => [i.ns, i.trusted, i.sourceTag]), [
      ['exif.bodySerial', true, 'ExifIFD:SerialNumber'], ['canon.internal', true, 'Canon:InternalSerialNumber']]);
    assert.equal(x.model.display, 'Canon EOS 70D');
    assert.equal(fileIdentity(F.canon5d4).identifiers[1].ns, 'canon.internal', 'InternalSerialNumber2 variant');
  });

  await t('Canon display name from the maker model id ("EOS R6m2" → "Canon EOS R6 Mark II")', () => {
    const x = fileIdentity(F.canonR6m2);
    assert.equal(x.model.display, 'Canon EOS R6 Mark II');
    assert.equal(x.model.raw, 'Canon EOS R6m2');
    const regional = fileIdentity({ ...F.canon70dOriginal, 'IFD0:Model': 'Canon EOS 750D', 'Canon:CanonModelID': 'EOS Rebel T6i / 750D / Kiss X8i' });
    assert.equal(regional.model.display, 'Canon EOS 750D', 'regional alias lists fall back to the EXIF model');
  });

  await t('Sony: body identity only from the maker-note internal serial', () => {
    const x = fileIdentity(F.sonyArwA);
    assert.deepEqual([x.level, x.make.name, x.model.display, x.identifiers[0].ns], ['body', 'Sony', 'Sony ILCE-7M3', 'sony.internal']);
    assert.equal(fileIdentity(F.sonyJpegExifr).level, 'model', 'exifr cannot see Sony maker notes');
    assert.equal(fileIdentity(F.sonyCamcorder).level, 'model');
  });

  await t('Nikon: maker-note serial and Adobe-copied EXIF/XMP serial are one namespace (measured equivalence)', () => {
    const a = fileIdentity(F.nikonNef), b = fileIdentity(F.nikonAdobeJpeg);
    assert.deepEqual(a.identifiers.map(i => i.ns), ['nikon.serial']);
    assert.deepEqual(b.identifiers.map(i => i.ns), ['nikon.serial'], 'ExifIFD + XMP-aux collapse into one identifier');
    assert.equal(b.edited, true);
    assert.equal(a.model.display, 'Nikon D750');
  });

  await t('Two values in one trusted namespace on one file → conflict, never one picked', () => {
    assert.equal(fileIdentity(F.nikonMismatch).conflict, 'identifier-mismatch');
  });

  await t('Video and devices without serials: model only, make from the maker group / encoder', () => {
    const nv = fileIdentity(F.nikonVideo), pc = fileIdentity(F.panasonicCamcorder), dj = fileIdentity(F.djiOsmo);
    assert.deepEqual([nv.level, nv.model.display], ['model', 'Nikon D750']);
    assert.deepEqual([pc.level, pc.make.name, pc.make.sourceTag, pc.model.display], ['model', 'Panasonic', 'Panasonic (maker-note group)', 'Panasonic HC-VX870']);
    assert.deepEqual([dj.level, dj.make.name, dj.model.display], ['model', 'DJI', 'DJI OsmoPocket3']);
  });

  await t('DNG CameraSerialNumber is a trusted standard identifier', () => {
    const x = fileIdentity(F.djiDng);
    assert.equal(x.level, 'body');
    assert.deepEqual(x.identifiers.map(i => i.ns).sort(), ['dng.cameraSerial', 'exif.bodySerial']);
  });

  await t('Unverified maker namespaces (Fujifilm) are recorded but never make a body identity', () => {
    const x = fileIdentity(F.fujiJpeg);
    assert.equal(x.level, 'model');
    assert.deepEqual(x.identifiers.map(i => [i.ns, i.trusted]), [['fujifilm.internalSerialNumber', false]]);
  });

  await t('Placeholder serials are ignored; stripped files are unknown', () => {
    assert.equal(fileIdentity(F.placeholder).level, 'model');
    assert.equal(fileIdentity(F.stripped).level, 'unknown');
    assert.equal(fileIdentity(null).level, 'unknown');
    assert.equal(normalizeMake('NIKON CORPORATION'), 'Nikon');
  });

  await t('Maker-note follow-up read: only exifr-read photos of maker-note makes without a body id', () => {
    assert.equal(needsMakerNoteRead(fileIdentity(F.sonyJpegExifr), false), true);
    assert.equal(needsMakerNoteRead(fileIdentity(F.canon70dExifrJpeg), false), false, 'Canon EXIF serial already identifies');
    assert.equal(needsMakerNoteRead(fileIdentity(F.iphone), false), false, 'phones carry no body identifier');
    assert.equal(needsMakerNoteRead(fileIdentity(F.sonyJpegExifr), true), false, 'already read with ExifTool');
  });

  await t('Grouped read helpers keep only identity tags and rebuild the Q2 date view', () => {
    const g = { 'ExifIFD:CreateDate': '2026:09:08 09:34:03', 'QuickTime:CreateDate': '2026:09:08 09:34:03+05:30', 'IFD0:Make': 'Canon', 'ExifIFD:LensSerialNumber': 'LENSFAKE', 'IFD0:Artist': 'Someone' };
    assert.equal(dateViewFromGrouped(g).CreateDate, '2026:09:08 09:34:03+05:30', 'QuickTime wins, as ExifTool does');
    assert.deepEqual(Object.keys(identityFromGrouped(g)), ['IFD0:Make'], 'lens serial and Artist are never identity');
    assert.equal(dateViewFromGrouped({ 'QuickTime:CreateDate': 'a', 'Nikon:CreateDate': 'b' }).CreateDate, 'b', 'Nikon maker note wins for Nikon video');
  });

  // ── Card-level grouping ────────────────────────────────────────────────────────
  await t('Several bodies of one model: separate groups labelled A and B (largest first)', () => {
    const r = [...Array(3)].map((_, i) => rec(`/C/A/TAJ0${i}.ARW`, 'raw', F.sonyArwA)).concat([...Array(2)].map((_, i) => rec(`/C/B/QQJ0${i}.ARW`, 'raw', F.sonyArwB)));
    const s = summary(r);
    assert.deepEqual(s.cameras.map(c => [c.display, c.bodyLabel, c.files, c.status]), [
      ['Sony ILCE-7M3', 'A', 3, 'body-identified'], ['Sony ILCE-7M3', 'B', 2, 'body-identified']]);
  });

  await t('Canon: identifiers co-observed on originals link one body; partial files (exports) join it', () => {
    const r = [rec('/C/1.CR2', 'raw', F.canon70dOriginal), rec('/C/2.JPG', 'photo', F.canon70dExifrJpeg), rec('/C/3.JPG', 'photo', F.canon70dInternalOnly), rec('/C/4.CR2', 'raw', F.canon70dOtherBody)];
    const s = summary(r);
    assert.deepEqual(s.cameras.map(c => [c.bodyLabel, c.files]), [['A', 3], ['B', 1]]);
  });

  await t('Nikon NEF + Adobe-exported JPEG of the same body → one body', () => {
    const s = summary([rec('/C/_DSC5634.NEF', 'raw', F.nikonNef), rec('/C/x/_DSC5634.jpg', 'photo', F.nikonAdobeJpeg)]);
    assert.deepEqual(s.cameras.map(c => [c.display, c.files, c.status, c.bodyLabel]), [['Nikon D750', 2, 'body-identified', null]]);
  });

  await t('RAW/JPEG pair: JPEG inherits the RAW body identity (recorded as derived)', () => {
    const r = [rec('/C/DSC1.ARW', 'raw', F.sonyArwA, { pairKey: 'p1' }), rec('/C/DSC1.JPG', 'photo', F.sonyJpegExifr, { pairKey: 'p1' })];
    const res = assessCameras(r);
    assert.equal(res.identities[1].inherited, true);
    assert.equal(res.identities[1].identifiers[0].inherited, true);
    assert.deepEqual(summarizeCameras(r, res, keyFor).cameras.map(c => [c.files, c.inheritedFiles, c.status]), [[2, 1, 'body-identified']]);
  });

  await t('RAW/JPEG pair whose identifiers disagree → both conflicting, never assigned', () => {
    const r = [rec('/C/DSC1.ARW', 'raw', F.sonyArwA, { pairKey: 'p1' }), rec('/C/DSC1.JPG', 'photo', F.sonyArwB, { pairKey: 'p1' })];
    const s = summary(r);
    assert.deepEqual([s.cameras.length, s.conflictFiles], [0, 2]);
  });

  await t('An unreliable pair (Q2 dates disagree) never inherits identity', () => {
    const bad = { ...dated(), status: 'uncertain', reason: 'pair-inconsistent' };
    const r = [rec('/C/D.ARW', 'raw', F.sonyArwA, { pairKey: 'p', evidence: bad }), rec('/C/D.JPG', 'photo', F.sonyJpegExifr, { pairKey: 'p', evidence: bad })];
    assert.deepEqual(summary(r).cameras.map(c => [c.status, c.files]).sort(), [['body-identified', 1], ['body-not-identified', 1]]);
  });

  await t('Unidentified files of a model stay separate — never merged into an identified body', () => {
    const r = [rec('/C/1.ARW', 'raw', F.sonyArwA), rec('/C/x/2.jpg', 'photo', F.sonyExportStripped), rec('/C/x/3.jpg', 'photo', F.sonyExportStripped)];
    assert.deepEqual(summary(r).cameras.map(c => [c.display, c.status, c.files]), [['Sony ILCE-7M3', 'body-identified', 1], ['Sony ILCE-7M3', 'body-not-identified', 2]]);
  });

  await t('An identifier seen with two different models is a conflict', () => {
    const odd = { ...F.sonyArwA, 'IFD0:Model': 'ILCE-7RM3', 'Sony:SonyModelID': 'ILCE-7RM3' };
    const s = summary([rec('/C/1.ARW', 'raw', F.sonyArwA), rec('/C/2.ARW', 'raw', odd)]);
    assert.equal(s.conflictFiles, 2);
  });

  await t('Edited file with identifiers no original links: body not identified (not a conflict)', () => {
    const edited = { ...F.canon70dOriginal, 'Canon:InternalSerialNumber': 'FKC70I999', 'IFD0:Software': 'Adobe Photoshop Lightroom Classic 13.0' };
    const s = summary([rec('/C/e.jpg', 'photo', edited), rec('/C/o.CR2', 'raw', { ...F.canon70dOtherBody })]);
    assert.equal(s.conflictFiles, 0);
  });

  await t('Mixed card: bodies, model-only, video, phone and unknown — every file counted once', () => {
    const r = [
      rec('/C/1.CR2', 'raw', F.canon70dOriginal), rec('/C/2.MOV', 'video', F.canon70dOriginal),
      rec('/C/3.JPG', 'photo', F.sonyCamcorder), rec('/C/4.MP4', 'video', F.panasonicCamcorder),
      rec('/C/5.JPG', 'photo', F.iphone), rec('/C/6.JPG', 'photo', F.stripped), rec('/C/7.NEF', 'raw', F.nikonMismatch),
    ];
    const s = summary(r);
    assert.equal(s.cameras.reduce((n, c) => n + c.files, 0) + s.unknownFiles + s.conflictFiles, r.length);
    assert.deepEqual([s.unknownFiles, s.conflictFiles], [1, 1]);
    assert.deepEqual(s.cameras[0].counts, { photo: 0, raw: 1, video: 1 }, 'Canon video joins its body');
  });

  await t('No identifier value ever appears in the popup summary', () => {
    const r = Object.values(F).map((id, i) => rec(`/C/${i}.JPG`, 'photo', id));
    const json = JSON.stringify(summary(r));
    for (const v of ALL_FAKE_SERIALS) if (v.length >= 3 && !/^0+$/.test(v)) assert.ok(!json.includes(v), `leaked ${v}`);
    assert.ok(!json.includes('/C/'), 'no paths either');
  });

  // ── Two-phase assessor ─────────────────────────────────────────────────────────
  const FILES = [
    { path: '/V/DCIM/A1.ARW', name: 'A1.ARW', type: 'raw', id: F.sonyArwA, mn: true },
    { path: '/V/DCIM/A1.JPG', name: 'A1.JPG', type: 'photo', id: F.sonyJpegExifr, mn: false, follow: F.sonyArwA }, // pair → no read
    { path: '/V/DCIM/B2.JPG', name: 'B2.JPG', type: 'photo', id: F.sonyJpegExifr, mn: false, follow: F.sonyArwB }, // needs read
    { path: '/V/DCIM/C3.JPG', name: 'C3.JPG', type: 'photo', id: F.canon70dExifrJpeg, mn: false },               // EXIF serial: no read
    { path: '/V/DCIM/P4.JPG', name: 'P4.JPG', type: 'photo', id: F.iphone, mn: false },                           // phone: no read
  ];
  const deps = (over = {}) => {
    const calls = { identity: [] };
    return { calls, deps: {
      listMedia: async () => FILES.map(f => ({ path: f.path, name: f.name, type: f.type, size: 1 })),
      readTags: async (p) => { const f = FILES.find(x => x.path === p); await sleep(1); return { tags: { DateTimeOriginal: '2026:11:02 10:00:00' }, id: f.id, makerNotesRead: f.mn }; },
      readIdentity: async (p) => { calls.identity.push(p); await sleep(5); return FILES.find(x => x.path === p).follow || {}; },
      statMount: async () => ({ dev: 1, ino: 1 }),
      ...over,
    } };
  };
  const waitFor = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return; await sleep(5); } throw new Error('timeout'); };

  await t('assessor: maker-note reads only where needed (pair partner identified, EXIF serial, phone → none)', async () => {
    const { calls, deps: d } = deps();
    const a = createCardAssessor(d);
    a.sync([{ sourceId: 'src-1', mountpoint: '/V', label: 'X' }]);
    await waitFor(() => a.get('src-1')?.state === 'complete');
    assert.deepEqual(calls.identity, ['/V/DCIM/B2.JPG']);
    const s = summarizeCameras(a.get('src-1').records, a.get('src-1').cameras, keyFor);
    assert.deepEqual(s.cameras.map(c => [c.display, c.bodyLabel, c.files]), [
      ['Sony ILCE-7M3', 'A', 2], ['Sony ILCE-7M3', 'B', 1], ['Apple iPhone 6', null, 1], ['Canon EOS 70D', null, 1]]);
    assert.equal(a.getDiagnostics().identityReads, 1);
    a.shutdown();
  });

  await t('assessor: removal during the identifying phase cancels it — no result, no further reads', async () => {
    let release; const gate = new Promise(r => { release = r; });
    const { calls, deps: d } = deps({ readIdentity: async (p) => { calls.identity.push(p); await gate; return {}; } });
    const a = createCardAssessor(d);
    a.sync([{ sourceId: 'src-1', mountpoint: '/V', label: 'X' }]);
    await waitFor(() => a.get('src-1')?.state === 'identifying');
    a.sync([]);
    release();
    await sleep(30);
    assert.equal(a.get('src-1'), null);
    assert.equal(a.getDiagnostics().running, null);
    a.shutdown();
  });

  await t('assessor: dates (and Review) are available while cameras are still being identified', async () => {
    let release; const gate = new Promise(r => { release = r; });
    const { deps: d } = deps({ readIdentity: async () => { await gate; return {}; } });
    const a = createCardAssessor(d);
    a.sync([{ sourceId: 'src-1', mountpoint: '/V', label: 'X' }]);
    await waitFor(() => a.get('src-1')?.state === 'identifying');
    const job = a.get('src-1');
    assert.equal(job.datesReady, true);
    assert.equal(job.records.length, FILES.length);
    assert.equal(job.cameras, null, 'camera groups only once identification finishes');
    assert.ok(await a.verify('src-1'), 'Review Selected Date may proceed on final dates');
    release();
    await waitFor(() => a.get('src-1')?.state === 'complete');
    assert.ok(a.get('src-1').cameras);
    a.shutdown();
  });

  await t('assessor: a failing identity read keeps exifr\'s make/model — never invents a body', async () => {
    const { deps: d } = deps({ readIdentity: async () => { throw new Error('pool ended'); } });
    const a = createCardAssessor(d);
    a.sync([{ sourceId: 'src-1', mountpoint: '/V', label: 'X' }]);
    await waitFor(() => a.get('src-1')?.state === 'complete', 6000);
    const s = summarizeCameras(a.get('src-1').records, a.get('src-1').cameras, keyFor);
    const b2 = s.cameras.find(c => c.status === 'body-not-identified' && c.display === 'Sony ILCE-7M3');
    assert.ok(b2 && b2.files === 1, JSON.stringify(s.cameras));
    a.shutdown();
  });

  await t('assessor: reconnection is assessed afresh; Q2 legacy readTags (date tags only) still works', async () => {
    const { deps: d } = deps({ readTags: async () => ({ DateTimeOriginal: '2026:11:02 10:00:00' }) });
    const a = createCardAssessor(d);
    a.sync([{ sourceId: 'src-1', mountpoint: '/V', label: 'X' }]);
    await waitFor(() => a.get('src-1')?.state === 'complete');
    a.sync([]);
    a.sync([{ sourceId: 'src-2', mountpoint: '/V', label: 'X' }]);
    assert.notEqual(a.get('src-2').state, 'complete');
    await waitFor(() => a.get('src-2')?.state === 'complete');
    assert.equal(summarizeCameras(a.get('src-2').records, a.get('src-2').cameras, keyFor).unknownFiles, FILES.length);
    a.shutdown();
  });

  console.log(`${passed} passed`);
})();
