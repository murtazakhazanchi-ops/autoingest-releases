'use strict';

// Engineering Evidence Packet — the bridge between an AI session's
// implementation activity and docs/product/'s documentation automation.
// See scripts/product-docs/schemas/evidence-packet.schema.json for the
// field-by-field reference and scripts/product-docs/automation/README.md
// for the lifecycle this file implements.
//
// Two safety properties this module exists to guarantee:
//   1. A crash never silently loses engineering history — every mutation is
//      journaled (append-only) BEFORE the packet snapshot is rewritten, and
//      the snapshot itself is written atomically (automation/atomicWrite.js).
//   2. Nothing is ever invented — createPacket()/appendEvidence() only ever
//      set what the caller explicitly provides; unset fields stay in their
//      "evidence pending" default rather than a guessed value.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PENDING_DIR, COMPLETED_DIR, FAILED_DIR, SESSIONS_ROOT } = require('./paths');
const { atomicWriteFileSync, appendJsonLineSync } = require('./atomicWrite');
const { redactDeep } = require('./redact');
const gitInfo = require('../lib/gitInfo');

const PACKET_VERSION = '1.0.0';

const TASK_TYPES = [
  'feature', 'enhancement', 'bugfix', 'refactor', 'performance', 'reliability',
  'ui-ux', 'architecture', 'documentation', 'test', 'release', 'investigation', 'maintenance',
];

const EVIDENCE_SOURCES = [
  'git', 'code-diff', 'test-output', 'canonical-docs', 'ai-session-summary',
  'explicit-user-statement', 'commit-message', 'release-metadata', 'evidence-pending',
];

const CONFIDENCE_LEVELS = ['explicit', 'strong', 'inferred', 'unknown'];

const AUTOMATION_STATUSES = ['pending', 'in-progress', 'finalizing', 'completed', 'failed', 'stale'];

const AUTOMATION_MODES = ['strict', 'standard', 'observe'];

