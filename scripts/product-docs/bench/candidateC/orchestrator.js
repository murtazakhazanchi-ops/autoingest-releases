'use strict';

// ASK AUTOINGEST — CANDIDATE C ORCHESTRATOR (Product Owner checkpoint,
// 2026-08-25 continuation). Experimental only, not wired into production,
// not shipped. A deliberate, isolated FORK of
// bench/bakeoff/experimentalConversation.js's askConversationalExperimental()
// -- Candidate B itself is untouched (a second copy, not a mutation), and
// production lib/conversationalAsk.js is untouched (Candidate A's own path).
//
// Preserves, BYTE-IDENTICAL, every piece of Candidate B's conversational
// architecture this checkpoint's own hypothesis explicitly holds fixed
// (Section 1: "the conversational architecture for C should preserve the
// useful experimental chat-memory behaviour already demonstrated in B" --
// "the principal experimental variable must be the KNOWLEDGE representation
// and retrieval path"): real multi-turn chat-history replay (owned by the
// harness, main/askAutoIngestKnowledgeModelExperiment.js, exactly as
// main/askAutoIngestArchitectureExperiment.js owns it for B), the same
// repeated-ambiguity hedge fix, the same topic-change detection, the same
// deterministic C8 authority/retrieval/clarification-decision layer
// (answerQuestionWithAuthority, assessPrimaryFit, decideClarification --
// none of that is retrieval for ANSWER TEXT, it is retrieval for WHICH
// RECORD/STATUS/CLARIFICATION IS CORRECT, which both this checkpoint and
// the prior one keep fixed and out of scope).
//
// THE ONE CHANGE from experimentalConversation.js: every buildPkg() thunk
// passed into trySynthesize() is augmented with three extra fields
// (__kmAnswer, __kmUserMessage, __kmQueryText) carrying exactly what
// candidateC/evidence.js's buildKnowledgeModelEvidence() needs to attempt
// Knowledge-Model-based evidence FIRST, falling back to Candidate B's own
// evidencePackage.js/experimentalEvidence.js path when the Knowledge Model
// has no record for whatever the authority layer resolved. This is a
// harmless, inert addition to the pkg object as far as trySynthesize() and
// evidencePackage.js are concerned (they never read these fields) -- it is
// purely a side-channel for this experiment's own options.synthesize
// implementation (see main/askAutoIngestKnowledgeModelExperiment.js).

const { answerQuestionWithAuthority } = require('../../lib/answerWithAuthority');
const { answerForKnownRecord } = require('../../lib/knowledgeEngine');
const { assessPrimaryFit } = require('../../lib/askSynthesis/retrievalConfidence');
const { buildEvidencePackageForAuthorityAnswer, sanitizeIdsInProse } = require('../../lib/askSynthesis/evidencePackage');
const { trySynthesize } = require('../../lib/answerWithSynthesis');
const { decideClarification } = require('../../lib/askSynthesis/clarificationDecision');
const { subjectGroupOf } = require('../../lib/candidateGrouping');
const CS = require('../../lib/conversationState');
const { isNotSure, formatClarificationFallback } = require('../../lib/conversationalAsk');
const { stripTechnicalSpans } = require('../bakeoff/experimentalEvidence');

function withKmContext(pkg, answer, userMessage, queryText) {
  return { ...pkg, __kmAnswer: answer, __kmUserMessage: userMessage, __kmQueryText: queryText };
}

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
  const synthesized = await trySynthesize(
    hedged,
    () => withKmContext(buildEvidencePackageForAuthorityAnswer(userMessage, hedged, ctx), hedged, userMessage, userMessage),
    options,
    { fit: 'SAFE' },
  );
  s = CS.resolveSubject(s, best.id);
  s = CS.addResolvedFact(s, `closest guess: ${best.title}`);
  s = CS.addAssistantFinal(s, synthesized);
  return { state: s, response: { kind: 'final', answer: synthesized, hedged: true } };
}

async function askConversationalKnowledgeModel(state, userMessage, ctx, options = {}) {
  let s = CS.addUserMessage(state, userMessage);

  // Unchanged from Candidate B / production.
  if (isNotSure(userMessage) && s.unresolvedAmbiguity) {
    s = CS.incrementNotSure(s);
    const prior = s.unresolvedAmbiguity;
    const result = await hedgeToBestCandidate(s, prior.candidates, userMessage, ctx, options);
    if (result) return result;
    const hedge = { query: userMessage, classification: 'UNKNOWN', directAnswer: "I don't have enough information to answer that confidently, even with what you've told me so far. Could you describe what you were trying to do in a bit more detail?", capabilityStatus: 'UNKNOWN', matchQuality: 'none', matchedCapabilities: [], guidance: null, limitations: [], relatedCapabilities: [], sources: [], confidence: 0 };
    s = CS.addAssistantFinal(s, hedge);
    return { state: s, response: { kind: 'final', answer: hedge } };
  }

  // Unchanged from Candidate B / production -- topic-change detection.
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
      const synthesized = await trySynthesize(
        alone.answer,
        () => withKmContext(buildEvidencePackageForAuthorityAnswer(userMessage, alone.answer, ctx), alone.answer, userMessage, userMessage),
        options,
        alone.primaryFit,
      );
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

    // Unchanged from Candidate B -- the repeated-ambiguity hedge.
    if (hadUnresolvedAmbiguityBeforeThisTurn) {
      const result = await hedgeToBestCandidate(s, clarify.candidates, userMessage, ctx, options);
      if (result) return { ...result, response: { ...result.response, experimentalHedgeAfterRepeatedAmbiguity: true } };
    }

    return askClarifyingQuestion(s, clarify, contextText, options, {});
  }

  const synthesized = await trySynthesize(
    answer,
    () => withKmContext(buildEvidencePackageForAuthorityAnswer(queryText, answer, ctx), answer, userMessage, queryText),
    options,
    primaryFit,
  );
  const topId = answer.matchedCapabilities[0] && answer.matchedCapabilities[0].id;
  if (topId) {
    s = CS.resolveSubject(s, topId);
    s = CS.addResolvedFact(s, userMessage);
  }
  s = CS.addAssistantFinal(s, synthesized);
  return { state: s, response: { kind: 'final', answer: synthesized } };
}

module.exports = { askConversationalKnowledgeModel };
