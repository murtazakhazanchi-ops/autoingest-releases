'use strict';

// main/askAutoIngestConversationTrial.js — ASK AUTOINGEST NATURAL
// CONVERSATION MODEL ACCEPTANCE TRIAL (Product Owner checkpoint,
// 2026-08-25). Benchmark-only, not wired into production, not shipped.
//
// Deliberately reuses, UNCHANGED, everything the prior model-bake-off
// checkpoint already built and froze: the real C8 pipeline
// (conversationalAsk.js/conversationState.js/clarificationDecision.js/
// answerWithAuthority.js/real BGE semantic retrieval), the SAME
// evidenceSerializer.js, and the SAME SYSTEM_CONTRACT text. The only
// things this file adds are: a NEW acceptance set of full multi-turn
// conversations (conversationTrial.js) in place of the prior isolated-
// question acceptance set, a NEW candidate list (Phi and Qwen3-0.6B
// excluded per this checkpoint's own instruction -- Phi already rejected
// by the Product Owner, 0.6B already shown weaker in the prior bake-off),
// and full verbatim transcript capture (every user/assistant turn, not
// just scored metrics) for the required blind-review artifact.
//
// Run with: node_modules/.bin/electron main/askAutoIngestConversationTrial.js [outDir]

const path = require('path');
const fs = require('fs');
const os = require('os');

const FIXTURE_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-c8-trial-userdata-'));
const OUT_DIR = process.argv[2] || path.join(os.tmpdir(), 'ai-c8-trial-results');
fs.mkdirSync(OUT_DIR, { recursive: true });

const { app } = require('electron');
app.setPath('userData', FIXTURE_USER_DATA);

const PRODUCT_DOCS = path.join(__dirname, '..', 'scripts', 'product-docs');
const build = require(path.join(PRODUCT_DOCS, 'lib', 'build.js'));
const { buildEngineContext } = require(path.join(PRODUCT_DOCS, 'lib', 'knowledgeEngine.js'));
const { askConversational } = require(path.join(PRODUCT_DOCS, 'lib', 'conversationalAsk.js'));
const CS = require(path.join(PRODUCT_DOCS, 'lib', 'conversationState.js'));
const { serializeEvidence } = require(path.join(PRODUCT_DOCS, 'bench', 'bakeoff', 'evidenceSerializer.js'));
const { CONVERSATIONS } = require(path.join(PRODUCT_DOCS, 'bench', 'bakeoff', 'conversationTrial.js'));

// FROZEN, byte-identical to main/askAutoIngestModelBakeOff.js's own
// SYSTEM_CONTRACT (Section 8 of the original bake-off checkpoint,
// verbatim) -- this trial does not re-tune it for any candidate.
const SYSTEM_CONTRACT = `You are Ask AutoIngest, the built-in assistant for AutoIngest.

Answer the operator naturally and directly using only the supplied AutoIngest information.

You may select, omit, reorganize and simplify the supplied evidence.

Do not mention internal implementation details unless the operator asks a technical question.

If the user's situation is ambiguous and the supplied candidate information does not establish one interpretation safely, ask one concise follow-up question instead of guessing.

Do not invent AutoIngest features, buttons, workflows, steps, paths or capability status.

For HOW_TO questions, use the supplied steps to actually explain what the operator should do.

For troubleshooting, prioritize the practical recovery steps and relevant warnings.

Keep simple questions concise. Use more detail only when useful.`;

