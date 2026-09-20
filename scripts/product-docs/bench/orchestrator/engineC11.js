'use strict';

// ASK AUTOINGEST — CHECKPOINT 11: GROUNDING DISCIPLINE, NOT BENCHMARK
// PATCHING. EXPERIMENTAL, ISOLATED PROTOTYPE.
//
// Structurally identical orchestration loop to engineC10.js (mechanical
// completion check, one-shot regeneration backstop, protocol containment
// as the absolute last step) -- the architecture and model are BOTH frozen
// this checkpoint per the brief's own explicit instruction. What changed:
//
//   - buildToolDefinitions/readAutoIngest come from knowledgeAccessC11.js
//     (adds the `hasDetail` signal -- see that file's header for the
//     forensic finding behind it).
//   - validateFinalAnswer comes from validatorC11.js (broadens capability-
//     grounding provenance to any of the three knowledge tools -- see that
//     file's header).
//   - SYSTEM_PROMPT gets ONE new paragraph reinforcing Phase 2's general
//     "knowledge before product fact" principle -- deliberately a
//     PRINCIPLE, not a rule about any specific feature, wording pattern,
//     or question shape. No regex, no keyword list, no special case for
//     any named feature is added anywhere in this file.
//   - Checkpoint 11, Phase 7 instrumentation fix: the ORIGINAL
//     pre-regeneration draft text and the exact HARD_SAFETY finding that
//     triggered it are now both recorded on the turn (`draftText`,
//     `originalFinding`) -- Checkpoint 10's own output did not preserve
//     this for successfully-fixed regenerations, a real, disclosed gap
//     found while doing this checkpoint's own Phase 7 forensics that is
//     fixed here so Phase 8/10/11's data is complete.

const { buildToolDefinitions, HandleSession } = require('./knowledgeAccessC11');
const { validateFinalAnswer, containProtocolArtifacts } = require('./validatorC11');

const MAX_TOOL_CALLS_PER_TURN = 6;
const MAX_TOKENS = 700;
const MAX_COMPLETION_CONTINUATIONS = 1;

let _nllc = null;
async function nllc() {
  if (!_nllc) _nllc = await import('node-llama-cpp');
  return _nllc;
}

