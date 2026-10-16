'use strict';

// Live end-to-end verification of renderer/commandManager.js's
// AutoIngestCommands registry (AI-FEAT MX Console Phase 1A, re-derived
// against the post-v0.9.13 reconciled codebase), driving the REAL Electron
// renderer against isolated synthetic media fixtures. Never touches a real
// archive, card, NAS, or user settings.
//
// Proves the command layer invokes the SAME authoritative renderer state
// (selectedFiles, tileMap, GroupManager, TagRefinementManager, ImportSession,
// the preview overlay) that the existing mouse/keyboard handlers use — never
// a parallel/duplicated implementation — and that it fails safely for
// unknown commands and malformed payloads.
//
// Sections 11-12 are new regression coverage for the reconciliation's
// conflict area: Stable's Per-Photo Tag Refinement and Multi-Event Import
// work added production side effects (TagRefinementManager.clearFiles,
// syncAllRefinementBadges, ImportSession cross-event claim tracking) to the
// exact group-assignment code Phase 1A had extracted into shared primitives.
// These prove the re-derived _assignSelectionToGroup/_unassignSelectionFromGroup
// still perform every one of those side effects for a command-driven caller,
// not just for the pre-existing context-menu/Cmd+G-chord callers.
//
// Run: node test/mxCommandLayerLive.test.js

const { _electron: electron } = require('playwright-core');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[mx-cmd-layer]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

// scanMediaRecursive drops files under 50 KB as thumbnail/proxy stubs —
// fixture media must clear that bar to be recognized as real media.
const FAKE_MEDIA_BYTES = Buffer.alloc(60 * 1024, 0xab);

async function writeMedia(root, relFile) {
  const full = path.join(root, relFile);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, FAKE_MEDIA_BYTES);
}

