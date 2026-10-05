'use strict';

// Live end-to-end verification of Phase 3D's additions to
// renderer/commandManager.js's AutoIngestCommands: tagRefinement.open/close/
// useAllTags/clearSelected and event.openChooser, plus the two new compact
// state fields (`tagRefinement`, `event`) and their subscription coverage.
// Split out from mxCommandLayerLive.test.js (Phase 1A) and
// mxCommandLayerPhase1BLive.test.js (Phase 1B), which already cover the
// original registry and the observability surface this file builds on.
//
// Drives the REAL Electron renderer against isolated synthetic fixtures
// (two real event.json files, a real multi-component event with real
// GroupManager groups, a real local-folder source). Never touches a real
// archive, card, NAS, or user settings.
//
// Run: node test/mxCommandLayerPhase3DLive.test.js

const { _electron: electron } = require('playwright-core');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[mx-cmd-3d]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }
async function writeRaw(p, i) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, Buffer.from('not-a-real-raw-' + i + '-' + path.basename(p)));
}

(async () => {
  const userDataDir = await mkTmp('ai-e2e-mx-3d-userdata-');
  const archiveRoot = await mkTmp('ai-e2e-mx-3d-archive-');
  const srcRoot = await mkTmp('ai-e2e-mx-3d-src-');
  log('userDataDir =', userDataDir);
  log('archiveRoot =', archiveRoot);
  log('srcRoot     =', srcRoot);

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));

  let window = await electronApp.firstWindow({ timeout: 60000 });
  window.on('pageerror', (err) => log('[pageerror]', err.message, err.stack));
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));
  log('splash state:', JSON.stringify(splashState));

  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'MX Phase 3D Test');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) {
      await window.click('.splash-user-item');
      await window.click('#splashSelectStartBtn');
    } else {
      await window.click('#splashNewProfileBtn');
      await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'MX Phase 3D Test');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  }

  window = await mainWindowPromise;
  window.on('pageerror', (err) => log('[pageerror]', err.message, err.stack));
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1000);
  await window.waitForFunction(() => typeof window.selectSource === 'function', { timeout: 15000 });
  await window.waitForFunction(() => typeof window.AutoIngestCommands === 'object', { timeout: 15000 });

  const onboardingVisible = await window.evaluate(() =>
    document.getElementById('onboardingOverlay')?.classList.contains('visible'));
  if (onboardingVisible) {
    await window.click('#onboardingSkip');
    await window.waitForTimeout(200);
  }

  const ev = (fn, arg) => window.evaluate(fn, arg);

  try {
    await ev((root) => window.api.setMainArchiveRoot(root), archiveRoot);
    await ev(() => { if (typeof obFinish === 'function') obFinish(); });

    const collName = 'CollPhase3D';
    const dirA = path.join(archiveRoot, collName, '1448-05-01 _01-Single-Alpha');
    const dirB = path.join(archiveRoot, collName, '1448-05-02 _02-Multi-Beta');
    const dirC = path.join(archiveRoot, collName, '1448-05-03 _03-NonRefinable-Gamma');
    const compB1 = 'Waaz-Hall A', compB2 = 'Ziyafat-Hall A';

    await ev(({ dir, data }) => window.api.writeEventJson(dir, data), {
      dir: dirA, data: { version: 1, hijriDate: '1448-05-01', sequence: 1, eventName: 'Single-Alpha', components: [
        { id: 1, folderName: 'Jashn-Hall A', location: 'Hall A', city: 'Surat', country: 'India', types: ['Jashn'], additionalKeywords: [] },
      ] },
    });
    await ev(({ dir, data }) => window.api.writeEventJson(dir, data), {
      dir: dirB, data: { version: 1, hijriDate: '1448-05-02', sequence: 2, eventName: 'Multi-Beta', components: [
        { id: 1, folderName: compB1, location: 'Hall A', city: 'Surat', country: 'India', types: ['Waaz'], additionalKeywords: [] },
        { id: 2, folderName: compB2, location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyafat'], additionalKeywords: [] },
      ] },
    });
    // A component with NO refinable tags at all (empty types/additionalKeywords) —
    // TagRefinementManager.isEligible() must be false for it; see tagRefinement.open's
    // "non-eligible component" test below.
    await ev(({ dir, data }) => window.api.writeEventJson(dir, data), {
      dir: dirC, data: { version: 1, hijriDate: '1448-05-03', sequence: 3, eventName: 'NonRefinable-Gamma', components: [
        { id: 1, folderName: 'Plain-Hall A', location: 'Hall A', city: 'Surat', country: 'India', types: [], additionalKeywords: [] },
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
    async function changeEventViaChooser(folderName) {
      const execResult = await ev(() => window.AutoIngestCommands.execute('event.openChooser'));
      await window.waitForFunction(() => EventMgmt.isOpen(), null, { timeout: 5000 });
      await window.waitForSelector(`.ec-evl-item[data-folder="${folderName}"]`, { timeout: 15000 });
      await window.click(`.ec-evl-item[data-folder="${folderName}"]`);
      await window.waitForFunction(() => !document.getElementById('emmContinueBtn').disabled, null, { timeout: 5000 });
      await window.click('#emmContinueBtn');
      await window.waitForFunction(() => !EventMgmt.isOpen(), null, { timeout: 15000 });
      await window.waitForTimeout(400);
      return execResult;
    }
    async function chordAssign(paths, n) {
      await ev((ps) => { selectedFiles.clear(); ps.forEach((p) => selectedFiles.add(p)); syncAllTiles(); updateSelectionBar(); }, paths);
      await window.keyboard.press('Control+g');
      await window.keyboard.press(String(n));
      await window.waitForTimeout(200);
    }
    async function mapGroup(gid, subEventId) {
      await ev(({ gid, subEventId }) => { GroupManager.setSubEvent(gid, subEventId); renderGroupPanel(); }, { gid, subEventId });
    }
    async function selectOnly(paths) {
      await ev((ps) => { selectedFiles.clear(); ps.forEach((p) => selectedFiles.add(p)); syncAllTiles(); updateSelectionBar(); }, paths);
    }

    const srcA = path.join(srcRoot, 'a');
    const P = {};
    for (const n of ['a1', 'a2']) { P[n] = path.join(srcA, n.toUpperCase() + '.cr2'); await writeRaw(P[n], n); }

    // ═══════════════════════════════════════════════════════════════════
    // 1. EVENT_SCOPE (single-component event): open / useAllTags / clearSelected / close
    // ═══════════════════════════════════════════════════════════════════
    await restoreEvent(dirA);
    check(await ev(() => EventCreator.getActiveEventData()?.event?.name) === path.basename(dirA), 'setup: Event A (single-component) is the Current Event');
    await ev((p) => selectSource({ type: 'local-folder', path: p, label: 'MX_3D_SRC_A' }), srcA);
    await window.waitForFunction(() => document.getElementById('workspace').classList.contains('visible'), null, { timeout: 15000 });
    await ev((p) => browseFolderDirect(p), srcA);
    await window.waitForFunction((n) => document.querySelectorAll('#fileGrid .file-tile[data-path]').length === n, 2, { timeout: 20000 });

    let state = await ev(() => window.AutoIngestCommands.getState());
    check(!('tagRefinement' in state), 'tagRefinement is omitted from state while refinement is not active');
    check(state.event && state.event.activeEventName && state.event.participatingCount === 0,
      `event state is present with the real active event name and participatingCount 0 before any assignment (${JSON.stringify(state.event)})`);
    check(state.availableCommands.includes('tagRefinement.open'), 'tagRefinement.open is available with no selection — EVENT_SCOPE needs none to ENTER');

    const openResult = await ev(() => window.AutoIngestCommands.execute('tagRefinement.open'));
    check(openResult.ok === true && openResult.executed === true, 'tagRefinement.open executes and enters EVENT_SCOPE');
    check(await ev(() => TagRefinementManager.isEventScopeActive()), 'TagRefinementManager confirms EVENT_SCOPE is now active — real primitive, not just a return value');

    state = await ev(() => window.AutoIngestCommands.getState());
    check(state.tagRefinement && state.tagRefinement.active === true && state.tagRefinement.scopeLabel === 'Current Event',
      `tagRefinement state reflects the real active EVENT_SCOPE session (${JSON.stringify(state.tagRefinement)})`);
    check(!state.availableCommands.includes('tagRefinement.open'), 'tagRefinement.open becomes unavailable once already active (never switches scopes out from under a session)');

    await selectOnly([P.a1]);
    state = await ev(() => window.AutoIngestCommands.getState());
    check(state.tagRefinement.selectedCount === 1 && state.tagRefinement.status === 'default',
      `selecting a file shows selectedCount:1, status:"default" (untouched) (${JSON.stringify(state.tagRefinement)})`);

    const useAllResult = await ev(() => window.AutoIngestCommands.execute('tagRefinement.useAllTags'));
    check(useAllResult.ok === true && useAllResult.executed === true, 'tagRefinement.useAllTags executes against the real selection');
    state = await ev(() => window.AutoIngestCommands.getState());
    check(state.tagRefinement.status === 'refined', `status becomes "refined" after useAllTags (${state.tagRefinement.status})`);
    const realOverride = await ev((p) => TagRefinementManager.getOverride(TagRefinementManager.EVENT_SCOPE, p), P.a1);
    check(realOverride && realOverride.eventTypes.includes('Jashn'), 'the REAL TagRefinementManager override now contains the component\'s real tag ("Jashn") — not a plugin-side fabrication');

    const clearResult = await ev(() => window.AutoIngestCommands.execute('tagRefinement.clearSelected'));
    check(clearResult.ok === true && clearResult.executed === true, 'tagRefinement.clearSelected executes');
    state = await ev(() => window.AutoIngestCommands.getState());
    check(state.tagRefinement.status === 'default', 'status reverts to "default" after clearSelected (reverts to inheritance, matching resetToDefault\'s own tri-state semantics)');
    const clearedOverride = await ev((p) => TagRefinementManager.getOverride(TagRefinementManager.EVENT_SCOPE, p), P.a1);
    check(clearedOverride === null, 'the real override was genuinely removed (resetToDefault), not just set to empty arrays');

    await selectOnly([]);
    const emptySelResult = await ev(() => window.AutoIngestCommands.execute('tagRefinement.useAllTags'));
    // check() already fully pre-validates (isTagRefinementActive() &&
    // getTagRefinementSelectedCount() > 0), so canExecute() rejects BEFORE
    // run() is ever called — ok:false, not run()'s own ok:true/executed:false
    // no-op shape. Same established precedent as selection.clear on an empty
    // selection (Phase 1A's own test, "declines rather than no-op-executing").
    check(emptySelResult.ok === false && emptySelResult.reason === 'not-applicable',
      'tagRefinement.useAllTags with an empty selection is rejected outright (gated by getTagRefinementSelectedCount), never silently attempted');

    // Subscription: entering/exiting refinement mode now notifies (a real gap found and
    // fixed while building this phase — see docs/commandLayer.md "State-change subscription").
    const subEvents = await ev(() => {
      window.__mx3dEvents = [];
      window.__mx3dUnsub = window.AutoIngestCommands.subscribe((s) => window.__mx3dEvents.push(s));
      return true;
    });
    check(subEvents === true, 'setup: subscribed for the notify-on-refinement-transition check');
    const closeResult = await ev(() => window.AutoIngestCommands.execute('tagRefinement.close'));
    check(closeResult.ok === true && closeResult.executed === true, 'tagRefinement.close executes');
    check(!(await ev(() => TagRefinementManager.isActive())), 'TagRefinementManager confirms refinement mode genuinely exited');
    const closeEvents = await ev(() => window.__mx3dEvents.length);
    check(closeEvents >= 1, `subscribe() fired at least once across the open->close transitions (${closeEvents} events) — the gap this phase fixed`);
    await ev(() => window.__mx3dUnsub());

    const closeAgainResult = await ev(() => window.AutoIngestCommands.execute('tagRefinement.close'));
    check(closeAgainResult.ok === false && closeAgainResult.reason === 'not-applicable',
      'tagRefinement.close when not active is rejected outright by check(), not a run()-level no-op');

    // ═══════════════════════════════════════════════════════════════════
    // 2. Non-eligible component: tagRefinement.open correctly unavailable
    // ═══════════════════════════════════════════════════════════════════
    await ev(() => window.AutoIngestCommands.execute('selection.clear'));
    await changeEventViaChooser(path.basename(dirC));
    check(await ev(() => EventCreator.getActiveEventData()?.event?.name) === path.basename(dirC), 'Change Event (via event.openChooser) → Event C (non-refinable) is Current');
    state = await ev(() => window.AutoIngestCommands.getState());
    check(!state.availableCommands.includes('tagRefinement.open'), 'tagRefinement.open is UNAVAILABLE for a component with zero refinable tags');
    const openOnGamma = await ev(() => window.AutoIngestCommands.execute('tagRefinement.open'));
    check(openOnGamma.ok === false && openOnGamma.reason === 'not-applicable',
      'tagRefinement.open on a non-eligible component is rejected outright by check() — never forces entry');

    // ═══════════════════════════════════════════════════════════════════
    // 3. Multi-component event (group-scope): open resolves the ONE group a
    // uniform selection belongs to; a selection spanning two groups, or an
    // unassigned file, correctly stays unavailable (never guesses).
    // ═══════════════════════════════════════════════════════════════════
    await changeEventViaChooser(path.basename(dirB));
    check(await ev(() => EventCreator.getActiveEventData()?.event?.name) === path.basename(dirB), 'Change Event → Event B (multi-component) is Current');
    check(await ev(() => !GroupManager.hasGroups()), 'Event B starts with its own empty groups');

    const srcB = path.join(srcRoot, 'b');
    for (const n of ['b1', 'b2', 'b3', 'b4']) { P[n] = path.join(srcB, n.toUpperCase() + '.cr2'); await writeRaw(P[n], n); }
    await ev((p) => browseFolderDirect(p), srcB);
    await window.waitForFunction((n) => document.querySelectorAll('#fileGrid .file-tile[data-path]').length === n, 4, { timeout: 20000 });

    await chordAssign([P.b1, P.b2], 1);
    await mapGroup(1, compB1);
    await chordAssign([P.b3, P.b4], 2);
    await mapGroup(2, compB2);

    await selectOnly([P.b1, P.b2]);
    state = await ev(() => window.AutoIngestCommands.getState());
    check(state.availableCommands.includes('tagRefinement.open'), 'tagRefinement.open is available for a selection uniformly inside one eligible group');
    const openGroup1 = await ev(() => window.AutoIngestCommands.execute('tagRefinement.open'));
    check(openGroup1.ok === true && openGroup1.executed === true, 'tagRefinement.open enters the resolved group scope');
    const group1Uid = await ev(() => GroupManager.getGroups().find((g) => g.id === 1)?.uid);
    check(await ev(() => TagRefinementManager.getActiveGroupId()) === group1Uid, 'the entered scope is REALLY group 1\'s stable uid — resolved from the selection, not guessed');
    state = await ev(() => window.AutoIngestCommands.getState());
    check(state.tagRefinement.componentLabel === compB1, `componentLabel reflects group 1's real mapped component ("${compB1}") (${state.tagRefinement.componentLabel})`);
    await ev(() => window.AutoIngestCommands.execute('tagRefinement.close'));

    await selectOnly([P.b1, P.b3]); // spans BOTH groups — genuinely ambiguous
    state = await ev(() => window.AutoIngestCommands.getState());
    check(!state.availableCommands.includes('tagRefinement.open'), 'tagRefinement.open is UNAVAILABLE for a selection spanning two different groups — never guesses which one');
    const openAmbiguous = await ev(() => window.AutoIngestCommands.execute('tagRefinement.open'));
    check(openAmbiguous.ok === false && openAmbiguous.reason === 'not-applicable',
      'an ambiguous-selection open attempt is rejected outright by check() — never guesses, never attempted');
    check(!(await ev(() => TagRefinementManager.isActive())), 'refinement mode was genuinely NOT entered for the ambiguous selection');

    await ev(() => window.AutoIngestCommands.execute('group.unassign')); // unassign b1 from its group — now ownerless
    state = await ev(() => window.AutoIngestCommands.getState());
    check(!state.availableCommands.includes('tagRefinement.open'), 'tagRefinement.open is UNAVAILABLE for a selection with no group at all');

    // ═══════════════════════════════════════════════════════════════════
    // 4. event.openChooser: unavailable while QMZ is open; the real
    // `event` state field updates once an actual event switch completes.
    // ═══════════════════════════════════════════════════════════════════
    await ev(() => window.AutoIngestCommands.execute('selection.clear'));
    const qmzRoot = await mkTmp('ai-e2e-mx-3d-qmz-');
    await writeRaw(path.join(qmzRoot, '_Unsequenced', 'Jane Doe', 'q1.cr2'), 'q1');
    const eventContext = { component: { location: 'Hall A', city: 'Mumbai', country: 'India' }, isMulti: false, eventTitle: 'Waaz Mubarak', hijriDate: '1448-02-10', eventJsonPath: null, componentTitle: null };
    await ev(({ root, ctx }) => window.openQMZManager(root, ctx), { root: qmzRoot, ctx: eventContext });
    await window.waitForTimeout(1000);
    check(await ev(() => !document.getElementById('qmzOverlay')?.classList.contains('hidden')), 'setup: QMZ overlay opens');
    state = await ev(() => window.AutoIngestCommands.getState());
    check(!state.availableCommands.includes('event.openChooser'), 'event.openChooser is UNAVAILABLE while QMZ is open');
    check(!('event' in state), 'event state is omitted entirely in qmz context (browse-only field, same convention as groups/tagRefinement)');
    const rejOpenChooserInQmz = await ev(() => window.AutoIngestCommands.execute('event.openChooser'));
    check(rejOpenChooserInQmz.ok === false && rejOpenChooserInQmz.reason === 'not-applicable', 'event.openChooser is rejected outright (ok:false) while QMZ is open, never silently attempted');
    await ev(() => _closeQMZManager());
    await window.waitForTimeout(300);

    const beforeSwitchEventName = (await ev(() => window.AutoIngestCommands.getState())).event.activeEventName;
    await changeEventViaChooser(path.basename(dirA));
    state = await ev(() => window.AutoIngestCommands.getState());
    check(state.event.activeEventName !== beforeSwitchEventName, `event.activeEventName genuinely changed after a real event.openChooser-driven switch (was "${beforeSwitchEventName}", now "${state.event.activeEventName}")`);
    check(await ev(() => EventCreator.getActiveEventData()?.event?.name) === path.basename(dirA), 'the REAL active event (EventCreator) matches the state field — not two independent sources of truth');

    if (failures === 0) {
      log('ALL CHECKS PASSED');
    } else {
      log(`${failures} CHECK(S) FAILED`);
      process.exitCode = 1;
    }
  } finally {
    await electronApp.close().catch(() => {});
  }
})().catch((err) => {
  console.error('[mx-cmd-3d] FATAL', err);
  process.exitCode = 1;
});
