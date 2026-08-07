'use strict';

// Part 8 redaction surface — reuses Part 5's existing secret-pattern
// detector (automation/redact.js) exactly like Part 6's own
// automation/memory/redactor.js does, per
// docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 12/§ 13. No new
// redaction engine. Adds data minimization on top: canonicalization only
// ever copies the ECP's own recognized fields into the record — an unknown
// vendor-specific field (which might carry personal data the ECP shape
// never anticipated) never reaches the canonical Markdown, even though it
// is preserved, redacted, in the raw local snapshot for review.

const { redactText, redactDeep } = require('../redact');
const { ARRAY_FIELDS } = require('./ecp');

function scanForSecrets(text) {
  if (typeof text !== 'string' || !text) return [];
  const redacted = redactText(text);
  if (redacted === text) return [];
  return [{ matched: true }];
}

// Scans every string-shaped field of a normalized ECP for a secret pattern —
// used before canonicalization to decide the record's Redaction status
// field, and by `conversation verify` to re-scan committed records.
function scanPacketForSecrets(packet) {
  const hits = [];
  const scanValue = (label, value) => {
    if (typeof value === 'string') {
      if (scanForSecrets(value).length) hits.push(label);
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => scanValue(`${label}[${i}]`, v));
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) scanValue(`${label}.${k}`, v);
    }
  };
  for (const [key, value] of Object.entries(packet)) scanValue(key, value);
  return hits;
}

function redactPacket(packet) {
  return redactDeep(packet);
}

// Keeps only the fields this system's ECP shape recognizes — see
// ecp.js#ARRAY_FIELDS plus the documented scalar/object fields. A raw import
// snapshot may retain unrecognized vendor fields (redacted) for local
// review; the canonical record never does.
const RECOGNIZED_SCALAR_FIELDS = [
  'ecp_version', 'project', 'source_tool', 'source_type', 'conversation_title',
  'conversation_started_at', 'conversation_completed_at', 'source_conversation_id',
  'user_goal', 'redaction_status',
];
const RECOGNIZED_OBJECT_FIELDS = ['repository_context', 'initial_proposal', 'integrity'];

function minimizeToRecognizedFields(packet) {
  const out = {};
  for (const f of RECOGNIZED_SCALAR_FIELDS) if (packet[f] !== undefined) out[f] = packet[f];
  for (const f of RECOGNIZED_OBJECT_FIELDS) if (packet[f] !== undefined) out[f] = packet[f];
  for (const f of ARRAY_FIELDS) if (packet[f] !== undefined) out[f] = packet[f];
  return out;
}

module.exports = { scanForSecrets, scanPacketForSecrets, redactPacket, minimizeToRecognizedFields };
