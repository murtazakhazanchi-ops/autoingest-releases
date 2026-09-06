'use strict';

// services/qwenOrchestrator/contextBudget.js — Ask AutoIngest Stage 4,
// Section 15 (context-budget policy). Pure, model-independent policy
// functions -- never appends conversation forever until node-llama-cpp
// throws (Section 15's own explicit prohibition). CONTEXT_SIZE is
// imported from Stage 3's own modelManifest.js, never re-pinned here, so
// this policy can never silently drift out of sync with the real
// qualified context size.
//
// Token counting here is a conservative, model-independent ESTIMATE
// (characters / 4, a standard rough approximation for English prose and
// JSON) -- used for pruning DECISIONS before a turn is sent, and surfaced
// as session.js's own getDiagnostics().contextTokenUsage (Section 32).
// The real authoritative count is node-llama-cpp's own tokenizer inside
// the isolated child once the model is loaded; this stage does not plumb
// that real count back to the orchestrator (it would require a new
// message round-trip for a figure only used for approximate diagnostics/
// pruning decisions, not correctness -- pruning already degrades safely
// via the real "context won't fit" signal node-llama-cpp's own
// contextShift and, as a last resort, needsFreshContext handle). This
// estimate exists so pruning policy can be exercised and tested without
// ever loading the ~2.7 GiB model.

const { CONTEXT_SIZE } = require('../qwenRuntime/modelManifest');

// Reserved token budgets -- generous, round numbers chosen to leave
// comfortable headroom against the character-based estimate's own
// inaccuracy, not tuned against any specific conversation.
const RESERVED_SYSTEM_AND_TOOLS = 1200; // system instruction + 5 tool schemas' descriptions/params
const RESERVED_GENERATION = 1024; // this turn's final answer + any tool-call scaffolding
const RESERVED_SAFETY_MARGIN = 512; // tokenizer-estimation error + chat-template overhead

const AVAILABLE_FOR_HISTORY = CONTEXT_SIZE - RESERVED_SYSTEM_AND_TOOLS - RESERVED_GENERATION - RESERVED_SAFETY_MARGIN;

const CHARS_PER_TOKEN_ESTIMATE = 4;

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / CHARS_PER_TOKEN_ESTIMATE);
}

// computeBudget(historyEstimatedTokens, currentTurnEstimatedTokens)
// Returns whether the conversation, as it stands plus this turn, fits
// within the history budget, and how much headroom remains.
function computeBudget(historyEstimatedTokens, currentTurnEstimatedTokens = 0) {
  const used = historyEstimatedTokens + currentTurnEstimatedTokens;
  const remaining = AVAILABLE_FOR_HISTORY - used;
  return {
    contextSize: CONTEXT_SIZE,
    availableForHistory: AVAILABLE_FOR_HISTORY,
    used,
    remaining,
    withinBudget: remaining >= 0,
    // A soft warning zone before the hard limit, so a caller can prune
    // proactively rather than only reactively at the exact boundary.
    approachingLimit: remaining < AVAILABLE_FOR_HISTORY * 0.15,
  };
}

module.exports = {
  CONTEXT_SIZE, RESERVED_SYSTEM_AND_TOOLS, RESERVED_GENERATION, RESERVED_SAFETY_MARGIN,
  AVAILABLE_FOR_HISTORY, CHARS_PER_TOKEN_ESTIMATE, estimateTokens, computeBudget,
};
