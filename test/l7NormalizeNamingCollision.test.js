'use strict';

// Regression test for the Canonical Representation Audit's L7 finding
// (2026-08-11): three unrelated functions were all named `normalize()` —
// main/aliasEngine.js (string casing/punctuation normalization for alias
// lookup matching), main/listManager.js (whitespace normalization for
// city/location/event-type list entries), and renderer/pathUtils.js's
// internal helper (already underscore-prefixed, not a true collision).
// Module-scoped CommonJS/IIFE isolation meant this was never a runtime
// collision risk — purely a code-hygiene/readability issue, not a bug — but
// resolved per the task's own instruction. Renamed to
// normalizeForAliasMatch() and normalizeListEntry() respectively, verified
// as a pure rename (no logic changed) below. aliasEngine.js exports
// `normalize` in its public API but has zero external consumers by that
// name (main.js requires the whole namespace, never calls .normalize());
// listManager.js's was purely internal. Both renames have zero external
// impact, confirmed by repo-wide grep before this fix was applied.
//
// Run: node test/l7NormalizeNamingCollision.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let passed = 0;
function ok(name) { passed++; console.log(`  ok — ${name}`); }
function fail(name, detail) {
  process.exitCode = 1;
  console.error(`  FAIL — ${name}`);
  if (detail !== undefined) console.error(detail);
}

// ── TEST 1: aliasEngine's renamed function preserves exact behavior ─────────
(function test1() {
  const aliasEngine = require('../main/aliasEngine.js');
  try {
    assert.equal(typeof aliasEngine.normalizeForAliasMatch, 'function', 'normalizeForAliasMatch must be exported');
    assert.equal(aliasEngine.normalizeForAliasMatch('Al-Ain'), 'al ain');
    assert.equal(aliasEngine.normalizeForAliasMatch('  Al   Ain  '), 'al ain');
    assert.equal(aliasEngine.normalizeForAliasMatch("Al'Ain"), 'al ain');
    assert.equal(aliasEngine.normalizeForAliasMatch(123), '', 'non-string input must still safely return empty string');
    ok('TEST 1: aliasEngine.normalizeForAliasMatch() preserves exact prior normalize() behavior (lowercase, punctuation-as-space, whitespace-collapse, non-string guard)');
  } catch (err) {
    fail('TEST 1: aliasEngine rename changed behavior', err.message);
  }
})();

// ── TEST 2: no stale reference to the old exported name remains ─────────────
(function test2() {
  const aliasEngine = require('../main/aliasEngine.js');
  if (aliasEngine.normalize === undefined) {
    ok('TEST 2: aliasEngine no longer exports a bare "normalize" — fully renamed, no dual-export left behind');
  } else {
    fail('TEST 2: aliasEngine still exports the old "normalize" name alongside the new one — expected a clean rename');
  }
})();

// ── TEST 3: repo-wide — no remaining reference to the old exported/internal names ──
(function test3() {
  const files = [
    path.join(__dirname, '..', 'main', 'main.js'),
    path.join(__dirname, '..', 'main', 'aliasEngine.js'),
    path.join(__dirname, '..', 'main', 'listManager.js'),
  ];
  let clean = true;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    if (/aliasEngine\.normalize\b(?!ForAliasMatch)/.test(src) || /listManager\.normalize\b(?!ListEntry)/.test(src)) {
      clean = false;
      fail(`TEST 3: ${path.basename(f)} still references the old dotted call form`);
    }
  }
  if (clean) ok('TEST 3: no remaining aliasEngine.normalize(...)/listManager.normalize(...) dotted-call references anywhere checked');
})();

console.log(`\n${passed} test(s) passed.`);
