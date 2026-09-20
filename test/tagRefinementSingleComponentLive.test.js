'use strict';

// Live end-to-end UI verification of Per-Photo Tag Refinement for SINGLE-component events
// (no groups) and the relaxed >=1 eligibility rule for multi-component groups — driving the
// REAL Electron renderer (real DOM, real selection, real import-confirm modal, real
// commitImportTransaction IPC, real exiftool-vendored read-back) against isolated synthetic
// fixtures. Never touches real data or real userData.
//
// Scenarios
//   S1  single-component, ONE Event Type  — the critical acceptance workflow, incl. a real
//       UI import and XMP read-back
//   S2  single-component, 2 Event Types + 2 Additional Keywords — available ≠ inherited,
//       per-file subsets, mixed-selection safety, real import + XMP read-back
//   S3  multi-component: one-tag mapped group NOW offers Refine Tags; multi-tag group unchanged
//   S4  single-component with ZERO refinable tags — control absent, no broken workspace
//   S5  invalidation: event edited, source changed, workspace reset, mid-refinement source change
//   S6  performance: 2000-file session
//   S7  legacy metadata groups (MetaPicker) under refinement — precedence, live
//
// Run with the real Electron binary (mirrors test/tagRefinementLiveE2E.test.js):
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --no-sandbox test/tagRefinementSingleComponentLive.test.js
// Optional: TAGREFINE_SHOTS=<dir> writes PNG screenshots of key states.

const { _electron: electron } = require('playwright-core');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const SHOTS = process.env.TAGREFINE_SHOTS || null;
// TAGREFINE_ONLY=S5,S6 runs just those scenarios (each is self-contained). Default: all.
const ONLY = process.env.TAGREFINE_ONLY ? process.env.TAGREFINE_ONLY.split(',').map(x => x.trim()) : null;
const run = id => !ONLY || ONLY.includes(id);

