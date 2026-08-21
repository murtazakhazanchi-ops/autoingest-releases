'use strict';

// Regression test for the "event sequence drift" production bug: repairing an
// unparseable event folder (e.g. "1448-01-26 _01M-Waaz-...", where the stray
// "M" right after the sequence digits breaks eventNameParser's PREFIX_RE)
// silently reassigned a FRESH "next sequence" number instead of preserving the
// event's real, already-persisted identity — corrupting both the renamed
// folder and its event.json. Two real archive events on the same Hijri date
// were observed both ending up at sequence 3 after one or both went through
// this repair path.
//
// Root cause (confirmed by direct code trace): renderer/eventCreator.js's
// _tryRepairEvent() (and the live-preview twin in _updateEventPreview())
// unconditionally called _computeNextSequence(hijriDate) — the function
// reserved for genuinely NEW events — even when repairing an EXISTING folder
// whose original sequence digits are still recoverable from its bad name.
//
// Fix: _extractOriginalSequence(folderName, expectedHijriDate) recovers the
// "_NN" digits immediately after the hijri date from the original (bad)
// folder name, regardless of what follows (so "_01M-..." still yields "01").
// _tryRepairEvent now prefers this recovered value over a freshly computed
// one; _computeNextSequence is reached ONLY when no sequence digits can be
// recovered at all (a genuinely new identity) or when the user deliberately
// changes the Hijri date during repair (a real resequence).
//
// TEST 1 — direct, source-drift-guarded unit test of _extractOriginalSequence,
//          extracted from the REAL renderer/eventCreator.js source (not a
//          hand-copied mirror) and evaluated against the exact folder-name
//          shapes from the bug report.
// TEST 2 — full Electron E2E: seed the exact "_01M-Waaz-..." unparseable
//          folder (sequence 1) alongside a normal, parseable "_02-QMZ-..."
//          event (sequence 2) on the same Hijri date — mirroring the bug
//          report's two-corrupted-events scenario — then drive the REAL
//          "Fix & Convert →" repair UI end-to-end and assert the repaired
//          event.json (and renamed folder) come out at sequence 1, not a
//          freshly computed 3.
// TEST 3 — the bug report's explicit regression fixture: two normally-named,
//          already-parseable events on the same Hijri date (_01 and _02) must
//          keep their sequences unchanged across repeated archive scans
//          (simulating reopening Event Management / app restart) — proving
//          scan/list/reload never mutates an existing event's identity.
//
// Run: node test/eventSequenceDriftRegression.test.js

const assert = require('node:assert/strict');
const fs = require('fs');
const { _electron: electron } = require('playwright-core');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

// This test must run against ITS OWN worktree's code, not a hardcoded main-repo
// path — fix branches live in isolated worktrees (see repo topology docs).
const PROJECT_ROOT = path.resolve(__dirname, '..');

let passed = 0;
function ok(name) { passed++; console.log(`  ok — ${name}`); }
function fail(name, detail) {
  process.exitCode = 1;
  console.error(`  FAIL — ${name}`);
  if (detail !== undefined) console.error(detail);
}

async function mkTmp(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeEventJsonFixture(dir, data) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'event.json'), JSON.stringify(data, null, 2), 'utf8');
}

