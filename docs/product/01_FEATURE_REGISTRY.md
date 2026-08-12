# Feature Registry — AutoIngest Product Capabilities

This is the canonical inventory of AutoIngest product capabilities. Every row has a permanent `AI-FEAT-###` ID and a corresponding file under [features/](features/).

IDs are assigned once and never reused or renumbered, even if a feature is later merged, deprecated, or reclassified — see [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md).

**Methodology**: built from (1) the required technical docs under `docs/`, (2) two independent code/test/git-history research passes covering all 63 checklist areas from the original audit brief, and (3) an `autoingest-architect` review pass that added 3 missed foundational systems, merged one over-split pair, and downgraded 3 entries to explicit subfeature/reflection-layer status. See [10_CHANGELOG.md](10_CHANGELOG.md) for when this was established.

**Status vocabulary**: Implemented / Implemented — evolving / Partially implemented / In active development / Planned / Deferred / Deprecated / Superseded
**Maturity vocabulary**: Foundational / Stable / Operational / Evolving / Experimental / Planned

---

## Application Platform

| ID | Name | Status | Maturity | Parent | Roadmap | Doc |
|---|---|---|---|---|---|---|
| AI-FEAT-001 | Electron Application Shell & Security Model | Implemented | Foundational | — | — | [features/AI-FEAT-001_ELECTRON_APPLICATION_SHELL_SECURITY_MODEL.md](features/AI-FEAT-001_ELECTRON_APPLICATION_SHELL_SECURITY_MODEL.md) |
| AI-FEAT-002 | Login & Operator Identity | Implemented | Stable | — | — | [features/AI-FEAT-002_LOGIN_OPERATOR_IDENTITY.md](features/AI-FEAT-002_LOGIN_OPERATOR_IDENTITY.md) |
| AI-FEAT-003 | Dashboard & System Status | Implemented — evolving | Operational | — | — | [features/AI-FEAT-003_DASHBOARD_SYSTEM_STATUS.md](features/AI-FEAT-003_DASHBOARD_SYSTEM_STATUS.md) |
| AI-FEAT-004 | event.json Data Model & Persistence Contract | Implemented | Foundational | — | — | [features/AI-FEAT-004_EVENT_JSON_DATA_MODEL_PERSISTENCE_CONTRACT.md](features/AI-FEAT-004_EVENT_JSON_DATA_MODEL_PERSISTENCE_CONTRACT.md) |
| AI-FEAT-005 | Application Settings & Configuration Store | Implemented | Foundational | — | — | [features/AI-FEAT-005_APPLICATION_SETTINGS_CONFIGURATION_STORE.md](features/AI-FEAT-005_APPLICATION_SETTINGS_CONFIGURATION_STORE.md) |
| AI-FEAT-006 | Application Auto-Update | Implemented | Stable | — | — | [features/AI-FEAT-006_APPLICATION_AUTO_UPDATE.md](features/AI-FEAT-006_APPLICATION_AUTO_UPDATE.md) |
| AI-FEAT-007 | Telemetry Pipeline | Implemented | Operational | — | — | [features/AI-FEAT-007_TELEMETRY_PIPELINE.md](features/AI-FEAT-007_TELEMETRY_PIPELINE.md) |
| AI-FEAT-057 | Multi-Channel Release & Update System | Implemented | Evolving | AI-FEAT-006 | AI-RM-010 | [features/AI-FEAT-057_MULTI_CHANNEL_RELEASE_UPDATE_SYSTEM.md](features/AI-FEAT-057_MULTI_CHANNEL_RELEASE_UPDATE_SYSTEM.md) |

## Product UI

| ID | Name | Status | Maturity | Parent | Roadmap | Doc |
|---|---|---|---|---|---|---|
| AI-FEAT-008 | Design System & UI Consistency Framework | Implemented — evolving | Foundational | — | — | [features/AI-FEAT-008_DESIGN_SYSTEM_UI_CONSISTENCY_FRAMEWORK.md](features/AI-FEAT-008_DESIGN_SYSTEM_UI_CONSISTENCY_FRAMEWORK.md) |

## Event Management

| ID | Name | Status | Maturity | Parent | Roadmap | Doc |
|---|---|---|---|---|---|---|
| AI-FEAT-009 | Event Creation | Implemented | Stable | — | — | [features/AI-FEAT-009_EVENT_CREATION.md](features/AI-FEAT-009_EVENT_CREATION.md) |
| AI-FEAT-010 | Event Management & Editing | Implemented | Stable | — | — | [features/AI-FEAT-010_EVENT_MANAGEMENT_EDITING.md](features/AI-FEAT-010_EVENT_MANAGEMENT_EDITING.md) |

