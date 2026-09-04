'use strict';

// Ask AutoIngest Stage 3, Section 27A: model-independent tests for
// services/qwenRuntime/runtime.js's lifecycle state machine, queueing,
// cancellation, and crash-recovery logic -- exercised against a FAKE,
// in-process EventEmitter child (via runtime.js's own
// _setSpawnFnForTesting() injection point, the exact same pattern
// test/localJudgeRuntime.test.js already established for Gemma), never a
// real Electron utilityProcess or node-llama-cpp. The real runtime is
// separately proven against the actual production stack by
// test/qwenRuntimeRealModel.test.js (opt-in, requires the real GGUF).
//
// Run with: node test/qwenRuntimeLifecycle.test.js

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const runtime = require('../services/qwenRuntime/runtime');
const modelManager = require('../services/qwenRuntime/modelManager');

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

let _pidCounter = 2000;
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

// Standard happy-path behavior: load -> context-created -> infer echoes ->
// disposeContext -> unload, all with a small async delay.
function standardBehavior(overrides = {}) {
  return (msg, child) => {
    if (msg.type === 'load') {
      setTimeout(() => child.emit('message', { type: 'loaded', loadMs: 5, gpu: 'metal' }), 1);
    } else if (msg.type === 'createContext') {
      setTimeout(() => child.emit('message', { type: 'context-created', createContextMs: 3, contextSize: 24576 }), 1);
    } else if (msg.type === 'infer') {
      const delay = overrides.inferDelayMs != null ? overrides.inferDelayMs : 5;
      setTimeout(() => {
        if (overrides.onInfer) { overrides.onInfer(msg, child); return; }
        child.emit('message', { type: 'result', requestId: msg.requestId, text: `echo:${msg.prompt}`, timing: { firstTokenMs: 1, totalMs: delay, approxOutputTokens: 3 } });
      }, delay);
    } else if (msg.type === 'disposeContext') {
      setTimeout(() => child.emit('message', { type: 'context-disposed' }), 1);
    } else if (msg.type === 'unload') {
      setTimeout(() => child.emit('message', { type: 'unloaded' }), 1);
    }
  };
}

async function withFreshRuntime(behaviorFactory, fn) {
  let child;
  runtime._setSpawnFnForTesting(() => {
    child = makeFakeChild(behaviorFactory(child));
    return child;
  });
  try {
    await fn(() => child);
  } finally {
    await runtime.terminate();
    runtime._setSpawnFnForTesting(null);
  }
}

