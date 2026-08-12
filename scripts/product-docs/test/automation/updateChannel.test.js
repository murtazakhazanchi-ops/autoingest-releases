#!/usr/bin/env node
'use strict';

// Part 9 — update-channel isolation regression tests. Pure logic only, no
// Electron, no network — drives the real updateChannelModel.js (which
// mirrors electron-updater's verified GitHubProvider behavior) plus the
// real releaseIntelligence.js gate against disposable fixture repos, the
// same tmpRepoHarness.js pattern every other automation/ test uses.
//
// Scope note: services/autoUpdater.js's applyChannelSetting() itself (which
// sets autoUpdater.channel/allowPrerelease on the REAL electron-updater
// singleton) is not exercised here — electron-updater's own constructor
// calls app.getVersion() at require-time, which throws outside a real
// Electron process (confirmed directly: `require('electron-updater')`
// outside Electron throws inside ElectronAppAdapter.js). This is the same,
// already-established class of limitation this repo's other Electron-
// dependent files carry (see the live-Electron E2E test files under
// test/) — applyChannelSetting's two property assignments were verified by
// direct reading of AppUpdater.js's setter source instead (see its own
// comment in autoUpdater.js), and would need a live-Electron E2E test to
// exercise at runtime, not a pure-logic unit test.
// Run with: node scripts/product-docs/test/automation/updateChannel.test.js

const assert = require('node:assert/strict');
const { createRunner } = require('../testHarness');
const { createFixtureRepo } = require('./tmpRepoHarness');
const { resolveOfferedRelease, defaultAllowPrerelease } = require('../../lib/updateChannelModel');

async function withFixture(fn) {
  const repo = createFixtureRepo();
  try {
    await fn(repo);
  } finally {
    repo.cleanup();
  }
}

// A fixture release list shaped like the real repo's GitHub releases would
// be, newest-first (matching the real Atom feed's created_at-descending
// order) — one Stable, two RCs (one superseding the other), one draft
// (which must never be offered to anyone).
const FIXTURE_RELEASES = [
  { tag: 'v0.9.12-rc.2', prerelease: true, draft: false },
  { tag: 'v0.9.12-rc.1', prerelease: true, draft: false },
  { tag: 'v0.9.11', prerelease: false, draft: false },
  { tag: 'v0.9.10-draft-never-offered', prerelease: false, draft: true },
];

