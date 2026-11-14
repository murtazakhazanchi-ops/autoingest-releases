'use strict';

// AI-FEAT-064 EQI-2 — the companion's Divide Photos Between Events controller: command validation,
// state preservation, new-event return, path-free views, the import plan and its pre-flight
// refusals, per-event results, the durable plan record, and the Local First re-import guard.
// Pure Node; no Electron, no card, no archive.
// Run: node test/eqi2DivideController.test.js

const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createDivideController } = require('../services/eventDumpDivide');
const { resolvePairs } = require('../services/dateAssessmentModel');
const { partitionAlreadyInDump, archiveCounterpart } = require('../services/eventDumpPaths');
const M = require('../services/eventDumpAssignmentModel');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

const D = '2026-11-14';
const COLL = '/Archive/Coll';
const EA = '1448-05-01 _01-Waaz-Hall-Surat', EB = '1448-05-01 _02-Ziyafat-Hall-Surat', EC = '1448-05-01 _03-Majlis-Hall-Surat';
const ev = (time, confidence = 'high') => ({ status: 'dated', date: D, time, offset: null, source: 'DateTimeOriginal', confidence, reason: null, candidates: null });
const rec = (name, time, type = 'photo') => ({ path: `/Volumes/CARD/DCIM/100/${name}`, name, type, size: 1000 + name.length, evidence: ev(time) });
const records = resolvePairs([
  rec('IMG_0001.JPG', '09:10:00'), rec('IMG_0001.CR3', '09:10:00', 'raw'), rec('IMG_0002.JPG', '11:00:00'),
  rec('IMG_0003.JPG', '13:00:00'), rec('IMG_0004.JPG', '17:00:00'), rec('MVI_0005.MP4', '18:00:00', 'video'),
]);

function harness(over = {}) {
  const sent = [];
  let finish = null;
  const handoff = {
    _active: null,
    getActive() { return this._active; },
    request(kind, o) {
      if (this._active) return { started: false, done: Promise.resolve({ state: 'refused', reason: 'busy' }) };
      this._active = { kind };
      const msg = o.payload(41);
      sent.push({ kind, channel: o.channel, foreground: o.foreground, msg });
      const done = new Promise(r => { finish = (res) => { this._active = null; r(res); }; });
      return { started: true, done };
    },
  };
  let active = { eventPath: `${COLL}/${EA}`, collectionName: 'Coll', pendingSync: false, localFirst: false };
  let photographer = 'Ali Bhai';
  const journal = [];
  const pushes = { n: 0 };
  const job = { state: 'complete', datesReady: true, records, cameras: null };
  const scan = [EA, EB, EC].map(f => ({ folderName: f, isFromJson: true, isCorrupt: false }));
  const deps = {
    handoff,
    getCard: (id) => (id === 'src-1' ? { mountpoint: '/Volumes/CARD', label: 'EOS_DIGITAL' } : null),
    peekJob: () => job,
    verifyJob: async () => job,
    isImported: () => false,
    listPhotographers: () => ['Ali Bhai', 'Husain Bhai'],
    scanEvents: async (c) => (c === COLL ? scan : []),
    cameras: () => ({ cameraOf: () => null, labels: new Map() }),
    getActiveEvent: () => active,
    cardPhotographer: () => photographer,
    openPicker: async () => ({ state: 'completed' }),
    archiveStatus: async () => ({ status: 'ready', defaultImportMode: 'direct-nas', localStagingRoot: '/Staging' }),
    statSize: async (p) => { const r = records.find(x => x.path === p); return r ? r.size : null; },
    makeThumb: async () => 'data:image/jpeg;base64,AAAA',
    journal: (r) => journal.push(r),
    isBusy: () => false,
    pushSnapshot: () => { pushes.n++; },
    showPopup: () => {},
    ...over,
  };
  const c = createDivideController(deps);
  return { c, sent, finish: (r) => finish(r), journal, pushes, job, scan,
    setActive: (a) => { active = a; }, setPhotographer: (p) => { photographer = p; } };
}
const cmd = (c, name, args = {}) => c.command({ sourceId: 'src-1', cmd: name, ...args });
const setup = async (h) => {
  assert.equal(h.c.open('src-1').ok, true);
  await h.c.events({ sourceId: 'src-1' });
  await cmd(h.c, 'addRange');
  const r1 = h.c.view('src-1').ranges[0].id;
  await cmd(h.c, 'updateRange', { rangeId: r1, start: '09:00', end: '12:00' });
  await cmd(h.c, 'setRangeEvent', { rangeId: r1, folderName: EA });
  await cmd(h.c, 'addRange');
  const r2 = h.c.view('src-1').ranges[1].id;
  await cmd(h.c, 'updateRange', { rangeId: r2, start: '16:30', end: '22:00' });
  await cmd(h.c, 'setRangeEvent', { rangeId: r2, folderName: EB });
  return { r1, r2 };
};

