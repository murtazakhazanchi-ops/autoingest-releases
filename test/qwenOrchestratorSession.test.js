'use strict';

// Ask AutoIngest Stage 4, Section 37: model-independent tests for
// OrchestratorSession -- session lifecycle, handle isolation, duplicate-
// tool-call protection, bounded action loop, cancellation state, reset,
// context-budget/pruning wiring, mechanical validator + regeneration +
// fallback, error mapping, diagnostics privacy. A fake in-process
// EventEmitter child (mirroring test/qwenRuntimeLifecycle.test.js's own
// established convention) simulates node-llama-cpp's real tool-calling
// loop -- emitting 'tool-call' messages and awaiting 'tool-result'
// replies exactly as the real runtimeWorker.js does -- so this suite
// exercises the REAL runtime.js session-routing code and the REAL Stage-2
// Knowledge Base operations (via a real build.assemble()), with only the
// native model itself faked. Zero real-model/GPU dependency.
//
// Run with: node test/qwenOrchestratorSession.test.js

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const runtime = require('../services/qwenRuntime/runtime');
const modelManager = require('../services/qwenRuntime/modelManager');
const { buildOrchestratorKnowledgeContext } = require('../services/qwenOrchestrator/index');
const { OrchestratorSession } = require('../services/qwenOrchestrator/session');

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

// Built once for the whole suite -- a real (not faked) Stage-2 knowledge
// context, exactly like Stage 2's own tests (`build.assemble()` is pure,
// filesystem-based, and has zero model/network dependency).
const knowledgeContext = buildOrchestratorKnowledgeContext();

let _pidCounter = 3000;
function makeFakeChild(behavior) {
  const child = new EventEmitter();
  child.pid = _pidCounter++;
  child.postMessage = (msg) => behavior(msg, child);
  child.kill = () => { setTimeout(() => child.emit('exit', 0), 1); return true; };
  return child;
}

// Standard lifecycle responses (load/createContext/session create-reset-
// dispose/history get-set) shared by every scenario -- only
// `onPromptSession`/`onToolResult` vary per test.
function baseBehavior(scenario) {
  return (msg, child) => {
    if (msg.type === 'load') setTimeout(() => child.emit('message', { type: 'loaded' }), 1);
    else if (msg.type === 'createContext') setTimeout(() => child.emit('message', { type: 'context-created', contextSize: 24576 }), 1);
    else if (msg.type === 'createSession') setTimeout(() => child.emit('message', { type: 'session-created', sessionId: msg.sessionId }), 1);
    else if (msg.type === 'resetSession') { scenario.resetCalls.push(msg.sessionId); setTimeout(() => child.emit('message', { type: 'session-reset', sessionId: msg.sessionId }), 1); }
    else if (msg.type === 'disposeSession') setTimeout(() => child.emit('message', { type: 'session-disposed', sessionId: msg.sessionId }), 1);
    else if (msg.type === 'getSessionHistory') setTimeout(() => child.emit('message', { type: 'session-history-result', sessionId: msg.sessionId, requestId: msg.requestId, history: scenario.history || [] }), 1);
    else if (msg.type === 'setSessionHistory') { scenario.setHistoryCalls.push(msg.history); setTimeout(() => child.emit('message', { type: 'session-history-set', sessionId: msg.sessionId, requestId: msg.requestId }), 1); }
    else if (msg.type === 'promptSession') scenario.onPromptSession(msg, child);
    else if (msg.type === 'tool-result') scenario.onToolResult(msg);
  };
}

