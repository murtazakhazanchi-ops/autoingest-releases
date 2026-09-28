'use strict';

// Live UI verification of a MULTI-EVENT import in LOCAL FIRST mode, against synthetic fixtures.
//
// Local First copies into a local staging root and later syncs to the archive. Each event's
// metadata batch completes independently and each writes its OWN pending sync manifest — the
// renderer used to hold ONE pending-manifest slot, so the second event would have overwritten
// the first (and its sync job never written). This test drives three events through ONE import
// and asserts three independent, correct sync records.
//
//   Event A (multi-component) + Event B (multi-component) + Event C (single-component, Assign)
//     → ONE combined import, Local First
//     → files staged per event / component / photographer; NOTHING copied into the archive yet
//     → exactly three sync-queue jobs, one per event, none overwritten
//     → per-event metadata correct on the staged files (no cross-event tags)
//
// SYNTHETIC ONLY: temp userData, temp "archive", temp staging root, temp source.
// Run: node test/multiEventLocalFirstUiLive.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
function log(...args) { console.log('[multi-event-lf]', ...args); }
let failures = 0;
function check(cond, msg) { if (cond) log('PASS —', msg); else { failures++; log('FAIL —', msg); } }
const mkTmp = (prefix) => fsp.mkdtemp(path.join(os.tmpdir(), prefix));
async function writeFake(p, bytes = 60 * 1024) { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, Buffer.alloc(bytes, 0xab)); }

