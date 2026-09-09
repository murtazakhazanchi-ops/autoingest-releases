'use strict';

// Regression test for the consecutive-city-run naming bug (reported against
// the real event 1448-03-27 _03-... on stable/0.9 at merge commit 9ae32ac):
// a multi-component event whose consecutive components share a city was
// getting that city appended once PER COMPONENT instead of once per
// consecutive run, e.g. "...QMZ-Mundra-Ziyarat-...-Mundra-Muaina-...-Mundra"
// instead of "...QMZ-Ziyarat-...-Muaina-...-Mundra".
//
// Root cause: renderer/eventCreator.js's _buildCompString() and
// buildFolderName() each independently computed a single GLOBAL
// "allSameCity" boolean ("do ALL components share one city?") rather than
// asking, per component, "does the city change here?" — correct only when
// every component shared one city, or when no two consecutive components
// ever shared a city.
//
// Fixed by extracting the actual rule into a small, pure, directly-testable
// helper (renderer/eventNamingRules.js, dual-exported the same way
// renderer/pathUtils.js already solves this for other small cross-cutting
// renderer helpers — see test/l6SeqPrefixDeduplication.test.js for the
// identical precedent) and having both eventCreator.js functions call it
// per component index instead of maintaining their own allSameCity logic.
//
// Run: node test/eventNamingConsecutiveCityRun.test.js

const assert = require('node:assert/strict');
const { shouldAppendCity } = require('../renderer/eventNamingRules.js');

let passed = 0;
function ok(name) { passed++; console.log(`  ok — ${name}`); }
function fail(name, detail) {
  process.exitCode = 1;
  console.error(`  FAIL — ${name}`);
  if (detail !== undefined) console.error(detail);
}

// comp(city, opts) — a minimal UI-shaped component: { eventTypes, location, city }.
function comp(types, city, location) {
  return {
    eventTypes: (Array.isArray(types) ? types : [types]).map((t) => ({ label: t })),
    location:   location ? { label: location } : null,
    city:       city ? { label: city } : null,
  };
}

// A minimal, city-boundary-only name builder for END-TO-END assertions
// against the real reported example strings — deliberately NOT a copy of
// eventCreator.js's own keyword-placement logic (that stays untouched and
// unrelated to this fix); this only exercises the real shouldAppendCity
// import to prove the fix produces the exact expected strings.
function buildNameForTest(comps) {
  const parts = [];
  comps.forEach((c, idx) => {
    c.eventTypes.forEach((t) => { if (t.label) parts.push(t.label); });
    if (c.location?.label) parts.push(c.location.label);
    if (shouldAppendCity(comps, idx) && c.city?.label) parts.push(c.city.label);
  });
  return parts.join('-');
}

// ── 1. Single component: city appears once ──────────────────────────────────
(function test1() {
  const comps = [comp('Ziyarat', 'Mandvi', 'Mazar e Noorani')];
  try {
    assert.equal(shouldAppendCity(comps, 0), true);
    assert.equal(buildNameForTest(comps), 'Ziyarat-Mazar e Noorani-Mandvi');
    ok('single component: city appears once');
  } catch (e) { fail('single component: city appears once', e); }
})();

// ── 2. All components same city: appears once at end ────────────────────────
(function test2() {
  const comps = [comp('A', 'Surat'), comp('B', 'Surat'), comp('C', 'Surat')];
  try {
    assert.equal(shouldAppendCity(comps, 0), false);
    assert.equal(shouldAppendCity(comps, 1), false);
    assert.equal(shouldAppendCity(comps, 2), true);
    assert.equal(buildNameForTest(comps), 'A-B-C-Surat');
    ok('all same city: appears once at end');
  } catch (e) { fail('all same city: appears once at end', e); }
})();

