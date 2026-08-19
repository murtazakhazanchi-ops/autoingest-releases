'use strict';

// services/localJudge/runtime.js — Phase C2. Parent-side (Electron main
// process) coordinator for the isolated local-judge utilityProcess
// (runtimeWorker.js). Owns exactly what Part G assigns to the parent:
// lifecycle coordination, request IDs, timeout, cancellation, process
// restart/recovery, model load/loaded state, and validating results before
// returning them to callers. Owns NOTHING about node-llama-cpp itself --
// that lives entirely in the child (runtimeWorker.js); this file never
// requires node-llama-cpp.
//
// Concurrency: a single module-level singleton child process and a strict
// FIFO queue -- one active generation at a time (Part K). The queue is
// built so a failed/cancelled/timed-out request can never poison later
// requests (each queued task runs regardless of the previous task's
// outcome; only the ORIGINAL caller for that specific task sees its own
// rejection). Model load is deduplicated: concurrent callers requesting
// the same model while a load is already in flight share the same load
// promise rather than triggering a second load.

let _child = null; // the UtilityProcess instance, or null if not spawned
let _loadState = 'NOT_LOADED'; // NOT_LOADED | LOADING | LOADED | ERROR
let _loadedModelPath = null;
let _loadPromise = null;
let _pending = new Map(); // requestId -> { resolve, reject, timer }
let _requestCounter = 0;
let _queueTail = Promise.resolve();

function _reset() {
  _child = null;
  _loadState = 'NOT_LOADED';
  _loadedModelPath = null;
  _loadPromise = null;
  // Any request still waiting on the now-dead child can never be answered.
  for (const [, entry] of _pending) {
    clearTimeout(entry.timer);
    entry.reject(Object.assign(new Error('local judge runtime process exited unexpectedly'), { crashed: true }));
  }
  _pending.clear();
}

// Real production spawn -- Electron's utilityProcess, only ever callable
// inside a running Electron main process (verified this checkpoint via a
// real electronSmokeTest.js run: model load, inference, cancellation,
// timeout, and crash recovery all proven against the real runtime).
function _realSpawn() {
  const { utilityProcess } = require('electron');
  const path = require('path');
  return utilityProcess.fork(path.join(__dirname, 'runtimeWorker.js'), [], { stdio: 'pipe' });
}

// Test-only injection point -- lets test/localJudgeRuntime.test.js exercise
// the real queueing/timeout/cancellation/crash-recovery logic below against
// a fake, in-process EventEmitter child instead of a real Electron
// utilityProcess (which cannot run under plain `node`). Production code
// never calls this; it always uses the real _realSpawn(). Mirrors the same
// "keep the real dependency injectable" discipline C1's judge parameter
// already established.
let _spawnFn = _realSpawn;
function _setSpawnFnForTesting(fn) {
  _spawnFn = fn || _realSpawn;
}

function _spawn() {
  const child = _spawnFn();
  child.on('exit', () => {
    // A stale/superseded child (e.g. one that was terminate()'d and whose
    // 'exit' event is only now arriving asynchronously) must NOT reset
    // state that a newer child has since taken over. Only reset if this
    // exiting child is still the current, active one.
    if (child !== _child) return;
    // A native inference crash (or any unexpected exit) must not crash the
    // main process -- this handler is exactly the recovery path: reject
    // whatever was in flight, reset to NOT_LOADED, and let the next
    // ensureLoaded() call transparently respawn.
    _reset();
  });
  child.on('message', (message) => {
    const msg = message;
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'result' || msg.type === 'infer-error') {
      const entry = _pending.get(msg.requestId);
      if (!entry) return; // already timed out/cancelled -- a late response is a safe no-op
      _pending.delete(msg.requestId);
      clearTimeout(entry.timer);
      if (msg.type === 'infer-error') entry.reject(new Error(msg.message));
      else entry.resolve(msg);
    }
  });
  return child;
}

// Idempotent and dedup-safe: concurrent callers requesting the SAME
// modelPath while a load is already in flight share the one real load;
// requesting a DIFFERENT modelPath while one is already LOADED requires an
// explicit unload() first (never silently swaps models under a caller).
async function ensureLoaded(modelPath) {
  if (_loadState === 'LOADED' && _loadedModelPath === modelPath) return { alreadyLoaded: true };
  if (_loadState === 'LOADED' && _loadedModelPath !== modelPath) {
    throw new Error(`a different model is already loaded (${_loadedModelPath}) -- call unload() first`);
  }
  if (_loadState === 'LOADING') return _loadPromise;

  _loadState = 'LOADING';
  _loadPromise = (async () => {
    if (!_child) _child = _spawn();
    const result = await new Promise((resolve, reject) => {
      const onMessage = (message) => {
        const msg = message;
        if (msg && msg.type === 'loaded') {
          _child.off('message', onMessage);
          resolve(msg);
        } else if (msg && msg.type === 'load-error') {
          _child.off('message', onMessage);
          reject(new Error(msg.message));
        }
      };
      _child.on('message', onMessage);
      _child.postMessage({ type: 'load', modelPath });
    });
    _loadState = 'LOADED';
    _loadedModelPath = modelPath;
    return result;
  })().catch((err) => {
    _loadState = 'ERROR';
    _loadedModelPath = null;
    throw err;
  });
  return _loadPromise;
}