function newSessionId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `sess-${ts}-${crypto.randomBytes(3).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function emptyArrayField() {
  return [];
}

// Builds a new packet. Every deterministic field (branch/base_commit) is
// read from git now; everything else defaults to an empty/pending value —
// nothing is guessed on the caller's behalf.
function createPacket({ taskType, taskTitle, taskSummary, userRequestSummary, sessionId, mode } = {}) {
  if (!TASK_TYPES.includes(taskType)) {
    throw new Error(`Invalid task_type "${taskType}" — must be one of: ${TASK_TYPES.join(', ')}`);
  }
  if (!taskTitle || typeof taskTitle !== 'string') {
    throw new Error('task_title is required');
  }
  const id = sessionId || newSessionId();
  const branch = safeBranch();
  const baseCommit = safeCommit();
  const packet = {
    packet_version: PACKET_VERSION,
    session_id: id,
    task_id: id,
    created_at: nowIso(),
    updated_at: nowIso(),
    repository_root: undefined, // filled by caller only if needed; never a source of truth for git identity
    branch,
    base_commit: baseCommit,
    head_commit: baseCommit,
    task_type: taskType,
    task_title: taskTitle,
    task_summary: taskSummary || 'Evidence pending — not yet documented as fact.',
    user_request_summary: userRequestSummary || 'Evidence pending — not yet documented as fact.',
    affected_files: emptyArrayField(),
    changed_symbols: emptyArrayField(),
    affected_feature_ids: emptyArrayField(),
    affected_roadmap_ids: emptyArrayField(),
    affected_subsystems: emptyArrayField(),
    bugs_discovered: emptyArrayField(),
    decisions_made: emptyArrayField(),
    alternatives_considered: emptyArrayField(),
    accepted_solution: null,
    rejected_solutions: emptyArrayField(),
    root_cause: null,
    implementation_summary: null,
    tests_run: emptyArrayField(),
    test_results: emptyArrayField(),
    manual_verification: emptyArrayField(),
    performance_results: emptyArrayField(),
    risks: emptyArrayField(),
    unresolved_gaps: emptyArrayField(),
    commits: emptyArrayField(),
    release_impact: null,
    confidence: 'unknown',
    evidence_sources: emptyArrayField(),
    evidence_pending_fields: ['task_summary', 'user_request_summary'],
    automation_status: 'pending',
    automation_mode: AUTOMATION_MODES.includes(mode) ? mode : 'standard',
    classification: null, // filled by changeClassifier at finalize time
    finalize_report: null, // filled by orchestrator at finalize time
  };
  delete packet.repository_root;
  return packet;
}

function safeBranch() {
  try {
    const { execFileSync } = require('child_process');
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: require('./paths').REPO_ROOT,
      encoding: 'utf8',
    }).trim();
  } catch {
    return 'unknown';
  }
}

function safeCommit() {
  return gitInfo.currentCommit();
}

function packetPath(sessionId, dir) {
  return path.join(dir, `${sessionId}.json`);
}

function journalPath(sessionId) {
  return path.join(SESSIONS_ROOT, `${sessionId}.journal.jsonl`);
}

// Validation is a small hand-rolled structural check, matching Part 4's own
// "focused standard-library validator, not a package" convention
// (scripts/product-docs/lib/schemaValidator.js). Returns {valid, errors[]}.
function validatePacket(packet) {
  const errors = [];
  const req = (field, type) => {
    if (packet[field] === undefined) errors.push(`missing field: ${field}`);
    else if (type === 'array' && !Array.isArray(packet[field])) errors.push(`${field} must be an array`);
    else if (type === 'string' && typeof packet[field] !== 'string') errors.push(`${field} must be a string`);
  };
  req('packet_version', 'string');
  req('session_id', 'string');
  req('task_id', 'string');
  req('created_at', 'string');
  req('updated_at', 'string');
  req('branch', 'string');
  req('base_commit', 'string');
  req('head_commit', 'string');
  req('task_type', 'string');
  req('task_title', 'string');
  req('affected_files', 'array');
  req('affected_feature_ids', 'array');
  req('affected_roadmap_ids', 'array');
  req('bugs_discovered', 'array');
  req('decisions_made', 'array');
  req('alternatives_considered', 'array');
  req('rejected_solutions', 'array');
  req('tests_run', 'array');
  req('test_results', 'array');
  req('manual_verification', 'array');
  req('risks', 'array');
  req('unresolved_gaps', 'array');
  req('commits', 'array');
  req('evidence_sources', 'array');
  req('evidence_pending_fields', 'array');
  req('automation_status', 'string');

  if (packet.task_type && !TASK_TYPES.includes(packet.task_type)) {
    errors.push(`invalid task_type: ${packet.task_type}`);
  }
  if (packet.confidence && !CONFIDENCE_LEVELS.includes(packet.confidence)) {
    errors.push(`invalid confidence: ${packet.confidence}`);
  }
  if (packet.automation_status && !AUTOMATION_STATUSES.includes(packet.automation_status)) {
    errors.push(`invalid automation_status: ${packet.automation_status}`);
  }
  for (const src of packet.evidence_sources || []) {
    if (!EVIDENCE_SOURCES.includes(src)) errors.push(`invalid evidence_source: ${src}`);
  }
  return { valid: errors.length === 0, errors };
}

// Journal first (append-only, survives a crash), THEN rewrite the atomic
// snapshot. If the process dies between these two steps, recovery.js can
// replay the journal against the last-good snapshot rather than silently
// losing the entry — see automation/recovery.js.
function persist(packet, { event } = {}) {
  packet.updated_at = nowIso();
  const { valid, errors } = validatePacket(packet);
  if (!valid) {
    throw new Error(`Refusing to persist invalid evidence packet: ${errors.join('; ')}`);
  }
  appendJsonLineSync(journalPath(packet.session_id), redactDeep({
    at: nowIso(),
    event: event || 'update',
    automation_status: packet.automation_status,
  }));
  atomicWriteFileSync(packetPath(packet.session_id, PENDING_DIR), JSON.stringify(redactDeep(packet), null, 2) + '\n');
}

function loadPacket(sessionId) {
  for (const dir of [PENDING_DIR, COMPLETED_DIR, FAILED_DIR]) {
    const p = packetPath(sessionId, dir);
    if (fs.existsSync(p)) {
      return { packet: JSON.parse(fs.readFileSync(p, 'utf8')), dir };
    }
  }
  return null;
}

function listPending() {
  if (!fs.existsSync(PENDING_DIR)) return [];
  return fs.readdirSync(PENDING_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(PENDING_DIR, f), 'utf8')));
}

// Moves a packet's snapshot from pending/ into completed/ or failed/ —
// never both, never silently. The pending copy is removed only after the
// destination write succeeds (atomic write, then unlink).
function moveToTerminal(packet, terminal) {
  const dir = terminal === 'completed' ? COMPLETED_DIR : FAILED_DIR;
  atomicWriteFileSync(packetPath(packet.session_id, dir), JSON.stringify(redactDeep(packet), null, 2) + '\n');
  const pendingFile = packetPath(packet.session_id, PENDING_DIR);
  if (fs.existsSync(pendingFile)) fs.unlinkSync(pendingFile);
}

module.exports = {
  PACKET_VERSION,
  TASK_TYPES,
  EVIDENCE_SOURCES,
  CONFIDENCE_LEVELS,
  AUTOMATION_STATUSES,
  AUTOMATION_MODES,
  createPacket,
  validatePacket,
  persist,
  loadPacket,
  listPending,
  moveToTerminal,
  packetPath,
  journalPath,
  newSessionId,
};
