'use strict';

// services/localJudge/electronSmokeTest.js — Phase C2. A REAL Electron
// main-process entry point (not a plain-node script -- utilityProcess only
// exists inside a running Electron app). Proves the isolated runtime
// actually works end to end: model load via utilityProcess, real
// node-llama-cpp inference, crash recovery, cancellation, and timeout --
// none of this is assumed or mocked.
//
// Run with:
//   node_modules/.bin/electron services/localJudge/electronSmokeTest.js [modelPath]
//
// Never launched by any production code path; this is a diagnostic/proof
// harness only, matching Part G's "prove the recovery path with a
// controlled test where practical."

const { app } = require('electron');
const path = require('path');
const runtime = require('./runtime');

const MODEL_PATH = process.argv[2] || path.join(__dirname, '..', '..', 'scripts', 'product-docs', 'bench', 'models', 'phi-4-mini-instruct-Q4_K_M.gguf');

const TRIVIAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['judgment', 'evidenceHandles', 'confidence'],
  properties: {
    judgment: { type: 'string', enum: ['SUPPORTS', 'CONTRADICTS', 'INSUFFICIENT_EVIDENCE'] },
    evidenceHandles: { type: 'array', items: { type: 'string', enum: ['S1'] } },
    confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
  },
};
const SYSTEM = 'You are a strict evidence-entailment classifier. Output only the JSON object described by the schema.';
function userFor(claim, evidence) {
  return JSON.stringify({ claim, availableEvidence: [{ handle: 'S1', kind: 'summary', text: evidence }], availableHandles: ['S1'] }, null, 2);
}

function memMB() {
  const mem = process.memoryUsage();
  return { rss: Math.round(mem.rss / 1024 / 1024) };
}

