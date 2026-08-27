'use strict';

// ASK AUTOINGEST — CONVERSATIONAL ARCHITECTURE A/B EXPERIMENT (Product
// Owner checkpoint, 2026-08-25). Benchmark-only, not wired into
// production, not shipped. A DELIBERATE, ISOLATED COPY of
// lib/conversationalAsk.js's askConversational() -- the production file
// itself is completely untouched (this is the CONTROL path in the A/B).
// Every retrieval/authority call (answerQuestionWithAuthority,
// assessPrimaryFit, decideClarification, trySynthesize,
// buildEvidencePackageForAuthorityAnswer) is imported and called
// UNCHANGED, exactly as production does -- this experiment tests
// CONVERSATIONAL ARCHITECTURE (candidate-list handling on repeated
// ambiguity, and -- in experimentalHarness.js -- real chat-history framing
// and evidence-text shaping), never a replacement for retrieval, the
// knowledge engine, or deterministic capability authority.
//
// THE ONE LOGIC CHANGE from askConversational() (forensic finding E/F.2
// this checkpoint): production re-runs the SAME retrieval on a growing
// concatenation of raw user messages every turn, with no memory of
// "already asked and not resolved" -- confirmed directly (this
// checkpoint's forensic trace) that conversationFacts is raw userMessage
// text, not a distilled understanding, so a follow-up reply that doesn't
// itself contain a new distinguishing keyword produces the SAME kind of
// clarification again (a narrower candidate list is retrieval-score
// incidental, not intentional pruning). This mirrors real user complaints:
// "My transfer stopped." -> clarify -> "I'm not sure. I was just copying
// yesterday's event." -> clarifies AGAIN instead of progressing.
//
// Fix tested here: if `state.unresolvedAmbiguity` was ALREADY set when
// this turn began (i.e. the operator is replying to a clarification we
// already asked) and the fresh retrieval STILL resolves to
// AMBIGUOUS/MISSING_REQUIRED_DETAIL, do not ask a third/second time --
// commit to the best candidate as an honest, explicit hedge (the SAME
// "closest guess" discipline the pre-existing isNotSure() hedge path
// already uses elsewhere in conversationalAsk.js, applied here to the
// general repeated-ambiguity case, not only the literal word "not sure").
// The operator can still correct it naturally on the next turn (already-
// tested "user corrects the assistant" behavior is unaffected). This is a
// SMALL, LOCAL, EASILY-REVERTED change to orchestration flow-control --
// zero change to retrieval, zero change to what "ambiguous" means, zero
// change to capability authority.

const { answerQuestionWithAuthority } = require('../../lib/answerWithAuthority');
const { answerForKnownRecord } = require('../../lib/knowledgeEngine');
const { assessPrimaryFit } = require('../../lib/askSynthesis/retrievalConfidence');
const { buildEvidencePackageForAuthorityAnswer, sanitizeIdsInProse } = require('../../lib/askSynthesis/evidencePackage');
const { trySynthesize } = require('../../lib/answerWithSynthesis');
const { decideClarification } = require('../../lib/askSynthesis/clarificationDecision');
const { subjectGroupOf } = require('../../lib/candidateGrouping');
const CS = require('../../lib/conversationState');
const { isNotSure, formatClarificationFallback } = require('../../lib/conversationalAsk');
const { stripTechnicalSpans } = require('./experimentalEvidence');

async function safeSemanticTopK(question, options) {
  if (!options.semanticTopK) return [];
  try {
    return await options.semanticTopK(question);
  } catch {
    return [];
  }
}

async function retrieveAndDecide(queryText, ctx, options) {
  const answer = await answerQuestionWithAuthority(queryText, ctx, options);
  const primaryFit = assessPrimaryFit(queryText, answer, ctx);
  const semTop = await safeSemanticTopK(queryText, options);
  const clarify = decideClarification(answer, primaryFit, semTop, ctx);
  return { answer, primaryFit, semTop, clarify };
}

