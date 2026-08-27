'use strict';

// Phase C8 — the conversational Ask AutoIngest orchestrator. The ONE new
// production entrypoint this checkpoint adds; everything it calls
// (answerQuestionWithAuthority, assessPrimaryFit, evaluateSynthesisEligibility,
// trySynthesize's own internals via answerQuestionWithSynthesis) is
// UNCHANGED. This module only adds a decision BETWEEN retrieval and
// synthesis (clarificationDecision.js) and a state-threading layer around
// repeated calls (conversationState.js) -- it never re-implements
// retrieval, authority, or synthesis.
//
// Pipeline (checkpoint Section 1):
//   user message -> conversation state
//     -> deterministic retrieval (answerQuestionWithAuthority, unchanged)
//     -> semantic retrieval (candidate generation ONLY -- see
//        clarificationDecision.js's own header: a similarity score is
//        never treated as capability truth, never bypasses authority)
//     -> clarificationDecision.decideClarification()
//        CLEAR / UNSUPPORTED -> synthesis as today -> final answer
//        AMBIGUOUS / MISSING_REQUIRED_DETAIL -> clarification question
//     -> updated conversation state

const { answerQuestionWithAuthority } = require('./answerWithAuthority');
const { assessPrimaryFit } = require('./askSynthesis/retrievalConfidence');
const { buildEvidencePackageForAuthorityAnswer } = require('./askSynthesis/evidencePackage');
const { trySynthesize } = require('./answerWithSynthesis');
const { decideClarification } = require('./askSynthesis/clarificationDecision');
const { subjectGroupOf } = require('./candidateGrouping');
const CS = require('./conversationState');

const NOT_SURE_PATTERN = /^\s*(not sure|i'?m not sure|no idea|don'?t know|i don'?t know|unsure)\s*\.?\s*$/i;

function isNotSure(text) {
  return NOT_SURE_PATTERN.test(String(text || ''));
}

// Deterministic fallback clarification wording -- ALWAYS correct, ALWAYS
// available, no model required. Used directly when no LLM formulator is
// supplied/available, and as the safety net when the LLM's own output
// fails validation (see clarificationAdapter.js's own header).
function formatClarificationFallback(clarify) {
  const titles = clarify.candidates.map((c) => c.title);
  if (clarify.decision === 'AMBIGUOUS') {
    return `I can help with a few different things here. Could you tell me which one you mean: ${titles.join(', ')}?`;
  }
  return `Could you tell me which one you mean: ${titles.join(', ')}?`;
}

// getSemanticCandidates: injected (options.semanticTopK), never imported
// directly -- keeps this module runnable/testable with zero model
// dependency, and keeps semantic retrieval's own availability/fallback
// entirely the caller's concern (see checkpoint Section 6: "deterministic-
// only fallback" must always be possible). Returns [] on any failure,
// NEVER throws -- semantic retrieval is supplementary evidence; its
// absence must never block an answer.
async function safeSemanticTopK(question, options) {
  if (!options.semanticTopK) return [];
  try {
    return await options.semanticTopK(question);
  } catch {
    return [];
  }
}

// The single retrieval+clarification-decision pass for one piece of query
// text (either the operator's newest message alone, or that message plus
// accumulated conversation context) -- factored out so topic-change
// detection (below) can run it twice (once "alone", once "with context")
// without duplicating logic.
async function retrieveAndDecide(queryText, ctx, options) {
  const answer = await answerQuestionWithAuthority(queryText, ctx, options);
  const primaryFit = assessPrimaryFit(queryText, answer, ctx);
  const semTop = await safeSemanticTopK(queryText, options);
  const clarify = decideClarification(answer, primaryFit, semTop, ctx);
  return { answer, primaryFit, semTop, clarify };
}

// Shared by the ordinary path and the topic-change-into-ambiguity path
// (below) -- both need to turn an AMBIGUOUS/MISSING_REQUIRED_DETAIL
// clarify result into a conversation-state update + clarification
// response the exact same way; factored out rather than duplicated.
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
      // fall through to the deterministic template -- never surfaced as an error
    }
  }
  s = CS.addAssistantClarification(s, questionText, candidateTitles);
  return { state: s, response: { kind: 'clarification', text: questionText, choices: [...candidateTitles, 'Not sure'], ...extraResponseFields } };
}