// runtime.js's own precondition check (Section 2: MODEL_UNAVAILABLE) calls
// modelManager.getStatus(overrideDir) with NO custom identity, so it is
// always pinned against the REAL ~2.7GB Qwen artifact's real SHA-256 --
// by design, since that pinning is exactly Section 2's point. A model-
// independent test therefore cannot satisfy it with a real-but-synthetic
// file (there is no way to forge a file matching a fixed real hash), so
// this stubs modelManager.getStatus() itself for the duration of the
// test. Since Node's require() cache means runtime.js and this test file
// share the exact same modelManager module object, reassigning the
// exported function here is visible to runtime.js too. Restored
// afterward so other tests/files see the real implementation.
async function withVerifiedModel(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwenrt-'));
  const originalGetStatus = modelManager.getStatus;
  modelManager.getStatus = (overrideDir) => {
    if (overrideDir === dir) return { status: modelManager.STATUS.READY, detail: { path: modelManager.resolvePaths(dir).finalPath } };
    return originalGetStatus(overrideDir);
  };
  try {
    await fn(dir, {});
  } finally {
    modelManager.getStatus = originalGetStatus;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  await t('initial state is UNINITIALIZED', () => {
    assert.equal(runtime.getState(), runtime.STATE.UNINITIALIZED);
  });

  await t('load() with no verified model transitions to MODEL_UNAVAILABLE, never attempts a spawn', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwenrt-empty-'));
    let spawnCalled = false;
    runtime._setSpawnFnForTesting(() => { spawnCalled = true; return makeFakeChild(() => {}); });
    try {
      await assert.rejects(() => runtime.load('/fake/path', { overrideDir: dir }), (err) => err.code === 'MODEL_NOT_INSTALLED');
      assert.equal(runtime.getState(), runtime.STATE.MODEL_UNAVAILABLE);
      assert.equal(spawnCalled, false);
    } finally {
      runtime._setSpawnFnForTesting(null);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t('load() with a verified model transitions UNINITIALIZED -> LOADING -> READY, model+context both created', async () => {
    await withVerifiedModel(async (dir) => {
      await withFreshRuntime(() => standardBehavior(), async () => {
        const result = await runtime.load(null, { overrideDir: dir });
        assert.equal(result.state, runtime.STATE.READY);
        assert.equal(runtime.getState(), runtime.STATE.READY);
      });
    });
  });

  await t('concurrent load() calls are deduplicated -- only one real load happens', async () => {
    await withVerifiedModel(async (dir) => {
      let loadMessageCount = 0;
      const behavior = () => (msg, child) => {
        if (msg.type === 'load') { loadMessageCount++; setTimeout(() => child.emit('message', { type: 'loaded', loadMs: 5 }), 5); }
        else if (msg.type === 'createContext') setTimeout(() => child.emit('message', { type: 'context-created', contextSize: 24576 }), 5);
      };
      await withFreshRuntime(behavior, async () => {
        const [a, b, c] = await Promise.all([
          runtime.load(null, { overrideDir: dir }),
          runtime.load(null, { overrideDir: dir }),
          runtime.load(null, { overrideDir: dir }),
        ]);
        assert.equal(loadMessageCount, 1);
        assert.ok(a.state === 'READY' || a.alreadyLoaded);
      });
    });
  });

  await t('load() while already READY on the SAME path is a safe no-op', async () => {
    await withVerifiedModel(async (dir) => {
      await withFreshRuntime(() => standardBehavior(), async () => {
        await runtime.load(null, { overrideDir: dir });
        const second = await runtime.load(null, { overrideDir: dir });
        assert.equal(second.alreadyLoaded, true);
      });
    });
  });

  await t('infer() runs a request end to end and returns the child\'s result', async () => {
    await withVerifiedModel(async (dir) => {
      await withFreshRuntime(() => standardBehavior(), async () => {
        await runtime.load(null, { overrideDir: dir });
        const result = await runtime.infer({ prompt: 'hello', maxTokens: 8, timeoutMs: 2000 });
        assert.equal(result.text, 'echo:hello');
        assert.equal(runtime.getState(), runtime.STATE.READY);
      });
    });
  });

  await t('infer() transitions to BUSY during the call and back to READY after', async () => {
    await withVerifiedModel(async (dir) => {
      await withFreshRuntime(() => standardBehavior({ inferDelayMs: 30 }), async () => {
        await runtime.load(null, { overrideDir: dir });
        const inferPromise = runtime.infer({ prompt: 'x', maxTokens: 8, timeoutMs: 2000 });
        await new Promise((r) => setTimeout(r, 5));
        assert.equal(runtime.getState(), runtime.STATE.BUSY);
        await inferPromise;
        assert.equal(runtime.getState(), runtime.STATE.READY);
      });
    });
  });

  await t('Section 20: two concurrent infer() calls are serialized (FIFO), never run simultaneously', async () => {
    await withVerifiedModel(async (dir) => {
      const activeCount = { current: 0, max: 0 };
      const behavior = () => (msg, child) => {
        if (msg.type === 'load') setTimeout(() => child.emit('message', { type: 'loaded' }), 1);
        else if (msg.type === 'createContext') setTimeout(() => child.emit('message', { type: 'context-created', contextSize: 24576 }), 1);
        else if (msg.type === 'infer') {
          activeCount.current++;
          activeCount.max = Math.max(activeCount.max, activeCount.current);
          setTimeout(() => {
            activeCount.current--;
            child.emit('message', { type: 'result', requestId: msg.requestId, text: 'ok' });
          }, 20);
        }
      };
      await withFreshRuntime(behavior, async () => {
        await runtime.load(null, { overrideDir: dir });
        await Promise.all([
          runtime.infer({ prompt: 'a', maxTokens: 8, timeoutMs: 2000 }),
          runtime.infer({ prompt: 'b', maxTokens: 8, timeoutMs: 2000 }),
          runtime.infer({ prompt: 'c', maxTokens: 8, timeoutMs: 2000 }),
        ]);
        assert.equal(activeCount.max, 1, 'at most one inference should ever be active at once');
      });
    });
  });

  await t('Section 19: cancellation rejects immediately without waiting for the child\'s (discarded) result', async () => {
    await withVerifiedModel(async (dir) => {
      await withFreshRuntime(() => standardBehavior({ inferDelayMs: 200 }), async () => {
        await runtime.load(null, { overrideDir: dir });
        const controller = new AbortController();
        const inferPromise = runtime.infer({ prompt: 'slow', maxTokens: 8, timeoutMs: 5000, signal: controller.signal });
        setTimeout(() => controller.abort(), 10);
        const t0 = Date.now();
        await assert.rejects(inferPromise, (err) => err.code === 'INFERENCE_CANCELLED');
        assert.ok(Date.now() - t0 < 100, 'cancellation must reject quickly, not wait for the full 200ms child delay');
      });
    });
  });

  await t('Section 19: a new inference after cancellation succeeds normally (repeated cancel -> new-inference cycles)', async () => {
    await withVerifiedModel(async (dir) => {
      await withFreshRuntime(() => standardBehavior({ inferDelayMs: 30 }), async () => {
        await runtime.load(null, { overrideDir: dir });
        for (let i = 0; i < 3; i++) {
          const controller = new AbortController();
          const cancelled = runtime.infer({ prompt: `c${i}`, maxTokens: 8, timeoutMs: 2000, signal: controller.signal });
          controller.abort();
          await assert.rejects(cancelled, (err) => err.code === 'INFERENCE_CANCELLED');
          const ok = await runtime.infer({ prompt: `ok${i}`, maxTokens: 8, timeoutMs: 2000 });
          assert.equal(ok.text, `echo:ok${i}`);
        }
        assert.equal(runtime.getState(), runtime.STATE.READY);
      });
    });
  });

  await t('a timed-out inference rejects with INFERENCE_FAILED and the runtime remains usable afterward', async () => {
    await withVerifiedModel(async (dir) => {
      await withFreshRuntime(() => standardBehavior({ inferDelayMs: 500 }), async () => {
        await runtime.load(null, { overrideDir: dir });
        await assert.rejects(
          runtime.infer({ prompt: 'x', maxTokens: 8, timeoutMs: 20 }),
          (err) => err.code === 'INFERENCE_FAILED',
        );
        // give the (now-abandoned) child response time to arrive and be discarded
        await new Promise((r) => setTimeout(r, 520));
        assert.equal(runtime.getState(), runtime.STATE.READY);
      });
    });
  });

  await t('Section 21: a crashed child transitions to FAILED and rejects in-flight requests, never crashes the host', async () => {
    await withVerifiedModel(async (dir) => {
      await withFreshRuntime((child) => (msg, c) => {
        if (msg.type === 'load') setTimeout(() => c.emit('message', { type: 'loaded' }), 1);
        else if (msg.type === 'createContext') setTimeout(() => c.emit('message', { type: 'context-created', contextSize: 24576 }), 1);
        else if (msg.type === 'infer') setTimeout(() => c.emit('exit', 1), 10); // simulate a native crash instead of responding
      }, async (getChild) => {
        await runtime.load(null, { overrideDir: dir });
        await assert.rejects(
          runtime.infer({ prompt: 'x', maxTokens: 8, timeoutMs: 5000 }),
          (err) => err.code === 'RUNTIME_CRASHED',
        );
        assert.equal(runtime.getState(), runtime.STATE.FAILED);
      });
    });
  });

  await t('Section 21: a controlled restart after FAILED works (load() again succeeds)', async () => {
    await withVerifiedModel(async (dir) => {
      await withFreshRuntime((child) => (msg, c) => {
        if (msg.type === 'load') setTimeout(() => c.emit('message', { type: 'loaded' }), 1);
        else if (msg.type === 'createContext') setTimeout(() => c.emit('message', { type: 'context-created', contextSize: 24576 }), 1);
        else if (msg.type === 'infer') setTimeout(() => c.emit('exit', 1), 5);
      }, async () => {
        await runtime.load(null, { overrideDir: dir });
        await assert.rejects(runtime.infer({ prompt: 'x', maxTokens: 8, timeoutMs: 5000 }));
        assert.equal(runtime.getState(), runtime.STATE.FAILED);
      });
      // A fresh spawn (new behavior, normal this time) proves recovery --
      // matches Gemma's own "no infinite restart loop" requirement: this
      // is an explicit, caller-initiated load(), never automatic.
      await withFreshRuntime(() => standardBehavior(), async () => {
        const result = await runtime.load(null, { overrideDir: dir });
        assert.equal(result.state, runtime.STATE.READY);
      });
    });
  });

  await t('Section 15: unload() while an inference is queued behind it waits its turn safely (no race)', async () => {
    await withVerifiedModel(async (dir) => {
      await withFreshRuntime(() => standardBehavior({ inferDelayMs: 30 }), async () => {
        await runtime.load(null, { overrideDir: dir });
        const inferPromise = runtime.infer({ prompt: 'x', maxTokens: 8, timeoutMs: 2000 });
        const unloadPromise = runtime.unload();
        await Promise.all([inferPromise, unloadPromise]);
        assert.equal(runtime.getState(), runtime.STATE.UNINITIALIZED);
      });
    });
  });

  await t('Section 26: repeated load/unload cycles are deterministic; loadCount tracked separately from current state', async () => {
    // loadCount is deliberately a whole-runtime-process-lifetime counter
    // (Section 26), not reset by terminate()/unload() -- so this asserts
    // the DELTA across this test's own 3 cycles, not an absolute value,
    // since the shared runtime singleton also accumulates loads from
    // every other test in this file.
    await withVerifiedModel(async (dir) => {
      await withFreshRuntime(() => standardBehavior(), async () => {
        const before = runtime.getDiagnostics().loadCount;
        for (let i = 0; i < 3; i++) {
          await runtime.load(null, { overrideDir: dir });
          assert.equal(runtime.getState(), runtime.STATE.READY);
          await runtime.unload();
          assert.equal(runtime.getState(), runtime.STATE.UNINITIALIZED);
        }
        const diag = runtime.getDiagnostics();
        assert.equal(diag.loadCount - before, 3);
      });
    });
  });

  await t('Section 17: createContext()/disposeContext() work independently of a full load/unload cycle', async () => {
    await withVerifiedModel(async (dir) => {
      await withFreshRuntime(() => standardBehavior(), async () => {
        await runtime.load(null, { overrideDir: dir });
        await runtime.disposeContext();
        const recreated = await runtime.createContext();
        assert.ok(recreated.alreadyReady || recreated.type === 'context-created' || recreated.contextSize);
      });
    });
  });

  await t('Section 24: getDiagnostics() never includes conversation content, only structural fields', () => {
    const diag = runtime.getDiagnostics();
    const banned = new Set(['prompt', 'question', 'answer', 'conversation', 'text', 'response', 'output']);
    for (const k of Object.keys(diag)) {
      const words = k.replace(/([A-Z])/g, ' $1').toLowerCase().split(/[^a-z]+/).filter(Boolean);
      assert.ok(!words.some((w) => banned.has(w)), `diagnostics field "${k}" looks conversation-content-shaped`);
    }
    assert.equal(diag.contextSize, 24576);
  });

  await t('terminate() is safe to call even when nothing was ever loaded', async () => {
    await assert.doesNotReject(async () => { await runtime.terminate(); });
    assert.equal(runtime.getState(), runtime.STATE.UNINITIALIZED);
  });

  console.log(`\ntest/qwenRuntimeLifecycle.test.js: ${passed} passed`);
}

main();
