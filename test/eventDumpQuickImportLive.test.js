'use strict';
// LIVE (AI-FEAT-064 EQI-1): Event Dump Quick Import from the real menu-bar companion popup, run by
// the real main window's import machinery — real main.js, preload, renderer, companion, copy
// engine, event.json transaction, ExifTool metadata and import index.
//
// Isolation (test/support/liveTestHarness.js): test-only app identity, temp profile, drivelist
// stub (synthetic cards are temp folders), external-Quit guard. Synthetic JPEGs and a throwaway
// archive only; production profile and Keychain are checked unchanged.
//
// Run: node test/eventDumpQuickImportLive.test.js      (macOS)

const { _electron: electron } = require('playwright-core');
const { ExifTool } = require('exiftool-vendored');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const H = require('./support/liveTestHarness');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_BIN = require(path.join(PROJECT_ROOT, 'node_modules', 'electron'));
const COLL = 'CollEQI1';
const P1 = 'Testali Bhai', P2 = 'Testhusain Bhai';   // already in the photographer list's own case form

let failures = 0;
const log = (...a) => console.log('[eqi1-live]', ...a);
const check = (c, m) => { if (c) log('PASS —', m); else { failures++; log('FAIL —', m); } };
const J = (x) => JSON.stringify(x);
const { sleep, localDate, fakeDrive, waitFor, createHelpers, listFiles, noiseJpeg: _noise } = require('./support/eventDumpLiveHelpers');
const { passSplash, withPopup, dumpView, importViaPopup, setActiveEvent: _setActive } = createHelpers({ projectRoot: PROJECT_ROOT });
const noiseJpeg = () => _noise(PROJECT_ROOT);
const setActiveEvent = (main, archiveRoot, folder) => _setActive(main, path.join(archiveRoot, COLL), COLL, folder);

