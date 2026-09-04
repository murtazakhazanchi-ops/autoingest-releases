#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/askRetrieval/fusion.test.js
// Ask AutoIngest — Stage 1 deterministic retrieval foundation, Section 16.
// Pure unit tests for lib/askRetrieval/fusion.js's Reciprocal Rank Fusion.
// No model, no KB build -- fast and fully deterministic.

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const { reciprocalRankFusion, reciprocalRankFusionScored } = require('../../lib/askRetrieval/fusion');

async function main() {
  const { t, summarize } = createRunner();

  await t('empty weighted-lists array fuses to an empty result', () => {
    assert.deepEqual(reciprocalRankFusion([]), []);
  });

  await t('a single channel is returned in its own rank order', () => {
    const fused = reciprocalRankFusion([[['B', 'A', 'C'], 1]]);
    assert.deepEqual(fused, ['B', 'A', 'C']);
  });

  await t('an id present in multiple channels accumulates score across all of them', () => {
    // 'X' ranked #1 in both channels should outrank 'Y' ranked #1 in only one.
    const fused = reciprocalRankFusion([
      [['X', 'Y'], 1],
      [['X', 'Z'], 1],
    ]);
    assert.equal(fused[0], 'X');
  });

  await t('deterministic tie-breaking: equal fused score resolves by id ascending', () => {
    // Two ids that never co-occur, each rank #1 in one equally-weighted
    // channel of the same length -- identical RRF contribution, so the
    // required deterministic tie-break (id ascending) must decide order.
    const fused = reciprocalRankFusion([
      [['zeta'], 1],
      [['alpha'], 1],
    ]);
    assert.deepEqual(fused, ['alpha', 'zeta']);
  });

  await t('a higher channel weight increases that channel\'s influence on the fused order', () => {
    // 'lowWeightWinner' ranks #1 in a weight-1 channel; 'highWeightWinner'
    // ranks #1 in a weight-5 channel -- the heavier channel's #1 must win.
    const fused = reciprocalRankFusion([
      [['lowWeightWinner'], 1],
      [['highWeightWinner'], 5],
    ]);
    assert.equal(fused[0], 'highWeightWinner');
  });

  await t('non-array entries are ignored gracefully rather than throwing', () => {
    assert.doesNotThrow(() => reciprocalRankFusion([[null, 1], [undefined, 2], [['A'], 1]]));
    const fused = reciprocalRankFusion([[null, 1], [['A'], 1]]);
    assert.deepEqual(fused, ['A']);
  });

  await t('rrfK shifts absolute score magnitude but preserves relative rank order for a simple case', () => {
    const withDefaultK = reciprocalRankFusion([[['A', 'B'], 1]]);
    const withSmallK = reciprocalRankFusion([[['A', 'B'], 1]], 1);
    assert.deepEqual(withDefaultK, ['A', 'B']);
    assert.deepEqual(withSmallK, ['A', 'B']);
  });

  await t('reciprocalRankFusionScored returns the same order as reciprocalRankFusion, with monotonically non-increasing scores', () => {
    const weightedLists = [
      [['A', 'B', 'C'], 3],
      [['C', 'A'], 1],
    ];
    const idsOnly = reciprocalRankFusion(weightedLists);
    const scored = reciprocalRankFusionScored(weightedLists);
    assert.deepEqual(scored.map((s) => s.id), idsOnly);
    for (let i = 1; i < scored.length; i++) {
      assert.ok(scored[i - 1].score >= scored[i].score, 'scores must be sorted descending');
    }
  });

  await t('deterministic: repeated calls with identical input produce identical output', () => {
    const weightedLists = [[['A', 'B', 'C'], 3], [['C', 'A'], 1]];
    const first = reciprocalRankFusion(weightedLists);
    const second = reciprocalRankFusion(weightedLists);
    assert.deepEqual(first, second);
  });

  summarize('askRetrieval/fusion.test.js');
}

main();
