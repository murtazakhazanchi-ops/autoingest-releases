'use strict';

// main/askAutoIngestKnowledgeModelGeneralization.js — CANDIDATE C
// GENERALIZATION RUN (Product Owner checkpoint, 2026-08-25 continuation,
// Section 12). Experimental, exploratory only -- NOT the frozen acceptance
// benchmark. Runs the EXACT SAME, already-frozen Candidate C code
// (candidateC/orchestrator.js, candidateC/evidence.js, the Knowledge Model)
// against scripts/product-docs/bench/candidateC/generalizationSet.js's 14
// unseen conversations instead of bakeoff/conversationTrial.js's frozen 19.
// Zero code differences from main/askAutoIngestKnowledgeModelExperiment.js
// other than which conversation list is imported and where the output is
// written -- deliberately, so this run exercises literally the same
// Candidate C the acceptance benchmark did, not a re-tuned variant.
//
// Run with: node_modules/.bin/electron main/askAutoIngestKnowledgeModelGeneralization.js [outDir]

const path = require('path');
const fs = require('fs');
const os = require('os');

const FIXTURE_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-c8-kmgen-userdata-'));
const OUT_DIR = process.argv[2] || path.join(os.tmpdir(), 'ai-c8-kmgen-results');
fs.mkdirSync(OUT_DIR, { recursive: true });

const { app } = require('electron');
app.setPath('userData', FIXTURE_USER_DATA);

const PRODUCT_DOCS = path.join(__dirname, '..', 'scripts', 'product-docs');
const build = require(path.join(PRODUCT_DOCS, 'lib', 'build.js'));
const { buildEngineContext } = require(path.join(PRODUCT_DOCS, 'lib', 'knowledgeEngine.js'));
const CS = require(path.join(PRODUCT_DOCS, 'lib', 'conversationState.js'));
const { askConversationalKnowledgeModel } = require(path.join(PRODUCT_DOCS, 'bench', 'candidateC', 'orchestrator.js'));
const { buildKnowledgeModelEvidence } = require(path.join(PRODUCT_DOCS, 'bench', 'candidateC', 'evidence.js'));
const { GENERALIZATION_CONVERSATIONS } = require(path.join(PRODUCT_DOCS, 'bench', 'candidateC', 'generalizationSet.js'));

const SYSTEM_CONTRACT = `You are Ask AutoIngest, the built-in assistant for AutoIngest.

Answer the operator naturally and directly using only the supplied AutoIngest information.

You may select, omit, reorganize and simplify the supplied evidence.

Do not mention internal implementation details unless the operator asks a technical question.

If the user's situation is ambiguous and the supplied candidate information does not establish one interpretation safely, ask one concise follow-up question instead of guessing.

Do not invent AutoIngest features, buttons, workflows, steps, paths or capability status.

For HOW_TO questions, use the supplied steps to actually explain what the operator should do.

For troubleshooting, prioritize the practical recovery steps and relevant warnings.

Keep simple questions concise. Use more detail only when useful.`;

const GEMMA_FILE = '/Users/funun_pa/.claude/jobs/6629ed37/tmp/models/gemma-4-E4B-it-Q4_K_M.gguf';

async function setUpRealEmbeddingModel() {
  const embeddingModelManager = require('../services/semanticRetrieval/embeddingModelManager');
  const REAL_MODEL_PATH = '/Users/funun_pa/.claude/jobs/6629ed37/tmp/models/bge-small-en-v1.5-q8_0.gguf';
  if (!fs.existsSync(REAL_MODEL_PATH)) return false;
  const { finalPath } = embeddingModelManager.resolvePaths();
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  fs.symlinkSync(REAL_MODEL_PATH, finalPath);
  const v = await embeddingModelManager.verify();
  return v.status === embeddingModelManager.STATUS.READY;
}

