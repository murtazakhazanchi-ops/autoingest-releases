#!/usr/bin/env node
'use strict';

// Run with: node scripts/product-docs/test/memory.test.js
// Reads the real docs/product/memory/ tree (read-only — never writes into
// it) and asserts the Part 6 invariants: the pilot capsule parses, appears
// in both the shared search index and the dedicated memory index, survives a
// deterministic rebuild, and the real tree validates with zero memory-related
// error-level findings. Companion to integration.test.js's own real-tree
// invariants for Part 4.
const assert = require('node:assert/strict');
const { createRunner } = require('./testHarness');
const build = require('../lib/build');
const validators = require('../lib/validators');
const { runQuery, lookupById } = require('../lib/query');
const memoryQuery = require('../automation/memory/query');

async function main() {
  const { t, summarize } = createRunner();

  const { parsed, built } = build.assemble();

  await t('the pilot capsule AI-MEM-0001 is parsed from docs/product/memory/', () => {
    assert.ok(parsed.memory.has('AI-MEM-0001'));
    const capsule = parsed.memory.get('AI-MEM-0001');
    assert.equal(capsule.header['Status'], 'Compiled');
    assert.match(capsule.header['Evidence classification'], /Reconstructed from repository evidence only/);
  });

  await t('AI-MEM-0001 appears in the built memory index with its real feature/bug/commit citations', () => {
    const rec = built.memoryIndex.find((r) => r.memory_id === 'AI-MEM-0001');
    assert.ok(rec, 'AI-MEM-0001 must appear in built.memoryIndex');
    assert.deepEqual(rec.feature_ids, ['AI-FEAT-008', 'AI-FEAT-033', 'AI-FEAT-034']);
    assert.deepEqual(rec.commit_ids, ['4446a30', '6349c62', '2c2090a', 'c5d200f']);
    assert.ok(rec.rejected_approaches.length >= 1, 'the pilot capsule records at least one explicitly rejected alternative');
  });

  await t('AI-MEM-0001 appears in the shared search index as entity_type "memory"', () => {
    const rec = built.searchIndex.find((r) => r.entity_type === 'memory' && r.stable_id === 'AI-MEM-0001');
    assert.ok(rec);
    assert.equal(rec.authority_level, 'evidence');
  });

  await t('lookupById resolves AI-MEM-0001 through the same generic path every other ID family uses', () => {
    const rec = lookupById('AI-MEM-0001', built.searchIndex);
    assert.ok(rec);
    assert.equal(rec.entity_type, 'memory');
  });

  await t('runQuery("Audit & Repair") surfaces AI-MEM-0001 among its results', () => {
    const results = runQuery('Audit & Repair', built.searchIndex, { limit: 20 });
    assert.ok(results.some((r) => r.record.stable_id === 'AI-MEM-0001'));
  });

  await t('memory query --feature AI-FEAT-033 finds the pilot capsule (no shell-out, calls the module directly)', () => {
    const capsules = memoryQuery.listCapsules();
    const hits = capsules.filter((c) => c.content.includes('AI-FEAT-033'));
    assert.ok(hits.some((c) => memoryQuery.idFromFile(c.file) === 'AI-MEM-0001'));
  });

  await t('memory query --commit 6349c62 finds the pilot capsule', () => {
    const capsules = memoryQuery.listCapsules();
    const hits = capsules.filter((c) => c.content.includes('6349c62'));
    assert.ok(hits.some((c) => memoryQuery.idFromFile(c.file) === 'AI-MEM-0001'));
  });

  await t('rebuilding twice from the same source produces a byte-identical memory-index.json (deterministic)', () => {
    const a = build.assemble().files.get('memory-index.json');
    const b = build.assemble().files.get('memory-index.jsonl');
    const a2 = build.assemble().files.get('memory-index.json');
    const b2 = build.assemble().files.get('memory-index.jsonl');
    assert.equal(a, a2);
    assert.equal(b, b2);
  });

  await t('running the full validator suite against the real repository produces zero memory-related error-level findings', () => {
    const findings = validators.runAllChecks(parsed, built, {});
    const memoryErrors = findings.filter((f) => f.level === 'error' && f.rule.startsWith('memory-'));
    assert.deepEqual(memoryErrors, []);
  });

  await t('manifest entity_counts.memory_capsules matches the real capsule count', () => {
    const { manifest } = build.assemble();
    assert.equal(manifest.entity_counts.memory_capsules, parsed.memory.size);
  });

  summarize('memory.test.js');
}

main();
