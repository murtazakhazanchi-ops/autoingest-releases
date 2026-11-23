'use strict';

// AI-FEAT-064 EQI-3.1 — Sort Dump live-event safety. Unit level, real temporary folders:
//   * a Dump photo is never offered an ordinary import (services/importSourceGuard.js)
//   * a source that disappeared is stopped BEFORE anything is written, and reported as what it was,
//     never as a user cancellation (main/fileManager.js abortReason, services/importStopReasons.js)
//   * the move finishes at its durable boundary; metadata runs in the background from a durable record
//     (services/dumpSortMetadata.js) — locks held until it is written, crash/restart resumed, failures
//     never undo a move, a file an interrupted batch owns is never given a second task
//   * renames are refused while a sort or its metadata still needs the event's folders (busyFor)
// Run: node test/eqi31SortDumpSafety.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { updateEventJsonAtomic } = require('../main/eventJsonStore');
const intent = require('../services/eventMetadataIntent');
const { createDumpSortService } = require('../services/dumpSortService');
const { createDumpSortMetadata } = require('../services/dumpSortMetadata');
const guard = require('../services/importSourceGuard');
const { abortedImportMessage } = require('../services/importStopReasons');
const Runner = require('../renderer/importSessionRunner');
// main/fileManager logs through services/logger (Electron's userData) — a silent logger under plain node.
require.cache[require.resolve('../services/logger')] = { id: 'logger', filename: require.resolve('../services/logger'), loaded: true, exports: { log: () => {} } };
const fileManager = require('../main/fileManager');
const journal = require('../services/dumpSortJournal');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

const PH = 'Synthetic Photographer';
const COMPS = [
  { id: 1, folderName: '01-Majlis', types: ['Majlis'], city: 'Testcity' },
  { id: 2, folderName: '02-Waaz', types: ['Waaz'], city: 'Testcity' },
];
const cr3 = (i) => `IMG_${String(i).padStart(4, '0')}.CR3`;
let root;
async function put(p, content) { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, content); return p; }
const exists = (p) => fsp.lstat(p).then(() => true, () => false);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function makeEvent(name, count = 6) {
  const ev = path.join(root, 'archive', 'Coll', name);
  await put(path.join(ev, 'event.json'), JSON.stringify({ eventName: name, components: COMPS, imports: [{ id: 'imp-1', destination: 'dump', counts: { total: count } }] }));
  for (let i = 1; i <= count; i++) {
    await put(path.join(ev, 'Dump', PH, cr3(i)), `raw-${name}-${i}`.repeat(50));
    await put(path.join(ev, 'Dump', PH, `IMG_${String(i).padStart(4, '0')}.xmp`), `<x:xmpmeta n="${i}"/>`);
  }
  return ev;
}
const sel = (ev, idx, comp) => idx.map(i => ({ path: path.join(ev, 'Dump', PH, cr3(i)), subEventId: comp }));

/** Background metadata with a controllable verifier and an observable lock ledger. */
function metadataHarness(over = {}) {
  const log = { verified: [], holds: 0, released: 0, events: [], emits: [] };
  const batch = deferred();
  const meta = createDumpSortMetadata({
    verify: async (real, files) => { log.verified.push(...files); return { checked: files.length, complete: 0, failed: 0, verificationRequired: 0, queued: files.length, batchDone: batch.promise }; },
    holdLocks: async () => { log.holds++; log.events.push('meta-hold'); return { ok: true, release: async () => { log.released++; log.events.push('meta-release'); } }; },
    activeQueuedFiles: async () => new Set(),
    indexFile: path.join(root, 'userData', 'dump-sort-metadata-pending.json'),
    emit: (st) => log.emits.push(st),
    ...over,
  });
  return { meta, log, batch };
}

function service(meta, over = {}) {
  const calls = { sortReleased: 0, events: [] };
  const svc = createDumpSortService({
    updateEventJsonAtomic, intent,
    roots: () => ({ archive: [fs.realpathSync(path.join(root, 'archive'))], staging: null, nas: null }),
    pendingSyncFor: async () => [], activeMetadataFor: async () => 0, isImportRunning: () => false,
    acquireLocks: async () => { calls.events.push('sort-hold'); return { ok: true, release: async () => { calls.sortReleased++; calls.events.push('sort-release'); } }; },
    metadata: meta,
    ...over,
  });
  return { svc, calls };
}
const until = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise(r => setTimeout(r, 10)); } return false; };

