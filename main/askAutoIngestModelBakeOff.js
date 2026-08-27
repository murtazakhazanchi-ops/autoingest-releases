'use strict';

// main/askAutoIngestModelBakeOff.js — ASK AUTOINGEST CONVERSATIONAL MODEL
// BAKE-OFF (Product Owner checkpoint, 2026-08-24). Benchmark-only, not
// wired into production, not shipped.
//
// Runs the REAL, UNMODIFIED C8 architecture (conversationalAsk.js,
// conversationState.js, clarificationDecision.js, answerWithAuthority.js,
// semanticRetrievalService.js) for every case in
// scripts/product-docs/bench/bakeoff/acceptanceSet.js, once per candidate
// model. The only thing that changes between runs is which model answers
// -- injected via trySynthesize()'s existing options.synthesize/
// options.formulateClarification hooks (the same injection point
// answerWithSynthesis.test.js already uses for fixtures), never a
// modification to retrieval, clarification decision, conversation state,
// or authority. Every candidate receives the exact same serialized
// evidence (scripts/product-docs/bench/bakeoff/evidenceSerializer.js) and
// the exact same system contract (below, verbatim from the checkpoint).
//
// Run with: node_modules/.bin/electron main/askAutoIngestModelBakeOff.js [outDir]

const path = require('path');
const fs = require('fs');
const os = require('os');

const FIXTURE_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-c8-bakeoff-userdata-'));
const OUT_DIR = process.argv[2] || path.join(os.tmpdir(), 'ai-c8-bakeoff-results');
fs.mkdirSync(OUT_DIR, { recursive: true });

const { app } = require('electron');
app.setPath('userData', FIXTURE_USER_DATA);

const PRODUCT_DOCS = path.join(__dirname, '..', 'scripts', 'product-docs');
const build = require(path.join(PRODUCT_DOCS, 'lib', 'build.js'));
const { buildEngineContext } = require(path.join(PRODUCT_DOCS, 'lib', 'knowledgeEngine.js'));
const { buildEvidencePackageForAuthorityAnswer } = require(path.join(PRODUCT_DOCS, 'lib', 'askSynthesis', 'evidencePackage.js'));
const { askConversational } = require(path.join(PRODUCT_DOCS, 'lib', 'conversationalAsk.js'));
const CS = require(path.join(PRODUCT_DOCS, 'lib', 'conversationState.js'));
const { trySynthesize } = require(path.join(PRODUCT_DOCS, 'lib', 'answerWithSynthesis.js'));
const { serializeEvidence } = require(path.join(PRODUCT_DOCS, 'bench', 'bakeoff', 'evidenceSerializer.js'));
const { CASES } = require(path.join(PRODUCT_DOCS, 'bench', 'bakeoff', 'acceptanceSet.js'));

// ============================================================
// Section 8 of the checkpoint, verbatim. Same for every model.
// ============================================================
const SYSTEM_CONTRACT = `You are Ask AutoIngest, the built-in assistant for AutoIngest.

Answer the operator naturally and directly using only the supplied AutoIngest information.

You may select, omit, reorganize and simplify the supplied evidence.

Do not mention internal implementation details unless the operator asks a technical question.

If the user's situation is ambiguous and the supplied candidate information does not establish one interpretation safely, ask one concise follow-up question instead of guessing.

Do not invent AutoIngest features, buttons, workflows, steps, paths or capability status.

For HOW_TO questions, use the supplied steps to actually explain what the operator should do.

For troubleshooting, prioritize the practical recovery steps and relevant warnings.

Keep simple questions concise. Use more detail only when useful.`;

