// Ask AutoIngest — Capability Entailment Judge Prototype benchmark runner.
// Real local model inference, real deterministic engine, real gold dataset,
// frozen before this ran. Never wired into answerQuestion()/portal/CLI --
// pure investigation harness, exactly like Phase A/A.2's own bench/.
//
// Usage: node runEntailmentBenchmark.mjs <model-label> <path-to-gguf> [evidenceLevel]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModel, unloadModel, generateStructured, memoryUsageMB } from './modelRunner.js';
import { GOLD, AMBIGUOUS } from './entailmentGoldDataset.mjs';

const buildMod = await import('../lib/build.js');
const engineMod = await import('../lib/knowledgeEngine.js');
const claimMod = await import('../lib/askSynthesis/claimNormalization.js');
const entEvidenceMod = await import('../lib/askSynthesis/entailmentEvidencePackage.js');
const entSchemaMod = await import('../lib/askSynthesis/entailmentSchema.js');
const entPromptMod = await import('../lib/askSynthesis/entailmentPrompt.js');
const entAuthMod = await import('../lib/askSynthesis/entailmentAuthority.js');

const { assemble } = buildMod;
const { buildEngineContext, answerQuestion } = engineMod;
const { normalizeClaim } = claimMod;
const { buildEntailmentEvidencePackage } = entEvidenceMod;
const { buildEntailmentSchema } = entSchemaMod;
const { buildEntailmentPrompt } = entPromptMod;
const { resolveEntailmentAuthority } = entAuthMod;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function judgeOne(handle, question, ctx, level, repeatPenalty) {
  const { claim, method } = normalizeClaim(question);
  const answer = answerQuestion(question, ctx);
  const { pkg, handleMap } = buildEntailmentEvidencePackage(question, claim, answer, ctx, { level });
  const schema = buildEntailmentSchema(handleMap);
  const { system, user } = buildEntailmentPrompt(pkg, handleMap);

  let synthesis = null;
  let synthesisError = null;
  try {
    synthesis = await generateStructured(handle, system, user, schema, { maxTokens: 200, repeatPenalty });
  } catch (err) {
    synthesisError = err.message;
  }

  const judgeResult = synthesis ? synthesis.parsed : null;
  const authority = resolveEntailmentAuthority({ curatedBoundary: pkg.curatedBoundary, judgeResult, judgeError: synthesisError || (synthesis && synthesis.parseError), handleMap });

  return { claim, claimMethod: method, deterministicStatus: answer.capabilityStatus, primary: answer.matchedCapabilities[0], pkg, judgeResult, judgeRaw: synthesis ? synthesis.raw : null, judgeParseError: synthesis ? synthesis.parseError : null, synthesisError, authority, timing: synthesis ? synthesis.timing : null };
}

// Maps the judge's SUPPORTS/CONTRADICTS/INSUFFICIENT_EVIDENCE (via the
// authority-resolved finalStatus) back to the same 3-way space the gold
// dataset uses, for scoring -- AVAILABLE->SUPPORTS, NOT_SUPPORTED->CONTRADICTS,
// UNKNOWN->INSUFFICIENT_EVIDENCE. This is the FINAL, authority-gated
// result, not the raw model judgment -- exactly what a real caller would see.
function toGoldSpace(finalStatus) {
  if (finalStatus === 'AVAILABLE') return 'SUPPORTS';
  if (finalStatus === 'NOT_SUPPORTED') return 'CONTRADICTS';
  return 'INSUFFICIENT_EVIDENCE';
}

async function main() {
  const [, , modelLabel, modelPath, level, repeatPenaltyArg] = process.argv;
  if (!modelLabel || !modelPath) {
    console.error('Usage: node runEntailmentBenchmark.mjs <model-label> <path-to-gguf> [evidenceLevel] [repeatPenalty]');
    process.exit(1);
  }
  const evidenceLevel = level || 'summary+body';
  const repeatPenalty = repeatPenaltyArg ? { penalty: Number(repeatPenaltyArg) } : undefined;

  const { built } = assemble();
  const ctx = buildEngineContext(built);

  console.log(`[${modelLabel}] loading model, evidenceLevel=${evidenceLevel}, repeatPenalty=${repeatPenaltyArg || 'default'} ...`);
  const memBefore = await memoryUsageMB();
  const handle = await loadModel(modelPath);
  const memAfterLoad = await memoryUsageMB();
  console.log(`[${modelLabel}] loaded in ${handle.loadMs.toFixed(0)}ms, gpu=${handle.gpu}`);

  const results = [];
  for (const g of GOLD) {
    const r = await judgeOne(handle, g.question, ctx, evidenceLevel, repeatPenalty);
    const finalGoldSpace = toGoldSpace(r.authority.finalStatus);
    const correct = finalGoldSpace === g.gold;
    console.log(`[${modelLabel}] ${g.id}: gold=${g.gold} final=${finalGoldSpace} (${r.authority.authoritySource}) ${correct ? 'OK' : '*** MISMATCH ***'}`);
    results.push({ ...g, result: r, finalGoldSpace, correct });
  }

  const memAfterRun = await memoryUsageMB();
  await unloadModel(handle);

  const falseSupports = results.filter((r) => r.gold !== 'SUPPORTS' && r.finalGoldSpace === 'SUPPORTS');
  const falseDeclines = results.filter((r) => r.gold === 'SUPPORTS' && r.finalGoldSpace !== 'SUPPORTS');

  const summary = {
    modelLabel, modelPath, evidenceLevel, gpu: handle.gpu, loadMs: handle.loadMs,
    memoryMB: { beforeLoad: memBefore, afterLoad: memAfterLoad, afterRun: memAfterRun },
    goldCount: GOLD.length,
    ambiguousExcluded: AMBIGUOUS.length,
    correctCount: results.filter((r) => r.correct).length,
    accuracy: results.filter((r) => r.correct).length / results.length,
    falseSupportsCount: falseSupports.length,
    falseSupportsRate: falseSupports.length / results.length,
    falseSupportsCases: falseSupports.map((r) => ({ id: r.id, question: r.question, gold: r.gold, authoritySource: r.result.authority.authoritySource })),
    falseDeclinesCount: falseDeclines.length,
    falseDeclinesCases: falseDeclines.map((r) => ({ id: r.id, question: r.question })),
    schemaConformCount: results.filter((r) => r.result.judgeResult && !r.result.judgeParseError).length,
    invalidHandleCount: results.filter((r) => r.result.authority.authoritySource === 'invalid-handle-fallback').length,
    avgTotalMs: results.reduce((s, r) => s + (r.result.timing ? r.result.timing.totalMs : 0), 0) / results.length,
    results,
  };

  const outPath = path.join(__dirname, 'results', `entailment-${modelLabel}-${evidenceLevel}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`\n[${modelLabel}] wrote ${outPath}`);
  console.log(`[${modelLabel}] accuracy: ${(summary.accuracy * 100).toFixed(1)}% | FALSE SUPPORTS: ${summary.falseSupportsCount}/${GOLD.length} | false declines: ${summary.falseDeclinesCount} | schema-conform: ${summary.schemaConformCount}/${GOLD.length}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