(async () => {
  console.log('eqi31SortDumpSafety');
  root = fs.realpathSync(await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-eqi31-')));

  // ── Import source guard ────────────────────────────────────────────────────────────────
  await t('a photo in a managed event\'s Dump is recognised; a loose "Dump" folder without an event is not', async () => {
    const ev = await makeEvent('G1', 1);
    const owner = await guard.dumpOwnerOf(path.join(ev, 'Dump', PH, cr3(1)));
    assert.equal(owner && owner.eventPath, ev);
    assert.equal(await guard.dumpOwnerOf(path.join(ev, 'Dump', PH, 'VIDEO', 'x.MP4')).then(o => o && o.eventPath), ev, 'nested folders too');
    const loose = await put(path.join(root, 'archive', 'Coll', 'Dump', PH, cr3(1)), 'x');
    assert.equal(await guard.dumpOwnerOf(loose), null, 'a collection-level Dump folder (no event.json above it) is an ordinary folder');
    assert.equal(await guard.dumpOwnerOf(path.join(ev, '01-Majlis', PH, cr3(1))), null, 'final component folders are not Dump');
    const first = await guard.firstDumpSource([{ src: loose }, { src: path.join(ev, 'Dump', PH, cr3(1)) }]);
    assert.equal(first && first.eventPath, ev);
  });

  await t('missingSourceDirs: a renamed event\'s old Dump folder is reported, present folders are not', async () => {
    const ev = await makeEvent('G2', 1);
    const job = { src: path.join(ev, 'Dump', PH, cr3(1)), dest: '/x' };
    assert.deepEqual(await guard.missingSourceDirs([job]), []);
    await fsp.rename(ev, ev + ' renamed');
    assert.deepEqual(await guard.missingSourceDirs([job, job]), [path.dirname(job.src)], 'once per folder');
  });

  // ── Stop reasons (the 0-of-139 report) ─────────────────────────────────────────────────
  await t('stop messages say what happened; only an explicit request is a "cancellation"; all stop a multi-event run', async () => {
    const m = abortedImportMessage('source-unavailable', 0, 139);
    assert.match(m, /^Import stopped: the source folder is no longer available/);
    assert.match(m, /0 of 139 files copied/);
    assert.doesNotMatch(m, /cancel/i);
    assert.match(abortedImportMessage('source-disconnected', 3, 10), /^Import stopped: the source was disconnected/);
    assert.match(abortedImportMessage('lock-lost', 1, 2), /lock was lost/);
    assert.match(abortedImportMessage('user', 2, 5), /^Import was cancelled — 2 of 5 files copied before cancellation/);
    assert.match(abortedImportMessage(undefined, 0, 1), /^Import stopped unexpectedly/);
    for (const r of ['source-unavailable', 'source-disconnected', 'lock-lost', 'user', null]) {
      assert.equal(Runner.isCancelMessage(abortedImportMessage(r, 0, 1)), true, `fatal for the session: ${r}`);
    }
    assert.equal(Runner.isCancelMessage('Import refused: these photos are already in an event\'s Dump'), true);
    assert.equal(Runner.isCancelMessage('Archive folder is busy'), false);
  });

  await t('copy engine: a source folder that vanished aborts as source-unavailable (not a user cancel); the flag resets per run', async () => {
    const src = await put(path.join(root, 'cp', 'src', 'a.CR3'), 'a'.repeat(4000));
    const gone = path.join(root, 'cp', 'gone', 'b.CR3');
    const dest = path.join(root, 'cp', 'dest');
    const r = await fileManager.copyFileJobs([{ src: gone, dest: path.join(dest, 'b.CR3') }, { src, dest: path.join(dest, 'a.CR3') }], () => {});
    assert.equal(r.wasAborted, true);
    assert.equal(r.abortReason, 'source-unavailable');
    assert.equal(r.copied, 0);
    const ok = await fileManager.copyFileJobs([{ src, dest: path.join(dest, 'a2.CR3') }], () => {});
    assert.equal(ok.wasAborted, false);
    assert.equal(ok.abortReason, null);
    fileManager.abortCopy('source-disconnected');
    fileManager.abortCopy('user');
    const again = await fileManager.copyFileJobs([{ src, dest: path.join(dest, 'a3.CR3') }], () => {});
    assert.equal(again.abortReason, null, 'an abort before a run never leaks into the next run');
  });

  // ── Background metadata ────────────────────────────────────────────────────────────────
  await t('move finishes first: the journal is done and the operator released while metadata is still writing', async () => {
    const ev = await makeEvent('M1', 6);
    const { meta, log, batch } = metadataHarness();
    const { svc, calls } = service(meta);
    const r = await svc.run(ev, { selection: sel(ev, [1, 2, 3], '01-Majlis') });
    assert.equal(r.ok, true, JSON.stringify(r.attention || r.blockers));
    assert.equal(r.movedFiles, 3);
    assert.equal(r.metadata.state, 'queued');
    assert.equal(r.metadataStart.started, true);
    assert.equal((await journal.listPending(ev)).journals.length, 0, 'move journal finished (done/) before metadata ran');
    assert.ok(await exists(path.join(journal.journalDir(ev), 'done', `${r.txId}.json`)));
    for (let i = 1; i <= 3; i++) {
      assert.ok(await exists(path.join(ev, '01-Majlis', PH, cr3(i))), 'photo at its final folder');
      assert.ok(await exists(path.join(ev, '01-Majlis', PH, `IMG_${String(i).padStart(4, '0')}.xmp`)), 'XMP moved with it');
      assert.ok(!(await exists(path.join(ev, 'Dump', PH, cr3(i)))), 'Dump copy removed');
    }
    assert.deepEqual(calls.events, ['sort-hold', 'sort-release']);
    assert.ok(log.events.indexOf('meta-hold') >= 0, 'metadata took its own hold');
    assert.equal(log.released, 0, 'metadata hold kept while the batch writes');
    await until(() => log.verified.length === 3);
    assert.deepEqual(log.verified.sort(), [1, 2, 3].map(i => path.join(ev, '01-Majlis', PH, cr3(i))).sort(), 'verifies FINAL paths, never Dump paths');
    assert.ok(log.verified.every(f => !f.includes(`${path.sep}Dump${path.sep}`)));
    assert.match(await svc.busyFor(ev), /Metadata is still being written/, 'rename refused while metadata writes');
    const rec = path.join(meta.recordDir(ev), `${r.txId}.json`);
    assert.ok(await exists(rec), 'durable record while pending');
    assert.equal(meta.snapshot()[0].state, 'writing');
    batch.resolve({ done: 3, failed: 0 });
    await until(() => log.released === 1);
    assert.equal(log.released, 1, 'hold released after the batch finished');
    assert.ok(!(await exists(rec)), 'record removed only after completion');
    assert.equal(meta.snapshot()[0].state, 'complete');
    assert.equal(await svc.busyFor(ev), null, 'rename allowed again');
    const doc = JSON.parse(await fsp.readFile(path.join(ev, 'event.json'), 'utf8'));
    assert.equal(doc.imports.length, 1, 'no new import record');
    assert.equal(doc.dumpSorts.length, 1);
  });

  await t('a second sort of the same event is not blocked by the first one\'s background metadata', async () => {
    const ev = await makeEvent('M2', 6);
    const { meta, batch } = metadataHarness();
    const { svc } = service(meta);
    const a = await svc.run(ev, { selection: sel(ev, [1, 2], '01-Majlis') });
    const b = await svc.run(ev, { selection: sel(ev, [3, 4], '02-Waaz') });
    assert.equal(a.ok && b.ok, true, JSON.stringify(b.blockers));
    assert.equal(b.movedFiles, 2);
    batch.resolve({ done: 2, failed: 0 });
    await until(() => meta.snapshot().every(s => !s.active));
  });

  await t('metadata failure: the move stands, the state says "requires attention", nothing is marked complete', async () => {
    const ev = await makeEvent('M3', 3);
    const { meta, log, batch } = metadataHarness();
    const { svc } = service(meta);
    const r = await svc.run(ev, { selection: sel(ev, [1, 2], '01-Majlis') });
    batch.resolve({ done: 1, failed: 1 });
    await until(() => log.released === 1);
    const st = meta.snapshot().find(s => s.txId === r.txId);
    assert.equal(st.state, 'attention');
    assert.match(st.message, /Metadata requires attention: 1 could not be written/);
    assert.ok(await exists(path.join(ev, '01-Majlis', PH, cr3(1))) && await exists(path.join(ev, '01-Majlis', PH, cr3(2))), 'moved photos untouched');
    assert.ok(!(await exists(path.join(ev, 'Dump', PH, cr3(1)))), 'never moved back');
    assert.equal((await journal.listPending(ev)).journals.length, 0, 'no sort is reopened or repeated');
  });

  await t('verification error: record kept and retried later (next Sort Dump open), never silently completed', async () => {
    const ev = await makeEvent('M4', 2);
    let fail = true;
    const batch = deferred();
    const meta = createDumpSortMetadata({
      verify: async (real, files) => { if (fail) throw new Error('exiftool down'); return { checked: files.length, complete: files.length, failed: 0, verificationRequired: 0, queued: 0, batchDone: batch.promise }; },
      holdLocks: async () => ({ ok: true, release: async () => {} }), activeQueuedFiles: async () => new Set(),
      indexFile: path.join(root, 'userData', 'idx-m4.json'),
    });
    const { svc } = service(meta);
    const r = await svc.run(ev, { selection: sel(ev, [1], '01-Majlis') });
    await until(() => meta.snapshot().every(s => !s.active));
    assert.equal(meta.snapshot()[0].state, 'attention');
    assert.ok(await exists(path.join(meta.recordDir(ev), `${r.txId}.json`)), 'record kept');
    fail = false;
    await svc.plan(ev, []);   // Sort Dump opening the event again resumes it
    await until(() => meta.snapshot().some(s => s.state === 'complete'));
    assert.equal(meta.snapshot().find(s => s.txId === r.txId).state, 'complete');
    assert.ok(!(await exists(path.join(meta.recordDir(ev), `${r.txId}.json`))));
  });

  await t('crash during metadata: a new process resumes from the userData index; files an interrupted batch owns are left to it', async () => {
    const ev = await makeEvent('M5', 4);
    const idx = path.join(root, 'userData', 'idx-m5.json');
    const never = deferred();
    const first = createDumpSortMetadata({
      verify: async (real, files) => ({ checked: files.length, complete: 0, failed: 0, verificationRequired: 0, queued: files.length, batchDone: never.promise }),
      holdLocks: async () => ({ ok: true, release: async () => {} }), activeQueuedFiles: async () => new Set(), indexFile: idx,
    });
    const { svc } = service(first);
    const r = await svc.run(ev, { selection: sel(ev, [1, 2, 3], '01-Majlis') });
    assert.equal(r.ok, true);
    // "crash": the first instance is abandoned mid-batch. A restarted process:
    const owned = new Set([path.resolve(path.join(ev, '01-Majlis', PH, cr3(1)))]);
    const verified = [];
    const second = createDumpSortMetadata({
      verify: async (real, files) => { verified.push(...files); return { checked: files.length, complete: files.length, failed: 0, verificationRequired: 0, queued: 0, batchDone: Promise.resolve(null) }; },
      holdLocks: async () => ({ ok: true, release: async () => {} }), activeQueuedFiles: async () => owned, indexFile: idx,
    });
    assert.equal(await second.resumeAll(), 1);
    await until(() => second.snapshot().some(s => !s.active));
    assert.deepEqual(verified.map(f => path.basename(f)).sort(), [cr3(2), cr3(3)], 'the file the interrupted batch owns is not processed twice');
    const st = second.snapshot()[0];
    assert.equal(st.state, 'complete');
    assert.equal(st.handedOff, 1);
    assert.ok(!(await exists(path.join(second.recordDir(ev), `${r.txId}.json`))));
    const index = JSON.parse(await fsp.readFile(idx, 'utf8'));
    assert.deepEqual(index.entries, [], 'index cleared');
    const tree = (await fsp.readdir(path.join(ev, '01-Majlis', PH))).filter(n => n.endsWith('.CR3'));
    assert.equal(tree.length, 3, 'no duplicate moves on resume');
  });

  await t('crash after the move but before the journal finished: recovery completes it and queues metadata exactly once', async () => {
    const ev = await makeEvent('M6', 3);
    const { meta, log, batch } = metadataHarness({ indexFile: path.join(root, 'userData', 'idx-m6.json') });
    let crash = true;
    const real = fs.realpathSync(ev);
    const crashingMeta = { ...meta, record: async (...a) => { if (crash) { crash = false; throw Object.assign(new Error('power loss'), { code: 'CRASH' }); } return meta.record(...a); } };
    // Simulate the crash: the engine treats a record failure as "not queued" and still finishes;
    // so model the real crash point instead — journal left in phase "metadata".
    const { svc } = service(crashingMeta);
    const r = await svc.run(ev, { selection: sel(ev, [1, 2], '01-Majlis') });
    assert.equal(r.ok, true);
    assert.equal(r.metadata.state, 'not-queued', 'a record that cannot be written is reported, the move is kept');
    // Real crash point: re-open the finished journal as unfinished at phase metadata.
    const done = JSON.parse(await fsp.readFile(path.join(journal.journalDir(real), 'done', `${r.txId}.json`), 'utf8'));
    await journal.write(real, { ...done, phase: 'metadata' });
    await svc.plan(ev, []);   // recovery under the sort's guards
    assert.equal((await journal.listPending(real)).journals.length, 0, 'recovered and finished');
    await until(() => log.verified.length === 2);
    assert.equal(log.verified.length, 2, 'metadata queued once by recovery');
    batch.resolve({ done: 2, failed: 0 });
    await until(() => meta.snapshot().every(s => !s.active));
    assert.equal((await fsp.readdir(path.join(ev, '01-Majlis', PH))).filter(n => n.endsWith('.CR3')).length, 2, 'no duplicate files');
  });

  await t('a folder locked elsewhere (or by an interrupted run) is waited for and retried — never cleared, never skipped', async () => {
    const ev = await makeEvent('L1', 2);
    let free = false;
    const verified = [];
    const meta = createDumpSortMetadata({
      verify: async (real, files) => { verified.push(...files); return { checked: files.length, complete: files.length, failed: 0, verificationRequired: 0, queued: 0, batchDone: Promise.resolve(null) }; },
      holdLocks: async () => (free ? { ok: true, release: async () => {} } : { ok: false, lockedBy: os.hostname(), self: true, lockPath: '/x/.autoingest/locks/a.json' }),
      activeQueuedFiles: async () => new Set(), indexFile: path.join(root, 'userData', 'idx-l1.json'), retryMs: 40,
    });
    const real = fs.realpathSync(ev);
    await meta.record(real, 'ds-l1-tx', ['01-Majlis/x.CR3']);
    await put(path.join(real, '01-Majlis', 'x.CR3'), 'x');
    const r = await meta.start(real, 'ds-l1-tx');
    assert.equal(r.started, false);
    assert.equal(meta.snapshot()[0].state, 'waiting');
    assert.equal(meta.snapshot()[0].lock.self, true);
    assert.match(meta.snapshot()[0].message, /interrupted AutoIngest run on this computer/);
    assert.match(await meta.busyFor(real), /not been verified yet/, 'rename still refused while waiting');
    await new Promise(res => setTimeout(res, 120));
    assert.equal(verified.length, 0, 'nothing verified while locked');
    free = true;
    assert.ok(await until(() => meta.snapshot().some(s => s.state === 'complete')), 'retried and completed once the folder was free');
    assert.equal(verified.length, 1);
  });

  await t('busyFor: refuses a rename while a sort journal is unfinished; null for an unrelated event', async () => {
    const ev = await makeEvent('B1', 2);
    const other = await makeEvent('B2', 1);
    const { meta } = metadataHarness({ indexFile: path.join(root, 'userData', 'idx-b.json') });
    const { svc } = service(meta);
    await journal.write(fs.realpathSync(ev), { txId: journal.newTxId(), phase: 'placing', assets: [] });
    assert.match(await svc.busyFor(ev), /has not finished/);
    assert.equal(await svc.busyFor(other), null);
    assert.equal(await svc.busyFor(path.join(root, 'nope')), null);
  });

  console.log(`eqi31SortDumpSafety: ${passed} passed`);
  await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
})();
