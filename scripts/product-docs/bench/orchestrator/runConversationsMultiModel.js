#!/usr/bin/env node
'use strict';

// ASK AUTOINGEST — CHECKPOINT 8. EXPERIMENTAL.
// CLI runner for engineMultiModel.js -- structurally identical to
// runConversations.js, extended only with ORCH_WRAPPER_KEY to select the
// candidate model's chat wrapper (qwen3 | llama31 | mistral).

const path = require('path');
const fs = require('fs');
const build = require('../../lib/build');
const { buildEngineContext } = require('../../lib/knowledgeEngine');
const { loadEngine, createConversation } = require('./engineMultiModel');

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

  console.log(`[orchestrator-mm] building knowledge context...`);
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  console.log(`[orchestrator-mm] loading model ${modelPath} (wrapper=${wrapperKey})...`);
  const engine = await loadEngine({
    modelPath, wrapperKey,
    embeddingModelDir: process.env.ORCH_EMBEDDING_MODEL_DIR || null,
    semanticIndexDir: process.env.ORCH_SEMANTIC_INDEX_DIR || null,
  });
  console.log(`[orchestrator-mm] model ready. semantic=${!!engine.semanticTopK}`);

  const results = [];
  for (const conv of conversations) {
    console.log(`[orchestrator-mm] === ${conv.id} ===`);
    const { converse, dispose } = await createConversation(engine, ctx);
    const transcript = [];
    for (const userMessage of conv.turns) {
      const t0 = Date.now();
      let turnResult;
      try {
        turnResult = await converse(userMessage);
      } catch (err) {
        turnResult = {
          finalText: null, toolCalls: [], capped: false, totalMs: Date.now() - t0,
          validation: { ok: false, findings: [{ severity: 'HARD_SAFETY', code: 'exception', detail: String(err && err.stack || err) }] },
          stopReason: null, malformedToolCalls: 0, emptyFinal: true, exceptionDuringPrompt: String(err && err.stack || err),
        };
      }
      console.log(`  "${userMessage.slice(0, 50)}" -> ${turnResult.toolCalls.length} tool call(s), ${turnResult.totalMs}ms, ok=${turnResult.validation.ok}, stopReason=${turnResult.stopReason}${turnResult.regenerated ? `, regenerated=${turnResult.regenerationOutcome}` : ''}${turnResult.completionContinuations ? `, continuations=${turnResult.completionContinuations}` : ''}${turnResult.protocolArtifactsStripped ? `, PROTOCOL_STRIPPED` : ''}${turnResult.emptyFinal ? `, EMPTY_FINAL` : ''}${turnResult.malformedToolCalls ? `, MALFORMED=${turnResult.malformedToolCalls}` : ''}`);
      transcript.push({ role: 'user', text: userMessage });
      transcript.push({
        role: 'assistant', text: turnResult.finalText, toolCalls: turnResult.toolCalls, capped: turnResult.capped, totalMs: turnResult.totalMs,
        validation: turnResult.validation, regenerated: !!turnResult.regenerated, regenerationOutcome: turnResult.regenerationOutcome || null,
        completionContinuations: turnResult.completionContinuations || 0, protocolArtifactsStripped: !!turnResult.protocolArtifactsStripped,
        stopReason: turnResult.stopReason || null, malformedToolCalls: turnResult.malformedToolCalls || 0, emptyFinal: !!turnResult.emptyFinal,
        exceptionDuringPrompt: turnResult.exceptionDuringPrompt || null,
      });
    }
    await dispose();
    results.push({ id: conv.id, transcript });
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ set: setName, modelPath, wrapperKey, results }, null, 2));
  console.log(`[orchestrator-mm] wrote ${outPath}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
