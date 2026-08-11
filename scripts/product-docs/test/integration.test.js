#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/integration.test.js
// Reads the real docs/product/ tree (read-only — never writes into it) and
// asserts the whole-repository invariants Part 4 promises: all 56 features
// present, deterministic rebuild, zero dangling graph edges, zero error-level
// health findings, and evidence-pending timelines are handled honestly.
const assert = require('node:assert/strict');
const { createRunner } = require('./testHarness');
const build = require('../lib/build');
const validators = require('../lib/validators');
const { stableStringify } = require('../lib/stableJson');
const { buildImpactAnalysis } = require('../lib/impact');
const { runQuery, lookupById } = require('../lib/query');
const { checkGeneratedSchemas } = require('../lib/validateSchemas');

async function main() {
  const { t, summarize } = createRunner();

  const { parsed, built, files, manifest } = build.assemble();

  await t('all 56 AI-FEAT records are present', () => {
    assert.equal(parsed.features.size, 56);
  });

  await t('all 9 AI-RM roadmap milestones are present', () => {
    assert.equal(parsed.roadmap.size, 9);
  });

  await t('bug/decision/postmortem counts match the current repository (BUG-001..014, DEC-001..015, PM-001)', () => {
    assert.equal(parsed.bugs.size, 14);
    assert.equal(parsed.decisions.size, 15);
    assert.equal(parsed.postmortems.size, 1);
  });

  await t('every generated JSON file is valid JSON and stableStringify is idempotent', () => {
    for (const [relPath, content] of files) {
      if (!relPath.endsWith('.json')) continue;
      const parsedJson = JSON.parse(content);
      assert.equal(stableStringify(parsedJson), content, `${relPath} is not in canonical stable form`);
    }
  });

  await t('rebuilding twice from the same source produces byte-identical output (deterministic build)', () => {
    const second = build.assemble();
    for (const [relPath, content] of files) {
      assert.equal(second.files.get(relPath), content, `${relPath} differed between two builds of the same source`);
    }
  });

  await t('no dependency-graph edge references a nonexistent node', () => {
    assert.deepEqual(built.graph.danglingEdges, []);
  });

  await t('running the full validator suite against the real repository produces zero error-level findings', () => {
    const findings = validators.runAllChecks(parsed, built, {});
    const errors = findings.filter((f) => f.level === 'error');
    assert.deepEqual(errors, [], `expected zero errors, got: ${errors.map((e) => e.rule + ': ' + e.message).join('; ')}`);
  });

  await t('every feature ID resolves via query by exact ID', () => {
    for (const id of parsed.features.keys()) {
      const found = lookupById(id, built.searchIndex);
      assert.ok(found, `${id} did not resolve via lookupById`);
      assert.equal(found.entity_type, 'feature');
    }
  });

  await t('a representative alias query returns the correct authoritative feature', () => {
    const results = runQuery('qmz', built.searchIndex, { limit: 5 });
    assert.ok(results.some((r) => r.record.stable_id === 'AI-FEAT-047'));
  });

  await t('a representative code-path query resolves to its explicitly-documented owning feature(s)', () => {
    const impact = buildImpactAnalysis('main/exifService.js', built, parsed);
    assert.equal(impact.confidence, 'explicit');
    assert.ok(impact.primary_ownership.includes('AI-FEAT-029'));
  });

  await t('impact analysis on an unrecognized path is honestly labeled unknown, not guessed', () => {
    const impact = buildImpactAnalysis('some/totally/unmapped/path.js', built, parsed);
    assert.equal(impact.confidence, 'unknown');
    assert.deepEqual(impact.primary_ownership, []);
  });

  await t('feature timelines never fabricate a date: every dated entry is verified, undated entries are explicitly marked', () => {
    for (const timeline of built.timelines) {
      for (const entry of timeline.entries) {
        if (entry.date) {
          assert.ok(entry.confidence === 'verified', `${timeline.feature_id} has a dated entry not marked verified`);
        } else {
          assert.ok(entry.confidence === 'undated' || entry.confidence === undefined || entry.event_type === 'evidence pending');
        }
      }
    }
  });

  await t('the roadmap dashboard matches the canonical current-position statement (AI-RM-001 complete, AI-RM-002 next, 1/9)', () => {
    assert.equal(built.dashboard.completed_count, 1);
    assert.equal(built.dashboard.total_milestones, 9);
    assert.equal(built.dashboard.current_milestone_id, 'AI-RM-002');
  });

  await t('every generated JSON artifact with a schema passes schema validation', () => {
    const findings = checkGeneratedSchemas(files);
    assert.deepEqual(findings, []);
  });

  await t('manifest.json carries the required provenance fields', () => {
    assert.ok(manifest.docsys_version);
    assert.ok(manifest.schema_version);
    assert.ok(manifest.source_commit);
    assert.ok(manifest.generation_command);
    assert.equal(manifest.entity_counts.features, 56);
  });

  summarize('integration.test.js');
}

main();
