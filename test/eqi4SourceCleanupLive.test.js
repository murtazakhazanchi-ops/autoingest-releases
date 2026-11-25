'use strict';
// LIVE (AI-FEAT-064 EQI-4 Safe Source Cleanup). Real main.js, renderer, import transaction, macOS Trash.
// Cards are disposable disk images (FAT32 / exFAT) mounted by this test; the archive is synthetic. Isolated
// test identity and temp profile. The real Trash used is each image's own .Trashes folder (detached and
// deleted with the image at the end) — nothing reaches the user's Trash or any real card.
//
//   A  card A: 100 imported + RAW/JPEG pair + video, 20 never imported → review (counts, reasons, Trash), Cancel
//      changes nothing; confirm → only the verified files are in the card's Trash, byte-identical; the 20 stay;
//      archive, event.json and import history unchanged
//   B  second cycle in the same session: shoot more, import, clean (from the import summary button) — works
//   C  card A ejected and mounted again → nothing eligible, the 20 still untouched
//   D  card B (exFAT): one file changed after import and one replaced (same name and size) → excluded; rest clean
//   E  read-only card → refused with the reason, nothing changed
//   F  Local First: staged but not synced → excluded "not synced"; after a real sync → eligible and cleaned
//   G  scope: the archive event's Dump as a source → refused
//   H  crash during a cleanup (SIGKILL after 3 files) → restart → reconciled from the real state, nothing
//      repeated; the rest cleaned in a new review
//
// Run: node test/eqi4SourceCleanupLive.test.js     AI_EQI4_SHOTS=<dir> keeps the screenshots

const { _electron: electron } = require('playwright-core');
const { ExifTool } = require('exiftool-vendored');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const H = require('./support/liveTestHarness');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_BIN = require(path.join(PROJECT_ROOT, 'node_modules', 'electron'));
const COLL = 'CollEQI4';
const P1 = 'Testali Bhai';
const EV = '1448-07-01 _01-Majlis-Hall-Surat';

let failures = 0;
const log = (...a) => console.log('[eqi4-live]', ...a);
const check = (c, m) => { if (c) log('PASS —', m); else { failures++; log('FAIL —', m); } };
const J = (x) => JSON.stringify(x);
const { sleep, createHelpers, noiseJpeg, fakeDrive } = require('./support/eventDumpLiveHelpers');
const { passSplash, setActiveEvent } = createHelpers({ projectRoot: PROJECT_ROOT });
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

async function shoot(page, dir, name) {
  const cur = await page.evaluate(() => document.documentElement.dataset.theme);
  for (const theme of ['dark', 'light']) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(dir, `${name}-${theme}.png`) });
  }
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, cur);
}

const hdi = (...a) => execFileSync('hdiutil', a, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
function makeCard(work, name, fsType, sizeMb = 120) {
  const img = path.join(work, `${name}.dmg`);
  hdi('create', '-size', `${sizeMb}m`, '-fs', fsType, '-volname', name, img);
  return img;
}
function mountCard(img, mnt, readonly = false) {
  fs.mkdirSync(mnt, { recursive: true });
  hdi('attach', '-nobrowse', ...(readonly ? ['-readonly'] : []), '-mountpoint', mnt, img);
  return mnt;
}
function unmount(mnt) { try { hdi('detach', '-force', mnt); } catch { /* already */ } }
const tree = (root) => {
  const out = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name.startsWith('.')) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(root, p)] = sha(p); } };
  if (fs.existsSync(root)) walk(root);
  return out;
};

