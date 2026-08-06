'use strict';

// Builds a disposable, fully isolated git repository under the OS temp
// directory with its own copy of scripts/product-docs/ and a small, clean,
// self-consistent docs/product/ fixture tree. Every automation module
// resolves its "repository root" by walking up from its own __dirname to
// the nearest .git (scripts/product-docs/lib/repoRoot.js) — copying the
// whole tooling tree into the fixture repo means that walk naturally lands
// on the FIXTURE's .git, not the real one, with zero refactor of
// application code. This is what makes it safe to run real
// `automation start/update/finalize` end-to-end here without ever risking
// the real docs/product/ tree — see the module-level comment in each
// test file that uses this harness.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REAL_TOOLING_ROOT = path.join(__dirname, '..', '..'); // scripts/product-docs/

function copyDir(src, dest, { skip = [] } = {}) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.includes(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(s, d, { skip });
    } else {
      fs.copyFileSync(s, d);
      // Preserve the executable bit on the version-controlled hook scripts —
      // fs.copyFileSync does not preserve mode by default on all platforms.
      const mode = fs.statSync(s).mode;
      fs.chmodSync(d, mode);
    }
  }
}

function git(dir, args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
}

function writeFixtureDocs(root) {
  const p = (...parts) => path.join(root, 'docs', 'product', ...parts);
  fs.mkdirSync(p('features'), { recursive: true });
  fs.mkdirSync(p('bugs'), { recursive: true });
  fs.mkdirSync(p('decisions'), { recursive: true });
  fs.mkdirSync(p('postmortems'), { recursive: true });
  fs.mkdirSync(p('generated'), { recursive: true });

  fs.writeFileSync(p('01_FEATURE_REGISTRY.md'), `# Feature Registry (fixture)

## Fixture Subsystem

| ID | Name | Status | Maturity | Parent | Roadmap | Doc |
|---|---|---|---|---|---|---|
| AI-FEAT-001 | Fixture Feature One | Implemented | Stable | None | AI-RM-001 | features/AI-FEAT-001_FIXTURE_FEATURE_ONE.md |
`);

  fs.writeFileSync(p('02_MASTER_ROADMAP.md'), `# Master Roadmap (fixture)

## AI-RM-001 — Fixture Milestone

| Field | Value |
|---|---|
| Included AI-FEAT IDs | AI-FEAT-001 |
| Status | In progress |
`);

  fs.writeFileSync(p('04_PROJECT_DASHBOARD.md'), `# Project Dashboard (fixture)

| Field | Value |
|---|---|
| Current milestone | AI-RM-001 |
`);

  fs.writeFileSync(p('11_ARCHITECTURAL_EVOLUTION.md'), `# Architectural Evolution (fixture)

### A. Fixture Stage

Fixture narrative.

## 5. Relationship Map

| Architectural stage | Features | Decisions | Records |
|---|---|---|---|
| §3A Fixture Stage | AI-FEAT-001 | None | None |
`);

  fs.writeFileSync(p('10_CHANGELOG.md'), `# Changelog — docs/product/ (fixture)

Append newest first. Never edit or delete a prior entry.

---

## 2026-01-01 — Fixture seed entry

- Initial fixture content for Part 5 automation tests.

---
`);

  fs.writeFileSync(p('features', 'AI-FEAT-001_FIXTURE_FEATURE_ONE.md'), `# AI-FEAT-001 — Fixture Feature One

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-001 |
| Category | Fixture Subsystem |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | None |
| Related roadmap milestone | AI-RM-001 |
| Related technical docs | None |
| Evidence status | Fixture data for Part 5 automation tests |
| First-known implementation | 2026-01-01 |
| Latest major update | 2026-01-01 |

## Summary

Fixture feature used only by scripts/product-docs/test/automation/*.

## Current Behavior

Fixture.

## Original Plan / Intent

Fixture.

## Evolution / Implementation Journal

- **2026-01-01** — Fixture seeded.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- \`fixture/sourceOne.js\`
`);
}

// Creates the disposable repo, returns paths/helpers for tests to drive it.
function createFixtureRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoingest-docs-fixture-'));
  copyDir(REAL_TOOLING_ROOT, path.join(dir, 'scripts', 'product-docs'), { skip: ['test'] });
  // Copy only the automation-relevant test helper files needed at runtime —
  // none; automation modules never require anything under test/ at runtime.
  writeFixtureDocs(dir);

  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'fixture@example.invalid']);
  git(dir, ['config', 'user.name', 'Fixture Runner']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'fixture: initial seed']);

  const cliPath = path.join(dir, 'scripts', 'product-docs', 'cli.js');

  function run(args, opts = {}) {
    try {
      const output = execFileSync(process.execPath, [cliPath, ...args], {
        cwd: dir,
        encoding: 'utf8',
        ...opts,
      });
      return { ok: true, output, status: 0 };
    } catch (err) {
      return { ok: false, output: (err.stdout || '') + (err.stderr || ''), status: err.status, error: err.message };
    }
  }

  function writeFile(relPath, content) {
    const abs = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }

  function commitAll(message) {
    git(dir, ['add', '-A']);
    git(dir, ['commit', '-q', '-m', message]);
  }

  function cleanup() {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  return { dir, cliPath, run, git: (args) => git(dir, args), writeFile, commitAll, cleanup };
}

module.exports = { createFixtureRepo };
