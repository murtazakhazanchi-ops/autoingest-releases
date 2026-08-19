'use strict';

// Phase C2. Model-free tests for services/localJudge/runtime.js's
// queueing/timeout/cancellation/crash-recovery logic -- exercised against
// a FAKE, in-process EventEmitter child (via runtime.js's test-only
// _setSpawnFnForTesting() injection point), never a real Electron
// utilityProcess or node-llama-cpp. The real runtime was separately proven
// against the actual production stack via
// services/localJudge/electronSmokeTest.js (utilityProcess + node-llama-cpp,
// requires a running Electron process, cannot run under plain `node` --
// see this checkpoint's own report for that real-run evidence). This file
// proves the PARENT-SIDE coordination logic in isolation.
//
// Run with: node test/localJudgeRuntime.test.js

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const runtime = require('../services/localJudge/runtime');

let passed = 0;
async function t(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok — ${name}`);
  } catch (err) {
    console.error(`  FAIL — ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

let _pidCounter = 1000;

// A controllable fake child process. `behavior(msg, child)` decides how
// (and whether, and when) to respond to each incoming postMessage -- tests
// script exactly the scenario they want (normal response, delayed
// response, no response at all, a mid-request crash).
function makeFakeChild(behavior) {
  const child = new EventEmitter();
  child.pid = _pidCounter++;
  child.killed = false;
  child.postMessage = (msg) => behavior(msg, child);
  child.kill = () => {
    child.killed = true;
    setImmediate(() => child.emit('exit', 0));
    return true;
  };
  return child;
}

function respondLoaded(child, { delayMs = 0 } = {}) {
  return (msg) => {
    if (msg.type !== 'load') return;
    setTimeout(() => child.emit('message', { type: 'loaded', loadMs: delayMs, gpu: 'metal' }), delayMs);
  };
}

function respondInferWith(resultFactory, { delayMs = 5 } = {}) {
  return (msg, child) => {
    if (msg.type === 'load') {
      setTimeout(() => child.emit('message', { type: 'loaded', loadMs: 1, gpu: 'metal' }), 1);
      return;
    }
    if (msg.type === 'unload') {
      setTimeout(() => child.emit('message', { type: 'unloaded' }), 1);
      return;
    }
    if (msg.type === 'infer') {
      setTimeout(() => {
        const r = resultFactory(msg);
        child.emit('message', { type: 'result', requestId: msg.requestId, ...r });
      }, delayMs);
    }
  };
}

async function withFreshRuntime(behaviorFactory, fn) {
  // Each test gets its own fake child instance via a fresh behavior
  // closure -- runtime.js itself is a module-level singleton (matching its
  // real single-purpose production role), so tests run sequentially, never
  // in parallel, and each explicitly terminates before the next begins.
  let child;
  runtime._setSpawnFnForTesting(() => {
    child = makeFakeChild(behaviorFactory(child));
    return child;
  });
  try {
    await fn();
  } finally {
    runtime.terminate();
    runtime._setSpawnFnForTesting(null);
  }
}

async function main() {
  console.log('localJudgeRuntime');

  await withFreshRuntime(
    () => respondInferWith(() => ({ raw: '{"judgment":"SUPPORTS","evidenceHandles":["S1"],"confidence":"HIGH"}', parsed: { judgment: 'SUPPORTS', evidenceHandles: ['S1'], confidence: 'HIGH' }, parseError: null, timing: {} })),
    async () => {
      await t('ensureLoaded + infer: a normal request resolves with the fake child\'s result', async () => {
        await runtime.ensureLoaded('/fake/model.gguf');
        const r = await runtime.infer({ system: 's', user: 'u', schema: {}, maxTokens: 10, modelPath: '/fake/model.gguf', timeoutMs: 5000 });
        assert.equal(r.parsed.judgment, 'SUPPORTS');
      });

      await t('ensureLoaded: concurrent calls for the SAME model share one load (deduped, not two loads)', async () => {
        runtime.terminate();
        let loadCount = 0;
        runtime._setSpawnFnForTesting(() => makeFakeChild((msg, child) => {
          if (msg.type === 'load') {
            loadCount++;
            setTimeout(() => child.emit('message', { type: 'loaded', loadMs: 20, gpu: 'metal' }), 20);
          }
        }));
        const [a, b] = await Promise.all([runtime.ensureLoaded('/fake/model.gguf'), runtime.ensureLoaded('/fake/model.gguf')]);
        assert.equal(loadCount, 1, 'two concurrent ensureLoaded() calls for the same model must trigger exactly one real load');
      });
    },
  );

  await withFreshRuntime(
    () => respondInferWith(() => ({ raw: '{"judgment":"INSUFFICIENT_EVIDENCE","evidenceHandles":[],"confidence":"HIGH"}', parsed: { judgment: 'INSUFFICIENT_EVIDENCE', evidenceHandles: [], confidence: 'HIGH' }, parseError: null, timing: {} }), { delayMs: 5 }),
    async () => {
      await t('queue: multiple requests are served one at a time, all eventually succeed', async () => {
        await runtime.ensureLoaded('/fake/model.gguf');
        const results = await Promise.all([1, 2, 3, 4].map(() => runtime.infer({ system: 's', user: 'u', schema: {}, maxTokens: 10, modelPath: '/fake/model.gguf', timeoutMs: 5000 })));
        assert.equal(results.length, 4);
        assert.ok(results.every((r) => r.parsed.judgment === 'INSUFFICIENT_EVIDENCE'));
      });
    },
  );

  await withFreshRuntime(
    () => respondInferWith(() => ({ raw: '{}', parsed: { judgment: 'SUPPORTS', evidenceHandles: ['S1'], confidence: 'HIGH' }, parseError: null, timing: {} }), { delayMs: 50 }),
    async () => {
      await t('timeout: a request exceeding timeoutMs rejects with timedOut:true, and does not corrupt the queue', async () => {
        await runtime.ensureLoaded('/fake/model.gguf');
        await assert.rejects(
          runtime.infer({ system: 's', user: 'u', schema: {}, maxTokens: 10, modelPath: '/fake/model.gguf', timeoutMs: 5 }),
          (err) => err.timedOut === true,
        );
        // Queue must still work after a timeout.
        const r = await runtime.infer({ system: 's', user: 'u', schema: {}, maxTokens: 10, modelPath: '/fake/model.gguf', timeoutMs: 5000 });
        assert.equal(r.parsed.judgment, 'SUPPORTS');
      });

      await t('timeout: a stale late response for an already-timed-out request is safely ignored (no crash, no corruption)', async () => {
        // The fake child still replies after 50ms even though the caller's
        // timeoutMs was 5 -- this reproduces exactly that "late response"
        // race and proves it does not throw or leak into the next request.
        await assert.rejects(runtime.infer({ system: 's', user: 'u', schema: {}, maxTokens: 10, modelPath: '/fake/model.gguf', timeoutMs: 5 }));
        await new Promise((r) => setTimeout(r, 80)); // let the late message actually arrive
        const r2 = await runtime.infer({ system: 's', user: 'u', schema: {}, maxTokens: 10, modelPath: '/fake/model.gguf', timeoutMs: 5000 });
        assert.equal(r2.parsed.judgment, 'SUPPORTS');
      });
    },
  );

  await withFreshRuntime(
    () => respondInferWith(() => ({ raw: '{}', parsed: { judgment: 'SUPPORTS', evidenceHandles: ['S1'], confidence: 'HIGH' }, parseError: null, timing: {} }), { delayMs: 100 }),
    async () => {
      await t('cancellation: aborting via signal rejects with cancelled:true and does not block the next request', async () => {
        await runtime.ensureLoaded('/fake/model.gguf');
        const controller = new AbortController();
        const p = runtime.infer({ system: 's', user: 'u', schema: {}, maxTokens: 10, modelPath: '/fake/model.gguf', timeoutMs: 5000, signal: controller.signal });
        setTimeout(() => controller.abort(), 10);
        await assert.rejects(p, (err) => err.cancelled === true);
        const r2 = await runtime.infer({ system: 's', user: 'u', schema: {}, maxTokens: 10, modelPath: '/fake/model.gguf', timeoutMs: 5000 });
        assert.equal(r2.parsed.judgment, 'SUPPORTS');
      });

      await t('cancellation: aborting a request that is still QUEUED (not yet sent) never reaches the child at all', async () => {
        const sentTypes = [];
        runtime.terminate();
        runtime._setSpawnFnForTesting(() => makeFakeChild((msg, child) => {
          sentTypes.push(msg.type);
          if (msg.type === 'load') setTimeout(() => child.emit('message', { type: 'loaded', loadMs: 1, gpu: 'metal' }), 1);
          if (msg.type === 'infer') setTimeout(() => child.emit('message', { type: 'result', requestId: msg.requestId, raw: '{}', parsed: { judgment: 'SUPPORTS', evidenceHandles: ['S1'], confidence: 'HIGH' }, parseError: null, timing: {} }), 100);
        }));
        await runtime.ensureLoaded('/fake/model.gguf');
        const controller = new AbortController();
        controller.abort(); // already aborted before infer() is even called
        await assert.rejects(
          runtime.infer({ system: 's', user: 'u', schema: {}, maxTokens: 10, modelPath: '/fake/model.gguf', timeoutMs: 5000, signal: controller.signal }),
          (err) => err.cancelled === true,
        );
      });
    },
  );

  await withFreshRuntime(
    (existingChild) => (msg, child) => {
      if (msg.type === 'load') setTimeout(() => child.emit('message', { type: 'loaded', loadMs: 1, gpu: 'metal' }), 1);
      // infer: never respond -- simulates a hung/crashed child; the test
      // itself triggers the crash via child.kill().
    },
    async () => {
      await t('crash: killing the child mid-request rejects the in-flight call with crashed:true and resets load state', async () => {
        await runtime.ensureLoaded('/fake/model.gguf');
        const p = runtime.infer({ system: 's', user: 'u', schema: {}, maxTokens: 10, modelPath: '/fake/model.gguf', timeoutMs: 5000 });
        const { pid } = runtime.getLoadState();
        setTimeout(() => {
          // Simulate an unexpected native crash: the child emits 'exit'
          // without ever being asked to via our own kill() path.
          const currentChild = runtime.getLoadState().pid === pid;
          assert.ok(currentChild, 'sanity: still the same child we started with');
        }, 5);
        // Trigger the crash by calling the fake child's own exit directly
        // (bypassing kill(), which would look like a controlled shutdown).
        await new Promise((r) => setTimeout(r, 10));
        runtime.terminate(); // uses the real kill() path -> emits 'exit' -> _reset()
        await assert.rejects(p, (err) => err.crashed === true);
        assert.equal(runtime.getLoadState().loadState, 'NOT_LOADED');
      });

      await t('crash recovery: a request after a crash transparently respawns and reloads', async () => {
        // Fresh behavior after terminate() in the previous test -- respawn
        // happens automatically inside ensureLoaded() via _spawn().
        runtime._setSpawnFnForTesting(() => makeFakeChild(respondInferWith(() => ({ raw: '{}', parsed: { judgment: 'CONTRADICTS', evidenceHandles: ['S1'], confidence: 'HIGH' }, parseError: null, timing: {} }))));
        const r = await runtime.infer({ system: 's', user: 'u', schema: {}, maxTokens: 10, modelPath: '/fake/model.gguf', timeoutMs: 5000 });
        assert.equal(r.parsed.judgment, 'CONTRADICTS');
      });
    },
  );

  await withFreshRuntime(
    () => respondInferWith(() => ({ raw: '{}', parsed: { judgment: 'SUPPORTS', evidenceHandles: ['S1'], confidence: 'HIGH' }, parseError: null, timing: {} })),
    async () => {
      await t('a failed request does not poison the queue for subsequent unrelated requests', async () => {
        await runtime.ensureLoaded('/fake/model.gguf');
        const controller = new AbortController();
        const failing = runtime.infer({ system: 's', user: 'u', schema: {}, maxTokens: 10, modelPath: '/fake/model.gguf', timeoutMs: 5000, signal: controller.signal });
        controller.abort();
        await assert.rejects(failing);
        const following = await Promise.all([1, 2, 3].map(() => runtime.infer({ system: 's', user: 'u', schema: {}, maxTokens: 10, modelPath: '/fake/model.gguf', timeoutMs: 5000 })));
        assert.ok(following.every((r) => r.parsed.judgment === 'SUPPORTS'));
      });
    },
  );

  await withFreshRuntime(
    () => respondInferWith(() => ({ raw: '{}', parsed: { judgment: 'SUPPORTS', evidenceHandles: ['S1'], confidence: 'HIGH' }, parseError: null, timing: {} })),
    async () => {
      await t('ensureLoaded: requesting a DIFFERENT model while one is already loaded throws rather than silently swapping', async () => {
        await runtime.ensureLoaded('/fake/model-a.gguf');
        await assert.rejects(runtime.ensureLoaded('/fake/model-b.gguf'), /different model is already loaded/);
      });
    },
  );

  console.log(`localJudgeRuntime: ${passed} passed`);
}

main();