async function askClarifyingQuestion(s, clarify, contextSummary, options, extraResponseFields) {
  s = CS.setUnresolvedAmbiguity(s, clarify);
  s = CS.recordCandidates(s, clarify.candidates, 'combined', s.turns.length);
  const missingFactLabel = clarify.decision === 'AMBIGUOUS' ? 'which AutoIngest area this is about' : 'which specific one you mean';
  const candidateTitles = clarify.candidates.map((c) => c.title);
  let questionText = formatClarificationFallback(clarify);
  if (options.formulateClarification) {
    try {
      const formulated = await options.formulateClarification({ missingFactLabel, candidateTitles, conversationSummary: contextSummary || null }, { signal: options.signal });
      if (formulated && formulated.question) questionText = formulated.question;
    } catch {
      // fall through to the deterministic template
    }
  }
  s = CS.addAssistantClarification(s, questionText, candidateTitles);
  return { state: s, response: { kind: 'clarification', text: questionText, choices: [...candidateTitles, 'Not sure'], ...extraResponseFields } };
}

// Same "closest guess" discipline as conversationalAsk.js's own isNotSure()
// hedge path, factored out here so the new repeated-ambiguity branch below
// can reuse it without duplicating the resolve/hedge/synthesize sequence.
//
// FORENSIC FINDING (this checkpoint, discovered via the experiment's own
// smoke test): production's identical hedge path has a pre-existing,
// undocumented defect -- `matchQuality: 'weak'` makes the hedge always
// INELIGIBLE for synthesis (evaluateSynthesisEligibility's own
// WEAK_MATCH_QUALITIES gate), so trySynthesize() never calls a model and
// ships `known.directAnswer` completely raw -- untouched by
// sanitizeIdsInProse(), full of literal record IDs, backtick identifiers,
// and markdown links. Production's real isNotSure() only reaches this
// path on the exact literal phrase "not sure", a narrow trigger; this
// experimental path's broader "don't ask twice" rule reaches it far more
// often, which is what surfaced the defect clearly. Rather than ship a
// broken experimental transcript or silently paper over a pre-existing
// bug, the raw text is sanitized here exactly the way every other
// evidence-facing text in this codebase already is (sanitizeIdsInProse +
// the same markdown-link flattening main/askAutoIngestPresentation.js
// applies before display) -- a general hygiene fix, not new leniency.
function flattenMarkdownLinks(text) {
  return typeof text === 'string' ? text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') : text;
}

async function hedgeToBestCandidate(s, candidates, userMessage, ctx, options) {
  const best = candidates[0];
  if (!best) return null;
  const known = answerForKnownRecord(best.id, ctx);
  if (!known) return null;
  const cleanDirectAnswer = stripTechnicalSpans(sanitizeIdsInProse(flattenMarkdownLinks(known.directAnswer), ctx));
  const hedged = { ...known, matchQuality: 'weak', directAnswer: `Closest match I can offer without more detail: ${cleanDirectAnswer}` };
  const synthesized = await trySynthesize(hedged, () => buildEvidencePackageForAuthorityAnswer(userMessage, hedged, ctx), options, { fit: 'SAFE' });
  s = CS.resolveSubject(s, best.id);
  s = CS.addResolvedFact(s, `closest guess: ${best.title}`);
  s = CS.addAssistantFinal(s, synthesized);
  return { state: s, response: { kind: 'final', answer: synthesized, hedged: true } };
}

