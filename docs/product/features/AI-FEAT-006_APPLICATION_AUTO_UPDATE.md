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

## Summary

Self-update mechanism using `electron-updater` against GitHub Releases. Checks 3 seconds after launch, then every 4 hours, broadcasts state to all windows, and only installs on explicit user action.

## Current Behavior

`services/autoUpdater.js`: checks for updates 3s post-launch and every 4h thereafter; broadcasts `update-available`, `download-progress`, and `update:ready` IPC events to all open windows; `quitAndInstall()` is user-gated (not automatic); maintains `_lastUpdateState` so a renderer window that attaches late (e.g. a modal opened after the check already ran) can still see the current state on demand rather than missing the original broadcast.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

No entries yet — this feature's history was not part of either research pass's scope; only its current shape has been verified.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `services/autoUpdater.js`
