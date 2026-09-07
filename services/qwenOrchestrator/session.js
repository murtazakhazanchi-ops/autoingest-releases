'use strict';

// services/qwenOrchestrator/session.js — Ask AutoIngest Stage 4. The
// per-conversation orchestrator session: owns one Stage-2 HandleSession +
// createKnowledgeOperations() instance, registers the 5 production tools
// (toolDefinitions.js) against the real qwenRuntime session API (Section
// 5/6), and implements every deterministic safety mechanism the brief
// requires as BOOKKEEPING around Qwen, never as a second intelligence
// (Section 10/25's own explicit boundary): duplicate-tool-call protection
// (Section 19), bounded tool-action loop (Section 18), grounding
// bookkeeping (Section 22), context-budget/history-pruning (Section
// 15/16), final-answer validation + bounded regeneration + fallback
// (Section 25-27), cancellation (Section 28), queuing (Section 29), and
// reset (Section 30). Deterministic state tracks mechanics; Qwen owns
// conversational interpretation (Section 14's own explicit division).
//
// Tool descriptions (toolDefinitions.js), the system prompt
// (systemPrompt.js), and the final-answer validator (answerValidator.js)
// are promoted from the qualified Checkpoint 14 bench lineage (see
// DEC-026's own audit) rather than freshly authored -- all three carry
// hard-won, forensically-evidenced anti-hallucination language and
// mechanical grounding checks a fresh rewrite would not.
//
// Tool EXECUTION runs in THIS process (the orchestrator/main process),
// never inside the isolated Qwen child -- DEC-026's Decision 2: the real
// Stage-2/Stage-1 Knowledge Base operations are pure, dependency-light JS
// with no native/Electron requirement, so keeping them here (a) never
// widens the isolated child's own crash-sensitive surface beyond what
// Stage 3/3.1 already qualified, and (b) needs no bidirectional RPC
// round-trip complexity beyond the single tool-call/tool-result message
// pair qwenRuntime's own extended protocol already provides.

const { HandleSession, createKnowledgeOperations } = require('../../scripts/product-docs/lib/askKnowledge/index');
const { SYSTEM_PROMPT } = require('./systemPrompt');
const { buildToolDefinitions } = require('./toolDefinitions');
const { validateFinalAnswer, containProtocolArtifacts } = require('./answerValidator');
const { pruneHistoryToFit } = require('./historyPruning');
const { estimateTokens } = require('./contextBudget');
const { OrchestratorError, mapUnknownError } = require('./errors');

// runtime is required lazily inside methods that need it (not at module
// load time) so this file's own pure logic (cache-key normalization)
// stays testable without ever touching qwenRuntime/runtime.js's own
// Electron-dependent _realSpawn default at require() time.
function getRuntime() {
  return require('../qwenRuntime/runtime');
}

// Section 18: bounded tool-action loop. Evidence for this number: the
// qualified Checkpoint 14 bench engine's own MAX_TOOL_CALLS_PER_TURN
// constant (`scripts/product-docs/bench/orchestrator/engineC14.js:19`,
// verified directly, not guessed) -- the most mature checkpoint's own
// closure-tested value, carried forward as the evidenced production
// default (DEC-026).
const DEFAULT_MAX_TOOL_ACTIONS_PER_TURN = 6;
// Section 26: bounded regeneration -- one extra attempt with the SAME
// Qwen model before falling back (Section 27), matching the qualified
// Checkpoint 14 engine's own single-retry regeneration design
// (`engineC14.js`'s `regenerateWithoutLeak`, called at most once per turn).
const DEFAULT_MAX_REGENERATIONS = 1;
// Section 15: this turn's own generation allowance, matching the
// qualified Checkpoint 14 engine's own MAX_TOKENS (`engineC14.js:20`).
const DEFAULT_MAX_TOKENS_PER_TURN = 700;

