'use strict';

// AutoIngest Knowledge Engine — Phase C1: Semantic Authority Core
// Integration (Product Owner-authorized checkpoint, 2026-08-19). A narrow
// production decorator around the deterministic answerQuestion() result —
// never woven into retrieval/ranking/status-resolution internals, and never
// itself aware of any model runtime (no GGUF paths, no node-llama-cpp, no
// quantization, no download state -- those belong to a later checkpoint).
//
// Purpose: for the narrow, curated-boundary-respecting scope of questions
// where the deterministic engine's own AVAILABLE/PARTIALLY_AVAILABLE claim
// can be a lexical-retrieval-driven false affirmation (the RF-4.3-EXT-001
// family), semantic capability authority may CONFIRM that claim or
// DOWNGRADE it to uncertainty -- it may never upgrade a non-affirmative
// deterministic result into an affirmative one, structurally guaranteed by
// the scope predicate below only ever firing on an already-affirmative
// answer.
//
// The judge dependency is injected (see applyCapabilityAuthority's `judge`
// parameter) so this entire pipeline is provable in tests without loading
// any local model -- see test/capabilityAuthority.test.js.

const { RECORD_STATUS, QUERY_STATUS } = require('./statusResolution');
const { QUESTION_TYPES } = require('./questionClassifier');
const { normalizeClaim } = require('./askSynthesis/claimNormalization');
const { buildEntailmentEvidencePackage } = require('./askSynthesis/entailmentEvidencePackage');
const { resolveEntailmentAuthority } = require('./askSynthesis/entailmentAuthority');

const AUTHORITY_SENSITIVE_TYPES = new Set([QUESTION_TYPES.CAPABILITY, QUESTION_TYPES.STATUS]);
const AFFIRMATIVE_STATUSES = new Set([RECORD_STATUS.AVAILABLE, RECORD_STATUS.PARTIALLY_AVAILABLE]);
// Mirrors knowledgeEngine.js's own inline GOVERNANCE_TYPES set exactly (that
// set isn't exported; duplicated here rather than exported+imported to
// avoid coupling this module to knowledgeEngine.js's internals -- this is
// the entityType vocabulary lib/query.js's searchIndex already assigns,
// stable across the whole engine, not knowledgeEngine.js-specific).
const GOVERNANCE_ENTITY_TYPES = new Set(['bug', 'decision', 'postmortem']);

// 'feature' | 'governance' | null (workflow-primary or unrecognized --
// authority never applies to either; a Workflow's capabilityStatus is
// hardcoded AVAILABLE by existing, separately-reasoned design and is
// deliberately not re-litigated here without new evidence it needs to be).
function primaryAuthorityKind(answer) {
  const primary = answer && answer.matchedCapabilities && answer.matchedCapabilities[0];
  if (!primary) return null;
  if (primary.entityType === 'feature') return 'feature';
  if (GOVERNANCE_ENTITY_TYPES.has(primary.entityType)) return 'governance';
  return null;
}

// The exact, narrow, approved scope (Phase B design, Phase C1 Product Owner
// decision #2) -- do not broaden. All four conditions required:
//   1. classification (qType) is CAPABILITY or STATUS;
//   2. the primary record is Feature or Governance (never Workflow);
//   3. deterministic capabilityStatus is already AVAILABLE or
//      PARTIALLY_AVAILABLE (never a non-affirmative status -- this is what
//      structurally prevents authority from ever "upgrading" an answer);
//   4. no curated boundary already resolved the question (matchQuality
//      'boundary' is boundaryAnswer()'s own, already-existing marker in
//      knowledgeEngine.js -- curated boundary answers are always
//      NOT_SUPPORTED anyway, so condition 3 alone already excludes them;
//      this check is kept explicit for defense-in-depth and readability,
//      matching entailmentAuthority.js's own "boundary always wins, checked
//      first" discipline).
function shouldApplyCapabilityAuthority(answer) {
  if (!answer) return false;
  if (!AUTHORITY_SENSITIVE_TYPES.has(answer.classification)) return false;
  if (answer.matchQuality === 'boundary') return false;
  if (!AFFIRMATIVE_STATUSES.has(answer.capabilityStatus)) return false;
  return primaryAuthorityKind(answer) !== null;
}

// Product Owner decision #16: never expose the raw deterministic
// AVAILABLE/PARTIALLY_AVAILABLE claim to a normal operator for an
// authority-sensitive question merely because semantic authority couldn't
// confirm it (unavailable, timed out, malformed output, unmatched claim,
// or a valid non-supporting judgment). One honest, non-fabricating,
// deterministic hedge sentence -- never a per-case invented explanation.
const UNVERIFIED_HEDGE = 'AutoIngest\'s documentation includes a related, implemented capability, but this specific claim could not be independently verified with high confidence, so it is reported as uncertain rather than confirmed.';

function baseAuthorityDiagnostic(answer) {
  return {
    required: false,
    ran: false,
    deterministicCapabilityStatus: answer.capabilityStatus,
    finalCapabilityStatus: answer.capabilityStatus,
    authoritySource: null,
    judgment: null,
    confidence: null,
    evidenceHandles: [],
    fallbackReason: null,
    evidenceItemCount: null,
    evidenceCharCount: null,
  };
}

