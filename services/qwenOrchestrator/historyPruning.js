'use strict';

// services/qwenOrchestrator/historyPruning.js — Ask AutoIngest Stage 4,
// Section 16 (history-management policy). Pure functions operating on
// node-llama-cpp's own real ChatHistoryItem[] shape (verified against
// node_modules/node-llama-cpp/dist/types.d.ts: {type:'system'|'user',
// text} | {type:'model', response: (string | ChatModelFunctionCall |
// ChatModelSegment)[]}) -- fully testable without a model, and directly
// usable with the real session.getChatHistory()/setChatHistory().
//
// Deterministic pruning hierarchy (Section 16's own explicit priority
// order), implemented as ordered, escalating steps -- each is tried only
// if the previous one was insufficient:
//   1. preserve recent conversational turns (never touched by any step)
//   2. preserve facts/tool evidence still needed by active context
//      (recent turns' tool calls are left intact)
//   3. discard obsolete tool-result payloads before human conversation
//      (stripToolCallPayloads: old turns' ChatModelFunctionCall entries
//      are dropped from history, their visible text is not)
//   4. if still over budget after step 3, drop the oldest whole
//      user/model turn pairs (never the system message), down to a hard
//      floor -- if even the floor doesn't fit, signal needsFreshContext
//      so the caller can reset (Section 30) rather than this module
//      silently deciding to lose the system instruction or truncate mid-
//      turn.
//
// Deliberately NOT implemented (Section 16's own permission: "prefer
// deterministic pruning first"): model-based self-summarization. No
// second learned summarizer, and no bounded/tested "same Qwen summarizes
// itself" path either -- out of scope for this stage; if pruning down to
// the hard floor still doesn't fit, the caller resets rather than
// inventing a compression mechanism.

const { estimateTokens, computeBudget } = require('./contextBudget');

const KEEP_RECENT_TURNS_UNTOUCHED = 3; // turns (one user + one model message = one turn) never pruned by step 3
const MIN_TURNS_FLOOR = 2; // step 4 never drops below this many most-recent turns

function isFunctionCallEntry(item) {
  return item && typeof item === 'object' && item.type === 'functionCall';
}

// A "turn" here is one {type:'user'} item immediately followed by its
// {type:'model'} response -- the natural conversational unit step 4
// drops as a pair, never splitting a user message from its own answer.
function splitIntoTurns(history) {
  const systemItems = [];
  const turns = [];
  let i = 0;
  while (i < history.length && history[i].type === 'system') { systemItems.push(history[i]); i++; }
  while (i < history.length) {
    const turn = [history[i]];
    i++;
    while (i < history.length && history[i].type !== 'user') { turn.push(history[i]); i++; }
    turns.push(turn);
  }
  return { systemItems, turns };
}

function estimateItemTokens(item) {
  if (item.type === 'system' || item.type === 'user') return estimateTokens(item.text);
  if (item.type === 'model') {
    return item.response.reduce((sum, part) => {
      if (typeof part === 'string') return sum + estimateTokens(part);
      if (isFunctionCallEntry(part)) return sum + estimateTokens(JSON.stringify(part.params || {})) + estimateTokens(JSON.stringify(part.result || {}));
      if (part && part.type === 'segment') return sum + estimateTokens(part.text);
      return sum;
    }, 0);
  }
  return 0;
}

function estimateHistoryTokens(history) {
  return history.reduce((sum, item) => sum + estimateItemTokens(item), 0);
}

// Strips ChatModelFunctionCall entries from every model-response item
// EXCEPT the most recent `keepRecentTurns` turns -- the tool-call
// scaffolding (function name/params/result) is the most token-expensive,
// least conversationally-relevant part of an old turn; the turn's own
// final visible text (string parts) is always preserved regardless of
// age, since that IS the human conversation.
function stripToolCallPayloads(history, keepRecentTurns = KEEP_RECENT_TURNS_UNTOUCHED) {
  const { systemItems, turns } = splitIntoTurns(history);
  const cutoff = Math.max(0, turns.length - keepRecentTurns);
  const prunedTurns = turns.map((turn, idx) => {
    if (idx >= cutoff) return turn;
    return turn.map((item) => {
      if (item.type !== 'model') return item;
      const strippedResponse = item.response.filter((part) => !isFunctionCallEntry(part));
      return strippedResponse.length === item.response.length ? item : { ...item, response: strippedResponse };
    });
  });
  return [...systemItems, ...prunedTurns.flat()];
}

// Drops the oldest whole turns (user+model pairs), keeping at least
// `minTurnsFloor` most-recent turns and the system message(s) untouched.
function dropOldestTurns(history, minTurnsFloor = MIN_TURNS_FLOOR) {
  const { systemItems, turns } = splitIntoTurns(history);
  if (turns.length <= minTurnsFloor) return { history: [...systemItems, ...turns.flat()], droppedAny: false };
  const kept = turns.slice(turns.length - minTurnsFloor);
  return { history: [...systemItems, ...kept.flat()], droppedAny: true };
}

// The main entry point: escalates through steps 3 then 4 only as needed.
// Returns { history, pruned: boolean, needsFreshContext: boolean,
// stepsApplied: string[] }. Never mutates the input array or its items.
function pruneHistoryToFit(history, currentTurnEstimatedTokens = 0) {
  const stepsApplied = [];
  let working = history;

  let budget = computeBudget(estimateHistoryTokens(working), currentTurnEstimatedTokens);
  if (budget.withinBudget) return { history: working, pruned: false, needsFreshContext: false, stepsApplied, budget };

  working = stripToolCallPayloads(working);
  stepsApplied.push('stripToolCallPayloads');
  budget = computeBudget(estimateHistoryTokens(working), currentTurnEstimatedTokens);
  if (budget.withinBudget) return { history: working, pruned: true, needsFreshContext: false, stepsApplied, budget };

  const { history: floored, droppedAny } = dropOldestTurns(working);
  if (droppedAny) {
    working = floored;
    stepsApplied.push('dropOldestTurns');
    budget = computeBudget(estimateHistoryTokens(working), currentTurnEstimatedTokens);
  }
  if (budget.withinBudget) return { history: working, pruned: true, needsFreshContext: false, stepsApplied, budget };

  // Pruned down to the hard floor and still over budget -- the caller
  // (Section 30's reset behavior) must start a fresh context rather than
  // this module silently dropping the system message or a mid-turn item.
  return { history: working, pruned: true, needsFreshContext: true, stepsApplied, budget };
}

module.exports = {
  KEEP_RECENT_TURNS_UNTOUCHED, MIN_TURNS_FLOOR,
  splitIntoTurns, estimateItemTokens, estimateHistoryTokens,
  stripToolCallPayloads, dropOldestTurns, pruneHistoryToFit,
};