function log(...args) { console.log('[tag-refine-sc]', ...args); }
let failures = 0;
function check(cond, msg) {
  if (cond) { log('PASS —', msg); }
  else { failures++; log('FAIL —', msg); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const mkTmp = prefix => fsp.mkdtemp(path.join(os.tmpdir(), prefix));
const nm = i => `IMG_${String(i).padStart(4, '0')}.cr2`;

async function writeRaws(dir, count) {
  await fsp.mkdir(dir, { recursive: true });
  const out = [];
  for (let i = 1; i <= count; i++) {
    const p = path.join(dir, nm(i));
    await fsp.writeFile(p, Buffer.from('not-a-real-raw-file-' + i)); // distinct bytes per file
    out.push(p);
  }
  return out;
}

(async () => {
  const userDataDir = await mkTmp('ai-tagrefine-sc-userdata-');
  const archiveRoot = await mkTmp('ai-tagrefine-sc-root-');
  if (SHOTS) await fsp.mkdir(SHOTS, { recursive: true });
  log('archiveRoot =', archiveRoot);

  const app = await electron.launch({ args: [REPO, '--user-data-dir=' + userDataDir, '--no-sandbox'], cwd: REPO, timeout: 60000 });
  let window = await app.firstWindow({ timeout: 60000 });
  await window.waitForTimeout(1500);

  const splash = await window.evaluate(() => {
    const vis = id => { const el = document.getElementById(id); return !!el && getComputedStyle(el).display !== 'none'; };
    return { welcome: vis('splashWelcome'), select: vis('splashSelect'), create: vis('splashCreate') };
  });
  const mainWindowPromise = app.waitForEvent('window', { timeout: 30000 });
  if (splash.create) {
    await window.fill('#splashInputName', 'Tag Refine SC Operator');
    await window.fill('#splashInputRole', 'QA');
    await window.click('#splashCreateStartBtn');
  } else if (splash.select) {
    const hasUsers = await window.evaluate(() => document.querySelectorAll('.splash-user-item').length > 0);
    if (hasUsers) { await window.click('.splash-user-item'); await window.click('#splashSelectStartBtn'); }
    else {
      await window.click('#splashNewProfileBtn');
      await window.fill('#splashInputName', 'Tag Refine SC Operator');
      await window.fill('#splashInputRole', 'QA');
      await window.click('#splashCreateStartBtn');
    }
  } else if (splash.welcome) { await window.click('#splashContinueBtn'); }
  window = await mainWindowPromise;
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(2500);
  await window.evaluate(() => document.getElementById('onboardingOverlay')?.classList.remove('visible'));

  const errors = [];
  window.on('pageerror', err => errors.push('pageerror: ' + err.message));

  await window.evaluate(root => window.api.setMainArchiveRoot(root), archiveRoot);
  await window.evaluate(() => window.api.addToList('photographers', 'Jane Doe'));

  // ── helpers ────────────────────────────────────────────────────────────────────────
  const tileSel = p => `#fileGrid .file-tile[data-path="${p}"]`;
  const shot = async name => { if (SHOTS) await window.screenshot({ path: path.join(SHOTS, name + '.png') }); };

  async function openEvent({ coll = 'CollSC', folder, components }) {
    const collPath = path.join(archiveRoot, coll);
    const evDir = path.join(collPath, folder);
    await window.evaluate(({ d, comps }) => window.api.writeEventJson(d,
      { version: 1, hijriDate: '1448-01-01', sequence: 1, eventName: 'SC', components: comps }), { d: evDir, comps: components });
    await window.evaluate(({ cp, c, f }) => window.api.setLastEvent({ collectionPath: cp, collectionName: c, eventName: f, safeEventName: f }),
      { cp: collPath, c: coll, f: folder });
    await window.evaluate(() => EventCreator.restoreLastEvent());
    await window.waitForFunction(() => !!EventCreator.getActiveEventData(), null, { timeout: 15000 });
    return evDir;
  }

  async function loadSource(count, label) {
    const srcRoot = await mkTmp('ai-tagrefine-sc-src-');
    const day = path.join(srcRoot, 'Day1');
    const paths = await writeRaws(day, count);
    await window.evaluate(p => selectSource({ type: 'local-folder', path: p, label: 'TEST_' + 'SRC' }), srcRoot);
    await window.waitForFunction(() => document.getElementById('workspace').classList.contains('visible'), null, { timeout: 15000 });
    await window.evaluate(p => browseFolderDirect(p), day);
    await window.waitForFunction(n => document.querySelectorAll('#fileGrid .file-tile[data-path]').length === n, count, { timeout: 30000 });
    return { srcRoot, day, paths };
  }

  async function selectOnly(paths) {
    await window.evaluate(() => document.getElementById('clearSelBtn').click());
    for (const p of paths) await window.click(tileSel(p), { modifiers: ['Meta'] });
  }

  const panelState = () => window.evaluate(() => {
    const panel = document.getElementById('groupPanel');
    return {
      visible: panel.classList.contains('visible'),
      header: panel.querySelector('.gp-header')?.textContent || null,
      chips: [...panel.querySelectorAll('input[data-cat]')].map(cb => ({ cat: cb.dataset.cat, value: cb.value, checked: cb.checked, indeterminate: cb.indeterminate })),
      titles: [...panel.querySelectorAll('.rp-section-title')].map(e => e.textContent),
      selected: panel.querySelector('#rpSelectedCount')?.textContent.replace(/\s+/g, ' ').trim() || null,
      status: panel.querySelector('#rpSelectionStatus')?.textContent || null,
      applyDisabled: panel.querySelector('#rpApplyBtn')?.disabled ?? null,
      note: !!panel.querySelector('.rp-note'),
      summary: [...panel.querySelectorAll('.rp-summary span')].map(e => e.textContent),
    };
  });
  const chipOf = (st, cat, value) => st.chips.find(c => c.cat === cat && c.value === value);
  const banner = () => window.evaluate(() => {
    const b = document.getElementById('refinementBanner');
    return { shown: b.style.display !== 'none', text: document.getElementById('refinementBannerText').textContent };
  });
  const footer = () => window.evaluate(() => ({
    visible: document.getElementById('refineTagsArea').classList.contains('visible'),
    disabled: document.getElementById('refineTagsBtn').disabled,
    label: document.getElementById('refineTagsBtn').textContent,
    summary: document.getElementById('refineTagsSummary').textContent,
    importVisible: document.getElementById('importBtn').classList.contains('visible'),
    importDisabled: document.getElementById('importBtn').disabled,
  }));
  const ovr = (paths, scope) => window.evaluate(({ paths, scope }) => paths.map(p =>
    TagRefinementManager.getOverride(scope === 'event' ? TagRefinementManager.EVENT_SCOPE : scope, p)), { paths, scope });
  const clickChip = (cat, value) => window.click(`#groupPanel input[data-cat="${cat}"][value="${value}"]`);
  const evCount = () => window.evaluate(() => TagRefinementManager.groupRefinementCount(TagRefinementManager.EVENT_SCOPE));

  const asArr = v => (v === undefined || v === null) ? [] : (Array.isArray(v) ? v : [v]);
  async function findFiles(dir, out = []) {
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await findFiles(full, out); else out.push(full);
    }
    return out;
  }

  // Drives the REAL import UI: Import → confirm modal → picker → Import →. Returns the
  // confirm-modal refinement summary text (what the operator saw at the import decision).
  async function uiImport(evDir) {
    await window.click('#importBtn');
    await window.waitForSelector('#eventImportOverlay.visible', { timeout: 10000 });
    const modalRefine = await window.evaluate(() => {
      const el = document.getElementById('eiRefineSummary');
      return { display: el.style.display, text: el.textContent };
    });
    await shot('modal-' + Date.now());
    await window.fill('#eiPhotographerContainer input', 'Jan');
    await window.click('.tac-item[data-label="Jane Doe"]');
    await window.waitForFunction(() => !document.getElementById('eiImportBtn').disabled, null, { timeout: 5000 });
    await window.click('#eiImportBtn');
    let doc = null;
    for (let i = 0; i < 60; i++) {
      await window.waitForTimeout(1000);
      try { doc = JSON.parse(await fsp.readFile(path.join(evDir, 'event.json'), 'utf8')); } catch { /* not yet */ }
      if (doc?.metadataState?.state === 'metadata-complete') break;
    }
    return { modalRefine, doc };
  }
  const { ExifTool } = require('exiftool-vendored');
  const et = new ExifTool();
  const keywordsFor = async (files, name) => {
    const xmp = files.find(f => f.endsWith(path.basename(name, '.cr2') + '.xmp'));
    if (!xmp) return null;
    return asArr((await et.read(xmp)).Subject);
  };
  const CTX = ['Hall A', 'Surat', 'India'];
  let f, ps, b, o; // shared scratch across scenarios

  // ═════════════════════════════════════════════════════════════════════════════════════
  // S1 — single-component, ONE Event Type (Ziyarat): the critical acceptance workflow
  // ═════════════════════════════════════════════════════════════════════════════════════
  if (run('S1')) {
  log('════ S1: single-component, ONE Event Type ════');
  const evS1 = await openEvent({
    folder: '1448-01-01 _01-Ziyarat',
    components: [{ id: 1, folderName: 'Ziyarat-Hall A', location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyarat'], additionalKeywords: [] }],
  });
  const s1 = await loadSource(12, 'S1');
  const P1 = i => s1.paths[i - 1];
  const base = await window.evaluate(() => ({
    comps: EventCreator.getEventComps().length,
    hasGroups: GroupManager.hasGroups(),
    panelVisible: document.getElementById('groupPanel').classList.contains('visible'),
    groupTriggers: document.querySelectorAll('.gc-refine-trigger').length,
    tiles: document.querySelectorAll('#fileGrid .file-tile[data-path]').length,
  }));
  check(base.comps === 1 && !base.hasGroups && !base.panelVisible && base.groupTriggers === 0 && base.tiles === 12,
    'S1: single-component event open, 12 photos visible, NO groups exist, group panel hidden, no per-group buttons');
  f = await footer();
  check(f.visible && !f.disabled && f.label === 'Refine Tags' && f.summary === '' && !f.importVisible,
    'S1: global "Refine Tags" control is visible + enabled with no groups; quiet summary; Import hidden until a selection exists');
  await shot('s1-01-import-screen-refine-button');

  await selectOnly([1, 2, 3, 4, 5, 6].map(P1)); // the operator's pending import selection
  f = await footer();
  check(f.importVisible && !f.importDisabled, 'S1: with photos selected the normal Import button is available');

  // Enter refinement via the KEYBOARD (real focus + Enter) — proves the control is a real,
  // keyboard-operable button.
  await window.focus('#refineTagsBtn');
  await window.keyboard.press('Enter');
  await window.waitForFunction(() => TagRefinementManager.isEventScopeActive(), null, { timeout: 5000 });
  b = await banner();
  check(b.shown && /Refining Tags/.test(b.text) && /Current Event/.test(b.text) && /12 files/.test(b.text),
    `S1: banner reads "${b.text}"`);
  ps = await panelState();
  check(ps.visible && ps.header === 'Refining Tags · Current Event', 'S1: refinement panel renders WITHOUT any group (panel forced visible for event scope)');
  check(same(ps.titles, ['Event Types']) && same(ps.chips.map(c => c.value), ['Ziyarat']),
    'S1: Ziyarat is shown as the sole refinable tag (no Additional Keywords section)');
  const mode1 = await window.evaluate(() => ({
    tiles: document.querySelectorAll('#fileGrid .file-tile[data-path]').length,
    hasGroups: GroupManager.hasGroups(),
    sidebar: document.getElementById('sidebar').style.display,
    rows: document.querySelectorAll('.gc-refine-trigger').length,
  }));
  check(mode1.tiles === 12 && !mode1.hasGroups && mode1.sidebar === 'none',
    'S1: grid still shows all 12 event photos; no fake/hidden group created; folder navigation locked');
  f = await footer();
  check(!f.visible && !f.importVisible, 'S1: while refining, footer Refine control is hidden and Import is unavailable (Done Refining is the only way out; no second import path)');
  check(ps.selected === 'Selected: 0 files', 'S1: refinement selection starts empty — pending import selection is held aside');
  await shot('s1-02-refinement-mode-default');

  // select 5 → default inherits Ziyarat
  await selectOnly([1, 2, 3, 4, 5].map(P1));
  ps = await panelState();
  check(ps.selected.startsWith('Selected: 5 files') && ps.status === 'Default' && chipOf(ps, 'eventTypes', 'Ziyarat').checked && !ps.applyDisabled,
    'S1: default photos INHERIT Ziyarat (chip checked, status Default) — the panel shows the pipeline truth');

  // unselect Ziyarat → Apply → explicit empty override
  await clickChip('eventTypes', 'Ziyarat');
  await window.click('#rpApplyBtn');
  o = await ovr([1, 2, 3, 4, 5].map(P1), 'event');
  check(o.every(x => same(x, { eventTypes: [], additionalKeywords: [] })), 'S1: the 5 photos now carry an EXPLICIT EMPTY override (not "no override")');
  ps = await panelState();
  check(ps.status === 'No Tags' && !chipOf(ps, 'eventTypes', 'Ziyarat').checked, 'S1: explicit "No Tags" state is visible in the panel');
  const badges = await window.evaluate(() => document.querySelectorAll('#fileGrid .file-refine-badge.rb-none').length);
  check(badges === 5, `S1: exactly 5 tiles show the ∅ (no tags) badge — incremental sync, ${badges} found`);
  check(same(ps.summary, ['12 files', '7 default', '0 refined', '5 no tags']), `S1: panel summary ${JSON.stringify(ps.summary)}`);
  await shot('s1-03-explicit-no-tags');

  // others still inherit
  await selectOnly([7, 8].map(P1));
  ps = await panelState();
  check(ps.status === 'Default' && chipOf(ps, 'eventTypes', 'Ziyarat').checked, 'S1: untouched photos still inherit Ziyarat — nothing leaked to them');

  // Reset deletes the override
  await selectOnly([1, 2].map(P1));
  ps = await panelState();
  check(ps.status === 'No Tags', 'S1: re-selecting refined photos shows No Tags (state persisted across selection changes)');
  await window.click('#rpResetBtn');
  o = await ovr([1, 2, 3].map(P1), 'event');
  check(o[0] === null && o[1] === null && o[2] !== null, 'S1: Reset to Defaults DELETES the override (null, not an explicit all-tags override); the others stay refined');
  ps = await panelState();
  check(ps.status === 'Default' && chipOf(ps, 'eventTypes', 'Ziyarat').checked, 'S1: reset photos return to inheritance (Default, Ziyarat checked)');

  // mixed-selection safety
  await selectOnly([3, 6].map(P1)); // one explicit-none, one default
  ps = await panelState();
  check(ps.status === 'Mixed' && chipOf(ps, 'eventTypes', 'Ziyarat').indeterminate && ps.applyDisabled,
    'S1: mixed selection → status Mixed, Ziyarat indeterminate, Apply disabled');
  await clickChip('eventTypes', 'Ziyarat');
  ps = await panelState();
  check(ps.applyDisabled === false, 'S1: an intentional chip change enables Apply for the mixed selection');
  await selectOnly([3, 6].map(P1)); // selection change → dirty state discarded
  ps = await panelState();
  check(ps.status === 'Mixed' && ps.applyDisabled === true, 'S1: a selection change resets the dirty gate (Apply blocked again) — programmatic sync never marks dirty');

  // Done → normal Import workspace, selection restored, refinement preserved
  await window.click('#rpDoneBtn');
  await window.waitForFunction(() => !TagRefinementManager.isActive(), null, { timeout: 5000 });
  b = await banner();
  f = await footer();
  const sel = await window.evaluate(() => [...selectedFiles].sort());
  check(!b.shown && (await panelState()).visible === false, 'S1: Done → banner hidden, panel gone, back to the normal Import workspace');
  check(same(sel, [1, 2, 3, 4, 5, 6].map(P1).sort()), 'S1: Done RESTORES the operator\'s pending import selection (6 photos)');
  check(f.visible && f.label === 'Review / Refine Tags' && f.summary === '9 default · 0 refined · 3 no tags' && f.importVisible && !f.importDisabled,
    `S1: after leaving refinement the footer shows the event-level summary "${f.summary}" and normal Import is back`);
  await shot('s1-04-after-done-summary');

  // re-enter → state persisted
  await window.click('#refineTagsBtn');
  await window.waitForFunction(() => TagRefinementManager.isEventScopeActive(), null, { timeout: 5000 });
  check(await evCount() === 3, 'S1: re-entering refinement keeps the 3 overrides');
  await selectOnly([P1(4)]);
  ps = await panelState();
  check(ps.status === 'No Tags' && ps.summary[3] === '3 no tags', 'S1: re-entered panel still reflects them');
  await window.click('#rpDoneBtn');

  // ── import preparation through the REAL UI, then read the real result back ──
  log('S1: performing a real UI import of the 6 selected photos…');
  const r1 = await uiImport(evS1);
  check(r1.modalRefine.display !== 'none' && r1.modalRefine.text === 'Tag refinements: 3 default · 0 refined · 3 no tags',
    `S1: import-confirm modal recognizes the overrides: "${r1.modalRefine.text}"`);
  check(r1.doc?.metadataState?.state === 'metadata-complete', 'S1: metadata batch reached metadata-complete');
  const tr1 = r1.doc?.tagRefinements;
  const rel1 = (tr1 && tr1[0] && tr1[0].relPaths || []).map(p => path.basename(p)).sort();
  check(Array.isArray(tr1) && tr1.length === 1 && same(tr1[0].eventTypes, []) && same(tr1[0].additionalKeywords, []) && same(rel1, [3, 4, 5].map(i => nm(i)).sort()),
    `S1: event.json persisted ONE explicit-empty bucket for exactly the 3 imported no-tag photos: ${JSON.stringify(tr1)}`);
  const files1 = await findFiles(evS1);
  for (const i of [1, 2, 6]) {
    const kw = await keywordsFor(files1, nm(i));
    check(kw && kw.includes('Ziyarat') && CTX.every(k => kw.includes(k)), `S1 XMP: default photo ${nm(i)} inherits Ziyarat + City/Location/Country`);
  }
  for (const i of [3, 4, 5]) {
    const kw = await keywordsFor(files1, nm(i));
    check(kw && !kw.includes('Ziyarat') && CTX.every(k => kw.includes(k)), `S1 XMP: no-tags photo ${nm(i)} has NO Ziyarat but keeps City/Location/Country (${JSON.stringify(kw)})`);
  }
  check(fs.existsSync(path.join(evS1, 'Jane Doe', nm(1))) && !files1.some(p => /Ziyarat-Hall A[\\/]/.test(p)),
    'S1: routing untouched — photos land in <event>/<photographer>/ with no sub-event or refinement folder');
  // post-import reset (real "Continue importing" control)
  await window.click('#postContinueBtn').catch(() => window.evaluate(() => _continueImporting()));
  await window.waitForTimeout(400);
  check(await evCount() === 0 && !(await window.evaluate(() => TagRefinementManager.isActive())), 'S1: after the import completes the refinement state is reset');

  }

  // ═════════════════════════════════════════════════════════════════════════════════════
  // S2 — single-component, 2 Event Types + 2 Additional Keywords
  // ═════════════════════════════════════════════════════════════════════════════════════
  if (run('S2')) {
  log('════ S2: single-component, 2 Event Types + 2 Additional Keywords ════');
  const evS2 = await openEvent({
    folder: '1448-01-02 _02-Ziyarat-Waaz',
    components: [{ id: 1, folderName: 'Ziyarat-Waaz-Hall A', location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyarat', 'Waaz'],
      additionalKeywords: [{ label: 'Quran Tilawat', keywordId: 'k1' }, { label: 'Children', keywordId: 'k2' }] }],
  });
  const s2 = await loadSource(8, 'S2');
  const P2 = i => s2.paths[i - 1];
  f = await footer();
  check(f.visible && !f.disabled, 'S2: Refine Tags offered for a single-component event with 2 Event Types + 2 Additional Keywords');
  await window.click('#refineTagsBtn');
  await window.waitForFunction(() => TagRefinementManager.isEventScopeActive(), null, { timeout: 5000 });
  await selectOnly([P2(8)]);
  ps = await panelState();
  check(same(ps.titles, ['Event Types', 'Additional Keywords']) &&
    same(ps.chips.map(c => `${c.cat}:${c.value}`), ['eventTypes:Ziyarat', 'eventTypes:Waaz', 'additionalKeywords:Quran Tilawat', 'additionalKeywords:Children']),
    'S2: all 4 refinable tags offered, Event Types and Additional Keywords kept in separate categories');
  check(ps.note, 'S2: panel explains that untouched photos get no Event Type here (ambiguity)');
  check(ps.status === 'Default' && !chipOf(ps, 'eventTypes', 'Ziyarat').checked && !chipOf(ps, 'eventTypes', 'Waaz').checked &&
    chipOf(ps, 'additionalKeywords', 'Quran Tilawat').checked && chipOf(ps, 'additionalKeywords', 'Children').checked,
    'S2: untouched photo shows NO Event Type inherited (existing ambiguity rule) but BOTH Additional Keywords inherited — available ≠ default');
  await shot('s2-01-available-vs-default');

  await selectOnly([P2(1)]); await clickChip('eventTypes', 'Ziyarat'); await window.click('#rpApplyBtn');
  await selectOnly([P2(2)]); await clickChip('eventTypes', 'Waaz'); await clickChip('additionalKeywords', 'Quran Tilawat'); await clickChip('additionalKeywords', 'Children'); await window.click('#rpApplyBtn');
  await selectOnly([P2(3)]); await clickChip('eventTypes', 'Ziyarat'); await clickChip('eventTypes', 'Waaz'); await window.click('#rpApplyBtn');
  await selectOnly([P2(4)]); await window.click('#rpNoneBtn');
  await selectOnly([P2(5)]); await window.click('#rpAllBtn');
  await selectOnly([P2(6)]); await window.click('#rpResetBtn');
  o = await ovr([1, 2, 3, 4, 5, 6, 7].map(P2), 'event');
  check(same(o[0], { eventTypes: ['Ziyarat'], additionalKeywords: ['Quran Tilawat', 'Children'] }), 'S2: photo1 → Ziyarat only (Additional Keywords stay as inherited)');
  check(same(o[1], { eventTypes: ['Waaz'], additionalKeywords: [] }), 'S2: photo2 → Waaz only, both Additional Keywords removed');
  check(same(o[2], { eventTypes: ['Ziyarat', 'Waaz'], additionalKeywords: ['Quran Tilawat', 'Children'] }), 'S2: photo3 → BOTH Event Types');
  check(same(o[3], { eventTypes: [], additionalKeywords: [] }), 'S2: photo4 → explicit none (neither Event Type nor Additional Keyword)');
  check(same(o[4], { eventTypes: ['Ziyarat', 'Waaz'], additionalKeywords: ['Quran Tilawat', 'Children'] }), 'S2: photo5 → "Use All Component Tags" = explicit everything');
  check(o[5] === null && o[6] === null, 'S2: photo6 Reset and photo7 untouched → no override (dynamic pipeline default)');

  await selectOnly([1, 4, 6].map(P2)); // refined + explicit-none + default
  ps = await panelState();
  check(ps.status === 'Mixed' && ps.chips.some(c => c.indeterminate) && ps.applyDisabled, 'S2: default + subset-refined + explicit-none selected together → Mixed, indeterminate chips, Apply disabled');
  await clickChip('eventTypes', 'Waaz');
  check((await panelState()).applyDisabled === false, 'S2: changing a chip enables Apply');
  await shot('s2-02-mixed-selection');
  await window.click('#rpDoneBtn');
  f = await footer();
  check(f.summary === '5 default · 3 refined · 1 no tags' || /default · \d+ refined · \d+ no tags/.test(f.summary), `S2: footer summary "${f.summary}"`);

  log('S2: performing a real UI import of all 8 photos…');
  await window.evaluate(() => document.getElementById('selectAllBtn').click());
  const r2 = await uiImport(evS2);
  check(r2.doc?.metadataState?.state === 'metadata-complete', 'S2: metadata batch reached metadata-complete');
  const files2 = await findFiles(evS2);
  const kw2 = {};
  for (let i = 1; i <= 8; i++) kw2[i] = await keywordsFor(files2, nm(i));
  const has = (i, ...ks) => kw2[i] && ks.every(k => kw2[i].includes(k));
  const lacks = (i, ...ks) => kw2[i] && ks.every(k => !kw2[i].includes(k));
  check(has(1, 'Ziyarat', 'Quran Tilawat', 'Children', ...CTX) && lacks(1, 'Waaz'), `S2 XMP: photo1 Ziyarat + both AK, no Waaz ${JSON.stringify(kw2[1])}`);
  check(has(2, 'Waaz', ...CTX) && lacks(2, 'Ziyarat', 'Quran Tilawat', 'Children'), `S2 XMP: photo2 Waaz only, no AK ${JSON.stringify(kw2[2])}`);
  check(has(3, 'Ziyarat', 'Waaz', 'Quran Tilawat', 'Children', ...CTX), `S2 XMP: photo3 BOTH Event Types + AK ${JSON.stringify(kw2[3])}`);
  check(has(4, ...CTX) && lacks(4, 'Ziyarat', 'Waaz', 'Quran Tilawat', 'Children'), `S2 XMP: photo4 none of the refinable tags, City/Location/Country intact ${JSON.stringify(kw2[4])}`);
  check(has(5, 'Ziyarat', 'Waaz', 'Quran Tilawat', 'Children', ...CTX), `S2 XMP: photo5 explicit all ${JSON.stringify(kw2[5])}`);
  for (const i of [6, 7, 8]) {
    check(has(i, 'Quran Tilawat', 'Children', ...CTX) && lacks(i, 'Ziyarat', 'Waaz'),
      `S2 XMP: untouched photo${i} follows the EXISTING pipeline — NO Event Type (ambiguity preserved), Additional Keywords still applied`);
  }
  const tr2 = r2.doc?.tagRefinements || [];
  check(tr2.length >= 4 && tr2.every(x => Array.isArray(x.eventTypes) && Array.isArray(x.additionalKeywords) && Array.isArray(x.relPaths)),
    `S2: event.json tagRefinements buckets keep Event Types and Additional Keywords as distinct typed arrays (${tr2.length} buckets)`);
  await window.click('#postContinueBtn').catch(() => window.evaluate(() => _continueImporting()));
  await window.waitForTimeout(300);

  }

  // ═════════════════════════════════════════════════════════════════════════════════════
  // S3 — multi-component: one-tag mapped group now offers Refine Tags; multi-tag unchanged
  // ═════════════════════════════════════════════════════════════════════════════════════
  if (run('S3')) {
  log('════ S3: multi-component regression + one-tag mapped group ════');
  await openEvent({
    folder: '1448-01-03 _03-Multi',
    components: [
      { id: 1, folderName: 'Ziyarat-Hall A', location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyarat'], additionalKeywords: [] },
      { id: 2, folderName: 'Waaz-Majlis-Hall B', location: 'Hall B', city: 'Surat', country: 'India', types: ['Waaz', 'Majlis'], additionalKeywords: [{ label: 'Children', keywordId: 'k9' }] },
    ],
  });
  const s3 = await loadSource(8, 'S3');
  const P3 = i => s3.paths[i - 1];
  const g = await window.evaluate(({ a, b }) => {
    const g1 = GroupManager.createGroup(); GroupManager.assignFiles(a, g1); GroupManager.setSubEvent(g1, 'Ziyarat-Hall A');
    const g2 = GroupManager.createGroup(); GroupManager.assignFiles(b, g2); GroupManager.setSubEvent(g2, 'Waaz-Majlis-Hall B');
    renderGroupPanel();
    return { g1, g2 };
  }, { a: [1, 2, 3, 4].map(P3), b: [5, 6, 7, 8].map(P3) });
  const cards = await window.evaluate(() => ({
    triggers: [...document.querySelectorAll('.gc-refine-trigger')].map(t => t.textContent),
    footerVisible: document.getElementById('refineTagsArea').classList.contains('visible'),
  }));
  check(same(cards.triggers, ['Refine Tags', 'Refine Tags']),
    'S3: BOTH mapped groups offer "Refine Tags" — including the group whose component has only ONE Event Type (previously absent)');
  check(!cards.footerVisible, 'S3: the single-component footer control does NOT appear in a multi-component event (group buttons own it)');
  await shot('s3-01-group-cards');

  await window.click(`.gc-refine-trigger[data-gid="${g.g1}"]`);
  await window.waitForFunction(() => TagRefinementManager.isActive(), null, { timeout: 5000 });
  b = await banner();
  check(/Refining Tags/.test(b.text) && /G1/.test(b.text) && /Ziyarat-Hall A/.test(b.text) && /4 files/.test(b.text), `S3: group banner unchanged in form: "${b.text}"`);
  const grid3 = await window.evaluate(() => document.querySelectorAll('#fileGrid .file-tile[data-path]').length);
  check(grid3 === 4, 'S3: grid scoped to group.files (4 of 8)');
  await selectOnly([1, 2].map(P3));
  ps = await panelState();
  check(same(ps.chips.map(c => c.value), ['Ziyarat']) && ps.status === 'Default' && chipOf(ps, 'eventTypes', 'Ziyarat').checked, 'S3: one-tag group shows Ziyarat, default-inherited');
  await clickChip('eventTypes', 'Ziyarat'); await window.click('#rpApplyBtn');
  const oG = await window.evaluate(({ gid, ps }) => ps.map(p => ({
    grp: TagRefinementManager.getOverride(gid, p), evt: TagRefinementManager.getOverride(TagRefinementManager.EVENT_SCOPE, p) })), { gid: g.g1, ps: [1, 2].map(P3) });
  check(oG.every(x => same(x.grp, { eventTypes: [], additionalKeywords: [] }) && x.evt === null),
    'S3: explicit-empty override stored in the GROUP scope only — nothing leaks into event scope');
  await window.click('#rpDoneBtn');
  const after = await window.evaluate(({ gid }) => {
    const grp = GroupManager.getGroups().find(x => x.id === gid);
    return { sub: grp.subEventId, files: grp.files.size, card: document.querySelector(`.gc-refine-trigger[data-gid="${gid}"]`)?.textContent,
      counts: document.querySelector('.gc-refine-counts')?.textContent };
  }, { gid: g.g1 });
  check(after.sub === 'Ziyarat-Hall A' && after.files === 4, 'S3: refinement did not change group→component routing (subEventId + files intact)');
  check(after.card === 'Review / Refine Tags' && after.counts === '2 default · 0 refined · 2 no tags', `S3: group summary preserved: "${after.counts}"`);

  await window.click(`.gc-refine-trigger[data-gid="${g.g2}"]`);
  await window.waitForFunction(() => TagRefinementManager.isActive(), null, { timeout: 5000 });
  await selectOnly([5].map(P3));
  ps = await panelState();
  check(same(ps.chips.map(c => `${c.cat}:${c.value}`), ['eventTypes:Waaz', 'eventTypes:Majlis', 'additionalKeywords:Children']) &&
    ps.chips.every(c => c.checked) && ps.status === 'Default' && !ps.note,
    'S3: multi-component multi-tag group UNCHANGED — every tag inherited by default (multi-component rule), no ambiguity note');
  await shot('s3-02-multi-group-panel');
  await window.click('#rpDoneBtn');

  }

  // ═════════════════════════════════════════════════════════════════════════════════════
  // S4 — single-component with ZERO refinable tags
  // ═════════════════════════════════════════════════════════════════════════════════════
  if (run('S4')) {
  log('════ S4: single-component, zero refinable tags ════');
  await openEvent({
    folder: '1448-01-04 _04-Bare',
    components: [{ id: 1, folderName: 'Bare-Hall A', location: 'Hall A', city: 'Surat', country: 'India', types: [], additionalKeywords: [] }],
  });
  await loadSource(3, 'S4');
  const z = await window.evaluate(() => ({
    comps: EventCreator.getEventComps().length,
    types: EventCreator.getEventComps()[0]?.eventTypes.length,
    eligible: TagRefinementManager.isEligible(EventCreator.getEventComps()[0]),
    area: document.getElementById('refineTagsArea').classList.contains('visible'),
  }));
  check(z.comps === 1 && z.types === 0 && z.eligible === false && z.area === false,
    'S4: a component with nothing to refine → ineligible and the control is absent (no empty/broken refinement workspace)');

  }

  // ═════════════════════════════════════════════════════════════════════════════════════
  // S7 — legacy metadata groups (MetaPicker / group.metadataTags) layered under refinement
  //      precedence: per-photo refinement > group.metadataTags > component default
  // ═════════════════════════════════════════════════════════════════════════════════════
  if (run('S7')) {
  log('════ S7: legacy metadata groups + refinement precedence ════');
  const evS7 = await openEvent({
    folder: '1448-01-07 _07-MetaGroups',
    components: [{ id: 1, folderName: 'Ziyarat-Waaz-Hall A', location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyarat', 'Waaz'], additionalKeywords: [] }],
  });
  const s7 = await loadSource(4, 'S7');
  const P7 = i => s7.paths[i - 1];
  await window.evaluate(({ a, b }) => {
    const g1 = GroupManager.createGroup(); GroupManager.assignFiles(a, g1); GroupManager.setMetadataTags(g1, ['Waaz']);
    const g2 = GroupManager.createGroup(); GroupManager.assignFiles(b, g2); GroupManager.setMetadataTags(g2, []);
    renderGroupPanel();
  }, { a: [1, 2].map(P7), b: [3, 4].map(P7) });
  const meta7 = await window.evaluate(() => ({ metaMode: isMetadataGroupingMode(), groups: GroupManager.getGroups().length,
    area: document.getElementById('refineTagsArea').classList.contains('visible'), header: document.querySelector('#groupPanel .gp-header')?.textContent }));
  check(meta7.metaMode && meta7.groups === 2 && meta7.area && meta7.header === 'Metadata Groups',
    'S7: legacy Metadata Groups panel is intact and the event-level Refine Tags control coexists with it');
  await window.click('#refineTagsBtn');
  await window.waitForFunction(() => TagRefinementManager.isEventScopeActive(), null, { timeout: 5000 });
  await selectOnly([P7(2)]); // group tagged ['Waaz'], no override
  ps = await panelState();
  check(ps.status === 'Default' && chipOf(ps, 'eventTypes', 'Waaz').checked && !chipOf(ps, 'eventTypes', 'Ziyarat').checked,
    'S7: a photo in a group tagged Waaz shows Waaz as its INHERITED default (panel reflects legacy tier 1, not "all" or "none")');
  await selectOnly([P7(3)]); // group tagged [], no override
  ps = await panelState();
  check(ps.status === 'Default' && !chipOf(ps, 'eventTypes', 'Waaz').checked && !chipOf(ps, 'eventTypes', 'Ziyarat').checked,
    'S7: a photo in a group with no event keyword inherits no Event Type');
  await selectOnly([P7(1)]); await clickChip('eventTypes', 'Waaz'); await clickChip('eventTypes', 'Ziyarat'); await window.click('#rpApplyBtn'); // Waaz→off, Ziyarat→on
  await selectOnly([P7(4)]); await clickChip('eventTypes', 'Ziyarat'); await clickChip('eventTypes', 'Waaz'); await window.click('#rpApplyBtn');
  o = await ovr([1, 2, 3, 4].map(P7), 'event');
  check(same(o[0], { eventTypes: ['Ziyarat'], additionalKeywords: [] }) && o[1] === null && o[2] === null && same(o[3], { eventTypes: ['Ziyarat', 'Waaz'], additionalKeywords: [] }),
    'S7: overrides recorded only where the operator acted');
  await window.click('#rpDoneBtn');
  await window.evaluate(() => document.getElementById('selectAllBtn').click());
  const gm = await window.evaluate(() => GroupManager.getGroups().map(g => ({ files: g.files.size, tags: g.metadataTags })));
  check(same(gm, [{ files: 2, tags: ['Waaz'] }, { files: 2, tags: [] }]), 'S7: legacy group metadataTags untouched by refinement');
  await uiImport(evS7);
  const files7 = await findFiles(evS7);
  const k7 = {}; for (let i = 1; i <= 4; i++) k7[i] = await keywordsFor(files7, nm(i));
  check(k7[1] && k7[1].includes('Ziyarat') && !k7[1].includes('Waaz'), `S7 XMP: refinement BEATS the group's legacy Waaz tag (photo1 → Ziyarat only) ${JSON.stringify(k7[1])}`);
  check(k7[2] && k7[2].includes('Waaz') && !k7[2].includes('Ziyarat'), `S7 XMP: un-refined photo2 still gets the group's legacy Waaz tag ${JSON.stringify(k7[2])}`);
  check(k7[3] && !k7[3].includes('Waaz') && !k7[3].includes('Ziyarat') && CTX.every(k => k7[3].includes(k)), `S7 XMP: un-refined photo3 in a no-keyword group gets no Event Type ${JSON.stringify(k7[3])}`);
  check(k7[4] && k7[4].includes('Ziyarat') && k7[4].includes('Waaz'), `S7 XMP: photo4 explicit both ${JSON.stringify(k7[4])}`);
  await window.click('#postContinueBtn').catch(() => window.evaluate(() => _continueImporting()));
  await window.waitForTimeout(300);

  }

  // ═════════════════════════════════════════════════════════════════════════════════════
  // S5 — invalidation / no leakage
  // ═════════════════════════════════════════════════════════════════════════════════════
  if (run('S5')) {
  log('════ S5: invalidation & leakage ════');
  const evS5 = await openEvent({
    folder: '1448-01-05 _05-Inval',
    components: [{ id: 1, folderName: 'Ziyarat-Hall A', location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyarat'], additionalKeywords: [] }],
  });
  const s5 = await loadSource(4, 'S5');
  const applyNone = async (idxs) => {
    await window.click('#refineTagsBtn');
    await window.waitForFunction(() => TagRefinementManager.isEventScopeActive(), null, { timeout: 5000 });
    await selectOnly(idxs.map(i => s5.paths[i - 1]));
    await window.click('#rpNoneBtn');
    await window.click('#rpDoneBtn');
  };
  await applyNone([1, 2]);
  check(await evCount() === 2, 'S5: two overrides exist before invalidation');

  // (a) event edited: its refinable tags change on disk and the app re-reads them (exactly
  // what import's reloadForImport does) → stale overrides are dropped, never written against
  // tags that no longer exist. (writeEventJson is create-only, so the edit is applied to the file directly.)
  const editTypes = async types => {
    const jp = path.join(evS5, 'event.json');
    const doc = JSON.parse(await fsp.readFile(jp, 'utf8'));
    doc.components[0].types = types;
    await fsp.writeFile(jp, JSON.stringify(doc, null, 2));
    return window.evaluate(p => EventCreator.reloadForImport(p), evS5);
  };
  check(await editTypes(['Ziyarat', 'Waaz']) === true, 'S5(a): the edited event was re-read by the app');
  check((await window.evaluate(() => EventCreator.getEventComps()[0].eventTypes.length)) === 2, 'S5(a): the app now sees 2 Event Types');
  await window.evaluate(() => updateSelectionBar());
  check(await evCount() === 0, 'REGRESSION S5(a) [event-scope invalidation]: event edited (its refinable tags changed) → stale overrides are cleared, never written against tags that no longer exist');
  await editTypes(['Ziyarat']);

  // (b) source change
  await applyNone([1]);
  check(await evCount() === 1, 'S5: override recreated');
  const s5b = await loadSource(3, 'S5b');
  check(await evCount() === 0, 'S5(b): changing the source clears event-scope refinements (no leak into the new source)');

  // (c) mid-refinement source change
  await window.click('#refineTagsBtn');
  await window.waitForFunction(() => TagRefinementManager.isEventScopeActive(), null, { timeout: 5000 });
  await loadSource(2, 'S5c');
  const mid = await window.evaluate(() => ({ active: TagRefinementManager.isActive(), bannerShown: document.getElementById('refinementBanner').style.display !== 'none',
    sidebar: document.getElementById('sidebar').style.display, panel: document.getElementById('groupPanel').classList.contains('visible') }));
  check(!mid.active && !mid.bannerShown && mid.sidebar !== 'none' && !mid.panel,
    `REGRESSION S5(c) [chrome healing]: changing source while refining exits refinement cleanly — no stale banner/panel, folder sidebar restored (sidebar display="${mid.sidebar}")`);

  // (d) workspace reset
  await window.click('#refineTagsBtn');
  await window.waitForFunction(() => TagRefinementManager.isEventScopeActive(), null, { timeout: 5000 });
  await selectOnly([(await window.evaluate(() => [...document.querySelectorAll('#fileGrid .file-tile[data-path]')].map(t => t.dataset.path)))[0]]);
  await window.click('#rpNoneBtn');
  await window.evaluate(() => resetWorkspaceState());
  const rs = await window.evaluate(() => ({ active: TagRefinementManager.isActive(), n: TagRefinementManager.groupRefinementCount(TagRefinementManager.EVENT_SCOPE),
    bannerShown: document.getElementById('refinementBanner').style.display !== 'none', sidebar: document.getElementById('sidebar').style.display }));
  check(!rs.active && rs.n === 0 && !rs.bannerShown && rs.sidebar !== 'none', 'REGRESSION S5(d) [chrome healing]: workspace reset clears mode + overrides + banner and restores the sidebar');

  }

  // ═════════════════════════════════════════════════════════════════════════════════════
  // S6 — performance: 2000-file session
  // ═════════════════════════════════════════════════════════════════════════════════════
  if (run('S6')) {
  log('════ S6: 2000-file performance ════');
  await openEvent({
    folder: '1448-01-06 _06-Perf',
    components: [{ id: 1, folderName: 'Ziyarat-Hall A', location: 'Hall A', city: 'Surat', country: 'India', types: ['Ziyarat'], additionalKeywords: [{ label: 'Children', keywordId: 'k1' }] }],
  });
  await loadSource(2000, 'S6');
  const perf = await window.evaluate(() => {
    const t = {};
    const time = (k, fn) => { const s = performance.now(); fn(); t[k] = Math.round(performance.now() - s); };
    const domBefore = document.getElementsByTagName('*').length;
    time('enter', () => document.getElementById('refineTagsBtn').click());
    time('selectAll', () => document.getElementById('selectAllBtn').click());
    const selected = selectedFiles.size;
    time('applyNone', () => document.getElementById('rpNoneBtn').click());
    time('selectOne', () => { const tile = document.querySelector('#fileGrid .file-tile[data-path]'); tile.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })); });
    time('reset', () => document.getElementById('rpResetBtn').click());
    time('done', () => document.getElementById('rpDoneBtn').click());
    return { t, selected, tiles: document.querySelectorAll('#fileGrid .file-tile[data-path]').length, domBefore, domAfter: document.getElementsByTagName('*').length };
  });
  log('S6 timings (ms):', JSON.stringify(perf.t), 'tiles:', perf.tiles, 'selected:', perf.selected);
  check(perf.selected === 2000 && perf.tiles === 2000, 'S6: 2000 files: all visible in refinement, Select All selects all 2000');
  check(perf.t.enter < 4000 && perf.t.selectAll < 2000 && perf.t.applyNone < 2000 && perf.t.selectOne < 500 && perf.t.reset < 2000 && perf.t.done < 4000,
    'S6: every refinement action stays well inside interactive budgets at 2000 files');
  check(perf.domAfter - perf.domBefore < 200, `S6: no DOM growth from repeated enter/exit (${perf.domAfter - perf.domBefore} extra nodes)`);
  const listeners = await window.evaluate(() => {
    // The panel's chip 'change' handler must be registered ONCE, not once per render.
    let n = 0; const panel = document.getElementById('groupPanel');
    const orig = panel.addEventListener; panel.addEventListener = function (t, ...r) { if (t === 'change') n++; return orig.call(this, t, ...r); };
    document.getElementById('refineTagsBtn').click(); document.getElementById('selectAllBtn').click(); document.getElementById('rpNoneBtn').click();
    document.getElementById('rpResetBtn').click(); document.getElementById('rpDoneBtn').click();
    panel.addEventListener = orig; return n;
  });
  check(listeners === 0, `REGRESSION S6 [single listener registration]: repeated renders register no additional panel 'change' listeners (${listeners})`);

  }

  await et.end().catch(() => {});
  check(errors.length === 0, `no renderer page errors (${JSON.stringify(errors)})`);
  await app.close();
  log(`=== SUMMARY: ${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} ===`);
  process.exitCode = failures === 0 ? 0 : 1;
})().catch(e => { console.error('[tag-refine-sc] FATAL', e.stack || e.message); process.exit(1); });
