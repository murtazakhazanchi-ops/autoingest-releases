'use strict';

// Regression test for the Canonical Representation Audit's L3 finding
// (2026-08-11): renderer/eventCreator.js's _openSeqModal() built its
// photographer-sequence sort list by trusting `seqData.sequence` (read from
// event.json's persisted `photographerSequences` block) without re-checking
// its type — the write side (main.js's applyPhotographerSequence handler)
// enforces `typeof entry.sequence === 'number'` before persisting, but
// nothing guaranteed a read-back value stayed that type (a hand-edited file,
// a future format). The comparator `a.sequence - b.sequence` would silently
// produce NaN for a non-numeric value, corrupting sort order rather than
// crashing — lower blast radius than BUG-011, same missing-symmetry pattern.
//
// Mirrors the exact fixed expression verbatim (source-drift guarded, TEST 0)
// rather than driving the real UI — `_openSeqModal()` is a private,
// module-scoped renderer function reachable only through the "Sort QMZ
// Photos" button after a full photographer-folder fetch via IPC; the actual
// defect is pure JS logic with no filesystem/IPC involvement, so a mirror is
// the right-sized test here, same pattern already used for
// bug011SequenceTypeMismatch.test.js's TEST 1b.
//
// Run: node test/l3PhotographerSequenceNormalization.test.js

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

// ── TEST 0: source-drift guard — the exact fixed expression must still be
// present in renderer/eventCreator.js, verbatim. ────────────────────────────
(function test0() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'eventCreator.js'), 'utf8');
  const expected = "const seqNum = typeof seqData?.sequence === 'number' ? seqData.sequence : Number(seqData?.sequence);";
  if (src.includes(expected)) {
    ok('TEST 0: source-drift guard — the L3 normalization expression is present verbatim in eventCreator.js');
  } else {
    fail('TEST 0: eventCreator.js no longer contains the expected L3 normalization expression — this test needs updating to match', expected);
  }
})();

// Mirrors _openSeqModal()'s per-photographer classification loop, verbatim
// logic (see TEST 0's source-drift guard).
function classifyPhotographers(photographers, scopeExisting) {
  const sequenced = [];
  const unsequenced = [];
  for (const ph of photographers) {
    const seqData = scopeExisting[ph.canonical];
    const seqNum = typeof seqData?.sequence === 'number' ? seqData.sequence : Number(seqData?.sequence);
    if (seqData?.sequence && Number.isFinite(seqNum)) {
      sequenced.push({ canonical: ph.canonical, sequence: seqNum });
    } else {
      unsequenced.push({ canonical: ph.canonical });
    }
  }
  sequenced.sort((a, b) => a.sequence - b.sequence);
  return { sequenced, unsequenced };
}

(function tests() {
  const photographers = [{ canonical: 'PC01' }, { canonical: 'PC02' }, { canonical: 'PC03' }, { canonical: 'PC04' }];

  // TEST 1: normal, correctly-typed numeric sequences sort correctly.
  {
    const scopeExisting = {
      PC01: { sequence: 3 }, PC02: { sequence: 1 }, PC03: { sequence: 2 }, PC04: {},
    };
    const { sequenced, unsequenced } = classifyPhotographers(photographers, scopeExisting);
    try {
      assert.deepStrictEqual(sequenced.map(s => s.canonical), ['PC02', 'PC03', 'PC01']);
      assert.deepStrictEqual(unsequenced.map(s => s.canonical), ['PC04']);
      ok('TEST 1: normally-typed numeric sequences sort correctly, no-sequence photographer routes to unsequenced');
    } catch (err) { fail('TEST 1: normal case mismatch', err.message); }
  }

  // TEST 2: the exact BUG-011-class case — a numeric-string sequence is
  // coerced to a real number and sorts correctly (not lexically, not NaN).
  {
    const scopeExisting = {
      PC01: { sequence: '10' }, PC02: { sequence: '2' }, PC03: { sequence: 1 }, PC04: {},
    };
    const { sequenced } = classifyPhotographers(photographers, scopeExisting);
    try {
      // Lexical ("10" < "2") would have produced ['PC01','PC02','PC03'] if
      // left as strings — numeric coercion must produce this order instead.
      assert.deepStrictEqual(sequenced.map(s => s.canonical), ['PC03', 'PC02', 'PC01']);
      assert.equal(typeof sequenced[0].sequence, 'number');
      ok('TEST 2: numeric-string sequence values are coerced to real numbers and sort numerically, not lexically or via NaN');
    } catch (err) { fail('TEST 2: numeric-string coercion case mismatch', err.message); }
  }

  // TEST 3: a genuinely non-numeric, non-coercible sequence value falls back
  // to "unsequenced" instead of producing NaN in the comparator (which would
  // silently corrupt the sort order of every OTHER entry too, since
  // Array.prototype.sort()'s behavior with a NaN-returning comparator is
  // unspecified).
  {
    const scopeExisting = {
      PC01: { sequence: 'corrupted-value' }, PC02: { sequence: 2 }, PC03: { sequence: 1 }, PC04: {},
    };
    const { sequenced, unsequenced } = classifyPhotographers(photographers, scopeExisting);
    try {
      assert.deepStrictEqual(sequenced.map(s => s.canonical), ['PC03', 'PC02']);
      assert.ok(unsequenced.some(u => u.canonical === 'PC01'), 'PC01 (corrupted sequence) should have landed in unsequenced');
      assert.ok(sequenced.every(s => Number.isFinite(s.sequence)), 'no NaN ever reaches the sequenced array');
      ok('TEST 3: a non-coercible sequence value safely falls back to unsequenced — no NaN reaches the comparator');
    } catch (err) { fail('TEST 3: non-coercible fallback case mismatch', err.message); }
  }

  // TEST 4: backward compatibility — sequence: 0 (falsy) still routes to
  // unsequenced exactly as before this fix (the write-side guard requires
  // sequence >= 1, so this should never occur in practice, but the fix must
  // not change this pre-existing edge-case behavior).
  {
    const scopeExisting = { PC01: { sequence: 0 } };
    const { sequenced, unsequenced } = classifyPhotographers([{ canonical: 'PC01' }], scopeExisting);
    try {
      assert.equal(sequenced.length, 0);
      assert.equal(unsequenced.length, 1);
      ok('TEST 4: sequence:0 (falsy) still routes to unsequenced — pre-existing edge-case behavior unchanged');
    } catch (err) { fail('TEST 4: sequence:0 backward-compatibility mismatch', err.message); }
  }
})();

console.log(`\n${passed} test(s) passed.`);
