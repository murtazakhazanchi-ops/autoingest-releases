'use strict';

// AI-FEAT-064 EQI-2 — Multi-Event Quick Assignment: the pure assignment model (time ranges,
// half-open boundaries, overlaps, midnight, RAW/JPEG assets, Split Here, boundary moves, gap
// suggestions, the import plan). Pure Node; no Electron, no card, no archive.
// Run: node test/eqi2AssignmentModel.test.js

const assert = require('node:assert/strict');
const M = require('../services/eventDumpAssignmentModel');
const { resolvePairs } = require('../services/dateAssessmentModel');

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

const D = '2026-11-14', D2 = '2026-11-15', D0 = '2026-11-13';
const ev = (date, time, confidence = 'high') => ({ status: 'dated', date, time: time.length === 5 ? `${time}:00` : time, offset: null, source: 'DateTimeOriginal', confidence, reason: null, candidates: null });
const undated = () => ({ status: 'uncertain', date: null, time: null, offset: null, source: null, confidence: null, reason: 'no-capture-metadata', candidates: null });
let n = 0;
const rec = (time, { date = D, type = 'photo', name = null, dir = '/card/DCIM/100', evidence = null, size = 1000 } = {}) => {
  n++;
  const nm = name || `IMG_${String(n).padStart(4, '0')}.${type === 'raw' ? 'CR3' : type === 'video' ? 'MP4' : 'JPG'}`;
  return { path: `${dir}/${nm}`, name: nm, type, size, evidence: evidence || (time ? ev(date, time) : undated()) };
};
const build = (records, imported = new Set(), cameraOf) => M.buildAssets(resolvePairs(records), { isImported: (name) => imported.has(name), cameraOf });
const range = (id, start, end, eventId, date = D) => ({ id, date, start, end, eventId });
const eventsOf = (assets, res) => assets.map(a => res.byAsset.get(a.id).eventId);

console.log('eqi2AssignmentModel');

t('1. two events two hours apart: each photo goes to the range that holds it; the gap stays unassigned', () => {
  const { assets } = build([rec('09:10'), rec('13:59:59'), rec('15:00'), rec('16:40'), rec('21:30')]);
  const res = M.assign(assets, [range('r1', '09:00', '14:30', 'A'), range('r2', '16:30', '22:00', 'B')]);
  assert.deepEqual(eventsOf(assets, res), ['A', 'A', null, 'B', 'B']);
  const s = M.summarize(assets, res, [range('r1', '09:00', '14:30', 'A'), range('r2', '16:30', '22:00', 'B')]);
  assert.equal(s.events.get('A').assets, 2); assert.equal(s.events.get('B').assets, 2);
  assert.equal(s.unassigned.assets, 1); assert.equal(s.unassigned.byDate[D], 1);
});

t('2–3. three events in one day, including an intermediate 30-minute event', () => {
  const { assets } = build([rec('10:00'), rec('11:40'), rec('12:10'), rec('12:29'), rec('12:30'), rec('18:00')]);
  const rs = [range('r1', '09:00', '11:45', 'A'), range('r2', '12:00', '12:30', 'B'), range('r3', '12:30', '23:00', 'C')];
  assert.deepEqual(eventsOf(assets, M.assign(assets, rs)), ['A', 'A', 'B', 'B', 'C', 'C']);
});

t('4. non-contiguous ranges for the same event consolidate into ONE batch per event', () => {
  const { assets } = build([rec('09:30'), rec('11:45'), rec('12:45'), rec('14:00')]);
  const rs = [range('r1', '09:00', '11:30', 'A'), range('r2', '11:30', '12:30', 'B'), range('r3', '12:30', '14:30', 'A')];
  const res = M.assign(assets, rs);
  assert.deepEqual(eventsOf(assets, res), ['A', 'B', 'A', 'A']);
  const { batches } = M.buildBatches(assets, res, () => 'Ali');
  assert.deepEqual(batches.map(b => [b.eventId, b.files.length]), [['A', 3], ['B', 1]]);
  assert.equal(new Set(batches.flatMap(b => b.files)).size, 4, 'every file planned exactly once');
});

