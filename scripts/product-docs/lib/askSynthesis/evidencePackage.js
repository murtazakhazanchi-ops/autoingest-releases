'use strict';

// Ask AutoIngest — Phase A (LLM synthesis investigation, Product Owner-
// authorized 2026-08-18). Purely additive: this module ONLY calls existing,
// unmodified knowledgeEngine.js exports (answerQuestion, explainNeighborhood,
// explainHistoricalContext, explainNormalization) and read-only ctx maps
// already built by buildEngineContext(). It reads zero private state, adds
// zero new fields to any existing record, and never touches lib/query.js,
// knowledgeSurfaceNormalization.js, questionClassifier.js, statusResolution.js,
// knowledgeHistoricalContext.js, knowledgeNeighborhood.js, or knowledgeEngine.js
// itself — all explicitly protected by prior Product Owner directive.
//
// Deliberately does NOT introduce a new confidence/refusal threshold (Product
// Owner clarification, 2026-08-18): the raw retrieval diagnostics
// (rawScore/adjustedScore/matchedTokenCount/tiedCount) are exposed here so the
// Phase A benchmark can evaluate safety conditions empirically against real
// corpus data, rather than this module guessing a boundary a priori.

const {
  answerQuestion,
  explainNeighborhood,
  explainHistoricalContext,
  explainNormalization,
} = require('../knowledgeEngine');

// A human-readable display name for any canonical ID this system knows about
// — Feature, Workflow, Decision, Bug, Postmortem, Memory, or Architecture
// section — resolved from the SAME already-built searchIndexById map every
// other cross-type lookup in this codebase already uses (knowledgeEngine.js's
// governanceRelationshipsForFeature, explainNeighborhood's reciprocal-citation
// check). Never invents a title; falls back to the bare ID only if truly
// unresolvable (defensive only — every ID reaching this function has already
// been validated to exist by the deterministic engine).
function displayNameFor(id, ctx) {
  if (!id) return null;
  const rec = ctx.searchIndexById ? ctx.searchIndexById.get(id) : null;
  if (rec && rec.title) return rec.title;
  const wf = ctx.workflowIndexById ? ctx.workflowIndexById.get(id) : null;
  if (wf && wf.title) return wf.title;
  const feat = ctx.knowledgeIndexById ? ctx.knowledgeIndexById.get(id) : null;
  if (feat && feat.title) return feat.title;
  return id; // last resort — no title anywhere; the ID itself, never fabricated prose
}

function pathFor(id, ctx) {
  const rec = ctx.searchIndexById ? ctx.searchIndexById.get(id) : null;
  return rec ? rec.canonical_path || null : null;
}

// Phase A.2 (Track 2.A follow-up finding, not anticipated at Phase A.2 design
// time): the deterministic engine's own free-text prose -- directAnswer,
// guidance, limitations -- routinely embeds raw IDs inline (e.g.
// answerFromGovernanceRecord()'s own "Context: this relates to X (AI-FEAT-007),
// which is AVAILABLE." construction, knowledgeEngine.js:360). The opaque-
// handle mechanism (sourceHandles.js) only covers STRUCTURED sourceIds
// fields -- it does nothing for free text the model is separately
// instructed to draw its "answer" from, so those IDs were still reaching
// the model's input verbatim and being faithfully reproduced. This is a
// pure, deterministic, regex-based text substitution applied ONLY to the
// copy of directAnswer/guidance/limitations that goes into the synthesis
// prompt -- it never touches lib/knowledgeEngine.js's own answer
// construction, and evidencePackage.deterministicFallback (sourced
// independently, directly from the real `answer` object) is completely
// unaffected -- what a human sees via the CLI/portal today is untouched.
const PROSE_ID_RE = /\b(AI-FEAT-\d+|AI-WF-\d+|AI-RM-\d+|DEC-\d+|BUG-\d+|PM-\d+|AI-MEM-\d+)\b/g;

