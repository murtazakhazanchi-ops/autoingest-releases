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

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | None beyond Dependencies/Parent/Subfeatures already listed in the header table above |
| Related decisions | None recorded |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | [§3D — D. Archive Integrity and Transaction Safety](../11_ARCHITECTURAL_EVOLUTION.md#d-archive-integrity-and-transaction-safety) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | Referenced in 2 test file(s) (mechanical name/import match, not a coverage percentage — the test suite was not executed for this documentation pass): `test/eventJsonStore.test.js`, `test/metadataStateService.test.js` |
| Documentation completeness | Mostly complete — 1 unresolved evidence gap(s) in this file (see fields/sections marked "Evidence pending" above) |

## Summary

`event.json` is written in a single atomic operation: `import → logs (including source and importedBy attribution) → lastImport → status`, committed together via `import:commitTransaction` using tmp→rename. No partial writes, no independent multi-step updates.

## Current Behavior

Renderer must not write to `event.json` directly — all ingestion mutations go through a single IPC transaction handler. `lastImport` must always reflect the latest entry in `imports[]`. Status is only set to "complete" after all steps succeed. On failure: do not update status to "complete," do not write partial logs or `lastImport`, revert to a safe state (usually `status: "created"`).

## Original Plan / Intent

Evidence pending beyond what `docs/history.md`'s v0.7.4-dev entry documents.

## Evolution / Implementation Journal

- **v0.7.4-dev** — `import:commitTransaction` introduced, replacing multi-step `event.json` writes; dead code removed (`markEventImportComplete`, standalone `appendImports`).

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: v0.7.4-dev (see header table's "First-known implementation" field for citation).

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: Evolution / Implementation Journal above has exactly one entry (already reflected as Initial implementation, or see that section directly if it describes a later change).

## Known Bugs / Troubleshooting

See `docs/debug-playbook.md` § 10 (Transaction Debugging Protocol) for the mandatory debug order when this contract is suspected to be violated.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `main/eventJsonStore.js`
- `main/main.js` (`import:commitTransaction` IPC handler)
