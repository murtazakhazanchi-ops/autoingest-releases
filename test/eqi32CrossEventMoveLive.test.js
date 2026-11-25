'use strict';
// LIVE (AI-FEAT-064 EQI-3.2): Move Selection to Another Event + the integrated EQI-3.1/EQI-3.2 rehearsal.
// Real main.js, renderer, Event Management, Event Creator, Import Workspace, groups, both transactions,
// event.json, ExifTool metadata and Metadata Audit — isolated test identity, temp profile, synthetic archive.
//
//   A  Sort Dump of Event A sorts some photos into A's components (EQI-3.1, background metadata)
//   B  "Move Selection to Another Event" is in the Sort Dump banner; the dialog searches the collection's
//      events (the source excluded), reviews (counts, RAW/JPEG/XMP, destinations, the "moved, not imported"
//      statement), moves to B's Dump; empty-folder prompt (Keep); the workspace stays on A with the other
//      photos, the unrelated group and the remaining selection intact; both records reconciled
//   C  Create New Event (the real Event Creator form): Back returns unchanged; creating returns to the SAME
//      Sort Dump with the new event as destination, current event still A; then → its final folder
//   D  → B's final component: the next PC number in B's sequenced component, RAW/XMP pair together
//   E  Change Event still asks to close Sort Dump (EQI-3.1 protection unchanged)
//   F  B's Sort Dump offers the transferred photos and sorts them normally; no import record anywhere
//   G  metadata verified in the background; Metadata Audit on both events
//   H  SIGKILL during a transfer → restart → Sort Dump of A completes it; no loss, no duplicate history
//
// Run: node test/eqi32CrossEventMoveLive.test.js     AI_EQI32_SHOTS=<dir> keeps the screenshots

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
const COLL = 'CollEQI32';
const P1 = 'Testali Bhai', P2 = 'Testhusain Bhai', P0 = 'Testother Bhai';
const A = '1448-06-01 _01-Majlis-Waaz-Hall-Surat', B = '1448-06-02 _01-Majlis-Ziyafat-Hall-Surat';
const MAJ = 'Majlis-Hall', WAAZ = 'Waaz-Hall', ZIY = 'Ziyafat-Hall';

