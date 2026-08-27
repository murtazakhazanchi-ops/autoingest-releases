'use strict';

// services/localJudge/electronBenchmarkC3.js — Phase C3, Part T. The
// strongest benchmark in this investigation: runs the frozen 56-case gold
// set through the COMPLETE, REAL, production C3 answering path --
//
//   question
//     -> answerQuestion()                          [unmodified, C0/A]
//     -> answerQuestionWithAuthority()              [C3 outer API]
//     -> applyCapabilityAuthority()                 [unmodified, C1]
//     -> judgeService.productionJudge()             [C3 construction path]
//     -> judgeAdapter.js's judge()                  [unmodified, C2]
//     -> runtime.js's infer() (real utilityProcess)  [unmodified, C2]
//     -> runtimeWorker.js (real node-llama-cpp)      [unmodified, C2]
//     -> real Phi-4-mini-instruct GGUF, real Metal inference
//
// Unlike C2's electronBenchmark.js (which called runtime.ensureLoaded()
// directly with an explicit model path, bypassing modelManager's
// availability gate entirely), this harness goes through the REAL
// judgeService.js construction path unmodified -- including the
// modelManager.getStatus() READY check -- by pointing Electron's own
// userData directory (via the standard, supported app.setPath() API, not
// a test-only override hook; judgeService.js exposes none, deliberately,
// per Part E) at a fixture directory containing a symlink to the
// already-benchmarked bench/ GGUF, verified once via the real
// modelManager.verify() so getStatus() genuinely reports READY.
//
// Run with:
//   node_modules/.bin/electron services/localJudge/electronBenchmarkC3.js

const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

const FIXTURE_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-c3-bench-userdata-'));

const { app } = require('electron');
app.setPath('userData', FIXTURE_USER_DATA);

const modelManager = require('./modelManager');
const runtime = require('./runtime');

const PRODUCT_DOCS = path.join(__dirname, '..', '..', 'scripts', 'product-docs');
const REAL_MODEL_PATH = path.join(PRODUCT_DOCS, 'bench', 'models', 'phi-4-mini-instruct-Q4_K_M.gguf');

