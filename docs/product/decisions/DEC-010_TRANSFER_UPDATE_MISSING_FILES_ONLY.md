# DEC-010 — Transfer Update Is Missing-Files-Only

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-040 |
| Status | Accepted |
| Date | Evidence pending exact date — confirmed via 10+ dedicated `feat(backup)`/`fix(backup)` commits, individually undated in this pass |
| Evidence status | Verified from code (`services/transferExportService.js:57,128-131`) and docs (`docs/product/features/AI-FEAT-040_BACKUP_UPDATE_SCANNING.md`) |

## Context

Keeping a backup/mirror archive current after the primary archive has changed needs an "update" mode distinct from a fresh full export — one that only moves what's actually missing, without risking overwriting or duplicating content that may have diverged for legitimate reasons (e.g. a file was intentionally corrected at the destination).

## Options Considered

Only the chosen direction is evidenced. No alternative (e.g. an overwrite-on-conflict update mode) appears in code or commit history. Full alternatives-considered detail: **Evidence pending**.

1. **Missing-files-only update, with changed files explicitly skipped/reported rather than overwritten or auto-duplicated** — the option that was built.

## Decision

Backup Update Scanning (`backupUpdate` mode, `services/transferExportService.js:57,128-131`) is a stricter no-mutation contract than standard Transfer Export: it never overwrites and never creates `_1`/`_2` renamed files for a changed destination file. Only genuinely missing files are copied. The mode supports custom source/destination folders (not just the standard Active→Transfer path), checkpoint/resume, and sequence-prefixed folder rename detection.

## Consequences

- A file that changed at the destination since the last update is explicitly skipped and reported, never silently overwritten or duplicated — any future enhancement to this mode must preserve that guarantee.
- Checkpoint/resume must track the queued-only total, not the full source scan count, so progress reporting on resume reflects the actual missing-file scope (see [BUG-005](../bugs/BUG-005_TRANSFER_EXPORT_RESUME_STATE_DIVERGENCE.md) for a case where this drifted).
- Forecloses treating Backup Update Scanning as interchangeable with a full Transfer Export "for convenience" — the two have genuinely different conflict semantics and must not be conflated in future UI or documentation.

## Reconciliation Note

None recorded — no known divergence between this decision and current code.
