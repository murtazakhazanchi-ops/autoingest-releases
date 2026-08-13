# DEC-018 — Part 9 — Multi-Channel Release & Update System: design and implementation

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-057, AI-FEAT-006, AI-FEAT-005, AI-FEAT-008, AI-RM-010 |
| Status | Accepted (2026-08-13, following live-pilot verification — see Review Note) |
| Date | 2026-08-12 |
| Evidence status | Auto-drafted by Part 8 conversation decision linkage from ENG-CONV-0004; source packet's own recorded evidence cleared the two-alternatives-plus-accepted-solution bar |

## Context

Design and implement a formal multi-channel release architecture (Development / RC-Preview / Stable) for AutoIngest, replacing the single-path release process that produced the v0.9.11 empty-release incident (PM-002), so a tester-facing build can exist without ever risking exposure to Stable users, and so a verified RC has an auditable, gated promotion path to Stable.

## Options Considered

1. **Exact-binary promotion: re-upload the verified RC's already-built artifacts under the Stable tag/release.** — rejected: The app's own version string is embedded in the artifact at build time only (asar package.json, Windows version resource, macOS Info.plist) — the running app would permanently misreport its own version, breaking allowPrerelease's version-based default and misleading support/telemetry. See DEC-017.
2. **Rely on naming convention alone (e.g. file/tag naming) for channel isolation, without explicit electron-updater channel/allowPrerelease configuration.** — rejected: The task explicitly required preferring explicit channel configuration; naming convention alone would not provide the structural (API-level) isolation guarantee electron-updater's GitHub provider already offers for free.
3. **Let electron-builder auto-create the RC's GitHub release/tag itself (its own getOrCreateRelease() fallback) rather than having the CI workflow create and push the tag explicitly.** — rejected: Verified from electron-publish's createRelease() source that it omits target_commitish entirely — a newly-created release would attach to the repository's default branch, not necessarily the exact commit the RC workflow ran against.

## Decision

Isolation between Stable and RC/Preview channels relies on electron-updater's own GitHub-provider mechanics (allowPrerelease + channel), not custom application logic — verified as structurally sufficient directly from the installed library's source.; RC promotion to Stable rebuilds from the verified RC's exact source commit, changing only the version string, rather than promoting the RC's already-built binaries — see DEC-017.; The release gate's checks (version/tag/lockfile alignment, channel-shape validation, source drift, blocking bugs) are all hard-blocking with no warning-only outcome for a release-critical mismatch.; The Stable CI path must invoke the release gate automatically (stable-release-gate job with needs: on create-release) rather than relying on a human to run it manually — added after architecture review identified this as the single biggest remaining risk.; The live CI pilot (an actual workflow_dispatch RC run) is explicitly deferred to a separate, later-authorized activation step, not performed as part of this implementation pass.

## Consequences

Evidence pending — not present in imported packet

## Reconciliation Note

Option 1 and the corresponding first bullet of the Decision section above restate, at a summary level, what [DEC-017](DEC-017_STABLE_RELEASES_REBUILD_FROM_VERIFIED_RC_SOURCE_NEVER_PROMOTE_EXACT_BINARIES.md) already documents in full technical detail (the exact three places a version string is embedded in a built artifact, the precise `git diff` formula the release gate enforces, etc.) — DEC-017 remains the authoritative, detailed record for the promotion-model decision specifically. This record's own distinct scope is the four other, broader Part 9 decisions DEC-017 does not cover: the isolation-mechanism choice (rely on electron-updater's own GitHub-provider mechanics rather than custom code), the hard-blocking gate policy, the Stable-CI-wiring decision (added after architecture review), and the live-pilot deferral. Not a duplicate to be merged away — a broader design-session record that happens to restate one narrower, already-documented decision alongside decisions no other record covers.

## Review Note

Auto-drafted from an imported conversation (ENG-CONV-0004) — a human or a future agent session should confirm this Status should move to Accepted (or Rejected/Deferred) before this record is relied on as settled. This draft was never triggered by a git hook — see docs/product/18_ENGINEERING_CONVERSATION_POLICY.md § 10.

**2026-08-13 — moved to Accepted.** The Decision section's isolation-mechanism claim was verified against real GitHub state, not only against library source: a real `workflow_dispatch` RC pilot (`v0.9.12-rc.1`/`v0.9.12-rc.2`) confirmed Stable's `/releases/latest` and `latest.yml`/`latest-mac.yml` were never affected by RC publication, including during a real partial-publish failure ([BUG-015](../bugs/BUG-015_WINDOWS_RUNNER_DEFAULT_POWERSHELL_SHELL_MANGLES_ELECTRON_BUILDER_DOT_NOTATION_CLI_OVERRIDES.md)). The Stable-CI-wiring decision (`stable-release-gate` with `needs:` on `create-release`) and the hard-blocking gate policy were both exercised via a local promotion-gate dry run (zero-drift pass, unrelated-drift block, both correct). The Decision section's closing sentence ("the live CI pilot... is explicitly deferred") is now historical — the CI/publication-side pilot has been performed; see [AI-FEAT-057](../features/AI-FEAT-057_MULTI_CHANNEL_RELEASE_UPDATE_SYSTEM.md)'s Evolution / Implementation Journal for the full result. What remains outstanding is real-installed-client verification (an actual Windows machine's updater), not covered by this decision's own scope.
