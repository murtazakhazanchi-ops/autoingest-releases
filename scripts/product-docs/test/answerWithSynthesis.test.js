#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/answerWithSynthesis.test.js
// Phase C5. Proves the NEW production outer entrypoint
// (lib/answerWithSynthesis.js) end to end -- eligibility, evidence-package
// selection, merge, and every fallback path -- WITHOUT loading any local
// model. The judge is always the READY-but-never-called NEVER_CALL fake
// (every question below either bypasses authority entirely or is fed
// through options.judge explicitly); synthesis is exercised via
// options.synthesize fakes covering success, refusal, and every documented
// failure mode. Real-model acceptance is a separate, non-CI benchmark (see
// this checkpoint's report).

const assert = require('node:assert/strict');
const { createRunner } = require('./testHarness');
const build = require('../lib/build');
const { buildEngineContext, answerQuestion, answerForKnownRecord } = require('../lib/knowledgeEngine');
const {
  answerQuestionWithSynthesis,
  answerKnownRecordWithSynthesis,
  mergeSynthesizedAnswer,
} = require('../lib/answerWithSynthesis');

const NEVER_CALL = async () => { throw new Error('must not be called'); };
const READY = () => ({ status: 'READY', detail: {} });

function fakeSynthesizeEchoing(overrides = {}) {
  return async (pkg) => ({
    answer: `SYNTHESIZED: ${pkg.directAnswer || ''}`,
    capabilityStatus: pkg.capabilityStatus,
    sourceIds: pkg.primary ? [pkg.primary.id] : [],
    steps: (pkg.steps || []).map((s) => ({ text: `SYNTH STEP: ${s.text}`, sourceIds: [s.sourceId] })),
    warnings: [],
    refused: false,
    ...overrides,
  });
}

