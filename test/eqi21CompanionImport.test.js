'use strict';

// AI-FEAT-064 EQI-2.1 — the companion's main-process import (no main window): the plan over the
// existing router/runner/transaction, Local First mirror + sync job after metadata, the busy-archive
// decision, completion only after metadata, partial failure, byte-level transfer statistics and the
// event.json component normalization. Pure Node with fakes; no Electron, no card, no archive.
// Run: node test/eqi21CompanionImport.test.js

const assert = require('node:assert/strict');
const { createCompanionImportService } = require('../services/companionImportService');
const { createTransferTracker } = require('../services/transferStats');
const { componentsFromEventJson, labelsOf } = require('../services/eventComponents');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}
const tick = () => new Promise(r => setTimeout(r, 0));
const until = async (fn, ms = 2000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) throw new Error('timeout'); await new Promise(r => setTimeout(r, 5)); } };

const COLL = '/Arc/Coll';
const EA = '1448-05-01 _01-Waaz-Hall', EB = '1448-05-01 _02-Majlis-Ziyafat';
const eventJson = {
  [EA]: { components: [{ id: 1, folderName: 'Waaz-Hall', types: ['Waaz'], location: 'Hall', city: 'Surat', country: 'India', additionalKeywords: ['Urs'] }] },
  [EB]: { components: [{ id: 1, types: ['Majlis'], city: 'Surat' }, { id: 2, types: ['Ziyafat'], city: 'Surat' }] },
};

function rig(over = {}) {
  const calls = { commit: [], mirror: [], update: [], sync: [], locks: 0, cleared: [] };
  let pushes = 0;
  const commits = [];   // control the transaction from the test
  const deps = {
    commit: (params, hooks) => new Promise((resolve, reject) => { calls.commit.push(params); commits.push({ params, hooks, resolve, reject }); }),
    readEventJson: async (p) => eventJson[p.split('/').pop()] || null,
    ensureLocalMirror: async (params) => { calls.mirror.push(params); return { ok: true, localEventPath: `/Staging/Coll/${params.eventName}` }; },
    updateEventJson: async (p, patch) => { calls.update.push([p, patch.status]); },
    checkLocks: async () => { calls.locks++; return { blocked: [] }; },
    clearSelfStaleLock: async (a) => { calls.cleared.push(a.lockPath); return { ok: true }; },
    archiveStatus: async () => ({ status: 'ready', defaultImportMode: 'direct-nas', nasRoot: '/Arc', localStagingRoot: '/Staging' }),
    appendSyncJob: async (a) => { calls.sync.push(a); return { ok: true }; },
    activeUser: () => ({ id: 'u1', name: 'Operator' }),
    dirExists: async () => true,
    statSize: async () => null,
    onChange: () => { pushes++; },
    ...over,
  };
  const svc = createCompanionImportService(deps);
  return { svc, calls, commits, pushes: () => pushes };
}
const plan = (over = {}) => ({
  sourceId: 'src-1', kind: 'multi', source: { label: 'CARD', path: '/Volumes/CARD' }, localFirstEvent: false, collectionName: 'Coll',
  batches: [
    { eventId: EA, eventPath: `${COLL}/${EA}`, photographer: 'Ali Bhai', files: [{ path: '/Volumes/CARD/A1.JPG', size: 4000 }, { path: '/Volumes/CARD/A2.CR3', size: 6000 }] },
    { eventId: EB, eventPath: `${COLL}/${EB}`, photographer: 'Ali Bhai', files: [{ path: '/Volumes/CARD/B1.JPG', size: 5000 }] },
  ],
  ...over,
});
const summaryOf = (params, { copied = null, errors = 0, batch = 'b' } = {}) => {
  const jobs = params.fileJobs;
  const ok = copied === null ? jobs : jobs.slice(0, copied);
  return { copied: ok.length, skipped: 0, errors, copiedFiles: ok.map(j => ({ src: j.src, dest: j.dest, size: 1000 })), skippedFiles: [], metadataBatchId: batch };
};

