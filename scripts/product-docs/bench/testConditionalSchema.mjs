import { loadModel, unloadModel, generateStructured } from './modelRunner.js';

const buildMod = await import('../lib/build.js');
const engineMod = await import('../lib/knowledgeEngine.js');
const claimMod = await import('../lib/askSynthesis/claimNormalization.js');
const entEvidenceMod = await import('../lib/askSynthesis/entailmentEvidencePackage.js');
const entPromptMod = await import('../lib/askSynthesis/entailmentPrompt.js');

const { assemble } = buildMod;
const { buildEngineContext, answerQuestion } = engineMod;
const { normalizeClaim } = claimMod;
const { buildEntailmentEvidencePackage } = entEvidenceMod;
const { buildEntailmentPrompt } = entPromptMod;

const { built } = assemble();
const ctx = buildEngineContext(built);

function buildConditionalSchema(handleMap) {
  const handleEnum = handleMap.validHandles.length ? handleMap.validHandles : ['__NONE__'];
  const handlesArr = { type: 'array', items: { type: 'string', enum: handleEnum } };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['judgment', 'evidenceHandles', 'confidence'],
    properties: {
      judgment: { type: 'string', enum: ['SUPPORTS', 'CONTRADICTS', 'INSUFFICIENT_EVIDENCE'] },
      evidenceHandles: handlesArr,
      reasonCode: { type: 'string' },
      confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
    },
    allOf: [
      {
        if: { properties: { judgment: { const: 'SUPPORTS' } } },
        then: { properties: { evidenceHandles: { ...handlesArr, minItems: 1 } } },
      },
      {
        if: { properties: { judgment: { const: 'CONTRADICTS' } } },
        then: { properties: { evidenceHandles: { ...handlesArr, minItems: 1 } } },
      },
    ],
  };
}

const q = 'Does AutoIngest support QMZ sequencing?'; // D1 -- the known SUPPORTS+empty-handles case
const { claim } = normalizeClaim(q);
const answer = answerQuestion(q, ctx);
const { pkg, handleMap } = buildEntailmentEvidencePackage(q, claim, answer, ctx, { level: 'summary+body' });
const schema = buildConditionalSchema(handleMap);
const { system, user } = buildEntailmentPrompt(pkg, handleMap);

const handle = await loadModel('./models/phi-4-mini-instruct-Q4_K_M.gguf');
console.log('=== testing conditional if/then schema enforcement on the known D1 empty-handles case ===');
for (let i = 0; i < 3; i++) {
  const r = await generateStructured(handle, system, user, schema, { maxTokens: 200 });
  console.log(`run ${i + 1}:`, JSON.stringify(r.parsed), r.parseError ? `PARSE ERROR: ${r.parseError}` : '');
}
await unloadModel(handle);
