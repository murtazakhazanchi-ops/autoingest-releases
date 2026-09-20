'use strict';

// ASK AUTOINGEST — CHECKPOINT 7: orchestrator reliability + retrieval
// safety. EXPERIMENTAL, ISOLATED PROTOTYPE. Not wired to production/
// conversationalAsk.js, not wired to Electron IPC. Runs as a PLAIN NODE
// SCRIPT (see Checkpoint 5's report for why).
//
// One LlamaChatSession PER CONVERSATION, kept alive across turns -- the
// conversation-memory design (Checkpoint 5, Phase 6, unchanged).
//
// Checkpoint 7 additions (see the report for the forensic evidence behind
// each):
//   - Phase 1/2: PROVEN (via session.promptWithMeta()'s raw stopReason +
//     response segments, not assumed) that "stalling" turns are genuine
//     `stopReason: 'eogToken'` completions with ZERO attempted tool calls
//     -- the model decides, in ordinary text generation, that a sentence
//     like "I'll check that" is a complete turn. This is not a parser
//     failure, not a dropped tool call, not a premature loop exit --
//     node-llama-cpp's own function-calling loop only continues when a
//     real function call was requested, and none was. No native
//     tool-call/finish-state signal distinguishes "legitimate zero-tool
//     answer" from "stalled zero-tool non-answer" (both are ordinary
//     eogToken-terminated text) -- proven by direct inspection, not
//     assumed. `maybeCompleteTurn()` below is the resulting mechanical,
//     bounded (ONE continuation, never more), non-phrase-blacklist
//     completion check: structural on tool-call count and on whether the
//     turn ends by asking the operator something (a real clarifying
//     question is a legitimate zero-tool-call answer; an unfinished
//     promise-to-act is neither grounded nor a question).
//   - Phase 5: real hybrid (deterministic + semantic) retrieval, via
//     semanticRetrieval.js's reuse of the existing, unmodified C7/C8
//     embedding infrastructure -- previously unavailable outside Electron
//     for a reason (`indexDir()`'s app.getPath call) that turned out not
//     to require the embedding/retrieval mechanism itself to change.
//   - Phase 7: containProtocolArtifacts() runs as the ABSOLUTE LAST step
//     on any text before it is treated as final -- a structural boundary
//     built from Gemma4ChatWrapper's own real control-token vocabulary
//     (traced directly from node-llama-cpp's source), not a single-string
//     replacement of the one observed leaked fragment.
//   - Phase 8: system prompt substantially simplified -- see the report
//     for the rule-by-rule audit. The worked anti-stalling example is
//     removed now that turn completion is enforced structurally rather
//     than by the model remembering a worked example.

const { buildToolDefinitions } = require('./tools');
const { validateFinalAnswer, checkStructuralLeak, containProtocolArtifacts } = require('./validator');
const { makeSemanticTopK } = require('./semanticRetrieval');

const MAX_TOOL_CALLS_PER_TURN = 6;
// Phase 1E (Checkpoint 6): chosen from measurement of Checkpoint 5's real
// transcripts (p50=618, p90=1079, p99=1565 chars, already truncated in the
// tail by the old 400-token cap). Unchanged this checkpoint; re-measured
// again in this checkpoint's own report.
const MAX_TOKENS = 700;
const MAX_REGENERATION_ATTEMPTS = 1;
// Phase 2: exactly one bounded internal continuation when a turn looks
// structurally unfinished -- never more (explicit instruction: no
// infinite retry loop).
const MAX_COMPLETION_CONTINUATIONS = 1;

let _nllc = null;
async function nllc() {
  if (!_nllc) _nllc = await import('node-llama-cpp');
  return _nllc;
}

// Phase 8 — system prompt, substantially simplified from Checkpoint 6.
// Rule-by-rule audit (full table in the report): rules that were really
// asking the model to compensate for something the orchestration layer
// can now guarantee mechanically (turn completion -> Phase 2's structural
// check; internal-id/leak prohibition -> Phase 1A's regeneration backstop
// + Phase 7's structural strip) were REMOVED from the prompt, not
// duplicated in both places. The worked right/wrong anti-stalling example
// is removed -- it was compensating for exactly the gap Phase 2 now closes
// structurally. What remains is the small set of things that genuinely
// require the LLM's own judgment: who it is, what its tools are for, when
// to use them, and to converse naturally without inventing things.
const SYSTEM_PROMPT = `You are the Ask AutoIngest assistant -- a knowledgeable, conversational colleague helping an AutoIngest operator. You are the one conversational intelligence here; your tools are a trusted reference library, not something to mention to the operator (never say "records", "evidence", "tools", "the knowledge base", or describe your own process -- just know things, the way a colleague does).

Talk naturally and concisely, like a capable human colleague, not documentation. No fixed template or required structure -- let the content decide the shape of your reply. Use what you learn from your tools to explain things in your own words; never quote a record verbatim, and never mention record ids, file names, function names, or other implementation details unless the operator explicitly asked a technical question and you deliberately looked up that detail for them.

Your tools:
- search_knowledge(query) finds candidate AutoIngest features/workflows that might match what the operator means. Results are fuzzy matches, not verified answers -- read each one's purpose and use your own judgment about whether it actually fits what was asked, especially when a title alone might be misleading. If nothing fits well, try different wording or ask the operator.
- get_knowledge(id, dimensions) fetches the specific facts you need about a subject (purpose, behavior, how-to steps, recovery, limitations, technical detail, etc) -- fetch only what this question actually needs.
- get_capability_status(id) is the one authoritative source for whether AutoIngest supports, does, or doesn't do something. Always check it before making that kind of claim, and never contradict it.
- get_roadmap_status(query) is the authoritative source for what's done, in progress, or planned -- use it for open-ended "what's next" style questions.

Ask a clarifying question only when you genuinely need the answer to help -- if the operator already told you enough, or you can find out yourself, just do that instead of asking. Remember the conversation: short replies like "yes" or "that one" refer back to what you just said. If AutoIngest's knowledge genuinely doesn't cover something, say so honestly rather than guessing or inventing a feature, button, or workflow.`;

