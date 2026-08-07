'use strict';

// Duplicate and continuation detection — docs/product/18_ENGINEERING_CONVERSATION_POLICY.md
// § 9. Two independent checks, never conflated:
//   - findExactDuplicate: fingerprint or source_conversation_id already
//     imported — rejected outright.
//   - findPossibleContinuation: reuses the exact fuzzy-match-then-threshold
//     pattern automation/decisionIntelligence.js's findPossibleContinuation
//     already uses for decisions (runQuery over the shared search index,
//     score >= a fixed threshold) — never a new similarity heuristic, and
//     never an automatic merge; a match below the threshold becomes a
//     review-required cross-link, nothing more.

const { runQuery } = require('../../lib/query');

const CONTINUATION_SCORE_THRESHOLD = 500; // same threshold decisionIntelligence.js uses for its own continuation search

// Extracts the exact value of Provenance's "Source conversation metadata"
// bullet — never a substring scan of the whole Provenance section, which
// also contains shared boilerplate text ("adapter", format names, etc.)
// that a short/common source_conversation_id could otherwise collide with
// (found in Part 8 security review: a packet claiming
// source_conversation_id "adapter" matched an unrelated record purely
// because its Provenance section happened to contain the word "adapter" in
// a different field's boilerplate).
function extractSourceConversationId(body) {
  const provenance = require('../../lib/markdown').extractSection(body, 'Provenance') || '';
  const m = /^-\s+\*\*Source conversation metadata\*\*:\s*(.+)$/m.exec(provenance);
  return m ? m[1].trim() : null;
}

function findExactDuplicate(packet, fingerprint, parsedConversations) {
  for (const [id, rec] of parsedConversations) {
    const identity = require('../../lib/markdown').extractSectionTable(rec.body, 'Identity') || rec.header;
    if (identity['Integrity checksum'] && identity['Integrity checksum'].trim() === fingerprint) {
      return { conversation_id: id, matched_on: 'fingerprint' };
    }
    if (packet.source_conversation_id) {
      const existingSourceId = extractSourceConversationId(rec.body);
      if (existingSourceId && existingSourceId === String(packet.source_conversation_id)) {
        return { conversation_id: id, matched_on: 'source_conversation_id' };
      }
    }
  }
  return null;
}

function findPossibleContinuation(packet, built) {
  if (!packet.conversation_title) return null;
  const results = runQuery(packet.conversation_title, built.searchIndex, { entityType: 'engineering_conversation', limit: 3 });
  const strong = results.find((r) => r.score >= CONTINUATION_SCORE_THRESHOLD);
  return strong ? { conversation_id: strong.record.stable_id, title: strong.record.title, score: strong.score } : null;
}

module.exports = { findExactDuplicate, findPossibleContinuation, CONTINUATION_SCORE_THRESHOLD };
