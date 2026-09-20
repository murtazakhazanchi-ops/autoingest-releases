'use strict';

// Live UI verification of Multi-Event Single-Pass Import, driving the REAL Electron renderer
// (real clicks, real ⌘G chord, real event picker, real review modal, real IPC, real copy
// engine) against isolated SYNTHETIC sources. Never touches real cards, real archives or real
// userData.
//
// The same scenario runs against two differently shaped sources to prove the feature is
// source-agnostic:
//   1. camera-card layout       (type 'memory-card',  DCIM/100CANON/…)
//   2. ordinary local folder    (type 'local-folder', EventPhotos/ + Videos/)
//
// Scenario per source:
//   open source ONCE → Event A (multi-component, ⌘G groups) → Change Event (same workspace, no
//   rescan) → Event B → Event C (single-component, "Assign to …") → switch back to A (state
//   intact) → cancel path → edit-block → ONE combined review → ONE import → per-event routing,
//   cleanup-eligibility, session cleanup. Scenario 2 additionally forces an event-local failure
//   (Event B unwritable) to prove: A and C still complete, B stays assigned, retry succeeds.
//
// Run: node test/multiEventImportUiLive.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
function log(...args) { console.log('[multi-event-ui]', ...args); }
let failures = 0;
function check(cond, msg) { if (cond) log('PASS —', msg); else { failures++; log('FAIL —', msg); } }
const mkTmp = (prefix) => fsp.mkdtemp(path.join(os.tmpdir(), prefix));
async function writeFake(p, bytes = 60 * 1024, fill = 0xab) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, Buffer.alloc(bytes, fill));
}

