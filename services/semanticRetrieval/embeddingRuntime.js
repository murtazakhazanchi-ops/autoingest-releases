'use strict';

// Phase C8 — production embedding runtime for semantic candidate
// generation. DELIBERATELY separate from services/localJudge/runtime.js
// (Phi's own singleton): they are two independently-lifecycled models,
// and the architecture map produced for this checkpoint confirms
// runtime.js's own queue REQUIRES an explicit unload() before loading a
// different model -- sharing it would force choosing between Phi and the
// embedding model being resident at any moment, defeating the point of
// having both. This module never touches runtime.js, runtimeWorker.js,
// judgeService.js, or the utilityProcess architecture in any way -- it is
// a plain, in-process node-llama-cpp load, exactly matching C7's own
// prototype pattern (proven, measured: ~1.5s load, ~6-9ms/embedding,
// ~320MB RAM), never a child process. Embedding inference is a single
// forward pass through a 33M-parameter encoder (no autoregressive
// decode loop, no streaming, no mid-generation cancellation semantics) --
// structurally not exposed to the SIGBUS abort/dispose race
// runtimeWorker.js's own header documents for Phi's decode loop, so no
// analogous guarded-dispose wrapper is needed here. This module never
// calls unload()/dispose() on any schedule -- once loaded, the model
// stays resident for the life of the process, per the checkpoint's own
// explicit instruction (no invented unload-after-every-query lifecycle,
// same "no automatic idle-unload timer" precedent judgeService.js already
// established for Phi).
//
// node-llama-cpp is ESM-only (same fact runtimeWorker.js already
// documents for the SAME library) -- dynamic import(), memoized once.

let _nllc = null;
async function nllc() {
  if (!_nllc) _nllc = await import('node-llama-cpp');
  return _nllc;
}

const STATE = Object.freeze({ NOT_LOADED: 'NOT_LOADED', LOADING: 'LOADING', LOADED: 'LOADED', ERROR: 'ERROR' });

let _state = STATE.NOT_LOADED;
let _loadPromise = null;
let _model = null;
let _embeddingContext = null;
let _lastError = null;

function getState() {
  return _state;
}

// Idempotent: concurrent callers awaiting the same in-flight load share
// one promise (no duplicate model loads racing each other).
async function ensureLoaded(modelPath) {
  if (_state === STATE.LOADED) return;
  if (_loadPromise) return _loadPromise;
  _state = STATE.LOADING;
  _loadPromise = (async () => {
    try {
      const { getLlama } = await nllc();
      const llama = await getLlama();
      _model = await llama.loadModel({ modelPath });
      _embeddingContext = await _model.createEmbeddingContext();
      _state = STATE.LOADED;
    } catch (err) {
      _state = STATE.ERROR;
      _lastError = err;
      _loadPromise = null;
      throw err;
    }
  })();
  return _loadPromise;
}

// embed(text) -> Promise<number[]>. Throws if not loaded -- callers must
// ensureLoaded() first (mirrors runtime.js's own explicit-load discipline,
// never an implicit lazy-load buried inside the inference call itself, so
// a caller can distinguish "still loading" from "inference failed").
async function embed(text) {
  if (_state !== STATE.LOADED) throw new Error(`embedding runtime not loaded (state=${_state})`);
  const result = await _embeddingContext.getEmbeddingFor(text);
  return result.vector;
}

async function embedBatch(texts) {
  const out = [];
  for (const t of texts) out.push(await embed(t));
  return out;
}

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function getLastError() {
  return _lastError;
}

// Test-only reset (mirrors the discipline other singleton services in
// this codebase already use for unit-testability) -- never called by any
// production code path.
function _resetForTests() {
  _state = STATE.NOT_LOADED;
  _loadPromise = null;
  _model = null;
  _embeddingContext = null;
  _lastError = null;
}

module.exports = { STATE, getState, ensureLoaded, embed, embedBatch, cosineSimilarity, getLastError, _resetForTests };
