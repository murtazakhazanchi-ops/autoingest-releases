'use strict';

// services/qwenRuntime/runtimeWorker.js — Ask AutoIngest Stage 3, Sections
// 6/17/18/23: runs ONLY inside an Electron utilityProcess (spawned by
// runtime.js). Owns node-llama-cpp model loading, context creation,
// minimal smoke-test inference, and unload -- nothing else. No queueing,
// no timeout/request-id bookkeeping, no Knowledge Base/tool wiring, no
// system prompt, no orchestrator policy (Section 17's own explicit
// boundary -- all of that is Stage 4 territory).
//
// Design pattern REUSED from services/localJudge/runtimeWorker.js
// (Gemma's own, already-production-proven worker) -- that file is not
// modified by this stage. Two deliberate, evidence-based departures from
// its pattern:
//
//   1. contextSize is ALWAYS passed explicitly to createContext()
//      (modelManifest.js's CONTEXT_SIZE=24576) -- Gemma's own worker
//      relies on node-llama-cpp's implicit default when the caller
//      doesn't supply one; Section 7 explicitly forbids that for Qwen.
//   2. The chat wrapper is unconditionally QwenChatWrapper({variation:
//      '3.5', thoughts: 'discourage'}) -- the exact Checkpoint 12/14
//      qualified configuration, verified directly against the installed
//      package's own QwenChatWrapper.d.ts (variation/thoughts are real,
//      documented constructor options, not assumed).
//
// Cancellation (Section 19), UNCHANGED from Gemma's own hard-won finding:
// node-llama-cpp's signal/stopOnAbortSignal early-stop was tried against
// this exact node-llama-cpp version's predecessor and reverted after a
// real reproduction matrix found it turns an intermittent native crash
// (SIGABRT in model.dispose()) into an almost-100%-reproducible one with a
// DIFFERENT signature (SIGBUS/EXC_BAD_ACCESS inside context.dispose()
// itself, immediately after an actively-interrupted generation) -- a
// genuine upstream synchronization gap between node-llama-cpp's abort-
// signal early-stop and native (Metal) context teardown, not a bug in
// this integration's own protocol. This worker therefore does NOT wire an
// AbortSignal into session.prompt(); the parent (runtime.js) instead
// discards a cancelled request's eventual result when it arrives (see
// that file's own cancellation handling). A future revisit should check
// for an updated node-llama-cpp release before retrying signal-based
// interruption.
//
// context.dispose() ALWAYS runs from a try/finally around the whole
// context/session/prompt block (same fix Gemma's own worker already
// proved necessary): any exception -- not just a cancellation -- must not
// leak the context and, with it, its hold on model.dispose()'s internal
// DisposeGuard, which is what causes unload() to hang forever.
//
// Message protocol (process.parentPort):
//   in  {type:'load', modelPath}
//   out {type:'loaded', loadMs, gpu} | {type:'load-error', message}
//   in  {type:'createContext'}
//   out {type:'context-created', createContextMs, contextSize}
//       | {type:'context-create-error', message}
//   in  {type:'infer', requestId, prompt, maxTokens}
//   out {type:'result', requestId, text, timing}
//       | {type:'infer-error', requestId, message}
//   in  {type:'disposeContext'}
//   out {type:'context-disposed'}
//   in  {type:'unload'}
//   out {type:'unloaded'}
//   in  {type:'diagnostics'}
//   out {type:'diagnostics-result', ...}
//
// Ask AutoIngest Stage 4 additions (Sections 6/13/18 of that stage's own
// brief -- session/tool-calling support only; nothing above this line is
// changed in behavior). Stage 3's own explicit "no Knowledge Base/tool
// wiring... all of that is Stage 4 territory" is exactly the boundary
// this addition fills, in Stage 4's own commit, on top of (never
// rewriting) Stage 3's approved commit -- the same additive-extension
// precedent Stage 3.1 itself already established in this same file for
// the sequence-pool fix. A persistent LlamaChatSession per Stage-4
// conversation reuses the SAME context/sequence-pool machinery above
// (including the Stage 3.1 waitForFreeSequence() fix), rather than a
// second, parallel, unqualified model-loading implementation. Tool
// EXECUTION itself (the actual Stage-2 Knowledge Base operations) never
// runs in this process -- a function `handler` here is a thin RPC proxy
// that messages the parent and awaits a correlated response, keeping
// this worker's own boundary exactly as narrow as Stage 3 left it (pure
// Qwen runtime mechanics; zero Knowledge Base code or data in this
// process):
//   in  {type:'createSession', sessionId, toolSchemas, systemInstruction}
//   out {type:'session-created', sessionId}
//       | {type:'session-create-error', sessionId, message}
//   in  {type:'tool-result', callId, result, error}  (reply to an
//       earlier {type:'tool-call', ...} this worker sent to the parent)
//   in  {type:'promptSession', sessionId, requestId, message, maxTokens}
//   out {type:'tool-call', sessionId, callId, toolName, params}  (sent
//       mid-turn, zero or more times, before the eventual session-result)
//   out {type:'session-result', sessionId, requestId, text, toolCalls, stopReason}
//       | {type:'session-error', sessionId, requestId, message}
//   in  {type:'resetSession', sessionId}
//   out {type:'session-reset', sessionId} | {type:'session-reset-error', sessionId, message}
//   in  {type:'disposeSession', sessionId}
//   out {type:'session-disposed', sessionId}

