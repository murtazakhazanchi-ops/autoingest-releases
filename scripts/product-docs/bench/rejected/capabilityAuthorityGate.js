'use strict';

// ============================================================================
// REJECTED EXPERIMENT — NOT PRODUCTION AUTHORITY LOGIC
// ============================================================================
// Relocated here (2026-08-19, SUPPORTS-recall checkpoint, Part 15) from
// lib/capabilityAuthorityGate.js -- this file was NEVER wired into
// answerQuestion() or any production caller, and must never be imported by
// one. It is preserved as evidence of a real, tested, and REJECTED
// candidate fix, not as usable code.
//
// WHY IT WAS TESTED: after Phase A.2's synthesis benchmark found 9/17
// adversarial fictitious-capability questions produced confident false
// AVAILABLE answers (both Feature-primary and Governance-primary), this
// title-token-overlap rule was investigated as the smallest deterministic
// post-retrieval authority gate that could close the gap without touching
// ranking.
//
// ADVERSARIAL IMPROVEMENT: closed 6/9 original + 13/18 expanded false
// positives, and 100% of the Governance-primary mechanism specifically,
// with zero regressions among 17 hand-picked positive controls.
//
// WHY IT WAS REJECTED: measured against the real, historically-validated
// V1+V2+V3 regression corpus (165 questions), it caused 23/165 (13.9%)
// regressions -- several of them documented, hard-won, previously-verified-
// correct answers (e.g. "Can I tell if a teammate is online right now?" ->
// AI-FEAT-027, explicitly marked "a genuine improvement, not a coincidence"
// in knowledgeTestCorpusV2.js) whose evidence lives in Summary/body prose
// using different vocabulary than the record's own title. Title-token
// overlap cannot distinguish "topically adjacent" from "specifically
// confirms" -- exactly the semantic distinction that motivated the
// subsequent Capability Entailment Judge investigation
// (lib/askSynthesis/entailment*.js), which superseded this approach.
//
// This file must never be imported by any production module. Kept for
// historical/evidentiary record only.
// ============================================================================
//
// Ask AutoIngest — Retrieval Safety Checkpoint (Product Owner-authorized
// 2026-08-18): "Unsupported-Capability Authority & False-Affirmation
// Closure". A deterministic, post-retrieval, pre-affirmation AUTHORITY GATE
// -- never a ranking change. Consumes the real, unmodified answerQuestion()
// output plus the same already-existing diagnostic seam
// (explainNormalization()) every other Part 3/4 investigation already
// trusts. Does NOT touch lib/query.js, knowledgeSurfaceNormalization.js,
// statusResolution.js, or knowledgeEngine.js's own ranking/selection logic
// -- this file may be composed AFTER answerQuestion() by any caller; it is
// NOT wired into answerQuestion(), knowledgeCli.js, or the portal server by
// this change. Wiring it in is a separate, explicit authorization step.
//
// GOVERNING PRINCIPLE (verbatim from the checkpoint brief): a record being
// lexically related to a question ("retrieval winning") is not the same
// claim as "the documentation establishes AutoIngest actually has this
// capability" ("capability existence"). An affirmative capabilityStatus
// (AVAILABLE / PARTIALLY_AVAILABLE) may only be rendered when the record
// actually GROUNDING that status -- the primary itself for a Feature-
// primary answer, or the CITED Feature for a Governance-primary answer --
// has a genuine, non-stopword correspondence with the question's own
// wording, not merely a coincidental overlap somewhere in its full body
// text.
//
// THE RULE, precisely (empirically derived and validated -- see the
// checkpoint's own pre-commit report for the full corpus-wide validation
// this rule was checked against before being proposed):
//
//   An affirmative status is allowed to stand UNCHANGED when EITHER:
//     (a) the winning match's own reasons (lib/query.js's existing,
//         unmodified tier vocabulary) include a tier STRONGER than bare
//         keyword-overlap/summary-substring -- exact-id, exact-alias,
//         exact-title, or title-substring. These tiers already mean the
//         query names the record specifically; no further check is needed
//         or invented.
//     (b) for a pure keyword-overlap/summary-substring match, the grounding
//         record's OWN canonical title shares at least one real,
//         non-stopword token with the question (using the exact same
//         keywordsFrom() tokenizer/STOPWORDS list every other part of this
//         codebase already uses -- no new tokenizer, no new stopword list).
//
//   Otherwise, the answer is downgraded: capabilityStatus -> UNKNOWN,
//   directAnswer replaced with an honest, non-fabricating hedge that names
//   what WAS found (so the operator isn't left with nothing) without
//   claiming the specific capability asked about is confirmed either way.
//
// WHY THIS IS NOT A RANKING REDESIGN: retrieval still runs, completely
// unchanged, and still picks whatever primary it would have picked before.
// This gate never changes WHICH record wins, never changes any score, and
// never changes a NOT_SUPPORTED/PLANNED/boundary answer (those are already
// either curated-boundary-grounded or the record's own Planned status --
// neither is the false-affirmation failure mode this gate exists for). It
// only intervenes on the narrow transition from "a record won retrieval" to
// "therefore state AVAILABLE" -- exactly the seam Part 2 of the checkpoint
// asked to be investigated first, before any ranking change was considered.

const { keywordsFrom } = require('../../lib/textKeywords');

const STRONG_TIERS = new Set(['exact-id', 'exact-alias', 'exact-title', 'title-substring']);
const GATED_STATUSES = new Set(['AVAILABLE', 'PARTIALLY_AVAILABLE']);

