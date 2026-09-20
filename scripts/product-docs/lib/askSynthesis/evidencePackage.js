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

// Integration-readiness checkpoint (Phase 5, 2026-08-27) -- Knowledge
// Model evidence-shaping integration. Mirrors main/askAutoIngest.js's own
// PRODUCTION_DOWNLOAD_SOURCE_APPROVED precedent exactly: a single boolean
// gate, not a configuration system. OFF (the default, and this file's own
// exact behavior before this checkpoint) reproduces buildEvidenceAtoms()'s
// output byte-for-byte -- the Knowledge Model module is never required,
// never consulted, never on the hot path. ON tries the Knowledge Model
// FIRST for whatever feature/boundary/roadmap subject the (unmodified)
// deterministic authority layer already resolved; on a miss, or on ANY
// error (require failure, malformed record, anything), it falls back to
// the exact same existing atom extraction, unconditionally logged, never
// silently. The Knowledge Model can never make Ask AutoIngest unavailable.
//
// Deliberately reads `answer.classification` (already computed by
// knowledgeEngine.js's own answerQuestion(), already returned on the
// `answer` object this file already threads through everywhere) rather
// than importing lib/questionClassifier.js directly -- this file's own
// long-standing Phase A directive (see header comment above) is that it
// never touches questionClassifier.js; reusing the already-computed
// classification honors that unmodified while still giving the Knowledge
// Model's dimension selection exactly the same question-type signal.
const KNOWLEDGE_MODEL_EVIDENCE_ENABLED = true;

function knowledgeModelAtomsFor(answer, question) {
  if (!KNOWLEDGE_MODEL_EVIDENCE_ENABLED) return null;
  try {
    const { resolveKnowledgeEvidenceAtoms } = require('../knowledgeModel/retrieval');
    const result = resolveKnowledgeEvidenceAtoms({ answer, questionType: answer.classification, userText: question });
    if (!result) return null;
    // eslint-disable-next-line no-console
    console.log(`[evidencePackage] Knowledge Model evidence used: ${result.kmRecordId} (${result.extractionTier}) dims=${result.dimensionsUsed.join(',')}`);
    return result;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[evidencePackage] Knowledge Model evidence lookup failed -- falling back to deterministic atom extraction:', err && err.message);
    return null;
  }
}

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

// Final acceptance checkpoint (2026-08-24): independently discovered
// duplication bug, mechanical, not a QMZ special case. The original
// version only stripped the "Title (ID)" ordering (the common
// answerFromGovernanceRecord()/sourcesForRecord() citation shape). A
// SECOND, equally real ordering exists elsewhere in this codebase's own
// prose construction -- e.g. knowledgeEngine.js's companion-workflow
// guidance template, `See ${companionWorkflow.id} (${companionWorkflow.title})
// for step-by-step instructions.` -- "ID (Title)", the reverse order. Left
// unhandled, the ID-then-title case fell through to the bare-ID
// substitution pass below, which replaced the ID with its OWN display
// name while the identical title already sat right next to it in
// parentheses -- producing a literal duplicate ("Sort QMZ Photographs
// (Sort QMZ Photographs)..."). Handled first, as its own pass, so by the
// time the "Title (ID)" pass and the bare-ID fallback run, this ordering
// is already gone.
const ID_THEN_PAREN_RE = /\b(AI-FEAT-\d+|AI-WF-\d+|AI-RM-\d+|DEC-\d+|BUG-\d+|PM-\d+|AI-MEM-\d+)\s*\(([^()]+)\)/g;

