'use strict';

// Live UI regression test for the "Change Component Mapping?" (clear-refinements-on-remap)
// confirmation modal — driving the REAL Electron renderer against a synthetic source/archive.
//
// Regression this guards: the RC.2 integration merge (commit 38057bc, later touched again in
// f1edc13) restored #clearRefinementsOverlay's HTML/JS correctly, but its CSS rule was restored
// into the wrong selector LIST — `#missingSubEventOverlay, #unassignedOverlay,
// #dupSubEventOverlay { display:none; position:fixed; inset:0; ... }` never gained
// `#clearRefinementsOverlay` as a fourth selector (nor did the paired `.visible { display:flex }`
// rule). With no matching CSS rule at all, the element fell back to plain browser defaults for an
// unstyled <div> — `display: block`, `position: static` — so it was ALWAYS visible (not hidden by
// default), sat in normal document flow instead of as a fixed, centered, backdropped overlay, and
// showed its literal HTML placeholder text ("...for 0 file(s)") on screens where no remap was ever
// triggered. One root cause (a missing CSS selector) produced both the layout symptom and the
// visibility symptom simultaneously — there was no separate JS/state bug: the modal's own
// open/close logic (showClearRefinementsOnRemapModal) was correct and untouched.
//
// Run: node test/refinementRemapModalUiLive.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
function log(...args) { console.log('[remap-modal-ui]', ...args); }
let failures = 0;
function check(cond, msg) { if (cond) log('PASS —', msg); else { failures++; log('FAIL —', msg); } }
const mkTmp = (prefix) => fsp.mkdtemp(path.join(os.tmpdir(), prefix));

