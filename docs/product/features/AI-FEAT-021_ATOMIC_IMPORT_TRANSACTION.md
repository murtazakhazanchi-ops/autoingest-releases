# AI-FEAT-021 — Atomic Import Transaction

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-021 |
| Category | Import and Archive Writing |
| Status | Implemented |
| Maturity | Foundational |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-004, AI-FEAT-019 |
| Related roadmap milestone | None |
| Related technical docs | `docs/system-contracts.md` §13, `CLAUDE.md` § Transactional Ingest Layer, `docs/features.md` #8 |
| Evidence status | Verified from docs (already fully read as required context) |
| First-known implementation | v0.7.4-dev |
| Latest major update | v0.7.4-dev |

## Summary

`event.json` is written in a single atomic operation: `import → logs (including source and importedBy attribution) → lastImport → status`, committed together via `import:commitTransaction` using tmp→rename. No partial writes, no independent multi-step updates.

## Current Behavior

Renderer must not write to `event.json` directly — all ingestion mutations go through a single IPC transaction handler. `lastImport` must always reflect the latest entry in `imports[]`. Status is only set to "complete" after all steps succeed. On failure: do not update status to "complete," do not write partial logs or `lastImport`, revert to a safe state (usually `status: "created"`).

## Original Plan / Intent

Evidence pending beyond what `docs/history.md`'s v0.7.4-dev entry documents.

## Evolution / Implementation Journal

- **v0.7.4-dev** — `import:commitTransaction` introduced, replacing multi-step `event.json` writes; dead code removed (`markEventImportComplete`, standalone `appendImports`).

## Known Bugs / Troubleshooting

See `docs/debug-playbook.md` § 10 (Transaction Debugging Protocol) for the mandatory debug order when this contract is suspected to be violated.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `main/eventJsonStore.js`
- `main/main.js` (`import:commitTransaction` IPC handler)
