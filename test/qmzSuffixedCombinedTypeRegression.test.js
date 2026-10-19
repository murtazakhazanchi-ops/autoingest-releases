'use strict';

// Regression test for the QMZ sequence-model extension (Stage 1 of
// "PDF-Assisted QMZ Workspace Folder Generation"): main/qmzService.js's
// SEQ_RE/formatCode/parseCode/createSequence/bulkCreateSequences/
// editSequenceType now additionally recognize a lowercase alphabetic
// sequence SUFFIX (a single numbered appointment split across multiple
// honorees — real reference programs carry entries like "5a"/"5b") and a
// combined QMZ type "MZ", while the existing "01Q"-style 2-digit+1-letter
// format is completely unchanged.
//
// Critical safety property under test: scanRoot()/_classifyOtherFolders()
// (and therefore initRoot()'s adoption sweep) must recognize "05aMZ"/"05bMZ"
// as real sequence folders, not as unrecognized "other" folders — before
// this extension, such a folder would have been silently swept into
// _Unsequenced/ the next time an operator ran folder adoption.
//
// LETTER_MAX is deliberately left untouched (Q:50, M:51, Z:52 unchanged) and
// MZ deliberately has NO type-specific ceiling (no rationale for one exists
// anywhere in the codebase/history/docs) — MZ instead falls back to
// MAX_SEQUENCE_NUMBER (99), the sequence-code FORMAT's own structural limit
// (two zero-padded digits), not an invented business rule. See
// main/qmzService.js's own comments on LETTER_MAX/MAX_SEQUENCE_NUMBER.
//
// Requires the real Electron binary (qmzService.js transitively needs
// Electron's app.getPath via services/logger.js — plain `node` fails):
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
//     --no-sandbox --user-data-dir=<isolated tmp dir> \
//     test/qmzSuffixedCombinedTypeRegression.test.js

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

async function mkQmzRoot() { return fsp.mkdtemp(path.join(os.tmpdir(), 'ai-qmz-suffix-')); }

