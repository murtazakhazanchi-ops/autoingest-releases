// Ask AutoIngest — Current Behavior Evidence Promotion & Entailment
// Integration-Readiness Checkpoint, Part 12. 3x consistency verification
// against the frozen gold set using the REAL, unmodified
// buildEntailmentEvidencePackage()/buildEntailmentPrompt() (level:
// 'summary+body', which now includes currentBehavior sourced from the real
// parsed Feature record -- no bench-side duplicate extraction).
//
// Supersedes bench/consistencyCheckVariant.mjs (retired -- built on the now-
// removed bench-only evidence-variant scaffolding).
//
// Usage: node consistencyCheckGold.mjs <model-label> <path-to-gguf> [repeatPenalty]
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

const [, , modelLabel, modelPath, repeatPenaltyArg] = process.argv;
if (!modelLabel || !modelPath) {
  console.error('Usage: node consistencyCheckGold.mjs <model-label> <path-to-gguf> [repeatPenalty]');
  process.exit(1);
}
const repeatPenalty = repeatPenaltyArg ? { penalty: Number(repeatPenaltyArg) } : undefined;

const SUPPORTS_CASES = GOLD.filter((g) => g.gold === 'SUPPORTS'); // C2, D1, D2, D3, D4
const REP_ADVERSARIAL_IDS = ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B8', 'B24', 'C1', 'C3'];
const adversarialSubset = GOLD.filter((g) => REP_ADVERSARIAL_IDS.includes(g.id));
const CASES = [...SUPPORTS_CASES, ...adversarialSubset];

function toGoldSpace(finalStatus) {
  if (finalStatus === 'AVAILABLE') return 'SUPPORTS';
  if (finalStatus === 'NOT_SUPPORTED') return 'CONTRADICTS';
  return 'INSUFFICIENT_EVIDENCE';
}

console.log(`consistencyCheckGold: model=${modelLabel}, repeatPenalty=${repeatPenaltyArg || 'default'}, ${CASES.length} cases x 3 runs`);
const handle = await loadModel(modelPath);
const report = [];
for (const g of CASES) {
  const { claim } = normalizeClaim(g.question);
  const answer = answerQuestion(g.question, ctx);
  const { pkg, handleMap } = buildEntailmentEvidencePackage(g.question, claim, answer, ctx, { level: 'summary+body' });
  const schema = buildEntailmentSchema(handleMap);
  const { system, user } = buildEntailmentPrompt(pkg, handleMap);

  const outcomes = [];
  const handleSets = [];
  const confidences = [];
  for (let i = 0; i < 3; i++) {
    let synthesis = null, err = null;
    try { synthesis = await generateStructured(handle, system, user, schema, { maxTokens: 200, repeatPenalty }); } catch (e) { err = e.message; }
    const authority = resolveEntailmentAuthority({ curatedBoundary: pkg.curatedBoundary, judgeResult: synthesis ? synthesis.parsed : null, judgeError: err || (synthesis && synthesis.parseError), handleMap });
    outcomes.push(toGoldSpace(authority.finalStatus));
    handleSets.push(synthesis && synthesis.parsed ? JSON.stringify((synthesis.parsed.evidenceHandles || []).slice().sort()) : 'n/a');
    confidences.push(synthesis && synthesis.parsed ? synthesis.parsed.confidence : 'n/a');
  }
  const stable = outcomes.every((o) => o === outcomes[0]) && handleSets.every((h) => h === handleSets[0]) && confidences.every((c) => c === confidences[0]);
  console.log(`  ${g.id} (gold=${g.gold}): judgment=[${outcomes.join(', ')}] handles=[${handleSets.join(', ')}] confidence=[${confidences.join(', ')}] ${stable ? 'STABLE' : '*** UNSTABLE ***'}`);
  report.push({ id: g.id, gold: g.gold, outcomes, handleSets, confidences, stable });
}
await unloadModel(handle);

const unstableCount = report.filter((r) => !r.stable).length;
console.log(`\nDone. ${report.length - unstableCount}/${report.length} stable, ${unstableCount} unstable.`);