// The exact terse redirect the qualified Checkpoint 14 engine returns
// once a turn's tool-call budget is spent (action-limit OR a duplicate
// call -- see the RB27 comment on _executeTool below) -- promoted
// verbatim, not paraphrased, since this specific wording is itself
// hard-won: earlier phrasings invited the model to keep narrating about
// the limit rather than simply answering.
const ACTION_BUDGET_REDIRECT = { note: 'Tool-call budget reached for this turn. Answer now with what you already have, or ask the operator a clarifying question.' };

function normalizeParamsForCacheKey(params) {
  const sorted = {};
  for (const key of Object.keys(params || {}).sort()) {
    const v = params[key];
    sorted[key] = typeof v === 'string' ? v.trim() : v;
  }
  return JSON.stringify(sorted);
}

// Section 26: redirects Qwen toward answering directly, never frames this
// as "your previous answer was rejected" (found, in the qualified
// Checkpoint 14 engine's own design, to invite meta-commentary like "Let
// me rephrase..." when framed that way). References the specific
// violation so the correction is concrete, not generic; explicitly tells
// the model not to call tools again (the grounding it needs is already in
// its own conversation history from the original turn).
function buildRegenerationMessage(findings) {
  const hardFinding = (findings || []).find((f) => f.severity === 'HARD_SAFETY');
  const reason = hardFinding ? hardFinding.detail : 'the answer had a problem';
  return `[System reminder, not something the operator said.] Your previous draft had a problem: ${reason}. Do not rewrite that draft and do not describe what you will do differently -- just give your direct answer to the operator's actual last message now, in your own words, going straight to the substance. No ids, handles, file paths, function names, reference codes, or narration of your own process. Do not call any tools; use only what you already found.`;
}

// Section 27: fallbacks read like product UX, never expose internals. One
// per violation family that plausibly recurs after regeneration is
// exhausted -- deliberately not a large blacklist-style map.
function pickFallback(finalText, findings) {
  const isEmpty = !String(finalText || '').trim();
  if (isEmpty) return 'I don\'t have enough confirmed AutoIngest information to answer that confidently.';
  const codes = new Set((findings || []).map((f) => f.code));
  if (codes.has('ungrounded-capability-claim') || codes.has('ungrounded-identity-claim') || codes.has('contradicted-relationship-assertion')) {
    return 'I don\'t have enough confirmed AutoIngest information to answer that confidently.';
  }
  return 'I couldn\'t give you a reliable answer to that yet. Could you try asking in a different way?';
}

class OrchestratorSession {
  constructor({ sessionId, knowledgeContext, maxToolActionsPerTurn = DEFAULT_MAX_TOOL_ACTIONS_PER_TURN, maxRegenerations = DEFAULT_MAX_REGENERATIONS, maxTokensPerTurn = DEFAULT_MAX_TOKENS_PER_TURN }) {
    this.sessionId = sessionId;
    this.knowledgeContext = knowledgeContext;
    this.maxToolActionsPerTurn = maxToolActionsPerTurn;
    this.maxRegenerations = maxRegenerations;
    this.maxTokensPerTurn = maxTokensPerTurn;

    this.handleSession = new HandleSession();
    this.knowledgeOps = createKnowledgeOperations(knowledgeContext, this.handleSession);
    this._toolDefs = buildToolDefinitions(this.knowledgeOps);
    this._toolSchemas = Object.fromEntries(Object.entries(this._toolDefs).map(([name, def]) => [name, { description: def.description, params: def.params }]));

    this._sessionToolLog = []; // Section 22: every tool call this whole conversation, for grounding checks
    this._created = false;
    this.busy = false;
    this.turnNumber = 0;

    // Section 32: structural diagnostics only -- never operator text.
    this.diagnostics = {
      toolActionCounts: {}, regenerationCount: 0, fallbackCount: 0,
      cancellationCount: 0, resetCount: 0, freshContextCount: 0,
    };
  }

  async create() {
    if (this._created) return;
    this._registerHandlers();
    await getRuntime().createSession({ sessionId: this.sessionId, toolSchemas: this._toolSchemas, systemInstruction: SYSTEM_PROMPT });
    this._created = true;
  }

  _registerHandlers() {
    const handlers = {};
    for (const name of Object.keys(this._toolDefs)) {
      handlers[name] = (params) => this._executeTool(name, params);
    }
    getRuntime().registerSessionToolHandlers(this.sessionId, handlers);
  }

