'use strict';

// D2 — Keyword Registry / Event-Type autocomplete integrity: real-Electron UI regression.
//
// Before this fix, window.api.matchList('event-types', 'Majlis') and window.api.getLists
// ('event-types')/('locations') returned FLATTENED top-level category labels (e.g.
// "04 Majlis", "06 Qadam/Majlis/Ziyafat", "Jamrat") as ordinary selectable entries —
// indistinguishable from real leaves — whenever the registry had no coverage for a
// category (which is every category today: data/keywords.registry.json ships with
// keywords: [] by design, populated only by the separate, unexercised Metadata Sync
// feature). A normal operator, via ordinary mouse click OR keyboard ArrowDown+Enter,
// could select a category header and have it become the Event Type / Location / folder
// name / real written XMP metadata for an archived event — proven end-to-end during the
// D2 forensic pass.
//
// Fixed via services/legacyKeywordFallback.js (collectLegacyLeaves / pruneLegacyTree),
// wired into main/main.js's _registryListData / _registryMatch. This test drives the
// REAL Electron app end-to-end: real IPC (lists:get / lists:match), the real create-
// event form's TreeAutocomplete widgets (mouse AND keyboard), a real archive import,
// and real ExifTool readback of the written sidecar — not inference from event.json.
//
// SYNTHETIC ONLY (temp userData / archive / source). Run: node test/keywordRegistryLegacyFallbackLive.test.js

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
function log(...args) { console.log('[keyword-registry-legacy-fallback]', ...args); }
let failures = 0;
function check(cond, msg) { if (cond) log('PASS —', msg); else { failures++; log('FAIL —', msg); } }
const mkTmp = (prefix) => fsp.mkdtemp(path.join(os.tmpdir(), prefix));

// The real 14 top-level category labels + known real leaves, read directly from the
// checked-in data files — never hardcoded independently of the actual data shape.
const EVENT_TYPES = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'event-types.json'), 'utf8'));
const LOCATIONS    = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'data', 'locations.json'), 'utf8'));
const EVENT_TYPE_CATEGORY_LABELS = EVENT_TYPES.map(c => c.label);
const LOCATION_PARENT_LABELS = LOCATIONS.filter(l => Array.isArray(l.children) && l.children.length).map(l => l.label);