(async () => {
  if (process.platform !== 'darwin') { log('SKIP — macOS only'); return; }
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-eqi1-live-'));
  const ud = path.join(work, 'userData'); await fsp.mkdir(ud);
  const archiveRoot = path.join(work, 'archive'); await fsp.mkdir(archiveRoot);
  const stagingRoot = path.join(work, 'staging'); await fsp.mkdir(stagingRoot);
  const iso = H.prepareIsolatedApp({ tag: 'eqi1', work, projectRoot: PROJECT_ROOT });
  const prodBefore = H.prodKeychainSnapshot();
  const testKcBefore = H.keychainHas(iso.keychainItem);
  const et = new ExifTool({ maxProcs: 2 });

  // ── synthetic cards (dated JPEGs; one undated) ──
  const today = localDate();
  const put = async (dir, name, date) => {
    await fsp.mkdir(dir, { recursive: true });
    const p = path.join(dir, name);
    await fsp.writeFile(p, await noiseJpeg());
    if (date) await et.write(p, { DateTimeOriginal: `${date.replace(/-/g, ':')} 10:00:00`, CreateDate: `${date.replace(/-/g, ':')} 10:00:00`, Make: 'Canon', Model: 'Canon EOS R5' }, { writeArgs: ['-overwrite_original'] });
    return p;
  };
  const cardA = path.join(work, 'CARD_A'), dcimA = path.join(cardA, 'DCIM', '100CANON');
  const A = { t1: await put(dcimA, 'IMG_0001.JPG', today), t2: await put(dcimA, 'IMG_0002.JPG', today), t3: await put(dcimA, 'IMG_0003.JPG', today),
    old: await put(dcimA, 'IMG_0004.JPG', '2026-01-05'), undated: await put(dcimA, 'IMG_0005.JPG', null) };
  const cardB = path.join(work, 'CARD_B'), dcimB = path.join(cardB, 'DCIM', '101CANON');
  const B = { t1: await put(dcimB, 'IMG_0101.JPG', today), t2: await put(dcimB, 'IMG_0102.JPG', today) };
  const srcBytes = async (files) => Promise.all(files.map(f => fsp.readFile(f)));
  const cardABefore = await srcBytes(Object.values(A));

  let app;
  try {
    app = await electron.launch({ executablePath: ELECTRON_BIN, args: [...iso.args, '--user-data-dir=' + ud, '--no-sandbox'], cwd: PROJECT_ROOT, env: iso.env(ud), timeout: 60000 });
    await H.verifyIsolation(app, iso, ud);
    check(true, 'isolation proven (test identity, temp profile, drivelist stub, quit guard)');
    const main = await passSplash(app);
    const ops = await main.evaluate(async (a) => {
      await window.api.initArchiveRoot(a.archiveRoot);
      await window.api.setNasRoot(a.archiveRoot);
      await window.api.setMainArchiveRoot(a.archiveRoot);
      await window.api.setDefaultImportMode('direct-nas');
      if (typeof EventCreator.setSessionArchiveRoot === 'function') EventCreator.setSessionArchiveRoot(a.archiveRoot);
      for (const n of a.names) await window.api.addToList('photographers', n);
      return window.api.getArchiveOperationsStatus();
    }, { archiveRoot, names: [P1, P2] });
    log('archive status:', J({ status: ops.status, mode: ops.defaultImportMode }));

    // ── events: single-component E1, multi-component E2, Local First E3 ──
    const evDir = (f) => path.join(archiveRoot, COLL, f);
    const E1 = '1448-05-01 _01-Waaz-Hall-Surat', E2 = '1448-05-02 _02-Majlis-Ziyafat', E3 = '1448-05-03 _03-Jashn-Pune';
    // event.json contract: every component has an id and a folderName (as the Event Creator writes).
    const comp = (id, folderName, types, city) => ({ id, folderName, location: 'Hall', city, country: 'India', types, additionalKeywords: [] });
    await main.evaluate(async ({ defs }) => { for (const [d, data] of defs) await window.api.writeEventJson(d, data); }, { defs: [
      [evDir(E1), { version: 1, hijriDate: '1448-05-01', sequence: 1, eventName: 'Waaz-Hall-Surat', components: [comp(1, 'Waaz-Hall', ['Waaz'], 'Surat')] }],
      [evDir(E2), { version: 1, hijriDate: '1448-05-02', sequence: 2, eventName: 'Majlis-Ziyafat', components: [comp(1, 'Majlis-Hall', ['Majlis'], 'Surat'), comp(2, 'Ziyafat-Hall', ['Ziyafat'], 'Surat')] }],
      [evDir(E3), { version: 1, hijriDate: '1448-05-03', sequence: 3, eventName: 'Jashn-Pune', components: [comp(1, 'Jashn-Hall', ['Jashn'], 'Pune')] }],
    ] });
    await setActiveEvent(main, archiveRoot, E1);
    const ev1 = await waitFor(async () => { const v = await dumpView(app); return v.global?.event?.eventName === E1 ? v.global.event : null; }, 15000);
    check(!!ev1 && ev1.componentCount === 1, `companion shows the main window's active event (${J(ev1)})`);
    const gv = (await dumpView(app)).global;
    check(gv && gv.photographers.includes(P1) && gv.photographers.includes(P2) && gv.lastPhotographer === null, 'photographer list from the app; nothing preselected');

    // ── card A ──
    fs.writeFileSync(iso.drivesFile, J([fakeDrive(cardA, 'CARD_A')]));
    const assessed = await waitFor(async () => { const v = await dumpView(app); return v.assessment?.state === 'complete' && v.card ? v.card : null; }, 60000);
    check(!!assessed && assessed.counts.selectedNew === 3 && assessed.counts.selectedImported === 0 && assessed.counts.earlierNew === 1 && assessed.counts.uncertain === 1 && assessed.counts.toImport === 3,
      `default selection: today's 3 new files; earlier 1 and undated 1 left out (${J(assessed && assessed.counts)})`);

    // 1) Default: today's new files → E1/Dump/P1, through the real popup.
    const r1 = await importViaPopup(app, P1);
    check(/Import 3 files to Dump/.test(r1.label || ''), `popup button names what it will do ("${r1.label}")`);
    check(r1.op && r1.op.state === 'completed' && r1.op.result.copied === 3 && r1.op.result.errors === 0 && r1.op.result.importMode === 'direct-nas', `import 1 completed: ${J(r1.op && r1.op.result)}`);
    const dump1 = path.join(evDir(E1), 'Dump', P1);
    check(J(await listFiles(dump1)) === J(['IMG_0001.JPG', 'IMG_0002.JPG', 'IMG_0003.JPG']), `exactly today's files in Event/Dump/${'<photographer>'} (${J(await listFiles(dump1))})`);
    check(!fs.existsSync(path.join(evDir(E1), 'Dump', `PC01-${P1}`)) && !(await fsp.readdir(path.join(evDir(E1), 'Dump'))).some(n => /^PC\d+-/.test(n)), 'no PC sequence anywhere inside Dump');
    check(!fs.existsSync(path.join(evDir(E1), P1)), 'nothing written to the normal photographer folder');
    let ej = JSON.parse(await fsp.readFile(path.join(evDir(E1), 'event.json'), 'utf8'));
    const imp = (ej.imports || [])[0] || {};
    check(ej.status === 'complete' && ej.imports.length === 1 && imp.destination === 'dump' && imp.componentName === 'Dump' && imp.photographer === P1 && imp.counts.photos === 3 && imp.source && imp.source.type === 'memory-card',
      `event.json: one Dump import entry (${J({ status: ej.status, destination: imp.destination, componentName: imp.componentName, counts: imp.counts, source: imp.source && imp.source.type })})`);
    check(!ej.photographerSequences || !J(ej.photographerSequences).includes('Dump'), 'no PC sequence recorded for Dump');

    // metadata really written (read back with ExifTool, not a UI message)
    const metaDone = await waitFor(async () => { const v = await dumpView(app); return v.card?.op?.metadata?.state && v.card.op.metadata.state !== 'writing' ? v.card.op.metadata : null; }, 60000);
    check(metaDone && metaDone.state === 'complete', `companion reports the metadata batch outcome (${J(metaDone)})`);
    for (const f of ['IMG_0001.JPG', 'IMG_0003.JPG']) {
      const tags = await et.read(path.join(dump1, f), ['-G1']);
      const creator = [].concat(tags['XMP-dc:Creator'] || tags.Creator || []);
      const byline = [].concat(tags['IPTC:By-line'] || tags['By-line'] || []);
      const artist = String(tags['IFD0:Artist'] || tags.Artist || '');
      const subj = [].concat(tags['XMP-dc:Subject'] || tags.Subject || []);
      check(creator.includes(P1) && byline.includes(P1) && artist.includes(P1) && !creator.some(c => /dump/i.test(c)) && subj.includes('Waaz'),
        `${f}: Creator/Artist/By-line = photographer (never "Dump"), event keywords written (${J({ creator, artist, byline, subj })})`);
    }
    check(J(await srcBytes(Object.values(A))) === J(cardABefore), 'card A untouched (no source deletion)');

    // 2) Same card again: everything of today is now "already imported" — nothing re-selected.
    const after1 = (await dumpView(app)).card;
    check(after1.counts.selectedNew === 0 && after1.counts.selectedImported === 3 && after1.counts.toImport === 0, `file-level history: today's files now imported (${J(after1.counts)})`);
    // 3) Earlier new photo, deliberately ticked → same Dump folder (reused).
    const r3 = await importViaPopup(app, P1, { earlier: true });
    check(r3.op && r3.op.state === 'completed' && r3.op.result.copied === 1, `earlier unimported photo imported when ticked (${J(r3.op && r3.op.result)})`);
    check(J(await listFiles(dump1)) === J(['IMG_0001.JPG', 'IMG_0002.JPG', 'IMG_0003.JPG', 'IMG_0004.JPG']), 'same Dump/<photographer> folder reused; undated file still on the card only');
    ej = JSON.parse(await fsp.readFile(path.join(evDir(E1), 'event.json'), 'utf8'));
    check(ej.imports.length === 2 && ej.imports.every(i => i.destination === 'dump'), 'two Dump import entries — no duplicate provenance');

    // 4) Different photographer, same event, another card.
    fs.writeFileSync(iso.drivesFile, J([fakeDrive(cardB, 'CARD_B')]));
    await waitFor(async () => { const v = await dumpView(app); return v.assessment?.state === 'complete' && v.card?.counts?.selectedNew === 2; }, 60000);
    const r4 = await importViaPopup(app, P2);
    check(r4.op && r4.op.state === 'completed' && r4.op.result.copied === 2, `second photographer imported (${J(r4.op && r4.op.result)})`);
    check(J(await listFiles(path.join(evDir(E1), 'Dump', P2))) === J(['IMG_0101.JPG', 'IMG_0102.JPG']) && J((await fsp.readdir(path.join(evDir(E1), 'Dump'))).sort()) === J([P1, P2].sort()),
      'Dump/<photographer> per photographer, plain names');

    // 5) Dump never sequenced: not offered, and refused if asked for.
    const folders = await main.evaluate((p) => window.api.getPhotographerFolders({ localEventPath: p }), evDir(E1));
    check(folders && !J(folders).includes('Dump') && !J(folders).includes(P2), `Sequence Photographer Folders never offers Dump or its folders (${J(folders).slice(0, 160)})`);
    const seqTry = await main.evaluate((p) => window.api.applyPhotographerSequence({ localEventPath: p, scopedOrdered: [{ scopeKey: 'Dump', ordered: [{ canonical: 'EQI Ali Bhai', sequence: 1, folderName: 'PC01-EQI Ali Bhai' }] }] }), evDir(E1)).catch(e => ({ ok: false, error: String(e) }));
    check(seqTry && seqTry.ok === false && fs.existsSync(dump1), `sequencing a Dump scope is refused (${J(seqTry).slice(0, 160)})`);

    // 6) Metadata Audit: Dump files audit complete with the right photographer.
    const audit = async (root) => {
      const a = await main.evaluate((r) => window.api.runMetadataAudit({ type: 'event', rootPath: r }), root);
      await waitFor(async () => { const st = await main.evaluate((id) => window.api.getMetadataAuditStatus(id), a.jobId); return st && st.running === false && st.completedAt; }, 60000);
      return (await main.evaluate((id) => window.api.getMetadataAuditReport(id, 0, 500, null), a.jobId)).items;
    };
    const rows1 = await audit(evDir(E1));
    check(rows1.length === 6 && rows1.every(r => r.status === 'complete'), `Audit (single component): all 6 Dump files complete (${rows1.map(r => r.status).join(',')})`);

    // 7) Multi-component event: Dump is not a component; Audit is not ambiguous.
    await setActiveEvent(main, archiveRoot, E2);
    await waitFor(async () => (await dumpView(app)).global?.event?.eventName === E2, 15000);
    const cardC = path.join(work, 'CARD_C'), dcimC = path.join(cardC, 'DCIM', '102CANON');
    await put(dcimC, 'IMG_0201.JPG', today); await put(dcimC, 'IMG_0202.JPG', today);
    fs.writeFileSync(iso.drivesFile, J([fakeDrive(cardC, 'CARD_C')]));
    await waitFor(async () => { const v = await dumpView(app); return v.assessment?.state === 'complete' && v.card?.counts?.selectedNew === 2; }, 60000);
    const r7 = await importViaPopup(app, P1);
    check(r7.op && r7.op.state === 'completed' && r7.op.result.copied === 2, `multi-component event import (${J(r7.op && r7.op.result)})`);
    check(J(await listFiles(path.join(evDir(E2), 'Dump', P1))) === J(['IMG_0201.JPG', 'IMG_0202.JPG']) && !fs.existsSync(path.join(evDir(E2), 'Majlis-Hall', P1)), 'event-root Dump, no component folder written');
    const ej2 = JSON.parse(await fsp.readFile(path.join(evDir(E2), 'event.json'), 'utf8'));
    check(ej2.components.length === 2 && !ej2.components.some(c => /dump/i.test(c.folderName || '')) && ej2.imports[0].componentName === 'Dump', 'Dump never added as a component');
    await waitFor(async () => (await dumpView(app)).card?.op?.metadata?.state === 'complete', 60000);
    const rows2 = await audit(evDir(E2));
    check(rows2.length === 2 && rows2.every(r => r.status === 'complete'), `Audit (multi component): Dump files complete, never ambiguous (${rows2.map(r => r.status).join(',')})`);

    // 8) Local First: staging copy + sync job; the archive itself is not written directly.
    await main.evaluate(async (s) => { await window.api.setLocalStagingRoot(s); await window.api.setDefaultImportMode('local-first'); }, stagingRoot);
    await setActiveEvent(main, archiveRoot, E3);
    await waitFor(async () => (await dumpView(app)).global?.event?.eventName === E3, 15000);
    const cardD = path.join(work, 'CARD_D'), dcimD = path.join(cardD, 'DCIM', '103CANON');
    await put(dcimD, 'IMG_0301.JPG', today);
    fs.writeFileSync(iso.drivesFile, J([fakeDrive(cardD, 'CARD_D')]));
    await waitFor(async () => { const v = await dumpView(app); return v.assessment?.state === 'complete' && v.card?.counts?.selectedNew === 1; }, 60000);
    const r8 = await importViaPopup(app, P2);
    const staged = path.join(stagingRoot, COLL, E3, 'Dump', P2, 'IMG_0301.JPG');
    check(r8.op && r8.op.state === 'completed' && r8.op.result.importMode === 'local-first' && fs.existsSync(staged), `Local First: copied to the staging Dump (${J(r8.op && r8.op.result)})`);
    check(!fs.existsSync(path.join(evDir(E3), 'Dump')), 'Local First: the archive copy is untouched until sync');
    const q = await waitFor(async () => { const sq = await main.evaluate(() => window.api.getSyncQueue()); return (sq.jobs || []).find(j => (j.event || '') === E3) || null; }, 30000, 500);
    check(!!q, `Local First: a sync job is registered for the event (${J(q && { event: q.event, status: q.status })})`);

    // 9) Create New Event: the EXISTING Event Creator opens in the main window; cancel leaves the companion as it was.
    await main.evaluate(async () => { await window.api.setDefaultImportMode('direct-nas'); });
    const before = (await dumpView(app)).global.event;
    await withPopup(app, async (page) => {
      await page.click('.mode-btn[data-mode="dump"]');
      await page.waitForSelector('.dump:not([hidden])', { timeout: 10000 });
      await page.click('.dump-new-event');
    });
    const opened = await main.waitForFunction(() => EventMgmt.isOpen() && EventMgmt.getMode() === 'create', null, { timeout: 15000 }).then(() => true, () => false);
    check(opened, 'Create New Event opens the existing Event Creator form (Event Management in create mode) in the main window');
    await main.evaluate(() => { EventMgmt.close(); });
    await sleep(1500);
    check(J((await dumpView(app)).global.event) === J(before), 'cancelled: the companion keeps the previous event');

    // ── isolation / guard ──
    const qg = H.quitGuardSummary(iso);
    log(H.formatQuitGuardSummary(qg));
    check(qg.failed === 0 && qg.unguarded === 0, 'no external quit got through');
  } catch (err) {
    failures++; log('FAIL — exception:', err && (err.stack || err.message));
  } finally {
    await et.end().catch(() => {});
    if (app) await app.close().catch(() => {});
    const qg = H.quitGuardSummary(iso);
    check(qg.endedWithoutExit === 0, `the app ended only by the test's deliberate quit (${qg.endedWithoutExit})`);
    check(H.removeTestKeychainItem(iso, testKcBefore), 'test Keychain item absent after the run');
    check(J(H.prodKeychainSnapshot()) === J(prodBefore), 'production Keychain items unchanged (presence only)');
    await fsp.rm(path.join(os.homedir(), 'Library', 'Logs', iso.name), { recursive: true, force: true }).catch(() => {});
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