  // Section 18-20: the single choke point every tool call passes through.
  //
  // RB27 forensic finding (promoted from the qualified Checkpoint 14
  // engine, DEC-026): a REPEATED call must trip the SAME hard circuit
  // breaker as the action-count ceiling, not merely return its cached
  // result and continue -- returning the cache alone still let the model
  // keep narrating around and re-attempting an already-answered request
  // until maxTokens did the job much later and much more expensively.
  // Once `_turnCapped` is set (by hitting the count ceiling OR by any
  // duplicate call), every further call this turn -- of ANY tool/args,
  // not just the one that tripped it -- gets the identical terse redirect
  // immediately, giving the model no new material to loop on.
  async _executeTool(name, params) {
    if (this._turnCapped) return ACTION_BUDGET_REDIRECT;
    if (this._turnActionCount >= this.maxToolActionsPerTurn) {
      this._turnCapped = true;
      return ACTION_BUDGET_REDIRECT;
    }

    const cacheKey = `${name}:${normalizeParamsForCacheKey(params)}`;
    if (this._turnCallCache.has(cacheKey)) {
      this._turnCapped = true;
      return ACTION_BUDGET_REDIRECT;
    }

    this._turnActionCount += 1;
    this.diagnostics.toolActionCounts[name] = (this.diagnostics.toolActionCounts[name] || 0) + 1;

    const t0 = Date.now();
    let result;
    let malformed = false;
    try {
      result = await this._toolDefs[name].handlerImpl(params);
    } catch (err) {
      malformed = true;
      result = { error: 'malformed_call', note: String((err && err.message) || err) };
    }
    this._turnCallCache.set(cacheKey, result);
    const logEntry = { tool: name, args: params, result, ms: Date.now() - t0, malformed };
    this._turnCallsThisTurn.push(logEntry);
    this._sessionToolLog.push(logEntry);
    // Section 23: known-handle leak scan needs every handle this whole
    // session has ever issued, not just this turn's.
    if (name === 'search_autoingest' && result && Array.isArray(result.results)) {
      for (const r of result.results) if (r.handle) this._allIssuedHandles.add(r.handle);
    }
    return result;
  }

  // Section 28/19: cancellation follows the exact Stage-3/3.1 "stop
  // waiting, don't interrupt" strategy one level up -- this promise
  // rejects immediately on abort; the underlying child keeps running
  // (including any in-flight tool-call loop) to natural completion in
  // the background, discarded when it eventually resolves.
  // Section 26: a bounded regeneration-without-leak attempt must not be
  // able to re-enter the tool-calling cycle -- `noFunctions` (wired
  // through runtime.js/runtimeWorker.js's own `functions`-omission
  // support) is a structural guarantee rather than relying on
  // instruction-following alone; the model already has everything it
  // needs from its own conversation history.
  async _promptOnce(message, { signal, timeoutMs, noFunctions = false } = {}) {
    try {
      return await getRuntime().promptSession({ sessionId: this.sessionId, message, maxTokens: this.maxTokensPerTurn, timeoutMs, signal, noFunctions });
    } catch (err) {
      const mapped = mapUnknownError(err);
      if (mapped.code === 'INFERENCE_CANCELLED') {
        this.diagnostics.cancellationCount += 1;
        throw new OrchestratorError('TURN_CANCELLED', 'turn cancelled');
      }
      throw mapped;
    }
  }