const { CONTEXT_SIZE, RUNTIME_COMPATIBILITY, INFERENCE_DEFAULTS } = require('./modelManifest');

let llama = null;
let model = null;
let context = null;
let _loadedModelPath = null;
let _loadCount = 0;
let _activeInferenceCount = 0;
let _lastErrorCategory = null;

// Stage 4 additions -- session/tool-calling state, entirely separate from
// the stateless smoke-test inference path above (which remains untouched
// and independently usable).
let _sessions = new Map(); // sessionId -> { llamaSession, sequence }
let _pendingToolCalls = new Map(); // callId -> { resolve, reject }
let _toolCallCounter = 0;

// node-llama-cpp is ESM-only -- a plain require() throws under Electron's
// utilityProcess (which hosts this file as CommonJS). Loaded via dynamic
// import(), cached after first load (same pattern Gemma's own worker
// already established).
let _nllc = null;
async function nllc() {
  if (!_nllc) _nllc = await import('node-llama-cpp');
  return _nllc;
}

async function handleLoad(modelPath) {
  try {
    const { getLlama } = await nllc();
    const t0 = performance.now();
    llama = await getLlama();
    model = await llama.loadModel({ modelPath });
    _loadedModelPath = modelPath;
    _loadCount += 1;
    const loadMs = performance.now() - t0;
    process.parentPort.postMessage({ type: 'loaded', loadMs, gpu: llama.gpu });
  } catch (err) {
    _lastErrorCategory = 'MODEL_LOAD_FAILED';
    process.parentPort.postMessage({ type: 'load-error', message: err && err.message ? err.message : String(err) });
  }
}

// Section 17's context/session factory: a raw Qwen context, the qualified
// chat wrapper, and NOTHING else -- no Knowledge Base tools, no Stage-2
// handles, no final system prompt. contextSize is always explicit
// (Section 7).
async function handleCreateContext() {
  try {
    if (!model) throw new Error('model not loaded');
    if (context) throw new Error('a context already exists -- dispose it before creating another (Section 20: one context per runtime)');
    const t0 = performance.now();
    context = await model.createContext({ sequences: INFERENCE_DEFAULTS.sequences, contextSize: CONTEXT_SIZE });
    const createContextMs = performance.now() - t0;
    process.parentPort.postMessage({ type: 'context-created', createContextMs, contextSize: context.contextSize });
  } catch (err) {
    _lastErrorCategory = 'CONTEXT_CREATE_FAILED';
    process.parentPort.postMessage({ type: 'context-create-error', message: err && err.message ? err.message : String(err) });
  }
}

