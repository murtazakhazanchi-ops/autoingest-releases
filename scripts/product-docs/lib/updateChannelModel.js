'use strict';

// Part 9 — a pure, dependency-free model of electron-updater's GitHub
// provider release-resolution logic, for testing and reasoning about
// channel isolation WITHOUT running Electron or making a real network call.
// This mirrors (does not reimplement or replace) the verified behavior in
// node_modules/electron-updater/out/providers/GitHubProvider.js /
// AppUpdater.js at the version pinned in package.json — see each function's
// comment for the exact source lines this was checked against. If
// electron-updater's own algorithm ever changes, this model (and its
// regression tests in test/automation/updateChannel.test.js) should be
// re-verified against the new source, not assumed still accurate.

// This file is required directly by scripts/product-docs/test/*.test.js,
// which the "Product Documentation Validation" CI workflow runs WITHOUT an
// `npm install` step (product-docs.yml's own header comment: "no npm
// dependencies") — so this module must resolve using only Node builtins.
// The only semver operation needed anywhere in this codebase's Part 9 logic
// is extracting a version string's prerelease identifiers (the "rc.1" part
// of "0.9.12-rc.1"). `semverPrerelease` below is a minimal, spec-faithful
// reimplementation of the `semver` npm package's own `prerelease()`
// function, cross-checked byte-for-byte against it across 20 cases
// (plain/prerelease/build-metadata/"v"-prefixed/invalid versions) before
// being substituted in — see the commit that introduced this comment for
// that verification. Do not reintroduce `require('semver')` here.
function semverPrerelease(version) {
  if (typeof version !== 'string') return null;
  const m = /^v?\d+\.\d+\.\d+-([0-9A-Za-z.-]+?)(?:\+.*)?$/.exec(version.trim());
  if (!m) return null;
  return m[1].split('.').map((part) => (/^(0|[1-9]\d*)$/.test(part) ? Number(part) : part));
}

// AppUpdater.js: `this.allowPrerelease = hasPrereleaseComponents(currentVersion)`
// — the client-side default before any explicit setting is applied.
function defaultAllowPrerelease(currentVersion) {
  const pre = semverPrerelease(currentVersion);
  return pre != null && pre.length > 0;
}

// GitHubProvider.js's getLatestVersion(): Layer 1 (allowPrerelease=false)
// calls GET {repo}/releases/latest — GitHub's own API, which by definition
// returns only the most recent non-draft, non-prerelease release. Layer 2
// (allowPrerelease=true) walks the full releases feed (draft releases are
// never present in either the public feed or /releases/latest — GitHub
// itself excludes drafts from both) and selects by channel match. `releases`
// must be pre-sorted newest-first (the real feed is GitHub-sorted by
// created_at descending); this model does not re-sort by semver, matching
// the real algorithm's own feed-order-dependent selection.
function resolveOfferedRelease({ allowPrerelease, channel, currentVersion }, releases) {
  const candidates = releases.filter((r) => !r.draft);

  if (!allowPrerelease) {
    // Layer 1 — GET /releases/latest semantics: first non-prerelease entry.
    const stable = candidates.find((r) => !r.prerelease);
    return stable || null;
  }

  // Layer 2 — resolved channel is the explicit setting, or (if unset) the
  // installed version's own prerelease component (AppUpdater.js /
  // GitHubProvider.js's `this.updater.channel || semver.prerelease(currentVersion)?.[0]`).
  const resolvedChannel = channel || (semverPrerelease(currentVersion) || [])[0] || null;

  if (resolvedChannel === null) {
    // No channel context at all — the real code takes the feed's very first
    // entry (GitHubProvider.js: `latestRelease.element("link")...` before
    // the loop even runs). With no channel to match, that is simply the
    // newest entry overall, prerelease or not.
    return candidates[0] || null;
  }

  for (const r of candidates) {
    const releaseChannel = (semverPrerelease(r.tag) || [])[0] || null;
    // A plain (non-prerelease) release is always an acceptable target for
    // any resolved channel — GitHubProvider.js's `shouldFetchVersion`
    // branch treats a tag with no prerelease component as fetchable
    // regardless of the client's current channel.
    if (releaseChannel === null) return r;
    if (releaseChannel === resolvedChannel) return r;
  }
  return null;
}

module.exports = { defaultAllowPrerelease, resolveOfferedRelease };
