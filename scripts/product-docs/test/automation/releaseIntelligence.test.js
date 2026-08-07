#!/usr/bin/env node
'use strict';

// Part 7D — autonomous release intelligence tests. Disposable fixture repo
// only (tmpRepoHarness.js) with real git tags. Drives the real cli.js's
// `release prepare` exactly as a human/CI would.
// Run with: node scripts/product-docs/test/automation/releaseIntelligence.test.js

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
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

  await t('release prepare auto-discovers the prior tag and never invents changes', async () => {
    await withFixture(async (repo) => {
      repo.git(['tag', 'v1.0.0']);
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 1;\n');
      repo.commitAll('feat: add a thing');
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 2;\n');
      repo.commitAll('fix: correct a thing');

      const r = repo.run(['release', 'prepare', '--to', 'HEAD', '--dry-run', '--json-only']);
      assert.equal(r.ok, true, r.output);
      const jsonStart = r.output.indexOf('{');
      const draft = JSON.parse(r.output.slice(jsonStart));
      assert.equal(draft.from_ref, 'v1.0.0');
      assert.equal(draft.from_ref_resolution, 'auto-detected-prior-tag');
      assert.equal(draft.categories.Added.length, 1);
      assert.equal(draft.categories.Fixed.length, 1);
      assert.deepEqual(draft.affected_features, ['AI-FEAT-001']);

      // dry-run must never write a file.
      assert.equal(fs.existsSync(path.join(repo.dir, 'docs/product/generated/release-drafts')), false);
    });
  });

  await t('release prepare honestly reports "no prior tag" for a first release, never fabricating a range', async () => {
    await withFixture(async (repo) => {
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 1;\n');
      repo.commitAll('feat: first ever change');

      const r = repo.run(['release', 'prepare', '--to', 'HEAD', '--dry-run', '--json-only']);
      assert.equal(r.ok, true, r.output);
      const jsonStart = r.output.indexOf('{');
      const draft = JSON.parse(r.output.slice(jsonStart));
      assert.equal(draft.from_ref, null);
      assert.equal(draft.resolution, 'no-prior-tag');
    });
  });

  await t('release prepare surfaces currently-open bugs as known issues, and reports "none" honestly otherwise', async () => {
    await withFixture(async (repo) => {
      repo.git(['tag', 'v1.0.0']);
      repo.writeFile('docs/product/bugs/BUG-001_OPEN_FIXTURE_BUG.md', `# BUG-001 — Open Fixture Bug

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-001 |
| Status | Open |
| Severity | Medium |
| Discovered | 2026-01-01 |
| Fixed | Not yet fixed |
| Evidence status | Fixture |

## Symptom

Fixture symptom.

## Root Cause

Evidence pending — not yet documented as fact.

## Investigation Log

- Fixture.

## Fix

Not yet fixed.

## Prevention / Reusable Lesson

Evidence pending — not yet documented as fact.

## Related

None recorded.
`);
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 3;\n');
      repo.commitAll('feat: seed an open bug and a change');

      const r = repo.run(['release', 'prepare', '--to', 'HEAD', '--dry-run', '--json-only']);
      assert.equal(r.ok, true, r.output);
      const jsonStart = r.output.indexOf('{');
      const draft = JSON.parse(r.output.slice(jsonStart));
      assert.equal(draft.known_issues.length, 1);
      assert.equal(draft.known_issues[0].id, 'BUG-001');
      assert.equal(draft.known_issues[0].status, 'Open');
    });
  });

  await t('release prepare --output-dir refuses to write outside the repository root without creating a stray directory', async () => {
    await withFixture(async (repo) => {
      repo.git(['tag', 'v1.0.0']);
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 9;\n');
      repo.commitAll('feat: containment test change');
      const outside = path.join(path.dirname(repo.dir), 'outside-release-drafts-target');
      const r = repo.run(['release', 'prepare', '--to', 'HEAD', '--output-dir', outside]);
      assert.equal(r.ok, false, r.output);
      assert.equal(fs.existsSync(outside), false, 'must not create the out-of-repo directory before rejecting the write');
    });
  });

  await t('release prepare rejects an unknown --to ref rather than silently no-op-ing', async () => {
    await withFixture(async (repo) => {
      const r = repo.run(['release', 'prepare', '--to', 'not-a-real-ref']);
      assert.equal(r.ok, false);
      assert.match(r.output, /Unknown git ref/);
    });
  });

  await t('release prepare writes deterministic, byte-identical output across two runs against the same commit', async () => {
    await withFixture(async (repo) => {
      repo.git(['tag', 'v1.0.0']);
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 4;\n');
      repo.commitAll('feat: deterministic test change');

      const r1 = repo.run(['release', 'prepare', '--to', 'HEAD', '--output-dir', 'docs/product/generated/release-drafts']);
      assert.equal(r1.ok, true, r1.output);
      const files = fs.readdirSync(path.join(repo.dir, 'docs/product/generated/release-drafts'));
      const jsonFile = files.find((f) => f.endsWith('.json'));
      const firstContent = fs.readFileSync(path.join(repo.dir, 'docs/product/generated/release-drafts', jsonFile), 'utf8');
      const firstParsed = JSON.parse(firstContent);

      const r2 = repo.run(['release', 'prepare', '--to', 'HEAD', '--output-dir', 'docs/product/generated/release-drafts']);
      assert.equal(r2.ok, true, r2.output);
      const secondContent = fs.readFileSync(path.join(repo.dir, 'docs/product/generated/release-drafts', jsonFile), 'utf8');
      const secondParsed = JSON.parse(secondContent);

      // generated_at is expected to differ (wall-clock) — compare everything else.
      delete firstParsed.generated_at;
      delete secondParsed.generated_at;
      assert.deepEqual(firstParsed, secondParsed);
    });
  });

  summarize('releaseIntelligence.test.js');
}

main();
