'use strict';

// Regression test for "QMZ Sequence Enhancements" — Phase 7B: the QMZ event-type set expands
// from Q/M/Z/MZ to a final set of six: Q (Qadam), M (Majlis), Z (Ziyafat), MZ (relabeled from
// "Majlis + Ziyafat" to "Majmui Ziyafat" — MZ is NOT a new code, only its display label
// changes), O (Olda, new), AQ (Aqeeqa, new). This file verifies the extension is purely
// additive everywhere the type set is consulted:
//
//   - renderer/qmzSequenceFormat.js's SEQ_RE/isValidSequenceCode now recognize O/AQ codes and
//     still reject every malformed shape the brief specifically calls out.
//   - main/qmzService.js's formatCode/parseCode/letterToType/LETTER_TYPE correctly produce
//     "Olda"/"Aqeeqa"/"Majmui Ziyafat", while Q/M/Z's own labels and ceilings (50/51/52) are
//     byte-identical to before.
//   - O and AQ fall back to MAX_SEQUENCE_NUMBER (99) exactly like MZ already does — no
//     invented ceiling, per the feature's own explicit instruction.
//   - main/qmzProgramPdfParser.js recognizes "O"/"AQ" as literal Sharaf-column values (the
//     SAME exact-string-match mechanism Q/M/Z/MZ already use — never a free-text/NLP guess)
//     and normalizes them through the real qmzService model, never a second copy of it.
//   - scanRoot() recognizes O/AQ-typed folders as real sequences, never "other".
//   - Full chronological sort order is correct for every format combination across all six
//     types and every suffix position (verified, not assumed, per the feature's own
//     instruction that this never be "naive alphabetical").
//
// Requires the real Electron binary (same constraint as every other qmz*.test.js):
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
//     --no-sandbox --user-data-dir=<isolated tmp dir> \
//     test/qmzExpandedTypesRegression.test.js

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

async function mkQmzRoot() { return fsp.mkdtemp(path.join(os.tmpdir(), 'ai-qmz-types-')); }

