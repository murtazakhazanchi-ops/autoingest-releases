'use strict';

// services/localJudge/electronSynthesisBenchmark.js — Phase C5, Section U.
// Runs the checkpoint's 13-question acceptance set (plus a handful of
// Related-topic known-record cases) through the COMPLETE, REAL, production
// C5 pipeline:
//
//   question
//     -> answerQuestion()                     [unmodified, C0/A]
//     -> answerQuestionWithAuthority()         [unmodified, C3]
//     -> evaluateSynthesisEligibility()        [new, C5]
//     -> buildEvidencePackageForAuthorityAnswer() [new, C5]
//     -> synthesisService.productionSynthesize()  [new, C5]
//     -> synthesisAdapter.js's synthesize()    [new, C5]
//     -> runtime.js's infer() (real utilityProcess) [unmodified, C2]
//     -> runtimeWorker.js (real node-llama-cpp)     [unmodified, C2]
//     -> real Phi-4-mini-instruct GGUF, real Metal inference
//
// Follows electronBenchmarkC3.js's exact fixture-userData pattern (symlink
// the already-verified bench/ GGUF into a throwaway userData dir, verify it
// once via the real modelManager.verify(), confirm the real, non-overridden
// modelManager.getStatus() reports READY) so this exercises the SAME
// construction path judgeService.js/synthesisService.js use in production,
// not a shortcut.
//
// Run with:
//   node_modules/.bin/electron services/localJudge/electronSynthesisBenchmark.js

const path = require('path');
const fs = require('fs');
const os = require('os');

const FIXTURE_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-c5-synth-bench-userdata-'));

const { app } = require('electron');
app.setPath('userData', FIXTURE_USER_DATA);

const modelManager = require('./modelManager');
const runtime = require('./runtime');

const PRODUCT_DOCS = path.join(__dirname, '..', '..', 'scripts', 'product-docs');
const REAL_MODEL_PATH = path.join(PRODUCT_DOCS, 'bench', 'models', 'phi-4-mini-instruct-Q4_K_M.gguf');

// Checkpoint Section S's exact 13-question acceptance set.
const QUESTIONS = [
  'How do I import photographs from an SD card?',
  'What is QMZ?',
  'How do I sort QMZ photos?',
  'Transfer stopped halfway. What should I do?',
  'How do I create a Transfer Export?',
  'Why was Transfer Export locking kept process-local?',
  'Does AutoIngest support face recognition?',
  'Does AutoIngest support drone footage or GPS?',
  'Does AutoIngest support system status monitoring?',
  'Does AutoIngest support telemetry?',
  "What's coming next?",
  'How does the Online Registry work?',
  'Why does Transfer Import exist?',
];

// Checkpoint Section S's Related-topic navigation set -- resolved to real
// record ids by title match against the real, assembled indexes (never
// hardcoded ids that could drift).
const RELATED_TITLES = ['Source Selection', 'Source Detection', 'Grouping System', 'Transfer Export'];

