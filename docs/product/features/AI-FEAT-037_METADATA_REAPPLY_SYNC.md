# AI-FEAT-037 — Metadata Reapply / Sync

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-037 |
| Category | Metadata |
| Status | Implemented |
| Maturity | Evolving |
| Parent feature | AI-FEAT-029 |
| Subfeatures | None |
| Dependencies | AI-FEAT-029, AI-FEAT-036 |
| Related roadmap milestone | None |
| Related technical docs | `docs/metadata-system.md` § Import Path Coverage (the "Reapply" row) |
| Evidence status | Known from project history (learning-log narrative + file existence); NOT independently function-level audited by either research fork in this pass — evidence status intentionally lower than most other Metadata entries |
| First-known implementation | 2026-05-09 |
| Latest major update | 2026-05-11 |

## Summary

Detects when metadata needs to be reapplied to already-imported files (e.g. after an operator corrects event component location/city/country post-import) and syncs the corrected metadata across previously-imported files, with a preview modal showing affected folders and changed/removed fields. `docs/metadata-system.md`'s Import Path Coverage table lists "Reapply" as a synchronous write via the shared engine (AI-FEAT-029) — this feature is that Reapply capability plus its scan/sync/preview surface.

## Current Behavior

`main/metadataSyncService.js` exists as a dedicated file. Full current function-level behavior is evidence-pending — this entry is grounded in file existence, the learning-log narrative below, and the doc cross-reference, not an independent code audit. A future pass should verify current behavior directly against `main/metadataSyncService.js` before treating implementation details here as authoritative.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

- **2026-05-09** — "Metadata Sync MVP" (learning-log).
- **2026-05-09** — "Metadata Sync Phase 1B Stabilization" (learning-log).
- **2026-05-10** — "Metadata Sync Modal: Affected-Folder Chips, Changed/Removed Preview Section, +N More Truncation" (learning-log).
- **2026-05-10** — "previewEventMetadata Classification Fix (commit 1464c85)" (learning-log).
- **2026-05-10** — "Metadata Sync Stabilization and Scan Performance Optimization" (learning-log).
- **2026-05-11** — "Metadata Sync Hardening: Sync Resilience and Scan Reliability (commit b14d5fd)" (learning-log) — most recent dated entry found.

## Known Bugs / Troubleshooting

None recorded in `docs/product/bugs/` yet — see the learning-log entries above (particularly the 2026-05-10 classification fix and 2026-05-11 hardening pass) for narrative detail on bugs found and fixed during this feature's development.

## Decisions

None recorded.

## Future Enhancements

A full function-level audit of `main/metadataSyncService.js` against the current codebase is an open follow-up — this entry's evidence status is deliberately marked lower than its siblings until that happens.

## Related Files

- `main/metadataSyncService.js`
