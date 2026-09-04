#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/askRetrieval/retrieval250Gate.test.js
// Ask AutoIngest — Stage 1 deterministic retrieval foundation, Section 17
// (the formal retrieval250 regression gate) plus the Section 13-vs-17
// forensic finding documented in this same run.
//
// Required minimum, frozen from Production Readiness Phase 1 (this file's
// own Section 2 baseline -- see docs/product/decisions/DEC-022 for the
// full writeup): Top-1 >= 64.1%, Top-3 >= 80.2%, Top-5 >= 87.3%,
// Top-10 >= 93.7%, MRR >= 0.740.
//
// CERTIFIED STAGE 1 CONFIGURATION: buildRetrievalIndex(built) called
// WITHOUT ctx (i.e. without Section 13's decision-text enrichment) is
// Stage 1's regression-gate baseline -- it reproduces the Production
// Readiness Phase 1 prototype's own numbers almost exactly (this is the
// PR1 reference point itself, not a new configuration being newly held to
// its own bar). This is the ONLY configuration this file enforces a hard
// floor on.
//
// Section 13's decision-text enrichment (buildRetrievalIndex(built, ctx))
// is measured here too, but NOT held to the same hard floor -- it is a
// genuine, understood, forensically-explained tradeoff (net +0.84pp Top-5,
// +1.27pp Top-10; net -0.84pp Top-1, -0.0021 MRR), reported transparently
// per Section 17's explicit "do not hide regressions through benchmark
// edits" instruction, and left as a documented, available, opt-in
// capability for Section 18-19's own general-improvement evaluation
// (against BOTH retrieval250 and the independent holdout) to decide
// whether it should become the default, not decided unilaterally here.

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const build = require('../../lib/build');
const { buildEngineContext } = require('../../lib/knowledgeEngine');
const { search, buildRetrievalIndex } = require('../../lib/askRetrieval/retrieval');
const retrieval250 = require('../../bench/orchestrator/retrieval250');

const REQUIRED_MINIMUM = {
  top1: 64.1,
  top3: 80.2,
  top5: 87.3,
  top10: 93.7,
  mrr: 0.740,
};
// Small tolerance for benchmark-composition/floating-point rounding only
// (the certified configuration is the literal PR1 reference point, so this
// is not "permission to regress" -- it exists because 237 discrete
// pass/fail queries cannot reproduce a percentage to infinite precision).
const TOLERANCE = { pct: 0.15, mrr: 0.002 };

function scoreAgainst(index, built, ctx, benchmarkItems) {
  const scored = benchmarkItems.filter((b) => b.style !== 'no-answer');
  let top1 = 0, top3 = 0, top5 = 0, top10 = 0, mrrSum = 0;
  const misses = [];
  for (const item of scored) {
    const result = search(built, ctx, index, item.q);
    const ids = result.candidates.map((c) => c.id);
    let rank = -1;
    for (let i = 0; i < ids.length; i++) {
      if (item.expect.includes(ids[i])) { rank = i + 1; break; }
    }
    if (rank === 1) top1++;
    if (rank >= 1 && rank <= 3) top3++;
    if (rank >= 1 && rank <= 5) top5++;
    if (rank >= 1 && rank <= 10) top10++;
    if (rank > 0) mrrSum += 1 / rank;
    else misses.push({ q: item.q, expect: item.expect, style: item.style });
  }
  const n = scored.length;
  return {
    n,
    top1: (100 * top1) / n,
    top3: (100 * top3) / n,
    top5: (100 * top5) / n,
    top10: (100 * top10) / n,
    mrr: mrrSum / n,
    misses,
  };
}