  // Section 29: one active turn per session at a time -- a second call
  // while busy is rejected with a typed SESSION_BUSY outcome (this
  // harness's own choice; a future IPC layer may instead queue
  // deterministically, per the brief's own "choose one" framing).
  async sendMessage(userText, { signal, timeoutMs = 120000 } = {}) {
    if (!this._created) throw new OrchestratorError('SESSION_NOT_FOUND', 'call create() before sendMessage()');
    if (this.busy) throw new OrchestratorError('SESSION_BUSY', 'a turn is already in progress on this session');

    this.busy = true;
    this.turnNumber += 1;
    this._turnActionCount = 0;
    this._turnCallCache = new Map();
    this._turnCallsThisTurn = [];
    this._turnCapped = false;
    if (!this._allIssuedHandles) this._allIssuedHandles = new Set();

    try {
      await this._ensureBudgetBeforeTurn(userText);
      let outcome;
      try {
        outcome = await this._promptOnce(userText, { signal, timeoutMs });
      } catch (err) {
        // Stage 4.1 real-model qualification (Section 14) evidence: even
        // with the proactive pre-turn check above, a single turn whose OWN
        // combined prompt (existing history + this user message) overflows
        // can still surface CONTEXT_LIMIT from node-llama-cpp's own default
        // context-shift strategy mid-prompt, before _ensureBudgetBeforeTurn
        // could have known. One deterministic fresh-context retry, exactly
        // the same recovery _maybePrune() already uses post-turn, rather
        // than letting the raw error (and an unusable session) reach the
        // caller.
        if (err.code === 'CONTEXT_LIMIT') {
          this.diagnostics.freshContextCount += 1;
          await getRuntime().resetSession({ sessionId: this.sessionId, toolSchemas: this._toolSchemas, systemInstruction: SYSTEM_PROMPT });
          outcome = await this._promptOnce(userText, { signal, timeoutMs });
        } else {
          throw err;
        }
      }
      // Section 23 defense-in-depth: node-llama-cpp's own responseText is
      // already the library's defined "plain visible text" (thought
      // segments and function-call structure excluded per its own
      // LlamaChatSession.d.ts -- see runtimeWorker.js's own handler), so
      // this is normally a no-op. containProtocolArtifacts (promoted from
      // validatorC10.js, DEC-026) is applied anyway, unconditionally,
      // before validation and before this text is ever used as the
      // candidate answer -- a structural backstop against a raw Qwen-
      // family control token reaching validateFinalAnswer or the operator
      // in the event responseText's own guarantee doesn't hold for some
      // future node-llama-cpp version or edge case, never relied on as
      // the ONLY protection.
      outcome = { ...outcome, text: containProtocolArtifacts(outcome.text).text };
      let validation = validateFinalAnswer({ finalText: outcome.text, toolCalls: this._turnCallsThisTurn, sessionToolLog: this._sessionToolLog });
      let regenerationCount = 0;

      while (!validation.ok && regenerationCount < this.maxRegenerations) {
        regenerationCount += 1;
        this.diagnostics.regenerationCount += 1;
        outcome = await this._promptOnce(buildRegenerationMessage(validation.findings), { signal, timeoutMs, noFunctions: true });
        outcome = { ...outcome, text: containProtocolArtifacts(outcome.text).text };
        validation = validateFinalAnswer({ finalText: outcome.text, toolCalls: this._turnCallsThisTurn, sessionToolLog: this._sessionToolLog });
      }

      let finalText = outcome.text;
      let usedFallback = false;
      if (!validation.ok) {
        usedFallback = true;
        this.diagnostics.fallbackCount += 1;
        finalText = pickFallback(finalText, validation.findings);
      }

      await this._maybePrune();

      return {
        text: finalText, toolCalls: outcome.toolCalls || [], grounding: this._turnCallsThisTurn,
        validation, regenerated: regenerationCount > 0, usedFallback, turnNumber: this.turnNumber,
        stopReason: outcome.stopReason,
      };
    } finally {
      this.busy = false;
    }
  }

