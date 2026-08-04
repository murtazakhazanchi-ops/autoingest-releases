# AI-FEAT-041 — Transfer Background/Minimize Operation

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-041 |
| Category | Transfer and Backup |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-038, AI-FEAT-039 |
| Related roadmap milestone | None |
| Related technical docs | None dedicated |
| Evidence status | Verified from git commit history (commit `848c867`, full message read) |
| First-known implementation | Commit `848c867`, merged to `main` |
| Latest major update | Same commit |

## Summary

Lets an operator run Transfer Export or Transfer Import in the background instead of being blocked by a modal, with a persistent status indicator. **Explicitly does not exist for standard Event Import** — confirmed by negative grep (only a generic OS-level window-minimize button exists for the main window) and by commit `848c867`'s own message, which scopes this capability to Transfer Export/Import only.

## Current Behavior

Persistent status pill (`#transferPill`) polls `getTransferExportStatus`/`getTransferImportStatus`, showing running%/paused/complete/partial/failed plus copied/error counts; click-to-reopen. "Run in Background" (Minimize) button in both Transfer Export and Transfer Import modals; close/Escape while active minimizes instead of being disabled. The underlying job (owned by `transferExportService`/`transferImportService` in the main process) is untouched by minimizing — only the modal's visibility changes. A cross-direction guard blocks starting Export while Import is running and vice versa.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

- Commit `848c867` — "feat(transfer): allow export and import to run in background" — introduced this feature. The commit's own message explicitly states no copy-engine changes and no new IPC, confirming AI-FEAT-040's backup-update behavior (commit `aa8e093`) is preserved unmodified by this change.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

**Event Import parity gap** (explicit, not accidental): standard Event Import has no equivalent background-run capability — only the OS-level minimize button exists. This was confirmed as a genuine gap, not an oversight in this audit, and no roadmap milestone currently targets closing it.

## Future Enhancements

Extending background/minimize operation to standard Event Import is a plausible future enhancement but is not currently scoped in any roadmap milestone.

## Related Files

- `services/transferExportService.js`, `services/transferImportService.js` (job-owning services, unmodified by this feature per commit `848c867`'s own message)
- `renderer/index.html` (`#transferPill`)
