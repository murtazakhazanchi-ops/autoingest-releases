'use strict';

// services/localJudge/judgeService.js — Phase C3. The ONE authoritative
// construction path connecting modelManager -> runtime -> judgeAdapter,
// so no caller builds these pieces differently, no caller accidentally
// bypasses model verification, and no caller accidentally instantiates a
// second model runtime (Part E). Everything else in C3 (the outer
// answerQuestionWithAuthority() wrapper in
// scripts/product-docs/lib/answerWithAuthority.js) depends on this module
// rather than reaching into modelManager/runtime/judgeAdapter directly.
//
// Approved Product Owner timeout policy (C3 checkpoint): 20,000ms,
// justified by the C2 real production-evidence benchmark's worst observed
// case (~8.2s) plus headroom. Lives HERE -- a single named constant in the
// construction layer -- never duplicated as a bare literal in
// runtimeWorker.js, runtime.js, or any caller (Part E's explicit
// instruction).
const PRODUCTION_JUDGE_TIMEOUT_MS = 20000;

const modelManager = require('./modelManager');
const runtime = require('./runtime');
const { createJudgeAdapter } = require('./judgeAdapter');

// Memoized once the model path is known to be READY -- createJudgeAdapter()
// itself is a pure closure factory (no side effects, no I/O), so this is
// safe to build lazily on first real use rather than at module load time
// (module load must stay side-effect-free so this file can be required
// under plain `node`, e.g. by the CLI/tests, without ever touching
// Electron -- see getModelAvailability()'s own comment below).
let _judge = null;
function getJudge() {
  if (!_judge) {
    const { finalPath } = modelManager.resolvePaths();
    _judge = createJudgeAdapter({ modelPath: finalPath, timeoutMs: PRODUCTION_JUDGE_TIMEOUT_MS });
  }
  return _judge;
}

// modelManager.getStatus() calls require('electron') internally (via
// resolveModelDir()) to locate the real userData path. Outside a running
// Electron process (the standalone knowledge portal and CLI both run
// under plain `node` -- see scripts/product-docs/knowledge-portal/
// server.js's own header comment), require('electron') resolves to a
// path STRING, not the Electron API object, so app.getPath(...) throws.
// That is not a bug to work around -- it is a real, structural fact: the
// local judge runtime can only ever run inside the Electron app process
// (utilityProcess is an Electron-only API). Callers outside Electron must
// see this as an ordinary "unavailable" state, never a crash -- so it is
// caught here and folded into the same STATUS.ERROR shape modelManager
// already uses for any other unavailable condition.
function getModelAvailability() {
  try {
    return modelManager.getStatus();
  } catch (err) {
    return { status: modelManager.STATUS.ERROR, detail: { reason: 'runtime-environment-unavailable', message: err.message } };
  }
}

// The production judge PROVIDER injected into C1's applyCapabilityAuthority().
// Deliberately does nothing eagerly -- availability is checked only when
// THIS function is actually called, which (per lib/capabilityAuthority.js's
// own scope gate) only happens for a question already confirmed to be
// inside C1's narrow authority scope. Out-of-scope, curated-boundary,
// Workflow-primary, and non-affirmative-baseline questions never reach
// this function at all -- proven structurally by applyCapabilityAuthority()
// itself, not re-implemented here (Part C/H/I/J).
// `signal` (Part C4/E: renderer-initiated query cancellation) is threaded
// straight through to judgeAdapter.js's judge(pkg, handleMap, {signal}) and
// from there into runtime.js's infer({..., signal}) -- both already support
// it, unchanged since C2. This function previously dropped a third
// argument silently; fixed here (C4) rather than left unwired, since the
// product surface is the first real caller that needs it.
async function productionJudge(pkg, handleMap, { signal } = {}) {
  const availability = getModelAvailability();
  if (availability.status !== modelManager.STATUS.READY) {
    const reason = (availability.detail && availability.detail.reason) || availability.status;
    throw Object.assign(
      new Error(`local semantic judge unavailable: model is ${availability.status}${reason && reason !== availability.status ? ` (${reason})` : ''}`),
      { modelState: availability.status, modelUnavailable: true },
    );
  }
  // Model file is READY (verified against the pinned identity). Loading
  // into the runtime (if not already loaded) and running inference is
  // runtime.js's job via judgeAdapter.js -- including LOADING-state
  // dedup, the single-inference queue, timeout, and cancellation, all
  // unchanged from C2.
  const judge = getJudge();
  return judge(pkg, handleMap, { signal });
}

// App-quit / test-teardown cleanup -- delegates to runtime.js unchanged.
// No automatic idle-unload timer exists or is added here (Product Owner
// decision, still deferred to post-C3 usage evidence).
function terminate() {
  return runtime.terminate();
}

module.exports = {
  productionJudge,
  getModelAvailability,
  getJudge,
  terminate,
  PRODUCTION_JUDGE_TIMEOUT_MS,
};
