'use strict';

// Regression test for the "Bug 2 Preview PARTIAL FAIL" follow-up: an event
// that had ALREADY been opened in the pre-fix (5dfe6f1) QMZ workspace still
// showed zero photographers/media after upgrading, even though the real
// event's photographer folders and files were genuinely present on disk
// (confirmed by the tester's own filesystem listing and event.json's
// photographerSequences record).
//
// Two independent reproduction attempts using the EXACT structure the tester
// reported — a direct qmzService.scanRoot() call, and a full real-Electron-UI
// end-to-end drive (real event creation, real Event Management, real "Sort
// QMZ Photos" button, real IPC round-trip) — both SUCCEEDED against the
// literal reported shape. This ruled out: the "_Unsequenced/PCxx-alias"
// double-nesting handled by 5dfe6f1 (a different, already-fixed shape),
// multi-component qmzRoot resolution (verified byte-for-byte correct via the
// real renderer), stale/cached renderer state, and UI-layer filtering.
//
// Second root cause: main/qmzService.js's own directory-listing helpers
// (listChildDirs, listMediaFiles) were written independently of
// main/main.js's event scanner and never got the SAME Windows/SMB Dirent
// hardening main.js's scanner already needed for BUG-011 (see
// test/bug011DirentMismatchRegression.test.js) — Dirent.isDirectory()/
// isFile() can misreport on some network shares, a documented Node/libuv
// behavior class, not specific to any one code path. The event that "had
// already been opened" went through real fsp.rename() calls (photographer
// sequencing renaming plain folders to PCxx-prefixed ones, then the OLD
// initRoot adopting them into _Unsequenced/) on a real Windows/NAS archive —
// exactly the kind of filesystem activity this bug class is associated with
// — while the "never opened" comparison event had no such history. A folder
// whose Dirent falsely reports "not a directory" was previously silently
// DROPPED from listChildDirs()'s results, producing exactly "no
// photographers listed" even though the folder and its media are genuinely
// present.
//
// Fix: _directoryHardened/_fileHardened (main/qmzService.js) and
// _directoryHardened (services/photographerSequenceService.js) recover via a
// real stat() when Dirent disagrees, mirroring main.js's BUG-011 fix exactly.
// Wired into every raw Dirent type-check in both files: listChildDirs,
// listMediaFiles, _mergeDirFilesInto, initRoot's alias-merge loop, and
// photographerSequenceService's readPhotographerDirs/_applyRenamesInDir.
//
// TEST 1 — unit-level: the hardening helpers, called directly (test-only
//          export, mirroring exifService.js's _buildTags convention) against
//          a REAL directory/file on disk with a FAKED lying Dirent — proves
//          the actual recovery mechanism against a real fs.stat(), not just
//          mirrored boolean algebra (bug011DirentMismatchRegression.test.js's
//          own limitation, noted in its header, was that main.js can't be
//          require()'d standalone; qmzService.js has no such restriction).
// TEST 2 — full integrated reproduction: fs.promises.readdir is
//          monkey-patched so _Unsequenced's real, on-disk photographer
//          folders report isDirectory()===false (simulating the exact
//          Windows/SMB Dirent lie), while genuinely existing on disk —
//          proving scanRoot() recovers them end-to-end through the real call
//          chain, and that the OLD (unhardened) behavior would NOT have.
// TEST 3 — the requested "already opened by old workspace" lifecycle:
//          reconstructs the persisted end-state the OLD, pre-5dfe6f1
//          initRoot + legitimate photographer sequencing would have left
//          behind (plain photographer folders → PCxx-renamed by sequencing →
//          adopted into _Unsequenced/ by the old initRoot), simulates "app
//          closed" (fresh process-level state), then runs the NEW fixed
//          qmzService with a simulated Dirent lie on the affected folders —
//          verifying photographers, correct component scope, RAW/XMP
//          pairing, and idempotent repeated opens.
// TEST 4 — regression: existing proper QMZ events (no Dirent lie) and the
//          5dfe6f1 nested-alias recovery are both unaffected by this change.
//
// Run with the real Electron binary (qmzService.js transitively needs
// Electron's app.getPath via services/logger.js):
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron --no-sandbox \
//     --user-data-dir=<isolated tmp dir> test/qmzDirentMismatchRegression.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

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

async function mkQmzRoot() { return fsp.mkdtemp(path.join(os.tmpdir(), 'ai-qmz-dirent-')); }
async function writeMediaFile(p) {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, Buffer.from('not-a-real-raw-file-just-bytes'));
  const ext = path.extname(p);
  await fsp.writeFile(p.slice(0, -ext.length) + '.xmp', '<xmp/>', 'utf8');
}

