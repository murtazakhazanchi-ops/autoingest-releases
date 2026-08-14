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
| Latest major update | Not applicable to implementation; 2026-08-14 documentation update — vision captured, relationship to AI-FEAT-053/056 documented |

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

**Vision** (product-owner intent, captured 2026-08-14 — *Known from project history; repository evidence pending*; future-tense throughout): long-term, AutoIngest would become a broader archival working suite, not just an ingestion tool — this feature would support browsing already-archived material, visual review, archival ratings/stars/selections, metadata management, secondary descriptive keywording, and handoff to external editing tools (Camera Raw/Photoshop/Lightroom), eventually extending to remote/online browsing for authorized users beyond the local archive workstation. Today, AutoIngest applies primary keywords during ingestion, but secondary descriptive keywording is still performed externally (especially in Adobe Bridge) — a fragmented post-ingestion workflow this feature would aim to reduce. The remote/online-discovery aspect of this vision raises authentication/access-control questions not yet addressed anywhere in this documentation.

**Relationship to AI-FEAT-053 and AI-FEAT-056**: distinct capabilities forming one long-term archival discovery/intelligence direction — Archive Browser is the navigation/visual-exploration route, Global Search (AI-FEAT-053) is the direct natural-language retrieval route, and AI Archive Intelligence (AI-FEAT-056) is the local AI/VLM layer intended to support both. Kept as three separate records rather than merged, since their eventual architectural shape differs materially (UI/browsing vs. natural-language query handling vs. a local AI model) — the same pattern already used for AI-FEAT-027/AI-FEAT-048, which share infrastructure while remaining distinct records.

## Current Behavior

Not implemented. No code exists. AI-FEAT-013 (File Browser & Media Grid/List Viewing) currently only browses a selected *source* (memory card/drive/folder) for import, not the archive itself — this planned feature would be a materially different scope (archive-wide, post-import browsing), not an extension of the same code path by default.

## Original Plan / Intent

Named as "Archive Browser" in the canonical roadmap order (see [../02_MASTER_ROADMAP.md](../02_MASTER_ROADMAP.md)). Specific scope is evidence-pending — not yet documented as fact.

## Evolution / Implementation Journal

Not started.

- **2026-08-14 — Vision captured; relationship to AI-FEAT-053/056 documented.** A Product-Owner Purpose Capture interview supplied the archival-working-suite vision now recorded in Summary above, and clarified this feature's relationship to Global Search and AI Archive Intelligence as three distinct-but-related capabilities, not a merge candidate. Status remains Planned; no code exists.

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