## Source Acquisition

| ID | Name | Status | Maturity | Parent | Roadmap | Doc |
|---|---|---|---|---|---|---|
| AI-FEAT-011 | Source Detection (Drives, DCIM, Sony PRIVATE) | Implemented | Stable | — | — | [features/AI-FEAT-011_SOURCE_DETECTION.md](features/AI-FEAT-011_SOURCE_DETECTION.md) |
| AI-FEAT-012 | Source Selection (Local Folder / External Drive) | Implemented | Stable | — | — | [features/AI-FEAT-012_SOURCE_SELECTION.md](features/AI-FEAT-012_SOURCE_SELECTION.md) |

## Media Browsing

| ID | Name | Status | Maturity | Parent | Roadmap | Doc |
|---|---|---|---|---|---|---|
| AI-FEAT-013 | File Browser & Media Grid/List Viewing | Implemented | Stable | — | — | [features/AI-FEAT-013_FILE_BROWSER_MEDIA_GRID_LIST_VIEWING.md](features/AI-FEAT-013_FILE_BROWSER_MEDIA_GRID_LIST_VIEWING.md) |
| AI-FEAT-014 | Thumbnail Generation & Caching | Implemented | Stable | — | — | [features/AI-FEAT-014_THUMBNAIL_GENERATION_CACHING.md](features/AI-FEAT-014_THUMBNAIL_GENERATION_CACHING.md) |
| AI-FEAT-015 | Media Preview | Implemented | Stable | — | — | [features/AI-FEAT-015_MEDIA_PREVIEW.md](features/AI-FEAT-015_MEDIA_PREVIEW.md) |
| AI-FEAT-016 | Preview Focus / Selection Separation | Implemented | Stable | — | — | [features/AI-FEAT-016_PREVIEW_FOCUS_SELECTION_SEPARATION.md](features/AI-FEAT-016_PREVIEW_FOCUS_SELECTION_SEPARATION.md) |

## Grouping and Routing

| ID | Name | Status | Maturity | Parent | Roadmap | Doc |
|---|---|---|---|---|---|---|
| AI-FEAT-017 | Grouping System | Implemented | Stable | — | — | [features/AI-FEAT-017_GROUPING_SYSTEM.md](features/AI-FEAT-017_GROUPING_SYSTEM.md) |
| AI-FEAT-018 | Event-Component Import Routing | Implemented | Stable | — | — | [features/AI-FEAT-018_EVENT_COMPONENT_IMPORT_ROUTING.md](features/AI-FEAT-018_EVENT_COMPONENT_IMPORT_ROUTING.md) |

## Import and Archive Writing

| ID | Name | Status | Maturity | Parent | Roadmap | Doc |
|---|---|---|---|---|---|---|
| AI-FEAT-019 | Import Pipeline & Copy Engine | Implemented | Foundational | — | — | [features/AI-FEAT-019_IMPORT_PIPELINE_COPY_ENGINE.md](features/AI-FEAT-019_IMPORT_PIPELINE_COPY_ENGINE.md) |
| AI-FEAT-020 | Duplicate Detection | Implemented | Stable | AI-FEAT-019 | — | [features/AI-FEAT-020_DUPLICATE_DETECTION.md](features/AI-FEAT-020_DUPLICATE_DETECTION.md) |
| AI-FEAT-021 | Atomic Import Transaction | Implemented | Foundational | — | — | [features/AI-FEAT-021_ATOMIC_IMPORT_TRANSACTION.md](features/AI-FEAT-021_ATOMIC_IMPORT_TRANSACTION.md) |
| AI-FEAT-022 | Photographer-Folder Resolution | Implemented | Stable | — | — | [features/AI-FEAT-022_PHOTOGRAPHER_FOLDER_RESOLUTION.md](features/AI-FEAT-022_PHOTOGRAPHER_FOLDER_RESOLUTION.md) |
| AI-FEAT-023 | Quick Import | Implemented | Stable | — | — | [features/AI-FEAT-023_QUICK_IMPORT.md](features/AI-FEAT-023_QUICK_IMPORT.md) |
| AI-FEAT-024 | Source Cleanup | Implemented | Stable | — | — | [features/AI-FEAT-024_SOURCE_CLEANUP.md](features/AI-FEAT-024_SOURCE_CLEANUP.md) |
| AI-FEAT-025 | Checksum-Based File Verification | Implemented | Operational | — | — | [features/AI-FEAT-025_CHECKSUM_BASED_FILE_VERIFICATION.md](features/AI-FEAT-025_CHECKSUM_BASED_FILE_VERIFICATION.md) |
| AI-FEAT-026 | Audit Integrity Verification (Count-Based) | Implemented | Operational | — | — | [features/AI-FEAT-026_AUDIT_INTEGRITY_VERIFICATION.md](features/AI-FEAT-026_AUDIT_INTEGRITY_VERIFICATION.md) |
| AI-FEAT-027 | Activity Log | Implemented | Stable | — | — | [features/AI-FEAT-027_ACTIVITY_LOG.md](features/AI-FEAT-027_ACTIVITY_LOG.md) |
| AI-FEAT-028 | Import Source Attribution | Implemented | Stable | — | — | [features/AI-FEAT-028_IMPORT_SOURCE_ATTRIBUTION.md](features/AI-FEAT-028_IMPORT_SOURCE_ATTRIBUTION.md) |

