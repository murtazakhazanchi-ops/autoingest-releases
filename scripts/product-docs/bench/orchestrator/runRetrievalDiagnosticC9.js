#!/usr/bin/env node
'use strict';

// ASK AUTOINGEST — CHECKPOINT 9, PHASE 11. EXPERIMENTAL.
// Runs retrievalDiagnosticC9.js's 42 single-turn queries, ONE fresh
// conversation per query (no cross-query context contamination), and
// measures, per query:
//   - candidatePresent: did the expected real id appear among ANY
//     search_autoingest result this turn (deterministic candidate-
//     generation recall -- independent of what the LLM did with it)?
//   - selectedCorrect: did the model's own subsequent read_autoingest/
//     capability_status calls resolve (via the handle map) to the
//     expected real id (same-LLM discrimination)?
//   - usedCatalogueFallback: did search fall back to the full-catalogue
//     browse this turn?
//   - invalidHandleAttempts: count of invalid_handle protocol errors hit.
//   - falseUnsupported: for queries with a real expected id, did the
//     final text contain a capability-negative claim (crude heuristic,
//     manually re-checked in the report, not trusted blindly)?
//
// Env: ORCH_MODEL_PATH (required), ORCH_OUT (required).

const path = require('path');
const fs = require('fs');
const build = require('../../lib/build');
const { buildEngineContext } = require('../../lib/knowledgeEngine');
const { loadEngine, createConversation } = require('./engineC9');
const queries = require('./retrievalDiagnosticC9');

const NEGATIVE_CLAIM_RE = /\b(?:doesn'?t|does not|can'?t|cannot|isn'?t|is not|no support|not supported|not available|not currently (?:supported|available))\b/i;

async function main() {
  const modelPath = process.env.ORCH_MODEL_PATH;
  const outPath = process.env.ORCH_OUT;
  if (!modelPath || !outPath) {
    console.error('ORCH_MODEL_PATH and ORCH_OUT are required.');
    process.exit(1);
  }

  console.log('[retrieval-diag] building knowledge context...');
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  console.log(`[retrieval-diag] loading model ${modelPath}...`);
  const engine = await loadEngine({ modelPath });

  const results = [];
  for (const q of queries) {
    console.log(`[retrieval-diag] === ${q.id} (${q.category}): "${q.query}" ===`);
    const session = await createConversation(engine, ctx, built);
    const t0 = Date.now();
    const turn = await session.converse(q.query);
    const ms = Date.now() - t0;

    const searchCalls = turn.toolCalls.filter((c) => c.tool === 'search_autoingest');
    const readOrStatusCalls = turn.toolCalls.filter((c) => c.tool === 'read_autoingest' || c.tool === 'capability_status');
    const invalidHandleAttempts = turn.toolCalls.filter((c) => c.result && c.result.error === 'invalid_handle').length;
    const usedCatalogueFallback = searchCalls.some((c) => (c.result.results || []).some((r) => r.matchType === 'catalogue'));

    let candidatePresent = null;
    if (q.expected) {
      candidatePresent = searchCalls.some((c) => {
        const handles = (c.result.results || []).map((r) => r.handle);
        return handles.some((h) => session.handleSession.resolve(h) === q.expected);
      });
    }

    let selectedCorrect = null;
    if (q.expected) {
      selectedCorrect = readOrStatusCalls.some((c) => session.handleSession.resolve(c.args && c.args.handle) === q.expected);
    }

    const falseUnsupported = q.expected ? NEGATIVE_CLAIM_RE.test(turn.finalText) : null;

    console.log(`  (${ms}ms, tools=${turn.toolCalls.length}) candidatePresent=${candidatePresent} selectedCorrect=${selectedCorrect} catalogueFallback=${usedCatalogueFallback} invalidHandles=${invalidHandleAttempts}`);
    console.log(`  answer: ${turn.finalText.slice(0, 140)}`);

    results.push({
      id: q.id, query: q.query, category: q.category, expected: q.expected,
      candidatePresent, selectedCorrect, usedCatalogueFallback, invalidHandleAttempts,
      falseUnsupportedHeuristic: falseUnsupported,
      toolCalls: turn.toolCalls, finalText: turn.finalText, ms, validation: turn.validation,
    });
    await session.dispose();
  }

  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`[retrieval-diag] wrote ${outPath}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[retrieval-diag] FATAL', err);
  process.exit(1);
});
