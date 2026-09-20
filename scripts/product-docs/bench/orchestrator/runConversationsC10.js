#!/usr/bin/env node
'use strict';

// ASK AUTOINGEST — CHECKPOINT 10. EXPERIMENTAL. Plain-Node CLI runner.
//
// Env:
//   ORCH_SET          module name in this directory (required)
//   ORCH_OUT          output JSON path (required)
//   ORCH_MODEL_PATH   path to the candidate GGUF (required)
//   ORCH_WRAPPER_KEY  key into engineC10.js's CHAT_WRAPPER_FACTORIES: 'qwen35' or 'qwen3' (required)
//
// No embedding-model env vars exist here at all -- engineC10.loadEngine()
// has no parameter capable of loading a second model. MODEL_LOAD_COUNT is
// instrumented and logged, matching runConversationsC9.js's own proof.

const path = require('path');
const fs = require('fs');
const build = require('../../lib/build');
const { buildEngineContext } = require('../../lib/knowledgeEngine');
const { loadEngine, createConversation } = require('./engineC10');

async function main() {
  const setName = process.env.ORCH_SET;
  const outPath = process.env.ORCH_OUT;
  const modelPath = process.env.ORCH_MODEL_PATH;
  const wrapperKey = process.env.ORCH_WRAPPER_KEY;
  if (!setName || !outPath || !modelPath || !wrapperKey) {
    console.error('ORCH_SET, ORCH_OUT, ORCH_MODEL_PATH, and ORCH_WRAPPER_KEY are required.');
    process.exit(1);
  }
  const conversations = require(path.join(__dirname, setName));

  console.log('[orchestrator-c10] building knowledge context...');
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  console.log(`[orchestrator-c10] loading model ${modelPath} (wrapper=${wrapperKey})...`);
  let modelLoadCount = 0;
  const engine = await loadEngine({ modelPath, wrapperKey });
  modelLoadCount += 1;
  console.log(`[orchestrator-c10] MODEL_LOAD_COUNT=${modelLoadCount} (must be exactly 1)`);

  const results = [];
  for (const conv of conversations) {
    console.log(`[orchestrator-c10] === ${conv.id} ===`);
    const session = await createConversation(engine, ctx, built);
    const transcript = [];
    for (const userText of conv.turns) {
      transcript.push({ role: 'user', text: userText });
      const t0 = Date.now();
      const result = await session.converse(userText);
      const ms = Date.now() - t0;
      console.log(`  turn (${ms}ms, tools=${result.toolCalls.length}, cont=${result.completionContinuations}${result.regenerated ? ', REGEN:' + result.regenerationOutcome : ''}${result.exceptionDuringPrompt ? ', EXCEPTION' : ''}): ${(result.finalText || '').slice(0, 100)}`);
      transcript.push({
        role: 'assistant', text: result.finalText, toolCalls: result.toolCalls,
        capped: result.capped, totalMs: result.totalMs, validation: result.validation,
        regenerated: result.regenerated, regenerationOutcome: result.regenerationOutcome,
        completionContinuations: result.completionContinuations,
        protocolArtifactsStripped: result.protocolArtifactsStripped,
        handleMapSize: result.handleMapSize, stopReason: result.stopReason,
        exceptionDuringPrompt: result.exceptionDuringPrompt,
        malformedToolCalls: result.malformedToolCalls, emptyFinal: result.emptyFinal,
      });
    }
    await session.dispose();
    results.push({ id: conv.id, transcript });
  }

  fs.writeFileSync(outPath, JSON.stringify({ modelLoadCount, wrapperKey, results }, null, 2));
  console.log(`[orchestrator-c10] wrote ${outPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[orchestrator-c10] FATAL', err);
  process.exit(1);
});
