# AI-FEAT-049 — Archive Maintenance

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-049 |
| Category | Planned Archive Management |
| Status | Planned |
| Maturity | Planned |
| Parent feature | None |
| Subfeatures | AI-FEAT-050 (Event Maintenance — an event-level structural-maintenance scope within this broader capability, not an independently-motivated feature; see Summary) |
| Dependencies | AI-FEAT-042, AI-FEAT-043 (expected to build on existing root config and health reporting) |
| Related roadmap milestone | AI-RM-002 (next milestone after AI-RM-001) |
| Related technical docs | None — no implementation exists yet |
| Evidence status | Confirmed zero implementation: exhaustive grep for "maintenance"/camelCase variants across `main/`, `services/`, `renderer/` found no matches; `git log --all --oneline` search found no relevant commits |
| First-known implementation | Not started |
| Latest major update | Not applicable to implementation; 2026-08-14 documentation update — vision captured, parent/child relationship with AI-FEAT-050 made explicit |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | None beyond Dependencies/Parent/Subfeatures already listed in the header table above |
| Related decisions | [DEC-015](../decisions/DEC-015_PLANNED_ARCHITECTURE_SEPARATE_FROM_IMPLEMENTED.md) *(found via reverse lookup — not yet cross-linked in the Decisions section above)* |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | [§3I — I. Planned Architectural Direction](../11_ARCHITECTURAL_EVOLUTION.md#i-planned-architectural-direction) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | Not applicable — feature not yet implemented (see header table's Status/Evidence status fields) |
| Documentation completeness | Complete — no unresolved "Evidence pending" markers in this file |

## Summary

Planned archive-maintenance capability — the next roadmap milestone after the completed AI-RM-001 (Metadata Audit & Repair). No architecture, scope, or design has been finalized. This document intentionally does not invent implementation detail for unbuilt work.

**Vision** (product-owner intent, captured 2026-08-14 — *Known from project history; repository evidence pending*; future-tense throughout, describing a planned capability, not current behavior): would bring controlled structural modification of already-existing archive events/collections under managed AutoIngest workflows — e.g. changing an event's date or sequence number, adding a component after creation, moving photographer folders between components, re-sorting/reorganizing existing archival structures. Today, AutoIngest can inspect/report/protect/verify many archive conditions (Health Reporting, Lock Handling, Backup Update Scanning, Audit/Integrity), but structural modification of already-established archive material currently requires manual, unmanaged filesystem work outside AutoIngest's safety model — this planned feature would extend the controlled-workflow model AutoIngest already applies to creation and import into ongoing maintenance as well.

**Relationship to AI-FEAT-050**: per explicit product-owner clarification, Event Maintenance is an event-level scope within this broader Archive Maintenance capability, not a second, independently-motivated concept — see AI-FEAT-050's own Summary for the parallel note. Both canonical IDs are retained (each is separately tied to its own roadmap milestone, AI-RM-002 and AI-RM-003 respectively) with the relationship now made explicit via the Parent feature/Subfeatures header fields above, rather than inventing two unrelated purposes for what is one vision at two scopes.

## Current Behavior

Not implemented. No code exists.

## Original Plan / Intent

Named as "Archive Maintenance" in the canonical roadmap order (see [../02_MASTER_ROADMAP.md](../02_MASTER_ROADMAP.md)). Specific scope, acceptance criteria, and design are evidence-pending — not yet documented as fact.

## Evolution / Implementation Journal

Not started.

- **2026-08-14 — Vision captured; parent/child relationship with AI-FEAT-050 made explicit.** A Product-Owner Purpose Capture interview supplied the maintenance vision now recorded in Summary above, and clarified that Event Maintenance (AI-FEAT-050) is a sub-scope of this capability rather than a separate concept. Header table's Subfeatures field updated accordingly. Status remains Planned; no code exists.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Not applicable — feature not yet implemented.

**Architectural / workflow decisions**: [DEC-015](../decisions/DEC-015_PLANNED_ARCHITECTURE_SEPARATE_FROM_IMPLEMENTED.md) — see the Decisions section above and each record's own "Decision"/"Consequences" fields for what changed and why.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: Evidence pending — Evolution / Implementation Journal above has no dated entries.

## Known Bugs / Troubleshooting

Not applicable.

## Decisions

None recorded.

## Future Enhancements

Scope, design, and acceptance criteria for this milestone are pending discovery/specification — see [../04_PROJECT_DASHBOARD.md](../04_PROJECT_DASHBOARD.md)'s "Next planned action."

## Related Files

None — no implementation exists.
