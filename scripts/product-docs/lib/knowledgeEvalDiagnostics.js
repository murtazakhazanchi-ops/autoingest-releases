'use strict';

// Part 3 Phase 4.1 (Decision 7) — evidence capture and A/B/C/D failure
// diagnosis for the hardened evaluation harness. This module observes and
// asserts the real answerQuestion() pipeline's own output; it never
// reimplements scoring (Decision 2's territory), admission (Decision 3's),
// or relationship traversal (Decision 4's) as a competing algorithm —
// see Decision 7's "harness independence" requirement.
//
// The one exception, and it is a read of ground truth rather than a second
// algorithm: diagnosing whether a missing required record is absent because
// it was never a candidate (category A) or because no canonical evidence
// supports the claim at all (category D) requires knowing what the
// canonical records themselves actually cite. That's exactly what
// lib/authorityTopics.js's buildAuthorityIndex() already computes from
// parsed canonical Markdown — this module reuses that existing, already-
// correct projection as a read-only oracle. It does not decide whether the
// Knowledge Engine SHOULD have found the relationship; it only records
// whether the relationship canonically EXISTS, which is a fact, not an
// algorithm's opinion.
//
// Categories B (admission failure) and C (relationship-visibility failure)
// cannot yet be told apart by this harness — neither Decision 3's admission
// logic nor Decision 4's live relationship wiring exists until Phase 5.1/
// 5.2 land. Rather than force a guess, a case that isn't cleanly A or D is
// labeled PENDING_PHASE_5 with the evidence attached, so a human (or a
// later, more capable harness) can finish the diagnosis once those phases
// exist. This is deliberate honesty, not a gap in the tool.

const DIAGNOSTIC_CATEGORIES = Object.freeze({
  A_RETRIEVAL_FAILURE: 'A_RETRIEVAL_FAILURE',
  D_EVIDENCE_GAP: 'D_EVIDENCE_GAP',
  PENDING_PHASE_5: 'PENDING_PHASE_5',
});

// A trimmed, stable snapshot of what the real pipeline actually produced —
// deliberately a plain data copy, not a reference to the live answer
// object, so a saved baseline snapshot can't be mutated by a later run.
// Extensible: later phases (4.3's adjusted scores, 5.1's visible
// relationships, 5.2's admission reasons) add fields here without breaking
// this shape — nothing here assumes those fields exist yet.
function captureEvidence(answer) {
  return {
    classification: answer.classification,
    capabilityStatus: answer.capabilityStatus,
    matchQuality: answer.matchQuality,
    confidence: answer.confidence,
    matchedCapabilities: (answer.matchedCapabilities || []).map((m) => ({ id: m.id, entityType: m.entityType, score: m.score })),
    // Part 5 Phase 5.3 (Decision 5) — role/historicalType/evidenceQualification
    // are additive, optional fields only present on historical-context
    // sources[] entries (see lib/knowledgeHistoricalContext.js); undefined
    // for every other source, exactly the extensibility this function's own
    // header comment already anticipated.
    sources: (answer.sources || []).map((s) => ({ id: s.id, title: s.title || null, role: s.role, historicalType: s.historicalType, evidenceQualification: s.evidenceQualification })),
    relatedCapabilities: answer.relatedCapabilities || [],
  };
}

function findAuthorityEntry(authorityIndex, recordId) {
  if (!authorityIndex) return null;
  return authorityIndex.find((e) => e.featureId === recordId || e.workflowId === recordId) || null;
}

// Ground-truth check only — does ANY canonical record (feature or workflow)
// cite `relatedId` in one of its own real relationship fields? This is
// deliberately broad (checks from every entry, not just a hypothesized
// subject) because Phase 4.1 doesn't yet know which direction Phase 5.1
// will end up querying — it only needs to know whether the fact exists
// anywhere in the canonical corpus at all.
function groundTruthCitationExists(authorityIndex, relatedId) {
  if (!authorityIndex) return null; // unknown — no oracle available
  for (const entry of authorityIndex) {
    const fields = [entry.relatedBugs, entry.relatedDecisions, entry.relatedPostmortems, entry.relatedFeatures, entry.relatedWorkflows, entry.roadmapIds];
    for (const field of fields) {
      if (Array.isArray(field) && field.includes(relatedId)) {
        return { citedBy: entry.featureId || entry.workflowId, recordType: entry.recordType };
      }
    }
  }
  return false;
}

