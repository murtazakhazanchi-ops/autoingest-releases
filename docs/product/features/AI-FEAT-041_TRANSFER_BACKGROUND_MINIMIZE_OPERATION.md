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

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | [AI-FEAT-040](AI-FEAT-040_BACKUP_UPDATE_SCANNING.md) (found via cross-reference in this file's own prose, not yet in Dependencies/Parent/Subfeatures above) |
| Related decisions | None recorded |
| Related bugs | [BUG-005](../bugs/BUG-005_TRANSFER_EXPORT_RESUME_STATE_DIVERGENCE.md) *(found via reverse lookup — not yet cross-linked in the Known Bugs section above)* |
| Related postmortems | None |
| Related architectural evolution sections | [§3E — E. Transfer and Distributed Working](../11_ARCHITECTURAL_EVOLUTION.md#e-transfer-and-distributed-working) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | Referenced in 1 test file(s) (mechanical name/import match, not a coverage percentage — the test suite was not executed for this documentation pass): `test/transferImportOutcomeManifest.test.js` |
| Documentation completeness | Mostly complete — 1 unresolved evidence gap(s) in this file (see fields/sections marked "Evidence pending" above) |

## Summary

Lets an operator run Transfer Export or Transfer Import in the background instead of being blocked by a modal, with a persistent status indicator. **Explicitly does not exist for standard Event Import** — confirmed by negative grep (only a generic OS-level window-minimize button exists for the main window) and by commit `848c867`'s own message, which scopes this capability to Transfer Export/Import only.

## Current Behavior

Persistent status pill (`#transferPill`) polls `getTransferExportStatus`/`getTransferImportStatus`, showing running%/paused/complete/partial/failed plus copied/error counts; click-to-reopen. "Run in Background" (Minimize) button in both Transfer Export and Transfer Import modals; close/Escape while active minimizes instead of being disabled. The underlying job (owned by `transferExportService`/`transferImportService` in the main process) is untouched by minimizing — only the modal's visibility changes. A cross-direction guard blocks starting Export while Import is running and vice versa.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

- Commit `848c867` — "feat(transfer): allow export and import to run in background" — introduced this feature. The commit's own message explicitly states no copy-engine changes and no new IPC, confirming AI-FEAT-040's backup-update behavior (commit `aa8e093`) is preserved unmodified by this change.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Commit `848c867`, merged to `main` (see header table's "First-known implementation" field for citation).

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: [BUG-005](../bugs/BUG-005_TRANSFER_EXPORT_RESUME_STATE_DIVERGENCE.md) — see the Known Bugs section above and each record's own "Root Cause"/"Fix" fields for what changed and why.

**Other dated milestones**: Evolution / Implementation Journal above has exactly one entry (already reflected as Initial implementation, or see that section directly if it describes a later change).

## Known Bugs / Troubleshooting

None recorded.

## Decisions

**Event Import parity gap** (explicit, not accidental): standard Event Import has no equivalent background-run capability — only the OS-level minimize button exists. This was confirmed as a genuine gap, not an oversight in this audit, and no roadmap milestone currently targets closing it.

## Future Enhancements

Extending background/minimize operation to standard Event Import is a plausible future enhancement but is not currently scoped in any roadmap milestone.

## Related Files

- `services/transferExportService.js`, `services/transferImportService.js` (job-owning services, unmodified by this feature per commit `848c867`'s own message)
- `renderer/index.html` (`#transferPill`)
