// Ask AutoIngest — SUPPORTS-recall checkpoint, Part 5: evidence-minimality
// experiment on a representative subset. Levels available WITHOUT any
// production file change: 'summary' (Summary only), 'summary+body'
// (+ Limitations + Workflow whenToUseIt/steps + curated TOPIC_ALIASES,
// the current default), 'full' (+ up to 3 admitted-related records'
// Summaries). A genuinely more targeted "Current Behavior" section was
// found NOT to be exposed by any existing parsed structure -- see the
// report's own Part 6 finding; not tested here since adding it would
// require a production parsing change, out of this checkpoint's authority.
import { loadModel, unloadModel, generateStructured } from './modelRunner.js';
import { GOLD } from './entailmentGoldDataset.mjs';

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

const { built } = assemble();
const ctx = buildEngineContext(built);

// Representative subset: every SUPPORTS case (the ones we're trying to
// recover), 3 adversarial (feature-primary + governance-primary lexical
// FPs), 1 curated boundary, 1 honest-gap control.
const SUBSET_IDS = ['C2', 'D1', 'D2', 'D3', 'D4', 'A2', 'A1', 'B8', 'A4', 'C1'];
const subset = GOLD.filter((g) => SUBSET_IDS.includes(g.id));

const LEVELS = ['summary', 'summary+body', 'full'];
const handle = await loadModel('./models/phi-4-mini-instruct-Q4_K_M.gguf');

for (const level of LEVELS) {
  console.log(`\n=== level: ${level} ===`);
  for (const g of subset) {
    const { claim } = normalizeClaim(g.question);
    const answer = answerQuestion(g.question, ctx);
    const { pkg, handleMap } = buildEntailmentEvidencePackage(g.question, claim, answer, ctx, { level });
    const schema = buildEntailmentSchema(handleMap);
    const { system, user } = buildEntailmentPrompt(pkg, handleMap);
    const approxTokens = Math.round(user.length / 4); // rough char/4 estimate, disclosed as approximate
    let synthesis = null, err = null;
    try { synthesis = await generateStructured(handle, system, user, schema, { maxTokens: 200 }); } catch (e) { err = e.message; }
    const authority = resolveEntailmentAuthority({ curatedBoundary: pkg.curatedBoundary, judgeResult: synthesis ? synthesis.parsed : null, judgeError: err || (synthesis && synthesis.parseError), handleMap });
    const finalGoldSpace = authority.finalStatus === 'AVAILABLE' ? 'SUPPORTS' : (authority.finalStatus === 'NOT_SUPPORTED' ? 'CONTRADICTS' : 'INSUFFICIENT_EVIDENCE');
    const correct = finalGoldSpace === g.gold;
    console.log(`  ${g.id} (~${approxTokens}tok, ${pkg.evidence.length}items): gold=${g.gold} got=${finalGoldSpace} ${correct ? 'OK' : 'MISS'}`);
  }
}
await unloadModel(handle);
