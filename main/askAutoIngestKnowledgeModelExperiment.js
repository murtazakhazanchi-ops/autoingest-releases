'use strict';

// main/askAutoIngestKnowledgeModelExperiment.js — ASK AUTOINGEST
// KNOWLEDGE MODEL EXPERIMENT, CANDIDATE C (Product Owner checkpoint,
// 2026-08-25 continuation). Benchmark-only, not wired into production, not
// shipped. Runs ONLY Gemma-4-E4B-it, through ONLY the Candidate C path.
// Candidate A's result is already on disk (frozen conversation-acceptance
// trial, 13/19) and Candidate B's result is already on disk
// (main/askAutoIngestArchitectureExperiment.js's own frozen run, 15/19) --
// both reused unchanged, neither re-run, neither touched.
//
// Reuses, UNCHANGED: everything main/askAutoIngestArchitectureExperiment.js
// reused (conversationState.js, answerQuestionWithAuthority,
// assessPrimaryFit, decideClarification, trySynthesize,
// buildEvidencePackageForAuthorityAnswer, real BGE semantic retrieval, the
// same 19 frozen conversations (conversationTrial.js), the same Gemma
// chat-template runtime config (Gemma4ChatWrapper({reasoning:false})), the
// same SYSTEM_CONTRACT, and Candidate B's own real chat-history replay
// architecture (one LlamaChatSession per CONVERSATION, setChatHistory()
// replaying the operator's actual prior turns before each new prompt).
//
// THE ONLY THING that differs from Candidate B's harness
// (askAutoIngestArchitectureExperiment.js): the orchestrator is
// candidateC/orchestrator.js's askConversationalKnowledgeModel() (a
// modified COPY of experimentalConversation.js, not a mutation -- B's own
// file is untouched), and options.synthesize routes evidence through
// candidateC/evidence.js's buildKnowledgeModelEvidence() (Knowledge Model
// first, Candidate B's own evidence-shaping as a disclosed fallback)
// instead of always calling serializeExperimentalEvidence() directly.
//
// Run with: node_modules/.bin/electron main/askAutoIngestKnowledgeModelExperiment.js [outDir]

const path = require('path');
const fs = require('fs');
const os = require('os');

const FIXTURE_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-c8-kmexp-userdata-'));
const OUT_DIR = process.argv[2] || path.join(os.tmpdir(), 'ai-c8-kmexp-results');
fs.mkdirSync(OUT_DIR, { recursive: true });

const { app } = require('electron');
app.setPath('userData', FIXTURE_USER_DATA);

const PRODUCT_DOCS = path.join(__dirname, '..', 'scripts', 'product-docs');
const build = require(path.join(PRODUCT_DOCS, 'lib', 'build.js'));
const { buildEngineContext } = require(path.join(PRODUCT_DOCS, 'lib', 'knowledgeEngine.js'));
const CS = require(path.join(PRODUCT_DOCS, 'lib', 'conversationState.js'));
const { askConversationalKnowledgeModel } = require(path.join(PRODUCT_DOCS, 'bench', 'candidateC', 'orchestrator.js'));
const { buildKnowledgeModelEvidence } = require(path.join(PRODUCT_DOCS, 'bench', 'candidateC', 'evidence.js'));
const { CONVERSATIONS } = require(path.join(PRODUCT_DOCS, 'bench', 'bakeoff', 'conversationTrial.js'));
const kmStats = require(path.join(PRODUCT_DOCS, 'bench', 'knowledgeModel', 'index.js')).stats;

// FROZEN, byte-identical to Candidate A/B's own SYSTEM_CONTRACT. The
// checkpoint holds the model, chat template, and generation configuration
// fixed across A/B/C -- this text is part of that fixed configuration, not
// a Candidate-C-specific tuning knob.
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
  console.log(`[kmexp] Knowledge Model loaded: ${kmStats.total} records (${kmStats.forensicVerified} forensic-verified, ${kmStats.registryReshaped} registry-reshaped)`);

  const hasEmbedding = await setUpRealEmbeddingModel();
  console.log(`[kmexp] real embedding retrieval ready: ${hasEmbedding}`);
  const semanticRetrievalService = hasEmbedding ? require('../services/semanticRetrieval/semanticRetrievalService') : null;

  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  const { getLlama, LlamaChatSession, Gemma4ChatWrapper } = await import('node-llama-cpp');
  const llama = await getLlama();

  console.log('[kmexp] loading Gemma-4-E4B-it...');
  const loadT0 = Date.now();
  const model = await llama.loadModel({ modelPath: GEMMA_FILE });
  const loadMs = Date.now() - loadT0;
  console.log(`[kmexp] loaded in ${loadMs}ms`);

  const chatWrapper = new Gemma4ChatWrapper({ reasoning: false }); // identical to A/B's own runtime config

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
            matchQuality: response.answer.matchQuality, steps: response.answer.steps, limitations: response.answer.limitations,
            synthesis: response.answer.synthesis, topicChanged: !!response.topicChanged,
            experimentalHedgeAfterRepeatedAmbiguity: !!response.experimentalHedgeAfterRepeatedAmbiguity,
          },
          evidenceMeta: lastEvidenceMeta,
        });
      }
      console.log(`[kmexp] ${conv.id} :: "${message.slice(0, 40)}" (${ms}ms) :: ${errored ? 'ERROR' : response.kind} :: evidence=${lastEvidenceMeta ? lastEvidenceMeta.source : 'n/a'}${lastEvidenceMeta && lastEvidenceMeta.kmRecordId ? ' (' + lastEvidenceMeta.kmRecordId + ')' : ''}`);
    }

    await context.dispose();
    return transcript;
  }

  const convLimit = process.env.KMEXP_CONV_LIMIT ? Number(process.env.KMEXP_CONV_LIMIT) : null;
  const conversationsToRun = convLimit ? CONVERSATIONS.slice(0, convLimit) : CONVERSATIONS;

  const conversationResults = [];
  for (const conv of conversationsToRun) {
    const transcript = await runConversation(conv);
    conversationResults.push({ id: conv.id, category: conv.category, transcript });
  }

  await model.dispose();
  fs.writeFileSync(path.join(OUT_DIR, 'gemma-4-e4b-knowledge-model.json'), JSON.stringify({
    candidate: { id: 'gemma-4-e4b-knowledge-model', label: 'Gemma-4-E4B-it (Candidate C: Knowledge Model architecture)', file: GEMMA_FILE },
    knowledgeModelStats: kmStats,
    loadMs, conversations: conversationResults,
  }, null, 2));
  console.log('\n[kmexp] Done. Wrote gemma-4-e4b-knowledge-model.json to', OUT_DIR);

  fs.rmSync(FIXTURE_USER_DATA, { recursive: true, force: true });
  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('[kmexp] FATAL:', err);
    app.exit(1);
  });
});