// A scenario drives a SEQUENCE of turns; `turnPlans` is an array, one
// entry consumed per promptSession call, each { calls: [{name,params}],
// text }. Sequential tool calls within one turn are made one at a time,
// awaiting each tool-result before making the next -- exactly matching
// node-llama-cpp's own real internal loop.
function makeScenario(turnPlans) {
  let turnIndex = 0;
  let callIdCounter = 0;
  const pendingByCallId = new Map();
  const scenario = {
    resetCalls: [], setHistoryCalls: [], history: [],
    onToolResult(msg) {
      const resolve = pendingByCallId.get(msg.callId);
      if (!resolve) return;
      pendingByCallId.delete(msg.callId);
      resolve(msg.error ? { error: msg.error } : msg.result);
    },
    onPromptSession(msg, child) {
      const plan = turnPlans[Math.min(turnIndex, turnPlans.length - 1)];
      turnIndex += 1;
      (async () => {
        const madeCalls = [];
        for (const call of (plan.calls || [])) {
          const callId = ++callIdCounter;
          const resultPromise = new Promise((resolve) => pendingByCallId.set(callId, resolve));
          child.emit('message', { type: 'tool-call', sessionId: msg.sessionId, callId, toolName: call.name, params: call.params });
          const result = await resultPromise;
          madeCalls.push({ name: call.name, params: call.params, result });
        }
        child.emit('message', { type: 'session-result', sessionId: msg.sessionId, requestId: msg.requestId, text: plan.text, toolCalls: madeCalls, stopReason: 'eogToken' });
      })();
    },
  };
  return scenario;
}

