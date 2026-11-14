'use strict';

// AI-FEAT-061 Q1/Q2 — static guard for the main-window UI freeze (DEC-027).
// Compares this branch against the Stable baseline and fails if any file that
// renders or wires the existing main window / splash changed, apart from the one
// approved non-visual handoff listener (Q2). The companion's own UI must live only
// under renderer/companion/.
//
// Q5c exception (AI-FEAT-063 / AI-RM-014): the read-only Photographer Registry tab inside
// Metadata Management, and nothing else — a fourth tab button, its panel, styles scoped to
// that panel (plus the tab-row responsiveness rule), the dedicated photographerRegistryUI.js
// module, the one-line tab registration + lazy-load hook in renderer.js, and four read-only
// preload channels. Each is checked line by line below; everything else stays frozen.
// Q5d extends it for camera-association decisions INSIDE that panel only: one more dedicated
// module (photographerRegistryActions.js, which draws its controls in the panel's detail pane),
// its script tag and scoped .pr-* styles, and three decision channels (prepare/commit/cancel).
// Q5e-1 adds, still inside that panel only, the profile module (photographerRegistryProfile.js:
// aliases, retire/reactivate, first registration, PREVIEW-ONLY rename), its script tag and scoped
// styles, and one read-only channel (renamePreview). No rename can be applied from the UI.
// EQI-1 exception (AI-FEAT-064 / AI-RM-016, owner-approved): Event Dump Quick Import from the
// companion, run by the main window's EXISTING import machinery and drawing NOTHING in the main
// window — a new non-visual module (eventDumpImport.js) and its script tag, additive
// ImportRouter.buildDumpFileJobs, a behaviour-preserving extraction of the multi-event import's
// per-event prepare step (importSessionUI.js _sessPrepareEvent, so both imports route alike), the
// module's init in the companion block of renderer.js, and three companion channels. The picker /
// Event Creator it opens is the existing UI, unchanged.
//
// Run: node test/companionQ1UiFreeze.test.js [baseRef]   (default origin/stable/0.9)

const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.argv[2] || 'origin/stable/0.9';
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });

let passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log(`  ok — ${name}`); }
  catch (err) { console.error(`  FAIL — ${name}`); console.error(err.message); process.exitCode = 1; }
}

// Committed + staged + unstaged + untracked changes relative to BASE.
const mergeBase = git('merge-base', BASE, 'HEAD').trim();
const changed = new Set([
  ...git('diff', '--name-only', mergeBase).split('\n'),
  ...git('ls-files', '--others', '--exclude-standard').split('\n'),
].filter(Boolean));

// Q2 (AI-FEAT-061): the ONE approved main-window touch is the non-visual companion
// handoff listener — additions only, in renderer/renderer.js and main/preload.js, with
// no DOM, markup or style of its own.
const APPROVED_RENDERER_TOUCH = 'renderer/renderer.js';
const Q5C_INDEX = 'renderer/index.html';
const Q5C_MODULE = 'renderer/photographerRegistryUI.js';
const Q5D_MODULE = 'renderer/photographerRegistryActions.js';
const Q5E_MODULE = 'renderer/photographerRegistryProfile.js';
const Q5C_TAB_LINE_OLD = "  ['msTabMetadata', 'msTabAudit', 'msTabRegistry'].forEach(id => {";
const Q5C_TAB_LINE_NEW = "  ['msTabMetadata', 'msTabAudit', 'msTabRegistry', 'msTabPhotographers'].forEach(id => {";
const Q5C_PRELOAD_CHANNELS = ['photographerRegistry:load', 'photographerRegistry:search', 'photographerRegistry:photographer', 'photographerRegistry:camera'];
const Q5D_PRELOAD_CHANNELS = ['photographerRegistry:prepare', 'photographerRegistry:commit', 'photographerRegistry:cancel', 'photographerRegistry:renamePreview'];
const EQI1_MODULE = 'renderer/eventDumpImport.js';
const EQI1_ROUTER = 'renderer/importRouter.js';
const EQI1_SESSION_UI = 'renderer/importSessionUI.js';
const EQI1_SCRIPT = '<script src="eventDumpImport.js"></script>';
const EQI1_PRELOAD_CHANNELS = ['companion:dumpImport', 'companion:openEventPicker', 'companion:workspaceEvent',
  // EQI-1.1: one-click event selection without foregrounding, and the attention request for safety dialogs.
  'companion:selectEvent', 'companion:attention',
  // EQI-2: the multi-event Dump plan handoff and its per-event progress (no main-window UI).
  'companion:dumpPlanImport', 'companion:dumpPlanEvent'];