function sanitizeIdsInProse(text, ctx) {
  if (typeof text !== 'string' || !text) return text;
  return text
    // "Title (AI-FEAT-007)" -> "Title" -- the common
    // answerFromGovernanceRecord()/sourcesForRecord() citation shape; the
    // human name almost always already precedes the parenthetical, so the
    // ID is pure redundancy for a reader who was never shown IDs at all
    .replace(/\s*\((AI-FEAT-\d+|AI-WF-\d+|AI-RM-\d+|DEC-\d+|BUG-\d+|PM-\d+|AI-MEM-\d+)\)/g, '')
    // any remaining bare occurrence (not already stripped above) ->
    // replaced with its real display name so the sentence stays readable
    // and no information is silently lost, only the opaque ID token
    .replace(PROSE_ID_RE, (id) => displayNameFor(id, ctx) || id);
}

// Raw retrieval diagnostics for the primary record and its closest
// competitors — reuses explainNormalization()'s existing, unmodified output
// (lib/knowledgeSurfaceNormalization.js's explainCandidate()) verbatim, sorted
// already by adjustedScore descending. Capped at the top 5 candidates: enough
// for a benchmark to see "how close was the next-best answer" without turning
// the evidence package into a full corpus dump.
function retrievalDiagnosticsFor(question, primaryId, ctx) {
  const all = explainNormalization(question, ctx.searchIndex);
  const top = all.slice(0, 5);
  const primary = all.find((c) => c.id === primaryId) || null;
  const tiedAtTop = all.length && primary ? all.filter((c) => c.rawScore === all[0].rawScore).length : 0;
  return {
    top5: top,
    primaryOwnDiagnostic: primary,
    tiedAtTopRawScore: tiedAtTop,
    totalCandidates: all.length,
  };
}

// Structured Workflow steps, each traceable back to the Workflow's own
// canonical ID (never re-authored, never split/merged from the real
// numbered list already parsed by lib/markdown.js's extractNumberedList()).
function structuredStepsFor(workflowId, ctx) {
  if (!workflowId || !ctx.workflowIndexById) return [];
  const wf = ctx.workflowIndexById.get(workflowId);
  if (!wf || !Array.isArray(wf.steps)) return [];
  // Phase A.2 follow-up (Track 2.A): a Workflow's own authored step text can
  // itself contain an inline ID citation (e.g. "...per AI-FEAT-031's audit
  // tab...") -- sanitized here for the same reason directAnswer/guidance/
  // limitations are (see sanitizeIdsInProse's own header comment). The
  // structured `sourceId` field (used to build the real handle, never shown
  // to the model as text) is completely unaffected.
  return wf.steps.map((text, i) => ({ index: i + 1, text: sanitizeIdsInProse(text, ctx), sourceId: workflowId }));
}

// A source entry, exactly as the deterministic answer already produced it —
// human display name added alongside the raw ID (both present; the LLM is
// instructed, not forced at this layer, to prefer displayName in prose — see
// promptTemplates.js and safetyValidation.js for the enforcement side).
function describeSources(sources, ctx) {
  return (sources || []).map((s) => ({
    id: s.id,
    displayName: displayNameFor(s.id, ctx),
    path: s.path || pathFor(s.id, ctx),
    role: s.role || null, // e.g. 'historical-context', otherwise absent — never invented
    evidenceQualification: s.evidenceQualification || null,
    note: s.note || null,
  }));
}

function describeNeighborhoodMembers(list, ctx) {
  return (list || []).map((m) => ({
    id: m.id,
    displayName: displayNameFor(m.id, ctx),
    role: m.role,
    materialAspect: m.materialAspect,
    canonicalRelationshipSource: m.canonicalRelationshipSource || null,
    source: m.source,
    reason: m.reason,
  }));
}

