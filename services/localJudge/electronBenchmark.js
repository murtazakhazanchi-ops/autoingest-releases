'use strict';

// services/localJudge/electronBenchmark.js — Phase C2, Part T. Runs the
// FROZEN 56-case gold set (scripts/product-docs/bench/entailmentGoldDataset.mjs,
// unmodified, unweakened) through the REAL production stack:
//   answerQuestion() [deterministic engine, unmodified]
//     -> applyCapabilityAuthority() [lib/capabilityAuthority.js, unmodified,
//        the actual C1 production decorator -- not a reimplementation]
//     -> createJudgeAdapter()'s judge() [services/localJudge/judgeAdapter.js]
//     -> runtime.infer() [services/localJudge/runtime.js, real utilityProcess]
//     -> runtimeWorker.js [real node-llama-cpp, real Phi-4-mini-instruct
//        GGUF, real Metal inference]
//
// This deliberately does NOT reuse bench/runEntailmentBenchmark.mjs or
// bench/modelRunner.js -- those exercise bench-only inference code, not the
// production runtime this checkpoint built. Every other piece (deterministic
// engine, evidence-package construction, authority resolution, the gold
// dataset itself) is the same real, unmodified production/investigation
// code already used and frozen in earlier checkpoints.
//
// Never wired into answerQuestion() callers, the CLI, or the portal --
// this is a standalone investigation/acceptance-bar harness, run only via:
//   node_modules/.bin/electron services/localJudge/electronBenchmark.js

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const runtime = require('./runtime');
const { createJudgeAdapter } = require('./judgeAdapter');

const PRODUCT_DOCS = path.join(__dirname, '..', '..', 'scripts', 'product-docs');
const { assemble } = require(path.join(PRODUCT_DOCS, 'lib', 'build.js'));
const { buildEngineContext, answerQuestion } = require(path.join(PRODUCT_DOCS, 'lib', 'knowledgeEngine.js'));
const { applyCapabilityAuthority } = require(path.join(PRODUCT_DOCS, 'lib', 'capabilityAuthority.js'));

const MODEL_PATH = process.argv[2] || path.join(PRODUCT_DOCS, 'bench', 'models', 'phi-4-mini-instruct-Q4_K_M.gguf');
// Generous, benchmark-only ceiling (measured warm p95 was 3309ms, slowest
// 3464ms in Part L/M's electronMeasure.js run) -- large enough that no
// case in this accuracy run should ever spuriously time out; NOT itself
// the production timeout recommendation (that is derived separately from
// the Part L measurements and reported in the final C2 report).
const BENCHMARK_TIMEOUT_MS = 30000;

function toGoldSpace(capabilityStatus) {
  if (capabilityStatus === 'AVAILABLE' || capabilityStatus === 'PARTIALLY_AVAILABLE') return 'SUPPORTS';
  if (capabilityStatus === 'NOT_SUPPORTED') return 'CONTRADICTS';
  return 'INSUFFICIENT_EVIDENCE';
}

function precisionRecall(results, label) {
  const tp = results.filter((r) => r.gold === label && r.finalGoldSpace === label).length;
  const fp = results.filter((r) => r.gold !== label && r.finalGoldSpace === label).length;
  const fn = results.filter((r) => r.gold === label && r.finalGoldSpace !== label).length;
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  return { label, tp, fp, fn, precision, recall };
}

