'use strict';
// LIVE (AI-FEAT-064 EQI-1): the full Event Creator round trip from the menu-bar companion, and
// interrupted Event Dump imports with crash / restart / recovery — real main.js, preload,
// renderer, companion, the EXISTING Event Creator form, copy engine, event.json transaction,
// metadata queue, ExifTool and archive sync.
//
//   A  Create New Event from the popup → existing Event Creator → invalid details refused →
//      cancel (companion back, state intact) → create → folder, event.json, sequence → back to the
//      companion with the new event selected and the card's choices kept → import into its Dump;
//      repeated creation; choosing an existing event; changing events with an Import workspace open
//   B  crash during COPY (main process SIGKILLed after the 5th file) → restart → retry
//   C  crash during METADATA writing → restart → the queue resumes → every file tagged
//   D  RAW/JPEG pairs, CR3, video through the same Dump import path: hashes, XMP sidecars
//   E  Local First Dump → pending sync → real sync to the archive
//
// Isolation: test/support/liveTestHarness.js (test-only identity, temp profile, drivelist stub,
// external-Quit guard). Synthetic files only; card files hashed before and after.
// Run: node test/eventDumpRoundTripRecoveryLive.test.js      (macOS)

const { _electron: electron } = require('playwright-core');
const { ExifTool } = require('exiftool-vendored');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const H = require('./support/liveTestHarness');
const { sleep, localDate, fakeDrive, waitFor, createHelpers, listFiles, noiseJpeg } = require('./support/eventDumpLiveHelpers');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ELECTRON_BIN = require(path.join(PROJECT_ROOT, 'node_modules', 'electron'));
const COLL = 'CollEQIRT';
const P1 = 'Testali Bhai', P2 = 'Testhusain Bhai';
const { mainRequire, passSplash, withPopup, dumpView, importViaPopup, setActiveEvent, ...H2 } = createHelpers({ projectRoot: PROJECT_ROOT });

let failures = 0;
const log = (...a) => console.log('[eqi1-rt]', ...a);
const check = (c, m) => { if (c) log('PASS —', m); else { failures++; log('FAIL —', m); } };
const J = (x) => JSON.stringify(x);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hashTree = async (dir) => Object.fromEntries(await Promise.all((await listFiles(dir)).map(async r => [r, sha(await fsp.readFile(path.join(dir, r)))])));
const readJson = async (p) => JSON.parse(await fsp.readFile(p, 'utf8'));

