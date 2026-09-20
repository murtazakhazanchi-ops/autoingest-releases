'use strict';

// ASK AUTOINGEST — CHECKPOINT 9: ONE BRAIN, ONE ASSISTANT. EXPERIMENTAL,
// ISOLATED PROTOTYPE. Not wired to production/conversationalAsk.js.
//
// Structurally identical orchestration loop to engine.js (Checkpoint 7's
// frozen control, kept byte-identical, untouched) -- the mechanical
// turn-completion check, the one-shot regeneration backstop, and the
// protocol-containment last step are all REUSED, not reinvented, because
// Checkpoint 7/8 already proved them structurally sound; Checkpoint 8's
// NO-GO was about MODEL reliability and tool-interface cognitive load, not
// this orchestration shape. What changed:
//
//   - buildToolDefinitions comes from knowledgeAccessC9.js (handle-based,
//     BGE-free, concept-framed) instead of tools.js.
//   - validateFinalAnswer/checkStructuralLeak come from validatorC9.js
//     (adds handle-leak detection, the fixed capability-claim regex, the
//     invalid-handle-derived-conclusion check, and process-narration
//     detection -- see that file's own header for each).
//   - loadEngine() loads EXACTLY ONE model: Gemma. No embeddingModelDir
//     parameter exists on this function at all -- there is no code path
//     in this file capable of loading a second learned model. See
//     runConversationsC9.js's own model-count instrumentation for how this
//     is PROVEN, not just asserted, in the report.
//   - createConversation() constructs one HandleSession per conversation
//     (Phase 3) and threads it through both the tool layer and the
//     validator's leak checks.
//   - SYSTEM_PROMPT is rewritten for the concept-based interface: no
//     "record"/"Knowledge Model" language, teaches the not-found ≠
//     not-supported invariant and the invalid-handle protocol-error
//     distinction explicitly (Phase 5/9), and adds one short, explicit
//     rule against narrating tool use (Phase 6) -- unlike the stalling
//     fix in Checkpoint 7, there is no fully structural enforcement
//     available for narration content (see validatorC9.js's own header
//     for why), so the prompt rule plus the regeneration backstop are the
//     two real mechanisms, both measured honestly in the report rather
//     than assumed to work.

const { buildToolDefinitions, HandleSession } = require('./knowledgeAccessC9');
const { validateFinalAnswer, containProtocolArtifacts } = require('./validatorC9');

const MAX_TOOL_CALLS_PER_TURN = 6;
const MAX_TOKENS = 700;
const MAX_REGENERATION_ATTEMPTS = 1;
const MAX_COMPLETION_CONTINUATIONS = 1;

let _nllc = null;
async function nllc() {
  if (!_nllc) _nllc = await import('node-llama-cpp');
  return _nllc;
}

const SYSTEM_PROMPT = `You are the Ask AutoIngest assistant -- a knowledgeable, conversational colleague helping an AutoIngest operator. You are the one conversational intelligence here; your tools are a trusted reference library, not something to mention to the operator. Never say "records", "handles", "search results", "the knowledge base", or describe your own process out loud -- just know things and answer, the way a colleague does. Do not begin a reply with "Based on...", "According to...", "Let me check...", or any other narration of what you looked up -- go straight to the answer.

Talk naturally and concisely, like a capable human colleague, not documentation. Use what you learn from your tools to explain things in your own words; never quote text verbatim, and never mention ids, handles, file names, function names, or other implementation details unless the operator explicitly asked a technical question and you deliberately looked that detail up for them.

Your tools:
- search_autoingest(query) finds AutoIngest subjects (features/workflows) that might match what the operator means. Results come back as short-lived handles like "H3" with a title and purpose -- never invent a handle, always get it from a search result first. For almost any question naming or implying a specific AutoIngest subject, search FIRST -- it's cheap, and it usually resolves things immediately without needing to ask the operator anything.
- read_autoingest(handle, dimensions) fetches the specific facts you need (purpose, behavior, how-to steps, recovery, limitations, technical detail, etc) about a subject you already have a handle for -- fetch only what this question needs.
- capability_status(handle) is the one authoritative source for whether AutoIngest supports, does, or doesn't do something. Always call it before making that kind of claim, and never contradict what it returns.
- roadmap_status(query) is the authoritative source for what's done, in progress, or planned -- use it for open-ended "what's next"/"what's done" style questions, not just named-subject ones.

A handle that turns out invalid is your own bookkeeping mistake, not evidence about AutoIngest -- search again rather than concluding AutoIngest lacks something. Likewise, one weak or empty search is not proof AutoIngest lacks a capability -- try different wording before giving up. Only capability_status's actual answer is the real truth about whether something exists.

Ask a clarifying question only when you genuinely need the answer to help AND searching wouldn't resolve it -- if the operator already told you enough, or a quick search would find out, just do that instead of asking. Remember the conversation: short replies like "yes" or "that one" refer back to what you just said. If AutoIngest's knowledge genuinely doesn't cover something, say so honestly rather than guessing or inventing a feature, button, or workflow.`;

// Loads EXACTLY ONE learned model: Gemma. No second model-loading code
// path exists in this function -- there is no embeddingModelDir parameter,
// no import of semanticRetrieval.js/embeddingModelManager.js/
// embeddingRuntime.js anywhere in this file. Contrast with engine.js's own
// loadEngine(), which accepted embeddingModelDir/semanticIndexDir and
// loaded BGE via semanticRetrieval.js when present.
async function loadEngine({ modelPath }) {
  const { getLlama, Gemma4ChatWrapper } = await nllc();
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  return { llama, model, Gemma4ChatWrapper };
}

async function createConversation(engine, ctx, built) {
  const { LlamaChatSession, defineChatSessionFunction } = await nllc();
  const context = await engine.model.createContext({ sequences: 1 });
  const chatWrapper = new engine.Gemma4ChatWrapper({ reasoning: false });
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
          const result = await def.handlerImpl(args);
          recorder.calls.push({ tool: name, args, result, ms: Date.now() - t0 });
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
    recorder.lastText = await session.prompt(userMessage, { functions, maxTokens: MAX_TOKENS });
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
        finalText = "I found information related to that, but I'm having trouble explaining it clearly. Could you rephrase your question, or ask about a more specific part of it?";
        validation = { ok: true, findings: [{ severity: 'SOFT_QUALITY', code: 'regeneration-fallback-used', detail: `Original: ${hardFinding.code}. Regeneration still failed; short neutral fallback shown instead.` }] };
        regenerationOutcome = 'fallback';
      }
    }

    const contained = containProtocolArtifacts(finalText);
    finalText = contained.text;

    return {
      finalText, toolCalls: recorder.calls, capped: recorder.capped, totalMs, validation, regenerated, regenerationOutcome,
      completionContinuations, protocolArtifactsStripped: contained.stripped,
      handleMapSize: handleSession._byHandle.size,
    };
  }

  async function dispose() {
    await context.dispose().catch(() => {});
  }

  return { converse, dispose, sessionToolLog, handleSession };
}

module.exports = { loadEngine, createConversation, SYSTEM_PROMPT, MAX_TOOL_CALLS_PER_TURN, MAX_TOKENS };