t('5. adjacent ranges sharing a boundary: start <= t < end — the boundary photo belongs to the later range only', () => {
  const { assets } = build([rec('11:29:59'), rec('11:30:00'), rec('11:30:01')]);
  const rs = [range('r1', '09:00', '11:30', 'A'), range('r2', '11:30', '12:30', 'B')];
  const res = M.assign(assets, rs);
  assert.deepEqual(eventsOf(assets, res), ['A', 'B', 'B']);
  assert.equal(res.overlaps.length, 0, 'touching ranges are not overlapping');
});

t('6. overlapping ranges: photos in the overlap are conflicts (assigned nowhere, import blocked); same-event overlap is fine', () => {
  const { assets } = build([rec('10:00'), rec('11:15'), rec('12:00')]);
  const rs = [range('r1', '09:00', '11:30', 'A'), range('r2', '11:00', '13:00', 'B')];
  const res = M.assign(assets, rs);
  assert.deepEqual(eventsOf(assets, res), ['A', null, 'B']);
  assert.deepEqual(res.byAsset.get(assets[1].id).conflict, ['r1', 'r2']);
  assert.deepEqual(res.overlaps, [{ a: 'r1', b: 'r2', sameEvent: false }]);
  const s = M.summarize(assets, res, rs);
  assert.equal(s.conflicts.assets, 1);
  assert.equal(M.buildBatches(assets, res, () => 'Ali').batches.flatMap(b => b.files).length, 2, 'the conflict is not planned');
  const same = M.assign(assets, [range('r1', '09:00', '11:30', 'A'), range('r2', '11:00', '13:00', 'A')]);
  assert.deepEqual(eventsOf(assets, same), ['A', 'A', 'A']);
  assert.equal(same.overlaps[0].sameEvent, true);
  // a range that has no event yet overlapping an assigned one is ambiguous too
  const half = M.assign(assets, [range('r1', '09:00', '11:30', 'A'), range('r2', '11:00', '13:00', null)]);
  assert.ok(half.byAsset.get(assets[1].id).conflict);
});

t('7. a range ending at or before its start runs past midnight into the next day', () => {
  const { assets } = build([rec('21:30'), rec('23:59:59'), rec('00:30', { date: D2 }), rec('02:00', { date: D2 }), rec('02:00', { date: D })]);
  const r = range('r1', '21:00', '02:00', 'A');
  const iv = M.rangeInterval(r);
  assert.equal(iv.nextDay, true);
  assert.equal(iv.end - iv.start, 5 * 3600);
  // sorted: D 02:00 (before the start), D 21:30, D 23:59:59, D2 00:30, D2 02:00 (the exclusive end)
  assert.deepEqual(eventsOf(assets, M.assign(assets, [r])), [null, 'A', 'A', 'A', null]);
});

t('7b. midnight assignment, precisely', () => {
  const { assets } = build([rec('21:30'), rec('00:30', { date: D2 }), rec('02:00', { date: D2 }), rec('01:00', { date: D })]);
  const res = M.assign(assets, [range('r1', '21:00', '02:00', 'A')]);
  const byLabel = Object.fromEntries(assets.map(a => [`${a.date} ${a.time}`, res.byAsset.get(a.id).eventId]));
  assert.deepEqual(byLabel, { [`${D} 21:30:00`]: 'A', [`${D2} 00:30:00`]: 'A', [`${D2} 02:00:00`]: null, [`${D} 01:00:00`]: null });
});

t('8. earlier-date photos are assigned only by a range on THEIR date', () => {
  const { assets } = build([rec('10:00', { date: D0 }), rec('10:00')]);
  const res = M.assign(assets, [range('r1', '09:00', '12:00', 'A')]);
  assert.deepEqual(assets.map(a => [a.date, res.byAsset.get(a.id).eventId]), [[D0, null], [D, 'A']]);
  const res2 = M.assign(assets, [range('r1', '09:00', '12:00', 'A'), range('r0', '09:00', '12:00', 'Old', D0)]);
  assert.deepEqual(assets.map(a => res2.byAsset.get(a.id).eventId), ['Old', 'A']);
});

