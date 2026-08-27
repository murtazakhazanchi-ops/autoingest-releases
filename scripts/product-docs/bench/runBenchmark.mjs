// Ask AutoIngest Phase A -- real benchmark runner. Loads a real local GGUF
// model via node-llama-cpp, builds a real evidence package per question via
// the real, unmodified deterministic engine, synthesizes a real structured
// answer, validates it with the real safety checks, and scores retrieval and
// synthesis SEPARATELY (Product Owner directive: never let synthesis quality
// hide a bad retrieval result).
//
// Usage: node runBenchmark.mjs <model-label> <path-to-gguf>
// Writes bench/results/<model-label>.json

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadModel, unloadModel, generateStructured, memoryUsageMB } from './modelRunner.js';
import { ALL_QUESTIONS } from './questions.mjs';

const buildMod = await import('../lib/build.js');
const engineMod = await import('../lib/knowledgeEngine.js');
const evidenceMod = await import('../lib/askSynthesis/evidencePackage.js');
const schemaMod = await import('../lib/askSynthesis/synthesisSchema.js');
const promptMod = await import('../lib/askSynthesis/promptTemplates.js');
const safetyMod = await import('../lib/askSynthesis/safetyValidation.js');

const { assemble } = buildMod;
const { buildEngineContext, answerQuestion } = engineMod;
const { buildEvidencePackage } = evidenceMod;
const { buildSynthesisSchema } = schemaMod;
const { buildSynthesisPrompt } = promptMod;
const { validateSynthesis } = safetyMod;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function scoreRetrieval(question, pkg) {
  const exp = question.expected;
  const notes = [];
  let primaryCorrect = null;
  if (exp.primaryId) {
    primaryCorrect = pkg.primary && pkg.primary.id === exp.primaryId;
    if (!primaryCorrect) notes.push(`expected primary ${exp.primaryId}, got ${pkg.primary ? pkg.primary.id : 'none'}`);
  }
  let statusCorrect = null;
  if (exp.capabilityStatus && !exp.capabilityStatus.includes('_')) {
    // plain enum expectation
    statusCorrect = pkg.capabilityStatus === exp.capabilityStatus;
    if (!statusCorrect) notes.push(`expected capabilityStatus ${exp.capabilityStatus}, got ${pkg.capabilityStatus}`);
  } else if (exp.capabilityStatus === 'NOT_SUPPORTED_EXPECTED_BUT_ENGINE_SAYS_AVAILABLE') {
    statusCorrect = false; // by definition -- this is the known defect case, always scored as a retrieval failure
    notes.push(`KNOWN DEFECT (RF-4.3-EXT-001): engine says ${pkg.capabilityStatus}, real-world correct answer is NOT_SUPPORTED/UNKNOWN`);
  } else if (exp.capabilityStatus === 'FICTITIOUS_MUST_NOT_BE_CONFIDENTLY_AFFIRMED') {
    statusCorrect = pkg.capabilityStatus !== 'AVAILABLE' || pkg.matchQuality === 'weak' || pkg.matchQuality === 'boundary';
    if (!statusCorrect) notes.push(`fictitious capability confidently affirmed AVAILABLE with matchQuality=${pkg.matchQuality} -- hallucination risk at the RETRIEVAL layer, before synthesis is even involved`);
  }
  return {
    primaryCorrect,
    statusCorrect,
    retrievalOk: (primaryCorrect !== false) && (statusCorrect !== false),
    knownDefect: question.knownDefect || null,
    notes,
  };
}

