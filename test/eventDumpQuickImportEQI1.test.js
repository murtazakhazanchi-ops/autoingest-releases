'use strict';

// AI-FEAT-064 EQI-1 — Event Dump Quick Import: the no-sequencing guards, Dump attribution, Dump
// routing, the import backstop, the companion controller and the generalized workspace handoff.
// Pure Node; temp folders only; no Electron, no card, no archive.
// Run: node test/eventDumpQuickImportEQI1.test.js

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const seq = require('../services/photographerSequenceService');
const evidence = require('../services/eventEvidenceReconstruction');
const ImportRouter = require('../renderer/importRouter.js');
const { dumpJobsRefusal, partitionAlreadyInDump } = require('../services/eventDumpPaths');
const { createEventDumpController } = require('../services/eventDumpCompanion');
const { createWorkspaceHandoff } = require('../services/workspaceHandoff');
const { classify, normalizeSelection } = require('../services/dateAssessmentModel');

let passed = 0;
async function t(name, fn) {
  try { await fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err); process.exitCode = 1; }
}
const mkdirs = async (root, rels) => { for (const r of rels) await fsp.mkdir(path.join(root, r), { recursive: true }); };

(async () => {
  console.log('eventDumpQuickImportEQI1');
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-eqi1-'));

  // ── No-sequencing guards ───────────────────────────────────────────────────
  await t('isEventDumpName: "Dump" in any case and a wrongly PC-prefixed "PC01-Dump" — never look-alikes', () => {
    for (const n of ['Dump', 'dump', 'DUMP', 'PC01-Dump']) assert.equal(seq.isEventDumpName(n), true, n);
    for (const n of ['Dumpster', 'Dump Truck', 'Ali Dump', '', null]) assert.equal(seq.isEventDumpName(n), false, String(n));
    assert.equal(seq.isDumpScopeKey('Dump'), true);
    assert.equal(seq.isDumpScopeKey('Comp/Dump/Ali'), true);
    assert.equal(seq.isDumpScopeKey('__eventRoot__'), false);
  });

  await t('scanPhotographerFolders (single component): Dump is neither a photographer nor a scope; its folders are never offered', async () => {
    const ev = path.join(tmp, 'single');
    await mkdirs(ev, ['Ali Bhai', 'Dump/Ali Bhai', 'Dump/Husain Bhai', '01Q/Zahra']);
    const scopes = await seq.scanPhotographerFolders(ev, [{ folderName: 'Waaz-Hall A' }]);
    const names = scopes.flatMap(s => s.photographers.map(p => p.folderName));
    assert.deepEqual(names.sort(), ['Ali Bhai', 'Zahra']);
    assert.ok(!scopes.some(s => seq.isDumpScopeKey(s.scopeKey)), 'no Dump scope');
  });

  await t('scanPhotographerFolders (multi component): an event-root Dump is never a component, photographer or scope', async () => {
    const ev = path.join(tmp, 'multi');
    await mkdirs(ev, ['Waaz-Hall A/Ali Bhai', 'Majlis-Hall B/Husain Bhai', 'Dump/Ali Bhai']);
    const scopes = await seq.scanPhotographerFolders(ev, [{ folderName: 'Waaz-Hall A' }, { folderName: 'Majlis-Hall B' }]);
    assert.deepEqual(scopes.map(s => s.scopeKey).sort(), ['Majlis-Hall B', 'Waaz-Hall A']);
    assert.ok(!JSON.stringify(scopes).includes('Dump'));
  });

  await t('a Dump folder inside a QMZ container is never a photographer either', async () => {
    const ev = path.join(tmp, 'qmz');
    await mkdirs(ev, ['_Unsequenced/Dump', '_Unsequenced/Ali Bhai']);
    const scopes = await seq.scanPhotographerFolders(ev, []);
    const unseq = scopes.find(s => s.scopeKey === '_Unsequenced');
    assert.deepEqual(unseq.photographers.map(p => p.folderName), ['Ali Bhai']);
  });

  await t('planRenames / applyRenames refuse any scope inside Dump and rename nothing', async () => {
    const ev = path.join(tmp, 'refuse');
    await mkdirs(ev, ['Dump/Ali Bhai']);
    const req = [{ scopeKey: 'Dump', ordered: [{ canonical: 'Ali Bhai', sequence: 1, folderName: 'PC01-Ali Bhai' }] }];
    const plan = await seq.planRenames(ev, req);
    assert.equal(plan.ok, false); assert.match(plan.error, /dump-not-sequenceable/);
    const applied = await seq.applyRenames(ev, req);
    assert.equal(applied.ok, false); assert.match(applied.error, /dump-not-sequenceable/);
    assert.ok(fs.existsSync(path.join(ev, 'Dump', 'Ali Bhai')) && !fs.existsSync(path.join(ev, 'Dump', 'PC01-Ali Bhai')), 'folder untouched');
  });

  await t('event-root renames never rename the Dump folder itself (backstop)', async () => {
    const ev = path.join(tmp, 'rootdump');
    await mkdirs(ev, ['Dump', 'Ali Bhai']);
    const req = [{ scopeKey: seq.EVENT_ROOT_KEY, ordered: [{ canonical: 'Dump', sequence: 1, folderName: 'PC01-Dump' }, { canonical: 'Ali Bhai', sequence: 2, folderName: 'PC02-Ali Bhai' }] }];
    const plan = await seq.planRenames(ev, req);
    assert.deepEqual(plan.renames.map(r => r.from), ['Ali Bhai']);
    await seq.applyRenames(ev, req);
    assert.ok(fs.existsSync(path.join(ev, 'Dump')) && !fs.existsSync(path.join(ev, 'PC01-Dump')));
  });

  await t('resolveScopeBaseDir and writeSequencesToEventJson refuse Dump; event.json is not rewritten', async () => {
    const ev = path.join(tmp, 'seqjson');
    await mkdirs(ev, ['Dump/Ali Bhai']);
    const doc = JSON.stringify({ version: 1, components: [] });
    await fsp.writeFile(path.join(ev, 'event.json'), doc);
    assert.equal(seq.resolveScopeBaseDir(ev, 'Dump').ok, false);
    const r = await seq.writeSequencesToEventJson(ev, { Dump: { 'Ali Bhai': { sequence: 1, folderName: 'PC01-Ali Bhai' } } });
    assert.equal(r.ok, false); assert.match(r.error, /dump-not-sequenceable/);
    assert.equal(await fsp.readFile(path.join(ev, 'event.json'), 'utf8'), doc);
  });

  // ── Attribution ───────────────────────────────────────────────────────────
  const EV = path.join(tmp, 'Coll', 'Ev');
  const multi = { components: [{ folderName: 'Waaz-Hall A', eventTypes: [{ label: 'Waaz' }] }, { folderName: 'Majlis-Hall B', eventTypes: [{ label: 'Majlis' }] }], imports: [{ photographer: 'Someone Else' }] };
  const single = { components: [{ folderName: 'Waaz-Hall A', eventTypes: [{ label: 'Waaz' }] }], imports: [{ photographer: 'Someone Else' }] };

  await t('Dump/<Name>/file resolves the photographer to <Name> — never "Dump", never the last import\'s photographer', () => {
    assert.deepEqual(evidence.resolvePhotographerFromPath(path.join(EV, 'Dump', 'Ali Bhai', 'a.cr2'), EV, 'X'), { photographer: 'Ali Bhai', unresolved: false });
    assert.deepEqual(evidence.resolvePhotographerFromPath(path.join(EV, 'Dump', 'Ali Bhai', 'VIDEO', 'v.mp4'), EV, 'X'), { photographer: 'Ali Bhai', unresolved: false });
    assert.deepEqual(evidence.resolvePhotographerFromPath(path.join(EV, 'Dump', 'loose.jpg'), EV, 'X'), { photographer: '', unresolved: true });
    for (const ej of [single, multi]) {
      const e = evidence.buildFileEvidence(EV, ej, path.join(EV, 'Dump', 'Ali Bhai', 'a.cr2'));
      assert.equal(e.photographer, 'Ali Bhai');
    }
  });

  await t('multi-component Dump file: the explicit no-component group the import wrote (not ambiguous); single: the root group', () => {
    const m = evidence.buildFileEvidence(EV, multi, path.join(EV, 'Dump', 'Ali Bhai', 'a.cr2'));
    assert.deepEqual(m.groups.map(g => ({ subEventId: g.subEventId, metadataTags: g.metadataTags })), [{ subEventId: null, metadataTags: [] }]);
    const s = evidence.buildFileEvidence(EV, single, path.join(EV, 'Dump', 'Ali Bhai', 'a.cr2'));
    assert.deepEqual(s.groups.map(g => g.id), ['root']);
    const ctx = evidence.buildEventEvidenceContext(EV, multi, [{ dest: path.join(EV, 'Dump', 'Ali Bhai', 'a.cr2') }]);
    assert.equal(ctx.files[0].photographer, 'Ali Bhai');
    assert.deepEqual(ctx.context.groups.map(g => ({ subEventId: g.subEventId, metadataTags: g.metadataTags })), [{ subEventId: null, metadataTags: [] }]);
    // A genuinely unplaced multi-component file (not Dump) is still ambiguous — unchanged.
    assert.deepEqual(evidence.buildFileEvidence(EV, multi, path.join(EV, 'Loose', 'x.jpg')).groups, []);
  });

  // ── Routing + backstop ────────────────────────────────────────────────────
  const eventData = { eventPath: EV, coll: { name: 'Coll', _masterPath: '/stale/master' }, event: { name: 'Ev', components: multi.components, photographerSequences: { __eventRoot__: { 'Ali Bhai': { folderName: 'PC01-Ali Bhai' } } } } };

  await t('buildDumpFileJobs: <eventPath>/Dump/<photographer>/[VIDEO/]file — no PC prefix even when sequences exist; never the stale master path', () => {
    const { fileJobs } = ImportRouter.buildDumpFileJobs({ eventData, photographer: 'Ali Bhai', files: ['/card/DCIM/a.CR2', '/card/DCIM/a.JPG', '/card/DCIM/c.MP4'] });
    assert.deepEqual(fileJobs.map(j => j.dest), [`${EV}/Dump/Ali Bhai/a.CR2`, `${EV}/Dump/Ali Bhai/a.JPG`, `${EV}/Dump/Ali Bhai/VIDEO/c.MP4`]);
    const again = ImportRouter.buildDumpFileJobs({ eventData, photographer: 'Ali Bhai', files: ['/card2/x.CR2'] });
    assert.equal(path.dirname(again.fileJobs[0].dest), path.dirname(fileJobs[0].dest), 'a later Dump import reuses the same folder');
    assert.deepEqual(ImportRouter.buildDumpFileJobs({ eventData, photographer: '  ', files: ['/a'] }).fileJobs, []);
  });

  await t('dumpJobsRefusal: accepts exactly the Dump layout; refuses PC prefixes, other folders, nesting, traversal and unsafe names', () => {
    const ok = [{ src: '/c/a', dest: path.join(EV, 'Dump', 'Ali Bhai', 'a.CR2') }, { src: '/c/v', dest: path.join(EV, 'Dump', 'Ali Bhai', 'VIDEO', 'v.MP4') }];
    assert.equal(dumpJobsRefusal(ok, EV, 'Ali Bhai'), null);
    assert.match(dumpJobsRefusal(ok, EV, 'PC01-Ali Bhai'), /PC sequence/);
    assert.match(dumpJobsRefusal([{ src: 's', dest: path.join(EV, 'Ali Bhai', 'a.CR2') }], EV, 'Ali Bhai'), /outside/);
    assert.match(dumpJobsRefusal([{ src: 's', dest: path.join(EV, 'Dump', 'Husain', 'a.CR2') }], EV, 'Ali Bhai'), /outside/);
    assert.match(dumpJobsRefusal([{ src: 's', dest: path.join(EV, 'Dump', 'Ali Bhai', 'Sub', 'a.CR2') }], EV, 'Ali Bhai'), /directly inside/);
    assert.match(dumpJobsRefusal([{ src: 's', dest: path.join(EV, 'Dump', 'Ali Bhai', '..', 'x', 'a') }], EV, 'Ali Bhai'), /outside/);
    assert.match(dumpJobsRefusal(ok, EV, '../x'), /safe folder name/);
    assert.match(dumpJobsRefusal(ok, EV, ''), /photographer/);
    assert.match(dumpJobsRefusal([], EV, 'Ali Bhai'), /no files/);
  });

  await t('partitionAlreadyInDump: held back ONLY when the destination exists with identical image data', async () => {
    const files = { '/d/same.JPG': 'h1', '/d/diff.JPG': 'hX', '/d/unread.JPG': null, '/d/err.JPG': 'boom' };
    const src = { '/c/same.JPG': 'h1', '/c/diff.JPG': 'h2', '/c/unread.JPG': null, '/c/new.JPG': 'h4', '/c/err.JPG': 'h5' };
    const io = {
      exists: async (p) => p in files,
      hashOf: async (p) => { const v = p.startsWith('/d/') ? files[p] : src[p]; if (v === 'boom') throw new Error('read failed'); return v; },
    };
    const jobs = ['same', 'diff', 'unread', 'new', 'err'].map(n => ({ src: `/c/${n}.JPG`, dest: `/d/${n}.JPG` }));
    const { copy, alreadyInDump } = await partitionAlreadyInDump(jobs, io);
    assert.deepEqual(alreadyInDump.map(j => j.src), ['/c/same.JPG'], 'only the identical photo is held back');
    assert.deepEqual(copy.map(j => j.src), ['/c/diff.JPG', '/c/unread.JPG', '/c/new.JPG', '/c/err.JPG'], 'different, unreadable, new and failing reads all proceed');
  });

  // ── Companion controller ──────────────────────────────────────────────────
  const today = '2026-11-12';
  const rec = (name, date, size = 100) => ({ path: `/Volumes/CARD/DCIM/${name}`, name, size, type: 'raw', evidence: date ? { status: 'dated', date, time: '10:00:00' } : { status: 'uncertain', reason: 'no-capture-metadata' } });
  const records = [rec('A1.CR2', today), rec('A2.CR2', today), rec('A3.CR2', today), rec('B1.CR2', '2026-11-10'), rec('B2.CR2', '2026-11-10'), rec('U1.CR2', null)];
  const imported = new Set(['A3.CR2_100', 'B2.CR2_100']);   // previously imported: one today, one earlier

  // EQI-2.1: the import runs in the main process (companionImportService) — a fake service here.
  function harness(over = {}) {
    const runs = [];
    let finish = null;
    let running = false;
    let svcView = null;
    const importService = {
      isRunning: () => running,
      runningSourceId: () => (running ? 'src-1' : null),
      view: (sourceId) => (sourceId === 'src-1' ? svcView : null),
      forget: () => {},
      run(plan) {
        runs.push(plan);
        running = true;
        svcView = { kind: plan.kind, state: 'pending', startedAt: Date.now(), finishedAt: null, events: [] };
        return new Promise(r => { finish = (res) => { running = false; svcView = { ...svcView, state: res.state, finishedAt: Date.now() }; r(res); }; });
      },
    };
    const creator = { results: [], opened: 0 };
    const pushes = { n: 0 }, popups = { n: 0 };
    const resolved = (ref) => {
      const eventPath = ref.eventPath || `${ref.collectionPath}/${ref.folderName || ref.safeEventName || ref.eventName}`;
      return { eventPath, eventName: eventPath.split('/').pop(), collectionName: 'Coll', componentCount: 1, pendingSync: ref.pendingSync === true, localFirst: false, types: ['Waaz'], places: ['Hall, Surat'] };
    };
    const c = createEventDumpController({
      importService,
      resolveEvent: async (ref) => resolved(ref),
      persistLastEvent: async () => {},
      openEventCreator: () => { creator.opened++; return { opened: true, done: Promise.resolve(creator.results.shift() || { ok: false, reason: 'cancelled' }) }; },
      getCard: (id) => (id === 'src-1' ? { mountpoint: '/Volumes/CARD', label: 'EOS_DIGITAL' } : null),
      verifyJob: async () => ({ state: 'complete', datesReady: true, records }),
      classify,
      selectionFor: () => normalizeSelection(null, today),
      isImported: (n, s) => imported.has(`${n}_${s}`),
      listPhotographers: () => ['Ali Bhai', 'Husain Bhai', 'Ali Bhai', ''],
      isBusy: () => false,
      scanEvents: async () => [{ folderName: 'Ev', isFromJson: true }, { folderName: 'Other', isFromJson: true }],
      pushSnapshot: () => { pushes.n++; },
      showPopup: () => { popups.n++; },
      hidePopup: () => {},
      ...over,
    });
    return { c, runs, finish: (r) => finish(r), pushes, popups, creator };
  }
  const job = { state: 'complete', datesReady: true, records };

  await t('default: every NEW file of today is selected; already-imported and undated files never are; earlier only when ticked', async () => {
    const { c } = harness();
    let v = c.cardView('src-1', job);
    assert.deepEqual(v.counts, { selectedNew: 2, selectedImported: 1, earlierNew: 1, earlierImported: 1, uncertain: 1, toImport: 2 });
    assert.equal(v.bytesToImport, 200, 'EQI-2.1: total size of the selected new files, before import');
    assert.equal(v.mode, 'review', 'the established Review behaviour stays the starting mode');
    assert.deepEqual(v.newByDate, { [today]: 2, '2026-11-10': 1 });
    assert.equal(c.setOptions({ sourceId: 'src-1', includeEarlier: true }).ok, true);
    v = c.cardView('src-1', job);
    assert.equal(v.counts.toImport, 3);
    assert.equal(v.bytesToImport, 300);
  });

  await t('photographer: only an exact name from the photographer list; never preselected; list de-duplicated and sorted', () => {
    const { c } = harness();
    assert.equal(c.cardView('src-1', job).photographer, null);
    assert.deepEqual(c.globalView().photographers, ['Ali Bhai', 'Husain Bhai']);
    assert.equal(c.setOptions({ sourceId: 'src-1', photographer: 'Ali Bhai' }).ok, true);
    assert.equal(c.setOptions({ sourceId: 'src-1', photographer: 'ali bhai' }).reason, 'unknown-photographer');
    assert.equal(c.setOptions({ sourceId: 'src-1', photographer: 'Ali Bhai', path: '/x' }).reason, 'invalid');
    assert.equal(c.setOptions({ sourceId: 'src-9', photographer: 'Ali Bhai' }).reason, 'invalid');
    assert.equal(c.setOptions({ sourceId: 'src-1', mode: 'quick' }).reason, 'invalid');
  });

  await t('startImport refuses without an event, without a photographer, with nothing new, while busy, or for a removed card', async () => {
    let h = harness();
    assert.equal((await h.c.startImport({ sourceId: 'src-1' })).reason, 'no-event');
    h.c.onWorkspaceEvent({ eventPath: '/Arc/Coll/Ev', eventName: 'Ev', collectionName: 'Coll', componentCount: 2, pendingSync: false });
    assert.equal((await h.c.startImport({ sourceId: 'src-1' })).reason, 'no-photographer');
    assert.equal(h.c.cardView('src-1', job).op.reason, 'no-photographer', 'a refusal is shown on the card');
    assert.equal((await h.c.startImport({ sourceId: 'src-2' })).reason, 'source-detached');
    h = harness({ isBusy: () => true });
    h.c.onWorkspaceEvent({ eventPath: '/Arc/Coll/Ev', eventName: 'Ev' });
    h.c.setOptions({ sourceId: 'src-1', photographer: 'Ali Bhai' });
    assert.equal((await h.c.startImport({ sourceId: 'src-1' })).reason, 'busy');
    h = harness({ isImported: () => true });
    h.c.onWorkspaceEvent({ eventPath: '/Arc/Coll/Ev', eventName: 'Ev' });
    h.c.setOptions({ sourceId: 'src-1', photographer: 'Ali Bhai' });
    assert.equal((await h.c.startImport({ sourceId: 'src-1' })).reason, 'nothing-new');
    assert.equal(h.runs.length, 0, 'nothing was ever handed to the import service');
  });

  await t('EQI-2.1 startImport hands the import service ONE single-event plan: the new files with sizes, the event, the confirmed photographer — no main window', async () => {
    const h = harness();
    h.c.onWorkspaceEvent({ eventPath: '/Arc/Coll/Ev', eventName: 'Ev', collectionName: 'Coll', componentCount: 2, pendingSync: false });
    h.c.setOptions({ sourceId: 'src-1', photographer: 'Ali Bhai' });
    const pending = h.c.startImport({ sourceId: 'src-1' });
    await new Promise(r => setImmediate(r));
    assert.equal(h.runs.length, 1);
    const plan = h.runs[0];
    assert.deepEqual({ ...plan, batches: plan.batches.map(b => ({ ...b, files: [...b.files].sort((x, y) => x.path.localeCompare(y.path)) })) }, {
      sourceId: 'src-1', kind: 'single', source: { label: 'EOS_DIGITAL', path: '/Volumes/CARD' }, localFirstEvent: false, collectionName: 'Coll',
      batches: [{ eventId: 'Ev', eventPath: '/Arc/Coll/Ev', photographer: 'Ali Bhai', files: [{ path: '/Volumes/CARD/DCIM/A1.CR2', size: 100 }, { path: '/Volumes/CARD/DCIM/A2.CR2', size: 100 }] }],
    });
    assert.equal((await h.c.startImport({ sourceId: 'src-1' })).reason, 'busy', 'one import at a time');
    assert.equal(h.c.cardView('src-1', job).op.state, 'pending', 'the service progress is the card op');
    h.finish({ state: 'completed' });
    assert.equal((await pending).state, 'completed');
    assert.equal(h.c.globalView().lastPhotographer, 'Ali Bhai', 'offered next time as a one-tap suggestion');
  });

  await t('a Local First (pending-sync) destination is passed on; a refused service run is shown as refused and nothing is remembered', async () => {
    const h = harness();
    h.c.onWorkspaceEvent({ eventPath: '/Staging/Coll/Ev', eventName: 'Ev', collectionName: 'Coll', pendingSync: true });
    h.c.setOptions({ sourceId: 'src-1', photographer: 'Ali Bhai' });
    const p = h.c.startImport({ sourceId: 'src-1' });
    await new Promise(r => setImmediate(r));
    assert.equal(h.runs[0].localFirstEvent, true);
    h.finish({ state: 'refused', reason: 'archive-busy' });
    assert.equal((await p).state, 'refused');
    assert.equal(h.c.cardView('src-1', job).op.reason, 'archive-busy');
    assert.equal(h.c.globalView().lastPhotographer, null);
  });

  await t('popup views carry names, counts and sizes only — never a file or event path', async () => {
    const h = harness();
    h.c.onWorkspaceEvent({ eventPath: '/Arc/Coll/Ev', eventName: 'Ev', collectionName: 'Coll', componentCount: 1, pendingSync: false });
    h.c.setOptions({ sourceId: 'src-1', photographer: 'Ali Bhai', includeEarlier: true });
    const json = JSON.stringify([h.c.cardView('src-1', job), h.c.globalView()]);
    assert.ok(!json.includes('/Volumes') && !json.includes('/Arc'), json);
  });

  await t('EQI-2.1 Create New Event opens the companion\'s own Event Creator window; created → new destination; cancel → nothing changes', async () => {
    const h = harness();
    h.c.onWorkspaceEvent({ eventPath: '/Arc/Coll/Ev', eventName: 'Ev', collectionName: 'Coll' });
    h.c.setOptions({ sourceId: 'src-1', photographer: 'Ali Bhai', mode: 'dump' });
    h.creator.results.push({ ok: true, eventPath: '/Arc/Coll/New', pendingSync: false, localFirst: false });
    const r1 = await h.c.openPicker({ mode: 'new' });
    assert.equal(r1.state, 'completed');
    assert.equal(h.creator.opened, 1);
    assert.equal(h.c.globalView().event.eventName, 'New', 'the new event is the destination');
    assert.equal(h.popups.n, 1, 'back to the companion');
    const r2 = await h.c.openPicker({ mode: 'new' });                 // cancelled
    assert.equal(r2.state, 'cancelled');
    assert.equal(h.c.globalView().event.eventName, 'New', 'cancelled: same event');
    assert.deepEqual([h.c.cardView('src-1', job).photographer, h.c.cardView('src-1', job).mode], ['Ali Bhai', 'dump'], 'cancelled: card choices kept');
    assert.equal((await h.c.openPicker({ mode: 'choose' })).reason, 'invalid', 'choosing is the companion\'s own picker');
  });

  await t('EQI-2.1 Change Event: only listed events, resolved from disk, without the main window; the main window\'s later change is followed', async () => {
    const h = harness();
    h.c.onWorkspaceEvent({ eventPath: '/Arc/Coll/Ev', eventName: 'Ev', collectionName: 'Coll' });
    assert.equal((await h.c.chooseEvent({ folderName: 'Other' })).reason, 'not-listed', 'list first');
    await h.c.listEvents();
    assert.equal((await h.c.chooseEvent({ folderName: '../x' })).reason, 'not-listed');
    assert.equal((await h.c.chooseEvent({ folderName: 'Other' })).state, 'completed');
    assert.equal(h.c.activeEvent().eventPath, '/Arc/Coll/Other');
    h.c.onWorkspaceEvent({ eventPath: '/Arc/Coll/Ev', eventName: 'Ev', collectionName: 'Coll' });   // same report as before: no change
    assert.equal(h.c.activeEvent().eventPath, '/Arc/Coll/Other', 'an unchanged main-window report never overrides the companion');
    h.c.onWorkspaceEvent({ eventPath: '/Arc/Coll/Third', eventName: 'Third', collectionName: 'Coll' });
    assert.equal(h.c.activeEvent().eventPath, '/Arc/Coll/Third', 'a real change in AutoIngest is followed');
  });

  await t('EQI-2.1 seed: with no main window the destination starts at AutoIngest\'s last event', async () => {
    const h = harness();
    await h.c.seed({ collectionPath: '/Arc/Coll', collectionName: 'Coll', eventName: 'Last', safeEventName: 'Last' });
    assert.equal(h.c.globalView().event.eventName, 'Last');
  });

  // ── Generalized handoff ───────────────────────────────────────────────────
  await t('workspaceHandoff.request: same lifecycle as openSource; the workspace result is kept, reduced to plain values', async () => {
    const ipc = new EventEmitter();
    const wc = new EventEmitter();
    Object.assign(wc, { id: 5, isDestroyed: () => false, sent: [], send(ch, msg) { this.sent.push({ ch, msg }); } });
    const win = { isDestroyed: () => false, webContents: wc };
    const h = createWorkspaceHandoff({ ipcMain: ipc, getMainWindow: () => win, openApp: () => {}, isBusy: () => false, readyTimeoutMs: 2000 });
    h.register();
    ipc.emit('companion:workspaceReady', { sender: wc });
    const started = h.request('dump-import', { sourceId: 'src-1', channel: 'companion:dumpImport', payload: (id) => ({ requestId: id, files: ['/a'] }) });
    assert.equal(started.started, true);
    for (let i = 0; i < 50 && !wc.sent.length; i++) await new Promise(r => setTimeout(r, 20));
    assert.equal(wc.sent[0].ch, 'companion:dumpImport');
    const id = wc.sent[0].msg.requestId;
    assert.equal(h.openSource({ sourceId: 'src-2', mountpoint: '/m', label: 'L' }).started, false, 'one operation at a time');
    ipc.emit('companion:openSourceProgress', { sender: wc }, { requestId: id });
    ipc.emit('companion:openSourceResult', { sender: wc }, { requestId: id, result: { ok: true, copied: 3, detail: 'x'.repeat(500), nested: { a: 1 }, fn: () => 1 } });
    const done = await started.done;
    assert.equal(done.state, 'completed'); assert.equal(done.kind, 'dump-import');
    assert.deepEqual(Object.keys(done.result).sort(), ['copied', 'detail', 'ok']);
    assert.equal(done.result.detail.length, 200);
    h.unregister();
  });

  await fsp.rm(tmp, { recursive: true, force: true });
  console.log(`${passed} passed`);
})();