(async () => {
  const qmz = require(path.join(PROJECT_ROOT, 'main/qmzService'));
  const { formatCode, parseCode, letterToType, createSequence, bulkCreateSequences,
    editSequenceType, removeSequence, scanRoot, initRoot, moveFilesToSequence } = qmz;

  // ═══════════════════ GROUP A — existing formats unchanged ═══════════════════
  console.log('=== GROUP A: existing 2-digit + 1-letter formats are completely unchanged ===');

  await t('A1: formatCode(number, letter) — 2-arg calls produce byte-identical output to before', () => {
    assert.equal(formatCode(1, 'Q'), '01Q');
    assert.equal(formatCode(2, 'M'), '02M');
    assert.equal(formatCode(3, 'Z'), '03Z');
    assert.equal(formatCode(10, 'Q'), '10Q');
    assert.equal(formatCode(27, 'M'), '27M');
    assert.equal(formatCode(1, 'q'), '01Q', 'lowercase letter input still uppercases, as before');
  });

  await t('A2: parseCode — existing plain codes parse exactly as before, suffix is "" not undefined', () => {
    for (const code of ['01Q', '02M', '03Z', '10Q', '27M']) {
      const p = parseCode(code);
      assert.ok(p, `${code} must still parse`);
      assert.equal(p.code, code);
      assert.equal(p.folderName, code);
      assert.equal(p.suffix, '', `${code}: suffix must be "" (not undefined) for a plain code`);
    }
    assert.deepStrictEqual(parseCode('05Q'), { number: 5, suffix: '', letter: 'Q', type: 'Qadam', code: '05Q', folderName: '05Q' });
    assert.deepStrictEqual(parseCode('27M'), { number: 27, suffix: '', letter: 'M', type: 'Majlis', code: '27M', folderName: '27M' });
  });

  await t('A3: letterToType unchanged for Q/M/Z', () => {
    assert.equal(letterToType('Q'), 'Qadam');
    assert.equal(letterToType('m'), 'Majlis');
    assert.equal(letterToType('Z'), 'Ziyafat');
  });

  await t('A4: createSequence — existing Q/M/Z ceilings (50/51/52) are completely untouched', async () => {
    const root = await mkQmzRoot();
    const okQ = await createSequence(root, 50, 'Q');
    assert.equal(okQ.ok, true); assert.equal(okQ.code, '50Q');
    const badQ = await createSequence(root, 51, 'Q');
    assert.equal(badQ.ok, false, 'Q must still reject number 51 (ceiling 50, unchanged)');
    const okM = await createSequence(root, 51, 'M');
    assert.equal(okM.ok, true); assert.equal(okM.code, '51M');
    const badM = await createSequence(root, 52, 'M');
    assert.equal(badM.ok, false, 'M must still reject number 52 (ceiling 51, unchanged)');
    const okZ = await createSequence(root, 52, 'Z');
    assert.equal(okZ.ok, true); assert.equal(okZ.code, '52Z');
    const badZ = await createSequence(root, 53, 'Z');
    assert.equal(badZ.ok, false, 'Z must still reject number 53 (ceiling 52, unchanged)');
  });

  await t('A5: scanRoot / createSequence round trip for a plain code, state.sequences entry shape', async () => {
    const root = await mkQmzRoot();
    const r = await createSequence(root, 4, 'Q');
    assert.equal(r.ok, true); assert.equal(r.code, '04Q');
    assert.ok(fs.existsSync(path.join(root, '04Q')), 'folder must exist on disk');
    const scan = await scanRoot(root);
    assert.equal(scan.sequences.length, 1);
    assert.equal(scan.sequences[0].code, '04Q');
    assert.equal(scan.sequences[0].suffix, '', 'plain sequence carries suffix:"" in scanRoot output too');
  });

  // ═══════════════════ GROUP B — new suffixed/combined formats ═══════════════════
  console.log('=== GROUP B: new 05aMZ / 05bMZ formats ===');

  await t('B1: formatCode — the exact required examples from the spec', () => {
    assert.equal(formatCode(5, 'MZ', 'a'), '05aMZ');
    assert.equal(formatCode(5, 'MZ', 'b'), '05bMZ');
    assert.equal(formatCode(1, 'Q', ''), '01Q', 'empty-string suffix behaves identically to omitting it');
  });

  await t('B2: parseCode — 05aMZ / 05bMZ round-trip, including the "MZ" 2-character type', () => {
    const a = parseCode('05aMZ');
    assert.ok(a);
    // "QMZ Sequence Enhancements" relabeled MZ's display type from "Majlis + Ziyafat" to
    // "Majmui Ziyafat" — MZ itself is unchanged, only this string.
    assert.deepStrictEqual(a, { number: 5, suffix: 'a', letter: 'MZ', type: 'Majmui Ziyafat', code: '05aMZ', folderName: '05aMZ' });
    const b = parseCode('05bMZ');
    assert.ok(b);
    assert.equal(b.suffix, 'b');
    assert.equal(b.letter, 'MZ');
  });

  await t('B3: formatCode(parseCode(code)...) round trip is identity for every new-format example', () => {
    for (const code of ['05aMZ', '05bMZ', '09aMZ', '99zMZ']) {
      const p = parseCode(code);
      assert.ok(p, `${code} must parse`);
      assert.equal(formatCode(p.number, p.letter, p.suffix), code, `round trip must reproduce ${code} exactly`);
    }
  });

  await t('B4: createSequence creates a real 05aMZ / 05bMZ folder and distinct state entries', async () => {
    const root = await mkQmzRoot();
    const ra = await createSequence(root, 5, 'MZ', 'a');
    assert.equal(ra.ok, true); assert.equal(ra.code, '05aMZ');
    const rb = await createSequence(root, 5, 'MZ', 'b');
    assert.equal(rb.ok, true); assert.equal(rb.code, '05bMZ');
    assert.ok(fs.existsSync(path.join(root, '05aMZ')));
    assert.ok(fs.existsSync(path.join(root, '05bMZ')));

    const state = await qmz.readState(root);
    assert.equal(state.sequences.length, 2);
    const byCode = Object.fromEntries(state.sequences.map(s => [s.code, s]));
    assert.equal(byCode['05aMZ'].suffix, 'a');
    assert.equal(byCode['05bMZ'].suffix, 'b');
    assert.equal(byCode['05aMZ'].type, 'Majmui Ziyafat');
  });

  await t('B5: MZ is NOT interpreted as two independent sequence folders — exactly one folder per created code', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 6, 'MZ', '');
    const entries = await fsp.readdir(root, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    assert.deepStrictEqual(dirs, ['06MZ'], 'a single combined-type sequence must create exactly one folder named "06MZ", never separate "06M"/"06Z"');
  });

  await t('B6: duplicate detection distinguishes different suffixes of the same base number/type', async () => {
    const root = await mkQmzRoot();
    const items = [{ number: 5, letter: 'MZ', suffix: 'a' }, { number: 5, letter: 'MZ', suffix: 'b' }, { number: 5, letter: 'MZ', suffix: 'a' }];
    const r = await bulkCreateSequences(root, items);
    const state = await qmz.readState(root);
    assert.equal(state.sequences.length, 2, 'the repeated 05aMZ must not be added twice');
    assert.deepStrictEqual(state.sequences.map(s => s.code).sort(), ['05aMZ', '05bMZ']);
  });

  await t('B7: ordering — 04Q, 05Q, 05aMZ, 05bMZ, 06Q sort correctly (plain string comparison on code, unchanged comparator)', async () => {
    const root = await mkQmzRoot();
    const items = [{ number: 6, letter: 'Q' }, { number: 5, letter: 'MZ', suffix: 'b' }, { number: 4, letter: 'Q' }, { number: 5, letter: 'MZ', suffix: 'a' }, { number: 5, letter: 'Q' }];
    await bulkCreateSequences(root, items);
    const state = await qmz.readState(root);
    assert.deepStrictEqual(state.sequences.map(s => s.code), ['04Q', '05Q', '05aMZ', '05bMZ', '06Q'], 'state.sequences must already be stored in this exact order');
    const scan = await scanRoot(root);
    assert.deepStrictEqual(scan.sequences.map(s => s.code), ['04Q', '05Q', '05aMZ', '05bMZ', '06Q'], 'scanRoot must report the same order');
  });

  await t('B8: editSequenceType preserves the suffix across a type change (not silently discarded)', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 5, 'MZ', 'a');
    const r = await editSequenceType(root, '05aMZ', 'Q');
    assert.equal(r.ok, true);
    assert.equal(r.code, '05aQ', 'the suffix "a" must survive the type edit from MZ to Q');
    assert.ok(!fs.existsSync(path.join(root, '05aMZ')), 'old folder must be gone');
    assert.ok(fs.existsSync(path.join(root, '05aQ')), 'renamed folder must exist');
    const state = await qmz.readState(root);
    assert.equal(state.sequences[0].suffix, 'a');
    assert.equal(state.sequences[0].letter, 'Q');
  });

  await t('B9: MZ has no type-specific ceiling — large numbers up to the 2-digit format limit (99) are accepted', async () => {
    const root = await mkQmzRoot();
    const r = await createSequence(root, 75, 'MZ');
    assert.equal(r.ok, true, 'MZ must accept a number well above Q/M/Z\'s own 50/51/52 ceilings — no MZ-specific maximum exists');
    assert.equal(r.code, '75MZ');
    const r99 = await createSequence(root, 99, 'MZ');
    assert.equal(r99.ok, true, '99 (the 2-digit format\'s own structural ceiling) must be accepted for MZ');
  });

  await t('B10: moveFilesToSequence works against a suffixed/combined-type code exactly like a plain one', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 5, 'MZ', 'a');
    // Source lives under qmzRoot/_Unsequenced, matching how the real app always discovers a
    // move source (listMediaFiles() only ever scans inside qmzRoot) — a later security-
    // hardening follow-up made moveFilesToSequence() reject any source outside the authorized
    // workspace, which a source in a wholly separate temp directory (this fixture's original
    // form) legitimately now is.
    const srcFile = path.join(root, '_Unsequenced', 'Alihusain Jamali', 'IMG_0001.CR2');
    await fsp.mkdir(path.dirname(srcFile), { recursive: true });
    await fsp.writeFile(srcFile, Buffer.from('not-a-real-raw-file'));
    const r = await moveFilesToSequence(root, [srcFile], '05aMZ', 'Alihusain Jamali');
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(path.join(root, '05aMZ', 'Alihusain Jamali', 'IMG_0001.CR2')));
  });

  // ═══════════════════ GROUP C — normalization ═══════════════════
  console.log('=== GROUP C: normalization — uppercase suffix input, canonical lowercase output ===');

  await t('C1: formatCode always lower-cases the suffix regardless of input case', () => {
    assert.equal(formatCode(5, 'MZ', 'A'), '05aMZ', 'uppercase suffix input must still produce lowercase canonical output');
    assert.equal(formatCode(5, 'MZ', 'B'), '05bMZ');
  });

  await t('C2: createSequence normalizes an uppercase suffix input to the canonical lowercase folder name', async () => {
    const root = await mkQmzRoot();
    const r = await createSequence(root, 5, 'MZ', 'A');
    assert.equal(r.ok, true);
    assert.equal(r.code, '05aMZ', 'canonical output must be lowercase even though "A" (uppercase) was passed in');
    // fs.existsSync() is unreliable for this check on a case-insensitive-but-preserving filesystem
    // (e.g. default macOS APFS) — existsSync('05AMZ') would resolve to the SAME directory as
    // '05aMZ' regardless of what case the entry actually has on disk. readdirSync() (filtered to
    // directories — createSequence also writes qmz-sequences.json into the same root) returns the
    // real on-disk name, which is the only way to verify the actual spelling written.
    const dirEntries = (await fsp.readdir(root, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name);
    assert.deepStrictEqual(dirEntries, ['05aMZ'], 'the directory actually written to disk must be spelled with a lowercase suffix');
  });

  // ═══════════════════ GROUP D — invalid input rejected, not guessed ═══════════════════
  console.log('=== GROUP D: malformed identifiers are rejected, never silently accepted ===');

  await t('D1: parseCode rejects every documented invalid shape', () => {
    for (const bad of ['01 Q', '05A MZ', '05AMZ', '05a MZ', '5aMZ', '05a-MZ', '05_a_MZ', '05aXYZ', 'abc', '', '05', 'Q05', '05QQ']) {
      assert.equal(parseCode(bad), null, `"${bad}" must be rejected (parseCode returns null)`);
    }
  });

  await t('D2: parseCode rejects an unsupported QMZ type and a malformed numeric sequence', () => {
    assert.equal(parseCode('05X'), null, 'unsupported type letter "X"');
    assert.equal(parseCode('5Q'), null, 'single-digit number without zero-padding');
    assert.equal(parseCode('005Q'), null, 'three-digit number');
    assert.equal(parseCode('05abQ'), null, 'two-letter suffix is not supported — must be rejected, not truncated/guessed');
  });

  await t('D3: createSequence rejects a malformed suffix rather than silently stripping or guessing it', async () => {
    const root = await mkQmzRoot();
    const r = await createSequence(root, 5, 'MZ', 'A1');
    assert.equal(r.ok, false, 'a multi-character / non-alphabetic suffix must be rejected outright');
    assert.ok(!fs.existsSync(path.join(root, '05a1MZ')) && !fs.existsSync(path.join(root, '05MZ')), 'no folder of any guessed shape may be created on rejection');
  });

  await t('D4: createSequence still rejects an unsupported letter exactly as before', async () => {
    const root = await mkQmzRoot();
    const r = await createSequence(root, 1, 'X');
    assert.equal(r.ok, false);
  });

  // ═══════════════════ GROUP E — workspace safety (the critical filesystem hazard) ═══════════════════
  console.log('=== GROUP E: workspace safety — 05aMZ/05bMZ are recognized, never swept into _Unsequenced ===');

  await t('E1: scanRoot recognizes 05aMZ/05bMZ as real sequences alongside standard folders, not as "other"', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    await createSequence(root, 5, 'MZ', 'a');
    await createSequence(root, 5, 'MZ', 'b');
    // A genuinely unrecognized folder must still land in "other" — proves the test isn't vacuous.
    await fsp.mkdir(path.join(root, 'Some Random Folder'), { recursive: true });

    const scan = await scanRoot(root);
    assert.deepStrictEqual(scan.sequences.map(s => s.code).sort(), ['01Q', '05aMZ', '05bMZ']);
    assert.deepStrictEqual(scan.other, ['Some Random Folder'], 'an actually-unrecognized folder must still be classified as "other"');
  });

  await t('E2: CRITICAL — initRoot() does NOT sweep 05aMZ/05bMZ into _Unsequenced/ (the hazard this extension exists to close)', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 5, 'MZ', 'a');
    await createSequence(root, 5, 'MZ', 'b');
    await createSequence(root, 2, 'Q');
    const beforeA = fs.readdirSync(path.join(root, '05aMZ'));

    const result = await initRoot(root);
    assert.equal(result.ok, true);
    assert.deepStrictEqual(result.adopted, [], 'nothing should be adopted — 05aMZ/05bMZ/02Q are all recognized sequence folders, not adoption candidates');
    assert.ok(fs.existsSync(path.join(root, '05aMZ')), '05aMZ must still exist at the TOP level');
    assert.ok(fs.existsSync(path.join(root, '05bMZ')), '05bMZ must still exist at the TOP level');
    assert.ok(!fs.existsSync(path.join(root, '_Unsequenced', '05aMZ')), '05aMZ must NOT have been moved into _Unsequenced/');
    assert.ok(!fs.existsSync(path.join(root, '_Unsequenced', '05bMZ')), '05bMZ must NOT have been moved into _Unsequenced/');
    assert.deepStrictEqual(fs.readdirSync(path.join(root, '05aMZ')), beforeA, 'contents of 05aMZ must be byte-for-byte untouched');
  });

  await t('E3: existing plain-format folders still adopt into _Unsequenced/ exactly as before (regression check)', async () => {
    const root = await mkQmzRoot();
    await fsp.mkdir(path.join(root, 'Loose Photographer'), { recursive: true });
    await fsp.writeFile(path.join(root, 'Loose Photographer', 'IMG_0001.CR2'), Buffer.from('x'));

    const result = await initRoot(root);
    assert.equal(result.ok, true);
    assert.deepStrictEqual(result.adopted, ['Loose Photographer']);
    assert.ok(fs.existsSync(path.join(root, '_Unsequenced', 'Loose Photographer', 'IMG_0001.CR2')), 'ordinary folder adoption must be completely unchanged');
  });

  await t('E4: repeat scans remain consistent (idempotent) for a mixed plain + suffixed workspace', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    await createSequence(root, 5, 'MZ', 'a');
    const scan1 = await scanRoot(root);
    const scan2 = await scanRoot(root);
    assert.deepStrictEqual(scan1.sequences.map(s => s.code), scan2.sequences.map(s => s.code));
  });

  await t('E5: duplicate createSequence calls for the same suffixed code are a safe no-op (no error, no second state entry)', async () => {
    const root = await mkQmzRoot();
    const r1 = await createSequence(root, 5, 'MZ', 'a');
    const r2 = await createSequence(root, 5, 'MZ', 'a');
    assert.equal(r1.ok, true); assert.equal(r2.ok, true);
    const state = await qmz.readState(root);
    assert.equal(state.sequences.length, 1, 'creating the same code twice must not duplicate the state entry');
  });

  await t('E6: state persistence and reload — a suffixed/combined entry round-trips through qmz-sequences.json', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 5, 'MZ', 'a');
    const raw = JSON.parse(await fsp.readFile(path.join(root, 'qmz-sequences.json'), 'utf8'));
    assert.equal(raw.sequences.length, 1);
    assert.equal(raw.sequences[0].code, '05aMZ');
    assert.equal(raw.sequences[0].suffix, 'a');
    const reloaded = await qmz.readState(root);
    assert.deepStrictEqual(reloaded.sequences, raw.sequences);
  });

  await t('E7: existing photographer folders and media remain byte-for-byte untouched by scanRoot (read-only)', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 5, 'MZ', 'a');
    const mediaPath = path.join(root, '05aMZ', 'Some Photographer', 'IMG_0001.CR2');
    await fsp.mkdir(path.dirname(mediaPath), { recursive: true });
    await fsp.writeFile(mediaPath, Buffer.from('original-bytes'));
    const before = await fsp.readFile(mediaPath);

    await scanRoot(root); await scanRoot(root); await initRoot(root);

    const after = await fsp.readFile(mediaPath);
    assert.deepStrictEqual(before, after, 'media bytes must be completely unchanged by any of these read-mostly operations');
  });

  await t('E8: removeSequence still works correctly against an EMPTY suffixed sequence (regression — unchanged function)', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 5, 'MZ', 'a');
    const r = await removeSequence(root, '05aMZ');
    assert.equal(r.ok, true);
    assert.ok(!fs.existsSync(path.join(root, '05aMZ')));
    const state = await qmz.readState(root);
    assert.equal(state.sequences.length, 0);
  });

  console.log(`\n${passed} check(s) passed.`);
  if (process.exitCode) console.log('SOME CHECKS FAILED');
  process.exit(process.exitCode || 0);
})().catch(err => {
  console.error('[qmzSuffixedCombinedTypeRegression] FATAL:', err);
  process.exit(1);
});