## Metadata

| ID | Name | Status | Maturity | Parent | Roadmap | Doc |
|---|---|---|---|---|---|---|
| AI-FEAT-029 | Metadata Writing Engine | Implemented | Foundational | — | — | [features/AI-FEAT-029_METADATA_WRITING_ENGINE.md](features/AI-FEAT-029_METADATA_WRITING_ENGINE.md) |
| AI-FEAT-030 | Metadata Durable Queue & Crash Recovery | Implemented | Stable | AI-FEAT-029 | — | [features/AI-FEAT-030_METADATA_DURABLE_QUEUE_CRASH_RECOVERY.md](features/AI-FEAT-030_METADATA_DURABLE_QUEUE_CRASH_RECOVERY.md) |
| AI-FEAT-031 | Metadata Event-State Derivation | Implemented | Stable | AI-FEAT-029 | — | [features/AI-FEAT-031_METADATA_EVENT_STATE_DERIVATION.md](features/AI-FEAT-031_METADATA_EVENT_STATE_DERIVATION.md) |
| AI-FEAT-032 | Metadata Verification | Implemented | Stable | AI-FEAT-029 | — | [features/AI-FEAT-032_METADATA_VERIFICATION.md](features/AI-FEAT-032_METADATA_VERIFICATION.md) |
| AI-FEAT-033 | Metadata Audit & Repair | Implemented | Stable | AI-FEAT-029 | AI-RM-001 | [features/AI-FEAT-033_METADATA_AUDIT_REPAIR.md](features/AI-FEAT-033_METADATA_AUDIT_REPAIR.md) |
| AI-FEAT-034 | Metadata Management Modal | Implemented — evolving | Operational | AI-FEAT-031, AI-FEAT-033, AI-FEAT-036 | — | [features/AI-FEAT-034_METADATA_MANAGEMENT_MODAL.md](features/AI-FEAT-034_METADATA_MANAGEMENT_MODAL.md) |
| AI-FEAT-035 | Dashboard Metadata Health | Implemented — evolving | Operational | AI-FEAT-031 | — | [features/AI-FEAT-035_DASHBOARD_METADATA_HEALTH.md](features/AI-FEAT-035_DASHBOARD_METADATA_HEALTH.md) |
| AI-FEAT-036 | Keyword Registry | Implemented | Stable | — | — | [features/AI-FEAT-036_KEYWORD_REGISTRY.md](features/AI-FEAT-036_KEYWORD_REGISTRY.md) |
| AI-FEAT-037 | Metadata Reapply / Sync | Implemented | Evolving | AI-FEAT-029 | — | [features/AI-FEAT-037_METADATA_REAPPLY_SYNC.md](features/AI-FEAT-037_METADATA_REAPPLY_SYNC.md) |

## Transfer and Backup