async function main() {
  if (!fs.existsSync(REAL_MODEL_PATH)) {
    console.error(`[bench-c3] real model not found at ${REAL_MODEL_PATH} -- cannot run the real-model acceptance bar. Skipping.`);
    process.exit(1);
  }

  // Set up the fixture "userData" model directory exactly as
  // modelManager's own resolveModelDir()/resolvePaths() expect, using a
  // symlink so the multi-GB artifact is never copied.
  const { finalPath } = modelManager.resolvePaths(path.join(FIXTURE_USER_DATA, 'local-judge-models'));
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  fs.symlinkSync(REAL_MODEL_PATH, finalPath);
  console.log('[bench-c3] verifying the symlinked model against the real pinned identity (real streaming SHA-256, one-time)...');
  const verifyResult = await modelManager.verify(path.join(FIXTURE_USER_DATA, 'local-judge-models'));
  if (verifyResult.status !== modelManager.STATUS.READY) {
    console.error('[bench-c3] FATAL: verify() did not report READY:', JSON.stringify(verifyResult));
    process.exit(1);
  }
  console.log('[bench-c3] verified READY. Confirming modelManager.getStatus() with NO override (the real production path, via app.setPath) also reports READY...');
  const realStatus = modelManager.getStatus();
  console.log('[bench-c3] modelManager.getStatus() (no override):', JSON.stringify(realStatus));
  if (realStatus.status !== modelManager.STATUS.READY) {
    console.error('[bench-c3] FATAL: the real (non-overridden) production availability check did not report READY -- app.setPath(userData) did not take effect as expected.');
    process.exit(1);
  }

  const { answerQuestionWithAuthority } = require(path.join(PRODUCT_DOCS, 'lib', 'answerWithAuthority.js'));
  const { answerQuestion } = require(path.join(PRODUCT_DOCS, 'lib', 'knowledgeEngine.js'));
  const { assemble } = require(path.join(PRODUCT_DOCS, 'lib', 'build.js'));
  const { buildEngineContext } = require(path.join(PRODUCT_DOCS, 'lib', 'knowledgeEngine.js'));
  const { shouldApplyCapabilityAuthority } = require(path.join(PRODUCT_DOCS, 'lib', 'capabilityAuthority.js'));

  const goldUrl = pathToFileURL(path.join(PRODUCT_DOCS, 'bench', 'entailmentGoldDataset.mjs')).href;
  const { GOLD, AMBIGUOUS } = await import(goldUrl);

  const { built } = assemble();
  const ctx = buildEngineContext(built);

  function toGoldSpace(capabilityStatus) {
    if (capabilityStatus === 'AVAILABLE' || capabilityStatus === 'PARTIALLY_AVAILABLE') return 'SUPPORTS';
    if (capabilityStatus === 'NOT_SUPPORTED') return 'CONTRADICTS';
    return 'INSUFFICIENT_EVIDENCE';
  }
  function precisionRecall(results, label) {
    const tp = results.filter((r) => r.gold === label && r.finalGoldSpace === label).length;
    const fp = results.filter((r) => r.gold !== label && r.finalGoldSpace === label).length;
    const fn = results.filter((r) => r.gold === label && r.finalGoldSpace !== label).length;
    return { label, tp, fp, fn, precision: tp + fp > 0 ? tp / (tp + fp) : null, recall: tp + fn > 0 ? tp / (tp + fn) : null };
  }

  const results = [];
  let inScopeCount = 0;
  for (const g of GOLD) {
    const det = answerQuestion(g.question, ctx);
    const willEnterScope = shouldApplyCapabilityAuthority(det);
    if (willEnterScope) inScopeCount++;
    const t0 = Date.now();
    // NO judge/getModelAvailability override -- the real, default,
    // production wiring: judgeService.productionJudge, real availability
    // check, real runtime, real model.
    const result = await answerQuestionWithAuthority(g.question, ctx);
    const totalMs = Date.now() - t0;
    const finalGoldSpace = toGoldSpace(result.capabilityStatus);
    const correct = finalGoldSpace === g.gold;
    console.log(`[bench-c3] ${g.id}: gold=${g.gold} final=${finalGoldSpace} (${result.authority.authoritySource}, ran=${result.authority.ran}, ${totalMs}ms) ${correct ? 'OK' : '*** MISMATCH ***'}`);
    results.push({ ...g, finalGoldSpace, correct, authoritySource: result.authority.authoritySource, authorityRan: result.authority.ran, modelState: result.authority.modelState, totalMs });
  }

  await runtime.unload();
  runtime.terminate();
  fs.rmSync(finalPath, { force: true }); // remove the symlink only, never the real bench/ file
  fs.rmSync(FIXTURE_USER_DATA, { recursive: true, force: true });

  const falseSupports = results.filter((r) => r.gold !== 'SUPPORTS' && r.finalGoldSpace === 'SUPPORTS');
  const falseDeclines = results.filter((r) => r.gold === 'SUPPORTS' && r.finalGoldSpace !== 'SUPPORTS');
  const judgeInvokedCases = results.filter((r) => r.authorityRan);
  const schemaConformCount = judgeInvokedCases.filter((r) => r.authoritySource !== 'model-failure-fallback' && r.authoritySource !== 'invalid-handle-fallback' && r.authoritySource !== 'unrecognized-judgment-fallback').length;
  const perLabel = ['SUPPORTS', 'CONTRADICTS', 'INSUFFICIENT_EVIDENCE'].map((l) => precisionRecall(results, l));

  const summary = {
    goldCount: GOLD.length,
    ambiguousExcluded: AMBIGUOUS.length,
    inScopeCount,
    bypassedCount: GOLD.length - inScopeCount,
    judgeInvokedCount: judgeInvokedCases.length,
    correctCount: results.filter((r) => r.correct).length,
    accuracy: results.filter((r) => r.correct).length / results.length,
    falseSupportsCount: falseSupports.length,
    falseSupportsCases: falseSupports.map((r) => ({ id: r.id, question: r.question, gold: r.gold })),
    falseDeclinesCount: falseDeclines.length,
    falseDeclinesCases: falseDeclines.map((r) => ({ id: r.id, question: r.question })),
    perLabel,
    schemaConformCount,
    schemaConformDenominator: judgeInvokedCases.length,
    avgTotalMsAllCases: results.reduce((s, r) => s + r.totalMs, 0) / results.length,
    avgTotalMsJudgeInvokedOnly: judgeInvokedCases.length ? judgeInvokedCases.reduce((s, r) => s + r.totalMs, 0) / judgeInvokedCases.length : null,
    results,
  };

  const outPath = path.join(PRODUCT_DOCS, 'bench', 'results', 'phase-c3-full-outer-api-full56.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));

  console.log('\n[bench-c3] FULL REPORT JSON:');
  console.log(JSON.stringify({ ...summary, results: undefined }, null, 2));
  console.log(`\n[bench-c3] accuracy: ${(summary.accuracy * 100).toFixed(1)}% (${summary.correctCount}/${GOLD.length}) | FALSE SUPPORTS: ${summary.falseSupportsCount} | in-scope: ${inScopeCount}/${GOLD.length} | judge invoked: ${judgeInvokedCases.length} | schema-conform: ${schemaConformCount}/${judgeInvokedCases.length} | wrote ${outPath}`);

  app.exit(summary.falseSupportsCount > 0 ? 1 : 0);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('[bench-c3] FATAL:', err);
    app.exit(1);
  });
});
