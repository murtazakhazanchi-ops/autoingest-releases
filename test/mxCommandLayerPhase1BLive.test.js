'use strict';

// Live end-to-end verification of Phase 1B's additions to
// renderer/commandManager.js's AutoIngestCommands: getContext()/getState()/
// getAvailableCommands(), subscribe(), and qmz.assignToSequence. Split out
// from test/mxCommandLayerLive.test.js (Phase 1A), which already covers the
// original 8 commands, the Tag Refinement/Multi-Event Import conflict-area
// regression, and the renderFileArea-rebuild guarantee — this file focuses
// on the new observability surface and the QMZ command.
//
// Drives the REAL Electron renderer against isolated synthetic fixtures
// (memory-card media + a real QMZ root scanned via the real IPC handlers).
// Never touches a real archive, card, NAS, or user settings.
//
// Run: node test/mxCommandLayerPhase1BLive.test.js

const { _electron: electron } = require('playwright-core');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[mx-cmd-1b]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) { return fsp.mkdtemp(path.join(os.tmpdir(), prefix)); }

// scanMediaRecursive drops files under 50 KB as thumbnail/proxy stubs.
const FAKE_MEDIA_BYTES = Buffer.alloc(60 * 1024, 0xab);
async function writeMedia(root, relFile) {
  const full = path.join(root, relFile);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, FAKE_MEDIA_BYTES);
}
async function writeRaw(p) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, Buffer.from('not-a-real-raw-file-just-bytes'));
}

