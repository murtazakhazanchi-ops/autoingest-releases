#!/usr/bin/env node
'use strict';

// Part 7A — zero-touch git integration tests. Disposable fixture repo only
// (tmpRepoHarness.js) — never touches the real .git or docs/product/ tree.
// Drives the real cli.js exactly as the version-controlled hook scripts do
// (`automation pre-commit-gate` / `pre-push-gate` / `post-commit-link`).
// Run with: node scripts/product-docs/test/automation/hookAutomation.test.js

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

// tmpRepoHarness's fixture seed commit deliberately leaves docs/product/generated/
// empty (no build has run yet) — every test that exercises validate (directly
// or via a gate that calls it) needs a real, committed, in-sync generated/
// baseline first, exactly like a real repository always has one committed.
function buildAndCommitBaseline(repo) {
  const r = repo.run(['build']);
  assert.equal(r.ok, true, r.output);
  repo.commitAll('chore: build generated baseline for test');
}

async function main() {
  const { t, summarize } = createRunner();

  await t('pre-commit-gate is a fast no-op when nothing is staged', async () => {
    await withFixture(async (repo) => {
      const r = repo.run(['automation', 'pre-commit-gate']);
      assert.equal(r.ok, true, r.output);
      const result = JSON.parse(r.output);
      assert.equal(result.ok, true);
      assert.deepEqual(result.staged, []);
    });
  });

  await t('pre-commit-gate blocks a STRICT-mode session whose affected_files overlap staged content', async () => {
    await withFixture(async (repo) => {
      let r = repo.run(['automation', 'start', '--type', 'feature', '--title', 'Strict Overlap', '--summary', 'x', '--mode', 'strict']);
      assert.equal(r.ok, true, r.output);
      const sessionId = sessionIdFromStartOutput(r.output);

      repo.writeFile('fixture/sourceOne.js', 'module.exports = 10;\n');
      repo.commitAll('feat: strict scenario commit 1');
      r = repo.run(['automation', 'update', sessionId, '--summary', 'in progress']);
      assert.equal(r.ok, true, r.output);

      // A follow-up, still-uncommitted edit to the same file, now staged —
      // models "about to commit more work covered by an unfinalized STRICT
      // session".
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 11;\n');
      repo.git(['add', 'fixture/sourceOne.js']);

      r = repo.run(['automation', 'pre-commit-gate']);
      assert.equal(r.ok, false, r.output);
      const result = JSON.parse(r.output);
      assert.equal(result.ok, false);
      assert.ok(result.blocking.some((b) => b.rule === 'strict-session-unfinalized' && b.session_id === sessionId));
    });
  });

  await t('pre-commit-gate does NOT block a commit on a different branch than the STRICT session\'s own', async () => {
    await withFixture(async (repo) => {
      let r = repo.run(['automation', 'start', '--type', 'feature', '--title', 'Strict On Main', '--summary', 'x', '--mode', 'strict']);
      assert.equal(r.ok, true, r.output);
      // Session started on main, with no `automation update` yet (empty
      // affected_files — the fail-closed case). Switch to an unrelated
      // branch and confirm an unrelated commit there is NOT blocked.
      repo.git(['checkout', '-b', 'unrelated-branch']);
      repo.writeFile('fixture/unrelated.js', 'module.exports = 1;\n');
      repo.git(['add', 'fixture/unrelated.js']);

      r = repo.run(['automation', 'pre-commit-gate']);
      assert.equal(r.ok, true, r.output);
    });
  });

  await t('pre-commit-gate still fail-closes on the SAME branch when the STRICT session has no recorded affected_files yet', async () => {
    await withFixture(async (repo) => {
      let r = repo.run(['automation', 'start', '--type', 'feature', '--title', 'Strict No Update Yet', '--summary', 'x', '--mode', 'strict']);
      assert.equal(r.ok, true, r.output);
      repo.writeFile('fixture/anything.js', 'module.exports = 1;\n');
      repo.git(['add', 'fixture/anything.js']);

      r = repo.run(['automation', 'pre-commit-gate']);
      assert.equal(r.ok, false, r.output);
      const result = JSON.parse(r.output);
      assert.ok(result.blocking.some((b) => b.rule === 'strict-session-unfinalized'));
    });
  });

  await t('pre-commit-gate does NOT block a STANDARD-mode session with the same overlap', async () => {
    await withFixture(async (repo) => {
      let r = repo.run(['automation', 'start', '--type', 'feature', '--title', 'Standard Overlap', '--summary', 'x']);
      const sessionId = sessionIdFromStartOutput(r.output);
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 10;\n');
      repo.commitAll('feat: standard scenario commit 1');
      repo.run(['automation', 'update', sessionId, '--summary', 'in progress']);

      repo.writeFile('fixture/sourceOne.js', 'module.exports = 11;\n');
      repo.git(['add', 'fixture/sourceOne.js']);

      r = repo.run(['automation', 'pre-commit-gate']);
      assert.equal(r.ok, true, r.output);
    });
  });

  await t('pre-commit-gate blocks when docs/product/ is staged with generated/ left stale', async () => {
    await withFixture(async (repo) => {
      buildAndCommitBaseline(repo);
      const changelogPath = path.join(repo.dir, 'docs/product/10_CHANGELOG.md');
      const content = fs.readFileSync(changelogPath, 'utf8');
      fs.writeFileSync(changelogPath, content.replace('---\n', '---\n\n## 2026-01-02 — Unbuilt manual edit\n\n- Stale on purpose for this test.\n'));
      repo.git(['add', 'docs/product/10_CHANGELOG.md']);

      const r = repo.run(['automation', 'pre-commit-gate']);
      assert.equal(r.ok, false, r.output);
      const result = JSON.parse(r.output);
      assert.ok(result.blocking.some((b) => b.rule === 'stale-or-invalid-generated-output'));
    });
  });

  await t('pre-push-gate auto-finalizes an in-progress session whose gate would already pass', async () => {
    await withFixture(async (repo) => {
      buildAndCommitBaseline(repo);
      let r = repo.run(['automation', 'start', '--type', 'feature', '--title', 'Push Eligible', '--summary', 'x']);
      const sessionId = sessionIdFromStartOutput(r.output);
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 20;\n');
      repo.commitAll('feat: push eligible change');
      r = repo.run(['automation', 'update', sessionId, '--summary', 'implemented', '--test', 'fixture.test.js']);
      assert.equal(r.ok, true, r.output);

      r = repo.run(['automation', 'pre-push-gate']);
      assert.equal(r.ok, true, r.output);
      const result = JSON.parse(r.output);
      const entry = result.auto_finalized.find((e) => e.session_id === sessionId);
      assert.ok(entry, 'expected an auto_finalized entry for the session');
      assert.equal(entry.finalized, true, JSON.stringify(entry));

      const status = JSON.parse(repo.run(['automation', 'status', '--json']).output);
      assert.equal(status.pending.length, 0, 'session should no longer be pending after auto-finalize');
    });
  });

  await t('pre-push-gate leaves a never-updated ("pending") session alone', async () => {
    await withFixture(async (repo) => {
      buildAndCommitBaseline(repo);
      const r0 = repo.run(['automation', 'start', '--type', 'feature', '--title', 'Never Touched', '--summary', 'x']);
      const sessionId = sessionIdFromStartOutput(r0.output);

      const r = repo.run(['automation', 'pre-push-gate']);
      assert.equal(r.ok, true, r.output);
      const result = JSON.parse(r.output);
      const entry = result.auto_finalized.find((e) => e.session_id === sessionId);
      assert.ok(entry);
      assert.equal(entry.finalized, false);
      assert.match(entry.reason, /not "in-progress"/);

      const status = JSON.parse(repo.run(['automation', 'status', '--json']).output);
      assert.equal(status.pending.length, 1, 'never-updated session must remain pending, not silently finalized');
    });
  });

  await t('post-commit-link attaches a new commit hash to a matching pending session without touching a terminal one', async () => {
    await withFixture(async (repo) => {
      let r = repo.run(['automation', 'start', '--type', 'feature', '--title', 'Link Me', '--summary', 'x']);
      const sessionId = sessionIdFromStartOutput(r.output);
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 30;\n');
      repo.commitAll('feat: link scenario commit A');
      r = repo.run(['automation', 'update', sessionId, '--summary', 'wip']);
      assert.equal(r.ok, true, r.output);

      // A second commit to the SAME file, made after the last `update` —
      // post-commit-link must pick this one up even though it was never
      // explicitly passed to `automation update`.
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 31;\n');
      repo.commitAll('feat: link scenario commit B');
      const commitB = repo.git(['rev-parse', 'HEAD']);

      r = repo.run(['automation', 'post-commit-link']);
      assert.equal(r.ok, true, r.output);
      const result = JSON.parse(r.output);
      assert.ok(result.linked_sessions.includes(sessionId));

      const pendingFile = path.join(repo.dir, '.autoingest-docs', 'sessions', 'pending', `${sessionId}.json`);
      const packet = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
      assert.ok(packet.commits.some((c) => c.hash === commitB), 'commit B must now be recorded on the pending packet');

      // Never mutates a commit already recorded, and never crashes on a
      // repeat call.
      const r2 = repo.run(['automation', 'post-commit-link']);
      assert.equal(r2.ok, true, r2.output);
      const result2 = JSON.parse(r2.output);
      assert.ok(!result2.linked_sessions.includes(sessionId), 'must not re-link a commit already recorded');
    });
  });

  await t('pre-push-gate loudly reports auto-finalize writes that are left uncommitted, never silently', async () => {
    await withFixture(async (repo) => {
      buildAndCommitBaseline(repo);
      let r = repo.run(['automation', 'start', '--type', 'bugfix', '--title', 'Uncommitted Notice Test', '--summary', 'x']);
      const sessionId = sessionIdFromStartOutput(r.output);
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 40;\n');
      repo.commitAll('fix: uncommitted-notice scenario');
      const bug = JSON.stringify({ title: 'Notice Test Bug', symptom: 'x', root_cause: 'y', status: 'Fixed', severity: 'Low', fix: 'z' });
      r = repo.run(['automation', 'update', sessionId, '--summary', 'fixed', '--bug', bug, '--test', 't.js']);
      assert.equal(r.ok, true, r.output);

      r = repo.run(['automation', 'pre-push-gate']);
      assert.equal(r.ok, true, r.output);
      const result = JSON.parse(r.output);
      assert.ok(result.uncommitted_canonical_changes.length > 0, 'auto-finalize should have written at least a changelog entry and a bug record');
      assert.match(result.uncommitted_canonical_changes_note, /NOT committed/);

      // Confirm those files really are sitting uncommitted in the working tree.
      const status = repo.git(['status', '--porcelain']);
      assert.ok(status.length > 0);
    });
  });

  await t('REAL installed post-commit hook links a commit that touches application code, not just docs/product/ — found in Part 7 operational activation', async () => {
    await withFixture(async (repo) => {
      buildAndCommitBaseline(repo);
      // Actually install into this fixture repo's own .git/hooks/ — a
      // shell-level regression the CLI-only tests above never exercised
      // (they always call `automation post-commit-link` directly, bypassing
      // the shell wrapper's own fast-path gate entirely). Reproduces the
      // exact bug: the wrapper used to only invoke post-commit-link when
      // the commit touched docs/product/ or scripts/product-docs/ — but a
      // pending session normally tracks an ordinary application-code
      // change (fixture/sourceOne.js here), so the link never fired.
      let r = repo.run(['automation', 'install-hooks']);
      assert.equal(r.ok, true, r.output);
      assert.ok(fs.existsSync(path.join(repo.dir, '.git/hooks/post-commit')));

      r = repo.run(['automation', 'start', '--type', 'bugfix', '--title', 'Real Hook Link Test', '--summary', 'x']);
      const sessionId = sessionIdFromStartOutput(r.output);
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 50;\n');
      repo.commitAll('fix: commit A (application code, not docs/product)');
      r = repo.run(['automation', 'update', sessionId, '--summary', 'wip']);
      assert.equal(r.ok, true, r.output);

      // A second application-code commit — real `git commit`, invoking the
      // REAL installed .git/hooks/post-commit shell script, not the CLI
      // subcommand directly.
      repo.writeFile('fixture/sourceOne.js', 'module.exports = 51;\n');
      repo.git(['add', 'fixture/sourceOne.js']);
      repo.git(['commit', '-q', '-m', 'fix: commit B (application code, not docs/product)']);
      const commitB = repo.git(['rev-parse', 'HEAD']);

      const pendingFile = path.join(repo.dir, '.autoingest-docs', 'sessions', 'pending', `${sessionId}.json`);
      const packet = JSON.parse(fs.readFileSync(pendingFile, 'utf8'));
      assert.ok(packet.commits.some((c) => c.hash === commitB), 'the REAL installed post-commit hook must link an application-code commit, not only a docs/product/ one');
    });
  });

  await t('hook-installation readiness is a non-mutating dry-run', async () => {
    await withFixture(async (repo) => {
      const r = repo.run(['automation', 'install-hooks', '--dry-run']);
      assert.equal(r.ok, true, r.output);
      const result = JSON.parse(r.output);
      assert.equal(result.note.includes('Dry-run only'), true);
      // No files were written into the fixture repo's real .git/hooks/.
      const hooksDir = path.join(repo.dir, '.git', 'hooks');
      for (const name of ['pre-commit', 'post-commit', 'pre-push']) {
        const p = path.join(hooksDir, name);
        assert.equal(fs.existsSync(p), false, `${name} must not exist after a dry-run`);
      }
    });
  });

  summarize('hookAutomation.test.js');
}

main();
