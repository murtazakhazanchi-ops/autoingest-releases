'use strict';

// Part 3 Phase 4.1 (Decision 7) — formalizes the Improvement / Acceptable
// change / Regression / Unexplained change / Unchanged discipline Part 2's
// closure review applied by hand (a forensic re-read that caught
// under-delivered work only because someone happened to re-check against
// the original findings report — see 10_CHANGELOG.md's 2026-08-14 entry).
// This module makes that comparison repeatable and mechanical: given two
// hardened-harness snapshot reports for the SAME entry (a "before" and an
// "after" run, e.g. pre- and post-Phase-4.2), classify what happened.
//
// This module does not run the Knowledge Engine itself and does not decide
// what SHOULD happen — it only compares two already-captured results
// (see knowledgeEvalDiagnostics.js's captureEvidence()) against the test
// entry's own declared target expectation.

const CHANGE_CLASS = Object.freeze({
  IMPROVEMENT: 'IMPROVEMENT',
  ACCEPTABLE_CHANGE: 'ACCEPTABLE_CHANGE',
  REGRESSION: 'REGRESSION',
  UNEXPLAINED_CHANGE: 'UNEXPLAINED_CHANGE',
  UNCHANGED: 'UNCHANGED',
});

// A coarse fingerprint used only to detect "did anything material change" —
// not itself the classification. Confidence is bucketed rather than
// compared as an exact float, per Decision 7's explicit "ranges/bands, not
// brittle exact values" requirement.
function fingerprint(evidence) {
  const primary = evidence.matchedCapabilities[0] || null;
  const confidenceBand = evidence.confidence >= 0.5 ? 'high' : evidence.confidence >= 0.2 ? 'mid' : 'low';
  return {
    primaryId: primary ? primary.id : null,
    status: evidence.capabilityStatus,
    quality: evidence.matchQuality,
    confidenceBand,
  };
}

function sameFingerprint(a, b) {
  return a.primaryId === b.primaryId && a.status === b.status && a.quality === b.quality && a.confidenceBand === b.confidenceBand;
}

// `entry` is the corpus test case (carries requiredMemberIds/forbiddenMemberIds/
// allowedMemberIds/expectedPrimaryId/targetPhase/etc. — see
// knowledgeRegressionCorpusV3.js). `beforeMet`/`afterMet` are booleans: did
// the before/after evidence satisfy `entry`'s own declared target
// expectation (computed by the hardened evaluator, not here).
function classifyCase(entry, beforeEvidence, afterEvidence, beforeMet, afterMet) {
  const beforeFp = fingerprint(beforeEvidence);
  const afterFp = fingerprint(afterEvidence);

  if (sameFingerprint(beforeFp, afterFp) && beforeMet === afterMet) {
    return { entryId: entry.id, classification: CHANGE_CLASS.UNCHANGED, reason: 'Primary record, status, match quality, confidence band, and target-expectation outcome are all materially identical.' };
  }

  if (!beforeMet && afterMet) {
    return { entryId: entry.id, classification: CHANGE_CLASS.IMPROVEMENT, reason: `Previously did not meet the declared target expectation (targetPhase ${entry.targetPhase || 'n/a'}); now does, without any forbidden member becoming primary.` };
  }

  if (beforeMet && !afterMet) {
    return { entryId: entry.id, classification: CHANGE_CLASS.REGRESSION, reason: 'Previously met the declared target expectation or an approved invariant; the new run no longer does. Zero unexplained instances of this are acceptable per Decision 7\'s closure standard.' };
  }

  // Changed, but the entry's own target-expectation-met verdict is
  // unchanged (true->true or false->false) — only "acceptable" if the new
  // primary is explicitly listed as an allowed alternate; otherwise it's a
  // real behavior change nobody has yet justified, and must not be silently
  // waved through.
  const allowed = new Set(entry.allowedMemberIds || []);
  if (afterFp.primaryId && allowed.has(afterFp.primaryId)) {
    return { entryId: entry.id, classification: CHANGE_CLASS.ACCEPTABLE_CHANGE, reason: `Result changed, but the new primary (${afterFp.primaryId}) is one of the entry's declared allowedMemberIds — a legitimate alternate, not a regression.` };
  }

  return { entryId: entry.id, classification: CHANGE_CLASS.UNEXPLAINED_CHANGE, reason: 'Result changed and is not covered by an Improvement, Regression, or declared-allowed-alternate rule above — requires human review before this run can be accepted. Known-limitations metadata must never be used to retroactively bless this after the fact (Decision 7).' };
}

// Compares two full snapshot reports (arrays of { id, evidence, meetsTargetExpectation }
// keyed by entry id) and returns per-case classifications plus a summary.
function classifyRun(corpus, beforeById, afterById) {
  const cases = [];
  for (const entry of corpus) {
    const before = beforeById.get(entry.id);
    const after = afterById.get(entry.id);
    if (!before || !after) continue; // entry didn't exist in one of the two runs — not a "change", a corpus-membership difference, reported separately by the caller
    cases.push(classifyCase(entry, before.evidence, after.evidence, before.meetsTargetExpectation, after.meetsTargetExpectation));
  }
  const counts = Object.fromEntries(Object.values(CHANGE_CLASS).map((c) => [c, 0]));
  for (const c of cases) counts[c.classification]++;
  const zeroUnexplainedHarmfulRegressions = counts[CHANGE_CLASS.REGRESSION] === 0 && counts[CHANGE_CLASS.UNEXPLAINED_CHANGE] === 0;
  return { cases, counts, zeroUnexplainedHarmfulRegressions };
}

module.exports = { CHANGE_CLASS, fingerprint, classifyCase, classifyRun };
