'use strict';

// Part 3 Phase 4.3 (Decision 2, E1 resolved by Product Owner: Option A /
// conservative) — a bounded, local relevance adjustment over lib/query.js's
// own keyword-overlap scoring tier. This is NOT a second ranker: it
// consumes the shared ranker's own score/reasons output unchanged (see
// isPureKeywordOverlapTier below) and only re-weights candidates whose
// winning score is attributable PURELY to keyword-overlap. Every other
// tier (exact-id/alias/title, title-substring) passes through this module
// completely untouched, always — lib/query.js itself is never imported or
// modified by this file.
//
// Governing principle: searchable-surface size must not itself confer
// retrieval authority. A record's own keyword-surface size (how many
// keywords it happens to index) gives it more OPPORTUNITIES to accumulate
// incidental token matches on a generic multi-word question, independent
// of whether those matches reflect genuine topical relevance. This module
// corrects for that structural opportunity advantage — it is not a
// negative authority signal against large/well-documented records in
// general. The sync-slot control (see AI-FEAT-058's Phase 4.3 evolution
// entry) proves a large record with genuinely dense, specific matched
// evidence must still win, and this module is required to preserve that.
//
// REF and DAMPING, and what "conservative" means here — see AI-FEAT-058's
// Phase 4.3 evolution entry for the full empirical account. Summary:
// REF (=20) is a small reference constant, not a hard on/off threshold —
// every keyword-overlap match is dampened continuously in proportion to
// log2(surfaceSize / REF); there is no discontinuity at any particular
// surface size. (A baseline-gated on/off design was tested and rejected —
// it let a moderately-sized, merely coincidentally-matching record escape
// dampening entirely by chance while a slightly larger CORRECT record got
// dampened, flipping an answer the wrong way — the AI-WF-008/AI-WF-009
// "Why does Transfer Import exist?" case.)
// DAMPING (=0.25) is the smallest strength found, by systematic empirical
// sweep against real corpus data, that robustly resolves the confirmed
// Gap C bias case (equal absolute evidence, N=4 vs N=4, materially
// different surfaces S=223 vs S=119) while ALSO robustly preserving the
// sync-slot legitimate-large-record control. A stronger damping value
// additionally flipped a second case (R29) only within a fragile few-point
// margin that simultaneously put sync-slot's correctness at risk —
// rejected by explicit Product Owner decision (E1) as an unacceptable
// robustness basis for production behavior. Do not strengthen these
// constants to force any specific case to resolve — a residual failure
// that available signals (absolute token overlap, surface size) cannot
// safely distinguish from a legitimate large-record win belongs to
// whichever future mechanism CAN make that distinction, not to a
// strengthened version of this one.

const KEYWORD_SURFACE_REFERENCE = 20;
const KEYWORD_SURFACE_DAMPING = 0.25;

// A record's winning score is eligible for this adjustment ONLY when the
// keyword-overlap tier is the sole reason it matched — if any higher tier
// (exact-id, exact-alias, exact-title, title-substring, identity-mention)
// also fired, that tier's own score is what lib/query.js's Math.max()
// actually returned, and this module must never touch it. This is the
// entire mechanism by which "exact-ID, alias and title tiers remain
// untouched" is guaranteed — not a separate exclusion list, but a
// structural property of when normalization is even considered.
//
// Phase C6 — 'identity-mention' added (lib/query.js's own header comment
// has the full forensic finding). It is the reverse direction of
// title-substring (query contains the record's title/alias, instead of
// the other way around) and must receive the exact same exemption for the
// exact same reason: it is an identity signal, not an incidental keyword-
// overlap accumulation, so surface-size opportunity-advantage reasoning
// does not apply to it.
const HIGHER_TIER_REASONS = new Set(['exact-id', 'exact-alias', 'exact-title', 'title-substring', 'identity-mention']);

function isPureKeywordOverlapTier(reasons) {
  if (!reasons || !reasons.length) return false;
  return reasons.some((r) => r.startsWith('keyword-overlap')) && !reasons.some((r) => HIGHER_TIER_REASONS.has(r));
}

// Restricted to feature/workflow entity types — every case investigated
// and evidenced during Phase 4.3 (Gap A, Gap C, R23, R29, R05, the
// sync-slot control) was a feature/workflow candidate. Governance records
// (bug/decision/postmortem, Part 2's Decision 1) were never tested against
// this mechanism; a real regression was found and fixed during
// implementation when normalization was briefly applied there too (it let
// a governance record unexpectedly become the governance-primary winner
// in a case it previously wasn't). Single source of truth for this gate —
// both the live knowledgeEngine.js path and this module's own diagnostic
// explainCandidate() consult it, so the diagnostic output can never drift
// from what actually happens.
const ELIGIBLE_ENTITY_TYPES = new Set(['feature', 'workflow']);

