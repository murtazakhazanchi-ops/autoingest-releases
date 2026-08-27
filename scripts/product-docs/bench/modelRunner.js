// Ask AutoIngest Phase A -- experimental, non-production local model runner.
// ESM (node-llama-cpp 3.x is ESM-only) -- kept entirely inside bench/, never
// imported by any production scripts/product-docs/lib/ file. Wraps
// node-llama-cpp's grammar/JSON-schema-constrained generation so a candidate
// answer is structurally guaranteed to match synthesisSchema.js's shape
// before safetyValidation.js's CONTENT checks ever run.

import { getLlama, LlamaChatSession } from 'node-llama-cpp';

let llamaSingleton = null;
async function llama() {
  if (!llamaSingleton) llamaSingleton = await getLlama();
  return llamaSingleton;
}

export async function loadModel(modelPath) {
  const l = await llama();
  const t0 = performance.now();
  const model = await l.loadModel({ modelPath });
  const loadMs = performance.now() - t0;
  return { model, loadMs, gpu: l.gpu };
}

export async function unloadModel(handle) {
  await handle.model.dispose();
}

// Generates one structured, schema-constrained answer. Each call creates
// and disposes its own context/sequence -- questions in a benchmark are
// independent single-turn Q&A, never a continued conversation, so no
// context/history is intentionally carried between questions (this also
// sidesteps LlamaContext's finite `sequencesLeft` pool -- see
// getSequence()'s own doc comment -- rather than risking exhaustion across
// a multi-question run). Returns raw text, parsed JSON (or null +
// parseError if the model somehow still produced invalid JSON -- grammar
// constraint makes this rare but not theoretically impossible across all
// decoding paths), and timing/throughput metrics.
// `repeatPenalty` is optional and defaults to node-llama-cpp's own default
// (undefined -- unchanged behavior for every prior benchmark run). Added
// during the Final Recall-Closure & Model-Capacity Checkpoint after
// Qwen2.5-7B-Instruct-Q4_K_M was observed to fall into a token-repetition
// decoding loop (repeatedly emitting valid `evidenceHandles` array elements
// until truncated, producing invalid JSON) on 10/56 gold cases -- a
// model-specific decoding pathology, not a prompt or evidence problem. This
// is a general, model-agnostic sampling parameter, not a per-case hack.
export async function generateStructured(handle, systemPrompt, userPrompt, jsonSchema, { maxTokens = 700, repeatPenalty } = {}) {
  const l = await llama();
  const grammar = await l.createGrammarForJsonSchema(jsonSchema);
  const context = await handle.model.createContext({ sequences: 1 });
  const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt });

  let firstTokenMs = null;
  const t0 = performance.now();
  let tokenCount = 0;
  const raw = await session.prompt(userPrompt, {
    grammar,
    maxTokens,
    ...(repeatPenalty ? { repeatPenalty } : {}),
    onToken: (tokens) => {
      if (firstTokenMs === null) firstTokenMs = performance.now() - t0;
      tokenCount += tokens.length;
    },
  });
  const totalMs = performance.now() - t0;
  await context.dispose();

  let parsed = null;
  let parseError = null;
  try {
    parsed = grammar.parse(raw);
  } catch (err) {
    try {
      parsed = JSON.parse(raw);
    } catch (err2) {
      parseError = err2.message;
    }
  }

  return {
    raw,
    parsed,
    parseError,
    timing: {
      loadMs: handle.loadMs,
      firstTokenMs,
      totalMs,
      approxOutputTokens: tokenCount,
      approxTokensPerSecond: tokenCount > 0 ? (tokenCount / (totalMs / 1000)) : null,
    },
  };
}

export async function memoryUsageMB() {
  const mem = process.memoryUsage();
  return { rss: Math.round(mem.rss / 1024 / 1024), external: Math.round(mem.external / 1024 / 1024) };
}
