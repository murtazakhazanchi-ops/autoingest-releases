# AI-FEAT-033 — Metadata Audit & Repair

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-033 |
| Category | Metadata |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | AI-FEAT-029 |
| Subfeatures | None |
| Dependencies | AI-FEAT-029, AI-FEAT-030, AI-FEAT-031 |
| Related roadmap milestone | AI-RM-001 (completed — this is that milestone's core deliverable) |
| Related technical docs | `docs/metadata-system.md` § Metadata Audit, § Repair, `docs/features.md` #15 |
| Evidence status | Verified from docs (already fully read as required context) and recent commit history |
| First-known implementation | Evidence pending overall architecture; recent UI polish 2026-08-03/04 |
| Latest major update | 2026-08-04 (commit `c5d200f`, "polish Audit & Repair spacing across window heights") |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | [AI-FEAT-034](AI-FEAT-034_METADATA_MANAGEMENT_MODAL.md), [AI-FEAT-035](AI-FEAT-035_DASHBOARD_METADATA_HEALTH.md), [AI-FEAT-052](AI-FEAT-052_ARCHIVE_REPAIR.md), [AI-FEAT-054](AI-FEAT-054_INTEGRITY_VERIFICATION_ARCHIVE_WIDE.md) (found via cross-reference in this file's own prose, not yet in Dependencies/Parent/Subfeatures above) |
| Related decisions | None recorded |
| Related bugs | [BUG-007](../bugs/BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md) |
| Related postmortems | [PM-001](../postmortems/PM-001_METADATA_CORRECTNESS_GAP_PRODUCTION_READINESS_REVIEW.md) |
| Related architectural evolution sections | [§3C — C. Metadata Automation](../11_ARCHITECTURAL_EVOLUTION.md#c-metadata-automation) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | Referenced in 4 test file(s) (mechanical name/import match, not a coverage percentage — the test suite was not executed for this documentation pass): `test/fieldSpecsConsistency.test.js`, `test/metadataAuditExport.test.js`, `test/metadataAuditService.test.js`, `test/metadataRepairService.test.js` |
| Documentation completeness | Mostly complete — 1 unresolved evidence gap(s) in this file (see fields/sections marked "Evidence pending" above) |

## Summary

Read-only, streaming, resumable, cancellable archive-wide metadata audit (`services/metadataAuditService.js`), paired with frozen-snapshot metadata repair (`main/metadataRepairService.js`) that consumes only an audit's captured snapshot and never re-resolves against live state. **This is the deliverable behind roadmap milestone AI-RM-001, which is complete** — see [../02_MASTER_ROADMAP.md](../02_MASTER_ROADMAP.md).

## Current Behavior

**Audit**: never writes a file, never calls an ExifTool write operation. Results stream to JSONL incrementally; a small state file commits only at event boundaries, so a resume at worst re-scans the one event in flight. Duplicate/case/whitespace-aware keyword classification. Exports to JSON/JSONL/CSV, each streamed temp-then-rename with reproducibility metadata (contract/resolver versions, archive-root identity, scan timestamp).

**Repair**: consumes a frozen snapshot only. Before any write, a real staleness guard compares the current file's size/mtime against what the snapshot recorded — a drifted file is skipped with a "re-audit required" note. Preview is exhaustive (current value, expected value, exact fields to change) and requires explicit operator confirmation. **One-shot per audit snapshot**: a successful write always bumps the file/sidecar's mtime (ExifTool's own behavior), so running Repair a second time against the same snapshot correctly shows just-repaired files as stale and skips them — this is the staleness check working, not a bug. Every repair result records the source `auditJobId`, a `snapshotIdentity`, timing, and outcome counts.

## Original Plan / Intent

This is explicitly the AI-RM-001 roadmap milestone. Evidence for its original scoping predates the docs read in this audit.

## Evolution / Implementation Journal

- **2026-08-02** — "Dashboard Metadata Health Card" work adjacent to this feature (see AI-FEAT-035).
- **2026-08-02** — "Metadata Management Modal" consolidation brought this feature's UI into a shared tabbed shell (see AI-FEAT-034).
- **2026-08-03** — "Run Audit Full-Width Fix + Obsolete Metadata Audit Entry Point Removal" (learning-log; commit `6349c62`).
- **2026-08-04** — "polish Audit & Repair spacing across window heights" (commit `c5d200f`) — most recent change, CSS/markup polish only, no behavior change per its own commit message.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending overall architecture; recent UI polish 2026-08-03/04 (see header table's "First-known implementation" field for citation).

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: [BUG-007](../bugs/BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md) — see the Known Bugs section above and each record's own "Root Cause"/"Fix" fields for what changed and why.

**Other dated milestones**: 4 entries exist in the Evolution / Implementation Journal above; not individually re-classified by milestone type here to avoid restating evidence — read that section directly for the full dated sequence.

## Known Bugs / Troubleshooting

**Known limitation** (documented directly in `docs/metadata-system.md`): the current UI does not preserve a preview-session identifier that survives the round trip from Preview to Confirm, so `previewedInThisSession` cannot prove which specific UI click-through produced a given repair run — only that a preview was generated for this job at some point in the session. Closing this fully would require a UI-level preview-session token, not implemented.

This feature is the corrective deliverable for [PM-001 — Metadata Correctness Gap Found in Production-Readiness Review](../postmortems/PM-001_METADATA_CORRECTNESS_GAP_PRODUCTION_READINESS_REVIEW.md) and its underlying [BUG-007](../bugs/BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md).

## Decisions

None recorded.

## Future Enhancements

None recorded — this milestone is complete; forward-looking archive-wide integrity/repair work is tracked separately under AI-RM-006 (AI-FEAT-054) and AI-RM-007 (AI-FEAT-052), which are distinct, broader-scope, unstarted milestones.

## Related Files

- `services/metadataAuditService.js`
- `main/metadataRepairService.js`
- `services/metadataAuditExport.js`
