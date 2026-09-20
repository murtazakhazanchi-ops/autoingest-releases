'use strict';

// services/localJudge/runtimeWorker.js — Phase C2. Runs ONLY inside an
// Electron utilityProcess (spawned by runtime.js via
// utilityProcess.fork(__dirname + '/runtimeWorker.js')) -- never in the
// renderer, preload, or Electron main process itself. This isolation is
// the entire point: a native-addon crash inside node-llama-cpp (Metal/CPU
// inference) terminates THIS process only; the parent (main process) sees
// an 'exit' event and recovers, per Part G.
//
// Owns: node-llama-cpp model loading, the inference context, generation,
// and model unload. Owns NOTHING else -- no filesystem download/checksum
// logic (modelManager.js's job), no queueing/timeout/request-id bookkeeping
// (runtime.js's job, in the parent). Message contract is intentionally
// tiny and generic (system/user/schema/maxTokens in, parsed-JSON-or-error
// out) -- this file has no knowledge of the entailment prompt/schema
// specifically; that stays entirely in judgeAdapter.js.
//
// Message protocol (process.parentPort):
//   in  {type:'load', modelPath}
//   out {type:'loaded', loadMs, gpu} | {type:'load-error', message}
//   in  {type:'infer', requestId, system, user, schema, maxTokens, repeatPenalty}
//   out {type:'result', requestId, raw, parsed, parseError, timing}
//       | {type:'infer-error', requestId, message}
//   in  {type:'unload'}
//   out {type:'unloaded'}
//
// Reliability checkpoint (post-C4) -- forensic investigation into a
// cancel-then-unload crash/hang found during C4's real-Electron
// verification. Two things were tried and empirically evaluated with a
// real reproduction matrix (real utilityProcess, real Phi-4-mini model):
//
// 1. Wiring node-llama-cpp's already-public `signal`/`stopOnAbortSignal`
//    options on session.prompt() to actually interrupt an abandoned
//    generation when cancelled, instead of leaving it running unowned in
//    the background (which is what this integration does today -- see
//    runtime.js's own onAbort comment). This was IMPLEMENTED, TESTED, AND
//    REVERTED: it made the underlying native crash MORE frequent (from a
//    ~40% reproduction rate at short cancel-delays to effectively 100%),
//    and changed its signature from SIGABRT (ggml_uncaught_exception,
//    inside model.dispose()) to SIGBUS/EXC_BAD_ACCESS inside
//    llama_context::synchronize() -> ~llama_context() -> AddonContext::
//    Dispose(), i.e. INSIDE context.dispose() itself, immediately after an
//    actively-interrupted generation. This is assessed as a genuine
//    upstream synchronization gap between node-llama-cpp's abort-signal
//    early-stop and native (Metal) context teardown, not a bug in this
//    integration's own message protocol or queueing -- see this
//    checkpoint's own report for the full before/after evidence. No safe
//    local workaround was found that does not amount to an arbitrary
//    delay, which is explicitly not an acceptable fix. Per this
//    checkpoint's own stop conditions, that half was reverted rather than
//    shipped; this file therefore still does NOT actually interrupt an
//    abandoned generation. A future checkpoint revisiting this should
//    check for an updated node-llama-cpp release before retrying.
//
// 2. context.dispose() is now called from a try/finally around the whole
//    grammar/context/session/prompt block (KEPT -- this part is safe and
//    independent of (1) above): previously it only ran on the success
//    path, so ANY exception -- a real model/grammar error, not just a
//    cancellation -- silently leaked the context and, with it, its
//    permanent hold on model.dispose()'s own internal DisposeGuard (an
//    upstream, already-correct reference-counted async lock; see
//    node_modules/node-llama-cpp/dist/utils/DisposeGuard.js), which is
//    exactly what the reproduction matrix's ~20s HANGS traced back to.
//    This half is unaffected by (1)'s revert: with no signal ever passed
//    to session.prompt(), it can only ever reject via a genuine model/
//    native error (same as before this checkpoint) or resolve normally --
//    in both cases the underlying native decode loop has already
//    quiesced through its OWN try/finally (LlamaContext.js's
//    createPreventDisposalHandle()/dispose() pairing around each decode
//    batch) before control reaches here, so disposing here is safe.

let llama = null;
let model = null;
let _loadedModelPath = null;