async function main() {
  if (!fs.existsSync(REAL_MODEL_PATH)) {
    console.error(`[c5-synth-bench] real model not found at ${REAL_MODEL_PATH} -- cannot run the real-model acceptance bar. Skipping.`);
    process.exit(1);
  }

  const { finalPath } = modelManager.resolvePaths(path.join(FIXTURE_USER_DATA, 'local-judge-models'));
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  fs.symlinkSync(REAL_MODEL_PATH, finalPath);
  console.log('[c5-synth-bench] verifying the symlinked model against the real pinned identity...');
  const verifyResult = await modelManager.verify(path.join(FIXTURE_USER_DATA, 'local-judge-models'));
  if (verifyResult.status !== modelManager.STATUS.READY) {
    console.error('[c5-synth-bench] FATAL: verify() did not report READY:', JSON.stringify(verifyResult));
    process.exit(1);
  }
  const realStatus = modelManager.getStatus();
  console.log('[c5-synth-bench] modelManager.getStatus() (no override, real production path):', JSON.stringify(realStatus));
  if (realStatus.status !== modelManager.STATUS.READY) {
    console.error('[c5-synth-bench] FATAL: real (non-overridden) availability check did not report READY.');
    process.exit(1);
  }

  const { answerQuestionWithAuthority } = require(path.join(PRODUCT_DOCS, 'lib', 'answerWithAuthority.js'));
  const { answerQuestionWithSynthesis, answerKnownRecordWithSynthesis } = require(path.join(PRODUCT_DOCS, 'lib', 'answerWithSynthesis.js'));
  const { answerQuestion } = require(path.join(PRODUCT_DOCS, 'lib', 'knowledgeEngine.js'));
  const { assemble } = require(path.join(PRODUCT_DOCS, 'lib', 'build.js'));
  const { buildEngineContext } = require(path.join(PRODUCT_DOCS, 'lib', 'knowledgeEngine.js'));

  const { built } = assemble();

  const results = [];
  for (const question of QUESTIONS) {
    // Fresh ctx per question, matching production's freshCtx() convention
    // (main/askAutoIngest.js) exactly -- never shared/cached across
    // requests here either.
    const ctxBefore = buildEngineContext(built);
    const t0 = Date.now();
    const before = await answerQuestionWithAuthority(question, ctxBefore);
    const beforeMs = Date.now() - t0;

    const ctxAfter = buildEngineContext(built);
    const t1 = Date.now();
    const after = await answerQuestionWithSynthesis(question, ctxAfter);
    const afterMs = Date.now() - t1;

    console.log(`\n[c5-synth-bench] Q: "${question}"`);
    console.log(`  BEFORE (${beforeMs}ms) status=${before.capabilityStatus} authorityRan=${before.authority.ran}`);
    console.log(`  BEFORE directAnswer: ${before.directAnswer}`);
    console.log(`  AFTER  (${afterMs}ms) status=${after.capabilityStatus} synthesisApplied=${after.synthesis.applied} reason=${after.synthesis.reason || '-'}`);
    console.log(`  AFTER  directAnswer: ${after.directAnswer}`);

    results.push({
      question,
      beforeMs,
      afterMs,
      beforeStatus: before.capabilityStatus,
      afterStatus: after.capabilityStatus,
      authorityRan: before.authority.ran,
      authoritySource: before.authority.authoritySource,
      synthesisApplied: after.synthesis.applied,
      synthesisReason: after.synthesis.reason,
      beforeDirectAnswer: before.directAnswer,
      afterDirectAnswer: after.directAnswer,
      afterSteps: after.steps,
      afterLimitations: after.limitations,
      statusUnchanged: before.capabilityStatus === after.capabilityStatus,
    });
  }

  const relatedResults = [];
  for (const title of RELATED_TITLES) {
    const ctx = buildEngineContext(built);
    // Prefix match: several real titles carry a parenthetical qualifier
    // (e.g. "Source Selection (Local Folder / External Drive)") not present
    // in checkpoint Section S's short-form title -- exact match alone
    // silently found nothing for 2 of 4 titles in this checkpoint's first
    // real-model run.
    const feature = built.knowledgeIndex.find((f) => f.title === title || f.title.startsWith(`${title} (`));
    const workflow = !feature ? built.workflowIndex.find((w) => w.title === title || w.title.startsWith(`${title} (`)) : null;
    const record = feature || workflow;
    if (!record) {
      relatedResults.push({ title, error: 'record not found in real index' });
      continue;
    }
    const t0 = Date.now();
    const result = await answerKnownRecordWithSynthesis(record.id, ctx);
    const ms = Date.now() - t0;
    console.log(`\n[c5-synth-bench] RELATED: "${title}" (${record.id}, ${ms}ms) synthesisApplied=${result.synthesis.applied} reason=${result.synthesis.reason || '-'}`);
    console.log(`  directAnswer: ${result.directAnswer}`);
    relatedResults.push({
      title, recordId: record.id, ms,
      status: result.capabilityStatus,
      synthesisApplied: result.synthesis.applied,
      synthesisReason: result.synthesis.reason,
      directAnswer: result.directAnswer,
    });
  }

  await runtime.unload();
  runtime.terminate();
  fs.rmSync(finalPath, { force: true }); // remove the symlink only, never the real bench/ file
  fs.rmSync(FIXTURE_USER_DATA, { recursive: true, force: true });

  const appliedMs = results.filter((r) => r.synthesisApplied).map((r) => r.afterMs);
  const relatedAppliedMs = relatedResults.filter((r) => r.synthesisApplied).map((r) => r.ms);
  const allAppliedMs = [...appliedMs, ...relatedAppliedMs];
  const statusChanged = results.filter((r) => !r.statusUnchanged);

  const summary = {
    questionCount: QUESTIONS.length,
    synthesisAppliedCount: results.filter((r) => r.synthesisApplied).length,
    synthesisRefusedCount: results.filter((r) => !r.synthesisApplied).length,
    refusalReasons: results.filter((r) => !r.synthesisApplied).map((r) => ({ question: r.question, reason: r.synthesisReason })),
    statusChangedCount: statusChanged.length,
    statusChangedCases: statusChanged.map((r) => ({ question: r.question, before: r.beforeStatus, after: r.afterStatus })),
    latency: {
      avgBeforeMs: results.reduce((s, r) => s + r.beforeMs, 0) / results.length,
      avgAfterMsAllCases: results.reduce((s, r) => s + r.afterMs, 0) / results.length,
      avgSynthesisAppliedMs: allAppliedMs.length ? allAppliedMs.reduce((a, b) => a + b, 0) / allAppliedMs.length : null,
      maxSynthesisAppliedMs: allAppliedMs.length ? Math.max(...allAppliedMs) : null,
      minSynthesisAppliedMs: allAppliedMs.length ? Math.min(...allAppliedMs) : null,
    },
    results,
    relatedResults,
  };

  const outPath = path.join(PRODUCT_DOCS, 'bench', 'results', 'phase-c5-synthesis-13q-real-model.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));

  console.log('\n[c5-synth-bench] SUMMARY:');
  console.log(JSON.stringify({ ...summary, results: undefined, relatedResults: undefined }, null, 2));
  console.log(`\n[c5-synth-bench] status-changed count (must be 0): ${statusChanged.length} | applied: ${summary.synthesisAppliedCount}/${QUESTIONS.length} | wrote ${outPath}`);

  app.exit(statusChanged.length > 0 ? 1 : 0);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('[c5-synth-bench] FATAL:', err);
    app.exit(1);
  });
});
