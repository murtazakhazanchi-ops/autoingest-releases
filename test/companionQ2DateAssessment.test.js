'use strict';

// AI-FEAT-061 Q2 — smart date-based card assessment: capture-date evidence, date
// classification, RAW/JPEG pairs, the cross-midnight range, the background assessor
// (dedup, cancellation, reconnection, volume swap, pausing, bounded reads) and the
// workspace handoff's fail-closed request/reply. Pure Node; no Electron, no card.
//
// Run: node test/companionQ2DateAssessment.test.js

// A fixed zone with a non-zero offset (+05:30) makes the video UTC-vs-local cases real.
process.env.TZ = 'Asia/Kolkata';

const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { captureEvidence, parseCaptureValue } = require('../services/captureDateEvidence');
const {
  resolvePairs, summarize, filesForSelection, normalizeSelection, classify, addDays, AFTER_MIDNIGHT_OPTIONS,
} = require('../services/dateAssessmentModel');
const { createCardAssessor } = require('../services/cardAssessmentService');
const { createWorkspaceHandoff } = require('../services/workspaceHandoff');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}

const TODAY = '2026-10-31';
const exif = (rawValue) => ({ rawValue }); // exiftool-vendored ExifDateTime shape
const rec = (p, type, evidence) => ({ path: p, name: p.split('/').pop(), type, size: 100000, evidence });
const dated = (date, time = '10:00:00', confidence = 'high') => ({ status: 'dated', date, time, offset: null, source: 'DateTimeOriginal', confidence, reason: null, candidates: null });
const unsure = (reason = 'no-capture-metadata') => ({ status: 'uncertain', date: null, time: null, offset: null, source: null, confidence: null, reason, candidates: null });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  // ── Capture-date evidence ────────────────────────────────────────────────────
  await t('photo: SubSecDateTimeOriginal with offset → dated, wall clock kept exactly as written', () => {
    const e = captureEvidence({ SubSecDateTimeOriginal: exif('2026:10:31 23:30:00.42-07:00'), DateTimeOriginal: exif('2026:10:31 23:30:00'), CreateDate: exif('2026:10:31 23:30:00') }, 'photo');
    assert.equal(e.status, 'dated');
    assert.equal(e.date, '2026-10-31', 'never converted to this computer\'s zone (+05:30 would make it 1 Nov)');
    assert.equal(e.time, '23:30:00');
    assert.equal(e.offset, '-07:00');
    assert.equal(e.confidence, 'high');
    assert.equal(e.source, 'SubSecDateTimeOriginal');
  });

  await t('photo: naive DateTimeOriginal → dated as the camera wrote it; OffsetTimeOriginal reported only', () => {
    const e = captureEvidence({ DateTimeOriginal: exif('2026:10:30 00:05:00'), OffsetTimeOriginal: '+09:00' }, 'raw');
    assert.deepEqual([e.status, e.date, e.time, e.offset, e.confidence], ['dated', '2026-10-30', '00:05:00', '+09:00', 'high']);
  });

  await t('photo: EXIF CreateDate only → dated with medium confidence', () => {
    const e = captureEvidence({ CreateDate: exif('2026:10:29 12:00:00') }, 'photo');
    assert.deepEqual([e.status, e.date, e.source, e.confidence], ['dated', '2026-10-29', 'CreateDate', 'medium']);
  });

  await t('missing capture metadata → uncertain; filesystem dates are never evidence', () => {
    const e = captureEvidence({ FileModifyDate: exif('2026:10:31 10:00:00+05:30'), FileCreateDate: exif('2026:10:31 10:00:00+05:30') }, 'photo');
    assert.deepEqual([e.status, e.reason, e.date], ['uncertain', 'no-capture-metadata', null]);
  });

  await t('zeroed / impossible dates → uncertain (invalid-date), never a guess', () => {
    assert.equal(captureEvidence({ DateTimeOriginal: '0000:00:00 00:00:00' }, 'photo').reason, 'invalid-date');
    assert.equal(captureEvidence({ DateTimeOriginal: '2026:02:31 10:00:00' }, 'photo').reason, 'invalid-date');
    assert.equal(parseCaptureValue('1904:01:01 00:00:00').invalid, true);
  });

  await t('contradictory DateTimeOriginal vs CreateDate (different days) → uncertain conflicting-tags', () => {
    const e = captureEvidence({ DateTimeOriginal: exif('2026:10:31 10:00:00'), CreateDate: exif('2026:10:20 10:00:00') }, 'photo');
    assert.equal(e.status, 'uncertain');
    assert.equal(e.reason, 'conflicting-tags');
    assert.deepEqual(e.candidates.map(c => c.date), ['2026-10-31', '2026-10-20']);
  });

  await t('wrong camera clock (reset to 2000-01-01) → dated as written, never shifted', () => {
    const e = captureEvidence({ DateTimeOriginal: exif('2000:01:01 00:12:00') }, 'photo');
    assert.deepEqual([e.status, e.date], ['dated', '2000-01-01']);
  });

  await t('unreadable file → uncertain read-error', () => {
    assert.equal(captureEvidence(null, 'photo').reason, 'read-error');
  });

  await t('video: offset-bearing CreationDate → dated high, as the camera wrote it', () => {
    const e = captureEvidence({ CreationDate: exif('2026:10:31 02:00:00+05:30'), CreateDate: exif('2026:10:30 20:30:00') }, 'video');
    assert.deepEqual([e.status, e.date, e.time, e.confidence, e.source], ['dated', '2026-10-31', '02:00:00', 'high', 'CreationDate']);
  });

  await t('video: QuickTime CreateDate giving the same day as written and as UTC → dated, LOW confidence', () => {
    const e = captureEvidence({ CreateDate: exif('2026:10:31 08:00:00') }, 'video'); // 13:30 local if UTC
    assert.deepEqual([e.status, e.date, e.confidence, e.note], ['dated', '2026-10-31', 'low', 'video-timezone-unknown']);
  });

  await t('video: QuickTime CreateDate whose day depends on the time zone → uncertain, both readings kept', () => {
    const e = captureEvidence({ CreateDate: exif('2026:10:30 20:30:00') }, 'video'); // 02:00 next day if UTC
    assert.equal(e.status, 'uncertain');
    assert.equal(e.reason, 'video-timezone-ambiguous');
    assert.deepEqual(e.candidates.map(c => c.date), ['2026-10-30', '2026-10-31']);
  });

  await t('video: no creation metadata → uncertain', () => {
    assert.equal(captureEvidence({ FileType: 'MP4' }, 'video').reason, 'no-capture-metadata');
    assert.equal(captureEvidence({ CreateDate: '0000:00:00 00:00:00' }, 'video').reason, 'invalid-date');
  });

  // ── Classification ─────────────────────────────────────────────────────────────
  const card = resolvePairs([
    rec('/C/DCIM/100/T1.JPG', 'photo', dated(TODAY)),
    rec('/C/DCIM/100/T2.JPG', 'photo', dated(TODAY, '23:59:59')),
    rec('/C/DCIM/100/T3.MP4', 'video', dated(TODAY, '08:00:00', 'low')),
    rec('/C/DCIM/100/E1.JPG', 'photo', dated('2026-10-30')),
    rec('/C/DCIM/100/E2.JPG', 'photo', dated('2026-10-28')),
    rec('/C/DCIM/100/E3.JPG', 'photo', dated('2026-10-28')),
    rec('/C/DCIM/100/F1.JPG', 'photo', dated('2026-11-02')),
    rec('/C/DCIM/100/U1.JPG', 'photo', unsure()),
    rec('/C/DCIM/100/U2.MP4', 'video', unsure('video-timezone-ambiguous')),
  ]);

  await t('today / earlier / later / uncertain totals are exact and add up', () => {
    const s = summarize(card, { today: TODAY });
    assert.deepEqual(s.selection, { date: TODAY, untilTime: null }, 'defaults to today');
    assert.deepEqual(s.counts, { selected: 3, earlier: 3, later: 1, uncertain: 2, total: 9 });
    assert.equal(s.counts.selected + s.counts.earlier + s.counts.later + s.counts.uncertain, s.counts.total);
    assert.deepEqual(s.selectedBreakdown, { photo: 2, raw: 0, video: 1, pairs: 0, lowConfidence: 1 });
    assert.equal(s.earlierDateCount, 2);
    assert.equal(s.laterDateCount, 1);
    assert.equal(s.afterTodayCount, 1, 'future-dated files are flagged (camera clock ahead)');
    assert.deepEqual(s.uncertainReasons, { 'no-capture-metadata': 1, 'video-timezone-ambiguous': 1 });
    assert.equal(s.suggestion, null);
  });

  await t('date selector lists every date present plus today, newest first, with relations', () => {
    const s = summarize(card, { today: TODAY });
    assert.deepEqual(s.options.map(o => [o.date, o.count, o.relation]), [
      ['2026-11-02', 1, 'later'], [TODAY, 3, 'today'], ['2026-10-30', 1, 'earlier'], ['2026-10-28', 2, 'earlier'],
    ]);
  });

  await t('choosing another date moves the counts; uncertain files stay separate', () => {
    const s = summarize(card, { today: TODAY, selection: { date: '2026-10-28' } });
    assert.deepEqual(s.counts, { selected: 2, earlier: 0, later: 5, uncertain: 2, total: 9 });
    assert.deepEqual(filesForSelection(card, s.selection), ['/C/DCIM/100/E2.JPG', '/C/DCIM/100/E3.JPG']);
  });

  await t('selected-date file set is exact (main-only paths)', () => {
    assert.deepEqual(filesForSelection(card, normalizeSelection(null, TODAY)), ['/C/DCIM/100/T1.JPG', '/C/DCIM/100/T2.JPG', '/C/DCIM/100/T3.MP4']);
  });

  await t('wrong camera clock: nothing from today → suggests the dominant date, dates unchanged', () => {
    const off = resolvePairs([1, 2, 3].map(i => rec(`/C/DCIM/X${i}.JPG`, 'photo', dated('2000-01-01'))).concat([rec('/C/DCIM/Y.JPG', 'photo', dated('2026-10-20'))]));
    const s = summarize(off, { today: TODAY });
    assert.equal(s.counts.selected, 0);
    assert.deepEqual(s.suggestion, { date: '2000-01-01', count: 3 });
    assert.equal(summarize(off, { today: TODAY, selection: { date: '2000-01-01' } }).suggestion, null, 'no suggestion once chosen');
  });

  await t('normalizeSelection rejects malformed input (falls back to today, no range)', () => {
    assert.deepEqual(normalizeSelection({ date: '31/10/2026', untilTime: '07:00' }, TODAY), { date: TODAY, untilTime: null });
    assert.deepEqual(normalizeSelection({ date: '2026-10-30', untilTime: '02:00' }, TODAY), { date: '2026-10-30', untilTime: '02:00' });
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  });

  // ── Cross-midnight range (DEC-029 decision 4, test row 28) ────────────────────
  await t('calendar date by default: after-midnight files fall under the next date', () => {
    const night = resolvePairs([
      rec('/C/N1.JPG', 'photo', dated('2026-10-30', '22:00:00')),
      rec('/C/N2.JPG', 'photo', dated('2026-10-31', '00:40:00')),
      rec('/C/N3.JPG', 'photo', dated('2026-10-31', '03:10:00')),
      rec('/C/N4.JPG', 'photo', unsure()),
    ]);
    const plain = summarize(night, { today: TODAY, selection: { date: '2026-10-30' } });
    assert.deepEqual(plain.counts, { selected: 1, earlier: 0, later: 2, uncertain: 1, total: 4 });
    const range = summarize(night, { today: TODAY, selection: { date: '2026-10-30', untilTime: '02:00' } });
    assert.deepEqual(range.counts, { selected: 2, earlier: 0, later: 1, uncertain: 1, total: 4 }, 'range includes 00:40, not 03:10; uncertain stays separate');
    assert.deepEqual(filesForSelection(night, range.selection), ['/C/N1.JPG', '/C/N2.JPG']);
    assert.equal(classify(dated('2026-10-31', '02:00:00'), range.selection), 'later', 'end time is exclusive');
    assert.deepEqual([...AFTER_MIDNIGHT_OPTIONS], ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00']);
  });

  // ── RAW/JPEG pairs ─────────────────────────────────────────────────────────────
  await t('RAW+JPEG pair: both files counted individually, linked as one pair', () => {
    const r = resolvePairs([
      rec('/C/DCIM/100/IMG_0001.JPG', 'photo', dated(TODAY, '10:00:00')),
      rec('/C/DCIM/100/IMG_0001.CR2', 'raw', dated(TODAY, '10:00:01')),
      rec('/C/DCIM/101/IMG_0001.CR2', 'raw', dated(TODAY, '11:00:00')), // other folder: not the same shot
    ]);
    const s = summarize(r, { today: TODAY });
    assert.deepEqual([s.counts.selected, s.selectedBreakdown.photo, s.selectedBreakdown.raw, s.selectedBreakdown.pairs], [3, 1, 2, 1]);
    assert.equal(r[0].pairKey, r[1].pairKey);
    assert.equal(r[2].pairKey, null);
  });

  await t('pair member without a date takes the pair\'s best-evidenced date', () => {
    const r = resolvePairs([rec('/C/A/IMG_2.JPG', 'photo', dated(TODAY)), rec('/C/A/IMG_2.ARW', 'raw', unsure())]);
    assert.equal(r[1].evidence.status, 'dated');
    assert.equal(r[1].evidence.date, TODAY);
    assert.equal(r[1].evidence.inheritedFromPair, true);
  });

  await t('pair members that disagree (date, or > 60 s apart) → whole pair uncertain', () => {
    const days = resolvePairs([rec('/C/A/IMG_3.JPG', 'photo', dated(TODAY)), rec('/C/A/IMG_3.NEF', 'raw', dated('2026-10-01'))]);
    assert.deepEqual(days.map(x => x.evidence.reason), ['pair-inconsistent', 'pair-inconsistent']);
    const mins = resolvePairs([rec('/C/A/IMG_4.JPG', 'photo', dated(TODAY, '10:00:00')), rec('/C/A/IMG_4.NEF', 'raw', dated(TODAY, '10:05:00'))]);
    assert.equal(summarize(mins, { today: TODAY }).counts.uncertain, 2);
  });

  // ── Background assessor ────────────────────────────────────────────────────────
  function fakeCard({ files, tags, identity = { dev: 7, ino: 2 } }) {
    const calls = { list: 0, reads: 0, maxInFlight: 0, inFlight: 0 };
    const state = { identity, block: null };
    const deps = {
      listMedia: async () => { calls.list++; return files.map(f => ({ ...f })); },
      readTags: async (p) => {
        calls.reads++; calls.inFlight++; calls.maxInFlight = Math.max(calls.maxInFlight, calls.inFlight);
        try {
          if (state.block) await state.block;
          await sleep(2);
          const v = tags[p];
          if (v instanceof Error) throw v;
          return v;
        } finally { calls.inFlight--; }
      },
      statMount: async () => state.identity,
    };
    return { deps, calls, state };
  }
  const waitFor = async (fn, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return; await sleep(10); } throw new Error('timeout'); };
  const FILES = Array.from({ length: 20 }, (_, i) => ({ path: `/V/DCIM/F${i}.JPG`, name: `F${i}.JPG`, type: 'photo', size: 1 }));
  const TAGS = Object.fromEntries(FILES.map((f, i) => [f.path, { DateTimeOriginal: exif(i < 12 ? '2026:10:31 10:00:00' : '2026:10:29 10:00:00') }]));
  const cardA = { sourceId: 'src-1', mountpoint: '/V', label: 'EOS_DIGITAL' };

  await t('assessor: classifies a card; repeated polls never rescan it; reads stay bounded', async () => {
    const { deps, calls } = fakeCard({ files: FILES, tags: TAGS });
    const a = createCardAssessor({ ...deps, concurrency: 3 });
    a.sync([cardA]); a.sync([cardA]); a.sync([cardA]);
    await waitFor(() => a.get('src-1')?.state === 'complete');
    for (let i = 0; i < 5; i++) a.sync([cardA]);
    await sleep(30);
    assert.equal(calls.list, 1, 'one scan per attachment');
    assert.equal(calls.reads, 20);
    assert.ok(calls.maxInFlight <= 3, `in flight ${calls.maxInFlight}`);
    assert.equal(summarize(a.get('src-1').records, { today: TODAY }).counts.selected, 12);
    a.shutdown();
  });

  await t('assessor: card removed during assessment → cancelled, result dropped, no further reads', async () => {
    const { deps, calls, state } = fakeCard({ files: FILES, tags: TAGS });
    let release; state.block = new Promise(r => { release = r; });
    const a = createCardAssessor({ ...deps, concurrency: 2 });
    a.sync([cardA]);
    await waitFor(() => a.get('src-1')?.state === 'reading');
    a.sync([]); // removal seen by the next poll
    assert.equal(a.get('src-1'), null);
    const readsAtCancel = calls.reads;
    release();
    await sleep(60);
    assert.ok(calls.reads <= readsAtCancel + 2, `kept reading after cancel (${readsAtCancel} → ${calls.reads})`);
    assert.equal(a.getDiagnostics().running, null);
    a.shutdown();
  });

  await t('assessor: reconnection (new attachment) is assessed afresh; no stale result shown', async () => {
    const { deps, calls } = fakeCard({ files: FILES, tags: TAGS });
    const a = createCardAssessor({ ...deps });
    a.sync([cardA]);
    await waitFor(() => a.get('src-1')?.state === 'complete');
    a.sync([]);
    a.sync([{ ...cardA, sourceId: 'src-2' }]);
    assert.equal(a.get('src-1'), null);
    assert.notEqual(a.get('src-2').state, 'complete', 'the new attachment starts from nothing');
    await waitFor(() => a.get('src-2')?.state === 'complete');
    assert.equal(calls.list, 2);
    a.shutdown();
  });

  await t('assessor: a different volume at the same mountpoint is never served the old result', async () => {
    const { deps, calls, state } = fakeCard({ files: FILES, tags: TAGS });
    const a = createCardAssessor({ ...deps });
    a.sync([cardA]);
    await waitFor(() => a.get('src-1')?.state === 'complete');
    state.identity = { dev: 9, ino: 2 }; // swapped between two polls
    assert.equal(await a.verify('src-1'), null, 'handoff refuses the stale result');
    a.revalidate();
    await waitFor(() => calls.list === 2 && a.get('src-1')?.state === 'complete');
    assert.ok(await a.verify('src-1'));
    a.shutdown();
  });

  await t('assessor: removal during the final listing → error, never a partial result', async () => {
    const { deps, state } = fakeCard({ files: FILES, tags: TAGS });
    const a = createCardAssessor({ ...deps, readTags: async (p) => { state.identity = null; return TAGS[p]; } });
    a.sync([cardA]);
    await waitFor(() => ['complete', 'error'].includes(a.get('src-1')?.state));
    assert.equal(a.get('src-1').state, 'error');
    assert.equal(a.get('src-1').records, null);
    a.shutdown();
  });

  await t('assessor: multiple cards are assessed one at a time, each with its own result', async () => {
    const other = FILES.slice(0, 5).map(f => ({ ...f, path: f.path.replace('/V/', '/W/') }));
    const tags = { ...TAGS, ...Object.fromEntries(other.map(f => [f.path, { DateTimeOriginal: exif('2026:10:30 09:00:00') }])) };
    let running = 0, maxRunning = 0;
    const a = createCardAssessor({
      listMedia: async (mp) => { running++; maxRunning = Math.max(maxRunning, running); await sleep(5); return mp === '/V' ? FILES : other; },
      readTags: async (p) => tags[p],
      statMount: async () => ({ dev: 1, ino: 1 }),
      onChange: () => {},
    });
    const origGet = a.get;
    a.sync([cardA, { sourceId: 'src-3', mountpoint: '/W', label: 'EOS_DIGITAL' }]);
    await waitFor(() => origGet('src-1')?.state === 'complete' && origGet('src-3')?.state === 'complete');
    assert.equal(summarize(origGet('src-3').records, { today: TODAY, selection: { date: '2026-10-30' } }).counts.selected, 5);
    assert.equal(summarize(origGet('src-1').records, { today: TODAY }).counts.selected, 12);
    a.shutdown();
    assert.ok(maxRunning >= 1);
  });

  await t('assessor: pauses while an import runs, then resumes', async () => {
    const { deps } = fakeCard({ files: FILES, tags: TAGS });
    let busy = true;
    const a = createCardAssessor({ ...deps, isPaused: () => busy });
    a.sync([cardA]);
    await waitFor(() => a.get('src-1')?.state === 'paused');
    assert.equal(a.get('src-1').done, 0);
    busy = false;
    await waitFor(() => a.get('src-1')?.state === 'complete', 5000);
    a.shutdown();
  });

  await t('assessor: a read that keeps failing is counted as uncertain (read-error), not dropped', async () => {
    const tags = { ...TAGS, [FILES[0].path]: new Error('pool ended') };
    const { deps } = fakeCard({ files: FILES, tags });
    const a = createCardAssessor({ ...deps });
    a.sync([cardA]);
    await waitFor(() => a.get('src-1')?.state === 'complete', 5000);
    const s = summarize(a.get('src-1').records, { today: TODAY });
    assert.equal(s.counts.total, 20);
    assert.deepEqual(s.uncertainReasons, { 'read-error': 1 });
    a.shutdown();
  });

  // ── Workspace handoff (fail-closed request/reply) ──────────────────────────────
  function fakeWorld() {
    const ipcMain = new EventEmitter();
    const wc = Object.assign(new EventEmitter(), { id: 11, sent: [], isDestroyed: () => false, send(ch, msg) { this.sent.push([ch, msg]); } });
    const win = { isDestroyed: () => false, webContents: wc };
    return { ipcMain, wc, win };
  }

  await t('handoff: refused while busy — the main window is not even focused', async () => {
    const { ipcMain, win } = fakeWorld();
    let opened = 0;
    const h = createWorkspaceHandoff({ ipcMain, getMainWindow: () => win, openApp: () => opened++, isBusy: () => true });
    h.register();
    assert.deepEqual(await h.openSource({ mountpoint: '/V', label: 'X' }), { ok: false, reason: 'busy', selected: 0 });
    assert.equal(opened, 0);
  });

  await t('handoff: waits for the workspace to be ready, sends one request, returns its answer', async () => {
    const { ipcMain, wc, win } = fakeWorld();
    const h = createWorkspaceHandoff({ ipcMain, getMainWindow: () => win, openApp: () => {}, isBusy: () => false });
    h.register();
    const p = h.openSource({ mountpoint: '/V', label: 'EOS', selectPaths: ['/V/a.JPG'] });
    await sleep(150);
    assert.equal(wc.sent.length, 0, 'nothing sent before the renderer announced ready');
    ipcMain.emit('companion:workspaceReady', { sender: wc });
    await waitFor(() => wc.sent.length === 1);
    const [ch, msg] = wc.sent[0];
    assert.equal(ch, 'companion:openSource');
    assert.deepEqual({ ...msg, requestId: 0 }, { requestId: 0, type: 'memory-card', path: '/V', label: 'EOS', selectPaths: ['/V/a.JPG'] });
    ipcMain.emit('companion:openSourceResult', { sender: { id: 99 } }, { requestId: msg.requestId, result: { ok: true, selected: 1 } }); // wrong sender ignored
    ipcMain.emit('companion:openSourceResult', { sender: wc }, { requestId: msg.requestId, result: { ok: true, selected: 1 } });
    assert.deepEqual(await p, { ok: true, reason: null, selected: 1 });
  });

  await t('handoff: no answer → timeout; a reload forgets readiness; one handoff at a time', async () => {
    const { ipcMain, wc, win } = fakeWorld();
    const h = createWorkspaceHandoff({ ipcMain, getMainWindow: () => win, openApp: () => {}, isBusy: () => false, resultTimeoutMs: 80, readyTimeoutMs: 200 });
    h.register();
    ipcMain.emit('companion:workspaceReady', { sender: wc });
    const first = h.openSource({ mountpoint: '/V', label: 'A' });
    assert.equal((await h.openSource({ mountpoint: '/V', label: 'A' })).reason, 'handoff-in-progress');
    assert.equal((await first).reason, 'timeout');
    wc.emit('did-start-loading');
    assert.equal((await h.openSource({ mountpoint: '/V', label: 'A' })).reason, 'workspace-unavailable');
    h.unregister();
  });

  console.log(`${passed} passed`);
})();
