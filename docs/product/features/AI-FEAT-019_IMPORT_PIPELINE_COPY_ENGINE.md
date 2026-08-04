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

## Summary

Processes grouped files and copies them into the archive structure. No file is ever overwritten; same file skips, conflicts rename. The engine itself (`main/fileManager.js`) is not shared with every other copy operation in the app — Transfer Export/Import, Local-First Sync, and Local Mirror each implement their own copy function following the same no-overwrite contract, not one universal engine.

## Current Behavior

Core functions in `main/fileManager.js`: `copyFiles()` (line 207) and `copyFileJobs()` (line 459), `resolveDestPath()` (line 157 — conflict/rename logic, also implements Duplicate Detection, AI-FEAT-020), `buildDestIndex()` (line 91 — resume fast-path), `verifyFile()` (line 135), `getFileHash()` (line 113), and adaptive concurrency tiers (150MB/s and 80MB/s throughput thresholds). `onProgress` callback reports `{total, index, completedCount, filename, status, eta, speedBps}` with exponential-moving-average speed smoothing (100ms throttle) — this is Import Progress and Completion (checklist item 24), folded into this feature rather than given a separate entry. Errors are caught per file; the loop continues; the final result reports copied/skipped/errored counts.

**Sibling copy engines** (do not assume these share code with this one): `services/archiveSyncService.js:_copyFile` (Local-First Sync, AI-FEAT-044), `services/localMirrorService.js:_copyFileIfNotConflict`, `services/transferExportService.js:_copyFileSafe` (AI-FEAT-038), `services/transferImportService.js:_copyFileSafe` (AI-FEAT-039).

## Original Plan / Intent

Evidence pending beyond `docs/history.md`'s v0.5.1 "Import pipeline hardening" entry, which implies an even earlier baseline this audit did not trace further back.

## Evolution / Implementation Journal

- **v0.5.1** — "Stabilization": import pipeline hardening, performance fixes, reduced import failures.
- **v0.7.x** — pipeline structure re-established as part of the core architecture rebuild alongside `event.json`.

## Known Bugs / Troubleshooting

See `docs/failure-patterns.md` #3 (Duplicate Files or Unexpected Renaming) and #8 (Import Flow Breaks or Stops).

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `main/fileManager.js`
