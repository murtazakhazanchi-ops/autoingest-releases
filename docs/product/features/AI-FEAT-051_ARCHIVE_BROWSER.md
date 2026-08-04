# AI-FEAT-051 — Archive Browser

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-051 |
| Category | Planned Archive Management |
| Status | Planned |
| Maturity | Planned |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-013 (expected to extend browsing beyond the current source-scoped File Browser to full-archive scope) |
| Related roadmap milestone | AI-RM-004 |
| Related technical docs | None — no implementation exists yet |
| Evidence status | Confirmed zero implementation: exhaustive grep across `main/`, `services/`, `renderer/` found no matches; `git log --all --oneline` search found no relevant commits |
| First-known implementation | Not started |
| Latest major update | Not applicable |

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
| Testing coverage | Not applicable — feature not yet implemented (see header table's Status/Evidence status fields) |
| Documentation completeness | Complete — no unresolved "Evidence pending" markers in this file |

## Summary

Planned full-archive browsing capability — fourth in the canonical roadmap order, positioned after Archive/Event Maintenance and before Global Search. No architecture, scope, or design has been finalized.

## Current Behavior

Not implemented. No code exists. AI-FEAT-013 (File Browser & Media Grid/List Viewing) currently only browses a selected *source* (memory card/drive/folder) for import, not the archive itself — this planned feature would be a materially different scope (archive-wide, post-import browsing), not an extension of the same code path by default.

## Original Plan / Intent

Named as "Archive Browser" in the canonical roadmap order (see [../02_MASTER_ROADMAP.md](../02_MASTER_ROADMAP.md)). Specific scope is evidence-pending — not yet documented as fact.

## Evolution / Implementation Journal

Not started.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Not applicable — feature not yet implemented.

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: Evidence pending — Evolution / Implementation Journal above has no dated entries.

## Known Bugs / Troubleshooting

Not applicable.

## Decisions

None recorded.

## Future Enhancements

Scope, design, and acceptance criteria are pending discovery/specification.

## Related Files

None — no implementation exists.
