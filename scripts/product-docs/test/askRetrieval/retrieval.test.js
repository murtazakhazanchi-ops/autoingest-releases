#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/askRetrieval/retrieval.test.js
// Ask AutoIngest — Stage 1 deterministic retrieval foundation, Section 16.
// Integration tests for lib/askRetrieval/retrieval.js's public search()
// boundary, run against the REAL canonical Knowledge Base (build.assemble())
// -- no model, no Qwen, no BGE, no network, no GPU. Fast (index build is a
// few hundred ms; see the performance measurement script for exact numbers).

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const build = require('../../lib/build');
const { buildEngineContext } = require('../../lib/knowledgeEngine');
const { search, buildRetrievalIndex } = require('../../lib/askRetrieval/retrieval');

async function main() {
  const { t, summarize } = createRunner();

  const { built } = build.assemble();
  const ctx = buildEngineContext(built);
  const index = buildRetrievalIndex(built, ctx);

  await t('a well-formed query returns ranked candidates with the documented shape', () => {
    const result = search(built, ctx, index, 'sequencing workspace numbered sequences');
    assert.equal(result.note, 'ok');
    assert.ok(result.candidates.length > 0);
    const top = result.candidates[0];
    assert.equal(typeof top.id, 'string');
    assert.ok(top.kind === 'feature' || top.kind === 'workflow');
    assert.equal(typeof top.title, 'string');
    assert.equal(top.rank, 1);
    assert.ok(Array.isArray(top.sourceChannels));
  });

  await t('empty query returns no candidates with note "empty_query", never throws', () => {
    const result = search(built, ctx, index, '');
    assert.deepEqual(result.candidates, []);
    assert.equal(result.note, 'empty_query');
  });

  await t('whitespace-only query returns no candidates with note "empty_query"', () => {
    const result = search(built, ctx, index, '   \t  ');
    assert.equal(result.note, 'empty_query');
  });

  await t('unusual punctuation / Unicode input never throws', () => {
    assert.doesNotThrow(() => search(built, ctx, index, '???!!! --- café memory card??'));
  });

  await t('a genuinely no-match gibberish query returns note "no_candidates" or an empty list, not a forced fallback', () => {
    const result = search(built, ctx, index, 'xylophone kangaroo submarine qqqqzzzz');
    assert.ok(result.note === 'no_candidates' || result.candidates.length === 0);
  });

  await t('candidate ids are never duplicated within a single result, even with channel overlap', () => {
    const result = search(built, ctx, index, 'import event archive folder');
    const ids = result.candidates.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate candidate id found in fused result');
  });

  await t('candidate ranks are contiguous starting at 1 and strictly increasing', () => {
    const result = search(built, ctx, index, 'checksum verification integrity');
    result.candidates.forEach((c, i) => assert.equal(c.rank, i + 1));
  });

  await t('deterministic: repeated identical calls return identical candidate lists and order', () => {
    const a = search(built, ctx, index, 'photographer write lock concurrent import');
    const b = search(built, ctx, index, 'photographer write lock concurrent import');
    assert.deepEqual(a, b);
  });

  await t('Section 11: multi-query fusion recovers a candidate a Qwen-style reformulation alone drops -- ' +
    'reproduces the documented PR1 finding for "memory card auto detect plug in"', () => {
    const originalWording = 'Does the app automatically notice a memory card being plugged in?';
    const modelReformulatedWording = 'memory card auto detect plug in';
    const TARGET_ID = 'AI-FEAT-011'; // Source Detection (Drives, DCIM, Sony PRIVATE)

    const reformulatedAlone = search(built, ctx, index, modelReformulatedWording);
    const reformulatedAloneIds = reformulatedAlone.candidates.map((c) => c.id);
    assert.ok(
      !reformulatedAloneIds.slice(0, 5).includes(TARGET_ID),
      'precondition check: the reformulated-only query must reproduce the known miss (target absent from top 5) for this test to be meaningful',
    );

    const fused = search(built, ctx, index, modelReformulatedWording, { alternateQuery: originalWording });
    const fusedIds = fused.candidates.map((c) => c.id);
    assert.ok(fusedIds.includes(TARGET_ID), 'fusing the original operator wording alongside the reformulation must recover the correct candidate');

    // Fusion must never discard the reformulated query's own candidates either.
    for (const id of reformulatedAloneIds.slice(0, 3)) {
      assert.ok(fusedIds.includes(id), `fusion must not silently drop a top reformulated-only candidate (${id})`);
    }
  });

  await t('an alternate query never introduces duplicate ids into the fused result', () => {
    const result = search(built, ctx, index, 'memory card auto detect plug in', {
      alternateQuery: 'Does the app automatically notice a memory card being plugged in?',
    });
    const ids = result.candidates.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  await t('a candidate found via the alternate query only is labeled with an "-alternate" source channel', () => {
    const result = search(built, ctx, index, 'memory card auto detect plug in', {
      alternateQuery: 'Does the app automatically notice a memory card being plugged in?',
    });
    const target = result.candidates.find((c) => c.id === 'AI-FEAT-011');
    assert.ok(target, 'expected target candidate must be present in the fused result');
    assert.ok(
      target.sourceChannels.includes('lexical-alternate') || target.sourceChannels.includes('bm25-alternate'),
      `expected an "-alternate" source channel, got: ${target.sourceChannels.join(',')}`,
    );
  });

  await t('an empty/whitespace-only alternateQuery is treated as absent, not as a second empty channel', () => {
    const withEmptyAlt = search(built, ctx, index, 'checksum verification', { alternateQuery: '   ' });
    const withoutAlt = search(built, ctx, index, 'checksum verification');
    assert.deepEqual(withEmptyAlt, withoutAlt);
  });

  await t('boundary contract: a candidate never carries operator-facing prose or a final-answer field -- only id/kind/title/rank/sourceChannels', () => {
    const result = search(built, ctx, index, 'archive root resolution');
    for (const c of result.candidates) {
      const keys = Object.keys(c).sort();
      assert.deepEqual(keys, ['id', 'kind', 'rank', 'sourceChannels', 'title']);
    }
  });

  summarize('askRetrieval/retrieval.test.js');
}

main();
