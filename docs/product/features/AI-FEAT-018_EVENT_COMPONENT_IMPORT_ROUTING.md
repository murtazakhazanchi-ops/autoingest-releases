# AI-FEAT-018 — Event-Component Import Routing

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-018 |
| Category | Grouping and Routing |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-004, AI-FEAT-009, AI-FEAT-017 |
| Related roadmap milestone | None |
| Related technical docs | `docs/event-system.md` § Routing Relationship, `docs/ingestion-flow.md` § Routing |
| Evidence status | Verified from docs (already fully read as required context) |
| First-known implementation | v0.7.x |
| Latest major update | Evidence pending |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | None beyond Dependencies/Parent/Subfeatures already listed in the header table above |
| Related decisions | [DEC-002](../decisions/DEC-002_FOLDER_STRUCTURE_PLUS_EMBEDDED_METADATA.md) *(found via reverse lookup — not yet cross-linked in the Decisions section above)* |
| Related bugs | [BUG-002](../bugs/BUG-002_PHOTOGRAPHER_SEQUENCE_FOLDER_RESOLUTION.md) *(found via reverse lookup — not yet cross-linked in the Known Bugs section above)* |
| Related postmortems | None |
| Related architectural evolution sections | [§3B — B. Initial AutoIngest Foundation](../11_ARCHITECTURAL_EVOLUTION.md#b-initial-autoingest-foundation) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | No dedicated test file identified via automated search of `test/` (17 test files exist repository-wide, concentrated in the metadata subsystem — see AI-FEAT-029 through AI-FEAT-033) |
| Documentation completeness | Mostly complete — 1 unresolved evidence gap(s) in this file (see fields/sections marked "Evidence pending" above) |

## Summary

Derives archive folder paths purely from `event.json` — no dynamic path computation happens during import. Single-component events route to `Collection/Event/Photographer/`; multi-component events route to `Collection/Event/SubEvent/Photographer/`. Video files always land inside a `VIDEO` subfolder.

## Current Behavior

`ImportRouter` must use `event.json` for path generation; no dynamic path logic exists outside it. Folder names are persisted at event-creation/editing time (AI-FEAT-009/010), never recomputed during import. Paths must be deterministic given the same `event.json`.

## Original Plan / Intent

Introduced as part of the v0.7.x "Core System Architecture" milestone (`docs/history.md`), alongside the Dashboard rebuild, Event system, and Grouping system.

## Evolution / Implementation Journal

- **v0.7.x** — import routing introduced.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: v0.7.x (see header table's "First-known implementation" field for citation).

**Architectural / workflow decisions**: [DEC-002](../decisions/DEC-002_FOLDER_STRUCTURE_PLUS_EMBEDDED_METADATA.md) — see the Decisions section above and each record's own "Decision"/"Consequences" fields for what changed and why.

**Reliability / correctness fixes**: [BUG-002](../bugs/BUG-002_PHOTOGRAPHER_SEQUENCE_FOLDER_RESOLUTION.md) — see the Known Bugs section above and each record's own "Root Cause"/"Fix" fields for what changed and why.

**Other dated milestones**: Evolution / Implementation Journal above has exactly one entry (already reflected as Initial implementation, or see that section directly if it describes a later change).

## Known Bugs / Troubleshooting

See `docs/failure-patterns.md` #2 (Files Imported to Wrong Folder) for the documented symptom→cause map.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `renderer/importRouter.js`
