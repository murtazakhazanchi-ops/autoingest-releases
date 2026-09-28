'use strict';

// Live UI regression: the primary "Import N Assigned Files" button must stay in step with
// assignment changes made through the GROUP PANEL paths (⌘G, drag-and-drop, Remove group),
// not only after a selection change.
//
// Root cause it guards: the label is owned by _syncSessionSelectionUI(), which used to run only from
// updateSelectionBar(). ⌘G / drag-drop / Remove group re-render through renderGroupPanel() without
// touching the selection bar, so the button lagged one assignment behind (it showed 10 while the
// session strip, review and import plan all said 12). Display-only — but the operator's primary action
// must never disagree with the strip beside it.
//
// SYNTHETIC ONLY (temp userData / archive / source). Run: node test/multiEventCountSyncUiLive.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
function log(...args) { console.log('[multi-event-count]', ...args); }
let failures = 0;
function check(cond, msg) { if (cond) log('PASS —', msg); else { failures++; log('FAIL —', msg); } }
const mkTmp = (prefix) => fsp.mkdtemp(path.join(os.tmpdir(), prefix));
async function writeFake(p, bytes = 60 * 1024) { await fsp.mkdir(path.dirname(p), { recursive: true }); await fsp.writeFile(p, Buffer.alloc(bytes, 0xab)); }

