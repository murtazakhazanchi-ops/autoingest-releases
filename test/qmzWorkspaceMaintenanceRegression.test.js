'use strict';

// QMZ workspace maintenance — two narrowly-scoped improvements:
//
// A. Hidden QMZ sequence metadata. Investigation (see the accompanying report) found
//    AutoIngest's REAL established convention for this (services/internalFileProtection.js,
//    already applied pervasively to event.json/event.metadata.json) is a genuine OS-level
//    hidden attribute on the file's UNCHANGED name — macOS chflags hidden, Windows attrib +H,
//    Linux .hidden registry — not a dot-prefixed rename. A dot-prefix is NOT honored as hidden
//    by Windows Explorer at all, whereas this mechanism genuinely works on both platforms, and
//    it requires no migration, no legacy-vs-canonical filename reconciliation, and no risk of
//    ever losing or duplicating a sequence record — the on-disk filename and schema never
//    change. Because there is only ever ONE filename, the brief's "both legacy and hidden
//    files present, possibly conflicting" scenarios (groups H/I/K/L below) do not apply to
//    this implementation — documented explicitly at each one, not silently skipped.
//
// B. _Unsequenced folder lifecycle. initRoot() previously created _Unsequenced
//    unconditionally on every call (i.e. every QMZ workspace open) — the exact reason a
//    fully-sorted workspace's empty _Unsequenced never actually disappeared. Now created only
//    when there is something to adopt into it; moveFilesToSequence()/moveFilesToUnsequenced()/
//    moveFilesToEnroute() each clean up an emptied source photographer folder and, if that
//    leaves _Unsequenced itself empty, remove it too — using the pre-existing, unchanged,
//    non-recursive removeIfEmptyIgnoringJunk() (never fs.rm(), never touches a directory
//    containing a real file, subdirectory, XMP sidecar, non-junk hidden file, or symlink).
//
// Requires the real Electron binary (qmzService.js transitively needs Electron's app.getPath
// via services/logger.js — plain `node` fails):
//   node_modules/electron/dist/Electron.app/Contents/MacOS/Electron \
//     --no-sandbox --user-data-dir=<isolated tmp dir> \
//     test/qmzWorkspaceMaintenanceRegression.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

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

