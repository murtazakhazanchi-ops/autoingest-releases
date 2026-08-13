# Documentation Health Report

> Generated artifact. Implements the 13 rules specified in [14_VALIDATION_SPECIFICATION.md](../14_VALIDATION_SPECIFICATION.md) plus Part 4 tooling-integrity checks. Regenerate with `node scripts/product-docs/cli.js validate`.

Generated against source commit `e93aebed65c0d9ffc586742f4a85b868eea80ff9`.

## Summary

| Level | Count | Exit policy |
|---|---|---|
| Error | 0 | Fails the build (non-zero exit) |
| Warning | 16 | Reported, does not fail the build |
| Information | 15 | Reported, does not fail the build |
| Evidence gap | 57 | Reported, does not fail the build — visibility only, per 14_VALIDATION_SPECIFICATION.md Rule 13 |

**Result**: PASS

## Error (0)

None.

## Warning (16)

| Rule | Message | File | Note |
|---|---|---|---|
| cyclic-dependency | Undocumented dependency cycle: AI-FEAT-006 -> AI-FEAT-007 -> AI-FEAT-006 | generated/dependency-graph.json | — |
| cyclic-dependency | Undocumented dependency cycle: AI-FEAT-009 -> AI-FEAT-018 -> AI-FEAT-009 | generated/dependency-graph.json | — |
| cyclic-dependency | Undocumented dependency cycle: AI-FEAT-032 -> AI-FEAT-039 -> AI-FEAT-032 | generated/dependency-graph.json | — |
| decision-draft-missing-evidence | DEC-016 is Status: Draft but its Evidence status does not cite the originating session or detected signals | decisions/DEC-016_WINDOWS_NAS_EVENT_MANAGEMENT_RELIABILITY_INVESTIGATION_BUG_011_014_CHATGPT_SIDE_.md | — |
| missing-related-technical-docs | AI-FEAT-005 is Implemented but cites no Related technical docs | features/AI-FEAT-005_APPLICATION_SETTINGS_CONFIGURATION_STORE.md | — |
| missing-related-technical-docs | AI-FEAT-006 is Implemented but cites no Related technical docs | features/AI-FEAT-006_APPLICATION_AUTO_UPDATE.md | — |
| missing-related-technical-docs | AI-FEAT-007 is Implemented but cites no Related technical docs | features/AI-FEAT-007_TELEMETRY_PIPELINE.md | — |
| missing-related-technical-docs | AI-FEAT-014 is Implemented but cites no Related technical docs | features/AI-FEAT-014_THUMBNAIL_GENERATION_CACHING.md | — |
| missing-related-technical-docs | AI-FEAT-022 is Implemented but cites no Related technical docs | features/AI-FEAT-022_PHOTOGRAPHER_FOLDER_RESOLUTION.md | — |
| missing-related-technical-docs | AI-FEAT-025 is Implemented but cites no Related technical docs | features/AI-FEAT-025_CHECKSUM_BASED_FILE_VERIFICATION.md | — |
| missing-related-technical-docs | AI-FEAT-034 is Implemented but cites no Related technical docs | features/AI-FEAT-034_METADATA_MANAGEMENT_MODAL.md | — |
| missing-related-technical-docs | AI-FEAT-035 is Implemented but cites no Related technical docs | features/AI-FEAT-035_DASHBOARD_METADATA_HEALTH.md | — |
| missing-related-technical-docs | AI-FEAT-036 is Implemented but cites no Related technical docs | features/AI-FEAT-036_KEYWORD_REGISTRY.md | — |
| missing-related-technical-docs | AI-FEAT-040 is Implemented but cites no Related technical docs | features/AI-FEAT-040_BACKUP_UPDATE_SCANNING.md | — |
| missing-related-technical-docs | AI-FEAT-041 is Implemented but cites no Related technical docs | features/AI-FEAT-041_TRANSFER_BACKGROUND_MINIMIZE_OPERATION.md | — |
| missing-related-technical-docs | AI-FEAT-058 is Implemented but cites no Related technical docs | features/AI-FEAT-058_AUTOINGEST_KNOWLEDGE_ENGINE_STAGE_1.md | — |

## Information (15)

