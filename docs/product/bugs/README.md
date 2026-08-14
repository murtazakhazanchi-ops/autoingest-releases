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

| [BUG-015](BUG-015_WINDOWS_RUNNER_DEFAULT_POWERSHELL_SHELL_MANGLES_ELECTRON_BUILDER_DOT_NOTATION_CLI_OVERRIDES.md) | Windows Runner Default PowerShell Shell Mangles electron-builder Dot-Notation CLI Overrides | Fixed | High | AI-FEAT-057 |
| [BUG-016](BUG-016_UNDECLARED_NPM_DEPENDENCY_IN_PRODUCT_DOCS_TOOLING_MASKED_BY_LOCALLY_HOISTED_NODE_MODULES.md) | Undeclared npm Dependency in product-docs Tooling Masked by Locally-Hoisted node_modules | Fixed | Medium | AI-FEAT-057 |

| [BUG-017](BUG-017_TELEMETRY_HARDCODED_BUNDLED_SERVICE_ACCOUNT_CREDENTIAL.md) | Telemetry Pipeline Bundles a Hardcoded Google Service-Account Credential | Open | High | AI-FEAT-007 |
| [BUG-018](BUG-018_TELEMETRY_IMPORT_FAILURE_REPORT_INCLUDES_ARCHIVE_DESTINATION_PATH.md) | Telemetry Import-Failure Report Includes the Real Archive Destination Path | Open | Medium | AI-FEAT-007, AI-FEAT-019 |

Note: this index table does not yet include BUG-011 through BUG-014 (Windows/NAS Event Management investigation, 2026-08-11) — a pre-existing gap from before this entry, not introduced or corrected here.