(async () => {
  const userDataDir = await mkTmp('ai-mev-lf-userdata-');
  const archiveRoot = await mkTmp('ai-mev-lf-archive-');
  const stagingRoot = await mkTmp('ai-mev-lf-staging-');
  const sourceRoot  = await mkTmp('ai-mev-lf-source-');
  const coll = 'CollLocalFirstUi';
  log('archiveRoot =', archiveRoot, '\n                 stagingRoot =', stagingRoot);

  const app = await electron.launch({ args: [PROJECT_ROOT, '--user-data-dir=' + userDataDir, '--no-sandbox'], cwd: PROJECT_ROOT, timeout: 60000 });
  let window = await app.firstWindow({ timeout: 60000 });
  await window.waitForTimeout(1500);
  const splash = await window.evaluate(() => {
    const vis = id => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  });
  const mainWindowPromise = app.waitForEvent('window', { timeout: 30000 });
  if (splash.create) { await window.fill('#splashInputName', 'LF Operator'); await window.fill('#splashInputRole', 'QA'); await window.click('#splashCreateStartBtn'); }
  else if (splash.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else { await window.click('#splashNewProfileBtn'); await window.fill('#splashInputName', 'LF Operator'); await window.fill('#splashInputRole', 'QA'); await window.click('#splashCreateStartBtn'); }
  } else if (splash.welcome) { await window.click('#splashContinueBtn'); }
  window = await mainWindowPromise;
  const pageErrors = [];
  window.on('pageerror', err => { pageErrors.push(err.message); log('[pageerror]', err.message); });
  window.on('console', (m) => { if (m.type() === 'error' && !/DeprecationWarning|Electron Security Warning/.test(m.text())) log('[renderer.error]', m.text().slice(0, 220)); });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);
  await window.waitForFunction(() => typeof window.selectSource === 'function', { timeout: 15000 });

  const ev = (fn, arg) => window.evaluate(fn, arg);
  async function clickHidden(sel) { await ev((s) => { const el = document.querySelector(s); if (!el) throw new Error('no element ' + s); el.click(); }, sel); }

  await ev(async (a) => { await window.api.setMainArchiveRoot(a.archiveRoot); await window.api.setLocalStagingRoot(a.stagingRoot); await window.api.setDefaultImportMode('local-first'); }, { archiveRoot, stagingRoot });
  await ev(() => { if (typeof obFinish === 'function') obFinish(); });
  await window.waitForTimeout(400);
  const ops = await ev(async () => window.api.getArchiveOperationsStatus());
  log('archive ops status:', JSON.stringify({ status: ops.status, mode: ops.defaultImportMode, staging: !!ops.localStagingRoot }));
  check(!!ops.localStagingRoot && ops.defaultImportMode === 'local-first', 'Local First is configured with a synthetic staging root');

  // ── three events on the (synthetic) archive ──
  const mk = (h, seq, name, comps) => ({ version: 1, hijriDate: h, sequence: seq, eventName: name, components: comps });
  const dirA = path.join(archiveRoot, coll, '1448-07-01 _01-Waaz-Alpha');
  const dirB = path.join(archiveRoot, coll, '1448-07-02 _02-Majlis-Beta');
  const dirC = path.join(archiveRoot, coll, '1448-07-03 _03-Jashn-Gamma');
  const A1 = 'Waaz-Hall A', A2 = 'Ziyafat-Hall A', B1 = 'Majlis-Hall B', B2 = 'Safar-Hall B';
  const defs = [
    [dirA, mk('1448-07-01', 1, 'Waaz-Alpha', [
      { folderName: A1, location: 'Hall A', city: 'Surat', country: 'India', types: ['Waaz'], additionalKeywords: [] },
      { folderName: A2, location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyafat'], additionalKeywords: [] }])],
    [dirB, mk('1448-07-02', 2, 'Majlis-Beta', [
      { folderName: B1, location: 'Hall B', city: 'Mumbai', country: 'India', types: ['Majlis'], additionalKeywords: [] },
      { folderName: B2, location: 'Hall B', city: 'Mumbai', country: 'India', types: ['Safar'], additionalKeywords: [] }])],
    [dirC, mk('1448-07-03', 3, 'Jashn-Gamma', [
      { folderName: 'Jashn-Hall C', location: 'Hall C', city: 'Pune', country: 'India', types: ['Jashn'], additionalKeywords: [] }])],
  ];
  for (const [dir, data] of defs) await ev(async ({ dir, data }) => window.api.writeEventJson(dir, data), { dir, data });
  const nameA = path.basename(dirA), nameB = path.basename(dirB), nameC = path.basename(dirC);

  const P = {
    a001: 'shoot/A001.cr2', a002: 'shoot/A002.cr2', a003: 'videos/A003.mp4',
    b001: 'shoot/B001.cr2', b002: 'shoot/B002.cr2', b003: 'videos/B003.mov',
    c001: 'shoot/C001.cr2', unassigned: 'shoot/UNASSIGNED.cr2',
  };
  for (const k of Object.keys(P)) { P[k] = path.join(sourceRoot, P[k]); await writeFake(P[k]); }

  await ev(async ({ collDir, coll, folder }) => {
    await window.api.setLastEvent({ collectionPath: collDir, collectionName: coll, eventName: folder, safeEventName: folder });
    await EventCreator.restoreLastEvent();
  }, { collDir: path.join(archiveRoot, coll), coll, folder: nameA });
  await window.waitForTimeout(400);
  await ev((a) => window.selectSource(a), { type: 'local-folder', path: sourceRoot, label: 'LF_SRC' });
  await window.waitForTimeout(800);
  await clickHidden('#viewMediaBtn');
  await window.waitForFunction((n) => currentFiles.length >= n, Object.keys(P).length, { timeout: 20000 });

  async function chordAssign(paths, n, sub) {
    await ev((ps) => { selectedFiles.clear(); ps.forEach(p => selectedFiles.add(p)); syncAllTiles(); updateSelectionBar(); }, paths);
    await window.keyboard.press('Control+g'); await window.keyboard.press(String(n)); await window.waitForTimeout(150);
    await ev(({ n, sub }) => { GroupManager.setSubEvent(n, sub); renderGroupPanel(); }, { n, sub });
  }
  async function changeEventTo(folder) {
    await window.click('#ctxChangeEventBtn');
    await window.waitForFunction(() => EventMgmt.isOpen(), null, { timeout: 5000 });
    await window.waitForSelector(`.ec-evl-item[data-folder="${folder}"]`, { timeout: 15000 });
    await window.click(`.ec-evl-item[data-folder="${folder}"]`);
    await window.waitForFunction(() => !document.getElementById('emmContinueBtn').disabled, null, { timeout: 5000 });
    await window.click('#emmContinueBtn');
    await window.waitForFunction(() => !EventMgmt.isOpen(), null, { timeout: 15000 });
    await window.waitForTimeout(400);
  }

  // ── prepare all three events, then ONE import ──
  await chordAssign([P.a001, P.a002], 1, A1);
  await chordAssign([P.a003], 2, A2);
  await changeEventTo(nameB);
  await chordAssign([P.b001, P.b002], 1, B1);
  await chordAssign([P.b003], 2, B2);
  await changeEventTo(nameC);
  await ev((p) => { selectedFiles.clear(); selectedFiles.add(p); syncAllTiles(); updateSelectionBar(); }, P.c001);
  await window.click('#assignEventBtn');
  check(await ev(() => ImportSession.getSummary().assignedTotal) === 7 && await ev(() => ImportSession.participatingCount()) === 3, 'three events prepared: 7 files assigned across E1/E2/E3');

  await window.click('#importBtn');
  await window.waitForSelector('.ec-modal-overlay', { timeout: 15000 });
  await ev(() => [...document.querySelectorAll('.ec-modal-overlay button')].find(b => b.textContent === 'Continue anyway')?.click());
  await window.waitForFunction(() => document.getElementById('eventImportOverlay').classList.contains('visible'), null, { timeout: 20000 });
  check(await ev(() => document.getElementById('eiModeLocalFirst').checked), 'the combined review defaults to Local First');
  await ev(() => { _eiPhotographerDD.setValue('p-jane', 'Jane Doe'); _eiPhotographerDD.onSelect({ id: 'p-jane', label: 'Jane Doe' }); });
  await window.waitForTimeout(200);
  const preview = await ev(() => document.getElementById('eiModeDestPreview').innerText.replace(/\s+/g, ' '));
  check(/E1 Local/i.test(preview) && /E2 Local/i.test(preview) && /E3 Local/i.test(preview), `review previews a Local First destination for EVERY event (${preview.slice(0, 120)}…)`);
  await window.click('#eiImportBtn');
  await window.waitForFunction(() => document.getElementById('progressSummary').classList.contains('visible'), null, { timeout: 90000 });
  await window.waitForTimeout(500);

  check(await ev(() => _postImportSucceeded === true) && await ev(() => document.getElementById('sumCopied').textContent) === '7', 'one import copied all 7 assigned files (clean run)');

  // ── files staged per event; the archive itself untouched (Local First defers the sync) ──
  const stg = (evName, sub, file, vid) => path.join(stagingRoot, coll, evName, sub || '', 'Jane Doe', vid ? 'VIDEO' : '', file);
  const staged = [stg(nameA, A1, 'A001.cr2'), stg(nameA, A1, 'A002.cr2'), stg(nameA, A2, 'A003.mp4', true),
                  stg(nameB, B1, 'B001.cr2'), stg(nameB, B1, 'B002.cr2'), stg(nameB, B2, 'B003.mov', true), stg(nameC, '', 'C001.cr2')];
  check(staged.every(fs.existsSync), 'every file is staged under its own Event / Component / Photographer / VIDEO path');
  const archiveMedia = fs.readdirSync(archiveRoot, { recursive: true }).filter(f => /\.(cr2|mp4|mov)$/i.test(String(f)));
  check(archiveMedia.length === 0, `nothing was copied into the archive yet (Local First) — found ${archiveMedia.length} media file(s)`);
  check(!fs.readdirSync(stagingRoot, { recursive: true }).some(f => String(f).includes('UNASSIGNED')), 'the unassigned file was not staged');

  // ── three independent sync records ──
  let jobs = [];
  for (let i = 0; i < 60; i++) {
    const q = await ev(async () => window.api.getSyncQueue());
    jobs = (q.jobs || []).filter(j => (j.collection || j.collectionName) === coll || JSON.stringify(j).includes(coll));
    if (jobs.length >= 3 && jobs.every(j => j.readyForSync !== false && j.metadataStatus)) break;
    await window.waitForTimeout(1000);
  }
  log('sync queue jobs:', JSON.stringify(jobs.map(j => ({ event: j.eventName || j.event, files: j.fileCount, batch: j.batchId, meta: j.metadataStatus, ready: j.readyForSync }))));
  const nameOf = (j) => j.eventName || j.event;
  check(jobs.length === 3, `exactly THREE sync jobs exist — none overwritten (found ${jobs.length})`);
  check([nameA, nameB, nameC].every(n => jobs.some(j => nameOf(j) === n)), 'one sync job per event, each under its own event name');
  const byEvent = Object.fromEntries(jobs.map(j => [nameOf(j), j]));
  check(byEvent[nameA]?.fileCount === 3 && byEvent[nameB]?.fileCount === 3 && byEvent[nameC]?.fileCount === 1, `each job carries ITS OWN file count (A=${byEvent[nameA]?.fileCount}, B=${byEvent[nameB]?.fileCount}, C=${byEvent[nameC]?.fileCount})`);
  check(new Set(jobs.map(j => j.importId)).size === 3, 'three distinct importIds');
  check(jobs.every(j => j.metadataStatus === 'complete'), 'every job recorded its own completed metadata batch');
  check(await ev(() => _metaTracker.pendingManifestCount()) === 0, 'no pending manifest left behind in the tracker');

  // ── per-event metadata on the staged files ──
  const { ExifTool } = require('exiftool-vendored');
  const et = new ExifTool();
  try {
    const asArr = v => (v === undefined || v === null) ? [] : (Array.isArray(v) ? v : [v]);
    const kw = async (p) => asArr((await et.read(p.replace(/\.[^.]+$/, '.xmp'))).Subject);
    const kA = await kw(staged[0]), kB = await kw(staged[3]), kC = await kw(staged[6]);
    check(kA.includes('Waaz') && kA.includes('Surat') && !kA.includes('Majlis') && !kA.includes('Mumbai') && !kA.includes('Jashn'), `staged Event A file carries only Event A tags (${JSON.stringify(kA)})`);
    check(kB.includes('Majlis') && kB.includes('Mumbai') && !kB.includes('Waaz') && !kB.includes('Surat') && !kB.includes('Jashn'), `staged Event B file carries only Event B tags (${JSON.stringify(kB)})`);
    check(kC.includes('Jashn') && kC.includes('Pune') && !kC.includes('Waaz') && !kC.includes('Majlis'), `staged Event C file carries only Event C tags (${JSON.stringify(kC)})`);
  } finally { await et.end().catch(() => {}); }

  check(pageErrors.length === 0, `no renderer page errors (${JSON.stringify(pageErrors)})`);
  await app.close();
  for (const d of [userDataDir, archiveRoot, stagingRoot, sourceRoot]) await fsp.rm(d, { recursive: true, force: true }).catch(() => {});
  log(`=== SUMMARY: ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch(e => { console.error('[multi-event-lf] FATAL', e.stack || e.message); process.exit(1); });
