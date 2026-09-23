'use strict';

// Live UI verification of the Multi-Event Import x Per-Photo Tag Refinement intersection,
// driving the REAL Electron renderer (real clicks, real ⌘G chord, real event picker, real
// refinement panel, real combined review modal, real IPC, real copy engine, real ExifTool)
// against an isolated SYNTHETIC source. Never touches a real card or archive.
//
// One source/card → Event A (single-component, EVENT_SCOPE refinement) → Change Event →
// Event B (multi-component, group-scope refinement) → move one already-refined Event-A file
// into Event B (⌘G re-chord — the real claim path) → Change Event back to A (state intact) →
// Change Event to B again → ONE combined import.
//
// Verifies on disk: Event A folder contains only A's files, Event B folder contains only B's,
// RAW/XMP and JPG metadata are correct per file, each event's own event.json holds only its
// own tagRefinements records, explicit No Tags and subset are both honored, and the moved
// file carries Event B's state (not stale Event A state).
//
// Run: node test/tagRefinementMultiEventLive.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { ExifTool } = require('exiftool-vendored');

const PROJECT_ROOT = path.resolve(__dirname, '..');
function log(...args) { console.log('[refine-multi-event]', ...args); }
let failures = 0;
function check(cond, msg) { if (cond) log('PASS —', msg); else { failures++; log('FAIL —', msg); } }
const mkTmp = (prefix) => fsp.mkdtemp(path.join(os.tmpdir(), prefix));
const asArr = v => (v === undefined || v === null) ? [] : (Array.isArray(v) ? v : [v]);
const et = new ExifTool();

async function writeRaw(p, i) { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, Buffer.from('not-a-real-raw-' + i + '-' + path.basename(p))); }
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
async function writeJpg(p) { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, JPEG); }

async function findFiles(dir, out = []) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await findFiles(full, out); else out.push(full);
  }
  return out;
}
async function keywordsFor(files, name) {
  const base = path.basename(name, path.extname(name));
  const target = files.find(f => path.basename(f, path.extname(f)) === base && (f.endsWith('.xmp') || f.endsWith('.jpg')));
  if (!target) return null;
  return asArr((await et.read(target)).Subject).map(String);
}

