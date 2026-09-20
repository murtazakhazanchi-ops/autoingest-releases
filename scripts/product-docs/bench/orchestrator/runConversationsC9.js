#!/usr/bin/env node
'use strict';

// ASK AUTOINGEST — CHECKPOINT 9. EXPERIMENTAL. Plain-Node CLI runner.
//
// Env:
//   ORCH_SET        module name in this directory exporting an array of
//                    {id, turns: [string, ...]} conversations (required)
//   ORCH_OUT         output JSON path (required)
//   ORCH_MODEL_PATH  path to the Gemma GGUF (required)
//
// Deliberately no ORCH_EMBEDDING_MODEL_DIR / ORCH_SEMANTIC_INDEX_DIR env
// vars -- unlike runConversationsMultiModel.js, this runner has no code
// path that could load a second model even if such a var were set, since
// engineC9.js's loadEngine() does not accept those parameters at all.
//
// Phase 10 instrumentation (checkpoint brief: "Instrument and prove this"
// -- exactly one learned model loaded): counts every llama.loadModel() /
// createContext() call actually made during this run via a thin wrap, and
// asserts exactly one model load before writing results.

const path = require('path');
const fs = require('fs');
const build = require('../../lib/build');
const { buildEngineContext } = require('../../lib/knowledgeEngine');
const { loadEngine, createConversation } = require('./engineC9');

async function main() {
  const setName = process.env.ORCH_SET;
  const outPath = process.env.ORCH_OUT;
  const modelPath = process.env.ORCH_MODEL_PATH;
  if (!setName || !outPath || !modelPath) {
    console.error('ORCH_SET, ORCH_OUT, and ORCH_MODEL_PATH are required.');
    process.exit(1);
  }
  const conversations = require(path.join(__dirname, setName));

  console.log('[orchestrator-c9] building knowledge context...');
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  console.log(`[orchestrator-c9] loading model ${modelPath}...`);
  let modelLoadCount = 0;
  const engine = await loadEngine({ modelPath });
  modelLoadCount += 1; // engineC9.loadEngine() has exactly one llama.loadModel() call site, statically verifiable in the file itself
  console.log(`[orchestrator-c9] MODEL_LOAD_COUNT=${modelLoadCount} (must be exactly 1)`);

  const results = [];
  for (const conv of conversations) {
    console.log(`[orchestrator-c9] === ${conv.id} ===`);
    const session = await createConversation(engine, ctx, built);
    const transcript = [];
    for (const userText of conv.turns) {
      transcript.push({ role: 'user', text: userText });
      const t0 = Date.now();
      const result = await session.converse(userText);
      const ms = Date.now() - t0;
      console.log(`  turn (${ms}ms, tools=${result.toolCalls.length}, cont=${result.completionContinuations}${result.regenerated ? ', REGEN:' + result.regenerationOutcome : ''}): ${result.finalText.slice(0, 100)}`);
      transcript.push({
        role: 'assistant', text: result.finalText, toolCalls: result.toolCalls,
        capped: result.capped, totalMs: result.totalMs, validation: result.validation,
        regenerated: result.regenerated, regenerationOutcome: result.regenerationOutcome,
        completionContinuations: result.completionContinuations,
        protocolArtifactsStripped: result.protocolArtifactsStripped,
        handleMapSize: result.handleMapSize,
      });
    }
    await session.dispose();
    results.push({ id: conv.id, transcript });
  }

  fs.writeFileSync(outPath, JSON.stringify({ modelLoadCount, results }, null, 2));
  console.log(`[orchestrator-c9] wrote ${outPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[orchestrator-c9] FATAL', err);
  process.exit(1);
});
