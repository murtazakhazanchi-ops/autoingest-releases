'use strict';

// Regression test for Enroute (Stage 4 of "PDF-Assisted QMZ Workspace Folder Generation"):
// main/qmzService.js's ensureEnroute()/moveFilesToEnroute()/createReviewedSequences(), and the
// scanRoot()/_classifyOtherFolders() recognition changes that make "Enroute" a permanent,
// first-class sorting destination — never a numbered sequence, never swept into
// _Unsequenced, independent of any PDF import.
//
// Requires the real Electron binary (qmzService.js transitively needs Electron's app.getPath
// via services/logger.js — plain `node` fails):
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
//     --no-sandbox --user-data-dir=<isolated tmp dir> \
//     test/qmzEnrouteRegression.test.js

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

async function mkQmzRoot() { return fsp.mkdtemp(path.join(os.tmpdir(), 'ai-qmz-enroute-')); }
async function writeFile(p, content = 'synthetic') {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content);
}

(async () => {
  const qmz = require(path.join(PROJECT_ROOT, 'main/qmzService'));
  const { ensureEnroute, createReviewedSequences, moveFilesToEnroute, moveFilesToSequence,
    moveFilesToUnsequenced, scanRoot, initRoot, createSequence } = qmz;

  // ═══════════════════ GROUP A — recognition ═══════════════════
  console.log('=== GROUP A: Enroute recognition during scanning/init ===');

  await t('A1: Enroute does not exist yet — scanRoot reports exists:false, empty photographers', async () => {
    const root = await mkQmzRoot();
    const scan = await scanRoot(root);
    assert.deepStrictEqual(scan.enroute, { exists: false, photographers: {} });
  });

  await t('A2: a real Enroute folder is recognized by scanRoot, never classified as "other"', async () => {
    const root = await mkQmzRoot();
    await fsp.mkdir(path.join(root, 'Enroute'));
    const scan = await scanRoot(root);
    assert.equal(scan.enroute.exists, true);
    assert.deepStrictEqual(scan.other, [], 'Enroute must never be reported as an unrecognized/adoption-candidate folder');
  });

  await t('A3: initRoot() does NOT adopt Enroute into _Unsequenced', async () => {
    const root = await mkQmzRoot();
    await fsp.mkdir(path.join(root, 'Enroute'));
    await writeFile(path.join(root, 'Enroute', 'Jane Doe', 'photo1.jpg'));
    const result = await initRoot(root);
    assert.deepStrictEqual(result.adopted, [], 'Enroute must not appear in the adopted list');
    assert.ok(fs.existsSync(path.join(root, 'Enroute')), 'Enroute folder itself must still exist at the top level');
    assert.ok(fs.existsSync(path.join(root, 'Enroute', 'Jane Doe', 'photo1.jpg')), 'Enroute contents must be untouched');
  });

  await t('A4: Enroute survives repeated initRoot() calls (idempotent recognition)', async () => {
    const root = await mkQmzRoot();
    await fsp.mkdir(path.join(root, 'Enroute'));
    await initRoot(root);
    await initRoot(root);
    await initRoot(root);
    const scan = await scanRoot(root);
    assert.equal(scan.enroute.exists, true);
  });

  await t('A5: Enroute and _Unsequenced remain distinct — files in one never appear in the other\'s report', async () => {
    const root = await mkQmzRoot();
    await writeFile(path.join(root, 'Enroute', 'Jane Doe', 'a.jpg'));
    await writeFile(path.join(root, '_Unsequenced', 'Jane Doe', 'b.jpg'));
    const scan = await scanRoot(root);
    assert.equal(scan.enroute.photographers['Jane Doe'].count, 1);
    assert.equal(scan.unsequenced['Jane Doe'].count, 1);
    assert.deepStrictEqual(scan.enroute.photographers['Jane Doe'].files.map(f => path.basename(f.path)), ['a.jpg']);
    assert.deepStrictEqual(scan.unsequenced['Jane Doe'].files.map(f => path.basename(f.path)), ['b.jpg']);
  });

  await t('A6: Enroute works correctly in a workspace with zero numbered sequence folders', async () => {
    const root = await mkQmzRoot();
    await writeFile(path.join(root, 'Enroute', 'Solo Photographer', 'x.jpg'));
    const scan = await scanRoot(root);
    assert.deepStrictEqual(scan.sequences, []);
    assert.equal(scan.enroute.exists, true);
    assert.equal(scan.enroute.photographers['Solo Photographer'].count, 1);
  });

  // ═══════════════════ GROUP B — safe creation (ensureEnroute) ═══════════════════
  console.log('=== GROUP B: ensureEnroute() safety ===');

  await t('B1: creates Enroute in an empty workspace, status "created"', async () => {
    const root = await mkQmzRoot();
    const r = await ensureEnroute(root);
    assert.equal(r.ok, true);
    assert.equal(r.folderName, 'Enroute');
    assert.equal(r.status, 'created');
    assert.ok(fs.existsSync(path.join(root, 'Enroute')));
  });

  await t('B2: repeated calls are idempotent — status "already-exists", no Enroute_1/Enroute (1)', async () => {
    const root = await mkQmzRoot();
    await ensureEnroute(root);
    const r2 = await ensureEnroute(root);
    const r3 = await ensureEnroute(root);
    assert.equal(r2.status, 'already-exists');
    assert.equal(r3.status, 'already-exists');
    const entries = await fsp.readdir(root);
    assert.deepStrictEqual(entries.filter(e => e.toLowerCase().startsWith('enroute')), ['Enroute']);
  });

  await t('B3: existing Enroute media is never touched by ensureEnroute()', async () => {
    const root = await mkQmzRoot();
    await writeFile(path.join(root, 'Enroute', 'Jane Doe', 'keep.jpg'), 'original-bytes');
    await ensureEnroute(root);
    const bytes = await fsp.readFile(path.join(root, 'Enroute', 'Jane Doe', 'keep.jpg'), 'utf8');
    assert.equal(bytes, 'original-bytes');
  });

  await t('B4: works with no numbered sequence folders present at all', async () => {
    const root = await mkQmzRoot();
    const r = await ensureEnroute(root);
    assert.equal(r.ok, true);
    const scan = await scanRoot(root);
    assert.deepStrictEqual(scan.sequences, []);
  });

  await t('B5: an existing FILE named "Enroute" is reported as a conflict, never overwritten', async () => {
    const root = await mkQmzRoot();
    await writeFile(path.join(root, 'Enroute'), 'not-a-directory');
    const r = await ensureEnroute(root);
    assert.equal(r.ok, false);
    assert.equal(r.status, 'conflict');
    const stat = await fsp.stat(path.join(root, 'Enroute'));
    assert.ok(stat.isFile(), 'the file must still be a file — never replaced');
  });

  await t('B6: a symlink named "Enroute" pointing OUTSIDE the workspace is refused, not followed', async () => {
    const root = await mkQmzRoot();
    const outside = await mkQmzRoot();
    await fsp.symlink(outside, path.join(root, 'Enroute'), 'dir');
    const r = await ensureEnroute(root);
    assert.equal(r.ok, false);
    assert.equal(r.status, 'conflict');
    assert.ok(/outside/i.test(r.error));
  });

  await t('B7: a broken symlink named "Enroute" is reported as a conflict', async () => {
    const root = await mkQmzRoot();
    await fsp.symlink(path.join(root, 'does-not-exist'), path.join(root, 'Enroute'), 'dir');
    const r = await ensureEnroute(root);
    assert.equal(r.ok, false);
    assert.equal(r.status, 'conflict');
  });

  await t('B8: a nonexistent qmzRoot is rejected with a clear error, nothing is created', async () => {
    const root = path.join(os.tmpdir(), 'ai-qmz-enroute-does-not-exist-' + Date.now());
    const r = await ensureEnroute(root);
    assert.equal(r.ok, false);
    assert.equal(r.status, 'error');
  });

  await t('B9: on the default case-insensitive filesystem (macOS APFS / Windows NTFS), a pre-existing "enroute" (any casing) IS the canonical Enroute — reused, never duplicated', async () => {
    // macOS/Windows both default to a case-insensitive, case-PRESERVING filesystem — "Enroute"
    // and "enroute" are the same inode, not two different folders (verified directly: this
    // was initially written as the opposite assertion and failed against the real filesystem,
    // the same class of false assumption Stage 2's own test-construction notes record for
    // "05aMZ" vs "05AMZ"). ensureEnroute() must therefore recognize and safely reuse whatever
    // casing is already there — critically, this is what PREVENTS a case-variant collision from
    // ever producing a second, duplicate Enroute folder.
    const root = await mkQmzRoot();
    await writeFile(path.join(root, 'enroute', 'Jane Doe', 'existing.jpg'), 'keep-this-casing-too');
    const r = await ensureEnroute(root);
    assert.equal(r.ok, true);
    assert.equal(r.status, 'already-exists', 'the existing lowercase-named folder must be recognized as the real Enroute, not shadowed by a second one');
    const entries = await fsp.readdir(root);
    assert.equal(entries.filter(e => e.toLowerCase() === 'enroute').length, 1, 'exactly one Enroute folder must exist on disk, regardless of casing');
    const bytes = await fsp.readFile(path.join(root, 'enroute', 'Jane Doe', 'existing.jpg'), 'utf8');
    assert.equal(bytes, 'keep-this-casing-too', 'pre-existing content must be completely untouched');
  });

  // ═══════════════════ GROUP C — assignment (moveFilesToEnroute) ═══════════════════
  console.log('=== GROUP C: moveFilesToEnroute() — assignment workflow ===');

  await t('C1: moves selected files into Enroute/<photographer>, creating Enroute on demand', async () => {
    const root = await mkQmzRoot();
    const src  = path.join(root, '_Unsequenced', 'Jane Doe', 'a.jpg');
    await writeFile(src, 'bytes-a');
    const r = await moveFilesToEnroute(root, [src], 'Jane Doe');
    assert.equal(r.ok, true);
    assert.equal(r.moved.length, 1);
    assert.ok(fs.existsSync(path.join(root, 'Enroute', 'Jane Doe', 'a.jpg')));
    assert.ok(!fs.existsSync(src), 'source file must be gone after a successful move');
  });

  await t('C2: co-moves an XMP sidecar exactly like moveFilesToSequence/moveFilesToUnsequenced', async () => {
    const root = await mkQmzRoot();
    const src  = path.join(root, '_Unsequenced', 'Jane Doe', 'raw1.cr2');
    await writeFile(src, 'raw-bytes');
    await writeFile(path.join(root, '_Unsequenced', 'Jane Doe', 'raw1.xmp'), 'xmp-bytes');
    const r = await moveFilesToEnroute(root, [src], 'Jane Doe');
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(path.join(root, 'Enroute', 'Jane Doe', 'raw1.cr2')));
    assert.ok(fs.existsSync(path.join(root, 'Enroute', 'Jane Doe', 'raw1.xmp')), 'sidecar must travel with its RAW file');
  });

  await t('C3: existing collision handling (safeMoveFile\'s own _1/_2 rename) still works for Enroute', async () => {
    const root = await mkQmzRoot();
    await writeFile(path.join(root, 'Enroute', 'Jane Doe', 'dup.jpg'), 'first-version');
    const src = path.join(root, '_Unsequenced', 'Jane Doe', 'dup.jpg');
    await writeFile(src, 'second-version-different-size!!');
    const r = await moveFilesToEnroute(root, [src], 'Jane Doe');
    assert.equal(r.ok, true);
    assert.equal(r.moved[0].action, 'moved-renamed');
    assert.ok(fs.existsSync(path.join(root, 'Enroute', 'Jane Doe', 'dup_1.jpg')), 'colliding file must be renamed, never overwritten');
    const original = await fsp.readFile(path.join(root, 'Enroute', 'Jane Doe', 'dup.jpg'), 'utf8');
    assert.equal(original, 'first-version', 'the original file already in Enroute must be untouched');
  });

  await t('C4: existing Enroute media is not disturbed when OTHER files are assigned alongside it', async () => {
    const root = await mkQmzRoot();
    await writeFile(path.join(root, 'Enroute', 'Jane Doe', 'already-here.jpg'), 'keep-me');
    const src = path.join(root, '_Unsequenced', 'Jane Doe', 'new.jpg');
    await writeFile(src, 'new-bytes');
    await moveFilesToEnroute(root, [src], 'Jane Doe');
    const bytes = await fsp.readFile(path.join(root, 'Enroute', 'Jane Doe', 'already-here.jpg'), 'utf8');
    assert.equal(bytes, 'keep-me');
  });

  await t('C5: no automatic assignment — files only move into Enroute when moveFilesToEnroute is explicitly called', async () => {
    const root = await mkQmzRoot();
    await writeFile(path.join(root, '_Unsequenced', 'Jane Doe', 'untouched.jpg'));
    await ensureEnroute(root); // creating Enroute must never itself move anything
    assert.ok(fs.existsSync(path.join(root, '_Unsequenced', 'Jane Doe', 'untouched.jpg')), 'file must still be in _Unsequenced, not auto-moved to Enroute');
  });

  await t('C6: Enroute assignment does not disturb numbered-sequence folders', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    await writeFile(path.join(root, '01Q', 'Jane Doe', 'seq-file.jpg'), 'seq-bytes');
    const src = path.join(root, '_Unsequenced', 'Jane Doe', 'move-me.jpg');
    await writeFile(src, 'move-bytes');
    await moveFilesToEnroute(root, [src], 'Jane Doe');
    const bytes = await fsp.readFile(path.join(root, '01Q', 'Jane Doe', 'seq-file.jpg'), 'utf8');
    assert.equal(bytes, 'seq-bytes');
  });

  // ═══════════════════ GROUP D — PDF-driven batch creation (createReviewedSequences) ═══════
  console.log('=== GROUP D: createReviewedSequences() — numbered folders + optional Enroute ===');

  await t('D1: creates several numbered folders from a reviewed list in one call', async () => {
    const root = await mkQmzRoot();
    const r = await createReviewedSequences(root, [
      { number: 1, letter: 'Q' },
      { number: 2, letter: 'M' },
      { number: 3, letter: 'Z' },
    ]);
    assert.equal(r.ok, true);
    assert.deepStrictEqual(r.results.map(x => x.code), ['01Q', '02M', '03Z']);
    assert.ok(r.results.every(x => x.status === 'created'));
    assert.ok(fs.existsSync(path.join(root, '01Q')) && fs.existsSync(path.join(root, '02M')) && fs.existsSync(path.join(root, '03Z')));
  });

  await t('D2: creates suffixed/combined-type entries (05aMZ/05bMZ) via the reviewed list', async () => {
    const root = await mkQmzRoot();
    const r = await createReviewedSequences(root, [
      { number: 5, letter: 'MZ', suffix: 'a' },
      { number: 5, letter: 'MZ', suffix: 'b' },
    ]);
    assert.equal(r.ok, true);
    assert.deepStrictEqual(r.results.map(x => x.code), ['05aMZ', '05bMZ']);
  });

  await t('D3: Enroute-only — zero numbered entries, includeEnroute:true still creates Enroute', async () => {
    const root = await mkQmzRoot();
    const r = await createReviewedSequences(root, [], { includeEnroute: true });
    assert.equal(r.ok, true);
    assert.deepStrictEqual(r.results, []);
    assert.equal(r.enroute.status, 'created');
    assert.ok(fs.existsSync(path.join(root, 'Enroute')));
  });

  await t('D4: numbered entries + Enroute together in one combined, reported operation', async () => {
    const root = await mkQmzRoot();
    const r = await createReviewedSequences(root, [{ number: 1, letter: 'Q' }], { includeEnroute: true });
    assert.equal(r.ok, true);
    assert.equal(r.results[0].status, 'created');
    assert.equal(r.enroute.status, 'created');
  });

  await t('D5: skips an already-existing numbered folder — reports "already-exists", does not recreate/alter it', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 4, 'Q');
    await writeFile(path.join(root, '04Q', 'Jane Doe', 'existing.jpg'), 'keep-this');
    const r = await createReviewedSequences(root, [{ number: 4, letter: 'Q' }]);
    assert.equal(r.results[0].status, 'already-exists');
    const bytes = await fsp.readFile(path.join(root, '04Q', 'Jane Doe', 'existing.jpg'), 'utf8');
    assert.equal(bytes, 'keep-this');
  });

  await t('D6: includeEnroute:true when Enroute already exists reports "already-exists", media untouched', async () => {
    const root = await mkQmzRoot();
    await writeFile(path.join(root, 'Enroute', 'Jane Doe', 'existing.jpg'), 'keep-this-too');
    const r = await createReviewedSequences(root, [], { includeEnroute: true });
    assert.equal(r.enroute.status, 'already-exists');
    const bytes = await fsp.readFile(path.join(root, 'Enroute', 'Jane Doe', 'existing.jpg'), 'utf8');
    assert.equal(bytes, 'keep-this-too');
  });

  await t('D7: rejects an invalid entry without throwing, without creating anything for it', async () => {
    const root = await mkQmzRoot();
    const r = await createReviewedSequences(root, [{ number: 999, letter: 'Q' }]);
    assert.equal(r.ok, false);
    assert.equal(r.results[0].status, 'invalid');
    assert.ok(r.results[0].error);
    const entries = await fsp.readdir(root);
    assert.deepStrictEqual(entries, []);
  });

  await t('D8: rejects duplicate selected destinations within the SAME request — neither is created', async () => {
    const root = await mkQmzRoot();
    const r = await createReviewedSequences(root, [
      { number: 7, letter: 'Q' },
      { number: 7, letter: 'Q' },
    ]);
    assert.equal(r.ok, false);
    assert.ok(r.results.every(x => x.status === 'duplicate-in-request'));
    assert.ok(!fs.existsSync(path.join(root, '07Q')), 'a duplicate-in-request entry must never be created');
  });

  await t('D9: a genuine filesystem error on one entry does not block or roll back the others', async () => {
    const root = await mkQmzRoot();
    // Pre-create "02M" as a plain FILE so createSequence's own mkdir fails for it specifically.
    await writeFile(path.join(root, '02M'), 'blocking-file');
    const r = await createReviewedSequences(root, [
      { number: 1, letter: 'Q' },
      { number: 2, letter: 'M' },
      { number: 3, letter: 'Z' },
    ]);
    assert.equal(r.ok, false);
    const byCode = Object.fromEntries(r.results.map(x => [`${x.number}${x.letter}`, x.status]));
    assert.equal(byCode['1Q'], 'created');
    assert.equal(byCode['2M'], 'error');
    assert.equal(byCode['3Z'], 'created', 'later entries must still be attempted after an earlier one fails');
    assert.ok(fs.existsSync(path.join(root, '01Q')));
    assert.ok(fs.existsSync(path.join(root, '03Z')));
  });

  await t('D10: never trusts the caller\'s validation alone — re-validates every entry server-side', async () => {
    const root = await mkQmzRoot();
    // Simulates a stale/tampered payload bypassing a renderer-side check — number 999 is
    // syntactically plausible JSON but invalid by the authoritative rule.
    const r = await createReviewedSequences(root, [{ number: 999, letter: 'MZ', suffix: 'a' }]);
    assert.equal(r.results[0].status, 'invalid');
    assert.ok(!fs.existsSync(path.join(root, '999aMZ')));
  });

  await t('D11: result ordering matches the input entries\' order (operator sees a predictable report)', async () => {
    const root = await mkQmzRoot();
    const r = await createReviewedSequences(root, [
      { number: 3, letter: 'Z' },
      { number: 1, letter: 'Q' },
      { number: 2, letter: 'M' },
    ]);
    assert.deepStrictEqual(r.results.map(x => x.code), ['03Z', '01Q', '02M']);
  });

  await t('D12: repeated identical PDF-driven creation requests are idempotent (no duplicate folders, no errors)', async () => {
    const root = await mkQmzRoot();
    const entries = [{ number: 1, letter: 'Q' }, { number: 2, letter: 'M' }];
    const r1 = await createReviewedSequences(root, entries, { includeEnroute: true });
    const r2 = await createReviewedSequences(root, entries, { includeEnroute: true });
    assert.ok(r1.results.every(x => x.status === 'created'));
    assert.ok(r2.results.every(x => x.status === 'already-exists'));
    assert.equal(r2.enroute.status, 'already-exists');
    const entriesOnDisk = await fsp.readdir(root);
    assert.deepStrictEqual(entriesOnDisk.filter(e => e === '01Q').length, 1);
  });

  // ═══════════════════ GROUP E — defensive / outside-scope guarantees ═══════════════════
  console.log('=== GROUP E: defensive guarantees ===');

  await t('E1: Enroute never appears in state.sequences (no fabricated number/type)', async () => {
    const root = await mkQmzRoot();
    await createReviewedSequences(root, [{ number: 1, letter: 'Q' }], { includeEnroute: true });
    const state = await qmz.readState(root);
    assert.ok(!state.sequences.some(s => s.code === 'Enroute'), 'Enroute must never be written into qmz-sequences.json as a sequence');
  });

  await t('E2: existing numbered-sequence functionality (createSequence) is completely unaffected by Enroute\'s presence', async () => {
    const root = await mkQmzRoot();
    await ensureEnroute(root);
    const r = await createSequence(root, 9, 'Q');
    assert.equal(r.ok, true);
    assert.equal(r.code, '09Q');
    assert.equal(r.status, 'created');
  });

  await t('E3: moveFilesToUnsequenced is unaffected by Enroute\'s existence (regression)', async () => {
    const root = await mkQmzRoot();
    await ensureEnroute(root);
    const src = path.join(root, '01Q', 'Jane Doe', 'f.jpg');
    await writeFile(src);
    const r = await moveFilesToUnsequenced(root, [src], 'Jane Doe');
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(path.join(root, '_Unsequenced', 'Jane Doe', 'f.jpg')));
  });

  await t('E4: moveFilesToSequence is unaffected by Enroute\'s existence (regression)', async () => {
    const root = await mkQmzRoot();
    await ensureEnroute(root);
    await createSequence(root, 1, 'Q');
    const src = path.join(root, '_Unsequenced', 'Jane Doe', 'g.jpg');
    await writeFile(src);
    const r = await moveFilesToSequence(root, [src], '01Q', 'Jane Doe');
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(path.join(root, '01Q', 'Jane Doe', 'g.jpg')));
  });

  console.log(`\n${passed} check(s) passed.`);
  if (process.exitCode) console.log('SOME CHECKS FAILED');
  process.exit(process.exitCode || 0);
})().catch(err => {
  console.error('[qmzEnrouteRegression] FATAL:', err);
  process.exit(1);
});