async function unload() {
  if (!_child || _loadState !== 'LOADED') {
    _loadState = 'NOT_LOADED';
    _loadedModelPath = null;
    return;
  }
  const child = _child;
  await new Promise((resolve) => {
    const onMessage = (message) => {
      if (message && message.type === 'unloaded') {
        child.off('message', onMessage);
        child.off('exit', onExit);
        resolve();
      }
    };
    // Reliability checkpoint (post-C4): before this handler existed, a
    // child that died (crashed or was killed) while unload() awaited the
    // 'unloaded' acknowledgement left this promise pending FOREVER -- the
    // matrix's own stress probe measured this directly (20s+ hangs, 100%
    // reproducible below ~900ms after a cancel, before the cancel-signal
    // fix above). _spawn()'s own 'exit' listener already resets global
    // state (_reset()) for this same child; this listener only needs to
    // settle THIS specific pending unload() promise. Resolves rather than
    // rejects -- a dead child means the model is unloaded by definition
    // (matching _reset()'s own NOT_LOADED-on-exit philosophy), and a
    // caller awaiting unload() only to see an unrelated crash surfaced as
    // an error would be a confusing, unnecessary failure mode.
    const onExit = () => {
      child.off('message', onMessage);
      child.off('exit', onExit);
      resolve();
    };
    child.on('message', onMessage);
    child.on('exit', onExit);
    child.postMessage({ type: 'unload' });
  });
  _loadState = 'NOT_LOADED';
  _loadedModelPath = null;
}

// Terminates the child process entirely (app quit / explicit teardown).
function terminate() {
  if (_child) _child.kill();
  _reset();
}

// Queue a task so it always runs regardless of the previous task's
// outcome -- the shared tail promise itself never rejects, so one bad
// request can never poison the ones behind it in the queue.
function _enqueue(taskFn) {
  const result = _queueTail.then(taskFn, taskFn);
  _queueTail = result.then(() => {}, () => {});
  return result;
}

// Core inference call. `timeoutMs` has no built-in default here -- see
// judgeAdapter.js for the production-recommended value derived from real
// measurement (Part L); this function requires the caller to be explicit
// rather than silently assuming a number. A timeout, cancellation, or
// crash all surface as a REJECTED promise -- exactly the shape C1's
// injected judge contract already expects to catch and fall back safely
// from (resolveEntailmentAuthority()'s 'model-failure-fallback' path).
function infer({ system, user, schema, maxTokens, repeatPenalty, modelPath, timeoutMs, signal }) {
  return _enqueue(async () => {
    if (signal && signal.aborted) {
      throw Object.assign(new Error('request cancelled before it started'), { cancelled: true });
    }
    await ensureLoaded(modelPath);

    const requestId = ++_requestCounter;
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        _pending.delete(requestId);
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(Object.assign(new Error(`local judge inference timed out after ${timeoutMs}ms`), { timedOut: true }));
      }, timeoutMs);
      const onAbort = () => {
        cleanup();
        reject(Object.assign(new Error('request cancelled'), { cancelled: true }));
        // Reliability checkpoint (post-C4) investigated actually telling
        // the child to stop generating here (a real 'cancel' message,
        // using node-llama-cpp's own signal/stopOnAbortSignal support) --
        // see runtimeWorker.js's header comment for the full evidence.
        // That change was reverted: it turned an intermittent native
        // crash into an almost-100%-reproducible one, with a DIFFERENT
        // signature (SIGBUS inside context.dispose() itself, immediately
        // after an actively-interrupted generation) that traces to
        // node-llama-cpp's own native (Metal) context teardown, not to
        // this file. The child therefore still keeps generating for this
        // now-abandoned request, unchanged from before this checkpoint;
        // its eventual 'result'/'infer-error' message will find no entry
        // in _pending (already deleted above) and be safely ignored. A
        // subsequent request is not blocked by this -- the queue only
        // waits for THIS promise to settle, which it just did. What DID
        // change this checkpoint is unload() below, which no longer hangs
        // forever if the child crashes (for this or any other reason)
        // while it's waiting for the model to actually unload.
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      _pending.set(requestId, { resolve, reject, timer });
      _child.postMessage({ type: 'infer', requestId, system, user, schema, maxTokens, repeatPenalty });
    });
  });
}

function getLoadState() {
  return { loadState: _loadState, loadedModelPath: _loadedModelPath, pid: _child ? _child.pid : null };
}

module.exports = { ensureLoaded, unload, terminate, infer, getLoadState, _setSpawnFnForTesting };
