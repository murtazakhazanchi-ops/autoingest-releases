# AI-FEAT-006 — Application Auto-Update

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-006 |
| Category | Application Platform |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | AI-FEAT-057 (Multi-Channel Release & Update System) |
| Dependencies | AI-FEAT-005 (settings), AI-FEAT-007 (telemetry consumes update state) |
| Related roadmap milestone | None |
| Related technical docs | None dedicated |
| Evidence status | Verified from current code (`autoingest-architect` review pass — missed by both initial research forks) |
| First-known implementation | Evidence pending |
| Latest major update | Evidence pending |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | None beyond Dependencies/Parent/Subfeatures already listed in the header table above |
| Related decisions | [DEC-017](../decisions/DEC-017_STABLE_RELEASES_REBUILD_FROM_VERIFIED_RC_SOURCE_NEVER_PROMOTE_EXACT_BINARIES.md) (via AI-FEAT-057) |
| Related bugs | None recorded |
| Related postmortems | [PM-002](../postmortems/PM-002_V0_9_11_FIRST_PUBLICATION_ATTEMPT_PRODUCED_AN_EMPTY_GITHUB_RELEASE.md) |
| Related architectural evolution sections | Not yet covered in 11_ARCHITECTURAL_EVOLUTION.md's relationship map |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | No dedicated test file identified via automated search of `test/` (17 test files exist repository-wide, concentrated in the metadata subsystem — see AI-FEAT-029 through AI-FEAT-033) |
| Documentation completeness | Partial — 3 unresolved evidence gaps in this file (see fields/sections marked "Evidence pending" above) |

## Summary

Self-update mechanism using `electron-updater` against GitHub Releases. Checks 3 seconds after launch, then every 4 hours, broadcasts state to all windows, and only installs on explicit user action.

**Why this exists** (*Known from project history; repository evidence pending* — captured during the Product-Owner Purpose Capture interview, 2026-08-14): standardizes and automates release distribution across deployed AutoIngest machines, removing a recurring release-distribution maintenance burden. Before this existed, releases were distributed manually to each operator's machine. This was not built in response to one dramatic incident — the stated motivation was proactive relief of ongoing maintenance friction: "this is repetitive release-distribution work that should happen automatically rather than requiring me to worry about it after every release." The manual install-confirmation step (`quitAndInstall()` requiring an explicit operator click — see Current Behavior) is an intentionally preserved human decision point, not an oversight.

## Current Behavior

`services/autoUpdater.js`: checks for updates 3s post-launch and every 4h thereafter; broadcasts `update-available`, `download-progress`, and `update:ready` IPC events to all open windows; `quitAndInstall()` is user-gated (not automatic); maintains `_lastUpdateState` so a renderer window that attaches late (e.g. a modal opened after the check already ran) can still see the current state on demand rather than missing the original broadcast. As of AI-FEAT-057 (Part 9), `init()` also applies the user's Stable/Preview channel preference (`applyChannelSetting()`) before the first check ever runs — see AI-FEAT-057 for the full multi-channel design; this feature's own default (no setting present) behaves identically to before AI-FEAT-057 existed.

## Original Plan / Intent

Evidence pending regarding this feature's originally-scoped requirements. See Summary above for the product-owner rationale captured 2026-08-14 (proactive relief of recurring manual-distribution burden) — that describes currently-understood purpose, not necessarily original scoping.

## Evolution / Implementation Journal

No entries yet regarding implementation history — this feature's history was not part of either research pass's scope; only its current shape has been verified.

- **2026-08-14** — Purpose/history captured — Product-Owner Purpose Capture interview. Added the release-distribution-burden rationale in Summary above. No code changed.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending — no independently-verified first-implementation date exists in this file's header table.

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: Evidence pending — Evolution / Implementation Journal above has no dated entries.

## Known Bugs / Troubleshooting

Not a defect in this feature's own runtime code — see [PM-002](../postmortems/PM-002_V0_9_11_FIRST_PUBLICATION_ATTEMPT_PRODUCED_AN_EMPTY_GITHUB_RELEASE.md): the first `v0.9.11` release-publish attempt produced an empty GitHub Release (zero assets, no updater metadata) because `package.json`'s version was not bumped before tagging — `electron-builder` derives its publish target/artifact names from that field, not the git tag. No client could discover the empty release since no `latest.yml`/`latest-mac.yml` was ever published for it; the release-preparation gap was corrected and a permanent `release gate` check added to prevent recurrence.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `services/autoUpdater.js`
