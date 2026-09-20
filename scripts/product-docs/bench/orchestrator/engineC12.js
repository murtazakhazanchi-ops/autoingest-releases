'use strict';

// ASK AUTOINGEST — CHECKPOINT 12: QWEN3.5-4B FINAL QUALIFICATION.
// EXPERIMENTAL, ISOLATED PROTOTYPE.
//
// Model, architecture, and orchestration SHAPE are frozen (Qwen3.5-4B,
// QwenChatWrapper variation "3.5", the mechanical completion check, the
// one-shot regeneration backstop, protocol containment as the absolute
// last step). What changed, each traced to a specific Checkpoint 12
// forensic finding:
//
// Phase 4 — STRUCTURAL ACTION/CLARIFICATION/FINAL investigation (traced
// from node-llama-cpp's actual installed source, not assumed): the
// library's own `ChatModelResponse.response` array DOES structurally
// segment output into plain strings, function calls, and `ChatModelSegment`
// objects with `segmentType: "thought" | "comment"` -- confirmed by direct
// read of `node_modules/node-llama-cpp/dist/types.d.ts`. ACTION (a real
// tool call) is therefore already 100% structural, unchanged since
// Checkpoint 9 -- it is never part of response text by construction.
// However: with `thoughts: 'discourage'` (required so the model doesn't
// waste every turn on a hybrid-reasoning preamble), the model has no
// reason to route narration-style commentary ("Let me try a different
// search") through the wrapper's `thought` segment type at all -- that
// commentary is just ordinary text the model considers part of its own
// answer, indistinguishable at the segment level from the real answer
// content. HONEST, DISCLOSED CONCLUSION: full structural separation of
// process-narration from final-answer text is NOT achievable with this
// model/wrapper/config -- only genuine tool calls get that guarantee.
// Per the explicit instruction not to expand the narration phrase
// dictionary, `validatorC12.js`'s `checkProcessNarration` regex is
// REUSED UNCHANGED from validatorC11.js. The mitigation here is a single
// GENERAL principle added to the system prompt (below), not a phrase list.
//
// Phase 5/6 — regeneration forensics (all 64 Checkpoint-11 regeneration
// events reclassified with their ORIGINAL pre-regeneration trigger, a gap
// in Checkpoint 10/11's own stored data that was fixed and is now
// available): handle-leak 32/64 (50.0%), process-narration 20/64 (31.3%),
// internal-id-leak 9/64 (14.1%), ungrounded-capability-claim 3/64 (4.7%,
// down from Checkpoint 10's ~50% share, confirming Checkpoint 11's own
// validator broadening worked). Direct inspection of handle-leak AND
// internal-id-leak drafts found the SAME underlying pattern in both:
// `"Recover From an Archive Lock Error" (H6)`, `"Metadata Audit & Repair"
// (AI-FEAT-033)` -- a citation-style habit of parenthetically appending a
// short reference code next to any named answer. Critically, the
// internal-id-leak cases cite ids that were NEVER shown to the model
// anywhere -- it fabricates a plausible-looking id to satisfy the same
// citation urge when no handle is salient. This is a general MODEL STYLE
// TENDENCY (category B), not an architectural gap, so the fix is a
// direct, general instruction against the citation pattern itself
// (regardless of whether the cited code is real or invented), combined
// with knowledgeAccessC12.js's field-reordering (handle now last, least
// salient, in every search result).
//
// Phase 7 — naturalness root-cause investigation, tested against real
// data, not assumed: (a) paragraph duplication was checked against
// `completionContinuations` and `regenerated` -- ZERO of the 3 observed
// Checkpoint-11 instances involved either mechanism; a genuine,
// probabilistic, single-pass model tendency, not a mechanical bug. Per
// Phase 7's own instruction for a purely-probabilistic cause, the
// mitigation is one minimal general instruction (below), not a mechanical
// fix, since there is no mechanical cause to fix. (b) The "You're right
// -- let me..." pattern was ALSO checked the same way and found the exact
// opposite result: 13/13 instances (100%) occurred specifically on turns
// where `completionContinuations > 0` -- i.e. every single instance was
// triggered by this engine's OWN completion-continuation nudge. The old
// nudge wording ("Your previous reply to the operator was not yet a
// complete answer") reads as a correction/critique, priming an
// apologetic acknowledgment as if the OPERATOR had pointed out a flaw.
// This IS a mechanical cause, and it IS fixed here -- the nudge is
// reworded to a neutral continuation instruction with an explicit note
// that it is a system reminder, not operator feedback, so no
// acknowledgment is warranted.

const { buildToolDefinitions, HandleSession } = require('./knowledgeAccessC12');
const { validateFinalAnswer, containProtocolArtifacts } = require('./validatorC12');

const MAX_TOOL_CALLS_PER_TURN = 6;
const MAX_TOKENS = 700;
const MAX_COMPLETION_CONTINUATIONS = 1;

let _nllc = null;
async function nllc() {
  if (!_nllc) _nllc = await import('node-llama-cpp');
  return _nllc;
}

