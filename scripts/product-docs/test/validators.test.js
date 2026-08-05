#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/validators.test.js
// Uses the isolated fixture tree under test/fixtures/broken-product-docs/,
// which intentionally embeds one instance of each defect this test checks for.
// Never touches the real docs/product/ tree.
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRunner } = require('./testHarness');
const parseProductDocs = require('../lib/parseProductDocs');
const validators = require('../lib/validators');
const { buildSubsystems, buildSourceIndex } = require('../lib/subsystems');
const { buildFeatureIndex } = require('../lib/featureIndex');
const { buildGraph } = require('../lib/dependencyGraph');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'broken-product-docs');

async function main() {
  const { t, summarize } = createRunner();
  const parsed = parseProductDocs.loadAll(FIXTURE_ROOT);

  await t('fixture loads all expected records (sanity check on the fixture itself)', () => {
    assert.equal(parsed.features.size, 2);
    assert.equal(parsed.roadmap.size, 1);
    assert.ok(parsed.bugs.size >= 2);
  });

  await t('checkDuplicateIds catches two registry rows sharing AI-FEAT-001', () => {
    const findings = validators.checkDuplicateIds(parsed);
    const rowDup = findings.find((f) => f.rule === 'duplicate-id' && f.message.includes('AI-FEAT-001') && f.message.includes('rows'));
    assert.ok(rowDup, 'expected a duplicate-id finding for AI-FEAT-001 registry rows');
  });

  await t('checkDuplicateIds catches two bug files sharing BUG-001', () => {
    const findings = validators.checkDuplicateIds(parsed);
    const fileDup = findings.find((f) => f.rule === 'duplicate-id' && f.message.includes('BUG-001') && f.message.includes('files'));
    assert.ok(fileDup, 'expected a duplicate-id finding for BUG-001 files');
  });

  await t('checkLinks catches a broken relative link and a broken anchor', () => {
    const findings = validators.checkLinks(parsed);
    assert.ok(findings.some((f) => f.rule === 'broken-link'));
    assert.ok(findings.some((f) => f.rule === 'broken-anchor'));
  });

  await t('checkFeatureReferences catches a nonexistent AI-FEAT-999 citation in the roadmap and architecture map', () => {
    const findings = validators.checkFeatureReferences(parsed);
    // AI-FEAT-999 is cited by the architectural-evolution relationship map row in the fixture
    assert.ok(findings.some((f) => f.message.includes('AI-FEAT-999')));
  });

  await t('checkRoadmapReferences catches AI-RM-001 including a nonexistent AI-FEAT-999', () => {
    const findings = validators.checkRoadmapReferences(parsed);
    assert.ok(findings.some((f) => f.rule === 'missing-feature-in-roadmap' && f.message.includes('AI-FEAT-999')));
  });

  await t('checkOrphans catches BUG-002 with no valid feature citation', () => {
    const findings = validators.checkOrphans(parsed);
    assert.ok(findings.some((f) => f.rule === 'orphan-bug' && f.message.includes('BUG-002')));
  });

  await t('checkPlannedRoadmap catches AI-FEAT-002 (Planned, no roadmap milestone on its own file)', () => {
    const findings = validators.checkPlannedRoadmap(parsed);
    assert.ok(findings.some((f) => f.message.includes('AI-FEAT-002')));
  });

  await t('checkRoadmapConsistency catches the roadmap/dashboard completion disagreement', () => {
    const findings = validators.checkRoadmapConsistency(parsed);
    assert.ok(findings.some((f) => f.rule === 'roadmap-dashboard-disagreement'));
  });

  await t('checkVocabulary catches an invalid Maturity value in the fixture', () => {
    const findings = validators.checkVocabulary(parsed);
    assert.ok(findings.some((f) => f.rule === 'invalid-maturity-vocabulary' && f.message.includes('AI-FEAT-002')));
  });

  await t('checkVocabulary catches an invalid Status value (isolated synthetic case, decoupled from the fixture)', () => {
    const synthetic = {
      features: new Map([
        ['AI-FEAT-900', { header: { Status: 'Kinda Done', Maturity: 'Stable' }, filePath: 'features/AI-FEAT-900_SYNTHETIC.md' }],
      ]),
    };
    const findings = validators.checkVocabulary(synthetic);
    assert.ok(findings.some((f) => f.rule === 'invalid-status-vocabulary' && f.message.includes('AI-FEAT-900')));
  });

  await t('checkRegistryFileMismatch is clean for this fixture (every row has a file and vice versa)', () => {
    const findings = validators.checkRegistryFileMismatch(parsed);
    assert.deepEqual(findings, []);
  });

  await t('a Related Files entry containing a space in the path is parsed and preserved intact', () => {
    const feat = parsed.features.get('AI-FEAT-001');
    assert.ok(feat.relatedFiles.includes('main/some folder/file with space.js'));
  });

  await t('full pipeline (subsystems/featureIndex/graph) runs without throwing on this imperfect fixture', () => {
    const subsystems = buildSubsystems(parsed);
    const sourceIndex = buildSourceIndex(subsystems);
    const featureIndex = buildFeatureIndex(parsed, sourceIndex);
    const graph = buildGraph(parsed);
    assert.equal(featureIndex.length, 2);
    assert.ok(graph.nodes.length > 0);
    // AI-FEAT-999 is cited but has no node -> must surface as a dangling edge, not a silent drop
    assert.ok(graph.danglingEdges.some((e) => e.source === 'AI-FEAT-999' || e.target === 'AI-FEAT-999'));
  });

  await t('checkGraphIntegrity reports the AI-FEAT-999 dangling edge as an invalid-dependency-edge error', () => {
    const graph = buildGraph(parsed);
    const findings = validators.checkGraphIntegrity(graph);
    assert.ok(findings.some((f) => f.rule === 'invalid-dependency-edge' && f.message.includes('AI-FEAT-999')));
  });

  summarize('validators.test.js');
}

main();
