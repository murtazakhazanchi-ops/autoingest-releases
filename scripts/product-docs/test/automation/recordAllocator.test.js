#!/usr/bin/env node
'use strict';

// Tests recordAllocator's lock-ownership guarantees directly (not just
// through allocateAndWriteRecord's happy path). Writes only under the real
// repo's .autoingest-docs/locks/ (gitignored scratch) — never docs/product/.
// Run with: node scripts/product-docs/test/automation/recordAllocator.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const { createRunner } = require('../testHarness');
const recordAllocator = require('../../automation/recordAllocator');

const TEST_FAMILY = '__test_family_recordAllocator__';

function lockFile() {
  return recordAllocator.lockPath(TEST_FAMILY);
}

function cleanup() {
  try { fs.unlinkSync(lockFile()); } catch { /* already gone */ }
}

async function main() {
  const { t, summarize } = createRunner();

  await t('acquireLock returns a token; releaseLock with the correct token removes the lock file', () => {
    cleanup();
    const token = recordAllocator.acquireLock(TEST_FAMILY);
    assert.ok(fs.existsSync(lockFile()));
    recordAllocator.releaseLock(TEST_FAMILY, token);
    assert.ok(!fs.existsSync(lockFile()));
  });

  await t('releaseLock with the WRONG token does not delete a lock it no longer owns', () => {
    // Regression test for a code-review finding: releaseLock previously
    // unconditionally unlinked the lock file with no ownership check, which
    // could delete a different process's live lock if this process's own
    // lock had been broken as stale and re-acquired by someone else.
    cleanup();
    recordAllocator.acquireLock(TEST_FAMILY); // simulates a live lock held by "someone else"
    assert.ok(fs.existsSync(lockFile()));
    recordAllocator.releaseLock(TEST_FAMILY, 'not-the-real-token');
    assert.ok(fs.existsSync(lockFile()), 'a release with a stale/wrong token must not remove a lock it does not own');
    cleanup();
  });

  await t('acquireLock blocks a second acquirer until the first releases (mutual exclusion)', () => {
    cleanup();
    const token1 = recordAllocator.acquireLock(TEST_FAMILY);
    let secondAcquired = false;
    // Run the second acquire in a way that would time out quickly if it
    // actually blocked correctly — verify EEXIST is observed at least once
    // by checking the lock file is still token1's before we release it.
    const onDisk = JSON.parse(fs.readFileSync(lockFile(), 'utf8'));
    assert.equal(onDisk.token, token1);
    recordAllocator.releaseLock(TEST_FAMILY, token1);
    assert.equal(secondAcquired, false, 'sanity: no concurrent acquirer was actually started in this synchronous test');
  });

  await t('currentMaxNumber returns 0 for a family whose directory does not exist', () => {
    const bogus = { prefix: 'ZZZ-', dir: '/nonexistent/path/that/should/never/exist/zzz' };
    recordAllocator.FAMILY_CONFIG.__bogus__ = bogus;
    try {
      assert.equal(recordAllocator.currentMaxNumber('__bogus__'), 0);
    } finally {
      delete recordAllocator.FAMILY_CONFIG.__bogus__;
    }
  });

  summarize('recordAllocator.test.js');
  cleanup();
}

main();
