# AI-FEAT-020 — Duplicate Detection

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-020 |
| Category | Import and Archive Writing |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | AI-FEAT-019 (Import Pipeline & Copy Engine) |
| Subfeatures | None |
| Dependencies | AI-FEAT-019 |
| Related roadmap milestone | None |
| Related technical docs | `docs/ingestion-flow.md` § Duplicate Handling, `docs/features.md` #6 |
| Evidence status | Verified from current code |
| First-known implementation | Evidence pending |
| Latest major update | Evidence pending |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | None beyond Dependencies/Parent/Subfeatures already listed in the header table above |
| Related decisions | [DEC-005](../decisions/DEC-005_ORIGINAL_PRESERVATION_NON_DESTRUCTIVE_INGEST.md) *(found via reverse lookup — not yet cross-linked in the Decisions section above)* |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | [§3B — B. Initial AutoIngest Foundation](../11_ARCHITECTURAL_EVOLUTION.md#b-initial-autoingest-foundation); [§3D — D. Archive Integrity and Transaction Safety](../11_ARCHITECTURAL_EVOLUTION.md#d-archive-integrity-and-transaction-safety) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | No dedicated test file identified via automated search of `test/` (17 test files exist repository-wide, concentrated in the metadata subsystem — see AI-FEAT-029 through AI-FEAT-033) |
| Documentation completeness | Partial — 3 unresolved evidence gaps in this file (see fields/sections marked "Evidence pending" above) |

## Summary

**Classification note**: this is documented as a separate feature file for lineage/continuity reasons — `docs/features.md` (an existing authoritative technical doc) lists it as its own top-level implemented feature (#6). Mechanically, it is entirely implemented inside AI-FEAT-019's `resolveDestPath()` — there is no independent service, state, or code path. Treat this as a **subfeature split out for documentation continuity**, not as an architecturally independent system. A reader should not assume this evolves separately from the Copy Engine.

## Current Behavior

Same name + size → skip. Different size → rename (`_1`, `_2` numbered-slot search). No overwrite under any condition. Prevents overwriting by identifying existing files at the destination before copy.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

No entries yet — this feature's evolution is the same as AI-FEAT-019's; see that file for the Copy Engine's history.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending — no independently-verified first-implementation date exists in this file's header table.

**Architectural / workflow decisions**: [DEC-005](../decisions/DEC-005_ORIGINAL_PRESERVATION_NON_DESTRUCTIVE_INGEST.md) — see the Decisions section above and each record's own "Decision"/"Consequences" fields for what changed and why.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: Evidence pending — Evolution / Implementation Journal above has no dated entries.

## Known Bugs / Troubleshooting

See `docs/failure-patterns.md` #3 (Duplicate Files or Unexpected Renaming).

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `main/fileManager.js` (`resolveDestPath`)
