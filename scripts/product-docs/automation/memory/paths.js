'use strict';

// Part 6 — Engineering Memory raw/local state layout. Same non-canonical,
// gitignored, repository-local pattern as Part 5's .autoingest-docs/sessions/
// — see automation/paths.js and docs/product/16_ENGINEERING_MEMORY_POLICY.md
// § 5 (Canonical vs. Raw). Never mixed with Part 5's own session state
// directories; memory sessions live in their own subtree so a memory-only
// session (no linked Evidence Packet) doesn't collide with paths.js's
// PENDING_DIR/COMPLETED_DIR/FAILED_DIR semantics.

const path = require('path');
const { STATE_ROOT, REPO_ROOT } = require('../paths');

const MEMORY_ROOT = path.join(STATE_ROOT, 'memory');
const RAW_DIR = path.join(MEMORY_ROOT, 'raw');
const PENDING_DIR = path.join(MEMORY_ROOT, 'pending');
const PROCESSED_DIR = path.join(MEMORY_ROOT, 'processed');
const FAILED_DIR = path.join(MEMORY_ROOT, 'failed');
const IMPORTS_DIR = path.join(MEMORY_ROOT, 'imports');
const AUDIT_DIR = path.join(MEMORY_ROOT, 'audit');
const LOCKS_DIR = path.join(MEMORY_ROOT, 'locks');

const MEMORY_DOCS_ROOT = path.join(REPO_ROOT, 'docs', 'product', 'memory');
const MEMORY_ASSETS_ROOT = path.join(MEMORY_DOCS_ROOT, 'assets');

module.exports = {
  REPO_ROOT,
  MEMORY_ROOT,
  RAW_DIR,
  PENDING_DIR,
  PROCESSED_DIR,
  FAILED_DIR,
  IMPORTS_DIR,
  AUDIT_DIR,
  LOCKS_DIR,
  MEMORY_DOCS_ROOT,
  MEMORY_ASSETS_ROOT,
};
