'use strict';

// scripts/product-docs/lib/answerWithSynthesis.js — Phase C5. The ONE
// production outer entrypoint layering LLM answer SYNTHESIS on top of the
// existing, unmodified answerWithAuthority.js. Mirrors that file's own
// discipline exactly: this module adds no new authority/eligibility RULES
// beyond askSynthesis/synthesisEligibility.js (itself new, but a pure,
// deterministic, fully-tested function of the already-decided answer); it
// only wires already-committed pieces together and never mutates its input.
//
// Pipeline (checkpoint Section A):
//   answerQuestionWithAuthority() / answerKnownRecordWithAuthority()  [unchanged]
//     -> VERIFIED FACTUAL ANSWER STATE (capabilityStatus is now immutable)
//     -> evaluateSynthesisEligibility()                                [new, deterministic]
//     -> (if eligible) bounded evidence package                       [askSynthesis/evidencePackage.js]
//     -> local Phi-4-mini synthesis                                   [injected synthesizer]
//     -> strict safety/schema validation                              [askSynthesis/safetyValidation.js, inside the adapter]
//     -> merge into the answer, OR fall back to the untouched answer on ANY failure
//
// Failure behavior (Section N): every synthesis failure mode -- ineligible,
// model unavailable, timeout, cancellation, malformed JSON, schema-invalid
// output, fabricated handle, status mismatch, safety-validation failure --
// is caught by the single try/catch in trySynthesize() below and always
// resolves to `{ applied: false, reason }` with the ORIGINAL authority-
// resolved answer object returned completely unchanged. Synthesis can only
// ever ADD a more natural directAnswer/steps/limitations; it can never be
// the reason Ask AutoIngest fails to answer.
//
// capabilityStatus IMMUTABILITY (Section D): structurally enforced twice --
// safetyValidation.js's checkCapabilityStatusMatches() rejects any candidate
// whose capabilityStatus differs from the evidence package's own (already-
// authority-decided) value, AND mergeSynthesizedAnswer() below never even
// reads the model's capabilityStatus field, only the answer's own.

const { answerQuestionWithAuthority, answerKnownRecordWithAuthority } = require('./answerWithAuthority');
const { evaluateSynthesisEligibility } = require('./askSynthesis/synthesisEligibility');
const { assessPrimaryFit } = require('./askSynthesis/retrievalConfidence');
const { buildEvidencePackageForAuthorityAnswer, buildEvidencePackageForKnownRecord } = require('./askSynthesis/evidencePackage');
const { productionSynthesize } = require('../../../services/localJudge/synthesisService');

// A synthesized `refused` candidate (schema-permitted: "the evidence is
// insufficient to answer at all") is not a failure -- it is the model
// correctly declining, exactly as instructed by promptTemplates.js's
// BASE_CONTRACT item 7. Treated identically to any other non-applied case:
// the deterministic/authority answer ships untouched.
function mergeSynthesizedAnswer(answer, resolved) {
  if (resolved.refused) {
    return { ...answer, synthesis: { applied: false, reason: 'model-refused' } };
  }
  return {
    ...answer,
    directAnswer: resolved.answer,
    // guidance/expectedResult/whereToGo are superseded by the synthesized
    // answer+steps (which already restate their content in natural
    // language) -- left in place, they would reintroduce raw documentation-
    // style prose right alongside the polished synthesized text. The one
    // exception is historicalNote (Track 2.B's structurally-gated field):
    // a genuinely separate "how this came to be" note, never a restatement
    // of current-state guidance, so it is the ONLY thing allowed to become
    // the new guidance value.
    guidance: resolved.historicalNote || null,
    expectedResult: null,
    whereToGo: null,
    steps: (resolved.steps || []).map((s) => s.text),
    limitations: (resolved.warnings || []).map((w) => w.text),
    synthesis: { applied: true, reason: null },
  };
}

// Shared by both entrypoints below. `buildPkg` is a zero-arg closure so
// this function never needs to know whether it's building a free-text-
// question package or a known-record package. `primaryFit` (Phase C5.1,
// Section K/L): the retrieval-confidence result for the free-text path, or
// `null` for the known-record path -- see answerKnownRecordWithSynthesis's
// own comment for why that path never computes one at all.
async function trySynthesize(answer, buildPkg, options, primaryFit) {
  const eligibility = evaluateSynthesisEligibility(answer, primaryFit);
  if (!eligibility.eligible) {
    return { ...answer, synthesis: { applied: false, reason: eligibility.reason } };
  }
  const synthesizer = options.synthesize || productionSynthesize;
  try {
    const pkg = buildPkg();
    const resolved = await synthesizer(pkg, { signal: options.signal });
    return mergeSynthesizedAnswer(answer, resolved);
  } catch (err) {
    // Every synthesis failure mode this checkpoint's Section N enumerates
    // lands here as a rejected promise (see synthesisAdapter.js/
    // synthesisService.js's own header comments) -- never rethrown, never
    // shown to the operator. `reason` is diagnostic-only (technicalDetails),
    // never operator-facing prose.
    const reason = err && err.message ? err.message : String(err);
    return { ...answer, synthesis: { applied: false, reason: `synthesis-error: ${reason}` } };
  }
}

// answerQuestionWithSynthesis(question, ctx, options) -> Promise<answer>
//   options.judge / options.getModelAvailability - forwarded to
//     answerQuestionWithAuthority() unchanged (tests only)
//   options.synthesize   - override the production synthesizer (tests only)
//   options.signal       - cancellation, forwarded to BOTH the judge call
//     (via answerQuestionWithAuthority, unchanged) and the synthesis call
async function answerQuestionWithSynthesis(question, ctx, options = {}) {
  const answer = await answerQuestionWithAuthority(question, ctx, options);
  // Phase C5.1, Section K: retrieval-confidence is defense-in-depth,
  // computed from the SAME already-decided answer/ctx -- never a second
  // retrieval pass -- and folded into the same eligibility decision
  // alongside the existing status/matchQuality checks.
  const primaryFit = assessPrimaryFit(question, answer, ctx);
  return trySynthesize(answer, () => buildEvidencePackageForAuthorityAnswer(question, answer, ctx), options, primaryFit);
}

// answerKnownRecordWithSynthesis(recordId, ctx, options) -> Promise<answer|null>
// Returns null (never throws), matching answerKnownRecordWithAuthority()'s
// own contract, when recordId doesn't resolve to a known record.
async function answerKnownRecordWithSynthesis(recordId, ctx, options = {}) {
  const answer = await answerKnownRecordWithAuthority(recordId, ctx);
  if (!answer) return null;
  // Phase C5.1, Section L: a Related capsule resolves a KNOWN record id
  // directly and deliberately bypasses fuzzy retrieval -- primaryFit is
  // never computed for this path (not "computed and found SAFE" --
  // structurally never asked, exactly as the checkpoint requires).
  return trySynthesize(answer, () => buildEvidencePackageForKnownRecord(answer, ctx), options, null);
}

// trySynthesize is also exported directly (Phase C8): the conversational
// orchestrator (conversationalAsk.js) needs to attempt synthesis on an
// answer/primaryFit pair it already computed for the clarification
// decision, without a second answerQuestionWithAuthority() retrieval pass
// -- reusing this exact function keeps eligibility/fallback/production-
// synthesizer-default behavior identical to the one-shot path rather than
// maintaining a second copy of it.
module.exports = { answerQuestionWithSynthesis, answerKnownRecordWithSynthesis, mergeSynthesizedAnswer, trySynthesize };
