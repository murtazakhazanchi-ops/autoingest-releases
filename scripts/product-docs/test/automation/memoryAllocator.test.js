#!/usr/bin/env node
'use strict';

// Tests automation/memory/allocator.js's allocateTemplatedCapsule against a
// SCRATCH directory inside .autoingest-docs/ (gitignored, inside the repo
// root so atomicWrite.js's assertInsideRepo doesn't reject it) — never
// touches the real docs/product/memory/ tree or its real AI-MEM-#### numbering.
// Run with: node scripts/product-docs/test/automation/memoryAllocator.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createRunner } = require('../testHarness');
const recordAllocator = require('../../automation/recordAllocator');
const { allocateTemplatedCapsule, ID_PLACEHOLDER } = require('../../automation/memory/allocator');
const { STATE_ROOT } = require('../../automation/paths');

const SCRATCH_DIR = path.join(STATE_ROOT, 'test-scratch', 'memory-allocator-test');

function cleanup() {
  fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
}

async function main() {
  const { t, summarize } = createRunner();
  cleanup();
  const originalDir = recordAllocator.FAMILY_CONFIG.memory.dir;
  recordAllocator.FAMILY_CONFIG.memory.dir = SCRATCH_DIR;

  try {
    await t('allocateTemplatedCapsule allocates AI-MEM-0001 (4 digits, zero-padded) as the first ID', () => {
      const { id, relPath } = allocateTemplatedCapsule('FIRST_CAPSULE', (placeholder) => `# ${placeholder} — First\n\nbody mentions ${placeholder} again.`);
      assert.equal(id, 'AI-MEM-0001');
      assert.match(relPath, /AI-MEM-0001_FIRST_CAPSULE\.md$/);
    });

    await t('the ID_PLACEHOLDER is fully substituted — no placeholder text survives in the written file', () => {
      const filePath = path.join(SCRATCH_DIR, fs.readdirSync(SCRATCH_DIR).find((f) => f.startsWith('AI-MEM-0001_')));
      const content = fs.readFileSync(filePath, 'utf8');
      assert.ok(!content.includes(ID_PLACEHOLDER));
      assert.ok(content.includes('# AI-MEM-0001 — First'));
      assert.equal((content.match(/AI-MEM-0001/g) || []).length, 2, 'both occurrences of the placeholder must have been substituted');
    });

    await t('a second allocation gets AI-MEM-0002, never reusing or colliding with 0001', () => {
      const { id } = allocateTemplatedCapsule('SECOND_CAPSULE', (placeholder) => `# ${placeholder} — Second`);
      assert.equal(id, 'AI-MEM-0002');
    });

    await t('currentMaxNumber reflects both allocated capsules', () => {
      assert.equal(recordAllocator.currentMaxNumber('memory'), 2);
    });
  } finally {
    recordAllocator.FAMILY_CONFIG.memory.dir = originalDir;
    cleanup();
  }

  summarize('memoryAllocator.test.js');
}

main();