(async () => {
  const userDataDir = await mkTmp('ai-mev-count-userdata-');
  const archiveRoot = await mkTmp('ai-mev-count-archive-');
  const sourceRoot = await mkTmp('ai-mev-count-source-');
  const coll = 'CollCountSync';

  const app = await electron.launch({ args: [PROJECT_ROOT, '--user-data-dir=' + userDataDir, '--no-sandbox'], cwd: PROJECT_ROOT, timeout: 60000 });
  let window = await app.firstWindow({ timeout: 60000 });
  await window.waitForTimeout(1500);
  const splash = await window.evaluate(() => {
    const vis = id => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  });
  const mainWindowPromise = app.waitForEvent('window', { timeout: 30000 });
  if (splash.create) { await window.fill('#splashInputName', 'Count Sync Operator'); await window.fill('#splashInputRole', 'QA'); await window.click('#splashCreateStartBtn'); }
  else if (splash.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else { await window.click('#splashNewProfileBtn'); await window.fill('#splashInputName', 'Count Sync Operator'); await window.fill('#splashInputRole', 'QA'); await window.click('#splashCreateStartBtn'); }
  } else if (splash.welcome) { await window.click('#splashContinueBtn'); }
  window = await mainWindowPromise;
  // A synthetic "card" has no real mount: drop the app's own drive-poll pushes at the main-process boundary.
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      const orig = w.webContents.send.bind(w.webContents);
      w.webContents.send = (ch, ...args) => (ch === 'drives:updated' || ch === 'drives:allUpdated') ? undefined : orig(ch, ...args);
    }
  });
  const pageErrors = [];
  window.on('pageerror', err => { pageErrors.push(err.message); log('[pageerror]', err.message); });
  window.on('dialog', (d) => { d.accept().catch(() => {}); });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);
  await window.waitForFunction(() => typeof window.selectSource === 'function', { timeout: 15000 });
  await window.evaluate(async (root) => window.api.setMainArchiveRoot(root), archiveRoot);
  await window.evaluate(() => { if (typeof obFinish === 'function') obFinish(); });
  await window.waitForTimeout(300);

  const ev = (fn, arg) => window.evaluate(fn, arg);

  // ── two multi-component events in one collection ──
  const mk = (hijri, seq, name, comps) => ({ version: 1, hijriDate: hijri, sequence: seq, eventName: name, components: comps });
  const A1 = 'Waaz-Hall A', A2 = 'Ziyafat-Hall A', B1 = 'Majlis-Hall B', B2 = 'Safar-Hall B';
  const comp = (folderName, type, loc, city) => ({ folderName, location: loc, city, country: 'India', types: [type], additionalKeywords: [] });
  const dirA = path.join(archiveRoot, coll, '1448-03-01 _01-Waaz-Alpha');
  const dirB = path.join(archiveRoot, coll, '1448-03-02 _02-Majlis-Beta');
  await ev(async ({ dir, data }) => window.api.writeEventJson(dir, data), { dir: dirA, data: mk('1448-03-01', 1, 'Waaz-Alpha', [comp(A1, 'Waaz', 'Hall A', 'Surat'), comp(A2, 'Ziyafat', 'Hall A', 'Surat')]) });
  await ev(async ({ dir, data }) => window.api.writeEventJson(dir, data), { dir: dirB, data: mk('1448-03-02', 2, 'Majlis-Beta', [comp(B1, 'Majlis', 'Hall B', 'Mumbai'), comp(B2, 'Safar', 'Hall B', 'Mumbai')]) });
  const nameA = path.basename(dirA), nameB = path.basename(dirB);
  await ev(async ({ collPath, coll, folder }) => {
    await window.api.setLastEvent({ collectionPath: collPath, collectionName: coll, eventName: 'Waaz-Alpha', safeEventName: folder });
    await EventCreator.restoreLastEvent();
  }, { collPath: path.join(archiveRoot, coll), coll, folder: nameA });
  await window.waitForTimeout(400);

  // ── 16 files on a camera-card-style source ──
  const N = 16;
  const P = Array.from({ length: N }, (_, i) => path.join(sourceRoot, 'DCIM/100CANON', `IMG_${String(i + 1).padStart(4, '0')}.CR2`));
  for (const p of P) await writeFake(p);
  await ev((a) => window.selectSource(a), { type: 'memory-card', path: sourceRoot, label: 'COUNT_SRC' });
  await window.waitForFunction((n) => currentFiles.length >= n, N, { timeout: 30000 });
  await window.waitForTimeout(800);
  const files = (from, to) => P.slice(from - 1, to);       // 1-based inclusive

  const label = () => ev(() => document.getElementById('importBtn').textContent.trim());
  const stripText = () => ev(() => { const r = document.getElementById('ctxLine3Session'); return r && getComputedStyle(r).display !== 'none' ? document.getElementById('ctxSessionUnassigned').textContent : null; });
  const total = () => ev(() => ImportSession.getSummary().assignedTotal);
  const planTotal = () => ev(() => ImportSession.buildPlan({ photographer: 'X', importMode: 'direct' }).events.reduce((s, e) => s + e.fileJobs.length, 0));
  /** Assert button, strip, model and frozen plan all agree — read straight after the operation, no extra sync. */
  async function agree(expected, what) {
    const [btn, strip, model, plan] = [await label(), await stripText(), await total(), await planTotal()];
    check(model === expected && plan === expected, `${what}: model=${model}, plan=${plan} (expected ${expected})`);
    check(strip !== null && new RegExp(`^${expected} assigned`).test(strip), `${what}: session strip "${strip}"`);
    check(btn === `Import ${expected} Assigned Files`, `${what}: primary button "${btn}"`);
  }
  /** Same input path as the existing suites: mark the selection, then press the REAL ⌘G chord + group number. */
  async function chord(paths, n) {
    await ev((ps) => { selectedFiles.clear(); ps.forEach(p => selectedFiles.add(p)); syncAllTiles(); updateSelectionBar(); }, paths);
    await window.keyboard.press('Control+g');
    await window.keyboard.press(String(n));
    await window.waitForTimeout(200);
  }
  async function mapGroup(gid, sub) { await ev(({ gid, sub }) => { GroupManager.setSubEvent(gid, sub); renderGroupPanel(); }, { gid, sub }); }
  async function changeEventTo(folder) {
    await window.click('#ctxChangeEventBtn');
    await window.waitForFunction(() => EventMgmt.isOpen(), null, { timeout: 5000 });
    await window.waitForSelector(`.ec-evl-item[data-folder="${folder}"]`, { timeout: 15000 });
    await window.click(`.ec-evl-item[data-folder="${folder}"]`);
    await window.waitForFunction(() => !document.getElementById('emmContinueBtn').disabled, null, { timeout: 5000 });
    await window.click('#emmContinueBtn');
    await window.waitForFunction(() => !EventMgmt.isOpen(), null, { timeout: 15000 });
    await window.waitForTimeout(450);
  }

  // ═══ 0. ordinary ONE-event workflow must be untouched ═══
  await chord(files(1, 4), 1); await mapGroup(1, A1);
  check(!/Assigned Files?/.test(await label()), `one-event session keeps its ORIGINAL (non-multi-event) label after ⌘G: "${await label()}"`);
  check(await stripText() === null, 'one-event session shows no session strip');

  // ═══ 1. build up to 10 assigned across two events ═══
  await chord(files(5, 7), 2); await mapGroup(2, A2);                       // A: G1=4, G2=3 → 7
  await changeEventTo(nameB);
  check(await label() === 'Import 7 Assigned Files', `after Change Event: "${await label()}"`);
  await chord(files(8, 10), 1); await mapGroup(1, B1);                      // B: G1=3 → 10
  await agree(10, '10 assigned (⌘G into B/G1)');

  // ═══ 2. THE regression: 10 → ⌘G two more files → 12 ═══
  await chord(files(11, 12), 2); await mapGroup(2, B2);                     // B: G2=2 → 12
  await agree(12, '12 assigned (⌘G two more files)');
  const gidB2 = await ev(() => GroupManager.getGroups().find(g => g.id === 2)?.id);
  check(gidB2 === 2, 'Event B has its second group (G2)');

  // ═══ 3. drag-and-drop assignment ═══
  // Playwright's pointer drag is not delivered as an HTML5 drag inside Electron, so replay the exact DOM sequence the
  // app's own handlers listen for (dragstart on the tile → dragover/drop on the group card).
  await ev(({ p }) => {
    const tileEl = [...document.querySelectorAll('.file-tile')].find(t => t.dataset.path === p);
    const card = document.querySelector('#groupPanel .group-card[data-gid="1"]');
    const dt = new DataTransfer();
    tileEl.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    card.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    card.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { p: P[12] });                                                          // IMG_0013, previously unassigned
  await window.waitForTimeout(250);
  await agree(13, '13 assigned (drag-and-drop one file onto G1)');

  // ═══ 4. reassignment A → B keeps the total, and everything still agrees ═══
  const aBefore = await ev(() => ImportSession.getSummary().events.map(e => e.fileCount));
  await chord(files(1, 2), 1);                                              // two of A's files into B/G1
  await agree(13, 'reassignment A→B via ⌘G (total unchanged)');
  const aAfter = await ev(() => ImportSession.getSummary().events.map(e => e.fileCount));
  check(aAfter[0] === aBefore[0] - 2 && aAfter[1] === aBefore[1] + 2, `ownership moved (A ${aBefore[0]}→${aAfter[0]}, B ${aBefore[1]}→${aAfter[1]})`);

  // ═══ 5. removal updates the count DOWNWARD ═══
  await window.click('#groupPanel .gc-remove-btn[data-gid="2"]');
  await window.waitForTimeout(250);
  await agree(11, '11 assigned (Remove B/G2 → −2)');

  // ═══ 6. a new group through the chord after removal, still in step ═══
  await chord(files(14, 15), 2);
  await ev((sub) => { const gs = GroupManager.getGroups(); GroupManager.setSubEvent(gs[gs.length - 1].id, sub); renderGroupPanel(); }, B2);
  await agree(13, '13 assigned (re-created G2 via ⌘G)');

  check(pageErrors.length === 0, `no renderer page errors (${JSON.stringify(pageErrors)})`);
  await app.close();
  for (const d of [userDataDir, archiveRoot, sourceRoot]) await fsp.rm(d, { recursive: true, force: true }).catch(() => {});
  log(`=== SUMMARY: ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch(e => { console.error('[multi-event-count] FATAL', e.stack || e.message); process.exit(1); });
