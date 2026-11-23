'use strict';
// LIVE (AI-FEAT-064 EQI-3.1): Sort Dump live-event safety + nonblocking background metadata.
// Real main.js, renderer, Event Management, Import Workspace, groups, move transaction, event.json,
// ExifTool metadata and Metadata Audit — isolated test identity, temp profile, synthetic archive only.
//
//   A  Sort Dump workspace: persistent indicator (event + group destinations), "Move to Event Folders"
//   B  Change Event before sorting → "Close Sort Dump?" — Stay keeps everything; Close goes home,
//      assignments discarded, no Confirm Event Import, Dump untouched
//   C  edit/rename of the event while Sort Dump is open → refused, no edit mode
//   D  the reported failure path: the event renamed underneath an open Sort Dump, then Move →
//      Sort Dump closes ("nothing was moved"), never an ordinary import, no folder created
//   E  another event made current underneath an open Sort Dump, then Move → closes; nothing reaches it
//   F  the Dump chosen by hand as a Local Folder source → ordinary import refused (renderer and main)
//   G  the 0-of-N report: a stale-source import stops BEFORE writing and says why (not "cancelled")
//   H  120 photos (+3 RAW/XMP pairs) moved: the move dialog closes before metadata finishes; a compact
//      chip shows progress; Event Management usable; rename refused while metadata writes; a
//      non-conflicting import into another event runs meanwhile; then "Metadata verification completed";
//      keywords for the final components, RAW bytes unchanged, XMP moved and rewritten, audit complete,
//      imports[] unchanged, no stale Dump path
//   I  metadata failure → "Metadata requires attention", the move stands; repair via the existing path
//   J  crash (SIGKILL) during a metadata batch → restart resumes; no duplicate moves or import records
//   K  Sort QMZ unaffected
//
// Run: node test/eqi31SortDumpSafetyLive.test.js     AI_EQI31_SHOTS=<dir> keeps the screenshots

const { _electron: electron } = require('playwright-core');
const { ExifTool } = require('exiftool-vendored');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const H = require('./support/liveTestHarness');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_BIN = require(path.join(PROJECT_ROOT, 'node_modules', 'electron'));
const COLL = 'CollEQI31';
const P1 = 'Testali Bhai', P2 = 'Testhusain Bhai';
const E = '1448-06-01 _01-Majlis-Waaz-QMZ-Hall-Surat', F = '1448-06-01 _02-Ziyafat-Hall-Surat';
const MAJ = 'Majlis-Hall', WAAZ = 'Waaz-Hall', QMZ = 'QMZ-Hall';
const N_JPG = 126;

let failures = 0;
const log = (...a) => console.log('[eqi31-live]', ...a);
const check = (c, m) => { if (c) log('PASS —', m); else { failures++; log('FAIL —', m); } };
const J = (x) => JSON.stringify(x);
const { sleep, waitFor, createHelpers, listFiles, noiseJpeg: _noise } = require('./support/eventDumpLiveHelpers');
const { passSplash, setActiveEvent } = createHelpers({ projectRoot: PROJECT_ROOT });
const noiseJpeg = () => _noise(PROJECT_ROOT, 240, 240);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const XMP = "<?xpacket begin='' id='W5M0MpCehiHzreSzNTczkc9d'?><x:xmpmeta xmlns:x='adobe:ns:meta/'><rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'></rdf:RDF></x:xmpmeta><?xpacket end='w'?>";
const jpgName = (i) => `IMG_${String(i).padStart(4, '0')}.JPG`;

async function shoot(page, dir, name) {
  const cur = await page.evaluate(() => document.documentElement.dataset.theme);
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(dir, `${name}-${theme}.png`) });
  }
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, cur);
}

