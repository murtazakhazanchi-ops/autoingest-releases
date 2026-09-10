'use strict';

// Regression test for the CARD-source browsing bug (reported against a real
// Canon EOS R6 card, EOS_DIGITAL, mounted correctly per Finder but shown by
// AutoIngest as "Card" with no DCIM child, "0 files · 0 folders", both
// Folder view and Media view broken).
//
// Root cause: CARD mode built its folder tree via buildFolderTree(files) —
// a function that constructs a tree PURELY from the flat file-path list
// returned by scanMediaRecursive() (a MEDIA-FILE-ONLY recursive scan). A
// directory containing zero media anywhere beneath it — including the
// whole card, on a freshly formatted or already-imported card, or one
// camera folder next to another that still has media — was therefore
// completely invisible: it never appeared in any file path, so it never
// became a tree node.
//
// Fixed per the architectural rule: "Directory structure comes from
// directory enumeration. Media membership comes from the media scan. The
// two datasets may then be combined." — implemented as
// buildCardFolderTree() in main/fileBrowser.js, which runs
// getShallowFolderTree() (directory-only enumeration, no stat calls) and
// scanMediaRecursive() (media-file-only scan) in PARALLEL, then merges the
// flat file list onto the directory skeleton via attachFilesToTree().
//
// This deliberately does NOT special-case "if (files.length === 0) use
// getShallowFolderTree(...)" — that narrow fix would still fail the mixed
// case covered by Scenario 3 below (one populated camera folder next to an
// empty sibling): the empty sibling would vanish again because the
// overall file list is non-empty.
//
// Run: node test/cardFolderTreeBugfix.test.js

const assert = require('node:assert/strict');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  getShallowFolderTree,
  scanMediaRecursive,
  attachFilesToTree,
  buildCardFolderTree,
} = require('../main/fileBrowser.js');

let passed = 0;
function ok(name) { passed++; console.log(`  ok — ${name}`); }
function fail(name, detail) {
  process.exitCode = 1;
  console.error(`  FAIL — ${name}`);
  if (detail !== undefined) console.error(detail);
}

async function mkTmp(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function mkdirs(root, relDirs) {
  for (const rel of relDirs) {
    await fsp.mkdir(path.join(root, rel), { recursive: true });
  }
}

// scanMediaRecursive drops any file under MIN_FILE_BYTES (50 KB) as a
// thumbnail/proxy/sidecar stub — fixture media files must clear that bar
// to be recognized as real media.
const FAKE_MEDIA_BYTES = Buffer.alloc(60 * 1024, 0xab);

async function touch(root, relFile) {
  const full = path.join(root, relFile);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, FAKE_MEDIA_BYTES);
}

function findChild(node, name) {
  return (node.children || []).find((c) => c.name === name);
}

