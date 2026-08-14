# Dependency Intelligence

Canonical, evidence-based relationship model connecting every record type in `docs/product/`. This document does not restate any record's own content — it is a navigational index over relationships already documented (in header tables, `Known Bugs`/`Decisions` sections, `Related` sections, and the architectural-evolution relationship map) elsewhere in this system. If this document and an individual record ever disagree, the individual record wins — regenerate this index rather than editing around the discrepancy.

**Relationship to `docs/product/generated/dependency-graph.*` (Part 4)**: this document is the curated, hand-authored ID-relationship narrative — it groups relationships the way a person would read them (Milestone→Features, Decision→Decision, etc.). `generated/dependency-graph.json`/`.md` is a separate, mechanically-derived, code-level view built by `scripts/product-docs/` from the same underlying evidence (feature files' header tables and Lifecycle Metadata sections) plus the subsystem locator's source-file mapping, with bounded per-subsystem Mermaid diagrams. Neither supersedes the other: this document is better for understanding *why* records relate; the generated graph is better for machine queries, impact analysis, and subsystem-scoped diagrams. Both trace back to the same canonical records, so a disagreement between them means one needs to be regenerated/corrected against those records — not that either is independently authoritative over the other.

**Relationship to Part 5's automated forward-linking**: `scripts/product-docs/automation/canonicalUpdater.js` can append a forward link from a feature file into `Known Bugs / Troubleshooting`/`Decisions` when a bug/decision record is created for it during `automation finalize` — but only for a link already evidenced by the classifier's citations (never a new relationship it invented). It never edits this document directly; this index is still regenerated (`node scripts/product-docs/cli.js build`), never hand-maintained, whether the underlying forward link was added by a human or by Part 5.

**This document is a hybrid, not a fully hand-authored file** (Part 2 Decision 5, 2026-08-14): the tables whose source data is already fully parsed elsewhere in `scripts/product-docs/` (Milestone→Features, Milestone/Feature→Workflow, Feature→Postmortem, Feature→Engineering Memory, Feature→Engineering Conversation) are machine-generated fragments, marked by `<!-- GENERATED:BEGIN <region-id> -->` / `<!-- GENERATED:END <region-id> -->` HTML comments and regenerated in place by `node scripts/product-docs/cli.js build` — never edit the content between a marker pair by hand, since the next build overwrites it. Everything outside those markers (this prose, the Methodology section, and the tables that still require scanning a record's own body/`Related`-section prose rather than a header field — Decision→Decision, Bug→Decision, Bug→Bug, Architecture→Features/Decisions/Postmortems, and the Coverage Summary) remains hand-authored for this pass; converting those would require new cross-reference-extraction parsing this pass deliberately did not add, rather than reusing already-parsed data. `node scripts/product-docs/cli.js validate` checks that every generated region's content matches a fresh rebuild, the same freshness guarantee `docs/product/generated/` already carries.

## Methodology

Every edge below is one of:
- A value already present in a record's own header table or `Related`/`Known Bugs`/`Decisions` section (a **forward** link), or
- A record's own header table naming *this* record as related (a **reverse** lookup — e.g. a decision's `Related feature(s)` field naming a feature that doesn't yet link back).

No relationship here is inferred from naming similarity, folder proximity, or assumption. Reverse-only edges (found by lookup, not yet cross-linked at the source) are marked *(reverse)* below — consider adding the forward link at the source when next editing that record, per [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md).

Per-feature relationship detail (Feature→Feature, Feature→Decision, Feature→Bug, Feature→Postmortem, Feature→Architecture) lives in each feature file's own **Lifecycle Metadata** section (added in this same pass) — this document aggregates that detail into cross-cutting tables for the relationship types that are hard to see from any single record: Decision→Decision, Bug→Decision, Bug→Bug, Milestone→Features, and Architecture→Features/Decisions.

## Milestone → Features

Source: `02_MASTER_ROADMAP.md`'s `Included AI-FEAT IDs` and `Existing features extended` fields per milestone. **AI-RM-010** runs as a parallel infrastructure track, not part of the AI-RM-001…009 archive-capability sequence above it — see `02_MASTER_ROADMAP.md` for that distinction; the table below is otherwise purely mechanical.

<!-- GENERATED:BEGIN milestone-features (regenerate with `node scripts/product-docs/cli.js build`; do not edit by hand between these markers) -->
| Milestone | Status | Included features (delivered by this milestone) | Existing features extended |
|---|---|---|---|
| **AI-RM-001** — Metadata Audit & Repair | **Completed** | [AI-FEAT-029](features/AI-FEAT-029_METADATA_WRITING_ENGINE.md), [AI-FEAT-030](features/AI-FEAT-030_METADATA_DURABLE_QUEUE_CRASH_RECOVERY.md), [AI-FEAT-031](features/AI-FEAT-031_METADATA_EVENT_STATE_DERIVATION.md), [AI-FEAT-032](features/AI-FEAT-032_METADATA_VERIFICATION.md), [AI-FEAT-033](features/AI-FEAT-033_METADATA_AUDIT_REPAIR.md), [AI-FEAT-034](features/AI-FEAT-034_METADATA_MANAGEMENT_MODAL.md), [AI-FEAT-035](features/AI-FEAT-035_DASHBOARD_METADATA_HEALTH.md), [AI-FEAT-036](features/AI-FEAT-036_KEYWORD_REGISTRY.md), [AI-FEAT-037](features/AI-FEAT-037_METADATA_REAPPLY_SYNC.md) | [AI-FEAT-003](features/AI-FEAT-003_DASHBOARD_SYSTEM_STATUS.md), [AI-FEAT-004](features/AI-FEAT-004_EVENT_JSON_DATA_MODEL_PERSISTENCE_CONTRACT.md) |
| **AI-RM-002** — Archive Maintenance | Planned — not started | [AI-FEAT-049](features/AI-FEAT-049_ARCHIVE_MAINTENANCE.md) | — |
| **AI-RM-003** — Event Maintenance | Planned — not started | [AI-FEAT-050](features/AI-FEAT-050_EVENT_MAINTENANCE.md) | — |
| **AI-RM-004** — Archive Browser | Planned — not started | [AI-FEAT-051](features/AI-FEAT-051_ARCHIVE_BROWSER.md) | — |
| **AI-RM-005** — Global Search | Planned — not started | [AI-FEAT-053](features/AI-FEAT-053_GLOBAL_SEARCH.md) | — |
| **AI-RM-006** — Integrity Verification | Planned — not started | [AI-FEAT-054](features/AI-FEAT-054_INTEGRITY_VERIFICATION_ARCHIVE_WIDE.md) | [AI-FEAT-025](features/AI-FEAT-025_CHECKSUM_BASED_FILE_VERIFICATION.md) |
| **AI-RM-007** — Archive Repair | Planned — not started | [AI-FEAT-052](features/AI-FEAT-052_ARCHIVE_REPAIR.md) | [AI-FEAT-043](features/AI-FEAT-043_ARCHIVE_HEALTH_REPORTING.md) |
| **AI-RM-008** — Archive Analytics | Planned — not started | [AI-FEAT-055](features/AI-FEAT-055_ARCHIVE_ANALYTICS.md) | [AI-FEAT-043](features/AI-FEAT-043_ARCHIVE_HEALTH_REPORTING.md) |
| **AI-RM-009** — AI Archive Intelligence | Planned — not started | [AI-FEAT-056](features/AI-FEAT-056_AI_ARCHIVE_INTELLIGENCE.md) | [AI-FEAT-055](features/AI-FEAT-055_ARCHIVE_ANALYTICS.md) |
| **AI-RM-010** — Multi-Channel Release & Update System | **Completed** — verified on real Windows hardware (2026-08-13) | [AI-FEAT-057](features/AI-FEAT-057_MULTI_CHANNEL_RELEASE_UPDATE_SYSTEM.md) | [AI-FEAT-005](features/AI-FEAT-005_APPLICATION_SETTINGS_CONFIGURATION_STORE.md), [AI-FEAT-006](features/AI-FEAT-006_APPLICATION_AUTO_UPDATE.md) |
| **AI-RM-011** — AutoIngest Knowledge & Onboarding Portal (Stage 1 + Stage 2) | **Completed — Stage 1 + Stage 2 merged to `main`** (merge commit `765e9b8`, 2026-08-14). Stage 1 (prototype) and Stage 2 Phases 4–27 (concept/intent retrieval layer, Workflow record type, roadmap routing, Online Registry/teamwork coverage, 119-question eval corpus, hallucination/grounding + adversarial suites, 9-tab portal UX + directory/onboarding mode, mandatory final-report sections, and a pre-merge acceptance pass) all complete and verified from the actual merged `main` state. Stage 3 has not begun and requires separate approval. | [AI-FEAT-058](features/AI-FEAT-058_AUTOINGEST_KNOWLEDGE_ENGINE_STAGE_1.md) | — |
<!-- GENERATED:END milestone-features -->

## Milestone / Feature → Workflow

Source: `workflows/AI-WF-###_*.md`'s own `Related capabilities`/`Related roadmap milestone` header fields (Part 2 Decision 5 — Workflows were not represented anywhere in this document before this pass; see [DEC-020](decisions/DEC-020_STAGE_2_KNOWLEDGE_ARCHITECTURE_WORKFLOW_RECORDS_AND_CONCEPT_LAYER.md) for why Workflow is its own record family).

<!-- GENERATED:BEGIN workflow-relationships (regenerate with `node scripts/product-docs/cli.js build`; do not edit by hand between these markers) -->
| Workflow | Domain | Related capabilities | Related roadmap milestone |
|---|---|---|---|
| [AI-WF-001](workflows/AI-WF-001_IMPORT_PHOTOGRAPHS_FROM_A_MEMORY_CARD_OR_FOLDER.md) | Import | [AI-FEAT-011](features/AI-FEAT-011_SOURCE_DETECTION.md), [AI-FEAT-012](features/AI-FEAT-012_SOURCE_SELECTION.md), [AI-FEAT-017](features/AI-FEAT-017_GROUPING_SYSTEM.md), [AI-FEAT-018](features/AI-FEAT-018_EVENT_COMPONENT_IMPORT_ROUTING.md), [AI-FEAT-019](features/AI-FEAT-019_IMPORT_PIPELINE_COPY_ENGINE.md), [AI-FEAT-022](features/AI-FEAT-022_PHOTOGRAPHER_FOLDER_RESOLUTION.md) | None |
| [AI-WF-002](workflows/AI-WF-002_CREATE_A_NEW_EVENT.md) | Events | [AI-FEAT-009](features/AI-FEAT-009_EVENT_CREATION.md) | None |
| [AI-WF-003](workflows/AI-WF-003_USE_QUICK_IMPORT_FOR_A_SMALL_BATCH.md) | Import | [AI-FEAT-023](features/AI-FEAT-023_QUICK_IMPORT.md) | None |
| [AI-WF-004](workflows/AI-WF-004_REPAIR_MISSING_OR_INCORRECT_METADATA.md) | Metadata | [AI-FEAT-031](features/AI-FEAT-031_METADATA_EVENT_STATE_DERIVATION.md), [AI-FEAT-033](features/AI-FEAT-033_METADATA_AUDIT_REPAIR.md), [AI-FEAT-034](features/AI-FEAT-034_METADATA_MANAGEMENT_MODAL.md) | AI-RM-001 |
| [AI-WF-005](workflows/AI-WF-005_EXPORT_OR_UPDATE_A_TRANSFER_DRIVE.md) | Transfer & Backup | [AI-FEAT-038](features/AI-FEAT-038_TRANSFER_EXPORT.md), [AI-FEAT-039](features/AI-FEAT-039_TRANSFER_IMPORT.md), [AI-FEAT-040](features/AI-FEAT-040_BACKUP_UPDATE_SCANNING.md), [AI-FEAT-041](features/AI-FEAT-041_TRANSFER_BACKGROUND_MINIMIZE_OPERATION.md) | None |
| [AI-WF-006](workflows/AI-WF-006_SEE_WHO_ELSE_IS_ONLINE_AND_WHAT_THEYRE_WORKING_ON.md) | Online Registry & Teamwork | [AI-FEAT-048](features/AI-FEAT-048_REALTIME_TEAM_PRESENCE_ONLINE_REGISTRY.md) | None |
| [AI-WF-007](workflows/AI-WF-007_SORT_QMZ_PHOTOGRAPHS.md) | QMZ | [AI-FEAT-047](features/AI-FEAT-047_QMZ_SEQUENCING_WORKSPACE.md) | None |
| [AI-WF-008](workflows/AI-WF-008_RECOVER_FROM_AN_ARCHIVE_LOCK_ERROR.md) | Archive Management | [AI-FEAT-043](features/AI-FEAT-043_ARCHIVE_HEALTH_REPORTING.md), [AI-FEAT-045](features/AI-FEAT-045_ARCHIVE_LOCK_HANDLING_STALE_LOCK_RECOVERY.md) | None |
| [AI-WF-009](workflows/AI-WF-009_IMPORT_OR_UPDATE_FROM_A_TRANSFER_DRIVE.md) | Transfer & Backup | [AI-FEAT-025](features/AI-FEAT-025_CHECKSUM_BASED_FILE_VERIFICATION.md), [AI-FEAT-032](features/AI-FEAT-032_METADATA_VERIFICATION.md), [AI-FEAT-038](features/AI-FEAT-038_TRANSFER_EXPORT.md), [AI-FEAT-039](features/AI-FEAT-039_TRANSFER_IMPORT.md), [AI-FEAT-042](features/AI-FEAT-042_ARCHIVE_ROOT_CONFIGURATION_RESOLUTION.md) | None |
<!-- GENERATED:END workflow-relationships -->

## Decision → Decision

Source: each decision record's own body text (excluding its header table) for other `DEC-###` mentions.

| Decision | References |
|---|---|
| [DEC-003](decisions/DEC-003_LOCAL_FIRST_ON_PREMISES_ARCHITECTURE.md) | [DEC-012](decisions/DEC-012_ARCHIVE_ROOT_RESOLUTION_REQUIRES_EVIDENCE.md) |
| [DEC-004](decisions/DEC-004_PRESERVE_BRIDGE_BASED_ARCHIVAL_PRACTICE.md) | [DEC-014](decisions/DEC-014_CONTROLLED_KEYWORD_REGISTRY.md) |
| [DEC-009](decisions/DEC-009_COPY_IDEMPOTENCY_MUST_NOT_SUPPRESS_METADATA_REPAIR.md) | [DEC-005](decisions/DEC-005_ORIGINAL_PRESERVATION_NON_DESTRUCTIVE_INGEST.md) |
| [DEC-014](decisions/DEC-014_CONTROLLED_KEYWORD_REGISTRY.md) | [DEC-004](decisions/DEC-004_PRESERVE_BRIDGE_BASED_ARCHIVAL_PRACTICE.md) |

Decisions not listed above reference no other decision in their own body text.

## Bug → Decision

Source: each bug record's own `Related` section for `DEC-###` links.

| Bug | Related decision(s) |
|---|---|
| [BUG-001](bugs/BUG-001_SOURCE_CLEANUP_POST_IMPORT_STATE_OWNERSHIP.md) | None recorded |
| [BUG-002](bugs/BUG-002_PHOTOGRAPHER_SEQUENCE_FOLDER_RESOLUTION.md) | [DEC-012](decisions/DEC-012_ARCHIVE_ROOT_RESOLUTION_REQUIRES_EVIDENCE.md) |
| [BUG-003](bugs/BUG-003_STALE_LOCAL_STAGING_RESTORE_OVER_ARCHIVE_ROOT.md) | [DEC-012](decisions/DEC-012_ARCHIVE_ROOT_RESOLUTION_REQUIRES_EVIDENCE.md) |
| [BUG-004](bugs/BUG-004_SAME_DEVICE_STALE_ARCHIVE_LOCK.md) | [DEC-013](decisions/DEC-013_LOCK_CLEARING_MUST_BE_CONSTRAINED.md) |
| [BUG-005](bugs/BUG-005_TRANSFER_EXPORT_RESUME_STATE_DIVERGENCE.md) | None recorded |
| [BUG-006](bugs/BUG-006_EVENT_EDIT_FULL_PAYLOAD_FIELD_DROP.md) | [DEC-001](decisions/DEC-001_EVENT_DATA_AS_DURABLE_ARCHIVE_TRUTH.md) |
| [BUG-007](bugs/BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md) | [DEC-007](decisions/DEC-007_SHARED_METADATA_ENGINE_RESOLVER.md) |
| [BUG-008](bugs/BUG-008_LASTMETADATARUN_EISDIR_SILENT_FAILURE.md) | None recorded |
| [BUG-009](bugs/BUG-009_SAME_SIZE_SKIP_METADATA_UNVERIFIED.md) | [DEC-009](decisions/DEC-009_COPY_IDEMPOTENCY_MUST_NOT_SUPPRESS_METADATA_REPAIR.md) |
| [BUG-010](bugs/BUG-010_METADATA_QUEUE_IN_MEMORY_LOSS_ON_CRASH.md) | [DEC-008](decisions/DEC-008_DURABLE_METADATA_SURVIVES_RESTART.md) |

## Bug → Bug

Source: each bug record's own `Related` section for other `BUG-###` links (same architectural-pattern cross-references).

| Bug | Related bug(s) |
|---|---|
| [BUG-001](bugs/BUG-001_SOURCE_CLEANUP_POST_IMPORT_STATE_OWNERSHIP.md) | None recorded |
| [BUG-002](bugs/BUG-002_PHOTOGRAPHER_SEQUENCE_FOLDER_RESOLUTION.md) | None recorded |
| [BUG-003](bugs/BUG-003_STALE_LOCAL_STAGING_RESTORE_OVER_ARCHIVE_ROOT.md) | [BUG-002](bugs/BUG-002_PHOTOGRAPHER_SEQUENCE_FOLDER_RESOLUTION.md) |
| [BUG-004](bugs/BUG-004_SAME_DEVICE_STALE_ARCHIVE_LOCK.md) | None recorded |
| [BUG-005](bugs/BUG-005_TRANSFER_EXPORT_RESUME_STATE_DIVERGENCE.md) | [BUG-001](bugs/BUG-001_SOURCE_CLEANUP_POST_IMPORT_STATE_OWNERSHIP.md) |
| [BUG-006](bugs/BUG-006_EVENT_EDIT_FULL_PAYLOAD_FIELD_DROP.md) | None recorded |
| [BUG-007](bugs/BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md) | [BUG-008](bugs/BUG-008_LASTMETADATARUN_EISDIR_SILENT_FAILURE.md) |
| [BUG-008](bugs/BUG-008_LASTMETADATARUN_EISDIR_SILENT_FAILURE.md) | [BUG-007](bugs/BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md) |
| [BUG-009](bugs/BUG-009_SAME_SIZE_SKIP_METADATA_UNVERIFIED.md) | [BUG-010](bugs/BUG-010_METADATA_QUEUE_IN_MEMORY_LOSS_ON_CRASH.md) |
| [BUG-010](bugs/BUG-010_METADATA_QUEUE_IN_MEMORY_LOSS_ON_CRASH.md) | [BUG-009](bugs/BUG-009_SAME_SIZE_SKIP_METADATA_UNVERIFIED.md) |

## Architecture → Features / Decisions / Postmortems

Source: `11_ARCHITECTURAL_EVOLUTION.md` § 5 Relationship Map (reproduced here for cross-cutting navigation — that document remains authoritative if this ever drifts).

| Stage | Related features | Related bug/decision/postmortem records |
|---|---|---|
| §3A Adobe Bridge workflow (continuity point) | AI-FEAT-029, AI-FEAT-036 | [DEC-004](decisions/DEC-004_PRESERVE_BRIDGE_BASED_ARCHIVAL_PRACTICE.md), [DEC-014](decisions/DEC-014_CONTROLLED_KEYWORD_REGISTRY.md) |
| §3B Initial foundation | AI-FEAT-001, AI-FEAT-004, AI-FEAT-009, AI-FEAT-011, AI-FEAT-018, AI-FEAT-019, AI-FEAT-020, AI-FEAT-022 | [DEC-001](decisions/DEC-001_EVENT_DATA_AS_DURABLE_ARCHIVE_TRUTH.md), [DEC-002](decisions/DEC-002_FOLDER_STRUCTURE_PLUS_EMBEDDED_METADATA.md), [DEC-005](decisions/DEC-005_ORIGINAL_PRESERVATION_NON_DESTRUCTIVE_INGEST.md), [BUG-002](bugs/BUG-002_PHOTOGRAPHER_SEQUENCE_FOLDER_RESOLUTION.md) |
| §3C Metadata automation | AI-FEAT-029, AI-FEAT-030, AI-FEAT-031, AI-FEAT-032, AI-FEAT-033, AI-FEAT-036, AI-FEAT-037 | [BUG-007](bugs/BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md), [BUG-008](bugs/BUG-008_LASTMETADATARUN_EISDIR_SILENT_FAILURE.md), [BUG-009](bugs/BUG-009_SAME_SIZE_SKIP_METADATA_UNVERIFIED.md), [BUG-010](bugs/BUG-010_METADATA_QUEUE_IN_MEMORY_LOSS_ON_CRASH.md), [DEC-006](decisions/DEC-006_RAW_FILES_USE_XMP_SIDECARS.md), [DEC-007](decisions/DEC-007_SHARED_METADATA_ENGINE_RESOLVER.md), [DEC-008](decisions/DEC-008_DURABLE_METADATA_SURVIVES_RESTART.md), [DEC-009](decisions/DEC-009_COPY_IDEMPOTENCY_MUST_NOT_SUPPRESS_METADATA_REPAIR.md), [PM-001](postmortems/PM-001_METADATA_CORRECTNESS_GAP_PRODUCTION_READINESS_REVIEW.md) |
| §3D Archive integrity & transaction safety | AI-FEAT-019, AI-FEAT-020, AI-FEAT-021, AI-FEAT-024, AI-FEAT-025, AI-FEAT-027, AI-FEAT-028 | [BUG-001](bugs/BUG-001_SOURCE_CLEANUP_POST_IMPORT_STATE_OWNERSHIP.md), [DEC-005](decisions/DEC-005_ORIGINAL_PRESERVATION_NON_DESTRUCTIVE_INGEST.md) |
| §3E Transfer & distributed working | AI-FEAT-038, AI-FEAT-039, AI-FEAT-040, AI-FEAT-041, AI-FEAT-044, AI-FEAT-045 | [BUG-004](bugs/BUG-004_SAME_DEVICE_STALE_ARCHIVE_LOCK.md), [BUG-005](bugs/BUG-005_TRANSFER_EXPORT_RESUME_STATE_DIVERGENCE.md), [DEC-010](decisions/DEC-010_TRANSFER_UPDATE_MISSING_FILES_ONLY.md), [DEC-013](decisions/DEC-013_LOCK_CLEARING_MUST_BE_CONSTRAINED.md) |
| §3F Specialized workflows (QMZ) | AI-FEAT-022, AI-FEAT-047 | [BUG-007](bugs/BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md), [DEC-011](decisions/DEC-011_QMZ_DEDICATED_DOMAIN_WORKFLOW.md) |
| §3G Archive Operations layer | AI-FEAT-042, AI-FEAT-043, AI-FEAT-044, AI-FEAT-045, AI-FEAT-046 | [BUG-003](bugs/BUG-003_STALE_LOCAL_STAGING_RESTORE_OVER_ARCHIVE_ROOT.md), [BUG-004](bugs/BUG-004_SAME_DEVICE_STALE_ARCHIVE_LOCK.md), [DEC-012](decisions/DEC-012_ARCHIVE_ROOT_RESOLUTION_REQUIRES_EVIDENCE.md), [DEC-013](decisions/DEC-013_LOCK_CLEARING_MUST_BE_CONSTRAINED.md) |
| §3I Planned direction | AI-FEAT-049 – AI-FEAT-056 | [DEC-015](decisions/DEC-015_PLANNED_ARCHITECTURE_SEPARATE_FROM_IMPLEMENTED.md) |

## Feature → Postmortem

<!-- GENERATED:BEGIN feature-postmortem (regenerate with `node scripts/product-docs/cli.js build`; do not edit by hand between these markers) -->
| Postmortem | Related features |
|---|---|
| [PM-001](postmortems/PM-001_METADATA_CORRECTNESS_GAP_PRODUCTION_READINESS_REVIEW.md) | [AI-FEAT-029](features/AI-FEAT-029_METADATA_WRITING_ENGINE.md), [AI-FEAT-030](features/AI-FEAT-030_METADATA_DURABLE_QUEUE_CRASH_RECOVERY.md), [AI-FEAT-031](features/AI-FEAT-031_METADATA_EVENT_STATE_DERIVATION.md), [AI-FEAT-032](features/AI-FEAT-032_METADATA_VERIFICATION.md), [AI-FEAT-033](features/AI-FEAT-033_METADATA_AUDIT_REPAIR.md), [AI-FEAT-047](features/AI-FEAT-047_QMZ_SEQUENCING_WORKSPACE.md) |
| [PM-002](postmortems/PM-002_V0_9_11_FIRST_PUBLICATION_ATTEMPT_PRODUCED_AN_EMPTY_GITHUB_RELEASE.md) | [AI-FEAT-006](features/AI-FEAT-006_APPLICATION_AUTO_UPDATE.md) |
<!-- GENERATED:END feature-postmortem -->

## Feature → Engineering Memory (Part 6)

<!-- GENERATED:BEGIN feature-memory (regenerate with `node scripts/product-docs/cli.js build`; do not edit by hand between these markers) -->
| Memory Capsule | Related features | Related bugs/decisions |
|---|---|---|
| [AI-MEM-0001](memory/AI-MEM-0001_METADATA_MANAGEMENT_MODAL_AUDIT_REPAIR_EVOLUTION.md) | [AI-FEAT-008](features/AI-FEAT-008_DESIGN_SYSTEM_UI_CONSISTENCY_FRAMEWORK.md), [AI-FEAT-033](features/AI-FEAT-033_METADATA_AUDIT_REPAIR.md), [AI-FEAT-034](features/AI-FEAT-034_METADATA_MANAGEMENT_MODAL.md) | None recorded |
| [AI-MEM-0002](memory/AI-MEM-0002_PART_8_MULTI_AI_ENGINEERING_CONVERSATION_INTEGRATION_DESIGN_AND_IMPLEMENTATION_F.md) | None | None recorded |
| [AI-MEM-0003](memory/AI-MEM-0003_WINDOWS_NAS_EVENT_MANAGEMENT_RELIABILITY_3_INDEPENDENT_ROOT_CAUSES.md) | None | None recorded |
| [AI-MEM-0004](memory/AI-MEM-0004_KNOWLEDGE_PORTAL_STAGE_2_OPERATOR_KNOWLEDGE_ARCHITECTURE.md) | [AI-FEAT-045](features/AI-FEAT-045_ARCHIVE_LOCK_HANDLING_STALE_LOCK_RECOVERY.md), [AI-FEAT-048](features/AI-FEAT-048_REALTIME_TEAM_PRESENCE_ONLINE_REGISTRY.md), [AI-FEAT-058](features/AI-FEAT-058_AUTOINGEST_KNOWLEDGE_ENGINE_STAGE_1.md) | DEC-019, DEC-020 |
<!-- GENERATED:END feature-memory -->

A Memory Capsule is historical evidence explaining *why* the cited feature(s) evolved the way they did — it carries no authority of its own and never supersedes the feature file it's linked from; see [16_ENGINEERING_MEMORY_POLICY.md](16_ENGINEERING_MEMORY_POLICY.md) § 3. This table, like every other one on this page, is a curated index over relationships already recorded at the source (each feature file's own Engineering Evolution section cross-links its capsule(s) directly); the machine-generated equivalent is [generated/MEMORY_INDEX.md](generated/MEMORY_INDEX.md).

## Feature → Engineering Conversation (Part 8)

<!-- GENERATED:BEGIN feature-conversation (regenerate with `node scripts/product-docs/cli.js build`; do not edit by hand between these markers) -->
| Conversation | Related features |
|---|---|
| [ENG-CONV-0001](conversations/ENG-CONV-0001_PART_8_MULTI_AI_ENGINEERING_CONVERSATION_INTEGRATION_DESIGN_AND_IMPLEMENTATION.md) | None — see the conversation's own Scope |
| [ENG-CONV-0002](conversations/ENG-CONV-0002_WINDOWS_NAS_EVENT_MANAGEMENT_RELIABILITY_INVESTIGATION_BUG_011_014_CHATGPT_SIDE_.md) | AI-FEAT-005, AI-FEAT-009, AI-FEAT-010, AI-FEAT-022, AI-FEAT-029, AI-FEAT-039 |
| [ENG-CONV-0003](conversations/ENG-CONV-0003_WINDOWS_NAS_EVENT_MANAGEMENT_FAILURE_INVESTIGATION_ROOT_CAUSE_VERIFICATION_AND_R.md) | AI-FEAT-005, AI-FEAT-009, AI-FEAT-010, AI-FEAT-022, AI-FEAT-029, AI-FEAT-031, AI-FEAT-039, AI-FEAT-042, AI-FEAT-054 |
| [ENG-CONV-0004](conversations/ENG-CONV-0004_PART_9_MULTI_CHANNEL_RELEASE_UPDATE_SYSTEM_DESIGN_AND_IMPLEMENTATION.md) | AI-FEAT-005, AI-FEAT-006, AI-FEAT-008, AI-FEAT-057 |
<!-- GENERATED:END feature-conversation -->

An Engineering Conversation is historical evidence, same authority tier as a Memory Capsule — see [18_ENGINEERING_CONVERSATION_POLICY.md](18_ENGINEERING_CONVERSATION_POLICY.md) § 3. Unlike Memory Capsules, Part 8 deliberately does **not** auto-cross-link a conversation into its cited feature file's Engineering Evolution section in this pass (a documented, deferred decision — see the pilot conversation's own Discussion Evolution and Engineering Decisions sections) to avoid flooding those sections given a conversation corpus may grow faster than a memory-capsule corpus; this table is the current substitute. The machine-generated equivalent is [generated/CONVERSATION_INDEX.md](generated/CONVERSATION_INDEX.md).

