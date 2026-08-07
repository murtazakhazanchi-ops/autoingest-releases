'use strict';

// Part 8 — Engineering Conversation raw/local state layout. Same
// non-canonical, gitignored, repository-local pattern as Part 5's
// .autoingest-docs/sessions/ and Part 6's .autoingest-docs/memory/ — see
// ../paths.js and docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 5.
// Folder names (inbox/processing/imported/rejected/duplicates/failed/audit)
// match the Part 8 brief's explicit external-AI-handoff directory layout —
// deliberately not memory's raw/pending/processed/imports naming, since a
// conversation packet is a complete document, not an in-session event
// stream, and the brief names this exact layout.

const path = require('path');
const { STATE_ROOT, REPO_ROOT } = require('../paths');

const CONVERSATIONS_ROOT = path.join(STATE_ROOT, 'conversations');
const INBOX_DIR = path.join(CONVERSATIONS_ROOT, 'inbox');
const PROCESSING_DIR = path.join(CONVERSATIONS_ROOT, 'processing');
const IMPORTED_DIR = path.join(CONVERSATIONS_ROOT, 'imported');
const REJECTED_DIR = path.join(CONVERSATIONS_ROOT, 'rejected');
const DUPLICATES_DIR = path.join(CONVERSATIONS_ROOT, 'duplicates');
const FAILED_DIR = path.join(CONVERSATIONS_ROOT, 'failed');
const AUDIT_DIR = path.join(CONVERSATIONS_ROOT, 'audit');
// Non-canonical, review-required decision/bug candidates surfaced from
// conversation evidence — same tier as Part 7B's own
// automation/paths.js#DECISION_CANDIDATES_DIR, kept separate here so a
// conversation-sourced candidate never collides with a live-session one.
const DECISION_CANDIDATES_DIR = path.join(CONVERSATIONS_ROOT, 'decision-candidates');

const CONVERSATION_DOCS_ROOT = path.join(REPO_ROOT, 'docs', 'product', 'conversations');
const CONVERSATION_ASSETS_ROOT = path.join(CONVERSATION_DOCS_ROOT, 'assets');

module.exports = {
  REPO_ROOT,
  CONVERSATIONS_ROOT,
  INBOX_DIR,
  PROCESSING_DIR,
  IMPORTED_DIR,
  REJECTED_DIR,
  DUPLICATES_DIR,
  FAILED_DIR,
  AUDIT_DIR,
  DECISION_CANDIDATES_DIR,
  CONVERSATION_DOCS_ROOT,
  CONVERSATION_ASSETS_ROOT,
};
