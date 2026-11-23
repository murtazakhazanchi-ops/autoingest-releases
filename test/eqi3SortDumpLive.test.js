'use strict';
// LIVE (AI-FEAT-064 EQI-3): Sort Dump — Event Management → the standard Import Workspace in Dump mode
// → Move to Event Folders. Real main.js, renderer, Event Management, workspace, groups, copy-free move
// transaction, event.json, ExifTool metadata and Metadata Audit, in an isolated test identity.
//
// The Dump is real: photographer 1's photos come from an Event Dump import through the menu-bar
// companion (RAW+JPEG pairs, metadata written); photographer 2's are placed in Dump with a nested
// card folder; a staging copy of photographer 2's Dump stands for an already-synced Local First import.
//
//   A  Sort Dump appears beside Sort QMZ only for the event whose Dump holds unsorted media
//   B  the normal Import Workspace opens on the whole Dump tree (both photographers, nested folder),
//      no "already imported" marks, thumbnails and preview work
//   C  G1 → component Majlis (photographer 1, pairs + video, one per-photo refinement),
//      G2 → component Waaz (photographer 2, already sequenced there → next PC number)
//   D  review → move → released at once (EQI-3.1: no result modal, metadata in the background); files
//      land in final folders (pairs, XMP, VIDEO/), leave Dump only after; event.json (intent keys,
//      sequences, audit; imports[] unchanged); metadata rewritten for the new component once the
//      background verification finished, and the event's Metadata Audit clean; the staging copy moved too
//   E  empty-folder prompt: Delete Empty Folder (photographer 2), later Keep Folder (photographer 1)
//   F  the rest sorted into the QMZ component (plain folder, never PC); Sort Dump disappears;
//      Sort QMZ still opens the QMZ manager
//   G  an interrupted sort (crash after the hard link) shows "Finish Sort Dump" and completes safely
//
// Run: node test/eqi3SortDumpLive.test.js     AI_EQI3_SHOTS=<dir> keeps the screenshots

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
const COLL = 'CollEQI3';
const P1 = 'Testali Bhai', P2 = 'Testhusain Bhai', P0 = 'Testother Bhai';
const E = '1448-05-01 _01-Majlis-Waaz-QMZ-Hall-Surat', F = '1448-05-01 _02-Ziyafat-Hall-Surat';
const MAJ = 'Majlis-Hall', WAAZ = 'Waaz-Hall', QMZ = 'QMZ-Hall';

