#!/usr/bin/env node
'use strict';

// ASK AUTOINGEST — CHECKPOINT 11. EXPERIMENTAL. Plain-Node CLI runner.
//
// Env:
//   ORCH_SET          module name in this directory (required)
//   ORCH_OUT          output JSON path (required)
//   ORCH_MODEL_PATH   path to the Qwen3.5-4B GGUF (required)
//
// Model and wrapper are fixed this checkpoint (Qwen3.5-4B, variation 3.5)
// -- no ORCH_WRAPPER_KEY, since testing another model is explicitly out of
// scope. MODEL_LOAD_COUNT is instrumented and logged, matching every prior
// checkpoint's own proof discipline.

const path = require('path');
const fs = require('fs');
const build = require('../../lib/build');
const { buildEngineContext } = require('../../lib/knowledgeEngine');
const { loadEngine, createConversation } = require('./engineC11');

async function main() {
  const setName = process.env.ORCH_SET;
  const outPath = process.env.ORCH_OUT;
  const modelPath = process.env.ORCH_MODEL_PATH;
  if (!setName || !outPath || !modelPath) {
    console.error('ORCH_SET, ORCH_OUT, and ORCH_MODEL_PATH are required.');
    process.exit(1);
  }
  const conversations = require(path.join(__dirname, setName));

  console.log('[orchestrator-c11] building knowledge context...');
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  console.log(`[orchestrator-c11] loading model ${modelPath}...`);
  let modelLoadCount = 0;
  const engine = await loadEngine({ modelPath });
  modelLoadCount += 1;
  console.log(`[orchestrator-c11] MODEL_LOAD_COUNT=${modelLoadCount} (must be exactly 1)`);

  const results = [];
  for (const conv of conversations) {
    console.log(`[orchestrator-c11] === ${conv.id} ===`);
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
        draftText: result.draftText, originalFinding: result.originalFinding,
      });
    }
    await session.dispose();
    results.push({ id: conv.id, transcript });
  }

  fs.writeFileSync(outPath, JSON.stringify({ modelLoadCount, results }, null, 2));
  console.log(`[orchestrator-c11] wrote ${outPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[orchestrator-c11] FATAL', err);
  process.exit(1);
});
