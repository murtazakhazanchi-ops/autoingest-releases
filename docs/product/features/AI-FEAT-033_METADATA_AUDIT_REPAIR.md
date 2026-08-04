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