(async () => {
  if (process.platform !== 'darwin') { log('SKIP — macOS only'); return; }
  const work = fs.realpathSync(await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-eqi4-live-')));
  const shots = process.env.AI_EQI4_SHOTS || path.join(work, 'shots');
  await fsp.mkdir(shots, { recursive: true });
  const ud = path.join(work, 'userData'); await fsp.mkdir(ud);
  const archiveRoot = path.join(work, 'archive'); await fsp.mkdir(archiveRoot);
  const stagingRoot = path.join(work, 'staging'); await fsp.mkdir(stagingRoot);
  const collDir = path.join(archiveRoot, COLL);
  const ev = path.join(collDir, EV);
  const iso = H.prepareIsolatedApp({ tag: 'eqi4', work, projectRoot: PROJECT_ROOT });
  const prodBefore = H.prodKeychainSnapshot();
  const testKcBefore = H.keychainHas(iso.keychainItem);
  const et = new ExifTool({ maxProcs: 2 });
  const mounts = [];
  let app, main;
  const launch = (extraEnv = {}) => electron.launch({ executablePath: ELECTRON_BIN, args: [...iso.args, '--user-data-dir=' + ud, '--no-sandbox'], cwd: PROJECT_ROOT, env: { ...iso.env(ud), ...extraEnv }, timeout: 60000 });
  const startApp = async (extraEnv) => {
    app = await launch(extraEnv);
    await H.verifyIsolation(app, iso, ud);
    main = await passSplash(app);
    main.on('dialog', (d) => d.accept().catch(() => {}));
    main.on('pageerror', (e) => log('pageerror', e.message.slice(0, 200)));
  };
  const stopApp = async () => {
    if (!app) return;
    await Promise.race([app.close().catch(() => {}), sleep(15000)]);
    try { if (app.process() && app.process().exitCode === null) app.process().kill('SIGKILL'); } catch { /* gone */ }
    app = null;
  };

  // ── media ──
  const base = path.join(work, 'base.jpg');
  await fsp.writeFile(base, await noiseJpeg(PROJECT_ROOT, 320, 240));
  let n = 0;
  const photo = async (dir, name) => {   // unique bytes per photo (a distinct DateTimeOriginal)
    await fsp.mkdir(dir, { recursive: true });
    const p = path.join(dir, name);
    await fsp.copyFile(base, p);
    n++;
    await et.write(p, { Make: 'Canon', Model: 'Canon EOS R5', DateTimeOriginal: `2026:11:2${n % 8} 1${n % 10}:${String(n % 60).padStart(2, '0')}:00` }, { writeArgs: ['-overwrite_original'] });
    return p;
  };
  const importFiles = (srcs, card, { mode = 'direct-nas', eventPath = ev } = {}) => main.evaluate(async (a) => {
    let evPath = a.eventPath, archEvent = null;
    if (a.mode === 'local-first') {
      const m = await window.api.ensureLocalMirror({ collectionName: a.coll, eventName: a.evName, eventPath: a.eventPath, eventJsonPath: a.eventPath + '/event.json' });
      archEvent = a.eventPath; evPath = m.localEventPath;
    }
    const r = await window.api.commitImportTransaction(a.srcs.map(s => ({ src: s, dest: `${evPath}/Dump/${a.ph}/${s.split('/').pop()}` })), evPath, {
      collName: a.coll, photographer: a.ph, subEventNames: [], liveComps: [], groups: [{ id: 0, subEventId: null, metadataTags: null, files: a.srcs, fileTagRefinements: null }],
      source: { type: 'memory-card', label: a.label, path: a.card }, importedBy: null, importMode: a.mode, destination: 'dump', ...(archEvent ? { archiveEventPath: archEvent } : {}) });
    return { ...r, localEventPath: archEvent ? evPath : null };
  }, { srcs, card, label: path.basename(card), coll: COLL, evName: EV, eventPath, ph: P1, mode });
  const drives = new Map();   // the stubbed drive list the app polls: a card is "inserted" while it is listed
  const setDrives = () => fs.writeFileSync(iso.drivesFile, J([...drives].map(([label, mnt]) => fakeDrive(mnt, label))));
  const selectCard = async (mnt, label, type = 'memory-card') => {
    drives.set(label, mnt); setDrives(); await sleep(1500);
    for (let i = 0; i < 20; i++) {
      const ok = await main.evaluate(async (a) => {
        if (!isLoadingFiles) await selectSource({ type: a.type, path: a.mnt, label: a.label });
        return !!activeSource && activeSource.path === a.mnt && document.getElementById('workspace').classList.contains('visible');
      }, { mnt, label, type });
      if (ok) return true;
      await sleep(500);
    }
    throw new Error(`could not open ${label} in the workspace`);
  };
  const waitMeta = () => main.waitForFunction(() => true, null, { timeout: 1000 }).then(() => sleep(1500));
  const overlayText = () => main.evaluate(() => document.getElementById('srcCleanOverlay')?.textContent.replace(/\s+/g, ' ') || '');
  const openCleanup = async (via = 'bar') => {
    if (via === 'bar') { await main.waitForSelector('#ctxCleanupBtn:not([hidden])', { state: 'attached', timeout: 15000 }); const vis = await main.evaluate(() => { const b = document.getElementById('ctxCleanupBtn'); const r = b.getBoundingClientRect(); return { w: r.width, h: r.height, ws: document.getElementById('workspace')?.classList.contains('visible'), bar: getComputedStyle(document.getElementById('contextBar')).display }; }); if (!vis.w) { log('DIAG button not rendered', J(vis)); await main.screenshot({ path: path.join(shots, 'diag-bar.png') }); } await main.click('#ctxCleanupBtn', { timeout: 10000 }); }
    else await main.evaluate(() => openSourceCleanup());
    await main.waitForFunction(() => { const o = document.getElementById('srcCleanOverlay'); return o && o.classList.contains('visible') && (o.querySelector('#scxCancel') || o.querySelector('#scxClose')); }, null, { polling: 100, timeout: 120000 });
  };
  const confirmAndRun = async () => {
    await main.click('#scxConfirm');
    await main.click('#scxGo');
    await main.waitForSelector('#srcCleanOverlay.visible #scxDone, #srcCleanOverlay.visible #scxClose', { timeout: 180000 });
  };
  const closeDialog = () => main.evaluate(() => SourceCleanup.close());
  const waitIdle = async (root) => {   // metadata is written to the archive copies after an import — cleanup waits for it
    for (let i = 0; i < 240; i++) {
      const v = await main.evaluate(async (r) => window.api.sourceCleanupReview({ sourceRoot: r }), root);
      if (v && v.ok && !(v.blockers || []).some(b => /Metadata|import is running/.test(b))) return true;
      await sleep(1000);
    }
    return false;
  };
  const trashOf = (mnt) => path.join(mnt, '.Trashes', String(process.getuid()));

  try {
    await startApp();
    check(true, 'isolation proven (test identity, temp profile, drivelist stub, quit guard)');
    await main.evaluate(async (a) => {
      await window.api.initArchiveRoot(a.archiveRoot); await window.api.setNasRoot(a.archiveRoot); await window.api.setMainArchiveRoot(a.archiveRoot);
      await window.api.setLocalStagingRoot(a.stagingRoot); await window.api.setDefaultImportMode('direct-nas');
      if (typeof EventCreator.setSessionArchiveRoot === 'function') EventCreator.setSessionArchiveRoot(a.archiveRoot);
      await window.api.addToList('photographers', a.p1);
      await window.api.writeEventJson(a.ev, { version: 1, hijriDate: '1448-07-01', sequence: 1, eventName: 'Majlis-Hall-Surat', components: [{ id: 1, folderName: 'Majlis-Hall', location: 'Hall', city: 'Surat', country: 'India', types: ['Majlis'], additionalKeywords: [] }], imports: [] });
    }, { archiveRoot, stagingRoot, p1: P1, ev });
    await setActiveEvent(main, collDir, COLL, EV);

    // ═══ A: card A (FAT32) ═══
    const imgA = makeCard(work, 'CARD_A', 'MS-DOS FAT32');
    const mA = mountCard(imgA, path.join(work, 'mnt', 'CARD_A')); mounts.push(mA);
    const dA = path.join(mA, 'DCIM', '100CANON');
    const batch1 = []; for (let i = 1; i <= 100; i++) batch1.push(await photo(dA, `IMG_${String(i).padStart(4, '0')}.JPG`));
    const leave = []; for (let i = 101; i <= 120; i++) leave.push(await photo(dA, `IMG_${String(i).padStart(4, '0')}.JPG`));
    const raw = path.join(dA, 'IMG_0200.CR3'); await fsp.writeFile(raw, crypto.randomBytes(300 * 1024));
    const rawJ = await photo(dA, 'IMG_0200.JPG');
    const vid = path.join(mA, 'PRIVATE', 'M4ROOT', 'CLIP', 'C0001.MP4'); await fsp.mkdir(path.dirname(vid), { recursive: true }); await fsp.writeFile(vid, crypto.randomBytes(200 * 1024));
    await selectCard(mA, 'CARD_A');
    const imp1 = await importFiles([...batch1, raw, rawJ, vid], mA);
    check(imp1 && imp1.copied === 103, `card A: 103 files imported through the real transaction (${imp1 && imp1.copied})`);
    check(await waitIdle(await main.evaluate(() => activeSource && activeSource.path)), 'metadata for the import finished (cleanup waits for it)');
    const evBefore = await fsp.readFile(path.join(ev, 'event.json'), 'utf8');
    const archBefore = tree(path.join(ev, 'Dump'));
    const cardBefore = tree(mA);
    const btn = await main.evaluate(() => { const b = document.getElementById('ctxCleanupBtn'); return b ? { hidden: b.hidden, text: b.textContent.trim() } : null; });
    check(btn && !btn.hidden && btn.text === 'Clean Up Source…', `"Clean Up Source…" is in the source bar for a card (${J(btn)})`);
    await openCleanup('bar');
    let t = await overlayText();
    check(/To the Trash\s*103 files/.test(t) && /Not imported\s*20 files/.test(t), `review: 103 to the Trash, 20 not imported (${(t.match(/To the Trash.{0,60}/) || [''])[0]} | ${(t.match(/Not imported.{0,30}/) || [''])[0]})`);
    check(/Trash on this MSDOS card/.test(t) && /Put Back/.test(t), 'review: says where they go and how to recover them');
    check(/Nothing is deleted permanently/.test(t), 'review: only verified files, never permanent');
    check(await main.evaluate(() => document.getElementById('scxGo').disabled && !document.getElementById('scxConfirm').checked), 'nothing is pre-selected: the move button waits for the confirmation');
    await shoot(main, shots, '1-review-card-a');
    await main.click('#scxCancel');
    await sleep(300);
    check(J(tree(mA)) === J(cardBefore) && !fs.existsSync(trashOf(mA)), 'Cancel: the card is unchanged and nothing is in its Trash');
    await openCleanup('bar');
    await confirmAndRun();
    t = await overlayText();
    check(/In the Trash\s*103 files/.test(t) && /Left on the source\s*0 files/.test(t), `result: 103 in the Trash (${(t.match(/In the Trash.{0,40}/) || [''])[0]})`);
    await shoot(main, shots, '2-result-card-a');
    await closeDialog();
    const cardNow = Object.keys(tree(mA)).sort();
    check(J(cardNow) === J(leave.map(p => path.relative(mA, p)).sort()), `card A keeps exactly the 20 unimported photos (${cardNow.length})`);
    const inTrash = fs.readdirSync(trashOf(mA)).filter(x => !x.startsWith('._') && !x.startsWith('.'));
    check(inTrash.length === 103, `the 103 files are in the card's own Trash (${inTrash.length})`);
    check(sha(path.join(trashOf(mA), 'IMG_0001.JPG')) === cardBefore[path.join('DCIM', '100CANON', 'IMG_0001.JPG')] && sha(path.join(trashOf(mA), 'IMG_0200.CR3')) === cardBefore[path.join('DCIM', '100CANON', 'IMG_0200.CR3')], 'what is in the Trash is byte-identical to what was on the card (recoverable)');
    check(fs.existsSync(path.join(mA, 'DCIM', '100CANON')) && fs.existsSync(path.join(mA, 'PRIVATE', 'M4ROOT', 'CLIP')), 'camera folders (DCIM, PRIVATE) are kept');
    check(J(tree(path.join(ev, 'Dump'))) === J(archBefore) && (await fsp.readFile(path.join(ev, 'event.json'), 'utf8')) === evBefore, 'archive Dump and event.json (import history) unchanged by cleanup');
    check(await main.evaluate(() => !currentFiles.some(f => /IMG_000[1-9]\.JPG$/.test(f.path))), 'trashed photos left the workspace grid');
    const sections = await main.evaluate(() => [...document.querySelectorAll('#fileGrid .file-section')].map(x => [x.querySelector('.section-label')?.textContent.trim(), x.querySelector('.section-count')?.textContent.trim()]));
    check(J(sections) === J([['Image Files', '20 files']]) || sections.every(([l, c]) => l !== 'Image Files' || c === '20 files') && !sections.some(([l]) => /RAW|Video/.test(l)), `grid re-rendered: only the 20 remaining photos, no emptied sections (${J(sections)})`);

    // ═══ B: second cycle in the same session ═══
    const batch2 = []; for (let i = 300; i < 315; i++) batch2.push(await photo(dA, `IMG_${i}.JPG`));
    const imp2 = await importFiles(batch2, mA);
    check(imp2 && imp2.copied === 15, 'second batch imported (15)');
    check(await waitIdle(await main.evaluate(() => activeSource && activeSource.path)), 'metadata for the import finished (cleanup waits for it)');
    await openCleanup('summary');
    t = await overlayText();
    check(/To the Trash\s*15 files/.test(t) && /Not imported\s*20 files/.test(t), `second cleanup sees exactly the new batch (${(t.match(/To the Trash.{0,30}/) || [''])[0]})`);
    await confirmAndRun();
    t = await overlayText();
    check(/In the Trash\s*15 files/.test(t), 'second cleanup in the same session works');
    await closeDialog();
    check(batch2.every(p => !fs.existsSync(p)) && leave.every(p => fs.existsSync(p)), 'second batch gone from the card; the 20 still there');

    // ═══ C: card A ejected and mounted again ═══
    drives.delete('CARD_A'); setDrives(); unmount(mA); await sleep(2500); mountCard(imgA, mA); await sleep(500);
    await selectCard(mA, 'CARD_A');
    await openCleanup('bar');
    t = await overlayText();
    check(/To the Trash\s*0 files/.test(t) && /Not imported\s*20 files/.test(t) && !(await main.$('#scxGo')), `after remounting: nothing eligible, the 20 untouched (${(t.match(/To the Trash.{0,30}/) || [''])[0]})`);
    await closeDialog();

    // ═══ D: card B (exFAT): changed and replaced files ═══
    const imgB = makeCard(work, 'CARD_B', 'ExFAT');
    const mB = mountCard(imgB, path.join(work, 'mnt', 'CARD_B')); mounts.push(mB);
    const dB = path.join(mB, 'DCIM', '100CANON');
    const bB = []; for (let i = 1; i <= 10; i++) bB.push(await photo(dB, `IMG_${String(i).padStart(4, '0')}.JPG`));   // same names as card A
    await selectCard(mB, 'CARD_B');
    const ev2 = path.join(collDir, '1448-07-02 _01-Ziyafat-Hall-Surat');
    await main.evaluate(async (e) => window.api.writeEventJson(e, { version: 1, hijriDate: '1448-07-02', sequence: 1, eventName: 'Ziyafat-Hall-Surat', components: [{ id: 1, folderName: 'Ziyafat-Hall', location: 'Hall', city: 'Surat', country: 'India', types: ['Ziyafat'], additionalKeywords: [] }], imports: [] }), ev2);
    const imp3 = await importFiles(bB, mB, { eventPath: ev2 });
    check(imp3 && imp3.copied === 10, 'card B: 10 imported into another event');
    check(await waitIdle(await main.evaluate(() => activeSource && activeSource.path)), 'metadata for the import finished (cleanup waits for it)');
    await fsp.appendFile(bB[0], Buffer.from('edited on the card'));
    const st = fs.statSync(bB[1]); const other = fs.readFileSync(bB[2]); await fsp.writeFile(bB[1], other.subarray(0, st.size)); await fsp.utimes(bB[1], st.atime, st.mtime);
    await openCleanup('bar');
    t = await overlayText();
    check(/To the Trash\s*8 files/.test(t) && /Excluded\s*2 imported files/.test(t), `card B: 8 eligible, 2 excluded (${(t.match(/Excluded.{0,40}/) || [''])[0]})`);
    await main.evaluate(() => { const d = document.querySelector('#srcCleanOverlay details.scx-excluded'); if (d) d.open = true; });
    t = await overlayText();
    check((t.match(/Changed on the source since it was imported/g) || []).length >= 2, 'reasons: edited on the card, and replaced by a same-size file → both "changed since import" (fingerprint)');
    await shoot(main, shots, '3-review-excluded');
    await confirmAndRun();
    await closeDialog();
    check(fs.existsSync(bB[0]) && fs.existsSync(bB[1]) && bB.slice(2).every(p => !fs.existsSync(p)), 'card B: the changed and replaced files stay, the 8 verified ones are in the Trash');

    // ═══ E: read-only card ═══
    drives.delete('CARD_B'); setDrives(); unmount(mB); await sleep(2500); mountCard(imgB, mB, true); await sleep(500);
    await selectCard(mB, 'CARD_B');
    await openCleanup('bar');
    t = await overlayText();
    check(/read-only/.test(t) && !(await main.$('#scxGo')), 'read-only card: refused with the reason, no move button');
    await shoot(main, shots, '4-review-readonly');
    await closeDialog();
    check(fs.existsSync(bB[0]) && fs.existsSync(bB[1]), 'read-only card unchanged');

    // ═══ F: Local First ═══
    const imgC = makeCard(work, 'CARD_C', 'MS-DOS FAT32');
    const mC = mountCard(imgC, path.join(work, 'mnt', 'CARD_C')); mounts.push(mC);
    const cC = []; for (let i = 1; i <= 4; i++) cC.push(await photo(path.join(mC, 'DCIM', '101CANON'), `LF_${i}.JPG`));
    await selectCard(mC, 'CARD_C');
    await main.evaluate(async () => { await window.api.setDefaultImportMode('local-first'); });
    const imp4 = await importFiles(cC, mC, { mode: 'local-first' });
    check(imp4 && imp4.copied === 4, `Local First: 4 staged (${imp4 && (imp4.error || imp4.copied)})`);
    check(await waitIdle(await main.evaluate(() => activeSource && activeSource.path)), 'metadata for the import finished (cleanup waits for it)');
    await openCleanup('bar');
    t = await overlayText();
    check(/To the Trash\s*0 files/.test(t) && /Excluded\s*4 imported files/.test(t), `staged but not synced → not eligible (${(t.match(/Excluded.{0,40}/) || [''])[0]})`);
    await main.evaluate(() => { const d = document.querySelector('#srcCleanOverlay details.scx-excluded'); if (d) d.open = true; });
    check(/Not synced to the archive yet/.test(await overlayText()), 'reason: not synced to the archive yet');
    await shoot(main, shots, '5-review-local-first-unsynced');
    await closeDialog();
    // The import UI queues the Local First sync job once the import's metadata is written; the same entry here.
    const appended = await main.evaluate(async (a) => window.api.appendSyncJob(a.lep, { importId: a.id, batchId: a.id, eventName: a.ev, collectionName: a.coll, photographer: a.ph, fileCount: a.files.length,
      files: a.files, importedAt: Date.now(), metadataStatus: 'complete', readyForSync: true, needsAttention: false }),
    { lep: imp4.localEventPath, id: imp4.metadataBatchId || `lf-${Date.now()}`, ev: EV, coll: COLL, ph: P1, files: (imp4.copiedFiles || []).map(f => f.dest.slice(imp4.localEventPath.length + 1)) });
    if (!appended || appended.ok === false) log('DIAG appendSyncJob', J(appended));
    const synced = await main.evaluate(async () => {
      await window.api.refreshSyncQueue().catch(() => null);
      for (let i = 0; i < 60; i++) {
        await window.api.syncAllReadyJobs().catch(() => null);
        const q = await window.api.getSyncQueue();
        if ((q.jobs || []).some(j => j.status === 'synced')) return true;
        await new Promise(r => setTimeout(r, 1000));
      }
      return false;
    });
    if (!synced) log('DIAG sync queue', J(await main.evaluate(async () => { const q = await window.api.getSyncQueue(); return (q.jobs || []).map(j => ({ s: j.status, ev: j.event, r: j.reason || j.lastError || null, ready: j.readyForSync })); })));
    check(synced, 'the Local First job synced to the archive (real sync)');
    await openCleanup('bar');
    t = await overlayText();
    check(/To the Trash\s*4 files/.test(t), `after the sync: the 4 are verified against the ARCHIVE copy (${(t.match(/To the Trash.{0,30}/) || [''])[0]})`);
    await confirmAndRun();
    await closeDialog();
    check(cC.every(p => !fs.existsSync(p)), 'Local First photos cleaned after the archive copy was verified');
    await main.evaluate(async () => { await window.api.setDefaultImportMode('direct-nas'); });

    // ═══ G: scope ═══
    const scope = await main.evaluate(async (p) => window.api.sourceCleanupReview({ sourceRoot: p }), path.join(ev, 'Dump'));
    check(scope && scope.ok === false && /archive/.test(scope.blockers[0]), `the archive event Dump is refused as a cleanup source (${scope && scope.blockers && scope.blockers[0]})`);

    // ═══ H: crash during a cleanup ═══
    const cH = []; for (let i = 1; i <= 8; i++) cH.push(await photo(path.join(mC, 'DCIM', '102CANON'), `CR_${i}.JPG`));
    await selectCard(mC, 'CARD_C');
    const imp5 = await importFiles(cH, mC);
    check(imp5 && imp5.copied === 8, '8 imported for the crash test');
    check(await waitIdle(await main.evaluate(() => activeSource && activeSource.path)), 'metadata for the import finished (cleanup waits for it)');
    await stopApp();
    await startApp({ AI_EQI4_TEST_CRASH_AFTER: '3' });
    await selectCard(mC, 'CARD_C');
    await openCleanup('bar');
    await main.click('#scxConfirm');
    await main.click('#scxGo');
    await new Promise((res) => { app.process().once('exit', res); setTimeout(res, 60000); });
    const gone = cH.filter(p => !fs.existsSync(p)).length;
    check(gone === 3, `killed after 3 files went to the Trash (${gone} gone)`);
    const journals = fs.readdirSync(path.join(ud, 'source-cleanup', 'journal')).filter(x => x.endsWith('.json'));
    check(journals.length === 1, 'an unfinished journal survived the crash');
    app = null;
    await startApp();
    await sleep(2500);   // startup recovery
    const hist = await main.evaluate(async () => window.api.sourceCleanupHistory());
    const rec = hist.find(h => h.state === 'reconciled');
    check(rec && rec.summary.trashed === 3 && rec.summary.attention === 0, `restart: reconciled from the real state — 3 in the Trash, nothing repeated (${J(rec && rec.summary)})`);
    check(cH.filter(p => !fs.existsSync(p)).length === 3, 'recovery moved nothing');
    await selectCard(mC, 'CARD_C');
    await openCleanup('bar');
    t = await overlayText();
    check(/To the Trash\s*5 files/.test(t), `a new review offers the remaining 5 (${(t.match(/To the Trash.{0,30}/) || [''])[0]})`);
    await confirmAndRun();
    await closeDialog();
    check(cH.every(p => !fs.existsSync(p)) && fs.readdirSync(trashOf(mC)).filter(x => /^CR_/.test(x)).length === 8, 'all 8 in the Trash exactly once');
    check(fs.readdirSync(path.join(ud, 'source-cleanup', 'journal')).filter(x => x.endsWith('.json')).length === 0, 'no journal left unfinished');
    check(J(H.prodKeychainSnapshot()) === J(prodBefore), 'production Keychain items unchanged (presence only)');
  } catch (err) {
    failures++;
    log('FAIL — exception:', err && err.stack ? err.stack.split('\n').slice(0, 6).join('\n') : err);
    try { log('overlay:', (await overlayText()).slice(0, 600)); } catch { /* app gone */ }
    try { log('app.log tail:\n' + fs.readFileSync(path.join(ud, 'app.log'), 'utf8').split('\n').slice(-30).join('\n')); } catch { /* none */ }
  } finally {
    await et.end().catch(() => {});
    await stopApp();
    for (const m of mounts) unmount(m);
    check(H.removeTestKeychainItem(iso, testKcBefore), 'test Keychain item absent after the run');
    if (!process.env.AI_EQI4_KEEP) await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
  }
  log(failures ? `${failures} FAILURE(S)` : 'ALL CHECKS PASSED');
  process.exitCode = failures ? 1 : 0;
})();
