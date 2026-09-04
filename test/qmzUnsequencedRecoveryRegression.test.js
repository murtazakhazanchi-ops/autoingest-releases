'use strict';

// Regression test for the "QMZ sorter cannot read nested _Unsequenced" bug: a
// tester accidentally ran "Sequence Photographer Folders" against a QMZ
// structure. Photographer sequencing treated QMZ's reserved holding folder,
// "_Unsequenced", as an ordinary photographer candidate (it was not in
// services/photographerSequenceService.js's SKIP_DIRS) and renamed it to
// "PC01-_Unsequenced". main/qmzService.js's scanRoot() only recognizes
// "_Unsequenced" by an exact name match, so the renamed folder fell into the
// generic "other" (adoption-candidate) bucket. The next time the QMZ manager
// was opened, initRoot() — which runs before every scan — then nested that
// whole folder AS A UNIT inside the real _Unsequenced/, producing:
//   _Unsequenced/PC01-_Unsequenced/<real photographer>/<media + sidecars>
// scanRoot()'s _Unsequenced handling only lists media one level deep per
// child, so the real media (now two levels deep) was invisible: the QMZ
// sorter showed "PC01-_Unsequenced — Unsequenced / 0 files" and "No media
// files here", even though the files were still physically present on disk.
//
// Fix:
//   1. Prevention — services/photographerSequenceService.js's SKIP_DIRS now
//      includes "_Unsequenced", so photographer sequencing can never rename
//      it again, regardless of what folder it is scoped to run against.
//   2. Recovery (scan) — main/qmzService.js's scanRoot() recognizes a child of
//      _Unsequenced whose canonical name (PCxx- prefix stripped) is itself
//      "_Unsequenced", and reads straight through it to the real nested
//      photographer folders — a pure read, no filesystem move.
//   3. Recovery (init) — initRoot()'s adoption loop recognizes the same
//      malformed shape at the top level and merges its CHILDREN into
//      _Unsequenced/ (one level flattened) instead of nesting the whole
//      folder as a unit — the exact operation that created the double-nesting
//      in the first place. This also makes initRoot self-healing for
//      already-affected archives: running it once un-nests the malformed
//      folder for good.
//
// Run with the real Electron binary (qmzService.js transitively needs
// Electron's app.getPath via services/logger.js):
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --no-sandbox \
//     --user-data-dir=<isolated tmp dir> test/qmzUnsequencedRecoveryRegression.test.js

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

async function mkQmzRoot() { return fsp.mkdtemp(path.join(os.tmpdir(), 'ai-qmz-recovery-')); }
async function writeMediaFile(p, withSidecar = true) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, Buffer.from('not-a-real-raw-file-just-bytes'));
  if (withSidecar) {
    const ext = path.extname(p);
    await fsp.writeFile(p.slice(0, -ext.length) + '.xmp', '<xmp/>', 'utf8');
  }
}

