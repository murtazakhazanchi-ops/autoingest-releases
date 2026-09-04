'use strict';

// services/qwenRuntime/runtime.js — Ask AutoIngest Stage 3, Sections
// 6/15/16/19/20/21/22/24: parent-side (Electron main process) coordinator
// for the isolated Qwen utilityProcess (runtimeWorker.js). Owns exactly
// what belongs on the parent side: lifecycle state machine, request
// queueing/serialization, cancellation, process restart/recovery,
// diagnostics, and mapping raw child messages into the typed error model
// (errors.js). Owns NOTHING about node-llama-cpp itself -- that lives
// entirely in the child; this file never requires node-llama-cpp,
// matching Section 6's own renderer/main isolation goal one level further
// (the ENTIRE native runtime, not just the renderer, stays out of the
// main process).
//
// Design pattern REUSED from services/localJudge/runtime.js (Gemma's own,
// already-production-proven parent coordinator) -- that file is not
// modified by this stage. Concurrency: a single module-level singleton
// child process and a strict FIFO queue -- one active generation at a
// time (Section 20). The queue is built so a failed/cancelled/timed-out
// request can never poison later requests. Model load is deduplicated:
// concurrent callers share the same in-flight load promise.
//
// Lifecycle states (Section 15): UNINITIALIZED, MODEL_UNAVAILABLE,
// LOADING, READY, BUSY, UNLOADING, FAILED.

const { ERROR_CODE, QwenRuntimeError, mapUnknownError } = require('./errors');
const modelManager = require('./modelManager');

const STATE = Object.freeze({
  UNINITIALIZED: 'UNINITIALIZED',
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  LOADING: 'LOADING',
  READY: 'READY',
  BUSY: 'BUSY',
  UNLOADING: 'UNLOADING',
  FAILED: 'FAILED',
});

let _child = null;
let _state = STATE.UNINITIALIZED;
let _loadedModelPath = null;
let _loadPromise = null;
let _contextReady = false;
let _pending = new Map(); // requestId -> { resolve, reject, timer }
let _requestCounter = 0;
let _queueTail = Promise.resolve();
let _loadCount = 0; // total successful loads this process lifetime (Section 26: tracked separately from current state)
let _lastErrorCategory = null;

function _reset(nextState) {
  _child = null;
  _state = nextState || STATE.FAILED;
  _loadedModelPath = null;
  _loadPromise = null;
  _contextReady = false;
  for (const [, entry] of _pending) {
    clearTimeout(entry.timer);
    entry.reject(new QwenRuntimeError('RUNTIME_CRASHED', 'Qwen runtime process exited unexpectedly'));
  }
  _pending.clear();
}

function _realSpawn() {
  const { utilityProcess } = require('electron');
  const path = require('path');
  return utilityProcess.fork(path.join(__dirname, 'runtimeWorker.js'), [], { stdio: 'pipe' });
}

// Test-only injection point (Section 27A: model-independent tests must be
// able to exercise this file's own queueing/state-machine/cancellation
// logic without a real Electron utilityProcess, which cannot run under
// plain `node`). Production code always uses the real _realSpawn().
let _spawnFn = _realSpawn;
function _setSpawnFnForTesting(fn) {
  _spawnFn = fn || _realSpawn;
}

function _spawn() {
  const child = _spawnFn();
  child.on('exit', () => {
    if (child !== _child) return; // a stale/superseded child's late exit must not clobber a newer child's state
    _reset(STATE.FAILED);
  });
  child.on('message', (message) => {
    const msg = message;
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'result' || msg.type === 'infer-error') {
      const entry = _pending.get(msg.requestId);
      if (!entry) return; // already timed out/cancelled -- a late response is a safe no-op
      _pending.delete(msg.requestId);
      clearTimeout(entry.timer);
      if (msg.type === 'infer-error') entry.reject(mapUnknownError(new Error(msg.message), ERROR_CODE.INFERENCE_FAILED));
      else entry.resolve(msg);
    }
  });
  return child;
}

// Section 2: precondition check before attempting a load -- MODEL_UNAVAILABLE
// is a first-class outcome, never conflated with a load failure caused by
// the runtime process itself.
function _checkModelAvailable(overrideDir) {
  const status = modelManager.getStatus(overrideDir);
  return status.status === modelManager.STATUS.READY;
}

