'use strict';

// Ask AutoIngest Stage 4, Section 37: model-independent tests for the
// orchestrator's pure, model-independent modules -- contextBudget.js,
// historyPruning.js, repetitionDetector.js, answerValidator.js, errors.js,
// toolDefinitions.js. Zero model/runtime/GPU/network dependency.
//
// Run with: node test/qwenOrchestratorPureModules.test.js

const assert = require('node:assert/strict');

const { estimateTokens, computeBudget, CONTEXT_SIZE, AVAILABLE_FOR_HISTORY } = require('../services/qwenOrchestrator/contextBudget');
const { splitIntoTurns, stripToolCallPayloads, dropOldestTurns, pruneHistoryToFit, estimateHistoryTokens } = require('../services/qwenOrchestrator/historyPruning');
const { detectPathologicalRepetition } = require('../services/qwenOrchestrator/repetitionDetector');
const { validateFinalAnswer, containProtocolArtifacts } = require('../services/qwenOrchestrator/answerValidator');
const { ORCHESTRATOR_ERROR_CODE, OrchestratorError, mapUnknownError } = require('../services/qwenOrchestrator/errors');
const { buildToolDefinitions } = require('../services/qwenOrchestrator/toolDefinitions');
const { SYSTEM_PROMPT } = require('../services/qwenOrchestrator/systemPrompt');

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

