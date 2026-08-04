# Bugs — Cross-Feature Troubleshooting Knowledge Base

Each file here is a reusable bug record: `BUG-###_NAME.md`, following [../07_BUG_TEMPLATE.md](../07_BUG_TEMPLATE.md).

This is project-history narrative — investigation logs, what was tried, what was ruled out, why the fix works. It complements, and does not replace, `docs/failure-patterns.md`, which remains the authoritative technical symptom→cause→check→fix map for debugging in the moment. When a bug recorded here reveals a durable, reusable diagnostic pattern, consider adding it to `docs/failure-patterns.md` too.

Not every fix needs a record. Use this for bugs whose root cause, symptom, or fix pattern would help diagnose something similar faster next time. See [../05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for when to create one.

## Index

| ID | Title | Status | Severity | Affected features |
|---|---|---|---|---|
| [BUG-001](BUG-001_SOURCE_CLEANUP_POST_IMPORT_STATE_OWNERSHIP.md) | Source Cleanup / Post-Import State Ownership Race | Fixed | Medium | AI-FEAT-024, AI-FEAT-012, AI-FEAT-010 |
| [BUG-002](BUG-002_PHOTOGRAPHER_SEQUENCE_FOLDER_RESOLUTION.md) | Photographer Sequence Folder Resolution Discards Existing Sequenced Folders | Fixed | Medium | AI-FEAT-022, AI-FEAT-018 |
| [BUG-003](BUG-003_STALE_LOCAL_STAGING_RESTORE_OVER_ARCHIVE_ROOT.md) | Stale Local-Staging Restore Wins Over Reachable Archive Root | Fixed | High | AI-FEAT-042, AI-FEAT-004 |
| [BUG-004](BUG-004_SAME_DEVICE_STALE_ARCHIVE_LOCK.md) | Same-Device Stale Archive Lock Blocks All Future Imports | Fixed | Medium | AI-FEAT-045 |
| [BUG-005](BUG-005_TRANSFER_EXPORT_RESUME_STATE_DIVERGENCE.md) | Transfer Export/Backup-Update Resume State Diverges From Backend Progress | Fixed | Medium | AI-FEAT-038, AI-FEAT-040, AI-FEAT-041 |
| [BUG-006](BUG-006_EVENT_EDIT_FULL_PAYLOAD_FIELD_DROP.md) | Event-Edit Full-Payload Save Silently Drops Untracked Fields | Fixed (recurring pattern) | High | AI-FEAT-010, AI-FEAT-004, AI-FEAT-046 |
| [BUG-007](BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md) | QMZ Metadata Context-Shape Mismatch Silently Drops Keywords/Hijri Date | Fixed | High | AI-FEAT-029, AI-FEAT-047, AI-FEAT-033 |
| [BUG-008](BUG-008_LASTMETADATARUN_EISDIR_SILENT_FAILURE.md) | lastMetadataRun Never Written Due to EISDIR Silent Failure | Fixed | Medium | AI-FEAT-029, AI-FEAT-031, AI-FEAT-035 |
| [BUG-009](BUG-009_SAME_SIZE_SKIP_METADATA_UNVERIFIED.md) | Same-Size Skip Left Metadata Unverified | Fixed | Medium | AI-FEAT-019, AI-FEAT-032 |
| [BUG-010](BUG-010_METADATA_QUEUE_IN_MEMORY_LOSS_ON_CRASH.md) | Metadata Batches Held Only In-Memory, Lost on Crash/Restart | Fixed | High | AI-FEAT-029, AI-FEAT-030 |

All ten records above were fixed prior to this documentation pass (2026-08-04); they are backfilled here from Git history, code, and `.claude/learning-log.md` for future reference, not filed as new open issues.
