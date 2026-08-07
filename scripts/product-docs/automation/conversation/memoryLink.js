'use strict';

// Conversation -> Engineering Memory linkage
// (docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 4). A many-to-optional
// relationship, never automatic 1:1: an imported conversation may create a
// new AI-MEM-####, continue/link an existing one (read-only), or remain
// conversation-only. Reuses Part 6's own event schema/significance
// gate/lifecycle unchanged — this module only ever TRANSLATES ECP fields
// into memory events with source_type 'imported-transcript' (an existing,
// documented Part 6 source type for exactly this case — see
// automation/memory/events.js#SOURCE_TYPES) and then calls Part 6's own
// gate/compiler. No new memory mechanism is introduced.

const { runQuery } = require('../../lib/query');
const memEvents = require('../memory/events');
const { planMemoryCapsule } = require('../memory/significance');
const lifecycle = require('../memory/lifecycle');

const CONTINUATION_SCORE_THRESHOLD = 500;

function findExistingMemory(packet, built) {
  if (!packet.conversation_title) return null;
  const results = runQuery(packet.conversation_title, built.searchIndex, { entityType: 'memory', limit: 3 });
  const strong = results.find((r) => r.score >= CONTINUATION_SCORE_THRESHOLD);
  return strong ? { memory_id: strong.record.stable_id, title: strong.record.title, score: strong.score } : null;
}

// Translates ECP fields into the same typed memory events a live session
// would record — never fabricated content, one event per packet entry.
function syntheticEventsFromPacket(sessionId, packet) {
  const events = [];
  const push = (type, summary, detail, relatedIds) => {
    events.push(memEvents.buildEvent({
      sessionId, type, sourceType: 'imported-transcript', sourceTool: packet.source_tool,
      summary: summary || undefined, detail: detail || {}, relatedIds: relatedIds || [], confidence: 'strong',
    }));
  };
  push('user_request_recorded', packet.user_goal, { wording_summary: packet.user_goal, constraints: (packet.constraints || []).join('; ') });
  for (const r of packet.revisions || []) {
    push('plan_revised', r.revised_approach || r.trigger, {
      trigger: r.trigger, user_feedback: r.user_feedback, prior_approach: r.prior_approach,
      revised_approach: r.revised_approach, reason: r.reason, status: r.status,
    });
  }
  for (const f of packet.feedback || []) {
    push('user_feedback_received', f.summary, { affected_area: f.affected_area, outcome: f.impact, disposition: f.disposition });
  }
  for (const a of packet.rejected_approaches || []) {
    push('option_considered', a.proposal, { reason: a.reason_rejected });
    push('option_rejected', a.proposal, { reason: a.reason_rejected });
  }
  for (const d of packet.accepted_decisions || []) {
    push('decision_accepted', d, {});
  }
  for (const b of packet.bugs_discussed || []) {
    if (b.root_cause) push('bug_confirmed', b.symptoms, { root_cause: b.root_cause });
  }
  for (const r of packet.implementation_requests || []) {
    push('follow_up_created', r.request, { expected_feature_ids: r.expected_feature_ids });
  }
  return events;
}

// conversationId: the already-allocated ENG-CONV-#### (memory linkage runs
// AFTER conversation ID allocation so the capsule can cite it).
function linkOrCreateMemory(packet, { built }, conversationId, { mode } = {}) {
  const existing = findExistingMemory(packet, built);
  if (existing) return { state: 'linked', memory_id: existing.memory_id, match: existing };

  const sessionId = memEvents.newSessionId();
  memEvents.touchSessionMeta(sessionId);
  const events = syntheticEventsFromPacket(sessionId, packet);
  for (const ev of events) memEvents.appendEvent(ev);

  const plan = planMemoryCapsule(null, memEvents.loadEvents(sessionId));
  if (!plan.justified) {
    return { state: 'not_significant', reason: plan.reason, session_id: sessionId };
  }
  if (mode === 'observe') {
    return { state: 'would_create', plan, session_id: sessionId };
  }
  const result = lifecycle.finalize(sessionId, { title: `${packet.conversation_title} (from ${conversationId})`, packet: null, mode });
  if (result.created) {
    return { state: 'created', memory_id: result.capsuleId, session_id: sessionId };
  }
  return { state: 'not_significant', reason: (result.plan && result.plan.reason) || 'memory finalize did not create a capsule', session_id: sessionId };
}

module.exports = { linkOrCreateMemory, findExistingMemory, syntheticEventsFromPacket };