## Coverage Summary

- 20/56 features have at least one related bug record.
- 19/56 features have at least one related decision record.
- 7/56 features have a related postmortem, across 2 postmortem records (`PM-001` cites 6 features; `PM-002`, added since this census was last updated by hand, cites 1 — see the generated Feature→Postmortem table above; CHANGED 2026-08-14, Part 2 Decision 5 — a real drift this pass's hybrid conversion surfaced, not a new postmortem written by this pass).
- 32/56 features are placed in the architectural-evolution relationship map.
- 15/15 decisions checked for decision-to-decision references; 4 have at least one.
- 10/10 bugs checked for bug-to-decision references; 7 have at least one.
- 4 Memory Capsules recorded (`AI-MEM-0001`–`AI-MEM-0004`, see the generated Feature→Engineering Memory table above; CHANGED 2026-08-14 — 3 capsules had accumulated since this line was last updated by hand); `AI-MEM-0001` cites 3 features, `AI-MEM-0002`/`AI-MEM-0003` cite none (documentation-system infrastructure/reliability-investigation work), `AI-MEM-0004` cites 3 features.
- 4 Engineering Conversations recorded (`ENG-CONV-0001`–`ENG-CONV-0004`, see the generated Feature→Engineering Conversation table above; CHANGED 2026-08-14 — 3 conversations had accumulated since this line was last updated by hand), citing 12 distinct AutoIngest features between them.

This is a coverage census, not a completeness requirement — a feature with zero related bugs/decisions is not a defect; it means no reusable bug or accepted-alternative decision has been recorded for it yet. See [14_VALIDATION_SPECIFICATION.md](14_VALIDATION_SPECIFICATION.md) for what *would* count as a genuine gap (an orphan bug/decision/postmortem with no valid feature reference at all).
