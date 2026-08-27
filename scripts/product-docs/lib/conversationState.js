'use strict';

// Phase C8 — bounded, in-memory, session-local conversation state for the
// Ask AutoIngest drawer. Pure data structure + pure reducer functions
// (immutable -- every function returns a NEW state, per this codebase's
// own project-wide immutability discipline) -- no retrieval, no IPC, no
// model calls live here. The orchestrator (conversationalAsk.js) is what
// ties this together with retrieval + clarificationDecision.js.
//
// Bounded: MAX_TURNS caps the transcript (a desktop Ask drawer, not an
// unbounded chat log) -- oldest turns are dropped from `turns` once
// exceeded, but `conversationFacts` (the accumulated understanding, not
// the raw transcript) is never truncated, since it's already small and
// summarized, not raw prose.
//
// Future contextual-awareness seam (checkpoint Section 11): `operationalContext`
// is a reserved, always-present field, always null in C8. A future C9 can
// populate it (current screen/event/component/active transfer/etc.)
// without any shape change here -- the orchestrator already threads
// `state.operationalContext` into retrieval/clarification wherever it
// reads conversation state, it just never sets it non-null yet.

const MAX_TURNS = 20;

function createConversation() {
  return {
    turns: [], // [{ role: 'user'|'assistant', kind: 'question'|'clarification'|'answer'|'choice'|'final', text, choices, timestamp }]
    originalQuestion: null,
    conversationFacts: [], // ["transfer stopped halfway", "workflow: Transfer Export", "cause: NAS disconnected"]
    candidatesConsidered: [], // [{id, title, entityType, source: 'deterministic'|'semantic', turnIndex}]
    resolvedSubjectId: null,
    unresolvedAmbiguity: null, // { decision, candidates, reason } | null
    finalAnswer: null,
    notSureCount: 0,
    // Reserved for C9 -- always present, always null until a future
    // checkpoint's context-injection work populates it. See header.
    operationalContext: null,
  };
}

function pushTurn(state, turn) {
  const turns = [...state.turns, { ...turn, timestamp: turn.timestamp || Date.now() }];
  return { ...state, turns: turns.length > MAX_TURNS ? turns.slice(turns.length - MAX_TURNS) : turns };
}

function addUserMessage(state, text) {
  let next = pushTurn(state, { role: 'user', kind: state.turns.length === 0 ? 'question' : 'response', text });
  if (!next.originalQuestion) next = { ...next, originalQuestion: text };
  return next;
}

function addAssistantClarification(state, text, choices) {
  return pushTurn(state, { role: 'assistant', kind: 'clarification', text, choices: choices || [] });
}

function addAssistantFinal(state, answer) {
  const withTurn = pushTurn(state, { role: 'assistant', kind: 'final', text: answer.directAnswer || '' });
  return { ...withTurn, finalAnswer: answer };
}

// A resolved fact is a short, plain-text restatement of what the operator
// established this turn (e.g. "workflow: Transfer Export") -- never a
// verbatim copy of raw user prose beyond what's needed, so the
// accumulated list stays small and directly usable as retrieval context.
function addResolvedFact(state, fact) {
  if (state.conversationFacts.includes(fact)) return state;
  return { ...state, conversationFacts: [...state.conversationFacts, fact] };
}

function recordCandidates(state, candidates, source, turnIndex) {
  const additions = candidates.map((c) => ({ id: c.id, title: c.title, entityType: c.entityType || c.type, source, turnIndex }));
  return { ...state, candidatesConsidered: [...state.candidatesConsidered, ...additions] };
}

function setUnresolvedAmbiguity(state, ambiguity) {
  return { ...state, unresolvedAmbiguity: ambiguity };
}

function resolveSubject(state, recordId) {
  return { ...state, resolvedSubjectId: recordId, unresolvedAmbiguity: null };
}

function incrementNotSure(state) {
  return { ...state, notSureCount: state.notSureCount + 1 };
}

// Topic change: keeps the turn TRANSCRIPT (an honest record of what was
// said) but resets everything that would otherwise contaminate a fresh
// question -- accumulated facts, unresolved ambiguity, resolved subject.
// The DECISION of whether to call this belongs to the orchestrator (it
// requires comparing the new message's own retrieval result against the
// current unresolved subject, which is retrieval logic, not state logic)
// -- this function only performs the reset once that decision is made.
function resetForTopicChange(state) {
  return { ...state, conversationFacts: [], candidatesConsidered: [], resolvedSubjectId: null, unresolvedAmbiguity: null, notSureCount: 0 };
}

// The conversation's own accumulated understanding, joined into one
// compact string a retrieval/clarification-formulation step can consume
// as additional context alongside the operator's newest message -- e.g.
// "transfer stopped halfway; workflow: Transfer Export; cause: NAS
// disconnected" -- never the raw multi-turn transcript verbatim.
function accumulatedContextText(state) {
  return state.conversationFacts.join('; ');
}

module.exports = {
  createConversation, pushTurn, addUserMessage, addAssistantClarification, addAssistantFinal,
  addResolvedFact, recordCandidates, setUnresolvedAmbiguity, resolveSubject, incrementNotSure,
  resetForTopicChange, accumulatedContextText, MAX_TURNS,
};