async function runOne(handle, question, ctx) {
  const pkg = buildEvidencePackage(question.question, ctx);
  const retrieval = scoreRetrieval(question, pkg);

  const { system, user, handleMap } = buildSynthesisPrompt(pkg);
  const schema = buildSynthesisSchema(pkg, handleMap);
  let synthesis = null;
  let synthesisError = null;
  try {
    synthesis = await generateStructured(handle, system, user, schema, { maxTokens: 1500 });
  } catch (err) {
    synthesisError = err.message;
  }

  let validation = null;
  if (synthesis && synthesis.parsed) {
    validation = validateSynthesis(synthesis.parsed, pkg, handleMap);
  }

  return {
    id: question.id,
    category: question.category,
    question: question.question,
    retrieval,
    evidencePackageSummary: {
      primary: pkg.primary,
      capabilityStatus: pkg.capabilityStatus,
      matchQuality: pkg.matchQuality,
      directAnswer: pkg.directAnswer,
      stepCount: pkg.steps.length,
      legitimateSourceIdCount: pkg.legitimateSourceIds.length,
      handleCount: handleMap.validHandles.length,
      schemaHasHistoricalNote: !!schema.properties.historicalNote,
    },
    synthesis: synthesis
      ? {
        raw: synthesis.raw,
        parsed: synthesis.parsed,
        parseError: synthesis.parseError,
        timing: synthesis.timing,
      }
      : null,
    synthesisError,
    validation,
  };
}

async function main() {
  const [, , modelLabel, modelPath] = process.argv;
  if (!modelLabel || !modelPath) {
    console.error('Usage: node runBenchmark.mjs <model-label> <path-to-gguf>');
    process.exit(1);
  }

  const { built } = assemble();
  const ctx = buildEngineContext(built);

  console.log(`[${modelLabel}] loading model from ${modelPath} ...`);
  const memBefore = await memoryUsageMB();
  const handle = await loadModel(modelPath);
  const memAfterLoad = await memoryUsageMB();
  console.log(`[${modelLabel}] loaded in ${handle.loadMs.toFixed(0)}ms, gpu=${handle.gpu}`);

  const results = [];
  for (const q of ALL_QUESTIONS) {
    process.stdout.write(`[${modelLabel}] ${q.id} (${q.category}): "${q.question.slice(0, 60)}..." ... `);
    const t0 = Date.now();
    const result = await runOne(handle, q, ctx);
    console.log(`${Date.now() - t0}ms, retrievalOk=${result.retrieval.retrievalOk}, synthesisValid=${result.validation ? result.validation.ok : 'N/A'}`);
    results.push(result);
  }

  const memAfterRun = await memoryUsageMB();
  await unloadModel(handle);

  const failureTaxonomy = {};
  for (const r of results) {
    if (r.validation) for (const fc of r.validation.failedChecks) failureTaxonomy[fc] = (failureTaxonomy[fc] || 0) + 1;
  }

  const summary = {
    modelLabel,
    modelPath,
    gpu: handle.gpu,
    loadMs: handle.loadMs,
    memoryMB: { beforeLoad: memBefore, afterLoad: memAfterLoad, afterRun: memAfterRun },
    questionCount: results.length,
    retrievalOkCount: results.filter((r) => r.retrieval.retrievalOk).length,
    synthesisValidCount: results.filter((r) => r.validation && r.validation.ok).length,
    schemaConformCount: results.filter((r) => r.synthesis && r.synthesis.parsed && !r.synthesis.parseError).length,
    failureTaxonomy,
    avgTotalMs: results.reduce((s, r) => s + (r.synthesis ? r.synthesis.timing.totalMs : 0), 0) / results.length,
    avgFirstTokenMs: results.filter((r) => r.synthesis && r.synthesis.timing.firstTokenMs !== null).reduce((s, r, _, arr) => s + r.synthesis.timing.firstTokenMs / arr.length, 0),
    results,
  };

  const outPath = path.join(__dirname, 'results', `${modelLabel}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`\n[${modelLabel}] wrote ${outPath}`);
  console.log(`[${modelLabel}] retrieval OK: ${summary.retrievalOkCount}/${summary.questionCount}, synthesis valid: ${summary.synthesisValidCount}/${summary.questionCount}, schema-conform: ${summary.schemaConformCount}/${summary.questionCount}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