function describeHistorical(historical, ctx) {
  const describe = (list) => (list || []).map((h) => ({
    id: h.id,
    displayName: h.title || displayNameFor(h.id, ctx),
    type: h.type,
    role: h.role,
    path: h.path,
    materialAspect: h.materialAspect,
    evidenceQualification: h.evidenceQualification,
    groundingSource: h.groundingSource,
    reason: h.reason,
  }));
  return {
    historicalIntent: historical.historicalIntent,
    admitted: describe(historical.admitted),
    notAdmitted: describe(historical.notAdmitted),
    currentStatusAuthority: historical.currentStatusAuthority || null,
    note: historical.note || null,
    // unanchored (governance-primary / no-primary Decision-C fallback) is
    // diagnostic-only by explicit, standing Product Owner directive
    // (Part 3 Phase 5.3 materiality-safety closure) — it is exposed here for
    // benchmark/safety evaluation ONLY, and promptTemplates.js/
    // safetyValidation.js must never let it reach operator-facing prose. It
    // is intentionally kept structurally separate from `admitted` above.
    unanchoredDiagnosticOnly: historical.unanchored
      ? {
        historicalIntent: historical.unanchored.historicalIntent,
        candidateCount: (historical.unanchored.candidates || []).length,
        note: historical.unanchored.note || null,
      }
      : null,
  };
}

// The single public entry point. Returns a bounded, JSON-serializable
// evidence package for one question. Calls answerQuestion() exactly once
// directly, plus once each inside explainNeighborhood()/
// explainHistoricalContext() (those wrappers always recompute internally —
// a known, accepted redundancy for Phase A; see the Phase A report's
// Performance section for why this was not "fixed" by touching
// knowledgeEngine.js, which remains off-limits).
function buildEvidencePackage(question, ctx) {
  const answer = answerQuestion(question, ctx);
  const primary = answer.matchedCapabilities[0] || null;

  const neighborhood = explainNeighborhood(question, ctx);
  const historical = explainHistoricalContext(question, ctx);

  const retrieval = primary ? retrievalDiagnosticsFor(question, primary.id, ctx) : null;

  return {
    // ---- 1. User question + classification ----
    question: answer.query,
    classification: answer.classification,

    // ---- 2. Primary record: human name + internal ID kept side by side ----
    primary: primary
      ? {
        id: primary.id,
        displayName: primary.title || displayNameFor(primary.id, ctx),
        entityType: primary.entityType,
        score: primary.score,
      }
      : null,

    // ---- 3. Capability status — deterministic, authoritative, never to be
    // second-guessed by the synthesis layer ----
    capabilityStatus: answer.capabilityStatus,
    matchQuality: answer.matchQuality,
    confidence: answer.confidence,

    // ---- 4. Raw retrieval diagnostics for empirical safety evaluation
    // (Product Owner clarification: no threshold baked in here) ----
    retrievalDiagnostics: retrieval,

    // ---- 5. Authoritative direct facts (the deterministic engine's own
    // prose — the ONE thing synthesis is allowed to rephrase, never
    // contradict). Sanitized of raw IDs (Phase A.2 follow-up finding) —
    // deterministicFallback below carries the real, untouched prose ----
    directAnswer: sanitizeIdsInProse(answer.directAnswer, ctx),
    guidance: sanitizeIdsInProse(answer.guidance, ctx),

    // ---- 6. Structured Workflow steps (only populated when the primary,
    // or its companion, is a Workflow — resolved via relatedCapabilities/
    // sources, never guessed) ----
    steps: structuredStepsFor(
      primary && primary.entityType === 'workflow' ? primary.id : (answer.sources.find((s) => /^AI-WF-/.test(s.id)) || {}).id,
      ctx,
    ),

    // ---- 7. Limitations / warnings, sanitized (see directAnswer note above)
    // ----
    limitations: (answer.limitations || []).map((l) => sanitizeIdsInProse(l, ctx)),

    // ---- 8/9/10. Neighborhood: admitted members (with role + material
    // aspect) and visible-but-not-admitted members, kept structurally
    // distinct per Phase 5.2's own eligibility/materiality/admission model
    // — synthesis must never blur the two ----
    admittedNeighborhood: describeNeighborhoodMembers(neighborhood.admitted, ctx),
    visibleNotAdmitted: describeNeighborhoodMembers(neighborhood.notAdmitted, ctx),

    // ---- 11/12. Historical context — kept structurally separate from
    // current-state authority (currentStatusAuthority always names the
    // real capabilityStatus source) ----
    historical: describeHistorical(historical, ctx),

    // ---- 13. Related Feature/Workflow titles (human names alongside IDs)
    // ----
    relatedCapabilities: (answer.relatedCapabilities || []).map((id) => ({ id, displayName: displayNameFor(id, ctx) })),

    // ---- 14. Sources — id, displayName, path, role, evidenceQualification
    // ----
    sources: describeSources(answer.sources, ctx),

    // ---- 15. Deterministic fallback — the exact answer the CLI/portal
    // would show today, preserved byte-for-byte. This is what ships if
    // synthesis is unavailable, fails validation, or is refused (§4 of the
    // architecture investigation) ----
    deterministicFallback: {
      directAnswer: answer.directAnswer,
      guidance: answer.guidance,
      limitations: answer.limitations || [],
      capabilityStatus: answer.capabilityStatus,
      sources: describeSources(answer.sources, ctx),
    },

    // Every ID that legitimately appears anywhere in this package — the
    // single source of truth safetyValidation.js's post-hoc ID-existence
    // check validates a synthesized answer's own sourceIds against. Built
    // here, once, rather than re-derived ad hoc by every caller.
    legitimateSourceIds: Array.from(new Set([
      ...(primary ? [primary.id] : []),
      ...(answer.relatedCapabilities || []),
      ...(answer.sources || []).map((s) => s.id),
      ...neighborhood.admitted.map((m) => m.id),
      ...neighborhood.notAdmitted.map((m) => m.id),
      ...historical.admitted.map((h) => h.id),
      ...historical.notAdmitted.map((h) => h.id),
    ])),
  };
}