async function main() {
  const results = {};

  console.log('[smoke] loading model:', MODEL_PATH);
  const memBefore = memMB();
  const loadResult = await runtime.ensureLoaded(MODEL_PATH);
  console.log('[smoke] load result:', JSON.stringify(loadResult), 'getLoadState:', JSON.stringify(runtime.getLoadState()));
  const memAfterLoad = memMB();
  results.load = { ...loadResult, memBeforeMB: memBefore.rss, memAfterLoadMB: memAfterLoad.rss, pid: runtime.getLoadState().pid };

  console.log('[smoke] running one real inference request...');
  const t0 = Date.now();
  const r1 = await runtime.infer({
    system: SYSTEM,
    user: userFor('AutoIngest supports duplicate detection during import', 'Same name + size -> skip. Different size -> rename. No overwrite under any condition.'),
    schema: TRIVIAL_SCHEMA,
    maxTokens: 200,
    modelPath: MODEL_PATH,
    timeoutMs: 60000,
  });
  const inferMs = Date.now() - t0;
  console.log('[smoke] inference result:', JSON.stringify(r1.parsed), 'wall-clock ms:', inferMs);
  results.basicInference = { parsed: r1.parsed, parseError: r1.parseError, timing: r1.timing, wallClockMs: inferMs };

  console.log('[smoke] testing cancellation (abort immediately after send)...');
  const controller = new AbortController();
  const p2 = runtime.infer({
    system: SYSTEM,
    user: userFor('AutoIngest supports X', 'Y'),
    schema: TRIVIAL_SCHEMA,
    maxTokens: 200,
    modelPath: MODEL_PATH,
    timeoutMs: 60000,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 10);
  try {
    await p2;
    results.cancellation = { cancelled: false, note: 'FAILED to cancel -- request completed before abort landed' };
  } catch (err) {
    results.cancellation = { cancelled: !!err.cancelled, message: err.message };
    console.log('[smoke] cancellation result:', JSON.stringify(results.cancellation));
  }

  console.log('[smoke] confirming queue is not poisoned after a cancelled request (next request still succeeds)...');
  const r3 = await runtime.infer({
    system: SYSTEM,
    user: userFor('AutoIngest supports Z', 'Evidence about Z.'),
    schema: TRIVIAL_SCHEMA,
    maxTokens: 200,
    modelPath: MODEL_PATH,
    timeoutMs: 60000,
  });
  results.postCancellationRequestSucceeded = !!(r3.parsed && !r3.parseError);
  console.log('[smoke] post-cancellation request result:', JSON.stringify(r3.parsed));

  console.log('[smoke] testing a very short timeout (should reject as timedOut, model keeps running in background harmlessly)...');
  try {
    await runtime.infer({
      system: SYSTEM,
      user: userFor('AutoIngest supports W', 'Evidence about W.'),
      schema: TRIVIAL_SCHEMA,
      maxTokens: 200,
      modelPath: MODEL_PATH,
      timeoutMs: 1, // deliberately impossible
    });
    results.timeout = { timedOut: false, note: 'FAILED to time out' };
  } catch (err) {
    results.timeout = { timedOut: !!err.timedOut, message: err.message };
    console.log('[smoke] timeout result:', JSON.stringify(results.timeout));
  }

  console.log('[smoke] confirming queue recovers after a timeout too...');
  const r4 = await runtime.infer({
    system: SYSTEM,
    user: userFor('AutoIngest supports V', 'Evidence about V.'),
    schema: TRIVIAL_SCHEMA,
    maxTokens: 200,
    modelPath: MODEL_PATH,
    timeoutMs: 60000,
  });
  results.postTimeoutRequestSucceeded = !!(r4.parsed && !r4.parseError);
  console.log('[smoke] post-timeout request result:', JSON.stringify(r4.parsed));

  console.log('[smoke] testing crash recovery: killing the child process mid-request...');
  const pidBeforeCrash = runtime.getLoadState().pid;
  const p5 = runtime.infer({
    system: SYSTEM,
    user: userFor('AutoIngest supports U', 'Evidence about U, deliberately long context to keep generation running for a moment.'),
    schema: TRIVIAL_SCHEMA,
    maxTokens: 200,
    modelPath: MODEL_PATH,
    timeoutMs: 60000,
  });
  setTimeout(() => {
    try { process.kill(pidBeforeCrash, 'SIGKILL'); } catch (e) { console.log('[smoke] kill error (informational):', e.message); }
  }, 50);
  try {
    await p5;
    results.crashRecovery = { crashDetected: false, note: 'request completed before the kill landed -- inconclusive, not a failure' };
  } catch (err) {
    results.crashRecovery = { crashDetected: !!err.crashed, message: err.message };
    console.log('[smoke] crash recovery -- in-flight request rejected as:', JSON.stringify(results.crashRecovery));
  }
  console.log('[smoke] load state immediately after crash:', JSON.stringify(runtime.getLoadState()));

  console.log('[smoke] confirming the runtime self-heals: a new request after a crash respawns and reloads transparently...');
  const t6 = Date.now();
  const r6 = await runtime.infer({
    system: SYSTEM,
    user: userFor('AutoIngest supports T', 'Evidence about T.'),
    schema: TRIVIAL_SCHEMA,
    maxTokens: 200,
    modelPath: MODEL_PATH,
    timeoutMs: 60000,
  });
  const respawnPlusInferMs = Date.now() - t6;
  results.postCrashRecovery = { succeeded: !!(r6.parsed && !r6.parseError), parsed: r6.parsed, respawnPlusInferMs, newPid: runtime.getLoadState().pid };
  console.log('[smoke] post-crash recovery result:', JSON.stringify(results.postCrashRecovery));

  console.log('[smoke] unloading...');
  const memBeforeUnload = memMB();
  await runtime.unload();
  const memAfterUnload = memMB();
  results.unload = { loadStateAfter: runtime.getLoadState(), memBeforeUnloadMB: memBeforeUnload.rss, memAfterUnloadMB: memAfterUnload.rss };

  runtime.terminate();

  console.log('\n[smoke] FULL RESULTS JSON:');
  console.log(JSON.stringify(results, null, 2));

  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('[smoke] FATAL:', err);
    app.exit(1);
  });
});
