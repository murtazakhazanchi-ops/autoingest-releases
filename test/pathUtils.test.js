'use strict';

// Windows/UNC path forensics for renderer/pathUtils.js — the fix for Bug 2
// (existing collection intermittently disappears from Event Management).
//
// Root cause: EventCreator.setSessionArchiveRoot() used to test collection
// membership with `somePath.startsWith(root + '/')`. On Windows, real paths
// from fs/path APIs are backslash-separated (UNC roots look like
// \\server\share\1448), so the literal forward slash appended to `root`
// never matched — every collection nested under the active root silently
// failed the check and was dropped from session state on every archive-root
// sync (app startup, Archive Locations Save). This exercises the fix,
// isPathUnderRoot(), against Windows-shaped fixtures using path.win32 so it
// reproduces reliably on a macOS/Linux dev host too.
//
// Run with: node test/pathUtils.test.js

const assert = require('node:assert/strict');
const path = require('node:path');
const { isPathUnderRoot, isPathUnderOrEqualToRoot } = require('../renderer/pathUtils');

let passed = 0;
function t(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok — ${name}`);
  } catch (err) {
    console.error(`  FAIL — ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const win32 = path.win32;

// ── UNC roots (the tester's exact reported shape) ──────────────────────────

t('UNC collection path is recognised as under the UNC archive root', () => {
  const root = '\\\\FQ_PhotoArchive\\02-Working-AJSS\\1448';
  const coll = win32.join(root, '1448-01-11 _UK Safar');
  assert.equal(isPathUnderRoot(coll, root), true);
});

t('UNC event folder (two levels deep) is recognised as under the UNC archive root', () => {
  const root = '\\\\FQ_PhotoArchive\\02-Working-AJSS\\1448';
  const evt  = win32.join(root, '1448-01-11 _UK Safar', '1448-01-11 _01-Waaz Mubarak-Bradford');
  assert.equal(isPathUnderRoot(evt, root), true);
});

t('regression guard: literal startsWith(root + "/") fails on the same UNC fixture (proves the bug existed)', () => {
  const root = '\\\\FQ_PhotoArchive\\02-Working-AJSS\\1448';
  const coll = win32.join(root, '1448-01-11 _UK Safar');
  // This is the exact expression that shipped in setSessionArchiveRoot() before the fix.
  assert.equal(coll.startsWith(root + '/'), false);
});

// ── Separator + trailing-slash variants ─────────────────────────────────────

t('root with a trailing backslash still matches', () => {
  const root = '\\\\FQ_PhotoArchive\\02-Working-AJSS\\1448\\';
  const coll = '\\\\FQ_PhotoArchive\\02-Working-AJSS\\1448\\1448-01-11 _UK Safar';
  assert.equal(isPathUnderRoot(coll, root), true);
});

t('mixed separators (root backslash, child forward slash) still match', () => {
  const root = '\\\\FQ_PhotoArchive\\02-Working-AJSS\\1448';
  const coll = '\\\\FQ_PhotoArchive/02-Working-AJSS/1448/1448-01-11 _UK Safar';
  assert.equal(isPathUnderRoot(coll, root), true);
});

t('POSIX-style paths (macOS mounted share) still match', () => {
  const root = '/Volumes/FQ_PhotoArchive/02-Working-AJSS/1448';
  const coll = '/Volumes/FQ_PhotoArchive/02-Working-AJSS/1448/1448-01-11 _UK Safar';
  assert.equal(isPathUnderRoot(coll, root), true);
});

// ── Case sensitivity (Windows/SMB paths are not case-sensitive) ────────────

t('differently-cased drive/share segments still match on Windows-shaped paths', () => {
  const root = '\\\\FQ_PhotoArchive\\02-Working-AJSS\\1448';
  const coll = '\\\\fq_photoarchive\\02-working-ajss\\1448\\1448-01-11 _UK Safar';
  assert.equal(isPathUnderRoot(coll, root), true);
});

t('a Windows drive-letter root is also treated case-insensitively', () => {
  const root = 'C:\\Archive\\1448';
  const coll = 'c:\\archive\\1448\\1448-01-11 _UK Safar';
  assert.equal(isPathUnderRoot(coll, root), true);
});

t('POSIX-shaped paths (e.g. Local Staging on a case-sensitive filesystem) are NOT case-folded — a differently-cased directory is correctly treated as a different collection', () => {
  const root = '/Volumes/LocalStaging/1448';
  const differentlyCasedSibling = '/Volumes/LocalStaging/1448/1448-01-11 _uk safar'; // lowercase vs the real one below
  const realColl = '/Volumes/LocalStaging/1448/1448-01-11 _UK Safar';
  // Both are genuinely "under root" on a POSIX path regardless of case, since the
  // *root* segment itself is untouched here — this only proves case-SENSITIVE
  // comparison is in effect, not a containment false-negative.
  assert.equal(isPathUnderRoot(realColl, root), true);
  assert.equal(isPathUnderRoot(differentlyCasedSibling, root), true);
  // The real regression this guards: two directories differing ONLY by case in the
  // ROOT segment itself must NOT be treated as the same root on a POSIX-shaped path.
  const differentlyCasedRoot = '/Volumes/localstaging/1448';
  assert.equal(isPathUnderRoot(realColl, differentlyCasedRoot), false);
  // The same differently-cased root DOES match on a Windows-shaped path.
  const winRoot = 'C:\\LocalStaging\\1448';
  const winRootDiffCase = 'C:\\localstaging\\1448';
  const winColl = 'C:\\LocalStaging\\1448\\1448-01-11 _UK Safar';
  assert.equal(isPathUnderRoot(winColl, winRootDiffCase), true);
  assert.equal(isPathUnderRoot(winColl, winRoot), true);
});

// ── Names containing spaces, underscores, hyphens ───────────────────────────

t('collection and event names with spaces, underscores, and hyphens are handled', () => {
  const root = '\\\\FQ_PhotoArchive\\02-Working-AJSS\\1448';
  const evt  = win32.join(root, '1448-01-26 _03-Waaz Mubarak-Ziyafat-Bethak-Jumua-Zohr Asr Namaz-Adam Masjid-Bradford');
  assert.equal(isPathUnderRoot(evt, root), true);
});

// ── Negative cases — must NOT be treated as nested ──────────────────────────

t('a sibling collection under a different root is NOT matched', () => {
  const root = '\\\\FQ_PhotoArchive\\02-Working-AJSS\\1448';
  const other = '\\\\FQ_PhotoArchive\\02-Working-AJSS\\1449\\1449-01-01 _Something';
  assert.equal(isPathUnderRoot(other, root), false);
});

t('a path that merely shares a string prefix (not a real path segment boundary) is NOT matched', () => {
  const root = '\\\\FQ_PhotoArchive\\02-Working-AJSS\\1448';
  const lookalike = '\\\\FQ_PhotoArchive\\02-Working-AJSS\\14489-01-01 _NotTheSameCollection';
  assert.equal(isPathUnderRoot(lookalike, root), false);
});

t('the root path itself (not a subdirectory) is NOT matched — matches prior strict-subdirectory semantics', () => {
  const root = '\\\\FQ_PhotoArchive\\02-Working-AJSS\\1448';
  assert.equal(isPathUnderRoot(root, root), false);
});

t('null/undefined/empty inputs never throw and return false', () => {
  assert.equal(isPathUnderRoot(null, '\\\\a\\b'), false);
  assert.equal(isPathUnderRoot('\\\\a\\b\\c', null), false);
  assert.equal(isPathUnderRoot('', ''), false);
  assert.equal(isPathUnderRoot(undefined, undefined), false);
});

// ── isPathUnderOrEqualToRoot — Canonical Representation Audit L1 (2026-08-11) ──
// Several main-process containment gates (main.js: collection:prepareOffline,
// collection:matchToNas, and others) previously used their own ad hoc
// `x === root || x.startsWith(root + path.sep)` check with plain path.resolve()
// — no case-folding, so a real Windows/SMB casing mismatch between the stored
// nasRoot setting and a server-returned nasCollectionPath would incorrectly
// reject a valid operation. Fixed by routing all of them through this one
// shared function instead of each re-implementing the "or-equal" case.

t('isPathUnderOrEqualToRoot: a descendant path is matched (same as isPathUnderRoot)', () => {
  const root = '\\\\FQ_PhotoArchive\\02-Working-AJSS\\1448';
  const coll = win32.join(root, '1448-01-11 _UK Safar');
  assert.equal(isPathUnderOrEqualToRoot(coll, root), true);
});

t('isPathUnderOrEqualToRoot: the root path itself IS matched (the "or-equal" case isPathUnderRoot deliberately excludes)', () => {
  const root = '\\\\FQ_PhotoArchive\\02-Working-AJSS\\1448';
  assert.equal(isPathUnderOrEqualToRoot(root, root), true);
  assert.equal(isPathUnderRoot(root, root), false); // confirms the two functions genuinely differ here
});

t('isPathUnderOrEqualToRoot: exact match with different casing on a Windows-shaped path is matched', () => {
  const root = '\\\\FQ_PhotoArchive\\02-Working-AJSS\\1448';
  const rootDiffCase = '\\\\fq_photoarchive\\02-working-ajss\\1448';
  assert.equal(isPathUnderOrEqualToRoot(rootDiffCase, root), true);
});

t('isPathUnderOrEqualToRoot: a descendant path with different casing on the shared prefix is matched — the exact BUG-011-class case for collection:prepareOffline/matchToNas', () => {
  const root = '\\\\FQ_PhotoArchive\\02-Working-AJSS';
  const nasCollectionPath = '\\\\fq_photoarchive\\02-working-ajss\\1448\\1448-01-11 _UK Safar';
  assert.equal(isPathUnderOrEqualToRoot(nasCollectionPath, root), true);
});

t('isPathUnderOrEqualToRoot: a sibling/unrelated path is still correctly rejected (no security broadening)', () => {
  const root = '\\\\FQ_PhotoArchive\\02-Working-AJSS\\1448';
  const other = '\\\\FQ_PhotoArchive\\02-Working-AJSS\\1449\\1449-01-01 _Something';
  assert.equal(isPathUnderOrEqualToRoot(other, root), false);
});

t('isPathUnderOrEqualToRoot: a lookalike prefix (not a real path segment boundary) is still correctly rejected', () => {
  const root = '\\\\FQ_PhotoArchive\\02-Working-AJSS\\1448';
  const lookalike = '\\\\FQ_PhotoArchive\\02-Working-AJSS\\14489-01-01 _NotTheSameCollection';
  assert.equal(isPathUnderOrEqualToRoot(lookalike, root), false);
});

t('isPathUnderOrEqualToRoot: POSIX-shaped paths remain case-sensitive (no broadening for Local Staging on case-sensitive filesystems)', () => {
  const root = '/Users/tester/LocalStaging/1448';
  const differentCase = '/Users/tester/localstaging/1448';
  assert.equal(isPathUnderOrEqualToRoot(differentCase, root), false);
});

t('isPathUnderOrEqualToRoot: null/undefined/empty inputs never throw and return false', () => {
  assert.equal(isPathUnderOrEqualToRoot(null, '\\\\a\\b'), false);
  assert.equal(isPathUnderOrEqualToRoot('\\\\a\\b\\c', null), false);
  assert.equal(isPathUnderOrEqualToRoot('', ''), false);
  assert.equal(isPathUnderOrEqualToRoot(undefined, undefined), false);
});

console.log(`\n${passed} test(s) passed.`);
