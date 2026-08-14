# AI-FEAT-019 — Import Pipeline & Copy Engine

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-019 |
| Category | Import and Archive Writing |
| Status | Implemented |
| Maturity | Foundational |
| Parent feature | None |
| Subfeatures | AI-FEAT-020 (Duplicate Detection — split out for documentation-lineage reasons, mechanically part of this feature's `resolveDestPath()`) |
| Dependencies | AI-FEAT-004, AI-FEAT-018 |
| Related roadmap milestone | None |
| Related technical docs | `docs/ingestion-flow.md`, `docs/system-contracts.md` §4-5, `docs/features.md` #5 |
| Evidence status | Verified from current code |
| First-known implementation | v0.5.1 ("Stabilization" — "Import pipeline hardening") implies an earlier baseline; v0.7.x is the architectural rebuild |
| Latest major update | Evidence pending |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | [AI-FEAT-038](AI-FEAT-038_TRANSFER_EXPORT.md), [AI-FEAT-039](AI-FEAT-039_TRANSFER_IMPORT.md), [AI-FEAT-044](AI-FEAT-044_LOCAL_FIRST_BACKGROUND_ARCHIVE_SYNC.md) (found via cross-reference in this file's own prose, not yet in Dependencies/Parent/Subfeatures above) |
| Related decisions | [DEC-005](../decisions/DEC-005_ORIGINAL_PRESERVATION_NON_DESTRUCTIVE_INGEST.md) *(found via reverse lookup — not yet cross-linked in the Decisions section above)*; [DEC-009](../decisions/DEC-009_COPY_IDEMPOTENCY_MUST_NOT_SUPPRESS_METADATA_REPAIR.md) *(found via reverse lookup — not yet cross-linked in the Decisions section above)* |
| Related bugs | [BUG-009](../bugs/BUG-009_SAME_SIZE_SKIP_METADATA_UNVERIFIED.md) *(found via reverse lookup — not yet cross-linked in the Known Bugs section above)* |
| Related postmortems | None |
| Related architectural evolution sections | [§3B — B. Initial AutoIngest Foundation](../11_ARCHITECTURAL_EVOLUTION.md#b-initial-autoingest-foundation); [§3D — D. Archive Integrity and Transaction Safety](../11_ARCHITECTURAL_EVOLUTION.md#d-archive-integrity-and-transaction-safety) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | No dedicated test file identified via automated search of `test/` (17 test files exist repository-wide, concentrated in the metadata subsystem — see AI-FEAT-029 through AI-FEAT-033) |
| Documentation completeness | Mostly complete — 2 unresolved evidence gap(s) in this file (see fields/sections marked "Evidence pending" above) |

## Summary

Processes grouped files and copies them into the archive structure. No file is ever overwritten; same file skips, conflicts rename. The engine itself (`main/fileManager.js`) is not shared with every other copy operation in the app — Transfer Export/Import, Local-First Sync, and Local Mirror each implement their own copy function following the same no-overwrite contract, not one universal engine.

## Current Behavior

Core functions in `main/fileManager.js`: `copyFiles()` (line 207) and `copyFileJobs()` (line 459), `resolveDestPath()` (line 157 — conflict/rename logic, also implements Duplicate Detection, AI-FEAT-020), `buildDestIndex()` (line 91 — resume fast-path), `verifyFile()` (line 135), `getFileHash()` (line 113), and adaptive concurrency tiers (150MB/s and 80MB/s throughput thresholds). `onProgress` callback reports `{total, index, completedCount, filename, status, eta, speedBps}` with exponential-moving-average speed smoothing (100ms throttle) — this is Import Progress and Completion (checklist item 24), folded into this feature rather than given a separate entry. Errors are caught per file; the loop continues; the final result reports copied/skipped/errored counts.

**Automatic per-file validation — distinct from AI-FEAT-026** (confirmed 2026-08-14, forensic code verification): every file copy performed by `copyFiles()` runs through `verifyFile()`, which performs an automatic **per-file size check**, always on, requiring no operator action (`result.integrity = 'verified'` is set as part of the normal copy path). This is a genuinely automatic validation layer — but it is **not** the same thing as AI-FEAT-026's "Verify Integrity" audit, which is a separate, manually-triggered, count-based completeness check the operator runs on demand from the Activity Log. A product-owner recollection of "automatic post-import integrity flagging" during the Purpose Capture interview (2026-08-14) was traced to this per-file check (plus this pipeline's automatic error-telemetry firing on copy failures — see AI-FEAT-007), not to AI-FEAT-026. See AI-FEAT-026's Current Behavior for the full three-layer integrity model (this automatic per-file check → the manual count audit → AI-FEAT-025's manual SHA-256 verification).

**Sibling copy engines** (do not assume these share code with this one): `services/archiveSyncService.js:_copyFile` (Local-First Sync, AI-FEAT-044), `services/localMirrorService.js:_copyFileIfNotConflict`, `services/transferExportService.js:_copyFileSafe` (AI-FEAT-038), `services/transferImportService.js:_copyFileSafe` (AI-FEAT-039).

## Original Plan / Intent

Evidence pending beyond `docs/history.md`'s v0.5.1 "Import pipeline hardening" entry, which implies an even earlier baseline this audit did not trace further back.

## Evolution / Implementation Journal

- **v0.5.1** — "Stabilization": import pipeline hardening, performance fixes, reduced import failures.
- **v0.7.x** — pipeline structure re-established as part of the core architecture rebuild alongside `event.json`.
- **2026-08-14 — Cross-referenced against AI-FEAT-026 to resolve a product-owner recollection conflict.** During the Product-Owner Purpose Capture interview, the product owner recalled automatic post-import integrity flagging; forensic verification traced this to this feature's own `verifyFile()` per-file check rather than to AI-FEAT-026 (which remains manual-only, confirmed and retained as such — see that file). Added the clarifying cross-reference above; no code changed.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: v0.5.1 ("Stabilization" — "Import pipeline hardening") implies an earlier baseline; v0.7.x is the architectural rebuild (see header table's "First-known implementation" field for citation).

**Architectural / workflow decisions**: [DEC-005](../decisions/DEC-005_ORIGINAL_PRESERVATION_NON_DESTRUCTIVE_INGEST.md); [DEC-009](../decisions/DEC-009_COPY_IDEMPOTENCY_MUST_NOT_SUPPRESS_METADATA_REPAIR.md) — see the Decisions section above and each record's own "Decision"/"Consequences" fields for what changed and why.

**Reliability / correctness fixes**: [BUG-009](../bugs/BUG-009_SAME_SIZE_SKIP_METADATA_UNVERIFIED.md) — see the Known Bugs section above and each record's own "Root Cause"/"Fix" fields for what changed and why.

**Other dated milestones**: 2 entries exist in the Evolution / Implementation Journal above; not individually re-classified by milestone type here to avoid restating evidence — read that section directly for the full dated sequence.

## Known Bugs / Troubleshooting

See `docs/failure-patterns.md` #3 (Duplicate Files or Unexpected Renaming) and #8 (Import Flow Breaks or Stops).

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `main/fileManager.js`
