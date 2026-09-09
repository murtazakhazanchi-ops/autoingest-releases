'use strict';

// Live end-to-end verification of the consecutive-city-run naming fix,
// driving the REAL Electron app (not a service-level call) via
// playwright-core's `_electron` API, against an isolated synthetic archive
// root — same convention as test/eventManagementReliabilityLive.test.js.
// Never touches real data or real userData.
//
// Reproduces the real reported bug pattern (Mandvi, Mundra, Mundra, Mundra)
// through the actual multi-step EventCreator UI and confirms:
//   - the live preview name (#ecEventPreviewName)
//   - the actual folder written to disk
//   - event.json's eventName / safeEventName / components[].folderName
//   - the event re-appearing correctly in the Event Management list on reopen
// all agree, and match the corrected consecutive-run expectation, not the
// old buggy per-component-city output.
//
// Also runs the "all same city" case through the same real flow, to prove
// the fix does not regress the case that already worked correctly.
//
// Run: node test/eventNamingConsecutiveCityRunLive.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = __dirname.replace(/\/test$/, '');

function log(...args) { console.log('[e2e-naming]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}

async function mkTmp(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

// Adds a new component via the real "+ Add Component" button and returns
// the newly-created component's id (read from the DOM, since _compSeq is a
// module-private running counter, never assume a specific numeric value).
async function addComponent(window) {
  const before = await window.evaluate(() => [...document.querySelectorAll('.ec-comp-row')].map((el) => el.dataset.compId));
  await window.click('#ecAddComp');
  await window.waitForTimeout(200);
  const after = await window.evaluate(() => [...document.querySelectorAll('.ec-comp-row')].map((el) => el.dataset.compId));
  const newId = after.find((id) => !before.includes(id));
  if (!newId) throw new Error('addComponent: no new .ec-comp-row appeared');
  return newId;
}

// Fills one component's Event Type via its real TreeAutocomplete widget.
// Each TreeAutocomplete instance renders its own .tac-dd/.tac-item DROPDOWN
// NESTED INSIDE its own container (see renderer/treeAutocomplete.js's
// constructor: `this._wrap.append(row, this._dd); container.append(this._wrap)`)
// -- so a page-global `.tac-item` query can ambiguously match a PRIOR
// widget's now-hidden-but-still-present dropdown. Always scope to the
// specific container's own locator.
async function fillEventType(window, compId, typeLabel) {
  const container = window.locator(`#ecET-${compId}`);
  await container.locator('input').click();
  await container.locator('input').fill(typeLabel);
  await container.locator('.tac-item').first().waitFor({ state: 'visible', timeout: 5000 });
  await container.locator('.tac-item').first().click();
  await window.waitForTimeout(150);
}

// Fills one component's OWN City field directly (overriding whatever it
// may have inherited from the Global City default), via its own
// TreeAutocomplete widget at #ecCity-${compId}.
async function fillCity(window, compId, cityLabel) {
  const container = window.locator(`#ecCity-${compId}`);
  await container.locator('input').click();
  await container.locator('input').fill(cityLabel);
  await container.locator('.tac-item').first().waitFor({ state: 'visible', timeout: 5000 });
  await container.locator('.tac-item').first().click();
  await window.waitForTimeout(150);
}

// Sets the Global City dropdown -- per eventCreator.js's own onSelect
// handler, this only fills components that don't already have a city, and
// becomes the default for components created AFTER this call.
async function setGlobalCity(window, cityLabel) {
  const container = window.locator('#ecGlobalCityDD');
  await container.locator('input').click();
  await container.locator('input').fill(cityLabel);
  await container.locator('.tac-item').first().waitFor({ state: 'visible', timeout: 5000 });
  await container.locator('.tac-item').first().click();
  await window.waitForTimeout(150);
}

async function seedRegistry(window, { types, cities }) {
  for (const label of types) {
    const r = await window.evaluate((l) => window.api.keywordsAddKeyword({ label: l, category: 'event', parentPath: ['Majlis'], parentId: 'event' }), label);
    check(r?.ok === true, `registry seed: event-type "${label}" added`);
  }
  for (const label of cities) {
    const r = await window.evaluate((l) => window.api.keywordsAddKeyword({ label: l, category: 'city', parentPath: [l], parentId: 'city' }), label);
    check(r?.ok === true, `registry seed: city "${label}" added`);
  }
}

(async () => {
  const userDataDir = await mkTmp('ai-e2e-naming-userdata-');
  const archiveRoot = await mkTmp('ai-e2e-naming-archive-');
  log('userDataDir =', userDataDir);
  log('archiveRoot =', archiveRoot);

  // Fixture collection so Step 1 has a card to select (mirrors the
  // established eventManagementReliabilityLive.test.js convention) — a
  // minimal placeholder event, distinct Hijri date from the two events this
  // test itself creates.
  const collName = '1448-05-01 _City Run Naming Fix E2E';
  const collDir  = path.join(archiveRoot, collName);
  const placeholderDir = path.join(collDir, '1448-05-01 _01-Placeholder-Nowhere');
  await fsp.mkdir(placeholderDir, { recursive: true });
  await fsp.writeFile(path.join(placeholderDir, 'event.json'), JSON.stringify({
    version: 1, hijriDate: '1448-05-01', sequence: 1, eventName: 'Placeholder',
    components: [{ location: null, city: 'Nowhere', country: null, types: ['Placeholder'], folderName: null }],
  }, null, 2), 'utf8');

  const electronApp = await electron.launch({
    args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`, '--no-sandbox'],
    cwd: PROJECT_ROOT,
    timeout: 60000,
  });
  electronApp.process().stdout.on('data', (d) => process.stdout.write('[main-stdout] ' + d));
  electronApp.process().stderr.on('data', (d) => process.stdout.write('[main-stderr] ' + d));
  electronApp.on('close', () => log('electronApp CLOSED unexpectedly'));

  let window = await electronApp.firstWindow({ timeout: 60000 });
  window.on('pageerror', (err) => log('[pageerror]', err.message));
  await window.waitForLoadState('domcontentloaded');
  log('window loaded, title =', await window.title().catch(() => '(no title)'));

  // ── Splash / operator login (same handling as the established live tests) ──
  await window.waitForTimeout(1500);
  const splashState = await window.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  }).catch(() => ({}));
  log('splash state:', JSON.stringify(splashState));

  const mainWindowPromise = electronApp.waitForEvent('window', { timeout: 30000 });
  if (splashState.create) {
    await window.fill('#splashInputName', 'E2E Naming Test');
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
      await window.fill('#splashInputName', 'E2E Naming Test');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splashState.welcome) {
    await window.click('#splashContinueBtn');
  } else {
    log('WARNING: no recognizable splash panel visible — continuing anyway');
  }

  window = await mainWindowPromise;
  window.on('pageerror', (err) => log('[pageerror]', err.message));
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);

  const initRes = await window.evaluate(async (root) => window.api.initArchiveRoot(root), archiveRoot);
  check(initRes?.ok === true, 'archive-root marker initialized');
  await window.evaluate(async (root) => {
    await window.api.setNasRoot(root);
    await window.api.setMainArchiveRoot(root);
    await window.api.setArchiveRootSetting(root);
    EventCreator.setSessionArchiveRoot(root);
  }, archiveRoot);
  await window.waitForTimeout(300);

  await seedRegistry(window, {
    types: ['Ziyarat', 'QMZ', 'Muaina'],
    cities: ['Mandvi', 'Mundra', 'Surat'],
  });

  async function openEventCreatorForCollection() {
    await window.evaluate(() => { document.getElementById('heroSecondaryBtn')?.click() || document.getElementById('emmOpenBtn')?.click(); });
    const emmVisible = await window.evaluate(() => document.getElementById('eventMgmtModal')?.classList.contains('open'));
    if (!emmVisible) await window.evaluate(() => { EventMgmt.open({ mode: 'select' }); EventCreator.start(); });
    await window.waitForTimeout(500);
    await window.waitForSelector(`.ec-coll-card[data-name="${collName}"]`, { timeout: 10000 });
    await window.click(`.ec-coll-card[data-name="${collName}"]`);
    await window.waitForTimeout(200);
    await window.click('#ecMasterContinue');
    await window.waitForTimeout(800);
    await window.click('#ecNewEventFromList');
    await window.waitForTimeout(300);
  }

  // =============================================================================
  // SCENARIO 1 — the real reported bug pattern: Mandvi, Mundra, Mundra, Mundra
  // =============================================================================
  log('=== SCENARIO 1: Mandvi -> Mundra -> Mundra -> Mundra (the real reported case) ===');
  await openEventCreatorForCollection();

  await window.fill('#evHijriYear', '1448');
  await window.fill('#evHijriMonth', '05');
  await window.fill('#evHijriDay', '02');

  // Component 1: Ziyarat, city Mandvi (set via Global City -- fills comp 1 since it has no city yet).
  const comp1 = await window.evaluate(() => document.querySelector('.ec-comp-row').dataset.compId);
  await fillEventType(window, comp1, 'Ziyarat');
  await setGlobalCity(window, 'Mandvi');

  // Components 2-4 each get their OWN city set explicitly (not relying on
  // repeated Global City changes taking effect for "future" components --
  // more robust and mirrors how an operator building a mixed-city event
  // would actually work: fill each component's own City field directly).
  const comp2 = await addComponent(window);
  await fillEventType(window, comp2, 'QMZ');
  await fillCity(window, comp2, 'Mundra');

  const comp3 = await addComponent(window);
  await fillEventType(window, comp3, 'Ziyarat');
  await fillCity(window, comp3, 'Mundra');

  const comp4 = await addComponent(window);
  await fillEventType(window, comp4, 'Muaina');
  await fillCity(window, comp4, 'Mundra');

  await window.waitForTimeout(500);

  const preview1 = await window.evaluate(() => document.getElementById('ecEventPreviewName')?.textContent);
  log('SCENARIO 1 live preview:', preview1);
  check(!!preview1 && preview1 !== '—', 'Scenario 1: preview resolved to a non-empty name');
  check((preview1.match(/Mundra/g) || []).length === 1, 'Scenario 1 preview: "Mundra" appears exactly once (the real reported bug produced it 3 times)');
  check(preview1.includes('Mandvi') && preview1.endsWith('Mundra'), 'Scenario 1 preview: Mandvi appears once, Mundra ends the name once');

  const createDisabled1 = await window.evaluate(() => document.getElementById('emmCreateBtn')?.disabled);
  check(createDisabled1 === false, 'Scenario 1: Create button is enabled (form valid)');

  let scenario1FolderName = null;
  let scenario1Json = null;
  if (createDisabled1 === false) {
    await window.click('#emmCreateBtn');
    await window.waitForTimeout(1000);
    const entries = await fsp.readdir(collDir).catch(() => []);
    scenario1FolderName = entries.find((n) => n.startsWith('1448-05-02'));
    check(!!scenario1FolderName, 'Scenario 1: a new event folder starting with 1448-05-02 was created on disk');
    if (scenario1FolderName) {
      log('SCENARIO 1 actual folder name:', scenario1FolderName);
      check((scenario1FolderName.match(/Mundra/g) || []).length === 1, 'Scenario 1 folder name: "Mundra" appears exactly once on disk');
      const jsonPath = path.join(collDir, scenario1FolderName, 'event.json');
      scenario1Json = JSON.parse(await fsp.readFile(jsonPath, 'utf8').catch(() => 'null'));
      check(!!scenario1Json, 'Scenario 1: event.json is readable');
      if (scenario1Json) {
        check(scenario1Json.eventName === scenario1FolderName, 'Scenario 1: event.json.eventName matches the actual folder name');
        check((scenario1Json.eventName.match(/Mundra/g) || []).length === 1, 'Scenario 1: event.json.eventName has "Mundra" exactly once');
        const comps = scenario1Json.components || [];
        check(comps.length === 4, 'Scenario 1: event.json has 4 components');
        check(comps[0]?.city === 'Mandvi' && comps[1]?.city === 'Mundra' && comps[2]?.city === 'Mundra' && comps[3]?.city === 'Mundra',
          'Scenario 1: component city values are Mandvi, Mundra, Mundra, Mundra as entered');
        const subFolderMundraCounts = comps.map((c) => (c.folderName.match(/Mundra/g) || []).length);
        check(subFolderMundraCounts[0] === 0 && subFolderMundraCounts[1] === 0 && subFolderMundraCounts[2] === 0 && subFolderMundraCounts[3] === 1,
          `Scenario 1: sub-folder names only carry the city on the LAST component of the run (got city-mention-counts ${JSON.stringify(subFolderMundraCounts)} for comps 1-4)`);
        log('SCENARIO 1 component folderNames:', JSON.stringify(comps.map((c) => c.folderName)));
      }
    }
  }

  // Reopen Event Management for the same collection and confirm the new
  // event is listed with the SAME corrected name (dashboard/list display
  // agrees with what was actually written).
  if (scenario1FolderName) {
    const stillOpen = await window.evaluate(() => document.getElementById('eventMgmtModal')?.classList.contains('open'));
    if (!stillOpen) await window.evaluate(() => { EventMgmt.open({ mode: 'select' }); EventCreator.start(); });
    await window.waitForTimeout(500);
    await window.click(`.ec-coll-card[data-name="${collName}"]`).catch(() => {});
    await window.waitForTimeout(200);
    await window.click('#ecMasterContinue').catch(() => {});
    await window.waitForTimeout(800);
    const listedName = await window.evaluate((folder) => {
      const row = document.querySelector(`.ec-evl-item[data-folder="${CSS.escape(folder)}"]`);
      return row ? row.textContent : null;
    }, scenario1FolderName);
    log('SCENARIO 1 list display after reopening:', listedName);
    check(!!listedName && listedName.includes('Mundra') && (listedName.match(/Mundra/g) || []).length === 1,
      'Scenario 1: Event Management list display (after reopening) shows the same corrected name, "Mundra" once');
  }

  // Reset modal state fully before Scenario 2 -- the reopen-check above may
  // have left Event Management on the event-LIST step (not Step 1), which
  // has no .ec-coll-card to select.
  await window.evaluate(() => { try { EventMgmt.close(); } catch {} });
  await window.waitForTimeout(300);

  // =============================================================================
  // SCENARIO 2 — all-same-city contrast case: Surat, Surat, Surat (must still work)
  // =============================================================================
  log('=== SCENARIO 2: Surat -> Surat -> Surat (all-same-city, must remain correct) ===');
  await openEventCreatorForCollection();

  await window.fill('#evHijriYear', '1448');
  await window.fill('#evHijriMonth', '05');
  await window.fill('#evHijriDay', '03');

  const s2comp1 = await window.evaluate(() => document.querySelector('.ec-comp-row').dataset.compId);
  await fillEventType(window, s2comp1, 'Ziyarat');
  await setGlobalCity(window, 'Surat');

  const s2comp2 = await addComponent(window);
  await fillEventType(window, s2comp2, 'QMZ');
  const s2comp3 = await addComponent(window);
  await fillEventType(window, s2comp3, 'Muaina');

  await window.waitForTimeout(500);
  const preview2 = await window.evaluate(() => document.getElementById('ecEventPreviewName')?.textContent);
  log('SCENARIO 2 live preview:', preview2);
  check((preview2.match(/Surat/g) || []).length === 1, 'Scenario 2 preview: "Surat" appears exactly once, at the end');
  check(preview2.endsWith('Surat'), 'Scenario 2 preview: ends with Surat');

  const createDisabled2 = await window.evaluate(() => document.getElementById('emmCreateBtn')?.disabled);
  if (createDisabled2 === false) {
    await window.click('#emmCreateBtn');
    await window.waitForTimeout(1000);
    const entries = await fsp.readdir(collDir).catch(() => []);
    const scenario2FolderName = entries.find((n) => n.startsWith('1448-05-03'));
    check(!!scenario2FolderName, 'Scenario 2: a new event folder starting with 1448-05-03 was created on disk');
    if (scenario2FolderName) {
      log('SCENARIO 2 actual folder name:', scenario2FolderName);
      check((scenario2FolderName.match(/Surat/g) || []).length === 1, 'Scenario 2 folder name: "Surat" appears exactly once (all-same-city case unaffected by the fix)');
      const jsonPath = path.join(collDir, scenario2FolderName, 'event.json');
      const scenario2Json = JSON.parse(await fsp.readFile(jsonPath, 'utf8').catch(() => 'null'));
      if (scenario2Json) {
        const comps = scenario2Json.components || [];
        const subFolderCityCounts = comps.map((c) => (c.folderName.match(/Surat/g) || []).length);
        check(subFolderCityCounts[0] === 0 && subFolderCityCounts[1] === 0 && subFolderCityCounts[2] === 1,
          `Scenario 2: sub-folder city only on the last component (got ${JSON.stringify(subFolderCityCounts)})`);
      }
    }
  }

  await electronApp.close();
  log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch((err) => {
  console.error('[e2e-naming] FATAL:', err);
  process.exitCode = 1;
});
