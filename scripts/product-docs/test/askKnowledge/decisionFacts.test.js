#!/usr/bin/env node
'use strict';
// Run with: node scripts/product-docs/test/askKnowledge/decisionFacts.test.js
// Ask AutoIngest — Stage 2, Section 23. Unit + integration tests for
// lib/askKnowledge/decisionFacts.js (Section 6A: Decision records as
// authoritative product knowledge).

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const { decisionFactsFor } = require('../../lib/askKnowledge/decisionFacts');
const build = require('../../lib/build');
const { buildEngineContext } = require('../../lib/knowledgeEngine');

async function main() {
  const { t, summarize } = createRunner();

  await t('returns an empty array when ctx is missing required indexes', () => {
    assert.deepEqual(decisionFactsFor('AI-FEAT-045', undefined), []);
    assert.deepEqual(decisionFactsFor('AI-FEAT-045', {}), []);
    assert.deepEqual(decisionFactsFor('AI-FEAT-045', { authorityIndexByFeatureId: new Map() }), []);
  });

  await t('returns an empty array when the feature has no linked decisions', () => {
    const ctx = {
      authorityIndexByFeatureId: new Map([['AI-FEAT-001', { relatedDecisions: [] }]]),
      searchIndexById: new Map(),
    };
    assert.deepEqual(decisionFactsFor('AI-FEAT-001', ctx), []);
  });

  await t('concatenates only real, existing decision-type records\' detail/summary text', () => {
    const ctx = {
      authorityIndexByFeatureId: new Map([['AI-FEAT-001', { relatedDecisions: ['DEC-001', 'DEC-002', 'DEC-MISSING'] }]]),
      searchIndexById: new Map([
        ['DEC-001', { entity_type: 'decision', detail: 'Detail one.' }],
        ['DEC-002', { entity_type: 'decision', summary: 'Summary two.' }],
      ]),
    };
    const facts = decisionFactsFor('AI-FEAT-001', ctx);
    assert.equal(facts.length, 2);
    assert.match(facts[0], /Detail one\./);
    assert.match(facts[1], /Summary two\./);
  });

  await t('ignores a linked record that is not actually a decision (entity_type mismatch)', () => {
    const ctx = {
      authorityIndexByFeatureId: new Map([['AI-FEAT-001', { relatedDecisions: ['BUG-001'] }]]),
      searchIndexById: new Map([['BUG-001', { entity_type: 'bug', detail: 'Should not appear.' }]]),
    };
    assert.deepEqual(decisionFactsFor('AI-FEAT-001', ctx), []);
  });

  await t('every returned fact is leak-boundary-clean (no raw DEC-### id in the output text)', () => {
    const ctx = {
      authorityIndexByFeatureId: new Map([['AI-FEAT-001', { relatedDecisions: ['DEC-013'] }]]),
      searchIndexById: new Map([['DEC-013', { entity_type: 'decision', detail: 'Per DEC-013 and AI-FEAT-045, locks are constrained.' }]]),
    };
    const facts = decisionFactsFor('AI-FEAT-001', ctx);
    assert.equal(facts.length, 1);
    assert.ok(!facts[0].includes('DEC-013'));
  });

  await t('integration: a real feature with real linked decisions (AI-FEAT-045, Archive Lock Handling) returns at least one fact', () => {
    const { built } = build.assemble();
    const ctx = buildEngineContext(built);
    const facts = decisionFactsFor('AI-FEAT-045', ctx);
    assert.ok(facts.length >= 1, 'expected at least one Decision-backed fact for AI-FEAT-045');
    assert.ok(facts[0].startsWith('Documented design decision:'));
  });

  await t('deterministic: repeated calls on the same real feature return identical facts', () => {
    const { built } = build.assemble();
    const ctx = buildEngineContext(built);
    const a = decisionFactsFor('AI-FEAT-045', ctx);
    const b = decisionFactsFor('AI-FEAT-045', ctx);
    assert.deepEqual(a, b);
  });

  summarize('askKnowledge/decisionFacts.test.js');
}

main();
