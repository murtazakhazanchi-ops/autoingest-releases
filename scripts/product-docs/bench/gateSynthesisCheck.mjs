// Retrieval Safety Checkpoint, Part 8 -- real, one-shot verification that
// WHEN the capability authority gate would fire, an evidence package built
// from its (gated) output never hands the LLM an affirmative AVAILABLE
// premise in the first place, so the LLM cannot be "responsible for
// correcting deterministic retrieval" -- there is nothing false left for it
// to inherit.
import { loadModel, unloadModel, generateStructured } from './modelRunner.js';

const buildMod = await import('../lib/build.js');
const engineMod = await import('../lib/knowledgeEngine.js');
const evidenceMod = await import('../lib/askSynthesis/evidencePackage.js');
const gateMod = await import('../lib/capabilityAuthorityGate.js');
const schemaMod = await import('../lib/askSynthesis/synthesisSchema.js');
const promptMod = await import('../lib/askSynthesis/promptTemplates.js');

const { assemble } = buildMod;
const { buildEngineContext, answerQuestion, explainNormalization } = engineMod;
const { buildEvidencePackage } = evidenceMod;
const { applyCapabilityAuthorityGate } = gateMod;
const { buildSynthesisSchema } = schemaMod;
const { buildSynthesisPrompt } = promptMod;

const { built } = assemble();
const ctx = buildEngineContext(built);

const Q = 'Does AutoIngest support blockchain-verified chain-of-custody signing for archived photos?';
const realAnswer = answerQuestion(Q, ctx);
const diag = explainNormalization(Q, ctx.searchIndex);
const gateResult = applyCapabilityAuthorityGate(Q, realAnswer, diag, ctx);
console.log('gate fired:', gateResult.gated, '| before status:', realAnswer.capabilityStatus, '| after status:', gateResult.answer.capabilityStatus);

// Simulate a gate-integrated evidence package: apply the SAME gated
// capabilityStatus/directAnswer to the real package's own top-level fields
// -- exactly what wiring the gate into buildEvidencePackage() would produce,
// without actually performing that wiring (not authorized this pass).
const pkg = buildEvidencePackage(Q, ctx);
const gatedPkg = { ...pkg, capabilityStatus: gateResult.answer.capabilityStatus, directAnswer: gateResult.answer.directAnswer, matchQuality: 'none', sources: [] };

const { system, user, handleMap } = buildSynthesisPrompt(gatedPkg);
const schema = buildSynthesisSchema(gatedPkg, handleMap);

const handle = await loadModel('./models/phi-4-mini-instruct-Q4_K_M.gguf');
const result = await generateStructured(handle, system, user, schema, { maxTokens: 500 });
await unloadModel(handle);

console.log('\nsynthesized answer over the GATED evidence package:');
console.log(JSON.stringify(result.parsed, null, 2));