const EQI1_RENDERER_LINES = [
  '+  // AI-FEAT-064 EQI-1: Event Dump imports / event picker requests from the companion, and the',
  '+  // active-event report it shows.',
  "+  if (typeof EventDumpImport !== 'undefined') EventDumpImport.init();",
];
const diffLines = (file) => git('diff', '-U0', mergeBase, '--', file).split('\n')
  .filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));

t('no existing renderer file changed except the approved handoff listener (main window, splash, shared modules)', () => {
  const offending = [...changed].filter(f => f.startsWith('renderer/') && !f.startsWith('renderer/companion/') && ![APPROVED_RENDERER_TOUCH, Q5C_INDEX, Q5C_MODULE, Q5D_MODULE, Q5E_MODULE, EQI1_MODULE, EQI1_ROUTER, EQI1_SESSION_UI].includes(f));
  assert.deepEqual(offending, []);
});

t('renderer.js: handoff listener is additions only and draws nothing', () => {
  const all = diffLines(APPROVED_RENDERER_TOUCH);
  // Q5c: the only changed existing line is the Metadata Management tab list gaining its fourth id.
  assert.deepEqual(all.filter(l => l.startsWith('-')), all.some(l => l === `+${Q5C_TAB_LINE_NEW}`) ? [`-${Q5C_TAB_LINE_OLD}`] : [], 'no existing line removed or changed');
  const lines = all.filter(l => l !== `+${Q5C_TAB_LINE_NEW}` && l !== `-${Q5C_TAB_LINE_OLD}` && !EQI1_RENDERER_LINES.includes(l));
  const drawing = lines.filter(l => /innerHTML|outerHTML|createElement|insertAdjacent|appendChild|replaceChildren|\.style\.|classList\.(add|remove|toggle)|<[a-z]+[ >]/i.test(l));
  assert.deepEqual(drawing, [], 'no DOM, markup or style created');
  if (lines.length) assert.ok(lines.some(l => l.includes('COMPANION HANDOFF')), 'confined to the documented handoff block');
});

t('main-window preload: only the companion handoff channels were added', () => {
  const lines = diffLines('main/preload.js');
  assert.deepEqual(lines.filter(l => l.startsWith('-')), [], 'no existing API removed or changed');
  const allowed = new Set(['companion:openSource', 'companion:openSourceProgress', 'companion:openSourceResult', 'companion:workspaceReady', ...Q5C_PRELOAD_CHANNELS, ...Q5D_PRELOAD_CHANNELS, ...EQI1_PRELOAD_CHANNELS]);
  const channels = [...lines.join('\n').matchAll(/'([a-z-]+:[A-Za-z]+)'/g)].map(m => m[1]);
  assert.deepEqual(channels.filter(c => !allowed.has(c)), [], 'no other channel exposed to the main window');
});

t('renderer.js (Q5c): only the tab registration and the lazy-load hook, nothing else', () => {
  const q5c = diffLines(APPROVED_RENDERER_TOUCH).filter(l => l === `-${Q5C_TAB_LINE_OLD}` || /msTabPhotographers|PhotographerRegistry|Photographer Registry/.test(l));
  if (!q5c.length) return;
  assert.deepEqual(q5c, [
    `-${Q5C_TAB_LINE_OLD}`,
    `+${Q5C_TAB_LINE_NEW}`,
    '+  // Photographer Registry (Q5c): read-only, loads lazily each time the tab is shown.',
    "+  if (tabId === 'msTabPhotographers') window.PhotographerRegistryUI?.onShow();",
  ]);
});

