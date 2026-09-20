'use strict';

// ASK AUTOINGEST — CHECKPOINT 10: FIND THE ONE AUTOINGEST BRAIN. EXPERIMENTAL.
//
// The Checkpoint-9 architecture is the CONTROL, held fixed: this file
// imports `buildToolDefinitions`/`HandleSession` from knowledgeAccessC9.js
// and the structural checks from validatorC10.js (which itself reuses
// EVERY non-model-specific check from validatorC9.js unmodified -- see
// that file's own header). Nothing about the knowledge-access design,
// the handle protocol, the tool contracts, or the orchestration LOOP
// SHAPE (mechanical completion check, one-shot regeneration backstop,
// protocol containment as the absolute last step) changes here. The only
// variable this checkpoint tests is the chat wrapper / model.
//
// engineC9.js itself is NOT modified or reused directly (it hardcodes
// Gemma4ChatWrapper) -- this file exists only because the checkpoint
// requires swapping the model, exactly the same disclosed-necessity
// pattern Checkpoint 8's engineMultiModel.js used for the same reason.

const { buildToolDefinitions, HandleSession } = require('./knowledgeAccessC9');
const { validateFinalAnswer, containProtocolArtifacts } = require('./validatorC10');

const MAX_TOOL_CALLS_PER_TURN = 6;
const MAX_TOKENS = 700;
const MAX_COMPLETION_CONTINUATIONS = 1;

let _nllc = null;
async function nllc() {
  if (!_nllc) _nllc = await import('node-llama-cpp');
  return _nllc;
}

// Identical in substance to engineC9.js's SYSTEM_PROMPT (byte-for-byte
// reused wording) -- only the header framing sentence is unchanged from
// that frozen file's own text. Not re-tuned per candidate (the checkpoint
// brief: "do not tune retrieval for individual models").
const SYSTEM_PROMPT = `You are the Ask AutoIngest assistant -- a knowledgeable, conversational colleague helping an AutoIngest operator. You are the one conversational intelligence here; your tools are a trusted reference library, not something to mention to the operator. Never say "records", "handles", "search results", "the knowledge base", or describe your own process out loud -- just know things and answer, the way a colleague does. Do not begin a reply with "Based on...", "According to...", "Let me check...", or any other narration of what you looked up -- go straight to the answer.

Talk naturally and concisely, like a capable human colleague, not documentation. Use what you learn from your tools to explain things in your own words; never quote text verbatim, and never mention ids, handles, file names, function names, or other implementation details unless the operator explicitly asked a technical question and you deliberately looked that detail up for them.

Your tools:
- search_autoingest(query) finds AutoIngest subjects (features/workflows) that might match what the operator means. Results come back as short-lived handles like "H3" with a title and purpose -- never invent a handle, always get it from a search result first. For almost any question naming or implying a specific AutoIngest subject, search FIRST -- it's cheap, and it usually resolves things immediately without needing to ask the operator anything.
- read_autoingest(handle, dimensions) fetches the specific facts you need (purpose, behavior, how-to steps, recovery, limitations, technical detail, etc) about a subject you already have a handle for -- fetch only what this question needs.
- capability_status(handle) is the one authoritative source for whether AutoIngest supports, does, or doesn't do something. Always call it before making that kind of claim, and never contradict what it returns.
- roadmap_status(query) is the authoritative source for what's done, in progress, or planned -- use it for open-ended "what's next"/"what's done" style questions, not just named-subject ones.

A handle that turns out invalid is your own bookkeeping mistake, not evidence about AutoIngest -- search again rather than concluding AutoIngest lacks something. Likewise, one weak or empty search is not proof AutoIngest lacks a capability -- try different wording before giving up. Only capability_status's actual answer is the real truth about whether something exists. Resolve which handle or dimension to use yourself -- never ask the operator to choose one for you.

Ask a clarifying question only when you genuinely need the answer to help AND searching wouldn't resolve it -- if the operator already told you enough, or a quick search would find out, just do that instead of asking. Remember the conversation: short replies like "yes" or "that one" refer back to what you just said. If AutoIngest's knowledge genuinely doesn't cover something, say so honestly rather than guessing or inventing a feature, button, or workflow.`;

