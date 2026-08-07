'use strict';

// Evidence-gated "is a canonical ENG-CONV-#### warranted" predicate — the
// Part 8 sibling of automation/memory/significance.js's planMemoryCapsule().
// Same style: a pure function over an already-normalized ECP, returning
// {justified, reason}. See docs/product/18_ENGINEERING_CONVERSATION_POLICY.md
// § 8 — this exists specifically so a bulk/routine import doesn't burn an ID
// on a conversation that carried no real engineering content (found in Part
// 8 architecture review: unlike Memory, which is gated at the SESSION level
// before any capsule work starts, a naive Part 8 design would allocate an ID
// for every schema-valid, non-duplicate import regardless of content).

function nonEmpty(arr) {
  return Array.isArray(arr) && arr.length > 0;
}

function planConversationCanonicalization(packet) {
  const reasons = [];

  if (nonEmpty(packet.explicit_requirements)) reasons.push(`${packet.explicit_requirements.length} explicit requirement(s) captured`);
  if (nonEmpty(packet.accepted_decisions)) reasons.push(`${packet.accepted_decisions.length} accepted decision(s)`);
  if (nonEmpty(packet.rejected_approaches)) reasons.push(`${packet.rejected_approaches.length} rejected approach(es)`);
  if (nonEmpty(packet.revisions)) reasons.push(`${packet.revisions.length} recorded revision(s)`);
  if (nonEmpty(packet.feedback)) reasons.push(`${packet.feedback.length} piece(s) of user feedback`);
  if (nonEmpty(packet.bugs_discussed)) reasons.push(`${packet.bugs_discussed.length} bug(s) discussed`);
  if (nonEmpty(packet.implementation_requests)) reasons.push(`${packet.implementation_requests.length} implementation request(s)`);
  if (nonEmpty(packet.open_questions)) reasons.push(`${packet.open_questions.length} substantive open question(s)`);
  if (nonEmpty(packet.deferred_items)) reasons.push(`${packet.deferred_items.length} deferred item(s)`);

  const justified = reasons.length > 0;
  return {
    justified,
    reason: justified
      ? `Significant per docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 8: ${reasons.join('; ')}.`
      : 'No engineering-content signal found (no explicit requirements, decisions, rejected approaches, revisions, feedback, bugs, implementation requests, open questions, or deferred items) — retained in the raw local tier only, no ENG-CONV-#### allocated.',
    signals: {
      explicit_requirements: (packet.explicit_requirements || []).length,
      accepted_decisions: (packet.accepted_decisions || []).length,
      rejected_approaches: (packet.rejected_approaches || []).length,
      revisions: (packet.revisions || []).length,
      feedback: (packet.feedback || []).length,
      bugs_discussed: (packet.bugs_discussed || []).length,
      implementation_requests: (packet.implementation_requests || []).length,
      open_questions: (packet.open_questions || []).length,
      deferred_items: (packet.deferred_items || []).length,
    },
  };
}

module.exports = { planConversationCanonicalization };
