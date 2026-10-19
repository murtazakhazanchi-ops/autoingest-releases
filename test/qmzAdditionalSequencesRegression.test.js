'use strict';

// Regression test for "QMZ Sequence Enhancements" — Phase 7A: manually-inserted ADDITIONAL
// sequences. A manually-inserted sequence is created the same way any other sequence is
// (createSequence/createReviewedSequences/editSequenceType), but with a non-empty lowercase
// SUFFIX that represents an INSERTION POSITION ("first additional sequence after 3", etc.) —
// independent of which event type eventually occupies it. This file verifies:
//
//   - renderer/qmzSequenceFormat.js's nextAvailableSuffix() suggests the next unused suffix
//     letter for a given number, scanning ALL types (never scoped to one letter).
//   - main/qmzService.js's createSequence() now rejects a DIFFERENT code that would occupy
//     an already-used (number, suffix) position ("03aAQ" vs "03aO" conflict), while still
//     allowing the exact same code to be re-created idempotently, and never touching any
//     other sequence's folder (no renumbering).
//   - createReviewedSequences() catches the same conflict WITHIN one batch (two reviewed
//     entries fighting over one new position), not just against pre-existing live state.
//   - editSequenceType() carries the same guard defensively, in case two conflicting entries
//     ever reach the state file through any other path (e.g. a pre-feature legacy file).
//   - Manual override: an operator may create "03d" directly without "03b"/"03c" existing.
//
// Requires the real Electron binary (qmzService.js transitively needs Electron's
// app.getPath via services/logger.js — plain `node` fails):
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
//     --no-sandbox --user-data-dir=<isolated tmp dir> \
//     test/qmzAdditionalSequencesRegression.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..');

let passed = 0;
function ok(name) { passed++; console.log(`  ok — ${name}`); }
function fail(name, detail) {
  process.exitCode = 1;
  console.error(`  FAIL — ${name}`);
  if (detail !== undefined) console.error(detail);
}
async function t(name, fn) {
  try { await fn(); ok(name); }
  catch (err) { fail(name, err && err.stack || err); }
}

async function mkQmzRoot() { return fsp.mkdtemp(path.join(os.tmpdir(), 'ai-qmz-additional-')); }

