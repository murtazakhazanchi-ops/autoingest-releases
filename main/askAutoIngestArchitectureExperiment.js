'use strict';

// main/askAutoIngestArchitectureExperiment.js — ASK AUTOINGEST
// CONVERSATIONAL ARCHITECTURE A/B EXPERIMENT (Product Owner checkpoint,
// 2026-08-25). Benchmark-only, not wired into production, not shipped.
// Runs ONLY Gemma-4-E4B-it (per instruction), through ONLY the
// EXPERIMENTAL path -- the CONTROL result (current C8 + Gemma) is already
// on disk from the frozen conversation-acceptance-trial run
// (/Users/funun_pa/.claude/jobs/6629ed37/tmp/trial-results/gemma-4-e4b.json,
// 13/19) and is reused unchanged rather than re-run, since it is already
// "the exact same Gemma runtime/chat-template configuration" the
// checkpoint asks to hold fixed.
//
// Reuses, UNCHANGED: conversationState.js, answerQuestionWithAuthority,
// assessPrimaryFit, decideClarification, trySynthesize,
// buildEvidencePackageForAuthorityAnswer, real BGE semantic retrieval, the
// same 19 frozen conversations (conversationTrial.js), the same Gemma
// chat-template runtime config (Gemma4ChatWrapper({reasoning:false})) that
// produced the control's 13/19. The ONLY things that differ from the
// control harness (askAutoIngestConversationTrial.js): the orchestrator is
// experimentalConversation.js's askConversationalExperimental() (a
// modified COPY, not a mutation, of conversationalAsk.js -- production
// file untouched), the evidence is shaped by experimentalEvidence.js
// before serialization, and each model call carries a REAL replayed chat
// history (this turn's evidence attached to the operator's own actual
// words, not a flattened QUESTION field) instead of a fresh, stateless
// prompt every turn.
//
// Run with: node_modules/.bin/electron main/askAutoIngestArchitectureExperiment.js [outDir]

const path = require('path');
const fs = require('fs');
const os = require('os');

const FIXTURE_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-c8-archexp-userdata-'));
const OUT_DIR = process.argv[2] || path.join(os.tmpdir(), 'ai-c8-archexp-results');
fs.mkdirSync(OUT_DIR, { recursive: true });

const { app } = require('electron');
app.setPath('userData', FIXTURE_USER_DATA);

const PRODUCT_DOCS = path.join(__dirname, '..', 'scripts', 'product-docs');
const build = require(path.join(PRODUCT_DOCS, 'lib', 'build.js'));
const { buildEngineContext } = require(path.join(PRODUCT_DOCS, 'lib', 'knowledgeEngine.js'));
const CS = require(path.join(PRODUCT_DOCS, 'lib', 'conversationState.js'));
const { askConversationalExperimental } = require(path.join(PRODUCT_DOCS, 'bench', 'bakeoff', 'experimentalConversation.js'));
const { serializeExperimentalEvidence } = require(path.join(PRODUCT_DOCS, 'bench', 'bakeoff', 'experimentalEvidence.js'));
const { CONVERSATIONS } = require(path.join(PRODUCT_DOCS, 'bench', 'bakeoff', 'conversationTrial.js'));

