# Dependency Intelligence

Canonical, evidence-based relationship model connecting every record type in `docs/product/`. This document does not restate any record's own content — it is a navigational index over relationships already documented (in header tables, `Known Bugs`/`Decisions` sections, `Related` sections, and the architectural-evolution relationship map) elsewhere in this system. If this document and an individual record ever disagree, the individual record wins — regenerate this index rather than editing around the discrepancy.

**Relationship to `docs/product/generated/dependency-graph.*` (Part 4)**: this document is the curated, hand-authored ID-relationship narrative — it groups relationships the way a person would read them (Milestone→Features, Decision→Decision, etc.). `generated/dependency-graph.json`/`.md` is a separate, mechanically-derived, code-level view built by `scripts/product-docs/` from the same underlying evidence (feature files' header tables and Lifecycle Metadata sections) plus the subsystem locator's source-file mapping, with bounded per-subsystem Mermaid diagrams. Neither supersedes the other: this document is better for understanding *why* records relate; the generated graph is better for machine queries, impact analysis, and subsystem-scoped diagrams. Both trace back to the same canonical records, so a disagreement between them means one needs to be regenerated/corrected against those records — not that either is independently authoritative over the other.

**Relationship to Part 5's automated forward-linking**: `scripts/product-docs/automation/canonicalUpdater.js` can append a forward link from a feature file into `Known Bugs / Troubleshooting`/`Decisions` when a bug/decision record is created for it during `automation finalize` — but only for a link already evidenced by the classifier's citations (never a new relationship it invented). It never edits this document directly; this index is still regenerated (`node scripts/product-docs/cli.js build`), never hand-maintained, whether the underlying forward link was added by a human or by Part 5.

## Methodology

Every edge below is one of:
- A value already present in a record's own header table or `Related`/`Known Bugs`/`Decisions` section (a **forward** link), or
- A record's own header table naming *this* record as related (a **reverse** lookup — e.g. a decision's `Related feature(s)` field naming a feature that doesn't yet link back).

No relationship here is inferred from naming similarity, folder proximity, or assumption. Reverse-only edges (found by lookup, not yet cross-linked at the source) are marked *(reverse)* below — consider adding the forward link at the source when next editing that record, per [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md).

Per-feature relationship detail (Feature→Feature, Feature→Decision, Feature→Bug, Feature→Postmortem, Feature→Architecture) lives in each feature file's own **Lifecycle Metadata** section (added in this same pass) — this document aggregates that detail into cross-cutting tables for the relationship types that are hard to see from any single record: Decision→Decision, Bug→Decision, Bug→Bug, Milestone→Features, and Architecture→Features/Decisions.

## Milestone → Features

Source: `02_MASTER_ROADMAP.md`'s `Included AI-FEAT IDs` and `Existing features extended` fields per milestone.

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
| **AI-RM-010** — Multi-Channel Release & Update System (parallel track, not part of the AI-RM-001…009 sequence above) | **Completed** — verified on real Windows hardware | [AI-FEAT-057](features/AI-FEAT-057_MULTI_CHANNEL_RELEASE_UPDATE_SYSTEM.md) | [AI-FEAT-006](features/AI-FEAT-006_APPLICATION_AUTO_UPDATE.md), [AI-FEAT-005](features/AI-FEAT-005_APPLICATION_SETTINGS_CONFIGURATION_STORE.md) |

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

| Postmortem | Related features |
|---|---|
| [PM-001](postmortems/PM-001_METADATA_CORRECTNESS_GAP_PRODUCTION_READINESS_REVIEW.md) | [AI-FEAT-029](features/AI-FEAT-029_METADATA_WRITING_ENGINE.md), [AI-FEAT-030](features/AI-FEAT-030_METADATA_DURABLE_QUEUE_CRASH_RECOVERY.md), [AI-FEAT-031](features/AI-FEAT-031_METADATA_EVENT_STATE_DERIVATION.md), [AI-FEAT-032](features/AI-FEAT-032_METADATA_VERIFICATION.md), [AI-FEAT-033](features/AI-FEAT-033_METADATA_AUDIT_REPAIR.md), [AI-FEAT-047](features/AI-FEAT-047_QMZ_SEQUENCING_WORKSPACE.md) |

## Feature → Engineering Memory (Part 6)

| Memory Capsule | Related features | Related bugs/decisions |
|---|---|---|
| [AI-MEM-0001](memory/AI-MEM-0001_METADATA_MANAGEMENT_MODAL_AUDIT_REPAIR_EVOLUTION.md) | [AI-FEAT-008](features/AI-FEAT-008_DESIGN_SYSTEM_UI_CONSISTENCY_FRAMEWORK.md), [AI-FEAT-033](features/AI-FEAT-033_METADATA_AUDIT_REPAIR.md), [AI-FEAT-034](features/AI-FEAT-034_METADATA_MANAGEMENT_MODAL.md) | None recorded — see the capsule's own Scope table |

A Memory Capsule is historical evidence explaining *why* the cited feature(s) evolved the way they did — it carries no authority of its own and never supersedes the feature file it's linked from; see [16_ENGINEERING_MEMORY_POLICY.md](16_ENGINEERING_MEMORY_POLICY.md) § 3. This table, like every other one on this page, is a curated index over relationships already recorded at the source (each feature file's own Engineering Evolution section cross-links its capsule(s) directly); the machine-generated equivalent is [generated/MEMORY_INDEX.md](generated/MEMORY_INDEX.md).

## Feature → Engineering Conversation (Part 8)

| Conversation | Related features |
|---|---|
| [ENG-CONV-0001](conversations/ENG-CONV-0001_PART_8_MULTI_AI_ENGINEERING_CONVERSATION_INTEGRATION_DESIGN_AND_IMPLEMENTATION.md) | None — the pilot conversation documents this documentation-system infrastructure work itself, not an AutoIngest application feature |

An Engineering Conversation is historical evidence, same authority tier as a Memory Capsule — see [18_ENGINEERING_CONVERSATION_POLICY.md](18_ENGINEERING_CONVERSATION_POLICY.md) § 3. Unlike Memory Capsules, Part 8 deliberately does **not** auto-cross-link a conversation into its cited feature file's Engineering Evolution section in this pass (a documented, deferred decision — see the pilot conversation's own Discussion Evolution and Engineering Decisions sections) to avoid flooding those sections given a conversation corpus may grow faster than a memory-capsule corpus; this table is the current substitute. The machine-generated equivalent is [generated/CONVERSATION_INDEX.md](generated/CONVERSATION_INDEX.md).

## Coverage Summary

- 20/56 features have at least one related bug record.
- 19/56 features have at least one related decision record.
- 6/56 features have a related postmortem.
- 32/56 features are placed in the architectural-evolution relationship map.
- 15/15 decisions checked for decision-to-decision references; 4 have at least one.
- 10/10 bugs checked for bug-to-decision references; 7 have at least one.
- 2 Memory Capsules recorded (`AI-MEM-0001`, `AI-MEM-0002`); `AI-MEM-0001` cites 3 features, `AI-MEM-0002` cites none (documentation-system infrastructure work).
- 1 Engineering Conversation recorded (`ENG-CONV-0001`), citing no AutoIngest features.

This is a coverage census, not a completeness requirement — a feature with zero related bugs/decisions is not a defect; it means no reusable bug or accepted-alternative decision has been recorded for it yet. See [14_VALIDATION_SPECIFICATION.md](14_VALIDATION_SPECIFICATION.md) for what *would* count as a genuine gap (an orphan bug/decision/postmortem with no valid feature reference at all).
