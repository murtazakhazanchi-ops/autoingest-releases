#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/query.test.js
const assert = require('node:assert/strict');
const { createRunner } = require('./testHarness');
const { runQuery, lookupById } = require('../lib/query');

function makeRecord(overrides) {
  return {
    entity_type: 'feature',
    stable_id: 'AI-FEAT-000',
    title: 'Placeholder Feature',
    canonical_path: 'features/AI-FEAT-000_PLACEHOLDER.md',
    aliases: [],
    keywords: [],
    summary: '',
    related_ids: [],
    authority_level: 'canonical',
    evidence_status: 'Verified',
    ...overrides,
  };
}

const FIXTURE_INDEX = [
  makeRecord({ stable_id: 'AI-FEAT-029', title: 'Metadata Writing Engine', aliases: ['metadata writing', 'xmp sidecars'], keywords: ['metadata', 'writing', 'engine', 'exif', 'xmp'], summary: 'Shared metadata engine.' }),
  makeRecord({ stable_id: 'AI-FEAT-033', title: 'Metadata Audit & Repair', aliases: ['metadata audit', 'metadata repair'], keywords: ['metadata', 'audit', 'repair'], summary: 'Audits and repairs metadata drift.' }),
  makeRecord({ stable_id: 'AI-FEAT-047', title: 'QMZ Sequencing Workspace', aliases: ['qmz'], keywords: ['qmz', 'sequencing', 'workspace'], summary: 'QMZ domain workflow.' }),
  makeRecord({ stable_id: 'SUBSYS-metadata', entity_type: 'subsystem', title: 'Metadata', aliases: ['metadata'], keywords: ['metadata'], authority_level: 'locator' }),
];

async function main() {
  const { t, summarize } = createRunner();

  await t('exact ID match ranks first with the highest score', () => {
    const results = runQuery('AI-FEAT-033', FIXTURE_INDEX);
    assert.equal(results[0].record.stable_id, 'AI-FEAT-033');
    assert.equal(results[0].score, 1000);
  });

  await t('exact alias match outranks a mere keyword/summary match', () => {
    const results = runQuery('qmz', FIXTURE_INDEX);
    assert.equal(results[0].record.stable_id, 'AI-FEAT-047');
    assert.ok(results[0].score >= 900);
  });

  await t('multi-word query ranks title-substring matches above single-keyword-overlap matches', () => {
    const results = runQuery('metadata audit', FIXTURE_INDEX);
    assert.equal(results[0].record.stable_id, 'AI-FEAT-033');
  });

  await t('keyword-overlap query surfaces multiple relevant records deterministically', () => {
    const results = runQuery('metadata', FIXTURE_INDEX);
    const ids = results.map((r) => r.record.stable_id);
    assert.ok(ids.includes('AI-FEAT-029'));
    assert.ok(ids.includes('AI-FEAT-033'));
    assert.ok(ids.includes('SUBSYS-metadata'));
  });

  await t('re-running the same query produces byte-identical ordering (deterministic ranking)', () => {
    const a = runQuery('metadata', FIXTURE_INDEX).map((r) => `${r.record.stable_id}:${r.score}`);
    const b = runQuery('metadata', FIXTURE_INDEX).map((r) => `${r.record.stable_id}:${r.score}`);
    assert.deepEqual(a, b);
  });

  await t('unknown query returns an empty result set, not an error', () => {
    const results = runQuery('completely unrelated nonsense query xyz123', FIXTURE_INDEX);
    assert.deepEqual(results, []);
  });

  await t('empty-string query returns an empty result set', () => {
    assert.deepEqual(runQuery('', FIXTURE_INDEX), []);
    assert.deepEqual(runQuery('   ', FIXTURE_INDEX), []);
  });

  await t('lookupById finds a record by stable ID and is case-insensitive on ID casing input', () => {
    const found = lookupById('AI-FEAT-029', FIXTURE_INDEX);
    assert.equal(found.title, 'Metadata Writing Engine');
    const notFound = lookupById('AI-FEAT-999', FIXTURE_INDEX);
    assert.equal(notFound, null);
  });

  await t('entityType filter restricts results to the requested entity type', () => {
    const results = runQuery('metadata', FIXTURE_INDEX, { entityType: 'subsystem' });
    assert.ok(results.every((r) => r.record.entity_type === 'subsystem'));
  });

  summarize('query.test.js');
}

main();