// CHAT_WRAPPER_FACTORIES -- one entry per candidate this checkpoint tests.
// Each factory is a thin, disclosed wrapper-construction choice (variation/
// thoughts settings), never a prompt or tool change.
const CHAT_WRAPPER_FACTORIES = {
  // Qwen3.5-4B / Qwen3.5-9B: node-llama-cpp 3.20.0 has EXPLICIT, dedicated
  // support for the Qwen3.5 template shape (variation "3.5", confirmed by
  // direct read of QwenChatWrapper.d.ts -- not the generic Qwen3 shape).
  qwen35: (nllcMod) => new nllcMod.QwenChatWrapper({ variation: '3.5', thoughts: 'discourage' }),
  // Hermes-4-14B: fine-tuned from Qwen3-14B, its own model card documents
  // the exact <tool_call>{"name":...} format matching QwenChatWrapper's
  // variation "3" (the default) precisely -- verified against the actual
  // installed wrapper source, not assumed from the model card alone.
  qwen3: (nllcMod) => new nllcMod.QwenChatWrapper({ variation: '3', thoughts: 'discourage' }),
};

async function loadEngine({ modelPath, wrapperKey }) {
  const nllcMod = await nllc();
  const llama = await nllcMod.getLlama();
  const model = await llama.loadModel({ modelPath });
  return { llama, model, nllcMod, wrapperKey };
}

