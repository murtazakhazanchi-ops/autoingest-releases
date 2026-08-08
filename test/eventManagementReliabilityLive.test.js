'use strict';

// Live end-to-end verification of the three Event Management reliability bugs
// reported by the Windows/NAS tester, driving the REAL Electron app (not a
// service-level call) via Playwright's `_electron` API, against an isolated
// synthetic archive root. Never touches real data or real userData.
//
// Requires playwright-core (already installed in node_modules, see
// test/metadataPipelineLive.test.js for the original install note).
//
// Run: node test/eventManagementReliabilityLive.test.js
//
// Covers:
//   TEST A — a collection with a pre-existing, valid event.json-backed event is
//            discovered by Event Management ("Existing Events (1)"), proving the
//            master:scanEvents IPC round-trip and the renderer's consumption of
//            its new { ok, events } contract.
//   TEST B — a transient read failure (permission-denied on the collection folder)
//            is reported as ok:false with an errorReason, NOT collapsed into an
//            empty events array — and once the permission is restored, a retry
//            recovers the real list.
//   TEST C — creating a new event through the real UI makes it appear in the
//            "Existing Events" list immediately after closing and reopening Event
//            Management for the same collection (the _scannedEvents cache
//            invalidation fix).
//   TEST D — the Create Event primary action (#emmCreateBtn, the real docked
//            modal-footer button — not the superseded inline #ecEventContinue)
//            is visible while the form is on screen, whether or not it is
//            currently valid, including on the specific navigation path that
//            used to leave the footer mode stuck on 'master' (switch collections
//            after having already scanned a different collection's event list).

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = '/Users/funun_pa/Projects/_Auto-Ingest-Software/electron-app-v24';