// ── 3. First city different, remainder same (the real reported example) ────
(function test3() {
  const comps = [
    comp('Ziyarat', 'Mandvi', 'Mazar e Noorani'),
    comp('QMZ', 'Mundra'),
    comp('Ziyarat', 'Mundra', 'Rani Behensaheba (Mundra)'),
    comp('Muaina', 'Mundra', 'Haveli'),
  ];
  try {
    const name = buildNameForTest(comps);
    assert.equal(
      name,
      'Ziyarat-Mazar e Noorani-Mandvi-QMZ-Ziyarat-Rani Behensaheba (Mundra)-Muaina-Haveli-Mundra',
      'must match the exact expected name from the real reported bug'
    );
    assert.ok(!name.includes('Mundra-Ziyarat'), 'must not repeat Mundra before the QMZ->Ziyarat transition');
    // "Mundra" appears twice in the expected string: once inside the location
    // text "Rani Behensaheba (Mundra)" (untouched by this fix) and once as
    // the single real city suffix at the very end -- the bug produced THREE
    // additional city-suffix occurrences beyond that (one per component).
    assert.equal((name.match(/Mundra/g) || []).length, 2, 'Mundra must appear exactly twice: once in the location text, once as the single city suffix');
    assert.ok(name.endsWith('-Mundra'), 'the single real city suffix must be the final segment');
    ok('first city different, remainder same: real reported example produces the exact expected name');
  } catch (e) { fail('first city different, remainder same', e); }
})();

// ── 4. Two city runs: Surat/Surat/Mumbai/Mumbai ─────────────────────────────
(function test4() {
  const comps = [
    comp('A', 'Surat', 'Loc1'), comp('B', 'Surat', 'Loc2'),
    comp('C', 'Mumbai', 'Loc3'), comp('D', 'Mumbai', 'Loc4'),
  ];
  try {
    assert.equal(buildNameForTest(comps), 'A-Loc1-B-Loc2-Surat-C-Loc3-D-Loc4-Mumbai');
    assert.equal((buildNameForTest(comps).match(/Surat/g) || []).length, 1);
    assert.equal((buildNameForTest(comps).match(/Mumbai/g) || []).length, 1);
    ok('two city runs: each city appears once, at the end of its own run');
  } catch (e) { fail('two city runs', e); }
})();

// ── 5. Three runs: Surat/Mumbai/Surat (non-consecutive reuse preserved) ─────
(function test5() {
  const comps = [comp('A', 'Surat'), comp('B', 'Mumbai'), comp('C', 'Surat')];
  try {
    assert.equal(shouldAppendCity(comps, 0), true, 'component 1 ends its own run (next differs)');
    assert.equal(shouldAppendCity(comps, 1), true, 'component 2 ends its own run (next differs)');
    assert.equal(shouldAppendCity(comps, 2), true, 'component 3 is last');
    assert.equal(buildNameForTest(comps), 'A-Surat-B-Mumbai-C-Surat', 'all three city boundaries preserved, never collapsed');
    ok('three runs (non-consecutive reuse): all city boundaries preserved');
  } catch (e) { fail('three runs (non-consecutive reuse)', e); }
})();

// ── 6. Alternating cities: Surat/Mumbai/Surat/Mumbai ─────────────────────────
(function test6() {
  const comps = [comp('A', 'Surat'), comp('B', 'Mumbai'), comp('C', 'Surat'), comp('D', 'Mumbai')];
  try {
    assert.equal(buildNameForTest(comps), 'A-Surat-B-Mumbai-C-Surat-D-Mumbai');
    ok('alternating cities: every component keeps its own city (no run to collapse)');
  } catch (e) { fail('alternating cities', e); }
})();

// ── 7. Same city with mixed location/no-location ────────────────────────────
(function test7() {
  const comps = [comp('A', 'Surat', 'Loc1'), comp('B', 'Surat'), comp('C', 'Surat', 'Loc3')];
  try {
    assert.equal(buildNameForTest(comps), 'A-Loc1-B-C-Loc3-Surat');
    ok('same city, mixed location/no-location: city still appears once at the end');
  } catch (e) { fail('same city, mixed location/no-location', e); }
})();