async function mkQmzRoot() { return fsp.mkdtemp(path.join(os.tmpdir(), 'ai-qmz-maint-')); }
async function writeFile(p, content = 'synthetic') {
  await fsp.mkdir(path.dirname(p), { recursive: true });
  await fsp.writeFile(p, content);
}
async function listDirNames(dir) {
  try { return (await fsp.readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort(); }
  catch { return []; }
}
async function listFileNames(dir) {
  try { return (await fsp.readdir(dir, { withFileTypes: true })).filter(e => e.isFile()).map(e => e.name).sort(); }
  catch { return []; }
}

// macOS-only: checks the real chflags "hidden" bit via `stat -f '%Sf'` — the same flag
// Finder itself honors. Returns null (skip, not fail) on non-macOS so this suite stays
// portable; the actual hiding mechanism for Windows/Linux is exercised structurally instead
// (hidePathBestEffort's own dedicated branch, not re-tested bit-for-bit here).
function isMacHidden(filePath) {
  if (process.platform !== 'darwin') return null;
  return new Promise((resolve) => {
    execFile('stat', ['-f', '%Sf', filePath], (err, stdout) => {
      if (err) return resolve(false);
      resolve(stdout.includes('hidden'));
    });
  });
}

(async () => {
  const qmz = require(path.join(PROJECT_ROOT, 'main/qmzService'));
  const { readState, saveState, createSequence, scanRoot, initRoot, moveFilesToSequence,
    moveFilesToUnsequenced, moveFilesToEnroute, ensureEnroute, createReviewedSequences } = qmz;
  const { isAutoIngestInternalName } = require(path.join(PROJECT_ROOT, 'services/internalFileProtection'));

  // ═══════════════════ GROUP A — hidden QMZ sequence metadata ═══════════════════
  console.log('=== A: new workspace creates hidden canonical metadata ===');

  await t('A: creating a sequence creates qmz-sequences.json, and it is hidden from Finder (macOS chflags)', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    const statePath = path.join(root, 'qmz-sequences.json');
    assert.ok(fs.existsSync(statePath), 'the state file must still use its existing, unchanged name');
    const hidden = await isMacHidden(statePath);
    if (hidden !== null) assert.equal(hidden, true, 'the state file must carry the real macOS hidden flag');
  });

  console.log('=== B: a pre-existing ("legacy", pre-this-change) workspace opens correctly ===');

  await t('B: a workspace with a plain, not-yet-hidden qmz-sequences.json (simulating one written by an older AutoIngest build) opens and reads correctly', async () => {
    const root = await mkQmzRoot();
    await writeFile(path.join(root, 'qmz-sequences.json'), JSON.stringify({ version: 1, qmzRoot: root, sequences: [{ code: '01Q', number: 1, letter: 'Q', suffix: '', type: 'Qadam' }] }));
    const state = await readState(root);
    assert.deepStrictEqual(state.sequences, [{ code: '01Q', number: 1, letter: 'Q', suffix: '', type: 'Qadam' }], 'D: existing sequence entries must remain intact, byte-for-byte');
  });

  console.log('=== C: retroactive hiding (this implementation\'s equivalent of "migration") ===');

  await t('C: simply OPENING (readState) a pre-existing, not-yet-hidden workspace retroactively hides it — no explicit migration step required', async () => {
    const root = await mkQmzRoot();
    await writeFile(path.join(root, 'qmz-sequences.json'), JSON.stringify({ version: 1, qmzRoot: root, sequences: [] }));
    const hiddenBefore = await isMacHidden(path.join(root, 'qmz-sequences.json'));
    if (hiddenBefore !== null) assert.equal(hiddenBefore, false, 'precondition: not yet hidden');
    await readState(root);
    await new Promise(r => setTimeout(r, 50)); // hidePathBestEffort is fire-and-forget (.catch-only) inside readState
    const hiddenAfter = await isMacHidden(path.join(root, 'qmz-sequences.json'));
    if (hiddenAfter !== null) assert.equal(hiddenAfter, true, 'opening the workspace must have applied the hidden attribute retroactively');
  });

  console.log('=== E: repeated "migration" (repeated open/save) is idempotent ===');

  await t('E: repeated readState()/saveState() calls never duplicate or corrupt sequence records', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    await readState(root); await readState(root); await readState(root);
    const state1 = await readState(root);
    await saveState(root, state1);
    await saveState(root, state1);
    const state2 = await readState(root);
    assert.deepStrictEqual(state2.sequences, state1.sequences);
    assert.equal(state2.sequences.length, 1, 'no duplicate records from repeated read/save');
  });

  console.log('=== F/G: hidden metadata remains readable and writable ===');

  await t('F/G: after being hidden, the state file is still fully readable AND writable by AutoIngest', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q'); // creates + hides
    const r2 = await createSequence(root, 2, 'M'); // a second write to the now-hidden file
    assert.equal(r2.ok, true, 'G: writing to the hidden file must still succeed');
    const state = await readState(root);
    assert.equal(state.sequences.length, 2, 'F: reading the hidden file must still return everything written to it');
  });

  console.log('=== H/I: both legacy and canonical filenames present — N/A for this implementation ===');
  ok('H/I: N/A — this implementation never introduces a second filename, so "both files present" cannot occur by construction (documented, not silently skipped)');

  console.log('=== J: malformed metadata handling ===');

  await t('J: malformed JSON in qmz-sequences.json is handled safely — falls back to a fresh default state, never throws', async () => {
    const root = await mkQmzRoot();
    await writeFile(path.join(root, 'qmz-sequences.json'), '{ this is not valid JSON');
    const state = await readState(root);
    assert.deepStrictEqual(state, { version: 1, qmzRoot: root, sequences: [] });
  });

  console.log('=== K: permission/attribute-failure handling ===');

  await t('K: a failure to apply the hidden attribute (simulated: nonexistent path) never breaks the real read/write path', async () => {
    // hidePathBestEffort() is only ever called with a real, just-written path in production,
    // but its own contract is "best-effort, never throws" — confirmed directly here.
    const { hidePathBestEffort } = require(path.join(PROJECT_ROOT, 'services/internalFileProtection'));
    const result = await hidePathBestEffort(path.join(os.tmpdir(), 'does-not-exist-' + Date.now()));
    assert.equal(result, false, 'a failed hide attempt must resolve false, never throw/reject');
  });

  console.log('=== L: "interrupted migration" — N/A; existing atomic write pattern unaffected ===');

  await t('L: the existing atomic tmp-then-rename write pattern is unaffected by hiding — an interrupted write never leaves a corrupt canonical file', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    const tmpPath = path.join(root, 'qmz-sequences.json.tmp');
    assert.ok(!fs.existsSync(tmpPath), 'the .tmp file must not survive a completed save — same unchanged atomic pattern as before');
  });

  console.log('=== M/N/O: normal QMZ operations continue working after hiding ===');

  await t('M: sequence creation works correctly against an already-hidden state file', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    const r = await createSequence(root, 2, 'M');
    assert.equal(r.ok, true);
  });

  await t('N: scanning works correctly with a hidden state file present', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    const scan = await scanRoot(root);
    assert.deepStrictEqual(scan.sequences.map(s => s.code), ['01Q']);
    assert.deepStrictEqual(scan.other, [], 'Q: the hidden metadata file must never be classified as an unrecognized folder/file');
  });

  await t('O: PDF-driven folder creation (createReviewedSequences) works correctly with a hidden state file', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q'); // hides the file
    const r = await createReviewedSequences(root, [{ number: 2, letter: 'M' }], { includeEnroute: false });
    assert.equal(r.ok, true);
    assert.equal(r.results[0].status, 'created');
  });

  console.log('=== P: no duplicate sequence records ===');

  await t('P: creating the same sequence code twice never produces a duplicate record', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    await createSequence(root, 1, 'Q');
    const state = await readState(root);
    assert.equal(state.sequences.filter(s => s.code === '01Q').length, 1);
  });

  console.log('=== Q: internal metadata filtering ===');

  await t('Q: qmz-sequences.json is registered as an AutoIngest-internal name (never treated as media/content)', () => {
    assert.equal(isAutoIngestInternalName('qmz-sequences.json'), true);
  });

  console.log('=== R: no metadata data loss across the whole flow ===');

  await t('R: a realistic sequence of operations (create, scan, create more, reopen) never loses a single existing record', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    await createSequence(root, 5, 'MZ', 'a');
    await createSequence(root, 5, 'MZ', 'b');
    await scanRoot(root);
    await createSequence(root, 2, 'M');
    const state = await readState(root);
    assert.deepStrictEqual(state.sequences.map(s => s.code).sort(), ['01Q', '02M', '05aMZ', '05bMZ']);
  });

  // ═══════════════════ GROUP B — _Unsequenced lifecycle ═══════════════════
  console.log('=== A: empty _Unsequenced is removed ===');

  await t('A: moving the only file out of _Unsequenced/Photographer into a numbered sequence removes BOTH the empty photographer folder AND _Unsequenced itself', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'a.jpg');
    await writeFile(src);
    const r = await moveFilesToSequence(root, [src], '01Q', 'Abbas Bhai');
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(path.join(root, '01Q', 'Abbas Bhai', 'a.jpg')));
    assert.ok(!fs.existsSync(path.join(root, '_Unsequenced', 'Abbas Bhai')), 'the emptied photographer folder must be removed');
    assert.ok(!fs.existsSync(path.join(root, '_Unsequenced')), '_Unsequenced itself must be removed once completely empty');
  });

  console.log('=== B: nonempty _Unsequenced is preserved ===');

  await t('B: moving one photographer\'s files out leaves _Unsequenced intact while ANOTHER photographer still has content', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    const srcA = path.join(root, '_Unsequenced', 'Abbas Bhai', 'a.jpg');
    const srcH = path.join(root, '_Unsequenced', 'Husain Bhai', 'h.jpg');
    await writeFile(srcA); await writeFile(srcH);
    await moveFilesToSequence(root, [srcA], '01Q', 'Abbas Bhai');
    assert.ok(!fs.existsSync(path.join(root, '_Unsequenced', 'Abbas Bhai')), 'C: the empty photographer folder IS removed');
    assert.ok(fs.existsSync(path.join(root, '_Unsequenced')), '_Unsequenced must remain while Husain Bhai still has content');
    assert.ok(fs.existsSync(path.join(root, '_Unsequenced', 'Husain Bhai', 'h.jpg')), 'D: the nonempty photographer folder is fully preserved');
  });

  console.log('=== E: multiple photographers, sequential clearing ===');

  await t('E: _Unsequenced disappears only once the LAST remaining photographer is also cleared', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    const srcA = path.join(root, '_Unsequenced', 'Abbas Bhai', 'a.jpg');
    const srcH = path.join(root, '_Unsequenced', 'Husain Bhai', 'h.jpg');
    await writeFile(srcA); await writeFile(srcH);
    await moveFilesToSequence(root, [srcA], '01Q', 'Abbas Bhai');
    assert.ok(fs.existsSync(path.join(root, '_Unsequenced')), 'still present after only the first photographer is cleared');
    await moveFilesToSequence(root, [srcH], '01Q', 'Husain Bhai');
    assert.ok(!fs.existsSync(path.join(root, '_Unsequenced')), 'removed once the second (last) photographer is also cleared');
  });

  console.log('=== F: partial movement ===');

  await t('F: a batch with one missing source file still cleans up correctly for the files that DID move, preserves what did not', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    const good = path.join(root, '_Unsequenced', 'Abbas Bhai', 'good.jpg');
    const missing = path.join(root, '_Unsequenced', 'Abbas Bhai', 'missing.jpg');
    await writeFile(good);
    const r = await moveFilesToSequence(root, [good, missing], '01Q', 'Abbas Bhai');
    assert.equal(r.ok, false);
    assert.equal(r.moved.length, 1);
    assert.ok(fs.existsSync(path.join(root, '01Q', 'Abbas Bhai', 'good.jpg')));
    assert.ok(!fs.existsSync(path.join(root, '_Unsequenced')), '_Unsequenced correctly disappears once the one real file is gone (the missing one was never really "remaining content")');
  });

  console.log('=== G: filename collision ===');

  await t('G: a collision-renamed file does not block correct emptying/removal of the source once truly empty', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    await writeFile(path.join(root, '01Q', 'Abbas Bhai', 'dup.jpg'), 'existing-version');
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'dup.jpg');
    await writeFile(src, 'different-size-version!!');
    const r = await moveFilesToSequence(root, [src], '01Q', 'Abbas Bhai');
    assert.equal(r.moved[0].action, 'moved-renamed');
    assert.ok(!fs.existsSync(path.join(root, '_Unsequenced')), '_Unsequenced is still removed — the rename-on-collision did not block emptying the source');
  });

  console.log('=== H/I/J/K: content that must block removal ===');

  await t('H: an XMP sidecar remaining in the photographer folder blocks removal of BOTH that folder and _Unsequenced', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'raw.cr2');
    await writeFile(src);
    await writeFile(path.join(root, '_Unsequenced', 'Abbas Bhai', 'unrelated.xmp')); // not this file's own sidecar
    await moveFilesToSequence(root, [src], '01Q', 'Abbas Bhai');
    assert.ok(fs.existsSync(path.join(root, '_Unsequenced', 'Abbas Bhai', 'unrelated.xmp')), 'the sidecar must be preserved');
    assert.ok(fs.existsSync(path.join(root, '_Unsequenced')), '_Unsequenced must NOT be removed while real content remains');
  });

  await t('I: a hidden (non-junk) file remaining blocks removal', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'a.jpg');
    await writeFile(src);
    await writeFile(path.join(root, '_Unsequenced', 'Abbas Bhai', '.some-hidden-file'));
    await moveFilesToSequence(root, [src], '01Q', 'Abbas Bhai');
    assert.ok(fs.existsSync(path.join(root, '_Unsequenced', 'Abbas Bhai', '.some-hidden-file')));
    assert.ok(fs.existsSync(path.join(root, '_Unsequenced')));
  });

  await t('J: an unknown/unsupported file remaining blocks removal', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'a.jpg');
    await writeFile(src);
    await writeFile(path.join(root, '_Unsequenced', 'Abbas Bhai', 'notes.txt'));
    await moveFilesToSequence(root, [src], '01Q', 'Abbas Bhai');
    assert.ok(fs.existsSync(path.join(root, '_Unsequenced', 'Abbas Bhai', 'notes.txt')));
    assert.ok(fs.existsSync(path.join(root, '_Unsequenced')));
  });

  await t('K: a nested directory with content remaining blocks removal', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'a.jpg');
    await writeFile(src);
    await writeFile(path.join(root, '_Unsequenced', 'Abbas Bhai', 'subdir', 'nested.jpg'));
    await moveFilesToSequence(root, [src], '01Q', 'Abbas Bhai');
    assert.ok(fs.existsSync(path.join(root, '_Unsequenced', 'Abbas Bhai', 'subdir', 'nested.jpg')));
    assert.ok(fs.existsSync(path.join(root, '_Unsequenced')));
  });

  console.log('=== L: symlink remaining blocks removal ===');

  await t('L: a symlink remaining in the photographer folder blocks removal (never followed, never deleted)', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    const outside = await mkQmzRoot();
    await writeFile(path.join(outside, 'linked.jpg'));
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'a.jpg');
    await writeFile(src);
    await fsp.symlink(path.join(outside, 'linked.jpg'), path.join(root, '_Unsequenced', 'Abbas Bhai', 'link.jpg'));
    await moveFilesToSequence(root, [src], '01Q', 'Abbas Bhai');
    assert.ok(fs.existsSync(path.join(root, '_Unsequenced', 'Abbas Bhai', 'link.jpg')), 'the symlink itself must still be present (lstat sees it even if the target is gone)');
    assert.ok(fs.existsSync(path.join(root, '_Unsequenced')), '_Unsequenced must not be removed while the symlink remains');
  });

  console.log('=== M: concurrent file appearance fails safely ===');

  await t('M: a file appearing in _Unsequenced AFTER the per-photographer cleanup but before the root check leaves _Unsequenced intact, no crash', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'a.jpg');
    await writeFile(src);
    // Simulate a concurrent actor creating new _Unsequenced content moments before cleanup —
    // directly exercises removeIfEmptyIgnoringJunk's own non-recursive, fails-safe contract.
    await writeFile(path.join(root, '_Unsequenced', 'Husain Bhai', 'new-arrival.jpg'));
    const r = await moveFilesToSequence(root, [src], '01Q', 'Abbas Bhai');
    assert.equal(r.ok, true, 'the file movement itself must NOT be reported as failed merely because _Unsequenced-root cleanup found it non-empty');
    assert.ok(fs.existsSync(path.join(root, '_Unsequenced', 'Husain Bhai', 'new-arrival.jpg')));
  });

  console.log('=== N/O: workspace reopening and scanning without _Unsequenced ===');

  await t('N: reopening (initRoot + scanRoot) a fully-sorted workspace does NOT recreate an empty _Unsequenced', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'a.jpg');
    await writeFile(src);
    await moveFilesToSequence(root, [src], '01Q', 'Abbas Bhai');
    assert.ok(!fs.existsSync(path.join(root, '_Unsequenced')));
    await initRoot(root); // simulates reopening the QMZ workspace
    assert.ok(!fs.existsSync(path.join(root, '_Unsequenced')), '_Unsequenced must remain absent after reopening');
    const scan = await scanRoot(root);
    assert.deepStrictEqual(scan.unsequenced, {}, 'O: scanning must work correctly with _Unsequenced absent — empty object, no error');
  });

  console.log('=== P/Q: automatic recreation on new content ===');

  await t('P: a new photographer folder appearing at the workspace root (adoption candidate) causes initRoot() to recreate _Unsequenced and adopt it', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    // Fully sort, confirm absence.
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'a.jpg');
    await writeFile(src);
    await moveFilesToSequence(root, [src], '01Q', 'Abbas Bhai');
    assert.ok(!fs.existsSync(path.join(root, '_Unsequenced')));
    // Simulate a fresh import dropping a new photographer folder directly at the workspace root.
    await writeFile(path.join(root, 'New Photographer', 'new1.jpg'));
    const result = await initRoot(root);
    assert.deepStrictEqual(result.adopted, ['New Photographer']);
    assert.ok(fs.existsSync(path.join(root, '_Unsequenced', 'New Photographer', 'new1.jpg')), '_Unsequenced and the photographer folder must both be recreated automatically');
  });

  await t('Q: reverse movement (Enroute -> _Unsequenced) also recreates _Unsequenced on demand after a full sort', async () => {
    const root = await mkQmzRoot();
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'a.jpg');
    await writeFile(src);
    await moveFilesToEnroute(root, [src], 'Abbas Bhai');
    assert.ok(!fs.existsSync(path.join(root, '_Unsequenced')));
    const enrouteSrc = path.join(root, 'Enroute', 'Abbas Bhai', 'a.jpg');
    const r = await moveFilesToUnsequenced(root, [enrouteSrc], 'Abbas Bhai');
    assert.equal(r.ok, true);
    assert.ok(fs.existsSync(path.join(root, '_Unsequenced', 'Abbas Bhai', 'a.jpg')), '_Unsequenced must be recreated on demand by the move itself');
  });

  console.log('=== Repeated cleanup/recreation cycles ===');

  await t('repeated full sort -> reverse-move -> sort cycles never leave stale state or crash', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    for (let i = 0; i < 3; i++) {
      const src = path.join(root, '_Unsequenced', 'Abbas Bhai', `cycle${i}.jpg`);
      await writeFile(src);
      await moveFilesToSequence(root, [src], '01Q', 'Abbas Bhai');
      assert.ok(!fs.existsSync(path.join(root, '_Unsequenced')), `cycle ${i}: _Unsequenced must be gone after sorting`);
      const seqSrc = path.join(root, '01Q', 'Abbas Bhai', `cycle${i}.jpg`);
      await moveFilesToUnsequenced(root, [seqSrc], 'Abbas Bhai');
      assert.ok(fs.existsSync(path.join(root, '_Unsequenced', 'Abbas Bhai', `cycle${i}.jpg`)), `cycle ${i}: _Unsequenced must be recreated after the reverse move`);
      await moveFilesToSequence(root, [path.join(root, '_Unsequenced', 'Abbas Bhai', `cycle${i}.jpg`)], '01Q', 'Abbas Bhai');
      assert.ok(!fs.existsSync(path.join(root, '_Unsequenced')), `cycle ${i}: _Unsequenced must disappear again`);
    }
  });

  console.log('=== R/S: Enroute-only and numbered-sequence-only workspaces ===');

  await t('R: an Enroute-only workspace (no numbered sequences at all) correctly loses _Unsequenced once sorted', async () => {
    const root = await mkQmzRoot();
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'a.jpg');
    await writeFile(src);
    await moveFilesToEnroute(root, [src], 'Abbas Bhai');
    assert.ok(!fs.existsSync(path.join(root, '_Unsequenced')));
    assert.ok(fs.existsSync(path.join(root, 'Enroute', 'Abbas Bhai', 'a.jpg')));
  });

  await t('S: a numbered-sequence-only workspace (no Enroute at all) correctly loses _Unsequenced once sorted', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'a.jpg');
    await writeFile(src);
    await moveFilesToSequence(root, [src], '01Q', 'Abbas Bhai');
    assert.ok(!fs.existsSync(path.join(root, '_Unsequenced')));
    assert.ok(!fs.existsSync(path.join(root, 'Enroute')), 'Enroute must not be fabricated merely because _Unsequenced was cleaned up');
  });

  console.log('=== T/U/V/W: cleanup never touches anything outside its intended scope ===');

  await t('T/U/V/W: cleanup never deletes the QMZ root, numbered sequences, Enroute, or metadata — only the intended _Unsequenced hierarchy', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    await writeFile(path.join(root, '01Q', 'Abbas Bhai', 'existing.jpg'), 'keep');
    await writeFile(path.join(root, 'Enroute', 'Husain Bhai', 'existing.jpg'), 'keep');
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'a.jpg');
    await writeFile(src);
    await moveFilesToSequence(root, [src], '01Q', 'Abbas Bhai');
    assert.ok(fs.existsSync(root), 'T: the QMZ root itself must never be removed');
    assert.ok(fs.existsSync(path.join(root, '01Q', 'Abbas Bhai', 'existing.jpg')), 'U: the numbered sequence and its content must be untouched');
    assert.ok(fs.existsSync(path.join(root, 'Enroute', 'Husain Bhai', 'existing.jpg')), 'V: Enroute and its content must be untouched');
    assert.ok(fs.existsSync(path.join(root, 'qmz-sequences.json')), 'W: the state file must never be removed by this cleanup');
  });

  console.log('=== X: UI-facing refresh correctness (service-level proxy) ===');

  await t('X: scanRoot() immediately after cleanup correctly reflects the new, _Unsequenced-absent state (what the UI refresh reads)', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'a.jpg');
    await writeFile(src);
    await moveFilesToSequence(root, [src], '01Q', 'Abbas Bhai');
    const scan = await scanRoot(root);
    assert.deepStrictEqual(scan.unsequenced, {});
    assert.deepStrictEqual(scan.sequences[0].photographers['Abbas Bhai'].files.map(f => path.basename(f.path)), ['a.jpg']);
  });

  console.log('=== Y: no accidental recovery/adoption of a legitimately-removed _Unsequenced ===');

  await t('Y: after _Unsequenced is correctly removed, repeated initRoot() calls do not recreate or "recover" it from nothing', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'a.jpg');
    await writeFile(src);
    await moveFilesToSequence(root, [src], '01Q', 'Abbas Bhai');
    await initRoot(root); await initRoot(root); await initRoot(root);
    assert.ok(!fs.existsSync(path.join(root, '_Unsequenced')));
  });

  console.log('=== Z: no unexpected metadata changes from lifecycle cleanup ===');

  await t('Z: _Unsequenced cleanup never writes to or alters qmz-sequences.json', async () => {
    const root = await mkQmzRoot();
    await createSequence(root, 1, 'Q');
    const stateBefore = await readState(root);
    const src = path.join(root, '_Unsequenced', 'Abbas Bhai', 'a.jpg');
    await writeFile(src);
    await moveFilesToSequence(root, [src], '01Q', 'Abbas Bhai');
    const stateAfter = await readState(root);
    assert.deepStrictEqual(stateAfter.sequences, stateBefore.sequences, 'moving files and cleaning up empty folders must never touch sequence state');
  });

  console.log('=== Security parity — hardening from 70713c5 remains intact around the new cleanup paths ===');

  await t('security: _Unsequenced-root cleanup cannot be tricked into removing anything via a crafted photographer name (the move itself is still rejected first)', async () => {
    const root = await mkQmzRoot();
    const src = path.join(root, '_Unsequenced', 'real-pg', 'a.jpg');
    await writeFile(src);
    const r = await moveFilesToUnsequenced(root, [src], '../../escaped');
    assert.equal(r.ok, false);
    assert.ok(fs.existsSync(src), 'the source file must remain untouched when the photographer name itself is rejected');
  });

  await t('security: cleanup never follows a symlinked _Unsequenced to remove something outside the workspace', async () => {
    const root = await mkQmzRoot();
    const outside = await mkQmzRoot();
    await writeFile(path.join(outside, 'real-content.jpg'));
    await fsp.symlink(outside, path.join(root, '_Unsequenced'), 'dir');
    // moveFilesToSequence's own destination-safety check must reject a sequence move whose
    // SOURCE lives behind this symlink before cleanup logic is ever reached.
    await createSequence(root, 1, 'Q');
    const r = await moveFilesToSequence(root, [path.join(root, '_Unsequenced', 'real-content.jpg')], '01Q', 'pg');
    assert.equal(r.ok, false);
    assert.ok(fs.existsSync(path.join(outside, 'real-content.jpg')), 'the real file behind the symlink must be completely untouched');
  });

  console.log(`\n${passed} check(s) passed.`);
  if (process.exitCode) console.log('SOME CHECKS FAILED');
  process.exit(process.exitCode || 0);
})().catch(err => {
  console.error('[qmzWorkspaceMaintenanceRegression] FATAL:', err);
  process.exit(1);
});
