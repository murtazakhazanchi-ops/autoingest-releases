'use strict';

// Live UI verification: CREATING A NEW EVENT from inside an open Import workspace.
//
// "Select existing event" and "create new event" share the return-to-workspace handler but
// leave EventCreator in different states (a freshly created event ends with a BLANK placeholder
// component list, a new collection-scoped event index, etc.). test/multiEventImportUiLive.test.js
// covers the existing-event round trip; this file covers the create path with the REAL create
// form (real TreeAutocomplete widgets, real #emmCreateBtn), driven the way
// test/eventNamingConsecutiveCityRunLive.test.js drives it.
//
//   Import workspace (Event A prepared)
//     → Change Event → + Create New Event → (back out of the form: workspace + Event A intact)
//     → Change Event → + Create New Event → fill → Create
//     → SAME source workspace (mounted, not rescanned), new event is the Current Event,
//       Event A's assignments intact, new event has real components (not the blank placeholder)
//     → assign files to the new event → one combined import → both events routed correctly.
//
// SYNTHETIC ONLY (temp userData / archive / source). Run: node test/multiEventNewEventUiLive.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
function log(...args) { console.log('[multi-event-new]', ...args); }
let failures = 0;
function check(cond, msg) { if (cond) log('PASS —', msg); else { failures++; log('FAIL —', msg); } }
const mkTmp = (prefix) => fsp.mkdtemp(path.join(os.tmpdir(), prefix));
async function writeFake(p, bytes = 60 * 1024) { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, Buffer.alloc(bytes, 0xab)); }

