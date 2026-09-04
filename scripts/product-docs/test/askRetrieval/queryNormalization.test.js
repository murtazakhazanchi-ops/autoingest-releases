#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/askRetrieval/queryNormalization.test.js
// Ask AutoIngest — Stage 1 deterministic retrieval foundation, Section 16.
// Pure unit tests for lib/askRetrieval/queryNormalization.js. No model, no
// KB build, no filesystem access -- fast and fully deterministic.

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const { normalizeQuery } = require('../../lib/askRetrieval/queryNormalization');
const { keywordsFrom } = require('../../lib/textKeywords');

async function main() {
  const { t, summarize } = createRunner();

  await t('empty string normalizes to an empty token list', () => {
    assert.deepEqual(normalizeQuery(''), []);
  });

  await t('whitespace-only query normalizes to an empty token list', () => {
    assert.deepEqual(normalizeQuery('   \t\n  '), []);
  });

  await t('non-string input is coerced defensively to an empty token list, never throws', () => {
    assert.deepEqual(normalizeQuery(undefined), []);
    assert.deepEqual(normalizeQuery(null), []);
    assert.deepEqual(normalizeQuery(42), []);
    assert.deepEqual(normalizeQuery({}), []);
    assert.deepEqual(normalizeQuery(['does', 'not', 'crash']), []);
  });

  await t('case-folds before tokenizing', () => {
    assert.deepEqual(normalizeQuery('Memory Card'), normalizeQuery('MEMORY card'));
  });

  await t('punctuation is treated as a token separator', () => {
    const tokens = normalizeQuery('memory-card, plugged-in?!');
    assert.ok(tokens.includes('memory'));
    assert.ok(tokens.includes('card'));
    assert.ok(tokens.includes('plugged'));
  });

  await t('unusual/repeated punctuation does not crash and still yields tokens', () => {
    assert.doesNotThrow(() => normalizeQuery('???...!!!---___===+++'));
    assert.doesNotThrow(() => normalizeQuery('a??b!!c--d__e'));
    const tokens = normalizeQuery('archive##root$$resolution');
    assert.ok(tokens.length > 0);
  });

  await t('known Unicode boundary: non-ASCII letters are treated as separators (matches keywordsFrom, not a new divergence)', () => {
    // Documented limitation (see queryNormalization.js header): "café"
    // tokenizes as "caf" because the shared tokenizer's split pattern is
    // [^a-z0-9]+. Asserted here so any future change to the shared
    // tokenizer is caught by this test rather than silently drifting.
    assert.deepEqual(normalizeQuery('café'), keywordsFrom('café'));
    assert.deepEqual(normalizeQuery('café'), ['caf']);
  });

  await t('is byte-for-byte the same tokenization the corpus documents use (single source of truth, no drift)', () => {
    const sample = 'Does AutoIngest automatically detect a memory card being plugged in?';
    assert.deepEqual(normalizeQuery(sample), keywordsFrom(sample));
  });

  await t('deterministic: repeated calls on the same input return identical, order-stable output', () => {
    const a = normalizeQuery('Source Detection for memory cards and external drives');
    const b = normalizeQuery('Source Detection for memory cards and external drives');
    assert.deepEqual(a, b);
  });

  await t('output tokens are de-duplicated and alphabetically sorted (inherited from keywordsFrom, not reimplemented here)', () => {
    const tokens = normalizeQuery('card card card memory memory');
    assert.deepEqual(tokens, ['card', 'memory']);
    const sorted = [...tokens].sort();
    assert.deepEqual(tokens, sorted);
  });

  summarize('askRetrieval/queryNormalization.test.js');
}

main();