// Checkpoint 12 additions to the Checkpoint 11 prompt, each general and
// traced to a specific forensic finding above -- none names a specific
// feature, id, wording pattern, or benchmark case:
//   - anti-citation instruction (Phase 5/6)
//   - "say each fact once" instruction (Phase 7, duplication)
//   - general narration-avoidance instruction (Phase 4, since the regex
//     cannot be expanded and there is no structural signal available)
//   - knowledgeState awareness (Phase 3)
const SYSTEM_PROMPT = `You are the Ask AutoIngest assistant -- a knowledgeable, conversational colleague helping an AutoIngest operator. You are the one conversational intelligence here; your tools are a trusted reference library, not something to mention to the operator. Never say "records", "handles", "search results", "the knowledge base", or describe your own process out loud -- just know things and answer, the way a colleague does. Do not begin a reply with "Based on...", "According to...", "Let me check...", or any other narration of what you looked up -- go straight to the answer. More generally: if a sentence you're about to write describes YOUR OWN process (that you searched, are about to search, are checking, are trying something, or are commenting on what a search did or didn't find) rather than telling the operator something about AutoIngest itself, delete that sentence and just give the answer instead.

Never write a code, id, or reference number next to a name you give the operator -- not in parentheses, not any other way, and not even one you're confident is correct. Just say the name plainly. This applies whether or not you actually have such a code available to you.

Talk naturally and concisely, like a capable human colleague, not documentation. Use what you learn from your tools to explain things in your own words; never quote text verbatim, and never mention ids, handles, file names, function names, or other implementation details unless the operator explicitly asked a technical question and you deliberately looked that detail up for them. Say each specific fact once -- don't restate the same point again in different words within the same answer.

Your tools:
- search_autoingest(query) finds AutoIngest subjects (features/workflows) that might match what the operator means. Results include a title, purpose, and hasDetail (whether real documented facts exist beyond the title/purpose) -- never invent a subject name yourself, always get it from a search result first. For almost any question naming, implying, or asking you to IDENTIFY a specific AutoIngest subject -- including "what's it called" style questions where the operator describes something without naming it -- search FIRST. The name itself is a fact about AutoIngest, exactly like its behavior or its capability status, and needs the same grounding before you say it.
- read_autoingest(handle, dimensions) fetches the specific facts you need (purpose, behavior, how-to steps, recovery, limitations, technical detail, etc) about a subject you already have a handle for -- fetch only what this question needs. The result tells you knowledgeState: DOCUMENTED (real content), THIN (most of what you asked for isn't established), or EMPTY (no detailed record at all). For THIN or EMPTY, say plainly that the detail isn't documented, or read a different candidate that does have it -- never invent the missing detail to fill the gap.
- capability_status(handle) is the one authoritative source for whether AutoIngest supports, does, or doesn't do something. Always call it before making that kind of claim, and never contradict what it returns.
- roadmap_status(query) is the authoritative source for what's done, in progress, or planned -- use it for open-ended "what's next"/"what's done" style questions, not just named-subject ones.

A handle that turns out invalid is your own bookkeeping mistake, not evidence about AutoIngest -- search again rather than concluding AutoIngest lacks something. Likewise, one weak or empty search is not proof AutoIngest lacks a capability -- try different wording before giving up. Only capability_status's actual answer is the real truth about whether something exists.

Ask a clarifying question only when you genuinely need the answer to help AND searching wouldn't resolve it -- if the operator already told you enough, or a quick search would find out, just do that instead of asking. Remember the conversation: short replies like "yes" or "that one" refer back to what you just said. If AutoIngest's knowledge genuinely doesn't cover something, say so honestly rather than guessing or inventing a feature, button, or workflow.`;

const CHAT_WRAPPER_KEY = 'qwen35';

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
          // Checkpoint 12 bug fix, found during this checkpoint's own
          // Phase 8 dev testing (ADV12: 14 tool calls in one turn,
          // exceeding MAX_TOOL_CALLS_PER_TURN=6): the cap check MUST run
          // unconditionally, before the dedup short-circuit, or a model
          // repeatedly retrying the exact same call never counts against
          // its budget and can loop indefinitely. The cap now applies to
          // every call attempt, duplicate or not.
          if (recorder.calls.length >= MAX_TOOL_CALLS_PER_TURN) {
            recorder.capped = true;
            return { note: 'Tool-call budget reached for this turn. Answer now with what you already have, or ask the operator a clarifying question.' };
          }
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

  // Checkpoint 12, Phase 7: reworded from engineC9-C11's version. The old
  // wording ("was not yet a complete answer") was proven (100% of 13
  // observed instances) to trigger an unwarranted "You're right --"
  // apology opener, since it reads as a correction. This version is a
  // neutral continuation instruction and explicitly disclaims that it is
  // a system reminder, not operator feedback.
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
    // Checkpoint 12, found during Phase 8 dev testing (CONV04): the prior
    // wording ("Rewrite it conveying the same information naturally")
    // assumes the flagged draft actually contained real information to
    // preserve. When the draft itself was pure narration for a message
    // needing none (e.g. a compliment, no informational question), there
    // is no "same information" to rewrite -- the model instead talked
    // about ITS OWN upcoming behavior ("Understood, I'll answer directly
        // without any internal narration or tool references"), which is
    // itself a meta-commentary leak, just worded differently from the
    // fixed narration regex. General fix, not phrase-specific: redirect
    // the model away from "rewrite the draft" and toward "answer the
    // operator's actual message", which the model can still see in the
    // conversation history -- this removes the paraphrase framing
    // entirely rather than covering one more observed wording.
    const correction = `[System reminder, not something the operator said.] Your previous draft had a problem: ${reason}. Do not rewrite that draft and do not describe what you will do differently -- just give your direct answer or response to the operator's actual last message now, in your own words, going straight to the substance -- no ids, handles, file paths, function names, reference codes, or narration of your own process, and never state a capability status without having checked it. Do not call any tools; use only what you already found.`;
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