// ── TEST 1: extract the REAL function from the shipped source and eval it ───
// so this test breaks if the fix is reverted or the function is renamed/moved,
// without hand-duplicating the logic (source-drift guarded, same convention
// as test/bug011SequenceTypeMismatch.test.js's TEST 1).
(function test1() {
  console.log('=== TEST 1: _extractOriginalSequence (real source, direct eval) ===');

  const src = fs.readFileSync(path.join(PROJECT_ROOT, 'renderer/eventCreator.js'), 'utf8');
  const m = /function _extractOriginalSequence\(folderName, expectedHijriDate\) \{[\s\S]*?\n  \}/.exec(src);
  if (!m) {
    fail('TEST 1: _extractOriginalSequence function found in renderer/eventCreator.js source', 'Function not found — was it renamed or removed?');
    return;
  }
  ok('TEST 1: _extractOriginalSequence found in source');

  // eslint-disable-next-line no-new-func
  const _extractOriginalSequence = new Function(`${m[0]}\nreturn _extractOriginalSequence;`)();

  // The exact Waaz record from the bug report: original source folder was
  // "_01M-..." (stray "M" breaks PREFIX_RE's "_NN-" requirement) — must
  // recover "01", not let the caller fall through to a freshly computed seq.
  assert.equal(
    _extractOriginalSequence('1448-01-26 _01M-Waaz Mubarak-Ziyafat-Bethak-Jumua-Zohr Asr Namaz-Adam Masjid-Bradford', '1448-01-26'),
    '01'
  );
  ok('TEST 1: recovers "01" from the real Waaz "_01M-..." folder name');

  // A folder unparseable for a different reason (e.g. unrecognized city token)
  // but with a clean "_NN-" prefix — digits still recoverable.
  assert.equal(
    _extractOriginalSequence('1448-01-26 _02-QMZ-Bethak-Manchester', '1448-01-26'),
    '02'
  );
  ok('TEST 1: recovers "02" from a clean-prefix-but-unparseable folder name');

  // Deliberate date change during repair (the user actually retypes the Hijri
  // date) must NOT reuse the old sequence — this really is a new identity for
  // that date, so the caller must fall back to _computeNextSequence.
  assert.equal(
    _extractOriginalSequence('1448-01-26 _01M-Waaz-...', '1448-02-01'),
    null
  );
  ok('TEST 1: returns null when the repaired Hijri date differs from the folder (forces fresh-sequence fallback)');

  // No recoverable digits at all (e.g. missing/garbled prefix) → null, caller
  // falls back to _computeNextSequence exactly as for a genuinely new event.
  assert.equal(_extractOriginalSequence('Some Random Legacy Folder', '1448-01-26'), null);
  ok('TEST 1: returns null for a folder name with no recoverable sequence digits');

  assert.equal(_extractOriginalSequence('', '1448-01-26'), null);
  assert.equal(_extractOriginalSequence(null, '1448-01-26'), null);
  ok('TEST 1: handles empty/null folder name without throwing');
})();

// Also assert the call site itself was actually fixed (guards against the
// helper existing but never being wired into the write path).
(function test1b() {
  console.log('=== TEST 1b: call-site wiring (source-drift guarded) ===');
  const src = fs.readFileSync(path.join(PROJECT_ROOT, 'renderer/eventCreator.js'), 'utf8');
  const hasFixedCallSite = /const seq\s*=\s*recoveredSeq \|\| _computeNextSequence\(_newEventDate\);/.test(src);
  if (hasFixedCallSite) ok('TEST 1b: _tryRepairEvent prefers recoveredSeq over a freshly computed sequence');
  else fail('TEST 1b: _tryRepairEvent prefers recoveredSeq over a freshly computed sequence', 'Expected call-site pattern not found — fix may have been reverted or refactored');
})();