// Stage 3.1 real-model finding: a burst of cancelled long generations can
// transiently exhaust the sequence pool (see handleInfer's own header
// comment below for the full reproduction). Polls context.sequencesLeft
// on a short interval rather than failing immediately -- bounded by
// SEQUENCE_WAIT_TIMEOUT_MS so a genuinely stuck pool (not just a
// transient burst) still surfaces as a real, typed error rather than
// hanging forever.
const SEQUENCE_WAIT_POLL_MS = 50;
const SEQUENCE_WAIT_TIMEOUT_MS = 30000;
function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitForFreeSequence() {
  const deadline = Date.now() + SEQUENCE_WAIT_TIMEOUT_MS;
  while (context.sequencesLeft < 1) {
    if (Date.now() >= deadline) {
      throw new Error(`no sequence slot became free within ${SEQUENCE_WAIT_TIMEOUT_MS}ms (sequencesLeft=0, totalSequences=${context.totalSequences})`);
    }
    await wait(SEQUENCE_WAIT_POLL_MS);
  }
}

// Minimal, neutral development/test prompt only (Section 17's own
// explicit instruction: "the purpose is runtime validation, not assistant
// -quality evaluation"). `prompt`/`maxTokens` are supplied by the caller
// (a development harness or test) -- this function has no opinion about
// conversational content, no system prompt beyond node-llama-cpp's own
// wrapper defaults, and no tools.
async function handleInfer({ requestId, prompt, maxTokens = 64 }) {
  _activeInferenceCount += 1;
  let sequence = null;
  let outcome = null; // { ok: true, text, timing } | { ok: false, message }
  try {
    const { LlamaChatSession, QwenChatWrapper } = await nllc();
    if (!model || !context) {
      throw new Error('model/context not ready -- call load then createContext first');
    }
    const chatWrapper = new QwenChatWrapper({
      variation: RUNTIME_COMPATIBILITY.chatWrapper.variation,
      thoughts: RUNTIME_COMPATIBILITY.chatWrapper.thoughts,
    });
    // A fresh session per inference call for this Stage 3 smoke-test
    // surface -- Stage 4 will own real persistent-conversation session
    // lifecycle; this worker only needs to prove a session/context CAN
    // run a real generation safely, not manage one across turns.
    //
    // Stage 3.1 real-model finding (a genuine concurrency bug, not a
    // disposal-API mistake): the context was created with
    // INFERENCE_DEFAULTS.sequences=1 (a single-sequence pool). The
    // original code posted the 'result' message to the parent BEFORE
    // disposing this call's sequence (in a `finally` block that ran
    // after the postMessage). The parent's own FIFO queue treats
    // "result received" as "ready for the next request" and immediately
    // sends the next 'infer' message -- which can arrive and reach
    // context.getSequence() in a SECOND, interleaved handleInfer()
    // invocation before the FIRST call's own sequence.dispose() has
    // actually completed (dispose is itself async and yields at least
    // once), reliably throwing "No sequences left" on the second call.
    // Reproduced and confirmed via direct child-process stderr
    // instrumentation, not assumed. Fixed by disposing the sequence
    // BEFORE posting the result/error message -- by the time the parent
    // sees "this request is done," the pool slot is genuinely free.
    //
    // That ordering fix alone does not cover CANCELLATION: a cancelled
    // request's generation keeps running in the background (Section 19's
    // "stop waiting, don't interrupt" strategy), so an immediately-
    // following new request can still collide with an abandoned-but-
    // still-generating sequence. Bumping INFERENCE_DEFAULTS.sequences to 2
    // (modelManifest.js) covers a single abandoned generation, but a
    // real-model stress test of 10 rapid cancel-then-retry cycles against
    // LONG (maxTokens:400) abandoned generations showed even 2 slots can
    // still be transiently exhausted: an abandoned long generation runs to
    // completion in the background regardless of how quickly the caller
    // moves on, so a fast enough burst of cancellations can pile up more
    // abandoned generations than any small fixed slot count. Rather than
    // continuing to inflate the slot count (which cannot bound an
    // unbounded burst), the general fix is to WAIT briefly for a slot to
    // free up instead of failing immediately -- this degrades a genuine
    // burst into a short, bounded delay rather than a hard error, and
    // requires no change to the cancellation/interruption strategy itself.
    await waitForFreeSequence();
    sequence = context.getSequence();
    const session = new LlamaChatSession({ contextSequence: sequence, chatWrapper });

    let firstTokenMs = null;
    const t0 = performance.now();
    let tokenCount = 0;
    const text = await session.prompt(prompt, {
      maxTokens,
      onToken: (tokens) => {
        if (firstTokenMs === null) firstTokenMs = performance.now() - t0;
        tokenCount += tokens.length;
      },
    });
    const totalMs = performance.now() - t0;
    outcome = { ok: true, text, timing: { firstTokenMs, totalMs, approxOutputTokens: tokenCount } };
  } catch (err) {
    _lastErrorCategory = /context/i.test(err && err.message || '') ? 'CONTEXT_LIMIT' : 'INFERENCE_FAILED';
    outcome = { ok: false, message: err && err.message ? err.message : String(err) };
  }

  // Release the sequence (this call's own pooled slot) BEFORE signaling
  // completion to the parent -- see the ordering rationale above. Runs
  // whether the call succeeded, failed, or was abandoned by a parent-side
  // cancellation (Section 19's strategy: the child keeps running to
  // natural completion regardless, so this still executes then, releasing
  // the slot so a cancelled-and-abandoned request cannot permanently
  // exhaust the pool either). The context itself is a longer-lived
  // resource this worker's own createContext/disposeContext messages own
  // explicitly, not torn down per-inference.
  if (sequence) { try { await sequence.dispose(); } catch { /* already disposed/torn down with the context -- safe no-op */ } }
  _activeInferenceCount -= 1;

  if (outcome.ok) {
    process.parentPort.postMessage({ type: 'result', requestId, text: outcome.text, timing: outcome.timing });
  } else {
    process.parentPort.postMessage({ type: 'infer-error', requestId, message: outcome.message });
  }
}