  // Stage 4.1, Section 14 (real-model qualification finding): _maybePrune()
  // below only runs AFTER a turn completes, so it cannot help when the
  // history handed INTO a turn is already over budget -- real-model
  // qualification demonstrated this concretely: a history exceeding
  // AVAILABLE_FOR_HISTORY, injected through the real orchestrator/runtime
  // path, produced a raw CONTEXT_LIMIT from node-llama-cpp's own default
  // context-shift strategy on the very next sendMessage(), and the session
  // stayed unusable afterward because nothing had ever pruned it. This
  // mirrors _maybePrune()'s own pruning hierarchy, just run BEFORE the
  // prompt instead of after, so the common case (history grows over budget
  // for any reason other than this stage's own post-turn pruning, e.g. a
  // future caller injecting/restoring history) is caught deterministically
  // rather than relying on node-llama-cpp's own internal recovery.
  async _ensureBudgetBeforeTurn(userText) {
    const runtime = getRuntime();
    const history = await runtime.getSessionHistory(this.sessionId);
    const result = pruneHistoryToFit(history, estimateTokens(userText));
    if (result.needsFreshContext) {
      this.diagnostics.freshContextCount += 1;
      await runtime.resetSession({ sessionId: this.sessionId, toolSchemas: this._toolSchemas, systemInstruction: SYSTEM_PROMPT });
      return;
    }
    if (result.pruned) {
      await runtime.setSessionHistory(this.sessionId, result.history);
    }
  }

  // Section 15/16: applied after every turn, never mid-generation. Reads
  // the REAL node-llama-cpp history, applies the deterministic pruning
  // hierarchy, and writes the pruned result back -- only when needed
  // (pruneHistoryToFit is a no-op when already within budget).
  async _maybePrune() {
    const runtime = getRuntime();
    const history = await runtime.getSessionHistory(this.sessionId);
    const result = pruneHistoryToFit(history);
    // Section 32: "context token usage" is a required diagnostics field --
    // pruneHistoryToFit() already computes this estimate as part of its
    // own budget decision (contextBudget.js's computeBudget()), so this is
    // free to surface, not a second measurement, and stays consistent with
    // whatever pruning decision was actually made for this turn.
    this.diagnostics.contextTokenUsage = result.budget;
    if (result.needsFreshContext) {
      // Section 16 point 4: deterministic pruning could not fit even at
      // the hard floor -- start a fresh Qwen context. The deterministic
      // conversation-state representation retained across this boundary
      // is this session's own HandleSession/grounding bookkeeping
      // (unchanged below), not the model's own verbatim turn history,
      // per this stage's own explicit choice not to implement model-
      // based self-summarization (historyPruning.js's own header).
      this.diagnostics.freshContextCount += 1;
      await runtime.resetSession({ sessionId: this.sessionId, toolSchemas: this._toolSchemas, systemInstruction: SYSTEM_PROMPT });
      return;
    }
    if (result.pruned) {
      await runtime.setSessionHistory(this.sessionId, result.history);
    }
  }

  // Section 30: clears Qwen conversational context, session handles,
  // turn-local grounding state, and the duplicate-tool cache -- never
  // unloads the model (model lifecycle and conversation lifecycle are
  // separate, per that section's own explicit instruction).
  async reset() {
    this.handleSession = new HandleSession();
    this.knowledgeOps = createKnowledgeOperations(this.knowledgeContext, this.handleSession);
    this._toolDefs = buildToolDefinitions(this.knowledgeOps);
    this._sessionToolLog = [];
    this._allIssuedHandles = new Set();
    this.turnNumber = 0;
    this.diagnostics.resetCount += 1;
    await getRuntime().resetSession({ sessionId: this.sessionId, toolSchemas: this._toolSchemas, systemInstruction: SYSTEM_PROMPT });
  }

  async dispose() {
    await getRuntime().disposeSession(this.sessionId);
    getRuntime().unregisterSessionToolHandlers(this.sessionId);
    this._created = false;
  }

  // Section 32: structural diagnostics only. Deliberately has no field
  // that could carry operator messages, generated answers, or raw tool-
  // result text -- same discipline as qwenRuntime's own getDiagnostics().
  getDiagnostics() {
    return {
      sessionId: this.sessionId, turnNumber: this.turnNumber, busy: this.busy,
      knownHandleCount: this.handleSession.size(), ...this.diagnostics,
    };
  }
}

module.exports = {
  OrchestratorSession,
  DEFAULT_MAX_TOOL_ACTIONS_PER_TURN, DEFAULT_MAX_REGENERATIONS, DEFAULT_MAX_TOKENS_PER_TURN,
  normalizeParamsForCacheKey, buildRegenerationMessage, pickFallback,
};