| ID | Name | Status | Maturity | Parent | Roadmap | Doc |
|---|---|---|---|---|---|---|
| AI-FEAT-038 | Transfer Export | Implemented | Stable | — | — | [features/AI-FEAT-038_TRANSFER_EXPORT.md](features/AI-FEAT-038_TRANSFER_EXPORT.md) |
| AI-FEAT-039 | Transfer Import | Implemented | Stable | — | — | [features/AI-FEAT-039_TRANSFER_IMPORT.md](features/AI-FEAT-039_TRANSFER_IMPORT.md) |
| AI-FEAT-040 | Backup Update Scanning | Implemented | Stable | AI-FEAT-038 | — | [features/AI-FEAT-040_BACKUP_UPDATE_SCANNING.md](features/AI-FEAT-040_BACKUP_UPDATE_SCANNING.md) |
| AI-FEAT-041 | Transfer Background/Minimize Operation | Implemented | Stable | AI-FEAT-038, AI-FEAT-039 | — | [features/AI-FEAT-041_TRANSFER_BACKGROUND_MINIMIZE_OPERATION.md](features/AI-FEAT-041_TRANSFER_BACKGROUND_MINIMIZE_OPERATION.md) |

## Archive Operations

| ID | Name | Status | Maturity | Parent | Roadmap | Doc |
|---|---|---|---|---|---|---|
| AI-FEAT-042 | Archive Root Configuration & Resolution | Implemented | Stable | AI-FEAT-005 | — | [features/AI-FEAT-042_ARCHIVE_ROOT_CONFIGURATION_RESOLUTION.md](features/AI-FEAT-042_ARCHIVE_ROOT_CONFIGURATION_RESOLUTION.md) |
| AI-FEAT-043 | Archive Health Reporting | Implemented | Stable | — | — | [features/AI-FEAT-043_ARCHIVE_HEALTH_REPORTING.md](features/AI-FEAT-043_ARCHIVE_HEALTH_REPORTING.md) |
| AI-FEAT-044 | Local-First Background Archive Sync | Implemented | Stable | — | — | [features/AI-FEAT-044_LOCAL_FIRST_BACKGROUND_ARCHIVE_SYNC.md](features/AI-FEAT-044_LOCAL_FIRST_BACKGROUND_ARCHIVE_SYNC.md) |
| AI-FEAT-045 | Archive Lock Handling & Stale-Lock Recovery | Implemented | Stable | — | — | [features/AI-FEAT-045_ARCHIVE_LOCK_HANDLING_STALE_LOCK_RECOVERY.md](features/AI-FEAT-045_ARCHIVE_LOCK_HANDLING_STALE_LOCK_RECOVERY.md) |
| AI-FEAT-046 | Archive Folder Adoption | Implemented | Stable | — | — | [features/AI-FEAT-046_ARCHIVE_FOLDER_ADOPTION.md](features/AI-FEAT-046_ARCHIVE_FOLDER_ADOPTION.md) |

## Special Workflows

| ID | Name | Status | Maturity | Parent | Roadmap | Doc |
|---|---|---|---|---|---|---|
| AI-FEAT-047 | QMZ Sequencing Workspace | Implemented | Stable | — | — | [features/AI-FEAT-047_QMZ_SEQUENCING_WORKSPACE.md](features/AI-FEAT-047_QMZ_SEQUENCING_WORKSPACE.md) |

## Collaboration and Realtime Coordination

| ID | Name | Status | Maturity | Parent | Roadmap | Doc |
|---|---|---|---|---|---|---|
| AI-FEAT-048 | Realtime Team Presence & Online Registry | Implemented | Operational | — | — | [features/AI-FEAT-048_REALTIME_TEAM_PRESENCE_ONLINE_REGISTRY.md](features/AI-FEAT-048_REALTIME_TEAM_PRESENCE_ONLINE_REGISTRY.md) |

## Planned Archive Management

| ID | Name | Status | Maturity | Parent | Roadmap | Doc |
|---|---|---|---|---|---|---|
| AI-FEAT-049 | Archive Maintenance | Planned | Planned | — | AI-RM-002 | [features/AI-FEAT-049_ARCHIVE_MAINTENANCE.md](features/AI-FEAT-049_ARCHIVE_MAINTENANCE.md) |
| AI-FEAT-050 | Event Maintenance | Planned | Planned | — | AI-RM-003 | [features/AI-FEAT-050_EVENT_MAINTENANCE.md](features/AI-FEAT-050_EVENT_MAINTENANCE.md) |
| AI-FEAT-051 | Archive Browser | Planned | Planned | — | AI-RM-004 | [features/AI-FEAT-051_ARCHIVE_BROWSER.md](features/AI-FEAT-051_ARCHIVE_BROWSER.md) |
| AI-FEAT-052 | Archive Repair | Planned | Planned | — | AI-RM-007 | [features/AI-FEAT-052_ARCHIVE_REPAIR.md](features/AI-FEAT-052_ARCHIVE_REPAIR.md) |

## Search and Discovery

