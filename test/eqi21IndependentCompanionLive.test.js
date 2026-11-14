'use strict';
// LIVE (AI-FEAT-064 EQI-2.1): the menu-bar companion imports and creates events WITHOUT the main
// application window. Real main.js, companion popup, Event Creator window, copy engine, event.json
// transaction, ExifTool metadata, import index, locks and sync queue.
//
// The main window is closed before any companion work, and every BrowserWindow is sampled
// throughout: the test fails if a main window (renderer/index.html) is ever created, shown or
// focused by an import, a Change Event or a Create New Event.
//
//   A  no main window: card discovery and assessment; single-event Dump import (Direct Archive) —
//      files, event.json, metadata (ExifTool), structured progress (stages, bytes, files) and the
//      completed summary; the new "Divide Between Events" button
//   B  busy archive folder (another computer's lock): the decision is asked IN the companion;
//      Cancel copies nothing; Check Again after the lock is gone imports
//   C  multi-event (divide) import, Local First, no main window: staging per event, one sync job
//      per event after metadata, per-event progress rows
//   D  Event Creator window: only that window opens; Cancel creates nothing; validation (Continue
//      disabled until valid); Create → the companion's new destination; a second event the same day
//      gets the next sequence; the original main-window Event Creator is untouched
//   E  Change Event with no main window; main window opened explicitly during an import and closed
//      during another — both imports complete
//   F  crash during an import → relaunch → re-import: every photo exactly once, no event left in progress
//
// Run: node test/eqi21IndependentCompanionLive.test.js     AI_EQI21_SHOTS=<dir> keeps the screenshots

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
const COLL = 'CollEQI21';
const P1 = 'Testali Bhai', P2 = 'Testhusain Bhai';
const E1 = '1448-05-01 _01-Waaz-Hall-Surat', E2 = '1448-05-01 _02-Ziyafat-Hall-Surat', E3 = '1448-05-01 _03-Majlis-Hall-Surat';

let failures = 0;
const log = (...a) => console.log('[eqi21-live]', ...a);
const check = (c, m) => { if (c) log('PASS —', m); else { failures++; log('FAIL —', m); } };
const J = (x) => JSON.stringify(x);
const { sleep, localDate, fakeDrive, waitFor, createHelpers, listFiles, noiseJpeg: _noise } = require('./support/eventDumpLiveHelpers');
const { mainRequire, diag, passSplash, withPopup, dumpView, setActiveEvent: _setActive, enterDump, pickPhotographer } = createHelpers({ projectRoot: PROJECT_ROOT });
const noiseJpeg = () => _noise(PROJECT_ROOT);

async function shoot(page, dir, name, both = true) {
  const cur = await page.evaluate(() => document.documentElement.dataset.theme);
  for (const theme of both ? [cur, cur === 'dark' ? 'light' : 'dark'] : [cur]) {
    await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
    await page.waitForTimeout(both ? 300 : 0);
    await page.screenshot({ path: path.join(dir, `${name}-${theme}.png`) });
  }
  await page.evaluate((t) => { document.documentElement.dataset.theme = t; }, cur);
}

/** Every BrowserWindow right now: page, visible, focused, auxiliary. */
// a window may be destroyed between the filter and the reads (the Event Creator closes on setImmediate)
const windows = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().flatMap((w) => {
  try { return w.isDestroyed() ? [] : [{ page: (w.webContents.getURL() || '').split('/').pop(), visible: w.isVisible(), focused: w.isFocused() }]; }
  catch { return []; }
}));
const isMainPage = (w) => w.page === 'index.html';