(async () => {
  console.log('=== TEST 1: prevention — _Unsequenced is never treated as a photographer candidate ===');
  await t('TEST 1: services/photographerSequenceService.scanPhotographerFolders never returns "_Unsequenced" as a photographer', async () => {
    const { scanPhotographerFolders, EVENT_ROOT_KEY } = require(path.join(PROJECT_ROOT, 'services/photographerSequenceService'));

    const eventDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-qmz-prevent-event-'));
    // A single-component event root containing the QMZ-reserved _Unsequenced
    // folder alongside a genuine photographer folder — mirrors what
    // "Sequence Photographer Folders" would see if run scoped at a QMZ root.
    await fsp.mkdir(path.join(eventDir, '_Unsequenced'), { recursive: true });
    await fsp.mkdir(path.join(eventDir, 'Alihusain Jamali'), { recursive: true });

    const scoped = await scanPhotographerFolders(eventDir, []);
    assert.equal(scoped.length, 1);
    assert.equal(scoped[0].scopeKey, EVENT_ROOT_KEY);
    const names = scoped[0].photographers.map(p => p.folderName);
    assert.ok(!names.includes('_Unsequenced'), `"_Unsequenced" must never be offered as a sequenceable photographer, got: ${JSON.stringify(names)}`);
    assert.ok(names.includes('Alihusain Jamali'), 'the real photographer folder must still be found');
  });

  console.log('=== TEST 2: recovery (scan) — nested "PCxx-_Unsequenced" is read through, not reported as 0 files ===');
  await t('TEST 2: scanRoot finds media nested inside a malformed "_Unsequenced/PC01-_Unsequenced/<photographer>" shape', async () => {
    const { scanRoot } = require(path.join(PROJECT_ROOT, 'main/qmzService'));
    const qmzRoot = await mkQmzRoot();

    // Exact malformed shape from the bug report.
    await writeMediaFile(path.join(qmzRoot, '_Unsequenced', 'PC01-_Unsequenced', 'Alihusain Jamali', 'ALI001.CR3'));
    await writeMediaFile(path.join(qmzRoot, '_Unsequenced', 'PC01-_Unsequenced', 'Alihusain Jamali', 'ALI002.CR3'));

    const scan = await scanRoot(qmzRoot);
    assert.ok(!('PC01-_Unsequenced' in scan.unsequenced), 'the alias folder name itself must never appear as a photographer entry');
    assert.ok('Alihusain Jamali' in scan.unsequenced, `real photographer must be surfaced, got keys: ${JSON.stringify(Object.keys(scan.unsequenced))}`);
    assert.equal(scan.unsequenced['Alihusain Jamali'].count, 2, 'both nested media files must be found (not 0)');
    const foundNames = scan.unsequenced['Alihusain Jamali'].files.map(f => f.name).sort();
    assert.deepStrictEqual(foundNames, ['ALI001.CR3', 'ALI002.CR3']);
  });

  await t('TEST 2b: multiple photographers nested inside the malformed alias are all found distinctly', async () => {
    const { scanRoot } = require(path.join(PROJECT_ROOT, 'main/qmzService'));
    const qmzRoot = await mkQmzRoot();

    await writeMediaFile(path.join(qmzRoot, '_Unsequenced', 'PC01-_Unsequenced', 'Photographer A', 'A1.CR3'));
    await writeMediaFile(path.join(qmzRoot, '_Unsequenced', 'PC01-_Unsequenced', 'Photographer B', 'B1.CR3'));
    await writeMediaFile(path.join(qmzRoot, '_Unsequenced', 'PC01-_Unsequenced', 'Photographer B', 'B2.CR3'));

    const scan = await scanRoot(qmzRoot);
    assert.equal(scan.unsequenced['Photographer A']?.count, 1);
    assert.equal(scan.unsequenced['Photographer B']?.count, 2);
  });

  await t('TEST 2c: a nested alias photographer merges correctly alongside a same-named photographer already directly under _Unsequenced', async () => {
    const { scanRoot } = require(path.join(PROJECT_ROOT, 'main/qmzService'));
    const qmzRoot = await mkQmzRoot();

    // Same photographer split across both the correct location and the
    // malformed nested alias (a plausible partial-corruption state).
    await writeMediaFile(path.join(qmzRoot, '_Unsequenced', 'Alihusain Jamali', 'PRE001.CR3'));
    await writeMediaFile(path.join(qmzRoot, '_Unsequenced', 'PC01-_Unsequenced', 'Alihusain Jamali', 'NEST001.CR3'));

    const scan = await scanRoot(qmzRoot);
    assert.equal(scan.unsequenced['Alihusain Jamali'].count, 2, 'files from both locations must be merged under the one real photographer');
    const names = scan.unsequenced['Alihusain Jamali'].files.map(f => f.name).sort();
    assert.deepStrictEqual(names, ['NEST001.CR3', 'PRE001.CR3']);
  });

  console.log('=== TEST 3: recovery (init) — initRoot flattens instead of double-nesting ===');
  await t('TEST 3: initRoot merges a top-level "PC01-_Unsequenced" alias\'s children into _Unsequenced/, not nested as a unit', async () => {
    const { initRoot, scanRoot } = require(path.join(PROJECT_ROOT, 'main/qmzService'));
    const qmzRoot = await mkQmzRoot();

    // Not-yet-adopted malformed alias sitting at the QMZ root (the state
    // right after the accidental sequencing run, before any QMZ manager
    // open triggered the old buggy initRoot).
    await writeMediaFile(path.join(qmzRoot, 'PC01-_Unsequenced', 'Alihusain Jamali', 'ALI001.CR3'));

    const result = await initRoot(qmzRoot);
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0, `expected no errors, got: ${JSON.stringify(result.errors)}`);

    // The critical assertion: media must land at _Unsequenced/<photographer>/,
    // NOT _Unsequenced/PC01-_Unsequenced/<photographer>/ (double-nested).
    const expectedPath = path.join(qmzRoot, '_Unsequenced', 'Alihusain Jamali', 'ALI001.CR3');
    const doubleNestedPath = path.join(qmzRoot, '_Unsequenced', 'PC01-_Unsequenced', 'Alihusain Jamali', 'ALI001.CR3');
    assert.ok(fs.existsSync(expectedPath), `media must be flattened to ${expectedPath}`);
    assert.ok(!fs.existsSync(doubleNestedPath), 'media must NOT be double-nested under the alias name');
    assert.ok(!fs.existsSync(path.join(qmzRoot, 'PC01-_Unsequenced')), 'the alias folder itself must be cleaned up once empty');
    // Sidecar must have traveled with its RAW file.
    assert.ok(fs.existsSync(expectedPath.replace('.CR3', '.xmp')), 'XMP sidecar must stay paired with its RAW file through the merge');

    const scan = await scanRoot(qmzRoot);
    assert.equal(scan.unsequenced['Alihusain Jamali']?.count, 1, 'a subsequent scan must correctly report the file (not 0)');
  });

  await t('TEST 3b: initRoot is idempotent — running it again on an already-flattened archive changes nothing and errors nothing', async () => {
    const { initRoot } = require(path.join(PROJECT_ROOT, 'main/qmzService'));
    const qmzRoot = await mkQmzRoot();
    await writeMediaFile(path.join(qmzRoot, '_Unsequenced', 'Alihusain Jamali', 'ALI001.CR3'));

    const first  = await initRoot(qmzRoot);
    const second = await initRoot(qmzRoot);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.errors.length, 0);
    assert.ok(fs.existsSync(path.join(qmzRoot, '_Unsequenced', 'Alihusain Jamali', 'ALI001.CR3')));
  });

  await t('TEST 3c: initRoot merges an alias colliding with an existing real photographer of the same name, without data loss or duplicates', async () => {
    const { initRoot } = require(path.join(PROJECT_ROOT, 'main/qmzService'));
    const qmzRoot = await mkQmzRoot();

    // A real photographer already correctly present...
    await writeMediaFile(path.join(qmzRoot, '_Unsequenced', 'Alihusain Jamali', 'PRE001.CR3'));
    // ...plus a not-yet-adopted alias containing the SAME photographer name
    // with different files (collision case for the rename-then-merge path).
    await writeMediaFile(path.join(qmzRoot, 'PC01-_Unsequenced', 'Alihusain Jamali', 'NEST001.CR3'));

    const result = await initRoot(qmzRoot);
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0, `expected no errors, got: ${JSON.stringify(result.errors)}`);

    const dir = path.join(qmzRoot, '_Unsequenced', 'Alihusain Jamali');
    const files = (await fsp.readdir(dir)).filter(f => f.endsWith('.CR3')).sort();
    assert.deepStrictEqual(files, ['NEST001.CR3', 'PRE001.CR3'], 'both files must be present, none lost, none duplicated');
  });

  console.log('=== TEST 4: regression — already-correct QMZ structures are unaffected ===');
  await t('TEST 4: a normal, non-malformed QMZ structure (_Unsequenced + a real sequence folder) is unaffected by the fix', async () => {
    const { scanRoot, initRoot } = require(path.join(PROJECT_ROOT, 'main/qmzService'));
    const qmzRoot = await mkQmzRoot();

    await writeMediaFile(path.join(qmzRoot, '_Unsequenced', 'Photographer A', 'A1.CR3'));
    await fsp.mkdir(path.join(qmzRoot, '01Q', 'Photographer B'), { recursive: true });
    await writeMediaFile(path.join(qmzRoot, '01Q', 'Photographer B', 'B1.CR3'));

    const initResult = await initRoot(qmzRoot);
    assert.equal(initResult.ok, true);
    assert.equal(initResult.adopted.length, 0, 'nothing should be adopted — there is no malformed or plain "other" folder here');

    const scan = await scanRoot(qmzRoot);
    assert.equal(scan.unsequenced['Photographer A']?.count, 1);
    assert.equal(scan.sequences.length, 1);
    assert.equal(scan.sequences[0].code, '01Q');
    assert.equal(scan.sequences[0].photographers['Photographer B']?.count, 1);
    assert.equal(scan.other.length, 0);
  });

  await t('TEST 4b: a plain (non-alias) "other" folder is still adopted into _Unsequenced/ exactly as before', async () => {
    const { initRoot } = require(path.join(PROJECT_ROOT, 'main/qmzService'));
    const qmzRoot = await mkQmzRoot();
    await writeMediaFile(path.join(qmzRoot, 'Loose Photographer', 'L1.CR3'));

    const result = await initRoot(qmzRoot);
    assert.equal(result.ok, true);
    assert.deepStrictEqual(result.adopted, ['Loose Photographer']);
    assert.ok(fs.existsSync(path.join(qmzRoot, '_Unsequenced', 'Loose Photographer', 'L1.CR3')));
  });

  console.log(`\n${passed} check(s) passed.`);
  if (process.exitCode) console.log('SOME CHECKS FAILED');
  process.exit(process.exitCode || 0);
})().catch(err => {
  console.error('[qmzUnsequencedRecoveryRegression] FATAL:', err);
  process.exit(1);
});