function isEligibleForNormalization(entityType, reasons) {
  return ELIGIBLE_ENTITY_TYPES.has(entityType) && isPureKeywordOverlapTier(reasons);
}

function matchedTokenCount(reasons) {
  const tag = (reasons || []).find((r) => r.startsWith('keyword-overlap'));
  return tag ? parseInt(tag.split(':')[1], 10) : 0;
}

// Dampen-only invariant: this divisor can never be less than 1.0, so
// dividing any raw score by it can never INCREASE that score. This is the
// single mechanism guaranteeing "the adjustment must never increase a
// candidate above its shared-ranker score" — proved structurally (for
// every surface size, not just tested fixtures) by keywordSurfaceDivisor's
// own Math.max floor, not by per-case tuning.
function keywordSurfaceDivisor(surfaceSize) {
  const raw = 1 + KEYWORD_SURFACE_DAMPING * Math.log2(Math.max(surfaceSize, 1) / KEYWORD_SURFACE_REFERENCE);
  return Math.max(raw, 1);
}

// `confidenceFloor` is passed in (not imported) to avoid a circular
// require with knowledgeEngine.js, which already owns that constant.
// Minimum-evidence protection: a match backed by 2+ distinct tokens is
// never dampened below the confidence floor — this is a general absolute-
// evidence invariant (the "absolute evidence" half of the governing
// principle), not tuned to any specific record; within the current corpus
// (max surface size 223) it is never actually reached at this damping
// strength — verified structurally across surface sizes, not assumed.
const ABSOLUTE_EVIDENCE_FLOOR_TOKENS = 2;

function adjustKeywordOverlapScore(rawScore, tokenCount, surfaceSize, confidenceFloor) {
  const divisor = keywordSurfaceDivisor(surfaceSize);
  const adjusted = rawScore / divisor;
  return tokenCount >= ABSOLUTE_EVIDENCE_FLOOR_TOKENS ? Math.max(adjusted, confidenceFloor) : adjusted;
}

// Diagnostic explanation for one candidate — every field named in the
// Phase 4.3 brief's observability requirement (candidate id, original
// score/tier, absolute evidence, surface measurement, adjustment,
// resulting delta). Used by the CLI/reports/tests to inspect the
// transformation; never consulted by the transformation itself.
function explainCandidate(candidate, confidenceFloor) {
  const eligible = isEligibleForNormalization(candidate.entityType, candidate.reasons);
  const tokens = eligible ? matchedTokenCount(candidate.reasons) : null;
  const adjustedScore = eligible
    ? adjustKeywordOverlapScore(candidate.score, tokens, candidate.surfaceSize, confidenceFloor)
    : candidate.score;
  return {
    id: candidate.id,
    entityType: candidate.entityType,
    rawScore: candidate.score,
    reasons: candidate.reasons,
    eligibleForNormalization: eligible,
    matchedTokenCount: tokens,
    surfaceSize: candidate.surfaceSize,
    divisor: eligible ? keywordSurfaceDivisor(candidate.surfaceSize) : 1,
    adjustedScore,
    delta: adjustedScore - candidate.score,
    note: eligible
      ? (adjustedScore === candidate.score
        ? `Surface size ${candidate.surfaceSize} is at or below the reference point (${KEYWORD_SURFACE_REFERENCE}) or the divisor rounded to 1 — no dampening applied.`
        : `Dampened from ${candidate.score} to ${adjustedScore.toFixed(1)} — surface size ${candidate.surfaceSize} exceeds the reference point, reducing this candidate's opportunity-to-match advantage. Never increased.`)
      : (ELIGIBLE_ENTITY_TYPES.has(candidate.entityType)
        ? 'Not eligible — winning score came from a higher tier (exact-id/alias/title or title-substring), which this module never touches.'
        : `Not eligible — entity type "${candidate.entityType}" is outside Phase 4.3's investigated/authorized scope (feature/workflow only).`),
  };
}

module.exports = {
  KEYWORD_SURFACE_REFERENCE,
  KEYWORD_SURFACE_DAMPING,
  ABSOLUTE_EVIDENCE_FLOOR_TOKENS,
  ELIGIBLE_ENTITY_TYPES,
  isPureKeywordOverlapTier,
  isEligibleForNormalization,
  matchedTokenCount,
  keywordSurfaceDivisor,
  adjustKeywordOverlapScore,
  explainCandidate,
};
