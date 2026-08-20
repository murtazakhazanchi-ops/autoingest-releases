'use strict';

// AutoIngest Knowledge Engine — Phase C3: real semantic-authority wiring.
// The ONE production outer entrypoint connecting the existing, unmodified
// deterministic engine (answerQuestion()) to the existing, unmodified C1
// decorator (applyCapabilityAuthority()) and the existing, unmodified C2
// local judge runtime (services/localJudge/judgeService.js) -- this file
// adds no new authority RULES of its own; it only wires already-committed,
// already-tested pieces together and (a) resolves the production judge via
// judgeService's single authoritative construction path, and (b) attaches
// a diagnostic model-state snapshot alongside C1's own authority metadata,
// non-destructively.
//
// answerQuestion() itself is NOT converted to async (see this checkpoint's
// caller inventory in the C3 report for why: every current production
// caller -- knowledgeCli.js's `ask` command, knowledge-portal/server.js's
// /api/ask, and the internal diagnostic helpers in knowledgeEngine.js
// itself -- calls it synchronously and none required forcing a global
// async conversion). This module is a new, separate, opt-in async
// entrypoint; callers that want the deterministic-only result unchanged
// keep calling answerQuestion() exactly as before.

const { answerQuestion, answerForKnownRecord } = require('./knowledgeEngine');
const { applyCapabilityAuthority } = require('./capabilityAuthority');
// services/localJudge/* is side-effect-free at require time (Electron is
// only ever touched lazily, inside function bodies, by modelManager.js and
// runtime.js) -- safe to require eagerly here, including under plain
// `node` (CLI/tests), per those modules' own header comments.
const { productionJudge, getModelAvailability } = require('../../../services/localJudge/judgeService');

// Deterministic, non-LLM presentation utility (Part L). C1's own
// UNVERIFIED_HEDGE text (produced unconditionally by
// downgradeToUncertain() for every downgrade reason, per C1's Product
// Owner decision #16) remains the answer's authoritative `directAnswer`
// text, UNCHANGED here -- this function is a separate, optional, presentation-
// layer helper a FUTURE UI may choose to consult for a more specific
// secondary message when the reason is model unavailability specifically,
// rather than a genuine semantic non-confirmation. It is exported and
// tested but not applied to the answer object automatically, so it cannot
// alter C1's existing decorator output.
// Exact wording, Phase C4 Part H (Product Owner-specified copy) -- kept
// here, not paraphrased, so the Electron UI (main/askAutoIngestPresentation.js)
// and any future caller consulting this function always agree verbatim.
function describeAuthorityOutcome(authority) {
  if (!authority || !authority.required) return null;
  if (authority.ran && authority.modelState && authority.modelState !== 'READY') {
    return 'Capability verification is currently unavailable. You can still view the related documentation below.';
  }
  return null;
}

// answerQuestionWithAuthority(question, ctx, options) -> Promise<answer>
//   options.judge                 - override the production judge (tests only)
//   options.getModelAvailability  - override the availability check (tests only)
//
// Behavior:
//   - answerQuestion() always runs first, synchronously, unchanged, and its
//     result is never mutated (applyCapabilityAuthority() itself only ever
//     spreads a NEW object from it -- see lib/capabilityAuthority.js).
//   - For any question outside C1's narrow authority scope (curated
//     boundary, Workflow-primary, non-CAPABILITY/STATUS, or a
//     non-affirmative deterministic baseline), applyCapabilityAuthority()
//     returns immediately WITHOUT ever invoking the judge -- so this
//     wrapper never touches modelManager/runtime for those questions
//     either (the instrumented judge below is simply never called).
//   - Only for an in-scope question does the injected judge run, and only
//     then does it check real model availability (lazily, once).
async function answerQuestionWithAuthority(question, ctx, options = {}) {
  const answer = answerQuestion(question, ctx);

  const rawJudge = options.judge || productionJudge;
  const availabilityCheck = options.getModelAvailability || getModelAvailability;

  // options.signal (Part C4/E: renderer-initiated cancellation) -- C1's
  // applyCapabilityAuthority(question, answer, ctx, judge) calls judge with
  // exactly two arguments (pkg, handleMap); it has no signal parameter of
  // its own and is never modified here. The signal is captured in this
  // closure and forwarded as a THIRD argument on the call to rawJudge,
  // which judgeAdapter.js's judge(pkg, handleMap, {signal}) (unchanged
  // since C2) already accepts and threads into runtime.infer({..., signal}).
  const signal = options.signal;

  // Captures the model-state snapshot AT THE MOMENT the judge was actually
  // invoked (only happens for in-scope questions) -- a side channel, since
  // applyCapabilityAuthority()'s own returned shape does not carry model
  // state (it has no knowledge of modelManager by design). Never read by
  // any decision logic -- purely diagnostic (Part K).
  let observedModelState = null;
  const instrumentedJudge = async (pkg, handleMap) => {
    observedModelState = availabilityCheck().status;
    return rawJudge(pkg, handleMap, { signal });
  };

  const result = await applyCapabilityAuthority(question, answer, ctx, instrumentedJudge);

  if (!result.authority.ran) {
    // Out of scope (authority.required === false) OR claim-unmatched
    // (required === true, ran === false, judge never invoked) -- in
    // neither case was the judge/model ever touched, so there is no model
    // state to report.
    return result;
  }

  return { ...result, authority: { ...result.authority, modelState: observedModelState } };
}