let failures = 0;
const log = (...a) => console.log('[eqi3-live]', ...a);
const check = (c, m) => { if (c) log('PASS —', m); else { failures++; log('FAIL —', m); } };
const J = (x) => JSON.stringify(x);
const { sleep, localDate, fakeDrive, waitFor, createHelpers, listFiles, noiseJpeg: _noise } = require('./support/eventDumpLiveHelpers');
const { mainRequire, passSplash, dumpView, importViaPopup, setActiveEvent } = createHelpers({ projectRoot: PROJECT_ROOT });
const noiseJpeg = () => _noise(PROJECT_ROOT);

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
  const work = fs.realpathSync(await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-eqi3-live-')));
  const shots = process.env.AI_EQI3_SHOTS || path.join(work, 'shots');
  await fsp.mkdir(shots, { recursive: true });
  const ud = path.join(work, 'userData'); await fsp.mkdir(ud);
  const archiveRoot = path.join(work, 'archive'); await fsp.mkdir(archiveRoot);
  const stagingRoot = path.join(work, 'staging'); await fsp.mkdir(stagingRoot);
  const collDir = path.join(archiveRoot, COLL);
  const ev = path.join(collDir, E);
  const iso = H.prepareIsolatedApp({ tag: 'eqi3', work, projectRoot: PROJECT_ROOT });
  const prodBefore = H.prodKeychainSnapshot();
  const testKcBefore = H.keychainHas(iso.keychainItem);
  const et = new ExifTool({ maxProcs: 2 });
  const today = localDate();
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const stamp = (time) => `${today.replace(/-/g, ':')} ${time}`;
  const jpg = async (p, time, cam = { Make: 'Canon', Model: 'Canon EOS R5' }) => {
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, await noiseJpeg());
    await et.write(p, { ...cam, DateTimeOriginal: stamp(time), CreateDate: stamp(time) }, { writeArgs: ['-overwrite_original'] });
    return p;
  };

  // photographer 1's card: 6 RAW+JPEG pairs
  const card = path.join(work, 'CARD_A'), c100 = path.join(card, 'DCIM', '100CANON');
  const rawHash = {};
  for (let i = 1; i <= 6; i++) {
    const j = await jpg(path.join(c100, `IMG_000${i}.JPG`), `10:0${i}:00`);
    const r = j.replace(/\.JPG$/, '.CR3');
    await fsp.writeFile(r, crypto.randomBytes(512 * 1024));
    rawHash[`IMG_000${i}.CR3`] = sha(await fsp.readFile(r));
  }

  let app;
  try {
    app = await electron.launch({ executablePath: ELECTRON_BIN, args: [...iso.args, '--user-data-dir=' + ud, '--no-sandbox'], cwd: PROJECT_ROOT, env: iso.env(ud), timeout: 60000 });
    await H.verifyIsolation(app, iso, ud);
    check(true, 'isolation proven (test identity, temp profile, drivelist stub, quit guard)');
    const main = await passSplash(app);
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
    }, { archiveRoot, stagingRoot, names: [P1, P2, P0] });
    const comp = (id, folderName, types) => ({ id, folderName, location: 'Hall', city: 'Surat', country: 'India', types, additionalKeywords: [] });
    await main.evaluate(async ({ defs }) => { for (const [d, data] of defs) await window.api.writeEventJson(d, data); }, { defs: [
      [ev, { version: 1, hijriDate: '1448-05-01', sequence: 1, eventName: 'Majlis-Waaz-QMZ-Hall-Surat', components: [comp(1, MAJ, ['Majlis']), comp(2, WAAZ, ['Waaz']), comp(3, QMZ, ['QMZ'])],
        photographerSequences: { [WAAZ]: { [P0]: { sequence: 1, folderName: `PC01-${P0}` } } } }],
      [path.join(collDir, F), { version: 1, hijriDate: '1448-05-01', sequence: 2, eventName: 'Ziyafat-Hall-Surat', components: [comp(1, 'Ziyafat-Hall', ['Ziyafat'])] }],
    ] });
    await fsp.mkdir(path.join(ev, WAAZ, `PC01-${P0}`), { recursive: true });
    await setActiveEvent(main, collDir, COLL, E);

    // ── the real Dump: photographer 1 through an Event Dump import (companion) ──
    fs.writeFileSync(iso.drivesFile, J([fakeDrive(card, 'CARD_A')]));
    await waitFor(async () => { const v = await dumpView(app); return v.assessment?.state === 'complete' && v.card?.counts?.selectedNew === 12; }, 90000);
    const imp = await importViaPopup(app, P1);
    check(imp.op && imp.op.state === 'completed', `photographer 1 imported into Dump through the companion (${imp.op && imp.op.state})`);
    fs.writeFileSync(iso.drivesFile, J([]));
    await waitFor(async () => !(await dumpView(app)).card, 30000);
    await fsp.mkdir(path.join(ev, 'Dump', P1, 'VIDEO'), { recursive: true });
    await fsp.writeFile(path.join(ev, 'Dump', P1, 'VIDEO', 'MVI_0007.MP4'), crypto.randomBytes(256 * 1024));
    for (const [rel, time] of [['DSC_0101.JPG', '11:01:00'], ['DSC_0102.JPG', '11:02:00'], ['card2/DSC_0201.JPG', '11:03:00']]) {
      await jpg(path.join(ev, 'Dump', P2, rel), time, { Make: 'NIKON CORPORATION', Model: 'NIKON Z 9' });
    }
    // an already-synced Local First staging copy of photographer 2's Dump
    for (const rel of ['DSC_0101.JPG', 'DSC_0102.JPG', 'card2/DSC_0201.JPG']) {
      const dst = path.join(stagingRoot, COLL, E, 'Dump', P2, rel);
      await fsp.mkdir(path.dirname(dst), { recursive: true });
      await fsp.copyFile(path.join(ev, 'Dump', P2, rel), dst);
    }
    const docBefore = JSON.parse(await fsp.readFile(path.join(ev, 'event.json'), 'utf8'));
    check(docBefore.imports.length === 1 && docBefore.imports[0].destination === 'dump', 'event.json has the one Dump import record');
    const dumpBefore = await listFiles(path.join(ev, 'Dump'));
    check(dumpBefore.length === 12 + 6 + 1 + 3, `Dump holds both photographers, XMP sidecars, a video and a nested card folder (${dumpBefore.length} files)`);

    // ═══ A: Event Management ═══
    const openEm = async () => {
      await main.evaluate(() => { if (!EventMgmt.isOpen()) { EventMgmt.open({ mode: 'select' }); EventCreator.start(); } });
      await main.waitForSelector(`.ec-coll-card[data-name="${COLL}"]`, { timeout: 15000 }).catch(() => {});
      if (await main.$(`.ec-coll-card[data-name="${COLL}"]`)) { await main.click(`.ec-coll-card[data-name="${COLL}"]`); await main.click('#ecMasterContinue'); }
      await main.waitForSelector(`.ec-evl-item[data-folder="${E}"]`, { timeout: 15000 });
    };
    const row = (folder) => `.ec-evl-item[data-folder="${folder}"]`;
    await openEm();
    await main.waitForSelector(`${row(E)} .ec-evl-dump-btn`, { timeout: 15000 });
    const emA = await main.evaluate(({ e, f }) => {
      const r = document.querySelector(`.ec-evl-item[data-folder="${e}"]`);
      const btns = [...r.querySelectorAll('button')].map(b => b.className.split(' ')[0]);
      return { btns, label: r.querySelector('.ec-evl-dump-btn').textContent, title: r.querySelector('.ec-evl-dump-btn').title,
        otherHas: !!document.querySelector(`.ec-evl-item[data-folder="${f}"] .ec-evl-dump-btn`) };
    }, { e: E, f: F });
    check(emA.label === 'Sort Dump' && emA.btns.indexOf('ec-evl-dump-btn') === emA.btns.indexOf('ec-evl-qmz-btn') + 1, `Sort Dump sits beside Sort QMZ on the event row (${J(emA.btns)}; "${emA.title}")`);
    check(!emA.otherHas, 'no Sort Dump for an event without Dump media');
    await shoot(main, shots, '1-event-management-sort-dump');

    // ═══ B: the standard Import Workspace on the whole Dump ═══
    await main.click(`${row(E)} .ec-evl-dump-btn`);
    await main.waitForFunction(() => window.DumpSortMode && DumpSortMode.isActive() && document.getElementById('workspace')?.classList.contains('visible'), null, { timeout: 20000 });
    await main.waitForSelector('#dumpSortBanner');
    const ws = await main.evaluate(() => ({ src: activeSource && activeSource.type, tree: JSON.stringify(currentFolderTree || {}), banner: document.getElementById('dumpSortBanner').textContent, eventMgmtOpen: EventMgmt.isOpen() }));
    check(ws.src === 'local-folder' && !ws.eventMgmtOpen, 'Sort Dump opens the normal Import Workspace (folder source), Event Management closed');
    check([P1, P2, 'card2', 'VIDEO'].every(n => ws.tree.includes(n)), 'the left tree holds the whole Dump hierarchy (both photographers, nested card folder, VIDEO)');
    check(/22 unsorted photos/.test(ws.banner) || /unsorted/.test(ws.banner), `Dump-mode banner: "${ws.banner.slice(0, 90)}"`);
    await main.waitForFunction(() => document.querySelectorAll('#fileGrid .file-tile').length >= 16, null, { timeout: 30000 }).catch(async (err) => {
      log('grid diagnostics', J(await main.evaluate(() => ({ view: viewModeType, nav: _folderNavMode, ctx: currentFolderContext && currentFolderContext.path, files: currentFiles.length, tiles: document.querySelectorAll('#fileGrid .file-tile').length, rows: document.querySelectorAll('#fileGrid [data-path]').length, text: document.getElementById('fileGrid').textContent.slice(0, 200) }))));
      throw err;
    });
    const grid = await main.evaluate(() => ({ tiles: document.querySelectorAll('#fileGrid .file-tile').length, imported: document.querySelectorAll('#fileGrid .file-tile.already-imported').length }));
    check(grid.tiles === 16 && grid.imported === 0, `every Dump photo and the video in the grid, none marked "already imported" (${J(grid)})`);
    const thumbs = await waitFor(async () => main.evaluate(() => [...document.querySelectorAll('#fileGrid .file-tile img')].filter(i => i.complete && i.naturalWidth > 0).length).then(n => n >= 6 ? n : null), 30000);
    check(!!thumbs, `thumbnails render (${thumbs})`);
    const pv = await main.evaluate(async (p) => { await openPreview(p); await new Promise(r => setTimeout(r, 600)); const v = !document.getElementById('previewOverlay').classList.contains('hidden'); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return v; }, path.join(ev, 'Dump', P2, 'DSC_0101.JPG'));
    check(pv, 'preview opens for a Dump photo');
    await main.evaluate(() => { const o = document.getElementById('previewOverlay'); if (!o.classList.contains('hidden')) document.getElementById('previewCloseBtn')?.click(); });
    await shoot(main, shots, '2-workspace-dump-mode');

    // ═══ C: groups → components, one per-photo refinement ═══
    const d1 = (n) => path.join(ev, 'Dump', P1, n);
    const g1 = [d1('IMG_0001.CR3'), d1('IMG_0001.JPG'), d1('IMG_0002.CR3'), d1('IMG_0002.JPG'), d1('IMG_0003.JPG'), d1('VIDEO/MVI_0007.MP4')];
    const g2 = ['DSC_0101.JPG', 'DSC_0102.JPG', 'card2/DSC_0201.JPG'].map(n => path.join(ev, 'Dump', P2, n));
    const grp = await main.evaluate(({ g1, g2, maj, waaz }) => {
      const a = GroupManager.createGroup(); GroupManager.assignFiles(g1, a); GroupManager.setSubEvent(a, maj);
      const b = GroupManager.createGroup(); GroupManager.assignFiles(g2, b); GroupManager.setSubEvent(b, waaz);
      for (const p of [...g1, ...g2]) selectedFiles.add(p);
      const uid = GroupManager.getGroups()[0].uid;
      TagRefinementManager.setOverride(uid, [g1[1]], { eventTypes: ['Majlis'], additionalKeywords: [] });
      renderGroupPanel(); renderCurrentView(); updateSelectionBar();
      return { groups: GroupManager.getGroups().map(g => [g.label, g.subEventId, g.files.size]), btn: document.getElementById('importBtn').textContent.trim(), refinable: typeof TagRefinementManager.serializeGroupForImport === 'function' };
    }, { g1, g2, maj: MAJ, waaz: WAAZ });
    check(J(grp.groups) === J([['G1', MAJ, 6], ['G2', WAAZ, 3]]) && grp.refinable, `G1 → ${MAJ}, G2 → ${WAAZ}; Tag Refinement available (${J(grp.groups)})`);
    check(grp.btn === 'Move to Event Folders', `the workspace action reads "Move to Event Folders" (${grp.btn})`);

    // ═══ D: review → move → result ═══
    await main.click('#importBtn');
    await main.waitForSelector('#dumpSortOverlay.visible .dsr-table');
    const review = await main.evaluate(() => ({ rows: [...document.querySelectorAll('#dumpSortOverlay .dsr-table tbody tr')].map(r => [...r.cells].map(c => c.textContent.trim())), sub: document.querySelector('#dumpSortOverlay .dup-subtitle').textContent }));
    check(review.rows.length === 2 && review.rows.some(r => r[0] === MAJ && r[1].startsWith(P1) && r[3] === '7') && review.rows.some(r => r[0] === WAAZ && r[1].startsWith(`PC02-${P2}`) && /next sequence/.test(r[1]) && r[3] === '3'),
      `review: destinations, the RAW of IMG_0003 brought along with its JPEG, next PC number in the sequenced component (${J(review.rows)})`);
    check(/10 files/.test(review.sub) && /XMP/.test(review.sub), `review shows files, size and XMP sidecars ("${review.sub}")`);
    await shoot(main, shots, '3-review');
    await main.click('#dsrGo');
    // ═══ E: empty-folder prompt — photographer 2's folder is empty now (the move itself needs no click) ═══
    await main.waitForSelector('#dumpSortOverlay.visible #dsrDelete', { timeout: 120000 });
    const result = await main.evaluate(() => document.getElementById('dsbLast')?.textContent || '');
    check(/Files moved successfully/.test(result) && /10 files moved/.test(result) && /Metadata verification queued/.test(result) && !/Metadata verified/.test(result), `result: moved, metadata QUEUED — not claimed verified (${J(result)})`);
    await shoot(main, shots, '4-result');
    const prompt = await main.evaluate(() => ({ q: document.querySelector('#dumpSortOverlay .dup-subtitle').textContent, name: document.querySelector('.dsr-folder-name').textContent }));
    check(prompt.q === 'This photographer folder is now empty. Would you like to delete it?' && prompt.name.includes(P2), `empty-folder prompt names the folder (${prompt.name})`);
    await shoot(main, shots, '5-empty-folder-prompt');
    await main.click('#dsrDelete');
    await main.waitForFunction(() => !document.getElementById('dumpSortOverlay')?.classList.contains('visible') && !DumpSortMode.busy, null, { timeout: 20000 });

    const tree = await listFiles(ev);
    const want1 = ['IMG_0001.CR3', 'IMG_0001.JPG', 'IMG_0001.xmp', 'IMG_0002.CR3', 'IMG_0002.JPG', 'IMG_0002.xmp', 'IMG_0003.CR3', 'IMG_0003.JPG', 'IMG_0003.xmp', 'VIDEO/MVI_0007.MP4'].map(n => `${MAJ}/${P1}/${n}`);
    const want2 = ['DSC_0101.JPG', 'DSC_0102.JPG', 'DSC_0201.JPG'].map(n => `${WAAZ}/PC02-${P2}/${n}`);
    check([...want1, ...want2].every(f => tree.includes(f)), 'photos in their final component/photographer folders (pairs, XMP, VIDEO/, nested card folder flattened)');
    check(!tree.some(f => f.startsWith(`Dump/${P2}`)) && !fs.existsSync(path.join(ev, 'Dump', P2)), 'Delete Empty Folder removed only photographer 2\'s empty folder');
    check(tree.filter(f => f.startsWith(`Dump/${P1}/`)).length === 9, 'photographer 1\'s unsorted photos (3 pairs + XMP) stay in Dump');
    check(!tree.some(f => /^Dump\/PC\d/.test(f)) && !tree.some(f => /_1\.(CR3|JPG)$/.test(f)), 'no PC folder in Dump, no "_1" duplicates');
    check(['IMG_0001.CR3', 'IMG_0002.CR3', 'IMG_0003.CR3'].every(n => sha(fs.readFileSync(path.join(ev, MAJ, P1, n))) === rawHash[n]), 'RAW bytes unchanged by the move');
    const doc = JSON.parse(await fsp.readFile(path.join(ev, 'event.json'), 'utf8'));
    check(J(doc.imports) === J(docBefore.imports), 'imports[] unchanged — a sort is not an import');
    check(Array.isArray(doc.dumpSorts) && doc.dumpSorts.length === 1 && doc.dumpSorts[0].movedFiles === 10, `Sort Dump audit entry (${J(doc.dumpSorts && doc.dumpSorts[0] && { files: doc.dumpSorts[0].movedFiles, ph: doc.dumpSorts[0].photographers })})`);
    check(J(doc.photographerSequences[WAAZ][P2]) === J({ sequence: 2, folderName: `PC02-${P2}` }), 'the new PC folder is recorded in photographerSequences');
    check((doc.tagRefinements || []).some(b => b.relPaths.includes(`${MAJ}/${P1}/IMG_0001.JPG`)) && !J(doc).includes(`Dump/${P1}/IMG_0001`), 'per-photo refinement recorded at the final path; no stale Dump path');
    const metaDone = await main.waitForFunction(() => window.DumpSortMetaChip && DumpSortMetaChip.states.length > 0 && DumpSortMetaChip.states.every(s => !s.active), null, { timeout: 120000 }).then(() => true, () => false);
    const metaStates = await main.evaluate(() => DumpSortMetaChip.states.map(s => [s.state, s.total, s.failed]));
    check(metaDone && metaStates.every(([st]) => st === 'complete'), `background metadata finished: ${J(metaStates)}`);
    const kw = async (p) => { const t = await et.read(p); return [].concat(t.Subject || [], t.Keywords || []).map(String); };
    const kMaj = await kw(path.join(ev, MAJ, P1, 'IMG_0002.JPG'));
    const kXmp = await kw(path.join(ev, MAJ, P1, 'IMG_0002.xmp'));
    const kWaaz = await kw(path.join(ev, WAAZ, `PC02-${P2}`, 'DSC_0101.JPG'));
    check(kMaj.includes('Majlis') && kXmp.includes('Majlis') && kWaaz.includes('Waaz'), `metadata rewritten for the new component (JPEG ${J(kMaj)}, RAW sidecar ${J(kXmp)}, Waaz ${J(kWaaz)})`);
    const audit = await main.evaluate(async (root) => {
      const r = await window.api.runMetadataAudit({ type: 'event', rootPath: root });
      const id = r.jobId;
      for (let i = 0; i < 240; i++) { const s = await window.api.getMetadataAuditStatus(id); if (s && /complete|done|finished/.test(s.state || s.status || '')) break; await new Promise(x => setTimeout(x, 500)); }
      const rep = await window.api.getMetadataAuditReport(id, 0, 500, null);
      return { counts: rep.counts, items: (rep.items || []).map(i => [i.relativePath || i.filePath, i.status]) };
    }, ev);
    const movedAudit = audit.items.filter(([p]) => p && !String(p).includes('Dump') && /\.(JPG|CR3)$/.test(p));
    check(movedAudit.length >= 9 && movedAudit.every(([, s]) => s === 'complete'), `Metadata Audit: every moved photo complete (${J(movedAudit.map(x => x[1]))}, exceptions ${audit.counts && audit.counts.exceptions})`);
    const stagingTree = await listFiles(path.join(stagingRoot, COLL, E));
    check(stagingTree.length === 3 && stagingTree.every(f => f.startsWith(`${WAAZ}/PC02-${P2}/`)), `the synced staging copy was moved the same way — nothing left in its Dump to sync back (${J(stagingTree)})`);
    const ws2 = await main.evaluate(() => ({ active: DumpSortMode.isActive(), tiles: document.querySelectorAll('#fileGrid .file-tile').length, groups: GroupManager.getGroups().length, detail: GroupManager.getGroups().map(g => [g.label, g.subEventId, g.files.size]) }));
    check(ws2.active && ws2.groups === 0, `the workspace returns to the remaining Dump photos (${J(ws2)})`);

    // ═══ F: the rest → the QMZ component (plain folder), Keep Folder, Sort Dump disappears ═══
    await main.evaluate(({ files, qmz }) => {
      const a = GroupManager.createGroup(); GroupManager.assignFiles(files, a); GroupManager.setSubEvent(a, qmz);
      for (const p of files) selectedFiles.add(p);
      renderGroupPanel(); updateSelectionBar();
    }, { files: ['IMG_0004.JPG', 'IMG_0005.JPG', 'IMG_0006.JPG'].map(d1), qmz: QMZ });
    await main.click('#importBtn');
    await main.waitForSelector('#dumpSortOverlay.visible #dsrGo').catch(async (err) => {
      log('review diagnostics', J(await main.evaluate(() => ({ overlay: document.getElementById('dumpSortOverlay')?.textContent.slice(0, 500), missing: document.getElementById('missingSubEventOverlay')?.classList.contains('visible'), groups: GroupManager.getGroups().map(g => [g.label, g.subEventId, g.files.size]) }))));
      throw err;
    });
    await main.click('#dsrGo');
    await main.waitForSelector('#dumpSortOverlay.visible #dsrKeep', { timeout: 120000 });
    await main.click('#dsrKeep');
    await main.waitForFunction(() => !(window.DumpSortMode && DumpSortMode.isActive()), null, { timeout: 20000 });
    const tree2 = await listFiles(ev);
    check(['IMG_0004.CR3', 'IMG_0005.JPG', 'IMG_0006.xmp'].every(n => tree2.includes(`${QMZ}/${P1}/${n}`)), 'QMZ component: plain photographer folder, never PC-sequenced');
    check(fs.existsSync(path.join(ev, 'Dump', P1)) && fs.readdirSync(path.join(ev, 'Dump', P1)).every(n => n === 'VIDEO' || n === '.DS_Store'), 'Keep Folder kept photographer 1\'s (now empty) folder');
    await openEm();
    await sleep(1500);
    const emF = await main.evaluate((e) => { const r = document.querySelector(`.ec-evl-item[data-folder="${e}"]`); return { dump: !!r.querySelector('.ec-evl-dump-btn'), qmz: !!r.querySelector('.ec-evl-qmz-btn') }; }, E);
    check(!emF.dump && emF.qmz, 'Sort Dump disappears when nothing is unsorted (the empty Dump folder kept); Sort QMZ still there');
    await main.click(`${row(E)} .ec-evl-qmz-btn`);
    const qmzOpen = await waitFor(async () => main.evaluate(() => { const o = document.getElementById('qmzOverlay'); return !!o && getComputedStyle(o).display !== 'none' && !o.hidden; }), 15000);
    check(!!qmzOpen, 'Sort QMZ still opens the QMZ manager');
    await main.evaluate(() => { document.getElementById('qmzCloseBtn')?.click(); });

    // ═══ G: an interrupted sort ═══
    await jpg(path.join(ev, 'Dump', P0, 'IMG_0900.JPG'), '12:00:00');
    await fsp.mkdir(path.join(ev, MAJ, P0), { recursive: true });
    await fsp.link(path.join(ev, 'Dump', P0, 'IMG_0900.JPG'), path.join(ev, MAJ, P0, 'IMG_0900.JPG'));
    await mainRequire(app, '../services/dumpSortJournal', `return m.write(${J(ev)}, { txId: 'ds-live-crash', phase: 'placing', dumpDir: 'Dump', assets: [{ id: 1, photographer: ${J(P0)}, scopeKey: ${J(MAJ)}, folder: ${J(P0)}, members: [{ role: 'media', kind: 'photo', src: 'Dump/${P0}/IMG_0900.JPG', dest: '${MAJ}/${P0}/IMG_0900.JPG', size: 1 }] }], newFolders: [] }).then(() => true);`);
    await main.evaluate(() => { if (EventMgmt.isOpen()) EventMgmt.close?.(); });
    await openEm();
    await main.waitForSelector(`${row(E)} .ec-evl-dump-btn`, { timeout: 15000 });
    const finishLabel = await main.textContent(`${row(E)} .ec-evl-dump-btn`);
    check(finishLabel === 'Finish Sort Dump', `an interrupted sort is announced in Event Management ("${finishLabel}")`);
    await main.click(`${row(E)} .ec-evl-dump-btn`);
    const recovered = await waitFor(async () => !fs.existsSync(path.join(ev, 'Dump', P0, 'IMG_0900.JPG')) && fs.existsSync(path.join(ev, MAJ, P0, 'IMG_0900.JPG')), 20000);
    check(!!recovered, 'the interrupted move is completed: the photo is only at its destination');
    const docG = JSON.parse(await fsp.readFile(path.join(ev, 'event.json'), 'utf8'));
    check(docG.dumpSorts.some(s => s.id === 'ds-live-crash') && J(docG.imports) === J(docBefore.imports), 'recovery recorded its audit entry; still no new import record');

    check(J(H.prodKeychainSnapshot()) === J(prodBefore), 'production Keychain items unchanged (presence only)');
  } catch (err) {
    failures++;
    log('FAIL — exception:', err && err.stack ? err.stack.split('\n').slice(0, 6).join('\n') : err);
  } finally {
    await et.end().catch(() => {});
    if (app) await app.close().catch(() => {});
    check(H.removeTestKeychainItem(iso, testKcBefore), 'test Keychain item absent after the run');
    if (!process.env.AI_EQI3_KEEP) await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
  log(failures ? `${failures} FAILURE(S)` : 'ALL CHECKS PASSED');
  process.exitCode = failures ? 1 : 0;
})();