function titleTokenOverlap(question, title) {
  if (!title) return [];
  const qTokens = new Set(keywordsFrom(question));
  const titleTokens = new Set(keywordsFrom(title));
  return [...qTokens].filter((t) => titleTokens.has(t));
}

function hasStrongTier(reasons) {
  return (reasons || []).some((r) => STRONG_TIERS.has(r));
}

// Resolves the SPECIFIC record whose own canonical title must correspond to
// the question before an affirmative status is allowed to stand: the
// primary itself for a Feature-primary answer, or the cited Feature
// (answer.sources[1], per answerFromGovernanceRecord()'s own unmodified
// construction -- sources[0] is always the governance record itself,
// sources[1] is always the featureContext it borrowed status from) for a
// Governance-primary answer. Returns null for any other primary shape
// (Workflow-primary, roadmap, unknown) -- this gate is deliberately scoped
// to exactly the two mechanisms the checkpoint's adversarial corpus proved
// vulnerable; Workflow-primary's capabilityStatus is hardcoded AVAILABLE by
// existing, already-reasoned design (a Workflow is only ever authored for
// something that exists -- knowledgeEngine.js:277's own comment) and is
// deliberately NOT re-litigated here without new evidence it needs to be.
function groundingRecordFor(answer) {
  const primary = answer.matchedCapabilities[0];
  if (!primary) return null;
  if (primary.entityType === 'feature') return { id: primary.id, kind: 'feature-primary' };
  if (primary.entityType === 'workflow') return null; // out of scope, see comment above
  // Governance-primary (bug/decision/postmortem): the cited Feature is
  // always sources[1] in this shape -- verified directly against
  // answerFromGovernanceRecord()'s own construction, not assumed.
  const cited = (answer.sources || [])[1];
  if (!cited) return null;
  return { id: cited.id, kind: 'governance-primary', governanceId: primary.id };
}

// diagnosticCandidates: the SAME array explainNormalization()/searchCandidates()
// already compute for this exact question -- pass it in rather than
// re-querying, so this gate is provably a zero-new-retrieval-pass
// post-processing step, not a second search.
function applyCapabilityAuthorityGate(question, answer, diagnosticCandidates, ctx) {
  if (!GATED_STATUSES.has(answer.capabilityStatus)) {
    return { answer, gated: false, reason: 'status is not an affirmative claim this gate governs (NOT_SUPPORTED/PLANNED/UNKNOWN/ROADMAP boundary and Planned-status paths are already safely grounded by existing, separate mechanisms)' };
  }

  const grounding = groundingRecordFor(answer);
  if (!grounding) {
    return { answer, gated: false, reason: 'no Feature-primary or Governance-primary grounding record resolved (Workflow-primary or unrecognized shape) -- out of this gate\'s scope' };
  }

  const candidate = grounding.kind === 'feature-primary'
    ? diagnosticCandidates.find((c) => c.id === answer.matchedCapabilities[0].id)
    : null; // for governance-primary, the STRONG_TIERS exemption applies to the GOVERNANCE record's own match, checked separately below

  if (grounding.kind === 'feature-primary' && candidate && hasStrongTier(candidate.reasons)) {
    return { answer, gated: false, reason: `exact-id/exact-alias/exact-title/title-substring match on ${grounding.id} -- the query already names this record specifically` };
  }
  if (grounding.kind === 'governance-primary') {
    const govCandidate = diagnosticCandidates.find((c) => c.id === grounding.governanceId);
    if (govCandidate && hasStrongTier(govCandidate.reasons)) {
      return { answer, gated: false, reason: `exact-id/exact-alias/exact-title/title-substring match on the governance record ${grounding.governanceId} itself -- the query already names it specifically` };
    }
  }

  const groundingRec = ctx.searchIndexById ? ctx.searchIndexById.get(grounding.id) : null;
  const overlap = titleTokenOverlap(question, groundingRec ? groundingRec.title : null);
  if (overlap.length > 0) {
    return { answer, gated: false, reason: `question shares real title token(s) ${JSON.stringify(overlap)} with ${grounding.id} (${grounding.kind}) -- genuine, non-coincidental correspondence, not mere body-text overlap` };
  }

  // GATE FIRES: zero title-token correspondence between the question and the
  // record actually grounding the affirmative status. Downgrade honestly --
  // never silently, never with a fabricated boundary citation.
  const foundLabel = groundingRec ? groundingRec.title : grounding.id;
  const downgraded = {
    ...answer,
    capabilityStatus: 'UNKNOWN',
    matchQuality: 'none',
    directAnswer: `AutoIngest's documentation does not establish that this specific capability exists. The closest related documentation found was about "${foundLabel}", but its own title/name has no direct correspondence with what was asked, so this is reported honestly rather than presented as a confident yes.`,
    confidence: 0,
  };
  return {
    answer: downgraded,
    gated: true,
    reason: `zero title-token overlap between the question and ${grounding.id} (${grounding.kind}) -- the ${grounding.kind === 'governance-primary' ? 'governance record borrowed status from a Feature' : 'winning Feature'} it never actually names -- affirmative status downgraded to UNKNOWN`,
    groundingId: grounding.id,
    groundingKind: grounding.kind,
  };
}

module.exports = { applyCapabilityAuthorityGate, titleTokenOverlap, groundingRecordFor, hasStrongTier, STRONG_TIERS, GATED_STATUSES };