(async () => {
  const userDataDir = await mkTmp('ai-mev-new-userdata-');
  const archiveRoot = await mkTmp('ai-mev-new-archive-');
  const sourceRoot = await mkTmp('ai-mev-new-source-');
  const coll = 'CollNewEventUi';
  const collDir = path.join(archiveRoot, coll);

  const app = await electron.launch({ args: [PROJECT_ROOT, '--user-data-dir=' + userDataDir, '--no-sandbox'], cwd: PROJECT_ROOT, timeout: 60000 });
  let window = await app.firstWindow({ timeout: 60000 });
  await window.waitForTimeout(1500);
  const splash = await window.evaluate(() => {
    const vis = id => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  });
  const mainWindowPromise = app.waitForEvent('window', { timeout: 30000 });
  if (splash.create) { await window.fill('#splashInputName', 'New Event UI Operator'); await window.fill('#splashInputRole', 'QA'); await window.click('#splashCreateStartBtn'); }
  else if (splash.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else { await window.click('#splashNewProfileBtn'); await window.fill('#splashInputName', 'New Event UI Operator'); await window.fill('#splashInputRole', 'QA'); await window.click('#splashCreateStartBtn'); }
  } else if (splash.welcome) { await window.click('#splashContinueBtn'); }
  window = await mainWindowPromise;
  const pageErrors = [];
  window.on('pageerror', err => { pageErrors.push(err.message); log('[pageerror]', err.message); });
  // Backing out of the create form triggers the app's own "You have unsaved changes. Discard them?" confirm;
  // an operator would click OK. (Playwright answers "no" to unhandled dialogs, which would trap the modal open.)
  window.on('dialog', (d) => { log('[dialog]', d.message().slice(0, 80)); d.accept().catch(() => {}); });
  window.on('console', (m) => { if (m.type() === 'error' && !/DeprecationWarning|Electron Security Warning/.test(m.text())) log('[renderer.error]', m.text().slice(0, 220)); });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);
  await window.waitForFunction(() => typeof window.selectSource === 'function', { timeout: 15000 });
  await window.evaluate(async (root) => window.api.setMainArchiveRoot(root), archiveRoot);
  await window.evaluate(() => { if (typeof obFinish === 'function') obFinish(); });
  await window.waitForTimeout(300);

  const ev = (fn, arg) => window.evaluate(fn, arg);
  async function clickHidden(sel) { await ev((s) => { const el = document.querySelector(s); if (!el) throw new Error('no element ' + s); el.click(); }, sel); }

  // ── registry: an event type and a city the create form can pick (same seeding as the naming live test) ──
  for (const label of ['Ziyarat']) {
    const r = await ev((l) => window.api.keywordsAddKeyword({ label: l, category: 'event', parentPath: ['Majlis'], parentId: 'event' }), label);
    check(r?.ok === true, `registry seed: event-type "${label}"`);
  }
  for (const label of ['Mundra']) {
    const r = await ev((l) => window.api.keywordsAddKeyword({ label: l, category: 'city', parentPath: [l], parentId: 'city' }), label);
    check(r?.ok === true, `registry seed: city "${label}"`);
  }

  // ── Event A (multi-component) on disk, adopted as the Current Event ──
  const dirA = path.join(collDir, '1448-05-01 _01-Waaz-Alpha');
  const A1 = 'Waaz-Hall A', A2 = 'Ziyafat-Hall A';
  await ev(async ({ dir, data }) => window.api.writeEventJson(dir, data), { dir: dirA, data: { version: 1, hijriDate: '1448-05-01', sequence: 1, eventName: 'Waaz-Alpha', components: [
    { folderName: A1, location: 'Hall A', city: 'Surat', country: 'India', types: ['Waaz'], additionalKeywords: [] },
    { folderName: A2, location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyafat'], additionalKeywords: [] }] } });
  await ev(async ({ collDir, coll, folder }) => {
    await window.api.setLastEvent({ collectionPath: collDir, collectionName: coll, eventName: folder, safeEventName: folder });
    await EventCreator.restoreLastEvent();
  }, { collDir, coll, folder: path.basename(dirA) });
  await window.waitForTimeout(400);
  const nameA = path.basename(dirA);

  // ── an ordinary local-folder source ──
  const P = {
    a001: path.join(sourceRoot, 'EventPhotos/A001.cr2'), a002: path.join(sourceRoot, 'EventPhotos/A002.cr2'),
    n001: path.join(sourceRoot, 'EventPhotos/N001.cr2'), n002: path.join(sourceRoot, 'EventPhotos/N002.cr2'),
    unassigned: path.join(sourceRoot, 'EventPhotos/UNASSIGNED.cr2'),
  };
  for (const p of Object.values(P)) await writeFake(p);
  await ev((a) => window.selectSource(a), { type: 'local-folder', path: sourceRoot, label: 'NEW_EVENT_SRC' });
  await window.waitForTimeout(800);
  await clickHidden('#viewMediaBtn');
  await window.waitForFunction((n) => currentFiles.length >= n, Object.keys(P).length, { timeout: 20000 });

  await ev(() => { selectedFiles.clear(); syncAllTiles(); });
  await ev((ps) => { selectedFiles.clear(); ps.forEach(p => selectedFiles.add(p)); syncAllTiles(); updateSelectionBar(); }, [P.a001, P.a002]);
  await window.keyboard.press('Control+g'); await window.keyboard.press('1'); await window.waitForTimeout(200);
  await ev((s) => { GroupManager.setSubEvent(1, s); renderGroupPanel(); }, A1);
  check(await ev(() => GroupManager.getGroups().length) === 1, 'Event A prepared: one group with two files');

  await ev(() => { window.__tileMap = tileMap; window.__loadId = fileLoadRequestId; window.__filesRef = currentFiles; });

  // ── create-form helpers (real widgets) ──
  async function fillType(compId, label) {
    const c = window.locator(`#ecET-${compId}`);
    await c.locator('input').click(); await c.locator('input').fill(label);
    await c.locator('.tac-item').first().waitFor({ state: 'visible', timeout: 5000 });
    await c.locator('.tac-item').first().click(); await window.waitForTimeout(150);
  }
  async function setGlobalCity(label) {
    const c = window.locator('#ecGlobalCityDD');
    await c.locator('input').click(); await c.locator('input').fill(label);
    await c.locator('.tac-item').first().waitFor({ state: 'visible', timeout: 5000 });
    await c.locator('.tac-item').first().click(); await window.waitForTimeout(150);
  }
  async function openCreateForm() {
    await window.click('#ctxChangeEventBtn');
    await window.waitForFunction(() => EventMgmt.isOpen(), null, { timeout: 5000 });
    await window.waitForSelector('#ecNewEventFromList', { timeout: 15000 });
    await window.click('#ecNewEventFromList');
    await window.waitForSelector('#evHijriYear', { timeout: 10000 });
  }

  // ═══ 1. back out of the create form: nothing changes ═══
  await openCreateForm();
  check(await ev(() => EventMgmt.getMode() === 'create'), 'the real create form opened from inside the Import workspace');
  await window.click('#emmBackBtn');                       // form → list (dirty-check passes: nothing typed)
  await window.waitForTimeout(400);
  await window.click('#emmBackBtn');                       // list → dismiss the picker
  await window.waitForFunction(() => !EventMgmt.isOpen(), null, { timeout: 8000 });
  await window.waitForTimeout(500);
  check(await ev((n) => EventCreator.getActiveEventData()?.event?.name === n, nameA), 'backing out of the create form leaves Event A as the Current Event');
  check(await ev(() => document.getElementById('workspace').classList.contains('visible')), 'backing out returns to the same open workspace');
  check(await ev(() => GroupManager.getGroups().length) === 1 && await ev((p) => ImportSession.ownerOf(p)?.ordinal === 1, P.a001), 'backing out kept Event A’s group and ownership');

  // ═══ 2. create the new event ═══
  await openCreateForm();
  await window.fill('#evHijriYear', '1448'); await window.fill('#evHijriMonth', '06'); await window.fill('#evHijriDay', '01');
  const comp1 = await ev(() => document.querySelector('.ec-comp-row').dataset.compId);
  await fillType(comp1, 'Ziyarat');
  await setGlobalCity('Mundra');
  await window.waitForTimeout(400);
  const createEnabled = await ev(() => !document.getElementById('emmCreateBtn').disabled);
  check(createEnabled, 'the create form is valid (Create enabled)');
  await window.click('#emmCreateBtn');
  await window.waitForFunction(() => !EventMgmt.isOpen(), null, { timeout: 20000 });
  await window.waitForTimeout(800);

  const created = (await fsp.readdir(collDir)).find(n => n.startsWith('1448-06-01'));
  check(!!created, `the new event folder exists on disk (${created})`);
  const evJson = created ? JSON.parse(await fsp.readFile(path.join(collDir, created, 'event.json'), 'utf8')) : null;
  check(!!evJson && Array.isArray(evJson.components) && evJson.components.length === 1, 'the new event has a valid event.json with one component');

  check(await ev((n) => EventCreator.getActiveEventData()?.event?.name === n, created), 'the NEW event became the Current Event');
  check(await ev(() => document.getElementById('workspace').classList.contains('visible')), 'returned to the SAME source workspace (no landing screen)');
  check(await ev(() => tileMap === window.__tileMap && fileLoadRequestId === window.__loadId && currentFiles === window.__filesRef && currentFiles.length === 5),
    'source still mounted and NOT rescanned/re-rendered: same tileMap, same load id, same file list');
  check(await ev((p) => ImportSession.ownerOf(p)?.ordinal === 1, P.a001) && await ev(() => document.querySelectorAll('.file-event-badge').length) === 2, 'Event A’s assignments intact and badged E1');
  const comps = await ev(() => EventCreator.getEventComps().map(c => ({ n: c.eventTypes.length, city: c.city?.label || null })));
  check(comps.length === 1 && comps[0].n === 1 && comps[0].city === 'Mundra', `the new event has REAL components, not the post-create blank placeholder (${JSON.stringify(comps)})`);
  check(await ev(() => !GroupManager.hasGroups()), 'the new event starts with its own empty group state');
  check(await ev(() => ImportSession.getCurrent()?.eventData?.event?.name) === created, 'the session’s Current Event workspace is the new event');

  // ═══ 3. use the new event: explicit Assign (single component), then one combined import ═══
  await ev((ps) => { selectedFiles.clear(); ps.forEach(p => selectedFiles.add(p)); syncAllTiles(); updateSelectionBar(); }, [P.n001, P.n002]);
  check(await ev(() => getComputedStyle(document.getElementById('assignEventBtn')).display !== 'none'), '"Assign to <new event>" is offered for the new single-component event');
  await window.click('#assignEventBtn');
  check(await ev((p) => ImportSession.ownerOf(p)?.ordinal === 2, P.n001), 'the new event owns its files (E2)');
  const btn = await ev(() => document.getElementById('importBtn').textContent.trim());
  check(/Import 4 Assigned Files/.test(btn), `one import button counts both events' assignments: "${btn}"`);

  await window.click('#importBtn');
  await window.waitForSelector('.ec-modal-overlay', { timeout: 15000 });                       // unassigned confirmation
  const unTxt = await ev(() => document.querySelector('.ec-modal-overlay')?.innerText.replace(/\s+/g, ' ') || '');
  check(/1 file in the current view is not assigned/.test(unTxt), `unassigned wording is scoped to the view: "${unTxt.slice(0, 140)}"`);
  await ev(() => [...document.querySelectorAll('.ec-modal-overlay button')].find(b => b.textContent === 'Continue anyway')?.click());
  await window.waitForFunction(() => document.getElementById('eventImportOverlay').classList.contains('visible'), null, { timeout: 20000 });
  await ev(() => { _eiPhotographerDD.setValue('p-jane', 'Jane Doe'); _eiPhotographerDD.onSelect({ id: 'p-jane', label: 'Jane Doe' }); });
  await window.waitForTimeout(150);
  await window.click('#eiImportBtn');
  await window.waitForFunction(() => document.getElementById('progressSummary').classList.contains('visible'), null, { timeout: 90000 });
  await window.waitForTimeout(600);

  const dest = (evDir, sub, file) => path.join(evDir, sub || '', 'Jane Doe', file);
  check(fs.existsSync(dest(dirA, A1, 'A001.cr2')) && fs.existsSync(dest(dirA, A1, 'A002.cr2')), 'Event A files landed in Event A / component / photographer');
  check(created && fs.existsSync(dest(path.join(collDir, created), '', 'N001.cr2')) && fs.existsSync(dest(path.join(collDir, created), '', 'N002.cr2')), 'the NEW event’s files landed in the new event / photographer');
  check(!fs.readdirSync(archiveRoot, { recursive: true }).some(f => String(f).includes('UNASSIGNED')), 'the unassigned file was never imported');
  check(await ev(() => document.getElementById('sumCopied').textContent) === '4' && await ev(() => _postImportSucceeded === true), 'summary: 4 copied, clean run');
  check(await ev(() => !ImportSession.hasAssignments()), 'both events cleared from the session after success');

  check(pageErrors.length === 0, `no renderer page errors (${JSON.stringify(pageErrors)})`);
  await app.close();
  for (const d of [userDataDir, archiveRoot, sourceRoot]) await fsp.rm(d, { recursive: true, force: true }).catch(() => {});
  log(`=== SUMMARY: ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch(e => { console.error('[multi-event-new] FATAL', e.stack || e.message); process.exit(1); });