// Diagnose why a single required-but-missing record didn't appear in the
// answer. `requiredId` is the record the test case expected; `evidence` is
// this same module's captureEvidence() output for the actual answer.
//
// Phase 4.1 review correction — do not equate "not present in scored
// retrieval candidates" with "not discoverable by the Knowledge Engine."
// Decision 4 introduces relationship-based discovery (a canonical citation
// lookup on the winning record) that does not require the missing record to
// ever have been a scored ranker candidate at all. So candidate-absence is
// no longer, by itself, sufficient to assert a confident retrieval-failure
// diagnosis — it is recorded as a raw observation, but the CATEGORY is
// decided by ground truth first: a real canonical citation means the
// eventual fix could come from Decision 4 (Phase 5.1) independent of
// ranking, so the honest label is PENDING, not a confirmed retrieval miss.
// This does not pre-implement Decision 4's own lookup mechanism — it reuses
// the SAME read-only ground-truth check already used elsewhere in this
// module, only removing the short-circuit that skipped it when the record
// wasn't a candidate.
function diagnoseMissingMember(requiredId, evidence, authorityIndex) {
  const presentInCandidates = evidence.matchedCapabilities.some((m) => m.id === requiredId);
  const presentInSources = evidence.sources.some((s) => s.id === requiredId);

  if (!authorityIndex) {
    // No oracle available this run — candidate-presence is the only signal
    // we have, so this category is provisional, never a confirmed
    // diagnosis. Re-run with a fresh build.assemble() result whenever
    // possible so this doesn't have to be guessed.
    return {
      requiredId, presentInCandidates, presentInSources, groundTruthCitation: null,
      category: (presentInCandidates || presentInSources) ? DIAGNOSTIC_CATEGORIES.PENDING_PHASE_5 : DIAGNOSTIC_CATEGORIES.A_RETRIEVAL_FAILURE,
      note: 'No ground-truth oracle (authorityIndex) was available this run to check for a canonical citation — this category is PROVISIONAL, not a confirmed diagnosis. Re-run with a fresh build.assemble() result.',
    };
  }

  const citation = groundTruthCitationExists(authorityIndex, requiredId);

  if (citation === false) {
    return {
      requiredId, presentInCandidates, presentInSources, groundTruthCitation: false,
      category: DIAGNOSTIC_CATEGORIES.D_EVIDENCE_GAP,
      note: 'No canonical record anywhere cites this relationship — an honest documentation gap, true regardless of whether it happened to score as a retrieval candidate.',
    };
  }

  // A canonical citation exists. Both raw observations (candidate presence,
  // citation existence) are preserved separately below; neither alone
  // determines which future phase will resolve this.
  return {
    requiredId, presentInCandidates, presentInSources, groundTruthCitation: citation,
    category: DIAGNOSTIC_CATEGORIES.PENDING_PHASE_5,
    note: presentInCandidates
      ? `Was a real ranker candidate AND a canonical citation exists (via ${citation.citedBy}), but today's single-primary architecture has no admission or live-relationship mechanism to surface it as the answer. Cannot yet distinguish an admission-logic miss (Decision 3, Phase 5.2) from a relationship-visibility miss (Decision 4, Phase 5.1) until those phases exist.`
      : `Not a scored ranker candidate, but a canonical citation exists (via ${citation.citedBy}) — do not conclude this is a retrieval/ranking defect. Decision 4 introduces relationship-based discovery independent of ranker scoring; whether the eventual fix comes from improved retrieval, Decision 4's relationship lookup (Phase 5.1), or Decision 3's admission logic (Phase 5.2) cannot be determined until Phase 5.1 exists.`,
  };
}

module.exports = { DIAGNOSTIC_CATEGORIES, captureEvidence, findAuthorityEntry, groundTruthCitationExists, diagnoseMissingMember };