function downgradeToUncertain(answer, fallbackReason, extra) {
  return {
    ...answer,
    capabilityStatus: QUERY_STATUS.UNKNOWN,
    directAnswer: UNVERIFIED_HEDGE,
    guidance: null,
    steps: null,
    whereToGo: null,
    confidence: 0,
    authority: {
      required: true,
      ran: !!(extra && extra.ran),
      deterministicCapabilityStatus: answer.capabilityStatus,
      finalCapabilityStatus: QUERY_STATUS.UNKNOWN,
      authoritySource: (extra && extra.authoritySource) || null,
      judgment: (extra && extra.judgment) || null,
      confidence: (extra && extra.confidence) || null,
      evidenceHandles: (extra && extra.evidenceHandles) || [],
      fallbackReason,
      evidenceItemCount: (extra && extra.evidenceItemCount) != null ? extra.evidenceItemCount : null,
      evidenceCharCount: (extra && extra.evidenceCharCount) != null ? extra.evidenceCharCount : null,
    },
  };
}

function confirmAffirmative(answer, finalCapabilityStatus, extra) {
  return {
    ...answer,
    capabilityStatus: finalCapabilityStatus,
    authority: {
      required: true,
      ran: true,
      deterministicCapabilityStatus: answer.capabilityStatus,
      finalCapabilityStatus,
      authoritySource: extra.authoritySource,
      judgment: extra.judgment,
      confidence: extra.confidence,
      evidenceHandles: extra.evidenceHandles,
      fallbackReason: null,
      evidenceItemCount: extra.evidenceItemCount,
      evidenceCharCount: extra.evidenceCharCount,
    },
  };
}

// judge: async (pkg, handleMap) => { judgment, evidenceHandles, confidence }
// -- or throws. This is the ENTIRE production judge interface; nothing
// about how a real implementation would obtain that object (a local model,
// a stub, a fixture) is visible to or assumed by this module. C1 ships no
// real implementation -- see test/capabilityAuthority.test.js for injected
// fake/stub judges proving every branch of this pipeline without a model.
async function applyCapabilityAuthority(question, answer, ctx, judge) {
  if (!shouldApplyCapabilityAuthority(answer)) {
    return { ...answer, authority: baseAuthorityDiagnostic(answer) };
  }

  const { claim, method } = normalizeClaim(question);
  if (method === 'unmatched') {
    // Part F: an authority-sensitive question whose claim couldn't be
    // deterministically extracted must not silently keep the old
    // affirmative result -- and must not be judged against a guessed or
    // decomposed claim either (no LLM extraction, no decomposition, per
    // explicit instruction). The judge is never even invoked.
    return downgradeToUncertain(answer, 'claim-unmatched', { ran: false });
  }

  const { pkg, handleMap } = buildEntailmentEvidencePackage(question, claim, answer, ctx, { level: 'summary+body' });
  const evidenceItemCount = pkg.evidence.length;
  const evidenceCharCount = pkg.evidence.reduce((sum, e) => sum + (e.text ? e.text.length : 0), 0);

  let judgeResult = null;
  let judgeError = null;
  try {
    judgeResult = await judge(pkg, handleMap);
  } catch (err) {
    judgeError = err && err.message ? err.message : String(err);
  }

  const authority = resolveEntailmentAuthority({ curatedBoundary: pkg.curatedBoundary, judgeResult, judgeError, handleMap });
  const extra = {
    ran: true,
    authoritySource: authority.authoritySource,
    judgment: judgeResult ? judgeResult.judgment : null,
    confidence: judgeResult ? judgeResult.confidence : null,
    evidenceHandles: authority.validatedEvidenceHandles || [],
    evidenceItemCount,
    evidenceCharCount,
  };

  if (authority.finalStatus === 'AVAILABLE') {
    // Part J: a valid SUPPORTS confirms the CLAIM -- it does not rewrite
    // the Feature's own lifecycle status. Deliberately NOT changing
    // resolveEntailmentAuthority()'s own AVAILABLE-collapsing return value
    // (bench/'s gold-space benchmark mapping still relies on it exactly as
    // proven across two full checkpoints) -- this is a decorator-only,
    // product-semantics refinement layered on top of that unchanged
    // contract.
    const finalCapabilityStatus = answer.capabilityStatus === RECORD_STATUS.PARTIALLY_AVAILABLE
      ? RECORD_STATUS.PARTIALLY_AVAILABLE
      : RECORD_STATUS.AVAILABLE;
    return confirmAffirmative(answer, finalCapabilityStatus, extra);
  }

  // Every other authority.finalStatus (UNKNOWN, or NOT_SUPPORTED via the
  // curated-boundary branch reused defensively -- unreachable today since
  // condition 4 of the scope predicate already excludes boundary-resolved
  // answers, but kept for defense-in-depth) is a downgrade from the
  // pre-authority affirmative status, never an upgrade -- Product Owner
  // decision #4.
  return downgradeToUncertain(answer, authority.authoritySource, extra);
}

module.exports = {
  shouldApplyCapabilityAuthority,
  applyCapabilityAuthority,
  primaryAuthorityKind,
  UNVERIFIED_HEDGE,
};