async function main() {
  const hasEmbedding = await setUpRealEmbeddingModel();
  console.log(`[kmgen] real embedding retrieval ready: ${hasEmbedding}`);
  const semanticRetrievalService = hasEmbedding ? require('../services/semanticRetrieval/semanticRetrievalService') : null;

  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  const { getLlama, LlamaChatSession, Gemma4ChatWrapper } = await import('node-llama-cpp');
  const llama = await getLlama();

  console.log('[kmgen] loading Gemma-4-E4B-it...');
  const loadT0 = Date.now();
  const model = await llama.loadModel({ modelPath: GEMMA_FILE });
  const loadMs = Date.now() - loadT0;
  console.log(`[kmgen] loaded in ${loadMs}ms`);

  const chatWrapper = new Gemma4ChatWrapper({ reasoning: false });

  async function runConversation(conv) {
    const context = await model.createContext({ contextSize: Math.min(model.trainContextSize, 8192) });
    const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt: SYSTEM_CONTRACT, chatWrapper });
    const baseHistory = session.getChatHistory();

    let state = CS.createConversation();
    let currentUserMessage = null;
    const transcript = [];

    async function generateFn(evidenceBlock, currentUserText) {
      const priorTurns = [];
      for (const t of state.turns) {
        if (t.role === 'user') priorTurns.push({ type: 'user', text: t.text });
        else priorTurns.push({ type: 'model', response: [t.text] });
      }
      session.setChatHistory([...baseHistory, ...priorTurns]);
      const userContent = evidenceBlock
        ? `${currentUserText}\n\n[Supporting AutoIngest evidence for this question]\n${evidenceBlock}`
        : currentUserText;
      const t0 = Date.now();
      const text = await session.prompt(userContent, { maxTokens: 600 });
      return { text: text.trim(), latencyMs: Date.now() - t0 };
    }

    let lastEvidenceMeta = null;
    const options = {
      semanticTopK: semanticRetrievalService ? (q) => semanticRetrievalService.productionSemanticTopK(q) : undefined,
      synthesize: async (pkg) => {
        const kmEvidence = buildKnowledgeModelEvidence(pkg);
        lastEvidenceMeta = kmEvidence;
        const { text, latencyMs } = await generateFn(kmEvidence.evidenceBlock, currentUserMessage);
        return { answer: text, capabilityStatus: pkg.capabilityStatus, sourceIds: [], steps: [], warnings: [], refused: false, __latencyMs: latencyMs };
      },
      formulateClarification: async ({ missingFactLabel, candidateTitles }) => {
        const prompt = `The operator's request is ambiguous. You need to ask them: ${missingFactLabel}.\nPossible options, in the operator's own words: ${candidateTitles.join(', ')}.\n\nAsk ONE natural, concise clarifying question that helps the operator pick between these.`;
        const { text, latencyMs } = await generateFn(prompt, currentUserMessage);
        return { question: text.trim().replace(/^"|"$/g, ''), __latencyMs: latencyMs };
      },
    };

    for (const message of conv.turns) {
      currentUserMessage = message;
      lastEvidenceMeta = null;
      transcript.push({ role: 'user', text: message });
      const t0 = Date.now();
      let response, errored = null;
      try {
        const result = await askConversationalKnowledgeModel(state, message, ctx, options);
        state = result.state;
        response = result.response;
      } catch (err) {
        errored = String(err && err.stack || err);
      }
      const ms = Date.now() - t0;
      if (errored) {
        transcript.push({ role: 'assistant', text: `[ERROR: ${errored}]`, kind: 'error', ms });
      } else if (response.kind === 'clarification') {
        transcript.push({ role: 'assistant', text: response.text, kind: 'clarification', choices: response.choices, ms, evidenceMeta: lastEvidenceMeta });
      } else {
        transcript.push({
          role: 'assistant', text: response.answer.directAnswer, kind: 'final', ms,
          meta: {
            classification: response.answer.classification, capabilityStatus: response.answer.capabilityStatus,
            matchQuality: response.answer.matchQuality, topicChanged: !!response.topicChanged,
          },
          evidenceMeta: lastEvidenceMeta,
        });
      }
      console.log(`[kmgen] ${conv.id} :: "${message.slice(0, 40)}" (${ms}ms) :: ${errored ? 'ERROR' : response.kind} :: evidence=${lastEvidenceMeta ? lastEvidenceMeta.source : 'n/a'}${lastEvidenceMeta && lastEvidenceMeta.kmRecordId ? ' (' + lastEvidenceMeta.kmRecordId + ')' : ''}`);
    }

    await context.dispose();
    return transcript;
  }

  const conversationResults = [];
  for (const conv of GENERALIZATION_CONVERSATIONS) {
    const transcript = await runConversation(conv);
    conversationResults.push({ id: conv.id, shape: conv.shape, transcript });
  }

  await model.dispose();
  fs.writeFileSync(path.join(OUT_DIR, 'gemma-4-e4b-knowledge-model-generalization.json'), JSON.stringify({
    candidate: { id: 'gemma-4-e4b-knowledge-model-generalization', label: 'Gemma-4-E4B-it (Candidate C, exploratory generalization set)' },
    loadMs, conversations: conversationResults,
  }, null, 2));
  console.log('\n[kmgen] Done.');

  fs.rmSync(FIXTURE_USER_DATA, { recursive: true, force: true });
  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('[kmgen] FATAL:', err);
    app.exit(1);
  });
});
