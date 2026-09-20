'use strict';

// ASK AUTOINGEST — CHECKPOINT 8: model/runtime reliability evaluation.
// EXPERIMENTAL.
//
// This file exists ONLY because engine.js -- the frozen Checkpoint-7
// control -- hardcodes Gemma4ChatWrapper (`const { getLlama,
// Gemma4ChatWrapper } = await nllc();` / `new engine.Gemma4ChatWrapper(...)`)
// and the checkpoint's own instruction is explicit: preserve every
// Checkpoint-7 file and hash, including engine.js itself. There is no way
// to swap the chat-wrapper class without either editing that frozen file
// or duplicating its orchestration logic elsewhere. This file is the
// disclosed, minimal duplication choice: everything that is NOT
// model-identity-specific is imported directly from the frozen files
// (SYSTEM_PROMPT, MAX_TOKENS, MAX_TOOL_CALLS_PER_TURN from engine.js;
// buildToolDefinitions from tools.js; validateFinalAnswer/
// checkStructuralLeak/containProtocolArtifacts from validator.js;
// makeSemanticTopK from semanticRetrieval.js) -- NOT reimplemented, so
// there is no behavioral drift between what Gemma ran under and what
// these candidates run under. The only genuinely new code below is the
// chat-wrapper selection/instantiation and the load/converse plumbing
// needed to wire a different model in -- copied verbatim in structure
// from engine.js's own createConversation/converse (same completion
// check, same regeneration backstop, same protocol containment, same
// order of operations), not redesigned.
//
// tools.js/validator.js/engine.js/runConversations.js/semanticRetrieval.js
// and all five evaluation-set files are UNCHANGED by this checkpoint --
// verified by hash before this file was written (see the report).

const { buildToolDefinitions } = require('./tools');
const { validateFinalAnswer, checkStructuralLeak, containProtocolArtifacts } = require('./validator');
const { makeSemanticTopK } = require('./semanticRetrieval');
const { SYSTEM_PROMPT, MAX_TOOL_CALLS_PER_TURN, MAX_TOKENS } = require('./engine');

const MAX_COMPLETION_CONTINUATIONS = 1;

let _nllc = null;
async function nllc() {
  if (!_nllc) _nllc = await import('node-llama-cpp');
  return _nllc;
}

// Per-candidate chat-wrapper selection -- the ONE piece of "runtime-specific
// chat-wrapper configuration" the checkpoint permits, disclosed here and in
// the report. Each candidate's wrapper class is the one node-llama-cpp
// itself ships specifically for that model family (verified present in
// this installed version: QwenChatWrapper, Llama3_1ChatWrapper,
// MistralChatWrapper -- see the report's Phase-0 chat-wrapper audit),
// chosen explicitly rather than left to auto-detection, for the same
// reason Gemma needed an explicit wrapper in Checkpoint 5: predictable,
// disclosed behavior over relying on template auto-detection to guess
// correctly. No generation-parameter or prompt changes are made per
// candidate beyond this.
const CHAT_WRAPPER_FACTORIES = {
  qwen3: async () => { const { QwenChatWrapper } = await nllc(); return new QwenChatWrapper(); },
  llama31: async () => { const { Llama3_1ChatWrapper } = await nllc(); return new Llama3_1ChatWrapper(); },
  mistral: async () => { const { MistralChatWrapper } = await nllc(); return new MistralChatWrapper(); },
};

async function loadEngine({ modelPath, wrapperKey, embeddingModelDir, semanticIndexDir }) {
  const { getLlama } = await nllc();
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  let semanticTopK = null;
  if (embeddingModelDir && semanticIndexDir) {
    semanticTopK = makeSemanticTopK({ modelDir: embeddingModelDir, indexDir: semanticIndexDir });
  }
  if (!CHAT_WRAPPER_FACTORIES[wrapperKey]) throw new Error(`Unknown wrapperKey: ${wrapperKey}`);
  return { llama, model, wrapperKey, semanticTopK };
}

// Structurally identical to engine.js's own createConversation -- same
// completion check, same regeneration backstop, same protocol-containment
// step, same order of operations. Only the chat-wrapper instantiation and
// (necessarily) the re-declared local constants differ.
async function createConversation(engine, ctx) {
  const { LlamaChatSession, defineChatSessionFunction } = await nllc();
  const context = await engine.model.createContext({ sequences: 1 });
  const chatWrapper = await CHAT_WRAPPER_FACTORIES[engine.wrapperKey]();
  const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt: SYSTEM_PROMPT, chatWrapper });

  const sessionToolLog = [];

  function buildFunctions(recorder) {
    const rawDefs = buildToolDefinitions(ctx, { semanticTopK: engine.semanticTopK });
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
          let result;
          let malformed = false;
          try {
            result = await def.handlerImpl(args);
          } catch (err) {
            malformed = true;
            result = { error: String(err && err.message || err) };
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
    const correction = `Your previous answer had a problem: ${reason}. Rewrite your last answer conveying the same information naturally for the operator, in your own words, using plain feature names only -- never ids, file paths, function names, or other internal references, and never state a capability status without having checked it. Do not call any tools; use only what you already found.`;
    const t0 = Date.now();
    const text = await session.prompt(correction, { maxTokens: MAX_TOKENS });
    return { text, ms: Date.now() - t0 };
  }

  async function converse(userMessage) {
    const recorder = { calls: [], capped: false, callsThisContinuation: 0 };
    const functions = buildFunctions(recorder);

    const t0 = Date.now();
    const initialCallCount = recorder.calls.length;
    let stopReason = null;
    try {
      const meta = await session.promptWithMeta(userMessage, { functions, maxTokens: MAX_TOKENS });
      recorder.lastText = meta.responseText;
      stopReason = meta.stopReason;
    } catch (err) {
      recorder.lastText = '';
      recorder.exceptionDuringPrompt = String(err && err.stack || err);
    }
    recorder.callsThisContinuation = recorder.calls.length - initialCallCount;
    let totalMs = Date.now() - t0;

    let finalText = await maybeCompleteTurn(recorder, functions);
    totalMs += recorder.continuationMs || 0;
    const completionContinuations = recorder.continuations || 0;
    sessionToolLog.push(...recorder.calls);

    let validation = validateFinalAnswer({ finalText, toolCalls: recorder.calls, sessionToolLog });
    let regenerated = false;
    let regenerationOutcome = null;

    if (!validation.ok) {
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
        finalText = "I found information related to that, but I'm having trouble explaining it without getting into internal details. Could you rephrase your question, or ask about a more specific part of it?";
        validation = { ok: true, findings: [{ severity: 'SOFT_QUALITY', code: 'regeneration-fallback-used', detail: `Original: ${hardFinding.code}. Regeneration still failed; short neutral fallback shown instead.` }] };
        regenerationOutcome = 'fallback';
      }
    }

    const contained = containProtocolArtifacts(finalText);
    finalText = contained.text;

    const malformedToolCalls = recorder.calls.filter((c) => c.malformed).length;
    const emptyFinal = !String(finalText || '').trim();

    return {
      finalText, toolCalls: recorder.calls, capped: recorder.capped, totalMs, validation, regenerated, regenerationOutcome,
      completionContinuations, protocolArtifactsStripped: contained.stripped, stopReason, malformedToolCalls, emptyFinal,
      exceptionDuringPrompt: recorder.exceptionDuringPrompt || null,
    };
  }

  async function dispose() {
    await context.dispose().catch(() => {});
  }

  return { converse, dispose, sessionToolLog };
}

module.exports = { loadEngine, createConversation, CHAT_WRAPPER_FACTORIES };