function sanitizeIdsInProse(text, ctx) {
  if (typeof text !== 'string' || !text) return text;
  return text
    // "AI-FEAT-007 (Title)" -> "Title" -- ID-then-title ordering. See this
    // constant's own header comment above for why this must run first.
    .replace(ID_THEN_PAREN_RE, (_match, _id, paren) => paren)
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

// Final answer-quality checkpoint (2026-08-24), Product Owner-authorized
// structural evidence separation. Forensic trace (this checkpoint, before
// any code change): the corpus's own "## Summary" section, for 25 of 58
// feature records, contains the operator-facing capability description and
// a "**Why this exists**"-led historical/provenance narrative -- verified
// directly in the canonical Markdown (e.g.
// docs/product/features/AI-FEAT-047_QMZ_SEQUENCING_WORKSPACE.md's own
// Summary section carries both, as two paragraphs). parseProductDocs.js's
// extractSection('Summary') (unchanged) returns that whole section's raw
// text with its internal structure intact; knowledgeEngine.js's
// answerFromRecord() (unchanged, off-limits per prior Product Owner
// directive -- see this file's own top-of-file header) concatenates it
// whole into directAnswer. By the time evidencePackage.js sees
// answer.directAnswer, the "**Why this exists**" marker is still present
// verbatim in the string -- this function splits on it.
//
// The marker itself, not a blank-line paragraph break, is the split point:
// checked directly against the corpus (AI-FEAT-038 Transfer Export), the
// SAME "**Why this exists**" convention sometimes starts mid-paragraph,
// not always after a blank line -- a newline-based split would miss those
// records. The bolded marker string itself is the one genuinely general,
// consistently-authored signal (25/58 records, always exactly once).
//
// Deliberately NOT attempted: an equivalent split for TECHNICAL_IMPLEMENTATION
// detail (e.g. QMZ's own `qmzRoot`/`qmz-sequences.json`/IPC-surface
// mentions). Traced and confirmed: unlike the historical narrative, these
// terms are interleaved within the SAME sentence as the capability
// description, with no comparable structural marker anywhere in the
// corpus to split on. Attempting one would mean guessing at sentence
// boundaries or keyword lists -- exactly the brittle heuristic this
// checkpoint's own guidance rules out. Left to the existing (previous
// checkpoint's) prompt instruction to select around, which real-model
// testing already showed works reliably once the evidence isn't also
// carrying a large, separate provenance block.
const WHY_THIS_EXISTS_RE = /\*\*Why this exists\*\*/;

function splitCapabilityFromProvenance(text) {
  if (typeof text !== 'string' || !text) return { capability: text, provenance: null };
  const match = WHY_THIS_EXISTS_RE.exec(text);
  if (!match) return { capability: text, provenance: null };
  const capability = text.slice(0, match.index).trim();
  const provenance = text.slice(match.index).trim();
  // A record whose ENTIRE directAnswer is the provenance narrative (no
  // capability sentence precedes the marker) is not observed in the
  // corpus, but handled safely rather than assumed away: fall back to the
  // original full text as "capability" so a real capability description
  // is never silently dropped, and provenance is not extracted from
  // nothing.
  return capability ? { capability, provenance } : { capability: text, provenance: null };
}

// C8 corrective checkpoint (2026-08-24), Defect 2 — "atomic evidence
// synthesis". Forensic trace of the "Why this exists" blob produced by
// splitCapabilityFromProvenance() above (scanned across all 25 corpus
// records that carry the marker): 23/25 follow one further, equally
// consistent structural convention -- the marker is IMMEDIATELY followed
// by a parenthetical carrying evidentiary/citation metadata (capture date,
// "Known from project history; repository evidence pending", "Product-
// Owner Purpose Capture interview", cross-references to Decision records),
// then a colon, then the actual reasoning prose. E.g. AI-FEAT-038 Transfer
// Export: "**Why this exists** (*Known from project history; repository
// evidence pending* — captured during the Product-Owner Purpose Capture
// interview, 2026-08-14): before this capability existed, ...". The
// remaining 2/25 (AI-FEAT-026, AI-FEAT-034) simply have no such
// parenthetical -- marker directly followed by a colon and the reasoning
// prose, with nothing to extract. This function splits on that same
// reliable structural marker (parenthetical-after-marker, not a keyword
// list) into two DIFFERENT evidence roles that the original, single
// "historyProvenance" blob conflated: RATIONALE (the actual design/history
// reasoning -- legitimate content for Phi to draw on when a question
// genuinely asks "why") and PROVENANCE (the citation/evidence-qualification
// commentary itself -- never legitimate operator-facing content, under any
// question, which is exactly the "repository evidence pending"/"Purpose
// Capture interview" leakage the Product Owner's original Answer-Quality
// Hold flagged). When there is no parenthetical, provenance is simply
// null and rationale is the whole marker-stripped text -- nothing is lost,
// nothing is invented.
const WHY_THIS_EXISTS_PARENTHETICAL_RE = /^\*\*Why this exists\*\*\s*(?:\(([^()]*(?:\([^()]*\)[^()]*)*)\))?\s*:\s*/;

function splitRationaleFromProvenanceQualifier(whyThisExistsBlob) {
  if (typeof whyThisExistsBlob !== 'string' || !whyThisExistsBlob) return { rationale: null, provenanceQualifier: null };
  const m = WHY_THIS_EXISTS_PARENTHETICAL_RE.exec(whyThisExistsBlob);
  if (!m) return { rationale: whyThisExistsBlob, provenanceQualifier: null };
  const rationale = whyThisExistsBlob.slice(m[0].length).trim();
  const provenanceQualifier = m[1] ? m[1].trim() : null;
  return { rationale: rationale || whyThisExistsBlob, provenanceQualifier };
}

// C8 corrective checkpoint, Defect 2 — TECHNICAL evidence-atom extraction.
// Forensic trace (this checkpoint): the corpus's own Markdown consistently
// uses backtick inline-code spans to mark implementation-level identifiers
// -- file names, internal state/config keys, function names, module paths
// (`qmzRoot`, `qmz-sequences.json`, `_qmz*`, `event.json`, `BrowserWindow`,
// `services/telemetry.js`, etc.). Verified general, not a QMZ special
// case: 38 of 58 Feature records use this convention in their own Summary
// section alone. This is a real, pre-existing AUTHORING convention (how
// engineers who wrote these docs already mark "this is an implementation
// detail," not a heuristic invented for this checkpoint) -- extracting the
// backtick-delimited spans is a syntactic operation, not a guess at
// sentence or clause boundaries.
//
// Deliberately NOT attempted: surgically removing these spans from
// directAnswer's own prose to produce a "technical-free" FACT sentence.
// Traced directly against the source (AI-FEAT-047 QMZ's own Summary
// paragraph): the identifiers are grammatically embedded inside the SAME
// sentence as the capability description ("...with its own root
// (`qmzRoot`), durable state file (`qmz-sequences.json`)..., and its own
// IPC surface."), and "IPC surface" itself is not even backtick-wrapped --
// removing the backtick spans alone would leave broken punctuation without
// reliably removing every technical phrase, and papering over the gap with
// additional keyword/phrase rules is exactly the brittle heuristic this
// checkpoint's guidance rules out. Reported rather than forced: directAnswer
// is therefore left completely untouched (still whole, ungrounded-risk-free
// -- it's real corpus prose) and extraction here is ADDITIVE ONLY, used for
// two things -- (1) making a genuine implementation identifier available
// as its own explicitly-labeled TECHNICAL evidence atom rather than
// invisible plain text and (2) letting safetyValidation.js's leak check
// verify a synthesized answer never reproduces a real, this-record's-own
// technical identifier, exactly the same "compare output against something
// derived from the evidence package itself, never a hardcoded vocabulary"
// pattern already proven for ID/handle/provenance leak checks. This is the
// second, structural layer of defense (selection-time: TECHNICAL atoms are
// never offered to Phi at all, see selectEvidenceAtomsForClassification()
// below) validation-time leak detection is the backstop for when a raw
// identifier is copied from directAnswer despite BASE_CONTRACT rule 4's
// instruction not to.
const INLINE_CODE_RE = /`([^`]+)`/g;

function extractTechnicalAtoms(text, sourceId, sourceField) {
  if (typeof text !== 'string' || !text) return [];
  const seen = new Set();
  const atoms = [];
  let m;
  INLINE_CODE_RE.lastIndex = 0;
  while ((m = INLINE_CODE_RE.exec(text))) {
    const token = m[1].trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    atoms.push({ role: 'TECHNICAL', text: token, sourceId: sourceId || null, sourceField });
  }
  return atoms;
}

// The single, general atomic-evidence builder — every evidence atom this
// system produces, of any role, is built here, from already-computed
// package fields, so buildEvidencePackage() and
// buildEvidencePackageForKnownRecord() both get identical atom-construction
// behavior without duplicating it. Deliberately does NOT re-derive
// anything from raw Markdown itself -- every atom traces back to a field
// this file already computed (directAnswer capability/provenance split,
// guidance, steps, limitations), so there is exactly one place a new
// canonical field would need to be wired in.
function buildEvidenceAtoms({ directAnswerCapability, directAnswerProvenanceBlob, guidance, steps, limitations, primaryId }) {
  const atoms = [];
  if (directAnswerCapability) {
    atoms.push({ role: 'FACT', text: directAnswerCapability, sourceId: primaryId || null, sourceField: 'directAnswer' });
    atoms.push(...extractTechnicalAtoms(directAnswerCapability, primaryId, 'directAnswer'));
  }
  if (guidance) {
    atoms.push({ role: 'FACT', text: guidance, sourceId: primaryId || null, sourceField: 'guidance' });
  }
  for (const s of steps || []) {
    atoms.push({ role: 'ACTION', text: s.text, sourceId: s.sourceId || primaryId || null, sourceField: `steps[${s.index}]` });
  }
  for (const [i, l] of (limitations || []).entries()) {
    atoms.push({ role: 'LIMITATION', text: l, sourceId: primaryId || null, sourceField: `limitations[${i}]` });
  }
  if (directAnswerProvenanceBlob) {
    const { rationale, provenanceQualifier } = splitRationaleFromProvenanceQualifier(directAnswerProvenanceBlob);
    if (rationale) atoms.push({ role: 'RATIONALE', text: rationale, sourceId: primaryId || null, sourceField: 'whyThisExists:rationale' });
    if (provenanceQualifier) atoms.push({ role: 'PROVENANCE', text: provenanceQualifier, sourceId: primaryId || null, sourceField: 'whyThisExists:provenanceQualifier' });
  }
  return atoms;
}

// Question-relevant, classification-driven selection -- general (a rule
// keyed on the SAME classification enum questionClassifier.js/
// knowledgeEngine.js already produce for every question, not a per-question
// or per-record special case) not a per-question rule. FACT/ACTION/
// LIMITATION are always offered -- the operator-facing "what/how/watch-out"
// atoms every question type already relies on today via directAnswer/
// steps/limitations. RATIONALE (the "why this exists" reasoning) is
// offered ONLY for classifications where a "why"/background question is
// plausible -- EXPLANATION and UNKNOWN already carry this exact
// instruction in promptTemplates.js's own TYPE_GUIDANCE (kept in sync,
// not duplicated logic -- this is that same intent enforced structurally
// instead of only by prompt wording); KNOWN_RECORD_BROWSE (Related-topic
// browsing) is added because its own guidance text already asks Phi to
// explain "why an operator would use it". TECHNICAL and PROVENANCE atoms
// are NEVER selected for any classification -- there is no question type
// in this system representing a genuine "explain your internal
// implementation" question, so there is no classification under which
// offering them would be correct; they remain in the full evidenceAtoms
// list purely for inspectability and as the source safetyValidation.js's
// leak check compares against.
const RATIONALE_ELIGIBLE_CLASSIFICATIONS = new Set(['EXPLANATION', 'UNKNOWN', 'KNOWN_RECORD_BROWSE']);

function selectEvidenceAtomsForClassification(atoms, classification) {
  return (atoms || []).filter((a) => {
    if (a.role === 'FACT' || a.role === 'ACTION' || a.role === 'LIMITATION') return true;
    if (a.role === 'RATIONALE') return RATIONALE_ELIGIBLE_CLASSIFICATIONS.has(classification);
    return false; // TECHNICAL, PROVENANCE: never offered to synthesis
  });
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

  const { capability: directAnswerCapability, provenance: directAnswerProvenance } = splitCapabilityFromProvenance(sanitizeIdsInProse(answer.directAnswer, ctx));
  const sanitizedGuidance = sanitizeIdsInProse(answer.guidance, ctx);
  const sanitizedLimitations = (answer.limitations || []).map((l) => sanitizeIdsInProse(l, ctx));
  const steps = structuredStepsFor(
    primary && primary.entityType === 'workflow' ? primary.id : (answer.sources.find((s) => /^AI-WF-/.test(s.id)) || {}).id,
    ctx,
  );
  const deterministicAtoms = buildEvidenceAtoms({
    directAnswerCapability,
    directAnswerProvenanceBlob: directAnswerProvenance,
    guidance: sanitizedGuidance,
    steps,
    limitations: sanitizedLimitations,
    primaryId: primary && primary.id,
  });
  // Knowledge Model evidence, tried first (Phase 5 integration -- see
  // KNOWLEDGE_MODEL_EVIDENCE_ENABLED above). Only ever replaces WHAT FACTS
  // ARE OFFERED to synthesis -- every other field below (primary,
  // capabilityStatus, matchQuality, retrievalDiagnostics,
  // admittedNeighborhood, historical, relatedCapabilities, sources,
  // deterministicFallback, legitimateSourceIds) is computed exactly as it
  // always was, from the unmodified deterministic answer, regardless of
  // whether the Knowledge Model covers this subject. On no coverage or any
  // error, `kmResult` is null and `evidenceAtoms` is byte-identical to
  // this file's own pre-Phase-5 behavior.
  const kmResult = knowledgeModelAtomsFor(answer, question);
  const evidenceAtoms = kmResult ? kmResult.atoms : deterministicAtoms;
  const knowledgeModelSource = kmResult
    ? { used: true, kmRecordId: kmResult.kmRecordId, extractionTier: kmResult.extractionTier, dimensionsUsed: kmResult.dimensionsUsed }
    : { used: false, kmRecordId: null, extractionTier: null, dimensionsUsed: null };

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
    // deterministicFallback below carries the real, untouched prose.
    // Final answer-quality checkpoint (2026-08-24): directAnswer here is
    // now the capability-description portion ONLY -- see
    // splitCapabilityFromProvenance()'s own header comment above for the
    // forensic trace and why this split point, not a paragraph break, was
    // chosen. historyProvenance (new) carries the "**Why this exists**"
    // narrative separately, null when the record has none. This changes
    // ONLY what reaches the synthesis prompt (promptTemplates.js's sole
    // reader of evidencePackage.directAnswer) -- deterministicFallback
    // below is sourced independently from the raw, untouched answer
    // object and is completely unaffected, so the existing deterministic/
    // no-synthesis rendering path is byte-for-byte unchanged ----
    directAnswer: directAnswerCapability,
    historyProvenance: directAnswerProvenance,
    guidance: sanitizedGuidance,

    // ---- 5b. Atomic, role-typed evidence (C8 corrective checkpoint,
    // Defect 2). Every atom below traces back to one of the fields above
    // (never re-derived from raw Markdown) and carries its role (FACT/
    // ACTION/LIMITATION/TECHNICAL/RATIONALE/PROVENANCE), source record id,
    // and originating field -- see buildEvidenceAtoms()'s own header
    // comment for the forensic trace behind each role's construction.
    // `evidenceAtoms` is the FULL set (used by safetyValidation.js's leak
    // checks, which must see TECHNICAL/PROVENANCE atoms even though
    // synthesis never does); `selectedEvidenceAtoms` is what
    // promptTemplates.js actually offers to Phi, already filtered by
    // selectEvidenceAtomsForClassification()'s question-relevant,
    // classification-driven rule ----
    evidenceAtoms,
    selectedEvidenceAtoms: selectEvidenceAtomsForClassification(evidenceAtoms, answer.classification),

    // ---- 6. Structured Workflow steps (only populated when the primary,
    // or its companion, is a Workflow — resolved via relatedCapabilities/
    // sources, never guessed) ----
    steps,

    // ---- 7. Limitations / warnings, sanitized (see directAnswer note above)
    // ----
    limitations: sanitizedLimitations,

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

    // ---- Diagnostic-only (Phase 5 integration), same discipline as
    // `synthesis`/`authority` diagnostics elsewhere in this codebase --
    // never affects capabilityStatus/directAnswer/steps/limitations above,
    // which are already final by the time this runs. Lets a caller (e.g.
    // the production-transfer validation harness) see, per turn, whether
    // this answer's evidenceAtoms came from the Knowledge Model or the
    // pre-existing deterministic extraction ----
    knowledgeModelSource,

    // ---- 15. Deterministic fallback — a structured, operator-safe
    // projection of the exact answer the CLI/portal would show today. C8
    // corrective checkpoint (2026-08-24), Defect 2, Section H: directAnswer
    // here is the capability-description portion ONLY (directAnswerCapability
    // — the SAME split used above for the synthesis-facing directAnswer
    // field), never the raw answer.directAnswer, so a record whose Summary
    // carries a "**Why this exists** (repository evidence pending...)"
    // narrative never ships that provenance/citation commentary through
    // this path either — matching main/askAutoIngestPresentation.js's own
    // shapeAnswerForUI(), which applies the identical split to whatever
    // ships on the actual no-synthesis/refused/failed-validation path.
    // Less polished than a Phi-synthesized answer (still real corpus
    // prose, not rephrased), but safe and usable by construction ----
    deterministicFallback: {
      directAnswer: directAnswerCapability,
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
  const { capability: knownRecordDirectAnswer, provenance: knownRecordProvenance } = splitCapabilityFromProvenance(sanitizeIdsInProse(answer.directAnswer, ctx));
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
  const knownRecordClassification = answer.classification === 'CAPABILITY' ? 'KNOWN_RECORD_BROWSE' : answer.classification;
  const knownRecordGuidance = sanitizeIdsInProse(answer.guidance, ctx);
  const knownRecordLimitations = (answer.limitations || []).map((l) => sanitizeIdsInProse(l, ctx));
  const knownRecordSteps = structuredStepsFor(
    typeof companionWorkflowId === 'string' ? companionWorkflowId : (companionWorkflowId ? companionWorkflowId.id : null),
    ctx,
  );
  const knownRecordEvidenceAtoms = buildEvidenceAtoms({
    directAnswerCapability: knownRecordDirectAnswer,
    directAnswerProvenanceBlob: knownRecordProvenance,
    guidance: knownRecordGuidance,
    steps: knownRecordSteps,
    limitations: knownRecordLimitations,
    primaryId: primary && primary.id,
  });

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
    classification: knownRecordClassification,
    primary,
    capabilityStatus: answer.capabilityStatus,
    matchQuality: answer.matchQuality,
    confidence: answer.confidence,
    // Deliberately null, not recomputed -- see header comment above.
    retrievalDiagnostics: null,
    directAnswer: knownRecordDirectAnswer,
    historyProvenance: knownRecordProvenance,
    guidance: knownRecordGuidance,
    evidenceAtoms: knownRecordEvidenceAtoms,
    selectedEvidenceAtoms: selectEvidenceAtomsForClassification(knownRecordEvidenceAtoms, knownRecordClassification),
    steps: knownRecordSteps,
    limitations: knownRecordLimitations,
    // Bounded scope (see header comment) -- never populated for known-record browsing.
    admittedNeighborhood: [],
    visibleNotAdmitted: [],
    historical: emptyHistorical,
    relatedCapabilities: (answer.relatedCapabilities || []).map((id) => ({ id, displayName: displayNameFor(id, ctx) })),
    sources: describeSources(answer.sources, ctx),
    // See buildEvidencePackage()'s own deterministicFallback comment above
    // -- same operator-safe, provenance-excluded projection, same reason.
    deterministicFallback: {
      directAnswer: knownRecordDirectAnswer,
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
  splitCapabilityFromProvenance,
  splitRationaleFromProvenanceQualifier,
  extractTechnicalAtoms,
  buildEvidenceAtoms,
  selectEvidenceAtomsForClassification,
  buildEvidencePackageForAuthorityAnswer,
  buildEvidencePackageForKnownRecord,
};
