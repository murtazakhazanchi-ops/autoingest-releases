'use strict';

// Regression test for the Canonical Representation Audit's L6 finding
// (2026-08-11): seqPrefix() was duplicated — services/photographerSequenceService.js
// (main process) and renderer/eventCreator.js each maintained their own copy,
// kept in sync only by a code comment. Fixed by extracting the one
// implementation into renderer/photographerSequenceUtils.js, dual-exported
// (CJS + window.PhotographerSequenceUtils) the same way renderer/pathUtils.js
// already solved this exact main/renderer sharing problem — main.js's own L1
// fix reuses that identical pattern for isPathUnderRoot().
//
// Run: node test/l6SeqPrefixDeduplication.test.js

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

// ── TEST 1: the shared module produces the correct output for the documented cases ──
(function test1() {
  const { seqPrefix } = require('../renderer/photographerSequenceUtils.js');
  const cases = [[1, 'PC01'], [9, 'PC09'], [10, 'PC10'], [99, 'PC99'], [100, 'PC100'], [999, 'PC999']];
  let allOk = true;
  for (const [input, expected] of cases) {
    if (seqPrefix(input) !== expected) {
      allOk = false;
      fail(`TEST 1: seqPrefix(${input}) should be "${expected}", got "${seqPrefix(input)}"`);
    }
  }
  if (allOk) ok('TEST 1: renderer/photographerSequenceUtils.js.seqPrefix() produces correct output for every documented case (1, 9, 10, 99, 100, 999)');
})();

// ── TEST 2: services/photographerSequenceService.js re-exports the SAME function ──
(function test2() {
  const shared = require('../renderer/photographerSequenceUtils.js');
  const service = require('../services/photographerSequenceService.js');
  try {
    assert.equal(service.seqPrefix, shared.seqPrefix, 'services/photographerSequenceService.js must re-export the shared function by reference, not a copy');
    ok('TEST 2: services/photographerSequenceService.js.seqPrefix IS renderer/photographerSequenceUtils.js.seqPrefix — same function reference, not a duplicate implementation');
  } catch (err) {
    fail('TEST 2: photographerSequenceService no longer re-exports the shared seqPrefix by reference', err.message);
  }
})();

// ── TEST 3: no second seqPrefix implementation remains in either file ───────
(function test3() {
  const rendererSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'eventCreator.js'), 'utf8');
  const serviceSrc = fs.readFileSync(path.join(__dirname, '..', 'services', 'photographerSequenceService.js'), 'utf8');
  const hasOwnImplRenderer = /function\s+_?seqPrefix\s*\(/.test(rendererSrc);
  const hasOwnImplService = serviceSrc.includes('function seqPrefix(');
  check('TEST 3a: renderer/eventCreator.js no longer defines its own seqPrefix function', !hasOwnImplRenderer);
  check('TEST 3b: services/photographerSequenceService.js no longer defines its own seqPrefix function', !hasOwnImplService);
  check('TEST 3c: renderer/eventCreator.js references the shared window.PhotographerSequenceUtils.seqPrefix', rendererSrc.includes('window.PhotographerSequenceUtils.seqPrefix'));
  check('TEST 3d: services/photographerSequenceService.js requires the shared module', serviceSrc.includes("require('../renderer/photographerSequenceUtils.js')"));

  function check(name, cond) { if (cond) ok(name); else fail(name); }
})();

// ── TEST 4: dead code removed — the unused EVENT_ROOT_KEY duplicate is gone ──
(function test4() {
  const rendererSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'eventCreator.js'), 'utf8');
  const hasDeclaration = rendererSrc.split('\n').some(line => {
    const trimmed = line.trim();
    return trimmed.includes('_SEQ_EVENT_ROOT_KEY') && !trimmed.startsWith('//');
  });
  if (!hasDeclaration) {
    ok('TEST 4: the unused _SEQ_EVENT_ROOT_KEY duplicate constant was removed (it was never referenced elsewhere in the file) — only an explanatory comment mentions the name now');
  } else {
    fail('TEST 4: _SEQ_EVENT_ROOT_KEY declaration still present — expected it removed as dead code alongside the seqPrefix fix');
  }
})();

// ── TEST 5: index.html loads the shared file before eventCreator.js ─────────
(function test5() {
  const htmlSrc = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'index.html'), 'utf8');
  const utilsIdx = htmlSrc.indexOf('photographerSequenceUtils.js');
  const creatorIdx = htmlSrc.indexOf('src="eventCreator.js"');
  try {
    assert.ok(utilsIdx !== -1, 'photographerSequenceUtils.js <script> tag not found in index.html');
    assert.ok(creatorIdx !== -1, 'eventCreator.js <script> tag not found in index.html');
    assert.ok(utilsIdx < creatorIdx, 'photographerSequenceUtils.js must load before eventCreator.js, since eventCreator.js reads window.PhotographerSequenceUtils at module-init time');
    ok('TEST 5: index.html loads photographerSequenceUtils.js before eventCreator.js (correct script order for a classic-script renderer)');
  } catch (err) {
    fail('TEST 5: script load order incorrect', err.message);
  }
})();

console.log(`\n${passed} test(s) passed.`);