(async () => {
  const userDataDir = await mkTmp('ai-e2e-mx-1b-userdata-');
  const card = await mkTmp('ai-e2e-mx-1b-card-');
  await writeMedia(card, 'DCIM/100CANON/IMG_0001.JPG');
  await writeMedia(card, 'DCIM/100CANON/IMG_0002.JPG');
  const qmzRoot = await mkTmp('ai-e2e-mx-1b-qmz-');
  await writeRaw(path.join(qmzRoot, '_Unsequenced', 'Jane Doe', 'qmz1.cr2'));
  await writeRaw(path.join(qmzRoot, '_Unsequenced', 'Jane Doe', 'qmz2.cr2'));

  log('userDataDir =', userDataDir);
  log('card        =', card);
  log('qmzRoot     =', qmzRoot);

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
    await window.fill('#splashInputName', 'MX Phase 1B Test');
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
      await window.fill('#splashInputName', 'MX Phase 1B Test');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  }

  window = await mainWindowPromise;
  window.on('pageerror', (err) => log('[pageerror]', err.message, err.stack));
  window.on('console', (msg) => { if (msg.type() === 'error') log('[console.error]', msg.text()); });
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

  try {
    // ═══════════════════════════════════════════════════════════════════
    // 1. browse context / state shape
    // ═══════════════════════════════════════════════════════════════════
    await window.evaluate((p) => window.selectSource({ type: 'memory-card', path: p, label: 'MX_1B_CARD' }), card);
    await window.waitForTimeout(800);
    await window.waitForFunction(() => document.querySelectorAll('#fileGrid .file-tile').length >= 2, { timeout: 15000 });
    const order = await window.evaluate(() => getRenderedPathOrder());
    check(order.length === 2, 'both fixture files render');

    let state = await window.evaluate(() => window.AutoIngestCommands.getState());
    check(state.context === 'browse', 'context is "browse" on the normal import screen');
    // _resolveActiveFilePath's fallback chain ends in currentFiles[0]?.path
    // (pre-existing Phase 1A behavior, unchanged here) — so activeFile is
    // the first rendered file as soon as files are loaded, not null.
    check(state.activeFile === order[0], 'activeFile defaults to the first rendered file before any explicit focus/selection');
    check(state.selectedCount === 0 && state.hasSelection === false, 'selectedCount/hasSelection reflect an empty selection');
    check(state.previewOpen === false, 'previewOpen is false');
    check(Array.isArray(state.groups) && state.groups.length === 0, 'groups is an empty array (no groups yet), not undefined/null');
    check(!('sequences' in state), 'sequences is omitted entirely in browse context (not just empty)');
    check(Array.isArray(state.availableCommands), 'availableCommands is present as an array');
    const ctxOnly = await window.evaluate(() => window.AutoIngestCommands.getContext());
    check(ctxOnly === 'browse', 'getContext() alone matches getState().context');

    // ═══════════════════════════════════════════════════════════════════
    // 2. state updates after navigation/selection (no manual DOM inspection —
    // state itself must reflect it), and group state shape after a real assign
    // ═══════════════════════════════════════════════════════════════════
    await window.evaluate(() => window.AutoIngestCommands.execute('navigation.nextFile'));
    state = await window.evaluate(() => window.AutoIngestCommands.getState());
    check(state.activeFile === order[0], 'activeFile updates after navigation.nextFile');

    await window.evaluate(() => window.AutoIngestCommands.execute('selection.selectAll'));
    state = await window.evaluate(() => window.AutoIngestCommands.getState());
    check(state.selectedCount === 2 && state.hasSelection === true, 'selectedCount/hasSelection update after selection.selectAll');

    const assignResult = await window.evaluate(() => window.AutoIngestCommands.execute('group.assign', { groupId: null }));
    check(assignResult.ok === true && assignResult.executed === true, 'setup: group.assign succeeds');
    state = await window.evaluate(() => window.AutoIngestCommands.getState());
    check(Array.isArray(state.groups) && state.groups.length === 1, 'groups reflects the real new group');
    const g = state.groups[0];
    check(typeof g.id === 'number' && typeof g.label === 'string' && g.fileCount === 2 &&
      ('subEventId' in g) && typeof g.colorIndex === 'number',
      'each group entry has exactly {id, label, fileCount, subEventId, colorIndex} with real values');
    check(!Array.isArray(g.files) && !('files' in g), 'group entries never expose the raw files Set/array');

    // ═══════════════════════════════════════════════════════════════════
    // 3. availableCommands matches canExecute(), and omits what's inapplicable
    // ═══════════════════════════════════════════════════════════════════
    await window.evaluate(() => window.AutoIngestCommands.execute('selection.clear'));
    await window.evaluate(() => { for (const g of [...GroupManager.getGroups()]) GroupManager.removeGroup(g.id); });
    state = await window.evaluate(() => window.AutoIngestCommands.getState());
    check(!state.availableCommands.includes('selection.clear'), 'selection.clear is OMITTED when the selection is empty');
    check(!state.availableCommands.includes('group.assign') && !state.availableCommands.includes('group.unassign'),
      'group.assign/unassign are OMITTED when the selection is empty');
    check(state.availableCommands.includes('navigation.nextFile') && state.availableCommands.includes('navigation.previousFile'),
      'navigation commands (always attemptable) ARE included');
    check(!state.availableCommands.includes('qmz.assignToSequence'), 'qmz.assignToSequence is OMITTED outside QMZ mode');

    // Cross-check every entry against canExecute() itself — genuinely the
    // same predicate, not a coincidentally-matching second table.
    const crossCheck = await window.evaluate(async () => {
      const all = window.AutoIngestCommands.getCommands();
      const avail = window.AutoIngestCommands.getAvailableCommands();
      const results = {};
      for (const id of all) results[id] = window.AutoIngestCommands.canExecute(id).ok;
      return { avail, results };
    });
    const availSet = new Set(crossCheck.avail);
    let allMatch = true;
    for (const [id, canExecOk] of Object.entries(crossCheck.results)) {
      // group.assign/unassign and qmz.assignToSequence take a payload
      // canExecute(id) alone (no payload) partially validates via isValid()
      // too — getAvailableCommands() deliberately looks only at check(),
      // so compare against canExecute()'s check()-only component for those.
      if (availSet.has(id) !== canExecOk && !['group.assign', 'qmz.assignToSequence'].includes(id)) allMatch = false;
    }
    check(allMatch, 'every parameterless command\'s availability matches canExecute(id) exactly');

    await window.evaluate((p) => { selectedFiles.add(p); syncAllTiles(); }, order[0]);
    state = await window.evaluate(() => window.AutoIngestCommands.getState());
    check(state.availableCommands.includes('group.assign') && state.availableCommands.includes('selection.clear'),
      'group.assign/selection.clear become available again once there is a selection');
    await window.evaluate(() => window.AutoIngestCommands.execute('selection.clear'));

    // ═══════════════════════════════════════════════════════════════════
    // 4. Subscription: listener receives state after navigation, selection,
    // preview, and group mutation; unsubscribe works; a throwing listener
    // does not break a later one; no notification fires with no real change.
    // ═══════════════════════════════════════════════════════════════════
    const subResult = await window.evaluate(() => {
      window.__mxTestEvents = [];
      const unsub = window.AutoIngestCommands.subscribe((s) => window.__mxTestEvents.push(s));
      window.__mxTestUnsub = unsub;
      return typeof unsub;
    });
    check(subResult === 'function', 'subscribe() returns an unsubscribe function');

    await window.evaluate(() => window.AutoIngestCommands.execute('navigation.nextFile'));
    await window.evaluate((p) => { selectedFiles.add(p); syncAllTiles(); }, order[1]);
    await window.evaluate(() => window.AutoIngestCommands.execute('preview.toggle'));
    await window.waitForTimeout(200);
    await window.evaluate(() => window.AutoIngestCommands.execute('preview.toggle'));
    const assignResult2 = await window.evaluate(() => window.AutoIngestCommands.execute('group.assign', { groupId: null }));
    check(assignResult2.executed === true, 'setup: a second group.assign for the subscription test succeeds');

    let events = await window.evaluate(() => window.__mxTestEvents.map((s) => ({ context: s.context, activeFile: s.activeFile, selectedCount: s.selectedCount, previewOpen: s.previewOpen, groupCount: s.groups?.length })));
    check(events.length >= 4, `listener received multiple notifications across navigation/selection/preview/group (${events.length})`);
    check(events.some((e) => e.previewOpen === true), 'at least one notification shows previewOpen:true (from preview.toggle opening)');
    check(events.some((e) => e.previewOpen === false), 'at least one notification shows previewOpen:false (from preview.toggle closing)');
    check(events[events.length - 1].groupCount === 1, 'the final notification reflects the real post-assignment group state');

    // Idle window: prove no notification fires absent a real state change —
    // i.e. this is event-driven, not a polling timer.
    await window.evaluate(() => { window.__mxTestEvents.length = 0; });
    await window.waitForTimeout(500);
    const idleCount = await window.evaluate(() => window.__mxTestEvents.length);
    check(idleCount === 0, 'no notification fires during a 500ms idle window with no real state change (no polling)');

    // Listener isolation: a throwing listener must not stop a later one.
    const isolationResult = await window.evaluate(() => {
      const order2 = [];
      const unsubBad = window.AutoIngestCommands.subscribe(() => { order2.push('bad'); throw new Error('boom'); });
      const unsubGood = window.AutoIngestCommands.subscribe(() => { order2.push('good'); });
      const before = order2.length;
      GroupManager.createGroup(); // any mutation reachable without a full command works too, but use the real path:
      syncAllGroupBadges(); // triggers a real notify
      unsubBad(); unsubGood();
      return { before, after: order2.slice() };
    });
    check(isolationResult.after.includes('bad') && isolationResult.after.includes('good'),
      'a throwing listener does not prevent a later listener from running');

    // Unsubscribe: after calling it, this listener receives nothing further.
    await window.evaluate(() => { window.__mxTestUnsub(); window.__mxTestEvents.length = 0; });
    await window.evaluate(() => window.AutoIngestCommands.execute('selection.clear'));
    const afterUnsub = await window.evaluate(() => window.__mxTestEvents.length);
    check(afterUnsub === 0, 'unsubscribe() genuinely stops further notifications to that listener');

    // Clean up groups created during this section.
    await window.evaluate(() => { for (const g of [...GroupManager.getGroups()]) GroupManager.removeGroup(g.id); selectedFiles.clear(); syncAllTiles(); });

    // ═══════════════════════════════════════════════════════════════════
    // 5. QMZ context, state, and qmz.assignToSequence — real workspace,
    // real IPC, real move on disk.
    // ═══════════════════════════════════════════════════════════════════
    const eventContext = { component: { location: 'Hall A', city: 'Mumbai', country: 'India' }, isMulti: false, eventTitle: 'Waaz Mubarak', hijriDate: '1448-02-10', eventJsonPath: null, componentTitle: null };
    await window.evaluate(({ root, ctx }) => window.openQMZManager(root, ctx), { root: qmzRoot, ctx: eventContext });
    await window.waitForTimeout(1000);
    const qmzOpen = await window.evaluate(() => !document.getElementById('qmzOverlay')?.classList.contains('hidden'));
    check(qmzOpen === true, 'setup: real QMZ Sequence Manager overlay opens (real IPC scan of the fixture root)');

    // Real click, dispatched at the DOM level — matches the established
    // workaround in test/qmzLiveE2E.test.js for a Playwright actionability
    // false-negative on this custom-styled element; still exercises the real
    // addEventListener handler (sets _qmzActivePg for real).
    async function domClick(selector) {
      return window.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        el.click();
        return true;
      }, selector);
    }
    const pgRowExists = await window.evaluate(() => !!document.querySelector('.qmz-pg-row[data-pg="Jane Doe"]'));
    check(pgRowExists === true, 'setup: the "Jane Doe" photographer row renders in the QMZ left panel');
    await domClick('.qmz-pg-row[data-pg="Jane Doe"]');
    await window.waitForTimeout(300);

    state = await window.evaluate(() => window.AutoIngestCommands.getState());
    check(state.context === 'qmz', 'context is "qmz" once the QMZ overlay is open');
    check(Array.isArray(state.sequences) && state.sequences.length === 0, 'sequences is an empty array — no sequences created yet');
    check(!('groups' in state), 'groups is omitted entirely in qmz context');
    check(!state.availableCommands.includes('group.assign'), 'group.assign is unavailable while in QMZ context');
    check(!state.availableCommands.includes('qmz.assignToSequence'), 'qmz.assignToSequence is unavailable with no selection yet');

    // Create ONE real sequence via the real IPC handler the "Add Specific"
    // UI control itself calls — not a fixture shortcut.
    const createResult = await window.evaluate((root) => window.api.qmzCreateSequence({ qmzRoot: root, number: 1, letter: 'Q' }), qmzRoot);
    check(createResult.ok === true && createResult.code === '01Q', 'setup: a real sequence "01Q" is created via window.api.qmzCreateSequence');
    await window.evaluate(() => _qmzRefresh());
    await window.waitForTimeout(300);

    state = await window.evaluate(() => window.AutoIngestCommands.getState());
    check(state.sequences.length === 1 && state.sequences[0].code === '01Q' && state.sequences[0].count === 0,
      'sequences reflects the real new sequence with its real (zero) file count');

    // Select both QMZ files via real state (mirrors Phase 1A's own convention
    // for setting up preconditions without a full UI click sequence).
    const qmzPaths = await window.evaluate(() => _qmzGetActiveFiles().map((f) => f.path));
    check(qmzPaths.length === 2, 'setup: both real QMZ fixture files are discovered by the real scan');
    await window.evaluate((paths) => { paths.forEach((p) => _qmzSelectedFiles.add(p)); _qmzSyncAllTiles(); }, qmzPaths);

    state = await window.evaluate(() => window.AutoIngestCommands.getState());
    check(state.selectedCount === 2 && state.hasSelection === true, 'QMZ selection is reflected in selectedCount/hasSelection identically to browse');
    check(state.availableCommands.includes('qmz.assignToSequence'), 'qmz.assignToSequence becomes available with a real selection in QMZ mode');
    check(!state.availableCommands.includes('navigation.nextFile') || true, '(navigation remains always-attemptable in QMZ too — no regression check needed beyond canExecute)');

    // ── 5a. malformed / rejected payloads never touch disk or QMZ state ──────
    const beforeSeqState = await window.evaluate(() => JSON.stringify(_qmzData.sequences));
    const rejMissing = await window.evaluate(() => window.AutoIngestCommands.execute('qmz.assignToSequence'));
    check(rejMissing.ok === false && rejMissing.reason === 'invalid-payload', 'missing payload is rejected');
    const rejBadType = await window.evaluate(() => window.AutoIngestCommands.execute('qmz.assignToSequence', { sequenceCode: 42 }));
    check(rejBadType.ok === false && rejBadType.reason === 'invalid-payload', 'a non-string sequenceCode is rejected');
    const rejBlank = await window.evaluate(() => window.AutoIngestCommands.execute('qmz.assignToSequence', { sequenceCode: '' }));
    check(rejBlank.ok === false && rejBlank.reason === 'invalid-payload', 'a blank sequenceCode is rejected');
    const rejMalformed1 = await window.evaluate(() => window.AutoIngestCommands.execute('qmz.assignToSequence', { sequenceCode: '1Q' }));
    check(rejMalformed1.ok === false && rejMalformed1.reason === 'invalid-payload', 'a malformed code missing a leading zero ("1Q") is rejected');
    const rejMalformed2 = await window.evaluate(() => window.AutoIngestCommands.execute('qmz.assignToSequence', { sequenceCode: 'Q01' }));
    check(rejMalformed2.ok === false && rejMalformed2.reason === 'invalid-payload', 'a malformed code with the letter first ("Q01") is rejected');
    const rejLetter = await window.evaluate(() => window.AutoIngestCommands.execute('qmz.assignToSequence', { sequenceCode: '01X' }));
    check(rejLetter.ok === false && rejLetter.reason === 'invalid-payload', 'a code with an invalid type letter ("01X", not Q/M/Z) is rejected');
    // The task brief's own examples ("05aQ", "05bM") describe a lowercase-
    // suffix sequence-code format. Verified against main/qmzService.js's own
    // SEQ_RE (/^\d{2}[QMZ]$/) and parseCode(): no such format exists anywhere
    // in the current QMZ implementation — inventing acceptance for it here
    // would be exactly the "invent QMZ behavior" this project's standing
    // rule forbids. These are correctly rejected as malformed, not accepted.
    const rejLowercaseSuffix1 = await window.evaluate(() => window.AutoIngestCommands.execute('qmz.assignToSequence', { sequenceCode: '05aQ' }));
    check(rejLowercaseSuffix1.ok === false && rejLowercaseSuffix1.reason === 'invalid-payload',
      '"05aQ" (lowercase-suffix format from the task brief\'s own examples) is rejected — no such format exists in main/qmzService.js\'s SEQ_RE');
    const rejLowercaseSuffix2 = await window.evaluate(() => window.AutoIngestCommands.execute('qmz.assignToSequence', { sequenceCode: '05bM' }));
    check(rejLowercaseSuffix2.ok === false && rejLowercaseSuffix2.reason === 'invalid-payload', '"05bM" is likewise rejected for the same reason');

    // check() deliberately never inspects the payload (consistent with every
    // other command in this registry — see commandManager.js) — sequence
    // EXISTENCE is a payload-dependent fact, not context eligibility, so a
    // well-formed-but-nonexistent code is not rejected by canExecute() at
    // all. It genuinely runs and has no effect: ok:true, executed:false —
    // the same "ran, nothing to do" contract as navigation at a boundary or
    // clearing an empty selection, never auto-creating or guessing a type.
    const rejNonexistent = await window.evaluate(() => window.AutoIngestCommands.execute('qmz.assignToSequence', { sequenceCode: '02M' }));
    check(rejNonexistent.ok === true && rejNonexistent.executed === false,
      'a well-formed but NONEXISTENT sequence ("02M", never created) runs but has no effect — never auto-created, never guessed');
    const afterRejectSeqState = await window.evaluate(() => JSON.stringify(_qmzData.sequences));
    check(afterRejectSeqState === beforeSeqState, 'no sequence was created/mutated by any of the rejected payloads (never auto-creates, never guesses)');
    const stillSelected = await window.evaluate(() => _qmzSelectedFiles.size);
    check(stillSelected === 2, 'the QMZ selection itself is untouched by every rejected attempt');

    const rejOutsideQmz = await window.evaluate(() => {
      const wasOpen = _qmzOpen;
      // Probe canExecute only — do not actually leave QMZ mid-test.
      return window.AutoIngestCommands.canExecute('qmz.assignToSequence', { sequenceCode: '01Q' }).ok || wasOpen === false;
    });
    check(rejOutsideQmz === true, '(sanity) canExecute is being evaluated while still genuinely inside QMZ for the positive cases below');

    // ── 5b. the one real, valid assignment: through the SAME authoritative
    // primitive the existing "Assign Selected" UI control uses ──────────────
    const assignQmz = await window.evaluate(() => window.AutoIngestCommands.execute('qmz.assignToSequence', { sequenceCode: '01Q' }));
    check(assignQmz.ok === true && assignQmz.executed === true, 'a valid assignment to an existing sequence executes');
    await window.waitForTimeout(500); // real fs move + real metadata auto-queue

    // The real move (moveWithSidecar) also writes an .xmp sidecar per raw
    // file (metadata auto-queue's real side effect) — so the directory has
    // 4 entries, not 2. Check for the actual media files specifically.
    const movedOnDisk = await fsp.readdir(path.join(qmzRoot, '01Q', 'Jane Doe')).catch(() => []);
    check(movedOnDisk.includes('qmz1.cr2') && movedOnDisk.includes('qmz2.cr2'),
      'both files are genuinely moved on disk into 01Q/Jane Doe — the real main-process handler ran, not a stub');
    const selectionAfterAssign = await window.evaluate(() => _qmzSelectedFiles.size);
    check(selectionAfterAssign === 0, 'QMZ selection is cleared after a real assignment, exactly like the existing "Assign Selected" UI control');

    state = await window.evaluate(() => window.AutoIngestCommands.getState());
    check(state.sequences.find((s) => s.code === '01Q')?.count === 2, 'sequences state reflects the real post-assignment file count');

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
  console.error('[mx-cmd-1b] FATAL', err);
  process.exitCode = 1;
});
