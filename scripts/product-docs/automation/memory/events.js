'use strict';

// Part 6 raw event capture. A memory session is a sequence of typed events —
// see docs/product/16_ENGINEERING_MEMORY_POLICY.md § 6 for the evidence
// discipline these events exist to satisfy, and
// scripts/product-docs/automation/memory/README.md § Event Schema for the
// full reference. Events are journaled append-only (never rewritten) under
// the gitignored .autoingest-docs/memory/raw/ tree — never canonical, never
// committed; compiler.js reads this journal to produce a canonical capsule.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { RAW_DIR } = require('./paths');
const { appendJsonLineSync, atomicWriteFileSync, assertInsideRepo } = require('../atomicWrite');
const { redactDeep } = require('../redact');

const EVENT_TYPES = [
  'task_started',
  'user_request_recorded',
  'plan_created',
  'plan_revised',
  'user_feedback_received',
  'investigation_started',
  'hypothesis_added',
  'evidence_found',
  'bug_confirmed',
  'option_considered',
  'option_rejected',
  'decision_accepted',
  'implementation_started',
  'implementation_changed',
  'test_run',
  'screenshot_captured',
  'review_finding',
  'correction_applied',
  'task_completed',
  'task_reopened',
  'follow_up_created',
];

const SOURCE_TYPES = [
  'native-lifecycle', // Part 5 orchestrator / this CLI, driven directly by a Claude Code session
  'evidence-packet', // derived from a linked Part 5 Evidence Packet field
  'agent-session-summary', // another AI agent's structured submission
  'imported-transcript', // node scripts/product-docs/cli.js memory import
  'explicit-user-statement', // the user directly, via CLI or an agent relaying a direct quote
  'repository-evidence', // git/tests/screenshots collected mechanically
];

const CONFIDENCE_LEVELS = ['explicit', 'strong', 'inferred', 'unknown'];

function nowIso() {
  return new Date().toISOString();
}

function newEventId() {
  return `mev-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function newSessionId() {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return `msess-${ts}-${crypto.randomBytes(3).toString('hex')}`;
}

function sessionJournalPath(sessionId) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9_-]/g, '');
  if (!safe || safe !== sessionId) throw new Error(`Invalid session id: ${sessionId}`);
  return path.join(RAW_DIR, `${safe}.events.jsonl`);
}

function sessionMetaPath(sessionId) {
  const safe = String(sessionId).replace(/[^A-Za-z0-9_-]/g, '');
  if (!safe || safe !== sessionId) throw new Error(`Invalid session id: ${sessionId}`);
  return path.join(RAW_DIR, `${safe}.meta.json`);
}

// Every event carries the fields the Part 6 brief's "Design a common input
// event schema" section requires — event_id/session_id/timestamp/source_tool/
// source_type/task_id/related_ids/summary/evidence_refs/confidence/
// redaction_status — regardless of which typed `memory <sub>` command
// produced it. `redactDeep` runs before the event ever touches disk, exactly
// like Part 5's evidencePacket.persist()/auditLog.recordRun().
function buildEvent({
  sessionId, type, taskId, sourceTool, sourceType, relatedIds, summary,
  evidenceRefs, confidence, detail,
}) {
  if (!EVENT_TYPES.includes(type)) {
    throw new Error(`Invalid memory event type "${type}" — must be one of: ${EVENT_TYPES.join(', ')}`);
  }
  if (sourceType && !SOURCE_TYPES.includes(sourceType)) {
    throw new Error(`Invalid source_type "${sourceType}" — must be one of: ${SOURCE_TYPES.join(', ')}`);
  }
  if (confidence && !CONFIDENCE_LEVELS.includes(confidence)) {
    throw new Error(`Invalid confidence "${confidence}" — must be one of: ${CONFIDENCE_LEVELS.join(', ')}`);
  }
  const event = {
    event_id: newEventId(),
    session_id: sessionId,
    timestamp: nowIso(),
    source_tool: sourceTool || 'claude-code',
    source_type: sourceType || 'native-lifecycle',
    task_id: taskId || sessionId,
    type,
    related_ids: Array.isArray(relatedIds) ? relatedIds : [],
    summary: summary || 'Evidence pending — source conversation unavailable',
    evidence_refs: Array.isArray(evidenceRefs) ? evidenceRefs : [],
    confidence: confidence || 'unknown',
    redaction_status: 'pending',
    detail: detail || {},
  };
  return event;
}

// Appends one event to the session's raw journal (fsync'd JSONL append —
// same primitive Part 5 uses for its own journal-then-snapshot durability).
// Redaction happens here, unconditionally, before the write — an event can
// never reach disk unredacted regardless of which caller constructed it.
function appendEvent(rawEvent) {
  const redacted = redactDeep(rawEvent);
  redacted.redaction_status = 'applied';
  fs.mkdirSync(RAW_DIR, { recursive: true });
  appendJsonLineSync(sessionJournalPath(rawEvent.session_id), redacted);
  touchSessionMeta(rawEvent.session_id);
  return redacted;
}

function touchSessionMeta(sessionId) {
  const p = sessionMetaPath(sessionId);
  let meta = { session_id: sessionId, created_at: nowIso(), status: 'open' };
  if (fs.existsSync(p)) {
    try {
      meta = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      // corrupt meta — recreate rather than throw; the journal itself is the
      // durable source of truth, meta is a cheap derived cache
    }
  }
  meta.updated_at = nowIso();
  atomicWriteFileSync(p, JSON.stringify(meta, null, 2) + '\n');
  return meta;
}

function loadSessionMeta(sessionId) {
  const p = sessionMetaPath(sessionId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function setSessionStatus(sessionId, status) {
  const meta = touchSessionMeta(sessionId);
  meta.status = status;
  meta.updated_at = nowIso();
  atomicWriteFileSync(sessionMetaPath(sessionId), JSON.stringify(meta, null, 2) + '\n');
  return meta;
}

// Reads every event for a session in append order — the journal is the
// single source of truth; there is no separate mutable snapshot to drift
// from it (unlike Part 5's packet, which layers a snapshot ON TOP of its
// journal for fast reads — memory sessions are read rarely enough, and
// journals stay small enough, that a snapshot layer isn't warranted yet).
function loadEvents(sessionId) {
  const p = sessionJournalPath(sessionId);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function listOpenSessions() {
  if (!fs.existsSync(RAW_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(RAW_DIR)) {
    if (!f.endsWith('.meta.json')) continue;
    const meta = JSON.parse(fs.readFileSync(path.join(RAW_DIR, f), 'utf8'));
    if (meta.status === 'open') out.push(meta);
  }
  return out;
}

module.exports = {
  EVENT_TYPES,
  SOURCE_TYPES,
  CONFIDENCE_LEVELS,
  newSessionId,
  newEventId,
  buildEvent,
  appendEvent,
  loadEvents,
  loadSessionMeta,
  touchSessionMeta,
  setSessionStatus,
  listOpenSessions,
  sessionJournalPath,
  assertInsideRepo,
};