async function withVerifiedModel(fn) {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qwenorch-'));
  const originalGetStatus = modelManager.getStatus;
  modelManager.getStatus = (overrideDir) => {
    if (overrideDir === dir) return { status: modelManager.STATUS.READY, detail: {} };
    return originalGetStatus(overrideDir);
  };
  try {
    await fn(dir);
  } finally {
    modelManager.getStatus = originalGetStatus;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function withFreshRuntimeAndScenario(turnPlans, fn) {
  const scenario = makeScenario(turnPlans);
  runtime._setSpawnFnForTesting(() => makeFakeChild(baseBehavior(scenario)));
  try {
    await withVerifiedModel(async (dir) => {
      await runtime.load(null, { overrideDir: dir });
      await fn(scenario);
    });
  } finally {
    await runtime.terminate();
    runtime._setSpawnFnForTesting(null);
  }
}

let _sessionCounter = 0;
function uniqueSessionId() { _sessionCounter += 1; return `test-session-${_sessionCounter}`; }

async function main() {
  console.log('qwenOrchestratorSession');

  await t('session lifecycle: create -> sendMessage (no tools) -> dispose', async () => {
    await withFreshRuntimeAndScenario([{ calls: [], text: 'Hello, how can I help?' }], async () => {
      const session = new OrchestratorSession({ sessionId: uniqueSessionId(), knowledgeContext });
      await session.create();
      const result = await session.sendMessage('hi');
      assert.equal(result.text, 'Hello, how can I help?');
      assert.equal(result.usedFallback, false);
      await session.dispose();
    });
  });

  await t('Section 32: getDiagnostics().contextTokenUsage is populated after a turn (required diagnostics field)', async () => {
    await withFreshRuntimeAndScenario([{ calls: [], text: 'A short reply.' }], async () => {
      const session = new OrchestratorSession({ sessionId: uniqueSessionId(), knowledgeContext });
      await session.create();
      assert.equal(session.getDiagnostics().contextTokenUsage, undefined, 'no figure before any turn has run');
      await session.sendMessage('hi');
      const usage = session.getDiagnostics().contextTokenUsage;
      assert.equal(typeof usage.contextSize, 'number');
      assert.equal(typeof usage.used, 'number');
      assert.equal(typeof usage.withinBudget, 'boolean');
      await session.dispose();
    });
  });

  await t('protocol-artifact defense-in-depth: a residual <think>/control-token in the raw session-result text is stripped before validation and before the caller ever sees it', async () => {
    await withFreshRuntimeAndScenario([
      { calls: [], text: '<think>\ninternal reasoning the model should never have leaked\n</think>\n\nHere is the real answer.<|im_end|>' },
    ], async () => {
      const session = new OrchestratorSession({ sessionId: uniqueSessionId(), knowledgeContext });
      await session.create();
      const result = await session.sendMessage('hi');
      assert.equal(result.text, 'Here is the real answer.');
      assert.equal(result.usedFallback, false, 'containProtocolArtifacts must run BEFORE validateFinalAnswer -- a raw <think>/control-token residual should never itself trigger a leak finding once stripped');
      await session.dispose();
    });
  });

  await t('handle isolation: a handle issued in session A does not resolve in session B', async () => {
    await withFreshRuntimeAndScenario([
      { calls: [{ name: 'search_autoingest', params: { query: 'duplicate detection' } }], text: 'Found it.' },
    ], async () => {
      const sessionA = new OrchestratorSession({ sessionId: uniqueSessionId(), knowledgeContext });
      await sessionA.create();
      const result = await sessionA.sendMessage('tell me about duplicate detection');
      const searchCall = result.toolCalls.find((c) => c.name === 'search_autoingest');
      assert.ok(searchCall && searchCall.result.results.length > 0, 'a real search should return at least one real result');
      const handle = searchCall.result.results[0].handle;

      const sessionB = new OrchestratorSession({ sessionId: uniqueSessionId(), knowledgeContext });
      await sessionB.create();
      assert.equal(sessionB.handleSession.resolve(handle), null, 'session B must never resolve a handle issued only in session A');

      await sessionA.dispose();
      await sessionB.dispose();
    });
  });

  await t('duplicate-tool-call protection: the SAME tool+args called twice in one turn executes the real op only once', async () => {
    await withFreshRuntimeAndScenario([
      {
        calls: [
          { name: 'search_autoingest', params: { query: 'metadata repair' } },
          { name: 'search_autoingest', params: { query: 'metadata repair' } }, // exact duplicate
        ],
        text: 'Metadata repair is available.',
      },
    ], async () => {
      const session = new OrchestratorSession({ sessionId: uniqueSessionId(), knowledgeContext });
      await session.create();
      await session.sendMessage('does AutoIngest repair metadata?');
      assert.equal(session.diagnostics.toolActionCounts.search_autoingest, 1, 'the real search_autoingest op must run exactly once despite two identical tool calls');
      await session.dispose();
    });
  });

  await t('duplicate-tool-call protection: a DIFFERENT query still executes as new work', async () => {
    await withFreshRuntimeAndScenario([
      {
        calls: [
          { name: 'search_autoingest', params: { query: 'metadata repair' } },
          { name: 'search_autoingest', params: { query: 'archive locking' } },
        ],
        text: 'Both are available.',
      },
    ], async () => {
      const session = new OrchestratorSession({ sessionId: uniqueSessionId(), knowledgeContext });
      await session.create();
      await session.sendMessage('tell me about both');
      assert.equal(session.diagnostics.toolActionCounts.search_autoingest, 2);
      await session.dispose();
    });
  });

  await t('bounded tool-action loop: calls beyond the per-turn limit return action_limit_reached, not real work', async () => {
    const manyCalls = Array.from({ length: 5 }, (_, i) => ({ name: 'search_autoingest', params: { query: `distinct query ${i}` } }));
    await withFreshRuntimeAndScenario([{ calls: manyCalls, text: 'Here is what I found.' }], async () => {
      const session = new OrchestratorSession({ sessionId: uniqueSessionId(), knowledgeContext, maxToolActionsPerTurn: 3 });
      await session.create();
      const result = await session.sendMessage('a question needing many lookups');
      assert.equal(session.diagnostics.toolActionCounts.search_autoingest, 3, 'must stop executing real work at the configured limit');
      const limitedCalls = result.toolCalls.filter((c) => c.result && /Tool-call budget reached/.test(c.result.note || ''));
      assert.equal(limitedCalls.length, 2, 'calls beyond the limit must get the structured budget-reached redirect, not silently vanish');
      await session.dispose();
    });
  });

  await t('cancellation: an aborted turn rejects promptly, session remains usable, cancellationCount increments', async () => {
    await withFreshRuntimeAndScenario([{ calls: [], text: 'irrelevant -- this turn is cancelled before it matters' }], async () => {
      const session = new OrchestratorSession({ sessionId: uniqueSessionId(), knowledgeContext });
      await session.create();
      const controller = new AbortController();
      const p = session.sendMessage('a question', { signal: controller.signal, timeoutMs: 5000 });
      controller.abort();
      await assert.rejects(p, (err) => err.code === 'TURN_CANCELLED');
      assert.equal(session.diagnostics.cancellationCount, 1);
      assert.equal(session.busy, false, 'busy flag must clear after a cancelled turn');
      await session.dispose();
    });
  });

  await t('reset: clears handles and grounding state -- a pre-reset handle is invalid after reset', async () => {
    await withFreshRuntimeAndScenario([
      { calls: [{ name: 'search_autoingest', params: { query: 'transfer export' } }], text: 'Found it.' },
    ], async () => {
      const session = new OrchestratorSession({ sessionId: uniqueSessionId(), knowledgeContext });
      await session.create();
      const result = await session.sendMessage('tell me about transfer export');
      const handle = result.toolCalls[0].result.results[0].handle;
      assert.equal(session.handleSession.resolve(handle), handle ? session.handleSession.resolve(handle) : null); // sanity: resolves to something non-null before reset
      assert.notEqual(session.handleSession.resolve(handle), null);

      await session.reset();
      assert.equal(session.handleSession.resolve(handle), null, 'a handle from before reset must not resolve after reset');
      assert.equal(session.turnNumber, 0);
      assert.equal(session.diagnostics.resetCount, 1);
      await session.dispose();
    });
  });

  await t('context-budget/pruning wiring: an oversized history triggers setSessionHistory with a pruned result', async () => {
    const scenario = makeScenario([{ calls: [], text: 'ok' }]);
    // Synthesize a history large enough that pruneHistoryToFit must act,
    // but not so large it needs a fresh context (tests the setHistory
    // path specifically, distinct from the freshContext path).
    scenario.history = [{ type: 'system', text: 'sys' }];
    for (let i = 0; i < 50; i++) {
      scenario.history.push({ type: 'user', text: `question number ${i} `.repeat(100) });
      scenario.history.push({ type: 'model', response: [{ type: 'functionCall', name: 'search_autoingest', params: { query: `q${i}` }, result: {} }, `answer number ${i} `.repeat(100)] });
    }
    runtime._setSpawnFnForTesting(() => makeFakeChild(baseBehavior(scenario)));
    try {
      await withVerifiedModel(async (dir) => {
        await runtime.load(null, { overrideDir: dir });
        const session = new OrchestratorSession({ sessionId: uniqueSessionId(), knowledgeContext });
        await session.create();
        await session.sendMessage('a question');
        assert.equal(scenario.setHistoryCalls.length, 1, 'an oversized history must trigger exactly one setSessionHistory call after the turn');
        await session.dispose();
      });
    } finally {
      await runtime.terminate();
      runtime._setSpawnFnForTesting(null);
    }
  });

  await t('context-budget/pruning wiring: a history too large even for the floor triggers a fresh-context reset', async () => {
    const scenario = makeScenario([{ calls: [], text: 'ok' }]);
    scenario.history = [{ type: 'system', text: 'sys' }];
    for (let i = 0; i < 3; i++) {
      scenario.history.push({ type: 'user', text: 'x'.repeat(400000) });
      scenario.history.push({ type: 'model', response: ['y'.repeat(400000)] });
    }
    runtime._setSpawnFnForTesting(() => makeFakeChild(baseBehavior(scenario)));
    try {
      await withVerifiedModel(async (dir) => {
        await runtime.load(null, { overrideDir: dir });
        const session = new OrchestratorSession({ sessionId: uniqueSessionId(), knowledgeContext });
        await session.create();
        await session.sendMessage('a question');
        assert.equal(session.diagnostics.freshContextCount, 1);
        assert.ok(scenario.resetCalls.length >= 1, 'an unfittable history must trigger a resetSession call on the child');
        await session.dispose();
      });
    } finally {
      await runtime.terminate();
      runtime._setSpawnFnForTesting(null);
    }
  });

  await t('validator + regeneration: a leaking first answer is regenerated and the clean second answer is returned', async () => {
    await withFreshRuntimeAndScenario([
      { calls: [], text: 'This is documented in AI-FEAT-058.' }, // leaks an internal id
      { calls: [], text: 'Files are skipped automatically when duplicated during import.' }, // clean, no capability-claim wording
    ], async () => {
      const session = new OrchestratorSession({ sessionId: uniqueSessionId(), knowledgeContext });
      await session.create();
      const result = await session.sendMessage('how does that work?');
      assert.equal(result.text, 'Files are skipped automatically when duplicated during import.');
      assert.equal(result.regenerated, true);
      assert.equal(result.usedFallback, false);
      assert.equal(session.diagnostics.regenerationCount, 1);
      await session.dispose();
    });
  });

  await t('fallback: every attempt (including all regenerations) leaking/empty exhausts regeneration and returns a safe fallback', async () => {
    await withFreshRuntimeAndScenario([
      { calls: [], text: '' }, // empty
      { calls: [], text: '' },
      { calls: [], text: '' },
    ], async () => {
      const session = new OrchestratorSession({ sessionId: uniqueSessionId(), knowledgeContext, maxRegenerations: 2 });
      await session.create();
      const result = await session.sendMessage('a question');
      assert.equal(result.usedFallback, true);
      assert.ok(result.text.length > 0, 'a fallback must never itself be empty');
      assert.equal(session.diagnostics.regenerationCount, 2);
      assert.equal(session.diagnostics.fallbackCount, 1);
      // the fallback text itself must be clean (no leaks) -- validated again for sanity
      const { validateFinalAnswer } = require('../services/qwenOrchestrator/answerValidator');
      assert.equal(validateFinalAnswer({ finalText: result.text }).ok, true);
      await session.dispose();
    });
  });

  await t('error mapping: sendMessage on an already-busy session throws SESSION_BUSY', async () => {
    await withFreshRuntimeAndScenario([{ calls: [], text: 'first' }, { calls: [], text: 'second' }], async () => {
      const session = new OrchestratorSession({ sessionId: uniqueSessionId(), knowledgeContext });
      await session.create();
      const p1 = session.sendMessage('first question');
      await assert.rejects(session.sendMessage('second question'), (err) => err.code === 'SESSION_BUSY');
      await p1;
      await session.dispose();
    });
  });

  await t('error mapping: sendMessage before create() throws SESSION_NOT_FOUND', async () => {
    const session = new OrchestratorSession({ sessionId: uniqueSessionId(), knowledgeContext });
    await assert.rejects(session.sendMessage('hi'), (err) => err.code === 'SESSION_NOT_FOUND');
  });

  await t('diagnostics privacy: getDiagnostics() never includes operator text, generated answers, or raw tool-result content', async () => {
    await withFreshRuntimeAndScenario([
      { calls: [{ name: 'search_autoingest', params: { query: 'a very specific operator question about archives' } }], text: 'A specific generated answer about archives.' },
    ], async () => {
      const session = new OrchestratorSession({ sessionId: uniqueSessionId(), knowledgeContext });
      await session.create();
      await session.sendMessage('a very specific operator question about archives');
      const diag = session.getDiagnostics();
      const serialized = JSON.stringify(diag);
      assert.ok(!serialized.includes('a very specific operator question'), 'diagnostics must not contain the operator message');
      assert.ok(!serialized.includes('A specific generated answer'), 'diagnostics must not contain the generated answer');
      const banned = new Set(['prompt', 'question', 'answer', 'conversation', 'text', 'response', 'output']);
      for (const key of Object.keys(diag)) {
        const words = key.replace(/([A-Z])/g, ' $1').toLowerCase().split(/[^a-z]+/).filter(Boolean);
        assert.ok(!words.some((w) => banned.has(w)), `diagnostics field "${key}" looks conversation-content-shaped`);
      }
      await session.dispose();
    });
  });

  console.log(`qwenOrchestratorSession: ${passed} passed`);
}

main();
