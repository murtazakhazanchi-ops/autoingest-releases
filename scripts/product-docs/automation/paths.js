'use strict';

const path = require('path');
const { REPO_ROOT } = require('../lib/repoRoot');

// .autoingest-docs/ is Part 5's repository-local automation state: evidence
// packets in progress, ID-allocation locks, and the audit log. It is never
// canonical (docs/product/ remains the only source of truth) and is
// gitignored — see .gitignore's "Part 5 documentation-automation local run
// state" entry.
const STATE_ROOT = path.join(REPO_ROOT, '.autoingest-docs');
const SESSIONS_ROOT = path.join(STATE_ROOT, 'sessions');
const PENDING_DIR = path.join(SESSIONS_ROOT, 'pending');
const COMPLETED_DIR = path.join(SESSIONS_ROOT, 'completed');
const FAILED_DIR = path.join(SESSIONS_ROOT, 'failed');
const LOCKS_DIR = path.join(STATE_ROOT, 'locks');
const AUDIT_DIR = path.join(STATE_ROOT, 'audit');
// Part 7B — evidence-incomplete architectural decision candidates. Local
// automation state, same tier as SESSIONS_ROOT: never canonical, never
// committed (see .gitignore's ".autoingest-docs/" entry), holds the
// review-required candidates the brief distinguishes from a published
// decisions/DEC-### draft.
const DECISION_CANDIDATES_DIR = path.join(STATE_ROOT, 'decision-candidates');

const CLI_PATH = path.join(REPO_ROOT, 'scripts', 'product-docs', 'cli.js');

module.exports = {
  REPO_ROOT,
  STATE_ROOT,
  SESSIONS_ROOT,
  PENDING_DIR,
  COMPLETED_DIR,
  FAILED_DIR,
  LOCKS_DIR,
  AUDIT_DIR,
  DECISION_CANDIDATES_DIR,
  CLI_PATH,
};
