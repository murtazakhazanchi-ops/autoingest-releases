'use strict';
// Ask AutoIngest — Stage 2 deterministic knowledge/tool foundation,
// Section 11 (capability authority). Productionized from the Checkpoint
// 9-12 `capability_status` tool (unchanged across those checkpoints).
//
// SAFETY-VERIFIED DETERMINISM (Section 3 audit finding, load-bearing for
// Section 27's one-brain invariant): lib/answerWithAuthority.js exports TWO
// functions. `answerQuestionWithAuthority` invokes the Gemma local judge
// model (services/localJudge/judgeService.js) for free-text capability
// claims -- MUST NEVER be imported here. `answerKnownRecordWithAuthority`,
// the one this module imports, is verified by direct source read to call
// only answerForKnownRecord() (a pure data lookup/join) and
// baseAuthorityDiagnostic() (a static object constructor, `required:false,
// ran:false` hardcoded) -- it never calls applyCapabilityAuthority() and
// never touches the judge/model, per that file's own explicit design
// comment. Zero learned-model dependency in this file's entire call chain.
//
// Capability truth is separate from retrieval success (Section 11's own
// explicit requirement): this module is reached only via an already-
// resolved handle (from search_autoingest), never by re-deriving a
// capability answer from a free-text query. A failed search does not reach
// this code at all; an invalid handle is reported as a distinct protocol
// error, never as NOT_SUPPORTED.

const { answerForKnownRecord } = require('../knowledgeEngine');
const { answerKnownRecordWithAuthority } = require('../answerWithAuthority');
const { findAllByFeatureId } = require('../knowledgeModel/index');
const { resolveThenSanitize } = require('./leakBoundary');
const { checkStatusConsistency } = require('./sourcePrecedence');

async function capabilityStatus(handle, ctx, handleSession) {
  const realId = handleSession.resolve(handle);
  if (!realId) {
    return {
      error: 'invalid_handle',
      note: `"${handle}" was not issued by a previous search in this session. This is a protocol error -- it tells you NOTHING about whether AutoIngest supports this. Search again to get a valid handle.`,
    };
  }
  const base = answerForKnownRecord(realId, ctx);
  if (!base) return { status: 'UNKNOWN', provenance_count: 0, limitations: [] };
  const withAuthority = await answerKnownRecordWithAuthority(realId, ctx);
  const answer = withAuthority || base;

  const kmRecords = findAllByFeatureId(realId);
  const consistency = checkStatusConsistency(realId, answer.capabilityStatus, kmRecords);

  return {
    status: answer.capabilityStatus,
    provenance_count: (answer.sources || []).length, // count only -- never real ids
    limitations: (answer.limitations || []).map(resolveThenSanitize),
    // Section 7: surfaced, never silently resolved. Present and true in the
    // overwhelming common case (nothing to disagree with, or the two
    // sources agree); a `false` value names exactly which KM record(s)
    // disagree with the live, authoritative status, so a future caller
    // (or this stage's own corpus audit) can see the disagreement rather
    // than having it silently absorbed.
    sourceConsistency: consistency,
  };
}

module.exports = { capabilityStatus };
