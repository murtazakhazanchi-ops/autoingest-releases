'use strict';

// services/qwenRuntime/electronSmokeTest.js — Ask AutoIngest Stage 3.1
// (real-model qualification). A REAL Electron main-process entry point
// (not a plain-node script -- utilityProcess only exists inside a running
// Electron app), directly mirroring the already-committed, already-proven
// services/localJudge/electronSmokeTest.js harness for Gemma. Proves the
// isolated Qwen runtime actually works end to end against the real,
// SHA-256-verified artifact: model load via utilityProcess, real 24576
// context creation, real node-llama-cpp inference, cancellation,
// serialization, crash recovery, and load/unload cycling -- none of this
// is assumed or mocked.
//
// Run with:
//   node_modules/.bin/electron services/qwenRuntime/electronSmokeTest.js [overrideDir]
//
// `overrideDir` is a directory containing the exact qualified artifact
// (qwen3.5-4b-instruct-Q4_K_M.gguf) plus its .verified.json sidecar
// (written by services/qwenRuntime/modelManager.js's own verify()) --
// defaults to no override, i.e. the real production userData path, which
// will correctly report MODEL_UNAVAILABLE on a machine without the model
// installed. Never launched by any production code path; this is a
// diagnostic/qualification harness only.

const { app } = require('electron');
const { execFileSync } = require('child_process');
const runtime = require('./runtime');

const OVERRIDE_DIR = process.argv[2] || undefined;

function memMB() {
  return { rss: Math.round(process.memoryUsage().rss / 1024 / 1024) };
}

// Section 17 measures the MODEL's own memory footprint, which lives in the
// isolated utilityProcess child, never in this (main-process) script's own
// process.memoryUsage() -- reading the child's real RSS via `ps` (read-only,
// external observation; no runtime.js/runtimeWorker.js protocol change
// needed for a measurement-only concern).
let _peakChildRssMB = 0;
function childRssMB(pid) {
  if (!pid) return null;
  try {
    const out = execFileSync('ps', ['-o', 'rss=', '-p', String(pid)]).toString().trim();
    const kb = parseInt(out, 10);
    if (!Number.isFinite(kb)) return null;
    const mb = Math.round(kb / 1024);
    if (mb > _peakChildRssMB) _peakChildRssMB = mb;
    return mb;
  } catch {
    return null;
  }
}

function ps() {
  // learned-model process census (Section 9's one-brain invariant, Stage
  // 3.1 own extension): counts THIS runtime's own child only -- Gemma's
  // runtime is a fully separate module/singleton with its own spawn
  // tracking, inspected separately below via require('../localJudge/runtime').
  const diag = runtime.getDiagnostics();
  return { qwenProcessState: diag.processState, qwenPid: diag.pid, qwenState: diag.state };
}