(async () => {
  if (process.platform !== 'darwin') { log('SKIP — macOS only'); return; }
  const work = fs.realpathSync(await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-eqi31-live-')));
  const shots = process.env.AI_EQI31_SHOTS || path.join(work, 'shots');
  await fsp.mkdir(shots, { recursive: true });
  const ud = path.join(work, 'userData'); await fsp.mkdir(ud);
  const archiveRoot = path.join(work, 'archive'); await fsp.mkdir(archiveRoot);
  const stagingRoot = path.join(work, 'staging'); await fsp.mkdir(stagingRoot);
  const collDir = path.join(archiveRoot, COLL);
  let ev = path.join(collDir, E);
  const evF = path.join(collDir, F);
  const iso = H.prepareIsolatedApp({ tag: 'eqi31', work, projectRoot: PROJECT_ROOT });
  const prodBefore = H.prodKeychainSnapshot();
  const testKcBefore = H.keychainHas(iso.keychainItem);
  const et = new ExifTool({ maxProcs: 2 });
  const launch = () => electron.launch({ executablePath: ELECTRON_BIN, args: [...iso.args, '--user-data-dir=' + ud, '--no-sandbox'], cwd: PROJECT_ROOT, env: iso.env(ud), timeout: 60000 });

  // ── synthetic Dump: N_JPG JPEGs + 3 RAW(+JPEG)+XMP shots of photographer 1 ──
  const d1 = (n) => path.join(ev, 'Dump', P1, n);
  const base = await noiseJpeg();
  const basePath = path.join(work, 'base.jpg');
  await fsp.writeFile(basePath, base);
  await et.write(basePath, { Make: 'Canon', Model: 'Canon EOS R5', DateTimeOriginal: '2026:11:20 10:00:00' }, { writeArgs: ['-overwrite_original'] });
  await fsp.mkdir(path.join(ev, 'Dump', P1), { recursive: true });
  for (let i = 1; i <= N_JPG; i++) await fsp.copyFile(basePath, d1(jpgName(i)));
  const rawHash = {};
  for (let i = 901; i <= 903; i++) {
    await fsp.copyFile(basePath, d1(`IMG_0${i}.JPG`));
    const r = crypto.randomBytes(300 * 1024);
    await fsp.writeFile(d1(`IMG_0${i}.CR3`), r);
    rawHash[`IMG_0${i}.CR3`] = sha(r);
    await fsp.writeFile(d1(`IMG_0${i}.xmp`), XMP);
  }
  const comp = (id, folderName, types) => ({ id, folderName, location: 'Hall', city: 'Surat', country: 'India', types, additionalKeywords: [] });
  const evDoc = { version: 1, hijriDate: '1448-06-01', sequence: 1, eventName: 'Majlis-Waaz-QMZ-Hall-Surat', components: [comp(1, MAJ, ['Majlis']), comp(2, WAAZ, ['Waaz']), comp(3, QMZ, ['QMZ'])],
    imports: [{ id: 'imp-dump-1', timestamp: new Date().toISOString(), photographer: P1, destination: 'dump', counts: { total: N_JPG + 9 } }] };

  let app, main;
  const dumpCount = async () => (await listFiles(path.join(ev, 'Dump'))).length;
  const stMsg = () => main.evaluate(() => document.getElementById('statusMessage').textContent);
  const confirmImportVisible = () => main.evaluate(() => document.getElementById('eventImportOverlay')?.classList.contains('visible') || false);
  const openEm = async () => {
    await main.evaluate(() => { if (!EventMgmt.isOpen()) { EventMgmt.open({ mode: 'select' }); EventCreator.start(); } });
    await main.waitForSelector(`.ec-coll-card[data-name="${COLL}"]`, { timeout: 15000 }).catch(() => {});
    if (await main.$(`.ec-coll-card[data-name="${COLL}"]`)) { await main.click(`.ec-coll-card[data-name="${COLL}"]`); await main.click('#ecMasterContinue'); }
    await main.waitForSelector(`.ec-evl-item[data-folder="${path.basename(ev)}"]`, { timeout: 15000 });
  };
  const openSortDump = async () => {
    await openEm();
    await main.waitForSelector(`.ec-evl-item[data-folder="${path.basename(ev)}"] .ec-evl-dump-btn`, { timeout: 15000 });
    await main.click(`.ec-evl-item[data-folder="${path.basename(ev)}"] .ec-evl-dump-btn`);
    await main.waitForFunction(() => window.DumpSortMode && DumpSortMode.isActive() && document.getElementById('workspace')?.classList.contains('visible'), null, { polling: 100, timeout: 20000 });
    await main.waitForFunction((n) => document.querySelectorAll('#fileGrid .file-tile').length >= n, Math.min(40, N_JPG), { polling: 100, timeout: 60000 });
  };
  const review = async () => {
    await main.click('#importBtn');
    await main.waitForSelector('#dumpSortOverlay.visible', { timeout: 30000 });
    if (!(await main.$('#dumpSortOverlay.visible #dsrGo'))) {
      log('review diagnostics', J(await main.evaluate(() => ({ overlay: document.getElementById('dumpSortOverlay').textContent.replace(/\s+/g, ' ').slice(0, 500), groups: GroupManager.getGroups().map(g => [g.label, g.subEventId, g.files.size]), sel: selectedFiles.size }))));
      log('event components', J(JSON.parse(fs.readFileSync(path.join(ev, 'event.json'), 'utf8')).components.map(c => c.folderName)), J(await main.evaluate(() => EventCreator.getSubEventNames())));
      throw new Error('review offers no Move');
    }
  };
  const assign = (groups) => main.evaluate(({ groups }) => {
    GroupManager.reset();
    for (const [files, sub] of groups) { const g = GroupManager.createGroup(); GroupManager.assignFiles(files, g); GroupManager.setSubEvent(g, sub); for (const p of files) selectedFiles.add(p); }
    renderGroupPanel(); updateSelectionBar();
    return { groups: GroupManager.getGroups().map(g => [g.label, g.subEventId, g.files.size]), banner: document.getElementById('dumpSortBanner')?.textContent || '', btn: document.getElementById('importBtn').textContent.trim() };
  }, { groups });

  try {
    app = await launch();
    await H.verifyIsolation(app, iso, ud);
    check(true, 'isolation proven (test identity, temp profile, drivelist stub, quit guard)');
    main = await passSplash(app);
    main.on('dialog', (d) => d.accept().catch(() => {}));
    await main.evaluate(async (a) => {
      await window.api.initArchiveRoot(a.archiveRoot);
      await window.api.setNasRoot(a.archiveRoot);
      await window.api.setMainArchiveRoot(a.archiveRoot);
      await window.api.setLocalStagingRoot(a.stagingRoot);
      await window.api.setDefaultImportMode('direct-nas');
      if (typeof EventCreator.setSessionArchiveRoot === 'function') EventCreator.setSessionArchiveRoot(a.archiveRoot);
      for (const n of a.names) await window.api.addToList('photographers', n);
      await window.api.keywordsAddKeyword({ label: 'Mundra', category: 'city', parentPath: ['Mundra'], parentId: 'city' });
    }, { archiveRoot, stagingRoot, names: [P1, P2] });
    await main.evaluate(async ({ defs }) => { for (const [d, data] of defs) await window.api.writeEventJson(d, data); }, { defs: [
      [ev, evDoc],
      [evF, { version: 1, hijriDate: '1448-06-01', sequence: 2, eventName: 'Ziyafat-Hall-Surat', components: [comp(1, 'Ziyafat-Hall', ['Ziyafat'])] }],
    ] });
    await setActiveEvent(main, collDir, COLL, E);
    const dumpN = await dumpCount();
    check(dumpN === N_JPG + 9, `synthetic Dump: ${N_JPG} JPEGs + 3 RAW/JPEG/XMP shots (${dumpN} files)`);

    // ═══ A: Sort Dump workspace and its indicator ═══
    await openSortDump();
    const half = Math.floor(N_JPG / 2);
    const gA = Array.from({ length: 60 }, (_, i) => d1(jpgName(i + 1)));
    const gB = [...Array.from({ length: 60 }, (_, i) => d1(jpgName(i + 61))), ...[901, 902, 903].flatMap(i => [d1(`IMG_0${i}.JPG`), d1(`IMG_0${i}.CR3`)])];
    let a = await assign([[gA, MAJ], [gB, WAAZ]]);
    check(/Sort Dump/.test(a.banner) && a.banner.includes(path.basename(ev)) && a.banner.includes(`G1 → ${MAJ}`) && a.banner.includes(`G2 → ${WAAZ}`), `persistent Sort Dump indicator: owning event and destinations ("${a.banner.slice(0, 160)}")`);
    check(a.btn === 'Move to Event Folders', `final action reads "Move to Event Folders" (${a.btn})`);
    await shoot(main, shots, '1-sort-dump-indicator');

    // ═══ B: Change Event before sorting ═══
    await main.click('#ctxChangeEventBtn');
    await main.waitForSelector('#dumpSortOverlay.visible #dsrStay', { timeout: 10000 });
    const leaveText = await main.evaluate(() => document.getElementById('dumpSortOverlay').textContent.replace(/\s+/g, ' '));
    check(/Close Sort Dump\?/.test(leaveText) && /not carried to another event/.test(leaveText) && /Nothing has been moved/.test(leaveText), 'Change Event explains that Sort Dump closes and why');
    await shoot(main, shots, '2-change-event-confirm');
    await main.click('#dsrStay');
    const stay = await main.evaluate(() => ({ active: DumpSortMode.isActive(), groups: GroupManager.getGroups().map(g => g.files.size), em: EventMgmt.isOpen() }));
    check(stay.active && J(stay.groups) === J([60, 66]) && !stay.em, `"Stay in Sort Dump" keeps the workspace and its assignments (${J(stay)})`);
    await main.click('#ctxChangeEventBtn');
    await main.waitForSelector('#dumpSortOverlay.visible #dsrLeave', { timeout: 10000 });
    await main.click('#dsrLeave');
    await main.waitForFunction(() => !DumpSortMode.isActive() && !document.getElementById('workspace').classList.contains('visible'), null, { polling: 100, timeout: 10000 });
    const left = await main.evaluate(() => ({ groups: GroupManager.getGroups().length, src: !!activeSource, em: EventMgmt.isOpen() }));
    check(left.groups === 0 && !left.src && left.em, `"Close Sort Dump": home + Event Management, assignments discarded, no source left behind (${J(left)})`);
    check(!(await confirmImportVisible()), 'no Confirm Event Import dialog');
    check(await dumpCount() === dumpN, 'Dump untouched');
    await main.evaluate(() => EventMgmt.close());

    // ═══ C: edit/rename while Sort Dump is open ═══
    await openSortDump();
    await assign([[gA, MAJ]]);
    await openEm();
    await main.click(`.ec-evl-item[data-folder="${E}"]`);
    await main.waitForSelector('#emmEditBtn', { state: 'visible', timeout: 10000 });
    await main.click('#emmEditBtn');
    await sleep(800);
    const ed = await main.evaluate(() => ({ msg: document.getElementById('statusMessage').textContent, mode: EventMgmt.getMode(), editing: !!document.querySelector('#ecEventContinue') && /Save/.test(document.getElementById('ecEventContinue').textContent) }));
    check(/Sort Dump is open for this event/.test(ed.msg) && ed.mode === 'select' && !ed.editing, `edit/rename refused while Sort Dump is open (${J(ed)})`);
    await main.evaluate(() => EventMgmt.close());

    // ═══ D: the reported path — the event renamed underneath an open Sort Dump ═══
    await openSortDump();
    a = await assign([[gA, MAJ], [gB, WAAZ]]);
    const renamed = path.join(collDir, E.replace('_01-', '_01-Renamed-'));
    await fsp.rename(ev, renamed);   // out-of-band (another computer / Finder) — the app never saw it
    await main.click('#importBtn');
    await sleep(1500);
    const dState = await main.evaluate(() => ({ active: DumpSortMode.isActive(), ws: document.getElementById('workspace').classList.contains('visible'), overlay: document.getElementById('dumpSortOverlay')?.classList.contains('visible') }));
    const dMsg = await stMsg();
    check(!dState.active && !dState.ws && !dState.overlay && /Sort Dump was closed and nothing was moved/.test(dMsg), `stale event path: Sort Dump closes, nothing moved (${J(dState)} "${dMsg.slice(0, 140)}")`);
    check(!(await confirmImportVisible()), 'no Confirm Event Import for already-imported Dump photos');
    await main.click('#importBtn').catch(() => {});   // a second click (the operator retrying) — nothing to import
    await sleep(800);
    check(!(await confirmImportVisible()), 'a second click does not turn it into an ordinary import either');
    const madeDirs = (await listFiles(renamed)).filter(f => !f.startsWith('Dump/') && f !== 'event.json' && !f.startsWith('.autoingest'));
    check(madeDirs.length === 0 && (await listFiles(path.join(renamed, 'Dump'))).length === dumpN, `no folder, file or record created in the event (${madeDirs.length})`);
    await fsp.rename(renamed, ev);

    // ═══ E: another event made current underneath an open Sort Dump ═══
    await openSortDump();
    await assign([[gA, MAJ]]);
    await main.evaluate((f) => EventCreator.adoptEventByFolder(f), F);
    await sleep(1200);
    const eState = await main.evaluate(() => ({ active: DumpSortMode.isActive(), src: !!activeSource, groups: GroupManager.getGroups().length, msg: document.getElementById('statusMessage').textContent }));
    check(!eState.active && !eState.src && eState.groups === 0 && /Sort Dump was closed/.test(eState.msg), `another event made current: Sort Dump closes at once, source and assignments cleared (${J(eState)})`);
    const fTree = (await listFiles(evF)).filter(f => f !== 'event.json' && !f.startsWith('.autoingest'));
    check(!eState.active && !(await confirmImportVisible()) && fTree.length === 0, `event switched underneath: Sort Dump closes; nothing reaches the other event (${fTree.length} files there)`);
    await setActiveEvent(main, collDir, COLL, E);

    // ═══ F: the Dump chosen by hand as a Local Folder → ordinary import refused ═══
    await main.evaluate(async (p) => { await selectSource({ type: 'local-folder', path: p, label: 'Dump' }); }, path.join(ev, 'Dump'));
    await main.waitForFunction(() => document.getElementById('workspace').classList.contains('visible'), null, { polling: 100, timeout: 15000 });
    await sleep(1500);
    await main.evaluate((files) => { for (const p of files) selectedFiles.add(p); updateSelectionBar(); }, gA.slice(0, 5));
    await main.evaluate(() => document.getElementById('importBtn').click());
    await sleep(1200);
    const fMsg = await stMsg();
    check(/These photos are in the Dump of/.test(fMsg) && !(await confirmImportVisible()), `renderer refuses an ordinary import from a managed Dump ("${fMsg.slice(0, 110)}")`);
    const mainRefusal = await main.evaluate(async ({ src, dest, ev }) => {
      try { await window.api.commitImportTransaction([{ src, dest }], ev, { groups: [{ id: 0, files: [src], subEventId: null, metadataTags: null }], photographer: 'Testali Bhai', importMode: 'direct-nas' }); return 'no error'; }
      catch (e) { return String(e.message); }
    }, { src: gA[0], dest: path.join(evF, 'Ziyafat-Hall', P1, jpgName(1)), ev: evF });
    check(/Import refused: these photos are already in an event's Dump/.test(mainRefusal) && !fs.existsSync(path.join(evF, 'Ziyafat-Hall', P1)), `main refuses it too, before writing anything ("${mainRefusal.slice(0, 120)}")`);

    // ═══ G: the 0-of-N report — stale source stops before writing, says why ═══
    const staleSrc = Array.from({ length: 139 }, (_, i) => path.join(work, 'gone', 'Dump', P1, jpgName(i + 1)));
    const gRes = await main.evaluate(async ({ srcs, destDir, ev }) => {
      try { await window.api.commitImportTransaction(srcs.map(s => ({ src: s, dest: destDir + '/' + s.split('/').pop() })), ev, { groups: [{ id: 0, files: srcs, subEventId: null, metadataTags: null }], photographer: 'Testali Bhai', importMode: 'direct-nas' }); return 'no error'; }
      catch (e) { return String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''); }
    }, { srcs: staleSrc, destDir: path.join(evF, 'Ziyafat-Hall', P2), ev: evF });
    check(/^Import stopped: the source folder is no longer available/.test(gRes) && /0 of 139 files copied/.test(gRes) && !/cancel/i.test(gRes), `stale source: "${gRes.slice(0, 150)}"`);
    check(!fs.existsSync(path.join(evF, 'Ziyafat-Hall', P2)), 'no destination folder created (the old build created photographer folders before aborting)');
    const evFDoc = JSON.parse(await fsp.readFile(path.join(evF, 'event.json'), 'utf8'));
    check(!(evFDoc.imports || []).length && evFDoc.status !== 'complete', 'no import record, no false "complete" status');
    await main.evaluate(() => document.getElementById('changeDriveBtn').click());

    // ═══ H: 120 photos + 3 RAW/XMP shots — nonblocking metadata ═══
    await openSortDump();
    a = await assign([[gA, MAJ], [gB, WAAZ]]);
    await review();
    await shoot(main, shots, '3-review');
    const tMove = Date.now();
    await main.click('#dsrGo');
    const released = await main.waitForFunction(() => !document.getElementById('dumpSortOverlay').classList.contains('visible') && !DumpSortMode.busy && /Files moved/.test(document.getElementById('dsbLast')?.textContent || ''), null, { polling: 100, timeout: 60000 }).then(() => true, () => false);
    const atRelease = await main.evaluate(() => ({ chip: document.getElementById('dsMetaChip') && !document.getElementById('dsMetaChip').hidden ? document.getElementById('dsMetaChip').textContent : null, states: DumpSortMetaChip.states.map(s => ({ state: s.state, active: s.active, total: s.total })), ws: document.getElementById('workspace').classList.contains('visible'), msg: document.getElementById('dsbLast')?.textContent || '' }));
    log('released after', Date.now() - tMove, 'ms', J(atRelease));
    if (!released) log('H diagnostics', J(await main.evaluate(() => ({ overlay: document.getElementById('dumpSortOverlay')?.textContent.replace(/\s+/g, ' ').slice(0, 400), busy: DumpSortMode.busy, active: DumpSortMode.isActive() }))));
    check(released && atRelease.ws, 'the move dialog closed and the operator is back in the workspace');
    check(/Files moved successfully/.test(atRelease.msg) && /126 files moved/.test(atRelease.msg) && /Metadata verification queued/.test(atRelease.msg), `completion message distinguishes move from metadata ("${atRelease.msg.slice(0, 160)}")`);
    const stillRunning = atRelease.states.some(s => s.active);
    check(stillRunning && !!atRelease.chip, `metadata still running in the background when the operator was released (chip: "${atRelease.chip}")`);
    await shoot(main, shots, '4-nonblocking-metadata-chip');
    // rename refused while metadata writes to the moved photos
    const ren = await main.evaluate(async ({ c, e }) => window.api.renameEvent(c, e, e.replace('_01-', '_01-X-')), { c: collDir, e: E });
    const metaActiveAtRename = await main.evaluate(() => DumpSortMetaChip.states.some(s => s.active));
    check(!metaActiveAtRename || (ren && ren.ok === false && /Metadata/.test(ren.reason || '')), `rename refused while metadata is written (${J(ren)}, active=${metaActiveAtRename})`);
    // Event Management stays usable meanwhile
    await openEm();
    const emOk = await main.evaluate(() => document.querySelectorAll('.ec-evl-item').length);
    check(emOk >= 2, `Event Management usable while metadata runs (${emOk} events listed)`);
    await main.evaluate(() => EventMgmt.close());
    // a non-conflicting import into another event meanwhile
    const extra = path.join(work, 'loose');
    await fsp.mkdir(extra, { recursive: true });
    await fsp.copyFile(basePath, path.join(extra, 'DSC_7001.JPG'));
    const metaActiveAtImport = await main.evaluate(() => DumpSortMetaChip.states.some(s => s.active));
    const imp = await main.evaluate(async ({ src, dest, ev, comps }) => {
      try { const r = await window.api.commitImportTransaction([{ src, dest }], ev, { groups: [{ id: 0, files: [src], subEventId: null, metadataTags: null }], photographer: 'Testhusain Bhai', liveComps: comps, collName: 'CollEQI31', importMode: 'direct-nas' }); return { ok: true, copied: r && (r.copied ?? r.result?.copied) }; }
      catch (e) { return { ok: false, err: String(e.message).slice(0, 200) }; }
    }, { src: path.join(extra, 'DSC_7001.JPG'), dest: path.join(evF, 'Ziyafat-Hall', P2, 'DSC_7001.JPG'), ev: evF, comps: [comp(1, 'Ziyafat-Hall', ['Ziyafat'])] });
    check(imp.ok && fs.existsSync(path.join(evF, 'Ziyafat-Hall', P2, 'DSC_7001.JPG')), `a non-conflicting import into another event runs (${J(imp)}; metadata still active then: ${metaActiveAtImport})`);
    // completion
    const metaDone = await main.waitForFunction(() => DumpSortMetaChip.states.length > 0 && DumpSortMetaChip.states.every(s => !s.active), null, { polling: 100, timeout: 300000 }).then(() => true, () => false);
    const fin = await main.evaluate(() => ({ chip: document.getElementById('dsMetaChip')?.textContent, state: document.getElementById('dsMetaChip')?.dataset.state, states: DumpSortMetaChip.states.map(s => ({ state: s.state, verified: s.verified, written: s.written, failed: s.failed, total: s.total })) }));
    check(metaDone && fin.states.every(s => s.state === 'complete') && /Metadata verification completed/.test(fin.chip || ''), `background metadata completed: "${fin.chip}" ${J(fin.states)}`);
    await shoot(main, shots, '5-metadata-completed');
    const tree = await listFiles(ev);
    check(tree.filter(f => f.startsWith(`${MAJ}/${P1}/`) && f.endsWith('.JPG')).length === 60, '60 photos in Majlis');
    const waazDir = tree.filter(f => f.startsWith(`${WAAZ}/`)).map(f => f.split('/')[1])[0];
    check(tree.filter(f => f.startsWith(`${WAAZ}/${waazDir}/`) && f.endsWith('.JPG')).length === 63, `63 photos in Waaz (${waazDir})`);
    check([901, 902, 903].every(i => tree.includes(`${WAAZ}/${waazDir}/IMG_0${i}.CR3`) && tree.includes(`${WAAZ}/${waazDir}/IMG_0${i}.xmp`)), 'RAW/XMP pairs moved together');
    check([901, 902, 903].every(i => sha(fs.readFileSync(path.join(ev, WAAZ, waazDir, `IMG_0${i}.CR3`))) === rawHash[`IMG_0${i}.CR3`]), 'RAW bytes unchanged');
    check(tree.filter(f => f.startsWith('Dump/')).length === N_JPG - 120, `${N_JPG - 120} photos left unsorted in Dump`);
    check(!tree.some(f => /_1\.(CR3|JPG)$/.test(f)), 'no "_1" duplicates / overwritten files');
    const kw = async (p) => { const t = await et.read(p); return [].concat(t.Subject || [], t.Keywords || []).map(String); };
    const kM = await kw(path.join(ev, MAJ, P1, jpgName(1)));
    const kW = await kw(path.join(ev, WAAZ, waazDir, jpgName(61)));
    const kX = await kw(path.join(ev, WAAZ, waazDir, 'IMG_0901.xmp'));
    check(kM.includes('Majlis') && kW.includes('Waaz') && kX.includes('Waaz'), `metadata for the final components (Majlis ${J(kM)}, Waaz ${J(kW)}, RAW sidecar ${J(kX)})`);
    const docH = JSON.parse(await fsp.readFile(path.join(ev, 'event.json'), 'utf8'));
    check(J(docH.imports) === J(evDoc.imports), 'imports[] unchanged — no duplicate import record');
    check(!J(docH).includes(`"Dump/${P1}/${jpgName(1)}"`), 'no stale Dump path in event.json');
    check(fs.readdirSync(path.join(ev, '.autoingest', 'dump-sort')).filter(n => n.endsWith('.json')).length === 0 && (fs.readdirSync(path.join(ev, '.autoingest', 'dump-sort', 'metadata')).length === 0), 'move journal and metadata record finished');
    const audit = await main.evaluate(async (root) => {
      const r = await window.api.runMetadataAudit({ type: 'event', rootPath: root });
      for (let i = 0; i < 480; i++) { const s = await window.api.getMetadataAuditStatus(r.jobId); if (s && /complete|done|finished/.test(s.state || s.status || '')) break; await new Promise(x => setTimeout(x, 500)); }
      const rep = await window.api.getMetadataAuditReport(r.jobId, 0, 1000, null);
      return { counts: rep.counts, items: (rep.items || []).map(i => [i.relativePath || i.filePath, i.status]) };
    }, ev);
    const moved = audit.items.filter(([p]) => p && !String(p).includes('Dump') && /\.(JPG|CR3)$/i.test(p) && !String(p).includes('Ziyafat'));
    check(moved.length >= 123 && moved.every(([, s]) => s === 'complete'), `Metadata Audit: moved photos complete (${moved.length}; statuses ${J([...new Set(moved.map(x => x[1]))])})`);

    // ═══ I: metadata failure → attention; the move stands; repaired by the existing path ═══
    check(await main.evaluate(() => DumpSortMode.isActive() && GroupManager.getGroups().length === 0), 'after the move the workspace shows the photos still to sort, groups empty for the next round');
    const gI = [d1(jpgName(121)), d1(jpgName(122))];
    await assign([[gI, QMZ]]);
    await fsp.mkdir(path.join(ev, QMZ, P1), { recursive: true });
    await review();
    // make the destination read-only the moment the files land, so the metadata write fails
    const lock = setInterval(() => { try { if (fs.readdirSync(path.join(ev, QMZ, P1)).length >= 2) { fs.chmodSync(path.join(ev, QMZ, P1), 0o555); clearInterval(lock); } } catch { /* not yet */ } }, 5);
    await main.click('#dsrGo');
    await main.waitForFunction(() => !document.getElementById('dumpSortOverlay').classList.contains('visible') && !DumpSortMode.busy, null, { polling: 100, timeout: 60000 });
    const att = await main.waitForFunction(() => DumpSortMetaChip.states.some(s => !s.active && s.state === 'attention'), null, { polling: 100, timeout: 120000 }).then(() => true, () => false);
    clearInterval(lock);
    const attState = await main.evaluate(() => ({ chip: document.getElementById('dsMetaChip')?.textContent, title: document.getElementById('dsMetaChip')?.title }));
    check(att && /Metadata requires attention/.test(attState.chip || ''), `metadata failure reported: "${attState.chip}"`);
    await shoot(main, shots, '6-metadata-attention');
    fs.chmodSync(path.join(ev, QMZ, P1), 0o755);
    check(gI.every(p => !fs.existsSync(p)) && fs.existsSync(path.join(ev, QMZ, P1, jpgName(121))), 'the move stands (never rolled back or repeated)');
    await main.evaluate(() => document.getElementById('dsMetaChip').click());
    await sleep(800);
    const alOpen = await main.evaluate(() => document.getElementById('activityLogModal')?.classList.contains('open'));
    check(!!alOpen, 'the chip opens Metadata Management (Activity Log → Metadata)');
    await main.evaluate(() => { if (typeof _alClose === 'function') _alClose(); });
    const rep = await main.evaluate(async (e) => window.api.reapplyEventMetadata(e).then(r => r, err => ({ err: err.message })), ev);
    await sleep(500);
    const repaired = await waitFor(async () => (await kw(path.join(ev, QMZ, P1, jpgName(121)))).includes('QMZ'), 120000);
    check(!!repaired, `the existing repair path completes it (${J(rep && { ok: rep.ok, queued: rep.queued })})`);

    // ═══ J: crash during a metadata batch → restart resumes ═══
    const gJ = [d1(jpgName(123)), d1(jpgName(124)), d1(jpgName(125)), d1(jpgName(126))];
    await assign([[gJ, MAJ]]);
    await review();
    await main.click('#dsrGo');
    // the last photos leave Dump → the empty-folder question; the move is committed and metadata
    // started by then — crash right here, mid-metadata
    await main.waitForSelector('#dumpSortOverlay.visible #dsrKeep', { timeout: 60000 });
    const killedWhileActive = await main.evaluate(() => DumpSortMetaChip.states.some(s => s.active));
    const pendingRecs = fs.readdirSync(path.join(ev, '.autoingest', 'dump-sort', 'metadata')).length;
    app.process().kill('SIGKILL');
    await sleep(1500);
    app = null;
    log('killed with metadata active:', killedWhileActive, 'pending records:', pendingRecs);
    app = await launch();
    await H.verifyIsolation(app, iso, ud);
    main = await passSplash(app);
    main.on('dialog', (d) => d.accept().catch(() => {}));
    // The killed run's folder lock is still "active" (30-minute TTL). Resume WAITS for it — the operator
    // releases it explicitly (this computer's own lock only) from the chip, then metadata continues.
    const waitingSeen = await main.waitForFunction(() => window.DumpSortMetaChip && DumpSortMetaChip.states.some(s => s.state === 'waiting' && s.lock && s.lock.self), null, { polling: 100, timeout: 60000 }).then(() => true, () => false);
    const chipW = await main.evaluate(() => ({ text: document.getElementById('dsMetaChip')?.textContent, title: document.getElementById('dsMetaChip')?.title }));
    check(waitingSeen && /waiting for a folder lock/.test(chipW.text || ''), `after restart: metadata waits for the interrupted run's folder lock — never cleared automatically ("${chipW.text}")`);
    await shoot(main, shots, '7-restart-waiting-for-lock');
    await main.click('#dsMetaChip');
    await main.waitForSelector('#dumpSortOverlay.visible #dsrRelease', { timeout: 10000 });
    await shoot(main, shots, '8-release-own-lock');
    await main.click('#dsrRelease');
    const resumed = await waitFor(async () => fs.readdirSync(path.join(ev, '.autoingest', 'dump-sort', 'metadata')).length === 0, 120000);
    check(!!resumed, `after the explicit release the pending metadata finished (record was ${pendingRecs ? 'present' : 'already done'} at the crash)`);
    const kJ = await kw(path.join(ev, MAJ, P1, jpgName(123)));
    check(kJ.includes('Majlis'), `resumed metadata written for the final folder (${J(kJ)})`);
    const treeJ = await listFiles(ev);
    check(gJ.every(p => !fs.existsSync(p)) && treeJ.filter(f => f.startsWith(`${MAJ}/${P1}/`) && f.endsWith('.JPG')).length === 64, 'no duplicate moves after the crash');
    const docJ = JSON.parse(await fsp.readFile(path.join(ev, 'event.json'), 'utf8'));
    check(J(docJ.imports) === J(evDoc.imports) && docJ.dumpSorts.length === 3, `no duplicate import records; ${docJ.dumpSorts.length} sort audit entries`);
    check(!fs.readdirSync(path.join(ev, '.autoingest', 'dump-sort')).some(n => /^ds-.*\.json$/.test(n)), 'no move journal left unfinished');

    // ═══ K: Sort QMZ unaffected ═══
    await setActiveEvent(main, collDir, COLL, E);
    await openEm();
    await main.click(`.ec-evl-item[data-folder="${E}"] .ec-evl-qmz-btn`);
    const qmzOpen = await waitFor(async () => main.evaluate(() => { const o = document.getElementById('qmzOverlay'); return !!o && getComputedStyle(o).display !== 'none' && !o.hidden; }), 15000);
    check(!!qmzOpen, 'Sort QMZ still opens the QMZ manager');

    check(J(H.prodKeychainSnapshot()) === J(prodBefore), 'production Keychain items unchanged (presence only)');
  } catch (err) {
    failures++;
    log('FAIL — exception:', err && err.stack ? err.stack.split('\n').slice(0, 6).join('\n') : err);
  } finally {
    await et.end().catch(() => {});
    try { fs.chmodSync(path.join(ev, QMZ, P1), 0o755); } catch { /* not created */ }
    if (app) await app.close().catch(() => {});
    check(H.removeTestKeychainItem(iso, testKcBefore), 'test Keychain item absent after the run');
    if (!process.env.AI_EQI31_KEEP) await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
  log(failures ? `${failures} FAILURE(S)` : 'ALL CHECKS PASSED');
  process.exitCode = failures ? 1 : 0;
})();