| Rule | Message | File | Note |
|---|---|---|---|
| architecture-coverage | 40/58 features placed in the architectural-evolution relationship map | 11_ARCHITECTURAL_EVOLUTION.md | Unplaced: AI-FEAT-002, AI-FEAT-003, AI-FEAT-005, AI-FEAT-007, AI-FEAT-008, AI-FEAT-010, AI-FEAT-012, AI-FEAT-013, AI-FEAT-014, AI-FEAT-015, AI-FEAT-016, AI-FEAT-017, AI-FEAT-023, AI-FEAT-026, AI-FEAT-034, AI-FEAT-035, AI-FEAT-048, AI-FEAT-058 |
| overlapping-active-decisions | 2 Accepted decisions (DEC-006, DEC-007) all govern the exact same feature/milestone set (AI-FEAT-029) — worth a human check that they don't contradict each other | DEC-006 | — |
| shared-code-path | main/main.js is explicitly owned by 6 features (shared, not exclusive) | main/main.js | AI-FEAT-001, AI-FEAT-021, AI-FEAT-024, AI-FEAT-025, AI-FEAT-036, AI-FEAT-057 |
| shared-code-path | main/preload.js is explicitly owned by 2 features (shared, not exclusive) | main/preload.js | AI-FEAT-001, AI-FEAT-057 |
| shared-code-path | renderer/theme-init.js is explicitly owned by 2 features (shared, not exclusive) | renderer/theme-init.js | AI-FEAT-001, AI-FEAT-003 |
| shared-code-path | services/settings.js is explicitly owned by 4 features (shared, not exclusive) | services/settings.js | AI-FEAT-002, AI-FEAT-005, AI-FEAT-042, AI-FEAT-057 |
| shared-code-path | renderer/renderer.js is explicitly owned by 10 features (shared, not exclusive) | renderer/renderer.js | AI-FEAT-003, AI-FEAT-012, AI-FEAT-016, AI-FEAT-023, AI-FEAT-026, AI-FEAT-027, AI-FEAT-028, AI-FEAT-035, AI-FEAT-047, AI-FEAT-057 |
| shared-code-path | main/eventJsonStore.js is explicitly owned by 3 features (shared, not exclusive) | main/eventJsonStore.js | AI-FEAT-004, AI-FEAT-021, AI-FEAT-029 |
| shared-code-path | services/autoUpdater.js is explicitly owned by 2 features (shared, not exclusive) | services/autoUpdater.js | AI-FEAT-006, AI-FEAT-057 |
| shared-code-path | renderer/index.html is explicitly owned by 4 features (shared, not exclusive) | renderer/index.html | AI-FEAT-008, AI-FEAT-034, AI-FEAT-041, AI-FEAT-057 |
| shared-code-path | main/fileBrowser.js is explicitly owned by 2 features (shared, not exclusive) | main/fileBrowser.js | AI-FEAT-011, AI-FEAT-013 |
| shared-code-path | main/fileManager.js is explicitly owned by 2 features (shared, not exclusive) | main/fileManager.js | AI-FEAT-019, AI-FEAT-020 |
| shared-code-path | services/transferExportService.js is explicitly owned by 3 features (shared, not exclusive) | services/transferExportService.js | AI-FEAT-038, AI-FEAT-040, AI-FEAT-041 |
| shared-code-path | services/offlineCollectionRegistryService.js is explicitly owned by 2 features (shared, not exclusive) | services/offlineCollectionRegistryService.js | AI-FEAT-042, AI-FEAT-048 |
| shared-code-path | scripts/product-docs/cli.js is explicitly owned by 2 features (shared, not exclusive) | scripts/product-docs/cli.js | AI-FEAT-057, AI-FEAT-058 |

## Evidence gap (57)

