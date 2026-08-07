'use strict';

// Conversation -> Decision Intelligence linkage.
//
// IMPORTANT BOUNDARY (docs/product/18_ENGINEERING_CONVERSATION_POLICY.md §
// 10, from Part 8 architecture review): this module is deliberately NOT
// automation/decisionIntelligence.js's scanPacket() reused against a live
// Evidence Packet session. It never writes into a live packet's
// decisions_made/alternatives_considered arrays, and it is never called
// from hookAutomation.js (no git hook triggers a conversation-sourced
// decision draft). It is only ever reached from an explicit
// `conversation import`/`conversation finalize` CLI invocation — a
// foreground, human-invoked action — so an untrusted external transcript
// can never indirectly shape a canonical decision purely through an
// automatic git-hook chain.
//
// Three outcomes, mirroring decisionIntelligence.js's own state machine:
//   - 'linked'            existing DEC-### found via fuzzy search — read-only.
//   - 'draft'              no existing match, but the packet's own evidence
//                           clears the same two-alternatives+accepted bar
//                           documentationPlanner.js/decisionIntelligence.js
//                           already use — a canonical Status: Draft record
//                           is created.
//   - 'candidate'          decision-shaped content exists but is below the
//                           evidence bar — saved locally, review-required,
//                           never canonical.
//   - 'not_applicable'     no decision-shaped content in the packet at all.

const fs = require('fs');
const path = require('path');
const { runQuery } = require('../../lib/query');
const { allocateAndWriteRecord } = require('../recordAllocator');
const { atomicWriteFileSync } = require('../atomicWrite');
const { REPO_ROOT, DECISION_CANDIDATES_DIR } = require('./paths');

const CONTINUATION_SCORE_THRESHOLD = 500;
const ID_PLACEHOLDER = '{{RECORD_ID}}';
const EVIDENCE_PENDING = 'Evidence pending — not present in imported packet';

function val(v) {
  return v === null || v === undefined || v === '' ? EVIDENCE_PENDING : String(v);
}

function hasDecisionShapedContent(packet) {
  return (packet.accepted_decisions || []).length > 0 || (packet.rejected_approaches || []).length > 0;
}

// A canonical decision record must always cite at least one feature or
// roadmap milestone (lib/validators.js#checkOrphans's orphan-decision
// rule) — a conversation with decision-shaped content but NO resolved
// feature/roadmap ownership can never justify a canonical Draft on its
// own, regardless of how many alternatives it names; it stays a local
// review-required candidate instead (found in Part 8 E2E testing: a
// packet naming a real accepted/rejected decision but no feature ownership
// produced an orphan DEC-### that failed validate).
//
// `ownership` must be the VALIDATED result of ownership.js's
// resolveConversationOwnership — never the packet's own raw
// related_feature_ids/related_roadmap_ids claims. Those are unvalidated
// input from an untrusted external packet; a packet could claim a
// syntactically well-formed but nonexistent feature ID (e.g. "AI-FEAT-999")
// and, without this check using the validated set, would still clear this
// bar and get a canonical DEC-### drafted citing a dangling reference —
// caught eventually by validate's missing-feature-reference rule, but only
// after a permanent, never-reusable ID was already spent on a broken
// record (found in Part 8 code review).
function hasSufficientEvidence(packet, ownership) {
  const alternativeCount = (packet.rejected_approaches || []).length + (packet.accepted_decisions.length ? 1 : 0);
  const hasOwnership = (ownership.primary_feature_ids || []).length > 0
    || (ownership.secondary_feature_ids || []).length > 0
    || (ownership.roadmap_ids || []).length > 0;
  return alternativeCount >= 2 && (packet.accepted_decisions || []).length >= 1 && hasOwnership;
}

function findExistingDecision(packet, built) {
  const text = packet.conversation_title || (packet.accepted_decisions || [])[0];
  if (!text) return null;
  const results = runQuery(text, built.searchIndex, { entityType: 'decision', limit: 3 });
  const strong = results.find((r) => r.score >= CONTINUATION_SCORE_THRESHOLD);
  return strong ? { decision_id: strong.record.stable_id, title: strong.record.title, score: strong.score } : null;
}

