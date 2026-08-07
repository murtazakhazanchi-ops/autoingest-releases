#!/usr/bin/env node
'use strict';

// Part 7B — architectural decision intelligence tests. Disposable fixture
// repo only (tmpRepoHarness.js). Drives the real cli.js exactly as
// `automation decision-scan` / the orchestrator's own best-effort finalize
// integration would.
// Run with: node scripts/product-docs/test/automation/decisionIntelligence.test.js

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createRunner } = require('../testHarness');
const { createFixtureRepo } = require('./tmpRepoHarness');

function sessionIdFromStartOutput(output) {
  const m = /Started session (\S+)/.exec(output);
  if (!m) throw new Error(`Could not parse session id from: ${output}`);
  return m[1];
}

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

  await t('a routine, non-architectural change produces state "not_warranted"', async () => {
    await withFixture(async (repo) => {
      let r = repo.run(['automation', 'start', '--type', 'enhancement', '--title', 'Trivial Tweak', '--summary', 'x']);
      const sessionId = sessionIdFromStartOutput(r.output);
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 99;\n');
      repo.commitAll('chore: trivial tweak');
      repo.run(['automation', 'update', sessionId, '--summary', 'trivial']);

      r = repo.run(['automation', 'decision-scan', sessionId]);
      assert.equal(r.ok, true, r.output);
      const result = JSON.parse(r.output);
      assert.equal(result.state, 'not_warranted');
      assert.deepEqual(result.signals, []);
    });
  });

  await t('an architectural signal with insufficient evidence produces a local, non-canonical candidate', async () => {
    await withFixture(async (repo) => {
      let r = repo.run(['automation', 'start', '--type', 'architecture', '--title', 'New Service Layer', '--summary', 'x']);
      const sessionId = sessionIdFromStartOutput(r.output);
      repo.writeFile('services/exampleService.js', 'module.exports = {};\n');
      repo.commitAll('feat: add a new service');
      repo.run(['automation', 'update', sessionId, '--summary', 'added a service']);

      r = repo.run(['automation', 'decision-scan', sessionId]);
      assert.equal(r.ok, true, r.output);
      const result = JSON.parse(r.output);
      assert.equal(result.state, 'candidate');
      assert.ok(result.signals.some((s) => s.id === 'service-boundary'));
      assert.ok(result.candidate.review_question.length > 0);

      // Never writes a canonical decisions/ file for a mere candidate.
      const decisionFiles = fs.readdirSync(path.join(repo.dir, 'docs/product/decisions'));
      assert.equal(decisionFiles.length, 0);

      // The candidate is discoverable via the dedicated listing command.
      const listResult = JSON.parse(repo.run(['automation', 'decision-candidates']).output);
      assert.equal(listResult.length, 1);
      assert.equal(listResult[0].session_id, sessionId);
    });
  });

  await t('an architectural signal WITH sufficient evidence (>=2 alternatives + accepted) drafts a canonical Status: Draft decision', async () => {
    await withFixture(async (repo) => {
      let r = repo.run(['automation', 'start', '--type', 'architecture', '--title', 'New Locking Strategy', '--summary', 'x']);
      const sessionId = sessionIdFromStartOutput(r.output);
      repo.writeFile('services/lockManager.js', 'module.exports = {};\n');
      repo.commitAll('feat: new lock manager');

      r = repo.run(['automation', 'update', sessionId, '--summary', 'work', '--alternative', JSON.stringify({ name: 'Option A', description: 'file-based lock' })]);
      assert.equal(r.ok, true, r.output);
      r = repo.run(['automation', 'update', sessionId, '--alternative', JSON.stringify({ name: 'Option B', description: 'in-memory lock' }), '--accepted', 'Chose Option A for cross-process safety.']);
      assert.equal(r.ok, true, r.output);

      r = repo.run(['automation', 'decision-scan', sessionId]);
      assert.equal(r.ok, true, r.output);
      const result = JSON.parse(r.output);
      assert.equal(result.state, 'draft');
      assert.match(result.decision_id, /^DEC-\d{3}$/);

      const decisionFiles = fs.readdirSync(path.join(repo.dir, 'docs/product/decisions'));
      assert.equal(decisionFiles.length, 1);
      const content = fs.readFileSync(path.join(repo.dir, 'docs/product/decisions', decisionFiles[0]), 'utf8');
      assert.match(content, /Status \| Draft — auto-detected architectural signal/);
      assert.match(content, new RegExp(`session \`${sessionId}\``));
      assert.match(content, /Option A/);
      assert.match(content, /Chose Option A for cross-process safety\./);

      // Idempotent: re-scanning the same (still-pending) session must not
      // allocate a second decision record.
      const r2 = repo.run(['automation', 'decision-scan', sessionId]);
      const result2 = JSON.parse(r2.output);
      assert.equal(result2.state, 'already_drafted');
      assert.equal(result2.decision_id, result.decision_id);
      const decisionFilesAfter = fs.readdirSync(path.join(repo.dir, 'docs/product/decisions'));
      assert.equal(decisionFilesAfter.length, 1, 'must not double-draft on a repeat scan');
    });
  });

  await t('a signal with sufficient evidence but a matching existing decision is reported as possible_continuation, not a new record', async () => {
    await withFixture(async (repo) => {
      repo.writeFile('docs/product/decisions/DEC-001_EXAMPLE_SERVICE_LAYER.md', `# DEC-001 — Example Service Layer

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-001 |
| Status | Accepted |
| Date | 2026-01-01 |
| Evidence status | Fixture seed for Part 7B dedup test |

## Context

Fixture context.

## Options Considered

1. **Option A** — fixture option

## Decision

Fixture decision.

## Consequences

None recorded.

## Reconciliation Note

None recorded.
`);
      repo.commitAll('docs: seed DEC-001');

      let r = repo.run(['automation', 'start', '--type', 'architecture', '--title', 'Example Service Layer', '--summary', 'x']);
      const sessionId = sessionIdFromStartOutput(r.output);
      repo.writeFile('services/anotherService.js', 'module.exports = {};\n');
      repo.commitAll('feat: another service change');
      repo.run(['automation', 'update', sessionId, '--alternative', JSON.stringify({ name: 'A', description: 'x' })]);
      repo.run(['automation', 'update', sessionId, '--alternative', JSON.stringify({ name: 'B', description: 'y' }), '--accepted', 'z']);

      r = repo.run(['automation', 'decision-scan', sessionId]);
      assert.equal(r.ok, true, r.output);
      const result = JSON.parse(r.output);
      assert.equal(result.state, 'possible_continuation');
      assert.equal(result.continuation.decision_id, 'DEC-001');

      const decisionFiles = fs.readdirSync(path.join(repo.dir, 'docs/product/decisions'));
      assert.equal(decisionFiles.length, 1, 'must not create a duplicate decision when a strong match already exists');
    });
  });

  summarize('decisionIntelligence.test.js');
}

main();