async function main() {
  const results = {};

  // --- Section 9: one-brain invariant, BEFORE any load ---------------
  const gemmaRuntime = require('../localJudge/runtime');
  results.oneBrainBefore = {
    qwen: ps(),
    gemmaLoadState: gemmaRuntime.getLoadState ? gemmaRuntime.getLoadState() : 'no getLoadState() export',
  };
  console.log('[qwen-smoke] one-brain invariant BEFORE load:', JSON.stringify(results.oneBrainBefore));

  // --- Section 7/8: real load through the real ModelManager + runtime ---
  console.log('[qwen-smoke] loading via overrideDir:', OVERRIDE_DIR || '(none -- real userData default)');
  const memBefore = memMB();
  const tLoad0 = Date.now();
  let loadResult;
  try {
    loadResult = await runtime.load(null, OVERRIDE_DIR ? { overrideDir: OVERRIDE_DIR } : {});
  } catch (err) {
    results.load = { failed: true, code: err.code, message: err.message };
    console.log('[qwen-smoke] load FAILED:', JSON.stringify(results.load));
    console.log('\n[qwen-smoke] FULL RESULTS JSON:');
    console.log(JSON.stringify(results, null, 2));
    app.exit(err.code === 'MODEL_NOT_INSTALLED' ? 2 : 1);
    return;
  }
  const loadMs = Date.now() - tLoad0;
  const memAfterLoad = memMB();
  const diagAfterLoad = runtime.getDiagnostics();
  const childRssAfterLoad = childRssMB(diagAfterLoad.pid);
  results.load = {
    ...loadResult, wallClockMs: loadMs,
    mainProcessRssBeforeMB: memBefore.rss, mainProcessRssAfterLoadMB: memAfterLoad.rss,
    // Bundled model-load + 24576-context-creation is Stage 3's own
    // documented lazy-load design (runtime.js's load() creates both in one
    // step) -- so "RSS after model load" and "RSS after 24576 context"
    // (Section 17) are necessarily the same real measurement here.
    childRssAfterLoadAndContextMB: childRssAfterLoad,
    pid: diagAfterLoad.pid, contextSize: diagAfterLoad.contextSize, contextReady: diagAfterLoad.contextReady,
  };
  console.log('[qwen-smoke] load result:', JSON.stringify(results.load));

  // --- Section 9: one-brain invariant, DURING load (Qwen=1, Gemma=0) ---
  results.oneBrainAfterLoad = {
    qwen: ps(),
    gemmaLoadState: gemmaRuntime.getLoadState ? gemmaRuntime.getLoadState() : 'no getLoadState() export',
  };
  console.log('[qwen-smoke] one-brain invariant AFTER load:', JSON.stringify(results.oneBrainAfterLoad));

  // --- Section 10: minimal real inference ------------------------------
  console.log('[qwen-smoke] running one real inference request...');
  const t1 = Date.now();
  const r1 = await runtime.infer({ prompt: 'In one short sentence, what is the capital of France?', maxTokens: 48, timeoutMs: 120000 });
  const infer1Ms = Date.now() - t1;
  const childRssDuringInference = childRssMB(diagAfterLoad.pid);
  results.basicInference = { text: r1.text, timing: r1.timing, wallClockMs: infer1Ms, nonEmpty: !!(r1.text && r1.text.trim().length > 0), childRssAfterMB: childRssDuringInference };
  console.log('[qwen-smoke] inference result:', JSON.stringify(results.basicInference));

  console.log('[qwen-smoke] running a second real inference (no reload required)...');
  const t2 = Date.now();
  const r2 = await runtime.infer({ prompt: 'Reply with exactly the word: acknowledged', maxTokens: 16, timeoutMs: 120000 });
  const infer2Ms = Date.now() - t2;
  results.secondInference = { text: r2.text, timing: r2.timing, wallClockMs: infer2Ms, nonEmpty: !!(r2.text && r2.text.trim().length > 0) };
  console.log('[qwen-smoke] second inference result:', JSON.stringify(results.secondInference));

  // --- Section 12: cancellation stress (10 cycles) ----------------------
  console.log('[qwen-smoke] running 10 cancel -> subsequent-inference cycles...');
  const cancelCycles = [];
  for (let i = 0; i < 10; i++) {
    const controller = new AbortController();
    const tC0 = Date.now();
    const cancelPromise = runtime.infer({
      prompt: `Write a long, detailed, multi-paragraph essay about topic number ${i}.`,
      maxTokens: 400, timeoutMs: 120000, signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 15);
    let cancelResult;
    try {
      await cancelPromise;
      cancelResult = { cancelled: false, note: 'FAILED to cancel -- completed before abort landed' };
    } catch (err) {
      cancelResult = { cancelled: err.code === 'INFERENCE_CANCELLED', code: err.code, latencyMs: Date.now() - tC0 };
    }
    const tReady0 = Date.now();
    const rNext = await runtime.infer({ prompt: `Reply with exactly the digit ${i}.`, maxTokens: 8, timeoutMs: 120000 });
    const readyMs = Date.now() - tReady0;
    cancelCycles.push({ cycle: i, ...cancelResult, timeToNextInferMs: readyMs, nextInferSucceeded: !!(rNext.text && rNext.text.trim().length > 0), stateAfter: runtime.getState() });
  }
  results.cancellationStress = cancelCycles;
  console.log('[qwen-smoke] cancellation stress summary:', JSON.stringify(cancelCycles.map((c) => ({ cycle: c.cycle, cancelled: c.cancelled, latencyMs: c.latencyMs, timeToNextInferMs: c.timeToNextInferMs, nextInferSucceeded: c.nextInferSucceeded }))));

  // --- Section 13: FIFO / concurrency ------------------------------------
  console.log('[qwen-smoke] submitting 3 concurrent inference requests (must serialize)...');
  const tConc0 = Date.now();
  const concResults = await Promise.all([
    runtime.infer({ prompt: 'Reply with exactly: one', maxTokens: 8, timeoutMs: 120000 }),
    runtime.infer({ prompt: 'Reply with exactly: two', maxTokens: 8, timeoutMs: 120000 }),
    runtime.infer({ prompt: 'Reply with exactly: three', maxTokens: 8, timeoutMs: 120000 }),
  ]);
  results.concurrency = { wallClockMs: Date.now() - tConc0, allNonEmpty: concResults.every((r) => r.text && r.text.trim().length > 0), texts: concResults.map((r) => r.text) };
  console.log('[qwen-smoke] concurrency result:', JSON.stringify(results.concurrency));

  // --- Section 14: context-limit safe handling (without OOMing) ----------
  console.log('[qwen-smoke] requesting an oversized maxTokens to probe context-limit handling safely...');
  try {
    const rOver = await runtime.infer({ prompt: 'x', maxTokens: 999999999, timeoutMs: 15000 });
    results.contextLimit = { errored: false, note: 'did not error -- node-llama-cpp/context accepted the request (may clamp internally)', textLength: rOver.text ? rOver.text.length : 0 };
  } catch (err) {
    results.contextLimit = { errored: true, code: err.code };
  }
  results.contextLimitRuntimeUsableAfter = runtime.getState();
  console.log('[qwen-smoke] context-limit probe result:', JSON.stringify(results.contextLimit), 'state after:', results.contextLimitRuntimeUsableAfter);
  if (results.contextLimitRuntimeUsableAfter !== 'READY') {
    console.log('[qwen-smoke] runtime not READY after probe -- attempting one more real inference to confirm actual usability...');
    try {
      const rPostLimit = await runtime.infer({ prompt: 'Reply with exactly: recovered', maxTokens: 8, timeoutMs: 120000 });
      results.contextLimitRecoveryInference = { succeeded: !!(rPostLimit.text && rPostLimit.text.trim().length > 0), text: rPostLimit.text };
    } catch (err) {
      results.contextLimitRecoveryInference = { succeeded: false, code: err.code, message: err.message };
    }
  }

  // --- Section 15: crash / failure recovery -------------------------------
  console.log('[qwen-smoke] testing crash recovery: killing the child process mid-request...');
  const pidBeforeCrash = runtime.getDiagnostics().pid;
  const pCrash = runtime.infer({ prompt: 'Write a moderately long paragraph to keep generation running for a moment.', maxTokens: 300, timeoutMs: 120000 });
  setTimeout(() => { try { process.kill(pidBeforeCrash, 'SIGKILL'); } catch (e) { console.log('[qwen-smoke] kill error (informational):', e.message); } }, 60);
  try {
    await pCrash;
    results.crashRecovery = { crashDetected: false, note: 'request completed before the kill landed -- inconclusive, not a failure' };
  } catch (err) {
    results.crashRecovery = { crashDetected: err.code === 'RUNTIME_CRASHED', code: err.code };
  }
  results.stateImmediatelyAfterCrash = runtime.getState();
  console.log('[qwen-smoke] crash recovery result:', JSON.stringify(results.crashRecovery), 'state after:', results.stateImmediatelyAfterCrash);

  console.log('[qwen-smoke] confirming controlled restart after FAILED (explicit load() again)...');
  const tRestart0 = Date.now();
  try {
    const restartResult = await runtime.load(null, OVERRIDE_DIR ? { overrideDir: OVERRIDE_DIR } : {});
    results.postCrashRestart = { succeeded: true, ...restartResult, wallClockMs: Date.now() - tRestart0 };
  } catch (err) {
    results.postCrashRestart = { succeeded: false, code: err.code, message: err.message };
  }
  console.log('[qwen-smoke] post-crash restart result:', JSON.stringify(results.postCrashRestart));
  if (results.postCrashRestart.succeeded) {
    const rPostCrash = await runtime.infer({ prompt: 'Reply with exactly: back online', maxTokens: 8, timeoutMs: 120000 });
    results.postCrashInference = { succeeded: !!(rPostCrash.text && rPostCrash.text.trim().length > 0), text: rPostCrash.text };
    console.log('[qwen-smoke] post-crash-restart inference result:', JSON.stringify(results.postCrashInference));
  }

  // --- Section 16: load/unload stress (10 cycles) -------------------------
  console.log('[qwen-smoke] running 10 load/unload cycles...');
  const cycles = [];
  for (let i = 0; i < 10; i++) {
    const tL0 = Date.now();
    const cycleLoad = await runtime.load(null, OVERRIDE_DIR ? { overrideDir: OVERRIDE_DIR } : {});
    const loadCycleMs = Date.now() - tL0;
    const cyclePid = runtime.getDiagnostics().pid; // may change after the crash-recovery step above respawned the child
    const childRssAfterLoad = childRssMB(cyclePid);
    const rInfer = await runtime.infer({ prompt: `Reply with exactly the number ${i}.`, maxTokens: 8, timeoutMs: 120000 });
    const tU0 = Date.now();
    await runtime.unload();
    const unloadCycleMs = Date.now() - tU0;
    const childRssAfterUnload = childRssMB(cyclePid); // same process (unload disposes model/context in place, does not kill the child -- see runtime.js's own unload())
    cycles.push({
      cycle: i, loadCycleMs, unloadCycleMs, pid: cyclePid,
      childRssAfterLoadMB: childRssAfterLoad, childRssAfterUnloadMB: childRssAfterUnload,
      alreadyLoaded: !!cycleLoad.alreadyLoaded, inferSucceeded: !!(rInfer.text && rInfer.text.trim().length > 0),
      stateAfterUnload: runtime.getState(),
    });
  }
  results.loadUnloadStress = cycles;
  results.peakChildRssMB = _peakChildRssMB;
  console.log('[qwen-smoke] load/unload stress summary:', JSON.stringify(cycles.map((c) => ({ cycle: c.cycle, loadCycleMs: c.loadCycleMs, unloadCycleMs: c.unloadCycleMs, childRssAfterLoadMB: c.childRssAfterLoadMB, childRssAfterUnloadMB: c.childRssAfterUnloadMB }))));
  console.log('[qwen-smoke] peak child RSS observed so far (MB):', _peakChildRssMB);

  // --- Section 9: one-brain invariant, AFTER final unload ------------------
  results.oneBrainAfterFinalUnload = { qwen: ps(), gemmaLoadState: gemmaRuntime.getLoadState ? gemmaRuntime.getLoadState() : 'no getLoadState() export' };
  console.log('[qwen-smoke] one-brain invariant AFTER final unload:', JSON.stringify(results.oneBrainAfterFinalUnload));

  // --- Section 17/20: final real load for steady-state RSS measurement -----
  console.log('[qwen-smoke] final load for steady-state RSS measurement...');
  const tFinal0 = Date.now();
  const finalLoad = await runtime.load(null, OVERRIDE_DIR ? { overrideDir: OVERRIDE_DIR } : {});
  const finalLoadMs = Date.now() - tFinal0;
  const finalPid = runtime.getDiagnostics().pid;
  const childRssAfterFinalLoad = childRssMB(finalPid);
  const finalInfer = await runtime.infer({ prompt: 'Reply with exactly: steady state', maxTokens: 8, timeoutMs: 120000 });
  const childRssDuringFinalInfer = childRssMB(finalPid);
  results.finalSteadyState = {
    load: { ...finalLoad, wallClockMs: finalLoadMs },
    pid: finalPid, childRssAfterLoadMB: childRssAfterFinalLoad, childRssDuringInferMB: childRssDuringFinalInfer,
    inferSucceeded: !!(finalInfer.text && finalInfer.text.trim().length > 0),
    diagnostics: runtime.getDiagnostics(),
  };
  console.log('[qwen-smoke] final steady-state result:', JSON.stringify(results.finalSteadyState));

  await runtime.unload();
  const childRssAfterFinalUnload = childRssMB(finalPid); // same process -- distinguishes real release from allocator retention
  results.peakChildRssMB = _peakChildRssMB;
  results.finalUnload = {
    pid: finalPid, childRssBeforeUnloadMB: childRssDuringFinalInfer,
    childRssAfterUnloadMB: childRssAfterFinalUnload, stateAfter: runtime.getState(),
  };
  console.log('[qwen-smoke] final unload result:', JSON.stringify(results.finalUnload));

  runtime.terminate();
  results.diagnosticsFinal = runtime.getDiagnostics();

  console.log('\n[qwen-smoke] FULL RESULTS JSON:');
  console.log(JSON.stringify(results, null, 2));

  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('[qwen-smoke] FATAL:', err);
    app.exit(1);
  });
});