(async () => {
  const qmz = require(path.join(PROJECT_ROOT, 'main/qmzService'));
  const { createSequence, createReviewedSequences, editSequenceType, readState, saveState } = qmz;
  const { nextAvailableSuffix } = require(path.join(PROJECT_ROOT, 'renderer/qmzSequenceFormat.js'));

  // ═══════════════════ GROUP A — nextAvailableSuffix (pure, type-independent) ═══════════════════
  console.log('=== GROUP A: nextAvailableSuffix suggests the next unused suffix, independent of type ===');

  await t('A1: no existing sequences for this number -> suggests "a"', () => {
    assert.equal(nextAvailableSuffix([], 3), 'a');
    assert.equal(nextAvailableSuffix([{ number: 3, suffix: '' }], 3), 'a', 'a bare (no-suffix) entry at the same number does not count as using a position');
  });

  await t('A2: one additional sequence (any type) used at "a" -> suggests "b", independent of the next type chosen', () => {
    const sequences = [{ number: 3, letter: 'Q', suffix: '' }, { number: 3, letter: 'AQ', suffix: 'a' }];
    assert.equal(nextAvailableSuffix(sequences, 3), 'b', 'must be "b" regardless of whether the next entry will be Q, M, Z, MZ, O, or AQ');
  });

  await t('A3: "a" and "b" both used (different types) -> suggests "c"; a used suffix for a DIFFERENT number does not count', () => {
    const sequences = [
      { number: 3, letter: 'AQ', suffix: 'a' },
      { number: 3, letter: 'O', suffix: 'b' },
      { number: 4, letter: 'Q', suffix: 'a' }, // different base number — irrelevant to number=3's suggestion
    ];
    assert.equal(nextAvailableSuffix(sequences, 3), 'c');
    assert.equal(nextAvailableSuffix(sequences, 4), 'b', 'number 4 already has "a" used, so its own next suggestion is "b"');
  });

  await t('A4: a-z all used -> returns null (manual override path remains the only way forward)', () => {
    const sequences = [];
    for (let c = 97; c <= 122; c++) sequences.push({ number: 7, letter: 'Q', suffix: String.fromCharCode(c) });
    assert.equal(nextAvailableSuffix(sequences, 7), null);
  });

  // ═══════════════════ GROUP B — createSequence(): insertion-position conflict ═══════════════════
  console.log('=== GROUP B: createSequence() position-conflict enforcement ===');

  await t('B1: create the base sequence "03Q" (no suffix) — succeeds, unaffected by this feature', async () => {
    const root = await mkQmzRoot();
    const r = await createSequence(root, 3, 'Q');
    assert.equal(r.ok, true);
    assert.equal(r.code, '03Q');
  });

  await t('B2: create an additional sequence "03aAQ" after it — succeeds, base "03Q" is never renamed/moved/renumbered', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 3, 'Q');
    const r = await createSequence(root, 3, 'AQ', 'a');
    assert.equal(r.ok, true);
    assert.equal(r.code, '03aAQ');
    assert.ok(fs.existsSync(path.join(root, '03Q')), 'base sequence folder "03Q" must still exist, untouched');
    assert.ok(fs.existsSync(path.join(root, '03aAQ')), 'new additional sequence folder must exist');
    const state = await readState(root);
    assert.deepStrictEqual(state.sequences.map(s => s.code).sort(), ['03Q', '03aAQ']);
  });

  await t('B3: a DIFFERENT type at the SAME position ("03aO" after "03aAQ" exists) is rejected — no folder, no state entry', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 3, 'Q');
    await createSequence(root, 3, 'AQ', 'a');
    const r = await createSequence(root, 3, 'O', 'a');
    assert.equal(r.ok, false);
    assert.match(r.error, /already used by 03aAQ/);
    assert.ok(!fs.existsSync(path.join(root, '03aO')), 'rejected request must never create a folder on disk');
    const state = await readState(root);
    assert.ok(!state.sequences.some(s => s.code === '03aO'), 'rejected request must never add a state entry');
    assert.equal(state.sequences.length, 2, 'the two pre-existing sequences are completely unaffected by the rejection');
  });

  await t('B4: a DIFFERENT suffix at the same base number ("03bO") does NOT conflict with "03aAQ" — succeeds', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 3, 'Q');
    await createSequence(root, 3, 'AQ', 'a');
    const r = await createSequence(root, 3, 'O', 'b');
    assert.equal(r.ok, true);
    assert.equal(r.code, '03bO');
  });

  await t('B5: re-creating the EXACT same code ("03aAQ" again) is idempotent, not a conflict (self-match is excluded)', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 3, 'Q');
    await createSequence(root, 3, 'AQ', 'a');
    const r = await createSequence(root, 3, 'AQ', 'a');
    assert.equal(r.ok, true);
    assert.equal(r.status, 'already-exists');
    const state = await readState(root);
    assert.equal(state.sequences.filter(s => s.code === '03aAQ').length, 1, 'no duplicate state entry was created');
  });

  await t('B6: a bare (no-suffix) number may still host more than one type — pre-existing behavior is completely unchanged', async () => {
    const root = await mkQmzRoot();
    const rQ = await createSequence(root, 5, 'Q');
    const rM = await createSequence(root, 5, 'M');
    assert.equal(rQ.ok, true);
    assert.equal(rM.ok, true, 'the position-conflict rule only applies to SUFFIXED (additional) sequences, never to the bare base number');
  });

  await t('B7: manual override — "03d" may be created directly without "03a"/"03b"/"03c" existing first', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 3, 'Q');
    const r = await createSequence(root, 3, 'M', 'd');
    assert.equal(r.ok, true);
    assert.equal(r.code, '03dM');
    const state = await readState(root);
    assert.equal(state.sequences.length, 2);
  });

  await t('B8: multiple additional sequences at increasing numbers sort chronologically and none renumbers another', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 3, 'Q');
    await createSequence(root, 3, 'AQ', 'a');
    await createSequence(root, 3, 'O', 'b');
    await createSequence(root, 4, 'M');
    const state = await readState(root);
    assert.deepStrictEqual(state.sequences.map(s => s.code), ['03Q', '03aAQ', '03bO', '04M'],
      'sort order must be chronological: base before its own additional sequences, both before the next base number');
    for (const code of ['03Q', '03aAQ', '03bO', '04M']) {
      assert.ok(fs.existsSync(path.join(root, code)), `${code} folder must exist at its own, never-renamed path`);
    }
  });

  // ═══════════════════ GROUP C — createReviewedSequences(): batch-level conflict ═══════════════════
  console.log('=== GROUP C: createReviewedSequences() catches the same conflict WITHIN one batch ===');

  await t('C1: two batch entries sharing a position with different types are BOTH flagged duplicate-in-request, neither created', async () => {
    const root = await mkQmzRoot();
    const { ok: batchOk, results } = await createReviewedSequences(root, [
      { number: 3, letter: 'Q' },
      { number: 3, letter: 'AQ', suffix: 'a' },
      { number: 3, letter: 'O', suffix: 'a' },
    ]);
    assert.equal(batchOk, false);
    const aq = results.find(r => r.letter === 'AQ');
    const o  = results.find(r => r.letter === 'O');
    assert.equal(aq.status, 'duplicate-in-request');
    assert.equal(o.status, 'duplicate-in-request');
    const state = await readState(root);
    assert.ok(!state.sequences.some(s => s.number === 3 && s.suffix === 'a'), 'neither conflicting entry was created');
    assert.ok(state.sequences.some(s => s.code === '03Q'), 'the unrelated, non-conflicting entry in the same batch was still created normally');
  });

  await t('C2: two batch entries with the identical exact code are still flagged duplicate-in-request (pre-existing rule, unaffected)', async () => {
    const root = await mkQmzRoot();
    const { results } = await createReviewedSequences(root, [
      { number: 3, letter: 'AQ', suffix: 'a' },
      { number: 3, letter: 'AQ', suffix: 'a' },
    ]);
    assert.ok(results.every(r => r.status === 'duplicate-in-request'));
  });

  await t('C3: entries with different suffixes for the same base number all create successfully in one batch', async () => {
    const root = await mkQmzRoot();
    const { ok: batchOk, results } = await createReviewedSequences(root, [
      { number: 3, letter: 'Q' },
      { number: 3, letter: 'AQ', suffix: 'a' },
      { number: 3, letter: 'O', suffix: 'b' },
    ]);
    assert.equal(batchOk, true);
    assert.ok(results.every(r => r.status === 'created'));
  });

  await t('C4: a batch entry colliding with PRE-EXISTING live state (not the same batch) is rejected by createSequence() itself, reported as "error"', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 3, 'Q');
    await createSequence(root, 3, 'AQ', 'a');
    const { ok: batchOk, results } = await createReviewedSequences(root, [
      { number: 3, letter: 'O', suffix: 'a' },
    ]);
    assert.equal(batchOk, false);
    assert.equal(results[0].status, 'error');
    assert.match(results[0].error, /already used by 03aAQ/);
  });

  // ═══════════════════ GROUP D — editSequenceType(): defensive position-conflict guard ═══════════════════
  console.log('=== GROUP D: editSequenceType() carries the same guard defensively ===');

  await t('D1: editing a suffixed sequence into a type that would collide with another existing (number,suffix) entry is rejected', async () => {
    // The creation-time guard (Group B) already prevents the LIVE state from ever containing
    // two different-code entries sharing one (number, suffix) position through normal use —
    // so this scenario is only reachable by constructing that state directly (simulating a
    // pre-feature legacy file, or a future bug elsewhere) via readState/saveState, exactly as
    // test/qmzWorkspaceMaintenanceRegression.test.js's own established technique for exercising
    // a defensive guard against a state shape normal callers cannot produce. The injected
    // conflicting entry is "07aM" — a DIFFERENT literal code from the "07aO" the edit below
    // would produce — so this specifically exercises the NEW (number,suffix) guard, not the
    // pre-existing exact-code "already exists" check (which only fires on a literal code match).
    const root = await mkQmzRoot();
    await createSequence(root, 7, 'Q', 'a');       // "07aQ"
    await createSequence(root, 7, 'M');            // bare "07M" — distinct position, no conflict
    const state = await readState(root);
    state.sequences.push({ code: '07aM', number: 7, suffix: 'a', letter: 'M', type: 'Majlis' });
    await saveState(root, state);

    const r = await editSequenceType(root, '07M', 'O'); // unrelated edit (bare number) — must be unaffected
    assert.equal(r.ok, true, 'editing an UNRELATED sequence is never blocked by another position pair existing elsewhere');

    const r2 = await editSequenceType(root, '07aQ', 'O'); // would produce "07aO", a DIFFERENT code from "07aM", but the SAME (7,'a') position
    assert.equal(r2.ok, false);
    assert.match(r2.error, /already used by 07aM/);
    assert.ok(fs.existsSync(path.join(root, '07aQ')), 'rejected edit must leave the source folder exactly where it was');
  });

  // ═══════════════════ GROUP E — suffix format / numeric-ceiling interaction ═══════════════════
  console.log('=== GROUP E: suffix normalization and numeric ceilings still apply to additional sequences ===');

  const { validateSequenceInput, scanRoot, removeSequence } = qmz;

  await t('E1: an uppercase-typed suffix normalizes to lowercase (formatCode/validateSequenceInput convention, unchanged)', () => {
    const v = validateSequenceInput(3, 'AQ', 'A');
    assert.equal(v.ok, true);
    assert.equal(v.code, '03aAQ', 'suffix must always lower-case on the way out, exactly as before this feature');
  });

  await t('E2: a non-alphabetic suffix is rejected', () => {
    const v = validateSequenceInput(3, 'O', '1');
    assert.equal(v.ok, false);
    assert.match(v.error, /Invalid sequence suffix/);
  });

  await t('E3: a letter with no LETTER_MAX entry (AQ) still allows numbers up to MAX_SEQUENCE_NUMBER (99), suffix or not', () => {
    assert.equal(validateSequenceInput(99, 'AQ', 'a').ok, true);
    assert.equal(validateSequenceInput(100, 'AQ', 'a').ok, false, 'format ceiling (two digits) is still enforced');
  });

  await t('E4: a letter WITH its own LETTER_MAX entry (Q=50) still enforces that ceiling even with a suffix present', () => {
    assert.equal(validateSequenceInput(50, 'Q', 'a').ok, true);
    assert.equal(validateSequenceInput(51, 'Q', 'a').ok, false, 'the suffix never raises or bypasses the type-specific ceiling');
  });

  // ═══════════════════ GROUP F — removal, cross-number isolation, folder adoption ═══════════════════
  console.log('=== GROUP F: removal and recognition of additional sequences ===');

  await t('F1: removing one additional sequence leaves its base and sibling additional sequences completely untouched', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 3, 'Q');
    await createSequence(root, 3, 'AQ', 'a');
    await createSequence(root, 3, 'O', 'b');
    const r = await removeSequence(root, '03aAQ');
    assert.equal(r.ok, true);
    assert.ok(!fs.existsSync(path.join(root, '03aAQ')));
    assert.ok(fs.existsSync(path.join(root, '03Q')), 'base sequence must survive a sibling removal');
    assert.ok(fs.existsSync(path.join(root, '03bO')), 'the OTHER additional sequence must survive too');
    const state = await readState(root);
    assert.deepStrictEqual(state.sequences.map(s => s.code).sort(), ['03Q', '03bO']);
  });

  await t('F2: the same suffix letter at two DIFFERENT base numbers never conflicts ("03aAQ" and "13aQ" coexist freely)', async () => {
    const root = await mkQmzRoot();
    const r1 = await createSequence(root, 3, 'AQ', 'a');
    const r2 = await createSequence(root, 13, 'Q', 'a');
    assert.equal(r1.ok, true);
    assert.equal(r2.ok, true, 'the position-conflict check is scoped per base number, not globally by suffix letter alone');
  });

  await t('F3: scanRoot() recognizes additional-sequence folders ("03aAQ"/"03bO") as real sequences, never as unrecognized "other" folders', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 3, 'Q');
    await createSequence(root, 3, 'AQ', 'a');
    await createSequence(root, 3, 'O', 'b');
    const scanned = await scanRoot(root);
    const codes = scanned.sequences.map(s => s.code).sort();
    assert.deepStrictEqual(codes, ['03Q', '03aAQ', '03bO']);
    assert.deepStrictEqual(scanned.other || [], [], 'none of the three folders must be swept into "other"');
  });

  console.log(`\n${passed} check(s) passed.`);
  if (process.exitCode) {
    console.error('\nSome checks FAILED.');
  } else {
    console.log('\nAll checks passed.');
  }
})();
