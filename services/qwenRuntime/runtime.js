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

// Stage 4 additions -- persistent-session / tool-calling state, routed
// through the SAME child/queue as the stateless infer() path above (one
// physical child process, one FIFO queue, regardless of whether a given
// request is a Stage-3 style one-shot infer() or a Stage-4 session turn).
let _pendingSessions = new Map(); // requestId -> { resolve, reject, timer }
let _sessionRequestCounter = 0;
// sessionId -> Map<toolName, async (params) => result>. Registered by the
// orchestrator layer (never this file), which owns the REAL Stage-2
// Knowledge Base operations -- this file only routes an already-arrived
// {type:'tool-call'} to whichever handler was registered for it, exactly
// mirroring _pending's own "look up by id, safe no-op if absent" pattern.
let _sessionToolHandlers = new Map();

// Found during Stage 4's own review, scoped to Stage 4's own new code
// (never touches load/createContext/disposeContext/unload above, which
// predate this and are already qualified): createSession/resetSession/
// getSessionHistory/setSessionHistory/disposeSession each wait on a
// one-shot ad hoc `_child.on('message', ...)` listener with no entry in
// `_pending`/`_pendingSessions`, so a crash mid-request would never
// settle their promise -- and because every one of them runs inside
// `_enqueue()`, a permanently-unsettled promise would wedge the shared
// FIFO queue forever, blocking ALL future work on the runtime (not just
// that one call). `_pendingChildOps` is a small, function-scoped registry
// of reject callbacks these five functions register themselves into
// while waiting, so `_reset()` (already the single place a real child
// crash is handled) can settle them the same way it already settles
// `_pending`/`_pendingSessions`.
let _pendingChildOps = new Set();

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
  for (const [, entry] of _pendingSessions) {
    clearTimeout(entry.timer);
    entry.reject(new QwenRuntimeError('RUNTIME_CRASHED', 'Qwen runtime process exited unexpectedly'));
  }
  _pendingSessions.clear();
  for (const rejectFn of _pendingChildOps) rejectFn();
  _pendingChildOps.clear();
  // Sessions themselves live inside the now-dead child -- nothing to
  // dispose there, but the registered tool-handler lookup table is
  // orchestrator-owned state, not runtime-owned, so it is deliberately
  // NOT cleared here (Section 30: model lifecycle and conversation
  // lifecycle are separate -- a crash/restart does not itself mean the
  // orchestrator's own session bookkeeping should be forgotten; the
  // orchestrator layer decides whether to recreate sessions after a
  // crash, not this file).
}