(async () => {
  const userDataDir = await mkTmp('ai-refine-mev-userdata-');
  const archiveRoot = await mkTmp('ai-refine-mev-archive-');
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
    await window.fill('#splashInputName', 'Refine MultiEvent Operator'); await window.fill('#splashInputRole', 'QA'); await window.click('#splashCreateStartBtn');
  } else if (splash.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else { await window.click('#splashNewProfileBtn'); await window.fill('#splashInputName', 'Refine MultiEvent Operator'); await window.fill('#splashInputRole', 'QA'); await window.click('#splashCreateStartBtn'); }
  } else if (splash.welcome) { await window.click('#splashContinueBtn'); }
  window = await mainWindowPromise;
  const pageErrors = [];
  window.on('pageerror', err => { pageErrors.push(err.message); log('[pageerror]', err.message); });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);
  await window.waitForFunction(() => typeof window.selectSource === 'function', { timeout: 15000 });

  await window.evaluate(async (root) => window.api.setMainArchiveRoot(root), archiveRoot);
  await window.evaluate(() => window.api.addToList('photographers', 'Jane Doe'));
  await window.waitForTimeout(300);
  await window.evaluate(() => { if (typeof obFinish === 'function') obFinish(); });

  const ev = (fn, arg) => window.evaluate(fn, arg);

  const collName = 'CollRefineMulti';
  const dirA = path.join(archiveRoot, collName, '1448-04-01 _01-Jashn-Alpha');
  const dirB = path.join(archiveRoot, collName, '1448-04-02 _02-Multi-Beta');
  const B1 = 'Waaz-Hall A', B2 = 'Ziyafat-Hall A';
  await ev(async ({ dir, data }) => window.api.writeEventJson(dir, data), {
    dir: dirA, data: { version: 1, hijriDate: '1448-04-01', sequence: 1, eventName: 'Jashn-Alpha', components: [
      { id: 1, folderName: 'Jashn-Hall A', location: 'Hall A', city: 'Surat', country: 'India', types: ['Jashn'], additionalKeywords: [] },
    ] },
  });
  await ev(async ({ dir, data }) => window.api.writeEventJson(dir, data), {
    dir: dirB, data: { version: 1, hijriDate: '1448-04-02', sequence: 2, eventName: 'Multi-Beta', components: [
      { id: 1, folderName: B1, location: 'Hall A', city: 'Surat', country: 'India', types: ['Waaz'], additionalKeywords: [] },
      { id: 2, folderName: B2, location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyafat'], additionalKeywords: [] },
    ] },
  });

  async function restoreEvent(dir) {
    const collPath = path.join(archiveRoot, collName);
    const folder = path.basename(dir);
    await ev(async ({ collPath, collName, folder }) => {
      await window.api.setLastEvent({ collectionPath: collPath, collectionName: collName, eventName: folder, safeEventName: folder });
      await EventCreator.restoreLastEvent();
    }, { collPath, collName, folder });
    await window.waitForTimeout(400);
  }
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
  async function chordAssign(paths, n) {
    await ev((ps) => { selectedFiles.clear(); ps.forEach(p => selectedFiles.add(p)); syncAllTiles(); updateSelectionBar(); }, paths);
    await window.keyboard.press('Control+g');
    await window.keyboard.press(String(n));
    await window.waitForTimeout(200);
  }
  async function mapGroup(gid, subEventId) {
    await ev(({ gid, subEventId }) => { GroupManager.setSubEvent(gid, subEventId); renderGroupPanel(); }, { gid, subEventId });
  }
  async function selectOnly(paths) {
    await ev(() => document.getElementById('clearSelBtn')?.click());
    for (const p of paths) await window.click(`#fileGrid .file-tile[data-path="${p}"]`, { modifiers: ['Meta'] });
  }

  // ── source + files ──
  const srcRoot = await mkTmp('ai-refine-mev-src-');
  const P = {};
  for (const n of ['a1', 'a2', 'b1', 'b2', 'b3', 'b4']) { P[n] = path.join(srcRoot, n.toUpperCase() + '.cr2'); await writeRaw(P[n], n); }
  P.a3jpg = path.join(srcRoot, 'A3.jpg'); await writeJpg(P.a3jpg);

  await restoreEvent(dirA);
  check(await ev(() => EventCreator.getActiveEventData()?.event?.name) === path.basename(dirA), 'Event A is the Current Event at source open');
  await ev(p => selectSource({ type: 'local-folder', path: p, label: 'REFINE_MULTI_SRC' }), srcRoot);
  await window.waitForFunction(() => document.getElementById('workspace').classList.contains('visible'), null, { timeout: 15000 });
  await ev(p => browseFolderDirect(p), srcRoot);
  await window.waitForFunction(n => document.querySelectorAll('#fileGrid .file-tile[data-path]').length === n, 7, { timeout: 20000 });
  check(await ev(() => document.getElementById('workspace').classList.contains('visible')), 'workspace open on the source');

  // ── Event A (single-component): refine via EVENT_SCOPE footer control ──
  // a1 → explicit No Tags, a2 → default (untouched), a3 (jpg) → explicit subset (same as component tag here)
  await selectOnly([P.a1, P.a2, P.a3jpg]);
  await window.click('#refineTagsBtn');
  await window.waitForFunction(() => TagRefinementManager.isEventScopeActive(), null, { timeout: 5000 });
  await selectOnly([P.a1]);
  await window.click('#rpNoneBtn');
  await selectOnly([P.a3jpg]);
  await window.click('#groupPanel input[data-cat="eventTypes"][value="Jashn"]');
  await window.click('#rpApplyBtn');
  await window.click('#rpDoneBtn');
  await window.waitForFunction(() => !TagRefinementManager.isActive(), null, { timeout: 5000 });
  check(await ev(() => TagRefinementManager.groupRefinementCount(TagRefinementManager.EVENT_SCOPE)) === 2, 'Event A: 2 EVENT_SCOPE overrides recorded (a1 None, a3 subset)');

  // ── assign a1/a2/a3 to Event A (ownership) via the explicit Assign control ──
  await selectOnly([P.a1, P.a2, P.a3jpg]);
  await window.click('#assignEventBtn');
  check(await ev((p) => ImportSession.ownerOf(p)?.ordinal, P.a1) === 1, 'a1 owned by E1 (Event A)');

  // ── Change Event → B ──
  await changeEventTo(path.basename(dirB));
  check(await ev(() => EventCreator.getActiveEventData()?.event?.name) === path.basename(dirB), 'Change Event → Event B is Current');
  check(await ev(() => !GroupManager.hasGroups()), 'Event B starts with its own empty groups (A\'s are not visible)');

  // Event B: two groups, group-scope refinement.
  await chordAssign([P.b1, P.b2], 1);
  await mapGroup(1, B1);
  await chordAssign([P.b3, P.b4], 2);
  await mapGroup(2, B2);
  const gB1card = await ev(() => document.querySelector('.gc-refine-trigger')?.dataset.gid);
  await window.click(`.gc-refine-trigger[data-gid="1"]`);
  await window.waitForFunction(() => TagRefinementManager.isActive(), null, { timeout: 5000 });
  await selectOnly([P.b1]);
  await window.click('#rpNoneBtn'); // b1 explicit No Tags
  await window.click('#rpDoneBtn');
  await window.waitForFunction(() => !TagRefinementManager.isActive(), null, { timeout: 5000 });
  check(await ev(() => { const g = GroupManager.getGroups().find(x => x.id === 1); return TagRefinementManager.groupRefinementCount(g.uid); }) === 1, 'Event B group 1: 1 explicit override recorded');

  // ── move an ALREADY-REFINED Event-A file (a3, subset override) into Event B via ⌘G (the real claim path) ──
  await selectOnly([P.a3jpg]);
  await window.keyboard.press('Control+g');
  await window.keyboard.press('1');
  await window.waitForTimeout(200);
  check(await ev((p) => ImportSession.ownerOf(p)?.ordinal, P.a3jpg) === 2, 'moved file is now owned by Event B (E2)');
  const movedOverrideInB = await ev((p) => { const g = GroupManager.getGroupForFile(p); return g ? TagRefinementManager.getOverride(g.uid, p) : 'NO-GROUP'; }, P.a3jpg);
  check(movedOverrideInB === null, `moved file starts at Default in B — old Event-A subset override did NOT carry over (got ${JSON.stringify(movedOverrideInB)})`);

  // Prove Event A itself has nothing stale for the file it no longer owns.
  await changeEventTo(path.basename(dirA));
  check(await ev((p) => GroupManager.getGroupForFile(p), P.a3jpg) === null, 'Event A no longer owns the moved file');
  check(await ev(() => TagRefinementManager.groupRefinementCount(TagRefinementManager.EVENT_SCOPE)) === 1, 'Event A retains only its OWN remaining EVENT_SCOPE override (a1)');

  await changeEventTo(path.basename(dirB));
  check(await ev(() => GroupManager.getGroups().length) === 2 && await ev(() => GroupManager.getGroups().map(g => g.subEventId).join('|')) === `${B1}|${B2}`,
    'returning to B: its own groups/mappings intact after the detour through A');

  // ── ONE combined import ──
  await window.click('#importBtn');
  // unassigned-files confirmation (a3 was moved so nothing extra should be unassigned; b3/b4 already grouped)
  const overlayShown = await window.waitForSelector('.ec-modal-overlay', { timeout: 8000 }).then(() => true).catch(() => false);
  if (overlayShown) {
    await window.evaluate(() => [...document.querySelectorAll('.ec-modal-overlay button')].find(b => b.textContent === 'Continue anyway')?.click());
    await window.waitForTimeout(300);
  }
  await window.waitForFunction(() => document.getElementById('eventImportOverlay').classList.contains('visible'), null, { timeout: 20000 });
  // buildPlan() sanity: prove the renderer-side plan itself carries each event's own
  // fileTagRefinements before the IPC call — isolates a renderer-model bug from an IPC-
  // payload-construction bug (importSessionUI.js's commit() must forward g.fileTagRefinements).
  const plan = await ev(() => { const p = ImportSession.buildPlan({ photographer: 'Jane Doe' }); return p.events.map(e => ({ eventPath: e.eventPath, groups: e.groups.map(g => ({ files: g.files.map(f => f.split('/').pop()), fileTagRefinements: g.fileTagRefinements })) })); });
  const planA = plan.find(e => e.eventPath === dirA), planB = plan.find(e => e.eventPath === dirB);
  check(!!planA?.groups[0]?.fileTagRefinements && Object.values(planA.groups[0].fileTagRefinements)[0]?.eventTypes?.length === 0,
    `buildPlan() carries Event A's own explicit-empty override (${JSON.stringify(planA?.groups)})`);
  check(!!planB?.groups[0]?.fileTagRefinements && Object.values(planB.groups[0].fileTagRefinements)[0]?.eventTypes?.length === 0,
    `buildPlan() carries Event B's own explicit-empty override (${JSON.stringify(planB?.groups[0])})`);

  await window.evaluate(() => { _eiPhotographerDD.setValue('p-jane', 'Jane Doe'); _eiPhotographerDD.onSelect({ id: 'p-jane', label: 'Jane Doe' }); });
  await window.waitForTimeout(200);
  check(await ev(() => !document.getElementById('eiImportBtn').disabled), 'photographer chosen — Import enabled');
  await window.click('#eiImportBtn');
  await window.waitForFunction(() => document.getElementById('progressSummary').classList.contains('visible'), null, { timeout: 90000 });
  await window.waitForTimeout(1500);
  // give metadata batches (one per event) time to complete
  let docA = null, docB = null;
  for (let i = 0; i < 60; i++) {
    await window.waitForTimeout(1000);
    try { docA = JSON.parse(await fsp.readFile(path.join(dirA, 'event.json'), 'utf8')); } catch {}
    try { docB = JSON.parse(await fsp.readFile(path.join(dirB, 'event.json'), 'utf8')); } catch {}
    if (docA?.metadataState?.state === 'metadata-complete' && docB?.metadataState?.state === 'metadata-complete') break;
  }
  check(docA?.metadataState?.state === 'metadata-complete', 'Event A metadata batch completed');
  check(docB?.metadataState?.state === 'metadata-complete', 'Event B metadata batch completed');

  // ── on-disk verification ──
  const filesA = await findFiles(dirA);
  const filesB = await findFiles(dirB);
  check(filesA.length > 0 && filesB.length > 0, 'both event folders received files');
  check(!filesA.some(f => /B1|B2|B3|B4/.test(path.basename(f))), 'Event A folder contains ONLY Event A files');
  check(!filesB.some(f => /^A1|^A2|^A1\.|^A2\./.test(path.basename(f))), 'Event B folder contains no Event-A-only files (a1/a2 stayed in A)');
  check(filesB.some(f => path.basename(f).startsWith('A3')), 'the MOVED file (a3) landed in Event B\'s folder, not A\'s');
  check(!filesA.some(f => path.basename(f).startsWith('A3')), 'the moved file is NOT also in Event A\'s folder');

  const kwA1 = await keywordsFor(filesA, 'A1');
  const kwA2 = await keywordsFor(filesA, 'A2');
  check(kwA1 && !kwA1.includes('Jashn'), `Event A a1 (explicit No Tags): no Jashn keyword (${JSON.stringify(kwA1)})`);
  check(kwA2 && kwA2.includes('Jashn'), `Event A a2 (Default): inherits Jashn (${JSON.stringify(kwA2)})`);

  const kwA3inB = await keywordsFor(filesB, 'A3');
  check(kwA3inB && kwA3inB.includes('Waaz') && !kwA3inB.includes('Jashn'), `moved file a3 carries Event B's Waaz tag, NOT Event A's stale Jashn subset (${JSON.stringify(kwA3inB)})`);

  const kwB1 = await keywordsFor(filesB, 'B1');
  const kwB2 = await keywordsFor(filesB, 'B2');
  const kwB3 = await keywordsFor(filesB, 'B3');
  check(kwB1 && !kwB1.includes('Waaz'), `Event B b1 (explicit No Tags): no Waaz keyword (${JSON.stringify(kwB1)})`);
  check(kwB2 && kwB2.includes('Waaz'), `Event B b2 (Default): inherits Waaz (${JSON.stringify(kwB2)})`);
  check(kwB3 && kwB3.includes('Ziyafat'), `Event B b3 (Default, other component): inherits Ziyafat (${JSON.stringify(kwB3)})`);

  // event.json cross-contamination check
  const trA = (docA.tagRefinements || []).flatMap(b => b.relPaths);
  const trB = (docB.tagRefinements || []).flatMap(b => b.relPaths);
  check(trA.every(p => !/B1|B2|B3|B4/.test(p)), `Event A's event.json contains ONLY Event A relPaths (${JSON.stringify(trA)})`);
  check(trB.every(p => !/^A1\.|^A2\./.test(p)), `Event B's event.json contains no Event-A-only relPaths (${JSON.stringify(trB)})`);
  check(trA.some(p => p.includes('A1')), 'Event A\'s event.json includes its own explicit-empty record (a1)');
  check(trB.some(p => p.includes('B1')), 'Event B\'s event.json includes its own explicit-empty record (b1)');

  check(pageErrors.length === 0, `no renderer errors (${JSON.stringify(pageErrors)})`);

  await et.end();
  log(`\n=== SUMMARY: ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`);
  await app.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch(async e => { console.error('FATAL', e.stack || e.message); try { await et.end(); } catch {} process.exit(1); });