t('index.html (Q5c): additions only, confined to the Photographer Registry tab, panel, scoped styles and module', () => {
  const lines = diffLines(Q5C_INDEX);
  assert.deepEqual(lines.filter(l => l.startsWith('-')), [], 'no existing markup or style removed or changed');
  const added = lines.map(l => l.slice(1));
  const ids = added.flatMap(l => [...l.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  assert.deepEqual(ids.filter(id => !/^(pr[A-Z]|msTabPhotographers$|msTab-photographers$)/.test(id)), [], 'only Q5c-owned ids');
  const classes = added.flatMap(l => [...l.matchAll(/\bclass="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)));
  assert.deepEqual(classes.filter(c => !c.startsWith('pr-') && !['ms-tab', 'ms-tab-helper', 'ms-scope-select'].includes(c)), [], 'only pr-* classes plus reused tab/helper/select styles');
  const selectors = added.filter(l => /^\s*[.#@][^{]*\{/.test(l)).map(l => l.trim());
  const scoped = (sel) => /^@media \(max-width: 860px\)/.test(sel) || sel.split('{')[0].split(',').every(part => /^\s*(\.pr-|#msTabPhotographers\b|#metadataSyncModal \.ms-tabs?\b)/.test(part));
  assert.deepEqual(selectors.filter(sel => !scoped(sel)), [], 'every new rule is scoped to the Q5c panel or the modal tab row');
  const scripts = added.filter(l => /<script\b/.test(l));
  assert.deepEqual(scripts.map(l => l.trim()).sort(), ['<script src="photographerRegistryUI.js" defer></script>', '<script src="photographerRegistryActions.js" defer></script>', '<script src="photographerRegistryProfile.js" defer></script>', EQI1_SCRIPT].sort(), 'only the dedicated modules are loaded');
  const tabButtons = added.filter(l => /class="ms-tab"/.test(l));
  assert.equal(tabButtons.length, 1, 'exactly one new Metadata Management tab button');
  assert.ok(/data-ms-tab="msTabPhotographers">Photographer Registry<\/button>/.test(tabButtons[0]));
  const actions = added.filter(l => /<button\b/.test(l) && !/class="ms-tab"|data-pr-view=/.test(l));
  assert.deepEqual(actions, [], 'no action button (rename, alias, confirm, retire, resolve) in the markup');
});

t('renderer.js (EQI-1): only the Event Dump module init in the companion block', () => {
  const eqi = diffLines(APPROVED_RENDERER_TOUCH).filter(l => /EventDumpImport|EQI-1|active-event report/.test(l));
  if (!eqi.length) return;
  assert.deepEqual(eqi, EQI1_RENDERER_LINES);
});

t('eventDumpImport.js (EQI-1): non-visual — draws nothing, only clicks the existing "+ Create New Event" button', () => {
  const src = require('fs').readFileSync(path.join(ROOT, EQI1_MODULE), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/innerHTML|outerHTML|insertAdjacent|createElement|appendChild|replaceChildren|\.style\.|classList\.(add|remove|toggle)|document\.write/.test(code), 'no DOM, markup or style created');
  assert.ok(!/ipcRenderer|require\(/.test(code), 'no direct IPC or module access');
  const ids = [...code.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(ids)].sort(), ['ecNewEventFromList', 'workspace'], 'reads the workspace state; clicks only the existing New Event button');
  assert.ok(/destination: 'dump'/.test(code) && /ImportRouter\.buildDumpFileJobs/.test(code) && /ImportSessionRunner\.run/.test(code) && /_sessPrepareEvent/.test(code), 'runs the existing import machinery');
});

t('importRouter.js (EQI-1): additions only — buildDumpFileJobs, never consults photographerSequences', () => {
  const lines = diffLines(EQI1_ROUTER);
  const removed = lines.filter(l => l.startsWith('-'));
  assert.deepEqual(removed, ['-  return { buildFileJobs, simulateImport, validateGroups };'], 'only the export line changed');
  const added = lines.filter(l => l.startsWith('+')).join('\n');
  assert.ok(/function buildDumpFileJobs/.test(added) && !/photographerSequences\[|\.photographerSequences/.test(added.replace(/\/\/.*$/gm, '')), 'Dump routing never reads PC sequences');
});

t('importSessionUI.js (EQI-1): only the per-event prepare step moved into _sessPrepareEvent, unchanged', () => {
  const lines = diffLines(EQI1_SESSION_UI);
  const norm = (l) => l.slice(1).trim();
  const added = new Set(lines.filter(l => l.startsWith('+')).map(norm));
  const removed = lines.filter(l => l.startsWith('-')).map(norm).filter(Boolean);
  // The helper takes the import mode as a parameter instead of reading the session's `choice`.
  const notMoved = removed.filter(l => !added.has(l) && !['prepareEvent: async (item) => {', '},', "if (choice.importMode !== 'local-first') {", "const normSlash = (p) => (p || '').replace(/\\\\/g, '/').replace(/\\/$/, '');"].includes(l));
  assert.deepEqual(notMoved, [], 'every removed line reappears in the extracted helper');
  assert.ok(added.has('prepareEvent: (item) => _sessPrepareEvent(item, choice.importMode, archSt),'), 'the multi-event import calls the shared helper');
  const drawing = lines.filter(l => l.startsWith('+') && /innerHTML|createElement|\.style\.|classList\.(add|remove|toggle)/.test(l));
  assert.deepEqual(drawing, [], 'no DOM, markup or style created');
});

t('photographerRegistryActions.js (Q5d): decisions only through prepare/commit/cancel (+ search for the picker), no HTML injection', () => {
  const src = require('fs').readFileSync(path.join(ROOT, Q5D_MODULE), 'utf8');
  const calls = [...src.matchAll(/api\.(\w+)\(/g)].map(m => m[1]);
  assert.deepEqual([...new Set(calls)].sort(), ['photographerRegistryCancel', 'photographerRegistryCommit', 'photographerRegistryPrepare', 'photographerRegistrySearch']);
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src), 'text is set with textContent only');
  assert.ok(!/ipcRenderer|require\(/.test(src), 'no direct IPC or module access');
  assert.ok(!/rename|folder/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), 'no naming or folder control');
  assert.ok(!/getElementById\('(?!pr)|querySelector\('(?!\.pr-|input\[data-first\]|button)/.test(src), 'touches only its own panel elements');
});

t('photographerRegistryProfile.js (Q5e-1): profile actions through the shared panel; rename is preview-only', () => {
  const src = require('fs').readFileSync(path.join(ROOT, Q5E_MODULE), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const calls = [...code.matchAll(/api\.(\w+)\(/g)].map(m => m[1]);
  assert.deepEqual([...new Set(calls)].sort(), ['photographerRegistryRenamePreview'], 'its only direct call is the read-only rename preview');
  const actions = [...code.matchAll(/action: '([a-z-]+)'/g)].map(m => m[1]);
  assert.deepEqual([...new Set(actions)].sort(), ['alias-add', 'alias-remove', 'register', 'status'], 'no rename, merge or folder action is ever requested');
  assert.ok(/apply\.disabled = true/.test(code) && !/apply\.disabled = false|apply\.addEventListener/.test(code), 'the apply button exists only disabled, with no handler');
  assert.ok(!/Rename Folder/i.test(code), 'no "Rename Folder Too" control');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|ipcRenderer|require\(/.test(code), 'textContent only, no direct IPC');
});

t('photographerRegistryUI.js (Q5c): browsing reads only the four read channels, no HTML injection', () => {
  const src = require('fs').readFileSync(path.join(ROOT, Q5C_MODULE), 'utf8');
  const calls = [...src.matchAll(/api\.(\w+)\(/g)].map(m => m[1]);
  assert.deepEqual([...new Set(calls)].sort(), ['photographerRegistryCamera', 'photographerRegistryLoad', 'photographerRegistryPhotographer', 'photographerRegistrySearch']);
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src), 'text is set with textContent only');
  assert.ok(!/ipcRenderer|require\(/.test(src), 'no direct IPC or module access');
});

t('no main-window asset or style changed (only new tray assets added)', () => {
  const offending = [...changed].filter(f => f.startsWith('assets/') && !f.startsWith('assets/tray/'));
  assert.deepEqual(offending, []);
});

t('companion UI is confined to renderer/companion/ and its own preload', () => {
  const companionFiles = [...changed].filter(f => /companion/i.test(f));
  assert.ok(companionFiles.includes('main/companionPreload.js'), 'dedicated preload present');
  assert.ok(companionFiles.some(f => f.startsWith('renderer/companion/')), 'companion renderer present');
});

t('main.js contains no remaining first-window progress routing (R1)', () => {
  const src = require('fs').readFileSync(path.join(ROOT, 'main', 'main.js'), 'utf8');
  assert.equal((src.match(/BrowserWindow\.getAllWindows\(\)\.find\(/g) || []).length, 0);
});

console.log(`${passed} passed (base ${BASE} @ ${mergeBase.slice(0, 7)})`);