// Wraps a one-shot ad hoc child-message wait so a crash during it settles
// the promise instead of hanging (see _pendingChildOps above). `run`
// receives (resolve, reject) exactly like a Promise executor; the
// returned promise behaves identically except it also self-unregisters
// from `_pendingChildOps` once settled through either path.
function _awaitChildMessage(run) {
  return new Promise((resolve, reject) => {
    const onCrash = () => rejectFn(new QwenRuntimeError('RUNTIME_CRASHED', 'Qwen runtime process exited unexpectedly'));
    const settle = (fn, value) => { _pendingChildOps.delete(onCrash); fn(value); };
    const resolveFn = (value) => settle(resolve, value);
    const rejectFn = (err) => settle(reject, err);
    _pendingChildOps.add(onCrash);
    run(resolveFn, rejectFn);
  });
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
    } else if (msg.type === 'session-result' || msg.type === 'session-error') {
      const entry = _pendingSessions.get(msg.requestId);
      if (!entry) return; // already timed out/cancelled -- a late response is a safe no-op (Section 19, same as infer())
      _pendingSessions.delete(msg.requestId);
      clearTimeout(entry.timer);
      if (msg.type === 'session-error') entry.reject(mapUnknownError(new Error(msg.message), ERROR_CODE.INFERENCE_FAILED));
      else entry.resolve(msg);
    } else if (msg.type === 'tool-call') {
      // Routes an already-arrived tool call to whichever handler the
      // orchestrator layer registered for this session -- this file never
      // executes a Knowledge Base operation itself, only relays. A
      // missing session/tool (e.g. the session was disposed while a call
      // was mid-flight) is reported back to the CHILD as an error, never
      // silently dropped -- the child's own pending handler promise would
      // otherwise hang forever.
      const sessionHandlers = _sessionToolHandlers.get(msg.sessionId);
      const handler = sessionHandlers && sessionHandlers.get(msg.toolName);
      if (!handler) {
        _child && _child.postMessage({ type: 'tool-result', callId: msg.callId, error: `no handler registered for tool "${msg.toolName}" in session "${msg.sessionId}"` });
        return;
      }
      Promise.resolve().then(() => handler(msg.params)).then(
        (result) => { _child && _child.postMessage({ type: 'tool-result', callId: msg.callId, result }); },
        (err) => { _child && _child.postMessage({ type: 'tool-result', callId: msg.callId, error: (err && err.message) || String(err) }); },
      );
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

// --- Stage 4: persistent-session / tool-calling API -----------------------
//
// Registered separately from the create/prompt/reset/dispose calls below
// so the orchestrator can supply (and later swap, e.g. after a reset)
// the real Stage-2 handler functions without this file ever importing
// the Knowledge Base itself (Section 6's own boundary, preserved: this
// file still never requires anything about search_autoingest/etc.).
function registerSessionToolHandlers(sessionId, handlers) {
  const map = new Map(Object.entries(handlers || {}));
  _sessionToolHandlers.set(sessionId, map);
}

function unregisterSessionToolHandlers(sessionId) {
  _sessionToolHandlers.delete(sessionId);
}

// createSession({sessionId, toolSchemas, systemInstruction}) -- routed
// through the same FIFO queue as every other child request (Section 29:
// one active operator generation at a time, enforced structurally by
// this one queue regardless of whether the request is a legacy infer()
// call or a Stage-4 session operation).
function createSession({ sessionId, toolSchemas, systemInstruction }) {
  return _enqueue(async () => {
    if (_state !== STATE.READY && _state !== STATE.BUSY) {
      throw new QwenRuntimeError('CONTEXT_CREATE_FAILED', `cannot create a session in state ${_state} -- call load() first`);
    }
    return _awaitChildMessage((resolve, reject) => {
      const onMessage = (message) => {
        if (message && message.type === 'session-created' && message.sessionId === sessionId) {
          _child.off('message', onMessage);
          resolve({ sessionId });
        } else if (message && message.type === 'session-create-error' && message.sessionId === sessionId) {
          _child.off('message', onMessage);
          reject(mapUnknownError(new Error(message.message), ERROR_CODE.CONTEXT_CREATE_FAILED));
        }
      };
      _child.on('message', onMessage);
      _child.postMessage({ type: 'createSession', sessionId, toolSchemas, systemInstruction });
    });
  });
}

// promptSession({sessionId, message, maxTokens, timeoutMs, signal}) --
// Cancellation follows the EXACT same "stop waiting, don't interrupt"
// strategy as infer() (Section 19/28 of Stage 4's own brief: "do not
// create orchestration logic that assumes native compute stopped
// instantly" -- a cancelled turn's tool-calling/generation loop keeps
// running in the isolated child in the background; its eventual
// session-result finds no _pendingSessions entry and is safely
// discarded).
function promptSession({ sessionId, message, maxTokens, timeoutMs, signal, noFunctions }) {
  return _enqueue(async () => {
    if (signal && signal.aborted) {
      throw new QwenRuntimeError('INFERENCE_CANCELLED', 'turn cancelled before it started');
    }
    if (_state !== STATE.READY) {
      throw new QwenRuntimeError('MODEL_LOAD_FAILED', `cannot prompt a session in state ${_state} -- call load() first`);
    }
    _state = STATE.BUSY;
    const requestId = ++_sessionRequestCounter;
    try {
      return await new Promise((resolve, reject) => {
        const cleanup = () => {
          _pendingSessions.delete(requestId);
          clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', onAbort);
        };
        const timer = setTimeout(() => {
          cleanup();
          reject(new QwenRuntimeError('INFERENCE_FAILED', `Qwen session turn timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        const onAbort = () => {
          cleanup();
          reject(new QwenRuntimeError('INFERENCE_CANCELLED', 'turn cancelled'));
        };
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        _pendingSessions.set(requestId, { resolve, reject, timer });
        _child.postMessage({ type: 'promptSession', sessionId, requestId, message, maxTokens, noFunctions: !!noFunctions });
      });
    } finally {
      if (_state === STATE.BUSY) _state = STATE.READY;
    }
  });
}

// resetSession (Section 30): clears conversational state without
// unloading the model -- routed through the same queue so it safely
// waits behind any in-flight turn on this (or another) session, exactly
// like unload() already waits behind in-flight inference.
function resetSession({ sessionId, toolSchemas, systemInstruction }) {
  return _enqueue(async () => {
    if (!_child) throw new QwenRuntimeError('CONTEXT_CREATE_FAILED', 'cannot reset a session -- runtime not loaded');
    return _awaitChildMessage((resolve, reject) => {
      const onMessage = (message) => {
        if (message && message.type === 'session-reset' && message.sessionId === sessionId) {
          _child.off('message', onMessage);
          resolve({ sessionId });
        } else if (message && message.type === 'session-reset-error' && message.sessionId === sessionId) {
          _child.off('message', onMessage);
          reject(mapUnknownError(new Error(message.message), ERROR_CODE.CONTEXT_CREATE_FAILED));
        }
      };
      _child.on('message', onMessage);
      _child.postMessage({ type: 'resetSession', sessionId, toolSchemas, systemInstruction });
    });
  });
}

// getSessionHistory/setSessionHistory (Section 16): a thin, mechanical
// remote get/set over the real node-llama-cpp ChatHistoryItem[] living in
// the child -- this file has no pruning POLICY of its own (that is
// historyPruning.js's own job, in the orchestrator layer); it only
// relays the real history across the process boundary.
let _historyRequestCounter = 0;
function getSessionHistory(sessionId) {
  return _enqueue(async () => {
    if (!_child) throw new QwenRuntimeError('CONTEXT_CREATE_FAILED', 'cannot read session history -- runtime not loaded');
    const requestId = ++_historyRequestCounter;
    return _awaitChildMessage((resolve, reject) => {
      const onMessage = (message) => {
        if (message && message.requestId === requestId && message.type === 'session-history-result') {
          _child.off('message', onMessage);
          resolve(message.history);
        } else if (message && message.requestId === requestId && message.type === 'session-history-error') {
          _child.off('message', onMessage);
          reject(mapUnknownError(new Error(message.message)));
        }
      };
      _child.on('message', onMessage);
      _child.postMessage({ type: 'getSessionHistory', sessionId, requestId });
    });
  });
}

function setSessionHistory(sessionId, history) {
  return _enqueue(async () => {
    if (!_child) throw new QwenRuntimeError('CONTEXT_CREATE_FAILED', 'cannot write session history -- runtime not loaded');
    const requestId = ++_historyRequestCounter;
    return _awaitChildMessage((resolve, reject) => {
      const onMessage = (message) => {
        if (message && message.requestId === requestId && message.type === 'session-history-set') {
          _child.off('message', onMessage);
          resolve({ sessionId });
        } else if (message && message.requestId === requestId && message.type === 'session-history-set-error') {
          _child.off('message', onMessage);
          reject(mapUnknownError(new Error(message.message)));
        }
      };
      _child.on('message', onMessage);
      _child.postMessage({ type: 'setSessionHistory', sessionId, requestId, history });
    });
  });
}

function disposeSession(sessionId) {
  return _enqueue(async () => {
    unregisterSessionToolHandlers(sessionId);
    if (!_child) return { sessionId, alreadyDisposed: true };
    return _awaitChildMessage((resolve) => {
      const onMessage = (message) => {
        if (message && message.type === 'session-disposed' && message.sessionId === sessionId) {
          _child.off('message', onMessage);
          resolve({ sessionId });
        }
      };
      _child.on('message', onMessage);
      _child.postMessage({ type: 'disposeSession', sessionId });
    });
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
    activeSessionTurnCount: _pendingSessions.size,
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
  createSession, promptSession, resetSession, disposeSession,
  registerSessionToolHandlers, unregisterSessionToolHandlers,
  getSessionHistory, setSessionHistory,
};
