# AI-FEAT-057 — Multi-Channel Release & Update System

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-057 |
| Category | Application Platform |
| Status | Implemented |
| Maturity | Evolving |
| Parent feature | AI-FEAT-006 (Application Auto-Update) |
| Subfeatures | None |
| Dependencies | AI-FEAT-006 (Application Auto-Update), AI-FEAT-005 (Application Settings & Configuration Store) |
| Related roadmap milestone | AI-RM-010 |
| Related technical docs | `.github/workflows/release.yml`, `scripts/product-docs/README.md` (Part 7D — release intelligence) |
| Evidence status | Verified from current code and `node_modules/electron-updater`/`node_modules/app-builder-lib`/`node_modules/electron-publish` source at the pinned installed versions (`electron-updater@6.8.3`, `electron-builder@26.8.1`) — not from memory or external documentation |
| First-known implementation | 2026-08-12 |
| Latest major update | 2026-08-12 — initial implementation |

## Lifecycle Metadata

| Field | Value |
|---|---|
| Related features | AI-FEAT-006, AI-FEAT-005 |
| Related decisions | [DEC-017](../decisions/DEC-017_STABLE_RELEASES_REBUILD_FROM_VERIFIED_RC_SOURCE_NEVER_PROMOTE_EXACT_BINARIES.md) (promotion model, detailed), [DEC-018](../decisions/DEC-018_PART_9_MULTI_CHANNEL_RELEASE_UPDATE_SYSTEM_DESIGN_AND_IMPLEMENTATION.md) (Draft — broader design-session record: isolation mechanism, gate policy, CI wiring, pilot deferral) |
| Related bugs | None recorded |
| Related postmortems | [PM-002](../postmortems/PM-002_V0_9_11_FIRST_PUBLICATION_ATTEMPT_PRODUCED_AN_EMPTY_GITHUB_RELEASE.md) (the incident this feature's release gate directly closes the gap behind) |
| Related architectural evolution sections | [§ Multi-Channel Release Architecture](../11_ARCHITECTURAL_EVOLUTION.md#multi-channel-release-architecture) |
| Related release notes | Not yet in a published `docs/release-notes-*.md` — this feature ships ahead of the next stable version that will carry it in its own notes |
| Testing coverage | `scripts/product-docs/test/automation/updateChannel.test.js` (19 assertions — all Part 9 channel-resolution and gate coverage, including `--auto-rc-commit`, lives here), `scripts/product-docs/lib/updateChannelModel.js` (the pure model those assertions drive). `releaseIntelligence.test.js` itself was not modified in this session — its own 10 assertions (from the prior PM-002 repair session) cover `checkVersionTagAlignment` only, unaffected by and unrelated to this feature's `checkChannelReleaseGate` coverage. |
| Documentation completeness | Complete for the implemented scope; the live pilot (an actual `rc-build` workflow run) is explicitly deferred — see Future Enhancements |

## Summary

Formalizes AutoIngest's release process into three isolated channels — Development (internal engineering builds, never published), RC/Preview (real tester acceptance before Stable, opt-in only), and Stable (the existing production release path, unchanged) — so a tester-facing build can exist without ever risking exposure to Stable users, and so a verified RC has an auditable, gated path to becoming the Stable release built from its exact source.

## Current Behavior

- **Stable** (`create-release`/`build-mac`/`build-windows` in `.github/workflows/release.yml`, triggered by `push: tags: v*`): `build-mac`/`build-windows` are structurally identical to before this feature (confirmed via parsed-YAML diff, not just text diff). `create-release` gained exactly one line, `needs: stable-release-gate` — an architecture-review finding: without it, the release gate existed but was never actually invoked on the path that ships to real Stable users, so PM-002's exact failure mode was still possible whenever a human forgot to run the gate manually. `stable-release-gate` runs `release gate --channel stable --auto-rc-commit` before `create-release`, auto-discovering the matching `vX.Y.Z-rc.*` tag from git history (this trigger has no `workflow_dispatch` input to carry an explicit `--rc-commit`); a release with no matching RC tag and no `Override-Drift-Check:` line in the pushed tag's own annotated message correctly blocks rather than publishing silently unverified.
- **Development** (`development-build`, `workflow_dispatch` with `build_type: development`): renamed from `windows-tester-build`; behavior unchanged — Windows-only, `-p never`, short-retention Actions artifact, no GitHub Release, no update-channel visibility.
- **RC/Preview** (`rc-tag` + `rc-build-windows` + `rc-build-mac`, `workflow_dispatch` with `build_type: rc` and `rc_version`): the workflow creates and pushes the real git tag itself (`vX.Y.Z-rc.N`) from the exact checked-out commit before building — verified necessary because `electron-builder`'s own auto-create-release path omits `target_commitish` and would otherwise attach to the repository's default branch. Builds publish with `-c.publish.channel=rc -c.publish.releaseType=prerelease`, producing `rc.yml`/`rc-mac.yml` update-channel files and a GitHub `prerelease:true` release — never `latest.yml`/`latest-mac.yml`.
- **Client-side isolation** (`services/autoUpdater.js`'s `applyChannelSetting()`): a Stable client (`allowPrerelease=false`, the default for any plain `X.Y.Z` installed version) resolves the latest release via GitHub's `/releases/latest` endpoint (`GitHubProvider.getLatestTagName()` — for `github.com` specifically this requests the website domain, not `api.github.com`, per that function's own "avoid limit" comment; the REST API resolves identically for a public repo), which by definition excludes every prerelease/draft release — structural isolation, not a convention. A Preview-opted-in client sets `autoUpdater.channel='rc'` and `autoUpdater.allowPrerelease=true`, which walks the full release feed and matches on the `rc` channel's own `.yml` files. Code-review finding, fixed before first commit: `electron-updater`'s `channel` setter has an undocumented-in-our-comments side effect — it unconditionally sets `allowDowngrade=true` on every assignment (`AppUpdater.js`'s own doc comment: "If this behavior is not suitable for you, simply set allowDowngrade explicitly after"). Since `applyChannelSetting()` runs at every app launch for every install (not only Preview opt-ins), the Stable/`else` branch now explicitly resets `allowDowngrade=false` immediately after, restoring electron-updater's own pre-existing default for the entire non-Preview install base; the Preview branch deliberately keeps the setter's `true` side effect, since a Preview user needs it to receive a Stable release that's numerically "behind" whatever RC they were previously running.
- **User setting** (`settings:getUpdateChannel`/`settings:setUpdateChannel`, `services/settings.js`): `"stable"` (default) or `"preview"`; a missing/unrecognized value always resolves to `"stable"`. Changing it only affects what the *next* check considers — never triggers an immediate download.
- **Release gate** (`node scripts/product-docs/cli.js release gate --tag <v> --channel rc|stable`, `releaseIntelligence.checkChannelReleaseGate()`): blocks (non-zero exit, no warning-only path) on version/tag/lockfile mismatch, wrong version shape for the channel, source drift between a Stable commit and its declared verified-RC commit (excluding the version-bump files themselves) unless explicitly overridden with a reason, and currently-Open/Investigating bugs for a Stable release.

## Original Plan / Intent

Commissioned directly as "Part 9" following the v0.9.11 stabilization and its release-process incident (PM-002) — see [ENG-CONV-0004](../conversations/ENG-CONV-0004_PART_9_MULTI_CHANNEL_RELEASE_UPDATE_SYSTEM_DESIGN_AND_IMPLEMENTATION.md) for the design-session record. Intent: prevent an RC/tester build from ever being confused with or exposed to Stable users, and give a verified RC an auditable promotion path to Stable, without inventing a versioning or channel scheme electron-updater/electron-builder can't actually support.

## Evolution / Implementation Journal

- **2026-08-12** — Initial implementation. Audited the existing release system (one workflow, one version field, one publish config — every RC/Stable distinction would have had to be invented from scratch). Verified electron-updater/electron-builder's real channel mechanics directly from their installed source rather than assumed. Investigated exact-binary RC→Stable promotion and rejected it (see DEC-017) in favor of rebuild-from-verified-source. Implemented settings/updater/release-gate/CI changes; added `scripts/product-docs/lib/updateChannelModel.js` and its test coverage. The live pilot (an actual `workflow_dispatch` RC run) was explicitly deferred to a separate, later-authorized activation step.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type — it adds no new facts beyond the header table and Evolution / Implementation Journal above.

**Initial implementation**: 2026-08-12, in one session, directly following the v0.9.11 stabilization and its release-process incident (PM-002).

**Architectural / workflow decisions**: [DEC-017](../decisions/DEC-017_STABLE_RELEASES_REBUILD_FROM_VERIFIED_RC_SOURCE_NEVER_PROMOTE_EXACT_BINARIES.md) — Stable rebuilds from verified-RC source rather than promoting exact binaries.

**Reliability / correctness fixes**: None — this feature is new infrastructure, not a fix to existing behavior (its own motivating incident, PM-002, was fixed separately before this feature existed).

**Other dated milestones**: None yet beyond the initial implementation above.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

See [DEC-017](../decisions/DEC-017_STABLE_RELEASES_REBUILD_FROM_VERIFIED_RC_SOURCE_NEVER_PROMOTE_EXACT_BINARIES.md) (promotion model) and [DEC-018](../decisions/DEC-018_PART_9_MULTI_CHANNEL_RELEASE_UPDATE_SYSTEM_DESIGN_AND_IMPLEMENTATION.md) (Draft, pending review — the broader Part 9 design-session decisions DEC-017 doesn't cover).

## Future Enhancements

- Live pilot: an actual `rc-build` `workflow_dispatch` run, confirming a real Preview-opted-in install discovers it while a Stable install does not — deferred, requires explicit authorization to trigger real CI/CD (see this feature's own Evolution entry and the Part 9 final report).

## Related Files

- `.github/workflows/release.yml`
- `services/autoUpdater.js`
- `services/settings.js`
- `main/main.js` (`settings:getUpdateChannel`/`settings:setUpdateChannel` IPC handlers)
- `main/preload.js`
- `renderer/index.html` (Settings modal — Update Channel section)
- `renderer/renderer.js` (Settings modal wiring)
- `scripts/product-docs/automation/releaseIntelligence.js` (`checkChannelReleaseGate`, QA checklist, promotion readiness)
- `scripts/product-docs/lib/updateChannelModel.js`
- `scripts/product-docs/cli.js` (`release gate --channel`, `release prepare --channel`)