(async () => {
  if (process.platform !== 'darwin') { log('SKIP — macOS only'); return; }
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-eqi1-rt-'));
  const ud = path.join(work, 'userData'); await fsp.mkdir(ud);
  const archiveRoot = path.join(work, 'archive'); await fsp.mkdir(archiveRoot);
  const stagingRoot = path.join(work, 'staging'); await fsp.mkdir(stagingRoot);
  const collDir = path.join(archiveRoot, COLL);
  const iso = H.prepareIsolatedApp({ tag: 'eqi1rt', work, projectRoot: PROJECT_ROOT });
  const prodBefore = H.prodKeychainSnapshot();
  const testKcBefore = H.keychainHas(iso.keychainItem);
  const et = new ExifTool({ maxProcs: 2 });
  const today = localDate();
  const stamp = `${today.replace(/-/g, ':')} 10:00:00`;
  const put = async (dir, name, size) => {
    await fsp.mkdir(dir, { recursive: true });
    const p = path.join(dir, name);
    await fsp.writeFile(p, await noiseJpeg(PROJECT_ROOT, size || 400, size || 400));
    await et.write(p, { DateTimeOriginal: stamp, CreateDate: stamp, Make: 'Canon', Model: 'Canon EOS R5' }, { writeArgs: ['-overwrite_original'] });
    return p;
  };
  const cards = {};
  const mkCard = async (label, n, size) => {
    const root = path.join(work, label), dcim = path.join(root, 'DCIM', '100CANON');
    for (let i = 1; i <= n; i++) await put(dcim, `${label.slice(-1)}_${String(i).padStart(4, '0')}.JPG`, size);
    cards[label] = root;
    return root;
  };
  await mkCard('CARD_A', 3);
  await mkCard('CARD_B', 30, 900);   // crash during copy
  await mkCard('CARD_C', 40);        // crash during metadata
  await mkCard('CARD_E', 2);         // Local First
  const cardHashesBefore = {};
  for (const [k, v] of Object.entries(cards)) cardHashesBefore[k] = await hashTree(v);

  let app, main;
  const launch = async () => {
    app = await electron.launch({ executablePath: ELECTRON_BIN, args: [...iso.args, '--user-data-dir=' + ud, '--no-sandbox'], cwd: PROJECT_ROOT, env: iso.env(ud), timeout: 60000 });
    await H.verifyIsolation(app, iso, ud);
    main = await passSplash(app);
    // The app's own confirmations (e.g. "discard changes?") are answered as an operator would.
    main.on('dialog', d => d.accept().catch(() => {}));
  };
  const insert = async (label) => {
    fs.writeFileSync(iso.drivesFile, J(label ? [fakeDrive(cards[label], label)] : []));
    if (!label) return true;
    return waitFor(async () => {
      const d = await mainRequire(app, '../services/companionService', 'return m.getDiagnostics();');
      const src = (d.snapshot && d.snapshot.sources || []).find(x => x.label === label);
      return src && src.assessment && src.assessment.state === 'complete' && src.assessment.dump && (d.snapshot.sources.length === 1) ? src.assessment.dump : null;
    }, 90000);
  };
  const evNow = async () => (await dumpView(app)).global?.event?.eventName || null;
  const crash = async () => { const pid = app.process().pid; process.kill(pid, 'SIGKILL'); await waitFor(async () => { try { process.kill(pid, 0); return false; } catch { return true; } }, 10000, 100); app = null; };

  try {
    await launch();
    check(true, 'isolation proven (test identity, temp profile, drivelist stub, quit guard)');
    await main.evaluate(async (a) => {
      await window.api.initArchiveRoot(a.archiveRoot); await window.api.setNasRoot(a.archiveRoot); await window.api.setMainArchiveRoot(a.archiveRoot);
      await window.api.setDefaultImportMode('direct-nas');
      if (typeof EventCreator.setSessionArchiveRoot === 'function') EventCreator.setSessionArchiveRoot(a.archiveRoot);
      for (const n of a.names) await window.api.addToList('photographers', n);
    }, { archiveRoot, names: [P1, P2] });
    const E0 = '1448-06-01 _01-Waaz-Surat';
    await main.evaluate((d) => window.api.writeEventJson(d, { version: 1, hijriDate: '1448-06-01', sequence: 1, eventName: 'Waaz-Surat', components: [{ id: 1, folderName: 'Waaz-Hall', location: 'Hall', city: 'Surat', country: 'India', types: ['Waaz'], additionalKeywords: [] }] }), path.join(collDir, E0));
    await setActiveEvent(main, collDir, COLL, E0);
    check(await waitFor(async () => (await evNow()) === E0, 15000), 'companion shows the existing active event');
    const a0 = await insert('CARD_A');
    check(a0 && a0.counts.selectedNew === 3, `card A assessed: today's 3 new photos (${J(a0 && a0.counts)})`);

    // ═══ A. Event Creator round trip ═══
    await withPopup(app, async (page) => {
      await H2.enterDump(page);
      await H2.pickPhotographer(page, P1);
    });
    await waitFor(async () => (await dumpView(app)).card?.photographer === P1, 5000);
    const clickNewEvent = () => withPopup(app, async (page) => {
      await H2.enterDump(page);
      await page.click('#xp-new-event');
    });
    await clickNewEvent();
    const formOpen = await main.waitForSelector('#evHijriYear', { timeout: 15000 }).then(() => true, () => false);
    check(formOpen && await main.evaluate(() => EventMgmt.isOpen() && EventMgmt.getMode() === 'create'), 'Create New Event opens the EXISTING Event Creator form in the main window');
    check(await waitFor(async () => (await dumpView(app)).popupOpen === false, 5000), 'the menu-bar popup steps aside while the form is open');

    // cancel (nothing typed)
    await main.click('#emmBackBtn'); await sleep(400);
    if (await main.evaluate(() => EventMgmt.isOpen())) { await main.click('#emmBackBtn'); }
    await main.waitForFunction(() => !EventMgmt.isOpen(), null, { timeout: 10000 }).catch(() => {});
    const back1 = await waitFor(async () => (await dumpView(app)).popupOpen === true, 8000);
    const vCancel = await dumpView(app);
    check(!!back1, 'cancelled: the companion comes back by itself');
    check(vCancel.global.event.eventName === E0 && vCancel.card.photographer === P1 && vCancel.card.mode === 'dump', `cancelled: same event, photographer and mode (${J({ ev: vCancel.global.event.eventName, ph: vCancel.card.photographer, mode: vCancel.card.mode })})`);
    check((await fsp.readdir(collDir)).length === 1, 'cancelled: no event folder created');

    // create — the real form, real widgets
    const fillForm = async (day, type, city) => {
      await main.waitForSelector('#evHijriYear', { timeout: 15000 });
      await main.fill('#evHijriYear', '1448'); await main.fill('#evHijriMonth', '06'); await main.fill('#evHijriDay', day);
      const compId = await main.evaluate(() => document.querySelector('.ec-comp-row').dataset.compId);
      const tac = async (sel, label) => {
        const c = main.locator(sel);
        await c.locator('input').click(); await c.locator('input').fill(label);
        await c.locator('.tac-item').first().waitFor({ state: 'visible', timeout: 5000 });
        await c.locator('.tac-item').first().click(); await sleep(150);
      };
      await tac(`#ecET-${compId}`, type);
      await tac('#ecGlobalCityDD', city);
      await sleep(400);
    };
    await clickNewEvent();
    // invalid details first: date only — no event type, no city
    await main.waitForSelector('#evHijriYear', { timeout: 15000 });
    await main.fill('#evHijriYear', '1448'); await main.fill('#evHijriMonth', '06'); await main.fill('#evHijriDay', '03');
    await sleep(400);
    check(await main.evaluate(() => document.getElementById('emmCreateBtn').disabled), 'invalid details (no event type / city): Create stays disabled');
    await fillForm('03', 'Ziyarat', 'Mundra');
    check(await main.evaluate(() => !document.getElementById('emmCreateBtn').disabled), 'valid details: Create enabled');
    await main.click('#emmCreateBtn');
    await main.waitForFunction(() => !EventMgmt.isOpen(), null, { timeout: 20000 });
    const created = (await fsp.readdir(collDir)).find(n => n.startsWith('1448-06-03'));
    const ejNew = created ? await readJson(path.join(collDir, created, 'event.json')) : null;
    // Event sequences are allocated per Hijri date (renderer/eventCreator.js "next sequence number for a
    // given hijri date"): the first event of 1448-06-03 is _01.
    check(!!created && /^1448-06-03 _01-Ziyarat-Mundra$/.test(created), `event folder created by the normal naming rule (${created})`);
    check(!!ejNew && ejNew.sequence === 1 && ejNew.hijriDate === '1448-06-03' && ejNew.components.length === 1 && ejNew.components[0].city === 'Mundra' && (ejNew.components[0].types || []).includes('Ziyarat'),
      `event.json written by the normal process (${J(ejNew && { sequence: ejNew.sequence, hijriDate: ejNew.hijriDate, comps: ejNew.components.map(c => ({ city: c.city, types: c.types })) })})`);
    const back2 = await waitFor(async () => { const v = await dumpView(app); return v.popupOpen && v.global?.event?.eventName === created ? v : null; }, 10000);
    check(!!back2, 'Event Creator closed; the companion is back with the NEW event selected');
    check(back2 && back2.card.photographer === P1 && back2.card.mode === 'dump' && back2.card.counts.toImport === 3, `card selection and photographer kept (${J(back2 && { ph: back2.card.photographer, toImport: back2.card.counts.toImport })})`);
    const rA = await importViaPopup(app, P1);
    check(rA.op && rA.op.state === 'completed' && rA.op.result.copied === 3, `imported into the new event (${J(rA.op && rA.op.result)})`);
    check(J(await listFiles(path.join(collDir, created, 'Dump', P1))) === J(['A_0001.JPG', 'A_0002.JPG', 'A_0003.JPG']), 'files in <new event>/Dump/<photographer>');

    // repeated creation with identical details
    await clickNewEvent();
    await fillForm('03', 'Ziyarat', 'Mundra');
    const dupAllowed = await main.evaluate(() => !document.getElementById('emmCreateBtn').disabled);
    if (dupAllowed) { await main.click('#emmCreateBtn'); await main.waitForFunction(() => !EventMgmt.isOpen(), null, { timeout: 20000 }).catch(() => {}); }
    await sleep(1000);
    const sameDay = (await fsp.readdir(collDir)).filter(n => n.startsWith('1448-06-03')).sort();
    const ejNewAfter = await readJson(path.join(collDir, created, 'event.json'));
    check(Array.isArray(ejNewAfter.imports) && ejNewAfter.imports.length === 1 && ejNewAfter.sequence === 1 && fs.existsSync(path.join(collDir, created, 'Dump', P1, 'A_0001.JPG')),
      'repeated creation never touches the first event (its event.json, import record and Dump intact)');
    check(new Set(sameDay).size === sameDay.length && (sameDay.length === 1 || /^1448-06-03 _02-/.test(sameDay[1])), `repeated creation: no folder collision — ${dupAllowed ? 'a distinct next-sequence event' : 'refused by the form'} (${J(sameDay)})`);
    log('repeated-creation behaviour:', dupAllowed ? `allowed → ${sameDay.join(', ')}` : 'Create disabled');
    if (await main.evaluate(() => EventMgmt.isOpen())) { await main.click('#emmBackBtn'); await sleep(300); if (await main.evaluate(() => EventMgmt.isOpen())) await main.click('#emmBackBtn'); }
    await waitFor(async () => (await dumpView(app)).popupOpen === true, 8000);

    // choose an EXISTING event from the companion's own picker (EQI-1.1: no main-window form)
    await withPopup(app, async (page) => {
      await H2.enterDump(page);
      await page.click('#xp-change-event');
      await page.waitForSelector(`#xp-picker-list [data-folder="${E0}"]`, { timeout: 15000 });
      await page.click(`#xp-picker-list [data-folder="${E0}"]`);
      await page.click('#xp-picker-use');
    });
    check(!(await main.evaluate(() => EventMgmt.isOpen())), 'Change Event (no workspace): chosen in the companion — the main-window Event Creator never opens');
    const back3 = await waitFor(async () => { const v = await dumpView(app); return v.popupOpen && v.global?.event?.eventName === E0 ? v : null; }, 10000);
    const v3 = await dumpView(app);
    check(!!back3, `Change event → existing event chosen → companion back with it selected (${J({ popup: v3.popupOpen, ev: v3.global?.event?.eventName, active: await main.evaluate(() => EventCreator.getActiveEventData()?.event?.name || null) })})`);

    // change events while an Import workspace is open (Review in AutoIngest → workspace)
    await withPopup(app, async (page) => {
      await H2.backToOverview(page);
      await page.waitForSelector('.review-selected:not([disabled])', { timeout: 10000 });
      await page.click('.review-selected');
    });
    const wsOpen = await main.waitForFunction(() => document.getElementById('workspace').classList.contains('visible') && typeof activeSource !== 'undefined' && !!activeSource, null, { timeout: 30000 }).then(() => true, () => false);
    check(wsOpen, 'Review in AutoIngest opens the card in the Import workspace (Q2 handoff unchanged)');
    await main.evaluate(() => { window.__eqiTiles = tileMap; });
    await withPopup(app, async (page) => {
      await H2.enterDump(page);
      await page.click('#xp-change-event');
      await page.waitForSelector(`#xp-picker-list [data-folder="${created}"]`, { timeout: 15000 });
      await page.click(`#xp-picker-list [data-folder="${created}"]`);
      await page.click('#xp-picker-use');
    });
    await main.waitForSelector(`.ec-evl-item[data-folder="${created}"]`, { timeout: 15000 });
    await main.click(`.ec-evl-item[data-folder="${created}"]`);
    await main.waitForFunction(() => !document.getElementById('emmContinueBtn').disabled, null, { timeout: 5000 });
    await main.click('#emmContinueBtn');
    await main.waitForFunction(() => !EventMgmt.isOpen(), null, { timeout: 15000 });
    await sleep(800);
    check(await main.evaluate(() => document.getElementById('workspace').classList.contains('visible') && tileMap === window.__eqiTiles), 'with an Import workspace open: the event changes and the SAME workspace stays (source not rescanned)');
    check(await waitFor(async () => (await evNow()) === created, 8000), 'the companion follows the event changed from the workspace');

    // ═══ B. crash during COPY ═══
    await setActiveEvent(main, collDir, COLL, E0);
    await waitFor(async () => (await evNow()) === E0, 10000);
    const b0 = await insert('CARD_B');
    check(b0 && b0.counts.selectedNew === 30, `card B: 30 new (${J(b0 && b0.counts)})`);
    // Crash injection at a precise point: the main process kills itself right after the 5th file is copied.
    await mainRequire(app, '../services/companionService', `const orig = m.notifyImportProgress; m.notifyImportProgress = (p) => { orig(p); const d = Number.isFinite(p.completedCount) ? p.completedCount : p.index; if ((p.status === 'done') && d >= 5) process.kill(process.pid, 'SIGKILL'); }; return true;`);
    const pid = app.process().pid;
    await importViaPopup(app, P2, { wait: false });
    await waitFor(async () => { try { process.kill(pid, 0); return false; } catch { return true; } }, 60000, 100);
    app = null;
    const dumpB = path.join(collDir, E0, 'Dump', P2);
    const partial = await listFiles(dumpB);
    check(partial.length >= 5 && partial.length < 30, `crash during copy: the import stopped part-way (${partial.length}/30 files on disk)`);
    let ej0 = await readJson(path.join(collDir, E0, 'event.json'));
    check(!(ej0.imports || []).some(i => i.photographer === P2), 'crash during copy: no import record was committed for the interrupted copy');
    await launch();
    await waitFor(async () => (await evNow()) === E0, 20000);
    const b1 = await insert('CARD_B');
    check(b1 && b1.counts.selectedNew === 30, `after restart: the card's photos are still NEW (an uncommitted copy is not "imported") (${J(b1 && b1.counts)})`);
    // This computer's own lock from the crashed import: the EXISTING busy-archive dialog appears in
    // the main window; the operator chooses Clear & Continue.
    await importViaPopup(app, P2, { wait: false });
    const dlg = await main.waitForSelector('.dab-clear-btn', { timeout: 20000 }).then(() => true, () => false);
    check(dlg, 'retry: the existing busy-archive dialog offers Clear & Continue for this computer\'s stale lock');
    if (dlg) await main.click('.dab-clear-btn');
    const rB = { op: await waitFor(async () => { const v = await dumpView(app); return v.card?.op && v.card.op.state !== 'pending' ? v.card.op : null; }, 120000) };
    check(rB.op && rB.op.state === 'completed' && rB.op.result.errors === 0 && rB.op.result.copied + rB.op.result.skipped === 30,
      `retry completed: ${J(rB.op && rB.op.result)}`);
    const filesB = await listFiles(dumpB);
    const extrasB = filesB.filter(f => !/^B_\d{4}\.JPG$/.test(f));
    check(filesB.length === 30 && extrasB.length === 0, `retry: exactly 30 files, no duplicates or renamed copies (${filesB.length}; extras: ${extrasB.join(',') || 'none'})`);
    await waitFor(async () => (await dumpView(app)).card?.op?.metadata?.state === 'complete', 90000);
    ej0 = await readJson(path.join(collDir, E0, 'event.json'));
    check((ej0.imports || []).filter(i => i.photographer === P2 && i.destination === 'dump').length === 1 && ej0.status === 'complete', 'retry: exactly one Dump import record; event complete — no new event needed');
    // Files copied before the crash are same-size-skipped on retry; the engine verifies and reconciles
    // skipped files asynchronously (import:commitTransaction "same-size-skip metadata verification").
    const untaggedB = async () => { const out = []; for (const f of filesB) { const t = await et.read(path.join(dumpB, f), ['-G1']); if (![].concat(t['XMP-dc:Creator'] || []).includes(P2)) out.push(f); } return out; };
    let missingB = await untaggedB();
    await waitFor(async () => { missingB = await untaggedB(); return missingB.length === 0; }, 120000, 2000);
    check(missingB.length === 0, `retry: all 30 files carry the photographer — including the ${partial.length} copied before the crash (untagged: ${missingB.join(',') || 'none'})`);

    // ═══ C. crash during METADATA writing ═══
    const c0 = await insert('CARD_C');
    check(c0 && c0.counts.selectedNew === 40, `card C: 40 new (${J(c0 && c0.counts)})`);
    const rC = await importViaPopup(app, P1);
    check(rC.op && rC.op.state === 'completed' && rC.op.result.copied === 40, `card C committed (${J(rC.op && rC.op.result)})`);
    const qdir = path.join(ud, 'metadata-queue');
    const journal = async () => { const f = (await fsp.readdir(qdir).catch(() => [])).find(n => n.endsWith('.journal.jsonl')); if (!f) return { f: null, done: 0 }; const txt = await fsp.readFile(path.join(qdir, f), 'utf8').catch(() => ''); return { f, done: txt.split('\n').filter(l => l.includes('"complete"')).length }; };
    const mid = await waitFor(async () => { const j = await journal(); return j.f && j.done >= 3 && j.done < 40 ? j : null; }, 60000, 50);
    check(!!mid, `metadata writing was in progress when the app crashed (${mid && mid.done}/40 written)`);
    await crash();
    check((await fsp.readdir(qdir)).some(n => n.endsWith('.manifest.json')), 'after the crash a pending metadata batch remains (recoverable)');
    await launch();
    const recovered = await waitFor(async () => !(await fsp.readdir(qdir)).some(n => n.endsWith('.manifest.json')), 120000, 500);
    check(!!recovered, 'after restart the metadata queue resumed and finished the batch');
    const dumpC = path.join(collDir, E0, 'Dump', P1);
    const filesC = await listFiles(dumpC);
    const wrongC = [];
    for (const f of filesC) { const t = await et.read(path.join(dumpC, f), ['-G1']); if (![].concat(t['XMP-dc:Creator'] || []).includes(P1) || ![].concat(t['IPTC:By-line'] || []).includes(P1) || !String(t['IFD0:Artist'] || '').includes(P1)) wrongC.push(f); }
    check(filesC.length === 40 && wrongC.length === 0, `every file of the interrupted batch carries Creator/Artist/By-line (${filesC.length} files, ${wrongC.length} wrong)`);
    ej0 = await readJson(path.join(collDir, E0, 'event.json'));
    check(ej0.metadataState && ej0.metadataState.counts && ej0.metadataState.counts.stale === 0 && (ej0.imports || []).filter(i => i.destination === 'dump' && i.photographer === P1).length === 1,
      `event metadata state after recovery (${J(ej0.metadataState && ej0.metadataState.counts)})`);
    await waitFor(async () => (await evNow()) === E0, 20000);
    const c1 = await insert('CARD_C');
    check(c1 && c1.counts.selectedNew === 0 && c1.counts.selectedImported === 40, `after recovery the batch is recognised as imported — nothing re-selected (${J(c1 && c1.counts)})`);

    // ═══ D. RAW/JPEG pairs, CR3, video — same Dump import path, driven directly ═══
    const rawDir = path.join(work, 'CARD_RAW', 'DCIM');
    await fsp.mkdir(rawDir, { recursive: true });
    const raws = { 'R_0001.CR2': Buffer.from('not-a-real-raw-R1'), 'R_0002.CR3': Buffer.from('not-a-real-raw-R2'), 'R_0003.MP4': Buffer.alloc(200 * 1024, 7) };
    for (const [n, b] of Object.entries(raws)) await fsp.writeFile(path.join(rawDir, n), b);
    await fsp.writeFile(path.join(rawDir, 'R_0001.JPG'), await noiseJpeg(PROJECT_ROOT));
    const rawFiles = ['R_0001.CR2', 'R_0001.JPG', 'R_0002.CR3', 'R_0003.MP4'].map(n => path.join(rawDir, n));
    const rawBefore = await hashTree(path.join(work, 'CARD_RAW'));
    const evPathE0 = await main.evaluate(() => EventCreator.getActiveEventData().eventPath);
    const rD = await main.evaluate((req) => EventDumpImport.run(req), { eventPath: evPathE0, photographer: P2, files: rawFiles, source: { label: 'CARD_RAW', path: path.join(work, 'CARD_RAW') } });
    check(rD.ok && rD.copied === 4 && rD.errors === 0, `RAW/JPEG/CR3/video Dump import (${J(rD)})`);
    await waitFor(async () => !(await fsp.readdir(qdir)).some(n => n.endsWith('.manifest.json')), 60000, 500);
    const dumpD = path.join(collDir, E0, 'Dump', P2);
    const filesD = await listFiles(dumpD);
    check(['R_0001.CR2', 'R_0001.JPG', 'R_0002.CR3', 'VIDEO/R_0003.MP4'].every(f => filesD.includes(f)), `RAW+JPEG pair side by side, CR3, video in VIDEO/ (${J(filesD.filter(f => f.startsWith('R_') || f.startsWith('VIDEO')))})`);
    check(sha(await fsp.readFile(path.join(dumpD, 'R_0001.CR2'))) === sha(raws['R_0001.CR2']) && sha(await fsp.readFile(path.join(dumpD, 'R_0002.CR3'))) === sha(raws['R_0002.CR3']), 'RAW bytes unchanged (hash equal)');
    for (const x of ['R_0001.xmp', 'R_0002.xmp']) {
      const p = path.join(dumpD, x);
      const t = fs.existsSync(p) ? await et.read(p) : {};
      check(fs.existsSync(p) && [].concat(t.Creator || []).includes(P2) && [].concat(t.Subject || []).includes('Waaz'), `${x}: XMP sidecar with Creator = photographer and event keywords (${J({ creator: t.Creator, subject: t.Subject })})`);
    }
    check(J(await hashTree(path.join(work, 'CARD_RAW'))) === J(rawBefore), 'RAW card untouched');

    // ═══ E. Local First → pending sync → archive ═══
    await main.evaluate(async (s) => { await window.api.setLocalStagingRoot(s); await window.api.setDefaultImportMode('local-first'); }, stagingRoot);
    const e0 = await insert('CARD_E');
    check(e0 && e0.counts.selectedNew === 2, 'card E: 2 new');
    const rE = await importViaPopup(app, P1);
    const stagedDump = path.join(stagingRoot, COLL, E0, 'Dump', P1);
    check(rE.op && rE.op.result.importMode === 'local-first' && J((await listFiles(stagedDump)).filter(f => f.startsWith('E_'))) === J(['E_0001.JPG', 'E_0002.JPG']), `Local First: staged into the staging Dump (${J(rE.op && rE.op.result)})`);
    check(!fs.existsSync(path.join(dumpC, 'E_0001.JPG')), 'Local First: the archive copy is not written before sync');
    const job = await waitFor(async () => { const q = await main.evaluate(() => window.api.getSyncQueue()); return (q.jobs || []).find(j => j.event === E0 && (j.status === 'ready-for-sync' || j.readyForSync)) || null; }, 60000, 500);
    check(!!job, `a ready sync job exists (${J(job && { status: job.status })})`);
    if (job) {
      const res = await main.evaluate((id) => window.api.syncJobNow(id), job.jobId || job.id);
      await waitFor(async () => fs.existsSync(path.join(dumpC, 'E_0002.JPG')), 60000, 500);
      check(fs.existsSync(path.join(dumpC, 'E_0001.JPG')) && fs.existsSync(path.join(dumpC, 'E_0002.JPG')), `sync: the Dump files reach the archive event (${J(res).slice(0, 120)})`);
      const sArc = sha(await fsp.readFile(path.join(dumpC, 'E_0001.JPG'))), sStg = sha(await fsp.readFile(path.join(stagedDump, 'E_0001.JPG')));
      check(sArc === sStg, 'sync: archive copy identical to the staged copy');
      const ejArc = await readJson(path.join(collDir, E0, 'event.json'));
      check((ejArc.imports || []).filter(i => i.destination === 'dump').length >= 3 && !ejArc.components.some(c => /dump/i.test(c.folderName || '')), 'sync: archive event.json keeps the Dump import records; Dump still not a component');
    }

    // ═══ F. the rolling import index forgot a card — no duplicates on re-import ═══
    await app.close(); app = null;                                         // deliberate quit
    const idxPath = path.join(ud, 'importIndex.json');
    const idx = await readJson(idxPath);
    for (const k of Object.keys(idx)) if (/^a_000\d\.jpg_/.test(k)) delete idx[k];   // as if rolled off the 5,000-entry history
    await fsp.writeFile(idxPath, J(idx));
    await launch();
    await main.evaluate(async () => { await window.api.setDefaultImportMode('direct-nas'); });   // E left Local First on
    await setActiveEvent(main, collDir, COLL, created);
    await waitFor(async () => (await evNow()) === created, 20000);
    const f0 = await insert('CARD_A');
    check(f0 && f0.counts.selectedNew === 3, `forgotten by the index: card A's photos look new again (${J(f0 && f0.counts)})`);
    const dumpF = path.join(collDir, created, 'Dump', P1);
    const beforeF = await hashTree(dumpF);
    const rF = await importViaPopup(app, P1);
    check(rF.op && rF.op.state === 'completed' && rF.op.result.copied === 0 && rF.op.result.skipped === 3, `re-import: identical photos already in the Dump are not copied again (${J(rF.op && rF.op.result)})`);
    check(J(await hashTree(dumpF)) === J(beforeF), 're-import: Dump folder unchanged — no "_1" duplicates');
    const ejF = await readJson(path.join(collDir, created, 'event.json'));
    check((ejF.imports || []).length === 1, `re-import: no duplicate import record (${(ejF.imports || []).length})`);
    const f1 = await insert('CARD_A');
    check(f1 && f1.counts.selectedImported === 3, 'the held-back photos are recorded as imported again');
    // a genuinely DIFFERENT photo that happens to share a filename is still imported
    await mkCard('CARD_F', 1);
    await fsp.rename(path.join(cards.CARD_F, 'DCIM', '100CANON', 'F_0001.JPG'), path.join(cards.CARD_F, 'DCIM', '100CANON', 'A_0001.JPG'));
    cardHashesBefore.CARD_F = await hashTree(cards.CARD_F);
    await insert('CARD_F');
    const rF2 = await importViaPopup(app, P1);
    check(rF2.op && rF2.op.result.copied === 1 && J(await listFiles(dumpF)) === J(['A_0001.JPG', 'A_0001_1.JPG', 'A_0002.JPG', 'A_0003.JPG']),
      `a different photo with the same name is imported (existing conflict rule: renamed), never skipped (${J(await listFiles(dumpF))})`);

    // ═══ sources ═══
    for (const [k, v] of Object.entries(cards)) check(J(await hashTree(v)) === J(cardHashesBefore[k]), `${k} untouched (every file hash equal)`);
    const allDump = (await listFiles(path.join(collDir, E0, 'Dump'))).map(f => f.split('/')[0]);
    check(!allDump.some(n => /^PC\d+-/i.test(n)), 'no PC sequence anywhere in Dump after all of the above');
    const qg = H.quitGuardSummary(iso);
    log(H.formatQuitGuardSummary(qg));
    check(qg.failed === 0 && qg.unguarded === 0, 'no external quit got through');
  } catch (err) {
    failures++; log('FAIL — exception:', err && (err.stack || err.message));
  } finally {
    await et.end().catch(() => {});
    if (app) await app.close().catch(() => {});
    const qg = H.quitGuardSummary(iso);
    check(qg.endedWithoutExit === 2, `the app ended only by the test's deliberate quits plus the 2 intentional crashes (${qg.endedWithoutExit})`);   // F's quit is deliberate
    check(H.removeTestKeychainItem(iso, testKcBefore), 'test Keychain item absent after the run');
    check(J(H.prodKeychainSnapshot()) === J(prodBefore), 'production Keychain items unchanged (presence only)');
    await fsp.rm(path.join(os.homedir(), 'Library', 'Logs', iso.name), { recursive: true, force: true }).catch(() => {});
    if (!process.env.AI_KEEP_WORK) await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
  }
})();