(async () => {
  console.log('eqi21CompanionImport');

  await t('runs the existing transaction per event with the workspace\'s exact parameters — Dump routing, no sequencing, importedBy, source', async () => {
    const { svc, calls, commits } = rig();
    const done = svc.run(plan());
    await until(() => commits.length === 1);
    const p = calls.commit[0];
    assert.equal(p.destination, 'dump');
    assert.equal(p.eventJsonPath, `${COLL}/${EA}`);
    assert.deepEqual(p.fileJobs.map(j => j.dest), [`${COLL}/${EA}/Dump/Ali Bhai/A1.JPG`, `${COLL}/${EA}/Dump/Ali Bhai/A2.CR3`]);
    assert.deepEqual(p.groups, [{ id: 0, subEventId: null, metadataTags: null, files: ['/Volumes/CARD/A1.JPG', '/Volumes/CARD/A2.CR3'], fileTagRefinements: null }]);
    assert.equal(p.liveComps[0].eventTypes[0].label, 'Waaz', 'event.json components in the workspace format');
    assert.deepEqual(p.importedBy, { id: 'u1', name: 'Operator' });
    assert.deepEqual(p.source, { type: 'memory-card', label: 'CARD', path: '/Volumes/CARD' });
    assert.equal(typeof p.importSessionId, 'string', 'multi-event: one session id');
    assert.deepEqual(calls.update[0], [`${COLL}/${EA}`, 'in-progress']);
    commits[0].resolve(summaryOf(commits[0].params, { batch: 'bA' }));
    await until(() => commits.length === 2);
    assert.deepEqual(commits[1].params.groups[0].metadataTags, [], 'multi-component event: Dump has no component keyword');
    commits[1].resolve(summaryOf(commits[1].params, { batch: 'bB' }));
    await until(() => svc.view('src-1').stage === 'metadata');
    assert.equal(svc.view('src-1').state, 'pending', 'copy done is NOT import done: metadata still running');
    commits[0].hooks.onMetadata({ batchId: 'bA', event: 'batch_complete', done: 2, failed: 0, total: 2 });
    assert.equal(svc.view('src-1').state, 'pending');
    commits[1].hooks.onMetadata({ batchId: 'bB', event: 'batch_complete', done: 1, failed: 0, total: 1 });
    assert.deepEqual(await done, { state: 'completed', reason: null });
    const v = svc.view('src-1');
    assert.deepEqual(v.events.map(e => [e.status, e.metadata.state]), [['completed', 'complete'], ['completed', 'complete']]);
    assert.equal(JSON.stringify(v).includes('/Volumes'), false, 'the view carries no path');
  });

  await t('Local First: mirror + staging remap, archive counterpart passed for the re-import guard; ONE sync job per event after its metadata', async () => {
    const { svc, calls, commits } = rig({ archiveStatus: async () => ({ status: 'ready', defaultImportMode: 'local-first', localStagingRoot: '/Staging' }) });
    const done = svc.run(plan());
    await until(() => commits.length === 1);
    assert.equal(calls.mirror[0].eventPath, `${COLL}/${EA}`);
    assert.equal(commits[0].params.eventJsonPath, `/Staging/Coll/${EA}`);
    assert.ok(commits[0].params.fileJobs.every(j => j.dest.startsWith(`/Staging/Coll/${EA}/Dump/Ali Bhai/`)));
    assert.equal(commits[0].params.archiveEventPath, `${COLL}/${EA}`);
    commits[0].hooks.onMetadata({ batchId: 'bA', event: 'batch_complete', done: 2, failed: 0, total: 2 });   // before the commit returns
    commits[0].resolve(summaryOf(commits[0].params, { batch: 'bA' }));
    await until(() => commits.length === 2);
    await until(() => calls.sync.length === 1);
    assert.deepEqual([calls.sync[0].localEventPath, calls.sync[0].job.readyForSync, calls.sync[0].job.metadataStatus, calls.sync[0].job.files.length], [`/Staging/Coll/${EA}`, true, 'complete', 2]);
    commits[1].resolve(summaryOf(commits[1].params, { batch: 'bB' }));
    await tick();
    assert.equal(calls.sync.length, 1, 'no sync job before that event\'s metadata finished');
    commits[1].hooks.onMetadata({ batchId: 'bB', event: 'batch_complete', done: 0, failed: 1, total: 1 });
    await done;
    await until(() => calls.sync.length === 2);
    assert.deepEqual([calls.sync[1].job.metadataStatus, calls.sync[1].job.needsAttention], ['failed', true]);
    assert.equal(svc.view('src-1').state, 'completed-with-errors', 'metadata failure is never a clean success');
    assert.equal(svc.view('src-1').events[0].sync, 'queued');
  });

  await t('busy archive folder: the operator decides in the companion — Check Again / Cancel; Clear only for this computer\'s own lock', async () => {
    let blocked = [{ photographerFolderName: 'Ali Bhai', lockedBy: 'OTHER-MAC', lockPath: '/Arc/.lock1' }];
    const { svc, calls, commits } = rig({ checkLocks: async () => ({ blocked, currentDeviceName: 'THIS-MAC' }) });
    let done = svc.run(plan());
    await until(() => svc.view('src-1').decision);
    let v = svc.view('src-1');
    assert.deepEqual([v.stage, v.decision.sameDevice, v.decision.device, v.decision.folders], ['waiting-decision', false, 'OTHER-MAC', ['Ali Bhai']]);
    assert.equal(svc.decide('src-1', 'clear').reason, 'invalid', 'never clears another computer\'s lock');
    assert.equal(svc.decide('src-1', 'cancel').ok, true);
    assert.deepEqual(await done, { state: 'refused', reason: 'archive-busy' });
    assert.equal(commits.length, 0, 'nothing copied');
    blocked = [{ photographerFolderName: 'Ali Bhai', lockedBy: 'THIS-MAC', lockPath: '/Arc/.lock2' }];
    done = svc.run(plan());
    await until(() => svc.view('src-1').decision);
    assert.equal(svc.view('src-1').decision.sameDevice, true);
    blocked = [];
    svc.decide('src-1', 'clear');
    await until(() => commits.length === 1);
    assert.deepEqual(calls.cleared, ['/Arc/.lock2'], 'only on the operator\'s explicit choice');
    commits[0].reject(new Error('stop'));
    await until(() => commits.length === 2);
    commits[1].resolve({ copied: 0, skipped: 0, errors: 0, copiedFiles: [], skippedFiles: [], metadataBatchId: null });
    const r = await done;
    assert.equal(r.state, 'partial');
  });

  await t('partial failure: a failing event is isolated, the other stays valid; a removed card stops the rest', async () => {
    let alive = true;
    const { svc, calls, commits } = rig({ dirExists: async () => alive });
    const done = svc.run(plan());
    await until(() => commits.length === 1);
    commits[0].reject(new Error('Archive folder busy'));
    await until(() => commits.length === 2);
    assert.deepEqual(calls.update.slice(0, 2).map(u => u[1]), ['in-progress', 'created'], 'the failed event is restored to created');
    commits[1].resolve(summaryOf(commits[1].params, { batch: null }));
    const r = await done;
    assert.equal(r.state, 'partial');
    const v = svc.view('src-1');
    assert.deepEqual(v.events.map(e => e.status), ['failed', 'completed']);
    assert.equal(v.events[0].error, 'Archive folder busy');
    // card removed between events
    const h2 = rig({ dirExists: async () => alive });
    const d2 = h2.svc.run(plan());
    await until(() => h2.commits.length === 1);
    alive = false;
    h2.commits[0].resolve(summaryOf(h2.commits[0].params, { batch: null }));
    const r2 = await d2;
    assert.equal(r2.state, 'partial');
    assert.deepEqual(h2.svc.view('src-1').events.map(e => e.status), ['completed', 'not-started']);
  });

  await t('pre-flight refusals: unreadable event, archive offline, staging missing, unsafe event name; one import at a time', async () => {
    let { svc } = rig({ readEventJson: async () => null });
    assert.deepEqual(await svc.run(plan()), { state: 'refused', reason: 'event-unreadable' });
    ({ svc } = rig({ archiveStatus: async () => ({ status: 'nas-disconnected', defaultImportMode: 'direct-nas' }) }));
    assert.equal((await svc.run(plan())).reason, 'archive-offline');
    ({ svc } = rig({ archiveStatus: async () => ({ status: 'ready', defaultImportMode: 'direct-nas' }) }));
    assert.equal((await svc.run(plan({ localFirstEvent: true }))).reason, 'staging-not-configured');
    ({ svc } = rig());
    assert.equal((await svc.run(plan({ batches: [{ eventId: '..', eventPath: '/Arc/..', photographer: 'A', files: [{ path: '/x', size: 1 }] }] }))).reason, 'invalid');
    const h = rig();
    const d = h.svc.run(plan());
    assert.deepEqual(await h.svc.run(plan()), { state: 'refused', reason: 'busy' });
    await until(() => h.commits.length === 1);
    h.commits[0].reject(new Error('x')); await until(() => h.commits.length === 2); h.commits[1].reject(new Error('y'));
    await d;
  });

  await t('transfer statistics: real bytes from the engine, in-flight bytes by stat, no double counting across retries, reconciled at commit', async () => {
    let now = 0;
    const sizes = new Map();
    const tr = createTransferTracker({ statSize: async (p) => sizes.get(p) ?? null, now: () => now });
    tr.addEvent({ totalBytes: 10_000_000, totalFiles: 2 });
    tr.addEvent({ totalBytes: 5_000_000, totalFiles: 1 });
    tr.setCurrent(0);
    await tr.sample();                               // t=0 baseline
    tr.onCopyStart({ dest: '/d/a', size: 6_000_000 });
    sizes.set('/d/a', 2_000_000); now = 500; await tr.sample();
    let v = tr.view(true);
    assert.equal(v.inflightBytes, 2_000_000);
    assert.equal(v.calculating, true, 'not enough samples for an estimate yet');
    assert.equal(v.etaSec, null);
    // retry: the attempt restarts at zero bytes
    tr.onCopyEnd({ dest: '/d/a' }); tr.onCopyStart({ dest: '/d/a', size: 6_000_000 }); sizes.set('/d/a', 1_000_000);
    now = 1000; await tr.sample();
    sizes.set('/d/a', 5_000_000); now = 1500; await tr.sample();
    sizes.set('/d/a', 6_000_000); now = 2000; await tr.sample();
    tr.onCopyEnd({ dest: '/d/a' });
    tr.onFile({ status: 'done', fileSize: 6_000_000 });
    tr.onFile({ status: 'skipped', fileSize: 4_000_000 });
    v = tr.view(true);
    assert.deepEqual([v.copiedBytes, v.skippedBytes, v.inflightBytes, v.transferredBytes], [6_000_000, 4_000_000, 0, 6_000_000]);
    assert.equal(v.files.copied, 1); assert.equal(v.files.skipped, 1);
    assert.equal(v.calculating, false);
    assert.ok(v.speedBps > 0 && v.etaSec > 0, `speed ${v.speedBps} eta ${v.etaSec}`);
    assert.equal(tr.view(false).etaSec, null, 'no estimate outside the copying stage');
    // the transaction summary is final (incl. "already in the Dump" skips that never reached the copy engine)
    tr.reconcile(0, { copied: 1, skipped: 1, errors: 0, copiedFiles: [{ src: 'a', size: 6_000_000 }], skippedFiles: [{ src: 'b' }] }, new Map([['b', 4_000_000]]));
    tr.setCurrent(1);
    tr.onFile({ status: 'error', fileSize: 5_000_000 });
    tr.reconcile(1, { copied: 0, skipped: 0, errors: 1, copiedFiles: [], skippedFiles: [] }, new Map());
    v = tr.view(false);
    assert.deepEqual([v.totalBytes, v.copiedBytes, v.skippedBytes, v.failedBytes, v.processedBytes], [15_000_000, 6_000_000, 4_000_000, 5_000_000, 15_000_000]);
    assert.deepEqual(v.files, { total: 3, copied: 1, skipped: 1, failed: 1 });
  });

  await t('transfer statistics: a stopped transfer shows Waiting, never a stale estimate', async () => {
    let now = 0;
    const tr = createTransferTracker({ statSize: async () => null, now: () => now });
    tr.addEvent({ totalBytes: 1e9, totalFiles: 10 });
    tr.setCurrent(0);
    for (let i = 0; i < 5; i++) { now += 500; tr.onFile({ status: 'done', fileSize: 5e7 }); await tr.sample(); }
    assert.ok(tr.view(true).etaSec > 0);
    now += 9000; await tr.sample();
    const v = tr.view(true);
    assert.equal(v.stalled, true);
    assert.equal(v.etaSec, null);
  });

  await t('the service view reports bytes per event and overall during the copy', async () => {
    const sizes = new Map();
    const { svc, commits } = rig({ statSize: async (p) => sizes.get(p) ?? null });
    const done = svc.run(plan());
    await until(() => commits.length === 1);
    const h = commits[0].hooks;
    h.onCopyStart({ src: '/Volumes/CARD/A1.JPG', dest: '/d/A1', size: 4000 });
    h.onProgress({ status: 'done', fileSize: 4000 }); h.onCopyEnd({ dest: '/d/A1' });
    const v = svc.view('src-1');
    assert.deepEqual([v.stage, v.totals.totalBytes, v.totals.copiedBytes, v.totals.files.total, v.totals.files.copied], ['copying', 15000, 4000, 3, 1]);
    assert.equal(v.events[0].bytes.totalBytes, 10000);
    commits[0].reject(new Error('x')); await until(() => commits.length === 2); commits[1].reject(new Error('y'));
    await done;
  });

  await t('event.json components: the same normalization as the Event Creator\'s loadEventFromDisk; labels for the companion', () => {
    const comps = componentsFromEventJson({ data: eventJson[EA] });
    assert.deepEqual(comps, [{ id: 1, eventTypes: [{ label: 'Waaz' }], location: { label: 'Hall' }, city: { label: 'Surat' }, country: 'India', folderName: 'Waaz-Hall',
      additionalKeywords: [{ label: 'Urs', keywordId: null, useInFolderName: false }] }]);
    assert.equal(componentsFromEventJson({ components: [] }), null);
    assert.equal(componentsFromEventJson(null), null);
    assert.deepEqual(labelsOf(componentsFromEventJson(eventJson[EB])), { types: ['Majlis', 'Ziyafat'], places: ['Surat'] });
  });

  console.log(`eqi21CompanionImport: ${passed} passed${process.exitCode ? ', FAILURES above' : ''}`);
})();