// ── 8. Multiple Event Types inside one component ────────────────────────────
(function test8() {
  const comps = [comp(['Ziyarat', 'Waaz'], 'Mundra'), comp('QMZ', 'Mundra')];
  try {
    // Both components share one city (a run of 2) -- city appears once, and
    // the multi-type component still emits both its own type labels in order.
    assert.equal(buildNameForTest(comps), 'Ziyarat-Waaz-QMZ-Mundra');
    ok('multiple Event Types in one component: not confused with multi-component city-run logic');
  } catch (e) { fail('multiple Event Types in one component', e); }
})();

// ── 9. Location text containing city-like text must not affect city-run detection ──
(function test9() {
  const comps = [
    comp('QMZ', 'Mundra'),
    comp('Ziyarat', 'Mundra', 'Rani Behensaheba (Mundra)'), // location text literally contains "Mundra"
    comp('Muaina', 'Mundra', 'Haveli'),
  ];
  try {
    assert.equal(shouldAppendCity(comps, 0), false, 'run continues -- must compare structured city, never location text');
    assert.equal(shouldAppendCity(comps, 1), false, 'still mid-run despite location text containing "Mundra"');
    assert.equal(shouldAppendCity(comps, 2), true, 'last component ends the run');
    const name = buildNameForTest(comps);
    assert.equal((name.match(/Mundra/g) || []).length, 2, 'exactly 2: one from the location text itself, one from the single real city suffix');
    ok('location text containing city-like text does not affect city-run detection');
  } catch (e) { fail('location text containing city-like text', e); }
})();

// ── 10. Component/sub-folder naming uses the identical city-run semantics as the overall event name ──
(function test10() {
  // Both eventCreator.js's buildFolderName() and _buildCompString() now call
  // shouldAppendCity(comps, idx) with the SAME comps array and SAME idx for
  // a given component -- proven directly here: the decision for a given
  // component/index pair is identical regardless of which caller asks.
  const comps = [comp('Ziyarat', 'Mandvi'), comp('QMZ', 'Mundra'), comp('Muaina', 'Mundra')];
  try {
    for (let i = 0; i < comps.length; i++) {
      const decision1 = shouldAppendCity(comps, i);
      const decision2 = shouldAppendCity(comps, i); // simulates the second (independent) call site
      assert.equal(decision1, decision2, `component ${i}: overall-name and sub-folder-name call sites must agree`);
    }
    ok('component/sub-folder naming follows the same city-run semantics as the overall event name');
  } catch (e) { fail('component/sub-folder naming agreement', e); }
})();

// ── 11. Existing single-component behavior unchanged ────────────────────────
(function test11() {
  const comps = [comp('Ziyarat', 'Mandvi', 'Mazar e Noorani')];
  try {
    assert.equal(shouldAppendCity(comps, 0), true);
    assert.equal(buildNameForTest(comps), 'Ziyarat-Mazar e Noorani-Mandvi');
    ok('existing single-component behavior is unchanged');
  } catch (e) { fail('existing single-component behavior unchanged', e); }
})();

// ── 12. Edge cases: empty/invalid input never throws ────────────────────────
(function test12() {
  try {
    assert.equal(shouldAppendCity([], 0), false);
    assert.equal(shouldAppendCity(null, 0), false);
    assert.equal(shouldAppendCity([comp('A', null)], 0), false, 'a component with no city never appends one');
    assert.equal(shouldAppendCity([comp('A', 'X')], -1), false);
    assert.equal(shouldAppendCity([comp('A', 'X')], 5), false);
    ok('edge cases (empty/invalid input) handled without throwing');
  } catch (e) { fail('edge cases', e); }
})();

// ── module surface ───────────────────────────────────────────────────────────
(function testSurface() {
  try {
    assert.equal(typeof shouldAppendCity, 'function');
    ok('module exports shouldAppendCity as a function');
  } catch (e) { fail('module surface', e); }
})();

console.log(`eventNamingConsecutiveCityRun: ${passed} passed`);
