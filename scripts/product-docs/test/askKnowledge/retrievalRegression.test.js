#!/usr/bin/env node
'use strict';
// Run with: node scripts/product-docs/test/askKnowledge/retrievalRegression.test.js
// Ask AutoIngest — Stage 2, Section 25 (retrieval regression). Stage 2
// adds a new knowledge/tool layer on top of Stage 1's retrieval -- this
// gate confirms, permanently and mechanically (not just measured once by
// hand), that nothing about Stage 2's own additions shifted retrieval
// behavior. Since Stage 2's chosen Decision-enrichment policy (DEC-023) is
// "off" -- byte-identical to Stage 1's own certified configuration -- this
// test's required floor is IDENTICAL to Stage 1's own retrieval250Gate.
// A future change to DEC-023's policy must update this test deliberately,
// not silently drift.

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const build = require('../../lib/build');
const { buildEngineContext } = require('../../lib/knowledgeEngine');
const { buildKnowledgeContext } = require('../../lib/askKnowledge/index');
const { search } = require('../../lib/askRetrieval/retrieval');
const retrieval250 = require('../../bench/orchestrator/retrieval250');
const holdout131 = require('../../bench/orchestrator/retrievalHoldout100');

const REQUIRED_MINIMUM = { top1: 64.1, top3: 80.2, top5: 87.3, top10: 93.7, mrr: 0.740 };
const TOLERANCE = { pct: 0.15, mrr: 0.002 };

function scoreAgainst(built, ctx, index, benchmarkItems) {
  const scored = benchmarkItems.filter((b) => b.style !== 'no-answer');
  let top1 = 0, top3 = 0, top5 = 0, top10 = 0, mrrSum = 0;
  for (const item of scored) {
    const result = search(built, ctx, index, item.q);
    const ids = result.candidates.map((c) => c.id);
    let rank = -1;
    for (let i = 0; i < ids.length; i++) { if (item.expect.includes(ids[i])) { rank = i + 1; break; } }
    if (rank === 1) top1++;
    if (rank >= 1 && rank <= 3) top3++;
    if (rank >= 1 && rank <= 5) top5++;
    if (rank >= 1 && rank <= 10) top10++;
    if (rank > 0) mrrSum += 1 / rank;
  }
  const n = scored.length;
  return { n, top1: (100 * top1) / n, top3: (100 * top3) / n, top5: (100 * top5) / n, top10: (100 * top10) / n, mrr: mrrSum / n };
}

async function main() {
  const { t, summarize } = createRunner();
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);
  // The EXACT retrieval index Stage 2's own buildKnowledgeContext() uses --
  // not a separately-constructed index -- so this test proves what search
  // through the real Stage 2 knowledge layer actually does, not merely
  // what Stage 1's own module can do in isolation.
  const { retrievalIndex } = buildKnowledgeContext(built);

  await t('Stage 2\'s own retrieval index meets or exceeds every retrieval250 required minimum (DEC-023 policy: no decision-text enrichment)', () => {
    const r = scoreAgainst(built, ctx, retrievalIndex, retrieval250);
    console.log(`    [retrieval250 via Stage 2] Top-1=${r.top1.toFixed(1)}% Top-3=${r.top3.toFixed(1)}% Top-5=${r.top5.toFixed(1)}% Top-10=${r.top10.toFixed(1)}% MRR=${r.mrr.toFixed(3)}`);
    assert.ok(r.top1 >= REQUIRED_MINIMUM.top1 - TOLERANCE.pct);
    assert.ok(r.top3 >= REQUIRED_MINIMUM.top3 - TOLERANCE.pct);
    assert.ok(r.top5 >= REQUIRED_MINIMUM.top5 - TOLERANCE.pct);
    assert.ok(r.top10 >= REQUIRED_MINIMUM.top10 - TOLERANCE.pct);
    assert.ok(r.mrr >= REQUIRED_MINIMUM.mrr - TOLERANCE.mrr);
  });

  await t('Stage 2\'s own retrieval index reproduces Stage 1\'s certified retrieval250 numbers essentially exactly (no drift introduced by Stage 2)', () => {
    const r = scoreAgainst(built, ctx, retrievalIndex, retrieval250);
    assert.ok(Math.abs(r.top1 - 64.1) < 0.2);
    assert.ok(Math.abs(r.top5 - 87.3) < 0.2);
    assert.ok(Math.abs(r.top10 - 93.7) < 0.2);
  });

  await t('Stage 2\'s own retrieval index scores the independent holdout131 consistently with Stage 1\'s own recorded numbers', () => {
    const r = scoreAgainst(built, ctx, retrievalIndex, holdout131);
    console.log(`    [holdout131 via Stage 2] Top-1=${r.top1.toFixed(1)}% Top-3=${r.top3.toFixed(1)}% Top-5=${r.top5.toFixed(1)}% Top-10=${r.top10.toFixed(1)}% MRR=${r.mrr.toFixed(3)}`);
    assert.ok(Math.abs(r.top5 - 89.3) < 0.2);
    assert.ok(Math.abs(r.top1 - 61.2) < 0.2);
  });

  await t('deterministic: repeated scoring against Stage 2\'s own index produces identical results', () => {
    const a = scoreAgainst(built, ctx, retrievalIndex, retrieval250);
    const b = scoreAgainst(built, ctx, retrievalIndex, retrieval250);
    assert.deepEqual(a, b);
  });

  summarize('askKnowledge/retrievalRegression.test.js');
}

main();
