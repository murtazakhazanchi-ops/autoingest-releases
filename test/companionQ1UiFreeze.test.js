'use strict';

// AI-FEAT-061 Q1/Q2 — static guard for the main-window UI freeze (DEC-027).
// Compares this branch against the Stable baseline and fails if any file that
// renders or wires the existing main window / splash changed, apart from the one
// approved non-visual handoff listener (Q2). The companion's own UI must live only
// under renderer/companion/.
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
const diffLines = (file) => git('diff', '-U0', mergeBase, '--', file).split('\n')
  .filter(l => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));

t('no existing renderer file changed except the approved handoff listener (main window, splash, shared modules)', () => {
  const offending = [...changed].filter(f => f.startsWith('renderer/') && !f.startsWith('renderer/companion/') && f !== APPROVED_RENDERER_TOUCH);
  assert.deepEqual(offending, []);
});

t('renderer.js: handoff listener is additions only and draws nothing', () => {
  const lines = diffLines(APPROVED_RENDERER_TOUCH);
  assert.deepEqual(lines.filter(l => l.startsWith('-')), [], 'no existing line removed or changed');
  const drawing = lines.filter(l => /innerHTML|outerHTML|createElement|insertAdjacent|appendChild|replaceChildren|\.style\.|classList\.(add|remove|toggle)|<[a-z]+[ >]/i.test(l));
  assert.deepEqual(drawing, [], 'no DOM, markup or style created');
  if (lines.length) assert.ok(lines.some(l => l.includes('COMPANION HANDOFF')), 'confined to the documented handoff block');
});

t('main-window preload: only the companion handoff channels were added', () => {
  const lines = diffLines('main/preload.js');
  assert.deepEqual(lines.filter(l => l.startsWith('-')), [], 'no existing API removed or changed');
  const allowed = new Set(['companion:openSource', 'companion:openSourceResult', 'companion:workspaceReady']);
  const channels = [...lines.join('\n').matchAll(/'([a-z-]+:[A-Za-z]+)'/g)].map(m => m[1]);
  assert.deepEqual(channels.filter(c => !allowed.has(c)), [], 'no other channel exposed to the main window');
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