async function main() {
  const { t, summarize } = createRunner();

  const { built } = build.assemble();
  const ctx = buildEngineContext(built);

  await t('retrieval250 benchmark file is present and has the expected frozen shape (252 total, 237 scored non-"no-answer")', () => {
    assert.ok(Array.isArray(retrieval250));
    assert.equal(retrieval250.length, 252);
    const scored = retrieval250.filter((b) => b.style !== 'no-answer');
    assert.equal(scored.length, 237);
  });

  await t('CERTIFIED CONFIGURATION (no decision-text enrichment) meets or exceeds every Section 2/17 required minimum', () => {
    const index = buildRetrievalIndex(built); // ctx intentionally omitted
    const r = scoreAgainst(index, built, ctx, retrieval250);
    console.log(`    [gate] Top-1=${r.top1.toFixed(1)}% Top-3=${r.top3.toFixed(1)}% Top-5=${r.top5.toFixed(1)}% Top-10=${r.top10.toFixed(1)}% MRR=${r.mrr.toFixed(3)}`);
    assert.ok(r.top1 >= REQUIRED_MINIMUM.top1 - TOLERANCE.pct, `Top-1 ${r.top1.toFixed(1)}% below required ${REQUIRED_MINIMUM.top1}%`);
    assert.ok(r.top3 >= REQUIRED_MINIMUM.top3 - TOLERANCE.pct, `Top-3 ${r.top3.toFixed(1)}% below required ${REQUIRED_MINIMUM.top3}%`);
    assert.ok(r.top5 >= REQUIRED_MINIMUM.top5 - TOLERANCE.pct, `Top-5 ${r.top5.toFixed(1)}% below required ${REQUIRED_MINIMUM.top5}%`);
    assert.ok(r.top10 >= REQUIRED_MINIMUM.top10 - TOLERANCE.pct, `Top-10 ${r.top10.toFixed(1)}% below required ${REQUIRED_MINIMUM.top10}%`);
    assert.ok(r.mrr >= REQUIRED_MINIMUM.mrr - TOLERANCE.mrr, `MRR ${r.mrr.toFixed(3)} below required ${REQUIRED_MINIMUM.mrr}`);
  });

  await t('deterministic: the certified configuration scores identically across repeated full benchmark runs', () => {
    const indexA = buildRetrievalIndex(built);
    const indexB = buildRetrievalIndex(built);
    const rA = scoreAgainst(indexA, built, ctx, retrieval250);
    const rB = scoreAgainst(indexB, built, ctx, retrieval250);
    assert.deepEqual(rA, rB);
  });

  await t('FORENSIC RECORD (informational, not gated): decision-text enrichment (Section 13) measured against the same benchmark', () => {
    const indexNoCtx = buildRetrievalIndex(built);
    const indexWithCtx = buildRetrievalIndex(built, ctx);
    const withoutEnrichment = scoreAgainst(indexNoCtx, built, ctx, retrieval250);
    const withEnrichment = scoreAgainst(indexWithCtx, built, ctx, retrieval250);
    console.log(`    [forensic] without decision-text: Top-1=${withoutEnrichment.top1.toFixed(1)}% Top-5=${withoutEnrichment.top5.toFixed(1)}% Top-10=${withoutEnrichment.top10.toFixed(1)}% MRR=${withoutEnrichment.mrr.toFixed(3)}`);
    console.log(`    [forensic] with decision-text:    Top-1=${withEnrichment.top1.toFixed(1)}% Top-5=${withEnrichment.top5.toFixed(1)}% Top-10=${withEnrichment.top10.toFixed(1)}% MRR=${withEnrichment.mrr.toFixed(3)}`);
    // Not an assertion of "improvement" or "regression" -- just a
    // recorded, reproducible measurement pairing, per Section 17's "do
    // not hide regressions through benchmark edits" instruction. The only
    // hard requirement here is that both configurations produce a stable,
    // deterministic, non-crashing measurement.
    assert.ok(Number.isFinite(withoutEnrichment.mrr) && Number.isFinite(withEnrichment.mrr));
  });

  summarize('askRetrieval/retrieval250Gate.test.js');
}

main();
