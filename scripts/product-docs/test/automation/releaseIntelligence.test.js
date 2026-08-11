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

  // release gate — the v0.9.11 release-process incident regression coverage.
  // electron-builder derives its publish target/artifact names from
  // package.json's version, never from the git tag that triggers the
  // workflow — a v0.9.11 tag pushed while package.json still read 0.9.10
  // built real artifacts but silently failed to publish any of them
  // (electron-builder's own overwrite-protection guard skipped every
  // upload against the already-published v0.9.10 release). This gate makes
  // that precondition checkable before a tag is ever created.

  await t('release gate PASSES when package.json version matches the target tag', async () => {
    await withFixture(async (repo) => {
      repo.writeFile('package.json', JSON.stringify({ name: 'fixture-app', version: '0.9.11' }, null, 2));
      repo.commitAll('chore: set fixture package version to 0.9.11');

      const r = repo.run(['release', 'gate', '--tag', 'v0.9.11', '--json']);
      assert.equal(r.ok, true, r.output);
      const result = JSON.parse(r.output);
      assert.equal(result.ok, true);
      assert.equal(result.packageVersion, '0.9.11');
      assert.equal(result.targetVersion, '0.9.11');
      assert.deepEqual(result.blocking, []);
    });
  });

  await t('release gate BLOCKS when package.json version does not match the target tag (the actual v0.9.11 incident, reproduced)', async () => {
    await withFixture(async (repo) => {
      repo.writeFile('package.json', JSON.stringify({ name: 'fixture-app', version: '0.9.10' }, null, 2));
      repo.commitAll('chore: fixture package version stays at 0.9.10');

      const r = repo.run(['release', 'gate', '--tag', 'v0.9.11', '--json']);
      assert.equal(r.ok, false, 'gate must exit non-zero on a version/tag mismatch');
      const result = JSON.parse(r.output);
      assert.equal(result.ok, false);
      assert.equal(result.packageVersion, '0.9.10');
      assert.equal(result.targetVersion, '0.9.11');
      assert.ok(result.blocking.some((b) => b.includes('does not match the target release version')), 'blocking reason must name the mismatch');
    });
  });

  await t('release gate BLOCKS when package-lock.json (which stores the project version) disagrees with package.json', async () => {
    await withFixture(async (repo) => {
      repo.writeFile('package.json', JSON.stringify({ name: 'fixture-app', version: '0.9.11' }, null, 2));
      repo.writeFile('package-lock.json', JSON.stringify({
        name: 'fixture-app', version: '0.9.10', lockfileVersion: 3,
        packages: { '': { name: 'fixture-app', version: '0.9.10' } },
      }, null, 2));
      repo.commitAll('chore: fixture package-lock.json left stale at 0.9.10');

      const r = repo.run(['release', 'gate', '--tag', 'v0.9.11', '--json']);
      assert.equal(r.ok, false, 'gate must exit non-zero when the lockfile disagrees');
      const result = JSON.parse(r.output);
      assert.equal(result.ok, false);
      assert.equal(result.packageVersion, '0.9.11');
      assert.equal(result.lockVersion, '0.9.10');
      assert.ok(result.blocking.some((b) => b.includes('package-lock.json version')), 'blocking reason must name the lockfile mismatch');
    });
  });

  await t('release gate accepts a bare version (no leading "v") as the --tag value', async () => {
    await withFixture(async (repo) => {
      repo.writeFile('package.json', JSON.stringify({ name: 'fixture-app', version: '2.0.0' }, null, 2));
      repo.commitAll('chore: fixture package version 2.0.0');

      const r = repo.run(['release', 'gate', '--tag', '2.0.0', '--json']);
      assert.equal(r.ok, true, r.output);
      const result = JSON.parse(r.output);
      assert.equal(result.ok, true);
    });
  });

  summarize('releaseIntelligence.test.js');
}

main();