// Related-topic direct navigation checkpoint -- a second, deliberately
// separate outer entrypoint mirroring answerQuestionWithAuthority() above
// almost verbatim, NOT refactored to share a helper with it: this
// checkpoint's own explicit boundary is "do not modify answerQuestion()
// retrieval / answer synthesis / capability authority", and
// answerQuestionWithAuthority() is the one function every existing test
// above already exercises end to end against real production behavior --
// extracting a shared helper would touch that proven function's body for
// no behavioral gain. This wrapper differs from it in exactly one respect:
// the deterministic answer comes from answerForKnownRecord(recordId, ctx)
// (a direct id lookup, knowledgeEngine.js, above) instead of
// answerQuestion(question, ctx) (fuzzy retrieval) -- everything after that
// (judge injection, signal forwarding, model-state snapshotting) is
// identical, so a Related-topic click still passes through the SAME
// unmodified applyCapabilityAuthority() scope gate, and therefore still
// invokes the local judge/model if and only if the destination record's
// own classification genuinely enters its narrow authority-sensitive scope
// -- never unconditionally.
//
// Returns null (never throws) when recordId doesn't resolve to a known
// record -- the caller (main/askAutoIngest.js) is responsible for turning
// that into an operator-facing "not found" error; this module never
// invents a fallback answer for an unresolvable id.
async function answerKnownRecordWithAuthority(recordId, ctx, options = {}) {
  const answer = answerForKnownRecord(recordId, ctx);
  if (!answer) return null;

  const rawJudge = options.judge || productionJudge;
  const availabilityCheck = options.getModelAvailability || getModelAvailability;
  const signal = options.signal;

  let observedModelState = null;
  const instrumentedJudge = async (pkg, handleMap) => {
    observedModelState = availabilityCheck().status;
    return rawJudge(pkg, handleMap, { signal });
  };

  // applyCapabilityAuthority()'s claim extraction (claimNormalization.js's
  // own unmodified TEMPLATES) only fires on templated interrogative
  // phrasing ("Does AutoIngest support X?", etc.) -- answer.query here is
  // just the record's own bare title (answerForKnownRecord() above), which
  // matches none of those templates and would otherwise take the
  // claim-unmatched branch unconditionally, silently downgrading every
  // in-scope Feature-primary Related click to Uncertain regardless of what
  // the local judge would have said. Feeding the SAME already-existing
  // "Does AutoIngest support {title}?" template deterministically instead
  // (never invented content -- {title} is the exact, already-known record
  // title) lets a Feature-primary direct navigation reach the real judge
  // exactly as an equivalent ordinary question about that same feature
  // would. Workflow-primary direct navigation is unaffected either way --
  // primaryAuthorityKind() only recognizes 'feature'/'governance', so
  // shouldApplyCapabilityAuthority() never even reaches claim extraction
  // for it.
  const authorityQuestion = `Does AutoIngest support ${answer.query}?`;
  const result = await applyCapabilityAuthority(authorityQuestion, answer, ctx, instrumentedJudge);

  if (!result.authority.ran) {
    return result;
  }

  return { ...result, authority: { ...result.authority, modelState: observedModelState } };
}

module.exports = { answerQuestionWithAuthority, answerKnownRecordWithAuthority, describeAuthorityOutcome };