// ── TEST 2 + 3: full Electron E2E against the real repair UI ────────────────
(async () => {
  console.log('=== TEST 2/3: live Electron repair flow + scan-stability regression ===');

  const userDataDir = await mkTmp('ai-e2e-seqdrift-userdata-');
  const archiveRoot = await mkTmp('ai-e2e-seqdrift-archive-');

  const collName = '1448-01-26 _UK Multi Event';
  const collDir  = path.join(archiveRoot, collName);

  // ── Fixture mirroring the bug report exactly: two events, same Hijri date.
  // Event A: unparseable due to the stray "M" (must repair to recover seq 1).
  // Deliberately NO event.json here — matches the real pre-repair archive
  // state (a fresh/legacy import that was never processed): the scanner only
  // routes a folder to the "needs repair" bucket (isParseable:false) when
  // event.json is absent/corrupt AND the folder name itself fails to parse
  // (main/main.js's master:scanEvents — see the branch at the "unparseable"
  // push). A folder with a valid event.json is ALWAYS isParseable:true
  // regardless of its name, so pre-seeding JSON here would never reach the
  // repair path this test exists to cover.
  const badWaazName = '1448-01-26 _01M-Waaz Mubarak-Ziyafat-Bethak-Jumua-Zohr Asr Namaz-Adam Masjid-Bradford';
  await fsp.mkdir(path.join(collDir, badWaazName), { recursive: true });

  // Event B: normally named, already parseable, sequence 2 — the "already
  // assigned" neighbor whose presence is what makes _computeNextSequence
  // return 3 for a naive repair of Event A.
  const qmzName = '1448-01-26 _02-QMZ-Bradford';
  await writeEventJsonFixture(path.join(collDir, qmzName), {
    version: 1, hijriDate: '1448-01-26', sequence: 2,
    eventName: qmzName, safeEventName: qmzName, status: 'created',
    components: [{ types: ['QMZ'], location: null, city: 'Bradford', country: 'United Kingdom', folderName: null }],
  });

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));

  let window = await electronApp.firstWindow({ timeout: 60000 });
  window.on('pageerror', err => console.log('[pageerror]', err.message, err.stack));
  await window.waitForLoadState('domcontentloaded');

  await window.waitForTimeout(1500);
  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));

  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'Repro Test Operator');
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
      await window.fill('#splashInputName', 'Repro Test Operator');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  }

  window = await mainWindowPromise;
  window.on('pageerror', err => console.log('[pageerror]', err.message, err.stack));
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(1500);

  await window.evaluate(async (root) => {
    await window.api.initArchiveRoot(root);
    await window.api.setNasRoot(root);
    await window.api.setMainArchiveRoot(root);
    await window.api.setArchiveRootSetting(root);
    EventCreator.setSessionArchiveRoot(root);
  }, archiveRoot);
  await window.waitForTimeout(300);

  // =============================================================================
  // TEST 3 — scan/reload stability: the two legitimate events must NEVER drift,
  // across repeated scans (simulating reopening Event Management / app restart).
  // =============================================================================
  const scan1 = await window.evaluate(async (masterPath) => window.api.scanMasterEvents(masterPath), collDir);
  const scan2 = await window.evaluate(async (masterPath) => window.api.scanMasterEvents(masterPath), collDir);
  const qmzEv1 = scan1?.events?.find(e => e.folderName === qmzName);
  const qmzEv2 = scan2?.events?.find(e => e.folderName === qmzName);
  if (qmzEv1 && qmzEv2) {
    if (String(qmzEv1.sequence) === '02' && String(qmzEv2.sequence) === '02') {
      ok('TEST 3: parseable event keeps sequence 02 across repeated scans (no scan-time mutation)');
    } else {
      fail('TEST 3: parseable event keeps sequence 02 across repeated scans', { scan1: qmzEv1.sequence, scan2: qmzEv2.sequence });
    }
  } else {
    fail('TEST 3: parseable event discovered on both scans', { found1: !!qmzEv1, found2: !!qmzEv2 });
  }
  // Confirm the un-repaired folder on disk is untouched by scanning alone.
  const dirsAfterScans = await fsp.readdir(collDir);
  if (dirsAfterScans.includes(badWaazName)) {
    ok('TEST 3: unparseable folder name is untouched by scanning alone (no silent rename)');
  } else {
    fail('TEST 3: unparseable folder name is untouched by scanning alone', dirsAfterScans);
  }

  // =============================================================================
  // TEST 2 — drive the real "Fix & Convert →" repair UI end-to-end.
  // =============================================================================
  await window.evaluate(() => { document.getElementById('heroSecondaryBtn')?.click() || document.getElementById('emmOpenBtn')?.click(); });
  const emmVisible = await window.evaluate(() => document.getElementById('eventMgmtModal')?.classList.contains('open'));
  if (!emmVisible) {
    await window.evaluate(() => { EventMgmt.open({ mode: 'select' }); EventCreator.start(); });
  }
  await window.waitForTimeout(500);

  await window.waitForSelector(`.ec-coll-card[data-name="${collName}"]`, { timeout: 10000 }).catch(() => {});
  await window.click(`.ec-coll-card[data-name="${collName}"]`).catch(() => {});
  await window.waitForTimeout(200);
  await window.click('#ecMasterContinue').catch(() => {});
  await window.waitForTimeout(800);

  // Playwright's attribute-value locator handles the raw string directly —
  // no need for the browser-only CSS.escape (which doesn't exist in this
  // Node-side Playwright API context).
  const repairBtnByAttr = window.locator(`.ec-evl-repair-btn[data-folder="${badWaazName}"]`);
  const repairBtnExists  = await repairBtnByAttr.count() > 0;
  if (!repairBtnExists) {
    const bodyHtml = await window.evaluate(() => document.getElementById('ecBody')?.innerHTML?.slice(0, 1500));
    fail('TEST 2: "Fix & Convert →" button present for the unparseable folder', bodyHtml);
  } else {
    ok('TEST 2: "Fix & Convert →" button present for the unparseable folder');

    await repairBtnByAttr.first().click();
    await window.waitForTimeout(400);

    // Registry-backed vocab — seed real entries so the repair form's
    // TreeAutocomplete has something genuine to find and select (same
    // convention as test/eventManagementReliabilityLive.test.js).
    await window.evaluate(() => window.api.keywordsAddKeyword({
      label: 'Waaz Mubarak', category: 'event', parentPath: ['Majlis'], parentId: 'event',
    }));
    await window.evaluate(() => window.api.keywordsAddKeyword({
      label: 'Bradford', category: 'city', parentPath: ['Bradford'], parentId: 'city',
    }));

    // Same Hijri date as the original folder — a deliberate date CHANGE is the
    // only case where re-sequencing is correct; this test proves the ordinary
    // "just fix the parse" repair preserves identity.
    await window.fill('#evHijriYear', '1448');
    await window.fill('#evHijriMonth', '01');
    await window.fill('#evHijriDay', '26');

    const etContainer = window.locator('[id^="ecET-"]').first();
    await etContainer.locator('input').click();
    await etContainer.locator('input').fill('Waaz Mubarak');
    await window.waitForSelector('.tac-item', { timeout: 5000 }).catch(() => {});
    await window.locator('.tac-item').first().click().catch(() => {});

    await window.locator('#ecGlobalCityDD input').click();
    await window.locator('#ecGlobalCityDD input').fill('Bradford');
    await window.waitForSelector('.tac-item', { timeout: 5000 }).catch(() => {});
    await window.locator('.tac-item').first().click().catch(() => {});
    await window.waitForTimeout(500);

    const repairBtnState = await window.evaluate(() => ({
      disabled: document.getElementById('emmRepairBtn')?.disabled,
      preview:  document.getElementById('ecEventPreviewName')?.textContent,
    }));
    console.log('  repair form state before submit:', JSON.stringify(repairBtnState));

    if (repairBtnState.disabled === false) {
      ok('TEST 2: repair form becomes valid/submittable once date + event type + city are filled');
      // The live preview must already show the RECOVERED sequence (01), never
      // a freshly computed 3 — proves the fix reaches the preview too.
      if (/_01-/.test(repairBtnState.preview || '')) {
        ok('TEST 2: live preview shows recovered sequence "_01-" before submit, not a freshly computed one');
      } else {
        fail('TEST 2: live preview shows recovered sequence "_01-" before submit', repairBtnState.preview);
      }

      await window.click('#emmRepairBtn');
      await window.waitForTimeout(1000);

      const dirsAfterRepair = await fsp.readdir(collDir);
      const repairedDir = dirsAfterRepair.find(n => n.startsWith('1448-01-26 _01-'));
      if (repairedDir) {
        ok(`TEST 2: repaired folder renamed with recovered sequence "_01-" (${repairedDir})`);
        const repairedJson = JSON.parse(await fsp.readFile(path.join(collDir, repairedDir, 'event.json'), 'utf8'));
        if (repairedJson.sequence === 1) {
          ok('TEST 2: repaired event.json persists sequence 1 (recovered), not a freshly computed 3');
        } else {
          fail('TEST 2: repaired event.json persists sequence 1 (recovered), not a freshly computed 3', repairedJson.sequence);
        }
      } else {
        fail('TEST 2: repaired folder renamed with recovered sequence "_01-"', dirsAfterRepair);
      }

      // The QMZ neighbor must be completely untouched by the repair of Event A.
      const qmzJsonAfter = JSON.parse(await fsp.readFile(path.join(collDir, qmzName, 'event.json'), 'utf8'));
      if (qmzJsonAfter.sequence === 2) {
        ok('TEST 2: unrelated neighbor event (QMZ, sequence 2) untouched by repairing Event A');
      } else {
        fail('TEST 2: unrelated neighbor event (QMZ, sequence 2) untouched by repairing Event A', qmzJsonAfter.sequence);
      }
    } else {
      fail('TEST 2: repair form becomes valid/submittable once date + event type + city are filled', repairBtnState);
    }
  }

  await electronApp.close().catch(() => {});
  console.log(process.exitCode ? `${process.exitCode ? 'SOME' : 'ALL'} CHECKS: see FAILs above` : `ALL ${passed} CHECKS PASSED`);
})().catch(err => {
  console.error('[seqdrift] FATAL:', err);
  process.exitCode = 1;
});
