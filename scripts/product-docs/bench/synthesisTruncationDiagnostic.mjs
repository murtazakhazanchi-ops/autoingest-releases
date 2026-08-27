// Ask AutoIngest — Phase C5.2, Sections B/C/D forensic diagnostic.
// NOT production code; a throwaway (but real-model) investigation script
// that reproduces the committed C5/C5.1 synthesis path's known truncation
// behavior and measures REAL input/output token counts via the actual
// tokenizer (model.tokenize()) and the actual generation loop
// (modelRunner.js's generateStructured(), reused unmodified from the
// existing Phase A.2 benchmark harness -- plain Node ESM, no Electron
// needed, no production runtime.js/runtimeWorker.js touched).
//
// For every question in the existing 34-case bench/questions.mjs corpus
// plus 5 known-record (Related-topic) cases, this script:
//   1. runs the REAL, unmodified, already-committed deterministic/authority
//      pipeline (answerQuestionWithAuthority/answerKnownRecordWithAuthority,
//      assessPrimaryFit, evaluateSynthesisEligibility) to decide, exactly as
//      production does, whether synthesis would even be attempted;
//   2. for every case that IS eligible, builds the real evidence
//      package/prompt/schema (unmodified askSynthesis/* production code)
//      and tokenizes system+user with the real model tokenizer;
//   3. generates once at the CURRENT committed budget (maxTokens=500) to
//      reproduce the exact truncation population production sees today;
//   4. for any case that truncates (or exactly saturates 500 tokens) at
//      that budget, regenerates once more at a generous ceiling (1400) to
//      observe the true, uncapped completion length -- this is the real
//      number a budget policy should be derived from, not a guess.
//
// Run with: node scripts/product-docs/bench/synthesisTruncationDiagnostic.mjs

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRODUCT_DOCS = path.join(__dirname, '..');
const require = createRequire(import.meta.url);

const { loadModel, unloadModel, generateStructured } = await import('./modelRunner.js');
const { ALL_QUESTIONS } = await import('./questions.mjs');

const { assemble } = require(path.join(PRODUCT_DOCS, 'lib', 'build.js'));
const { buildEngineContext } = require(path.join(PRODUCT_DOCS, 'lib', 'knowledgeEngine.js'));
const { answerQuestionWithAuthority, answerKnownRecordWithAuthority } = require(path.join(PRODUCT_DOCS, 'lib', 'answerWithAuthority.js'));
const { evaluateSynthesisEligibility } = require(path.join(PRODUCT_DOCS, 'lib', 'askSynthesis', 'synthesisEligibility.js'));
const { assessPrimaryFit } = require(path.join(PRODUCT_DOCS, 'lib', 'askSynthesis', 'retrievalConfidence.js'));
const { buildEvidencePackageForAuthorityAnswer, buildEvidencePackageForKnownRecord } = require(path.join(PRODUCT_DOCS, 'lib', 'askSynthesis', 'evidencePackage.js'));
const { buildSynthesisPrompt } = require(path.join(PRODUCT_DOCS, 'lib', 'askSynthesis', 'promptTemplates.js'));
const { buildSynthesisSchema } = require(path.join(PRODUCT_DOCS, 'lib', 'askSynthesis', 'synthesisSchema.js'));

const REAL_MODEL_PATH = path.join(PRODUCT_DOCS, 'bench', 'models', 'phi-4-mini-instruct-Q4_K_M.gguf');
const CURRENT_BUDGET = 500; // synthesisAdapter.js's committed default, reproduced exactly
const CEILING_BUDGET = 1400; // generous, well under the 45s production timeout at observed tok/s

const KNOWN_RECORD_TITLES = ['Source Selection', 'Source Detection', 'Grouping System', 'Transfer Export', 'Create a New Event'];

function tokenCount(model, text) {
  return model.tokenize(text).length;
}

