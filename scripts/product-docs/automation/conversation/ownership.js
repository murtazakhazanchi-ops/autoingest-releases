'use strict';

// Conversation -> feature/roadmap/bug/decision/memory ownership resolution.
// Two evidence tiers only, never a third invented confidence level:
//   - explicit: the packet's own related_*_ids arrays, validated against
//     the real parsed record maps (an ID the packet cites that doesn't
//     exist is dropped here, not silently kept — validators.js's
//     conversation-broken-reference rule catches it if it slips through).
//   - inferred: a deterministic keyword/alias match (lib/query.js's
//     scoreRecord) against the packet's own title/user_goal text — the same
//     non-embeddings, non-guessing mechanism every other Part 4-7 module
//     uses. Never privileges source_tool (docs/product/18_ENGINEERING_CONVERSATION_POLICY.md
//     § 6/§ 13 — source_tool is metadata, never an ownership signal).

const { runQuery } = require('../../lib/query');

// Two distinct keyword-overlap matches, not one (lib/query.js's scoreRecord
// scores 100 per distinct matched keyword token) — a single shared common
// word (e.g. "engineering," "integration") between a conversation about
// documentation-system infrastructure and an unrelated AutoIngest feature
// title is exactly the kind of single-token false positive this threshold
// exists to filter out (found while importing this system's own Part 8
// pilot conversation, which shares no real ownership with any AI-FEAT).
const INFERRED_SCORE_THRESHOLD = 200;

function validExistingIds(ids, map) {
  return Array.from(new Set(ids || [])).filter((id) => map.has(String(id).toUpperCase())).map((id) => String(id).toUpperCase());
}

function inferredMatches(text, searchIndex, entityType) {
  if (!text) return [];
  return runQuery(text, searchIndex, { entityType, limit: 5 })
    .filter((r) => r.score >= INFERRED_SCORE_THRESHOLD)
    .map((r) => ({ id: r.record.stable_id, title: r.record.title, score: r.score }));
}

function resolveConversationOwnership(packet, { parsed, built }) {
  const queryText = [packet.conversation_title, packet.user_goal].filter(Boolean).join(' ');

  const explicitFeatures = validExistingIds(packet.related_feature_ids, parsed.features);
  const explicitRoadmap = validExistingIds(packet.related_roadmap_ids, parsed.roadmap);
  const explicitBugs = validExistingIds(packet.related_bug_ids, parsed.bugs);
  const explicitDecisions = validExistingIds(packet.related_decision_ids, parsed.decisions);
  const explicitMemory = parsed.memory ? validExistingIds(packet.related_memory_ids, parsed.memory) : [];

  const inferredFeatures = inferredMatches(queryText, built.searchIndex, 'feature').filter((m) => !explicitFeatures.includes(m.id));
  const inferredRoadmap = inferredMatches(queryText, built.searchIndex, 'roadmap').filter((m) => !explicitRoadmap.includes(m.id));

  return {
    primary_feature_ids: explicitFeatures.length ? explicitFeatures : inferredFeatures.map((m) => m.id),
    secondary_feature_ids: explicitFeatures.length ? inferredFeatures.map((m) => m.id) : [],
    roadmap_ids: explicitRoadmap.length ? explicitRoadmap : inferredRoadmap.map((m) => m.id),
    bug_ids: explicitBugs,
    decision_ids: explicitDecisions,
    memory_ids: explicitMemory,
    confidence: explicitFeatures.length ? 'explicit' : (inferredFeatures.length ? 'inferred' : 'unknown'),
    evidence: {
      explicit_feature_ids_from_packet: explicitFeatures,
      inferred_feature_matches: inferredFeatures,
      inferred_roadmap_matches: inferredRoadmap,
    },
  };
}

module.exports = { resolveConversationOwnership, validExistingIds, inferredMatches, INFERRED_SCORE_THRESHOLD };