// Idempotent and dedup-safe: concurrent callers requesting the SAME
// modelPath while a load is already in flight share the one real load;
// requesting a DIFFERENT modelPath while one is already loaded requires
// an explicit unload() first (never silently swaps models under a
// caller). Also creates the context as part of the same bundled
// "ensure ready" step (Section 16's own lazy-load flow: "runtime loads
// if needed" is one conceptual step from a caller's perspective) --
// createContext()/disposeContext() below remain independently callable
// for Section 17's own standalone context-lifecycle testing.
async function load(modelPath, { overrideDir } = {}) {
  // A caller-supplied null/undefined modelPath means "use the resolved
  // default artifact path" -- resolved up front so the READY-dedup check
  // below compares the SAME normalized value on every call. Comparing the
  // raw, possibly-null argument instead would make load(null) never dedup
  // against a prior load(null) (null !== null is false, so that part is
  // fine, but a mix of an explicit finalPath and a null on different calls
  // for the SAME artifact would falsely look like "a different model").
  const { finalPath } = modelManager.resolvePaths(overrideDir);
  const resolvedPath = modelPath || finalPath;

  if ((_state === STATE.READY || _state === STATE.BUSY) && _loadedModelPath === resolvedPath) {
    return { alreadyLoaded: true, state: _state };
  }
  if ((_state === STATE.READY || _state === STATE.BUSY) && _loadedModelPath !== resolvedPath) {
    throw new QwenRuntimeError('UNKNOWN', `a different model is already loaded (${_loadedModelPath}) -- call unload() first`);
  }
  if (_state === STATE.LOADING) return _loadPromise;

  if (!_checkModelAvailable(overrideDir)) {
    _state = STATE.MODEL_UNAVAILABLE;
    throw new QwenRuntimeError('MODEL_NOT_INSTALLED', 'Qwen model artifact is not verified/READY -- run modelManager.verify()/download() first');
  }

  _state = STATE.LOADING;
  _loadPromise = (async () => {
    if (!_child) _child = _spawn();
    await new Promise((resolve, reject) => {
      const onMessage = (message) => {
        const msg = message;
        if (msg && msg.type === 'loaded') {
          _child.off('message', onMessage);
          resolve(msg);
        } else if (msg && msg.type === 'load-error') {
          _child.off('message', onMessage);
          reject(mapUnknownError(new Error(msg.message), ERROR_CODE.MODEL_LOAD_FAILED));
        }
      };
      _child.on('message', onMessage);
      _child.postMessage({ type: 'load', modelPath: resolvedPath });
    });
    await new Promise((resolve, reject) => {
      const onMessage = (message) => {
        const msg = message;
        if (msg && msg.type === 'context-created') {
          _child.off('message', onMessage);
          _contextReady = true;
          resolve(msg);
        } else if (msg && msg.type === 'context-create-error') {
          _child.off('message', onMessage);
          reject(mapUnknownError(new Error(msg.message), ERROR_CODE.CONTEXT_CREATE_FAILED));
        }
      };
      _child.on('message', onMessage);
      _child.postMessage({ type: 'createContext' });
    });
    _state = STATE.READY;
    _loadedModelPath = resolvedPath;
    _loadCount += 1;
    return { state: _state };
  })().catch((err) => {
    _state = STATE.FAILED;
    _loadedModelPath = null;
    _lastErrorCategory = (err && err.code) || ERROR_CODE.UNKNOWN;
    throw err;
  });
  return _loadPromise;
}

// Section 17: standalone context creation/destruction, independent of the
// bundled load() flow above -- lets a caller/test dispose and recreate a
// context without a full model unload/reload cycle.
function createContext() {
  return _enqueue(async () => {
    if (_state !== STATE.READY && _state !== STATE.BUSY) {
      throw new QwenRuntimeError('CONTEXT_CREATE_FAILED', `cannot create context in state ${_state}`);
    }
    if (_contextReady) return { alreadyReady: true };
    return new Promise((resolve, reject) => {
      const onMessage = (message) => {
        const msg = message;
        if (msg && msg.type === 'context-created') {
          _child.off('message', onMessage);
          _contextReady = true;
          resolve(msg);
        } else if (msg && msg.type === 'context-create-error') {
          _child.off('message', onMessage);
          reject(mapUnknownError(new Error(msg.message), ERROR_CODE.CONTEXT_CREATE_FAILED));
        }
      };
      _child.on('message', onMessage);
      _child.postMessage({ type: 'createContext' });
    });
  });
}

function disposeContext() {
  return _enqueue(async () => {
    if (!_child || !_contextReady) { _contextReady = false; return { alreadyDisposed: true }; }
    await new Promise((resolve) => {
      const onMessage = (message) => {
        if (message && message.type === 'context-disposed') {
          _child.off('message', onMessage);
          resolve();
        }
      };
      _child.on('message', onMessage);
      _child.postMessage({ type: 'disposeContext' });
    });
    _contextReady = false;
    return { disposed: true };
  });
}

