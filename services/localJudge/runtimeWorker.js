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

let llama = null;
let model = null;

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
  const loadMs = performance.now() - t0;
  process.parentPort.postMessage({ type: 'loaded', loadMs, gpu: llama.gpu });
}

async function handleInfer({ requestId, system, user, schema, maxTokens = 200, repeatPenalty }) {
  const { LlamaChatSession } = await nllc();
  if (!model) {
    process.parentPort.postMessage({ type: 'infer-error', requestId, message: 'model not loaded' });
    return;
  }
  try {
    const grammar = await llama.createGrammarForJsonSchema(schema);
    const context = await model.createContext({ sequences: 1 });
    const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt: system });

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
    await context.dispose();

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