// askConversational(state, userMessage, ctx, options) -> Promise<{ state, response }>
//   options: { synthesize, semanticTopK, signal, formulateClarification }
//     all optional and all injected -- see each one's own call site for
//     its fallback behavior when omitted.
async function askConversational(state, userMessage, ctx, options = {}) {
  let s = CS.addUserMessage(state, userMessage);

  // "Not sure" (Section 12D): never a dead end. Present the best-available
  // candidate as an explicit hedge rather than re-asking indefinitely --
  // matches the existing weak-match hedge language answerFromRecord()
  // already uses elsewhere in this codebase, not a new uncertainty idiom.
  if (isNotSure(userMessage) && s.unresolvedAmbiguity) {
    s = CS.incrementNotSure(s);
    const prior = s.unresolvedAmbiguity;
    const best = prior.candidates[0];
    if (!best) {
      const hedge = { query: userMessage, classification: 'UNKNOWN', directAnswer: "I don't have enough information to answer that confidently, even with what you've told me so far. Could you describe what you were trying to do in a bit more detail?", capabilityStatus: 'UNKNOWN', matchQuality: 'none', matchedCapabilities: [], guidance: null, limitations: [], relatedCapabilities: [], sources: [], confidence: 0 };
      s = CS.addAssistantFinal(s, hedge);
      return { state: s, response: { kind: 'final', answer: hedge } };
    }
    // Re-resolve using the best remaining candidate directly (a known-id
    // path, same discipline answerForKnownRecord already uses) rather than
    // guessing via fuzzy retrieval a second time.
    const { answerForKnownRecord } = require('./knowledgeEngine');
    const known = answerForKnownRecord(best.id, ctx);
    const hedged = known ? { ...known, matchQuality: 'weak', directAnswer: `Closest match I can offer without more detail: ${known.directAnswer}` } : null;
    if (hedged) {
      const synthesized = await trySynthesize(hedged, () => buildEvidencePackageForAuthorityAnswer(userMessage, hedged, ctx), options, { fit: 'SAFE' });
      s = CS.resolveSubject(s, best.id);
      s = CS.addResolvedFact(s, `closest guess: ${best.title}`);
      s = CS.addAssistantFinal(s, synthesized);
      return { state: s, response: { kind: 'final', answer: synthesized, hedged: true } };
    }
  }

  // Topic-change detection (Section 12E): only checked when there is
  // existing unresolved state to potentially override -- re-running
  // retrieval on every ordinary turn would be wasteful and unnecessary.
  // The NEW message ALONE (ignoring accumulated context) must resolve
  // CLEARLY to a DIFFERENT subject group than whatever is currently
  // unresolved/resolved for this to count as a real topic change -- a
  // vague follow-up ("what about that?") never triggers it, since it
  // won't resolve clearly on its own.
  //
  // CRITICAL: clarify.decision === 'CLEAR' is not by itself evidence of a
  // NEW topic -- decideClarification() also returns CLEAR for
  // reason:'no-evidence-anywhere' (deterministic AND semantic both found
  // nothing on the bare follow-up alone -- an honest "nothing to say",
  // not a confident resolution to some other subject). Measured bug: "The
  // NAS disconnected." alone resolves 'none'/CLEAR/no-evidence-anywhere
  // against an unrelated low-score top candidate (AI-FEAT-044, wrong
  // group purely by coincidence) -- treating that as a topic change wiped
  // the real, still-relevant "transfer stopped / Transfer Export"
  // conversation context the very continuation needed. Only a GENUINELY
  // confident alone-resolution (deterministic actually decided something,
  // not "nothing to decide") counts as evidence of a new subject.
  // FINAL ACCEPTANCE FINDING (real Electron + real embedding model, this
  // checkpoint): "What is QMZ?" -> resolved, then "My transfer stopped
  // halfway." confidently answered QMZ again. Root cause traced precisely:
  // "My transfer stopped halfway." ALONE resolves to MISSING_REQUIRED_DETAIL
  // (its own, correct, unambiguous-about-being-a-different-topic verdict --
  // group "transfer and backup", nothing to do with QMZ's "special
  // workflows" group) -- but the topic-change check below ONLY recognized
  // a new topic when the bare message resolved CLEAR. Because
  // MISSING_REQUIRED_DETAIL isn't CLEAR, topic-change never fired, so
  // execution fell into the ordinary path and glued the stale "What is
  // QMZ?" fact onto the new message -- and the rare, highly distinctive
  // "QMZ" keyword then dominated the combined retrieval query. This is a
  // local defect in THIS orchestration function, not in
  // clarificationDecision.js (which was already correctly reporting the
  // new subject as unambiguously a different group) -- fixed by also
  // recognizing "the bare message confidently resolves to a DIFFERENT
  // subject group, even if it's internally ambiguous within that group"
  // as a real topic change, not only "resolves to one exact record".
  // Measured counter-example to the QMZ fix above (same real-Electron
  // session): a genuine free-form REPLY to a pending clarification ("it's
  // the one where I hand a drive off to someone else, not the one
  // bringing a drive back in", answering "which transfer operation?")
  // evaluated ALONE weakly matches a single, unrelated candidate
  // (reason:'single-weak-candidate-needs-confirmation', AI-FEAT-028
  // "Import Source Attribution") -- a short phrase that only makes sense
  // in the context of the pending clarification carries no reliable
  // topical signal on its own, and broadening topic-change to trust this
  // reason wrongly re-clarified an already-answerable reply. Distinguishes
  // the two: 'multiple-distinct-records-same-subject-area' (multiple REAL
  // candidates independently found, same signal that correctly caught the
  // QMZ case) and 'deterministic-and-semantic-disagree-on-subject-group'
  // (two independent mechanisms agreeing on a different area) are strong,
  // trustworthy topic-change evidence; 'single-weak-candidate-needs-
  // confirmation' (one weak, unconfirmed candidate) is not.
  const STRONG_TOPIC_CHANGE_REASONS = new Set(['multiple-distinct-records-same-subject-area', 'deterministic-and-semantic-disagree-on-subject-group']);

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
      // New subject, but itself needs disambiguation (e.g. mid-conversation
      // switch from "What is QMZ?" straight into "My transfer stopped
      // halfway.") -- reset the stale context and ask about the NEW topic's
      // own ambiguity, rather than either guessing confidently by gluing
      // stale context onto it, or silently keeping the old, now-irrelevant
      // clarification alive.
      s = CS.resetForTopicChange(s);
      s = CS.addResolvedFact(s, userMessage);
      return askClarifyingQuestion(s, alone.clarify, null, options, { topicChanged: true });
    }
  }

  // Ordinary path: retrieve using the operator's newest message PLUS
  // accumulated conversation facts (checkpoint Section 2's own worked
  // example -- "transfer stopped + Transfer Export + NAS disconnected",
  // not merely the last sentence).
  const contextText = CS.accumulatedContextText(s);
  const queryText = contextText ? `${contextText}. ${userMessage}` : userMessage;
  const { answer, primaryFit, semTop, clarify } = await retrieveAndDecide(queryText, ctx, options);

  if (clarify.decision === 'AMBIGUOUS' || clarify.decision === 'MISSING_REQUIRED_DETAIL') {
    // Record what THIS turn established as a fact for the NEXT turn's
    // query, even though it didn't resolve to a single answer yet --
    // e.g. the raw user message itself ("my transfer stopped halfway")
    // is exactly the kind of fact that must carry forward per Section 2's
    // worked example.
    s = CS.addResolvedFact(s, userMessage);
    return askClarifyingQuestion(s, clarify, contextText, options, {});
  }

  // CLEAR or UNSUPPORTED -> answer now, through the existing, unmodified
  // synthesis pipeline.
  const synthesized = await trySynthesize(answer, () => buildEvidencePackageForAuthorityAnswer(queryText, answer, ctx), options, primaryFit);
  const topId = answer.matchedCapabilities[0] && answer.matchedCapabilities[0].id;
  if (topId) {
    s = CS.resolveSubject(s, topId);
    // The message that just resolved a prior clarification (e.g. "Transfer
    // Export.") must itself become part of the accumulated context, or the
    // NEXT follow-up ("The NAS disconnected.") loses exactly the detail
    // that narrowed things down and falls back into the same ambiguity --
    // measured bug (M1 multi-turn scenario): without this, turn 3's query
    // was built from only the ORIGINAL vague message, re-triggering the
    // same clarification turn 2 had just resolved.
    s = CS.addResolvedFact(s, userMessage);
  }
  s = CS.addAssistantFinal(s, synthesized);
  return { state: s, response: { kind: 'final', answer: synthesized } };
}

module.exports = { askConversational, isNotSure, formatClarificationFallback, retrieveAndDecide };
