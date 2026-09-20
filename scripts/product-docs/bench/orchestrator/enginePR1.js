'use strict';

// ASK AUTOINGEST — CHECKPOINT 14: ONE-BRAIN ARCHITECTURE CLOSURE
// QUALIFICATION. EXPERIMENTAL, ISOLATED PROTOTYPE. PRODUCT OWNER-
// AUTHORIZED NARROW CLOSURE FOLLOW-UP TO CHECKPOINT 13's HOLD.
//
// Identical to engineC13.js in every respect (model, wrapper config,
// completion-continuation mechanism, regeneration backstop, SYSTEM_PROMPT)
// EXCEPT it imports knowledgeAccessC14.js (Phase 2 corrupted-knowledge
// fix, Phase 3 directional relationships, Phase 4 Decision-record
// exposure + corpus-wide sanitization fix) and validatorC14.js in place
// of the C13 versions. No engine-shape change in this file yet -- the
// Phase 6 (RB27 structural loop fix) change belongs here and is applied
// separately, after investigating node-llama-cpp's actual tool loop.

const { buildToolDefinitions, HandleSession } = require('./knowledgeAccessPR1');
const { validateFinalAnswer, containProtocolArtifacts } = require('./validatorC14');

const MAX_TOOL_CALLS_PER_TURN = 6;
const MAX_TOKENS = 700;
const MAX_COMPLETION_CONTINUATIONS = 1;

let _nllc = null;
async function nllc() {
  if (!_nllc) _nllc = await import('node-llama-cpp');
  return _nllc;
}

// Checkpoint 13's SYSTEM_PROMPT, byte-identical. Checkpoint 14's own
// directive (Phase 3/4) does not ask for a new prompt sentence -- the
// existing "check relationships before asserting them" language already
// covers directional relations (check_relationship's own tool description
// carries the new directional-meaning guidance instead, per Phase 10's
// small-tool-surface / minimal-prompt-churn preference).
const SYSTEM_PROMPT = `You are the Ask AutoIngest assistant -- a knowledgeable, conversational colleague helping an AutoIngest operator. You are the one conversational intelligence here; your tools are a trusted reference library, not something to mention to the operator. Never say "records", "handles", "search results", "the knowledge base", or describe your own process out loud -- just know things and answer, the way a colleague does. Do not begin a reply with "Based on...", "According to...", "Let me check...", or any other narration of what you looked up -- go straight to the answer. More generally: if a sentence you're about to write describes YOUR OWN process (that you searched, are about to search, are checking, are trying something, or are commenting on what a search did or didn't find) rather than telling the operator something about AutoIngest itself, delete that sentence and just give the answer instead.

Never write a code, id, or reference number next to a name you give the operator -- not in parentheses, not any other way, and not even one you're confident is correct. Just say the name plainly. This applies whether or not you actually have such a code available to you.

Talk naturally and concisely, like a capable human colleague, not documentation. Use what you learn from your tools to explain things in your own words; never quote text verbatim, and never mention ids, handles, file names, function names, or other implementation details unless the operator explicitly asked a technical question and you deliberately looked that detail up for them. Say each specific fact once -- don't restate the same point again in different words within the same answer.

Your tools:
- search_autoingest(query) finds AutoIngest subjects (features/workflows) that might match what the operator means. Results include a title, purpose, and hasDetail (whether real documented facts exist beyond the title/purpose) -- never invent a subject name yourself, always get it from a search result first. For almost any question naming, implying, or asking you to IDENTIFY a specific AutoIngest subject -- including "what's it called" style questions where the operator describes something without naming it -- search FIRST. The name itself is a fact about AutoIngest, exactly like its behavior or its capability status, and needs the same grounding before you say it. The same is true of any claim that connects two AutoIngest subjects -- that one is the same as, contains, uses, or is separate from another: check that relationship (check_relationship) before asserting it, exactly like any other fact.
- read_autoingest(handle, dimensions) fetches the specific facts you need (purpose, behavior, how-to steps, recovery, limitations, technical detail, etc) about a subject you already have a handle for -- fetch only what this question needs. The result tells you knowledgeState: DOCUMENTED (real content), THIN (most of what you asked for isn't established), or EMPTY (no detailed record at all). For THIN or EMPTY, say plainly that the detail isn't documented, or read a different candidate that does have it -- never invent the missing detail to fill the gap.
- capability_status(handle) is the one authoritative source for whether AutoIngest supports, does, or doesn't do something. Always call it before making that kind of claim, and never contradict what it returns.
- roadmap_status(query) is the authoritative source for what's done, in progress, or planned -- use it for open-ended "what's next"/"what's done" style questions, not just named-subject ones.
- check_relationship(subjectHandle, objectHandle) is the one authoritative source for whether two AutoIngest subjects are connected -- the same one, contain/use each other, or are documented as separate. Call it before telling the operator two things are the same, related, or different, whenever you actually have handles for both. It can return UNKNOWN (not documented either way) -- that is not "confirmed unrelated"; say plainly the relationship isn't documented rather than guessing in either direction.

A handle that turns out invalid is your own bookkeeping mistake, not evidence about AutoIngest -- search again rather than concluding AutoIngest lacks something. Likewise, one weak or empty search is not proof AutoIngest lacks a capability -- try different wording before giving up. Only capability_status's actual answer is the real truth about whether something exists.

Ask a clarifying question only when you genuinely need the answer to help AND searching wouldn't resolve it -- if the operator already told you enough, or a quick search would find out, just do that instead of asking. Remember the conversation: short replies like "yes" or "that one" refer back to what you just said. If AutoIngest's knowledge genuinely doesn't cover something, say so honestly rather than guessing or inventing a feature, button, or workflow.`;