async function handleDisposeContext() {
  if (context) {
    await context.dispose().catch(() => {});
    context = null;
  }
  process.parentPort.postMessage({ type: 'context-disposed' });
}

async function handleUnload() {
  try {
    if (context) {
      await context.dispose().catch(() => {});
      context = null;
    }
    if (model) {
      await model.dispose();
      model = null;
    }
    llama = null;
    _loadedModelPath = null;
  } finally {
    process.parentPort.postMessage({ type: 'unloaded' });
  }
}

function handleDiagnostics() {
  process.parentPort.postMessage({
    type: 'diagnostics-result',
    modelKey: _loadedModelPath ? require('./modelManifest').MODEL_KEY : null,
    loaded: !!model,
    contextReady: !!context,
    contextSize: context ? context.contextSize : null,
    loadCount: _loadCount,
    activeInferenceCount: _activeInferenceCount,
    sessionCount: _sessions.size,
    lastErrorCategory: _lastErrorCategory,
    memoryUsage: process.memoryUsage(),
  });
}

// --- Stage 4: persistent-session / tool-calling handlers ------------------

// Builds a real node-llama-cpp ChatSessionModelFunctions object (verified
// shape: {[name]: {description?, params?: GbnfJsonSchema, handler}}) from
// the plain, serializable {name: {description, params}} schemas the
// parent sent over IPC. Every handler is a thin RPC proxy -- it never
// executes the real Knowledge Base operation itself (that code, and the
// data it reads, never enters this process); it messages the parent with
// a correlated callId and returns the promise that resolves when the
// matching {type:'tool-result'} arrives.
function buildFunctionsFromSchemas(sessionId, toolSchemas) {
  const functions = {};
  for (const [name, schema] of Object.entries(toolSchemas || {})) {
    functions[name] = {
      description: schema.description,
      params: schema.params,
      handler: (params) => new Promise((resolve, reject) => {
        const callId = ++_toolCallCounter;
        _pendingToolCalls.set(callId, { resolve, reject });
        process.parentPort.postMessage({ type: 'tool-call', sessionId, callId, toolName: name, params });
      }),
    };
  }
  return functions;
}