// Production-transfer validation checkpoint (2026-08-27, Product Owner
// Phase 3) addition: node-llama-cpp auto-detects a chat template from the
// loaded GGUF's own metadata when no explicit chatWrapper is passed to
// LlamaChatSession -- exactly what this file did before this checkpoint,
// and still does for every model family except the one case documented
// here. Every prior benchmark in this investigation (the original model
// bake-off through the corrected Candidate C run) independently found and
// disclosed the same fact: Gemma's chat-template family defaults to an
// internal "thinking"/reasoning mode that, under a short maxTokens budget
// (this production path's schema-constrained generation uses budgets far
// smaller than an open-ended chat reply), consumes the entire budget on
// invisible reasoning content and leaves an empty visible answer. This is
// a model-family runtime-configuration fact, not a prompt or schema
// change, and not specific to any one request -- disabled uniformly for
// every request against a Gemma artifact, exactly mirroring the disclosed
// convention every A/B/C harness already used. No other model family is
// affected: this file's own default (`chatWrapper` left unset, so
// node-llama-cpp auto-detects) is completely unchanged for Phi or any
// other future model whose filename doesn't match this pattern.
function chatWrapperOptionsFor(modelPath) {
  return /gemma/i.test(modelPath || '') ? { family: 'gemma' } : null;
}

// node-llama-cpp is ESM-only (confirmed directly: a plain require() throws
// "require() of ES Module ... not supported" under Electron's utilityProcess,
// which hosts this file as CommonJS) -- loaded via dynamic import(), which
// works from a CommonJS module. Cached after first load.
let _nllc = null;
async function nllc() {
  if (!_nllc) _nllc = await import('node-llama-cpp');
  return _nllc;
}

async function handleLoad(modelPath) {
  const { getLlama } = await nllc();
  const t0 = performance.now();
  llama = await getLlama();
  model = await llama.loadModel({ modelPath });
  _loadedModelPath = modelPath;
  const loadMs = performance.now() - t0;
  process.parentPort.postMessage({ type: 'loaded', loadMs, gpu: llama.gpu });
}

async function handleInfer({ requestId, system, user, schema, maxTokens = 200, repeatPenalty }) {
  const { LlamaChatSession, Gemma4ChatWrapper } = await nllc();
  if (!model) {
    process.parentPort.postMessage({ type: 'infer-error', requestId, message: 'model not loaded' });
    return;
  }
  let context = null;
  try {
    const grammar = await llama.createGrammarForJsonSchema(schema);
    context = await model.createContext({ sequences: 1 });
    const wrapperOptions = chatWrapperOptionsFor(_loadedModelPath);
    const chatWrapper = wrapperOptions && wrapperOptions.family === 'gemma' ? new Gemma4ChatWrapper({ reasoning: false }) : undefined;
    const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt: system, ...(chatWrapper ? { chatWrapper } : {}) });

    let firstTokenMs = null;
    const t0 = performance.now();
    let tokenCount = 0;
    const raw = await session.prompt(user, {
      grammar,
      maxTokens,
      ...(repeatPenalty ? { repeatPenalty } : {}),
      onToken: (tokens) => {
        if (firstTokenMs === null) firstTokenMs = performance.now() - t0;
        tokenCount += tokens.length;
      },
    });
    const totalMs = performance.now() - t0;

    let parsed = null;
    let parseError = null;
    try {
      parsed = grammar.parse(raw);
    } catch (err) {
      try {
        parsed = JSON.parse(raw);
      } catch (err2) {
        parseError = err2.message;
      }
    }

    process.parentPort.postMessage({
      type: 'result',
      requestId,
      raw,
      parsed,
      parseError,
      timing: { firstTokenMs, totalMs, approxOutputTokens: tokenCount },
    });
  } catch (err) {
    process.parentPort.postMessage({ type: 'infer-error', requestId, message: err && err.message ? err.message : String(err) });
  } finally {
    // ALWAYS runs, not only the success path (reliability checkpoint fix,
    // see this file's header comment part 2) -- releases this context's
    // hold on model.dispose()'s DisposeGuard promptly even after a genuine
    // model/native error, closing the resource leak that otherwise hangs
    // any later unload() forever.
    if (context) await context.dispose().catch(() => {});
  }
}

async function handleUnload() {
  if (model) {
    await model.dispose();
    model = null;
  }
  llama = null;
  process.parentPort.postMessage({ type: 'unloaded' });
}

process.parentPort.on('message', (e) => {
  const msg = e.data;
  if (!msg || typeof msg.type !== 'string') return;
  if (msg.type === 'load') {
    handleLoad(msg.modelPath).catch((err) => {
      process.parentPort.postMessage({ type: 'load-error', message: err && err.message ? err.message : String(err) });
    });
  } else if (msg.type === 'infer') {
    handleInfer(msg);
  } else if (msg.type === 'unload') {
    handleUnload().catch(() => {
      process.parentPort.postMessage({ type: 'unloaded' }); // best-effort -- unload failures are not fatal to report back
    });
  }
});