async function main() {
  if (!fs.existsSync(REAL_MODEL_PATH)) {
    console.error(`[c5.2-trunc-diag] real model not found at ${REAL_MODEL_PATH}. Skipping.`);
    process.exit(1);
  }
  const { built } = assemble();
  const handle = await loadModel(REAL_MODEL_PATH);
  console.log(`[c5.2-trunc-diag] model loaded (${handle.loadMs.toFixed(0)}ms, gpu=${handle.gpu})`);

  const cases = [];

  for (const q of ALL_QUESTIONS) {
    const ctx = buildEngineContext(built);
    const answer = await answerQuestionWithAuthority(q.question, ctx);
    const primaryFit = assessPrimaryFit(q.question, answer, ctx);
    const eligibility = evaluateSynthesisEligibility(answer, primaryFit);
    cases.push({
      kind: 'question', id: q.id, question: q.question, category: q.category,
      classification: answer.classification || null,
      capabilityStatus: answer.capabilityStatus, matchQuality: answer.matchQuality,
      eligible: eligibility.eligible, ineligibleReason: eligibility.reason,
      buildPkg: eligibility.eligible ? () => buildEvidencePackageForAuthorityAnswer(q.question, answer, ctx) : null,
    });
  }

  for (const title of KNOWN_RECORD_TITLES) {
    const feature = built.knowledgeIndex.find((f) => f.title === title || f.title.startsWith(`${title} (`));
    const workflow = !feature ? built.workflowIndex.find((w) => w.title === title || w.title.startsWith(`${title} (`)) : null;
    const record = feature || workflow;
    if (!record) { cases.push({ kind: 'known-record', title, error: 'not found' }); continue; }
    const ctx = buildEngineContext(built);
    const answer = await answerKnownRecordWithAuthority(record.id, ctx);
    const eligibility = evaluateSynthesisEligibility(answer, null);
    cases.push({
      kind: 'known-record', title, recordId: record.id,
      classification: answer.classification || null,
      capabilityStatus: answer.capabilityStatus, matchQuality: answer.matchQuality,
      eligible: eligibility.eligible, ineligibleReason: eligibility.reason,
      buildPkg: eligibility.eligible ? () => buildEvidencePackageForKnownRecord(answer, ctx) : null,
    });
  }

  const eligibleCases = cases.filter((c) => c.eligible);
  console.log(`[c5.2-trunc-diag] ${cases.length} total cases, ${eligibleCases.length} eligible for synthesis (matches production eligibility gate exactly)`);

  const results = [];
  for (const c of cases) {
    if (!c.eligible) {
      results.push({ ...c, buildPkg: undefined, skipped: 'ineligible' });
      continue;
    }
    const pkg = c.buildPkg();
    const { system, user, handleMap } = buildSynthesisPrompt(pkg);
    const schema = buildSynthesisSchema(pkg, handleMap);
    const systemTokens = tokenCount(handle.model, system);
    const userTokens = tokenCount(handle.model, user);

    const evidenceSize = {
      stepsCount: (pkg.steps || []).length,
      neighborhoodCount: (pkg.admittedNeighborhood || []).length,
      historicalCount: (pkg.historical && pkg.historical.admitted || []).length,
      limitationsCount: (pkg.limitations || []).length,
      relatedCount: (pkg.relatedCapabilities || []).length,
      userJsonChars: user.length,
    };

    const label = c.kind === 'question' ? `${c.id} "${c.question}"` : `KNOWN "${c.title}"`;
    process.stdout.write(`[c5.2-trunc-diag] generating @500 for ${label} ... `);
    const at500 = await generateStructured(handle, system, user, schema, { maxTokens: CURRENT_BUDGET });
    const truncatedAt500 = !!at500.parseError;
    console.log(`outTok=${at500.timing.approxOutputTokens} ${truncatedAt500 ? 'TRUNCATED (' + at500.parseError + ')' : 'ok'} (${at500.timing.totalMs.toFixed(0)}ms)`);

    let atCeiling = null;
    if (truncatedAt500 || at500.timing.approxOutputTokens >= CURRENT_BUDGET - 2) {
      process.stdout.write(`[c5.2-trunc-diag]   re-generating @${CEILING_BUDGET} to find true completion length ... `);
      atCeiling = await generateStructured(handle, system, user, schema, { maxTokens: CEILING_BUDGET });
      console.log(`outTok=${atCeiling.timing.approxOutputTokens} ${atCeiling.parseError ? 'STILL TRUNCATED (' + atCeiling.parseError + ')' : 'completed'} (${atCeiling.timing.totalMs.toFixed(0)}ms)`);
    }

    results.push({
      ...c, buildPkg: undefined,
      classification: pkg.classification,
      systemTokens, userTokens, inputTokens: systemTokens + userTokens,
      evidenceSize,
      at500: { outputTokens: at500.timing.approxOutputTokens, totalMs: at500.timing.totalMs, truncated: truncatedAt500, parseError: at500.parseError || null },
      atCeiling: atCeiling ? { outputTokens: atCeiling.timing.approxOutputTokens, totalMs: atCeiling.timing.totalMs, truncated: !!atCeiling.parseError, parseError: atCeiling.parseError || null, raw: atCeiling.raw } : null,
    });
  }

  await unloadModel(handle);

  const outPath = path.join(PRODUCT_DOCS, 'bench', 'results', 'phase-c5.2-truncation-diagnostic.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ currentBudget: CURRENT_BUDGET, ceilingBudget: CEILING_BUDGET, cases: results }, null, 2));
  console.log(`\n[c5.2-trunc-diag] wrote ${outPath}`);

  const evaluated = results.filter((r) => r.at500);
  const truncatedCases = evaluated.filter((r) => r.at500.truncated);
  console.log(`\n[c5.2-trunc-diag] SUMMARY: ${evaluated.length} generated @500, ${truncatedCases.length} truncated:`);
  for (const r of truncatedCases) {
    const label = r.kind === 'question' ? `${r.id} "${r.question}"` : `KNOWN "${r.title}"`;
    console.log(`  - ${label} [${r.classification}] input=${r.inputTokens}tok out@500=${r.at500.outputTokens} out@ceiling=${r.atCeiling ? r.atCeiling.outputTokens : 'n/a'} evidence=${JSON.stringify(r.evidenceSize)}`);
  }
}

main().catch((err) => {
  console.error('[c5.2-trunc-diag] FATAL:', err);
  process.exit(1);
});
