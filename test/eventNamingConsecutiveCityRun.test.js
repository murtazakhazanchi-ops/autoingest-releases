'use strict';

// Regression test for the consecutive-city-run naming bug (reported against
// the real event 1448-03-27 _03-... on stable/0.9 at merge commit 9ae32ac):
// a multi-component event whose OVERALL EVENT NAME had consecutive
// same-city components getting that city appended once PER COMPONENT
// instead of once per consecutive run, e.g.
// "...QMZ-Mundra-Ziyarat-...-Mundra-Muaina-...-Mundra" instead of
// "...QMZ-Ziyarat-...-Muaina-...-Mundra".
//
// Root cause: renderer/eventCreator.js's _buildCompString() computed a
// single GLOBAL "allSameCity" boolean ("do ALL components share one
// city?") rather than asking, per component, "does the city change here?"
// — correct only when every component shared one city, or when no two
// consecutive components ever shared a city.
//
// Fixed by extracting the rule into shouldAppendCity() in
// renderer/eventNamingRules.js (dual-exported the same way
// renderer/pathUtils.js already solves this for other small cross-cutting
// renderer helpers — see test/l6SeqPrefixDeduplication.test.js for the
// identical precedent).
//
// IMPORTANT CORRECTION: a first pass of this fix mistakenly applied that
// SAME consecutive-run rule to buildFolderName() (component SUB-FOLDER
// names) too. That was wrong -- a sub-folder is a standalone directory
// entry that must be self-describing on its own; collapsing its city
// because a sibling shares it makes an individual folder (e.g. "02-QMZ")
// impossible to identify by city without inspecting neighbors. The
// original, pre-fix `allSameCity` GLOBAL check was actually already
// correct for sub-folders (verified directly: the real historical event's
// own persisted sub-folder names already matched it) -- it was only ever
// wrong for the overall event name. shouldAppendCityToSubfolders()
// restores that original event-wide rule for sub-folders specifically,
// while shouldAppendCity() keeps the consecutive-run fix for the overall
// name. The two rules are DIFFERENT and deliberately not interchangeable.
//
// Run: node test/eventNamingConsecutiveCityRun.test.js

const assert = require('node:assert/strict');
const { shouldAppendCity, shouldAppendCityToSubfolders } = require('../renderer/eventNamingRules.js');

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

// ── 10. Sub-folder naming rule is DIFFERENT from the overall-name rule ──────
// shouldAppendCityToSubfolders(comps) is ONE decision for the whole event
// (apply to every component's own folder name) -- true whenever there is
// ANY city diversity, false only when every component shares one city.
(function test10a() {
  try {
    // All-same-city: no sub-folder shows a city.
    assert.equal(shouldAppendCityToSubfolders([comp('A', 'Surat'), comp('B', 'Surat'), comp('C', 'Surat')]), false);
    ok('sub-folder rule: all-same-city event -> false (no city on any sub-folder)');
  } catch (e) { fail('sub-folder rule: all-same-city', e); }
})();

(function test10b() {
  try {
    // The real reported case (Mandvi/Mundra/Mundra/Mundra): every sub-folder
    // shows its own city, including the three consecutive Mundra ones --
    // deliberately NOT collapsed, unlike the overall event name.
    const comps = [comp('Ziyarat', 'Mandvi', 'Mazar e Noorani'), comp('QMZ', 'Mundra'), comp('Ziyarat', 'Mundra', 'Rani Behensaheba (Mundra)'), comp('Muaina', 'Mundra', 'Haveli')];
    assert.equal(shouldAppendCityToSubfolders(comps), true);
    ok('sub-folder rule: mixed-city event -> true (every sub-folder shows its own city, no consecutive-run collapsing)');
  } catch (e) { fail('sub-folder rule: mixed-city event', e); }
})();

(function test10c() {
  try {
    // Real historical event's own persisted sub-folder names, verified
    // directly against disk before any fix existed, already matched this
    // exact rule -- confirming the pre-fix `allSameCity` behavior was
    // correct for sub-folders all along and only ever wrong for the
    // overall event name.
    const realComps = [comp('Ziyarat', 'Mandvi'), comp('QMZ', 'Mundra'), comp('Ziyarat', 'Mundra'), comp('Muaina', 'Mundra')];
    const expectedFolderNames = ['01-Ziyarat-Mandvi', '02-QMZ-Mundra', '03-Ziyarat-Mundra', '04-Muaina-Mundra'];
    const appendCity = shouldAppendCityToSubfolders(realComps);
    const actual = realComps.map((c, idx) => {
      const indexPart = String(idx + 1).padStart(2, '0');
      const types = c.eventTypes.map((t) => t.label).join('-');
      const cityPart = appendCity && c.city?.label ? `-${c.city.label}` : '';
      return `${indexPart}-${types}${cityPart}`;
    });
    assert.deepEqual(actual, expectedFolderNames, 'reconstructed sub-folder names must match the real historical event\'s own pre-existing, already-correct folder names');
    ok('sub-folder rule: matches the real historical event\'s own already-correct persisted folder names');
  } catch (e) { fail('sub-folder rule: matches real historical event', e); }
})();

(function test10d() {
  try {
    // Single component always shows its own city.
    assert.equal(shouldAppendCityToSubfolders([comp('A', 'Surat')]), true);
    ok('sub-folder rule: single component -> true');
  } catch (e) { fail('sub-folder rule: single component', e); }
})();

(function test10e() {
  try {
    assert.equal(shouldAppendCityToSubfolders([]), false);
    assert.equal(shouldAppendCityToSubfolders(null), false);
    ok('sub-folder rule: edge cases (empty/invalid input) handled without throwing');
  } catch (e) { fail('sub-folder rule: edge cases', e); }
})();

// ── 10f. Overall-name rule and sub-folder rule are genuinely DIFFERENT for
// the same mixed-city input (this is the whole point of the correction) ──
(function test10f() {
  try {
    const comps = [comp('A', 'Mandvi'), comp('B', 'Mundra'), comp('C', 'Mundra')];
    // Overall name: component 2 (mid-run) does NOT get its own city.
    assert.equal(shouldAppendCity(comps, 1), false, 'overall-name rule: mid-run component does not repeat the city');
    // Sub-folder: EVERY component (including component 2) DOES get its own city.
    assert.equal(shouldAppendCityToSubfolders(comps), true, 'sub-folder rule: every component gets its own city, no run collapsing');
    ok('overall-name rule and sub-folder rule genuinely differ for the same mixed-city input');
  } catch (e) { fail('overall-name vs sub-folder rule difference', e); }
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
