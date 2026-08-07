#!/usr/bin/env node
'use strict';

// Part 7E — universal repository context assistant tests. Disposable
// fixture repo only (tmpRepoHarness.js). Drives the real cli.js's
// `context <sub>` exactly as an agent following docs/product/CLAUDE.md's
// "run the repository context command" instruction would.
// Run with: node scripts/product-docs/test/automation/contextEngine.test.js

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const { createFixtureRepo } = require('./tmpRepoHarness');

async function withFixture(fn) {
  const repo = createFixtureRepo();
  try {
    await fn(repo);
  } finally {
    repo.cleanup();
  }
}

async function main() {
  const { t, summarize } = createRunner();

  await t('context feature returns a bounded, authority-ordered bundle in JSON', async () => {
    await withFixture(async (repo) => {
      const r = repo.run(['context', 'feature', 'AI-FEAT-001', '--json']);
      assert.equal(r.ok, true, r.output);
      const bundle = JSON.parse(r.output);
      assert.equal(bundle.found, true);
      assert.equal(bundle.kind, 'feature');
      assert.equal(bundle.canonical_document, 'features/AI-FEAT-001_FIXTURE_FEATURE_ONE.md');
      assert.ok(Array.isArray(bundle.authority_order) && bundle.authority_order.length === 5);
      assert.ok(bundle.provenance.includes('features/AI-FEAT-001_FIXTURE_FEATURE_ONE.md'));
    });
  });

  await t('context feature also renders readable Markdown by default (no --json)', async () => {
    await withFixture(async (repo) => {
      const r = repo.run(['context', 'feature', 'AI-FEAT-001']);
      assert.equal(r.ok, true, r.output);
      assert.match(r.output, /^# Context — feature AI-FEAT-001/);
      assert.match(r.output, /## Authority Order/);
      assert.match(r.output, /## Provenance/);
    });
  });

  await t('context subsystem resolves via alias, not just exact name/id', async () => {
    await withFixture(async (repo) => {
      const r = repo.run(['context', 'subsystem', 'Fixture Subsystem', '--json']);
      assert.equal(r.ok, true, r.output);
      const bundle = JSON.parse(r.output);
      assert.equal(bundle.found, true);
      assert.equal(bundle.name, 'Fixture Subsystem');
      assert.deepEqual(bundle.primary_features, ['AI-FEAT-001']);
    });
  });

  await t('context file resolves an explicitly-owned path with full confidence', async () => {
    await withFixture(async (repo) => {
      const r = repo.run(['context', 'file', 'fixture/sourceOne.js', '--json']);
      assert.equal(r.ok, true, r.output);
      const bundle = JSON.parse(r.output);
      assert.equal(bundle.found, true);
      assert.deepEqual(bundle.primary_owner_ids, ['AI-FEAT-001']);
      assert.equal(bundle.overall_confidence, 'explicit');
      assert.equal(bundle.owning_features[0].feature_id, 'AI-FEAT-001');
    });
  });

  await t('context on an unknown topic exits non-zero and is honest, never a fabricated match', async () => {
    await withFixture(async (repo) => {
      const r = repo.run(['context', 'feature', 'AI-FEAT-999', '--json']);
      assert.equal(r.ok, false);
      const bundle = JSON.parse(r.output);
      assert.equal(bundle.found, false);
      assert.match(bundle.note, /No such feature/);
    });
  });

  await t('context task uses deterministic keyword matching to route to the right feature', async () => {
    await withFixture(async (repo) => {
      const r = repo.run(['context', 'task', 'Fixture Feature One', '--json']);
      assert.equal(r.ok, true, r.output);
      const bundle = JSON.parse(r.output);
      assert.equal(bundle.found, true);
      assert.equal(bundle.matches[0].stable_id, 'AI-FEAT-001');
      assert.equal(bundle.primary_match.found, true);
    });
  });

  await t('context task on a genuinely unrelated query is honest ("no match"), never guesses', async () => {
    await withFixture(async (repo) => {
      const r = repo.run(['context', 'task', 'xyzzy plugh completely unrelated nonsense', '--json']);
      assert.equal(r.ok, false);
      const bundle = JSON.parse(r.output);
      assert.equal(bundle.found, false);
      assert.match(bundle.note, /not guessed/);
    });
  });

  await t('context explain includes a routing_note pointing at the canonical document to read next', async () => {
    await withFixture(async (repo) => {
      const r = repo.run(['context', 'explain', 'Fixture Feature One', '--json']);
      assert.equal(r.ok, true, r.output);
      const bundle = JSON.parse(r.output);
      assert.ok(bundle.routing_note.includes('AI-FEAT-001'));
    });
  });

  await t('context bundle --feature and --file are equivalent entry points to the same builders', async () => {
    await withFixture(async (repo) => {
      const rFeat = repo.run(['context', 'bundle', '--feature', 'AI-FEAT-001', '--json']);
      const rFile = repo.run(['context', 'bundle', '--file', 'fixture/sourceOne.js', '--json']);
      assert.equal(rFeat.ok, true, rFeat.output);
      assert.equal(rFile.ok, true, rFile.output);
      assert.equal(JSON.parse(rFeat.output).kind, 'feature');
      assert.equal(JSON.parse(rFile.output).kind, 'file');
    });
  });

  summarize('contextEngine.test.js');
}

main();
