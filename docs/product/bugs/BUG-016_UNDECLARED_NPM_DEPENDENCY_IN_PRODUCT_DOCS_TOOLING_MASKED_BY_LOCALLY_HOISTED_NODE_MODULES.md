# BUG-016 — Undeclared npm Dependency in product-docs Tooling Masked by Locally-Hoisted node_modules

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-057 (Multi-Channel Release & Update System) |
| Status | Fixed |
| Severity | Medium |
| Discovered | 2026-08-13 (CI run `31667229566`, "Product Documentation Validation" workflow) |
| Fixed | 2026-08-13 (commit `fed471d`) |
| Evidence status | Verified from the real GitHub Actions run log and reproduced deterministically in a fresh `git worktree` with no `node_modules` |

## Symptom

`scripts/product-docs/test/automation/updateChannel.test.js` failed in CI with `Error: Cannot find module 'semver'` (`MODULE_NOT_FOUND`), even though the same test passed locally every time it was run during and after Part 9's implementation and live-pilot sessions.

## Root Cause

`.github/workflows/product-docs.yml` deliberately never runs `npm install` — its own header comment states the whole `scripts/product-docs/` tooling suite has "no npm dependencies," so the CI job checks out the repo and runs `node --test ...` directly, with no `node_modules/` present at all. `scripts/product-docs/lib/updateChannelModel.js` (added during Part 9) called `require('semver')`, but `semver` was never added to `package.json`'s `dependencies`/`devDependencies` — it only resolved locally because it exists as a *transitive* dependency of other packages (electron-builder and others) and npm's hoisting had placed it at the top level of the local development `node_modules/`. A fresh checkout with no install step at all has no `node_modules/` whatsoever, so the `require` failed immediately.

This is a "works on my machine" class of bug specific to this project's deliberately dependency-free documentation-tooling CI design: any code that ever runs under `product-docs.yml`'s test step must resolve using only Node builtins, and a locally-hoisted transitive dependency gives no signal that this invariant has been broken until either a real CI run or a genuinely clean checkout exercises it.

## Investigation Log

- 2026-08-13 — Compared CI run `31601541070` (2026-08-12, before Part 9's `updateChannelModel.js` existed... actually already present but not yet exercising this path in a way that failed) against `31667229566` (first failure). Pulled the full failing job log via `gh run view <id> --job=<id> --log`, found the exact `MODULE_NOT_FOUND` stack trace pointing at `updateChannelModel.js:14`.
- 2026-08-13 — Confirmed `semver` is absent from `package.json`'s `dependencies`/`devDependencies` (`node -e "require('./package.json').dependencies.semver"` → `undefined`), and present in `package-lock.json` only nested under other packages' own dependency subtrees — never as a direct project dependency.
- 2026-08-13 — Read `.github/workflows/product-docs.yml` in full: confirmed no `npm install`/`npm ci` step exists anywhere in the `validate` job, by design.
- 2026-08-13 — Reproduced deterministically: (a) copied `updateChannelModel.js` alone into an isolated directory with no `node_modules` in its ancestry — reproduced the identical `MODULE_NOT_FOUND` error; (b) created a fresh `git worktree` at the actual failing commit (zero `node_modules`, real repo content) — reproduced the identical failure in the real test file; (c) applied the fix in both environments — both passed.
- 2026-08-13 — Grepped the entire `scripts/product-docs/` tree for any other non-builtin `require(...)` — confirmed `semver` in `updateChannelModel.js` was the only instance.

## Fix

Replaced the single `semver` API this file used (`semver.prerelease(version)`) with a minimal local reimplementation (`semverPrerelease()`), cross-checked against the real `semver` package's actual output across 20 cases — plain versions, prerelease versions, build-metadata suffixes, `"v"`-prefixed versions, and invalid input — before substituting it in, so behavior did not change, only the dependency. `scripts/product-docs/lib/updateChannelModel.js`, commit `fed471d`.

## Prevention / Reusable Lesson

**Any file under `scripts/product-docs/` (or anything else it `require`s) must resolve using only Node builtins — no npm package, direct or transitive, may be relied upon — because `product-docs.yml`'s CI job never runs `npm install`.** A local `require('some-package')` succeeding during development proves nothing on its own if that package isn't a declared dependency: it may only be present because it was hoisted as some other package's transitive dependency in the *Electron app's* own `node_modules/`, which will not exist in a fresh, dependency-free checkout. Before adding any `require(...)` to this tooling tree, check `package.json`'s own `dependencies`/`devDependencies` — if the package isn't listed there, either avoid it (write the small amount of logic locally, as done here) or reconsider whether this file truly belongs under `scripts/product-docs/`'s no-dependency contract at all. A `git worktree add --detach HEAD` into a scratch path is a fast, low-risk way to get a genuinely `node_modules`-less checkout of the real repository content for exactly this kind of verification, without needing a container or deleting real local state.

## Related

- [AI-FEAT-057](../features/AI-FEAT-057_MULTI_CHANNEL_RELEASE_UPDATE_SYSTEM.md) — the feature `updateChannelModel.js` belongs to.
- [BUG-015](BUG-015_WINDOWS_RUNNER_DEFAULT_POWERSHELL_SHELL_MANGLES_ELECTRON_BUILDER_DOT_NOTATION_CLI_OVERRIDES.md) — a different CI failure found the same day, in the same feature's pipeline, but an unrelated mechanism (shell argument tokenization, not dependency resolution). Worth reading together as two examples of the same broader lesson: an untested branch of automation is a real risk until it is actually exercised once, end to end, under the real conditions it will run in.
