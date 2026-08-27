// Ask AutoIngest — Capability Entailment Judge Prototype, Part 17: run the
// same question through the judge multiple times to check stability.
import { loadModel, unloadModel, generateStructured } from './modelRunner.js';

const buildMod = await import('../lib/build.js');
const engineMod = await import('../lib/knowledgeEngine.js');
const claimMod = await import('../lib/askSynthesis/claimNormalization.js');
const entEvidenceMod = await import('../lib/askSynthesis/entailmentEvidencePackage.js');
const entSchemaMod = await import('../lib/askSynthesis/entailmentSchema.js');
const entPromptMod = await import('../lib/askSynthesis/entailmentPrompt.js');

const { assemble } = buildMod;
const { buildEngineContext, answerQuestion } = engineMod;
const { normalizeClaim } = claimMod;
const { buildEntailmentEvidencePackage } = entEvidenceMod;
const { buildEntailmentSchema } = entSchemaMod;
const { buildEntailmentPrompt } = entPromptMod;

const { built } = assemble();
const ctx = buildEngineContext(built);

const QUESTIONS = [
  'Can I tell if a teammate is online right now?', // the hard body-text case
  'Does AutoIngest support drone footage import with GPS flight paths?', // the FP flagship
  'Does AutoIngest support QMZ sequencing?', // clean positive
];

const handle = await loadModel('./models/phi-4-mini-instruct-Q4_K_M.gguf');
for (const q of QUESTIONS) {
  const { claim } = normalizeClaim(q);
  const answer = answerQuestion(q, ctx);
  const { pkg, handleMap } = buildEntailmentEvidencePackage(q, claim, answer, ctx, { level: 'summary+body' });
  const schema = buildEntailmentSchema(handleMap);
  const { system, user } = buildEntailmentPrompt(pkg, handleMap);
  console.log(`\n=== "${q}" (3 runs) ===`);
  for (let i = 0; i < 3; i++) {
    const r = await generateStructured(handle, system, user, schema, { maxTokens: 200 });
    console.log(`  run ${i + 1}: ${JSON.stringify(r.parsed)}`);
  }
}
await unloadModel(handle);