async function main() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  // ---------------------------------------------------------------------
  // Eligible path: applies synthesis, capabilityStatus never changes.
  // ---------------------------------------------------------------------
  await t('eligible HOW_TO question: synthesis applied, capabilityStatus unchanged, directAnswer replaced', async () => {
    const question = 'How do I create a new event?';
    const det = answerQuestion(question, ctx);
    const result = await answerQuestionWithSynthesis(question, ctx, {
      judge: NEVER_CALL,
      getModelAvailability: READY,
      synthesize: fakeSynthesizeEchoing(),
    });
    assert.equal(result.synthesis.applied, true);
    assert.equal(result.capabilityStatus, det.capabilityStatus);
    assert.notEqual(result.directAnswer, det.directAnswer);
    assert.match(result.directAnswer, /^SYNTHESIZED:/);
  });

  // ---------------------------------------------------------------------
  // Ineligible: deterministic UNKNOWN -- synthesizer must never be called.
  // ---------------------------------------------------------------------
  await t('ineligible (deterministic UNKNOWN): synthesizer never called, answer unchanged', async () => {
    const question = 'xyzzy plugh unrelated made up capability qqqqq';
    const det = answerQuestion(question, ctx);
    assert.equal(det.capabilityStatus, 'UNKNOWN');
    const result = await answerQuestionWithSynthesis(question, ctx, {
      judge: NEVER_CALL,
      getModelAvailability: READY,
      synthesize: NEVER_CALL,
    });
    assert.equal(result.synthesis.applied, false);
    assert.equal(result.synthesis.reason, 'deterministic-unknown');
    assert.equal(result.directAnswer, det.directAnswer);
  });

  // ---------------------------------------------------------------------
  // Ineligible: authority downgrade -- a real in-scope CAPABILITY question
  // whose injected judge fails to confirm. Synthesizer must never be called.
  // ---------------------------------------------------------------------
  await t('ineligible (authority downgraded to UNKNOWN): synthesizer never called', async () => {
    // A real, known affirmative Feature-primary CAPABILITY/STATUS question
    // (mirrors capabilityAuthority.test.js's own fixture discovery
    // discipline) -- found by scanning for one that actually enters
    // authority scope, rather than hardcoding a question that might drift.
    const { shouldApplyCapabilityAuthority } = require('../lib/capabilityAuthority');
    const candidates = [
      'Does AutoIngest support duplicate detection?',
      'Is grouping available in AutoIngest?',
      'Can AutoIngest detect duplicate files?',
    ];
    const question = candidates.find((q) => shouldApplyCapabilityAuthority(answerQuestion(q, ctx)));
    assert.ok(question, 'test fixture assumption failed: no candidate question enters authority scope -- update the candidate list');
    const failingJudge = async () => ({ judgment: 'INSUFFICIENT_EVIDENCE', evidenceHandles: [], confidence: 'LOW' });
    const result = await answerQuestionWithSynthesis(question, ctx, {
      judge: failingJudge,
      getModelAvailability: READY,
      synthesize: NEVER_CALL,
    });
    assert.equal(result.capabilityStatus, 'UNKNOWN');
    assert.equal(result.synthesis.applied, false);
    assert.equal(result.synthesis.reason, 'authority-downgraded-unknown');
  });

  // ---------------------------------------------------------------------
  // Every documented synthesis failure mode falls back to the untouched
  // authority-resolved answer (Section N).
  // ---------------------------------------------------------------------
  const question = 'How do I create a new event?';
  const failureModes = [
    { label: 'model unavailable (throws)', synthesize: async () => { throw Object.assign(new Error('local synthesis model unavailable: model is NOT_DOWNLOADED'), { modelUnavailable: true }); } },
    { label: 'timeout (throws)', synthesize: async () => { throw Object.assign(new Error('local synthesis inference timed out after 45000ms'), { timedOut: true }); } },
    { label: 'malformed JSON (throws from adapter)', synthesize: async () => { throw new Error('synthesis model produced no parseable output'); } },
    { label: 'schema-invalid / fabricated handle (throws from adapter)', synthesize: async () => { throw Object.assign(new Error('synthesis failed safety validation: handlesExist'), { safetyValidationFailure: true }); } },
    { label: 'status mismatch (throws from adapter)', synthesize: async () => { throw Object.assign(new Error('synthesis failed safety validation: capabilityStatusMatches'), { safetyValidationFailure: true }); } },
    { label: 'cancellation (throws)', synthesize: async () => { throw Object.assign(new Error('request cancelled'), { cancelled: true }); } },
  ];
  for (const { label, synthesize } of failureModes) {
    await t(`fallback on synthesis failure: ${label}`, async () => {
      const det = answerQuestion(question, ctx);
      const result = await answerQuestionWithSynthesis(question, ctx, {
        judge: NEVER_CALL,
        getModelAvailability: READY,
        synthesize,
      });
      assert.equal(result.synthesis.applied, false);
      assert.match(result.synthesis.reason, /^synthesis-error:/);
      assert.equal(result.directAnswer, det.directAnswer, 'operator must see the exact deterministic answer, never a blank/error state');
      assert.equal(result.capabilityStatus, det.capabilityStatus);
    });
  }

  // ---------------------------------------------------------------------
  // Model-declined refusal (schema-permitted `refused: true`) is treated
  // as non-applied, not an error -- the deterministic answer still ships.
  // ---------------------------------------------------------------------
  await t('model-declined refusal: treated as not-applied, deterministic answer ships', async () => {
    const det = answerQuestion(question, ctx);
    const result = await answerQuestionWithSynthesis(question, ctx, {
      judge: NEVER_CALL,
      getModelAvailability: READY,
      synthesize: async () => ({ answer: 'irrelevant', capabilityStatus: det.capabilityStatus, sourceIds: [], refused: true }),
    });
    assert.equal(result.synthesis.applied, false);
    assert.equal(result.synthesis.reason, 'model-refused');
    assert.equal(result.directAnswer, det.directAnswer);
  });

  // ---------------------------------------------------------------------
  // mergeSynthesizedAnswer never lets the model's own capabilityStatus
  // field influence the merged answer -- it is never even read.
  // ---------------------------------------------------------------------
  await t('mergeSynthesizedAnswer ignores the candidate\'s own capabilityStatus field entirely', () => {
    const answer = { capabilityStatus: 'AVAILABLE', directAnswer: 'orig' };
    const merged = mergeSynthesizedAnswer(answer, { answer: 'new text', capabilityStatus: 'NOT_SUPPORTED', steps: [], warnings: [], refused: false });
    assert.equal(merged.capabilityStatus, 'AVAILABLE', 'capabilityStatus must remain the answer\'s own, never the synthesized candidate\'s');
    assert.equal(merged.directAnswer, 'new text');
  });

  // ---------------------------------------------------------------------
  // Known-record (Related-topic) path.
  // ---------------------------------------------------------------------
  await t('known-record synthesis: applies to a real record, never calls answerQuestion() (no re-run of retrieval)', async () => {
    const feature = built.knowledgeIndex.find((f) => f.title === 'Grouping System') || built.knowledgeIndex[0];
    const det = answerForKnownRecord(feature.id, ctx);
    const result = await answerKnownRecordWithSynthesis(feature.id, ctx, { synthesize: fakeSynthesizeEchoing() });
    assert.ok(result);
    assert.equal(result.capabilityStatus, det.capabilityStatus);
    if (result.synthesis.applied) {
      assert.match(result.directAnswer, /^SYNTHESIZED:/);
    } else {
      // If the deterministic record itself resolves UNKNOWN/weak (unlikely
      // for a real id/score:1000 match), the eligibility gate is still
      // required to have refused for a real, inspectable reason.
      assert.ok(result.synthesis.reason);
    }
  });

  await t('known-record synthesis: unknown id still returns null (unchanged contract)', async () => {
    const result = await answerKnownRecordWithSynthesis('AI-FEAT-999999', ctx, { synthesize: NEVER_CALL });
    assert.equal(result, null);
  });

  // ---------------------------------------------------------------------
  // Phase C5.1 -- retrieval-confidence end-to-end (checkpoint Sections
  // M/N): the safety gate must refuse synthesis on a wrong primary,
  // through the real production entrypoint, not just the unit-level
  // assessPrimaryFit() check.
  //
  // Phase C6 UPDATE: Q5 and Q13 (lib/query.js's identity-mention tier)
  // no longer reproduce a wrong primary -- "Transfer Export"/"Transfer
  // Import" are now correctly resolved, so these two are re-purposed
  // below as POSITIVE proof the fix took effect end-to-end (retrieval ->
  // synthesis-eligibility, not retrieval in isolation) and that the
  // safety gate correctly steps out of the way once retrieval is right
  // (Section Q: "correct retrieval should reduce how often it fires").
  // The gate's own continued protection (Section Q: "but it should
  // remain as defense-in-depth") is re-proven immediately after using a
  // genuinely still-remaining mismatch case from the same investigation.
  // ---------------------------------------------------------------------
  await t('Q5 end-to-end, POST-C6: "How do I create a Transfer Export?" now resolves the correct primary and reaches synthesis normally', async () => {
    const q5 = 'How do I create a Transfer Export?';
    const det = answerQuestion(q5, ctx);
    assert.equal(det.matchedCapabilities[0].id, 'AI-FEAT-038', 'Phase C6 fix: identity-mention tier now correctly resolves the exact-named record');
    const result = await answerQuestionWithSynthesis(q5, ctx, {
      judge: NEVER_CALL,
      getModelAvailability: READY,
      synthesize: fakeSynthesizeEchoing(),
    });
    assert.equal(result.synthesis.applied, true, 'the retrieval-confidence gate no longer has a wrong primary to block -- synthesis proceeds normally');
  });

  await t('Q13 end-to-end, POST-C6: "Why does Transfer Import exist?" now resolves the correct primary and reaches synthesis normally', async () => {
    const q13 = 'Why does Transfer Import exist?';
    const det = answerQuestion(q13, ctx);
    assert.equal(det.matchedCapabilities[0].id, 'AI-FEAT-039', 'Phase C6 fix: identity-mention tier now correctly resolves the exact-named record');
    const result = await answerQuestionWithSynthesis(q13, ctx, {
      judge: NEVER_CALL,
      getModelAvailability: READY,
      synthesize: fakeSynthesizeEchoing(),
    });
    assert.equal(result.synthesis.applied, true);
  });

  await t('retrieval-confidence gate remains active as defense-in-depth (Section Q): a two-competing-title question is still refused end-to-end', async () => {
    // Phase C6's identity-mention tier can boost BOTH named titles here
    // ("Transfer Export" and "Backup Update Scanning"); only one wins
    // primacy and the other is uncited, so the gate still correctly
    // refuses synthesis -- proves the fix is bounded, not a blanket
    // override of the safety gate.
    const q = 'Is a Transfer Export the same thing as a backup from Backup Update Scanning?';
    const det = answerQuestion(q, ctx);
    assert.equal(det.matchedCapabilities[0].id, 'AI-FEAT-040');
    const result = await answerQuestionWithSynthesis(q, ctx, {
      judge: NEVER_CALL,
      getModelAvailability: READY,
      synthesize: NEVER_CALL,
    });
    assert.equal(result.synthesis.applied, false);
    assert.equal(result.directAnswer, det.directAnswer, 'the wrong deterministic answer still ships unpolished, never LLM-polished into something more convincing');
  });

  await t('a correctly-resolved HOW_TO question with a real confusable competitor still synthesizes end-to-end', async () => {
    const q = 'How do I import photographs from an SD card?';
    const det = answerQuestion(q, ctx);
    assert.equal(det.matchedCapabilities[0].id, 'AI-WF-001');
    const result = await answerQuestionWithSynthesis(q, ctx, {
      judge: NEVER_CALL,
      getModelAvailability: READY,
      synthesize: fakeSynthesizeEchoing(),
    });
    assert.equal(result.synthesis.applied, true);
    assert.equal(result.capabilityStatus, det.capabilityStatus);
  });

  summarize('answerWithSynthesis.test.js');
}

main();
