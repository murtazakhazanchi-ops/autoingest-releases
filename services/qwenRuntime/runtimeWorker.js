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

const { CONTEXT_SIZE, RUNTIME_COMPATIBILITY, INFERENCE_DEFAULTS } = require('./modelManifest');

let llama = null;
let model = null;
let context = null;
let _loadedModelPath = null;
let _loadCount = 0;
let _activeInferenceCount = 0;
let _lastErrorCategory = null;

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
    lastErrorCategory: _lastErrorCategory,
    memoryUsage: process.memoryUsage(),
  });
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
});