(async () => {
  const userDataDir = await mkTmp('ai-remap-modal-userdata-');
  const archiveRoot = await mkTmp('ai-remap-modal-archive-');
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
    await window.fill('#splashInputName', 'Remap Modal Operator'); await window.fill('#splashInputRole', 'QA'); await window.click('#splashCreateStartBtn');
  } else if (splash.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else { await window.click('#splashNewProfileBtn'); await window.fill('#splashInputName', 'Remap Modal Operator'); await window.fill('#splashInputRole', 'QA'); await window.click('#splashCreateStartBtn'); }
  } else if (splash.welcome) { await window.click('#splashContinueBtn'); }
  window = await mainWindowPromise;
  const pageErrors = [];
  window.on('pageerror', err => { pageErrors.push(err.message); log('[pageerror]', err.message); });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);
  await window.waitForFunction(() => typeof window.selectSource === 'function', { timeout: 15000 });

  await window.evaluate(async (root) => window.api.setMainArchiveRoot(root), archiveRoot);
  await window.waitForTimeout(300);
  await window.evaluate(() => { if (typeof obFinish === 'function') obFinish(); });

  const ev = (fn, arg) => window.evaluate(fn, arg);

  /** Full structural/computed snapshot of the overlay — what the screenshot regression needs. */
  const overlaySnapshot = () => ev(() => {
    const overlay = document.getElementById('clearRefinementsOverlay');
    const modal = document.getElementById('clearRefinementsModal');
    if (!overlay) return null;
    const cs = getComputedStyle(overlay);
    const rect = overlay.getBoundingClientRect();
    const modalRect = modal ? modal.getBoundingClientRect() : null;
    const vw = window.innerWidth, vh = window.innerHeight;
    return {
      classListVisible: overlay.classList.contains('visible'),
      hiddenAttr: overlay.hasAttribute('hidden'),
      display: cs.display, position: cs.position, inset: cs.inset, zIndex: cs.zIndex,
      backgroundColor: cs.backgroundColor,
      overlayRect: { width: rect.width, height: rect.height, top: rect.top, left: rect.left },
      overlayCoversViewport: rect.width >= vw - 2 && rect.height >= vh - 2,
      modalRect,
      centerOffsetX: modalRect ? Math.abs((modalRect.left + modalRect.width / 2) - vw / 2) : null,
      centerOffsetY: modalRect ? Math.abs((modalRect.top + modalRect.height / 2) - vh / 2) : null,
      countText: document.getElementById('clearRefinementsCount')?.textContent ?? null,
      docScrollHeight: document.documentElement.scrollHeight,
      docClientHeight: document.documentElement.clientHeight,
      viewport: { vw, vh },
    };
  });

  // ═══════════════════════════════════════════════════════════════════════════════════════
  // 1 — INITIAL / SOURCE-SELECTION SCREEN: the exact reported regression state
  // ═══════════════════════════════════════════════════════════════════════════════════════
  log('════ 1: initial / source-selection screen (no source, Current Event set) ════');
  const collName = 'CollRemapModal';
  const evDir = path.join(archiveRoot, collName, '1448-06-01 _01-RemapTest');
  await ev(async ({ dir, data }) => window.api.writeEventJson(dir, data), {
    dir: evDir, data: { version: 1, hijriDate: '1448-06-01', sequence: 1, eventName: 'RemapTest', components: [
      { id: 1, folderName: 'A', location: 'Hall A', city: 'Surat', country: 'India', types: ['Waaz'], additionalKeywords: [] },
      { id: 2, folderName: 'B', location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyafat'], additionalKeywords: [] },
    ] },
  });
  await ev(async ({ collPath, collName, folder }) => {
    await window.api.setLastEvent({ collectionPath: collPath, collectionName: collName, eventName: folder, safeEventName: folder });
    await EventCreator.restoreLastEvent();
  }, { collPath: path.join(archiveRoot, collName), collName, folder: path.basename(evDir) });
  await window.waitForTimeout(500);

  check(await ev(() => EventCreator.getActiveEventData()?.event?.name) === path.basename(evDir), 'Current Event is set');
  check(await ev(() => !document.getElementById('workspace').classList.contains('visible')), 'no source selected — still on the source-selection screen');

  const initial = await overlaySnapshot();
  log('initial overlay snapshot:', JSON.stringify(initial));
  check(initial.display === 'none', `overlay computed display is "none" by default (was "block" before the fix) — got "${initial.display}"`);
  check(!initial.classListVisible, 'overlay does not carry the .visible class');
  check(initial.overlayRect.width === 0 && initial.overlayRect.height === 0, `hidden overlay has ZERO layout footprint (was 1530x226 before the fix) — got ${JSON.stringify(initial.overlayRect)}`);
  check(initial.docScrollHeight === initial.docClientHeight, `document does not grow taller than the viewport merely from this overlay existing (scrollHeight=${initial.docScrollHeight}, clientHeight=${initial.docClientHeight})`);

  // ═══════════════════════════════════════════════════════════════════════════════════════
  // 2 — LEGITIMATE OPEN STATE: real remap, real refinement, real trigger
  // ═══════════════════════════════════════════════════════════════════════════════════════
  log('════ 2: legitimate open state (real component remap with real refinement state) ════');
  const srcRoot = await mkTmp('ai-remap-modal-src-');
  const P1 = path.join(srcRoot, 'F1.cr2'), P2 = path.join(srcRoot, 'F2.cr2');
  await fsp.writeFile(P1, Buffer.from('raw1')); await fsp.writeFile(P2, Buffer.from('raw2'));
  await ev(p => selectSource({ type: 'local-folder', path: p, label: 'SRC' }), srcRoot);
  await window.waitForFunction(() => document.getElementById('workspace').classList.contains('visible'), null, { timeout: 15000 });
  await ev(p => browseFolderDirect(p), srcRoot);
  await window.waitForFunction(n => document.querySelectorAll('#fileGrid .file-tile[data-path]').length === n, 2, { timeout: 20000 });

  const gid = await ev(({ p1, p2 }) => {
    const g = GroupManager.createGroup();
    GroupManager.assignFiles([p1, p2], g);
    GroupManager.setSubEvent(g, 'A');
    TagRefinementManager.setOverride(GroupManager.getGroups()[0].uid, [p1], { eventTypes: [], additionalKeywords: [] });
    renderGroupPanel();
    return g;
  }, { p1: P1, p2: P2 });
  check(await ev((gid) => TagRefinementManager.groupRefinementCount(GroupManager.getGroups().find(x => x.id === gid).uid), gid) === 1, 'group has exactly 1 real refinement before the remap');

  await window.click(`.gc-sub-trigger[data-gid="${gid}"]`);
  await window.waitForSelector('.gc-dropdown-item[data-value="B"]', { timeout: 5000 });
  await window.click('.gc-dropdown-item[data-value="B"]');
  await window.waitForFunction(() => document.getElementById('clearRefinementsOverlay').classList.contains('visible'), null, { timeout: 5000 });

  const open = await overlaySnapshot();
  log('legitimate open snapshot:', JSON.stringify(open));
  check(open.classListVisible, 'overlay carries .visible when legitimately triggered');
  check(open.display === 'flex', `computed display is "flex" (viewport-overlay appropriate) — got "${open.display}"`);
  check(open.position === 'fixed', `computed position is "fixed" — got "${open.position}"`);
  check(open.inset === '0px', `overlay insets to the full viewport — got "${open.inset}"`);
  check(open.overlayCoversViewport, `overlay bounding rect covers the viewport (${JSON.stringify(open.overlayRect)} vs viewport ${JSON.stringify(open.viewport)})`);
  check(/rgba\(0, ?0, ?0/.test(open.backgroundColor), `a real backdrop is present — got "${open.backgroundColor}"`);
  check(open.centerOffsetX < 2 && open.centerOffsetY < 2, `dialog is centered in the viewport (offsets: x=${open.centerOffsetX}, y=${open.centerOffsetY})`);
  check(open.countText === '1', `count reflects the REAL refinement count, not the stale "0" placeholder — got "${open.countText}"`);
  check(open.docScrollHeight === open.docClientHeight, `document does not grow taller than the viewport while the modal is open (scrollHeight=${open.docScrollHeight}, clientHeight=${open.docClientHeight})`);

  // ═══════════════════════════════════════════════════════════════════════════════════════
  // 3 — CANCEL
  // ═══════════════════════════════════════════════════════════════════════════════════════
  log('════ 3: Cancel ════');
  await window.click('#clearRefinementsCancelBtn');
  await window.waitForTimeout(200);
  const afterCancel = await overlaySnapshot();
  check(!afterCancel.classListVisible && afterCancel.display === 'none', 'overlay hidden again after Cancel');
  check(afterCancel.overlayRect.width === 0 && afterCancel.overlayRect.height === 0, 'no layout footprint after Cancel');
  check(await ev(gid => GroupManager.getGroups().find(g => g.id === gid).subEventId, gid) === 'A', 'Cancel did NOT apply the remap — mapping unchanged');
  check(await ev(gid => TagRefinementManager.groupRefinementCount(GroupManager.getGroups().find(x => x.id === gid).uid), gid) === 1, 'Cancel preserved the original refinement (still 1)');

  // ═══════════════════════════════════════════════════════════════════════════════════════
  // 4 — CHANGE & CLEAR
  // ═══════════════════════════════════════════════════════════════════════════════════════
  log('════ 4: Change & Clear ════');
  await window.click(`.gc-sub-trigger[data-gid="${gid}"]`);
  await window.waitForSelector('.gc-dropdown-item[data-value="B"]', { timeout: 5000 });
  await window.click('.gc-dropdown-item[data-value="B"]');
  await window.waitForFunction(() => document.getElementById('clearRefinementsOverlay').classList.contains('visible'), null, { timeout: 5000 });
  await window.click('#clearRefinementsConfirmBtn');
  await window.waitForTimeout(300);
  const afterConfirm = await overlaySnapshot();
  check(!afterConfirm.classListVisible && afterConfirm.display === 'none', 'overlay hides after Change & Clear');
  check(await ev(gid => GroupManager.getGroups().find(g => g.id === gid).subEventId, gid) === 'B', 'remap actually applied (A → B)');
  check(await ev(gid => TagRefinementManager.groupRefinementCount(GroupManager.getGroups().find(x => x.id === gid).uid), gid) === 0, 'refinement state was cleared by the confirmed remap');

  // ═══════════════════════════════════════════════════════════════════════════════════════
  // 5 — ZERO-REFINEMENT PATH: the modal must not appear at all (existing, validated guard)
  // ═══════════════════════════════════════════════════════════════════════════════════════
  log('════ 5: zero-refinement remap — modal must never appear (existing refCount > 0 guard) ════');
  // Group now has 0 refinements after step 4's clear. Remap it again — no confirmation expected.
  await window.click(`.gc-sub-trigger[data-gid="${gid}"]`);
  await window.waitForSelector('.gc-dropdown-item[data-value="A"]', { timeout: 5000 });
  await window.click('.gc-dropdown-item[data-value="A"]');
  await window.waitForTimeout(300);
  const zeroPath = await overlaySnapshot();
  check(!zeroPath.classListVisible && zeroPath.display === 'none', 'modal never appears for a zero-refinement remap');
  check(await ev(gid => GroupManager.getGroups().find(g => g.id === gid).subEventId, gid) === 'A', 'zero-refinement remap applied immediately, without any confirmation step');

  // ═══════════════════════════════════════════════════════════════════════════════════════
  // 6 — NAVIGATION / RESET: the modal cannot leak into a later, unrelated screen under NORMAL
  //     use (trigger → resolve via Cancel/Confirm → navigate away). This is the actual
  //     regression's scope — the reported bug was a phantom modal on an otherwise-untouched
  //     screen with no trigger at all, which sections 1 and this section both cover.
  //
  //     NOT covered here (deliberately, and unrelated to this regression): resetting the
  //     workspace WHILE one of the G4 confirm modals (missingSubEvent/unassigned/dupSubEvent/
  //     clearRefinements) is still open mid-interaction. None of the reset functions on the
  //     validated feature/refine-tags-all-events branch (resetWorkspaceState, resetAppState,
  //     _continueImporting, _exitToHome) ever reference any of these four overlays either —
  //     this characteristic is identical across all four modals on both branches, pre-dates
  //     this integration work, and is not what was reported. Fixing it would be inventing new
  //     behavior beyond restoring the validated design, so it is left untouched; see the
  //     integration report for this session.
  // ═══════════════════════════════════════════════════════════════════════════════════════
  log('════ 6: navigation/reset — modal cannot leak into an unrelated screen after normal use ════');
  await ev(({ p1 }) => {
    TagRefinementManager.setOverride(GroupManager.getGroups()[0].uid, [p1], { eventTypes: [], additionalKeywords: [] });
  }, { p1: P1 });
  await window.click(`.gc-sub-trigger[data-gid="${gid}"]`);
  await window.waitForSelector('.gc-dropdown-item[data-value="B"]', { timeout: 5000 });
  await window.click('.gc-dropdown-item[data-value="B"]');
  await window.waitForFunction(() => document.getElementById('clearRefinementsOverlay').classList.contains('visible'), null, { timeout: 5000 });
  await window.click('#clearRefinementsCancelBtn'); // resolve it normally, the only way a real operator can leave it
  await window.waitForTimeout(200);

  await ev(() => resetAppState());
  await window.waitForTimeout(400);
  const afterReset = await overlaySnapshot();
  check(!afterReset.classListVisible && afterReset.display === 'none', 'overlay stays hidden on the post-reset (source-selection) screen');
  check(afterReset.overlayRect.width === 0 && afterReset.overlayRect.height === 0, 'no layout footprint on the post-reset screen');
  check(afterReset.docScrollHeight === afterReset.docClientHeight, 'document does not grow taller than the viewport on the post-reset screen');

  check(pageErrors.length === 0, `no renderer errors across the whole scenario (${JSON.stringify(pageErrors)})`);

  log(`\n=== SUMMARY: ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`);
  await app.close();
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e.stack || e.message); process.exit(1); });