async function handleCreateSession({ sessionId, toolSchemas, systemInstruction }) {
  try {
    if (_sessions.has(sessionId)) throw new Error(`session "${sessionId}" already exists`);
    await handleCreateSessionInline({ sessionId, toolSchemas, systemInstruction });
    process.parentPort.postMessage({ type: 'session-created', sessionId });
  } catch (err) {
    _lastErrorCategory = 'CONTEXT_CREATE_FAILED';
    process.parentPort.postMessage({ type: 'session-create-error', sessionId, message: err && err.message ? err.message : String(err) });
  }
}

// A reply to this worker's own earlier {type:'tool-call'} -- resolves (or
// rejects) the specific pending handler promise it belongs to. A callId
// with no pending entry is a safe no-op (e.g. the session was disposed
// while the parent's own tool execution was still in flight).
function handleToolResult({ callId, result, error }) {
  const pending = _pendingToolCalls.get(callId);
  if (!pending) return;
  _pendingToolCalls.delete(callId);
  if (error) pending.reject(new Error(error));
  else pending.resolve(result);
}

// Runs one full conversational turn on a persistent session. node-llama-
// cpp's own promptWithMeta() drives the ENTIRE tool-call loop internally
// (calling each function's handler, feeding the result back to the
// model, and repeating until the model produces a final text-only
// response or a stop condition) -- this worker does not hand-rolled-parse
// any tool-call JSON itself; that is exactly what the real `functions`
// option (verified against node-llama-cpp 3.20.0's own
// ChatSessionModelFunctions type) is for.
async function handlePromptSession({ sessionId, requestId, message, maxTokens = 512, noFunctions = false }) {
  const entry = _sessions.get(sessionId);
  if (!entry) {
    process.parentPort.postMessage({ type: 'session-error', sessionId, requestId, message: `session "${sessionId}" not found` });
    return;
  }
  try {
    const t0 = performance.now();
    // Section 26: a bounded regeneration-without-leak attempt must not be
    // able to re-enter the tool-calling cycle -- `noFunctions` omits the
    // `functions` option entirely for this one call (not merely an
    // instruction telling the model not to call tools), a structural
    // guarantee rather than relying on instruction-following alone.
    const result = await entry.llamaSession.promptWithMeta(message, {
      ...(noFunctions ? {} : { functions: entry.functions }),
      maxTokens,
    });
    const totalMs = performance.now() - t0;
    // promptWithMeta's own `responseText` is already the plain visible
    // text (verified directly against node-llama-cpp 3.20.0's own
    // LlamaChatSession.d.ts) -- used directly rather than re-derived, so
    // this worker never risks drifting from the library's own definition
    // of "visible text" (e.g. how it excludes thought segments). `response`
    // (the raw mixed array) is still walked separately, only to extract
    // the structured tool-call log for the parent's own grounding
    // bookkeeping.
    const toolCalls = [];
    for (const part of result.response) {
      if (part && part.type === 'functionCall') toolCalls.push({ name: part.name, params: part.params, result: part.result });
    }
    process.parentPort.postMessage({ type: 'session-result', sessionId, requestId, text: result.responseText, toolCalls, stopReason: result.stopReason, timing: { totalMs } });
  } catch (err) {
    _lastErrorCategory = /context/i.test(err && err.message || '') ? 'CONTEXT_LIMIT' : 'INFERENCE_FAILED';
    process.parentPort.postMessage({ type: 'session-error', sessionId, requestId, message: err && err.message ? err.message : String(err) });
  }
}

// Section 30: reset must clear conversational state without unloading the
// model. Implemented as dispose-and-recreate (a fresh LlamaChatSession +
// a fresh sequence) rather than relying on the library's own
// resetChatHistory() -- guarantees a genuinely clean state (including a
// freshly re-seeded system prompt) rather than depending on that method's
// own exact semantics.
async function handleResetSession({ sessionId, toolSchemas, systemInstruction }) {
  const entry = _sessions.get(sessionId);
  try {
    if (entry) {
      try { entry.llamaSession.dispose({ disposeSequence: false }); } catch { /* already disposed -- safe no-op */ }
      try { await entry.sequence.dispose(); } catch { /* already disposed -- safe no-op */ }
      _sessions.delete(sessionId);
    }
    await handleCreateSessionInline({ sessionId, toolSchemas, systemInstruction });
    process.parentPort.postMessage({ type: 'session-reset', sessionId });
  } catch (err) {
    process.parentPort.postMessage({ type: 'session-reset-error', sessionId, message: err && err.message ? err.message : String(err) });
  }
}

