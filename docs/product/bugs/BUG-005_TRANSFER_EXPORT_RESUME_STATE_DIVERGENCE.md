# BUG-005 — Transfer Export/Backup-Update Resume State Diverges From Backend Progress

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-038, AI-FEAT-040, AI-FEAT-041 |
| Status | Fixed |
| Severity | Medium |
| Discovered | 2026-06-23 |
| Fixed | 2026-06-23 (same day, three related fixes) |
| Evidence status | Verified from Git history (commits `cb01b34`, `803c756`, `9f825df`) |

## Symptom

Three related, same-day symptoms in the Transfer Export / Backup Update Scanning UI:

1. Progress display showed impossible numbers (e.g. "19,216 / 4,252") when reopening the transfer modal over an already-running backup-update export.
2. On resume from a checkpoint, the progress denominator reset to the full source file count instead of the queued-only total (e.g. "0 / 20,000" instead of the correct "0 / 3").
3. For custom-destination exports, an interrupted export's resume banner never appeared at all, and the "resume"/"start fresh" actions routed to the wrong (archive) IPC handlers instead of the custom-export ones.

## Root Cause

In each case, resume/progress state was derived from a **renderer/UI-modal lifecycle flag** instead of the actual backend service state:

1. `_txOpen()` reset `_txScanMode = false` on every modal open, including when reopening over a running backup-update export already in progress; `_txApplyStatus` then used the wrong progress formula against that stale flag.
2. `resumeExportFromCheckpoint` didn't pass `updateTotalFiles`, so the denominator was recomputed from the full source scan instead of the queued-only total that was actually checkpointed.
3. Custom-destination exports never checked for an existing checkpoint at all before rendering the modal, so the resume-detection branch simply never ran for that export type.

## Investigation Log

- **2026-06-23** — Commit `cb01b34` — "fix(ui): correct transfer update progress and show queued size." Root cause (1) fixed: derive `isBackupUpdate` from backend `status.backupUpdate` instead of the UI flag `_txScanMode`.
- **2026-06-23** (~25 minutes later) — Commit `803c756` — "fix(backup): preserve queued progress total on resume." Root cause (2) fixed.
- **2026-06-23** — Commit `9f825df` — "fix(ui): show custom backup resume state." Root cause (3) fixed.

## Fix

- `renderer/renderer.js` / `services/transferExportService.js`: `isBackupUpdate` is now derived from the backend's own `status.backupUpdate`, not a UI-modal-lifecycle flag that resets on every reopen.
- `services/transferExportService.js`: `resumeExportFromCheckpoint` now passes `updateTotalFiles` through so the progress denominator reflects the actual queued scope, not a full re-scan.
- `renderer/renderer.js`: custom-destination exports now check for an existing checkpoint before rendering, so the resume banner and correct (custom-export, not archive) IPC handlers are used.

## Prevention / Reusable Lesson

Resume and progress state must always be derived from the backend service's own authoritative state, never from a renderer/UI-modal lifecycle flag that resets independently of whatever operation is actually running in the background — the same category of mistake as [BUG-001](BUG-001_SOURCE_CLEANUP_POST_IMPORT_STATE_OWNERSHIP.md)'s post-import state ownership issue, recurring in a different subsystem. When a "review then resume" UI exists, every entry point into it (standard export, custom-destination export, backup-update mode) needs its own resume-detection check — one code path's fix does not automatically cover a structurally similar but separately-implemented path.

## Related

- [AI-FEAT-038 — Transfer Export](../features/AI-FEAT-038_TRANSFER_EXPORT.md)
- [AI-FEAT-040 — Backup Update Scanning](../features/AI-FEAT-040_BACKUP_UPDATE_SCANNING.md)
- [AI-FEAT-041 — Transfer Background/Minimize Operation](../features/AI-FEAT-041_TRANSFER_BACKGROUND_MINIMIZE_OPERATION.md)
- [BUG-001 — Source Cleanup / Post-Import State Ownership Race](BUG-001_SOURCE_CLEANUP_POST_IMPORT_STATE_OWNERSHIP.md) (same class of bug — UI-lifecycle state substituted for backend/session state)
