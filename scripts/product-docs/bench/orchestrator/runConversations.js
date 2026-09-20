#!/usr/bin/env node
'use strict';

// ASK AUTOINGEST — ARCHITECTURE-RESET CHECKPOINT (Phase 10/11). EXPERIMENTAL.
// Plain-Node CLI runner for the isolated orchestrator prototype. Not wired
// to Electron, production IPC, or conversationalAsk.js.
//
// Usage:
//   ORCH_SET=devSet ORCH_OUT=/tmp/dev.json node runConversations.js
//
// Env:
//   ORCH_SET               module name in this directory exporting an array
//                           of {id, turns: [string, ...]} conversations (required)
//   ORCH_OUT                output JSON path (required)
//   ORCH_MODEL_PATH          path to the Gemma GGUF (required)
//   ORCH_EMBEDDING_MODEL_DIR directory containing the bge-small embedding
//                             GGUF (optional -- omit to run deterministic-
//                             only search, as Checkpoints 5/6 did)
//   ORCH_SEMANTIC_INDEX_DIR   directory to build/cache the semantic index in
//                             (required if ORCH_EMBEDDING_MODEL_DIR is set)

const path = require('path');
const fs = require('fs');
const build = require('../../lib/build');
const { buildEngineContext } = require('../../lib/knowledgeEngine');
const { loadEngine, createConversation } = require('./engine');

async function main() {
  const setName = process.env.ORCH_SET;
  const outPath = process.env.ORCH_OUT;
  const modelPath = process.env.ORCH_MODEL_PATH;
  if (!setName || !outPath || !modelPath) {
    console.error('ORCH_SET, ORCH_OUT, and ORCH_MODEL_PATH are required.');
    process.exit(1);
  }
  const conversations = require(path.join(__dirname, setName));

  console.log(`[orchestrator] building knowledge context...`);
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  console.log(`[orchestrator] loading model ${modelPath}...`);
  const engine = await loadEngine({
    modelPath,
    embeddingModelDir: process.env.ORCH_EMBEDDING_MODEL_DIR || null,
    semanticIndexDir: process.env.ORCH_SEMANTIC_INDEX_DIR || null,
  });
  console.log(`[orchestrator] model ready. semantic=${!!engine.semanticTopK}`);

  const results = [];
  for (const conv of conversations) {
    console.log(`[orchestrator] === ${conv.id} ===`);
    const { converse, dispose } = await createConversation(engine, ctx);
    const transcript = [];
    for (const userMessage of conv.turns) {
      const t0 = Date.now();
      let turnResult;
      try {
        turnResult = await converse(userMessage);
      } catch (err) {
        turnResult = { finalText: null, toolCalls: [], capped: false, totalMs: Date.now() - t0, validation: { ok: false, findings: [{ severity: 'HARD_SAFETY', code: 'exception', detail: String(err && err.stack || err) }] } };
      }
      console.log(`  "${userMessage.slice(0, 50)}" -> ${turnResult.toolCalls.length} tool call(s), ${turnResult.totalMs}ms, ok=${turnResult.validation.ok}${turnResult.regenerated ? `, regenerated=${turnResult.regenerationOutcome}` : ''}${turnResult.completionContinuations ? `, continuations=${turnResult.completionContinuations}` : ''}${turnResult.protocolArtifactsStripped ? `, PROTOCOL_STRIPPED` : ''}`);
      transcript.push({
        role: 'user', text: userMessage,
      });
      transcript.push({
        role: 'assistant', text: turnResult.finalText, toolCalls: turnResult.toolCalls, capped: turnResult.capped, totalMs: turnResult.totalMs,
        validation: turnResult.validation, regenerated: !!turnResult.regenerated, regenerationOutcome: turnResult.regenerationOutcome || null,
        completionContinuations: turnResult.completionContinuations || 0, protocolArtifactsStripped: !!turnResult.protocolArtifactsStripped,
      });
    }
    await dispose();
    results.push({ id: conv.id, transcript });
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ set: setName, modelPath, results }, null, 2));
  console.log(`[orchestrator] wrote ${outPath}`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