| Rule | Message | File | Note |
|---|---|---|---|
| documentation-completeness | AI-FEAT-001 has 7 evidence-pending marker(s) | features/AI-FEAT-001_ELECTRON_APPLICATION_SHELL_SECURITY_MODEL.md | — |
| documentation-completeness | AI-FEAT-002 has 3 evidence-pending marker(s) | features/AI-FEAT-002_LOGIN_OPERATOR_IDENTITY.md | — |
| documentation-completeness | AI-FEAT-003 has 6 evidence-pending marker(s) | features/AI-FEAT-003_DASHBOARD_SYSTEM_STATUS.md | — |
| documentation-completeness | AI-FEAT-004 has 2 evidence-pending marker(s) | features/AI-FEAT-004_EVENT_JSON_DATA_MODEL_PERSISTENCE_CONTRACT.md | — |
| documentation-completeness | AI-FEAT-005 has 6 evidence-pending marker(s) | features/AI-FEAT-005_APPLICATION_SETTINGS_CONFIGURATION_STORE.md | — |
| documentation-completeness | AI-FEAT-006 has 8 evidence-pending marker(s) | features/AI-FEAT-006_APPLICATION_AUTO_UPDATE.md | — |
| documentation-completeness | AI-FEAT-007 has 9 evidence-pending marker(s) | features/AI-FEAT-007_TELEMETRY_PIPELINE.md | — |
| documentation-completeness | AI-FEAT-008 has 7 evidence-pending marker(s) | features/AI-FEAT-008_DESIGN_SYSTEM_UI_CONSISTENCY_FRAMEWORK.md | — |
| documentation-completeness | AI-FEAT-009 has 2 evidence-pending marker(s) | features/AI-FEAT-009_EVENT_CREATION.md | — |
| documentation-completeness | AI-FEAT-010 has 6 evidence-pending marker(s) | features/AI-FEAT-010_EVENT_MANAGEMENT_EDITING.md | — |
| documentation-completeness | AI-FEAT-011 has 8 evidence-pending marker(s) | features/AI-FEAT-011_SOURCE_DETECTION.md | — |
| documentation-completeness | AI-FEAT-012 has 7 evidence-pending marker(s) | features/AI-FEAT-012_SOURCE_SELECTION.md | — |
| documentation-completeness | AI-FEAT-013 has 2 evidence-pending marker(s) | features/AI-FEAT-013_FILE_BROWSER_MEDIA_GRID_LIST_VIEWING.md | — |
| documentation-completeness | AI-FEAT-014 has 2 evidence-pending marker(s) | features/AI-FEAT-014_THUMBNAIL_GENERATION_CACHING.md | — |
| documentation-completeness | AI-FEAT-015 has 2 evidence-pending marker(s) | features/AI-FEAT-015_MEDIA_PREVIEW.md | — |
| documentation-completeness | AI-FEAT-016 has 3 evidence-pending marker(s) | features/AI-FEAT-016_PREVIEW_FOCUS_SELECTION_SEPARATION.md | — |
| documentation-completeness | AI-FEAT-017 has 3 evidence-pending marker(s) | features/AI-FEAT-017_GROUPING_SYSTEM.md | — |
| documentation-completeness | AI-FEAT-018 has 3 evidence-pending marker(s) | features/AI-FEAT-018_EVENT_COMPONENT_IMPORT_ROUTING.md | — |
| documentation-completeness | AI-FEAT-019 has 4 evidence-pending marker(s) | features/AI-FEAT-019_IMPORT_PIPELINE_COPY_ENGINE.md | — |
| documentation-completeness | AI-FEAT-020 has 8 evidence-pending marker(s) | features/AI-FEAT-020_DUPLICATE_DETECTION.md | — |
| documentation-completeness | AI-FEAT-021 has 3 evidence-pending marker(s) | features/AI-FEAT-021_ATOMIC_IMPORT_TRANSACTION.md | — |
| documentation-completeness | AI-FEAT-022 has 7 evidence-pending marker(s) | features/AI-FEAT-022_PHOTOGRAPHER_FOLDER_RESOLUTION.md | — |
| documentation-completeness | AI-FEAT-023 has 9 evidence-pending marker(s) | features/AI-FEAT-023_QUICK_IMPORT.md | — |
| documentation-completeness | AI-FEAT-024 has 7 evidence-pending marker(s) | features/AI-FEAT-024_SOURCE_CLEANUP.md | — |
| documentation-completeness | AI-FEAT-025 has 9 evidence-pending marker(s) | features/AI-FEAT-025_CHECKSUM_BASED_FILE_VERIFICATION.md | — |
| documentation-completeness | AI-FEAT-026 has 9 evidence-pending marker(s) | features/AI-FEAT-026_AUDIT_INTEGRITY_VERIFICATION.md | — |
| documentation-completeness | AI-FEAT-027 has 7 evidence-pending marker(s) | features/AI-FEAT-027_ACTIVITY_LOG.md | — |
| documentation-completeness | AI-FEAT-028 has 9 evidence-pending marker(s) | features/AI-FEAT-028_IMPORT_SOURCE_ATTRIBUTION.md | — |
| documentation-completeness | AI-FEAT-029 has 6 evidence-pending marker(s) | features/AI-FEAT-029_METADATA_WRITING_ENGINE.md | — |
| documentation-completeness | AI-FEAT-030 has 8 evidence-pending marker(s) | features/AI-FEAT-030_METADATA_DURABLE_QUEUE_CRASH_RECOVERY.md | — |
| documentation-completeness | AI-FEAT-031 has 8 evidence-pending marker(s) | features/AI-FEAT-031_METADATA_EVENT_STATE_DERIVATION.md | — |
| documentation-completeness | AI-FEAT-032 has 8 evidence-pending marker(s) | features/AI-FEAT-032_METADATA_VERIFICATION.md | — |
| documentation-completeness | AI-FEAT-033 has 4 evidence-pending marker(s) | features/AI-FEAT-033_METADATA_AUDIT_REPAIR.md | — |
| documentation-completeness | AI-FEAT-034 has 3 evidence-pending marker(s) | features/AI-FEAT-034_METADATA_MANAGEMENT_MODAL.md | — |
| documentation-completeness | AI-FEAT-035 has 5 evidence-pending marker(s) | features/AI-FEAT-035_DASHBOARD_METADATA_HEALTH.md | — |
| documentation-completeness | AI-FEAT-036 has 5 evidence-pending marker(s) | features/AI-FEAT-036_KEYWORD_REGISTRY.md | — |
| documentation-completeness | AI-FEAT-037 has 4 evidence-pending marker(s) | features/AI-FEAT-037_METADATA_REAPPLY_SYNC.md | — |
| documentation-completeness | AI-FEAT-038 has 4 evidence-pending marker(s) | features/AI-FEAT-038_TRANSFER_EXPORT.md | — |
| documentation-completeness | AI-FEAT-039 has 3 evidence-pending marker(s) | features/AI-FEAT-039_TRANSFER_IMPORT.md | — |
| documentation-completeness | AI-FEAT-040 has 8 evidence-pending marker(s) | features/AI-FEAT-040_BACKUP_UPDATE_SCANNING.md | — |
| documentation-completeness | AI-FEAT-041 has 4 evidence-pending marker(s) | features/AI-FEAT-041_TRANSFER_BACKGROUND_MINIMIZE_OPERATION.md | — |
| documentation-completeness | AI-FEAT-042 has 2 evidence-pending marker(s) | features/AI-FEAT-042_ARCHIVE_ROOT_CONFIGURATION_RESOLUTION.md | — |
| documentation-completeness | AI-FEAT-043 has 2 evidence-pending marker(s) | features/AI-FEAT-043_ARCHIVE_HEALTH_REPORTING.md | — |
| documentation-completeness | AI-FEAT-044 has 8 evidence-pending marker(s) | features/AI-FEAT-044_LOCAL_FIRST_BACKGROUND_ARCHIVE_SYNC.md | — |
| documentation-completeness | AI-FEAT-045 has 8 evidence-pending marker(s) | features/AI-FEAT-045_ARCHIVE_LOCK_HANDLING_STALE_LOCK_RECOVERY.md | — |
| documentation-completeness | AI-FEAT-046 has 3 evidence-pending marker(s) | features/AI-FEAT-046_ARCHIVE_FOLDER_ADOPTION.md | — |
| documentation-completeness | AI-FEAT-047 has 7 evidence-pending marker(s) | features/AI-FEAT-047_QMZ_SEQUENCING_WORKSPACE.md | — |
| documentation-completeness | AI-FEAT-048 has 3 evidence-pending marker(s) | features/AI-FEAT-048_REALTIME_TEAM_PRESENCE_ONLINE_REGISTRY.md | — |
| documentation-completeness | AI-FEAT-049 has 4 evidence-pending marker(s) | features/AI-FEAT-049_ARCHIVE_MAINTENANCE.md | — |
| documentation-completeness | AI-FEAT-050 has 4 evidence-pending marker(s) | features/AI-FEAT-050_EVENT_MAINTENANCE.md | — |
| documentation-completeness | AI-FEAT-051 has 4 evidence-pending marker(s) | features/AI-FEAT-051_ARCHIVE_BROWSER.md | — |
| documentation-completeness | AI-FEAT-052 has 4 evidence-pending marker(s) | features/AI-FEAT-052_ARCHIVE_REPAIR.md | — |
| documentation-completeness | AI-FEAT-053 has 4 evidence-pending marker(s) | features/AI-FEAT-053_GLOBAL_SEARCH.md | — |
| documentation-completeness | AI-FEAT-054 has 4 evidence-pending marker(s) | features/AI-FEAT-054_INTEGRITY_VERIFICATION_ARCHIVE_WIDE.md | — |
| documentation-completeness | AI-FEAT-055 has 4 evidence-pending marker(s) | features/AI-FEAT-055_ARCHIVE_ANALYTICS.md | — |
| documentation-completeness | AI-FEAT-056 has 4 evidence-pending marker(s) | features/AI-FEAT-056_AI_ARCHIVE_INTELLIGENCE.md | — |
| documentation-completeness | AI-FEAT-058 has 2 evidence-pending marker(s) | features/AI-FEAT-058_AUTOINGEST_KNOWLEDGE_ENGINE_STAGE_1.md | — |

