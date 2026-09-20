#!/usr/bin/env node
'use strict';

// ASK AUTOINGEST — CHECKPOINT 13. EXPERIMENTAL. Plain-Node CLI runner.
// Identical to runConversationsC12.js except it loads engineC13.js.
//
// Env:
//   ORCH_SET          module name in this directory (required)
//   ORCH_OUT          output JSON path (required)
//   ORCH_MODEL_PATH   path to the Qwen3.5-4B GGUF (required)
//   ORCH_REPEAT_INDEX optional integer, appended to each conversation's id
//                      for stochastic testing so repeats of the same
//                      conversation produce distinct, traceable output ids
//                      without mutating the frozen input set.

const path = require('path');
const fs = require('fs');
const build = require('../../lib/build');
const { buildEngineContext } = require('../../lib/knowledgeEngine');
const { loadEngine, createConversation } = require('./engineC13');

async function main() {
  const setName = process.env.ORCH_SET;
  const outPath = process.env.ORCH_OUT;
  const modelPath = process.env.ORCH_MODEL_PATH;
  const repeatIndex = process.env.ORCH_REPEAT_INDEX;
  if (!setName || !outPath || !modelPath) {
    console.error('ORCH_SET, ORCH_OUT, and ORCH_MODEL_PATH are required.');
    process.exit(1);
  }
  const conversations = require(path.join(__dirname, setName));

  console.log('[orchestrator-c13] building knowledge context...');
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  console.log(`[orchestrator-c13] loading model ${modelPath}...`);
  let modelLoadCount = 0;
  const t0Load = Date.now();
  const engine = await loadEngine({ modelPath });
  const loadMs = Date.now() - t0Load;
  modelLoadCount += 1;
  console.log(`[orchestrator-c13] MODEL_LOAD_COUNT=${modelLoadCount} (must be exactly 1), loadMs=${loadMs}`);

  const results = [];
  for (const conv of conversations) {
    const outId = repeatIndex ? `${conv.id}__rep${repeatIndex}` : conv.id;
    console.log(`[orchestrator-c13] === ${outId} ===`);
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
    results.push({ id: outId, sourceId: conv.id, transcript });
  }

  fs.writeFileSync(outPath, JSON.stringify({ modelLoadCount, loadMs, results }, null, 2));
  console.log(`[orchestrator-c13] wrote ${outPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[orchestrator-c13] FATAL', err);
  process.exit(1);
});