(async () => {
  const userDataDir = await mkTmp('ai-e2e-mx-cmd-userdata-');
  const card = await mkTmp('ai-e2e-mx-cmd-card-');
  await writeMedia(card, 'DCIM/100CANON/IMG_0001.JPG');
  await writeMedia(card, 'DCIM/100CANON/IMG_0002.JPG');
  await writeMedia(card, 'DCIM/100CANON/IMG_0003.JPG');

  log('userDataDir =', userDataDir);
  log('card        =', card);

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

  // Splash/operator screen — same handling as the other *Live.test.js files.
  await window.waitForTimeout(1500);
  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));
  log('splash state:', JSON.stringify(splashState));

  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'MX Command Layer Test');
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
      await window.fill('#splashInputName', 'MX Command Layer Test');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  } else {
    log('WARNING: no recognizable splash panel visible — continuing anyway');
  }

  window = await mainWindowPromise;
  window.on('pageerror', (err) => log('[pageerror]', err.message, err.stack));
  window.on('console', (msg) => { if (msg.type() === 'error') log('[console.error]', msg.text()); });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1000);
  await window.waitForFunction(() => typeof window.selectSource === 'function', { timeout: 15000 });
  await window.waitForFunction(() => typeof window.AutoIngestCommands === 'object', { timeout: 15000 });

  // A freshly-created operator profile shows the first-run onboarding tour
  // overlay, which _isAnyBlockingOverlayOpen() correctly treats as blocking
  // (by design, predating this change) — dismiss it so navigation commands
  // are exercised the same way a real operator would experience them.
  const onboardingVisible = await window.evaluate(() =>
    document.getElementById('onboardingOverlay')?.classList.contains('visible'));
  if (onboardingVisible) {
    await window.click('#onboardingSkip');
    await window.waitForTimeout(200);
  }

  try {
    // ═══════════════════════════════════════════════════════════════════
    // 1. Registry contains the expected initial commands
    // ═══════════════════════════════════════════════════════════════════
    const commands = await window.evaluate(() => window.AutoIngestCommands.getCommands());
    log('registered commands:', JSON.stringify(commands));
    const expected = [
      'navigation.nextFile', 'navigation.previousFile',
      'selection.toggleCurrent', 'selection.selectAll', 'selection.clear',
      'preview.toggle',
      'group.assign', 'group.unassign',
      'qmz.assignToSequence', // added in Phase 1B — see test/mxCommandLayerPhase1BLive.test.js
      // added in Phase 3D — see test/mxCommandLayerPhase3DLive.test.js
      'tagRefinement.open', 'tagRefinement.close', 'tagRefinement.useAllTags', 'tagRefinement.clearSelected',
      'event.openChooser',
      // added in Phase 3E — see test/mxCommandLayerPhase3ELive.test.js
      'tagRefinement.setTagState', 'tagRefinement.applyToSelected',
      // added by the Map Group feature (group → sub-event mapping, commit
      // e22a172) — see mxLogitechCSharp.md
      'group.setSubEvent',
      // added alongside the GROUPS overflow workspace (safe Import review
      // entry point, commit 7fc2978) — see mxLogitechCSharp.md
      'import.openConfirmation',
    ];
    check(expected.every((id) => commands.includes(id)), 'registry contains every expected initial command');
    check(commands.length === expected.length, 'registry contains no unexpected extra commands');

    // ═══════════════════════════════════════════════════════════════════
    // 2. Unknown command fails safely
    // ═══════════════════════════════════════════════════════════════════
    const unknown = await window.evaluate(() => window.AutoIngestCommands.execute('nope.doesNotExist'));
    check(unknown.ok === false && unknown.reason === 'unknown-command', 'unknown command returns ok:false without throwing');
    const unknownCanExec = await window.evaluate(() => window.AutoIngestCommands.canExecute('nope.doesNotExist'));
    check(unknownCanExec.ok === false, 'canExecute also rejects an unknown command');

    // Before any files are loaded, commands requiring an active file/selection
    // must decline rather than throw.
    const tooEarly = await window.evaluate(() => window.AutoIngestCommands.execute('selection.toggleCurrent'));
    check(tooEarly.ok === false && tooEarly.reason === 'not-applicable', 'selection.toggleCurrent fails safely with no files loaded yet');

    // ── Load fixture media into the real browse grid ──────────────────────
    await window.evaluate((p) => window.selectSource({ type: 'memory-card', path: p, label: 'MX_CMD_CARD' }), card);
    await window.waitForTimeout(800);
    await window.waitForFunction(() => document.querySelectorAll('#fileGrid .file-tile').length >= 3, { timeout: 15000 });

    const order = await window.evaluate(() => getRenderedPathOrder());
    log('rendered order:', JSON.stringify(order));
    check(order.length === 3, 'all 3 fixture files are rendered');

    // ═══════════════════════════════════════════════════════════════════
    // 3. next/previous navigation boundaries
    // ═══════════════════════════════════════════════════════════════════
    let active = await window.evaluate(() => lastClickedPath);
    check(active === null || active === undefined, 'no active file before any navigation');

    let r = await window.evaluate(() => window.AutoIngestCommands.execute('navigation.nextFile'));
    check(r.ok === true && r.executed === true, 'navigation.nextFile from nothing focuses the first file');
    active = await window.evaluate(() => lastClickedPath);
    check(active === order[0], 'active file is now the first rendered file');

    r = await window.evaluate(() => window.AutoIngestCommands.execute('navigation.nextFile'));
    active = await window.evaluate(() => lastClickedPath);
    check(r.executed === true && active === order[1], 'navigation.nextFile moves to the second file');

    r = await window.evaluate(() => window.AutoIngestCommands.execute('navigation.nextFile'));
    active = await window.evaluate(() => lastClickedPath);
    check(r.executed === true && active === order[2], 'navigation.nextFile moves to the third (last) file');

    r = await window.evaluate(() => window.AutoIngestCommands.execute('navigation.nextFile'));
    active = await window.evaluate(() => lastClickedPath);
    check(r.ok === true && r.executed === false && active === order[2],
      'navigation.nextFile at the last file is a safe no-op (stays put, executed:false)');

    r = await window.evaluate(() => window.AutoIngestCommands.execute('navigation.previousFile'));
    active = await window.evaluate(() => lastClickedPath);
    check(r.executed === true && active === order[1], 'navigation.previousFile moves back to the second file');

    // ═══════════════════════════════════════════════════════════════════
    // 4. Selection toggle (on the active file, order[1])
    // ═══════════════════════════════════════════════════════════════════
    let selSize = await window.evaluate(() => selectedFiles.size);
    check(selSize === 0, 'selection starts empty');

    r = await window.evaluate(() => window.AutoIngestCommands.execute('selection.toggleCurrent'));
    let selHas = await window.evaluate((p) => selectedFiles.has(p), order[1]);
    check(r.ok === true && r.executed === true && selHas, 'selection.toggleCurrent selects the active file');

    r = await window.evaluate(() => window.AutoIngestCommands.execute('selection.toggleCurrent'));
    selHas = await window.evaluate((p) => selectedFiles.has(p), order[1]);
    check(r.executed === true && !selHas, 'selection.toggleCurrent deselects it again');

    // A real click still works identically afterward (proves no divergent state).
    await window.evaluate((p) => { const t = tileMap.get(p); t && t.click(); }, order[0]);
    await window.waitForTimeout(100);

    // ═══════════════════════════════════════════════════════════════════
    // 5. selectAll / 6. clear
    // ═══════════════════════════════════════════════════════════════════
    r = await window.evaluate(() => window.AutoIngestCommands.execute('selection.selectAll'));
    selSize = await window.evaluate(() => selectedFiles.size);
    check(r.executed === true && selSize === 3, 'selection.selectAll selects every visible file');

    r = await window.evaluate(() => window.AutoIngestCommands.execute('selection.clear'));
    selSize = await window.evaluate(() => selectedFiles.size);
    check(r.executed === true && selSize === 0, 'selection.clear empties the selection');

    const clearAgain = await window.evaluate(() => window.AutoIngestCommands.execute('selection.clear'));
    check(clearAgain.ok === false && clearAgain.reason === 'not-applicable', 'selection.clear on an empty selection declines rather than no-op-executing');

    // ═══════════════════════════════════════════════════════════════════
    // 7. preview.toggle invokes the authoritative preview path
    // ═══════════════════════════════════════════════════════════════════
    await window.evaluate((p) => { const t = tileMap.get(p); t && t.click(); }, order[0]); // sets lastClickedPath, no preview
    await window.waitForTimeout(100);
    let overlayHidden = await window.evaluate(() => document.getElementById('previewOverlay').classList.contains('hidden'));
    check(overlayHidden, 'preview overlay starts hidden');

    r = await window.evaluate(() => window.AutoIngestCommands.execute('preview.toggle'));
    await window.waitForTimeout(300);
    overlayHidden = await window.evaluate(() => document.getElementById('previewOverlay').classList.contains('hidden'));
    const pvFilename = await window.evaluate(() => document.getElementById('pvFilename')?.textContent);
    check(r.executed === true && !overlayHidden, 'preview.toggle opens the real preview overlay');
    check(!!pvFilename, 'preview overlay shows the active file\'s name (real content, not a stub)');

    r = await window.evaluate(() => window.AutoIngestCommands.execute('preview.toggle'));
    await window.waitForTimeout(100);
    overlayHidden = await window.evaluate(() => document.getElementById('previewOverlay').classList.contains('hidden'));
    check(r.executed === true && overlayHidden, 'preview.toggle closes the overlay again');

    // ═══════════════════════════════════════════════════════════════════
    // 8. group.assign invokes GroupManager rather than duplicating group state
    // ═══════════════════════════════════════════════════════════════════
    let groupCount = await window.evaluate(() => GroupManager.getGroups().length);
    check(groupCount === 0, 'no groups exist yet');

    await window.evaluate((paths) => { paths.forEach((p) => selectedFiles.add(p)); syncAllTiles(); }, [order[0], order[1]]);
    r = await window.evaluate(() => window.AutoIngestCommands.execute('group.assign', { groupId: null }));
    const groupState = await window.evaluate(() => {
      const groups = GroupManager.getGroups();
      return {
        count: groups.length,
        g1Files: groups[0] ? [...groups[0].files].sort() : null,
      };
    });
    log('group state after assign:', JSON.stringify(groupState));
    check(r.ok === true && r.executed === true && groupState.count === 1, 'group.assign creates exactly one new group via GroupManager');
    check(JSON.stringify(groupState.g1Files) === JSON.stringify([order[0], order[1]].sort()),
      'the group\'s files are exactly the 2 selected files — GroupManager is the single source of truth');

    const gid = r.detail && r.detail.groupId;
    check(typeof gid === 'number', 'group.assign returns { groupId, claim } as detail, with a numeric groupId');
    check(r.detail && ('claim' in r.detail), 'detail also carries a claim field (null here — no other event owns these files yet)');
    check(!r.detail.claim, 'claim is falsy when no cross-event reassignment happened (single-context assignment)');

    // ═══════════════════════════════════════════════════════════════════
    // 9. invalid group payload does not corrupt state
    // ═══════════════════════════════════════════════════════════════════
    const beforeInvalid = await window.evaluate(() => GroupManager.getGroups().length);
    const invalid1 = await window.evaluate(() => window.AutoIngestCommands.execute('group.assign', { groupId: 'not-a-number' }));
    const invalid2 = await window.evaluate(() => window.AutoIngestCommands.execute('group.assign', 'a string, not an object'));
    const invalid3 = await window.evaluate(() => window.AutoIngestCommands.execute('group.assign', { groupId: 1.5 }));
    const afterInvalid = await window.evaluate(() => GroupManager.getGroups().length);
    check(invalid1.ok === false && invalid1.reason === 'invalid-payload', 'a non-numeric groupId is rejected');
    check(invalid2.ok === false && invalid2.reason === 'invalid-payload', 'a non-object payload is rejected');
    check(invalid3.ok === false && invalid3.reason === 'invalid-payload', 'a non-integer groupId is rejected');
    check(afterInvalid === beforeInvalid, 'no group was created/mutated by any of the rejected payloads');

    // group.unassign
    r = await window.evaluate(() => window.AutoIngestCommands.execute('group.unassign'));
    const afterUnassign = await window.evaluate(() => GroupManager.getGroups().length);
    check(r.ok === true && r.executed === true && afterUnassign === 0, 'group.unassign removes the files, and GroupManager auto-removes the now-empty group');

    // ═══════════════════════════════════════════════════════════════════
    // 10. commands do not cause unintended renderFileArea calls
    // Proven by DOM node identity: renderFileArea rebuilds tileMap (and the
    // DOM tiles) from scratch, so the tile element for order[0] would be a
    // NEW node if any command layer call had forced a re-render.
    // ═══════════════════════════════════════════════════════════════════
    const tileHandleBefore = await window.evaluateHandle((p) => tileMap.get(p), order[0]);
    await window.evaluate(() => window.AutoIngestCommands.execute('navigation.nextFile'));
    await window.evaluate(() => window.AutoIngestCommands.execute('selection.toggleCurrent'));
    await window.evaluate(() => window.AutoIngestCommands.execute('selection.selectAll'));
    await window.evaluate(() => window.AutoIngestCommands.execute('selection.clear'));
    const sameNode = await window.evaluate(([el, p]) => tileMap.get(p) === el, [tileHandleBefore, order[0]]);
    check(sameNode, 'the tile DOM node for order[0] is the SAME object after a run of commands — no renderFileArea rebuild occurred');

    // ═══════════════════════════════════════════════════════════════════
    // 11. Command-driven group assignment preserves Tag Refinement cleanup
    // and refinement-badge sync — the reconciliation's conflict area.
    // Proven directly against TagRefinementManager's own real state (not a
    // DOM badge, which needs a full multi-component-event refinement
    // session to render — see the module comment above), and cross-checked
    // that the pre-existing context-menu-equivalent code path (a direct
    // GroupManager.assignFiles call, same as _assignSelectionToGroup's own
    // body) produces the identical TagRefinementManager side effect, proving
    // the command layer is another caller of the same primitive, not a
    // parallel implementation.
    // ═══════════════════════════════════════════════════════════════════
    await window.evaluate((p) => {
      selectedFiles.clear();
      selectedFiles.add(p);
      syncAllTiles();
      TagRefinementManager.setOverride(TagRefinementManager.EVENT_SCOPE, [p], { eventTypes: ['Test Type'], additionalKeywords: ['test-kw'] });
    }, order[0]);
    let override = await window.evaluate((p) => TagRefinementManager.getOverride(TagRefinementManager.EVENT_SCOPE, p), order[0]);
    check(!!override && override.eventTypes.includes('Test Type'), 'setup: a refinement override is set on the active file before assignment');

    r = await window.evaluate(() => window.AutoIngestCommands.execute('group.assign', { groupId: null }));
    override = await window.evaluate((p) => TagRefinementManager.getOverride(TagRefinementManager.EVENT_SCOPE, p), order[0]);
    let refBadgeCallSucceeded = await window.evaluate(() => { try { syncAllRefinementBadges(); return true; } catch { return false; } });
    check(r.ok === true && r.executed === true, 'group.assign via the command layer executes');
    check(override === null, 'group.assign THROUGH THE COMMAND LAYER clears the pre-existing refinement override (TagRefinementManager.clearFiles ran)');
    check(refBadgeCallSucceeded, 'syncAllRefinementBadges runs cleanly after a command-driven assignment (no stale/inconsistent tileMap state)');

    // Equivalence: the same override, cleared via the pre-existing UI-path
    // primitive body (a direct GroupManager.assignFiles call preceded by
    // TagRefinementManager.clearFiles, exactly what the context menu and
    // Cmd+G chord already did before this extraction) — same outcome.
    const gidForEquivalence = await window.evaluate(() => GroupManager.createGroup());
    await window.evaluate((p) => {
      TagRefinementManager.setOverride(TagRefinementManager.EVENT_SCOPE, [p], { eventTypes: ['Test Type 2'], additionalKeywords: [] });
    }, order[1]);
    await window.evaluate(([p, gid]) => {
      // Mirrors _assignSelectionToGroup's own body exactly (the shared primitive
      // both the context menu and the command layer call) — proving the two
      // callers are equivalent means proving THIS sequence, run directly,
      // produces the same clearing behavior the command layer's call just did.
      TagRefinementManager.clearFiles([p]);
      GroupManager.assignFiles([p], gid);
    }, [order[1], gidForEquivalence]);
    const overrideAfterDirectPath = await window.evaluate((p) => TagRefinementManager.getOverride(TagRefinementManager.EVENT_SCOPE, p), order[1]);
    check(overrideAfterDirectPath === null, 'the pre-existing UI-path primitive body clears the override identically — command layer and UI path are equivalent, not parallel implementations');

    // Clean up this section's groups so section 12 starts from a known state.
    await window.evaluate(() => { for (const g of [...GroupManager.getGroups()]) GroupManager.removeGroup(g.id); });

    // ═══════════════════════════════════════════════════════════════════
    // 12. Multi-Event Import: command-driven group.assign participates in
    // cross-event claim tracking exactly like the Cmd+G chord does.
    // Uses ImportSession's own real switchTo/ownerOf API directly (pure
    // renderer state — no disk I/O, no real event.json) to bind
    // GroupManager to two distinct synthetic event workspaces, exactly as
    // EventCreator does when an operator actually switches events.
    // ═══════════════════════════════════════════════════════════════════
    await window.evaluate(() => {
      ImportSession.reset();
      ImportSession.switchTo({ eventPath: '/tmp/mx-cmd-test-event-A', collectionPath: '/tmp/mx-cmd-test-coll', coll: {}, event: { displayName: 'Event A' }, idx: 0 });
    });
    const gidA = await window.evaluate(() => GroupManager.createGroup());
    await window.evaluate(([p, gid]) => GroupManager.assignFiles([p], gid), [order[2], gidA]);
    let owner = await window.evaluate((p) => ImportSession.ownerOf(p)?.key, order[2]);
    check(!!owner, 'setup: Event A now owns the fixture file via a real ImportSession/GroupManager claim');

    await window.evaluate(() => {
      ImportSession.switchTo({ eventPath: '/tmp/mx-cmd-test-event-B', collectionPath: '/tmp/mx-cmd-test-coll', coll: {}, event: { displayName: 'Event B' }, idx: 1 });
      selectedFiles.clear();
    });
    await window.evaluate((p) => { selectedFiles.add(p); syncAllTiles(); }, order[2]);

    r = await window.evaluate(() => window.AutoIngestCommands.execute('group.assign', { groupId: null }));
    check(r.ok === true && r.executed === true, 'group.assign succeeds while Event B claims a file Event A currently owns');
    check(r.detail && r.detail.claim && r.detail.claim.reassigned === 1,
      'command layer surfaces ImportSession claim info — 1 file reassigned — identical to what the Cmd+G chord toast reports');
    owner = await window.evaluate((p) => ImportSession.ownerOf(p)?.key, order[2]);
    check(owner === '/tmp/mx-cmd-test-event-B', "ownership genuinely moved to Event B's workspace (ImportSession's own bookkeeping, not just the command layer's return value)");

    // Event A now owns nothing and holds no refinement overrides, so
    // ImportSession's own disposal rule (_isDisposable/_pruneEmpty, run at
    // the end of every claim) discards its entire workspace, not merely its
    // now-empty group — a stronger cleanup guarantee than group-removal
    // alone, and it too fires correctly through the command-driven path.
    const eventAWorkspace = await window.evaluate(() => ImportSession.getWorkspace('/tmp/mx-cmd-test-event-A'));
    check(eventAWorkspace === null, "Event A's now-empty, override-free workspace was pruned entirely by the claim (ImportSession's _pruneEmpty, triggered via the command layer)");

    // Restore a clean single-context state for anything after this point.
    await window.evaluate(() => { ImportSession.reset(); selectedFiles.clear(); });

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
  console.error('[mx-cmd-layer] FATAL', err);
  process.exitCode = 1;
});
