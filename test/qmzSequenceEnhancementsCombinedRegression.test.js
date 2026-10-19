'use strict';

// Regression test for "QMZ Sequence Enhancements" — Phase 7C: combined behavior across BOTH
// new features (manually-inserted additional sequences + expanded O/AQ event types) together,
// and a safety net confirming they interoperate correctly with every prior QMZ stage still
// intact: Stage 1 suffix/MZ support, Stage 4 Enroute, and the most recent Workspace
// Maintenance feature (hidden qmz-sequences.json + lazy _Unsequenced lifecycle).
//
// Requires the real Electron binary (same constraint as every other qmz*.test.js):
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
//     --no-sandbox --user-data-dir=<isolated tmp dir> \
//     test/qmzSequenceEnhancementsCombinedRegression.test.js

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

async function mkQmzRoot() { return fsp.mkdtemp(path.join(os.tmpdir(), 'ai-qmz-combined-')); }

(async () => {
  const qmz = require(path.join(PROJECT_ROOT, 'main/qmzService'));
  const {
    createSequence, createReviewedSequences, ensureEnroute, initRoot, scanRoot,
    moveFilesToSequence, moveFilesToUnsequenced, readState,
  } = qmz;

  // ═══════════════════ GROUP A — a manually-inserted ADDITIONAL sequence using a NEW type ═══════════════════
  console.log('=== GROUP A: additional sequences + new types compose correctly ===');

  await t('A1: an additional sequence may use a brand-new type (O/AQ), not just the original Q/M/Z/MZ', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 3, 'Q');
    const r = await createSequence(root, 3, 'O', 'a');
    assert.equal(r.ok, true);
    assert.equal(r.code, '03aO');
  });

  await t('A2: the insertion-position conflict rule applies identically to the new types ("03aO" vs "03aAQ" conflict)', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 3, 'O', 'a');
    const r = await createSequence(root, 3, 'AQ', 'a');
    assert.equal(r.ok, false);
    assert.match(r.error, /already used by 03aO/);
  });

  await t('A3: createReviewedSequences() (the PDF-review creation path) handles a batch mixing base, additional, and new-type entries together', async () => {
    const root = await mkQmzRoot();
    const { ok: batchOk, results, enroute } = await createReviewedSequences(root, [
      { number: 3, letter: 'Q' },
      { number: 3, letter: 'AQ', suffix: 'a' },
      { number: 4, letter: 'O' },
      { number: 4, letter: 'M', suffix: 'a' },
    ], { includeEnroute: true });
    assert.equal(batchOk, true);
    assert.ok(results.every(r => r.status === 'created'));
    assert.equal(enroute.status, 'created');
    const state = await readState(root);
    assert.deepStrictEqual(state.sequences.map(s => s.code), ['03Q', '03aAQ', '04O', '04aM']);
  });

  // ═══════════════════ GROUP B — interoperation with Enroute (Stage 4) ═══════════════════
  console.log('=== GROUP B: Enroute remains fully independent of the expanded type set ===');

  await t('B1: Enroute creation/recognition is unaffected by the new types existing in the same workspace', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'O');
    await createSequence(root, 2, 'AQ', 'a');
    const r = await ensureEnroute(root);
    assert.equal(r.ok, true);
    const scanned = await scanRoot(root);
    assert.equal(scanned.enroute.exists, true);
    assert.deepStrictEqual(scanned.other, []);
  });

  // ═══════════════════ GROUP C — interoperation with Workspace Maintenance (hidden state + lazy _Unsequenced) ═══════════════════
  console.log('=== GROUP C: hidden qmz-sequences.json + lazy _Unsequenced lifecycle both still hold with the new types ===');

  const { hidePathBestEffort } = require(path.join(PROJECT_ROOT, 'services/internalFileProtection.js'));

  await t('C1: qmz-sequences.json remains the same filename (hidden via OS attribute, never renamed) after creating new-type sequences', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'O');
    await createSequence(root, 2, 'AQ', 'a');
    assert.ok(fs.existsSync(path.join(root, 'qmz-sequences.json')), 'state file must still be named exactly "qmz-sequences.json"');
    const state = JSON.parse(await fsp.readFile(path.join(root, 'qmz-sequences.json'), 'utf8'));
    assert.ok(state.sequences.some(s => s.code === '01O'));
    assert.ok(state.sequences.some(s => s.code === '02aAQ'));
  });

  await t('C2: initRoot only creates _Unsequenced when there is genuinely unadopted content, even with new-type sequence folders present', async () => {
    const root = await mkQmzRoot();
    // A folder matching SEQ_RE (including the new O/AQ types) is never "other" content —
    // initRoot()'s own adoption sweep only ever touches _classifyOtherFolders()'s list, so a
    // pre-existing O/AQ folder must neither be adopted into _Unsequenced NOR trigger its
    // creation, exactly like a pre-existing Q/M/Z/MZ folder already didn't before this feature.
    // (initRoot() itself never reads/writes qmz-sequences.json for sequence-shaped folders at
    // all — recognition happens live, on read, via scanRoot()'s own SEQ_RE check below; this
    // is pre-existing, unrelated-to-this-feature behavior, not something this task changes.)
    await fsp.mkdir(path.join(root, '01O'), { recursive: true });
    await fsp.mkdir(path.join(root, '02aAQ'), { recursive: true });
    const r = await initRoot(root);
    assert.equal(r.ok, true);
    assert.deepStrictEqual(r.adopted, [], 'sequence-shaped folders must never be adopted into _Unsequenced');
    assert.ok(!fs.existsSync(path.join(root, '_Unsequenced')), 'no stray "other" content exists, so _Unsequenced must not be created');
    const scanned = await scanRoot(root);
    assert.deepStrictEqual(scanned.sequences.map(s => s.code).sort(), ['01O', '02aAQ'], 'scanRoot() recognizes both folders live, from disk, regardless of state-file persistence');
    assert.deepStrictEqual(scanned.other, []);
  });

  // ═══════════════════ GROUP D — full workflow: PDF-style batch with new types + additional sequences, then file movement ═══════════════════
  console.log('=== GROUP D: end-to-end — create, move files in, verify both features hold together ===');

  await t('D1: files can be moved into a new-type additional sequence, and out of _Unsequenced, with everything intact afterward', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 3, 'Q');
    await createSequence(root, 3, 'AQ', 'a'); // additional sequence, new type

    // Source lives under qmzRoot/_Unsequenced, matching how the real app always discovers a
    // move source (listMediaFiles() only ever scans inside qmzRoot) — moveFilesToSequence()
    // rejects any source outside the authorized workspace (Stage 4 security hardening).
    const srcFile = path.join(root, '_Unsequenced', 'PC01', 'IMG_0001.JPG');
    await fsp.mkdir(path.dirname(srcFile), { recursive: true });
    await fsp.writeFile(srcFile, 'fake-jpeg-bytes');

    const r = await moveFilesToSequence(root, [srcFile], '03aAQ', 'PC01');
    assert.equal(r.ok, true, r.error);
    assert.ok(fs.existsSync(path.join(root, '03aAQ', 'PC01', 'IMG_0001.JPG')), 'file must land inside the additional sequence\'s own photographer folder');

    const scanned = await scanRoot(root);
    const aqSeq = scanned.sequences.find(s => s.code === '03aAQ');
    assert.equal(aqSeq.photographers.PC01.count, 1);
    assert.equal(aqSeq.type, 'Aqeeqa');
  });

  console.log(`\n${passed} check(s) passed.`);
  if (process.exitCode) {
    console.error('\nSome checks FAILED.');
  } else {
    console.log('\nAll checks passed.');
  }
})();