async function main() {
  const goldUrl = pathToFileURL(path.join(PRODUCT_DOCS, 'bench', 'entailmentGoldDataset.mjs')).href;
  const { GOLD, AMBIGUOUS } = await import(goldUrl);

  const { built } = assemble();
  const ctx = buildEngineContext(built);

  console.log(`[bench] loading model: ${MODEL_PATH}`);
  const tLoadStart = Date.now();
  const loadResult = await runtime.ensureLoaded(MODEL_PATH);
  console.log(`[bench] loaded in ${(Date.now() - tLoadStart)}ms (reported ${loadResult.loadMs.toFixed(0)}ms), gpu=${loadResult.gpu}`);

  const judge = createJudgeAdapter({ modelPath: MODEL_PATH, timeoutMs: BENCHMARK_TIMEOUT_MS });

  let judgeCallCount = 0;
  let judgeErrorCount = 0;
  const countingJudge = async (pkg, handleMap) => {
    judgeCallCount++;
    try {
      return await judge(pkg, handleMap);
    } catch (err) {
      judgeErrorCount++;
      throw err;
    }
  };

  const results = [];
  for (const g of GOLD) {
    const answer = answerQuestion(g.question, ctx);
    const t0 = Date.now();
    const result = await applyCapabilityAuthority(g.question, answer, ctx, countingJudge);
    const totalMs = Date.now() - t0;
    const finalGoldSpace = toGoldSpace(result.capabilityStatus);
    const correct = finalGoldSpace === g.gold;
    const authoritySource = result.authority ? result.authority.authoritySource : null;
    const authorityRan = result.authority ? result.authority.ran : false;
    console.log(`[bench] ${g.id}: gold=${g.gold} final=${finalGoldSpace} (${authoritySource}, ran=${authorityRan}, ${totalMs}ms) ${correct ? 'OK' : '*** MISMATCH ***'}`);
    results.push({ ...g, finalGoldSpace, correct, authoritySource, authorityRan, totalMs, evidenceHandles: result.authority ? result.authority.evidenceHandles : [] });
  }

  await runtime.unload();
  runtime.terminate();

  const falseSupports = results.filter((r) => r.gold !== 'SUPPORTS' && r.finalGoldSpace === 'SUPPORTS');
  const falseDeclines = results.filter((r) => r.gold === 'SUPPORTS' && r.finalGoldSpace !== 'SUPPORTS');
  const judgeInvokedCases = results.filter((r) => r.authorityRan);
  const schemaConformCount = judgeInvokedCases.filter((r) => r.authoritySource !== 'model-failure-fallback' && r.authoritySource !== 'invalid-handle-fallback' && r.authoritySource !== 'unrecognized-judgment-fallback').length;
  const invalidHandleCases = judgeInvokedCases.filter((r) => r.authoritySource === 'invalid-handle-fallback');
  const judgeErrorCases = judgeInvokedCases.filter((r) => r.authoritySource === 'model-failure-fallback');

  const perLabel = ['SUPPORTS', 'CONTRADICTS', 'INSUFFICIENT_EVIDENCE'].map((l) => precisionRecall(results, l));

  const summary = {
    modelPath: MODEL_PATH,
    gpu: loadResult.gpu,
    loadMs: loadResult.loadMs,
    goldCount: GOLD.length,
    ambiguousExcluded: AMBIGUOUS.length,
    judgeCallCount,
    judgeErrorCount,
    correctCount: results.filter((r) => r.correct).length,
    accuracy: results.filter((r) => r.correct).length / results.length,
    falseSupportsCount: falseSupports.length,
    falseSupportsCases: falseSupports.map((r) => ({ id: r.id, question: r.question, gold: r.gold, authoritySource: r.authoritySource })),
    falseDeclinesCount: falseDeclines.length,
    falseDeclinesCases: falseDeclines.map((r) => ({ id: r.id, question: r.question, authoritySource: r.authoritySource })),
    perLabel,
    schemaConformCount,
    schemaConformDenominator: judgeInvokedCases.length,
    invalidHandleCount: invalidHandleCases.length,
    invalidHandleCases: invalidHandleCases.map((r) => ({ id: r.id, question: r.question })),
    judgeErrorFallbackCount: judgeErrorCases.length,
    avgTotalMsAllCases: results.reduce((s, r) => s + r.totalMs, 0) / results.length,
    avgTotalMsJudgeInvokedOnly: judgeInvokedCases.length ? judgeInvokedCases.reduce((s, r) => s + r.totalMs, 0) / judgeInvokedCases.length : null,
    results,
  };

  const outPath = path.join(PRODUCT_DOCS, 'bench', 'results', 'phase-c2-production-runtime-full56.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));

  console.log('\n[bench] FULL REPORT JSON:');
  console.log(JSON.stringify({ ...summary, results: undefined }, null, 2));
  console.log(`\n[bench] accuracy: ${(summary.accuracy * 100).toFixed(1)}% (${summary.correctCount}/${GOLD.length}) | FALSE SUPPORTS: ${summary.falseSupportsCount} | false declines: ${summary.falseDeclinesCount} | judge calls: ${judgeCallCount} | schema-conform: ${schemaConformCount}/${judgeInvokedCases.length} | wrote ${outPath}`);

  app.exit(summary.falseSupportsCount > 0 ? 1 : 0);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('[bench] FATAL:', err);
    app.exit(1);
  });
});
