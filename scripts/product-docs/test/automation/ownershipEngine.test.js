#!/usr/bin/env node
'use strict';

// Part 7C — multi-signal ownership engine tests.
//
// Signals 1-2 (explicit_related_files, subsystem_directory) and 6
// (git_co_change) are exercised end-to-end through the disposable fixture
// repo (tmpRepoHarness.js) via `automation ownership <path>`, since they
// depend on real Part 4 index-building and real git history. Signals 3-5
// (require_graph, test_to_source, decision_or_bug_citation) are unit-tested
// directly against hand-built `built`/`parsed` shapes — faster, and doesn't
// require fabricating a second whole feature file just to exercise one
// regex-matching function.
// Run with: node scripts/product-docs/test/automation/ownershipEngine.test.js

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const { createFixtureRepo } = require('./tmpRepoHarness');
const ownershipEngine = require('../../automation/ownershipEngine');

async function withFixture(fn) {
  const repo = createFixtureRepo();
  try {
    await fn(repo);
  } finally {
    repo.cleanup();
  }
}

function fakeBuilt(overrides = {}) {
  return {
    subsystems: [{ id: 'SUBSYS-FIXTURE', name: 'Fixture', primaryFeatures: ['AI-FEAT-001'] }],
    sourceIndex: { byFile: new Map([['fixture/sourceOne.js', ['SUBSYS-FIXTURE']]]), byDir: new Map([['fixture', ['SUBSYS-FIXTURE']]]) },
    ...overrides,
  };
}

async function main() {
  const { t, summarize } = createRunner();

  await t('resolveOwnership: explicit Related Files citation scores highest and is confidence "explicit"', async () => {
    await withFixture(async (repo) => {
      const r = repo.run(['automation', 'ownership', 'fixture/sourceOne.js']);
      assert.equal(r.ok, true, r.output);
      const result = JSON.parse(r.output);
      assert.deepEqual(result.primary_owner_ids, ['AI-FEAT-001']);
      assert.equal(result.overall_confidence, 'explicit');
      assert.equal(result.owners[0].score, 100);
      assert.ok(result.evidence.some((e) => e.signal === 'explicit_related_files'));
    });
  });

  await t('resolveOwnership: a file in a known subsystem directory (not explicitly listed) resolves via subsystem_directory, weaker than explicit', async () => {
    await withFixture(async (repo) => {
      const r = repo.run(['automation', 'ownership', 'fixture/siblingFile.js']);
      assert.equal(r.ok, true, r.output);
      const result = JSON.parse(r.output);
      assert.deepEqual(result.primary_owner_ids, ['AI-FEAT-001']);
      assert.equal(result.overall_confidence, 'high');
      assert.equal(result.owners[0].score, 40);
    });
  });

  await t('resolveOwnership: a genuinely unmapped path stays unknown/unresolved — never guessed', async () => {
    await withFixture(async (repo) => {
      const r = repo.run(['automation', 'ownership', 'totally/unrelated/path.js']);
      assert.equal(r.ok, true, r.output);
      const result = JSON.parse(r.output);
      assert.equal(result.unresolved, true);
      assert.equal(result.overall_confidence, 'unknown');
      assert.deepEqual(result.owners, []);
      assert.ok(result.note && result.note.includes('not guessed'));
    });
  });

  await t('resolveOwnership: git co-change history contributes a scaled, ratio-based signal', async () => {
    await withFixture(async (repo) => {
      // Three commits where an unrelated file always changes alongside the
      // explicitly-owned fixture file — a real, evidence-grounded co-change
      // pattern, not a filename guess.
      for (let i = 0; i < 3; i++) {
        repo.writeFile('fixture/sourceOne.js', `module.exports = ${i};\n`);
        repo.writeFile('fixture/coChanged.js', `module.exports = ${i};\n`);
        repo.commitAll(`chore: co-change commit ${i}`);
      }
      const r = repo.run(['automation', 'ownership', 'fixture/coChanged.js']);
      assert.equal(r.ok, true, r.output);
      const result = JSON.parse(r.output);
      // coChanged.js is ALSO in the fixture/ subsystem directory, so it
      // already resolves via subsystem_directory (40) — assert the
      // co-change signal specifically fired in addition, at full ratio (1.0).
      const coChangeEvidence = result.evidence.find((e) => e.signal === 'git_co_change');
      assert.ok(coChangeEvidence, 'expected a git_co_change evidence entry');
      assert.equal(coChangeEvidence.co_change_ratio, 1);
      assert.equal(coChangeEvidence.feature, 'AI-FEAT-001');
    });
  });

  await t('requireGraphSignal: unit-tested directly — a relative require resolving to an explicitly-owned file contributes evidence', () => {
    // Uses this real repository's own source tree read-only (never
    // mutated): scripts/product-docs/lib/query.js has `require('./ids')` —
    // a real, on-disk-verifiable relative require this signal can resolve.
    const built = fakeBuilt({
      sourceIndex: { byFile: new Map([['scripts/product-docs/lib/ids.js', ['SUBSYS-FIXTURE']]]), byDir: new Map() },
    });
    const result = ownershipEngine.requireGraphSignal('scripts/product-docs/lib/query.js', built);
    assert.ok(result.evidence.some((e) => e.signal === 'require_graph' && e.required_file === 'scripts/product-docs/lib/ids.js'));
  });

  await t('testToSourceSignal: never guesses a pairing whose candidate source file does not actually exist on disk', () => {
    // services/exampleService.js does not exist on disk in this real repo —
    // testToSourceSignal is fs-existence-gated by design (never resolves
    // ownership of a candidate path that isn't actually there), so this
    // correctly yields no evidence even though the sourceIndex claims
    // ownership for that (non-existent) path.
    const built = fakeBuilt({
      sourceIndex: { byFile: new Map([['services/exampleService.js', ['SUBSYS-FIXTURE']]]), byDir: new Map() },
    });
    const result = ownershipEngine.testToSourceSignal('test/exampleService.test.js', built);
    assert.deepEqual(result.evidence, []);
  });

  await t('testToSourceSignal: pairs a real test/X.test.js to a real, explicitly-owned main/X.js candidate', () => {
    // main/main.js exists in this real repository — a stable, always-present
    // fixture for the fs-existence-gated candidate check.
    const built = fakeBuilt({
      sourceIndex: { byFile: new Map([['main/main.js', ['SUBSYS-FIXTURE']]]), byDir: new Map() },
    });
    const result = ownershipEngine.testToSourceSignal('test/main.test.js', built);
    assert.ok(result.evidence.some((e) => e.signal === 'test_to_source' && e.source_file === 'main/main.js'));
  });

  await t('decisionBugCitationSignal: a decision body citing the exact path contributes evidence for its cited feature(s)', () => {
    const parsed = {
      decisions: new Map([[
        'DEC-001',
        { header: { 'Related feature(s) / roadmap milestone': 'AI-FEAT-002' }, body: 'This decision affects `services/queue.js` directly.' },
      ]]),
      bugs: new Map(),
    };
    const result = ownershipEngine.decisionBugCitationSignal('services/queue.js', parsed);
    assert.equal(result.evidence.length, 1);
    assert.equal(result.evidence[0].feature, 'AI-FEAT-002');
    assert.equal(result.evidence[0].record, 'DEC-001');
  });

  summarize('ownershipEngine.test.js');
}

main();