let failures = 0;
const log = (...a) => console.log('[eqi32-live]', ...a);
const check = (c, m) => { if (c) log('PASS —', m); else { failures++; log('FAIL —', m); } };
const J = (x) => JSON.stringify(x);
const { sleep, waitFor, createHelpers, listFiles, noiseJpeg: _noise } = require('./support/eventDumpLiveHelpers');
const { passSplash, setActiveEvent } = createHelpers({ projectRoot: PROJECT_ROOT });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const XMP = "<?xpacket begin='' id='W5M0MpCehiHzreSzNTczkc9d'?><x:xmpmeta xmlns:x='adobe:ns:meta/'><rdf:RDF xmlns:rdf='http://www.w3.org/1999/02/22-rdf-syntax-ns#'></rdf:RDF></x:xmpmeta><?xpacket end='w'?>";
const img = (i) => `IMG_${String(i).padStart(4, '0')}.JPG`;
const dsc = (i) => `DSC_${String(i).padStart(4, '0')}.JPG`;

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
  const work = fs.realpathSync(await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-eqi32-live-')));
  const shots = process.env.AI_EQI32_SHOTS || path.join(work, 'shots');
  await fsp.mkdir(shots, { recursive: true });
  const ud = path.join(work, 'userData'); await fsp.mkdir(ud);
  const archiveRoot = path.join(work, 'archive'); await fsp.mkdir(archiveRoot);
  const stagingRoot = path.join(work, 'staging'); await fsp.mkdir(stagingRoot);
  const collDir = path.join(archiveRoot, COLL);
  const evA = path.join(collDir, A), evB = path.join(collDir, B);
  const iso = H.prepareIsolatedApp({ tag: 'eqi32', work, projectRoot: PROJECT_ROOT });
  const prodBefore = H.prodKeychainSnapshot();
  const testKcBefore = H.keychainHas(iso.keychainItem);
  const et = new ExifTool({ maxProcs: 2 });
  const launch = () => electron.launch({ executablePath: ELECTRON_BIN, args: [...iso.args, '--user-data-dir=' + ud, '--no-sandbox'], cwd: PROJECT_ROOT, env: iso.env(ud), timeout: 60000 });

  // ── synthetic archive ──
  const a1 = (n) => path.join(evA, 'Dump', P1, n);
  const a2 = (n) => path.join(evA, 'Dump', P2, n);
  const basePath = path.join(work, 'base.jpg');
  await fsp.writeFile(basePath, await _noise(PROJECT_ROOT, 240, 240));
  await et.write(basePath, { Make: 'Canon', Model: 'Canon EOS R5', DateTimeOriginal: '2026:11:20 10:00:00' }, { writeArgs: ['-overwrite_original'] });
  await fsp.mkdir(path.join(evA, 'Dump', P1), { recursive: true });
  await fsp.mkdir(path.join(evA, 'Dump', P2), { recursive: true });
  for (let i = 1; i <= 30; i++) await fsp.copyFile(basePath, a1(img(i)));
  for (let i = 1; i <= 6; i++) await fsp.copyFile(basePath, a2(dsc(i)));
  const rawHash = {};
  for (const i of [901, 902]) {
    await fsp.copyFile(basePath, a1(`IMG_0${i}.JPG`));
    const r = crypto.randomBytes(300 * 1024);
    await fsp.writeFile(a1(`IMG_0${i}.CR3`), r);
    rawHash[i] = sha(r);
    await fsp.writeFile(a1(`IMG_0${i}.xmp`), XMP);
  }
  await fsp.writeFile(a1('MVI_0001.MP4'), crypto.randomBytes(200 * 1024));
  for (let i = 1; i <= 300; i++) await fsp.copyFile(basePath, path.join(evA, 'Dump', P1, 'bulk', `BLK_${String(i).padStart(4, '0')}.JPG`)).catch(async () => { await fsp.mkdir(path.join(evA, 'Dump', P1, 'bulk'), { recursive: true }); await fsp.copyFile(basePath, path.join(evA, 'Dump', P1, 'bulk', `BLK_${String(i).padStart(4, '0')}.JPG`)); });
  await fsp.mkdir(path.join(evB, MAJ, `PC01-${P0}`), { recursive: true });
  const comp = (id, folderName, types) => ({ id, folderName, location: 'Hall', city: 'Surat', country: 'India', types, additionalKeywords: [] });
  const docA0 = { version: 1, hijriDate: '1448-06-01', sequence: 1, eventName: 'Majlis-Waaz-Hall-Surat', components: [comp(1, MAJ, ['Majlis']), comp(2, WAAZ, ['Waaz'])],
    imports: [{ id: 'imp-a-p1', timestamp: new Date().toISOString(), photographer: P1, destination: 'dump', counts: { photos: 334, videos: 1 } }, { id: 'imp-a-p2', timestamp: new Date().toISOString(), photographer: P2, destination: 'dump', counts: { photos: 6, videos: 0 } }] };
  const docB0 = { version: 1, hijriDate: '1448-06-02', sequence: 1, eventName: 'Majlis-Ziyafat-Hall-Surat', components: [comp(1, MAJ, ['Majlis']), comp(2, ZIY, ['Ziyafat'])],
    photographerSequences: { [MAJ]: { [P0]: { sequence: 1, folderName: `PC01-${P0}` } } }, imports: [] };

  let app, main;
  const readDoc = async (ev) => JSON.parse(await fsp.readFile(path.join(ev, 'event.json'), 'utf8'));
  const overlayText = () => main.evaluate(() => document.getElementById('dumpSortOverlay')?.textContent.replace(/\s+/g, ' ') || '');
  const openEm = async () => {
    await main.evaluate(() => { if (!EventMgmt.isOpen()) { EventMgmt.open({ mode: 'select' }); EventCreator.start(); } });
    await main.waitForSelector(`.ec-coll-card[data-name="${COLL}"]`, { timeout: 15000 }).catch(() => {});
    if (await main.$(`.ec-coll-card[data-name="${COLL}"]`)) { await main.click(`.ec-coll-card[data-name="${COLL}"]`); await main.click('#ecMasterContinue'); }
    await main.waitForSelector('.ec-evl-item', { timeout: 15000 });
  };
  const openSortDump = async (folder, minTiles) => {
    await openEm();
    await main.waitForSelector(`.ec-evl-item[data-folder="${folder}"] .ec-evl-dump-btn`, { timeout: 15000 });
    await main.click(`.ec-evl-item[data-folder="${folder}"] .ec-evl-dump-btn`);
    await main.waitForFunction(() => window.DumpSortMode && DumpSortMode.isActive() && document.getElementById('workspace')?.classList.contains('visible'), null, { polling: 100, timeout: 30000 });
    await main.waitForFunction((n) => document.querySelectorAll('#fileGrid .file-tile').length >= n, minTiles, { polling: 100, timeout: 60000 });
  };
  const select = (paths) => main.evaluate((ps) => { selectedFiles.clear(); for (const p of ps) selectedFiles.add(p); updateSelectionBar(); return selectedFiles.size; }, paths);
  const settle = () => main.waitForFunction(() => !document.getElementById('dumpSortOverlay')?.classList.contains('visible') && !DumpSortMode.busy, null, { polling: 100, timeout: 180000 });
  const openMove = async () => {
    await main.click('#dsbMoveOther');
    await main.waitForSelector('#dumpSortOverlay.visible #xemSearch', { timeout: 15000 });
  };
  const chooseDest = async (folder) => {
    await main.fill('#xemSearch', folder.slice(0, 14));
    await main.click(`.xem-event[data-path$="${folder}"]`);
    await main.waitForSelector(`.xem-event.selected[data-path$="${folder}"]`, { timeout: 5000 });
  };
  const reviewMove = async () => {
    await main.click('#xemReview');
    await main.waitForFunction(() => !!document.querySelector('#dumpSortOverlay.visible .xem-statement'), null, { timeout: 30000 });
  };
  const answerEmpty = async (choice) => {
    const prompts = [];
    for (;;) {
      // One condition, one timeout: the next empty-folder prompt, or the move fully finished (not busy).
      const s = await main.waitForFunction(() => {
        const o = document.getElementById('dumpSortOverlay');
        const open = !!o && o.classList.contains('visible');
        if (open && o.querySelector('#dsrKeep')) return 'prompt';
        return !open && !DumpSortMode.busy ? 'settled' : false;
      }, null, { polling: 100, timeout: 180000 }).then(h => h.jsonValue(), () => 'timeout');
      if (s !== 'prompt') break;
      prompts.push(await main.evaluate(() => document.querySelector('.dsr-folder-name')?.textContent || ''));
      await main.click(choice === 'delete' ? '#dsrDelete' : '#dsrKeep');
      await sleep(300);
    }
    await settle();
    return prompts;
  };
  const metaSettled = () => main.waitForFunction(() => DumpSortMetaChip.states.length > 0 && DumpSortMetaChip.states.every(s => !s.active && s.state !== 'waiting'), null, { polling: 200, timeout: 300000 }).then(() => true, () => false);
  const audit = (root) => main.evaluate(async (r) => {
    const j = await window.api.runMetadataAudit({ type: 'event', rootPath: r });
    for (let i = 0; i < 480; i++) { const s = await window.api.getMetadataAuditStatus(j.jobId); if (s && /complete|done|finished/.test(s.state || s.status || '')) break; await new Promise(x => setTimeout(x, 500)); }
    const rep = await window.api.getMetadataAuditReport(j.jobId, 0, 2000, null);
    return { counts: rep.counts, items: (rep.items || []).map(i => [i.relativePath || i.filePath, i.status]) };
  }, root);
  const setup = async () => {
    main = await passSplash(app);
    main.on('dialog', (d) => d.accept().catch(() => {}));
    // Diagnostics: why a page would go away (renderer crash vs a window closed by the app).
    main.on('crash', () => log('DIAG — main window renderer crashed'));
    main.on('close', () => log('DIAG — main window closed'));
    // Main-process probe: which window closes, whether JS asked for it (stack), whether it was focused,
    // and every Cmd/Ctrl keystroke delivered to a window (an external Cmd+W would show here).
    await app.evaluate(({ BrowserWindow, app: eApp }) => {
      global.__diag = global.__diag || [];
      const hook = (w) => {
        if (w.__diagHooked) return; w.__diagHooked = true;
        const page = () => { try { return w.webContents.getURL().split('/').pop(); } catch { return '?'; } };
        w.webContents.on('before-input-event', (_e, i) => { if (i.meta || i.control) global.__diag.push({ t: Date.now(), key: i.key, meta: i.meta, type: i.type, page: page() }); });
        w.on('close', () => global.__diag.push({ t: Date.now(), close: page(), focused: w.isFocused(), stack: (new Error().stack || '').split('\n').slice(2, 7).join(' | ') }));
      };
      BrowserWindow.getAllWindows().forEach(hook);
      if (!BrowserWindow.prototype.__diagWrapped) {
        BrowserWindow.prototype.__diagWrapped = true;
        for (const m of ['close', 'destroy', 'hide']) {
          const orig = BrowserWindow.prototype[m];
          BrowserWindow.prototype[m] = function (...a) {
            let page = '?'; try { page = this.webContents.getURL().split('/').pop(); } catch { /* destroyed */ }
            global.__diag.push({ t: Date.now(), call: m, page, stack: (new Error().stack || '').split('\n').slice(2, 9).map(x => x.trim().replace(/\(\/.*\/([^/]+:\d+:\d+)\)/, '($1)')).join(' | ') });
            return orig.apply(this, a);
          };
        }
      }
      eApp.on('browser-window-created', (_e, w) => hook(w));
    }).catch(err => log('DIAG — probe not installed', err.message));
  };

  try {
    app = await launch();
    await H.verifyIsolation(app, iso, ud);
    check(true, 'isolation proven (test identity, temp profile, drivelist stub, quit guard)');
    await setup();
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
    await main.evaluate(async ({ defs }) => { for (const [d, data] of defs) await window.api.writeEventJson(d, data); }, { defs: [[evA, docA0], [evB, docB0]] });
    await setActiveEvent(main, collDir, COLL, A);

    // ═══ A: Sort Dump of A sorts 10 photos into A's Majlis (EQI-3.1) ═══
    await openSortDump(A, 40);
    await main.evaluate(({ files }) => { GroupManager.reset(); const g = GroupManager.createGroup(); GroupManager.assignFiles(files, g); GroupManager.setSubEvent(g, 'Majlis-Hall'); for (const p of files) selectedFiles.add(p); renderGroupPanel(); updateSelectionBar(); }, { files: Array.from({ length: 10 }, (_, i) => a1(img(i + 1))) });
    await main.click('#importBtn');
    await main.waitForSelector('#dumpSortOverlay.visible #dsrGo', { timeout: 30000 });
    const t0 = Date.now();
    await main.click('#dsrGo');
    await answerEmpty('keep');
    log(`A sort released the operator after ${Date.now() - t0} ms`);
    check((await listFiles(path.join(evA, MAJ))).length === 10, 'A: 10 photos sorted into A\'s Majlis (existing Sort Dump)');

    // ═══ B: Move Selection to Another Event → B's Dump ═══
    const unrelated = Array.from({ length: 5 }, (_, i) => a1(img(i + 11)));
    await main.evaluate(({ files }) => { GroupManager.reset(); const g = GroupManager.createGroup(); GroupManager.assignFiles(files, g); GroupManager.setSubEvent(g, 'Majlis-Hall'); renderGroupPanel(); }, { files: unrelated });
    const toB = [...Array.from({ length: 10 }, (_, i) => a1(img(i + 21))), a1('IMG_0901.JPG'), a1('MVI_0001.MP4'), ...Array.from({ length: 6 }, (_, i) => a2(dsc(i + 1)))];
    const tilesBefore = await main.evaluate(() => document.querySelectorAll('#fileGrid .file-tile').length);
    check(await select(toB) === 18, '18 photos selected (10 JPEG, 1 RAW+JPEG pair, 1 video of P1; 6 of P2)');
    const btn = await main.evaluate(() => { const b = document.getElementById('dsbMoveOther'); return b ? { text: b.textContent.trim(), inBanner: !!b.closest('#dumpSortBanner'), visible: b.offsetWidth > 0 } : null; });
    check(btn && btn.text === 'Move Selection to Another Event' && btn.inBanner && btn.visible, `the action is in the Sort Dump banner (${J(btn)})`);
    await openMove();
    const dlg = await main.evaluate(() => ({ text: document.getElementById('dumpSortOverlay').textContent.replace(/\s+/g, ' '), events: [...document.querySelectorAll('.xem-event')].map(e => e.dataset.path.split('/').pop()) }));
    check(dlg.events.length === 1 && dlg.events[0] === B && !dlg.events.includes(A), `destination list = the collection's other events, source excluded (${J(dlg.events)})`);
    check(/Selected photos \(18\)/.test(dlg.text) && /G1/.test(dlg.text) && /current event does not change/.test(dlg.text), 'photos: the selection or a group; the current event is said to stay');
    await shoot(main, shots, '1-move-dialog');
    await main.fill('#xemSearch', 'zzz-no-match');
    check(await main.evaluate(() => /No event matches/.test(document.getElementById('xemList').textContent)), 'search filters the events');
    await chooseDest(B);
    check(await main.evaluate(() => document.querySelector('input[name="xemKind"][value="dump"]').checked && !document.getElementById('xemComponent')), 'default destination: B\'s Dump (no component selector shown)');
    check(await main.evaluate((a) => EventCreator.getActiveEventData()?.eventPath?.endsWith(a), A) && await main.evaluate(() => DumpSortMode.isActive()), 'choosing a destination did not change the current event');
    await reviewMove();
    const rv = await overlayText();
    check(/From/.test(rv) && rv.includes(A) && rv.includes(B) && /Dump \(sorted later with Sort Dump\)/.test(rv), 'review: source, destination, destination type');
    check(/19 files/.test(rv) && /1 RAW/.test(rv) && /17 JPEG\/photo/.test(rv) && /1 video/.test(rv) && /1 XMP sidecar/.test(rv), `review: counts by kind (${(rv.match(/Files.{0,120}/) || [''])[0]})`);
    check(rv.includes(P1) && rv.includes(P2) && rv.includes(`${B}/Dump/${P1}`) && rv.includes(`${B}/Dump/${P2}`), 'review: each photographer has its own destination folder');
    check(/These photographs will be moved, not imported again\. They will leave the source event only after the destination is verified\./.test(rv), 'review: the moved-not-imported statement');
    check(/Left in this Dump/.test(rv) && /Same collection/.test(rv), 'review: remaining count and archive state');
    await shoot(main, shots, '2-move-review');
    await main.click('#xemGo');
    const prompts = await answerEmpty('keep');
    check(prompts.length === 1 && prompts[0].includes(P2), `empty-folder prompt for the emptied photographer folder only (${J(prompts)})`);
    const after = await main.evaluate(({ moved, unrelated }) => ({
      active: DumpSortMode.isActive(), event: EventCreator.getActiveEventData()?.eventPath, tiles: document.querySelectorAll('#fileGrid .file-tile').length,
      movedTiles: moved.filter(p => tileMap.has(p)).length, group: GroupManager.getGroups().map(g => [g.subEventId, g.files.size, unrelated.every(p => g.files.has(p))]),
      sel: selectedFiles.size, last: document.getElementById('dsbLast')?.textContent || '', em: EventMgmt.isOpen(), confirm: document.getElementById('eventImportOverlay')?.classList.contains('visible') || false,
    }), { moved: toB, unrelated });
    check(after.active && after.event.endsWith(A) && !after.em && !after.confirm, 'workspace still Sort Dump of A — no navigation, no Confirm Event Import');
    check(after.movedTiles === 0 && after.tiles === tilesBefore - 19, `moved photos (19 tiles: the RAW has its own) left the grid (${tilesBefore} → ${after.tiles})`);
    check(J(after.group) === J([[MAJ, 5, true]]) && after.sel === 0, `unrelated group kept (${J(after.group)})`);
    check(/19 photos moved to .*'s Dump/.test(after.last) && /Metadata verification queued/.test(after.last), `banner outcome: "${after.last}"`);
    await shoot(main, shots, '3-after-move');
    const treeB = await listFiles(evB);
    check(treeB.filter(f => f.startsWith(`Dump/${P1}/`)).length === 14 && treeB.filter(f => f.startsWith(`Dump/${P2}/`)).length === 6, 'B\'s Dump holds the photos under their own photographers (14 + 6 files)');
    check(sha(fs.readFileSync(path.join(evB, 'Dump', P1, 'IMG_0901.CR3'))) === rawHash[901] && fs.existsSync(path.join(evB, 'Dump', P1, 'IMG_0901.xmp')), 'RAW bytes unchanged; XMP moved with its RAW');
    check(toB.every(p => !fs.existsSync(p)) && !fs.existsSync(a1('IMG_0901.CR3')) && fs.existsSync(path.join(evA, 'Dump', P2)), 'A\'s Dump no longer holds them; the empty P2 folder was kept (Keep Folder)');
    let dA = await readDoc(evA), dB = await readDoc(evB);
    check(J(dA.imports) === J(docA0.imports) && J(dB.imports) === '[]', 'imports[] of both events unchanged — no new import');
    check(dB.transfersIn && dB.transfersIn.length === 1 && dB.transfersIn[0].movedFiles === 19 && J(dB.transfersIn[0].originalImports.map(i => i.id).sort()) === J(['imp-a-p1', 'imp-a-p2']) && dB.transfersIn[0].fromEvent.folder === A, 'B: transfersIn with original import provenance and source event');
    check(dA.transfersOut && dA.transfersOut.length === 1 && dA.transfersOut[0].toEvent.folder === B && dA.transfersOut[0].id === dB.transfersIn[0].id, 'A: transfersOut with the same transaction id');
    check(!fs.readdirSync(path.join(evA, '.autoingest', 'dump-sort', 'transfers')).some(n => n.endsWith('.json')) && !(fs.readdirSync(path.join(evB, '.autoingest', 'dump-sort', 'transfers-in')).length), 'journal finished, inbound marker removed');

    // ═══ C: Create New Event (the real Event Creator) as the destination ═══
    const toC = [a1(img(16)), a1(img(17)), a1(img(18))];
    await select(toC);
    await openMove();
    await main.click('#xemCreate');
    await main.waitForFunction(() => EventMgmt.isOpen(), null, { timeout: 8000 });
    await main.waitForSelector('#ecNewEventFromList', { timeout: 15000 });
    await main.click('#emmBackBtn');
    await main.waitForSelector('#dumpSortOverlay.visible #xemSearch', { timeout: 15000 });
    const back = await main.evaluate(() => ({ active: DumpSortMode.isActive(), em: EventMgmt.isOpen(), sel: selectedFiles.size, ev: EventCreator.getActiveEventData()?.eventPath }));
    check(back.active && !back.em && back.sel === 3 && back.ev.endsWith(A), `Back from the Event Creator returns to the same dialog, nothing changed (${J(back)})`);
    await main.click('#xemCreate');
    await main.waitForSelector('#ecNewEventFromList', { timeout: 15000 });
    await main.click('#ecNewEventFromList');
    await main.waitForSelector('#evHijriYear', { timeout: 10000 });
    await main.fill('#evHijriYear', '1448'); await main.fill('#evHijriMonth', '06'); await main.fill('#evHijriDay', '03');
    const compId = await main.evaluate(() => document.querySelector('.ec-comp-row').dataset.compId);
    const tac = async (sel, label) => { const c = main.locator(sel); await c.locator('input').click(); await c.locator('input').fill(label); await c.locator('.tac-item').first().waitFor({ state: 'visible', timeout: 5000 }); await c.locator('.tac-item').first().click(); await main.waitForTimeout(150); };
    await tac(`#ecET-${compId}`, 'Ziyarat');
    await tac('#ecGlobalCityDD', 'Mundra');
    await main.waitForTimeout(400);
    await main.click('#emmCreateBtn');
    await main.waitForSelector('#dumpSortOverlay.visible #xemSearch', { timeout: 30000 });
    const created = (await fsp.readdir(collDir)).find(n => n.startsWith('1448-06-03'));
    const evC = created ? path.join(collDir, created) : null;
    const ret = await main.evaluate((c) => ({ active: DumpSortMode.isActive(), ev: EventCreator.getActiveEventData()?.eventPath, sel: selectedFiles.size, group: GroupManager.getGroups().map(g => g.files.size), chosen: document.querySelector('.xem-event.selected')?.dataset.path || '', note: document.querySelector('.xem-note-ok')?.textContent || '', em: EventMgmt.isOpen() }), created);
    check(!!created && ret.active && ret.ev.endsWith(A) && !ret.em, `created ${created}; back in the SAME Sort Dump, current event still A`);
    check(ret.chosen.endsWith(created || '?') && /Nothing has been moved/.test(ret.note), `the new event is the selected destination ("${ret.note}")`);
    check(ret.sel === 3 && J(ret.group) === '[5]', 'selection and G1 assignments preserved through Create New Event');
    await shoot(main, shots, '4-created-destination');
    await main.click('input[name="xemKind"][value="component"]');
    await reviewMove();
    const rvC = await overlayText();
    check(rvC.includes(created) && /Final component/.test(rvC) && /3 files/.test(rvC), 'review for the new event\'s final folder');
    await main.click('#xemGo');
    await answerEmpty('keep');
    const treeC = evC ? await listFiles(evC) : [];
    check(toC.every(p => !fs.existsSync(p)) && treeC.filter(f => f.endsWith('.JPG')).length === 3, `photos in the new event's folder (${J(treeC.filter(f => f.endsWith('.JPG')).slice(0, 3))})`);

    // ═══ D: → B's final component (sequenced): next PC number, RAW/XMP together ═══
    await select([a1(img(19)), a1(img(20)), a1('IMG_0902.JPG')]);
    await openMove();
    await chooseDest(B);
    await main.click('input[name="xemKind"][value="component"]');
    await main.selectOption('#xemComponent', MAJ);
    await reviewMove();
    const rvD = await overlayText();
    check(/new · PC02/.test(rvD) && rvD.includes(`${B}/${MAJ}/PC02-${P1}`) && /New photographer sequence: PC02-/.test(rvD), 'review shows the new PC02 sequence in B\'s Majlis');
    await shoot(main, shots, '5-review-component');
    await main.click('#xemGo');
    await answerEmpty('keep');
    const pc2 = await listFiles(path.join(evB, MAJ, `PC02-${P1}`));
    check(J(pc2) === J([img(19), img(20), 'IMG_0902.CR3', 'IMG_0902.JPG', 'IMG_0902.xmp'].sort()), `B/Majlis/PC02-${P1}: ${J(pc2)}`);
    dB = await readDoc(evB);
    check(J(dB.photographerSequences[MAJ][P1]) === J({ sequence: 2, folderName: `PC02-${P1}` }) && dB.transfersIn.length === 2, 'B photographerSequences records PC02; two transfers in');

    // ═══ E: Change Event keeps the EQI-3.1 protection ═══
    await main.click('#ctxChangeEventBtn');
    await main.waitForSelector('#dumpSortOverlay.visible #dsrStay', { timeout: 10000 });
    check(/Close Sort Dump\?/.test(await overlayText()), 'Change Event still asks "Close Sort Dump?"');
    await main.click('#dsrStay');
    check(await main.evaluate(() => DumpSortMode.isActive() && GroupManager.getGroups().length === 1), 'Stay keeps the Sort Dump workspace and its group');

    // ═══ G (part): background metadata for A's sort and B's transfers ═══
    const metaOk = await metaSettled();
    const st = await main.evaluate(() => DumpSortMetaChip.states.map(s => ({ ev: s.eventName, state: s.state, total: s.total, verified: s.verified, written: s.written, failed: s.failed })));
    check(metaOk && st.length >= 3 && st.every(s => s.state === 'complete'), `background metadata completed for every move (${J(st)})`);

    // ═══ F: B's Sort Dump sorts the transferred photos normally ═══
    await main.click('#ctxChangeEventBtn');
    await main.waitForSelector('#dumpSortOverlay.visible #dsrLeave', { timeout: 10000 });
    await main.click('#dsrLeave');
    await setActiveEvent(main, collDir, COLL, A);
    await openEm();
    const dumpBtnB = await main.$(`.ec-evl-item[data-folder="${B}"] .ec-evl-dump-btn`);
    check(!!dumpBtnB, 'Event Management offers Sort Dump for B (the transferred photos)');
    await openSortDump(B, 17);
    const bTiles = await main.evaluate(() => [...tileMap.keys()]);
    check(bTiles.length >= 17, `B's Sort Dump shows the transferred photos (${bTiles.length} tiles)`);
    await main.evaluate(({ files }) => { GroupManager.reset(); const g = GroupManager.createGroup(); GroupManager.assignFiles(files, g); GroupManager.setSubEvent(g, 'Majlis-Hall'); for (const p of files) selectedFiles.add(p); renderGroupPanel(); updateSelectionBar(); }, { files: bTiles });
    await main.click('#importBtn');
    await main.waitForSelector('#dumpSortOverlay.visible #dsrGo', { timeout: 30000 });
    await main.click('#dsrGo');
    await answerEmpty('delete');
    const treeB2 = await listFiles(evB);
    check(treeB2.filter(f => f.startsWith('Dump/')).length === 0, 'B\'s Dump fully sorted');
    check(treeB2.filter(f => f.startsWith(`${MAJ}/PC02-${P1}/`) && /\.(JPG|CR3|MP4)$/.test(f)).length === 4 + 13 && treeB2.some(f => f.startsWith(`${MAJ}/PC03-${P2}/`)), 'B sort reused PC02 for P1 and allocated PC03 for P2');
    dB = await readDoc(evB);
    check(J(dB.imports) === '[]' && dB.dumpSorts.length === 1 && dB.transfersIn.length === 2, 'B: still no import record; one Sort Dump audit, two transfers');
    check(!J([dB.tagRefinements || [], dB.metadataGroups || []]).includes('Dump/'), 'no stale Dump path in B\'s active intent records (audit entries keep the from → to paths)');
    dA = await readDoc(evA);
    check(!J(dA).includes(`Dump/${P1}/${img(21)}`) || J(dA.transfersOut).includes(`Dump/${P1}/${img(21)}`), 'A\'s active records no longer point at moved files (audit paths only)');

    // ═══ G: Metadata Audit on both events ═══
    await metaSettled();
    const auB = await audit(evB);
    const finalB = auB.items.filter(([p]) => p && !String(p).includes('/Dump/') && /\.(JPG|CR3)$/i.test(p));
    check(finalB.length >= 20 && finalB.every(([, s]) => s === 'complete'), `Metadata Audit B: final photos complete (${finalB.length}; ${J([...new Set(finalB.map(x => x[1]))])})`);
    const auA = await audit(evA);
    const finalA = auA.items.filter(([p]) => p && String(p).includes(MAJ) && /\.JPG$/i.test(p));
    check(finalA.length === 10 && finalA.every(([, s]) => s === 'complete'), `Metadata Audit A: sorted photos complete (${finalA.length}; ${J(auA.counts)})`);
    const kB = await et.read(path.join(evB, MAJ, `PC02-${P1}`, img(21)));
    check([].concat(kB.Subject || [], kB.Keywords || []).map(String).includes('Majlis'), 'B photos carry B\'s component keywords');

    // ═══ H: SIGKILL during a transfer → restart → completed exactly once ═══
    await main.click('#ctxChangeEventBtn').catch(() => {});
    await setActiveEvent(main, collDir, COLL, A);
    await openSortDump(A, 40);
    const bulk = Array.from({ length: 300 }, (_, i) => path.join(evA, 'Dump', P1, 'bulk', `BLK_${String(i + 1).padStart(4, '0')}.JPG`));
    await select(bulk);
    await openMove();
    await chooseDest(B);
    await reviewMove();
    await main.click('#xemGo');
    let killedAt = -1;
    for (let i = 0; i < 4000; i++) {
      const n = (await fsp.readdir(path.join(evB, 'Dump', P1, 'bulk')).catch(() => [])).length;
      if (n > 0) { killedAt = n; break; }
      await sleep(2);
    }
    app.process().kill('SIGKILL');
    await sleep(1500);
    const inB = (await fsp.readdir(path.join(evB, 'Dump', P1, 'bulk')).catch(() => [])).length;
    const inA = (await fsp.readdir(path.join(evA, 'Dump', P1, 'bulk')).catch(() => [])).length;
    log(`killed with ${killedAt} placed; after kill: ${inA} in A, ${inB} in B`);
    check(bulk.every(p => fs.existsSync(p) || fs.existsSync(p.replace(evA, evB))), 'after SIGKILL every photo exists in A or B');
    app = await launch();
    await setup();
    await setActiveEvent(main, collDir, COLL, A);
    const pendingBefore = fs.readdirSync(path.join(evA, '.autoingest', 'dump-sort', 'transfers')).filter(n => n.endsWith('.json')).length;
    await openEm();
    const hasBtn = await main.$(`.ec-evl-item[data-folder="${A}"] .ec-evl-dump-btn`);
    check(!!hasBtn || pendingBefore === 0, 'after the restart Event Management offers Sort Dump for A (interrupted transfer pending)');
    let released = false;
    if (hasBtn) {
      await main.click(`.ec-evl-item[data-folder="${A}"] .ec-evl-dump-btn`);
      // The killed run's NAS folder locks are this computer's: released only explicitly (EQI-3.1), then completed.
      const s = await Promise.race([
        main.waitForSelector('#dumpSortOverlay.visible #dsrRelease', { timeout: 60000 }).then(() => 'lock'),
        main.waitForFunction(() => window.DumpSortMode && DumpSortMode.isActive(), null, { polling: 100, timeout: 60000 }).then(() => 'open'),
      ]).catch(() => 'timeout');
      if (s === 'lock') {
        const lt = await overlayText();
        check(/Previous Sort Dump lock found/.test(lt) && /never released here/.test(lt), 'restart: the crash-left lock of this computer is offered for explicit release');
        await shoot(main, shots, '6-restart-release-lock');
        await main.click('#dsrRelease');
        released = true;
      }
      await waitFor(async () => fs.readdirSync(path.join(evA, '.autoingest', 'dump-sort', 'transfers')).filter(n => n.endsWith('.json')).length === 0, 60000);
      await main.waitForFunction(() => window.DumpSortMode && DumpSortMode.isActive(), null, { polling: 100, timeout: 60000 }).catch(() => {});
    }
    log(`restart: lock released explicitly = ${released}`);
    const nA = (await fsp.readdir(path.join(evA, 'Dump', P1, 'bulk')).catch(() => [])).length;
    const nB = (await fsp.readdir(path.join(evB, 'Dump', P1, 'bulk')).catch(() => [])).length;
    dB = await readDoc(evB); dA = await readDoc(evA);
    check(nA + nB === 300 && (pendingBefore === 0 || nB === inB), `restart completed the interrupted transfer: shots already at B completed, the rest stay in A (pending journal ${pendingBefore}; ${nA} in A + ${nB} in B = 300; ${inB} were at B at the kill)`);
    check(fs.readdirSync(path.join(evA, '.autoingest', 'dump-sort', 'transfers')).filter(n => n.endsWith('.json')).length === 0 && fs.readdirSync(path.join(evB, '.autoingest', 'dump-sort', 'transfers-in')).length === 0, 'no transfer left unfinished');
    const ids = dB.transfersIn.map(t => t.id);
    check(new Set(ids).size === ids.length && new Set(dA.transfersOut.map(t => t.id)).size === dA.transfersOut.length, `no duplicate transfer history (${ids.length} in B, ${dA.transfersOut.length} out of A)`);
    check(J(dB.imports) === '[]' && J(dA.imports) === J(docA0.imports), 'no import record created by the crash or the recovery');

    check(J(H.prodKeychainSnapshot()) === J(prodBefore), 'production Keychain items unchanged (presence only)');
  } catch (err) {
    failures++;
    log('FAIL — exception:', err && err.stack ? err.stack.split('\n').slice(0, 6).join('\n') : err);
    try { log('overlay:', (await overlayText()).slice(0, 600)); } catch { /* app gone */ }
    try { log('DIAG probe:', JSON.stringify(await app.evaluate(() => global.__diag || []))); } catch (e) { log('DIAG probe unreadable', e.message); }
    try { log('app.log tail:\n' + fs.readFileSync(path.join(ud, 'app.log'), 'utf8').split('\n').slice(-40).join('\n')); } catch { /* none */ }
  } finally {
    await et.end().catch(() => {});
    // Never leave a test app behind (a window lost mid-run can leave app.close() waiting forever).
    if (app) {
      await Promise.race([app.close().catch(() => {}), sleep(15000)]);
      try { if (app.process() && app.process().exitCode === null) app.process().kill('SIGKILL'); } catch { /* gone */ }
    }
    check(H.removeTestKeychainItem(iso, testKcBefore), 'test Keychain item absent after the run');
    if (!process.env.AI_EQI32_KEEP) await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
  log(failures ? `${failures} FAILURE(S)` : 'ALL CHECKS PASSED');
  process.exitCode = failures ? 1 : 0;
})();
