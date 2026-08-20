#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/askSynthesis/synthesisBudget.test.js
// Phase C5.2. Pure unit tests for the synthesis output-length budget policy
// -- no model, no engine: proves the classification -> maxTokens mapping
// itself, which is the entire policy (see synthesisBudget.js's own header
// for the real-model measurements this is derived from).

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const { resolveMaxTokens, STANDARD_MAX_TOKENS, EXTENDED_MAX_TOKENS, EXTENDED_CLASSIFICATIONS } = require('../../lib/askSynthesis/synthesisBudget');

async function main() {
  const { t, summarize } = createRunner();

  await t('STANDARD_MAX_TOKENS is the unchanged, real-measured-sufficient C5/C5.1 committed value', () => {
    assert.equal(STANDARD_MAX_TOKENS, 500);
  });

  await t('EXTENDED_MAX_TOKENS covers the real observed maximum (1102) with margin, and fits the unmodified 45s timeout at worst observed throughput', () => {
    assert.equal(EXTENDED_MAX_TOKENS, 1200);
    assert.ok(EXTENDED_MAX_TOKENS > 1102, 'must exceed the real observed max true-completion length (M9, "Online Registry")');
    // Worst observed real throughput across the diagnostic's 6 truncating
    // cases was 35.6 tok/s (Transfer Export) -- at that rate 1200 tokens
    // must stay comfortably under PRODUCTION_SYNTHESIS_TIMEOUT_MS=45000.
    const worstCaseGenerationMs = (EXTENDED_MAX_TOKENS / 35.6) * 1000;
    assert.ok(worstCaseGenerationMs < 40000, `1200 tokens at worst observed throughput must leave real margin under the 45s timeout, got ${worstCaseGenerationMs.toFixed(0)}ms`);
  });

  await t('every classification found to truncate in the real diagnostic run gets the EXTENDED budget', () => {
    for (const c of ['EXPLANATION', 'TEAM_ACTIVITY', 'UNKNOWN', 'KNOWN_RECORD_BROWSE']) {
      assert.equal(resolveMaxTokens(c), EXTENDED_MAX_TOKENS, `${c} must resolve to EXTENDED_MAX_TOKENS`);
      assert.ok(EXTENDED_CLASSIFICATIONS.has(c));
    }
  });

  await t('every classification that stayed comfortably under 500 in the real diagnostic run keeps the STANDARD budget', () => {
    for (const c of ['CAPABILITY', 'STATUS', 'HOW_TO', 'TROUBLESHOOTING', 'ROADMAP', 'NAVIGATION', 'COMPARISON', 'CONNECTIVITY']) {
      assert.equal(resolveMaxTokens(c), STANDARD_MAX_TOKENS, `${c} must resolve to STANDARD_MAX_TOKENS`);
      assert.ok(!EXTENDED_CLASSIFICATIONS.has(c));
    }
  });

  await t('an unrecognized/missing classification defensively falls back to STANDARD, never EXTENDED', () => {
    assert.equal(resolveMaxTokens(undefined), STANDARD_MAX_TOKENS);
    assert.equal(resolveMaxTokens(null), STANDARD_MAX_TOKENS);
    assert.equal(resolveMaxTokens('SOME_FUTURE_CLASSIFICATION_NOT_YET_MEASURED'), STANDARD_MAX_TOKENS);
  });

  summarize('askSynthesis/synthesisBudget.test.js');
}

main();
