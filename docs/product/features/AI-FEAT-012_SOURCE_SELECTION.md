# AI-FEAT-012 — Source Selection (Local Folder / External Drive)

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-012 |
| Category | Source Acquisition |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-011 (consumes detected drives) |
| Related roadmap milestone | None |
| Related technical docs | `docs/failure-patterns.md` #16, `docs/system-contracts.md` §4 |
| Evidence status | Verified from current code (`autoingest-architect` review pass merged what was originally two proposed entries) |
| First-known implementation | Evidence pending |
| Latest major update | v0.8.7 (source card double-selection fix) |

## Summary

Activating a source for import, whether a local folder, external drive, or memory card. Originally proposed as two separate registry entries ("Local Folder Source Selection" and "External Drive Source Selection"); merged into one after `autoingest-architect` review found `selectLocalFolder()` is a thin wrapper calling the same `_setActiveSource()` used by `selectSource()`, writing into the same `activeSource` state with only the `type` discriminator changing — no independent backend or state shape exists for local folders specifically.

## Current Behavior

`renderer/renderer.js:5690` `renderExtDrives()` renders polled drive cards; `renderer/renderer.js:5761` `selectSource({type, path, label, driveObj})` is the shared source-activation entry point used by local folder, external drive, and memory card paths alike. `renderer/renderer.js:3028` `selectLocalFolder()` opens a folder picker and delegates into the same activation path. The module-level `activeSource` variable (assigned at `renderer/renderer.js:1243`/`1267`) holds the active selection regardless of source type and is the variable at the center of the "Path Outside Source Root" race documented in `docs/failure-patterns.md` #16 and guarded against per `docs/system-contracts.md` §4's Cleanup Root Capture Rule.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

- **v0.8.7** — source card double-selection fix: clicking between source types previously left the old type's checkmark visible until the next polling cycle; each click handler now immediately clears the other list's checkmarks; `_pendingSourcePath` added so polling renders stay consistent during the async scan window in `selectSource()` (`docs/history.md`).
- **v0.8.8** — Source Cleanup root-capture race fixed (see `docs/failure-patterns.md` #16 and AI-FEAT-024) — root cause was `activeSource` being nulled by drive-polling disconnect detection during an in-flight import await.

## Known Bugs / Troubleshooting

See `docs/failure-patterns.md` #16 — the "Path Outside Source Root" bug is rooted in this feature's `activeSource` state management, even though its symptom surfaces in Source Cleanup (AI-FEAT-024).

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `renderer/renderer.js` (`selectSource`, `selectLocalFolder`, `renderExtDrives`, `activeSource`)