async function main() {
  const { t, summarize } = createRunner();

  // ── 1. Stable user + Stable release → update offered ──────────────────────
  await t('Stable user + Stable release → offered', () => {
    const offered = resolveOfferedRelease({ allowPrerelease: false, channel: null, currentVersion: '0.9.10' }, FIXTURE_RELEASES);
    assert.equal(offered.tag, 'v0.9.11');
  });

  // ── 2. Stable user + RC release → NOT offered ──────────────────────────────
  await t('Stable user + RC-only release list → not offered (no stable candidate)', () => {
    const rcOnly = FIXTURE_RELEASES.filter((r) => r.prerelease);
    const offered = resolveOfferedRelease({ allowPrerelease: false, channel: null, currentVersion: '0.9.10' }, rcOnly);
    assert.equal(offered, null, 'a Stable client must never resolve a prerelease release, even when it is the only thing published');
  });

  await t('Stable user never sees the RC even when a newer RC exists alongside Stable', () => {
    const offered = resolveOfferedRelease({ allowPrerelease: false, channel: null, currentVersion: '0.9.10' }, FIXTURE_RELEASES);
    assert.notEqual(offered.tag, 'v0.9.12-rc.1');
    assert.notEqual(offered.tag, 'v0.9.12-rc.2');
    assert.equal(offered.tag, 'v0.9.11');
  });

  // ── 3. Preview user + RC release → offered ─────────────────────────────────
  await t('Preview user (allowPrerelease + channel=rc) + RC release → offered, latest RC wins', () => {
    const offered = resolveOfferedRelease({ allowPrerelease: true, channel: 'rc', currentVersion: '0.9.11' }, FIXTURE_RELEASES);
    assert.equal(offered.tag, 'v0.9.12-rc.2', 'the newest matching-channel entry (feed order) must be selected, not the oldest');
  });

  // ── 4. Preview user + newer Stable release → documented behavior ──────────
  await t('Preview user + a Stable release newer than any RC → the Stable release is offered (no prerelease-component tag beats it)', () => {
    const newerStableThanRc = [
      { tag: 'v0.9.13', prerelease: false, draft: false },
      { tag: 'v0.9.12-rc.2', prerelease: true, draft: false },
      { tag: 'v0.9.12-rc.1', prerelease: true, draft: false },
    ];
    const offered = resolveOfferedRelease({ allowPrerelease: true, channel: 'rc', currentVersion: '0.9.12-rc.2' }, newerStableThanRc);
    assert.equal(offered.tag, 'v0.9.13', 'GitHubProvider.js\'s shouldFetchVersion branch treats a non-prerelease tag as always fetchable regardless of the client\'s current channel — documented, verified behavior, not an assumption');
  });

  // ── 5. Development artifact → not visible to Stable (or anyone) ───────────
  await t('Development artifacts never appear in the release list model at all (no channel, no draft flag matters — they are never published as a GitHub Release)', () => {
    // Development builds are workflow_dispatch Actions-artifact uploads
    // (see .github/workflows/release.yml's development-build job) — they
    // never call the GitHub Releases API, so there is no release list entry
    // for a Stable OR Preview client to ever resolve. Modeled here as: the
    // fixture list simply never contains one, and both client types still
    // correctly resolve only to real releases.
    const stableOffered = resolveOfferedRelease({ allowPrerelease: false, channel: null, currentVersion: '0.9.10' }, FIXTURE_RELEASES);
    const previewOffered = resolveOfferedRelease({ allowPrerelease: true, channel: 'rc', currentVersion: '0.9.11' }, FIXTURE_RELEASES);
    assert.ok(stableOffered && !stableOffered.tag.includes('dev'));
    assert.ok(previewOffered && !previewOffered.tag.includes('dev'));
  });

  // ── Draft releases are excluded for every client type ──────────────────────
  await t('A draft release is never offered to any client, Stable or Preview', () => {
    const stableOffered = resolveOfferedRelease({ allowPrerelease: false, channel: null, currentVersion: '0.9.9' }, FIXTURE_RELEASES);
    const previewOffered = resolveOfferedRelease({ allowPrerelease: true, channel: 'rc', currentVersion: '0.9.9' }, FIXTURE_RELEASES);
    assert.notEqual(stableOffered && stableOffered.tag, 'v0.9.10-draft-never-offered');
    assert.notEqual(previewOffered && previewOffered.tag, 'v0.9.10-draft-never-offered');
  });

  // ── defaultAllowPrerelease — the client-side default before any explicit setting ──
  await t('defaultAllowPrerelease is false for a plain Stable-shaped installed version', () => {
    assert.equal(defaultAllowPrerelease('0.9.11'), false);
  });
  await t('defaultAllowPrerelease is true for an RC-shaped installed version', () => {
    assert.equal(defaultAllowPrerelease('0.9.12-rc.1'), true);
  });

  // ── 6. Version/tag mismatch → blocked ──────────────────────────────────────
  await t('release gate: package.json/tag mismatch is blocked (channel-aware)', async () => {
    await withFixture(async (repo) => {
      repo.writeFile('package.json', JSON.stringify({ name: 'fixture-app', version: '0.9.10' }, null, 2));
      repo.commitAll('chore: fixture stays at 0.9.10');
      const r = repo.run(['release', 'gate', '--tag', 'v0.9.11', '--channel', 'stable', '--override-drift-check', 'no RC in this fixture', '--json']);
      assert.equal(r.ok, false);
      const result = JSON.parse(r.output);
      assert.equal(result.ok, false);
    });
  });

  // ── 7. Stable commit differs from approved RC commit → blocked ────────────
  await t('release gate: Stable commit with source drift from the approved RC commit is blocked', async () => {
    await withFixture(async (repo) => {
      repo.writeFile('package.json', JSON.stringify({ name: 'fixture-app', version: '0.9.11' }, null, 2));
      repo.commitAll('chore: fixture at 0.9.11 (this is the "verified RC" commit)');
      const rcCommit = repo.git(['rev-parse', 'HEAD']).trim();
      repo.writeFile('fixture/newSourceFile.js', 'module.exports = "drift";\n');
      repo.commitAll('feat: a source change the RC was never verified against');

      const r = repo.run(['release', 'gate', '--tag', 'v0.9.11', '--channel', 'stable', '--rc-commit', rcCommit, '--json']);
      assert.equal(r.ok, false, 'drift beyond the version bump must block Stable');
      const result = JSON.parse(r.output);
      assert.equal(result.sourceDrift.drifted, true);
      assert.ok(result.sourceDrift.changedFiles.includes('fixture/newSourceFile.js'));
    });
  });

  await t('release gate: Stable commit with ZERO drift from the approved RC commit passes', async () => {
    await withFixture(async (repo) => {
      repo.writeFile('package.json', JSON.stringify({ name: 'fixture-app', version: '0.9.11' }, null, 2));
      repo.commitAll('chore: fixture at 0.9.11');
      const rcCommit = repo.git(['rev-parse', 'HEAD']).trim();

      const r = repo.run(['release', 'gate', '--tag', 'v0.9.11', '--channel', 'stable', '--rc-commit', rcCommit, '--json']);
      assert.equal(r.ok, true, r.output);
    });
  });

  await t('release gate: Stable commit with ONLY a version-bump diff from the approved RC commit passes (the expected promotion shape)', async () => {
    await withFixture(async (repo) => {
      repo.writeFile('package.json', JSON.stringify({ name: 'fixture-app', version: '0.9.12-rc.1' }, null, 2));
      repo.commitAll('chore: fixture RC at 0.9.12-rc.1');
      const rcCommit = repo.git(['rev-parse', 'HEAD']).trim();
      repo.writeFile('package.json', JSON.stringify({ name: 'fixture-app', version: '0.9.12' }, null, 2));
      repo.commitAll('chore(release): bump to stable 0.9.12 — version bump only, matches the promotion model');

      const r = repo.run(['release', 'gate', '--tag', 'v0.9.12', '--channel', 'stable', '--rc-commit', rcCommit, '--json']);
      assert.equal(r.ok, true, r.output);
    });
  });

  // ── 8. package-lock mismatch → blocked (channel-aware path) ───────────────
  await t('release gate: stale package-lock.json blocks even a version-matched Stable release', async () => {
    await withFixture(async (repo) => {
      repo.writeFile('package.json', JSON.stringify({ name: 'fixture-app', version: '0.9.11' }, null, 2));
      repo.writeFile('package-lock.json', JSON.stringify({ name: 'fixture-app', version: '0.9.10', lockfileVersion: 3, packages: { '': { name: 'fixture-app', version: '0.9.10' } } }, null, 2));
      repo.commitAll('chore: package-lock.json left stale');
      const rcCommit = repo.git(['rev-parse', 'HEAD']).trim();

      const r = repo.run(['release', 'gate', '--tag', 'v0.9.11', '--channel', 'stable', '--rc-commit', rcCommit, '--json']);
      assert.equal(r.ok, false);
      const result = JSON.parse(r.output);
      assert.ok(result.blocking.some((b) => b.includes('package-lock.json version')));
    });
  });

  // ── 9. RC channel metadata cannot overwrite Stable metadata ───────────────
  await t('RC and Stable never resolve to the same channel-file name for either platform', () => {
    // electron-builder's getUpdateInfoFileName is "${channel}${osSuffix}.yml"
    // (app-builder-lib/out/publish/updateInfoBuilder.js) — verified directly
    // rather than assumed. Stable's channel is always "latest" (package.json
    // sets no override); RC's is "rc" (release.yml's -c.publish.channel=rc).
    // These can never collide as long as "rc" is never renamed to "latest".
    const RC_CHANNEL = 'rc';
    const STABLE_CHANNEL = 'latest';
    assert.notEqual(RC_CHANNEL, STABLE_CHANNEL);
    const winFile = (channel) => `${channel}.yml`;
    const macFile = (channel) => `${channel}-mac.yml`;
    assert.notEqual(winFile(RC_CHANNEL), winFile(STABLE_CHANNEL));
    assert.notEqual(macFile(RC_CHANNEL), macFile(STABLE_CHANNEL));
  });

  await t('RC gate requires an "X.Y.Z-rc.N" shaped version, rejecting a plain Stable-shaped one', async () => {
    await withFixture(async (repo) => {
      repo.writeFile('package.json', JSON.stringify({ name: 'fixture-app', version: '0.9.11' }, null, 2));
      repo.commitAll('chore: fixture at plain stable version');
      const r = repo.run(['release', 'gate', '--tag', 'v0.9.11', '--channel', 'rc', '--json']);
      assert.equal(r.ok, false);
      const result = JSON.parse(r.output);
      assert.ok(result.blocking.some((b) => b.includes('RC channel requires')));
    });
  });

  // ── --auto-rc-commit: discovers the prior RC tag from git history alone ──
  // Code-review follow-up: the Stable CI path (a plain `push: tags: v*`
  // event) has no workflow_dispatch input to carry an explicit --rc-commit,
  // so wiring the gate into that path requires this auto-discovery.
  await t('release gate --auto-rc-commit discovers the matching "vX.Y.Z-rc.*" tag and finds zero drift for a clean version-bump-only promotion', async () => {
    await withFixture(async (repo) => {
      repo.writeFile('package.json', JSON.stringify({ name: 'fixture-app', version: '0.9.12-rc.1' }, null, 2));
      repo.commitAll('chore: fixture RC at 0.9.12-rc.1');
      repo.git(['tag', '-a', 'v0.9.12-rc.1', '-m', 'RC tag']);

      repo.writeFile('package.json', JSON.stringify({ name: 'fixture-app', version: '0.9.12' }, null, 2));
      repo.commitAll('chore(release): bump to stable 0.9.12');

      const r = repo.run(['release', 'gate', '--tag', 'v0.9.12', '--channel', 'stable', '--auto-rc-commit', '--json']);
      assert.equal(r.ok, true, r.output);
      const result = JSON.parse(r.output);
      assert.equal(result.autoDiscoveredRcTag, 'v0.9.12-rc.1');
      assert.equal(result.sourceDrift.checked, true);
      assert.equal(result.sourceDrift.drifted, false);
    });
  });

  await t('release gate --auto-rc-commit picks the HIGHEST-numbered RC tag when multiple RCs exist for the same version', async () => {
    await withFixture(async (repo) => {
      repo.writeFile('package.json', JSON.stringify({ name: 'fixture-app', version: '0.9.12-rc.1' }, null, 2));
      repo.commitAll('chore: fixture RC 1');
      repo.git(['tag', '-a', 'v0.9.12-rc.1', '-m', 'RC 1']);

      repo.writeFile('package.json', JSON.stringify({ name: 'fixture-app', version: '0.9.12-rc.2' }, null, 2));
      repo.commitAll('chore: fixture RC 2 (supersedes RC 1)');
      repo.git(['tag', '-a', 'v0.9.12-rc.2', '-m', 'RC 2']);
      const rc2Commit = repo.git(['rev-parse', 'HEAD']).trim();

      repo.writeFile('package.json', JSON.stringify({ name: 'fixture-app', version: '0.9.12' }, null, 2));
      repo.commitAll('chore(release): bump to stable 0.9.12, promoted from RC 2');

      const r = repo.run(['release', 'gate', '--tag', 'v0.9.12', '--channel', 'stable', '--auto-rc-commit', '--json']);
      assert.equal(r.ok, true, r.output);
      const result = JSON.parse(r.output);
      assert.equal(result.autoDiscoveredRcTag, 'v0.9.12-rc.2', 'must pick the latest RC, not the first one found');
      void rc2Commit;
    });
  });

  await t('release gate --auto-rc-commit still requires --override-drift-check when NO matching RC tag exists', async () => {
    await withFixture(async (repo) => {
      repo.writeFile('package.json', JSON.stringify({ name: 'fixture-app', version: '0.9.12' }, null, 2));
      repo.commitAll('chore(release): emergency hotfix, no preceding RC');

      const r = repo.run(['release', 'gate', '--tag', 'v0.9.12', '--channel', 'stable', '--auto-rc-commit', '--json']);
      assert.equal(r.ok, false);
      const result = JSON.parse(r.output);
      assert.equal(result.autoDiscoveredRcTag, null);
      assert.ok(result.blocking.some((b) => b.includes('none could be auto-discovered')));
    });
  });

  summarize('updateChannel.test.js');
}

main();