async function createConversation(engine, ctx, built) {
  const { LlamaChatSession, defineChatSessionFunction } = engine.nllcMod;
  const context = await engine.model.createContext({ sequences: 1 });
  const chatWrapper = CHAT_WRAPPER_FACTORIES[engine.wrapperKey](engine.nllcMod);
  const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt: SYSTEM_PROMPT, chatWrapper });

  const handleSession = new HandleSession();
  const sessionToolLog = [];

  function buildFunctions(recorder) {
    const rawDefs = buildToolDefinitions(ctx, built, handleSession);
    const functions = {};
    for (const [name, def] of Object.entries(rawDefs)) {
      functions[name] = defineChatSessionFunction({
        description: def.description,
        params: def.params,
        handler: async (args) => {
          if (recorder.calls.length >= MAX_TOOL_CALLS_PER_TURN) {
            recorder.capped = true;
            return { note: 'Tool-call budget reached for this turn. Answer now with what you already have, or ask the operator a clarifying question.' };
          }
          const t0 = Date.now();
          let result, malformed = false;
          try {
            result = await def.handlerImpl(args);
          } catch (err) {
            malformed = true;
            result = { error: 'malformed_call', note: String(err && err.message || err) };
          }
          recorder.calls.push({ tool: name, args, result, ms: Date.now() - t0, malformed });
          return result;
        },
      });
    }
    return functions;
  }

  function looksStructurallyIncomplete(text, toolCallsThisTurn) {
    if (toolCallsThisTurn > 0) return false;
    const t = String(text || '').trim();
    if (!t) return true;
    return !t.endsWith('?');
  }

  async function maybeCompleteTurn(recorder, functions) {
    let attempts = 0;
    let text = recorder.lastText;
    let callsThisPass = recorder.callsThisContinuation;
    while (attempts < MAX_COMPLETION_CONTINUATIONS && looksStructurallyIncomplete(text, callsThisPass)) {
      attempts++;
      const nudge = 'Your previous reply to the operator was not yet a complete answer or question. If you need to check something to answer the operator\'s actual message, use a tool now. Then give your complete, final answer or question to the operator in this same reply.';
      const beforeCount = recorder.calls.length;
      const t0 = Date.now();
      text = await session.prompt(nudge, { functions, maxTokens: MAX_TOKENS });
      callsThisPass = recorder.calls.length - beforeCount;
      recorder.continuationMs = (recorder.continuationMs || 0) + (Date.now() - t0);
      recorder.continuations = (recorder.continuations || 0) + 1;
    }
    return text;
  }

  async function regenerateWithoutLeak(reason) {
    const correction = `Your previous answer had a problem: ${reason}. Rewrite your last answer conveying the same information naturally for the operator, in your own words, going straight to the answer -- no ids, handles, file paths, function names, or narration of your own process, and never state a capability status without having checked it. Do not call any tools; use only what you already found.`;
    const t0 = Date.now();
    const text = await session.prompt(correction, { maxTokens: MAX_TOKENS });
    return { text, ms: Date.now() - t0 };
  }

  async function converse(userMessage) {
    const recorder = { calls: [], capped: false, callsThisContinuation: 0 };
    const functions = buildFunctions(recorder);

    const t0 = Date.now();
    const initialCallCount = recorder.calls.length;
    let stopReason = null, exceptionDuringPrompt = null;
    try {
      const meta = await session.promptWithMeta(userMessage, { functions, maxTokens: MAX_TOKENS });
      recorder.lastText = meta.responseText;
      stopReason = meta.stopReason;
    } catch (err) {
      exceptionDuringPrompt = String(err && err.message || err);
      recorder.lastText = '';
    }
    recorder.callsThisContinuation = recorder.calls.length - initialCallCount;
    let totalMs = Date.now() - t0;

    let finalText = exceptionDuringPrompt ? '' : await maybeCompleteTurn(recorder, functions);
    totalMs += recorder.continuationMs || 0;
    const completionContinuations = recorder.continuations || 0;
    sessionToolLog.push(...recorder.calls);

    let validation = validateFinalAnswer({ finalText, toolCalls: recorder.calls, sessionToolLog });
    let regenerated = false;
    let regenerationOutcome = null;

    if (!exceptionDuringPrompt && !validation.ok) {
      const hardFinding = validation.findings.find((f) => f.severity === 'HARD_SAFETY');
      const attempt = await regenerateWithoutLeak(hardFinding.detail);
      totalMs += attempt.ms;
      regenerated = true;
      const revalidated = validateFinalAnswer({ finalText: attempt.text, toolCalls: recorder.calls, sessionToolLog });
      if (revalidated.ok) {
        finalText = attempt.text;
        validation = revalidated;
        regenerationOutcome = 'fixed';
      } else {
        finalText = "I found information related to that, but I'm having trouble explaining it clearly. Could you rephrase your question, or ask about a more specific part of it?";
        validation = { ok: true, findings: [{ severity: 'SOFT_QUALITY', code: 'regeneration-fallback-used', detail: `Original: ${hardFinding.code}. Regeneration still failed; short neutral fallback shown instead.` }] };
        regenerationOutcome = 'fallback';
      }
    }

    const contained = containProtocolArtifacts(finalText);
    finalText = contained.text;

    const malformedToolCalls = recorder.calls.filter((c) => c.malformed).length;

    return {
      finalText, toolCalls: recorder.calls, capped: recorder.capped, totalMs, validation, regenerated, regenerationOutcome,
      completionContinuations, protocolArtifactsStripped: contained.stripped,
      handleMapSize: handleSession._byHandle.size,
      stopReason, exceptionDuringPrompt, malformedToolCalls,
      emptyFinal: !exceptionDuringPrompt && !String(finalText || '').trim(),
    };
  }

  async function dispose() {
    await context.dispose().catch(() => {});
  }

  return { converse, dispose, sessionToolLog, handleSession };
}

module.exports = { loadEngine, createConversation, SYSTEM_PROMPT, CHAT_WRAPPER_FACTORIES, MAX_TOOL_CALLS_PER_TURN, MAX_TOKENS };
