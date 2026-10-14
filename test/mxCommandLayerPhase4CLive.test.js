'use strict';

// Live end-to-end verification of Phase 4C's addition to
// renderer/commandManager.js's AutoIngestCommands: group.setSubEvent, plus
// the two new compact state fields (`availableSubEvents`,
// `targetGroupIdForMapping`) and their subscription coverage. Split out
// from mxCommandLayerPhase3DLive.test.js (Phase 3D), which already covers
// group.assign/unassign and tagRefinement.* this file builds alongside.
//
// Drives the REAL Electron renderer against isolated synthetic fixtures
// (a real multi-component event.json, a real single-component event.json,
// real GroupManager groups, a real local-folder source). Never touches a
// real archive, card, NAS, or user settings.
//
// Run: node test/mxCommandLayerPhase4CLive.test.js

const { _electron: electron } = require('playwright-core');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[mx-cmd-4c]', ...args); }
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
  const userDataDir = await mkTmp('ai-e2e-mx-4c-userdata-');
  const archiveRoot = await mkTmp('ai-e2e-mx-4c-archive-');
  const srcRoot = await mkTmp('ai-e2e-mx-4c-src-');
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
    await window.fill('#splashInputName', 'MX Phase 4C Test');
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
      await window.fill('#splashInputName', 'MX Phase 4C Test');
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

    const collName = 'CollPhase4C';
    const dirMulti   = path.join(archiveRoot, collName, '1448-05-02 _01-Multi-Beta');
    const dirSingle  = path.join(archiveRoot, collName, '1448-05-01 _02-Single-Alpha');
    const compWaaz    = '01-Waaz-Hall A';
    const compZiyafat = '02-Ziyafat-Hall A';

    await ev(({ dir, data }) => window.api.writeEventJson(dir, data), {
      dir: dirMulti, data: { version: 1, hijriDate: '1448-05-02', sequence: 1, eventName: 'Multi-Beta', components: [
        { id: 1, folderName: compWaaz, location: 'Hall A', city: 'Surat', country: 'India', types: ['Waaz'], additionalKeywords: [] },
        { id: 2, folderName: compZiyafat, location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyafat'], additionalKeywords: [] },
      ] },
    });
    await ev(({ dir, data }) => window.api.writeEventJson(dir, data), {
      dir: dirSingle, data: { version: 1, hijriDate: '1448-05-01', sequence: 2, eventName: 'Single-Alpha', components: [
        { id: 1, folderName: 'Jashn-Hall A', location: 'Hall A', city: 'Surat', country: 'India', types: ['Jashn'], additionalKeywords: [] },
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
      await ev(() => window.AutoIngestCommands.execute('event.openChooser'));
      await window.waitForFunction(() => EventMgmt.isOpen(), null, { timeout: 5000 });
      await window.waitForSelector(`.ec-evl-item[data-folder="${folderName}"]`, { timeout: 15000 });
      await window.click(`.ec-evl-item[data-folder="${folderName}"]`);
      await window.waitForFunction(() => !document.getElementById('emmContinueBtn').disabled, null, { timeout: 5000 });
      await window.click('#emmContinueBtn');
      await window.waitForFunction(() => !EventMgmt.isOpen(), null, { timeout: 15000 });
      await window.waitForTimeout(400);
    }
    async function chordAssign(paths, n) {
      await ev((ps) => { selectedFiles.clear(); ps.forEach((p) => selectedFiles.add(p)); syncAllTiles(); updateSelectionBar(); }, paths);
      await window.keyboard.press('Control+g');
      await window.keyboard.press(String(n));
      await window.waitForTimeout(200);
    }
    async function selectOnly(paths) {
      await ev((ps) => { selectedFiles.clear(); ps.forEach((p) => selectedFiles.add(p)); syncAllTiles(); updateSelectionBar(); }, paths);
    }

    const srcB = path.join(srcRoot, 'b');
    const P = {};
    for (const n of ['b1', 'b2', 'b3', 'b4']) { P[n] = path.join(srcB, n.toUpperCase() + '.cr2'); await writeRaw(P[n], n); }

    // ═══════════════════════════════════════════════════════════════════
    // 1. Single-component event: group.setSubEvent correctly unavailable
    // (no sub-event/component concept at all — same convention Tag
    // Refinement's own commands use).
    // ═══════════════════════════════════════════════════════════════════
    await restoreEvent(dirSingle);
    check(await ev(() => EventCreator.getActiveEventData()?.event?.name) === path.basename(dirSingle), 'setup: Event (single-component) is the Current Event');
    let state = await ev(() => window.AutoIngestCommands.getState());
    check(!('availableSubEvents' in state), 'availableSubEvents is omitted for a single-component event');
    check(!state.availableCommands.includes('group.setSubEvent'), 'group.setSubEvent is UNAVAILABLE for a single-component event');
    const rejSingle = await ev(() => window.AutoIngestCommands.execute('group.setSubEvent', { groupId: 1, subEventId: 'anything' }));
    check(rejSingle.ok === false && rejSingle.reason === 'not-applicable', 'group.setSubEvent is rejected outright by check() in a single-component event');

    // ═══════════════════════════════════════════════════════════════════
    // 2. Multi-component event: state schema, target-group resolution,
    // valid mapping, state update, and subscription.
    // ═══════════════════════════════════════════════════════════════════
    await changeEventViaChooser(path.basename(dirMulti));
    check(await ev(() => EventCreator.getActiveEventData()?.event?.name) === path.basename(dirMulti), 'Change Event → multi-component event is Current');
    await ev((p) => selectSource({ type: 'local-folder', path: p, label: 'MX_4C_SRC_B' }), srcB);
    await window.waitForFunction(() => document.getElementById('workspace').classList.contains('visible'), null, { timeout: 15000 });
    await ev((p) => browseFolderDirect(p), srcB);
    await window.waitForFunction((n) => document.querySelectorAll('#fileGrid .file-tile[data-path]').length === n, 4, { timeout: 20000 });

    state = await ev(() => window.AutoIngestCommands.getState());
    check(Array.isArray(state.availableSubEvents) && state.availableSubEvents.length === 2,
      `availableSubEvents lists both real components (${JSON.stringify(state.availableSubEvents)})`);
    check(state.availableSubEvents.some((s) => s.id === compWaaz && s.name === compWaaz),
      'a real component entry has the real folder name as both id and name — never rebuilt from other fields');
    check(state.targetGroupIdForMapping === null, 'targetGroupIdForMapping is null before any group exists — nothing to map yet');

    await chordAssign([P.b1, P.b2], 1); // creates G1, assigns b1/b2
    await selectOnly([P.b1]);
    state = await ev(() => window.AutoIngestCommands.getState());
    check(state.targetGroupIdForMapping === 1, `targetGroupIdForMapping resolves to G1 for a selection fully inside it (${state.targetGroupIdForMapping})`);
    check(state.availableCommands.includes('group.setSubEvent'), 'group.setSubEvent is available now that a multi-component event + a group exist');

    // Malformed payloads — isValid() rejects before check()/run() ever run.
    const malformed1 = await ev((sub) => window.AutoIngestCommands.execute('group.setSubEvent', { groupId: 'not-a-number', subEventId: sub }), compWaaz);
    check(malformed1.ok === false && malformed1.reason === 'invalid-payload', 'non-integer groupId is rejected as invalid-payload');
    const malformed2 = await ev(() => window.AutoIngestCommands.execute('group.setSubEvent', { groupId: 1, subEventId: '' }));
    check(malformed2.ok === false && malformed2.reason === 'invalid-payload', 'empty-string subEventId is rejected as invalid-payload');
    const malformed3 = await ev(() => window.AutoIngestCommands.execute('group.setSubEvent', { groupId: 1 }));
    check(malformed3.ok === false && malformed3.reason === 'invalid-payload', 'missing subEventId is rejected as invalid-payload');

    // Invalid groupId (well-formed, but no such group).
    const subEventsSubscribed = await ev(() => {
      window.__mx4cEvents = [];
      window.__mx4cUnsub = window.AutoIngestCommands.subscribe((s) => window.__mx4cEvents.push(s));
      return true;
    });
    check(subEventsSubscribed === true, 'setup: subscribed for the notify-on-remap check');
    const unknownGroup = await ev((sub) => window.AutoIngestCommands.execute('group.setSubEvent', { groupId: 999, subEventId: sub }), compWaaz);
    check(unknownGroup.ok === true && unknownGroup.executed === false, 'an unknown groupId is a real no-op (ok:true, executed:false) — a well-formed-but-rejected payload, not a check() failure');

    // Invalid/stale subEventId (well-formed, but not a real component).
    const unknownSub = await ev(() => window.AutoIngestCommands.execute('group.setSubEvent', { groupId: 1, subEventId: 'not-a-real-component-id' }));
    check(unknownSub.ok === true && unknownSub.executed === false, 'an unknown subEventId is a real no-op, never guessed at or silently accepted');

    // Valid mapping.
    const validMap = await ev((sub) => window.AutoIngestCommands.execute('group.setSubEvent', { groupId: 1, subEventId: sub }), compWaaz);
    check(validMap.ok === true && validMap.executed === true, 'a valid group.setSubEvent executes and applies');
    const g1SubEvent = await ev(() => GroupManager.getGroups().find((g) => g.id === 1)?.subEventId);
    check(g1SubEvent === compWaaz, `the REAL GroupManager group now has the real subEventId ("${g1SubEvent}") — not a plugin-side fabrication`);
    state = await ev(() => window.AutoIngestCommands.getState());
    check(state.availableSubEvents.find((s) => s.id === compWaaz) !== undefined, 'state still lists the mapped component (availableSubEvents is the full list, not "remaining")');
    const mappedGroupState = state.groups.find((g) => g.id === 1);
    check(mappedGroupState.subEventId === compWaaz, `the compact groups[] field reflects the real mapping (${JSON.stringify(mappedGroupState)})`);
    const notifyEvents = await ev(() => window.__mx4cEvents.length);
    check(notifyEvents >= 1, `subscribe() fired at least once for the remap (${notifyEvents} events) — brief §5's explicit requirement`);
    await ev(() => window.__mx4cUnsub());

    // ═══════════════════════════════════════════════════════════════════
    // 3. Group membership / ImportSession ownership untouched by a remap.
    // ═══════════════════════════════════════════════════════════════════
    const filesBeforeRemap = await ev(() => [...GroupManager.getGroups().find((g) => g.id === 1).files].sort());
    const ownedBefore = await ev((p) => ImportSession.isOwnedByCurrent(p), P.b1);
    const remapAgain = await ev((sub) => window.AutoIngestCommands.execute('group.setSubEvent', { groupId: 1, subEventId: sub }), compZiyafat);
    check(remapAgain.ok === true && remapAgain.executed === true, 'remapping an already-mapped group to a DIFFERENT component (no prior refinements) executes directly, no confirmation needed');
    const filesAfterRemap = await ev(() => [...GroupManager.getGroups().find((g) => g.id === 1).files].sort());
    check(JSON.stringify(filesBeforeRemap) === JSON.stringify(filesAfterRemap), `group membership is byte-for-byte unchanged by a sub-event remap (${JSON.stringify(filesBeforeRemap)})`);
    const ownedAfter = await ev((p) => ImportSession.isOwnedByCurrent(p), P.b1);
    check(ownedBefore === ownedAfter, `ImportSession ownership of b1 is unchanged by a sub-event remap (before=${ownedBefore}, after=${ownedAfter}) — a remap must never independently alter file→event ownership`);

    // ═══════════════════════════════════════════════════════════════════
    // 4. Duplicate mapping — blocked, matching the real dropdown's own
    // `disabled` rule (brief §12).
    // ═══════════════════════════════════════════════════════════════════
    await chordAssign([P.b3, P.b4], 2); // creates G2
    await selectOnly([P.b3]);
    state = await ev(() => window.AutoIngestCommands.getState());
    check(state.targetGroupIdForMapping === 2, 'targetGroupIdForMapping resolves to G2 for a selection inside it');
    const dupAttempt = await ev((sub) => window.AutoIngestCommands.execute('group.setSubEvent', { groupId: 2, subEventId: sub }), compZiyafat);
    check(dupAttempt.ok === true && dupAttempt.executed === false, 'mapping G2 to a component G1 already owns is a real no-op — same block the dropdown\'s own disabled item enforces');
    const g2SubEventAfterDup = await ev(() => GroupManager.getGroups().find((g) => g.id === 2)?.subEventId);
    check(g2SubEventAfterDup === null, 'G2 remains unmapped after the rejected duplicate attempt — never partially applied');

    // ═══════════════════════════════════════════════════════════════════
    // 5. Ambiguous selection: targetGroupIdForMapping is null, never a guess.
    // ═══════════════════════════════════════════════════════════════════
    await selectOnly([P.b1, P.b3]); // spans G1 and G2
    state = await ev(() => window.AutoIngestCommands.getState());
    check(state.targetGroupIdForMapping === null, 'targetGroupIdForMapping is null for a selection spanning two different groups — never guesses which one');

    // ═══════════════════════════════════════════════════════════════════
    // 6. Stale subEventId after Change Event: a subEventId real in the OLD
    // event must be rejected in a DIFFERENT event, never silently accepted.
    // ═══════════════════════════════════════════════════════════════════
    await ev(() => window.AutoIngestCommands.execute('selection.clear'));
    await changeEventViaChooser(path.basename(dirSingle));
    await changeEventViaChooser(path.basename(dirMulti)); // back to the multi-component event — groups persist per-event-instance in this harness
    await selectOnly([P.b1]);
    const staleAttempt = await ev((sub) => window.AutoIngestCommands.execute('group.setSubEvent', { groupId: 1, subEventId: sub }), 'totally-made-up-stale-id');
    check(staleAttempt.ok === true && staleAttempt.executed === false, 'a subEventId that is not a real component of the CURRENT active event is rejected, never guessed at');

    // ═══════════════════════════════════════════════════════════════════
    // 7. UI ↔ command equivalence: the mouse-driven dropdown and
    // group.setSubEvent must produce IDENTICAL resulting GroupManager state
    // for an equivalent remap (brief §14) — both call the exact same
    // _setGroupSubEvent primitive, this proves it end-to-end.
    // ═══════════════════════════════════════════════════════════════════
    await ev((sub) => window.AutoIngestCommands.execute('group.setSubEvent', { groupId: 1, subEventId: sub }), compWaaz); // known baseline
    const viaCommand = await ev((sub) => window.AutoIngestCommands.execute('group.setSubEvent', { groupId: 1, subEventId: sub }), compZiyafat);
    check(viaCommand.ok === true && viaCommand.executed === true, 'setup: command-driven remap applied');
    const stateAfterCommand = await ev(() => GroupManager.getGroups().find((g) => g.id === 1).subEventId);

    // Reset to baseline, then do the equivalent remap via the REAL dropdown UI.
    await ev((sub) => window.AutoIngestCommands.execute('group.setSubEvent', { groupId: 1, subEventId: sub }), compWaaz);
    await ev(() => renderGroupPanel());
    await window.click('.gc-sub-trigger[data-gid="1"]');
    await window.waitForSelector('.gc-dropdown', { timeout: 5000 });
    await window.click(`.gc-dropdown-item[data-value="${compZiyafat}"]`); // Node-side string interpolation — safe, not an evaluate() closure
    await window.waitForTimeout(200);
    const stateAfterUi = await ev(() => GroupManager.getGroups().find((g) => g.id === 1).subEventId);
    check(stateAfterUi === stateAfterCommand && stateAfterUi === compZiyafat,
      `the mouse dropdown and group.setSubEvent produce IDENTICAL resulting state (UI: "${stateAfterUi}", command: "${stateAfterCommand}")`);

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
  console.error('[mx-cmd-4c] FATAL', err);
  process.exitCode = 1;
});