async function loadEngine({ modelPath, embeddingModelDir, semanticIndexDir }) {
  const { getLlama, Gemma4ChatWrapper } = await nllc();
  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath });
  let semanticTopK = null;
  if (embeddingModelDir && semanticIndexDir) {
    semanticTopK = makeSemanticTopK({ modelDir: embeddingModelDir, indexDir: semanticIndexDir });
  }
  return { llama, model, Gemma4ChatWrapper, semanticTopK };
}

// Creates ONE fresh conversational session (= one conversation's worth of
// native chat memory). Call once per conversation, then call `converse()`
// repeatedly for each user turn, then `dispose()` when the conversation ends.
async function createConversation(engine, ctx) {
  const { LlamaChatSession, defineChatSessionFunction } = await nllc();
  const context = await engine.model.createContext({ sequences: 1 });
  const chatWrapper = new engine.Gemma4ChatWrapper({ reasoning: false });
  const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt: SYSTEM_PROMPT, chatWrapper });

  // Phase 1A/2 (Checkpoint 6): cumulative across the WHOLE conversation --
  // the capability-grounding check must recognize a later turn legitimately
  // reusing an earlier turn's get_capability_status call.
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
          const result = await def.handlerImpl(args);
          recorder.calls.push({ tool: name, args, result, ms: Date.now() - t0 });
          return result;
        },
      });
    }
    return functions;
  }

  // Checkpoint 7, Phase 2 -- mechanical (structural) turn-completion check.
  // Proven (see this file's header, and the report) that no native
  // tool-call/finish-state signal from node-llama-cpp distinguishes a
  // legitimate zero-tool-call answer (reused context, or a genuine
  // clarifying question) from a stalled non-answer -- both are ordinary
  // `eogToken`-terminated text. The two structural facts actually
  // available -- how many tools were called THIS turn, and whether the
  // turn ends by asking the operator something (a real question mark
  // directed outward) -- are what this checks. This is NOT a phrase/
  // regex blacklist of stalling language ("I'll check", "let me look",
  // etc. are never matched against) -- it never inspects what the model
  // said, only (a) tool-call count and (b) whether the turn structurally
  // reads as a question. A turn that used zero tools and does not end in
  // "?" is treated as possibly unfinished and given exactly ONE bounded
  // internal continuation nudge (never shown to the operator) telling it
  // to use a tool now if it needs to, then answer completely. If the
  // continuation ALSO produces zero tools and no question, its result is
  // shipped as-is -- never a second retry.
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
      // Checkpoint 7 fix (found in dev-set testing, D7_11): a short bare
      // "Continue..." nudge was, at least once, misread by the model as an
      // ambiguous one-word OPERATOR message ("'Continue' isn't enough
      // information for me to know what process you're referring to") --
      // it needs to unambiguously read as an instruction ABOUT the
      // assistant's own prior turn, not as new input from the operator,
      // mirroring the phrasing regenerateWithoutLeak() below already uses
      // successfully for the same reason.
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

  // Phase 1A (Checkpoint 6): post-generation backstop. If the answer
  // contains a structural leak or an ungrounded capability claim, give the
  // model ONE controlled regeneration attempt using the SAME session (same
  // already-fetched evidence still in context, no new retrieval) with an
  // explicit correction instruction and no tool access (forces plain text,
  // prevents drifting into more tool calls instead of fixing the wording).
  // If that still fails, return a short, neutral, grounded fallback --
  // never the raw evidence dump.
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
        // Regeneration did not resolve it -- never show the leaking text,
        // never show a raw deterministic dump. Short, neutral, honest.
        finalText = "I found information related to that, but I'm having trouble explaining it without getting into internal details. Could you rephrase your question, or ask about a more specific part of it?";
        validation = { ok: true, findings: [{ severity: 'SOFT_QUALITY', code: 'regeneration-fallback-used', detail: `Original: ${hardFinding.code}. Regeneration still failed; short neutral fallback shown instead.` }] };
        regenerationOutcome = 'fallback';
      }
    }

    // Phase 7: the ABSOLUTE last step, regardless of which path above
    // produced finalText -- a structural containment boundary, not
    // conditional on anything upstream having already caught the issue.
    const contained = containProtocolArtifacts(finalText);
    finalText = contained.text;

    return {
      finalText, toolCalls: recorder.calls, capped: recorder.capped, totalMs, validation, regenerated, regenerationOutcome,
      completionContinuations, protocolArtifactsStripped: contained.stripped,
    };
  }

  async function dispose() {
    await context.dispose().catch(() => {});
  }

  return { converse, dispose, sessionToolLog };
}

module.exports = { loadEngine, createConversation, SYSTEM_PROMPT, MAX_TOOL_CALLS_PER_TURN, MAX_TOKENS };