t('9. missing capture time: never an asset; unreliable (video time zone unknown) never assigned by a range', () => {
  const lowVideo = rec(null, { type: 'video', evidence: ev(D, '10:00', 'low') });
  const { assets, undated: u } = build([rec(null), rec('10:00'), lowVideo]);
  assert.equal(u.assets, 1);
  assert.equal(assets.length, 2);
  const res = M.assign(assets, [range('r1', '09:00', '12:00', 'A')]);
  const video = assets.find(a => a.type === 'video');
  assert.equal(res.byAsset.get(video.id).eventId, null);
  assert.equal(res.byAsset.get(video.id).needsChoice, true);
  // the operator may place it deliberately, one by one
  const res2 = M.assign(assets, [range('r1', '09:00', '12:00', 'A')], new Map([[video.id, 'B']]));
  assert.equal(res2.byAsset.get(video.id).eventId, 'B');
  assert.equal(res2.byAsset.get(video.id).via, 'manual');
});

t('10. inconsistent camera clocks: a RAW/JPEG pair that disagrees is undated (stays on the card); camera times are never shifted', () => {
  const a = rec('10:00', { name: 'IMG_9001.JPG' });
  const b = rec('15:00', { name: 'IMG_9001.CR3', type: 'raw' });
  const { assets, undated: u } = build([a, b, rec('10:00:05', { name: 'IMG_9002.JPG' })]);
  assert.equal(u.files, 2, 'both members of the disagreeing pair');
  assert.equal(assets.length, 1);
  assert.equal(assets[0].time, '10:00:05', 'time exactly as the camera wrote it');
});

t('RAW/JPEG pairs are ONE asset: never split between events, sidecar-free; RAW-only and video are single assets', () => {
  const j = rec('11:29:59', { name: 'IMG_0100.JPG' });
  const r = rec('11:30:00', { name: 'IMG_0100.CR3', type: 'raw' });  // within pair tolerance, straddles the boundary
  const rawOnly = rec('12:00', { name: 'IMG_0101.CR3', type: 'raw' });
  const vid = rec('12:10', { name: 'MVI_0102.MP4', type: 'video' });
  const { assets } = build([j, r, rawOnly, vid]);
  assert.deepEqual(assets.map(a => [a.type, a.files.length]), [['pair', 2], ['raw', 1], ['video', 1]]);
  const res = M.assign(assets, [range('r1', '09:00', '11:30', 'A'), range('r2', '11:30', '13:00', 'B')]);
  assert.equal(res.byAsset.get(assets[0].id).eventId, 'A', 'the pair goes by its earliest member — both files together');
  const { batches } = M.buildBatches(assets, res, () => 'Ali');
  assert.deepEqual(batches.find(b => b.eventId === 'A').files.sort(), [j.path, r.path].sort());
  assert.equal(assets[0].label, 'IMG_0100.JPG', 'shown by its JPEG');
});

t('duplicate filenames in different card folders are separate assets', () => {
  const { assets } = build([rec('10:00', { name: 'IMG_0001.JPG', dir: '/card/DCIM/100' }), rec('10:00', { name: 'IMG_0001.JPG', dir: '/card/DCIM/101' })]);
  assert.equal(assets.length, 2);
  const { batches } = M.buildBatches(assets, M.assign(assets, [range('r1', '09:00', '11:00', 'A')]), () => 'Ali');
  assert.equal(batches[0].files.length, 2);
});

t('previously imported files are excluded; a half-imported pair plans only its new file', () => {
  const j = rec('10:00', { name: 'IMG_0200.JPG' }), r = rec('10:00', { name: 'IMG_0200.CR3', type: 'raw' }), k = rec('10:05', { name: 'IMG_0201.JPG' });
  const { assets } = build([j, r, k], new Set(['IMG_0200.JPG', 'IMG_0201.JPG']));
  assert.equal(assets[1].imported, true);
  const res = M.assign(assets, [range('r1', '09:00', '11:00', 'A')]);
  const s = M.summarize(assets, res, [range('r1', '09:00', '11:00', 'A')]);
  assert.equal(s.imported.files, 2); assert.equal(s.imported.assets, 1);
  assert.deepEqual(M.buildBatches(assets, res, () => 'Ali').batches[0].files, [r.path]);
});