(async () => {
  const userDataDir = await mkTmp('ai-d2-userdata-');
  const archiveRoot = await mkTmp('ai-d2-archive-');
  const collName = 'D2LiveColl';

  const app = await electron.launch({ args: [PROJECT_ROOT, '--user-data-dir=' + userDataDir, '--no-sandbox'], cwd: PROJECT_ROOT, timeout: 60000 });
  let window = await app.firstWindow({ timeout: 60000 });
  await window.waitForTimeout(1500);
  const splash = await window.evaluate(() => {
    const vis = id => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  });
  const mainWindowPromise = app.waitForEvent('window', { timeout: 30000 });
  if (splash.create) { await window.fill('#splashInputName', 'D2 Live Operator'); await window.fill('#splashInputRole', 'QA'); await window.click('#splashCreateStartBtn'); }
  else if (splash.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else { await window.click('#splashNewProfileBtn'); await window.fill('#splashInputName', 'D2 Live Operator'); await window.fill('#splashInputRole', 'QA'); await window.click('#splashCreateStartBtn'); }
  } else if (splash.welcome) { await window.click('#splashContinueBtn'); }
  window = await mainWindowPromise;
  const pageErrors = [];
  window.on('pageerror', err => { pageErrors.push(err.message); log('[pageerror]', err.message); });
  window.on('dialog', (d) => { d.accept().catch(() => {}); });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2000);
  await window.waitForFunction(() => typeof window.selectSource === 'function', { timeout: 15000 });
  await window.evaluate(async (root) => window.api.setMainArchiveRoot(root), archiveRoot);
  await window.evaluate(() => window.api.addToList('photographers', 'Jane Doe'));
  await window.evaluate(() => { if (typeof obFinish === 'function') obFinish(); });
  await window.waitForTimeout(300);
  const ev = (fn, arg) => window.evaluate(fn, arg);

  // ═════════════════════════════════════════════════════════════════════════════
  // PART 1 — service level (IPC): empty registry, both event-types and locations
  // ═════════════════════════════════════════════════════════════════════════════
  {
    const matches = await ev(() => window.api.matchList('event-types', 'Majlis'));
    const matchLabels = matches.map(m => m.label);
    check(matches.length > 0, `search "Majlis" returns results (${matches.length})`);
    for (const cat of EVENT_TYPE_CATEGORY_LABELS) {
      check(!matchLabels.includes(cat), `search results never include category header "${cat}"`);
    }
    check(matchLabels.includes('Majlis'), 'search results include the real leaf "Majlis"');
    check(matches.every(m => !EVENT_TYPE_CATEGORY_LABELS.includes(m.label)), 'every returned match is a real leaf, not a category header');
  }
  {
    const tree = await ev(() => window.api.getLists('event-types'));
    check(Array.isArray(tree) && tree.length > 0, 'browse tree for event-types is non-empty with an empty registry');
    for (const node of tree) {
      check(Array.isArray(node.children) && node.children.length > 0, `top-level browse node "${node.label}" remains a real category with children (never collapsed to a bare leaf)`);
    }
  }
  {
    const locMatches = await ev(() => window.api.matchList('locations', 'Jamrat'));
    const locLabels = locMatches.map(m => m.label);
    check(!locLabels.includes('Jamrat'), 'location search never returns the "Jamrat" category header itself');
    const jamratChildren = await ev(() => window.api.matchList('locations', 'Al-Jamrah'));
    check(jamratChildren.map(m => m.label).includes('Al-Jamrah al-Kubra'), 'a real child of "Jamrat" ("Al-Jamrah al-Kubra") is reachable via search');
  }
  {
    const locTree = await ev(() => window.api.getLists('locations'));
    const topLabels = locTree.map(n => n.label);
    for (const parent of LOCATION_PARENT_LABELS) {
      const node = locTree.find(n => n.label === parent);
      check(!!node && Array.isArray(node.children) && node.children.length > 0, `location "${parent}" remains a real category with children in the browse tree`);
    }
    const pureLeafCount = locTree.filter(n => !n.children).length;
    check(pureLeafCount === 450, `450 pure-leaf locations pass through unaffected (found ${pureLeafCount})`);
  }

  // Seed a synthetic registry entry NOW, before the create form is opened for the first
  // time. The Additional Keywords widget (renderer/eventCreator.js's own _getRegistry())
  // caches the registry for the page's lifetime, invalidated only by its OWN "Add New
  // Keyword" modal flow — not by an external registry write such as this one. That
  // caching is pre-existing, untouched by this fix, and out of scope to change; seeding
  // here (before any create-form mount ever calls _getRegistry()) is what lets every part
  // below — including Additional Keywords in PART 7 — observe it consistently.
  // Two path segments (a group + the leaf) — a single-segment parentPath produces a bare
  // TOP-LEVEL registry leaf, which is a separate, pre-existing edge case in
  // renderer/treeAutocomplete.js's _renderEventsTree (every top-level tree entry is
  // unconditionally rendered as an expandable category header, regardless of whether it
  // has children) — untouched by this fix and out of scope here. A normal two-level path
  // (what the real "Add New Keyword" modal always produces, since it requires picking a
  // parent category first) avoids that unrelated edge case entirely.
  const seedRes = await ev(() => window.api.keywordsAddKeyword({ label: 'Registry Test Leaf', category: 'event', parentPath: ['Registry Test Group', 'Registry Test Subgroup'], parentId: 'event' }));
  check(seedRes?.ok === true, `seeded a synthetic registry entry ("Registry Test Leaf") before any create-form mount`);

  // ═════════════════════════════════════════════════════════════════════════════
  // PART 2 — real create-event form: mouse selection of a real leaf, category
  // headers never appear as selectable search results
  // ═════════════════════════════════════════════════════════════════════════════
  const dirSeed = path.join(archiveRoot, collName, '1448-01-01 _01-Seed');
  await ev(async ({ dir, data }) => window.api.writeEventJson(dir, data), {
    dir: dirSeed, data: { version: 1, hijriDate: '1448-01-01', sequence: 1, eventName: 'Seed', components: [
      { id: 1, folderName: 'Seed-Hall', location: 'Hall', city: 'Surat', country: 'India', types: ['Ziyarat'], additionalKeywords: [] },
    ] },
  });
  await ev(async ({ collPath, collName, folder }) => {
    await window.api.setLastEvent({ collectionPath: collPath, collectionName: collName, eventName: folder, safeEventName: folder });
    await EventCreator.restoreLastEvent();
  }, { collPath: path.join(archiveRoot, collName), collName, folder: path.basename(dirSeed) });
  await window.waitForTimeout(500);

  const srcRoot = await mkTmp('ai-d2-src-');
  await fsp.mkdir(path.join(srcRoot, 'sub'), { recursive: true });
  await fsp.writeFile(path.join(srcRoot, 'sub', 'dummy.txt'), 'x');
  await ev(a => selectSource(a), { type: 'local-folder', path: srcRoot, label: 'D2_SRC' });
  await window.waitForFunction(() => document.getElementById('workspace').classList.contains('visible'), null, { timeout: 15000 });
  await window.waitForTimeout(300);

  async function openCreateForm() {
    await window.click('#ctxChangeEventBtn');
    await window.waitForFunction(() => EventMgmt.isOpen(), null, { timeout: 5000 });
    await window.waitForSelector('#ecNewEventFromList', { timeout: 15000 });
    await window.click('#ecNewEventFromList');
    await window.waitForSelector('#evHijriYear', { timeout: 10000 });
  }
  async function closeCreateForm() {
    await window.click('#emmBackBtn').catch(() => {});
    await window.waitForTimeout(300);
    await window.click('#emmBackBtn').catch(() => {});
    await window.waitForFunction(() => !EventMgmt.isOpen(), null, { timeout: 8000 }).catch(() => {});
  }

  await openCreateForm();
  await window.fill('#evHijriYear', '1448'); await window.fill('#evHijriMonth', '02'); await window.fill('#evHijriDay', '02');
  const compId = await ev(() => document.querySelector('.ec-comp-row')?.dataset.compId || null);
  check(!!compId, 'reached the real component / Event Type picker in the create form');

  const etInput = window.locator(`#ecET-${compId} input`);
  await etInput.click(); await etInput.fill('Majlis');
  await window.waitForTimeout(400);
  const etSuggestions = await ev((cid) => [...document.getElementById(`ecET-${cid}`).querySelectorAll('.tac-item')].map(el => el.textContent.trim()), compId);
  check(etSuggestions.length > 0, `real Event Type widget shows suggestions for "Majlis" (${JSON.stringify(etSuggestions)})`);
  for (const cat of EVENT_TYPE_CATEGORY_LABELS) {
    check(!etSuggestions.includes(cat), `real widget never shows category header "${cat}" as a suggestion`);
  }

  await window.click(`#ecET-${compId} .tac-item:first-child`);
  await window.waitForTimeout(200);
  const chosenAfterMouse = await ev((cid) => EventCreator.getEventComps().find(c => String(c.id) === String(cid))?.eventTypes?.map(t => t.label), compId);
  check(Array.isArray(chosenAfterMouse) && chosenAfterMouse.length === 1 && !EVENT_TYPE_CATEGORY_LABELS.includes(chosenAfterMouse[0]),
    `mouse-click selection committed a real leaf, not a category header: ${JSON.stringify(chosenAfterMouse)}`);

  // ═════════════════════════════════════════════════════════════════════════════
  // PART 3 — keyboard-only selection (ArrowDown + Enter) also commits a real leaf
  // ═════════════════════════════════════════════════════════════════════════════
  await ev((cid) => { const c = EventCreator.getEventComps().find(x => String(x.id) === String(cid)); if (c) c.eventTypes = []; }, compId).catch(() => {});
  // (component-level clear may not persist through encapsulation — the widget itself is
  // re-driven fresh below regardless, so any residual prior selection does not affect
  // this assertion: we read the LATEST committed value only.)
  const etInput2 = window.locator(`#ecET-${compId} input`);
  await etInput2.click(); await etInput2.fill(''); await etInput2.fill('Majlis');
  await window.waitForTimeout(400);
  await etInput2.press('ArrowDown');
  await window.waitForTimeout(100);
  const activeText = await ev((cid) => document.querySelector(`#ecET-${cid} .tac-active`)?.textContent.trim() || null, compId);
  check(!!activeText && !EVENT_TYPE_CATEGORY_LABELS.includes(activeText), `keyboard ArrowDown highlights a real leaf, not a category header ("${activeText}")`);
  await etInput2.press('Enter');
  await window.waitForTimeout(200);
  const chosenAfterKeyboard = await ev((cid) => EventCreator.getEventComps().find(c => String(c.id) === String(cid))?.eventTypes?.map(t => t.label), compId);
  check(Array.isArray(chosenAfterKeyboard) && chosenAfterKeyboard.length >= 1 && chosenAfterKeyboard.every(l => !EVENT_TYPE_CATEGORY_LABELS.includes(l)),
    `keyboard ArrowDown+Enter committed a real leaf: ${JSON.stringify(chosenAfterKeyboard)}`);
  // Restore the component to a single Event Type via the real chip-remove control (rather
  // than mutating internal state directly) so later parts back out of a clean, single-select
  // form — matching how a real operator would use this widget, and avoiding an unrelated
  // "2+ Event Types, no refinement" resolver ambiguity from leaking into later assertions.
  if (chosenAfterKeyboard.length > 1) {
    await window.click(`.ec-chip-x[data-comp="${compId}"][data-idx="1"]`);
    await window.waitForTimeout(150);
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // PART 4 — browse mode: category headers are expand-only via mouse, and are
  // structurally excluded from keyboard nav (the pre-existing widget behavior this
  // fix preserves — verified live here, not merely by reading the source)
  // ═════════════════════════════════════════════════════════════════════════════
  // The input already had focus from the prior keyboard Enter, so a plain .click() fires
  // no new 'focus' event (the widget opens on focus) — force a real blur+refocus cycle,
  // exactly what happens when an operator tabs away and back or clicks elsewhere first.
  await etInput2.evaluate(el => el.blur());
  await window.waitForTimeout(100);
  await etInput2.click(); await etInput2.fill('');
  await window.waitForTimeout(300);
  const browseHeaders = await ev((cid) => [...document.getElementById(`ecET-${cid}`).querySelectorAll('.tac-cat-hdr')].length, compId);
  check(browseHeaders > 0, `browse (empty-input) mode shows ${browseHeaders} real category headers`);
  const navExcludesHeaders = await ev((cid) => {
    const dd = document.getElementById(`ecET-${cid}`);
    const nav = [...dd.querySelectorAll('.tac-item, .tac-leaf, .tac-add')];
    return nav.every(el => !el.classList.contains('tac-cat-hdr') && !el.classList.contains('tac-ev-hdr'));
  }, compId);
  check(navExcludesHeaders, 'keyboard-navigable elements in browse mode never include a category header');
  // Expand via mouse (the header's own designed interaction), specifically the synthetic
  // "Other (legacy — read-only)" wrapper — found by its own label text, not DOM position,
  // since the registry-seeded entry from PART 6's setup now also renders its own top-level
  // header alongside it. Under that wrapper, every real category is nested one level deeper
  // (_renderEventsTree treats every top-level entry as a pure category header, so it's safe
  // to group all 14 real categories under one such wrapper — the locked design decision from
  // the D2 implementation authorization). So reaching a real legacy leaf here takes two expand
  // clicks: the wrapper, then one real category header beneath it.
  const legacyHdr = window.locator(`#ecET-${compId} .tac-cat-hdr`).filter({ hasText: 'Other (legacy' });
  check(await legacyHdr.count() === 1, 'exactly one "Other (legacy — read-only)" wrapper header is present in browse mode');
  await legacyHdr.click();
  await window.waitForTimeout(200);
  const innerHeaders = await ev((cid) => [...document.getElementById(`ecET-${cid}`).querySelectorAll('.tac-ev-hdr')].length, compId);
  check(innerHeaders > 0, `expanding the wrapper reveals ${innerHeaders} real category headers beneath it`);
  await window.click(`#ecET-${compId} .tac-ev-hdr:first-child`);
  await window.waitForTimeout(200);
  const leavesAfterExpand = await ev((cid) => [...document.getElementById(`ecET-${cid}`).querySelectorAll('.tac-leaf')].length, compId);
  check(leavesAfterExpand > 0, `expanding a real category header via mouse reveals ${leavesAfterExpand} real selectable leaves`);
  await window.keyboard.press('Escape');
  await window.waitForTimeout(150);

  await closeCreateForm();

  // ═════════════════════════════════════════════════════════════════════════════
  // PART 5 — end-to-end archive test: create an event with a real leaf Event Type,
  // import one synthetic RAW+XMP through the real pipeline, verify folder name,
  // event.json, AND real ExifTool-read metadata on the written sidecar.
  // ═════════════════════════════════════════════════════════════════════════════
  await openCreateForm();
  await window.fill('#evHijriYear', '1448'); await window.fill('#evHijriMonth', '03'); await window.fill('#evHijriDay', '03');
  const compId2 = await ev(() => document.querySelector('.ec-comp-row')?.dataset.compId || null);
  const etInput3 = window.locator(`#ecET-${compId2} input`);
  await etInput3.click(); await etInput3.fill('Nikah Majlis');
  await window.waitForTimeout(400);
  await window.click(`#ecET-${compId2} .tac-item:first-child`);
  await window.waitForTimeout(150);
  const cityDD = window.locator('#ecGlobalCityDD');
  await cityDD.locator('input').click(); await cityDD.locator('input').fill('Mumbai');
  await window.waitForTimeout(400);
  const cityHasResults = await window.locator('#ecGlobalCityDD .tac-item').count();
  if (cityHasResults > 0) { await cityDD.locator('.tac-item').first().click(); }
  else { await window.click('#ecGlobalCityDD .tac-leaf:first-child').catch(() => {}); }
  await window.waitForTimeout(300);

  const createEnabled = await ev(() => !document.getElementById('emmCreateBtn').disabled);
  check(createEnabled, 'create form valid with a real leaf Event Type selected');
  let createdFolder = null, evJsonAfterCreate = null;
  if (createEnabled) {
    await window.click('#emmCreateBtn');
    await window.waitForFunction(() => !EventMgmt.isOpen(), null, { timeout: 20000 });
    await window.waitForTimeout(700);
    const collDir = path.join(archiveRoot, collName);
    createdFolder = (await fsp.readdir(collDir)).find(n => n.startsWith('1448-03-03'));
    check(!!createdFolder, `new event folder created on disk (${createdFolder})`);
    if (createdFolder) {
      evJsonAfterCreate = JSON.parse(await fsp.readFile(path.join(collDir, createdFolder, 'event.json'), 'utf8'));
      const types = evJsonAfterCreate.components[0].types;
      check(Array.isArray(types) && types.length === 1 && !EVENT_TYPE_CATEGORY_LABELS.includes(types[0]),
        `event.json component types is a real leaf, not a category header: ${JSON.stringify(types)}`);

      // ── real import: one synthetic RAW, verify real written sidecar via ExifTool ──
      const srcRoot2 = await mkTmp('ai-d2-import-src-');
      await fsp.mkdir(path.join(srcRoot2, 'DCIM', '100CANON'), { recursive: true });
      const filePath = path.join(srcRoot2, 'DCIM', '100CANON', 'IMG_0001.CR2');
      await fsp.writeFile(filePath, Buffer.from('not-a-real-raw-file'));
      await ev(a => selectSource(a), { type: 'local-folder', path: srcRoot2, label: 'D2_IMPORT_SRC' });
      await window.waitForFunction(() => document.getElementById('workspace').classList.contains('visible'), null, { timeout: 15000 });
      await ev(p => browseFolderDirect(p), path.join(srcRoot2, 'DCIM', '100CANON'));
      await window.waitForFunction(n => document.querySelectorAll('#fileGrid .file-tile[data-path]').length === n, 1, { timeout: 20000 });
      await window.click(`#fileGrid .file-tile[data-path="${filePath}"]`, { modifiers: ['Meta'] });
      await window.keyboard.press('Control+g'); await window.keyboard.press('1');
      await window.waitForTimeout(300);
      await window.click('#importBtn');
      const overlayShown = await window.waitForSelector('.ec-modal-overlay', { timeout: 5000 }).then(() => true).catch(() => false);
      if (overlayShown) {
        await ev(() => [...document.querySelectorAll('.ec-modal-overlay button')].find(b => b.textContent === 'Continue anyway')?.click());
        await window.waitForTimeout(300);
      }
      await window.waitForFunction(() => document.getElementById('eventImportOverlay').classList.contains('visible'), null, { timeout: 20000 });
      await ev(() => { _eiPhotographerDD.setValue('p-jane', 'Jane Doe'); _eiPhotographerDD.onSelect({ id: 'p-jane', label: 'Jane Doe' }); });
      await window.waitForTimeout(200);
      await window.click('#eiImportBtn');
      await window.waitForFunction(() => document.getElementById('progressSummary').classList.contains('visible'), null, { timeout: 90000 });
      await window.waitForTimeout(500);
      // Dismiss the progress modal via the real post-import chooser ("Continue Importing" —
      // keeps the same source workspace mounted, without ejecting or resetting the event)
      // so later parts of this test can reach #ctxChangeEventBtn again.
      await window.click('#progressDoneBtn');
      await window.waitForSelector('#postContinueBtn', { timeout: 10000 });
      await window.click('#postContinueBtn');
      await window.waitForFunction(() => !document.getElementById('progressOverlay').classList.contains('visible'), null, { timeout: 10000 });

      const eventJsonPath = path.join(collDir, createdFolder, 'event.json');
      let finalDoc = null;
      for (let i = 0; i < 30; i++) {
        await window.waitForTimeout(1000);
        try { finalDoc = JSON.parse(await fsp.readFile(eventJsonPath, 'utf8')); } catch {}
        if (finalDoc?.metadataState?.state === 'metadata-complete') break;
      }
      check(finalDoc?.metadataState?.state === 'metadata-complete', `metadata pipeline reached metadata-complete (${finalDoc?.metadataState?.state})`);

      async function findFiles(dir, out = []) {
        for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) await findFiles(full, out); else out.push(full);
        }
        return out;
      }
      const allFiles = await findFiles(path.join(collDir, createdFolder));
      const xmpPath = allFiles.find(f => f.endsWith('.xmp'));
      check(!!xmpPath, `real XMP sidecar written under the archived event folder (${xmpPath})`);
      if (xmpPath) {
        const { ExifTool } = require(path.join(PROJECT_ROOT, 'node_modules', 'exiftool-vendored'));
        const et = new ExifTool();
        try {
          const tags = await et.read(xmpPath);
          const subject = Array.isArray(tags.Subject) ? tags.Subject : (tags.Subject ? [tags.Subject] : []);
          check(subject.includes('Nikah Majlis'), `real ExifTool-read Subject/keywords include the real leaf "Nikah Majlis": ${JSON.stringify(subject)}`);
          for (const cat of EVENT_TYPE_CATEGORY_LABELS) {
            check(!subject.includes(cat), `real written metadata never contains category header "${cat}": ${JSON.stringify(subject)}`);
          }
        } finally {
          await et.end().catch(() => {});
        }
      }
    }
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // PART 6 — registry-populated path: a synthetic registry entry (seeded before PART 2,
  // above) remains authoritative and is never duplicated by the legacy fallback
  // ═════════════════════════════════════════════════════════════════════════════
  {
    const tree = await ev(() => window.api.getLists('event-types'));
    const flat = []; (function walk(nodes) { for (const n of nodes) { flat.push(n.label); if (n.children) walk(n.children); } })(tree);
    check(flat.filter(l => l === 'Registry Test Leaf').length === 1, 'the registry-covered leaf appears exactly once (not duplicated by the legacy fallback)');
    const matches = await ev(() => window.api.matchList('event-types', 'Registry Test Leaf'));
    check(matches.some(m => m.label === 'Registry Test Leaf'), 'the registry-covered leaf is searchable');
    // Uncovered siblings under the pre-existing legacy data must still surface normally.
    const majlisMatches = await ev(() => window.api.matchList('event-types', 'Majlis'));
    check(majlisMatches.some(m => m.label === 'Majlis'), 'uncovered legacy leaves remain reachable alongside a populated registry');
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // PART 7 — Additional Keywords: architecturally untouched by this fix (reads the
  // registry directly via keywordsLoadRegistry, never lists:get/lists:match), so it
  // must behave identically with an empty AND a populated registry.
  // ═════════════════════════════════════════════════════════════════════════════
  await openCreateForm();
  const compId3 = await ev(() => document.querySelector('.ec-comp-row')?.dataset.compId || null);
  const kwInput = window.locator(`#ecKwInput-${compId3}`);
  await kwInput.click(); await kwInput.fill('Registry Test Leaf');
  await window.waitForTimeout(400);
  const kwItems = await ev((cid) => [...document.getElementById(`ecKwDD-${cid}`).querySelectorAll('.ec-kw-dd-item[data-label]')].map(el => el.dataset.label), compId3);
  check(kwItems.includes('Registry Test Leaf'), `Additional Keywords search finds the populated registry entry unaffected: ${JSON.stringify(kwItems)}`);
  await kwInput.fill(''); await kwInput.fill('04 Majlis');
  await window.waitForTimeout(400);
  const kwItemsEmpty = await ev((cid) => [...document.getElementById(`ecKwDD-${cid}`).querySelectorAll('.ec-kw-dd-item[data-label]')].map(el => el.dataset.label), compId3);
  check(!kwItemsEmpty.includes('04 Majlis'), 'Additional Keywords never surfaces a legacy category label — it only ever reads the registry itself, never the legacy tree fallback');
  await kwInput.fill('');
  await closeCreateForm();

  // ═════════════════════════════════════════════════════════════════════════════
  // PART 8 — historical-event compatibility: an existing event.json using an old
  // flattened category-header value (e.g. "04 Majlis") must still load untouched,
  // with no migration, rejection, or crash.
  // ═════════════════════════════════════════════════════════════════════════════
  {
    const histDir = path.join(archiveRoot, collName, '1447-09-09 _01-Historical');
    await ev(async ({ dir, data }) => window.api.writeEventJson(dir, data), {
      dir: histDir, data: { version: 1, hijriDate: '1447-09-09', sequence: 1, eventName: 'Historical', components: [
        { id: 1, folderName: 'Historical-Hall', location: 'Hall', city: 'Surat', country: 'India', types: ['04 Majlis'], additionalKeywords: [] },
      ] },
    });
    await ev(async ({ collPath, collName, folder }) => {
      await window.api.setLastEvent({ collectionPath: collPath, collectionName: collName, eventName: folder, safeEventName: folder });
      await EventCreator.restoreLastEvent();
    }, { collPath: path.join(archiveRoot, collName), collName, folder: path.basename(histDir) });
    await window.waitForTimeout(500);
    const restored = await ev(() => EventCreator.getActiveEventData()?.event?.name);
    check(restored === path.basename(histDir), 'a historical event.json with an old category-header value loads without crashing');
    const onDiskUnchanged = JSON.parse(await fsp.readFile(path.join(histDir, 'event.json'), 'utf8'));
    check(onDiskUnchanged.components[0].types[0] === '04 Majlis', 'the historical value is preserved verbatim on disk — no silent migration or rejection');
    check(pageErrors.length === 0, 'no renderer page errors from loading the historical event');
  }

  check(pageErrors.length === 0, `no renderer page errors across the whole run (${JSON.stringify(pageErrors)})`);
  await app.close();
  for (const d of [userDataDir, archiveRoot, srcRoot]) await fsp.rm(d, { recursive: true, force: true }).catch(() => {});
  log(`=== SUMMARY: ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch(e => { console.error('[keyword-registry-legacy-fallback] FATAL', e.stack || e.message); process.exit(1); });