(async () => {
  console.log('eqi2DivideController');

  await t('opening needs an active event (it names the collection); nothing is assigned until the operator says so', () => {
    const h = harness();
    h.setActive(null);
    assert.deepEqual(h.c.open('src-1'), { ok: false, reason: 'no-event' });
    h.setActive({ eventPath: `${COLL}/${EA}`, collectionName: 'Coll' });
    assert.equal(h.c.open('src-1').ok, true);
    const v = h.c.view('src-1');
    assert.equal(v.ready, true);
    assert.deepEqual(v.ranges, []);
    assert.deepEqual(v.events, [], 'no event is guessed — not even the active one');
    assert.equal(v.unassigned.assets, 5);
    assert.deepEqual(v.review.blockers, ['nothing-assigned']);
    assert.equal(h.c.open('src-9').ok, false, 'unknown card');
  });

  await t('the view never carries a path; assets of a date are names and times only', async () => {
    const h = harness();
    await setup(h);
    const json = JSON.stringify([h.c.view('src-1'), h.c.assetsOf({ sourceId: 'src-1', date: D })]);
    assert.equal(json.includes('/Volumes'), false);
    assert.equal(json.includes('/Archive'), false);
    const a = h.c.assetsOf({ sourceId: 'src-1', date: D });
    assert.deepEqual(a.assets.map(x => [x.label, x.type, x.eventId]), [['IMG_0001.JPG', 'pair', EA], ['IMG_0002.JPG', 'photo', EA], ['IMG_0003.JPG', 'photo', null], ['IMG_0004.JPG', 'photo', EB], ['MVI_0005.MP4', 'video', EB]]);
  });

  await t('commands are strictly validated: unknown keys, bad times, events not in the collection scan, unknown photographers', async () => {
    const h = harness();
    const { r1 } = await setup(h);
    assert.equal((await cmd(h.c, 'updateRange', { rangeId: r1, start: '25:00' })).reason, 'invalid-time');
    assert.equal((await cmd(h.c, 'updateRange', { rangeId: r1, start: '09:00', evil: 1 })).reason, 'invalid');
    assert.equal((await cmd(h.c, 'setRangeEvent', { rangeId: r1, folderName: '../../etc' })).reason, 'not-listed');
    assert.equal((await cmd(h.c, 'setRangeEvent', { rangeId: 'r99', folderName: EA })).reason, 'invalid');
    assert.equal((await cmd(h.c, 'setAssets', { assetIds: ['a1'], target: '/Archive/Coll/x' })).reason, 'not-listed');
    assert.equal((await cmd(h.c, 'setCameraPhotographer', { camera: 'x', photographer: 'Ali Bhai' })).reason, 'invalid');
    assert.equal((await cmd(h.c, 'bogus')).reason, 'invalid');
    assert.equal((await h.c.command({ sourceId: 'src-2', cmd: 'addRange' })).reason, 'invalid');
  });

  await t('changing the shown date keeps every range; Split Here and per-photo choices update counts consistently', async () => {
    const h = harness();
    const { r1 } = await setup(h);
    await cmd(h.c, 'setViewDate', { date: '2026-11-13' });
    assert.equal(h.c.view('src-1').ranges.length, 2, 'ranges survive a date change');
    const a2 = h.c.assetsOf({ sourceId: 'src-1', date: D }).assets.find(a => a.label === 'IMG_0002.JPG');
    assert.equal((await cmd(h.c, 'splitAt', { assetId: a2.id })).ok, true);
    let v = h.c.view('src-1');
    assert.equal(v.ranges.length, 3);
    assert.equal(v.ranges[0].id, r1);
    assert.equal(v.ranges[1].eventId, null, 'the new part has no event until the operator chooses one');
    assert.equal(v.events.find(e => e.eventId === EA).assets, 1);
    assert.equal(v.unassigned.assets, 2);
    await cmd(h.c, 'setAssets', { assetIds: [a2.id], target: EC });
    v = h.c.view('src-1');
    assert.equal(v.events.find(e => e.eventId === EC).assets, 1);
    await cmd(h.c, 'setAssets', { assetIds: [a2.id], target: null });
    assert.equal(h.c.view('src-1').events.some(e => e.eventId === EC), false, 'clearing the hand choice returns it to the ranges');
  });

  await t('overlapping ranges with different events block the import with a specific reason', async () => {
    const h = harness();
    const { r2 } = await setup(h);
    await cmd(h.c, 'updateRange', { rangeId: r2, start: '10:30' });
    const v = h.c.view('src-1');
    assert.equal(v.conflicts.assets, 1, 'only the 11:00 photo is inside both ranges');
    assert.ok(v.review.blockers.includes('conflicts'));
    assert.equal((await h.c.startImport({ sourceId: 'src-1' })).reason, 'conflicts');
  });

  await t('Create New Event: back from the Event Creator, the new event is selected for that range only; cancel changes nothing', async () => {
    const h = harness();
    const { r1, r2 } = await setup(h);
    assert.equal((await cmd(h.c, 'newEvent', { rangeId: r2 })).ok, true);
    // cancelled (active event unchanged)
    h.c.onActiveEvent({ eventPath: `${COLL}/${EA}` }, true);
    let v = h.c.view('src-1');
    assert.equal(v.notice, 'new-event-cancelled');
    assert.equal(v.ranges.find(r => r.id === r2).eventId, EB);
    // created in this collection
    await cmd(h.c, 'newEvent', { rangeId: r2 });
    const NEW = '1448-05-01 _04-Jashn-Hall-Surat';
    h.c.onActiveEvent({ eventPath: `${COLL}/${NEW}` }, true);
    v = h.c.view('src-1');
    assert.equal(v.ranges.find(r => r.id === r2).eventId, NEW);
    assert.equal(v.ranges.find(r => r.id === r1).eventId, EA, 'other ranges keep their events');
    assert.equal(v.notice, 'new-event-selected');
    assert.equal(h.sent.length, 0, 'nothing imported automatically');
    // created in another collection → not used
    await cmd(h.c, 'newEvent', { rangeId: r1 });
    h.c.onActiveEvent({ eventPath: `/Archive/Other/${NEW}` }, true);
    assert.equal(h.c.view('src-1').ranges.find(r => r.id === r1).eventId, EA);
    assert.equal(h.c.view('src-1').notice, 'new-event-other-collection');
  });

  await t('one plan: a batch per (event, photographer), event paths inside the collection, every file once, Dump only', async () => {
    const h = harness();
    await setup(h);
    const p = h.c.startImport({ sourceId: 'src-1' });
    await new Promise(r => setTimeout(r, 0));
    assert.equal(h.sent.length, 1);
    const { kind, channel, foreground, msg } = h.sent[0];
    assert.deepEqual([kind, channel, foreground], ['dump-plan', 'companion:dumpPlanImport', false]);
    assert.equal(msg.collectionPath, COLL);
    assert.deepEqual(msg.batches.map(b => [b.folderName, b.eventPath, b.photographer, b.files.length]),
      [[EA, path.join(COLL, EA), 'Ali Bhai', 3], [EB, path.join(COLL, EB), 'Ali Bhai', 2]]);
    const all = msg.batches.flatMap(b => b.files);
    assert.equal(new Set(all).size, all.length);
    assert.ok(!all.some(f => f.endsWith('IMG_0003.JPG')), 'unassigned photo is not in the plan');
    assert.equal(h.c.view('src-1').op.state, 'pending');
    assert.equal((await cmd(h.c, 'addRange')).reason, 'busy', 'no edits while the plan runs');
    // per-event progress, then the flat result
    h.c.onPlanEvent({ requestId: 41, phase: 'start', index: 0 });
    h.c.onPlanEvent({ requestId: 41, phase: 'end', index: 0, status: 'completed', copied: 3, skipped: 0, errors: 0 });
    h.c.onPlanEvent({ requestId: 99, phase: 'start', index: 1 });
    assert.equal(h.c.view('src-1').op.events[1].status, 'waiting', 'progress from another request is ignored');
    h.finish({ state: 'completed', reason: null, result: { ok: true, events: 2,
      e0_status: 'completed', e0_copied: 3, e0_skipped: 0, e0_errors: 0, e0_batch: 'b-1', e0_error: null,
      e1_status: 'failed', e1_copied: 0, e1_skipped: 0, e1_errors: 0, e1_batch: null, e1_error: 'Archive folder busy' } });
    const out = await p;
    assert.equal(out.state, 'partial', 'never reported as fully completed when one event failed');
    const op = h.c.view('src-1').op;
    assert.deepEqual(op.events.map(e => [e.eventId, e.status, e.copied]), [[EA, 'completed', 3], [EB, 'failed', 0]]);
    assert.equal(op.events[1].error, 'Archive folder busy');
    assert.deepEqual(op.events[0].metadata, { state: 'writing' });
    h.c.onMetadataBatch({ event: 'batch_complete', batchId: 'b-1', failed: 0, partial: 0 });
    assert.equal(h.c.view('src-1').op.events[0].metadata.state, 'complete');
    // durable record: started + outcome, names and sizes only
    assert.equal(h.journal.length, 2);
    assert.equal(h.journal[0].state, 'started');
    assert.deepEqual(h.journal[0].batches.map(b => [b.event, b.photographer, b.files.length]), [[EA, 'Ali Bhai', 3], [EB, 'Ali Bhai', 2]]);
    assert.equal(JSON.stringify(h.journal).includes('/Volumes'), false);
    assert.equal(h.journal[1].state, 'partial');
    // ranges stay for the retry
    assert.equal(h.c.view('src-1').ranges.length, 2);
  });

  await t('pre-flight refusals: photographer, archive, missing event, changed source, removed card', async () => {
    let h = harness();
    await setup(h);
    h.setPhotographer(null);
    assert.equal((await h.c.startImport({ sourceId: 'src-1' })).reason, 'no-photographer');
    h = harness({ archiveStatus: async () => ({ status: 'nas-disconnected', defaultImportMode: 'direct-nas' }) });
    await setup(h);
    assert.equal((await h.c.startImport({ sourceId: 'src-1' })).reason, 'archive-offline');
    h = harness({ archiveStatus: async () => ({ status: 'ready', defaultImportMode: 'local-first', localStagingRoot: null }) });
    await setup(h);
    assert.equal((await h.c.startImport({ sourceId: 'src-1' })).reason, 'staging-not-configured');
    h = harness();
    await setup(h);
    h.scan.splice(1, 1);   // EB no longer a valid event
    assert.equal((await h.c.startImport({ sourceId: 'src-1' })).reason, 'event-unavailable');
    h = harness({ statSize: async () => 5 });
    await setup(h);
    assert.equal((await h.c.startImport({ sourceId: 'src-1' })).reason, 'source-changed');
    h = harness();
    await setup(h);
    h.c.forget('src-1');
    assert.equal((await h.c.startImport({ sourceId: 'src-1' })).reason, 'invalid', 'a removed card leaves no division behind');
    assert.equal(h.c.view('src-1'), null);
  });

  await t('mixed camera identities: each camera\'s photographer is required; batches split by photographer', async () => {
    const cams = new Map([[0, 'K1'], [1, 'K1'], [2, 'K1'], [3, 'K2'], [4, 'K2'], [5, 'K2']]);
    const h = harness({ cameras: () => ({ cameraOf: (i) => cams.get(i), labels: new Map([['K1', 'EOS R5'], ['K2', 'Z 9']]) }) });
    await setup(h);
    let v = h.c.view('src-1');
    assert.equal(v.cameraMode, 'per-camera');
    assert.deepEqual(v.cameras.map(c => [c.label, c.photographer]), [['EOS R5', null], ['Z 9', null]], 'never the card\'s first camera for all');
    assert.ok(v.review.blockers.includes('camera-photographer'));
    await cmd(h.c, 'setCameraPhotographer', { camera: 'K1', photographer: 'Ali Bhai' });
    await cmd(h.c, 'setCameraPhotographer', { camera: 'K2', photographer: 'Husain Bhai' });
    v = h.c.view('src-1');
    assert.deepEqual(v.review.blockers, []);
    assert.deepEqual(v.review.batches.map(b => [b.eventId, b.photographer, b.files]), [[EA, 'Ali Bhai', 3], [EB, 'Husain Bhai', 2]]);
  });

  await t('previously imported files are excluded from the plan and counted; a new assessment drops hand choices only', async () => {
    const imported = new Set(['IMG_0002.JPG']);
    const h = harness({ isImported: (n) => imported.has(n) });
    await setup(h);
    const v = h.c.view('src-1');
    assert.equal(v.imported.files, 1);
    assert.equal(v.events.find(e => e.eventId === EA).files, 2);
    const a = h.c.assetsOf({ sourceId: 'src-1', date: D }).assets[0];
    await cmd(h.c, 'setAssets', { assetIds: [a.id], target: EC });
    assert.equal(h.c.view('src-1').events.some(e => e.eventId === EC), true);
  });

  await t('a new assessment of the card drops per-photo choices (their ids are gone) but keeps the time ranges', async () => {
    let job = { state: 'complete', datesReady: true, records, cameras: null };
    const h = harness({ peekJob: () => job, verifyJob: async () => job });
    await setup(h);
    const a = h.c.assetsOf({ sourceId: 'src-1', date: D }).assets[2];
    await cmd(h.c, 'setAssets', { assetIds: [a.id], target: EC });
    assert.equal(h.c.view('src-1').events.some(e => e.eventId === EC), true);
    job = { ...job };
    const v = h.c.view('src-1');
    assert.equal(v.events.some(e => e.eventId === EC), false);
    assert.equal(v.ranges.length, 2);
  });

  await t('gap suggestions: offered only when asked; accepting splits a range, never assigns an event', async () => {
    const h = harness();
    h.c.open('src-1');
    await h.c.events({ sourceId: 'src-1' });
    await cmd(h.c, 'addRange');
    const r = h.c.view('src-1').ranges[0];
    await cmd(h.c, 'updateRange', { rangeId: r.id, start: '09:00', end: '20:00' });
    await cmd(h.c, 'setRangeEvent', { rangeId: r.id, folderName: EA });
    assert.deepEqual(h.c.view('src-1').gaps, [], 'off by default');
    await cmd(h.c, 'setGapMinutes', { minutes: 120 });
    const gaps = h.c.view('src-1').gaps;
    assert.deepEqual(gaps.map(gp => gp.time), ['13:00', '17:00'], 'pauses of 2 h and 4 h; the 1 h 50 pause is below the threshold');
    assert.equal((await cmd(h.c, 'acceptGap', { key: gaps[0].key })).ok, true);
    const v = h.c.view('src-1');
    assert.equal(v.ranges.length, 2);
    assert.deepEqual(v.ranges.map(x => x.eventId), [EA, null]);
    assert.equal((await cmd(h.c, 'setGapMinutes', { minutes: 45 })).ok, false);
  });

  await t('thumbnails: bounded per call, cached, path-free', async () => {
    let made = 0;
    const h = harness({ makeThumb: async () => { made++; return 'data:image/jpeg;base64,BBBB'; } });
    h.c.open('src-1');
    const ids = h.c.assetsOf({ sourceId: 'src-1', date: D }).assets.map(a => a.id);
    const r = await h.c.thumbs({ sourceId: 'src-1', ids });
    assert.equal(Object.keys(r.thumbs).length, ids.length);
    await h.c.thumbs({ sourceId: 'src-1', ids });
    assert.equal(made, ids.length, 'second call served from the cache');
    assert.equal((await h.c.thumbs({ sourceId: 'src-1', ids: new Array(25).fill('a1') })).ok, false);
  });

  await t('Local First guard: the archive counterpart of a staging Dump job is checked by image data, read-only', async () => {
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-eqi2-'));
    const staging = path.join(tmp, 'staging', 'Coll', EA), archive = path.join(tmp, 'archive', 'Coll', EA);
    const job = { src: '/Volumes/CARD/DCIM/IMG_1.JPG', dest: path.join(staging, 'Dump', 'Ali Bhai', 'IMG_1.JPG') };
    assert.equal(archiveCounterpart(job, staging, archive), path.join(archive, 'Dump', 'Ali Bhai', 'IMG_1.JPG'));
    assert.equal(archiveCounterpart({ ...job, dest: path.join(staging, 'Other', 'x.JPG') }, staging, archive), null, 'only inside Dump');
    assert.equal(archiveCounterpart({ ...job, dest: path.join(tmp, 'elsewhere.JPG') }, staging, archive), null);
    const existing = new Set([path.join(archive, 'Dump', 'Ali Bhai', 'IMG_1.JPG')]);
    const io = { exists: async (p) => existing.has(p), hashOf: async (p) => (p === job.src || existing.has(p) ? 'H1' : null) };
    const withAlt = await partitionAlreadyInDump([job], { ...io, alternateOf: (j) => archiveCounterpart(j, staging, archive) });
    assert.deepEqual([withAlt.copy.length, withAlt.alreadyInDump.length], [0, 1], 'already in the archive Dump → not staged again');
    const without = await partitionAlreadyInDump([job], io);
    assert.deepEqual([without.copy.length, without.alreadyInDump.length], [1, 0], 'EQI-1 behaviour unchanged without the counterpart');
    const differs = await partitionAlreadyInDump([job], { exists: io.exists, hashOf: async (p) => (p === job.src ? 'H1' : 'H2'), alternateOf: (j) => archiveCounterpart(j, staging, archive) });
    assert.equal(differs.copy.length, 1, 'a different photo with the same name is still imported');
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  await t('model sanity through the controller: the boundary photo goes to the later range', async () => {
    const h = harness();
    const { r1, r2 } = await setup(h);
    await cmd(h.c, 'updateRange', { rangeId: r1, end: '11:00' });
    await cmd(h.c, 'updateRange', { rangeId: r2, start: '11:00' });
    const a = h.c.assetsOf({ sourceId: 'src-1', date: D }).assets.find(x => x.label === 'IMG_0002.JPG');
    assert.equal(a.eventId, EB);
    assert.equal(M.UNASSIGNED, '__unassigned__');
  });

  console.log(`eqi2DivideController: ${passed} passed${process.exitCode ? ', FAILURES above' : ''}`);
})();