// Candidate list per this checkpoint's own instruction: Phi excluded
// (already rejected by the Product Owner for conversational quality --
// retained only as historical context, not retested), Qwen3-0.6B
// excluded (already shown measurably weaker in the prior bake-off).
// Gemma-4-E4B added as the one additional current, license-compatible,
// 3B-8B-range candidate with a credible, disclosed reason to test it
// (Apache 2.0, explicit node-llama-cpp Gemma4ChatWrapper support, and
// documented strength at structured, natural instruction-following).
const MODEL_CANDIDATES = [
  { id: 'qwen3-1.7b', label: 'Qwen3-1.7B-Instruct', file: '/Users/funun_pa/.claude/jobs/6629ed37/tmp/models/qwen3-1.7b-instruct-Q4_K_M.gguf', family: 'qwen' },
  { id: 'qwen3.5-4b', label: 'Qwen3.5-4B-Instruct', file: path.join(__dirname, '..', 'scripts', 'product-docs', 'bench', 'models', 'qwen3.5-4b-instruct-Q4_K_M.gguf'), family: 'qwen' },
  { id: 'qwen2.5-7b', label: 'Qwen2.5-7B-Instruct', file: path.join(__dirname, '..', 'scripts', 'product-docs', 'bench', 'models', 'Qwen2.5-7B-Instruct-Q4_K_M.gguf'), family: 'qwen' },
  { id: 'gemma-4-e4b', label: 'Gemma-4-E4B-it', file: '/Users/funun_pa/.claude/jobs/6629ed37/tmp/models/gemma-4-E4B-it-Q4_K_M.gguf', family: 'gemma' },
];

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
  console.log(`[trial] real embedding retrieval ready: ${hasEmbedding}`);
  const semanticRetrievalService = hasEmbedding ? require('../services/semanticRetrieval/semanticRetrievalService') : null;

  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  const { getLlama, LlamaChatSession, QwenChatWrapper, Gemma4ChatWrapper } = await import('node-llama-cpp');
  const llama = await getLlama();

  const onlyModel = process.env.TRIAL_MODEL_ID || null;
  const candidates = onlyModel ? MODEL_CANDIDATES.filter((m) => m.id === onlyModel) : MODEL_CANDIDATES;
  const convLimit = process.env.TRIAL_CONV_LIMIT ? Number(process.env.TRIAL_CONV_LIMIT) : null;
  const conversationsToRun = convLimit ? CONVERSATIONS.slice(0, convLimit) : CONVERSATIONS;

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate.file)) {
      console.log(`[trial] SKIP ${candidate.id} -- file not found: ${candidate.file}`);
      continue;
    }
    console.log(`\n[trial] ===== ${candidate.label} (${candidate.id}) =====`);
    const loadT0 = Date.now();
    const model = await llama.loadModel({ modelPath: candidate.file });
    const loadMs = Date.now() - loadT0;
    console.log(`[trial] loaded in ${loadMs}ms, size=${(model.size / 1e6).toFixed(0)}MB`);

    // Disclosed runtime configuration (Section 17: "runtime configuration
    // required merely to make a model operate correctly may be fixed
    // before the official frozen run, but must be disclosed"). Both the
    // Qwen and Gemma-4 chat-template families default to an internal
    // "thinking"/"reasoning" mode that, verified directly before this
    // trial began (same diagnostic technique the prior bake-off used for
    // Qwen), consumes the entire token budget on invisible reasoning
    // content for a prompt of this length, leaving an EMPTY visible
    // answer. Disabled uniformly for every candidate that has the option
    // -- never a per-candidate content/instruction change, only a
    // template-level decoding setting each family's own runtime wrapper
    // exposes for exactly this purpose.
    let chatWrapper = 'auto';
    if (candidate.family === 'qwen') chatWrapper = new QwenChatWrapper({ thoughts: 'discourage' });
    if (candidate.family === 'gemma') chatWrapper = new Gemma4ChatWrapper({ reasoning: false });

    async function generateFn(systemPrompt, userPrompt) {
      const context = await model.createContext({ contextSize: Math.min(model.trainContextSize, 4096) });
      try {
        const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt, chatWrapper });
        const t0 = Date.now();
        const text = await session.prompt(userPrompt, { maxTokens: 600 });
        return { text: text.trim(), latencyMs: Date.now() - t0 };
      } finally {
        await context.dispose();
      }
    }

    const options = {
      semanticTopK: semanticRetrievalService ? (q) => semanticRetrievalService.productionSemanticTopK(q) : undefined,
      synthesize: async (pkg) => {
        const evidenceText = serializeEvidence(pkg.question, pkg, { includeTechnical: false });
        const { text, latencyMs } = await generateFn(SYSTEM_CONTRACT, evidenceText);
        return { answer: text, capabilityStatus: pkg.capabilityStatus, sourceIds: [], steps: [], warnings: [], refused: false, __latencyMs: latencyMs };
      },
      formulateClarification: async ({ missingFactLabel, candidateTitles, conversationSummary }) => {
        const prompt = `The operator's request is ambiguous. You need to ask them: ${missingFactLabel}.\nPossible options, in the operator's own words: ${candidateTitles.join(', ')}.\n${conversationSummary ? `Conversation so far: ${conversationSummary}` : ''}\n\nAsk ONE natural, concise clarifying question that helps the operator pick between these.`;
        const { text, latencyMs } = await generateFn(SYSTEM_CONTRACT, prompt);
        return { question: text.trim().replace(/^"|"$/g, ''), __latencyMs: latencyMs };
      },
    };

    const conversationResults = [];
    for (const conv of conversationsToRun) {
      let state = CS.createConversation();
      const transcript = [];
      for (const message of conv.turns) {
        transcript.push({ role: 'user', text: message });
        const t0 = Date.now();
        let response, errored = null;
        try {
          const result = await askConversational(state, message, ctx, options);
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
            role: 'assistant',
            text: response.answer.directAnswer,
            kind: 'final',
            ms,
            meta: {
              classification: response.answer.classification,
              capabilityStatus: response.answer.capabilityStatus,
              matchQuality: response.answer.matchQuality,
              steps: response.answer.steps,
              limitations: response.answer.limitations,
              synthesis: response.answer.synthesis,
              topicChanged: !!response.topicChanged,
            },
          });
        }
        console.log(`[trial] ${candidate.id} :: ${conv.id} :: "${message.slice(0, 40)}" (${ms}ms) :: ${errored ? 'ERROR' : response.kind}`);
      }
      conversationResults.push({ id: conv.id, category: conv.category, transcript });
    }

    await model.dispose();

    fs.writeFileSync(path.join(OUT_DIR, `${candidate.id}.json`), JSON.stringify({ candidate, loadMs, conversations: conversationResults }, null, 2));
    console.log(`[trial] wrote ${candidate.id}.json`);
  }

  console.log(`\n[trial] Done. Results in ${OUT_DIR}`);
  fs.rmSync(FIXTURE_USER_DATA, { recursive: true, force: true });
  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('[trial] FATAL:', err);
    app.exit(1);
  });
});
