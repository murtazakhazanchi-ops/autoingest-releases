'use strict';

// Regression test for the Canonical Representation Audit's L2 finding
// (2026-08-11): transferImportService.js's _readCheckpoint() trusted its
// numeric progress fields (currentBatchIdx, totalCopied, totalSkipped,
// totalRenamed, totalChangedSkipped, totalFiles) unvalidated — only
// `checkpoint.batches` got an explicit Array.isArray guard before use in
// resumeImportFromCheckpoint(). A checkpoint whose numeric fields were ever
// anything other than a genuine number (a hand-edited file, a future format,
// a not-yet-written producer bug) would pass through the old `|| 0` fallback
// unchanged if truthy, silently turning later `+=` progress arithmetic into
// string concatenation — same defect class as BUG-011, not yet triggered by
// any current writer.
//
// Fix: normalize these fields once, in _readCheckpoint() itself (exercised
// here through the exported getImportCheckpoint() wrapper — no internal API
// reached into). The on-disk checkpoint file is never rewritten by this fix;
// only the in-memory object handed back to callers is normalized.
//
// Uses the real module against a real temp checkpoint file — no mocks, no
// Electron dependency (transferImportService.js has none).
//
// Run: node test/l2CheckpointNumericNormalization.test.js

const assert = require('node:assert/strict');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { getImportCheckpoint } = require('../services/transferImportService');

let passed = 0;
function ok(name) { passed++; console.log(`  ok — ${name}`); }
function fail(name, detail) {
  process.exitCode = 1;
  console.error(`  FAIL — ${name}`);
  if (detail !== undefined) console.error(detail);
}

async function writeCheckpointFixture(mainArchiveRoot, data) {
  const dir = path.join(mainArchiveRoot, '.autoingest', 'transfer-imports');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'import-checkpoint.json'), JSON.stringify(data, null, 2), 'utf8');
}

(async () => {
  const mainArchiveRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'ai-l2-checkpoint-'));

  // TEST 1: a normal, correctly-typed checkpoint is unaffected.
  await writeCheckpointFixture(mainArchiveRoot, {
    transferRoot: '/x', importId: 'batch-1', mode: 'plain', status: 'in-progress',
    batches: [{ id: 1 }], currentBatchIdx: 2, totalCopied: 40, totalSkipped: 1,
    totalRenamed: 0, totalChangedSkipped: 0, totalFiles: 100,
  });
  {
    const cp = await getImportCheckpoint(mainArchiveRoot);
    try {
      assert.equal(cp.currentBatchIdx, 2);
      assert.equal(cp.totalCopied, 40);
      assert.equal(cp.totalFiles, 100);
      assert.equal(typeof cp.currentBatchIdx, 'number');
      ok('TEST 1: a normally-typed checkpoint is read back unchanged');
    } catch (err) {
      fail('TEST 1: normal checkpoint read-back mismatch', err.message);
    }
  }

  // TEST 2: numeric-string fields (the exact BUG-011-class hazard) are
  // coerced to real numbers, not passed through as strings.
  await writeCheckpointFixture(mainArchiveRoot, {
    transferRoot: '/x', importId: 'batch-2', mode: 'plain', status: 'in-progress',
    batches: [{ id: 1 }], currentBatchIdx: '3', totalCopied: '55', totalSkipped: '2',
    totalRenamed: '0', totalChangedSkipped: '1', totalFiles: '200',
  });
  {
    const cp = await getImportCheckpoint(mainArchiveRoot);
    try {
      assert.equal(cp.currentBatchIdx, 3);
      assert.equal(typeof cp.currentBatchIdx, 'number');
      assert.equal(cp.totalCopied, 55);
      assert.equal(typeof cp.totalCopied, 'number');
      assert.equal(cp.totalFiles, 200);
      assert.equal(typeof cp.totalFiles, 'number');
      // Prove arithmetic actually works correctly post-normalization — this
      // is the concrete failure mode the fix prevents (string concatenation).
      assert.equal(cp.totalCopied + 5, 60);
      ok('TEST 2: numeric-string fields are coerced to real numbers, and arithmetic on them is correct (not concatenation)');
    } catch (err) {
      fail('TEST 2: numeric-string coercion failed', err.message);
    }
  }

  // TEST 3: genuinely invalid (non-numeric, non-coercible) values default to
  // 0, matching the prior `|| 0` fallback's intent for missing/falsy values,
  // without ever handing back something a caller's `+=` could silently
  // corrupt on.
  await writeCheckpointFixture(mainArchiveRoot, {
    transferRoot: '/x', importId: 'batch-3', mode: 'plain', status: 'in-progress',
    batches: [{ id: 1 }], currentBatchIdx: 'not-a-number', totalCopied: null,
    totalSkipped: undefined, totalRenamed: {}, totalChangedSkipped: [], totalFiles: true,
  });
  {
    const cp = await getImportCheckpoint(mainArchiveRoot);
    try {
      for (const field of ['currentBatchIdx', 'totalCopied', 'totalSkipped', 'totalRenamed', 'totalChangedSkipped', 'totalFiles']) {
        assert.equal(cp[field], 0, `${field} should default to 0`);
        assert.equal(typeof cp[field], 'number', `${field} should be a number, not ${typeof cp[field]}`);
      }
      ok('TEST 3: genuinely invalid values default to 0 as a real number, never pass through as the wrong type');
    } catch (err) {
      fail('TEST 3: invalid-value defaulting failed', err.message);
    }
  }

  // TEST 4: batches (already-guarded elsewhere) and non-numeric fields
  // (transferRoot, importId, mode, status) are untouched by this fix — scope
  // check, not a blanket rewrite of the checkpoint shape.
  {
    const cp = await getImportCheckpoint(mainArchiveRoot);
    try {
      assert.equal(cp.transferRoot, '/x');
      assert.equal(cp.importId, 'batch-3');
      assert.deepStrictEqual(cp.batches, [{ id: 1 }]);
      ok('TEST 4: non-numeric fields are passed through unchanged — fix is scoped to the numeric fields only');
    } catch (err) {
      fail('TEST 4: unrelated field was unexpectedly altered', err.message);
    }
  }

  // TEST 5: the on-disk file itself is never rewritten by a read — the
  // persisted format guarantee from the task's own instruction.
  {
    const raw = await fsp.readFile(path.join(mainArchiveRoot, '.autoingest', 'transfer-imports', 'import-checkpoint.json'), 'utf8');
    const onDisk = JSON.parse(raw);
    try {
      assert.equal(onDisk.currentBatchIdx, 'not-a-number'); // still the original invalid string on disk
      assert.equal(onDisk.totalCopied, null);
      ok('TEST 5: the persisted checkpoint file itself is untouched by normalization — read-only fix, as required');
    } catch (err) {
      fail('TEST 5: persisted file was unexpectedly modified', err.message);
    }
  }

  await fsp.rm(mainArchiveRoot, { recursive: true, force: true }).catch(() => {});

  console.log(`\n${passed} test(s) passed.`);
})();
