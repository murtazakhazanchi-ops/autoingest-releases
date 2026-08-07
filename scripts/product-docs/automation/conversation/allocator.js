'use strict';

// Thin Part 8 wrapper over Part 5's existing race-resistant ID allocator
// (automation/recordAllocator.js's FAMILY_CONFIG.conversation) — no new
// locking or concurrency mechanism, per
// docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 7. Reproduces
// canonicalUpdater.js's / automation/memory/allocator.js's exact "render
// with a {{RECORD_ID}} placeholder, allocate+write once under the lock,
// substitute in a second atomic pass" idempotency-safe pattern.

const fs = require('fs');
const path = require('path');
const { allocateAndWriteRecord } = require('../recordAllocator');
const { atomicWriteFileSync } = require('../atomicWrite');
const { REPO_ROOT } = require('../paths');

const ID_PLACEHOLDER = '{{RECORD_ID}}';

// renderFn(placeholderOrId) => full Markdown content string.
function allocateTemplatedConversation(slug, renderFn) {
  const draft = renderFn(ID_PLACEHOLDER);
  const { id, relPath } = allocateAndWriteRecord('conversation', slug, draft);
  const finalPath = path.join(REPO_ROOT, relPath);
  const withId = fs.readFileSync(finalPath, 'utf8').split(ID_PLACEHOLDER).join(id);
  atomicWriteFileSync(finalPath, withId);
  return { id, relPath, filePath: finalPath };
}

module.exports = { allocateTemplatedConversation, ID_PLACEHOLDER };