async function askConversationalExperimental(state, userMessage, ctx, options = {}) {
  let s = CS.addUserMessage(state, userMessage);

  // Unchanged from production.
  if (isNotSure(userMessage) && s.unresolvedAmbiguity) {
    s = CS.incrementNotSure(s);
    const prior = s.unresolvedAmbiguity;
    const result = await hedgeToBestCandidate(s, prior.candidates, userMessage, ctx, options);
    if (result) return result;
    const hedge = { query: userMessage, classification: 'UNKNOWN', directAnswer: "I don't have enough information to answer that confidently, even with what you've told me so far. Could you describe what you were trying to do in a bit more detail?", capabilityStatus: 'UNKNOWN', matchQuality: 'none', matchedCapabilities: [], guidance: null, limitations: [], relatedCapabilities: [], sources: [], confidence: 0 };
    s = CS.addAssistantFinal(s, hedge);
    return { state: s, response: { kind: 'final', answer: hedge } };
  }

  // Unchanged from production -- topic-change detection.
  const STRONG_TOPIC_CHANGE_REASONS = new Set(['multiple-distinct-records-same-subject-area', 'deterministic-and-semantic-disagree-on-subject-group']);
  const hadUnresolvedAmbiguityBeforeThisTurn = !!s.unresolvedAmbiguity;

  if ((s.unresolvedAmbiguity || s.resolvedSubjectId)) {
    const alone = await retrieveAndDecide(userMessage, ctx, options);
    const aloneGroup = alone.answer.matchedCapabilities[0] ? subjectGroupOf(alone.answer.matchedCapabilities[0].id, ctx) : null;
    const priorSubjectId = s.resolvedSubjectId || (s.unresolvedAmbiguity && s.unresolvedAmbiguity.candidates[0] && s.unresolvedAmbiguity.candidates[0].id);
    const priorGroup = subjectGroupOf(priorSubjectId, ctx);
    const isTopicChange = aloneGroup && priorGroup && aloneGroup !== priorGroup
      && ((alone.clarify.decision === 'CLEAR' && alone.clarify.reason !== 'no-evidence-anywhere') || STRONG_TOPIC_CHANGE_REASONS.has(alone.clarify.reason));

    if (isTopicChange && alone.clarify.decision === 'CLEAR') {
      s = CS.resetForTopicChange(s);
      const synthesized = await trySynthesize(alone.answer, () => buildEvidencePackageForAuthorityAnswer(userMessage, alone.answer, ctx), options, alone.primaryFit);
      const newTopId = alone.answer.matchedCapabilities[0] && alone.answer.matchedCapabilities[0].id;
      if (newTopId) {
        s = CS.resolveSubject(s, newTopId);
        s = CS.addResolvedFact(s, userMessage);
      }
      s = CS.addAssistantFinal(s, synthesized);
      return { state: s, response: { kind: 'final', answer: synthesized, topicChanged: true } };
    }

    if (isTopicChange) {
      s = CS.resetForTopicChange(s);
      s = CS.addResolvedFact(s, userMessage);
      return askClarifyingQuestion(s, alone.clarify, null, options, { topicChanged: true });
    }
  }

  const contextText = CS.accumulatedContextText(s);
  const queryText = contextText ? `${contextText}. ${userMessage}` : userMessage;
  const { answer, clarify, primaryFit } = await retrieveAndDecide(queryText, ctx, options);

  if (clarify.decision === 'AMBIGUOUS' || clarify.decision === 'MISSING_REQUIRED_DETAIL') {
    s = CS.addResolvedFact(s, userMessage);

    // *** THE EXPERIMENTAL CHANGE ***
    // Production always asks again here. This path instead checks whether
    // an ambiguity was ALREADY unresolved when this turn started -- if so,
    // the operator just gave us their best additional detail and retrieval
    // still couldn't cleanly resolve it. Asking essentially the same
    // internal-taxonomy question a second time is exactly the "repeated
    // clarification loop" this experiment exists to test a fix for.
    // Commit to the current top candidate as an honest, explicit hedge
    // instead -- grounded (real record, real evidence, never invented),
    // and the operator can still correct it on the next turn.
    if (hadUnresolvedAmbiguityBeforeThisTurn) {
      const result = await hedgeToBestCandidate(s, clarify.candidates, userMessage, ctx, options);
      if (result) return { ...result, response: { ...result.response, experimentalHedgeAfterRepeatedAmbiguity: true } };
    }

    return askClarifyingQuestion(s, clarify, contextText, options, {});
  }

  const synthesized = await trySynthesize(answer, () => buildEvidencePackageForAuthorityAnswer(queryText, answer, ctx), options, primaryFit);
  const topId = answer.matchedCapabilities[0] && answer.matchedCapabilities[0].id;
  if (topId) {
    s = CS.resolveSubject(s, topId);
    s = CS.addResolvedFact(s, userMessage);
  }
  s = CS.addAssistantFinal(s, synthesized);
  return { state: s, response: { kind: 'final', answer: synthesized } };
}

module.exports = { askConversationalExperimental };
