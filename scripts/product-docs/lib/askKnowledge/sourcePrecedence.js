'use strict';
// Ask AutoIngest — Stage 2 deterministic knowledge/tool foundation,
// Section 7 (source precedence and conflicts). NEW production logic --
// the C9-C14 prototypes never had to face this question explicitly,
// because they always called the live status resolver and never compared
// it against the Knowledge Model's own static `status` field. This module
// makes that precedence an explicit, canonical, testable policy instead of
// an accidental non-conflict.
//
// TWO independent sources can each make a capability-status claim about the
// same Feature:
//   1. lib/statusResolution.js's resolveFeatureOperatorStatus() (via
//      lib/knowledgeEngine.js's answerForKnownRecord()) -- LIVE, computed
//      fresh every call from the Feature record's own current canonical
//      `status` field plus current linked-bug evidence. This is Stage 2's
//      capability_status tool's actual source of truth.
//   2. A Knowledge Model record's own `status` field (schema.js's STATUS
//      enum) -- a STATIC snapshot, authored once (2026-08-25 for the
//      original Candidate C promotion) and only updated when someone edits
//      that specific record. Retained for record-level classification
//      (e.g. distinguishing a NOT_SUPPORTED boundary record from an
//      ordinary Feature record) -- never Stage 2's own authoritative
//      answer.
//
// POLICY (Section 7's own "do not let future Qwen infer authority from
// ranking order" -- made explicit, not left implicit): for capability
// status specifically, source (1) is authoritative over source (2). This
// module's job is not to pick a winner silently -- it CROSS-CHECKS the two
// and returns a structured CONFLICT when they genuinely disagree (a real
// finding worth surfacing, e.g. if a KM record's static text drifts stale
// after a Feature's canonical status changes), rather than letting the
// live source win with the disagreement unrecorded.

const { STATUS } = require('../knowledgeModel/schema');
const { QUERY_STATUS } = require('../statusResolution');

// Maps the live, 5-value QUERY_STATUS vocabulary onto the Knowledge
// Model's coarser 4-value STATUS vocabulary. AVAILABLE and
// PARTIALLY_AVAILABLE both count as "implemented" from the KM schema's own
// coarser perspective (schema.js has no partial-availability concept).
const LIVE_TO_KM_STATUS = Object.freeze({
  [QUERY_STATUS.AVAILABLE]: STATUS.IMPLEMENTED,
  [QUERY_STATUS.PARTIALLY_AVAILABLE]: STATUS.IMPLEMENTED,
  [QUERY_STATUS.PLANNED]: STATUS.PLANNED,
  [QUERY_STATUS.NOT_SUPPORTED]: STATUS.NOT_SUPPORTED,
  [QUERY_STATUS.UNKNOWN]: STATUS.UNKNOWN,
});

// Cross-checks a live-resolved capability status against every Knowledge
// Model record's own static `status` field for the same featureId.
// Returns { agree: true } when every KM record's status maps onto the live
// status (including the trivial "zero KM records" case -- nothing to
// disagree with), or { agree: false, conflicts: [...] } naming exactly
// which KM record(s) disagree and how. Never called from a hot path that
// blocks a tool response -- see capabilityStatus.js for where this is
// surfaced (as an additional `sourceConsistency` field, non-blocking) and
// the corpus audit (Section 22) for where it is run exhaustively.
function checkStatusConsistency(featureId, liveStatus, kmRecords) {
  const records = kmRecords || [];
  const expectedKmStatus = LIVE_TO_KM_STATUS[liveStatus] || null;
  const conflicts = [];
  for (const r of records) {
    if (!r.status) continue;
    if (expectedKmStatus && r.status !== expectedKmStatus) {
      conflicts.push({
        kmRecordId: r.id,
        kmStatus: r.status,
        liveStatus,
        expectedKmStatus,
        note: `Knowledge Model record ${r.id} has status "${r.status}" but the live, authoritative resolver currently says "${liveStatus}" (expected KM status "${expectedKmStatus}"). The live resolver is authoritative for capability_status; this record's static status field may be stale and is a documentation-quality candidate, not evidence that changes the returned answer.`,
      });
    }
  }
  return conflicts.length ? { agree: false, conflicts } : { agree: true, conflicts: [] };
}

module.exports = { LIVE_TO_KM_STATUS, checkStatusConsistency };