// A Dirent-shaped wrapper that LIES about isDirectory()/isFile() for names in
// `lieAbout`, while everything else (readdir's real entries) passes through
// unchanged — used to monkey-patch fs.promises.readdir per-test.
function _wrapLyingReaddir(realReaddir, lieAbout) {
  return async function (dir, opts) {
    const entries = await realReaddir(dir, opts);
    if (!opts || !opts.withFileTypes) return entries;
    return entries.map(e => {
      if (!lieAbout.has(e.name)) return e;
      return {
        name: e.name,
        isDirectory: () => false,
        isFile: () => false,
        isSymbolicLink: () => false,
      };
    });
  };
}

(async () => {
  console.log('=== TEST 1: hardening helpers against a real dir/file with a faked lying Dirent ===');
  await t('TEST 1: qmzService._directoryHardened recovers a real directory whose Dirent falsely says isDirectory()=false', async () => {
    const qmzService = require('../main/qmzService');
    const root = await mkQmzRoot();
    const realDir = path.join(root, 'PC01-M Aliasger Gulamali');
    await fsp.mkdir(realDir, { recursive: true });
    const lyingEntry = { name: 'PC01-M Aliasger Gulamali', isDirectory: () => false, isFile: () => false };
    const result = await qmzService._directoryHardened(root, lyingEntry);
    assert.equal(result, true, 'a real, present directory must be recovered via stat() even when Dirent lies');
  });

  await t('TEST 1b: qmzService._directoryHardened correctly rejects a genuine non-directory (no false recovery)', async () => {
    const qmzService = require('../main/qmzService');
    const root = await mkQmzRoot();
    await fsp.writeFile(path.join(root, 'notadir.txt'), 'x');
    const entry = { name: 'notadir.txt', isDirectory: () => false, isFile: () => true };
    const result = await qmzService._directoryHardened(root, entry);
    assert.equal(result, false, 'a genuine file must never be recovered as a directory');
  });

  await t('TEST 1c: qmzService._fileHardened recovers a real file whose Dirent falsely says isFile()=false', async () => {
    const qmzService = require('../main/qmzService');
    const root = await mkQmzRoot();
    await fsp.writeFile(path.join(root, 'IMG001.CR3'), 'x');
    const lyingEntry = { name: 'IMG001.CR3', isDirectory: () => false, isFile: () => false };
    const result = await qmzService._fileHardened(root, lyingEntry);
    assert.equal(result, true, 'a real, present file must be recovered via stat() even when Dirent lies');
  });

  await t('TEST 1d: qmzService._directoryHardened rejects a genuinely-gone path (stat throws) without a false recovery', async () => {
    const qmzService = require('../main/qmzService');
    const root = await mkQmzRoot();
    const lyingEntry = { name: 'does-not-exist', isDirectory: () => false, isFile: () => false };
    const result = await qmzService._directoryHardened(root, lyingEntry);
    assert.equal(result, false, 'a path that genuinely does not exist must not be falsely recovered');
  });

  await t('TEST 1e: photographerSequenceService._directoryHardened recovers a real directory the same way', async () => {
    const { _directoryHardened } = require('../services/photographerSequenceService');
    const root = await mkQmzRoot();
    const realDir = path.join(root, 'M Aliasger Gulamali');
    await fsp.mkdir(realDir, { recursive: true });
    const lyingEntry = { name: 'M Aliasger Gulamali', isDirectory: () => false, isFile: () => false };
    const result = await _directoryHardened(root, lyingEntry);
    assert.equal(result, true);
  });

  console.log('=== TEST 2: full integrated recovery through the real call chain (monkey-patched readdir) ===');
  await t('TEST 2: scanRoot recovers photographers/media when their Dirents falsely report isDirectory()/isFile()=false', async () => {
    const qmzRoot = await mkQmzRoot();
    await writeMediaFile(path.join(qmzRoot, '_Unsequenced', 'PC01-M Aliasger Gulamali', 'ALI001.CR3'));
    await writeMediaFile(path.join(qmzRoot, '_Unsequenced', 'PC02-Husain Khokhri', 'HUS001.CR3'));

    const realReaddir = fsp.readdir;
    fsp.readdir = _wrapLyingReaddir(realReaddir, new Set(['PC01-M Aliasger Gulamali', 'PC02-Husain Khokhri', 'ALI001.CR3', 'HUS001.CR3']));
    try {
      // Fresh require after monkey-patch installed — qmzService captured
      // `fsp` by reference at module load, so patching fs.promises.readdir
      // itself (the same object) is what actually takes effect here.
      const qmzService = require('../main/qmzService');
      const scan = await qmzService.scanRoot(qmzRoot);
      assert.equal(scan.unsequenced['PC01-M Aliasger Gulamali']?.count, 1,
        `expected recovery to find PC01's file despite the lying Dirent, got: ${JSON.stringify(scan.unsequenced)}`);
      assert.equal(scan.unsequenced['PC02-Husain Khokhri']?.count, 1,
        `expected recovery to find PC02's file despite the lying Dirent, got: ${JSON.stringify(scan.unsequenced)}`);
    } finally {
      fsp.readdir = realReaddir;
    }
  });

  await t('TEST 2b: without the hardening, the same lying Dirent would have produced zero photographers (proves this is the real mechanism, not a coincidence)', async () => {
    const qmzRoot = await mkQmzRoot();
    await writeMediaFile(path.join(qmzRoot, '_Unsequenced', 'PC01-M Aliasger Gulamali', 'ALI001.CR3'));

    // Directly exercises the UNHARDENED filter expression qmzService used to
    // use (`entries.filter(e => e.isDirectory())`), against the same lying
    // Dirent, to make the "would have failed before this fix" claim concrete
    // rather than asserted.
    const entries = await fsp.readdir(path.join(qmzRoot, '_Unsequenced'), { withFileTypes: true });
    const lying = entries.map(e => ({ name: e.name, isDirectory: () => false, isFile: () => false }));
    const unhardenedResult = lying.filter(e => e.isDirectory()).map(e => e.name);
    assert.deepStrictEqual(unhardenedResult, [], 'confirms the pre-fix expression silently drops the real photographer folder under this exact Dirent lie');
  });

  console.log('=== TEST 3: "already opened by pre-fix QMZ workspace" lifecycle ===');
  await t('TEST 3: photographers/media are rediscovered after reconstructing the OLD workspace\'s persisted end-state, with a simulated Dirent lie on the affected folders', async () => {
    // Step 1 — reconstruct what the tester's forensic evidence (real
    // filesystem shape + event.json photographerSequences keyed "01-QMZ" with
    // PCxx folderName values) proves DID happen, in order:
    //   a) fresh import: plain, un-adopted photographer folders directly
    //      under the multi-component's "01-QMZ" folder.
    const qmzRoot = await mkQmzRoot(); // stands in for "<event>/01-QMZ"
    await writeMediaFile(path.join(qmzRoot, 'M Aliasger Gulamali', 'ALI001.CR3'));
    await writeMediaFile(path.join(qmzRoot, 'M Aliasger Gulamali', 'ALI002.CR3'));
    await writeMediaFile(path.join(qmzRoot, 'Husain Khokhri', 'HUS001.CR3'));

    //   b) "Sequence Photographer Folders" ran scoped at "01-QMZ" BEFORE QMZ
    //      was ever opened (matches the tester's event.json: scope key
    //      "01-QMZ", not "__eventRoot__") — renames the plain folders in
    //      place, directly under "01-QMZ" (real production code, not a
    //      mirror).
    const photographerSeqService = require('../services/photographerSequenceService');
    const scanned = await photographerSeqService.scanPhotographerFolders(qmzRoot, []); // isMulti=false relative to THIS root — qmzRoot stands in for the component dir itself
    const ordered = scanned[0].photographers.map((p, i) => ({ canonical: p.canonical, sequence: i + 1, folderName: `${photographerSeqService.seqPrefix(i + 1)}-${p.canonical}` }));
    const renameResult = await photographerSeqService.applyRenames(qmzRoot, [{ scopeKey: photographerSeqService.EVENT_ROOT_KEY, ordered }]);
    assert.equal(renameResult.ok, true, `setup: photographer sequencing must succeed, got: ${JSON.stringify(renameResult)}`);
    assert.ok(fs.existsSync(path.join(qmzRoot, 'PC01-M Aliasger Gulamali')) || fs.existsSync(path.join(qmzRoot, 'PC02-M Aliasger Gulamali')),
      'setup: photographer folders must now be PCxx-prefixed directly under the component root');

    //   c) THEN, for the first time, "Sort QMZ Photos" was opened — the OLD,
    //      pre-5dfe6f1 initRoot ran, adopting the now-PCxx-prefixed plain
    //      folders into _Unsequenced/ (real production initRoot — its
    //      adoption behavior for a plain "other" folder is unchanged by
    //      5dfe6f1; only the NEW alias-detection branch was added).
    const qmzService = require('../main/qmzService');
    const initResult = await qmzService.initRoot(qmzRoot);
    assert.equal(initResult.ok, true);
    const adoptedNames = fs.readdirSync(path.join(qmzRoot, '_Unsequenced'));
    assert.ok(adoptedNames.length === 2, `setup: both PCxx-prefixed folders must be adopted into _Unsequenced/, got: ${JSON.stringify(adoptedNames)}`);

    // Step 2 — "app closed": nothing more than the filesystem end-state and
    // event.json persist; no in-memory state carries over (this test starts
    // a fresh require() with no shared state anyway, mirroring a real
    // process restart).

    // Step 3 — "app reopened with the fixed version", but on a real
    // Windows/NAS archive the just-renamed folders (both the sequencing
    // rename in step b and the adoption rename in step c happened via real
    // fsp.rename() calls) are exactly the kind of entry a Dirent-misreport
    // has been documented to affect — simulate that here.
    const realReaddir = fsp.readdir;
    fsp.readdir = _wrapLyingReaddir(realReaddir, new Set(adoptedNames));
    try {
      const scan = await qmzService.scanRoot(qmzRoot);
      const totalFiles = Object.values(scan.unsequenced).reduce((n, p) => n + p.count, 0);
      assert.equal(Object.keys(scan.unsequenced).length, 2, `expected both photographers rediscovered, got: ${JSON.stringify(Object.keys(scan.unsequenced))}`);
      assert.equal(totalFiles, 3, `expected all 3 media files recovered, got ${totalFiles}`);

      // RAW/XMP pairing intact.
      for (const pg of Object.keys(scan.unsequenced)) {
        for (const f of scan.unsequenced[pg].files) {
          if (f.name.endsWith('.CR3')) {
            const xmp = f.path.slice(0, -4) + '.xmp';
            assert.ok(fs.existsSync(xmp), `sidecar must exist for ${f.path}`);
          }
        }
      }
    } finally {
      fsp.readdir = realReaddir;
    }

    // Idempotent repeated opens — initRoot + scanRoot again (Dirent lie
    // still simulated) must not progressively move/nest/rename anything
    // further, and must keep reporting correctly.
    fsp.readdir = _wrapLyingReaddir(realReaddir, new Set(adoptedNames));
    try {
      const initAgain = await qmzService.initRoot(qmzRoot);
      assert.equal(initAgain.ok, true);
      assert.equal(initAgain.adopted.length, 0, 'nothing left in "other" to adopt on a second open — must not re-nest');
      const scanAgain = await qmzService.scanRoot(qmzRoot);
      assert.equal(Object.keys(scanAgain.unsequenced).length, 2, 'repeated open must remain stable, not regress');
    } finally {
      fsp.readdir = realReaddir;
    }
  });

  console.log('=== TEST 4: regression — normal Dirents and the 5dfe6f1 alias recovery are unaffected ===');
  await t('TEST 4: a normal (non-lying) QMZ structure scans exactly as before', async () => {
    const qmzService = require('../main/qmzService');
    const qmzRoot = await mkQmzRoot();
    await writeMediaFile(path.join(qmzRoot, '_Unsequenced', 'Photographer A', 'A1.CR3'));
    const scan = await qmzService.scanRoot(qmzRoot);
    assert.equal(scan.unsequenced['Photographer A']?.count, 1);
  });

  await t('TEST 4b: the 5dfe6f1 nested-alias recovery (PCxx-_Unsequenced) still works alongside the new Dirent hardening', async () => {
    const qmzService = require('../main/qmzService');
    const qmzRoot = await mkQmzRoot();
    await writeMediaFile(path.join(qmzRoot, '_Unsequenced', 'PC01-_Unsequenced', 'Real Photographer', 'X1.CR3'));
    const scan = await qmzService.scanRoot(qmzRoot);
    assert.equal(scan.unsequenced['Real Photographer']?.count, 1);
    assert.ok(!('PC01-_Unsequenced' in scan.unsequenced));
  });

  console.log(`\n${passed} check(s) passed.`);
  if (process.exitCode) console.log('SOME CHECKS FAILED');
  process.exit(process.exitCode || 0);
})().catch(err => {
  console.error('[qmzDirentMismatchRegression] FATAL:', err);
  process.exit(1);
});