// Phase C5 — overlays the AUTHORITY-DECIDED capabilityStatus onto a fresh
// Phase A/A.2 evidence package. Deliberately re-runs buildEvidencePackage()
// rather than accepting a precomputed one: answerQuestion(question, ctx) is
// a pure function of its two arguments (build.js's assemble()/
// buildEngineContext() produce a fresh ctx per request -- see
// main/askAutoIngest.js's freshCtx()), so recomputing it here reproduces
// the EXACT SAME directAnswer/guidance/steps/limitations/primary that
// answerQuestionWithAuthority() itself started from -- this is the same
// "known, accepted redundancy" this file's own header comment already
// documents for explainNeighborhood()/explainHistoricalContext(). The one
// and only field capability authority can change is capabilityStatus
// itself (see capabilityAuthority.js's confirmAffirmative()/
// downgradeToUncertain() -- every other field on a CONFIRMED affirmative
// answer is untouched); overlaying it here, rather than threading the
// already-computed answer object through a rebuilt evidence package,
// keeps this module's only public surface change a one-line addition.
function buildEvidencePackageForAuthorityAnswer(question, authorityAnswer, ctx) {
  const pkg = buildEvidencePackage(question, ctx);
  return { ...pkg, capabilityStatus: authorityAnswer.capabilityStatus };
}

