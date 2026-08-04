# AI-FEAT-006 — Application Auto-Update

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-006 |
| Category | Application Platform |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
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
| Related decisions | None recorded |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | Not yet covered in 11_ARCHITECTURAL_EVOLUTION.md's relationship map |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | No dedicated test file identified via automated search of `test/` (17 test files exist repository-wide, concentrated in the metadata subsystem — see AI-FEAT-029 through AI-FEAT-033) |
| Documentation completeness | Partial — 3 unresolved evidence gaps in this file (see fields/sections marked "Evidence pending" above) |

## Summary

Self-update mechanism using `electron-updater` against GitHub Releases. Checks 3 seconds after launch, then every 4 hours, broadcasts state to all windows, and only installs on explicit user action.

## Current Behavior

`services/autoUpdater.js`: checks for updates 3s post-launch and every 4h thereafter; broadcasts `update-available`, `download-progress`, and `update:ready` IPC events to all open windows; `quitAndInstall()` is user-gated (not automatic); maintains `_lastUpdateState` so a renderer window that attaches late (e.g. a modal opened after the check already ran) can still see the current state on demand rather than missing the original broadcast.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

No entries yet — this feature's history was not part of either research pass's scope; only its current shape has been verified.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending — no independently-verified first-implementation date exists in this file's header table.

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: Evidence pending — Evolution / Implementation Journal above has no dated entries.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `services/autoUpdater.js`