// Shared by handleCreateSession's own message-driven entry point and
// handleResetSession above (which needs the SAME creation logic without
// re-triggering a duplicate 'session-created'/'session-create-error'
// message pair).
async function handleCreateSessionInline({ sessionId, toolSchemas, systemInstruction }) {
  if (!model || !context) throw new Error('model/context not ready -- call load then createContext first');
  const { LlamaChatSession, QwenChatWrapper } = await nllc();
  await waitForFreeSequence();
  const sequence = context.getSequence();
  const chatWrapper = new QwenChatWrapper({
    variation: RUNTIME_COMPATIBILITY.chatWrapper.variation,
    thoughts: RUNTIME_COMPATIBILITY.chatWrapper.thoughts,
  });
  const functions = buildFunctionsFromSchemas(sessionId, toolSchemas);
  const llamaSession = new LlamaChatSession({ contextSequence: sequence, chatWrapper, systemPrompt: systemInstruction });
  _sessions.set(sessionId, { llamaSession, sequence, functions });
}

// Section 16: exposes node-llama-cpp's own real getChatHistory()/
// setChatHistory() so the orchestrator (parent process) can apply its
// own deterministic pruning policy (historyPruning.js) to the REAL
// ChatHistoryItem[] and write the pruned result back -- this worker has
// no pruning POLICY of its own, only the mechanical get/set.
function handleGetSessionHistory({ sessionId, requestId }) {
  const entry = _sessions.get(sessionId);
  if (!entry) {
    process.parentPort.postMessage({ type: 'session-history-error', sessionId, requestId, message: `session "${sessionId}" not found` });
    return;
  }
  process.parentPort.postMessage({ type: 'session-history-result', sessionId, requestId, history: entry.llamaSession.getChatHistory() });
}

function handleSetSessionHistory({ sessionId, requestId, history }) {
  const entry = _sessions.get(sessionId);
  if (!entry) {
    process.parentPort.postMessage({ type: 'session-history-set-error', sessionId, requestId, message: `session "${sessionId}" not found` });
    return;
  }
  try {
    entry.llamaSession.setChatHistory(history);
    process.parentPort.postMessage({ type: 'session-history-set', sessionId, requestId });
  } catch (err) {
    process.parentPort.postMessage({ type: 'session-history-set-error', sessionId, requestId, message: err && err.message ? err.message : String(err) });
  }
}

async function handleDisposeSession({ sessionId }) {
  const entry = _sessions.get(sessionId);
  if (entry) {
    try { entry.llamaSession.dispose({ disposeSequence: false }); } catch { /* already disposed -- safe no-op */ }
    try { await entry.sequence.dispose(); } catch { /* already disposed -- safe no-op */ }
    _sessions.delete(sessionId);
  }
  process.parentPort.postMessage({ type: 'session-disposed', sessionId });
}

process.parentPort.on('message', (e) => {
  const msg = e.data;
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'load') handleLoad(msg.modelPath);
  else if (msg.type === 'createContext') handleCreateContext();
  else if (msg.type === 'infer') handleInfer(msg);
  else if (msg.type === 'disposeContext') handleDisposeContext();
  else if (msg.type === 'unload') handleUnload();
  else if (msg.type === 'diagnostics') handleDiagnostics();
  else if (msg.type === 'createSession') handleCreateSession(msg);
  else if (msg.type === 'tool-result') handleToolResult(msg);
  else if (msg.type === 'promptSession') handlePromptSession(msg);
  else if (msg.type === 'resetSession') handleResetSession(msg);
  else if (msg.type === 'disposeSession') handleDisposeSession(msg);
  else if (msg.type === 'getSessionHistory') handleGetSessionHistory(msg);
  else if (msg.type === 'setSessionHistory') handleSetSessionHistory(msg);
});
