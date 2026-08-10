'use strict';

// Regression test for the Dirent/stat directory-type hardening implemented in
// main/main.js's master:scanEvents (BUG-011 final RC). Mirrors the exact
// decision expression verbatim (source-drift guarded, TEST 0) rather than
// re-deriving it, since main.js cannot be require()'d standalone outside
// Electron (it requires('electron') at module scope) and Playwright's
// electronApp.evaluate() runs without require()/dynamic import() available
// (confirmed empirically in an earlier round — a genuine Playwright/Electron
// tooling limitation, not a finding about the fix itself).
//
// The fix: `if (!entry.isDirectory()) continue;` (the ONLY gate before this
// RC — see BUG-011's investigation log) is replaced with a three-way check:
//   - Dirent says directory                      → treat as directory (unchanged)
//   - Dirent says NOT directory, stat says YES    → treat as directory (NEW — recovered)
//   - Dirent says NOT directory, stat agrees/fails → reject (unchanged, still correct)
//
// This is filesystem robustness hardening only — see main/main.js's own
// comment at the fix site for the full rationale and the BUG-011 investigation
// log for the Node/libuv research this was informed by.
//
// Run: node test/bug011DirentMismatchRegression.test.js

const assert = require('node:assert/strict');
const fs   = require('node:fs');
const fsp  = require('node:fs/promises');
const os   = require('node:os');
const path = require('node:path');

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

const MAIN_JS_PATH = path.join(__dirname, '..', 'main', 'main.js');

// TEST 0 — source-drift guard: fail loudly if the exact expression this test
// mirrors is no longer present verbatim in main.js.
t('source-drift guard: master:scanEvents still contains the exact hardening expression this test mirrors', () => {
  const src = fs.readFileSync(MAIN_JS_PATH, 'utf8');
  assert.ok(
    src.includes('const _treatedAsDirectory = _direntSaysDir || _recoveredViaStat;'),
    'main/main.js no longer contains the exact hardening expression — update this test to match before trusting its result'
  );
  assert.ok(
    src.includes("const _recoveredViaStat = !_direntSaysDir && _statIsDirectory === true;"),
    'main/main.js no longer contains the exact recovery condition — update this test to match before trusting its result'
  );
});

// The exact decision logic from master:scanEvents, mirrored verbatim.
function treatedAsDirectory(direntIsDirectory, statIsDirectoryOrNull) {
  const _direntSaysDir    = direntIsDirectory;
  const _recoveredViaStat = !_direntSaysDir && statIsDirectoryOrNull === true;
  const _treatedAsDirectory = _direntSaysDir || _recoveredViaStat;
  return { treatedAsDirectory: _treatedAsDirectory, recoveredViaStat: _recoveredViaStat };
}

t('CASE 1 (unchanged): Dirent says directory — treated as directory, no recovery flag', () => {
  const r = treatedAsDirectory(true, true);
  assert.equal(r.treatedAsDirectory, true);
  assert.equal(r.recoveredViaStat, false);
});

t('CASE 2 (NEW — the fix): Dirent says NOT directory, stat says directory — RECOVERED, treated as directory', () => {
  const r = treatedAsDirectory(false, true);
  assert.equal(r.treatedAsDirectory, true, 'this is the exact scenario a Windows/SMB Dirent-type misreport would produce — must now recover');
  assert.equal(r.recoveredViaStat, true, 'must be flagged as a recovery so DIR_ENTRY_TYPE_MISMATCH is logged');
});

t('CASE 3 (unchanged): Dirent says NOT directory, stat AGREES (also not a directory) — correctly rejected, no false recovery', () => {
  const r = treatedAsDirectory(false, false);
  assert.equal(r.treatedAsDirectory, false, 'a genuine file must still be rejected — the fix must not accept everything');
  assert.equal(r.recoveredViaStat, false);
});

t('CASE 4 (unchanged): Dirent says NOT directory, stat THREW (path inaccessible, statIsDirectory is null) — correctly rejected', () => {
  const r = treatedAsDirectory(false, null);
  assert.equal(r.treatedAsDirectory, false, 'an inaccessible path must not be treated as a recovered directory');
  assert.equal(r.recoveredViaStat, false);
});

(async () => {
  // ── End-to-end confirmation against a REAL directory + real fs.stat() ───────
  // Proves the underlying fs.stat() behavior this fix depends on is what it's
  // assumed to be, on this machine, right now — not just the boolean algebra.
  const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-dirent-regression-'));
  const realDir = path.join(tmpRoot, '1448-02-22 _01-QMZ-East London-Arrival-Ziyarat-London');
  await fsp.mkdir(realDir, { recursive: true });
  await fsp.writeFile(path.join(realDir, 'event.json'), JSON.stringify({ version: 1 }), 'utf8');

  let statIsDirectory;
  try {
    statIsDirectory = (await fsp.stat(realDir)).isDirectory();
  } catch (err) {
    statIsDirectory = `THREW: ${err.message}`;
  }

  if (statIsDirectory === true) {
    passed++;
    console.log('  ok — TEST 5: fs.stat() on a real, genuinely-present directory reports isDirectory()===true ' +
      '(confirms the recovery path\'s data source is trustworthy on this machine)');
  } else {
    process.exitCode = 1;
    console.error(`  FAIL — TEST 5: expected fs.stat().isDirectory() === true, got ${JSON.stringify(statIsDirectory)}`);
  }

  const combined = treatedAsDirectory(false, statIsDirectory === true);
  if (combined.treatedAsDirectory === true && combined.recoveredViaStat === true) {
    passed++;
    console.log('  ok — TEST 6: end-to-end — a faked "Dirent says false" for this real directory, combined with ' +
      'its real fs.stat() result, is correctly recovered by the mirrored decision logic');
  } else {
    process.exitCode = 1;
    console.error('  FAIL — TEST 6: end-to-end recovery did not produce the expected result:', JSON.stringify(combined));
  }

  await fsp.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});

  console.log(`\n${passed} test(s) passed.`);
})();