t('per-photo manual choice wins over ranges; UNASSIGNED keeps a photo out deliberately', () => {
  const { assets } = build([rec('10:00'), rec('10:30')]);
  const res = M.assign(assets, [range('r1', '09:00', '11:00', 'A')], new Map([[assets[0].id, 'B'], [assets[1].id, M.UNASSIGNED]]));
  assert.deepEqual(eventsOf(assets, res), ['B', null]);
});

t('mixed camera identities: each asset asks for ITS camera\'s photographer; missing ones are not planned', () => {
  const recs = [rec('10:00'), rec('10:01'), rec('10:02')];
  const cams = ['bodyA', 'bodyB', 'bodyA'];
  const { assets } = build(recs, new Set(), (i) => cams[i]);
  assert.deepEqual(assets.map(a => a.camera), ['bodyA', 'bodyB', 'bodyA']);
  const res = M.assign(assets, [range('r1', '09:00', '11:00', 'E')]);
  const { batches, missingPhotographer } = M.buildBatches(assets, res, (a) => (a.camera === 'bodyA' ? 'Ali' : null));
  assert.equal(missingPhotographer, 1);
  assert.deepEqual(batches.map(b => [b.photographer, b.files.length]), [['Ali', 2]]);
  const both = M.buildBatches(assets, res, (a) => (a.camera === 'bodyA' ? 'Ali' : 'Husain')).batches;
  assert.deepEqual(both.map(b => [b.eventId, b.photographer, b.files.length]).sort(), [['E', 'Ali', 2], ['E', 'Husain', 1]]);
});

t('Split Here: [start, t) keeps the event, [t, end) starts unassigned; midnight ranges split correctly', () => {
  const r = range('r1', '22:00', '02:00', 'A');
  const t1 = M.wallSeconds(D2, '01:00:00');
  const s = M.splitAt([r], 'r1', t1, 'r2');
  assert.equal(s.ok, true);
  assert.deepEqual(s.ranges.map(x => [x.id, x.date, x.start, x.end, x.eventId]), [['r1', D, '22:00:00', '01:00:00', 'A'], ['r2', D2, '01:00:00', '02:00:00', null]]);
  assert.equal(M.splitAt([r], 'r1', M.wallSeconds(D, '21:00:00'), 'r2').ok, false);
  const s2 = M.splitAt([r], 'r1', M.wallSeconds(D, '23:00:00'), 'r2');
  assert.deepEqual(s2.ranges.map(x => [x.start, x.end]), [['22:00:00', '23:00:00'], ['23:00:00', '02:00:00']]);
  assert.equal(M.rangeInterval(s2.ranges[1]).nextDay, true);
});

t('Split Here outside any range starts a new range at that photo, ending before the next range', () => {
  const { assets } = build([rec('08:00'), rec('08:30'), rec('10:00')]);
  const rf = M.rangeFrom(assets, [range('r1', '09:30', '12:00', 'A')], assets[0].sec, 'r2');
  assert.equal(rf.ok, true);
  assert.deepEqual([rf.range.start, rf.range.end], ['08:00:00', '08:30:01']);
  assert.equal(M.rangeFrom(assets, [range('r1', '09:30', '12:00', 'A')], assets[2].sec, 'r3').ok, false);
});

