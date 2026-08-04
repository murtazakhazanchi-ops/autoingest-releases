# AI-FEAT-040 — Backup Update Scanning

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-040 |
| Category | Transfer and Backup |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | AI-FEAT-038 |
| Subfeatures | None |
| Dependencies | AI-FEAT-038 |
| Related roadmap milestone | None |
| Related technical docs | None dedicated |
| Evidence status | Verified from current code, git commit history, and git branch inspection |
| First-known implementation | Evidence pending (10+ dedicated commits, dates not individually attributed in this pass) |
| Latest major update | Evidence pending |

## Summary

A distinct mode of Transfer Export (`backupUpdate` mode) with genuinely different conflict semantics: it never overwrites and never creates `_1`/`_2` renamed files — a stricter no-mutation contract than standard export. Real and substantial, not aspirational: confirmed via 10+ dedicated `feat(backup)`/`fix(backup)`-prefixed commits, all merged to `main`.

## Current Behavior

IPC: `archive:scanBackupSync` → `transferExportService.scanBackupSync()`. `backupUpdate` mode (`services/transferExportService.js:57,128-131`). Supports custom source/destination folders (not just the standard Active→Transfer path), checkpoint/resume, sequence-prefixed folder rename detection, and a cross-device resume validation guard (confirms a resumed job's source root still matches the originating device — see 01_FEATURE_REGISTRY.md's Cross-Cutting Patterns note on "cross-device continuation," which is not a standalone feature but partly lives here).

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

Commits confirmed on `main` (via the fully-merged `feat/backup-sync-scan` branch, 0 commits ahead of main as of this audit): `13a4558` (correct event.json classification, update progress, detect folder renames), `8f9a351` (support custom source folder export), `385d60c` (hidden custom transfer job state), `0674d3a` (resume custom folder exports from checkpoint), `3238ade` (clean transfer backup scan summary layout), `4caad25`/`f2ea43a` (detect sequence-prefixed/reviewed nested folder renames), `9f825df` (show custom backup resume state), `e08fac2` (cross-device source validation for custom export resume), `803c756` (preserve queued progress total on resume). Individual commit dates were not attributed in this pass.

## Known Bugs / Troubleshooting

None recorded in `docs/product/bugs/` yet — several of the commits above are themselves bug fixes (folder-rename detection, resume-state display, progress-total preservation) but were not backfilled into individual bug records.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `services/transferExportService.js` (`scanBackupSync`, `backupUpdate` mode)