async function run() {
  // ── Scenario 1: completely empty-of-media card ──────────────────────────
  // DCIM/100CANON/ and MISC/ both exist and are empty. The whole card has
  // zero media anywhere. This is the exact shape of the originally reported
  // bug: buildFolderTree([]) degenerates to {name:'', path:'', children:[],
  // files:[]} when fed an empty file list, so the entire tree vanished.
  {
    const root = await mkTmp('ai-card-empty-');
    await mkdirs(root, ['DCIM/100CANON', 'MISC']);

    const { tree, files } = await buildCardFolderTree(root);

    assert.equal(files.length, 0, 'no media discovered');
    const dcim = findChild(tree, 'DCIM');
    assert.ok(dcim, 'DCIM must appear even though the card has zero media');
    const cameraFolder = findChild(dcim, '100CANON');
    assert.ok(cameraFolder, '100CANON must appear even though it is empty');
    assert.equal(cameraFolder.files.length, 0);
    const misc = findChild(tree, 'MISC');
    assert.ok(misc, 'MISC must appear even though it is empty');
    ok('Scenario 1: empty-of-media card — DCIM/100CANON and MISC both visible, 0 files');
  }

  // ── Scenario 2: populated card ───────────────────────────────────────────
  // A normal, fully-populated card — the common case that must keep working.
  {
    const root = await mkTmp('ai-card-populated-');
    await touch(root, 'DCIM/100CANON/IMG_0001.CR3');
    await touch(root, 'DCIM/100CANON/IMG_0002.CR3');
    await mkdirs(root, ['MISC']);

    const { tree, files } = await buildCardFolderTree(root);

    assert.equal(files.length, 2, 'both media files discovered');
    const cameraFolder = findChild(findChild(tree, 'DCIM'), '100CANON');
    assert.ok(cameraFolder, '100CANON present');
    assert.equal(cameraFolder.files.length, 2, 'both files attached to their real parent node');
    assert.deepEqual(
      cameraFolder.files.map((f) => f.name).sort(),
      ['IMG_0001.CR3', 'IMG_0002.CR3'],
    );
    ok('Scenario 2: populated card — media correctly attached to its owning folder node');
  }

  // ── Scenario 3: mixed populated + empty sibling folders ─────────────────
  // This is the scenario that a narrow "if empty file list, fall back to
  // getShallowFolderTree" fix would NOT catch: the overall file list is
  // non-empty (100CANON has media), yet 101CANON — a sibling with zero
  // media — must still remain visible and navigable.
  {
    const root = await mkTmp('ai-card-mixed-');
    await touch(root, 'DCIM/100CANON/IMG_0001.CR3');
    await mkdirs(root, ['DCIM/101CANON']);

    const { tree, files } = await buildCardFolderTree(root);

    assert.equal(files.length, 1);
    const dcim = findChild(tree, 'DCIM');
    const populated = findChild(dcim, '100CANON');
    const empty = findChild(dcim, '101CANON');
    assert.ok(populated, '100CANON (populated) present');
    assert.ok(empty, '101CANON (empty sibling) must remain visible — this is the bug this fix targets');
    assert.equal(populated.files.length, 1);
    assert.equal(empty.files.length, 0);
    ok('Scenario 3: mixed populated+empty sibling folders — this test prevents the tempting empty-whole-card-only fix');
  }

  // ── Scenario 4: nested empty directory ───────────────────────────────────
  // An empty directory nested two levels beneath another already-empty
  // directory must still surface as a real, navigable node.
  {
    const root = await mkTmp('ai-card-nested-empty-');
    await mkdirs(root, ['DCIM/100CANON/EMPTYSUB/DEEPER']);

    const { tree, files } = await buildCardFolderTree(root);

    assert.equal(files.length, 0);
    const cameraFolder = findChild(findChild(tree, 'DCIM'), '100CANON');
    assert.ok(cameraFolder, '100CANON present');
    const emptySub = findChild(cameraFolder, 'EMPTYSUB');
    assert.ok(emptySub, 'EMPTYSUB (nested empty dir) must be visible');
    const deeper = findChild(emptySub, 'DEEPER');
    assert.ok(deeper, 'DEEPER (doubly-nested empty dir) must be visible');
    ok('Scenario 4: nested empty directory — surfaces at every depth');
  }

  // ── Scenario 5: junk/system directories remain filtered ─────────────────
  // Pre-existing SKIP_DIRS/hidden-dot-prefix filtering (shared identically
  // by getShallowFolderTree and scanMediaRecursive) must still exclude
  // known junk directories, even now that empty directories are otherwise
  // shown unconditionally.
  {
    const root = await mkTmp('ai-card-junk-');
    await touch(root, 'DCIM/100CANON/IMG_0001.CR3');
    await mkdirs(root, ['System Volume Information', '.Trashes', '.hiddenDir']);

    const { tree } = await buildCardFolderTree(root);

    assert.ok(!findChild(tree, 'System Volume Information'), 'SKIP_DIRS entry must not appear');
    assert.ok(!findChild(tree, '.Trashes'), 'SKIP_DIRS dotfile entry must not appear');
    assert.ok(!findChild(tree, '.hiddenDir'), 'hidden dot-prefixed dir must not appear');
    assert.ok(findChild(tree, 'DCIM'), 'legitimate DCIM dir still present');
    ok('Scenario 5: junk/system directories remain filtered, legitimate dirs unaffected');
  }

  // ── Scenario 6: Folder/Media mode relationship ───────────────────────────
  // Folder view must show a directory even when it holds no *recognized
  // media* — legitimacy is never decided by whether media exists. Media
  // view (the flat `files` list) must continue to report only actual,
  // recognized media — a non-media file sitting in a folder must not
  // silently promote that folder out of the "zero media" state, and must
  // never appear in the files list itself.
  {
    const root = await mkTmp('ai-card-mode-relationship-');
    await touch(root, 'DCIM/100CANON/IMG_0001.CR3'); // real media
    await fsp.mkdir(path.join(root, 'DCIM', '101CANON'), { recursive: true });
    await fsp.writeFile(path.join(root, 'DCIM', '101CANON', 'notes.txt'), 'not media'); // non-media file
    await fsp.writeFile(path.join(root, 'DCIM', '101CANON', '.DS_Store'), 'junk'); // junk file

    const { tree, files } = await buildCardFolderTree(root);

    // Media view: only the one real media file, never the .txt or .DS_Store.
    assert.equal(files.length, 1);
    assert.equal(files[0].name, 'IMG_0001.CR3');

    // Folder view: 101CANON is still visible and navigable even though it
    // has zero *media* (it holds only a non-media file and a junk file).
    const dcim = findChild(tree, 'DCIM');
    const folderWithNoMedia = findChild(dcim, '101CANON');
    assert.ok(folderWithNoMedia, '101CANON must be visible in Folder view despite holding no recognized media');
    assert.equal(folderWithNoMedia.files.length, 0, 'Media view correctly reports zero media for 101CANON');
    ok('Scenario 6: Folder view shows zero-media dirs; Media view still reports only actual media');
  }

  // ── attachFilesToTree: orphan-file safety net ────────────────────────────
  // A file whose dirname isn't present in the skeleton (only possible if
  // the skeleton's own depth/node cap was hit) must attach to the root
  // rather than being silently dropped.
  {
    const root = { name: 'root', path: '/synthetic/root', children: [], files: [] };
    const files = [{ name: 'orphan.jpg', path: '/synthetic/root/unindexed/orphan.jpg', type: 'photo' }];
    attachFilesToTree(root, files);
    assert.equal(root.files.length, 1, 'orphaned file attaches to root instead of vanishing');
    ok('attachFilesToTree: file with no matching tree node falls back to root, never dropped');
  }

  console.log(`\n${passed} check(s) passed.`);
  if (process.exitCode === 1) {
    console.error('\nSOME CHECKS FAILED.');
  } else {
    console.log('\nALL CHECKS PASSED.');
  }
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
