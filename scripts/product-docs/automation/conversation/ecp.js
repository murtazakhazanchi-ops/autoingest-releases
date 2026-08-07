'use strict';

// Engineering Conversation Packet (ECP) 1.0 — schema constants and a small,
// dependency-free structural validator, matching Part 4's
// lib/schemaValidator.js convention (see scripts/product-docs/schemas/README.md's
// "no ajv" rationale) rather than adding a JSON Schema library. Reference
// shape lives at scripts/product-docs/schemas/engineering-conversation-packet.schema.json —
// this file is the runtime enforcement of that same shape.

const ECP_VERSION = '1.0';

const SOURCE_TOOLS = [
  'chatgpt', 'claude-code', 'claude', 'codex', 'gemini', 'human-meeting',
  'engineering-review', 'email', 'markdown-notes', 'json', 'manual-import', 'unknown',
];

const ARRAY_FIELDS = [
  'explicit_requirements', 'constraints', 'revisions', 'feedback', 'accepted_decisions',
  'rejected_approaches', 'deferred_items', 'bugs_discussed', 'implementation_requests',
  'open_questions', 'related_feature_ids', 'related_roadmap_ids', 'related_bug_ids',
  'related_decision_ids', 'related_memory_ids', 'source_evidence', 'evidence_pending',
];

// Minimum required per docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 11 /
// docs/product/conversations/README.md — everything else stays unknown rather
// than fabricated when absent.
function validateEcp(packet) {
  const errors = [];
  if (typeof packet !== 'object' || packet === null || Array.isArray(packet)) {
    return { valid: false, errors: ['root must be a JSON object'] };
  }
  if (packet.ecp_version !== ECP_VERSION) {
    errors.push(`ecp_version must be "${ECP_VERSION}" — got ${JSON.stringify(packet.ecp_version)}. Unsupported version is rejected, never guess-parsed.`);
  }
  if (!packet.project || typeof packet.project !== 'string') errors.push('"project" is required and must be a string');
  if (!packet.source_tool || typeof packet.source_tool !== 'string') {
    errors.push('"source_tool" is required and must be a string');
  } else if (!SOURCE_TOOLS.includes(packet.source_tool)) {
    errors.push(`"source_tool" must be one of: ${SOURCE_TOOLS.join(', ')} — got "${packet.source_tool}"`);
  }
  if (!packet.conversation_title || typeof packet.conversation_title !== 'string') {
    errors.push('"conversation_title" is required and must be a string');
  }
  if (!packet.user_goal && !packet.conversation_title) {
    errors.push('at least one of "user_goal" or "conversation_title" must describe the discussion');
  }
  for (const field of ARRAY_FIELDS) {
    if (packet[field] !== undefined && !Array.isArray(packet[field])) {
      errors.push(`"${field}" must be an array if present`);
    }
  }
  if (packet.repository_context !== undefined && (typeof packet.repository_context !== 'object' || Array.isArray(packet.repository_context))) {
    errors.push('"repository_context" must be an object if present');
  }
  if (packet.initial_proposal !== undefined && (typeof packet.initial_proposal !== 'object' || Array.isArray(packet.initial_proposal))) {
    errors.push('"initial_proposal" must be an object if present');
  }
  return { valid: errors.length === 0, errors };
}

// Fills every optional field with its documented default so downstream code
// never has to guard for `undefined` — this is normalization, not
// fabrication: every filled default is an empty/neutral value, never a
// guessed fact (docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 11).
function normalizeEcp(packet) {
  const normalized = { ...packet };
  normalized.ecp_version = packet.ecp_version || ECP_VERSION;
  normalized.source_type = packet.source_type || 'engineering_conversation';
  normalized.conversation_started_at = packet.conversation_started_at ?? null;
  normalized.conversation_completed_at = packet.conversation_completed_at ?? null;
  normalized.source_conversation_id = packet.source_conversation_id ?? null;
  normalized.repository_context = packet.repository_context || {};
  normalized.repository_context.branch = normalized.repository_context.branch ?? null;
  normalized.repository_context.base_commit = normalized.repository_context.base_commit ?? null;
  normalized.repository_context.head_commit = normalized.repository_context.head_commit ?? null;
  normalized.user_goal = packet.user_goal || '';
  normalized.initial_proposal = packet.initial_proposal || {};
  normalized.redaction_status = packet.redaction_status || 'pending';
  normalized.integrity = packet.integrity || {};
  for (const field of ARRAY_FIELDS) {
    normalized[field] = Array.isArray(packet[field]) ? packet[field] : [];
  }
  return normalized;
}

module.exports = { ECP_VERSION, SOURCE_TOOLS, ARRAY_FIELDS, validateEcp, normalizeEcp };
