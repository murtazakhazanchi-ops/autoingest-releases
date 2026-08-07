#!/usr/bin/env node
'use strict';

// Regression coverage for the Part 7 fix to lib/validators.js's
// checkGeneratedFreshness: manifest.json's own `source_commit` field is
// excluded from the strict byte-for-byte freshness comparison (it can
// never self-reference the commit that first introduces a given rebuild —
// see that function's own comment and docs/product/10_CHANGELOG.md's Part
// 7 entry for the full account), but nothing else is. This file proves the
// exclusion is exactly that narrow: an unrelated stale field inside
// manifest.json still fails, and a stale field in ANY other generated file
// still fails — no broader generated-output exclusion was introduced.
// Uses a disposable temp directory as `generatedRoot`; never reads or
// writes the real docs/product/generated/ tree.
// Run with: node scripts/product-docs/test/generatedFreshness.test.js

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createRunner } = require('./testHarness');
const { checkGeneratedFreshness } = require('../lib/validators');

function withTempGeneratedRoot(onDiskFiles, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'generated-freshness-test-'));
  try {
    for (const [relPath, content] of Object.entries(onDiskFiles)) {
      const abs = path.join(dir, relPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function baseManifest(overrides = {}) {
  return JSON.stringify({
    docsys_version: '1.1.0',
    schema_version: '1.1.0',
    generator_version: '1.1.0',
    source_commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    generation_command: 'node scripts/product-docs/cli.js build',
    generated_files: ['feature-index.json'],
    source_file_count: 1,
    entity_counts: { features: 1, roadmap_milestones: 0, bugs: 0, decisions: 0, postmortems: 0, subsystems: 0, search_index_records: 0, memory_capsules: 0 },
    relationship_counts: { dependency_graph_edges: 0, dependency_graph_nodes: 0 },
    ...overrides,
  });
}

function findingsFor(rule, findings) {
  return findings.filter((f) => f.rule === rule);
}

async function main() {
  const { t, summarize } = createRunner();

  await t('manifest.json differing ONLY in source_commit is never reported as stale', () => {
    const onDisk = baseManifest({ source_commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
    const fresh = baseManifest({ source_commit: 'cccccccccccccccccccccccccccccccccccccccc' });
    withTempGeneratedRoot({ 'manifest.json': onDisk }, (dir) => {
      const findings = checkGeneratedFreshness(new Map([['manifest.json', fresh]]), dir);
      assert.deepEqual(findingsFor('stale-generated-output', findings), []);
    });
  });

  await t('manifest.json differing in source_commit AND an unrelated field (entity_counts) IS still reported as stale', () => {
    const onDisk = baseManifest({ source_commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', entity_counts: { features: 1, roadmap_milestones: 0, bugs: 0, decisions: 0, postmortems: 0, subsystems: 0, search_index_records: 0, memory_capsules: 0 } });
    const fresh = baseManifest({ source_commit: 'cccccccccccccccccccccccccccccccccccccccc', entity_counts: { features: 2, roadmap_milestones: 0, bugs: 0, decisions: 0, postmortems: 0, subsystems: 0, search_index_records: 0, memory_capsules: 0 } });
    withTempGeneratedRoot({ 'manifest.json': onDisk }, (dir) => {
      const findings = checkGeneratedFreshness(new Map([['manifest.json', fresh]]), dir);
      const stale = findingsFor('stale-generated-output', findings);
      assert.equal(stale.length, 1);
      assert.equal(stale[0].file, 'manifest.json');
    });
  });

  await t('manifest.json differing in source_commit AND generated_files list IS still reported as stale', () => {
    const onDisk = baseManifest({ source_commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', generated_files: ['feature-index.json'] });
    const fresh = baseManifest({ source_commit: 'cccccccccccccccccccccccccccccccccccccccc', generated_files: ['feature-index.json', 'ownership-manifest.json'] });
    withTempGeneratedRoot({ 'manifest.json': onDisk }, (dir) => {
      const findings = checkGeneratedFreshness(new Map([['manifest.json', fresh]]), dir);
      assert.equal(findingsFor('stale-generated-output', findings).length, 1);
    });
  });

  await t('a stale field in an UNRELATED generated file (not manifest.json) still fails — the exclusion is not broader than manifest.json', () => {
    const onDiskFeatureIndex = JSON.stringify({ schema_version: '1.1.0', docsys_version: '1.1.0', features: [{ feature_id: 'AI-FEAT-001' }] });
    const freshFeatureIndex = JSON.stringify({ schema_version: '1.1.0', docsys_version: '1.1.0', features: [{ feature_id: 'AI-FEAT-001' }, { feature_id: 'AI-FEAT-002' }] });
    withTempGeneratedRoot({ 'feature-index.json': onDiskFeatureIndex, 'manifest.json': baseManifest() }, (dir) => {
      const findings = checkGeneratedFreshness(
        new Map([['feature-index.json', freshFeatureIndex], ['manifest.json', baseManifest({ source_commit: 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz' })]]),
        dir,
      );
      const stale = findingsFor('stale-generated-output', findings);
      assert.equal(stale.length, 1, 'only feature-index.json should be flagged — manifest.json differs only in source_commit');
      assert.equal(stale[0].file, 'feature-index.json');
    });
  });

  await t('a missing generated file is still reported as stale (error), regardless of the manifest.json exception', () => {
    withTempGeneratedRoot({}, (dir) => {
      const findings = checkGeneratedFreshness(new Map([['feature-index.json', '{}']]), dir);
      const stale = findingsFor('stale-generated-output', findings);
      assert.equal(stale.length, 1);
      assert.equal(stale[0].level, 'error');
    });
  });

  await t('a byte-identical manifest.json (including source_commit) is never reported as stale', () => {
    const identical = baseManifest();
    withTempGeneratedRoot({ 'manifest.json': identical }, (dir) => {
      const findings = checkGeneratedFreshness(new Map([['manifest.json', identical]]), dir);
      assert.deepEqual(findingsFor('stale-generated-output', findings), []);
    });
  });

  summarize('generatedFreshness.test.js');
}

main();