// Phase C5 — a deliberately MINIMAL evidence package for known-record
// (Related-topic) browsing. Does NOT call explainNeighborhood()/
// explainHistoricalContext() -- both internally call answerQuestion(question, ctx)
// a second time, and feeding either of them a record's own title as if it
// were operator-typed free text is exactly the synthetic-question pattern
// answerWithAuthority.js's own header comment documents being removed for
// causing a real Product Owner-reported acceptance failure (commit
// 9e088c8). Known-record browsing is bounded to the record's own already-
// resolved fields (directAnswer/guidance/steps/limitations/relatedCapabilities/
// sources) -- exactly what Section K of this checkpoint requires ("grounded
// solely in that known record and any explicitly permitted linked
// evidence"). `answer` is the result of answerForKnownRecord()/
// answerKnownRecordWithAuthority() -- the same answerFromRecord()/
// answerFromWorkflow() shape answerQuestion() itself produces, just
// resolved by id instead of by search.
function buildEvidencePackageForKnownRecord(answer, ctx) {
  const primaryMatch = answer.matchedCapabilities && answer.matchedCapabilities[0];
  const primary = primaryMatch
    ? {
      id: primaryMatch.id,
      displayName: primaryMatch.title || displayNameFor(primaryMatch.id, ctx),
      entityType: primaryMatch.entityType,
      score: primaryMatch.score,
    }
    : null;
  const companionWorkflowId = primary && primary.entityType === 'workflow'
    ? primary.id
    : (answer.sources || []).find((s) => /^AI-WF-/.test(s.id));

  const emptyHistorical = {
    historicalIntent: null, admitted: [], notAdmitted: [], currentStatusAuthority: null, note: null, unanchoredDiagnosticOnly: null,
  };

  return {
    question: answer.query,
    // Feature-primary known records are hardcoded QUESTION_TYPES.CAPABILITY
    // by answerForKnownRecord() (knowledgeEngine.js, unmodified) regardless
    // of how the record was reached -- correct for a real typed "does X
    // exist?" question, wrong for Related-topic BROWSING (there is no claim
    // being verified). Remapped to a dedicated synthesis-only guidance key
    // (promptTemplates.js's KNOWN_RECORD_BROWSE) -- this never changes
    // answer.classification itself, which the rest of the app (and
    // deterministicFallback below) never sees touched. Workflow-primary
    // known records already classify HOW_TO, which reads naturally for
    // browsing as-is and is left untouched.
    classification: answer.classification === 'CAPABILITY' ? 'KNOWN_RECORD_BROWSE' : answer.classification,
    primary,
    capabilityStatus: answer.capabilityStatus,
    matchQuality: answer.matchQuality,
    confidence: answer.confidence,
    // Deliberately null, not recomputed -- see header comment above.
    retrievalDiagnostics: null,
    directAnswer: sanitizeIdsInProse(answer.directAnswer, ctx),
    guidance: sanitizeIdsInProse(answer.guidance, ctx),
    steps: structuredStepsFor(
      typeof companionWorkflowId === 'string' ? companionWorkflowId : (companionWorkflowId ? companionWorkflowId.id : null),
      ctx,
    ),
    limitations: (answer.limitations || []).map((l) => sanitizeIdsInProse(l, ctx)),
    // Bounded scope (see header comment) -- never populated for known-record browsing.
    admittedNeighborhood: [],
    visibleNotAdmitted: [],
    historical: emptyHistorical,
    relatedCapabilities: (answer.relatedCapabilities || []).map((id) => ({ id, displayName: displayNameFor(id, ctx) })),
    sources: describeSources(answer.sources, ctx),
    deterministicFallback: {
      directAnswer: answer.directAnswer,
      guidance: answer.guidance,
      limitations: answer.limitations || [],
      capabilityStatus: answer.capabilityStatus,
      sources: describeSources(answer.sources, ctx),
    },
    legitimateSourceIds: Array.from(new Set([
      ...(primary ? [primary.id] : []),
      ...(answer.relatedCapabilities || []),
      ...(answer.sources || []).map((s) => s.id),
    ])),
  };
}

module.exports = {
  buildEvidencePackage,
  displayNameFor,
  sanitizeIdsInProse,
  buildEvidencePackageForAuthorityAnswer,
  buildEvidencePackageForKnownRecord,
};