// FROZEN, byte-identical to the control trial's own SYSTEM_CONTRACT.
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
  console.log(`[archexp] real embedding retrieval ready: ${hasEmbedding}`);
  const semanticRetrievalService = hasEmbedding ? require('../services/semanticRetrieval/semanticRetrievalService') : null;

  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  const { getLlama, LlamaChatSession, Gemma4ChatWrapper } = await import('node-llama-cpp');
  const llama = await getLlama();

  console.log('[archexp] loading Gemma-4-E4B-it...');
  const loadT0 = Date.now();
  const model = await llama.loadModel({ modelPath: GEMMA_FILE });
  const loadMs = Date.now() - loadT0;
  console.log(`[archexp] loaded in ${loadMs}ms`);

  const chatWrapper = new Gemma4ChatWrapper({ reasoning: false }); // identical to the control run's own runtime config

  // ONE session per CONVERSATION (not per turn) -- this is the whole point
  // of the experimental change: real chat memory persists across the
  // conversation's own turns, replayed via setChatHistory() with the
  // operator's actual words and the assistant's actual prior answers, not
  // reconstructed from a fresh context every call.
  async function runConversation(conv) {
    const context = await model.createContext({ contextSize: Math.min(model.trainContextSize, 8192) });
    const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt: SYSTEM_CONTRACT, chatWrapper });
    const baseHistory = session.getChatHistory();

    let state = CS.createConversation();
    let currentUserMessage = null; // set fresh before each askConversationalExperimental() call below; the closures read THIS, never the (still-stale, pre-this-turn) outer `state`, since options.synthesize/formulateClarification fire DURING that call, before its own returned state has propagated back out here.
    const transcript = [];

    async function generateFn(evidenceBlock, currentUserText) {
      // Deliberately reads the OUTER `state` here, not `currentUserMessage`
      // -- at the moment this fires, `state` is still last turn's state
      // (this turn's own user message hasn't been folded back in yet),
      // which is exactly the PRIOR-turns-only history we want to replay;
      // the current turn's own message is passed separately as
      // `currentUserText` below.
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

    const options = {
      semanticTopK: semanticRetrievalService ? (q) => semanticRetrievalService.productionSemanticTopK(q) : undefined,
      synthesize: async (pkg) => {
        const evidenceBlock = serializeExperimentalEvidence(pkg);
        const { text, latencyMs } = await generateFn(evidenceBlock, currentUserMessage);
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
      transcript.push({ role: 'user', text: message });
      const t0 = Date.now();
      let response, errored = null;
      try {
        const result = await askConversationalExperimental(state, message, ctx, options);
        state = result.state;
        response = result.response;
      } catch (err) {
        errored = String(err && err.stack || err);
      }
      const ms = Date.now() - t0;
      if (errored) {
        transcript.push({ role: 'assistant', text: `[ERROR: ${errored}]`, kind: 'error', ms });
      } else if (response.kind === 'clarification') {
        transcript.push({ role: 'assistant', text: response.text, kind: 'clarification', choices: response.choices, ms });
      } else {
        transcript.push({
          role: 'assistant', text: response.answer.directAnswer, kind: 'final', ms,
          meta: {
            classification: response.answer.classification, capabilityStatus: response.answer.capabilityStatus,
            matchQuality: response.answer.matchQuality, steps: response.answer.steps, limitations: response.answer.limitations,
            synthesis: response.answer.synthesis, topicChanged: !!response.topicChanged,
            experimentalHedgeAfterRepeatedAmbiguity: !!response.experimentalHedgeAfterRepeatedAmbiguity,
          },
        });
      }
      console.log(`[archexp] ${conv.id} :: "${message.slice(0, 40)}" (${ms}ms) :: ${errored ? 'ERROR' : response.kind}`);
    }

    await context.dispose();
    return transcript;
  }

  const convLimit = process.env.ARCHEXP_CONV_LIMIT ? Number(process.env.ARCHEXP_CONV_LIMIT) : null;
  const conversationsToRun = convLimit ? CONVERSATIONS.slice(0, convLimit) : CONVERSATIONS;

  const conversationResults = [];
  for (const conv of conversationsToRun) {
    const transcript = await runConversation(conv);
    conversationResults.push({ id: conv.id, category: conv.category, transcript });
  }

  await model.dispose();
  fs.writeFileSync(path.join(OUT_DIR, 'gemma-4-e4b-experimental.json'), JSON.stringify({
    candidate: { id: 'gemma-4-e4b-experimental', label: 'Gemma-4-E4B-it (experimental architecture)', file: GEMMA_FILE },
    loadMs, conversations: conversationResults,
  }, null, 2));
  console.log('\n[archexp] Done. Wrote gemma-4-e4b-experimental.json to', OUT_DIR);

  fs.rmSync(FIXTURE_USER_DATA, { recursive: true, force: true });
  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('[archexp] FATAL:', err);
    app.exit(1);
  });
});
