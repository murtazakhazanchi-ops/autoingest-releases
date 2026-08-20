'use strict';

// Ask AutoIngest — Phase C5: synthesis eligibility policy.
//
// Decides, from the already-authority-resolved answer alone (never from
// retrieval internals directly, never by re-running anything), whether the
// LLM synthesis stage may run at all. This is a REFUSAL gate, not a quality
// gate -- when it says ineligible, the caller must show the existing,
// already-safe deterministic/authority answer completely unchanged.
//
// Two independent, deterministic reasons to refuse:
//
//  1. capabilityStatus === 'UNKNOWN'. This single check covers BOTH of the
//     ways an answer legitimately ends up UNKNOWN: the deterministic engine
//     found nothing (knowledgeEngine.js's unknownAnswer(), matchQuality
//     'none'), and capabilityAuthority.js's downgradeToUncertain() (a
//     confirmed-safe, already-tested hedge -- see UNVERIFIED_HEDGE in
//     capabilityAuthority.js). A fluent LLM must never be allowed to make
//     either of these sound more confident than the deterministic/authority
//     layer already decided they should (checkpoint Section E).
//
//  2. matchQuality === 'weak'. This is the retrieval-defect guard (checkpoint
//     Section C/V): a question whose primary record was only weakly matched
//     or tied with close competitors (knowledgeEngine.js's matchQualityFor())
//     can still carry an AFFIRMATIVE capabilityStatus that capability
//     authority never even looks at (authority only fires for
//     CAPABILITY/STATUS-classified questions -- a HOW_TO or EXPLANATION
//     question with a shaky primary match never enters that scope at all).
//     Polishing a possibly-wrong primary-record selection into fluent prose
//     would make a retrieval defect MORE convincing, not less -- exactly
//     what this checkpoint prohibits. 'boundary' (a deliberately curated
//     answer) and 'roadmap' (deterministic dashboard data, not retrieval-
//     ranked) are NOT weak matches and remain eligible.
//
// FORMERLY-OPEN GAP, CLOSED IN PHASE C5.1 (checkpoint Section C/V/Y):
// "How do I create a Transfer Export?" deterministically matched AI-WF-008
// ("Recover From an Archive Lock Error") -- a completely unrelated
// Workflow -- with matchQuality 'strong'. A first candidate third rule
// (built during C5, comparing the chosen primary against an untyped,
// cross-entity-type top5 ranking) caught this case but produced a real
// false positive on "How do I create a new event?" and was reverted rather
// than shipped. Phase C5.1 re-derived the fix properly, validated against a
// 32-question evaluation set spanning every question type plus 8
// deliberately confusable pairs (Section D/E) -- see
// askSynthesis/retrievalConfidence.js for the full root-cause account, the
// signal actually shipped (a competing-title-named-in-query check, not a
// score-margin check), the rejected alternative and why, and the exemption
// that resolves its one apparent false positive. `primaryFit` below is that
// module's result, computed by the caller (answerWithSynthesis.js) ONLY for
// the free-text question path -- see Section L: known-record navigation
// resolves an already-deterministic id directly and must never be subjected
// to this check, so callers on that path pass `null` here, not a
// computed-and-passing result.
//
// Known gap, documented rather than solved here (checkpoint Section C: "if
// some checks cannot be made deterministically, document that boundary
// honestly"): this policy has no way to detect genuinely CONFLICTING
// evidence within an otherwise strong-matched package (e.g. two admitted
// neighborhood members whose own text disagrees) -- no such case has been
// observed in the 13-question acceptance set or the existing corpus, and
// building a conflict detector was not attempted this checkpoint.

const WEAK_MATCH_QUALITIES = new Set(['weak', 'none']);

function evaluateSynthesisEligibility(answer, primaryFit) {
  if (!answer) {
    return { eligible: false, reason: 'no-answer' };
  }
  if (answer.capabilityStatus === 'UNKNOWN') {
    const authority = answer.authority;
    const reason = authority && authority.required
      ? (authority.ran ? 'authority-downgraded-unknown' : 'authority-claim-unmatched')
      : 'deterministic-unknown';
    return { eligible: false, reason };
  }
  if (WEAK_MATCH_QUALITIES.has(answer.matchQuality)) {
    return { eligible: false, reason: `weak-retrieval-${answer.matchQuality}` };
  }
  if (primaryFit && primaryFit.fit === 'MISMATCHED') {
    return { eligible: false, reason: `primary-mismatch-${primaryFit.competingId}` };
  }
  return { eligible: true, reason: null };
}

module.exports = { evaluateSynthesisEligibility };
