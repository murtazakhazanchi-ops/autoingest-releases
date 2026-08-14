# AI-FEAT-054 — Integrity Verification — Archive-Wide

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-054 |
| Category | Reliability and Recovery |
| Status | Planned |
| Maturity | Planned |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-025 (Checksum-Based File Verification — prior art/foundation, narrower scope) |
| Related roadmap milestone | AI-RM-006 |
| Related technical docs | None — no implementation exists yet |
| Evidence status | Confirmed zero implementation of the archive-wide scope; existing narrower prior art independently verified |
| First-known implementation | Not started |
| Latest major update | Not applicable to implementation; 2026-08-14 documentation update — long-term preservation vision captured, both-sweep-types requirement confirmed |

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

Planned archive-wide (possibly scheduled) integrity verification — sixth in the canonical roadmap order. **Explicitly distinct in scope from AI-FEAT-025**, which is already implemented but scoped only to a single import batch or a single Local-First sync job, not the whole archive.

**Vision** (product-owner intent, captured 2026-08-14 — *Known from project history; repository evidence pending*; future-tense throughout, describing a planned capability, not current behavior): long-term digital preservation assurance — detecting silent corruption, missing/damaged files, and storage degradation over time, beyond what ingestion-time verification (AI-FEAT-025/AI-FEAT-026) can prove. Ingestion-time verification proves integrity at that one moment; it does not prove files remain healthy months or years later. The product owner explicitly wants **both** scheduled full archive sweeps **and** incremental/background verification — not one or the other. Scheduling cadence and resource-management details are **not yet designed**; no specific schedule should be assumed or invented.

**Preserved from prior documentation**: the existing warning below not to read AI-FEAT-025 as partial progress toward this milestone remains accurate and applies equally to this vision note.

## Current Behavior

Not implemented at archive-wide scope. AI-FEAT-025's `checksum:run` (import-batch) and `archive:verifyJobChecksum` (sync-job) are real, shipped, narrower-scoped prior art for this planned milestone — not a partial implementation of it. Do not treat AI-RM-006 as "in progress" on the basis of AI-FEAT-025 existing.

## Original Plan / Intent

Named as "Integrity Verification" in the canonical roadmap order (see [../02_MASTER_ROADMAP.md](../02_MASTER_ROADMAP.md)). Specific scope (full-archive scan? scheduled? on-demand only?) is evidence-pending — not yet documented as fact.

## Evolution / Implementation Journal

Not started (for archive-wide scope). See AI-FEAT-025 for the existing narrower capability's history.

- **2026-08-14 — Long-term preservation vision captured; both-sweep-types requirement confirmed.** A Product-Owner Purpose Capture interview supplied the long-term digital preservation vision now recorded in Summary above, and confirmed both scheduled full sweeps and incremental/background verification are wanted, with scheduling details still undesigned. Status remains Planned; no code exists.

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

Scope, design, and acceptance criteria are pending discovery/specification. Whether this milestone builds directly on AI-FEAT-025's `getFileHash()` primitive or introduces a new mechanism is an open design question for whoever scopes this milestone. Scheduling cadence and resource-management approach for the required scheduled-sweep + incremental-verification combination (see Summary's Vision note) is likewise undesigned.

## Related Files

None — no implementation of the planned archive-wide capability exists.
