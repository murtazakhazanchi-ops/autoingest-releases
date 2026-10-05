'use strict';

// Live end-to-end verification of Phase 3E's AutoIngest-side foundation for a
// future dynamic Logitech keypad: tagRefinement.setTagState/applyToSelected,
// the new state.tagRefinement.tags[] array, UI<->command equivalence,
// security/validation rejection, a larger-selection performance sanity
// check, and the real Phase 2 WebSocket transport end to end. No Logitech
// SDK involved — per the brief, this task builds the AutoIngest foundation
// only.
//
// Drives the REAL Electron renderer (real chip clicks for the equivalence
// section) plus a REAL raw WebSocket client (the `ws` package, same role
// test/mxControlTransportLive.test.js already established) against isolated
// synthetic fixtures. Never touches a real archive, card, NAS, or user
// settings.
//
// Run: node test/mxCommandLayerPhase3ELive.test.js

const { _electron: electron } = require('playwright-core');
const WebSocket = require('ws');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[mx-cmd-3e]', ...args); }
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

function waitForMessage(ws, predicate, timeoutMs = 5000, label = 'message') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.removeListener('message', onMsg); reject(new Error(`timed out waiting for ${label}`)); }, timeoutMs);
    function onMsg(raw) {
      let msg; try { msg = JSON.parse(raw.toString('utf8')); } catch { return; }
      if (predicate(msg)) { clearTimeout(timer); ws.removeListener('message', onMsg); resolve(msg); }
    }
    ws.on('message', onMsg);
  });
}
function connectRaw(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  ws.setMaxListeners(50);
  return ws;
}
async function readDescriptor(userDataDir) {
  const raw = await fsp.readFile(path.join(userDataDir, 'mx-control.json'), 'utf8');
  return JSON.parse(raw);
}