async function main() {
  console.log('qwenOrchestratorPureModules');

  // --- contextBudget.js -------------------------------------------------

  await t('estimateTokens: proportional to character length', () => {
    assert.equal(estimateTokens(''), 0);
    assert.ok(estimateTokens('a'.repeat(400)) > estimateTokens('a'.repeat(40)));
  });

  await t('CONTEXT_SIZE is imported from qwenRuntime/modelManifest, not re-pinned (single source of truth)', () => {
    const { CONTEXT_SIZE: RUNTIME_CONTEXT_SIZE } = require('../services/qwenRuntime/modelManifest');
    assert.equal(CONTEXT_SIZE, RUNTIME_CONTEXT_SIZE);
    assert.equal(CONTEXT_SIZE, 24576);
  });

  await t('computeBudget: within budget when history is small', () => {
    const b = computeBudget(100, 50);
    assert.equal(b.withinBudget, true);
    assert.equal(b.contextSize, CONTEXT_SIZE);
  });

  await t('computeBudget: over budget when history exceeds AVAILABLE_FOR_HISTORY', () => {
    const b = computeBudget(AVAILABLE_FOR_HISTORY + 1000, 0);
    assert.equal(b.withinBudget, false);
    assert.ok(b.remaining < 0);
  });

  await t('computeBudget: approachingLimit flags a soft warning zone before the hard limit', () => {
    const nearLimit = computeBudget(AVAILABLE_FOR_HISTORY * 0.9, 0);
    assert.equal(nearLimit.approachingLimit, true);
    const wellWithin = computeBudget(AVAILABLE_FOR_HISTORY * 0.2, 0);
    assert.equal(wellWithin.approachingLimit, false);
  });

  // --- historyPruning.js --------------------------------------------------

  function fakeHistory(turnCount, { withToolCalls = false } = {}) {
    const history = [{ type: 'system', text: 'sys' }];
    for (let i = 0; i < turnCount; i++) {
      history.push({ type: 'user', text: `question ${i} `.repeat(20) });
      const response = [`answer ${i} `.repeat(20)];
      if (withToolCalls) response.unshift({ type: 'functionCall', name: 'search_autoingest', params: { query: `q${i}` }, result: { results: [] } });
      history.push({ type: 'model', response });
    }
    return history;
  }

  await t('splitIntoTurns: separates system items from turn pairs correctly', () => {
    const history = fakeHistory(3);
    const { systemItems, turns } = splitIntoTurns(history);
    assert.equal(systemItems.length, 1);
    assert.equal(turns.length, 3);
    assert.equal(turns[0][0].type, 'user');
    assert.equal(turns[0][1].type, 'model');
  });

  await t('stripToolCallPayloads: removes functionCall entries from OLD turns, keeps recent turns untouched', () => {
    const history = fakeHistory(6, { withToolCalls: true });
    const stripped = stripToolCallPayloads(history, 2);
    const { turns } = splitIntoTurns(stripped);
    for (let i = 0; i < turns.length - 2; i++) {
      const modelItem = turns[i].find((x) => x.type === 'model');
      assert.ok(!modelItem.response.some((p) => p && p.type === 'functionCall'), `turn ${i} should have had its tool-call payload stripped`);
    }
    for (let i = turns.length - 2; i < turns.length; i++) {
      const modelItem = turns[i].find((x) => x.type === 'model');
      assert.ok(modelItem.response.some((p) => p && p.type === 'functionCall'), `turn ${i} should still have its tool-call payload`);
    }
  });

  await t('stripToolCallPayloads: never touches the visible text of any turn, old or recent', () => {
    const history = fakeHistory(5, { withToolCalls: true });
    const stripped = stripToolCallPayloads(history, 1);
    const originalText = history.filter((i) => i.type === 'model').flatMap((i) => i.response.filter((p) => typeof p === 'string'));
    const strippedText = stripped.filter((i) => i.type === 'model').flatMap((i) => i.response.filter((p) => typeof p === 'string'));
    assert.deepEqual(strippedText, originalText);
  });

  await t('dropOldestTurns: keeps at least the floor, drops older turns first, never touches system message', () => {
    const history = fakeHistory(10);
    const { history: floored, droppedAny } = dropOldestTurns(history, 2);
    assert.equal(droppedAny, true);
    const { systemItems, turns } = splitIntoTurns(floored);
    assert.equal(systemItems.length, 1);
    assert.equal(turns.length, 2);
    const keptUserText = turns[0].find((x) => x.type === 'user').text;
    assert.ok(keptUserText.includes('question 8'));
  });

  await t('dropOldestTurns: no-op when already at or below the floor', () => {
    const history = fakeHistory(2);
    const { droppedAny } = dropOldestTurns(history, 2);
    assert.equal(droppedAny, false);
  });

  await t('pruneHistoryToFit: no-op when already within budget', () => {
    const history = fakeHistory(2);
    const result = pruneHistoryToFit(history);
    assert.equal(result.pruned, false);
    assert.equal(result.needsFreshContext, false);
  });

  await t('pruneHistoryToFit: escalates to stripToolCallPayloads then dropOldestTurns as needed', () => {
    const hugeHistory = fakeHistory(400, { withToolCalls: true });
    const result = pruneHistoryToFit(hugeHistory);
    assert.equal(result.pruned, true);
    assert.ok(result.stepsApplied.includes('stripToolCallPayloads'));
  });

  await t('pruneHistoryToFit: signals needsFreshContext when even the floor does not fit', () => {
    const massiveHistory = [{ type: 'system', text: 'sys' }];
    for (let i = 0; i < 3; i++) {
      massiveHistory.push({ type: 'user', text: 'x'.repeat(400000) });
      massiveHistory.push({ type: 'model', response: ['y'.repeat(400000)] });
    }
    const result = pruneHistoryToFit(massiveHistory);
    assert.equal(result.needsFreshContext, true);
  });

  await t('estimateHistoryTokens: sums realistically across mixed item types', () => {
    const history = fakeHistory(2, { withToolCalls: true });
    const total = estimateHistoryTokens(history);
    assert.ok(total > 0);
  });

  // --- repetitionDetector.js ----------------------------------------------

  await t('detectPathologicalRepetition: a normal, varied paragraph is not flagged', () => {
    const text = 'AutoIngest supports duplicate detection during import. Files with the same name and size are skipped automatically. Different sizes are renamed instead of overwritten.';
    const result = detectPathologicalRepetition(text);
    assert.equal(result.pathological, false);
  });

  await t('detectPathologicalRepetition: a sentence repeated 3+ times is flagged (repeated_sentence)', () => {
    const sentence = 'AutoIngest never overwrites your original archive files under any condition.';
    const text = `${sentence} ${sentence} Some other content here. ${sentence}`;
    const result = detectPathologicalRepetition(text);
    assert.equal(result.pathological, true);
    assert.ok(result.findings.some((f) => f.type === 'repeated_sentence'));
  });

  await t('detectPathologicalRepetition: a cyclic A-B-A-B block is flagged (cyclic_block)', () => {
    const a = 'The archive root must be selected before import can begin.';
    const b = 'Duplicate files are detected automatically during the copy phase.';
    const text = `${a} ${b} ${a} ${b}`;
    const result = detectPathologicalRepetition(text);
    assert.equal(result.pathological, true);
    assert.ok(result.findings.some((f) => f.type === 'cyclic_block'));
  });

  await t('detectPathologicalRepetition: a runaway repeated word sequence without sentence punctuation is flagged (runaway_ngram)', () => {
    const text = new Array(6).fill('this is a runaway repeated phrase that keeps going').join(' ');
    const result = detectPathologicalRepetition(text);
    assert.equal(result.pathological, true);
    assert.ok(result.findings.some((f) => f.type === 'runaway_ngram'));
  });

  // --- answerValidator.js ---------------------------------------------------

  await t('containProtocolArtifacts: strips a <think> segment entirely', () => {
    const result = containProtocolArtifacts('<think>\nsome internal reasoning\n</think>\n\nThe actual answer.');
    assert.equal(result.text, 'The actual answer.');
    assert.equal(result.stripped, true);
  });

  await t('containProtocolArtifacts: strips ChatML/tool-call control tokens', () => {
    const result = containProtocolArtifacts('<|im_start|>assistant\nHello there.<|im_end|>');
    assert.equal(result.text, 'Hello there.');
    assert.equal(result.stripped, true);
  });

  await t('containProtocolArtifacts: an already-clean answer is untouched and reports stripped:false', () => {
    const result = containProtocolArtifacts('This is a perfectly ordinary answer.');
    assert.equal(result.text, 'This is a perfectly ordinary answer.');
    assert.equal(result.stripped, false);
  });

  await t('validateFinalAnswer: rejects empty/whitespace-only answers', () => {
    assert.equal(validateFinalAnswer({ finalText: '' }).ok, false);
    assert.equal(validateFinalAnswer({ finalText: '   ' }).ok, false);
    assert.equal(validateFinalAnswer({ finalText: '' }).findings[0].code, 'empty-answer');
  });

  await t('validateFinalAnswer: accepts an ordinary, clean natural-language answer with no capability claim', () => {
    const result = validateFinalAnswer({ finalText: 'Files with the same name and size are skipped automatically during import; different sizes are renamed instead of overwritten.' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.findings, []);
  });

  await t('validateFinalAnswer: accepts a capability claim when grounded by a real tool call this conversation', () => {
    const sessionToolLog = [{ tool: 'capability_status', args: { handle: 'H1' }, result: { status: 'AVAILABLE' } }];
    const result = validateFinalAnswer({ finalText: 'AutoIngest supports duplicate detection automatically during import.', sessionToolLog });
    assert.equal(result.ok, true);
  });

  await t('validateFinalAnswer: flags a session-handle leak', () => {
    const leaking = validateFinalAnswer({ finalText: 'See reference H2 for details.' });
    assert.ok(leaking.findings.some((f) => f.code === 'handle-leak'));
  });

  await t('validateFinalAnswer: flags an internal AI-FEAT/DEC/KM id leak', () => {
    const result = validateFinalAnswer({ finalText: 'This is documented in AI-FEAT-058.' });
    assert.ok(result.findings.some((f) => f.code === 'internal-id-leak'));
  });

  await t('validateFinalAnswer: flags a literal tool-name/call-syntax mention', () => {
    const result = validateFinalAnswer({ finalText: 'Let me use search_autoingest() to check that.' });
    assert.ok(result.findings.some((f) => f.code === 'literal-tool-call-leak'));
  });

  await t('validateFinalAnswer: flags pathological repetition via the shared detector', () => {
    const sentence = 'AutoIngest never overwrites your original archive files under any condition.';
    const result = validateFinalAnswer({ finalText: `${sentence} ${sentence} ${sentence}` });
    assert.ok(result.findings.some((f) => f.code === 'structural-repetition-loop'));
  });

  await t('validateFinalAnswer: flags process narration', () => {
    const result = validateFinalAnswer({ finalText: 'Let me check that for you. AutoIngest supports duplicate detection.' });
    assert.ok(result.findings.some((f) => f.code === 'process-narration'));
  });

  await t('validateFinalAnswer: flags an ungrounded capability claim when no grounding tool was ever called', () => {
    const result = validateFinalAnswer({ finalText: 'AutoIngest supports that feature.', toolCalls: [], sessionToolLog: [] });
    assert.ok(result.findings.some((f) => f.code === 'ungrounded-capability-claim'));
  });

  // Stage 4.2 real-model finding (Finding A, cap-platform-1): the model
  // confidently claimed Linux support with ZERO grounding tool ever
  // called, but the answer's phrasing ("runs natively on X", "fully
  // supported platform") evaded the original CAPABILITY_CLAIM_RE, so
  // checkCapabilityGrounding never even ran. See DEC-026's Stage 4.2
  // Postscript.
  await t('validateFinalAnswer: flags an ungrounded capability claim phrased as "runs natively on X" (real Linux-claim regression)', () => {
    const result = validateFinalAnswer({ finalText: "AutoIngest runs natively on Linux. It's designed to work across major operating systems including Windows, macOS, and Linux, with Linux being a fully supported platform for all its core features and workflows.", toolCalls: [], sessionToolLog: [] });
    assert.ok(result.findings.some((f) => f.code === 'ungrounded-capability-claim'), JSON.stringify(result.findings));
  });

  await t('validateFinalAnswer: flags an ungrounded capability claim phrased as "works with/is compatible with X"', () => {
    const result = validateFinalAnswer({ finalText: 'AutoIngest works with any third-party cloud provider out of the box.', toolCalls: [], sessionToolLog: [] });
    assert.ok(result.findings.some((f) => f.code === 'ungrounded-capability-claim'), JSON.stringify(result.findings));
  });

  await t('validateFinalAnswer: does NOT flag a capability claim when a grounding tool was called this conversation', () => {
    const sessionToolLog = [{ tool: 'capability_status', args: { handle: 'H1' }, result: { status: 'AVAILABLE' } }];
    const result = validateFinalAnswer({ finalText: 'AutoIngest supports that feature.', toolCalls: [], sessionToolLog });
    assert.ok(!result.findings.some((f) => f.code === 'ungrounded-capability-claim'));
  });

  // Stage 4.2 real-model finding (Finding B root cause): a bolded
  // bullet-point LABEL using ordinary English (e.g. "**File dates**") is
  // not an identity claim, but used to false-positive as
  // 'ungrounded-identity-claim' whenever it reduced to exactly one
  // distinctive word after generic-term filtering AND that word's exact
  // inflection didn't literally appear in the retrieved text even though
  // its singular/plural counterpart did -- reproduced via the real
  // long-context-0 conversation's "What is QMZ?" turn (see DEC-026's
  // Stage 4.2 Postscript). This is the regression test for that fix.
  await t('validateFinalAnswer: does NOT flag a bolded label whose singular/plural form appears in retrieved evidence (regression for the real QMZ false-positive)', () => {
    const sessionToolLog = [{ tool: 'read_autoingest', args: { handle: 'H17' }, result: { dimensions: { behavior: 'QMZ reads each media file\'s original embedded capture date rather than the file\'s copy date on disk.' } } }];
    const result = validateFinalAnswer({ finalText: '**File dates** are read from the original embedded capture date, not the copy date on disk.', toolCalls: [], sessionToolLog });
    assert.ok(!result.findings.some((f) => f.code === 'ungrounded-identity-claim'), JSON.stringify(result.findings));
  });

  await t('validateFinalAnswer: STILL flags a genuinely fabricated multi-word bolded term with no grounding at all', () => {
    const sessionToolLog = [{ tool: 'read_autoingest', args: { handle: 'H1' }, result: { dimensions: { behavior: 'Files are copied from the source to the destination archive folder.' } } }];
    const result = validateFinalAnswer({ finalText: 'This is handled by the **Quantum Sync Bridge**, an internal AutoIngest subsystem.', toolCalls: [], sessionToolLog });
    assert.ok(result.findings.some((f) => f.code === 'ungrounded-identity-claim'), JSON.stringify(result.findings));
  });

  await t('validateFinalAnswer: flags an answer asserting a relationship the conversation itself found CONTRADICTED', () => {
    const sessionToolLog = [
      { tool: 'search_autoingest', args: {}, result: { results: [{ handle: 'H1', title: 'Archive Locking' }, { handle: 'H2', title: 'Online Registry' }] } },
      { tool: 'check_relationship', args: { subjectHandle: 'H1', objectHandle: 'H2' }, result: { status: 'CONTRADICTED' } },
    ];
    const result = validateFinalAnswer({ finalText: 'Archive Locking and Online Registry work together closely.', toolCalls: [], sessionToolLog });
    assert.ok(result.findings.some((f) => f.code === 'contradicted-relationship-assertion'));
  });

  // --- toolDefinitions.js ---------------------------------------------------

  await t('buildToolDefinitions: exactly the five Stage-2 operations, no duplicates', () => {
    const fakeOps = { search_autoingest: () => {}, read_autoingest: () => {}, capability_status: () => {}, roadmap_status: () => {}, check_relationship: () => {} };
    const defs = buildToolDefinitions(fakeOps);
    assert.deepEqual(Object.keys(defs).sort(), ['capability_status', 'check_relationship', 'read_autoingest', 'roadmap_status', 'search_autoingest']);
  });

  await t('buildToolDefinitions: every def has a real description, valid params, and a handlerImpl function', () => {
    const fakeOps = { search_autoingest: () => {}, read_autoingest: () => {}, capability_status: () => {}, roadmap_status: () => {}, check_relationship: () => {} };
    const defs = buildToolDefinitions(fakeOps);
    for (const [name, def] of Object.entries(defs)) {
      assert.ok(def.description && def.description.length > 10, `${name} needs a real description`);
      assert.equal(def.params.type, 'object');
      assert.equal(typeof def.handlerImpl, 'function');
    }
  });

  await t('buildToolDefinitions: descriptions never mention repository paths or canonical id shapes', () => {
    const fakeOps = { search_autoingest: () => {}, read_autoingest: () => {}, capability_status: () => {}, roadmap_status: () => {}, check_relationship: () => {} };
    const defs = buildToolDefinitions(fakeOps);
    const idLeakRe = /AI-FEAT-\d|AI-WF-\d|KM-\w|DEC-\d|BUG-\d|\.js\b|\.md\b|scripts\/product-docs/;
    for (const [name, def] of Object.entries(defs)) {
      assert.ok(!idLeakRe.test(def.description), `${name}'s description leaks an internal reference shape`);
    }
  });

  await t('buildToolDefinitions: handlerImpl dispatches to the correct real operation with correctly-shaped arguments', async () => {
    const calls = [];
    const fakeOps = {
      search_autoingest: (q) => { calls.push(['search_autoingest', q]); return { results: [] }; },
      read_autoingest: (h, d) => { calls.push(['read_autoingest', h, d]); return {}; },
      capability_status: (h) => { calls.push(['capability_status', h]); return {}; },
      roadmap_status: (h) => { calls.push(['roadmap_status', h]); return {}; },
      check_relationship: (s, o) => { calls.push(['check_relationship', s, o]); return {}; },
    };
    const defs = buildToolDefinitions(fakeOps);
    await defs.search_autoingest.handlerImpl({ query: 'archive locking' });
    await defs.read_autoingest.handlerImpl({ handle: 'H1', dimensions: ['purpose'] });
    await defs.capability_status.handlerImpl({ handle: 'H1' });
    await defs.roadmap_status.handlerImpl({ handle: 'H1' });
    await defs.check_relationship.handlerImpl({ subjectHandle: 'H1', objectHandle: 'H2' });
    assert.deepEqual(calls, [
      ['search_autoingest', 'archive locking'],
      ['read_autoingest', 'H1', ['purpose']],
      ['capability_status', 'H1'],
      ['roadmap_status', 'H1'],
      ['check_relationship', 'H1', 'H2'],
    ]);
  });

  // --- systemPrompt.js ---------------------------------------------------

  await t('SYSTEM_PROMPT: no benchmark-specific content (a specific test question or answer) baked in', () => {
    assert.equal(typeof SYSTEM_PROMPT, 'string');
    assert.ok(SYSTEM_PROMPT.length > 100);
    // Structural sanity: mentions the five real tool names (guidance to
    // the model about when to use them) but never a raw AI-FEAT/DEC/KM id.
    const { INTERNAL_ID_LEAK_RE } = require('../scripts/product-docs/lib/askKnowledge/leakBoundary');
    assert.ok(!INTERNAL_ID_LEAK_RE.test(SYSTEM_PROMPT));
  });

  // --- errors.js -----------------------------------------------------

  await t('ORCHESTRATOR_ERROR_CODE: includes every Stage-3 runtime code plus orchestrator-only codes', () => {
    const { ERROR_CODE: RUNTIME_ERROR_CODE } = require('../services/qwenRuntime/errors');
    for (const code of Object.keys(RUNTIME_ERROR_CODE)) {
      assert.equal(ORCHESTRATOR_ERROR_CODE[code], RUNTIME_ERROR_CODE[code]);
    }
    assert.ok(ORCHESTRATOR_ERROR_CODE.SESSION_BUSY);
    assert.ok(ORCHESTRATOR_ERROR_CODE.ACTION_LIMIT_REACHED);
  });

  await t('OrchestratorError: unknown code names fall back to UNKNOWN', () => {
    const err = new OrchestratorError('NOT_A_REAL_CODE', 'test');
    assert.equal(err.code, 'UNKNOWN');
  });

  await t('mapUnknownError: a QwenRuntimeError is wrapped, preserving its code', () => {
    const { QwenRuntimeError } = require('../services/qwenRuntime/errors');
    const wrapped = mapUnknownError(new QwenRuntimeError('INFERENCE_CANCELLED', 'x'));
    assert.equal(wrapped.code, 'INFERENCE_CANCELLED');
    assert.ok(wrapped instanceof OrchestratorError);
  });

  console.log(`qwenOrchestratorPureModules: ${passed} passed`);
}

main();