function log(...args) { console.log('[e2e]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeEventJsonFixture(dir, data) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'event.json'), JSON.stringify(data, null, 2), 'utf8');
}

(async () => {
  const userDataDir = await mkTmp('ai-e2e-emm-userdata-');
  const archiveRoot = await mkTmp('ai-e2e-emm-archive-');

  log('userDataDir =', userDataDir);
  log('archiveRoot =', archiveRoot);

  // ── Synthetic fixture: a collection with ONE pre-existing, valid event ──────
  const collName = '1448-01-11 _UK Safar';
  const collDir  = path.join(archiveRoot, collName);
  const evName   = '1448-01-11 _01-Waaz Mubarak-Adam Masjid-Bradford';
  const evDir    = path.join(collDir, evName);
  await writeEventJsonFixture(evDir, {
    version: 1, hijriDate: '1448-01-11', sequence: 1, eventName: 'Waaz Mubarak',
    components: [{ location: 'Adam Masjid', city: 'Bradford', country: 'United Kingdom', types: ['Waaz Mubarak'], folderName: null }],
  });

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));
  electronApp.on('close', () => log('electronApp CLOSED unexpectedly'));

  let window = await electronApp.firstWindow({ timeout: 60000 });
  window.on('console', msg => { if (msg.type() === 'error') log('[console.error]', msg.text()); });
  window.on('pageerror', err => log('[pageerror]', err.message, err.stack));
  await window.waitForLoadState('domcontentloaded');
  log('window loaded, title =', await window.title().catch(() => '(no title)'));

  // ── Splash / operator login (same handling as metadataPipelineLive.test.js) ──
  await window.waitForTimeout(1500);
  const splashState = await window.evaluate(() => {
    const vis = (id) => {
      const el = document.getElementById(id);
      return el && el.style.display !== 'none';
    };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));
  log('splash state:', JSON.stringify(splashState));

  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'E2E Test Operator');
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
      await window.fill('#splashInputName', 'E2E Test Operator');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  } else {
    log('WARNING: no recognizable splash panel visible — continuing anyway');
  }

  window = await mainWindowPromise;
  window.on('console', msg => { if (msg.type() === 'error') log('[console.error]', msg.text()); });
  window.on('pageerror', err => log('[pageerror]', err.message, err.stack));
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);

  // ── Configure archive root (marker + Active Archive Root + Main Archive Root, ──
  // mirroring the tester's "Working Root = Main Archive Root" setup) via real IPC.
  const initRes = await window.evaluate(async (root) => window.api.initArchiveRoot(root), archiveRoot);
  log('initArchiveRoot:', JSON.stringify(initRes));
  check(initRes?.ok === true, 'archive-root marker initialized');

  const dbg = await window.evaluate(() => ({
    readyState: document.readyState,
    hasEcBody: !!document.getElementById('ecBody'),
    typeofEventCreator: typeof window.EventCreator,
    typeofEventCreatorBare: (() => { try { return typeof EventCreator; } catch (e) { return 'THROWS:' + e.message; } })(),
    typeofEventMgmt: (() => { try { return typeof EventMgmt; } catch (e) { return 'THROWS:' + e.message; } })(),
    typeofPathUtils: typeof window.PathUtils,
    bodyClass: document.body.className,
    scripts: [...document.scripts].map(s => s.src.split('/').pop()),
  }));
  log('DEBUG pre-EventCreator state:', JSON.stringify(dbg, null, 2));

  await window.evaluate(async (root) => {
    await window.api.setNasRoot(root);
    await window.api.setMainArchiveRoot(root);
    await window.api.setArchiveRootSetting(root);
    EventCreator.setSessionArchiveRoot(root);
  }, archiveRoot);
  await window.waitForTimeout(300);

  // =============================================================================
  // TEST A: pre-existing collection + event discovery via the real IPC handler
  // =============================================================================
  log('=== TEST A: existing event discovery ===');
  const scanA = await window.evaluate(async (masterPath) => window.api.scanMasterEvents(masterPath), collDir);
  log('scanMasterEvents (fixture present):', JSON.stringify({ ok: scanA?.ok, count: scanA?.events?.length }));
  check(scanA?.ok === true, 'Test A: scan reports ok:true for a readable collection');
  check(Array.isArray(scanA?.events) && scanA.events.length === 1, 'Test A: exactly 1 resolved event found');
  check(scanA?.events?.[0]?.folderName === evName, 'Test A: discovered event folder name matches the fixture');

  // =============================================================================
  // TEST B: a transient read failure must NOT collapse into "zero events"
  // =============================================================================
  log('=== TEST B: transient read failure vs genuine empty ===');
  await fsp.chmod(collDir, 0o000);
  let scanB;
  try {
    scanB = await window.evaluate(async (masterPath) => window.api.scanMasterEvents(masterPath), collDir);
  } finally {
    await fsp.chmod(collDir, 0o755); // always restore, even if the assertion below throws
  }
  log('scanMasterEvents (permission-denied):', JSON.stringify(scanB));
  // Root running the test harness may bypass permission checks (e.g. CI as root) —
  // only assert the invariant when the OS actually enforced the denial.
  if (scanB?.ok === false) {
    check(Array.isArray(scanB.events) && scanB.events.length === 0, 'Test B: failed scan still returns an events array (shape-stable)');
    check(!!scanB.errorReason, 'Test B: failed scan carries a non-empty errorReason, distinguishing it from a genuine empty collection');
  } else {
    log('SKIP — permission denial not enforced for this OS/user (likely running as root); invariant not exercised');
  }

  const scanBRecovered = await window.evaluate(async (masterPath) => window.api.scanMasterEvents(masterPath), collDir);
  check(scanBRecovered?.ok === true && scanBRecovered.events.length === 1, 'Test B: scan recovers the real event list once the read succeeds again');

  // =============================================================================
  // TEST C + D: drive the real Event Management UI
  // =============================================================================
  log('=== TEST C/D: real Event Management UI — discovery, creation, footer ===');

  await window.evaluate(() => { document.getElementById('heroSecondaryBtn')?.click() || document.getElementById('emmOpenBtn')?.click(); });
  // Fall back to the documented public entry point if no obvious button exists.
  const emmVisible = await window.evaluate(() => document.getElementById('eventMgmtModal')?.classList.contains('open'));
  if (!emmVisible) {
    await window.evaluate(() => { EventMgmt.open({ mode: 'select' }); EventCreator.start(); });
  }
  await window.waitForTimeout(500);
  check(await window.evaluate(() => document.getElementById('eventMgmtModal')?.classList.contains('open')), 'Event Management modal opened');

  // Select the pre-existing collection card from Step 1.
  await window.waitForSelector(`.ec-coll-card[data-name="${collName}"]`, { timeout: 10000 }).catch(() => {});
  const cardExists = await window.evaluate((name) =>
    !!document.querySelector(`.ec-coll-card[data-name="${CSS.escape(name)}"]`), collName);
  check(cardExists, 'Test C: pre-existing collection card is listed in Step 1 (not forced into Create Collection)');
  if (cardExists) {
    await window.click(`.ec-coll-card[data-name="${collName}"]`);
    await window.waitForTimeout(200);
    await window.click('#ecMasterContinue');
  } else {
    // Diagnostic dump so a failure here is debuggable without re-running.
    const bodyHtml = await window.evaluate(() => document.getElementById('ecBody')?.innerHTML?.slice(0, 800));
    log('Step 1 body (no card found):', bodyHtml);
  }
  await window.waitForTimeout(800);

  // Should land on the event LIST (not the create form) with the fixture event visible.
  const listState1 = await window.evaluate(() => ({
    navScreen: EventCreator.getNavScreen?.(),
    evlItems:  document.querySelectorAll('.ec-evl-item[data-folder]').length,
    countText: document.querySelector('.ec-tab-panel[data-panel="current-device"] .ec-section-title')?.textContent || null,
  }));
  log('list state after selecting existing collection:', JSON.stringify(listState1));
  check(listState1.evlItems === 1, 'Test C: existing event appears in the Event Management list via the real UI');

  // ── Create a NEW event through the real form ────────────────────────────────
  await window.click('#ecNewEventFromList');
  await window.waitForTimeout(300);

  // Bug 3 check #1 — footer state immediately on entering the (empty, invalid) form.
  const footer1 = await window.evaluate(() => ({
    mode:          EventMgmt.getMode(),
    createDisplay: getComputedStyle(document.getElementById('emmCreateBtn')).display,
    createDisabled: document.getElementById('emmCreateBtn')?.disabled,
  }));
  log('footer state on fresh Create Event form:', JSON.stringify(footer1));
  check(footer1.mode === 'create', 'Test D: footer mode is "create" on entering the new-event form');
  check(footer1.createDisplay !== 'none', 'Test D: #emmCreateBtn is visible (not display:none) on an empty/invalid form');
  check(footer1.createDisabled === true, 'Test D: #emmCreateBtn is disabled (not missing) while the form is invalid');

  // event-types/locations/cities are REGISTRY-backed lists (_REG_LIST_CATEGORY in
  // main.js) — a brand-new synthetic userData dir has no registry entries yet, so
  // the static seed JSON in data/*.json is not what search matches against. Seed
  // real registry entries via the same IPC the "+ Add" flow uses, so the real
  // TreeAutocomplete search+select UI has something genuine to find and click.
  const seedET = await window.evaluate(() => window.api.keywordsAddKeyword({
    label: 'Waaz Mubarak', category: 'event', parentPath: ['Majlis'], parentId: 'event',
  }));
  const seedCity = await window.evaluate(() => window.api.keywordsAddKeyword({
    label: 'Bradford', category: 'city', parentPath: ['Bradford'], parentId: 'city',
  }));
  log('seeded registry entries:', JSON.stringify({ seedET, seedCity }));
  check(seedET?.ok === true, 'registry seed: event-type "Waaz Mubarak" added');
  check(seedCity?.ok === true, 'registry seed: city "Bradford" added');

  // Fill the form: Hijri date, one component's Event Type + City via the real
  // TreeAutocomplete widgets (type text, click the first suggestion).
  await window.fill('#evHijriYear', '1448');
  await window.fill('#evHijriMonth', '01');
  await window.fill('#evHijriDay', '26');

  const etContainer = window.locator('[id^="ecET-"]').first();
  await etContainer.locator('input').click();
  await etContainer.locator('input').fill('Waaz Mubarak');
  await window.waitForSelector('.tac-item', { timeout: 5000 });
  await window.locator('.tac-item').first().click();

  await window.locator('#ecGlobalCityDD input').click();
  await window.locator('#ecGlobalCityDD input').fill('Bradford');
  await window.waitForSelector('.tac-item', { timeout: 5000 });
  await window.locator('.tac-item').first().click();
  await window.waitForTimeout(500);

  const previewName = await window.evaluate(() => document.getElementById('ecEventPreviewName')?.textContent);
  log('folder preview after filling form:', previewName);

  const footer2 = await window.evaluate(() => ({
    mode:           EventMgmt.getMode(),
    createDisplay:  getComputedStyle(document.getElementById('emmCreateBtn')).display,
    createDisabled: document.getElementById('emmCreateBtn')?.disabled,
  }));
  log('footer state after filling form:', JSON.stringify(footer2));
  check(footer2.createDisplay !== 'none', 'Test D: #emmCreateBtn stays visible once the form is filled');
  check(footer2.createDisabled === false, 'Test D: #emmCreateBtn becomes enabled once the form is valid (city resolved: ' + (previewName && previewName !== '—') + ')');

  if (footer2.createDisabled === false) {
    await window.click('#emmCreateBtn');
    await window.waitForTimeout(1000);
    const evJsonExists = await fsp.access(path.join(collDir, (await fsp.readdir(collDir)).find(n => n.startsWith('1448-01-26')) || '__missing__', 'event.json'))
      .then(() => true).catch(() => false);
    check(evJsonExists, 'Test C: new event.json was written to the archive by the real create flow');

    // Reopen Event Management for the SAME collection and confirm the new event appears
    // immediately (proves the _scannedEvents cache-invalidation fix from _tryCreateEvent).
    const stillOpen = await window.evaluate(() => document.getElementById('eventMgmtModal')?.classList.contains('open'));
    if (!stillOpen) {
      await window.evaluate(() => { EventMgmt.open({ mode: 'select' }); EventCreator.start(); });
      await window.waitForTimeout(500);
    }
    await window.click(`.ec-coll-card[data-name="${collName}"]`).catch(() => {});
    await window.waitForTimeout(200);
    await window.click('#ecMasterContinue').catch(() => {});
    await window.waitForTimeout(800);
    const listState2 = await window.evaluate(() => document.querySelectorAll('.ec-evl-item[data-folder]').length);
    log('event count after reopening for the same collection:', listState2);
    check(listState2 === 2, 'Test C: newly created event appears immediately on reopening Event Management (1 pre-existing + 1 new)');
  } else {
    log('SKIP create/reopen check — form did not reach a valid state (see footer2 above); city dropdown selector likely needs adjustment for this build');
  }

  // =============================================================================
  // TEST E: the specific stale-footer-mode repro for Bug 3's root cause —
  // showEventStep() can reach _renderEventForm() directly (skipping the event
  // list, where EventMgmt.setMode('select') is normally set) whenever
  // _scannedEvents/_eventComps are still populated from a PRIOR visit to a
  // different collection this session. Before the fix, this left the footer
  // mode stuck on 'master' (set when Step 1 rendered) and #emmCreateBtn hidden.
  // =============================================================================
  log('=== TEST E: footer stays correct after switching collections mid-session ===');

  // We're currently on Collection A's event list (has 1 pre-existing + 1 new event).
  // Go back to Step 1 and create a brand-new second collection.
  await window.click('#ecChangeCollection').catch(async () => {
    // Fall back if the modal auto-closed after Test C/D's create flow.
    await window.evaluate(() => { EventMgmt.open({ mode: 'select' }); EventCreator.start(); });
  });
  await window.waitForTimeout(500);

  // The "New Collection" form starts collapsed whenever existing collections are
  // present (buildMasterHTML(): formOpen = !hasExisting) — expand it first.
  const newFormOpen = await window.evaluate(() => document.getElementById('ecNewForm')?.classList.contains('open'));
  if (!newFormOpen) await window.click('#ecNewToggle');
  await window.waitForTimeout(300);

  await window.fill('#hijriYear', '1448');
  await window.fill('#hijriMonth', '02');
  await window.fill('#hijriDay', '01');
  await window.fill('#collLabel', 'Second Collection E2E');
  await window.waitForTimeout(300);
  await window.click('#ecMasterContinue');
  await window.waitForTimeout(800);

  const stateB = await window.evaluate(() => ({
    navScreen:      EventCreator.getNavScreen?.(),
    mode:           EventMgmt.getMode(),
    createDisplay:  getComputedStyle(document.getElementById('emmCreateBtn')).display,
    backOnlyFooter: (() => {
      const visible = ['emmEditBtn', 'emmSeqFoldersBtn', 'emmContinueBtn', 'emmCreateBtn', 'emmSaveBtn', 'emmRepairBtn']
        .map(id => document.getElementById(id))
        .filter(b => b && getComputedStyle(b).display !== 'none');
      return visible.length === 0;
    })(),
  }));
  log('state on entering a brand-new second collection:', JSON.stringify(stateB));
  check(!stateB.backOnlyFooter, 'Test E: footer is not stuck showing only "← Back" when switching to a new collection after a prior collection was scanned this session');
  if (stateB.navScreen === 'eventForm') {
    check(stateB.mode === 'create' && stateB.createDisplay !== 'none',
      'Test E: landing directly on the create form for a fresh collection still shows a correctly-moded, visible primary action');
  } else {
    check(stateB.mode === 'select', 'Test E: landing on the event list for the new (empty) collection sets mode to "select" correctly');
  }

  // =============================================================================
  // Summary
  // =============================================================================
  await electronApp.close().catch(() => {});
  log(failures === 0 ? `ALL CHECKS PASSED` : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(err => {
  console.error('[e2e] FATAL:', err);
  process.exit(1);
});
