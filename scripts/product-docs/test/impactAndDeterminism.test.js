#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/impactAndDeterminism.test.js
// Unit tests for stableJson determinism, ownership-resolution confidence
// tiers (explicit/inferred/unknown), and impact-analysis resolution paths —
// all against small synthetic fixtures, decoupled from the real repository.
const assert = require('node:assert/strict');
const { createRunner } = require('./testHarness');
const { stableStringify } = require('../lib/stableJson');
const { resolveFileOwnership } = require('../lib/changeReport');
const { buildImpactAnalysis } = require('../lib/impact');

function makeSourceIndex() {
  const byFile = new Map([
    ['main/exifService.js', ['SUBSYS-metadata']],
    ['main/some folder/file with space.js', ['SUBSYS-metadata']],
  ]);
  const byDir = new Map([
    ['main', ['SUBSYS-application-platform']],
  ]);
  return { byFile, byDir };
}

async function main() {
  const { t, summarize } = createRunner();

  await t('stableStringify sorts object keys recursively and is idempotent', () => {
    const a = { b: 1, a: { d: 2, c: 3 } };
    const out1 = stableStringify(a);
    const out2 = stableStringify(JSON.parse(out1));
    assert.equal(out1, out2);
    assert.ok(out1.indexOf('"a"') < out1.indexOf('"b"'));
  });

  await t('stableStringify preserves array order (arrays are not sorted, only object keys)', () => {
    const out = stableStringify({ list: [3, 1, 2] });
    assert.equal(JSON.parse(out).list.join(','), '3,1,2');
  });

  await t('resolveFileOwnership returns "explicit" for a file cited exactly in a feature\'s Related Files', () => {
    const result = resolveFileOwnership('main/exifService.js', makeSourceIndex());
    assert.equal(result.confidence, 'explicit');
    assert.deepEqual(result.subsystems, ['SUBSYS-metadata']);
  });

  await t('resolveFileOwnership handles a path containing spaces identically to any other path', () => {
    const result = resolveFileOwnership('main/some folder/file with space.js', makeSourceIndex());
    assert.equal(result.confidence, 'explicit');
  });

  await t('resolveFileOwnership returns "inferred" for a file only within a known subsystem directory', () => {
    const result = resolveFileOwnership('main/someOtherFile.js', makeSourceIndex());
    assert.equal(result.confidence, 'inferred');
    assert.deepEqual(result.subsystems, ['SUBSYS-application-platform']);
  });

  await t('resolveFileOwnership returns "unknown" (never a guess) for a completely unmapped path', () => {
    const result = resolveFileOwnership('renderer/somethingUnrelated.js', makeSourceIndex());
    assert.equal(result.confidence, 'unknown');
    assert.deepEqual(result.subsystems, []);
  });

  const builtFixture = {
    featureIndex: [
      { feature_id: 'AI-FEAT-100', canonical_document: 'features/AI-FEAT-100_X.md', related_features: [], dependencies: ['AI-FEAT-101'], dependents: [], related_decisions: ['DEC-001'], related_bugs: [], related_technical_docs: ['docs/x.md'], related_tests: ['test/x.test.js'], roadmap_ids: ['AI-RM-100'] },
      { feature_id: 'AI-FEAT-101', canonical_document: 'features/AI-FEAT-101_Y.md', related_features: [], dependencies: [], dependents: ['AI-FEAT-100'], related_decisions: [], related_bugs: [], related_technical_docs: [], related_tests: [], roadmap_ids: [] },
    ],
    subsystems: [{ id: 'SUBSYS-x', name: 'X Subsystem', aliases: ['xsub'], primaryFeatures: ['AI-FEAT-100'] }],
    sourceIndex: { byFile: new Map(), byDir: new Map() },
  };
  const parsedFixture = { roadmap: new Map([['AI-RM-100', { header: { 'Included AI-FEAT IDs': 'AI-FEAT-100' } }]]) };

  await t('buildImpactAnalysis resolves a subsystem by its alias', () => {
    const impact = buildImpactAnalysis('xsub', builtFixture, parsedFixture);
    assert.equal(impact.confidence, 'explicit');
    assert.deepEqual(impact.primary_ownership, ['AI-FEAT-100']);
    assert.deepEqual(impact.dependencies, ['AI-FEAT-101']);
  });

  await t('buildImpactAnalysis resolves a roadmap milestone to its included features', () => {
    const impact = buildImpactAnalysis('AI-RM-100', builtFixture, parsedFixture);
    assert.deepEqual(impact.primary_ownership, ['AI-FEAT-100']);
  });

  await t('buildImpactAnalysis on an unknown feature ID returns empty ownership, not a crash', () => {
    const impact = buildImpactAnalysis('AI-FEAT-999', builtFixture, parsedFixture);
    assert.deepEqual(impact.primary_ownership, []);
  });

  summarize('impactAndDeterminism.test.js');
}

main();