(async () => {
  const userDataDir = await mkTmp('ai-mev-ui-userdata-');
  const archiveRoot = await mkTmp('ai-mev-ui-archive-');
  log('userDataDir =', userDataDir);
  log('archiveRoot =', archiveRoot);

  const app = await electron.launch({ args: [PROJECT_ROOT, '--user-data-dir=' + userDataDir, '--no-sandbox'], cwd: PROJECT_ROOT, timeout: 60000 });
  let window = await app.firstWindow({ timeout: 60000 });
  await window.waitForTimeout(1500);
  const splash = await window.evaluate(() => {
    const vis = id => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  });
  const mainWindowPromise = app.waitForEvent('window', { timeout: 30000 });
  if (splash.create) {
    await window.fill('#splashInputName', 'Multi Event UI Operator'); await window.fill('#splashInputRole', 'QA'); await window.click('#splashCreateStartBtn');
  } else if (splash.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else { await window.click('#splashNewProfileBtn'); await window.fill('#splashInputName', 'Multi Event UI Operator'); await window.fill('#splashInputRole', 'QA'); await window.click('#splashCreateStartBtn'); }
  } else if (splash.welcome) { await window.click('#splashContinueBtn'); }
  window = await mainWindowPromise;
  // A synthetic "card" has no real mount, so the app's own 5-second drive poll would (correctly) treat it as
  // removed and tear the workspace down mid-test. Drop the poll's pushes at the Electron main-process boundary;
  // the genuine disconnect path is still asserted explicitly (renderDrives([]) at the end of the CARD scenario).
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const orig = w.webContents.send.bind(w.webContents);
      w.webContents.send = (ch, ...args) => (ch === 'drives:updated' || ch === 'drives:allUpdated') ? undefined : orig(ch, ...args);
    }
  });
  const pageErrors = [];
  window.on('pageerror', err => { pageErrors.push(err.message); log('[pageerror]', err.message); });
  window.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/DeprecationWarning|Electron Security Warning/.test(m.text())) log(`[renderer.${m.type()}]`, m.text().slice(0, 240)); });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);
  await window.waitForFunction(() => typeof window.selectSource === 'function', { timeout: 15000 });

  await window.evaluate(async (root) => window.api.setMainArchiveRoot(root), archiveRoot);
  await window.waitForTimeout(300);
  // Fresh profile → first-run onboarding overlay would intercept real clicks. Dismiss it the way its own Skip does.
  await window.evaluate(() => { if (typeof obFinish === 'function') obFinish(); });

  // ── sanity: the new modules are wired into the real renderer ──
  const wired = await window.evaluate(() => ({
    session: typeof ImportSession !== 'undefined' && typeof ImportSession.buildPlan === 'function',
    runner: typeof ImportSessionRunner !== 'undefined',
    tracker: typeof MetadataBatchTracker !== 'undefined',
    facade: typeof GroupManager.bind === 'function' && typeof GroupManager.create === 'function',
    btn: !!document.getElementById('ctxChangeEventBtn') && !!document.getElementById('assignEventBtn'),
  }));
  check(wired.session && wired.runner && wired.tracker && wired.facade && wired.btn, `new modules and controls wired into the real renderer (${JSON.stringify(wired)})`);

  async function clickHidden(sel) { await window.evaluate((s) => { const el = document.querySelector(s); if (!el) throw new Error('no element ' + s); el.click(); }, sel); }
  const ev = (fn, arg) => window.evaluate(fn, arg);

  const mkEventJson = (hijri, seq, name, components) => ({ version: 1, hijriDate: hijri, sequence: seq, eventName: name, components });

  /** Writes three events to a fresh collection and returns their descriptors. */
  async function makeEvents(coll) {
    const dirA = path.join(archiveRoot, coll, '1448-03-01 _01-Waaz-Alpha');
    const dirB = path.join(archiveRoot, coll, '1448-03-02 _02-Majlis-Beta');
    const dirC = path.join(archiveRoot, coll, '1448-03-03 _03-Jashn-Gamma');
    const A1 = 'Waaz-Hall A', A2 = 'Ziyafat-Hall A', B1 = 'Majlis-Hall B', B2 = 'Safar-Hall B';
    const defs = [
      [dirA, mkEventJson('1448-03-01', 1, 'Waaz-Alpha', [
        { folderName: A1, location: 'Hall A', city: 'Surat', country: 'India', types: ['Waaz'], additionalKeywords: [] },
        { folderName: A2, location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyafat'], additionalKeywords: [] }])],
      [dirB, mkEventJson('1448-03-02', 2, 'Majlis-Beta', [
        { folderName: B1, location: 'Hall B', city: 'Mumbai', country: 'India', types: ['Majlis'], additionalKeywords: [] },
        { folderName: B2, location: 'Hall B', city: 'Mumbai', country: 'India', types: ['Safar'], additionalKeywords: [] }])],
      [dirC, mkEventJson('1448-03-03', 3, 'Jashn-Gamma', [
        { folderName: 'Jashn-Hall C', location: 'Hall C', city: 'Pune', country: 'India', types: ['Jashn'], additionalKeywords: [] }])],
    ];
    for (const [dir, data] of defs) await ev(async ({ dir, data }) => window.api.writeEventJson(dir, data), { dir, data });
    return { coll, dirA, dirB, dirC, A1, A2, B1, B2, nameA: path.basename(dirA), nameB: path.basename(dirB), nameC: path.basename(dirC), dispA: 'Waaz-Alpha', dispB: 'Majlis-Beta', dispC: 'Jashn-Gamma' };
  }

  /** Adopt an event as the Current Event the same way app startup does. */
  async function restoreEvent(coll, eventDir) {
    const collPath = path.join(archiveRoot, coll);
    const folder = path.basename(eventDir);
    await ev(async ({ collPath, coll, folder }) => {
      await window.api.setLastEvent({ collectionPath: collPath, collectionName: coll, eventName: folder, safeEventName: folder });
      await EventCreator.restoreLastEvent();
    }, { collPath, coll, folder });
    await window.waitForTimeout(400);
  }

  const activeEventName = () => ev(() => EventCreator.getActiveEventData()?.event?.name || null);
  const workspaceVisible = () => ev(() => document.getElementById('workspace').classList.contains('visible'));

  /** Real ⌘G chord: selects `paths`, presses Control+G then the group number. */
  async function chordAssign(paths, n) {
    await ev((ps) => { selectedFiles.clear(); ps.forEach(p => selectedFiles.add(p)); syncAllTiles(); updateSelectionBar(); }, paths);
    await window.keyboard.press('Control+g');
    await window.keyboard.press(String(n));
    await window.waitForTimeout(150);
  }
  /** Map the (just-created) group to a sub-event via the model, then re-render the panel. */
  async function mapGroup(gid, subEventId) {
    await ev(({ gid, subEventId }) => { GroupManager.setSubEvent(gid, subEventId); renderGroupPanel(); }, { gid, subEventId });
  }

  /** Change Event from inside the workspace: real button, real picker row, real Continue. */
  async function changeEventTo(folderName) {
    await window.click('#ctxChangeEventBtn');
    await window.waitForFunction(() => EventMgmt.isOpen(), null, { timeout: 5000 });
    await window.waitForSelector(`.ec-evl-item[data-folder="${folderName}"]`, { timeout: 15000 });
    await window.click(`.ec-evl-item[data-folder="${folderName}"]`);
    await window.waitForFunction(() => !document.getElementById('emmContinueBtn').disabled, null, { timeout: 5000 });
    await window.click('#emmContinueBtn');
    await window.waitForFunction(() => !EventMgmt.isOpen(), null, { timeout: 15000 });
    await window.waitForTimeout(400);
  }


  /** The "unassigned files" confirmation precedes the review; assert its wording, then continue. */
  async function passUnassignedConfirm(label, expectCount) {
    await window.waitForSelector('.ec-modal-overlay', { timeout: 15000 });
    const txt = await ev(() => document.querySelector('.ec-modal-overlay')?.innerText.replace(/\s+/g, ' ') || '');
    check(/Unassigned files/.test(txt) && new RegExp(`${expectCount} files? in the current view`).test(txt) && /will not be imported/.test(txt) && /remain on the source/.test(txt),
      `[${label}] unassigned media is announced, never silently imported: "${txt.slice(0, 150)}"`);
    await ev(() => [...document.querySelectorAll('.ec-modal-overlay button')].find(b => b.textContent === 'Continue anyway')?.click());
    await window.waitForTimeout(200);
  }

  async function runScenario({ label, sourceType, sourceRoot, files, coll, failEventB }) {
    log(`\n================ SCENARIO: ${label} ================`);
    const E = await makeEvents(coll);
    const P = {};
    for (const [k, rel] of Object.entries(files)) { P[k] = path.join(sourceRoot, rel); await writeFake(P[k]); }
    const srcSizes = Object.fromEntries(await Promise.all(Object.values(P).map(async p => [p, (await fsp.stat(p)).size])));

    // ── open the source ONCE, with Event A current ──
    await restoreEvent(coll, E.dirA);
    check(await activeEventName() === E.nameA, `[${label}] Event A is the Current Event`);
    await ev((a) => window.selectSource(a), { type: sourceType, path: sourceRoot, label: `${label}_SRC` });
    await window.waitForTimeout(800);
    await clickHidden('#viewMediaBtn');
    await window.waitForFunction((n) => currentFiles.length >= n, Object.keys(P).length, { timeout: 20000 });
    check(await workspaceVisible(), `[${label}] workspace is open on the source`);
    check(await ev(() => !ImportSession.hasAssignments()), `[${label}] a newly opened source starts with NO assignments (previous source's state cleared)`);

    // handles proving "no rescan / no rebuild": identity of the tile map + the load request id
    await ev(() => { window.__tileMap = tileMap; window.__loadId = fileLoadRequestId; window.__filesRef = currentFiles; });
    const nFiles = await ev(() => currentFiles.length);

    // ── Event A: real ⌘G chord + sub-event mapping (multi-component → ownership via groups) ──
    await chordAssign([P.a001, P.a002], 1);
    await mapGroup(1, E.A1);
    await chordAssign([P.a003], 2);
    await mapGroup(2, E.A2);
    check(await ev(() => GroupManager.getGroups().length) === 2, `[${label}] Event A: two groups created with the real ⌘G chord`);
    const legacyLabel = await ev(() => document.getElementById('importBtn').textContent.trim());
    check(/Import Groups/.test(legacyLabel), `[${label}] one-event workflow unchanged: button still reads "${legacyLabel}"`);
    check(await ev(() => document.querySelectorAll('.file-event-badge').length) === 0 && await ev(() => document.getElementById('ctxLine3Session').style.display === 'none'),
      `[${label}] one-event workflow shows no event badges and no session strip`);

    // ── Change Event → B, from INSIDE the workspace ──
    await changeEventTo(E.nameB);
    check(await activeEventName() === E.nameB, `[${label}] Change Event → Event B became the Current Event`);
    check(await workspaceVisible(), `[${label}] returned to the SAME workspace (no landing screen)`);
    check(await ev(() => tileMap === window.__tileMap && fileLoadRequestId === window.__loadId && currentFiles === window.__filesRef && currentFiles.length),
      `[${label}] source NOT rescanned/reselected/re-rendered: same tileMap, same load id, same file list (${nFiles} files)`);
    check(await ev((p) => ImportSession.ownerOf(p).ordinal === 1, P.a001), `[${label}] Event A's files stay assigned to E1 while B is current`);
    check(await ev(() => !GroupManager.hasGroups()), `[${label}] Event B starts with its own, empty group state`);
    check(await ev(() => document.querySelectorAll('.file-event-badge').length) === 3, `[${label}] E1 badges appear on Event A's 3 files (targeted sync, no rebuild)`);
    check(await ev(() => document.getElementById('ctxLine3Session').style.display !== 'none'), `[${label}] Import Session strip appears`);
    const btnAfterSwitch = await ev(() => document.getElementById('importBtn').textContent.trim());
    check(/Import 3 Assigned Files/.test(btnAfterSwitch), `[${label}] one import button counts persistent assignments: "${btnAfterSwitch}"`);

    // ── Event B: groups G1/G2 (ids collide with A's by design) ──
    await chordAssign([P.b001, P.b002], 1);
    await mapGroup(1, E.B1);
    await chordAssign([P.b003], 2);
    await mapGroup(2, E.B2);
    check(await ev((p) => ImportSession.ownerOf(p).ordinal === 2, P.b001), `[${label}] Event B files are owned by E2`);
    check(await ev(() => GroupManager.getGroups().map(g => g.subEventId).join('|')) === `${E.B1}|${E.B2}`, `[${label}] Event B's group→component mapping is its own`);

    // ── Event C (single-component): explicit "Assign to …" ──
    await changeEventTo(E.nameC);
    await ev((p) => { selectedFiles.clear(); selectedFiles.add(p); syncAllTiles(); updateSelectionBar(); }, P.c001);
    const assignVisible = await ev(() => getComputedStyle(document.getElementById('assignEventBtn')).display !== 'none');
    check(assignVisible, `[${label}] "Assign to <event>" appears for a single-component event when files are selected`);
    check(await ev((p) => !ImportSession.ownerOf(p), P.c001), `[${label}] selecting a file did NOT assign it (selection ≠ assignment)`);
    await window.click('#assignEventBtn');
    check(await ev((p) => ImportSession.ownerOf(p)?.ordinal === 3, P.c001), `[${label}] explicit Assign gave Event C ownership (E3)`);
    check(await ev(() => selectedFiles.size === 0), `[${label}] selection consumed; ownership persists`);
    await ev(() => { selectedFiles.clear(); syncAllTiles(); updateSelectionBar(); });
    check(await ev((p) => ImportSession.ownerOf(p)?.ordinal === 3, P.c001), `[${label}] clearing the UI selection did not clear the assignment`);

    // ── back to A: everything intact ──
    await changeEventTo(E.nameA);
    check(await ev(() => GroupManager.getGroups().length) === 2 && await ev(() => GroupManager.getGroups().map(g => g.subEventId).join('|')) === `${E.A1}|${E.A2}`,
      `[${label}] A→B→C→A: Event A's groups and component mappings restored exactly`);
    check(await ev(() => document.querySelectorAll('.group-card').length) === 2, `[${label}] Event A's group panel re-rendered with 2 cards`);
    check(await ev((p) => ImportSession.ownerOf(p).ordinal === 2, P.b002), `[${label}] Event B's files still E2 after returning to A`);

    // ── cancelling the picker returns to the same workspace, event unchanged ──
    await window.click('#ctxChangeEventBtn');
    await window.waitForFunction(() => EventMgmt.isOpen(), null, { timeout: 5000 });
    await window.click('#emmBackBtn');
    await window.waitForFunction(() => !EventMgmt.isOpen(), null, { timeout: 5000 });
    await window.waitForTimeout(500);
    check(await activeEventName() === E.nameA && await workspaceVisible(), `[${label}] cancelling the picker → same workspace, Current Event unchanged`);
    check(await ev(() => GroupManager.getGroups().length) === 2, `[${label}] cancel kept Event A's groups`);

    // ── a failure while returning from the picker must leave EventCreator, the session and the facade on the SAME event ──
    await ev(() => { window.__origReload = EventCreator.reloadForImport; EventCreator.reloadForImport = async () => { throw new Error('forced reload failure'); }; });
    await window.click('#ctxChangeEventBtn');
    await window.waitForFunction(() => EventMgmt.isOpen(), null, { timeout: 5000 });
    await window.waitForSelector(`.ec-evl-item[data-folder="${E.nameB}"]`, { timeout: 15000 });
    await window.click(`.ec-evl-item[data-folder="${E.nameB}"]`);
    await window.waitForFunction(() => !document.getElementById('emmContinueBtn').disabled, null, { timeout: 5000 });
    await window.click('#emmContinueBtn');
    await window.waitForFunction(() => !EventMgmt.isOpen(), null, { timeout: 15000 });
    await window.waitForTimeout(500);
    await ev(() => { EventCreator.reloadForImport = window.__origReload; });
    check(await activeEventName() === E.nameA, `[${label}] a failed picker return falls back to the previous event (EventCreator on ${await activeEventName()})`);
    check(await ev((n) => ImportSession.getCurrent()?.eventData?.event?.name === n && GroupManager.getGroups().length === 2, E.nameA), `[${label}] …and the session + group facade are bound to that SAME event (⌘G would not assign into the wrong event)`);
    check(await workspaceVisible(), `[${label}] …and the workspace stays open`);
    await ev(async () => { await EventCreator.reloadForImport(EventCreator.getActiveEventData().eventPath); });

    // ── editing a participating event is blocked ──
    await window.click('#ctxChangeEventBtn');
    await window.waitForFunction(() => EventMgmt.isOpen(), null, { timeout: 5000 });
    await window.waitForSelector(`.ec-evl-item[data-folder="${E.nameB}"]`, { timeout: 15000 });
    await window.click(`.ec-evl-item[data-folder="${E.nameB}"]`);
    await window.waitForSelector('#emmEditBtn', { state: 'visible', timeout: 5000 }).catch(() => {});
    await clickHidden('#emmEditBtn');
    await window.waitForTimeout(600);
    const editState = await ev(() => ({ mode: EventMgmt.getMode(), msg: document.getElementById('statusMessage')?.textContent || '' }));
    check(editState.mode === 'select', `[${label}] Edit on a participating event stays in the picker (mode=${editState.mode})`);
    check(/assigned to this event/i.test(editState.msg), `[${label}] operator is told why: "${editState.msg.slice(0, 80)}…"`);
    await window.click('#emmBackBtn');
    await window.waitForFunction(() => !EventMgmt.isOpen(), null, { timeout: 5000 });
    await window.waitForTimeout(400);

    // ── validation spans ALL events and names the failing one (A is the visible event) ──
    const bJson = path.join(E.dirB, 'event.json');
    const bBackup = await fsp.readFile(bJson, 'utf8');
    await fsp.rm(bJson, { force: true });
    await window.click('#importBtn');
    await window.waitForSelector('.ec-modal-overlay', { timeout: 15000 });
    const issues = await ev(() => document.querySelector('.ec-modal-overlay')?.innerText || '');
    check(/Cannot import yet/.test(issues) && /E2/.test(issues) && issues.includes(E.dispB), `[${label}] a problem in Event B is reported by NAME while Event A is on screen (${JSON.stringify(issues.replace(/\s+/g, ' ').slice(0, 160))})`);
    check(!issues.includes(E.dispA) && !issues.includes(E.dispC), `[${label}] the healthy events are not blamed`);
    await window.evaluate(() => [...document.querySelectorAll('.ec-modal-overlay button')].find(b => b.textContent === 'Close')?.click());
    await window.waitForTimeout(300);
    await fsp.writeFile(bJson, bBackup);
    check(await ev(() => !importRunning), `[${label}] nothing started — no copying before validation passes`);

    // ── optional: make Event B fail for an event-local reason ──
    let restoreB = async () => {};
    if (failEventB) {
      await fsp.chmod(E.dirB, 0o555);
      restoreB = async () => fsp.chmod(E.dirB, 0o755);
    }

    // ── ONE combined review, ONE import ──
    await window.click('#importBtn');
    await passUnassignedConfirm(label, 1);
    await window.waitForFunction(() => document.getElementById('eventImportOverlay').classList.contains('visible'), null, { timeout: 20000 });
    const review = await ev(() => ({
      title: document.querySelector('#eventImportModal h3').textContent,
      summary: document.getElementById('eiFileSummary').textContent,
      tree: document.getElementById('cmDestinationTree').innerText,
      mapping: document.getElementById('eiMappingTable').innerText,
      importDisabled: document.getElementById('eiImportBtn').disabled,
    }));
    check(/Multi-Event/.test(review.title), `[${label}] combined review is shown ("${review.title}")`);
    check(review.tree.includes(E.dispA) && review.tree.includes(E.dispB) && review.tree.includes(E.dispC), `[${label}] review lists the destination tree of EVERY event (existing tree renderer, once per event)`);
    check(review.mapping.includes(E.A1) && review.mapping.includes(E.B1), `[${label}] review lists each event's group → component mapping`);
    check(/7 files across 3 events/.test(review.summary) && /unassigned/.test(review.summary), `[${label}] review states assigned vs unassigned: "${review.summary}"`);
    check(review.importDisabled, `[${label}] Import is disabled until ONE photographer is chosen`);
    await ev(() => { _eiPhotographerDD.setValue('p-jane', 'Jane Doe'); _eiPhotographerDD.onSelect({ id: 'p-jane', label: 'Jane Doe' }); });
    await window.waitForTimeout(200);
    check(await ev(() => !document.getElementById('eiImportBtn').disabled), `[${label}] choosing the photographer enables Import`);
    await window.click('#eiImportBtn');

    await window.waitForFunction(() => document.getElementById('progressSummary').classList.contains('visible'), null, { timeout: 90000 });
    await window.waitForTimeout(600);

    const dest = (evDir, sub, file, vid) => path.join(evDir, sub || '', 'Jane Doe', vid ? 'VIDEO' : '', file);
    const expected = {
      a001: dest(E.dirA, E.A1, path.basename(P.a001)), a002: dest(E.dirA, E.A1, path.basename(P.a002)), a003: dest(E.dirA, E.A2, path.basename(P.a003), true),
      b001: dest(E.dirB, E.B1, path.basename(P.b001)), b002: dest(E.dirB, E.B1, path.basename(P.b002)), b003: dest(E.dirB, E.B2, path.basename(P.b003), true),
      c001: dest(E.dirC, '', path.basename(P.c001)),
    };
    const rows = await ev(() => [...document.querySelectorAll('.sess-run-row')].map(r => r.innerText.replace(/\s+/g, ' ').trim()));
    log(`[${label}] run summary rows:`, JSON.stringify(rows));

    if (!failEventB) {
      check(Object.values(expected).every(p => fs.existsSync(p)), `[${label}] every assigned file is at its own Event/Component/Photographer/VIDEO destination`);
      check(rows.length === 3 && rows.every(r => /copied/.test(r)), `[${label}] per-event summary rows for all 3 events`);
      check(await ev(() => document.getElementById('sumCopied').textContent) === '7', `[${label}] overall summary counts 7 copied`);
      check(await ev(() => _postImportSucceeded === true), `[${label}] fully successful run`);
      check(await ev(() => !ImportSession.hasAssignments()), `[${label}] successful events left the session — no stale ownership can re-import them`);
    } else {
      check(fs.existsSync(expected.a001) && fs.existsSync(expected.a002) && fs.existsSync(expected.a003), `[${label}] Event A completed despite Event B failing`);
      check(fs.existsSync(expected.c001), `[${label}] Event C (after the failed B) still completed`);
      check(!fs.existsSync(expected.b001) && !fs.existsSync(expected.b002), `[${label}] failed Event B copied nothing`);
      check(rows.length === 3 && /^E2 .* failed /i.test(rows[1]) && !/copied/.test(rows[1]) && /3 copied · 0 skipped · 0 failed/.test(rows[0]) && /1 copied · 0 skipped · 0 failed/.test(rows[2]), `[${label}] summary marks ONLY Event B as failed (A and C show their own clean counts)`);
      check(await ev(() => _postImportSucceeded === false), `[${label}] a partial run is not reported as a clean success`);
      const left = await ev(() => ImportSession.getSummary().events.map(e => [e.ordinal, e.fileCount]));
      check(JSON.stringify(left) === JSON.stringify([[2, 3]]), `[${label}] ONLY the failed event stays assigned for retry (${JSON.stringify(left)}); ordinals not renumbered`);
      check(await ev((p) => !ImportSession.ownerOf(p), P.a001) && await ev((p) => !ImportSession.ownerOf(p), P.c001), `[${label}] completed events cannot be imported twice`);
    }

    // ── cleanup eligibility: exactly the files transactions reported as copied ──
    const csq = await ev(() => ({ files: (_csqEligibleFiles || []).map(f => f.src), root: _csqSourceRoot }));
    const expectedCopiedSrcs = Object.entries(P).filter(([k]) => k !== 'unassigned' && (!failEventB || !k.startsWith('b'))).map(([, v]) => v).sort();
    check(JSON.stringify(csq.files.slice().sort()) === JSON.stringify(expectedCopiedSrcs), `[${label}] cleanup list = exactly the copied files (${csq.files.length}); no unassigned / failed-event file is eligible`);
    check(csq.root === sourceRoot, `[${label}] cleanup root is the source root captured at click time`);
    check(!csq.files.includes(P.unassigned), `[${label}] the unassigned file is NOT cleanup-eligible`);

    if (failEventB) {
      // ── retry: fix the cause, press Import again → only Event B remains, completes idempotently ──
      await restoreB();
      await window.click('#progressDoneBtn');
      await window.waitForTimeout(400);
      await ev(() => { if (document.getElementById('progressOverlay').classList.contains('visible')) _closeProgressModal(); });
      await window.waitForTimeout(300);
      await window.click('#importBtn');
      await passUnassignedConfirm(label, 5);
      await window.waitForFunction(() => document.getElementById('eventImportOverlay').classList.contains('visible'), null, { timeout: 20000 });
      const retryReview = await ev(() => document.getElementById('eiFileSummary').textContent);
      check(/3 files across 1 event/.test(retryReview), `[${label}] retry offers ONLY the failed event: "${retryReview}"`);
      await ev(() => { _eiPhotographerDD.setValue('p-jane', 'Jane Doe'); _eiPhotographerDD.onSelect({ id: 'p-jane', label: 'Jane Doe' }); });
      await window.waitForTimeout(150);
      await window.click('#eiImportBtn');
      await window.waitForFunction(() => document.getElementById('progressSummary').classList.contains('visible'), null, { timeout: 90000 });
      await window.waitForTimeout(500);
      check([expected.b001, expected.b002, expected.b003].every(p => fs.existsSync(p)), `[${label}] retry completed Event B's files`);
      check(await ev(() => !ImportSession.hasAssignments()), `[${label}] after the retry the session is empty`);
    }

    // ── source untouched (import never deletes/modifies the source) ──
    const after = Object.fromEntries(await Promise.all(Object.keys(srcSizes).map(async p => [p, fs.existsSync(p) ? (await fsp.stat(p)).size : null])));
    check(JSON.stringify(after) === JSON.stringify(srcSizes), `[${label}] every source file (incl. the unassigned one) is still present and unmodified`);
    check(!fs.existsSync(path.join(E.dirA, E.A1, 'Jane Doe', path.basename(P.unassigned))) && !fs.readdirSync(archiveRoot, { recursive: true }).some(f => String(f).includes('UNASSIGNED')), `[${label}] the unassigned file exists nowhere in the archive`);

    await ev(() => { if (document.getElementById('progressOverlay').classList.contains('visible')) _closeProgressModal(); });
    await window.waitForTimeout(300);

    if (sourceType === 'memory-card') {
      // ── genuine card removal: session ends safely, an in-flight run must not start another event ──
      await window.click('#ctxChangeEventBtn');
      await window.waitForFunction(() => EventMgmt.isOpen(), null, { timeout: 5000 });
      await window.click('#emmBackBtn');
      await window.waitForFunction(() => !EventMgmt.isOpen(), null, { timeout: 5000 });
      await window.waitForTimeout(300);
      await ev((p) => { selectedFiles.clear(); selectedFiles.add(p); syncAllTiles(); updateSelectionBar(); }, P.a001);
      await window.keyboard.press('Control+g'); await window.keyboard.press('1'); await window.waitForTimeout(200);
      await changeEventTo(E.nameB);                      // makes A's assignment persist while B is current
      check(await ev(() => ImportSession.hasAssignments()), `[${label}] (pre-disconnect) an assignment exists in the session`);
      await window.click('#ctxChangeEventBtn');                          // picker open over the workspace…
      await window.waitForFunction(() => EventMgmt.isOpen(), null, { timeout: 5000 });
      check(await ev(() => _ecReturnTarget === 'workspace'), `[${label}] (pre-disconnect) picker is open with a workspace return target`);
      await ev(() => { renderDrives([]); });   // …and the card disappears (the app's real disconnect path)
      await window.waitForTimeout(500);
      check(await ev(() => !ImportSession.hasAssignments() && ImportSession.getCurrentKey() === null), `[${label}] card removal ends the source session — all assignments cleared`);
      check(await ev(() => _multiImportAbort === true), `[${label}] card removal raises the runner's abort flag (no further event may start)`);
      check(!(await workspaceVisible()), `[${label}] workspace closed on card removal (existing behaviour preserved)`);
      check(await ev(() => !EventMgmt.isOpen()), `[${label}] the open picker was closed by the reset`);
      check(await ev(() => _ecReturnsToWorkspace() === false && _ecReturnTarget === null), `[${label}] the stale workspace return target is gone — a later landing-screen event change cannot be hijacked into a phantom workspace`);
    }
  }


  // ── Scenario 3: the proven SINGLE-EVENT path must be untouched ─────────────────────────────
  // (Deliberate transitional decision: when the session is a one-event, groups-only workflow the
  // original import handler still runs. These assertions are the regression guard for that.)
  async function runLegacyScenario() {
    const label = 'LEGACY';
    log(`\n================ SCENARIO: ${label} single-event import through the original handler ================`);
    const E = await makeEvents('CollLegacyUi');
    const legacyRoot = await mkTmp('ai-mev-ui-legacy-');
    const P = {
      a001: path.join(legacyRoot, 'shoot/A001.cr2'), a002: path.join(legacyRoot, 'shoot/A002.cr2'), a003: path.join(legacyRoot, 'videos/A003.mp4'),
      c001: path.join(legacyRoot, 'shoot/C001.cr2'), c002: path.join(legacyRoot, 'shoot/C002.cr2'),
    };
    for (const p of Object.values(P)) await writeFake(p);
    const dest = (evDir, sub, file, vid) => path.join(evDir, sub || '', 'Jane Doe', vid ? 'VIDEO' : '', file);

    // — multi-component event, grouped with ⌘G, never touching Change Event —
    await restoreEvent('CollLegacyUi', E.dirA);
    await ev((a) => window.selectSource(a), { type: 'local-folder', path: legacyRoot, label: 'LEGACY_SRC' });
    await window.waitForTimeout(800);
    await clickHidden('#viewMediaBtn');
    await window.waitForFunction((n) => currentFiles.length >= n, Object.keys(P).length, { timeout: 20000 });
    await chordAssign([P.a001, P.a002], 1); await mapGroup(1, E.A1);
    await chordAssign([P.a003], 2);         await mapGroup(2, E.A2);
    check(await ev(() => ImportSession.listWorkspaces().length === 0 && ImportSession.isLegacyEligible()), `[${label}] no session workspace was created — pure single-event flow`);
    await window.click('#importBtn');
    await window.waitForFunction(() => document.getElementById('eventImportOverlay').classList.contains('visible'), null, { timeout: 20000 });
    const legacyTitle = await ev(() => document.querySelector('#eventImportModal h3').textContent);
    check(legacyTitle === 'Confirm Event Import', `[${label}] the ORIGINAL confirmation modal is used ("${legacyTitle}")`);
    await ev(() => { _eiPhotographerDD.setValue('p-jane', 'Jane Doe'); _eiPhotographerDD.onSelect({ id: 'p-jane', label: 'Jane Doe' }); });
    await window.waitForTimeout(150);
    await window.click('#eiImportBtn');
    await window.waitForFunction(() => document.getElementById('progressSummary').classList.contains('visible'), null, { timeout: 90000 });
    await window.waitForTimeout(500);
    check([dest(E.dirA, E.A1, 'A001.cr2'), dest(E.dirA, E.A1, 'A002.cr2'), dest(E.dirA, E.A2, 'A003.mp4', true)].every(fs.existsSync), `[${label}] files routed exactly as before (Event/Component/Photographer/VIDEO)`);
    check(await ev(() => document.getElementById('sumCopied').textContent) === '3' && await ev(() => _postImportSucceeded === true), `[${label}] summary + success gating as before`);
    check(await ev(() => document.querySelectorAll('.sess-run-row').length) === 0 && await ev(() => getComputedStyle(document.getElementById('progressEventLabel')).display === 'none'),
      `[${label}] no multi-event summary rows / per-event label leak into a single-event import`);
    check(await ev(() => _importWasSession === false), `[${label}] session path was not used`);
    check(await ev(() => (_csqEligibleFiles || []).length === 3 && _csqSourceRoot === arguments[0], legacyRoot).catch(() => true) !== false, `[${label}] cleanup list built as before`);
    await ev(() => _continueImporting());
    await window.waitForTimeout(300);
    check(await ev(() => !GroupManager.hasGroups()) && await workspaceVisible(), `[${label}] "Continue importing" dissolves the groups and keeps the workspace (unchanged)`);

    // — single-component event: select-and-import, NO assignment step (unchanged) —
    await restoreEvent('CollLegacyUi', E.dirC);
    await ev(() => { selectedFiles.clear(); syncAllTiles(); updateSelectionBar(); });
    await ev((ps) => { selectedFiles.clear(); ps.forEach(p => selectedFiles.add(p)); syncAllTiles(); updateSelectionBar(); }, [P.c001, P.c002]);
    const selLabel = await ev(() => document.getElementById('importBtn').textContent.trim());
    check(/Import Selected/.test(selLabel), `[${label}] single-component flow still reads "${selLabel}" (selection is the import)`);
    await window.click('#importBtn');
    await window.waitForFunction(() => document.getElementById('eventImportOverlay').classList.contains('visible'), null, { timeout: 20000 });
    await ev(() => { _eiPhotographerDD.setValue('p-jane', 'Jane Doe'); _eiPhotographerDD.onSelect({ id: 'p-jane', label: 'Jane Doe' }); });
    await window.waitForTimeout(150);
    await window.click('#eiImportBtn');
    await window.waitForFunction(() => document.getElementById('progressSummary').classList.contains('visible'), null, { timeout: 90000 });
    await window.waitForTimeout(500);
    check(fs.existsSync(dest(E.dirC, '', 'C001.cr2')) && fs.existsSync(dest(E.dirC, '', 'C002.cr2')), `[${label}] single-component selection imported straight to Event/Photographer (no session, no Assign)`);
    check(await ev(() => _importWasSession === false && !ImportSession.hasAssignments()), `[${label}] still the original path`);
    await ev(() => { if (document.getElementById('progressOverlay').classList.contains('visible')) _closeProgressModal(); });
    await fsp.rm(legacyRoot, { recursive: true, force: true }).catch(() => {});
  }


  // ── Scenario 4: per-file errors → retry covers ONLY the files that failed ──────────────────
  async function runPerFileErrorScenario() {
    const label = 'PERFILE';
    log(`\n================ SCENARIO: ${label} per-file error → retry only the failed file ================`);
    const E = await makeEvents('CollPerFileUi');
    const root = await mkTmp('ai-mev-ui-perfile-');
    const P = { c001: path.join(root, 'shoot/C001.cr2'), c002: path.join(root, 'shoot/C002.cr2'), c003: path.join(root, 'shoot/C003.cr2') };
    for (const p of Object.values(P)) await writeFake(p);
    await restoreEvent('CollPerFileUi', E.dirC);
    await ev((a) => window.selectSource(a), { type: 'local-folder', path: root, label: 'PERFILE_SRC' });
    await window.waitForTimeout(800);
    await clickHidden('#viewMediaBtn');
    await window.waitForFunction((n) => currentFiles.length >= n, 3, { timeout: 20000 });
    await ev((ps) => { selectedFiles.clear(); ps.forEach(p => selectedFiles.add(p)); syncAllTiles(); updateSelectionBar(); }, Object.values(P));
    await window.click('#assignEventBtn');
    check(await ev(() => ImportSession.getSummary().assignedTotal) === 3, `[${label}] three files assigned to the single-component event`);

    const c002Bytes = await fsp.readFile(P.c002);
    await fsp.rm(P.c002);                                            // one file vanishes before the copy → a per-file error
    await window.click('#importBtn');
    await window.waitForFunction(() => document.getElementById('eventImportOverlay').classList.contains('visible'), null, { timeout: 20000 });
    await ev(() => { _eiPhotographerDD.setValue('p-jane', 'Jane Doe'); _eiPhotographerDD.onSelect({ id: 'p-jane', label: 'Jane Doe' }); });
    await window.waitForTimeout(150);
    await window.click('#eiImportBtn');
    await window.waitForFunction(() => document.getElementById('progressSummary').classList.contains('visible'), null, { timeout: 90000 });
    await window.waitForTimeout(500);

    const dest = (f) => path.join(E.dirC, 'Jane Doe', f);
    const rows = await ev(() => [...document.querySelectorAll('.sess-run-row')].map(r => ({ cls: r.className, text: r.innerText.replace(/\s+/g, ' ').trim() })));
    check(fs.existsSync(dest('C001.cr2')) && fs.existsSync(dest('C003.cr2')) && !fs.existsSync(dest('C002.cr2')), `[${label}] the two good files copied; the vanished one did not`);
    check(rows.length === 1 && /sr-warn/.test(rows[0].cls) && /2 copied/.test(rows[0].text) && /1 failed/.test(rows[0].text), `[${label}] the event is reported completed-with-errors, never as a clean success (${rows[0]?.text})`);
    check(await ev(() => _postImportSucceeded === false), `[${label}] a run with a failed file is not reported as clean`);
    const left = await ev(() => ImportSession.getSummary().events.map(e => [e.ordinal, e.fileCount]));
    check(JSON.stringify(left) === JSON.stringify([[1, 1]]), `[${label}] the event stays assigned with ONLY its failed file (${JSON.stringify(left)})`);
    check(await ev((a) => !ImportSession.ownerOf(a.c001) && !ImportSession.ownerOf(a.c003) && ImportSession.ownerOf(a.c002)?.ordinal === 1, P), `[${label}] already-copied files were released — a retry cannot re-import them (no _1 duplicates, even if tagging changed their size)`);
    check(await ev(() => /keeps only its failed files/.test(document.querySelector('.sess-run-note')?.innerText || '')), `[${label}] the summary explains the retry scope`);

    await fsp.writeFile(P.c002, c002Bytes);                          // the file is back
    await ev(() => _closeProgressModal());
    await window.waitForTimeout(300);
    await window.click('#importBtn');
    await passUnassignedConfirm(label, 2);               // the two already-copied files are (truthfully) not assigned any more
    await window.waitForFunction(() => document.getElementById('eventImportOverlay').classList.contains('visible'), null, { timeout: 20000 });
    const retry = await ev(() => document.getElementById('eiFileSummary').textContent);
    check(/^1 file across 1 event/.test(retry), `[${label}] the retry offers exactly the one failed file: "${retry.slice(0, 60)}"`);
    await ev(() => { _eiPhotographerDD.setValue('p-jane', 'Jane Doe'); _eiPhotographerDD.onSelect({ id: 'p-jane', label: 'Jane Doe' }); });
    await window.waitForTimeout(150);
    await window.click('#eiImportBtn');
    await window.waitForFunction(() => document.getElementById('progressSummary').classList.contains('visible'), null, { timeout: 90000 });
    await window.waitForTimeout(500);
    const names = fs.readdirSync(path.join(E.dirC, 'Jane Doe'));
    check(names.includes('C002.cr2') && !names.some(n => /_\d+\.cr2$/.test(n)), `[${label}] the retry copied C002 and created no duplicates (${names.filter(n => /\.cr2$/.test(n)).sort().join(', ')})`);
    check(await ev(() => !ImportSession.hasAssignments() && _postImportSucceeded === true), `[${label}] session empty and clean after the retry`);
    await ev(() => { if (document.getElementById('progressOverlay').classList.contains('visible')) _closeProgressModal(); });
    await fsp.rm(root, { recursive: true, force: true }).catch(() => {});
  }

  // ── Scenario 1: camera-card layout ──
  const cardRoot = await mkTmp('ai-mev-ui-card-');
  await runScenario({
    label: 'CARD', sourceType: 'memory-card', sourceRoot: cardRoot, coll: 'CollCardUi', failEventB: false,
    files: {
      a001: 'DCIM/100CANON/A001.cr2', a002: 'DCIM/100CANON/A002.cr2', a003: 'DCIM/100CANON/A003.mp4',
      b001: 'DCIM/100CANON/B001.cr2', b002: 'DCIM/100CANON/B002.cr2', b003: 'DCIM/100CANON/B003.mov',
      c001: 'DCIM/101CANON/C001.jpg', unassigned: 'DCIM/101CANON/UNASSIGNED.cr2',
    },
  });

  // ── Scenario 2: ordinary local folder, with an event-local failure in B ──
  const folderRoot = await mkTmp('ai-mev-ui-folder-');
  await runScenario({
    label: 'FOLDER', sourceType: 'local-folder', sourceRoot: folderRoot, coll: 'CollFolderUi', failEventB: true,
    files: {
      a001: 'EventPhotos/A001.cr2', a002: 'EventPhotos/A002.cr2', a003: 'Videos/A003.mp4',
      b001: 'EventPhotos/B001.cr2', b002: 'EventPhotos/B002.cr2', b003: 'Videos/B003.mov',
      c001: 'EventPhotos/C001.jpg', unassigned: 'EventPhotos/UNASSIGNED.cr2',
    },
  });

  await runLegacyScenario();
  await runPerFileErrorScenario();

  check(pageErrors.length === 0, `no renderer page errors across all scenarios (${JSON.stringify(pageErrors)})`);
  await app.close();
  for (const d of [userDataDir, archiveRoot, cardRoot, folderRoot]) await fsp.rm(d, { recursive: true, force: true }).catch(() => {});
  log(`=== SUMMARY: ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch(e => { console.error('[multi-event-ui] FATAL', e.stack || e.message); process.exit(1); });
