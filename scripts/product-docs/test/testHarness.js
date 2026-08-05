'use strict';

// Minimal shared test harness matching the style of test/*.test.js at the repo
// root (node:assert, no framework) — extracted here since this directory has
// several test files that would otherwise each duplicate the same run loop.
function createRunner() {
  let passed = 0;
  let failed = 0;
  const failures = [];

  async function t(name, fn) {
    try {
      await fn();
      passed++;
      console.log(`  ok — ${name}`);
    } catch (err) {
      failed++;
      failures.push({ name, err });
      console.error(`  FAIL — ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  function summarize(fileName) {
    console.log(`${fileName}: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  }

  return { t, summarize };
}

module.exports = { createRunner };