// Checkpoint 11 addition: ONE new paragraph, inserted after the tool
// descriptions, stating the general grounding principle Phase 2 asks for.
// Deliberately does not name Transfer Export, QMZ, Archive Health
// Reporting, "Local Staging Root", or any other specific term from any
// failure this checkpoint found -- it must read the same to a model
// answering a question about a feature that has never failed a single
// test as to one answering about QMZ.
const SYSTEM_PROMPT = `You are the Ask AutoIngest assistant -- a knowledgeable, conversational colleague helping an AutoIngest operator. You are the one conversational intelligence here; your tools are a trusted reference library, not something to mention to the operator. Never say "records", "handles", "search results", "the knowledge base", or describe your own process out loud -- just know things and answer, the way a colleague does. Do not begin a reply with "Based on...", "According to...", "Let me check...", or any other narration of what you looked up -- go straight to the answer.

Talk naturally and concisely, like a capable human colleague, not documentation. Use what you learn from your tools to explain things in your own words; never quote text verbatim, and never mention ids, handles, file names, function names, or other implementation details unless the operator explicitly asked a technical question and you deliberately looked that detail up for them.

Your tools:
- search_autoingest(query) finds AutoIngest subjects (features/workflows) that might match what the operator means. Results come back as short-lived handles like "H3" with a title, a purpose, and hasDetail (whether real documented facts exist beyond the title/purpose) -- never invent a handle, always get it from a search result first. For almost any question naming or implying a specific AutoIngest subject, search FIRST -- it's cheap, and it usually resolves things immediately without needing to ask the operator anything.
- read_autoingest(handle, dimensions) fetches the specific facts you need (purpose, behavior, how-to steps, recovery, limitations, technical detail, etc) about a subject you already have a handle for -- fetch only what this question needs. If it comes back with no real content, that subject genuinely has no documented detail -- say so plainly, or read a different candidate that does; never invent the missing detail.
- capability_status(handle) is the one authoritative source for whether AutoIngest supports, does, or doesn't do something. Always call it before making that kind of claim, and never contradict what it returns.
- roadmap_status(query) is the authoritative source for what's done, in progress, or planned -- use it for open-ended "what's next"/"what's done" style questions, not just named-subject ones.

Before you state a concrete AutoIngest-specific fact -- a name, behavior, capability, technical detail, location, limitation, or status -- that isn't already established earlier in THIS conversation, make sure you actually have it from a tool rather than guessing at something plausible. This doesn't mean searching on every message: general conversation, opinions, clarifying questions, and anything you already found out earlier in this same conversation need no tool at all. It only applies the moment you're about to assert a specific AutoIngest fact you don't already have grounded. If what you retrieve doesn't actually cover what was asked, say that plainly instead of filling the gap with something that sounds plausible.

A handle that turns out invalid is your own bookkeeping mistake, not evidence about AutoIngest -- search again rather than concluding AutoIngest lacks something. Likewise, one weak or empty search is not proof AutoIngest lacks a capability -- try different wording before giving up. Only capability_status's actual answer is the real truth about whether something exists.

Ask a clarifying question only when you genuinely need the answer to help AND searching wouldn't resolve it -- if the operator already told you enough, or a quick search would find out, just do that instead of asking. Remember the conversation: short replies like "yes" or "that one" refer back to what you just said. If AutoIngest's knowledge genuinely doesn't cover something, say so honestly rather than guessing or inventing a feature, button, or workflow.`;

async function loadEngine({ modelPath }) {
  const { getLlama, QwenChatWrapper } = await nllc();
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  return { llama, model, QwenChatWrapper };
}

async function createConversation(engine, ctx, built) {
  const { LlamaChatSession, defineChatSessionFunction } = await nllc();
  const context = await engine.model.createContext({ sequences: 1 });
  const chatWrapper = new engine.QwenChatWrapper({ variation: '3.5', thoughts: 'discourage' });
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
          // Checkpoint 11 addition: a generic, tool-agnostic anti-redundant-
          // call guard, found necessary during Phase 8 dev testing (a
          // question with a weak first search led the model to call
          // capability_status on the same handle three times in a row,
          // wasting most of the turn's tool-call budget on identical
          // repeats). Purely mechanical -- exact tool name + exact
          // JSON-serialized args already seen THIS turn -- never inspects
          // which tool or which subject, so it applies identically to any
          // tool and any future knowledge-base content.
          const callKey = name + '::' + JSON.stringify(args);
          if (recorder.seenCallKeys && recorder.seenCallKeys.has(callKey)) {
            const result = { note: 'You already called this exact tool with these exact arguments this turn -- use what you found, or call something different (a new search, a different handle, or different dimensions).' };
            recorder.calls.push({ tool: name, args, result, ms: 0, malformed: false, deduped: true });
            return result;
          }
          recorder.seenCallKeys = recorder.seenCallKeys || new Set();
          recorder.seenCallKeys.add(callKey);

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
    let draftText = null;
    let originalFinding = null;

    if (!exceptionDuringPrompt && !validation.ok) {
      draftText = finalText;
      const hardFinding = validation.findings.find((f) => f.severity === 'HARD_SAFETY');
      originalFinding = hardFinding;
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
      draftText, originalFinding,
    };
  }

  async function dispose() {
    await context.dispose().catch(() => {});
  }

  return { converse, dispose, sessionToolLog, handleSession };
}

module.exports = { loadEngine, createConversation, SYSTEM_PROMPT, MAX_TOOL_CALLS_PER_TURN, MAX_TOKENS };