const MODEL_CANDIDATES = [
  { id: 'phi-4-mini', label: 'Phi-4-mini-instruct (baseline)', file: path.join(__dirname, '..', 'scripts', 'product-docs', 'bench', 'models', 'phi-4-mini-instruct-Q4_K_M.gguf') },
  { id: 'qwen3-0.6b', label: 'Qwen3-0.6B-Instruct', file: '/Users/funun_pa/.claude/jobs/6629ed37/tmp/models/qwen3-0.6b-instruct-Q4_K_M.gguf' },
  { id: 'qwen3-1.7b', label: 'Qwen3-1.7B-Instruct', file: '/Users/funun_pa/.claude/jobs/6629ed37/tmp/models/qwen3-1.7b-instruct-Q4_K_M.gguf' },
  { id: 'qwen3.5-4b', label: 'Qwen3.5-4B-Instruct', file: path.join(__dirname, '..', 'scripts', 'product-docs', 'bench', 'models', 'qwen3.5-4b-instruct-Q4_K_M.gguf') },
  { id: 'qwen2.5-7b', label: 'Qwen2.5-7B-Instruct', file: path.join(__dirname, '..', 'scripts', 'product-docs', 'bench', 'models', 'Qwen2.5-7B-Instruct-Q4_K_M.gguf') },
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
  console.log(`[bakeoff] real embedding retrieval ready: ${hasEmbedding}`);
  const semanticRetrievalService = hasEmbedding ? require('../services/semanticRetrieval/semanticRetrievalService') : null;

  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  const { getLlama, LlamaChatSession, QwenChatWrapper } = await import('node-llama-cpp');
  const llama = await getLlama();

  const onlyModel = process.env.BAKEOFF_MODEL_ID || null;
  const candidates = onlyModel ? MODEL_CANDIDATES.filter((m) => m.id === onlyModel) : MODEL_CANDIDATES;
  const caseLimit = process.env.BAKEOFF_CASE_LIMIT ? Number(process.env.BAKEOFF_CASE_LIMIT) : null;
  const casesToRun = caseLimit ? CASES.slice(0, caseLimit) : CASES;

  for (const candidate of candidates) {
    if (!fs.existsSync(candidate.file)) {
      console.log(`[bakeoff] SKIP ${candidate.id} -- file not found: ${candidate.file}`);
      continue;
    }
    console.log(`\n[bakeoff] ===== ${candidate.label} (${candidate.id}) =====`);
    const loadT0 = Date.now();
    const model = await llama.loadModel({ modelPath: candidate.file });
    const loadMs = Date.now() - loadT0;
    console.log(`[bakeoff] loaded in ${loadMs}ms, size=${(model.size / 1e6).toFixed(0)}MB, trainContext=${model.trainContextSize}`);

    // Diagnostic finding, this run: the Qwen family's own chat template
    // defaults to "auto" chain-of-thought mode (a real, documented Qwen3+
    // feature, not a node-llama-cpp bug) -- for a moderately long
    // evidence-plus-instructions prompt like this bake-off's, the model
    // routinely spent the ENTIRE maxTokens budget on invisible thinking
    // content and never emitted a visible answer at all (confirmed
    // directly: qwen3.5-4b returned an EMPTY final answer for 43/50 turns
    // in an earlier run of this exact harness, before this fix).
    // QwenChatWrapper's own `thoughts: "discourage"` option (a genuine,
    // documented chat-template-level setting, not a per-model prompt
    // rewrite) pre-fills an empty <think></think> block, matching this
    // checkpoint's own allowed-changes exception: "unless the runtime/chat
    // template requires a minimal formatting difference". Confirmed fix
    // directly: the same QMZ prompt that returned "" at maxTokens=400
    // returned a clean, natural, un-leaked answer in 1.5s once this was
    // applied. Applied uniformly to every Qwen-family candidate (the
    // architecture check mirrors QwenChatWrapper's own supported-
    // architecture list) -- never a Qwen-specific INSTRUCTION change, only
    // this one template-level setting; Phi keeps its own auto-resolved
    // chat wrapper, untouched.
    const isQwenFamily = /^qwen/i.test(candidate.id);
    const chatWrapper = isQwenFamily ? new QwenChatWrapper({ thoughts: 'discourage' }) : 'auto';

    // Stateless-per-call generation, matching the real production
    // discipline (each trySynthesize() call is independent -- the model
    // never carries its own growing chat history across turns; the C8
    // conversation-state/retrieval layer is what carries context forward,
    // unchanged, real, in askConversational() below).
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

    function makeOptions(caseCategory) {
      return {
        semanticTopK: semanticRetrievalService ? (q) => semanticRetrievalService.productionSemanticTopK(q) : undefined,
        synthesize: async (pkg) => {
          const includeTechnical = caseCategory === 'TECHNICAL';
          const evidenceText = serializeEvidence(pkg.question, pkg, { includeTechnical });
          const { text, latencyMs } = await generateFn(SYSTEM_CONTRACT, evidenceText);
          return { answer: text, capabilityStatus: pkg.capabilityStatus, sourceIds: [], steps: [], warnings: [], refused: false, __latencyMs: latencyMs, __evidenceText: evidenceText };
        },
        formulateClarification: async ({ missingFactLabel, candidateTitles, conversationSummary }) => {
          const prompt = `The operator's request is ambiguous. You need to ask them: ${missingFactLabel}.\nPossible options, in the operator's own words: ${candidateTitles.join(', ')}.\n${conversationSummary ? `Conversation so far: ${conversationSummary}` : ''}\n\nAsk ONE natural, concise clarifying question that helps the operator pick between these.`;
          const { text, latencyMs } = await generateFn(SYSTEM_CONTRACT, prompt);
          return { question: text.trim().replace(/^"|"$/g, ''), __latencyMs: latencyMs };
        },
      };
    }

    const caseResults = [];
    for (const kase of casesToRun) {
      let state = CS.createConversation();
      const turnResults = [];
      for (let i = 0; i < kase.turns.length; i++) {
        const message = kase.turns[i];
        const options = makeOptions(kase.category);
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
        turnResults.push({
          turnIndex: i,
          message,
          ms,
          error: errored,
          kind: response ? response.kind : null,
          clarificationText: response && response.kind === 'clarification' ? response.text : null,
          clarificationChoices: response && response.kind === 'clarification' ? response.choices : null,
          topicChanged: response && response.topicChanged || false,
          finalAnswer: response && response.kind === 'final' ? {
            classification: response.answer.classification,
            capabilityStatus: response.answer.capabilityStatus,
            matchQuality: response.answer.matchQuality,
            directAnswer: response.answer.directAnswer,
            steps: response.answer.steps,
            limitations: response.answer.limitations,
            synthesis: response.answer.synthesis,
          } : null,
        });
        console.log(`[bakeoff] ${candidate.id} :: ${kase.id} turn${i} (${ms}ms) :: ${response ? response.kind : 'ERROR'}`);
      }
      caseResults.push({ id: kase.id, category: kase.category, turns: kase.turns, expect: kase.expect, results: turnResults });
    }

    await model.dispose();

    fs.writeFileSync(path.join(OUT_DIR, `${candidate.id}.json`), JSON.stringify({ candidate, loadMs, cases: caseResults }, null, 2));
    console.log(`[bakeoff] wrote ${candidate.id}.json`);
  }

  console.log(`\n[bakeoff] Done. Results in ${OUT_DIR}`);
  fs.rmSync(FIXTURE_USER_DATA, { recursive: true, force: true });
  app.exit(0);
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('[bakeoff] FATAL:', err);
    app.exit(1);
  });
});
