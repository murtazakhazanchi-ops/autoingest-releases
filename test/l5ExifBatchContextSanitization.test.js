'use strict';

// Regression test for the Canonical Representation Audit's L5 finding
// (2026-08-11): main/exifService.js's getBatchStatus(batchId) returns the
// internal batch object raw — including `_context` (whatever object was
// passed to applyBatch() by its caller — verified safe at 2+ call sites, but
// never independently validated at this boundary) and `_resolved` (per-file
// frozen expectation snapshots, also internal-only). The IPC-exposed
// metadata:getStatus handler sent that raw object straight to the renderer.
//
// Fix is scoped to the IPC boundary only: main.js's metadata:getStatus
// handler now destructures _context/_resolved out before returning.
// exifService.getBatchStatus() itself, and main.js's OWN internal call to it
// inside metadata:retry (which reads _context.eventJsonPath directly, main-
// process-side, never over IPC), are both deliberately untouched — metadata
// behavior for that consumer is unchanged, per the task's own instruction.
//
// TEST 0 is a source-drift guard proving the projection is actually wired at
// the IPC handler. TESTS 1-3 mirror the exact destructuring expression
// verbatim against representative batch shapes (a plain Node test — no
// ExifTool/real batch run needed to validate a destructuring expression).
//
// Run: node test/l5ExifBatchContextSanitization.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let passed = 0;
function ok(name) { passed++; console.log(`  ok — ${name}`); }
function fail(name, detail) {
  process.exitCode = 1;
  console.error(`  FAIL — ${name}`);
  if (detail !== undefined) console.error(detail);
}

// ── TEST 0: source-drift guard ───────────────────────────────────────────────
(function test0() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'main', 'main.js'), 'utf8');
  const handlerStart = src.indexOf("ipcMain.handle('metadata:getStatus'");
  if (handlerStart === -1) {
    fail('TEST 0: metadata:getStatus handler not found in main.js — this test needs updating');
    return;
  }
  const handlerBody = src.slice(handlerStart, handlerStart + 700);
  const hasProjection = handlerBody.includes('const { _context, _resolved, ...publicStatus } = batch;') && handlerBody.includes('return publicStatus;');
  const retryStillUsesRawContext = src.includes("exifService.getBatchStatus(batchId)?._context || null");
  if (hasProjection) {
    ok('TEST 0a: metadata:getStatus destructures _context/_resolved out before returning');
  } else {
    fail('TEST 0a: expected projection expression not found in metadata:getStatus handler');
  }
  if (retryStillUsesRawContext) {
    ok('TEST 0b: metadata:retry still reads the RAW _context internally (main-process-only, never over IPC) — confirms the fix is scoped to the IPC boundary, not exifService.getBatchStatus() itself');
  } else {
    fail('TEST 0b: metadata:retry no longer reads _context the expected way — verify this fix did not change that internal call\'s behavior');
  }
})();

// Mirrors the exact fix expression, verbatim (see TEST 0's source-drift guard).
function projectBatchStatus(batch) {
  if (!batch) return batch;
  const { _context, _resolved, ...publicStatus } = batch;
  return publicStatus;
}

(function tests() {
  // A representative batch shape, matching main/exifService.js's applyBatch()
  // construction (total/done/skipped/failed/partial/ambiguous/excluded/files,
  // plus the two internal-only fields this fix removes).
  const rawBatch = {
    total: 10, done: 6, skipped: 1, failed: 0, partial: 0, ambiguous: 0, excluded: 3,
    files: [{ status: 'complete', src: '/a', dest: '/b' }],
    _context: { eventJsonPath: '/archive/event.json', groups: [], diskComponents: [] },
    _resolved: [{ src: '/a', expectation: {} }],
  };

  const projected = projectBatchStatus(rawBatch);

  try {
    assert.equal('_context' in projected, false);
    assert.equal('_resolved' in projected, false);
    ok('TEST 1: _context and _resolved are absent from the projected status');
  } catch (err) { fail('TEST 1: internal fields still present', err.message); }

  try {
    assert.equal(projected.total, 10);
    assert.equal(projected.done, 6);
    assert.equal(projected.skipped, 1);
    assert.equal(projected.excluded, 3);
    assert.deepStrictEqual(projected.files, rawBatch.files);
    ok('TEST 2: every field a status consumer actually needs is preserved unchanged — no metadata behavior change');
  } catch (err) { fail('TEST 2: a public status field was altered or dropped', err.message); }

  try {
    assert.equal(rawBatch._context.eventJsonPath, '/archive/event.json');
    assert.equal('_context' in rawBatch, true);
    ok('TEST 3: the original batch object itself is unmodified (projection is non-destructive — exifService\'s own internal state, and metadata:retry\'s direct access to it, are unaffected)');
  } catch (err) { fail('TEST 3: original batch object was mutated', err.message); }

  try {
    assert.equal(projectBatchStatus(null), null);
    assert.equal(projectBatchStatus(undefined), undefined);
    ok('TEST 4: a missing batch (unknown batchId) still returns null/undefined unchanged, not an error');
  } catch (err) { fail('TEST 4: null/undefined batch handling changed', err.message); }
})();

console.log(`\n${passed} test(s) passed.`);