const CHAT_WRAPPER_KEY = 'qwen35';

async function loadEngine({ modelPath }) {
  const { getLlama, QwenChatWrapper } = await nllc();
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  return { llama, model, QwenChatWrapper };
}

async function createConversation(engine, ctx, built, options) {
  const { LlamaChatSession, defineChatSessionFunction } = await nllc();
  // Phase 13 (contextSize=16384 qualification): forwarded only when the
  // caller explicitly passes it (e.g. runConversationsC14.js's
  // ORCH_CONTEXT_SIZE) -- omitted, node-llama-cpp keeps its own default,
  // unchanged from every prior checkpoint's behavior.
  const contextOpts = { sequences: 1 };
  if (options && options.contextSize) contextOpts.contextSize = options.contextSize;
  const context = await engine.model.createContext(contextOpts);
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
          // Phase 6 (RB27 structural fix), checked FIRST and unconditionally:
          // node-llama-cpp's promptWithMeta runs an internal while(true) loop
          // -- each generation pass that emits a function call feeds the
          // result back in and loops again; only a pass with NO function
          // call ends the turn (traced directly in node_modules/
          // node-llama-cpp/dist/evaluator/LlamaChatSession/LlamaChatSession.js,
          // not guessed). RB27's forensic trace: the model got UNKNOWN from
          // check_relationship, then requested the SAME (tool, args) again;
          // the old dedup path returned an explanatory note but let the loop
          // keep running, so the model kept re-attempting (and narrating
          // about) an already-answered request until it burned the entire
          // per-turn token budget. Once ANY call this turn has tripped
          // `capped` (either the 6-call ceiling below, or a repeat -- see
          // that branch), every further call, of ANY tool/args, hits this
          // check FIRST and gets the identical terse redirect immediately --
          // no new narration material is fed back for the model to loop on.
          if (recorder.capped) {
            return { note: 'Tool-call budget reached for this turn. Answer now with what you already have, or ask the operator a clarifying question.' };
          }
          if (recorder.calls.length >= MAX_TOOL_CALLS_PER_TURN) {
            recorder.capped = true;
            return { note: 'Tool-call budget reached for this turn. Answer now with what you already have, or ask the operator a clarifying question.' };
          }
          const callKey = name + '::' + JSON.stringify(args);
          if (recorder.seenCallKeys && recorder.seenCallKeys.has(callKey)) {
            // General trigger condition: repetition itself (identical tool
            // AND identical args, regardless of which tool, which subject,
            // or how the model phrases its narration around it) -- not a
            // specific tool, feature, or observed phrase. The deterministic
            // knowledge for this exact request already came back once this
            // turn and cannot change mid-turn, so a second identical request
            // is by definition ALREADY_RESOLVED, never new information.
            // Tripping the same circuit breaker as the call-count ceiling
            // (rather than only noting-and-continuing) is what forces the
            // loop toward a final answer instead of letting it run until
            // maxTokens does the job much later and much more expensively.
            recorder.capped = true;
            const result = { note: 'Tool-call budget reached for this turn. Answer now with what you already have, or ask the operator a clarifying question.' };
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
      const nudge = '[System reminder, not something the operator said -- no need to acknowledge or apologize.] Continue: if you still need to check something to answer the operator\'s actual message, use a tool now. Then give your complete answer or question to the operator in this same reply.';
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
    const correction = `[System reminder, not something the operator said.] Your previous draft had a problem: ${reason}. Do not rewrite that draft and do not describe what you will do differently -- just give your direct answer or response to the operator's actual last message now, in your own words, going straight to the substance -- no ids, handles, file paths, function names, reference codes, or narration of your own process, and never state a capability status without having checked it, and never state a relationship between two subjects without having checked it. Do not call any tools; use only what you already found.`;
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

module.exports = { loadEngine, createConversation, SYSTEM_PROMPT, CHAT_WRAPPER_KEY, MAX_TOOL_CALLS_PER_TURN, MAX_TOKENS };