(async () => {
  if (process.platform !== 'darwin') { log('SKIP — macOS only'); return; }
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-eqi21-live-'));
  const shots = process.env.AI_EQI21_SHOTS || path.join(work, 'shots');
  await fsp.mkdir(shots, { recursive: true });
  const ud = path.join(work, 'userData'); await fsp.mkdir(ud);
  const archiveRoot = path.join(work, 'archive'); await fsp.mkdir(archiveRoot);
  const stagingRoot = path.join(work, 'staging'); await fsp.mkdir(stagingRoot);
  const collDir = path.join(archiveRoot, COLL);
  const evDir = (f) => path.join(collDir, f);
  const dumpOf = (f, ph = P1, root = collDir) => path.join(root, f, 'Dump', ph);
  const iso = H.prepareIsolatedApp({ tag: 'eqi21', work, projectRoot: PROJECT_ROOT });
  const prodBefore = H.prodKeychainSnapshot();
  const testKcBefore = H.keychainHas(iso.keychainItem);
  const et = new ExifTool({ maxProcs: 2 });
  const today = localDate();
  const cam = { Make: 'Canon', Model: 'Canon EOS R5', 'ExifIFD:SerialNumber': '0123EQI21' };

  const put = async (dir, name, time, extra = {}) => {
    await fsp.mkdir(dir, { recursive: true });
    const p = path.join(dir, name);
    await fsp.writeFile(p, await noiseJpeg());
    const stamp = `${today.replace(/-/g, ':')} ${time}`;
    await et.write(p, { ...cam, DateTimeOriginal: stamp, CreateDate: stamp, ...extra }, { writeArgs: ['-overwrite_original'] });
    return p;
  };
  const rawOf = async (jpg, mb) => { const p = jpg.replace(/\.JPG$/, '.CR3'); await fsp.writeFile(p, crypto.randomBytes(mb * 1024 * 1024)); return p; };
  const sizeOf = async (files) => (await Promise.all(files.map(f => fsp.stat(f)))).reduce((n, s) => n + s.size, 0);
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const hashTree = async (root) => { const out = {}; for (const f of await listFiles(root)) out[f] = sha(await fsp.readFile(path.join(root, f))); return out; };

  // card A: 40 RAW+JPEG pairs (RAW 3 MB), today
  const cardA = path.join(work, 'CARD_A'), a100 = path.join(cardA, 'DCIM', '100CANON');
  const aFiles = [];
  for (let i = 1; i <= 40; i++) { const j = await put(a100, `IMG_${String(i).padStart(4, '0')}.JPG`, `10:${String(i).padStart(2, '0')}:00`); aFiles.push(j, await rawOf(j, 3)); }
  const aBytes = await sizeOf(aFiles);
  const cardABefore = await hashTree(cardA);

  let app;
  const seenWindows = [];
  let watching = false;
  const watch = async () => { watching = true; while (watching) { try { for (const w of await windows(app)) seenWindows.push(w); } catch { /* app restarting */ } await sleep(120); } };
  try {
    const launch = () => electron.launch({ executablePath: ELECTRON_BIN, args: [...iso.args, '--user-data-dir=' + ud, '--no-sandbox'], cwd: PROJECT_ROOT, env: iso.env(ud), timeout: 60000 });
    app = await launch();
    await H.verifyIsolation(app, iso, ud);
    check(true, 'isolation proven (test identity, temp profile, drivelist stub, quit guard)');
    const main = await passSplash(app);
    await main.evaluate(async (a) => {
      await window.api.initArchiveRoot(a.archiveRoot);
      await window.api.setNasRoot(a.archiveRoot);
      await window.api.setMainArchiveRoot(a.archiveRoot);
      await window.api.setLocalStagingRoot(a.stagingRoot);
      await window.api.setDefaultImportMode('direct-nas');
      if (typeof EventCreator.setSessionArchiveRoot === 'function') EventCreator.setSessionArchiveRoot(a.archiveRoot);
      for (const n of a.names) await window.api.addToList('photographers', n);
      await window.api.keywordsAddKeyword({ label: 'Ziyarat', category: 'event', parentPath: ['Majlis'], parentId: 'event' });
      await window.api.keywordsAddKeyword({ label: 'Mundra', category: 'city', parentPath: ['Mundra'], parentId: 'city' });
    }, { archiveRoot, stagingRoot, names: [P1, P2] });
    const comp = (id, folderName, types, city) => ({ id, folderName, location: 'Hall', city, country: 'India', types, additionalKeywords: [] });
    await main.evaluate(async ({ defs }) => { for (const [d, data] of defs) await window.api.writeEventJson(d, data); }, { defs: [
      [evDir(E1), { version: 1, hijriDate: '1448-05-01', sequence: 1, eventName: 'Waaz-Hall-Surat', components: [comp(1, 'Waaz-Hall', ['Waaz'], 'Surat')] }],
      [evDir(E2), { version: 1, hijriDate: '1448-05-01', sequence: 2, eventName: 'Ziyafat-Hall-Surat', components: [comp(1, 'Ziyafat-Hall', ['Ziyafat'], 'Surat')] }],
      [evDir(E3), { version: 1, hijriDate: '1448-05-01', sequence: 3, eventName: 'Majlis-Hall-Surat', components: [comp(1, 'Majlis-Hall', ['Majlis'], 'Surat'), comp(2, 'Ziyafat-Hall', ['Ziyafat'], 'Surat')] }],
    ] });
    await _setActive(main, collDir, COLL, E1);
    await waitFor(async () => (await dumpView(app)).global?.event?.eventName === E1, 15000);

    // ── the main window is closed: everything below runs without it ──
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if ((w.webContents.getURL() || '').endsWith('index.html')) w.close(); });
    const closed = await waitFor(async () => !(await windows(app)).some(isMainPage), 15000);
    check(!!closed, `main application window closed — remaining windows: ${J(await windows(app))}`);
    check((await mainRequire(app, '../services/windowRegistry', 'return !!m.getMainWindow();')) === false, 'windowRegistry has no main window');
    watch();

    // ═══ A: discovery and a single-event import with no main window ═══
    fs.writeFileSync(iso.drivesFile, J([fakeDrive(cardA, 'CARD_A')]));
    const assessed = await waitFor(async () => { const v = await dumpView(app); return v.assessment?.state === 'complete' && v.card ? v.card : null; }, 90000);
    check(!!assessed && assessed.counts.selectedNew === 80 && assessed.bytesToImport === aBytes, `card discovered and assessed with no main window: 80 new files, ${aBytes} bytes before import (${J(assessed && { n: assessed.counts.selectedNew, b: assessed.bytesToImport })})`);
    const progress = [];
    await withPopup(app, async (page) => {
      if (!page.__errHooked) { page.__errHooked = true; page.on('pageerror', (e) => log('[popup error]', e.message)); page.on('console', (m) => { if (m.type() === 'error') log('[popup console]', m.text().slice(0, 200)); }); }
      // the popup closes on blur by design; a retry after the import started resumes at the summary
      if (!progress.started) {
      await enterDump(page);
      await pickPhotographer(page, P1);
      await waitFor(async () => (await dumpView(app)).card?.photographer === P1, 5000);
      await page.waitForFunction(() => !document.getElementById('xp-import').disabled, null, { timeout: 10000 });
      const ui = await page.evaluate(() => ({ btn: document.getElementById('xp-import').textContent, ready: document.getElementById('xp-ready').textContent,
        divide: document.getElementById('xp-divide').textContent, divideCls: document.getElementById('xp-divide').className, hint: document.getElementById('xp-divide-hint').textContent }));
      check(/Import 80 Files to Dump/.test(ui.btn) && /80 files · \d+(\.\d)? MB/.test(ui.ready), `primary action and the transfer size before import (${J(ui).slice(0, 220)})`);
      check(ui.divide === 'Divide Between Events' && /btn-outline/.test(ui.divideCls) && ui.hint === 'Assign photographs by time or visual selection.', 'the multi-event action is an outlined button with its explanation');
      await shoot(page, shots, '1-expanded-divide-button');
      await page.click('#xp-import');
      progress.started = true;
      // main-process responsiveness across the whole import (copy, event record, metadata)
      progress.rtt = (async () => { const r = []; for (;;) { const o = (await dumpView(app)).card?.op; if (o && o.state !== 'pending') break; const t0 = Date.now(); await app.evaluate(() => 1); r.push(Date.now() - t0); await sleep(100); } r.sort((a, b) => a - b); return { n: r.length, max: r[r.length - 1] || 0, p50: r[Math.floor(r.length / 2)] || 0 }; })();
      // structured progress while it runs
      for (let i = 0; i < 400; i++) {
        const v = (await dumpView(app)).card?.op;
        if (v) progress.push({ stage: v.stage, state: v.state, t: v.totals, speed: v.speedBps, eta: v.etaSec, calc: v.calculating });
        if (v && v.state !== 'pending') break;
        if (v && process.env.AI_EQI21_DEBUG && i % 5 === 0) {
          const dom = await page.evaluate(async () => { const sn = await window.companion.getSnapshot(); const src = sn.sources[0]; return { ipHidden: document.getElementById('xp-ip').hidden, btnHidden: document.getElementById('xp-import').hidden,
            view: document.querySelector('.popup').dataset.view, snapView: sn.view, snapOp: src && src.assessment && src.assessment.dump && src.assessment.dump.op ? src.assessment.dump.op.stage : 'none', busy: sn.dump && sn.dump.busy }; }).catch(e => ({ err: e.message }));
          log('[debug]', v.stage, J(dom));
        }
        if (v && v.stage === 'metadata' && !progress.metaShot) {
          progress.metaShot = true;
          if (await page.waitForSelector('#xp-ip:not([hidden]) .ip-stage[data-stage="metadata"]', { timeout: 3000 }).catch(() => null)) await shoot(page, shots, '3-progress-metadata', false).catch(() => {});
        }
        await sleep(40);
      }
      }
      if (!(await page.evaluate(() => document.querySelector('.popup').dataset.view === 'expanded'))) await enterDump(page);
      await page.waitForSelector('#xp-ip .ip-summary', { timeout: 120000 });
      await shoot(page, shots, '4-completed-summary');
      // The copy stage of this synthetic card is near-instant (card and archive share one APFS volume, so
      // files are cloned). The real progress component is rendered here with a representative copy-stage
      // view (a 10.6 GB card mid-transfer) to show its layout; the byte/speed/ETA logic is unit-tested.
      await page.evaluate(() => {
        const op = { id: 'demo', kind: 'single', state: 'pending', stage: 'copying', mode: 'direct-nas', decision: null, current: 0, calculating: false, stalled: false,
          speedBps: 87.4e6, etaSec: 72, totals: { totalBytes: 10.6e9, transferredBytes: 4.3e9, processedBytes: 4.38e9, copiedBytes: 4.3e9, skippedBytes: 0.08e9, failedBytes: 0, files: { total: 412, copied: 166, skipped: 3, failed: 0 } },
          events: [{ eventId: '1448-05-01 _01-Waaz-Hall-Surat', photographer: 'Testali Bhai', status: 'copying', bytes: {}, metadata: null, sync: null }] };
        document.getElementById('xp-import').hidden = true; document.getElementById('xp-divide-row').hidden = true; document.getElementById('xp-ready').hidden = true;
        window.ImportProgress.render(document.getElementById('xp-ip'), op, { onDecide: () => {} });
        // hold the injected view: a live snapshot push would otherwise re-render the real (completed) import
        window.__ipRender = window.ImportProgress.render; window.ImportProgress.render = () => {};
        const st = document.createElement('style'); st.id = '__ipHold'; st.textContent = '#xp-import,#xp-divide-row,#xp-ready,#xp-result{display:none!important}'; document.head.appendChild(st);
      });
      await shoot(page, shots, '2-progress-copying-representative');
      await page.evaluate(() => { window.ImportProgress.render = window.__ipRender; delete window.__ipRender; document.getElementById('__ipHold')?.remove(); });
    });
    const opA = (await dumpView(app)).card?.op;
    const rttA = await progress.rtt;
    check(rttA.n >= 3 && rttA.max < 500, `main process responsive throughout the import with no main window (${rttA.n} round trips, max ${rttA.max} ms, median ${rttA.p50} ms)`);
    const stages = [...new Set(progress.map(p => p.stage))];
    check(opA && opA.state === 'completed' && opA.totals.files.copied === 80 && opA.totals.copiedBytes === aBytes && opA.totals.totalBytes === aBytes,
      `single-event import completed: 80 files, ${opA && opA.totals.copiedBytes} of ${aBytes} bytes, verified (${opA && opA.state})`);
    check(stages.includes('copying') && stages.includes('metadata') && progress.findIndex(p => p.stage === 'metadata') > progress.findIndex(p => p.stage === 'copying'),
      `distinct stages observed in order (${J(stages)}) — copy completion is not import completion`);
    check(progress.every(p => p.state !== 'completed' || p.stage === 'done'), 'never "completed" before metadata finished');
    check(progress.filter(p => p.stage === 'copying').every(p => p.t.transferredBytes <= p.t.totalBytes && (p.eta === null || p.speed > 0)), 'bytes never exceed the total; an estimate only with a measured speed');
    const dumpA = await listFiles(dumpOf(E1));
    const media = dumpA.filter(f => !/\.xmp$/i.test(f));
    check(media.length === 80 && media.filter(f => f.endsWith('.CR3')).length === 40 && dumpA.filter(f => /\.xmp$/i.test(f)).length === 40,
      `E1/Dump/${P1}: 80 media files incl. 40 RAW, each RAW with its metadata sidecar (${media.length} + ${dumpA.length - media.length} XMP)`);
    const ejA = JSON.parse(await fsp.readFile(path.join(evDir(E1), 'event.json'), 'utf8'));
    check(ejA.status === 'complete' && (ejA.imports || []).filter(i => i.destination === 'dump' && i.photographer === P1).length === 1, 'event.json: one Dump import entry, status complete');
    const tags = await et.read(path.join(dumpOf(E1), 'IMG_0001.JPG'), ['-G1']);
    check([].concat(tags['XMP-dc:Creator'] || []).includes(P1) && [].concat(tags['XMP-dc:Subject'] || []).includes('Waaz'), 'metadata written by the real ExifTool batch (Creator, event keyword)');
    check(J(await hashTree(cardA)) === J(cardABefore), 'card untouched');

    if (process.env.AI_EQI21_ONLY_A) throw new Error('stopped after A (debug)');
    // ═══ B: busy archive folder — another computer's lock ═══
    const cardB = path.join(work, 'CARD_B'), b100 = path.join(cardB, 'DCIM', '100CANON');
    for (let i = 1; i <= 3; i++) await put(b100, `LCK_${i}.JPG`, `11:0${i}:00`);
    await _setActiveCompanion(app, E2);
    const lockSvc = require(path.join(PROJECT_ROOT, 'services', 'archiveLockService'));
    const lockPath = lockSvc.getLockPath(archiveRoot, { collection: COLL, eventFolderName: E2, photographerFolderName: P1 });
    await fsp.mkdir(path.dirname(lockPath), { recursive: true });
    await fsp.writeFile(lockPath, J({ lockType: 'photographer-archive-write', collection: COLL, eventFolderName: E2, photographerFolderName: P1, deviceName: 'OTHER-MAC', status: 'active', createdAt: Date.now(), lastHeartbeatAt: Date.now(), expiresAt: Date.now() + 600000 }));
    fs.writeFileSync(iso.drivesFile, J([fakeDrive(cardB, 'CARD_B')]));
    await waitFor(async () => { const v = await dumpView(app); return v.assessment?.state === 'complete' && v.card?.counts?.selectedNew === 3; }, 60000);
    await withPopup(app, async (page) => {
      await enterDump(page);
      await pickPhotographer(page, P1);
      await page.waitForFunction(() => !document.getElementById('xp-import').disabled, null, { timeout: 10000 });
      await page.click('#xp-import');
      await page.waitForSelector('#xp-ip .ip-decision', { timeout: 20000 });
      const txt = await page.textContent('#xp-ip .ip-decision');
      const btns = await page.$$eval('#xp-ip .ip-decision button', b => b.map(x => x.textContent));
      check(/OTHER-MAC/.test(txt) && J(btns) === J(['Cancel Import', 'Check Again']), `the busy-folder decision is asked in the companion; no Clear for another computer's lock (${J(btns)})`);
      await shoot(page, shots, '5-busy-folder-decision');
      check(!(await windows(app)).some(isMainPage), 'no main window for the decision');
      await page.click('#xp-ip .ip-decision button:has-text("Cancel Import")');
    });
    const refusedB = await waitFor(async () => { const o = (await dumpView(app)).card?.op; return o && o.state === 'refused' ? o : null; }, 15000);
    check(refusedB && refusedB.reason === 'archive-busy' && !fs.existsSync(dumpOf(E2)), 'Cancel: nothing copied, lock left in place');
    check(fs.existsSync(lockPath), 'the other computer\'s lock was never cleared');
    await withPopup(app, async (page) => { await enterDump(page); await page.waitForFunction(() => !document.getElementById('xp-import').disabled, null, { timeout: 10000 }); await page.click('#xp-import'); await page.waitForSelector('#xp-ip .ip-decision', { timeout: 20000 }); });
    await fsp.rm(lockPath);
    await withPopup(app, async (page) => { await page.click('#xp-ip .ip-decision button:has-text("Check Again")'); });
    const doneB = await waitFor(async () => { const o = (await dumpView(app)).card?.op; return o && o.state !== 'pending' && o.state !== 'refused' ? o : null; }, 60000);
    check(doneB && doneB.state === 'completed' && (await listFiles(dumpOf(E2))).length === 3, `Check Again after the other computer finished: imported (${doneB && doneB.state})`);

    // ═══ C: multi-event (divide) import, Local First, no main window ═══
    await setDefaultMode(app, 'local-first');
    const cardC = path.join(work, 'CARD_C'), c100 = path.join(cardC, 'DCIM', '100CANON');
    for (let i = 1; i <= 4; i++) await put(c100, `MOR_${i}.JPG`, `09:1${i}:00`);
    for (let i = 1; i <= 3; i++) await put(c100, `EVE_${i}.JPG`, `18:1${i}:00`);
    await _setActiveCompanion(app, E1);
    fs.writeFileSync(iso.drivesFile, J([fakeDrive(cardC, 'CARD_C')]));
    await waitFor(async () => { const v = await dumpView(app); return v.assessment?.state === 'complete' && v.card?.counts?.selectedNew === 7; }, 60000);
    const dv = async () => { const d = await diag(app); return d.snapshot.sources[0].assessment.divide; };
    let multiStarted = false;   // the popup closes on blur by design; a retry after the import started resumes at the summary
    await withPopup(app, async (page) => {
      if (!multiStarted) {
      await enterDump(page);
      await pickPhotographer(page, P2);
      await waitFor(async () => (await dumpView(app)).card?.photographer === P2, 5000);
      await page.click('#xp-divide');
      await page.waitForSelector('#dv:not([hidden])', { timeout: 10000 });
      for (const [start, end, ev] of [['09:00:00', '12:00:00', E1], ['17:00:00', '20:00:00', E3]]) {
        const n = (await dv()).ranges.length;
        await page.click('#dv-add-range');
        const id = await waitFor(async () => { const r = (await dv()).ranges; return r.length === n + 1 ? r[n].id : null; }, 5000);
        const inputs = page.locator(`.dv-range[data-id="${id}"] input.dv-time`);
        await inputs.nth(0).fill(start); await inputs.nth(0).dispatchEvent('change');
        await inputs.nth(1).fill(end); await inputs.nth(1).dispatchEvent('change');
        await waitFor(async () => (await dv()).ranges.find(r => r.id === id)?.start === start.slice(0, 5), 5000);
        await page.click('#dv-sub');
        await page.click(`.dv-range[data-id="${id}"] .dv-event-btn`);
        await page.waitForSelector('#dv-chooser:not([hidden]) #dv-chooser-list .picker-item', { timeout: 10000 });
        await page.locator('#dv-chooser-list .picker-item', { hasText: ev }).first().click();
        await page.click('#dv-chooser-use');
        await waitFor(async () => (await dv()).ranges.find(r => r.id === id)?.eventId === ev, 5000);
      }
      await page.click('#dv-review');
      await page.waitForSelector('#dv-review-panel:not([hidden]) .dv-review-event');
      const rv = await page.evaluate(() => ({ meta: document.getElementById('dv-review-meta').textContent, btn: document.getElementById('dv-review-import').textContent, rows: [...document.querySelectorAll('.dv-review-event')].map(e => e.textContent) }));
      check(/Local First/.test(rv.meta) && /7 files · \d+ KB|7 files · \d+(\.\d)? MB/.test(rv.meta) && /7 files, /.test(rv.btn) && rv.rows.every(r => /KB|MB/.test(r)), `review shows the transfer size overall and per event (${J(rv).slice(0, 260)})`);
      await page.click('#dv-review-import');
      multiStarted = true;
      await page.waitForSelector('#dv-ip:not([hidden]) .ip-events, #dv-ip .ip-summary', { timeout: 30000 });
      await shoot(page, shots, '6-multi-progress', false).catch(() => {});
      }
      await page.waitForSelector('#dv-ip .ip-summary', { timeout: 120000 });
      await shoot(page, shots, '7-multi-summary');
    });
    const opC = (await dv()).op;
    check(opC && opC.state === 'completed' && opC.events.length === 2 && opC.events.every(e => e.status === 'completed' && e.metadata && e.metadata.state === 'complete'),
      `multi-event import completed per event with metadata (${J(opC && opC.events.map(e => [e.eventId.slice(0, 14), e.status, e.metadata && e.metadata.state, e.sync]))})`);
    check(J(await listFiles(dumpOf(E1, P2, path.join(stagingRoot, COLL)))) === J(['MOR_1.JPG', 'MOR_2.JPG', 'MOR_3.JPG', 'MOR_4.JPG']) && J(await listFiles(dumpOf(E3, P2, path.join(stagingRoot, COLL)))) === J(['EVE_1.JPG', 'EVE_2.JPG', 'EVE_3.JPG']),
      'Local First: each event staged in its own staging Dump');
    check(!fs.existsSync(dumpOf(E1, P2)) && !fs.existsSync(dumpOf(E3, P2)), 'the archive is not written directly (sync later)');
    const syncJobs = await waitFor(async () => { const q = await mainRequire(app, '../services/syncQueueService', 'return m.refreshQueue().then(() => m.getQueue());'); const js = ((q && q.jobs) || []).filter(j => [E1, E3].includes(j.event || '')); return js.length >= 2 ? js : null; }, 30000, 500);
    check(!!syncJobs && syncJobs.length === 2 && opC.events.every(e => e.sync === 'queued'), `one sync job per event, registered in main after metadata (${J((syncJobs || []).map(j => [j.event, j.status]))})`);
    await setDefaultMode(app, 'direct-nas');

    // ═══ D: the companion's Event Creator window ═══
    const ecWindow = () => app.windows().find(p => p.url().endsWith('eventCreatorWindow.html'));
    await withPopup(app, async (page) => {
      if (await page.evaluate(() => document.querySelector('.popup').dataset.view === 'divide')) { await page.click('#dv-back'); }
      await enterDump(page);
      await page.click('#xp-new-event');
    });
    const ec = await waitFor(async () => ecWindow() || null, 15000);
    // The form's own "discard unsaved changes?" confirm: an operator answers it (Playwright would dismiss it).
    const acceptDialogs = (w) => { if (w && !w.__dlg) { w.__dlg = true; w.on('dialog', (d) => d.accept().catch(() => {})); } };
    acceptDialogs(ec);
    check(!!ec, 'Create New Event opens the Event Creator window');
    await ec.waitForFunction(() => document.body.dataset.ready === 'create', null, { timeout: 20000 });
    const sideways = await ec.evaluate(() => [...document.querySelectorAll('.emm-box *')].filter((e) => /auto|scroll/.test(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth + 1).map((e) => `${e.id || e.className}:${e.scrollWidth}/${e.clientWidth}`));
    check(sideways.length === 0, `the Event Creator fits its window — no sideways scrolling (${J(sideways)})`);
    let wins = await windows(app);
    check(!wins.some(isMainPage) && wins.some(w => w.page === 'eventCreatorWindow.html' && w.visible), `only the Event Creator window — never the main application (${J(wins)})`);
    const box = await ec.evaluate(() => { const b = document.querySelector('.emm-box').getBoundingClientRect(); return { w: b.width, h: b.height, vw: innerWidth, vh: innerHeight, hasForm: !!document.getElementById('evHijriYear'), createDisabled: document.getElementById('emmCreateBtn').disabled }; });
    check(box.hasForm && box.w >= box.vw - 2 && box.createDisabled, `the existing create form fills the window; Continue disabled until valid (${J(box)})`);
    await shoot(ec, shots, '8-event-creator-window');
    // cancel: Back to the list, Back again → closed, nothing created
    const before = (await fsp.readdir(collDir)).sort();
    for (let i = 0; i < 3 && ecWindow(); i++) { await ecWindow().click('#emmBackBtn').catch(() => {}); await sleep(400); }
    await waitFor(async () => !ecWindow(), 10000);
    check(!ecWindow() && J((await fsp.readdir(collDir)).sort()) === J(before), 'Cancel: the window closes and no event is created');
    check(((await dumpView(app)).global.event || {}).eventName === E1, 'cancelled: the destination is unchanged');
    // create
    const createIn = async () => {
      await withPopup(app, async (page) => { await enterDump(page); await page.click('#xp-new-event'); });
      const w = await waitFor(async () => ecWindow() || null, 15000);
      acceptDialogs(w);
      await w.waitForFunction(() => document.body.dataset.ready === 'create', null, { timeout: 20000 });
      await w.fill('#evHijriYear', '1448'); await w.fill('#evHijriMonth', '05'); await w.fill('#evHijriDay', '01');
      const compId = await w.evaluate(() => document.querySelector('.ec-comp-row').dataset.compId);
      const t1 = w.locator(`#ecET-${compId}`); await t1.locator('input').click(); await t1.locator('input').fill('Ziyarat');
      await t1.locator('.tac-item').first().waitFor({ state: 'visible', timeout: 5000 }); await t1.locator('.tac-item').first().click();
      const c1 = w.locator('#ecGlobalCityDD'); await c1.locator('input').click(); await c1.locator('input').fill('Mundra');
      await c1.locator('.tac-item').first().waitFor({ state: 'visible', timeout: 5000 }); await c1.locator('.tac-item').first().click();
      await w.waitForFunction(() => !document.getElementById('emmCreateBtn').disabled, null, { timeout: 5000 });
      await w.click('#emmCreateBtn');
      await waitFor(async () => !ecWindow(), 20000);
      return waitFor(async () => { const e = (await dumpView(app)).global.event; return e && /Ziyarat/.test(e.eventName) && !before.includes(e.eventName) ? e.eventName : null; }, 15000);
    };
    const NEW1 = await createIn();
    check(!!NEW1 && fs.existsSync(path.join(evDir(NEW1), 'event.json')) && /^1448-05-01 _04-/.test(NEW1), `created with the existing rules and next sequence: "${NEW1}"; it is the companion's destination`);
    const NEW2 = await createIn();
    check(!!NEW2 && /^1448-05-01 _05-/.test(NEW2), `a second event the same day gets the next sequence: "${NEW2}"`);
    check((await mainRequire(app, '../services/companionService', 'return m.getDiagnostics().popupOpen;')) === true, 'back to the companion after creating');

    // ═══ E: Change Event with no main window; main window opened / closed during imports ═══
    await withPopup(app, async (page) => {
      await enterDump(page);
      await page.click('#xp-change-event');
      await page.waitForSelector('#xp-picker:not([hidden]) .picker-item', { timeout: 10000 });
      await page.locator('#xp-picker-list .picker-item', { hasText: E3 }).first().click();
      await page.click('#xp-picker-use');
    });
    await waitFor(async () => (await dumpView(app)).global.event?.eventName === E3, 10000);
    check(!(await windows(app)).some(isMainPage), 'Change Event: chosen in the companion, no main window');
    const cardE = path.join(work, 'CARD_E'), e100 = path.join(cardE, 'DCIM', '100CANON');
    const eFiles = [];
    for (let i = 1; i <= 25; i++) { const j = await put(e100, `OPN_${String(i).padStart(2, '0')}.JPG`, `13:${String(i).padStart(2, '0')}:00`); eFiles.push(j, await rawOf(j, 4)); }
    fs.writeFileSync(iso.drivesFile, J([fakeDrive(cardE, 'CARD_E')]));
    await waitFor(async () => { const v = await dumpView(app); return v.assessment?.state === 'complete' && v.card?.counts?.selectedNew === 50; }, 90000);
    await withPopup(app, async (page) => { await enterDump(page); await pickPhotographer(page, P1); await page.waitForFunction(() => !document.getElementById('xp-import').disabled, null, { timeout: 10000 }); await page.click('#xp-import'); });
    await waitFor(async () => (await dumpView(app)).card?.op?.state === 'pending', 10000, 50);
    watching = false; await sleep(200);
    check(!seenWindows.some(isMainPage), `no main window was created, shown or focused by any companion action (${seenWindows.length} window samples)`);
    // explicitly open AutoIngest while the import runs
    await withPopup(app, async (page) => { await page.click('#open-btn'); });
    const opened = await waitFor(async () => (await windows(app)).some(w => isMainPage(w) || w.page === 'splash.html'), 20000);
    check(!!opened, 'Open AutoIngest during an import opens the application');
    const opE = await waitFor(async () => { const o = (await dumpView(app)).card?.op; return o && o.state !== 'pending' ? o : null; }, 120000);
    const mediaOf = async (dir, re) => (await listFiles(dir)).filter(f => !/\.xmp$/i.test(f) && (!re || re.test(f)));
    check(opE && opE.state === 'completed' && opE.totals.files.copied === 50 && (await mediaOf(dumpOf(E3), /^OPN_/)).length === 50, `the import completed while the application window was opened (${opE && opE.state})`);
    // close the main window during another import
    const mainPage2 = await waitFor(async () => app.windows().find(p => p.url().endsWith('index.html')) || null, 30000);
    if (mainPage2) {
      await mainPage2.waitForFunction(() => typeof EventCreator !== 'undefined', null, { timeout: 30000 }).catch(() => {});
      const cardF = path.join(work, 'CARD_F'), f100 = path.join(cardF, 'DCIM', '100CANON');
      for (let i = 1; i <= 25; i++) { const j = await put(f100, `CLS_${String(i).padStart(2, '0')}.JPG`, `14:${String(i).padStart(2, '0')}:00`); await rawOf(j, 4); }
      fs.writeFileSync(iso.drivesFile, J([fakeDrive(cardF, 'CARD_F')]));
      await waitFor(async () => { const v = await dumpView(app); return v.assessment?.state === 'complete' && v.card?.counts?.selectedNew === 50; }, 90000);
      await withPopup(app, async (page) => { await enterDump(page); await pickPhotographer(page, P1); await page.waitForFunction(() => !document.getElementById('xp-import').disabled, null, { timeout: 10000 }); await page.click('#xp-import'); });
      await waitFor(async () => (await dumpView(app)).card?.op?.state === 'pending', 10000, 50);
      await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if ((w.webContents.getURL() || '').endsWith('index.html')) w.destroy(); });
      const opF = await waitFor(async () => { const o = (await dumpView(app)).card?.op; return o && o.state !== 'pending' ? o : null; }, 120000);
      check(opF && opF.state === 'completed' && (await mediaOf(dumpOf(E3), /^CLS_/)).length === 50, `the import completed after the application window was closed mid-import (${opF && opF.state})`);
    }

    // ═══ F: crash during an import → relaunch → re-import, exactly once ═══
    const cardG = path.join(work, 'CARD_G'), g100 = path.join(cardG, 'DCIM', '100CANON');
    for (let i = 1; i <= 40; i++) { const j = await put(g100, `CRS_${String(i).padStart(2, '0')}.JPG`, `15:${String(i).padStart(2, '0')}:00`); await rawOf(j, 6); }
    await _setActiveCompanion(app, E2);
    fs.writeFileSync(iso.drivesFile, J([fakeDrive(cardG, 'CARD_G')]));
    await waitFor(async () => { const v = await dumpView(app); return v.assessment?.state === 'complete' && v.card?.counts?.selectedNew === 80; }, 90000);
    await withPopup(app, async (page) => { await enterDump(page); await pickPhotographer(page, P2); await page.waitForFunction(() => !document.getElementById('xp-import').disabled, null, { timeout: 10000 }); await page.click('#xp-import'); });
    await waitFor(async () => { const o = (await dumpView(app)).card?.op; return o && o.stage === 'copying' && o.totals.files.copied >= 4; }, 30000, 20);
    const pid = app.process().pid;
    process.kill(pid, 'SIGKILL');
    await sleep(1500);
    const partial = (await listFiles(dumpOf(E2, P2))).length;
    check(partial > 0 && partial < 80, `crashed mid-import: ${partial} of 80 files had been copied`);
    app = await launch();
    const main2 = await passSplash(app);
    void main2;
    await app.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) if ((w.webContents.getURL() || '').endsWith('index.html')) w.close(); });
    await waitFor(async () => !(await windows(app)).some(isMainPage), 15000);
    await _setActiveCompanion(app, E2);
    fs.writeFileSync(iso.drivesFile, J([]));
    await sleep(2500);
    fs.writeFileSync(iso.drivesFile, J([fakeDrive(cardG, 'CARD_G')]));
    await waitFor(async () => { const v = await dumpView(app); return v.assessment?.state === 'complete' && v.card; }, 90000);
    await withPopup(app, async (page) => { await enterDump(page); await pickPhotographer(page, P2); await page.waitForFunction(() => !document.getElementById('xp-import').disabled, null, { timeout: 10000 }); await page.click('#xp-import'); });
    // The crashed import still holds THIS computer's archive lock: the companion asks; nothing is cleared by itself.
    const dec = await waitFor(async () => { const o = (await dumpView(app)).card?.op; return o && (o.decision || o.state !== 'pending') ? o : null; }, 30000);
    check(dec && dec.decision && dec.decision.sameDevice === true, `after the crash the stale lock of this computer is reported and waits for the operator (${J(dec && dec.decision)})`);
    if (dec && dec.decision) {
      await withPopup(app, async (page) => {
        await page.waitForSelector('#xp-ip .ip-decision', { timeout: 10000 });
        await shoot(page, shots, '9-stale-lock-decision');
        await page.click('#xp-ip .ip-decision button:has-text("Clear Lock & Continue")');
      });
    }
    const opG = await waitFor(async () => { const o = (await dumpView(app)).card?.op; return o && o.state !== 'pending' ? o : null; }, 180000);
    const g = (await listFiles(dumpOf(E2, P2))).filter(f => !/\.xmp$/i.test(f));
    const ejG = JSON.parse(await fsp.readFile(path.join(evDir(E2), 'event.json'), 'utf8'));
    check(opG && /completed/.test(opG.state) && g.length === 80 && g.every(f => /^CRS_\d\d\.(JPG|CR3)$/.test(f)), `after the crash, re-import brings every photo exactly once (${g.length} files; ${opG && opG.state}; ${opG && opG.totals.files.skipped} skipped)`);
    check(ejG.status === 'complete', `no event left in progress (${ejG.status})`);

    const qg = H.quitGuardSummary(iso);
    log(H.formatQuitGuardSummary(qg));
  } catch (err) {
    failures++; log('FAIL — exception:', err && (err.stack || err.message));
  } finally {
    watching = false;
    await et.end().catch(() => {});
    if (app) await app.close().catch(() => {});
    check(H.removeTestKeychainItem(iso, testKcBefore), 'test Keychain item absent after the run');
    check(J(H.prodKeychainSnapshot()) === J(prodBefore), 'production Keychain items unchanged (presence only)');
    await fsp.rm(path.join(os.homedir(), 'Library', 'Logs', iso.name), { recursive: true, force: true }).catch(() => {});
    await fsp.rm(work, { recursive: true, force: true }).catch(() => {});
    log('screenshots:', process.env.AI_EQI21_SHOTS ? shots : '(temp, removed)');
    log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURE(S)`);
    process.exit(failures === 0 ? 0 : 1);
  }

  /** The companion's destination, chosen through its own picker logic (no main window). */
  async function _setActiveCompanion(a, folder) {
    await mainRequire(a, '../services/companionService', `return true;`);
    await withPopup(a, async (page) => {
      if (await page.evaluate(() => document.querySelector('.popup').dataset.view === 'divide')) await page.click('#dv-back');
      if (await page.evaluate(() => document.querySelector('.popup').dataset.view === 'compact')) {
        const has = await page.$('.card-row .event-dump-btn:not([disabled])');
        if (!has) return;
      }
    }).catch(() => {});
    // Choose via the companion API directly (same validation as the picker).
    await withPopup(a, (page) => page.evaluate(async (f) => { await window.companion.listEvents(); return window.companion.chooseEvent(f); }, folder));
    await waitFor(async () => (await dumpView(a)).global?.event?.eventName === folder, 10000);
  }
  async function setDefaultMode(a, mode) {
    await mainRequire(a, '../services/settings', 'return m.setDefaultImportMode(arg);', mode);
  }
})();