// Section 15/21: unload is routed through the SAME FIFO queue as
// inference (see _enqueue below) -- this is what makes "unload while
// busy" safe structurally: unload() simply waits its turn behind any
// in-flight/queued inference rather than needing ad hoc locking. A dead
// child (crashed or killed) never leaves this hanging (Gemma's own
// hard-won reliability fix, reproduced identically here).
function unload() {
  return _enqueue(async () => {
    if (!_child || (_state !== STATE.READY && _state !== STATE.BUSY)) {
      _state = STATE.UNINITIALIZED;
      _loadedModelPath = null;
      _contextReady = false;
      return { state: _state };
    }
    _state = STATE.UNLOADING;
    const child = _child;
    await new Promise((resolve) => {
      const onMessage = (message) => {
        if (message && message.type === 'unloaded') {
          child.off('message', onMessage);
          child.off('exit', onExit);
          resolve();
        }
      };
      const onExit = () => {
        child.off('message', onMessage);
        child.off('exit', onExit);
        resolve(); // a dead child means the model is unloaded by definition
      };
      child.on('message', onMessage);
      child.on('exit', onExit);
      child.postMessage({ type: 'unload' });
    });
    _state = STATE.UNINITIALIZED;
    _loadedModelPath = null;
    _contextReady = false;
    return { state: _state };
  });
}

// Terminates the child process entirely (app quit / explicit teardown --
// Section 15's own "application shutdown releases resources").
function terminate() {
  if (_child) _child.kill();
  _reset(STATE.UNINITIALIZED);
}

function _enqueue(taskFn) {
  const result = _queueTail.then(taskFn, taskFn);
  _queueTail = result.then(() => {}, () => {});
  return result;
}

// Core inference call (Section 17/19/20). `timeoutMs` has no built-in
// default -- callers must be explicit, matching Gemma's own established
// discipline. A timeout, cancellation, or crash all surface as a
// REJECTED promise with a typed QwenRuntimeError.
//
// Cancellation (Section 19): on abort, this function stops WAITING and
// rejects immediately -- it does NOT tell the child to interrupt the
// native generation (see runtimeWorker.js's own header for the documented
// SIGBUS/Metal crash this avoids). The child keeps generating for the
// now-abandoned request in the background; its eventual result finds no
// entry in _pending (already deleted) and is safely discarded. The next
// queued request is not blocked -- the queue only waits for THIS
// promise to settle, which happens immediately on cancel.
function infer({ prompt, maxTokens, timeoutMs, signal }) {
  return _enqueue(async () => {
    if (signal && signal.aborted) {
      throw new QwenRuntimeError('INFERENCE_CANCELLED', 'request cancelled before it started');
    }
    if (_state !== STATE.READY) {
      throw new QwenRuntimeError('MODEL_LOAD_FAILED', `cannot infer in state ${_state} -- call load() first`);
    }
    _state = STATE.BUSY;
    const requestId = ++_requestCounter;
    try {
      return await new Promise((resolve, reject) => {
        const cleanup = () => {
          _pending.delete(requestId);
          clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', onAbort);
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new QwenRuntimeError('INFERENCE_FAILED', `Qwen inference timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        const onAbort = () => {
          cleanup();
          reject(new QwenRuntimeError('INFERENCE_CANCELLED', 'request cancelled'));
        };
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        _pending.set(requestId, { resolve, reject, timer });
        _child.postMessage({ type: 'infer', requestId, prompt, maxTokens });
      });
    } finally {
      if (_state === STATE.BUSY) _state = STATE.READY;
    }
  });
}

// Section 24: deterministic internal diagnostics. Parent-authoritative
// (always answerable even if the child is slow/unresponsive) -- never
// includes conversation contents, operator questions, or generated
// answers (Section 24's own explicit privacy boundary; note this
// function's own shape has no field that could carry that content).
function getDiagnostics() {
  return {
    state: _state,
    modelKey: _loadedModelPath ? require('./modelManifest').MODEL_KEY : null,
    loadedModelPath: _loadedModelPath,
    contextReady: _contextReady,
    contextSize: require('./modelManifest').CONTEXT_SIZE,
    processState: _child ? 'spawned' : 'not-spawned',
    pid: _child ? _child.pid : null,
    loadCount: _loadCount,
    activeInferenceCount: _pending.size,
    lastErrorCategory: _lastErrorCategory,
    mainProcessMemoryUsage: process.memoryUsage(),
  };
}

function getState() {
  return _state;
}

module.exports = {
  STATE, load, unload, terminate, infer, createContext, disposeContext,
  getDiagnostics, getState, _setSpawnFnForTesting,
};