function renderDraftDecision(id, packet, ownership, conversationId) {
  const alts = (packet.rejected_approaches || []).map((a, i) => `${i + 1}. **${val(a.proposal)}** — rejected: ${val(a.reason_rejected)}`).join('\n') || EVIDENCE_PENDING;
  // Cites the VALIDATED ownership (feature/roadmap IDs confirmed to exist),
  // never the packet's own raw, unvalidated claim — see hasSufficientEvidence's
  // comment above for why.
  const relatedIds = [...(ownership.primary_feature_ids || []), ...(ownership.secondary_feature_ids || []), ...(ownership.roadmap_ids || [])];
  return `# ${id} — ${packet.conversation_title}

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | ${relatedIds.join(', ') || EVIDENCE_PENDING} |
| Status | Draft — auto-drafted from an imported Engineering Conversation Packet, pending review |
| Date | ${new Date().toISOString().slice(0, 10)} |
| Evidence status | Auto-drafted by Part 8 conversation decision linkage from ${conversationId}; source packet's own recorded evidence cleared the two-alternatives-plus-accepted-solution bar |

## Context

${val(packet.user_goal)}

## Options Considered

${alts}

## Decision

${listOrNone(packet.accepted_decisions)}

## Consequences

${EVIDENCE_PENDING}

## Reconciliation Note

None recorded.

## Review Note

Auto-drafted from an imported conversation (${conversationId}) — a human or a future agent session should confirm this Status should move to Accepted (or Rejected/Deferred) before this record is relied on as settled. This draft was never triggered by a git hook — see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 10.
`;
}

function listOrNone(arr) {
  return Array.isArray(arr) && arr.length ? arr.join('; ') : EVIDENCE_PENDING;
}

function saveCandidate(packet, ownership, conversationId) {
  fs.mkdirSync(DECISION_CANDIDATES_DIR, { recursive: true });
  const candidate = {
    conversation_id: conversationId,
    title: packet.conversation_title,
    created_at: new Date().toISOString(),
    accepted_decisions: packet.accepted_decisions,
    rejected_approaches: packet.rejected_approaches,
    validated_feature_ids: [...(ownership.primary_feature_ids || []), ...(ownership.secondary_feature_ids || [])],
    validated_roadmap_ids: ownership.roadmap_ids || [],
    state: 'candidate',
  };
  atomicWriteFileSync(path.join(DECISION_CANDIDATES_DIR, `${conversationId}.json`), JSON.stringify(candidate, null, 2) + '\n');
  return candidate;
}

// conversationId: the already-allocated ENG-CONV-#### (decision linkage runs
// AFTER conversation ID allocation, so the draft/candidate can cite it).
// `ownership`: the VALIDATED result of ownership.js's resolveConversationOwnership
// — required so canonical drafting never trusts the packet's own raw,
// unvalidated related_feature_ids/related_roadmap_ids claims (see
// hasSufficientEvidence's comment).
function linkOrDraftDecision(packet, { built }, ownership, conversationId) {
  if (!hasDecisionShapedContent(packet)) return { state: 'not_applicable' };

  const existing = findExistingDecision(packet, built);
  if (existing) return { state: 'linked', decision_id: existing.decision_id, match: existing };

  if (!hasSufficientEvidence(packet, ownership)) {
    const candidate = saveCandidate(packet, ownership, conversationId);
    return { state: 'candidate', candidate };
  }

  const draft = renderDraftDecision(ID_PLACEHOLDER, packet, ownership, conversationId);
  const { id, relPath } = allocateAndWriteRecord('decision', packet.conversation_title, draft);
  const finalPath = path.join(REPO_ROOT, relPath);
  const withId = fs.readFileSync(finalPath, 'utf8').split(ID_PLACEHOLDER).join(id);
  atomicWriteFileSync(finalPath, withId);
  return { state: 'draft', decision_id: id, path: relPath };
}

module.exports = { linkOrDraftDecision, hasDecisionShapedContent, hasSufficientEvidence, findExistingDecision };
