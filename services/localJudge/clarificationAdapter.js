'use strict';

// Phase C8 — production adapter for clarification-question WORDING only.
// Mirrors synthesisAdapter.js's "thin, no fallback logic of its own"
// discipline and reuses the SAME shared Phi runtime.js singleton (no
// second model load -- same precedent judgeService.js/synthesisService.js
// already established: one local model serves multiple small deterministic-
// bounded tasks).
//
// CRITICAL SAFETY PROPERTY (checkpoint Section 4): the deterministic
// clarificationDecision.js layer has ALREADY decided WHAT is uncertain and
// which candidate records are plausible -- this adapter's model call is
// given that fixed candidate list as read-only context and asked ONLY to
// phrase a natural question about it. The candidate CHOICE LIST the
// operator actually sees is rendered by the caller directly from
// clarificationDecision.js's own `candidates` array -- Phi's output is
// NEVER parsed for record identity, NEVER used to populate the choice
// pills, and structurally CANNOT introduce a new/fourth option, because no
// code path ever reads a record id out of its text. If the model's own
// output fails the (loose) sanity checks below -- empty, too long, or
// contains anything looking like a confident capability-status claim,
// which a clarifying QUESTION must never assert -- the caller falls back
// to the deterministic template question (conversationalAsk.js's own
// `formatClarificationFallback`), never a retry, never a crash.

const path = require('path');
const runtime = require('./runtime');

const CLARIFICATION_TIMEOUT_MS = 20000; // same order of magnitude as judgeService's own PRODUCTION_JUDGE_TIMEOUT_MS (20000) -- this is an even smaller/faster task (one short sentence, no evidence package to read), never expected to approach synthesis's own 45s budget
const CLARIFICATION_MAX_TOKENS = 80; // a clarifying question is one or two sentences -- generous but bounded

const FORBIDDEN_STATUS_WORDS = /\b(AVAILABLE|NOT_SUPPORTED|PLANNED|PARTIALLY_AVAILABLE|UNKNOWN)\b/;

function buildPrompt({ missingFactLabel, candidateTitles, conversationSummary }) {
  const system = 'You help phrase ONE short, natural, friendly clarifying question for a desktop photo-archiving assistant called AutoIngest. '
    + 'You are given a fixed list of possible topics the operator might mean. Ask which one applies, in plain conversational English. '
    + 'Do not answer the question. Do not state facts about AutoIngest. Do not mention record IDs, scores, or internal terms. One or two sentences only.';
  const user = [
    conversationSummary ? `Conversation so far: ${conversationSummary}` : null,
    `What is unclear: ${missingFactLabel}`,
    `Possible topics: ${candidateTitles.join(', ')}`,
    'Write the clarifying question now.',
  ].filter(Boolean).join('\n');
  return { system, user };
}

function isValidClarificationText(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 400) return false;
  if (FORBIDDEN_STATUS_WORDS.test(trimmed)) return false;
  return true;
}

function createClarificationAdapter({ modelPath, timeoutMs = CLARIFICATION_TIMEOUT_MS, maxTokens = CLARIFICATION_MAX_TOKENS }) {
  if (!modelPath) throw new Error('createClarificationAdapter requires an explicit modelPath');

  return async function formulateClarification({ missingFactLabel, candidateTitles, conversationSummary }, { signal } = {}) {
    const { system, user } = buildPrompt({ missingFactLabel, candidateTitles, conversationSummary });
    const schema = { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] };
    const result = await runtime.infer({ system, user, schema, maxTokens, modelPath, timeoutMs, signal });
    if (result.parseError || !result.parsed || !isValidClarificationText(result.parsed.question)) {
      throw new Error(result.parseError || 'clarification model produced no usable question text');
    }
    return { question: result.parsed.question.trim() };
  };
}

module.exports = { createClarificationAdapter, isValidClarificationText, CLARIFICATION_TIMEOUT_MS, CLARIFICATION_MAX_TOKENS };