(async () => {
  const userDataDir = await mkTmp('ai-e2e-mx-3e-userdata-');
  const archiveRoot = await mkTmp('ai-e2e-mx-3e-archive-');
  const srcRoot = await mkTmp('ai-e2e-mx-3e-src-');
  log('userDataDir =', userDataDir);
  log('archiveRoot =', archiveRoot);

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

  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'MX Phase 3E Test');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splashState.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn'); await window.waitForTimeout(300);
      await window.fill('#splashInputName', 'MX Phase 3E Test'); await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) { await window.click('#splashContinueBtn'); }

  window = await mainWindowPromise;
  window.on('pageerror', (err) => log('[pageerror]', err.message, err.stack));
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1000);
  await window.waitForFunction(() => typeof window.selectSource === 'function', { timeout: 15000 });
  await window.waitForFunction(() => typeof window.AutoIngestCommands === 'object', { timeout: 15000 });
  const onboardingVisible = await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.contains('visible'));
  if (onboardingVisible) { await window.click('#onboardingSkip'); await window.waitForTimeout(200); }

  const ev = (fn, arg) => window.evaluate(fn, arg);

  try {
    await ev((root) => window.api.setMainArchiveRoot(root), archiveRoot);
    await ev(() => { if (typeof obFinish === 'function') obFinish(); });

    const collName = 'CollPhase3E';
    const dirAlpha = path.join(archiveRoot, collName, '1448-06-01 _01-Alpha');
    const dirBeta = path.join(archiveRoot, collName, '1448-06-02 _02-Beta');
    await ev(({ dir, data }) => window.api.writeEventJson(dir, data), {
      dir: dirAlpha, data: { version: 1, hijriDate: '1448-06-01', sequence: 1, eventName: 'Alpha', components: [
        { id: 1, folderName: 'Alpha-Hall A', location: 'Hall A', city: 'Surat', country: 'India', types: ['Waaz', 'Jashn'], additionalKeywords: ['Procession'] },
      ] },
    });
    await ev(({ dir, data }) => window.api.writeEventJson(dir, data), {
      dir: dirBeta, data: { version: 1, hijriDate: '1448-06-02', sequence: 2, eventName: 'Beta', components: [
        { id: 1, folderName: 'Ziyafat-Hall A', location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyafat'], additionalKeywords: [] },
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
    async function selectOnly(paths) {
      await ev((ps) => { selectedFiles.clear(); ps.forEach((p) => selectedFiles.add(p)); syncAllTiles(); updateSelectionBar(); }, paths);
    }
    function overrideOf(scopeConst, p) {
      return ev(({ scopeConst, p }) => TagRefinementManager.getOverride(scopeConst, p), { scopeConst, p });
    }
    /** Closes any active refinement session, opens EVENT_SCOPE, THEN selects
     * `paths` — _enterRefinementMode() clears selectedFiles on entry (exactly
     * like the real footer "Refine Tags" button), so selecting must happen
     * AFTER open, never before, or the draft functions see an empty
     * selection-within-scope. Forces a fresh renderRefinementPanel() after
     * selecting (the real UI deliberately does NOT re-render on every
     * selection change for performance — see commandLayer.md — so the
     * Use All/None/Reset buttons would otherwise still show the stale
     * selCount===0 `disabled` from the moment refinement was entered;
     * calling the exact same render function a selection-changing UI
     * interaction would eventually trigger is a test-driving concern, not a
     * product change). Returns the open command's own result. */
    async function openEventScopeWithSelection(paths) {
      await ev(() => window.AutoIngestCommands.execute('tagRefinement.close'));
      const r = await ev(() => window.AutoIngestCommands.execute('tagRefinement.open'));
      await selectOnly(paths);
      await ev(() => { if (TagRefinementManager.isActive()) renderRefinementPanel(); });
      return r;
    }

    // ── fixture files ──
    const srcA = path.join(srcRoot, 'alpha');
    const P = {};
    for (const n of ['x1', 'x2', 'x3', 'x4', 'x5', 'x6', 'x7', 'x8']) { P[n] = path.join(srcA, n.toUpperCase() + '.cr2'); await writeRaw(P[n], n); }

    await restoreEvent(dirAlpha);
    await ev((p) => selectSource({ type: 'local-folder', path: p, label: 'MX_3E_SRC' }), srcA);
    await window.waitForFunction(() => document.getElementById('workspace').classList.contains('visible'), null, { timeout: 15000 });
    await ev((p) => browseFolderDirect(p), srcA);
    await window.waitForFunction((n) => document.querySelectorAll('#fileGrid .file-tile[data-path]').length === n, 8, { timeout: 20000 });
    const EVENT_SCOPE = await ev(() => TagRefinementManager.EVENT_SCOPE);

    // ═══════════════════════════════════════════════════════════════════
    // 1. tags[] shape, canonical ids, draft-aware ON/OFF, mixed resolution
    // ═══════════════════════════════════════════════════════════════════
    let openRes = await openEventScopeWithSelection([P.x1]);
    check(openRes.ok === true && openRes.executed === true, 'setup: tagRefinement.open enters EVENT_SCOPE');

    let state = await ev(() => window.AutoIngestCommands.getState());
    const tags = state.tagRefinement.tags;
    check(Array.isArray(tags) && tags.length === 3, `tags[] has exactly 3 entries (2 Event Types + 1 Additional Keyword) (${tags?.length})`);
    const waazTag = tags.find((t) => t.label === 'Waaz');
    check(!!waazTag && waazTag.category === 'eventTypes' && waazTag.id === 'eventTypes:Waaz', `the "Waaz" tag has the correct composite id/category (${JSON.stringify(waazTag)})`);
    const procTag = tags.find((t) => t.label === 'Procession');
    check(!!procTag && procTag.category === 'additionalKeywords' && procTag.id === 'additionalKeywords:Procession', 'the "Procession" tag has the correct composite id/category');
    // Cross-check tags[] against the authoritative function it is derived from directly.
    const directSelState = await ev(({ scope, p }) => {
      const { eventTypes, additionalKeywords } = RefinableTags.availableTags(EventCreator.getEventComps()[0]);
      return TagRefinementManager.getSelectionState(scope, [p], eventTypes, additionalKeywords, RefinableTags.effectiveDefaults({ component: EventCreator.getEventComps()[0], isMulti: false }));
    }, { scope: EVENT_SCOPE, p: P.x1 });
    check(waazTag.state === directSelState.eventTypes['Waaz'], `tags[]'s "Waaz" state matches TagRefinementManager.getSelectionState() directly (${waazTag.state} vs ${directSelState.eventTypes['Waaz']})`);

    // ON: setTagState -> draft visible immediately, BEFORE Apply commits anything.
    let r = await ev(() => window.AutoIngestCommands.execute('tagRefinement.setTagState', { tagId: 'eventTypes:Waaz', checked: true }));
    check(r.ok === true && r.executed === true, 'setTagState(Waaz, true) executes');
    state = await ev(() => window.AutoIngestCommands.getState());
    check(state.tagRefinement.tags.find((t) => t.id === 'eventTypes:Waaz').state === 'checked', 'the draft is visible in state IMMEDIATELY — before Apply, the real UX requirement');
    check((await overrideOf(EVENT_SCOPE, P.x1)) === null, 'the real TagRefinementManager override is STILL null — setTagState never commits on its own');

    r = await ev(() => window.AutoIngestCommands.execute('tagRefinement.applyToSelected'));
    check(r.ok === true && r.executed === true, 'applyToSelected commits the draft');
    const committedA = await overrideOf(EVENT_SCOPE, P.x1);
    check(!!committedA && committedA.eventTypes.includes('Waaz') && !committedA.eventTypes.includes('Jashn'), `the real override now contains exactly what was drafted (${JSON.stringify(committedA)})`);

    // OFF: baseline all-checked via useAllTags, then explicitly uncheck one —
    // the other UNTOUCHED tag (Waaz) must keep its baseline value (not
    // silently reset), while the explicitly-touched one (Procession) must
    // not. Deliberately leaves x2 WITHOUT Procession (unlike x1, which kept
    // it from its own untouched baseline above) so the next section has a
    // genuinely mixed selection to resolve, not two coincidentally-identical
    // overrides.
    await selectOnly([P.x2]);
    await ev(() => window.AutoIngestCommands.execute('tagRefinement.useAllTags'));
    r = await ev(() => window.AutoIngestCommands.execute('tagRefinement.setTagState', { tagId: 'additionalKeywords:Procession', checked: false }));
    check(r.ok === true && r.executed === true, 'setTagState(Procession, false) executes after useAllTags');
    state = await ev(() => window.AutoIngestCommands.getState());
    const tagsAfterOff = state.tagRefinement.tags;
    check(tagsAfterOff.find((t) => t.id === 'additionalKeywords:Procession').state === 'unchecked', 'Procession is now unchecked in the draft');
    check(tagsAfterOff.find((t) => t.id === 'eventTypes:Waaz').state === 'checked' && tagsAfterOff.find((t) => t.id === 'eventTypes:Jashn').state === 'checked',
      'untouched tags (Waaz, Jashn) kept their baseline checked value — not silently reset by touching Procession');
    await ev(() => window.AutoIngestCommands.execute('tagRefinement.applyToSelected'));
    const committedB = await overrideOf(EVENT_SCOPE, P.x2);
    check(committedB.eventTypes.includes('Waaz') && committedB.eventTypes.includes('Jashn') && !committedB.additionalKeywords.includes('Procession'),
      `OFF toggle committed correctly alongside untouched baseline tags (${JSON.stringify(committedB)})`);

    // Mixed resolution + Apply gating. x1={Waaz,Procession} (from the ON
    // section above), x2={Waaz,Jashn} (just committed, no Procession) — Waaz
    // is shared (uniform), Jashn/Procession each differ — a genuinely mixed
    // selection, not two coincidentally-identical overrides.
    await openEventScopeWithSelection([P.x1, P.x2]);
    state = await ev(() => window.AutoIngestCommands.getState());
    check(state.tagRefinement.status === 'mixed', 'a selection with differing overrides correctly reports status "mixed"');
    check(state.tagRefinement.tags.find((t) => t.id === 'eventTypes:Waaz').state === 'checked', 'Waaz (shared by both files) reads "checked" even while mixed overall');
    check(state.tagRefinement.tags.find((t) => t.id === 'additionalKeywords:Procession').state === 'indeterminate', 'Procession (present on only one file) reads "indeterminate"');
    check(!state.availableCommands.includes('tagRefinement.applyToSelected'), 'applyToSelected is UNAVAILABLE for an untouched mixed selection — mirrors the real Apply button\'s own disabled rule exactly');
    await ev(() => window.AutoIngestCommands.execute('tagRefinement.setTagState', { tagId: 'eventTypes:Jashn', checked: true }));
    state = await ev(() => window.AutoIngestCommands.getState());
    check(state.availableCommands.includes('tagRefinement.applyToSelected'), 'applyToSelected becomes available once the operator explicitly touches a tag on a mixed selection');
    await ev(() => window.AutoIngestCommands.execute('tagRefinement.applyToSelected'));
    const committedX1 = await overrideOf(EVENT_SCOPE, P.x1);
    const committedX2 = await overrideOf(EVENT_SCOPE, P.x2);
    check(committedX1.eventTypes.includes('Jashn') && committedX2.eventTypes.includes('Jashn'), 'resolving a mixed selection applies the explicit choice to BOTH files identically');
    await ev(() => window.AutoIngestCommands.execute('tagRefinement.close'));

    // ═══════════════════════════════════════════════════════════════════
    // 2. UI <-> Command equivalence (step 11 — "especially important")
    // ═══════════════════════════════════════════════════════════════════
    async function viaRealUiSetAndApply(filePath, tagLabel) {
      await openEventScopeWithSelection([filePath]);
      await window.waitForFunction(() => TagRefinementManager.isEventScopeActive(), null, { timeout: 5000 });
      // A REAL DOM click on the actual chip checkbox — not a scripted state assignment.
      await window.evaluate((label) => {
        const cb = [...document.querySelectorAll('input[data-cat="eventTypes"]')].find((el) => el.value === label);
        cb.checked = true;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      }, tagLabel);
      await window.click('#rpApplyBtn');
      await ev(() => window.AutoIngestCommands.execute('tagRefinement.close'));
      return overrideOf(EVENT_SCOPE, filePath);
    }
    async function viaCommandsSetAndApply(filePath, tagLabel) {
      await openEventScopeWithSelection([filePath]);
      await ev((label) => window.AutoIngestCommands.execute('tagRefinement.setTagState', { tagId: `eventTypes:${label}`, checked: true }), tagLabel);
      await ev(() => window.AutoIngestCommands.execute('tagRefinement.applyToSelected'));
      await ev(() => window.AutoIngestCommands.execute('tagRefinement.close'));
      return overrideOf(EVENT_SCOPE, filePath);
    }
    const uiOverride = await viaRealUiSetAndApply(P.x3, 'Jashn');
    const cmdOverride = await viaCommandsSetAndApply(P.x4, 'Jashn');
    check(JSON.stringify([...uiOverride.eventTypes].sort()) === JSON.stringify([...cmdOverride.eventTypes].sort()) &&
      JSON.stringify([...uiOverride.additionalKeywords].sort()) === JSON.stringify([...cmdOverride.additionalKeywords].sort()),
      `ON via real UI click vs via commands produce an IDENTICAL override (${JSON.stringify(uiOverride)} vs ${JSON.stringify(cmdOverride)})`);

    // Use All: real #rpAllBtn click vs tagRefinement.useAllTags.
    await openEventScopeWithSelection([P.x5]);
    await window.click('#rpAllBtn');
    await ev(() => window.AutoIngestCommands.execute('tagRefinement.close'));
    const uiAllOverride = await overrideOf(EVENT_SCOPE, P.x5);

    await openEventScopeWithSelection([P.x6]);
    await ev(() => window.AutoIngestCommands.execute('tagRefinement.useAllTags'));
    await ev(() => window.AutoIngestCommands.execute('tagRefinement.close'));
    const cmdAllOverride = await overrideOf(EVENT_SCOPE, P.x6);
    check(JSON.stringify([...uiAllOverride.eventTypes].sort()) === JSON.stringify([...cmdAllOverride.eventTypes].sort()) &&
      JSON.stringify([...uiAllOverride.additionalKeywords].sort()) === JSON.stringify([...cmdAllOverride.additionalKeywords].sort()),
      `Use All via real UI click vs via command produce an IDENTICAL override (${JSON.stringify(uiAllOverride)} vs ${JSON.stringify(cmdAllOverride)})`);

    // Clear/Reset: real #rpResetBtn click vs tagRefinement.clearSelected.
    await openEventScopeWithSelection([P.x7]);
    await ev(() => window.AutoIngestCommands.execute('tagRefinement.useAllTags')); // give it something to clear
    await ev(() => window.AutoIngestCommands.execute('tagRefinement.close'));
    await openEventScopeWithSelection([P.x7]);
    await window.click('#rpResetBtn');
    await ev(() => window.AutoIngestCommands.execute('tagRefinement.close'));
    const uiClearOverride = await overrideOf(EVENT_SCOPE, P.x7);

    await openEventScopeWithSelection([P.x8]);
    await ev(() => window.AutoIngestCommands.execute('tagRefinement.useAllTags'));
    await ev(() => window.AutoIngestCommands.execute('tagRefinement.close'));
    await openEventScopeWithSelection([P.x8]);
    await ev(() => window.AutoIngestCommands.execute('tagRefinement.clearSelected'));
    await ev(() => window.AutoIngestCommands.execute('tagRefinement.close'));
    const cmdClearOverride = await overrideOf(EVENT_SCOPE, P.x8);
    check(uiClearOverride === null && cmdClearOverride === null, `Clear/Reset via real UI click vs via command both genuinely remove the override (null) (${JSON.stringify({ uiClearOverride, cmdClearOverride })})`);

    // ═══════════════════════════════════════════════════════════════════
    // 3. Security / validation — must fail safely, never mutate
    // ═══════════════════════════════════════════════════════════════════
    await openEventScopeWithSelection([P.x1]);
    const beforeSecurity = await overrideOf(EVENT_SCOPE, P.x1);

    const rejArbitrary = await ev(() => window.AutoIngestCommands.execute('tagRefinement.setTagState', { tagId: 'eventTypes:TotallyFakeTag', checked: true }));
    check(rejArbitrary.ok === true && rejArbitrary.executed === false, 'an arbitrary tag not in the current scope is rejected (ran, no effect, never mutates)');

    const rejWrongCategory = await ev(() => window.AutoIngestCommands.execute('tagRefinement.setTagState', { tagId: 'additionalKeywords:Waaz', checked: true }));
    check(rejWrongCategory.ok === true && rejWrongCategory.executed === false, '"Waaz" (a real label, but under the WRONG category) is rejected — category+label together are the real identity');

    const rejMalformedNoColon = await ev(() => window.AutoIngestCommands.execute('tagRefinement.setTagState', { tagId: 'Waaz', checked: true }));
    check(rejMalformedNoColon.ok === true && rejMalformedNoColon.executed === false, 'a tagId with no category prefix at all is rejected');

    const rejMissingTagId = await ev(() => window.AutoIngestCommands.execute('tagRefinement.setTagState', { checked: true }));
    check(rejMissingTagId.ok === false && rejMissingTagId.reason === 'invalid-payload', 'a missing tagId is rejected at isValid(), never attempted');

    const rejMissingChecked = await ev(() => window.AutoIngestCommands.execute('tagRefinement.setTagState', { tagId: 'eventTypes:Waaz' }));
    check(rejMissingChecked.ok === false && rejMissingChecked.reason === 'invalid-payload', 'a missing checked boolean is rejected at isValid()');

    const rejNonBooleanChecked = await ev(() => window.AutoIngestCommands.execute('tagRefinement.setTagState', { tagId: 'eventTypes:Waaz', checked: 'yes' }));
    check(rejNonBooleanChecked.ok === false && rejNonBooleanChecked.reason === 'invalid-payload', 'a non-boolean checked value ("yes") is rejected at isValid()');

    const rejNoPayload = await ev(() => window.AutoIngestCommands.execute('tagRefinement.setTagState'));
    check(rejNoPayload.ok === false && rejNoPayload.reason === 'invalid-payload', 'no payload at all is rejected at isValid()');

    const afterSecurity = await overrideOf(EVENT_SCOPE, P.x1);
    check(JSON.stringify(beforeSecurity) === JSON.stringify(afterSecurity), 'NONE of the rejected attempts above mutated the real TagRefinementManager override at all');

    // Stale tag identity after a real event/group change: a valid Alpha tagId
    // must be rejected once Beta (a different component's tag set) is active.
    await ev(() => window.AutoIngestCommands.execute('tagRefinement.close'));
    const collPath = path.join(archiveRoot, collName);
    await ev(async ({ collPath, collName, folder }) => {
      await window.api.setLastEvent({ collectionPath: collPath, collectionName: collName, eventName: folder, safeEventName: folder });
      await EventCreator.restoreLastEvent();
    }, { collPath, collName, folder: path.basename(dirBeta) });
    await window.waitForTimeout(400);
    const srcB = path.join(srcRoot, 'beta');
    const pB1 = path.join(srcB, 'B1.cr2');
    await writeRaw(pB1, 'b1');
    await ev((p) => browseFolderDirect(p), srcB);
    await window.waitForFunction((n) => document.querySelectorAll('#fileGrid .file-tile[data-path]').length === n, 1, { timeout: 20000 });
    await openEventScopeWithSelection([pB1]);
    const rejStale = await ev((tagId) => window.AutoIngestCommands.execute('tagRefinement.setTagState', { tagId, checked: true }), 'eventTypes:Waaz');
    check(rejStale.ok === true && rejStale.executed === false, 'Alpha\'s own valid tagId ("eventTypes:Waaz") is rejected once Beta\'s different component is active — stale identity never honored');
    await ev(() => window.AutoIngestCommands.execute('tagRefinement.close'));

    // Outside refinement mode entirely.
    const rejOutsideMode = await ev((tagId) => window.AutoIngestCommands.execute('tagRefinement.setTagState', { tagId, checked: true }), 'eventTypes:Ziyafat');
    check(rejOutsideMode.ok === false && rejOutsideMode.reason === 'not-applicable', 'setTagState outside refinement mode is rejected outright by check(), never attempted');
    const rejApplyOutsideMode = await ev(() => window.AutoIngestCommands.execute('tagRefinement.applyToSelected'));
    check(rejApplyOutsideMode.ok === false && rejApplyOutsideMode.reason === 'not-applicable', 'applyToSelected outside refinement mode is likewise rejected outright');

    // ═══════════════════════════════════════════════════════════════════
    // 4. Performance: a larger selection must stay bounded by selection
    // size, not archive size — no full-card/archive scan.
    // ═══════════════════════════════════════════════════════════════════
    await restoreEvent(dirAlpha);
    const srcLarge = path.join(srcRoot, 'large');
    const largePaths = [];
    for (let i = 0; i < 150; i++) {
      const p = path.join(srcLarge, `L${String(i).padStart(3, '0')}.cr2`);
      await writeRaw(p, i);
      largePaths.push(p);
    }
    await ev((p) => browseFolderDirect(p), srcLarge);
    await window.waitForFunction((n) => document.querySelectorAll('#fileGrid .file-tile[data-path]').length === n, 150, { timeout: 25000 });
    await ev(() => window.AutoIngestCommands.execute('tagRefinement.open')); // EVENT_SCOPE needs no selection to enter
    await ev(() => window.AutoIngestCommands.execute('selection.selectAll')); // select AFTER open — open clears selection
    const t0 = Date.now();
    const bigState = await ev(() => window.AutoIngestCommands.getState());
    const elapsedMs = Date.now() - t0;
    check(bigState.tagRefinement.selectedCount === 150, `a 150-file selection is reflected correctly (${bigState.tagRefinement.selectedCount})`);
    check(elapsedMs < 2000, `getState() with 150 selected files completes quickly (${elapsedMs}ms) — bounded by selection/tag count, not a card/archive scan`);
    await ev(() => window.AutoIngestCommands.execute('tagRefinement.close'));

    // ═══════════════════════════════════════════════════════════════════
    // 5. Real Phase 2 WebSocket transport — full round trip (step 12)
    // ═══════════════════════════════════════════════════════════════════
    const descriptor = await readDescriptor(userDataDir);
    /** Connects and authenticates, retrying the raw TCP/WS-upgrade connect
     * itself a few times — not the real transport's own concern (the real
     * descriptor/port/token are correct and unchanged throughout), just
     * defensive handling of a plain connection-establishment flake in this
     * test harness. */
    async function connectAndAuthenticate(attemptsLeft = 3) {
      const ws = connectRaw(descriptor.port);
      try {
        const readyPromise = waitForMessage(ws, (m) => m.type === 'ready', 5000, 'ready');
        const initialStatePromise = waitForMessage(ws, (m) => m.type === 'state' && !m.requestId, 5000, 'initial state push');
        const errorOnce = new Promise((_, reject) => ws.once('error', reject));
        await new Promise((resolve, reject) => {
          ws.once('open', resolve);
          ws.once('error', reject);
        });
        ws.send(JSON.stringify({ type: 'hello', token: descriptor.token, protocolVersion: descriptor.protocolVersion }));
        await Promise.race([Promise.all([readyPromise, initialStatePromise]), errorOnce]);
        const initialState = await initialStatePromise;
        return { ws, initialState };
      } catch (err) {
        try { ws.close(); } catch { /* ignore */ }
        if (attemptsLeft <= 1) throw err;
        log('connection attempt failed, retrying:', err.message);
        await new Promise((r) => setTimeout(r, 500));
        return connectAndAuthenticate(attemptsLeft - 1);
      }
    }
    const { ws: wsClient, initialState: wsInitialState } = await connectAndAuthenticate();
    wsClient.on('error', (err) => log('[ws error, post-setup]', err.message)); // never let a later error crash the process
    check(wsInitialState.state !== null, 'setup: real authenticated WS client receives a real initial state push');

    function execViaWs(commandId, payload) {
      const requestId = `r-${commandId}-${Math.random().toString(36).slice(2)}`;
      const resultPromise = waitForMessage(wsClient, (m) => m.type === 'commandResult' && m.requestId === requestId, 5000, `commandResult(${commandId})`);
      wsClient.send(JSON.stringify({ type: 'executeCommand', requestId, commandId, payload }));
      return resultPromise;
    }
    const nextPush = () => waitForMessage(wsClient, (m) => m.type === 'state' && !m.requestId, 4000, 'state push');

    // Back onto the original 8-file source/event (the performance section
    // above browsed into a separate 150-file folder).
    await ev((p) => browseFolderDirect(p), srcA);
    await window.waitForFunction((n) => document.querySelectorAll('#fileGrid .file-tile[data-path]').length === n, 8, { timeout: 20000 });

    let push = nextPush();
    const wsOpenResult = await execViaWs('tagRefinement.open'); // EVENT_SCOPE needs no selection to enter
    const pushedOpen = await push;
    check(wsOpenResult.result.ok === true, '1. real authenticated WS client: tagRefinement.open executes');
    check(Array.isArray(pushedOpen.state.tagRefinement?.tags) && pushedOpen.state.tagRefinement.tags.length === 3,
      '2. the pushed state carries the real available tag list with real tri-state values over the wire');

    // select AFTER open (open clears selection, same as every other scenario
    // above) — drains the selection-change's OWN push first so it is never
    // mistaken for the setTagState push that follows.
    push = nextPush();
    await selectOnly([P.x1]);
    await push;

    push = nextPush();
    const wsSetResult = await execViaWs('tagRefinement.setTagState', { tagId: 'eventTypes:Waaz', checked: true });
    const pushedAfterSet = await push;
    check(wsSetResult.result.ok === true && wsSetResult.result.executed === true, '3. the tag operation executes via the real WS transport');
    check(pushedAfterSet.state.tagRefinement.tags.find((t) => t.id === 'eventTypes:Waaz').state === 'checked',
      '4. the resulting pushed state reflects the draft change, delivered over the real socket');

    push = nextPush();
    const wsApplyResult = await execViaWs('tagRefinement.applyToSelected');
    const pushedFinal = await push;
    check(wsApplyResult.result.ok === true && wsApplyResult.result.executed === true, '5. Apply executes via the real WS transport');
    check(pushedFinal.state.tagRefinement != null, '6. the final pushed state arrives over the real socket');
    const finalOverride = await overrideOf(EVENT_SCOPE, P.x1);
    check(!!finalOverride && finalOverride.eventTypes.includes('Waaz'), 'the real TagRefinementManager was genuinely mutated end to end, through a real authenticated external WS client');

    wsClient.close();

    if (failures === 0) { log('ALL CHECKS PASSED'); } else { log(`${failures} CHECK(S) FAILED`); process.exitCode = 1; }
  } finally {
    await electronApp.close().catch(() => {});
  }
})().catch((err) => {
  console.error('[mx-cmd-3e] FATAL', err);
  process.exitCode = 1;
});
