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
| Latest major update | 2026-08-13 — live CI pilot (v0.9.12-rc.1/rc.2), Windows-shell bug found and fixed (BUG-015), Stable-isolation and promotion-gate verified against real GitHub state; real-client (installed Windows app) verification still pending |

## Lifecycle Metadata

| Field | Value |
|---|---|
| Related features | AI-FEAT-006, AI-FEAT-005 |
| Related decisions | [DEC-017](../decisions/DEC-017_STABLE_RELEASES_REBUILD_FROM_VERIFIED_RC_SOURCE_NEVER_PROMOTE_EXACT_BINARIES.md) (promotion model, detailed), [DEC-018](../decisions/DEC-018_PART_9_MULTI_CHANNEL_RELEASE_UPDATE_SYSTEM_DESIGN_AND_IMPLEMENTATION.md) (Accepted 2026-08-13, following live-pilot verification — broader design-session record: isolation mechanism, gate policy, CI wiring) |
| Related bugs | [BUG-015](../bugs/BUG-015_WINDOWS_RUNNER_DEFAULT_POWERSHELL_SHELL_MANGLES_ELECTRON_BUILDER_DOT_NOTATION_CLI_OVERRIDES.md) (found and fixed during the live RC pilot) |
| Related postmortems | [PM-002](../postmortems/PM-002_V0_9_11_FIRST_PUBLICATION_ATTEMPT_PRODUCED_AN_EMPTY_GITHUB_RELEASE.md) (the incident this feature's release gate directly closes the gap behind) |
| Related architectural evolution sections | [§ Multi-Channel Release Architecture](../11_ARCHITECTURAL_EVOLUTION.md#multi-channel-release-architecture) |
| Related release notes | Not yet in a published `docs/release-notes-*.md` — this feature ships ahead of the next stable version that will carry it in its own notes |
| Testing coverage | `scripts/product-docs/test/automation/updateChannel.test.js` (19 assertions — all Part 9 channel-resolution and gate coverage, including `--auto-rc-commit`, lives here), `scripts/product-docs/lib/updateChannelModel.js` (the pure model those assertions drive). `releaseIntelligence.test.js` itself was not modified in this session — its own 10 assertions (from the prior PM-002 repair session) cover `checkVersionTagAlignment` only, unaffected by and unrelated to this feature's `checkChannelReleaseGate` coverage. **Live-pilot evidence (2026-08-13, not a unit test):** two real `workflow_dispatch` RC runs (v0.9.12-rc.1, v0.9.12-rc.2) against the real GitHub repository — see Evolution / Implementation Journal below for full results. |
| Documentation completeness | Complete for the CI/publication-side scope, verified against real GitHub state. The real-installed-client verification (a Windows machine actually running the updater against the published RC) is still pending — see Future Enhancements |

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
- **2026-08-13** — Live CI pilot. Triggered the real `rc-build` `workflow_dispatch` path for the first time (`build_type: rc`, `rc_version: 0.9.12-rc.1`). `rc-tag` correctly created and pushed `v0.9.12-rc.1` from the exact HEAD commit (`a507c47`), with no unrelated feature work. `rc-build-mac` succeeded and published (8 mac assets + `rc-mac.yml`, `prerelease:true`). `rc-build-windows` **failed** at the electron-builder publish step — see [BUG-015](../bugs/BUG-015_WINDOWS_RUNNER_DEFAULT_POWERSHELL_SHELL_MANGLES_ELECTRON_BUILDER_DOT_NOTATION_CLI_OVERRIDES.md) for the full root-cause investigation (windows-2022's default `pwsh` shell mangled the `-c.publish.channel=rc` CLI argument). Verified live, at the moment of this partial failure, that Stable isolation held regardless: `v0.9.12-rc.1`'s GitHub release remained `prerelease:true`, `/releases/latest` continued resolving to `v0.9.11`, and Stable's `latest.yml`/`latest-mac.yml` were confirmed byte-identical to their pre-pilot state. Fixed the root cause (`shell: bash` added to the affected step, commit `66469f5`) and re-ran as `v0.9.12-rc.2` from that fix commit — both `rc-build-windows` and `rc-build-mac` succeeded, publishing a complete 12-asset RC release with both `rc.yml` and `rc-mac.yml` correctly scoped to `0.9.12-rc.2` only. `v0.9.12-rc.1` (mac-only, partial) was **not** deleted or altered — left in place as a real example of the rollback runbook's "partially uploaded RC" scenario, superseded by `v0.9.12-rc.2` per the runbook (see § Rollback / Recovery Runbook below). Ran the Stable promotion gate as a local dry run (no `v0.9.12` tag created): `release gate --channel stable --rc-commit 66469f5 --stable-commit 66469f5` (same commit) correctly `PASS`ed with zero drift; `release gate --channel stable --rc-commit 66469f5 --stable-commit 942bce1` (a deliberately unrelated earlier commit) correctly `BLOCK`ed, listing 51 drifted files. A final security/architecture/code review pass against the real pilot diff found no CRITICAL/HIGH issues (see Decisions section below for the one accepted structural note). Real-installed-client verification (an actual Windows machine checking for updates on Stable vs. Preview channel) was not performed in this session — tester instructions were produced and handed off; see Future Enhancements.

## Rollback / Recovery Runbook

Informed directly by [PM-002](../postmortems/PM-002_V0_9_11_FIRST_PUBLICATION_ATTEMPT_PRODUCED_AN_EMPTY_GITHUB_RELEASE.md) and now additionally proven by a real incident during the 2026-08-13 live pilot (see above). Applies to the RC/Preview channel; Stable's own recovery procedure is PM-002's own documented sequence (unchanged by this feature).

- **Failed or partially-uploaded RC build** (real example: `v0.9.12-rc.1`, mac assets published, Windows publish failed): never auto-delete or auto-recreate the release. Diagnose from the actual workflow logs first (`gh run view <id> --job=<id> --log`) — the failure mode is rarely what the top-level job status implies; read the actual publish-step output, not just red/green. Leave the partial release in place; it does no harm (still `prerelease:true`, still structurally isolated from Stable, still requires explicit Preview opt-in to even be discoverable). Fix the root cause, then supersede with the next RC number (`rc.N+1`) — `rc-tag`'s own collision check refuses to let a fixed rerun silently overwrite the broken tag, so incrementing is the only path the pipeline allows, which is itself a safety property, not a limitation.
- **Incorrect RC metadata discovered after publication**: same pattern — do not hand-edit a published `.yml` channel file or re-upload over an existing asset. Supersede with a new RC number built cleanly from a corrected source commit.
- **Tester rejection / RC found to have a real bug**: mark the RC as rejected in whatever tracking surface is being used for that release cycle (this feature does not yet automate that state); fix the bug on `main`, cut a new RC number. The rejected RC's GitHub prerelease is left in place as historical evidence, per this repository's general "append, don't erase" documentation discipline — it is not deleted.
- **Abandoned RC** (development moved on without ever promoting it to Stable): left in place indefinitely unless it is confirmed to contain something that must not remain public (credentials, broken security posture) — in which case deletion requires the same explicit, human-authorized process PM-002 actually used (verify independently, confirm the *other* channel is untouched, then delete), never an automated cleanup.
- **No automated process may delete or rewrite a published release or tag** — every corrective action above is manual and explicit. This is unchanged from PM-002's own resolution and was not weakened by adding the RC channel.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type — it adds no new facts beyond the header table and Evolution / Implementation Journal above.

**Initial implementation**: 2026-08-12, in one session, directly following the v0.9.11 stabilization and its release-process incident (PM-002).

**Architectural / workflow decisions**: [DEC-017](../decisions/DEC-017_STABLE_RELEASES_REBUILD_FROM_VERIFIED_RC_SOURCE_NEVER_PROMOTE_EXACT_BINARIES.md) — Stable rebuilds from verified-RC source rather than promoting exact binaries.

**Reliability / correctness fixes**: [BUG-015](../bugs/BUG-015_WINDOWS_RUNNER_DEFAULT_POWERSHELL_SHELL_MANGLES_ELECTRON_BUILDER_DOT_NOTATION_CLI_OVERRIDES.md) — Windows RC publish step failed under `pwsh`'s default argument tokenization; fixed with an explicit `shell: bash`, found only once the live pilot exercised this code path for the first time.

**Other dated milestones**: 2026-08-13 — live CI pilot (see Evolution / Implementation Journal above): both RC publish paths proven end-to-end against real GitHub state; Stable isolation and the promotion gate's drift check both verified with real evidence, not simulated. Real-installed-client verification remains outstanding.

## Known Bugs / Troubleshooting

- [BUG-015](../bugs/BUG-015_WINDOWS_RUNNER_DEFAULT_POWERSHELL_SHELL_MANGLES_ELECTRON_BUILDER_DOT_NOTATION_CLI_OVERRIDES.md) — Windows RC publish step failed under PowerShell's default argument tokenization. Fixed.

## Decisions

See [DEC-017](../decisions/DEC-017_STABLE_RELEASES_REBUILD_FROM_VERIFIED_RC_SOURCE_NEVER_PROMOTE_EXACT_BINARIES.md) (promotion model) and [DEC-018](../decisions/DEC-018_PART_9_MULTI_CHANNEL_RELEASE_UPDATE_SYSTEM_DESIGN_AND_IMPLEMENTATION.md) (Accepted 2026-08-13 — the broader Part 9 design-session decisions DEC-017 doesn't cover).

**Accepted structural note from the 2026-08-13 pilot review (not a DEC-record — no real alternative was weighed, it's an observed and accepted risk, not a choice between options):** `rc-build-windows` and `rc-build-mac` each depend only on `rc-tag`, not on each other, and each independently publishes assets to the same GitHub prerelease — there is no atomic "publish only if both platforms succeed" gate. This is exactly the mechanism that produced the `v0.9.12-rc.1` partial (mac-only) release. The pilot proved the failure mode is graceful (isolation held, nothing corrupted, superseding with the next RC number is the pipeline's own natural recovery path) rather than dangerous, so this is accepted as-is rather than requiring a new gate.

## Future Enhancements

- Real-installed-client verification: an actual Windows machine, currently on Stable v0.9.11, checking for updates on the Stable channel (must not see the RC) and then on the Preview channel (must see it), installing it, confirming persistence across restart, and confirming no silent downgrade on returning to Stable. Tester instructions were produced 2026-08-13; results are pending a real tester run. This is the one remaining gap between "infrastructure proven" and "fully activated" — see the Part 9 pilot final report.

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