| ID | Name | Status | Maturity | Parent | Roadmap | Doc |
|---|---|---|---|---|---|---|
| AI-FEAT-053 | Global Search | Planned | Planned | — | AI-RM-005 | [features/AI-FEAT-053_GLOBAL_SEARCH.md](features/AI-FEAT-053_GLOBAL_SEARCH.md) |

## Reliability and Recovery

| ID | Name | Status | Maturity | Parent | Roadmap | Doc |
|---|---|---|---|---|---|---|
| AI-FEAT-054 | Integrity Verification — Archive-Wide | Planned | Planned | — | AI-RM-006 | [features/AI-FEAT-054_INTEGRITY_VERIFICATION_ARCHIVE_WIDE.md](features/AI-FEAT-054_INTEGRITY_VERIFICATION_ARCHIVE_WIDE.md) |

## Analytics and Intelligence

| ID | Name | Status | Maturity | Parent | Roadmap | Doc |
|---|---|---|---|---|---|---|
| AI-FEAT-055 | Archive Analytics | Planned | Planned | — | AI-RM-008 | [features/AI-FEAT-055_ARCHIVE_ANALYTICS.md](features/AI-FEAT-055_ARCHIVE_ANALYTICS.md) |
| AI-FEAT-056 | AI Archive Intelligence | Planned | Planned | — | AI-RM-009 | [features/AI-FEAT-056_AI_ARCHIVE_INTELLIGENCE.md](features/AI-FEAT-056_AI_ARCHIVE_INTELLIGENCE.md) |

---

## Totals

- **57 features registered**: 49 Implemented-family (45 plain "Implemented", including AI-FEAT-057 + 4 "Implemented — evolving"), 0 "Partially implemented", 0 "In active development", 8 "Planned" (0% implementation confirmed for all 8).
- Planned: 8 (all mapped 1:1 to AI-RM-002 through AI-RM-009, except AI-RM-001 which has no dedicated "planned" row because it is already complete — see AI-FEAT-033)
- AI-FEAT-057 maps to AI-RM-010, a parallel release-infrastructure track outside the AI-RM-001…009 archive-capability sequence — see 02_MASTER_ROADMAP.md.

## Cross-Cutting Patterns (documented, not given their own AI-FEAT ID)

These are real, repeated engineering patterns confirmed across multiple features during the audit. They are intentionally **not** independent registry entries because no single code path implements them — each owning feature implements its own instance. Documented here so they aren't silently lost, per the audit's own evidence-discipline rule.

- **Resume/checkpoint behavior.** Implemented independently in at least 3 places with no shared code path: Metadata Durable Queue (AI-FEAT-030), Transfer Export/Import checkpoint (AI-FEAT-038/039/040), and the Local-First Sync Queue (AI-FEAT-044). Each feature's doc describes its own resume mechanism.
- **Renderer memory safety (IPC payload stripping).** `docs/failure-patterns.md` §12 and `CLAUDE.md` § Renderer Memory Safety: never cache full nested IPC scan results (`_eventJson`, `imports[]`) in module-level renderer variables; strip before caching, load lazily per-event. Applies to AI-FEAT-010 (event list) and AI-FEAT-027 (Activity Log), both of which had real OOM bugs from this exact pattern (see `docs/history.md` v0.7.4-dev, v0.8.6).
- **Never-throw-to-IPC / per-source isolation / `_inFlight` guard.** Documented in `docs/archive-operations-layer.md` § Service Contracts, applies uniformly across AI-FEAT-043's four reporting services.

## Reconciliation Notes (existing docs found stale relative to current code)

- `docs/features.md`'s "Planned Features" § **NAS Sync** entry is superseded by AI-FEAT-042 (Archive Root Configuration & Resolution) and AI-FEAT-044 (Local-First Background Archive Sync), both of which are Implemented. `docs/features.md` itself was not edited (out of scope for this task — see `05_DOCUMENTATION_WORKFLOW.md` § Authority Boundary); this note exists so the discrepancy isn't silently lost.
- `docs/features.md`'s "Planned Features" § **Persistence Enhancements** is too vague to map to a durable capability; folded into AI-FEAT-004's Future Enhancements.
- `docs/features.md`'s "Planned Features" § **Multi-User Handling** remains genuinely unimplemented (operator profiles are single-active-user; `services/settings.js`'s `getLastActiveUserId()` confirms a single value, not concurrent/role-based access) and is folded into AI-FEAT-002's Future Enhancements rather than given its own ID.