t('boundary moves to the neighbouring photo, and an adjacent range moves with it', () => {
  const { assets } = build([rec('10:00'), rec('10:10'), rec('10:20'), rec('10:30')]);
  const secs = assets.map(a => a.sec);
  const rs = [range('r1', '09:00', '10:15', 'A'), range('r2', '10:15', '11:00', 'B')];
  // r1's end ▶: include 10:20 → end 10:20:01, r2 starts there too
  const fwd = M.nudge(rs, 'r1', 'end', 1, secs);
  assert.deepEqual(fwd.ranges.map(r => [r.start, r.end]), [['09:00:00', '10:20:01'], ['10:20:01', '11:00:00']]);
  assert.deepEqual(eventsOf(assets, M.assign(assets, fwd.ranges)), ['A', 'A', 'A', 'B']);
  // r1's end ◀: exclude 10:10 → end 10:10:00
  const back = M.nudge(rs, 'r1', 'end', -1, secs);
  assert.deepEqual(eventsOf(assets, M.assign(assets, back.ranges)), ['A', 'B', 'B', 'B']);
  // r2's start ◀: include 10:10
  const s = M.nudge(rs, 'r2', 'start', -1, secs);
  assert.deepEqual(eventsOf(assets, M.assign(assets, s.ranges)), ['A', 'B', 'B', 'B']);
  assert.equal(M.assign(assets, s.ranges).overlaps.length, 0, 'still adjacent, never overlapping');
  assert.equal(M.nudge([range('r1', '10:00', '10:05', 'A')], 'r1', 'start', 1, [M.wallSeconds(D, '10:00:00')]).ok, false, 'no photo to move to');
});

t('gap suggestions are possible boundaries only — never already-divided gaps, never dismissed ones', () => {
  const { assets } = build([rec('09:00'), rec('09:20'), rec('11:00'), rec('11:10'), rec('14:00')]);
  const g = M.gapSuggestions(assets, { date: D, minutes: 60 });
  assert.deepEqual(g.map(x => [x.time, x.gapMinutes]), [['11:00:00', 100], ['14:00:00', 170]]);
  const g90 = M.gapSuggestions(assets, { date: D, minutes: 120 });
  assert.deepEqual(g90.map(x => x.time), ['14:00:00']);
  const divided = M.gapSuggestions(assets, { date: D, minutes: 60, ranges: [range('r1', '09:00', '12:00', 'A')] });
  assert.deepEqual(divided.map(x => x.time), ['11:00:00'], 'the 12:00 range end already divides the 11:10→14:00 gap; the gap inside the range is still offered');
  assert.deepEqual(M.gapSuggestions(assets, { date: D, minutes: 60, dismissed: new Set([g[0].key]) }).map(x => x.time), ['14:00:00']);
  assert.deepEqual(M.gapSuggestions(assets, { date: D, minutes: 45 }), [], 'only the offered thresholds');
  // suggestions assign nothing
  assert.deepEqual(eventsOf(assets, M.assign(assets, [])), [null, null, null, null, null]);
});

t('invalid ranges are ignored for assignment and reported', () => {
  assert.equal(M.rangeProblem(range('r', '25:00', '10:00', 'A')), 'invalid-time');
  assert.equal(M.rangeProblem(range('r', '09:00', '10:00', 'A', '2026-02-30')), 'invalid-date');
  const { assets } = build([rec('09:30')]);
  assert.deepEqual(eventsOf(assets, M.assign(assets, [range('r', '9:00', '10:00', 'A')])), [null]);
});

t('the popup view of an asset carries no path', () => {
  const { assets } = build([rec('10:00')]);
  const v = M.publicAsset(assets[0], M.assign(assets, []).byAsset.get(assets[0].id));
  assert.equal(JSON.stringify(v).includes('/card/'), false);
  assert.equal(v.time, '10:00');
});

t('large card: 6000 assets assign in well under a second', () => {
  const recs = [];
  for (let i = 0; i < 6000; i++) { const s = 8 * 3600 + i * 7; recs.push(rec(`${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`)); }
  const t0 = Date.now();
  const { assets } = build(recs);
  const rs = [range('r1', '08:00', '12:00', 'A'), range('r2', '12:00', '16:00', 'B'), range('r3', '16:00', '20:00', 'C')];
  const res = M.assign(assets, rs);
  M.summarize(assets, res, rs);
  M.buildBatches(assets, res, () => 'Ali');
  assert.ok(Date.now() - t0 < 1000, `${Date.now() - t0} ms`);
});

console.log(`eqi2AssignmentModel: ${passed} passed${process.exitCode ? ', FAILURES above' : ''}`);
