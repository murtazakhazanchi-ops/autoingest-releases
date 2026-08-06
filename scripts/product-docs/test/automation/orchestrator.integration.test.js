#!/usr/bin/env node
'use strict';

// Integration tests against a DISPOSABLE, fully isolated git fixture repo
// (tmpRepoHarness.js) — never touches the real docs/product/ tree. Each
// test creates its own fixture repo and cleans it up (fs.rmSync) even on
// failure. Drives the real, unmodified cli.js exactly as a human/CI would.
// Run with: node scripts/product-docs/test/automation/orchestrator.integration.test.js
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
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

  await t('Scenario A — feature change: start -> work -> update -> finalize updates the feature journal and changelog, rebuilds generated, validate passes', async () => {
    await withFixture(async (repo) => {
      let r = repo.run(['automation', 'start', '--type', 'feature', '--title', 'Scenario A Feature', '--summary', 'x']);
      assert.equal(r.ok, true, r.output);
      const sessionId = sessionIdFromStartOutput(r.output);

      repo.writeFile('fixture/sourceOne.js', 'module.exports = 2;\n');
      repo.commitAll('feat: scenario A change');

      r = repo.run(['automation', 'update', sessionId, '--summary', 'Implemented scenario A', '--test', 'fixture.test.js']);
      assert.equal(r.ok, true, r.output);

      r = repo.run(['automation', 'finalize', sessionId]);
      assert.equal(r.ok, true, r.output);
      const result = JSON.parse(r.output.split('\n').slice(1).join('\n'));
      assert.equal(result.ok, true);
      assert.ok(result.canonical_files_modified.includes('docs/product/10_CHANGELOG.md'));
      assert.ok(result.canonical_files_modified.some((f) => f.includes('AI-FEAT-001')));
      assert.equal(result.generated_rebuilt, true);

      const validateResult = repo.run(['validate']);
      assert.equal(validateResult.ok, true, validateResult.output);
    });
  });

  await t('Scenario B — bug: a confirmed bug (symptom + root cause) creates a new BUG-### record linked to the feature', async () => {
    await withFixture(async (repo) => {
      let r = repo.run(['automation', 'start', '--type', 'bugfix', '--title', 'Scenario B Bugfix', '--summary', 'x']);
      const sessionId = sessionIdFromStartOutput(r.output);
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 3;\n');
      repo.commitAll('fix: scenario B change');

      const bug = JSON.stringify({
        title: 'Scenario B Off By One', symptom: 'wrong count', root_cause: 'loop bound error',
        status: 'Fixed', severity: 'Medium', fix: 'corrected bound',
      });
      r = repo.run(['automation', 'update', sessionId, '--summary', 'fixed it', '--bug', bug, '--test', 'regression.test.js']);
      assert.equal(r.ok, true, r.output);

      r = repo.run(['automation', 'finalize', sessionId]);
      assert.equal(r.ok, true, r.output);
      const result = JSON.parse(r.output.split('\n').slice(1).join('\n'));
      assert.equal(result.records_created.length, 1);
      assert.match(result.records_created[0], /^BUG-001$/);

      const bugFiles = fs.readdirSync(path.join(repo.dir, 'docs/product/bugs'));
      assert.equal(bugFiles.length, 1);
      const bugContent = fs.readFileSync(path.join(repo.dir, 'docs/product/bugs', bugFiles[0]), 'utf8');
      assert.match(bugContent, /^# BUG-001 —/);
      assert.match(bugContent, /wrong count/);
      assert.match(bugContent, /loop bound error/);
    });
  });

  await t('Scenario C — ambiguous/unmapped change: an unrecognized file produces evidence-pending output, never invents ownership', async () => {
    await withFixture(async (repo) => {
      let r = repo.run(['automation', 'start', '--type', 'maintenance', '--title', 'Scenario C Unmapped', '--summary', 'x']);
      const sessionId = sessionIdFromStartOutput(r.output);
      repo.writeFile('completely/unmapped/path.js', '// nobody owns this\n');
      repo.commitAll('chore: touch unmapped file');
      repo.run(['automation', 'update', sessionId, '--summary', 'touched unmapped file']);

      r = repo.run(['automation', 'dry-run', sessionId]);
      assert.equal(r.ok, true, r.output);
      assert.ok(r.output.includes('No files were written'));
      const dryRunResult = JSON.parse(r.output.split('\n').slice(1).join('\n'));
      assert.deepEqual(dryRunResult.classification.primary_feature_ids, [], 'must not invent a feature owner for an unmapped file');
      assert.ok(dryRunResult.classification.unknown_files.includes('completely/unmapped/path.js'));
    });
  });

  await t('dry-run guarantees zero filesystem writes even for a fully justified plan', async () => {
    await withFixture(async (repo) => {
      let r = repo.run(['automation', 'start', '--type', 'feature', '--title', 'Dry Run No Write', '--summary', 'x']);
      const sessionId = sessionIdFromStartOutput(r.output);
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 5;\n');
      repo.commitAll('feat: dry run test change');
      repo.run(['automation', 'update', sessionId, '--summary', 'work', '--test', 't.js']);

      // documentation-health.md/.json are diagnostic report OUTPUT of the
      // `validate` step the gate runs to compute its own result — they are
      // generated/disposable, not canonical, and are expected to refresh on
      // every validate call including inside a dry-run's gate check. The
      // no-write guarantee that matters is: canonical docs/product/*.md,
      // feature/bug/decision/postmortem records, and every OTHER generated
      // artifact (manifest.json, feature-index.json, ...) must not change.
      const nonDiagnostic = (dir) => fs.readdirSync(dir).filter((f) => !f.startsWith('documentation-health.'));
      const changelogBefore = fs.readFileSync(path.join(repo.dir, 'docs/product/10_CHANGELOG.md'), 'utf8');
      const bugsBefore = fs.readdirSync(path.join(repo.dir, 'docs/product/bugs'));
      const genBefore = JSON.stringify(nonDiagnostic(path.join(repo.dir, 'docs/product/generated')).sort());
      const manifestBefore = fs.existsSync(path.join(repo.dir, 'docs/product/generated/manifest.json'))
        ? fs.readFileSync(path.join(repo.dir, 'docs/product/generated/manifest.json'), 'utf8') : null;

      r = repo.run(['automation', 'dry-run', sessionId]);
      assert.equal(r.ok, true, r.output);

      const changelogAfter = fs.readFileSync(path.join(repo.dir, 'docs/product/10_CHANGELOG.md'), 'utf8');
      const bugsAfter = fs.readdirSync(path.join(repo.dir, 'docs/product/bugs'));
      const genAfter = JSON.stringify(nonDiagnostic(path.join(repo.dir, 'docs/product/generated')).sort());
      const manifestAfter = fs.existsSync(path.join(repo.dir, 'docs/product/generated/manifest.json'))
        ? fs.readFileSync(path.join(repo.dir, 'docs/product/generated/manifest.json'), 'utf8') : null;
      assert.equal(changelogBefore, changelogAfter);
      assert.deepEqual(bugsBefore, bugsAfter);
      assert.equal(genBefore, genAfter, 'no non-diagnostic generated artifact may appear/disappear from a dry-run');
      assert.equal(manifestBefore, manifestAfter, 'manifest.json content must be byte-identical after a dry-run');

      // Session must still be pending — dry-run never advances lifecycle state.
      const status = repo.run(['automation', 'status', '--json']);
      const statusJson = JSON.parse(status.output);
      assert.equal(statusJson.pending.length, 1);
      assert.equal(statusJson.pending[0].packet.automation_status, 'in-progress');
    });
  });

  await t('deterministic repeated finalize: finalizing an already-completed session is a safe no-op, no duplicate changelog entry', async () => {
    await withFixture(async (repo) => {
      let r = repo.run(['automation', 'start', '--type', 'feature', '--title', 'Idempotent Finalize', '--summary', 'x']);
      const sessionId = sessionIdFromStartOutput(r.output);
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 6;\n');
      repo.commitAll('feat: idempotent finalize test');
      repo.run(['automation', 'update', sessionId, '--summary', 'work']);

      r = repo.run(['automation', 'finalize', sessionId]);
      assert.equal(r.ok, true, r.output);
      r = repo.run(['automation', 'finalize', sessionId]);
      assert.equal(r.ok, true, r.output);

      const changelog = fs.readFileSync(path.join(repo.dir, 'docs/product/10_CHANGELOG.md'), 'utf8');
      const count = (changelog.match(/## \d{4}-\d{2}-\d{2} — Idempotent Finalize/g) || []).length;
      assert.equal(count, 1, 'must not duplicate the changelog entry on a repeated finalize');
    });
  });

  await t('no-op documentation-only commit: a change touching only docs/product/generated/ plans no feature-evolution entry', async () => {
    await withFixture(async (repo) => {
      let r = repo.run(['automation', 'start', '--type', 'maintenance', '--title', 'Generated Only Touch', '--summary', 'x']);
      const sessionId = sessionIdFromStartOutput(r.output);
      repo.run(['build']);
      repo.commitAll('chore: rebuild generated only');
      repo.run(['automation', 'update', sessionId, '--summary', 'rebuilt generated only']);

      r = repo.run(['automation', 'dry-run', sessionId]);
      const result = JSON.parse(r.output.split('\n').slice(1).join('\n'));
      assert.equal(result.plan_summary.feature_evolution, 0);
    });
  });

  await t('shared-file / multiple-affected-features change resolves feature ownership independently per file', async () => {
    await withFixture(async (repo) => {
      // Add a second feature owning a second file, to exercise multi-feature resolution.
      const featPath = path.join(repo.dir, 'docs/product/features/AI-FEAT-002_FIXTURE_FEATURE_TWO.md');
      fs.writeFileSync(featPath, fs.readFileSync(path.join(repo.dir, 'docs/product/features/AI-FEAT-001_FIXTURE_FEATURE_ONE.md'), 'utf8')
        .replace(/AI-FEAT-001/g, 'AI-FEAT-002')
        .replace('Fixture Feature One', 'Fixture Feature Two')
        .replace('fixture/sourceOne.js', 'fixture/sourceTwo.js'));
      const registryPath = path.join(repo.dir, 'docs/product/01_FEATURE_REGISTRY.md');
      fs.appendFileSync(registryPath, `| AI-FEAT-002 | Fixture Feature Two | Implemented | Stable | None | AI-RM-001 | features/AI-FEAT-002_FIXTURE_FEATURE_TWO.md |\n`);
      const roadmapPath = path.join(repo.dir, 'docs/product/02_MASTER_ROADMAP.md');
      fs.writeFileSync(roadmapPath, fs.readFileSync(roadmapPath, 'utf8').replace('AI-FEAT-001', 'AI-FEAT-001, AI-FEAT-002'));
      repo.commitAll('fixture: add second feature');

      let r = repo.run(['automation', 'start', '--type', 'feature', '--title', 'Two Feature Change', '--summary', 'x']);
      const sessionId = sessionIdFromStartOutput(r.output);
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 7;\n');
      repo.writeFile('fixture/sourceTwo.js', 'module.exports = 8;\n');
      repo.commitAll('feat: touch both features');
      repo.run(['automation', 'update', sessionId, '--summary', 'touched two features']);

      r = repo.run(['automation', 'finalize', sessionId]);
      assert.equal(r.ok, true, r.output);
      const result = JSON.parse(r.output.split('\n').slice(1).join('\n'));
      assert.equal(result.plan_summary.feature_evolution, 2, 'both features must get their own evolution entry');
      assert.ok(result.canonical_files_modified.some((f) => f.includes('AI-FEAT-001')));
      assert.ok(result.canonical_files_modified.some((f) => f.includes('AI-FEAT-002')));
    });
  });

  await t('STRICT mode blocks finalize when an unjustified record type is present; STANDARD allows it through', async () => {
    await withFixture(async (repo) => {
      let r = repo.run(['automation', 'start', '--type', 'bugfix', '--title', 'Strict Mode Test', '--mode', 'strict', '--summary', 'x']);
      const sessionId = sessionIdFromStartOutput(r.output);
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 9;\n');
      repo.commitAll('fix: strict mode test');
      // Insufficient bug evidence (symptom only, no root cause/status) — unjustified.
      const bug = JSON.stringify({ title: 'Insufficient Evidence Bug', symptom: 'something looked wrong' });
      r = repo.run(['automation', 'update', sessionId, '--summary', 'partial evidence', '--bug', bug]);
      assert.equal(r.ok, true, r.output);

      r = repo.run(['automation', 'finalize', sessionId]);
      assert.equal(r.ok, false, 'STRICT mode must block on an unjustified bug-record candidate');
      assert.equal(r.status, 1);
    });
  });

  await t('STANDARD mode (default) does not block on an unjustified record — it is reported, not created', async () => {
    await withFixture(async (repo) => {
      let r = repo.run(['automation', 'start', '--type', 'bugfix', '--title', 'Standard Mode Test', '--summary', 'x']);
      const sessionId = sessionIdFromStartOutput(r.output);
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 10;\n');
      repo.commitAll('fix: standard mode test');
      const bug = JSON.stringify({ title: 'Insufficient Evidence Bug', symptom: 'something looked wrong' });
      repo.run(['automation', 'update', sessionId, '--summary', 'partial evidence', '--bug', bug]);

      r = repo.run(['automation', 'finalize', sessionId]);
      assert.equal(r.ok, true, r.output);
      const bugFiles = fs.readdirSync(path.join(repo.dir, 'docs/product/bugs'));
      assert.equal(bugFiles.length, 0, 'an unjustified bug candidate must never produce a fabricated record, even in STANDARD mode');
    });
  });

  await t('OBSERVE mode never writes canonical docs, even for a fully justified plan', async () => {
    await withFixture(async (repo) => {
      let r = repo.run(['automation', 'start', '--type', 'feature', '--title', 'Observe Mode Test', '--mode', 'observe', '--summary', 'x']);
      const sessionId = sessionIdFromStartOutput(r.output);
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 11;\n');
      repo.commitAll('feat: observe mode test');
      repo.run(['automation', 'update', sessionId, '--summary', 'work', '--test', 't.js']);

      const changelogBefore = fs.readFileSync(path.join(repo.dir, 'docs/product/10_CHANGELOG.md'), 'utf8');
      r = repo.run(['automation', 'finalize', sessionId]);
      assert.equal(r.ok, true, r.output);
      const changelogAfter = fs.readFileSync(path.join(repo.dir, 'docs/product/10_CHANGELOG.md'), 'utf8');
      assert.equal(changelogBefore, changelogAfter, 'OBSERVE mode must never mutate canonical docs');
    });
  });

  await t('concurrent sessions: two child processes allocating a bug record in parallel never collide on an ID', async () => {
    await withFixture(async (repo) => {
      const { spawn } = require('child_process');
      const script = path.join(repo.dir, 'scripts', 'product-docs', 'automation', 'concurrentAllocateForTest.js');
      fs.writeFileSync(script, [
        "'use strict';",
        "const { allocateAndWriteRecord } = require('./recordAllocator');",
        "const r = allocateAndWriteRecord('bug', 'CONCURRENT_' + process.pid, '# placeholder\\n');",
        "process.stdout.write(JSON.stringify(r));",
      ].join('\n'));

      const N = 5;
      const runs = Array.from({ length: N }, () => new Promise((resolve) => {
        const p = spawn(process.execPath, [script], { cwd: repo.dir });
        let out = '';
        p.stdout.on('data', (d) => { out += d; });
        p.on('close', () => resolve(out.trim()));
      }));
      const outputs = await Promise.all(runs);
      const ids = outputs.map((o) => JSON.parse(o).id);
      assert.equal(new Set(ids).size, N, `expected ${N} unique IDs, got: ${ids.join(', ')}`);
      const files = fs.readdirSync(path.join(repo.dir, 'docs/product/bugs'));
      assert.equal(files.length, N);
    });
  });

  await t('crash recovery: a pending session whose base_commit is no longer an ancestor of HEAD is recovered as stale, never silently resumed', async () => {
    await withFixture(async (repo) => {
      let r = repo.run(['automation', 'start', '--type', 'feature', '--title', 'Crash Recovery Test', '--summary', 'x']);
      const sessionId = sessionIdFromStartOutput(r.output);

      // Simulate history moving on without this session ever finalizing:
      // create a divergent branch, commit there, then force this branch's
      // HEAD away from the session's recorded base_commit via a fresh
      // orphan commit that does NOT descend from it.
      repo.git(['checkout', '-q', '--orphan', 'diverged']);
      repo.writeFile('unrelated.txt', 'unrelated history\n');
      repo.git(['add', '-A']);
      repo.git(['commit', '-q', '-m', 'diverged: unrelated root commit']);

      r = repo.run(['automation', 'recover']);
      assert.equal(r.ok, true, r.output);
      const results = JSON.parse(r.output);
      const mine = results.find((x) => x.session_id === sessionId);
      assert.ok(mine);
      assert.equal(mine.outcome, 'stale');

      const status = repo.run(['automation', 'status', '--json']);
      const statusJson = JSON.parse(status.output);
      assert.equal(statusJson.pending.find((p) => p.packet.session_id === sessionId), undefined, 'a stale session must be moved out of pending');
    });
  });

  await t('reconcile rebuilds generated artifacts and reports pending sessions without mutating canonical docs', async () => {
    await withFixture(async (repo) => {
      const before = fs.readFileSync(path.join(repo.dir, 'docs/product/10_CHANGELOG.md'), 'utf8');
      const r = repo.run(['automation', 'reconcile']);
      assert.equal(r.ok, true, r.output);
      const after = fs.readFileSync(path.join(repo.dir, 'docs/product/10_CHANGELOG.md'), 'utf8');
      assert.equal(before, after);
      const validateResult = repo.run(['validate']);
      assert.equal(validateResult.ok, true, validateResult.output);
    });
  });

  await t('release-draft classifies commits into changelog categories and never writes docs/release-notes-*.md', async () => {
    await withFixture(async (repo) => {
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 12;\n');
      repo.commitAll('feat: add release-draft-worthy feature');
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 13;\n');
      repo.commitAll('fix: correct release-draft-worthy bug');

      const r = repo.run(['automation', 'release-draft', 'HEAD~2', 'HEAD']);
      assert.equal(r.ok, true, r.output);
      const files = fs.readdirSync(path.join(repo.dir, 'docs/product/generated/release-drafts'));
      assert.ok(files.some((f) => f.endsWith('.md')));
      const md = fs.readFileSync(path.join(repo.dir, 'docs/product/generated/release-drafts', files.find((f) => f.endsWith('.md'))), 'utf8');
      assert.match(md, /## Added/);
      assert.match(md, /## Fixed/);
      assert.match(md, /DRAFT ONLY/);
      assert.ok(!fs.existsSync(path.join(repo.dir, 'docs/release-notes-vDRAFT.md')));
    });
  });

  await t('record creation is retry-safe: calling applyBugRecord twice with the same plan object allocates only ONE ID', async () => {
    // Regression test for a code-review finding: a crash between two
    // canonicalUpdater.applyPlan items (e.g. finalize interrupted, then
    // re-run) previously re-allocated a fresh BUG-### for the same
    // evidence, because plan.bug carried no memory of a prior successful
    // allocation. Exercises the fix directly against canonicalUpdater.js
    // as copied into the disposable fixture repo (never the real repo).
    await withFixture(async (repo) => {
      const script = path.join(repo.dir, 'scripts', 'product-docs', 'automation', '__retrySafetyTest.js');
      fs.writeFileSync(script, [
        "'use strict';",
        "const { applyBugRecord } = require('./canonicalUpdater');",
        "const packet = { session_id: 'test-session', task_title: 'Retry Safety Test' };",
        "const bug = { title: 'Retry Safety Bug', symptom: 'x', root_cause: 'y' };",
        "const plan = { type: 'bug-record', bug, justified: true, reason: 'ok' };",
        "const first = applyBugRecord(packet, plan);",
        "const second = applyBugRecord(packet, plan);", // simulates a retry with the SAME (mutated) plan/packet
        "process.stdout.write(JSON.stringify({ first, second }));",
      ].join('\n'));
      const out = execFileSync(process.execPath, [script], { cwd: repo.dir, encoding: 'utf8' });
      const { first, second } = JSON.parse(out);
      assert.equal(first.applied, true);
      assert.equal(second.applied, false);
      assert.equal(second.id, first.id, 'the retry must report the SAME id, not allocate a new one');
      const files = fs.readdirSync(path.join(repo.dir, 'docs/product/bugs'));
      assert.equal(files.length, 1, 'exactly one bug record must exist on disk after the "retry"');
    });
  });

  await t('automation status --check-strict-blocking exits nonzero only when a STRICT in-progress session exists, and is silent otherwise', async () => {
    await withFixture(async (repo) => {
      let r = repo.run(['automation', 'status', '--check-strict-blocking']);
      assert.equal(r.ok, true, 'no pending sessions — must not block');
      assert.equal(r.output.trim(), '');

      const start = repo.run(['automation', 'start', '--type', 'feature', '--title', 'Strict Blocking Check', '--mode', 'strict', '--summary', 'x']);
      const sessionId = sessionIdFromStartOutput(start.output);
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 42;\n');
      repo.commitAll('feat: strict blocking check');
      repo.run(['automation', 'update', sessionId, '--summary', 'work']);

      r = repo.run(['automation', 'status', '--check-strict-blocking']);
      assert.equal(r.ok, false, 'a STRICT in-progress session must cause a nonzero exit');
      assert.match(r.output, new RegExp(sessionId));

      repo.run(['automation', 'finalize', sessionId]);
      r = repo.run(['automation', 'status', '--check-strict-blocking']);
      assert.equal(r.ok, true, 'once finalized, the session is terminal and must no longer block');
    });
  });

  summarize('orchestrator.integration.test.js');
}

main();
