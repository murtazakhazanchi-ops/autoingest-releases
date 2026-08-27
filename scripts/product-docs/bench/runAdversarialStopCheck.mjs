// Ask AutoIngest — SUPPORTS-recall checkpoint, Part 10: adversarial
// stop-rule check. Run BEFORE the full 56-case benchmark after any
// material prompt/schema/evidence change -- if any negative-gold case
// flips to SUPPORTS, STOP that variant and report it, never proceed.
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

const modelPath = process.argv[2] || './models/phi-4-mini-instruct-Q4_K_M.gguf';
const level = process.argv[3] || 'summary+body';
const repeatPenaltyArg = process.argv[4];
const repeatPenalty = repeatPenaltyArg ? { penalty: Number(repeatPenaltyArg) } : undefined;
const ADVERSARIAL = GOLD.filter((g) => g.gold !== 'SUPPORTS'); // every negative/insufficient/contradicts gold case

console.log(`Adversarial stop-check: ${ADVERSARIAL.length} cases, model=${modelPath}, level=${level}, repeatPenalty=${repeatPenaltyArg || 'default'}`);
const handle = await loadModel(modelPath);
let violations = 0;
for (const g of ADVERSARIAL) {
  const { claim } = normalizeClaim(g.question);
  const answer = answerQuestion(g.question, ctx);
  const { pkg, handleMap } = buildEntailmentEvidencePackage(g.question, claim, answer, ctx, { level });
  const schema = buildEntailmentSchema(handleMap);
  const { system, user } = buildEntailmentPrompt(pkg, handleMap);
  let synthesis = null, err = null;
  try { synthesis = await generateStructured(handle, system, user, schema, { maxTokens: 200, repeatPenalty }); } catch (e) { err = e.message; }
  const authority = resolveEntailmentAuthority({ curatedBoundary: pkg.curatedBoundary, judgeResult: synthesis ? synthesis.parsed : null, judgeError: err || (synthesis && synthesis.parseError), handleMap });
  const finalGoldSpace = authority.finalStatus === 'AVAILABLE' ? 'SUPPORTS' : (authority.finalStatus === 'NOT_SUPPORTED' ? 'CONTRADICTS' : 'INSUFFICIENT_EVIDENCE');
  if (finalGoldSpace === 'SUPPORTS') {
    violations++;
    console.log(`*** STOP-RULE VIOLATION *** ${g.id}: "${g.question}" -> gold=${g.gold}, now=SUPPORTS (${authority.authoritySource})`);
    console.log('    evidence:', JSON.stringify(pkg.evidence.map((e) => e.text.slice(0, 100))));
    console.log('    judge raw:', synthesis ? synthesis.raw : err);
  }
}
await unloadModel(handle);
console.log(`\nDone. Violations: ${violations}/${ADVERSARIAL.length}`);
if (violations > 0) { console.log('STOP: this variant reintroduces false SUPPORTS -- do not proceed to the full benchmark with it.'); process.exit(1); }
console.log('PASS: zero adversarial cases flipped to SUPPORTS -- safe to proceed to the full 56-case rerun.');
