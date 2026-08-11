# PM-002 — v0.9.11 First Publication Attempt Produced an Empty GitHub Release

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-006 |
| Severity | Medium |
| Date of incident | 2026-08-11 |
| Date resolved | 2026-08-11 |
| Evidence status | Verified from Git history, GitHub Actions run logs, and the GitHub Releases/Tags API |

## Summary

The first `v0.9.11` git tag was pushed to trigger AutoIngest's stable release workflow while `package.json`'s `"version"` field still read `0.9.10`. `electron-builder` derives both its published artifact filenames and which GitHub release it targets from `package.json`'s version — not from the git tag that triggered the workflow — so it built real `0.9.10`-named Windows and macOS artifacts and attempted to publish them against the already-published `v0.9.10` release. `electron-builder`'s own overwrite-protection guard (`existing release published more than 2 hours ago`) correctly refused to touch that release and silently skipped every upload. The `create-release` job had already created a `v0.9.11` GitHub Release, so the net result was a real, public, non-draft `v0.9.11` release with zero assets and no updater metadata.

## Impact

- The `v0.9.11` GitHub Release was live and public for approximately 24 minutes with zero assets attached.
- `v0.9.10`'s release was not modified, corrupted, or touched in any way — `electron-builder`'s guard worked exactly as designed.
- No `latest.yml`/`latest-mac.yml` was ever published for `v0.9.11`, so no installed AutoIngest client (all on `v0.9.10` or earlier) could discover or attempt to fetch the empty release through the normal `electron-updater` channel. There was no production update-corruption risk at any point.
- Both GitHub Actions jobs (`build-windows`, `build-mac`) reported `success` at the process-exit-code level despite not actually publishing anything — `electron-builder`'s "skip, already published" behavior is not treated as a failure by the tool itself, so job status alone was not a sufficient signal that the release succeeded.

## Timeline

- **2026-08-11 11:29 UTC** — `v0.9.11` tag (commit `977e1f2`) pushed; `release.yml` triggered. `create-release` job succeeds, creating a public, non-draft, non-prerelease `v0.9.11` GitHub Release with no assets yet.
- **2026-08-11 11:32 UTC** — `build-windows` and `build-mac` jobs each build real `0.9.10`-named artifacts (`package.json` still read `0.9.10`) and attempt to publish. `electron-builder` logs `GitHub release not created  reason=existing release published more than 2 hours ago tag=v0.9.10` and skips every upload for both platforms. Both jobs exit 0.
- **2026-08-11 ~11:53 UTC** — Post-release verification (`gh api .../releases/tags/v0.9.11`) finds `assets_count: 0`, contradicting both jobs' reported `success`. Investigation opens both jobs' full logs and finds the `skipped publishing` / `existing release published more than 2 hours ago` lines identifying the root cause.
- **2026-08-11 11:53 UTC** — Repair authorized. `package.json`/`package-lock.json` bumped to `0.9.11` (commit `7bb6017`) and pushed to `main`.
- **2026-08-11 11:53 UTC** — Empty `v0.9.11` GitHub Release deleted (`gh release delete v0.9.11`); `v0.9.10` release independently re-confirmed intact (12 assets, unchanged) immediately before and after.
- **2026-08-11 11:53 UTC** — Failed `v0.9.11` tag deleted locally and on `origin` (`git tag -d` / `git push origin :refs/tags/v0.9.11`).
- **2026-08-11 11:53 UTC** — Fresh annotated `v0.9.11` tag created on the version-corrected commit (`7bb6017`) and pushed, re-triggering `release.yml`.
- **2026-08-11 ~11:56 UTC** — Rebuild completes. Logs confirm `publisher=Github (... version: 0.9.11)` and real `uploading` lines (no skips) for all 12 expected artifacts on both platforms. `gh api .../releases/tags/v0.9.11` confirms 12 assets, `draft: false`, `prerelease: false`. `latest.yml`/`latest-mac.yml` fetched directly and confirmed to declare `version: 0.9.11` with correct URLs/checksums.
- **2026-08-11** — `scripts/product-docs/automation/releaseIntelligence.js` extended with `checkVersionTagAlignment()` and a new `release gate --tag <version>` CLI subcommand (commit `e634d9a`) as a permanent, testable precondition check for this exact failure mode, with 4 new regression tests including a direct reproduction of this incident's mismatch.

## Root Cause

`electron-builder`'s GitHub publish provider determines both its target release and its artifact filenames from `package.json`'s `"version"` field, entirely independent of which git ref or tag triggered the CI workflow. The project's release process assumed pushing a `v0.9.11` tag was sufficient to produce a `v0.9.11` release, but nothing in the existing `release.yml` workflow, `docs/product/CLAUDE.md`, or prior release history made explicit that `package.json` must be bumped to the matching version *before* the tag is created. `electron-builder`'s own safety guard against overwriting an already-published release is what surfaced this as a silent no-op (empty release) rather than a corrupted `v0.9.10` release or a hard CI failure — a defensible design choice by `electron-builder`, but one that meant a genuine release-preparation gap produced a job status of `success` with no actual publication.

## Resolution

1. `package.json` and `package-lock.json` bumped from `0.9.10` to `0.9.11` (`npm version 0.9.11 --no-git-tag-version`, commit `7bb6017`).
2. The empty `v0.9.11` GitHub Release deleted; `v0.9.10` confirmed untouched before and after.
3. The mismatched `v0.9.11` tag deleted locally and on `origin`.
4. A fresh, correctly-annotated `v0.9.11` tag created on the version-corrected commit and pushed, re-triggering the real release workflow.
5. Rebuild verified end-to-end: correct artifact names, real (non-skipped) uploads, correct updater metadata, 12 assets present, `v0.9.10` still intact.

## Follow-up Actions

- **Done**: `node scripts/product-docs/cli.js release gate --tag <vX.Y.Z>` (`scripts/product-docs/automation/releaseIntelligence.js`'s `checkVersionTagAlignment()`) checks `package.json`'s (and `package-lock.json`'s, when it carries a version field) version against a target release version and exits non-zero on mismatch, with 4 regression tests including a direct reproduction of this incident. Run this before creating any future stable release tag.
- **Not yet done**: `release gate` is not yet wired into `release.yml` itself as an automated pre-tag CI check (it exists as a locally-run, explicitly-invoked command per the existing Part 7 "drafts/checks only, never auto-publishes" boundary) — a future enhancement could add a `workflow_dispatch`-triggered or pre-tag-hook invocation, but that was out of scope for this corrective action per the instruction not to alter stable release behavior beyond preventing mismatched version/tag releases.

## Related

- [AI-FEAT-006](../features/AI-FEAT-006_APPLICATION_AUTO_UPDATE.md) — Application Auto-Update (the publish/update-channel surface this incident affected).
- `docs/product/generated/release-drafts/v0.9.10_TO_main.md` — the release-intelligence draft reviewed ahead of this release.
- `docs/release-notes-v0.9.11.md` — the user-facing release notes this incident delayed but did not require changing.
- This is a release-process incident, not an Event Management defect — BUG-011 through BUG-014's own statuses are unaffected and unchanged by this record.
