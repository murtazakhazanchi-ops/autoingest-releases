'use strict';

// Deterministic content fingerprint for exact-duplicate detection
// (docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 9). A sha256 over a
// stable-sorted-keys JSON serialization of the packet's ENGINEERING content
// only — import metadata (timestamps, import session, integrity itself)
// is deliberately excluded so re-importing the byte-identical packet twice
// (the common accidental-duplicate case) always fingerprints identically
// regardless of when the second import happened.

const crypto = require('crypto');
const { stableStringify } = require('../../lib/stableJson');

const FINGERPRINT_FIELDS = [
  'project', 'source_tool', 'conversation_title', 'user_goal',
  'explicit_requirements', 'constraints', 'initial_proposal', 'revisions',
  'feedback', 'accepted_decisions', 'rejected_approaches', 'deferred_items',
  'bugs_discussed', 'implementation_requests', 'open_questions',
];

function fingerprintPacket(normalizedPacket) {
  const subset = {};
  for (const f of FINGERPRINT_FIELDS) subset[f] = normalizedPacket[f] ?? null;
  return crypto.createHash('sha256').update(stableStringify(subset)).digest('hex');
}

module.exports = { fingerprintPacket, FINGERPRINT_FIELDS };