(async () => {
  const qmz = require(path.join(PROJECT_ROOT, 'main/qmzService'));
  const { formatCode, parseCode, letterToType, createSequence, validateSequenceInput, scanRoot } = qmz;
  const Fmt = require(path.join(PROJECT_ROOT, 'renderer/qmzSequenceFormat.js'));
  const P = require(path.join(PROJECT_ROOT, 'main/qmzProgramPdfParser.js'));

  // ═══════════════════ GROUP A — SEQ_RE / isValidSequenceCode ═══════════════════
  console.log('=== GROUP A: shared SEQ_RE recognizes O/AQ, rejects malformed shapes ===');

  await t('A1: valid new-type codes are accepted', () => {
    for (const code of ['01O', '02AQ', '99O', '03aO', '03bAQ']) {
      assert.ok(Fmt.isValidSequenceCode(code), `${code} must be valid`);
    }
  });

  await t('A2: existing Q/M/Z/MZ codes are still accepted, completely unaffected', () => {
    for (const code of ['01Q', '02M', '03Z', '05aMZ', '06MZ']) {
      assert.ok(Fmt.isValidSequenceCode(code), `${code} must still be valid`);
    }
  });

  await t('A3: brief-specified invalid shapes are rejected', () => {
    for (const code of ['03AAQ', '03aAQQ', '03aUnknown', '03-Q', '03 a AQ', '3Q', 'AQ', '03aaO']) {
      assert.ok(!Fmt.isValidSequenceCode(code), `${code} must be rejected`);
    }
  });

  await t('A4: a non-string input is rejected without throwing', () => {
    assert.equal(Fmt.isValidSequenceCode(null), false);
    assert.equal(Fmt.isValidSequenceCode(undefined), false);
    assert.equal(Fmt.isValidSequenceCode(42), false);
  });

  // ═══════════════════ GROUP B — formatCode / parseCode / letterToType ═══════════════════
  console.log('=== GROUP B: formatCode/parseCode/letterToType for the new and relabeled types ===');

  await t('B1: formatCode produces correct O/AQ codes', () => {
    assert.equal(formatCode(1, 'O'), '01O');
    assert.equal(formatCode(2, 'AQ'), '02AQ');
    assert.equal(formatCode(3, 'o'), '03O', 'lowercase letter input still uppercases, as before');
    assert.equal(formatCode(3, 'aq'), '03AQ');
  });

  await t('B2: parseCode round-trips O/AQ codes with the correct type label', () => {
    assert.deepStrictEqual(parseCode('01O'), { number: 1, suffix: '', letter: 'O', type: 'Olda', code: '01O', folderName: '01O' });
    assert.deepStrictEqual(parseCode('02AQ'), { number: 2, suffix: '', letter: 'AQ', type: 'Aqeeqa', code: '02AQ', folderName: '02AQ' });
  });

  await t('B3: letterToType resolves the new types, and MZ\'s relabeled value ("Majmui Ziyafat", not "Majlis + Ziyafat")', () => {
    assert.equal(letterToType('O'), 'Olda');
    assert.equal(letterToType('aq'), 'Aqeeqa');
    assert.equal(letterToType('MZ'), 'Majmui Ziyafat');
    assert.equal(letterToType('mz'), 'Majmui Ziyafat', 'MZ is NOT a new code — only its display label changed');
  });

  await t('B4: Q/M/Z labels and suffix/combined-type round-trips are completely unaffected', () => {
    assert.equal(letterToType('Q'), 'Qadam');
    assert.equal(letterToType('M'), 'Majlis');
    assert.equal(letterToType('Z'), 'Ziyafat');
    assert.deepStrictEqual(parseCode('27M'), { number: 27, suffix: '', letter: 'M', type: 'Majlis', code: '27M', folderName: '27M' });
  });

  await t('B5: an unrecognized letter is still rejected (no accidental over-matching introduced by the alternation change)', () => {
    assert.equal(letterToType('X'), null);
    assert.equal(parseCode('01X'), null);
  });

  // ═══════════════════ GROUP C — numeric ceilings: O/AQ fall back to MAX_SEQUENCE_NUMBER ═══════════════════
  console.log('=== GROUP C: O/AQ have no invented ceiling — same MAX_SEQUENCE_NUMBER=99 fallback as MZ ===');

  await t('C1: shared LETTER_MAX has no O/AQ/MZ entries — only the pre-existing Q/M/Z ceilings', () => {
    assert.deepStrictEqual(Fmt.LETTER_MAX, { Q: 50, M: 51, Z: 52 });
    assert.equal(Fmt.MAX_SEQUENCE_NUMBER, 99);
  });

  await t('C2: validateSequenceInput allows O up to 99, rejects 100 (format ceiling, not a business rule)', () => {
    assert.equal(validateSequenceInput(99, 'O').ok, true);
    assert.equal(validateSequenceInput(100, 'O').ok, false);
  });

  await t('C3: validateSequenceInput allows AQ up to 99, rejects 100', () => {
    assert.equal(validateSequenceInput(99, 'AQ').ok, true);
    assert.equal(validateSequenceInput(100, 'AQ').ok, false);
  });

  await t('C4: createSequence actually creates O/AQ sequences at numbers above Q/M/Z\'s own ceilings (e.g. 60)', async () => {
    const root = await mkQmzRoot();
    const rO  = await createSequence(root, 60, 'O');
    const rAQ = await createSequence(root, 61, 'AQ');
    assert.equal(rO.ok, true);
    assert.equal(rAQ.ok, true);
    assert.ok(fs.existsSync(path.join(root, '60O')));
    assert.ok(fs.existsSync(path.join(root, '61AQ')));
  });

  // ═══════════════════ GROUP D — PDF parser recognizes O/AQ as literal Sharaf values ═══════════════════
  console.log('=== GROUP D: qmzProgramPdfParser.js recognizes O/AQ exactly like Q/M/Z/MZ ===');

  await t('D1: _classifyRow treats a row with Sharaf="O" as a recognized data row (not excluded)', () => {
    const layout = { sharafIndex: 0, addressIndex: -1, codeIndex: -1 };
    const row = { items: [{ str: '3' }] };
    const result = P._classifyRow(row, ['O'], layout);
    assert.equal(result.kind, 'data');
    assert.equal(result.sharaf, 'O');
  });

  await t('D2: _classifyRow treats a row with Sharaf="AQ" as a recognized data row (not excluded)', () => {
    const layout = { sharafIndex: 0, addressIndex: -1, codeIndex: -1 };
    const row = { items: [{ str: '7' }] };
    const result = P._classifyRow(row, ['AQ'], layout);
    assert.equal(result.kind, 'data');
    assert.equal(result.sharaf, 'AQ');
  });

  await t('D3: an unrecognized single letter ("X") is still excluded and flagged, not accidentally matched by the widened alternation', () => {
    const layout = { sharafIndex: 0, addressIndex: -1, codeIndex: -1 };
    const row = { items: [{ str: '1' }] };
    const result = P._classifyRow(row, ['X'], layout);
    assert.equal(result.kind, 'excluded');
    assert.equal(result.reason, 'unrecognized-sharaf');
  });

  await t('D4: the "N" (not-applicable) marker is still excluded distinctly, never confused with "O"', () => {
    const layout = { sharafIndex: 0, addressIndex: -1, codeIndex: -1 };
    const row = { items: [{ str: '1' }] };
    const result = P._classifyRow(row, ['N'], layout);
    assert.equal(result.kind, 'excluded');
    assert.equal(result.reason, 'sharaf-not-applicable');
  });

  await t('D5: _normalizeEntry builds a correct O entry via the real qmzService model (formatCode/parseCode/letterToType), not a second copy', () => {
    const { entry, warning } = P._normalizeEntry({ kind: 'data', sequenceRaw: '4', sharaf: 'O' }, 1, 1);
    assert.equal(warning, null);
    assert.equal(entry.folderName, '04O');
    assert.equal(entry.type, 'Olda');
  });

  await t('D6: _normalizeEntry builds a correct suffixed AQ entry, case-normalized suffix included', () => {
    const { entry, warning } = P._normalizeEntry({ kind: 'data', sequenceRaw: '4A', sharaf: 'AQ' }, 1, 1);
    assert.equal(warning, null);
    assert.equal(entry.folderName, '04aAQ');
    assert.equal(entry.suffix, 'a');
    assert.equal(entry.type, 'Aqeeqa');
  });

  await t('D7: existing Q/M/Z/MZ normalization is completely unaffected', () => {
    const { entry } = P._normalizeEntry({ kind: 'data', sequenceRaw: '5A', sharaf: 'MZ' }, 1, 1);
    assert.equal(entry.folderName, '05aMZ');
    assert.equal(entry.type, 'Majmui Ziyafat', 'the PDF-parsed label also reflects the relabel, since it reads through letterToType/parseCode');
  });

  // ═══════════════════ GROUP E — scanRoot() recognizes O/AQ folders ═══════════════════
  console.log('=== GROUP E: scanRoot() recognizes O/AQ-typed folders as real sequences, never "other" ===');

  await t('E1: a workspace with one of every type (including O/AQ) is scanned with none swept into "other"', async () => {
    const root = await mkQmzRoot();
    for (const [n, letter] of [[1, 'Q'], [2, 'M'], [3, 'Z'], [4, 'MZ'], [5, 'O'], [6, 'AQ']]) {
      await createSequence(root, n, letter);
    }
    const scanned = await scanRoot(root);
    assert.deepStrictEqual(scanned.other, []);
    assert.deepStrictEqual(scanned.sequences.map(s => s.code), ['01Q', '02M', '03Z', '04MZ', '05O', '06AQ']);
    assert.deepStrictEqual(scanned.sequences.map(s => s.type), ['Qadam', 'Majlis', 'Ziyafat', 'Majmui Ziyafat', 'Olda', 'Aqeeqa']);
  });

  // ═══════════════════ GROUP F — chronological sort, verified for every format combination ═══════════════════
  console.log('=== GROUP F: sequence sort order is chronological, never "naive alphabetical", across all 6 types ===');

  await t('F1: a mixed set of all six types, suffixed and bare, sorts in true chronological order', async () => {
    const root = await mkQmzRoot();
    const specs = [
      [3, 'Q', ''], [3, 'AQ', 'a'], [3, 'O', 'b'],
      [4, 'M', ''], [4, 'MZ', 'a'],
      [9, 'Z', ''], [10, 'O', ''], [99, 'AQ', ''],
      [1, 'O', ''], [2, 'AQ', ''],
    ];
    for (const [n, l, s] of specs) await createSequence(root, n, l, s);
    const state = await qmz.readState(root);
    assert.deepStrictEqual(
      state.sequences.map(s => s.code),
      ['01O', '02AQ', '03Q', '03aAQ', '03bO', '04M', '04aMZ', '09Z', '10O', '99AQ'],
      'base-before-additional, suffix letter order, and numeric order (incl. single- vs double-digit) must all hold simultaneously'
    );
  });

  await t('F2: a bare (no-suffix) code always sorts before ANY suffixed code at the same base number, for every type pairing', () => {
    // Verified structurally (not just empirically for one pair): formatCode always places the
    // (lowercase) suffix character — or, when absent, the (uppercase) type letter — at the
    // same string position immediately after the 2-digit number. Since every lowercase ASCII
    // letter (97-122) sorts after every uppercase ASCII letter (65-90), a bare code's type
    // letter at that position always compares less than any suffixed code's suffix letter at
    // the same position, for every one of the 6 x 6 (type, type) pairings.
    const types = ['Q', 'M', 'Z', 'MZ', 'O', 'AQ'];
    for (const bareType of types) {
      for (const sufType of types) {
        const bare   = formatCode(5, bareType);
        const suffed = formatCode(5, sufType, 'a');
        assert.ok(bare < suffed, `${bare} must sort before ${suffed}`);
      }
    }
  });

  console.log(`\n${passed} check(s) passed.`);
  if (process.exitCode) {
    console.error('\nSome checks FAILED.');
  } else {
    console.log('\nAll checks passed.');
  }
})();
