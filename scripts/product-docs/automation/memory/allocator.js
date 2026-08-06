'use strict';

// Thin Part 6 wrapper over Part 5's existing race-resistant ID allocator
// (automation/recordAllocator.js's FAMILY_CONFIG.memory) — no new locking or
// concurrency mechanism, per docs/product/16_ENGINEERING_MEMORY_POLICY.md
// § 13. Reproduces canonicalUpdater.js's exact "render with a {{RECORD_ID}}
// placeholder, allocate+write once under the lock, substitute in a second
// atomic pass" idempotency-safe pattern for a family (memory) that cites its
// own ID inside its own content.

const fs = require('fs');
const path = require('path');
const { allocateAndWriteRecord } = require('../recordAllocator');
const { atomicWriteFileSync } = require('../atomicWrite');
const { REPO_ROOT } = require('../paths');

const ID_PLACEHOLDER = '{{RECORD_ID}}';

// renderFn(placeholderOrId) => full Markdown content string.
function allocateTemplatedCapsule(slug, renderFn) {
  const draft = renderFn(ID_PLACEHOLDER);
  const { id, relPath } = allocateAndWriteRecord('memory', slug, draft);
  const finalPath = path.join(REPO_ROOT, relPath);
  const withId = fs.readFileSync(finalPath, 'utf8').split(ID_PLACEHOLDER).join(id);
  atomicWriteFileSync(finalPath, withId);
  return { id, relPath, filePath: finalPath };
}

module.exports = { allocateTemplatedCapsule, ID_PLACEHOLDER };
