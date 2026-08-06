'use strict';

// Evidence-gated "is a durable Memory Capsule warranted" predicate — the
// Part 6 sibling of automation/documentationPlanner.js's planDocumentation(),
// same style: a pure function over already-collected evidence (events plus
// an optional linked Evidence Packet), returning {justified, reason}. See
// docs/product/16_ENGINEERING_MEMORY_POLICY.md § 8 for the significance
// table this function encodes, and § 3 for why this never promotes a
// low-confidence guess into a "yes, create a capsule" answer.

const SIGNIFICANT_EVENT_TYPES = new Set([
  'plan_revised',
  'user_feedback_received',
  'bug_confirmed',
  'option_rejected',
  'decision_accepted',
  'correction_applied',
  'follow_up_created',
]);

// A packet/session counts as "substantial troubleshooting" or "multiple plan
// revisions" once it clears a small floor — one plan revision or one
// rejected option alone is routine engineering, not yet a story worth a
// permanent capsule. Two or more of the same significant-event family is the
// bar; see docs/product/16_ENGINEERING_MEMORY_POLICY.md § 8's own list for
// the full non-mechanical judgment this floor approximates.
const REVISION_FLOOR = 2;

function countByType(events, type) {
  return events.filter((e) => e.type === type).length;
}

// Sanity check, run once at module load: every type this file treats as an
// independently-significant signal must actually be listed in
// SIGNIFICANT_EVENT_TYPES, so the constant (previously exported but never
// consulted — found in code review) can't silently drift out of sync with
// the logic below it documents. 'option_considered' is deliberately excluded
// — it's a companion count for 'option_rejected', never significant alone.
(function assertSignificantTypesInSync() {
  const usedAsSignificant = ['plan_revised', 'user_feedback_received', 'option_rejected', 'correction_applied', 'bug_confirmed', 'follow_up_created'];
  for (const type of usedAsSignificant) {
    if (!SIGNIFICANT_EVENT_TYPES.has(type)) {
      throw new Error(`significance.js treats "${type}" as significant but it is missing from SIGNIFICANT_EVENT_TYPES`);
    }
  }
})();

// packet: an optional Part 5 Evidence Packet (already finalized-eligible, or
// null for a memory-only session with no linked packet).
// events: this session's raw event list (events.js's loadEvents()).
function planMemoryCapsule(packet, events) {
  events = events || [];
  const reasons = [];

  const planRevisions = countByType(events, 'plan_revised');
  const feedback = countByType(events, 'user_feedback_received');
  const rejectedOptions = countByType(events, 'option_rejected');
  const corrections = countByType(events, 'correction_applied');
  const bugsConfirmed = countByType(events, 'bug_confirmed');
  const followUps = countByType(events, 'follow_up_created');

  if (planRevisions >= REVISION_FLOOR) reasons.push(`${planRevisions} plan revisions recorded`);
  if (feedback >= 1) reasons.push(`${feedback} piece(s) of user feedback recorded`);
  if (rejectedOptions >= 1 && countByType(events, 'option_considered') >= 2) {
    reasons.push(`${rejectedOptions} alternative(s) rejected out of ${countByType(events, 'option_considered')} considered`);
  }
  if (corrections >= 1) reasons.push(`${corrections} post-implementation correction(s) recorded`);
  if (bugsConfirmed >= 1) reasons.push(`${bugsConfirmed} confirmed bug(s) with investigation`);
  if (followUps >= 1) reasons.push(`${followUps} follow-up item(s) recorded`);

  if (packet) {
    if (Array.isArray(packet.bugs_discovered) && packet.bugs_discovered.length) {
      reasons.push(`linked Evidence Packet recorded ${packet.bugs_discovered.length} bug(s)`);
    }
    if (Array.isArray(packet.decisions_made) && packet.decisions_made.length) {
      reasons.push(`linked Evidence Packet recorded ${packet.decisions_made.length} decision(s)`);
    }
    if (Array.isArray(packet.alternatives_considered) && packet.alternatives_considered.length >= 2) {
      reasons.push(`linked Evidence Packet recorded ${packet.alternatives_considered.length} alternatives considered`);
    }
    // Deliberately NOT a bare `task_type === 'feature'` trigger — that would
    // fire for every routine feature packet regardless of substance,
    // violating docs/product/16_ENGINEERING_MEMORY_POLICY.md § 8's "not for
    // every session" rule. A feature/architecture/reliability packet only
    // counts as significant when it also carries risk-flagged evidence.
    if (Array.isArray(packet.risks) && packet.risks.length && ['feature', 'architecture', 'reliability', 'security'].includes(packet.task_type)) {
      reasons.push(`task_type "${packet.task_type}" with ${packet.risks.length} recorded risk(s)`);
    }
  }

  const justified = reasons.length > 0;
  return {
    justified,
    reason: justified
      ? `Significant per docs/product/16_ENGINEERING_MEMORY_POLICY.md § 8: ${reasons.join('; ')}.`
      : 'No significant-event threshold met (no plan revisions ≥ 2, no user feedback, no rejected alternatives among ≥2 considered, no corrections, no confirmed bugs, no follow-ups, and no qualifying linked Evidence Packet fields) — routine work, no capsule created.',
    signals: { planRevisions, feedback, rejectedOptions, corrections, bugsConfirmed, followUps },
  };
}

module.exports = { planMemoryCapsule, SIGNIFICANT_EVENT_TYPES, REVISION_FLOOR };
