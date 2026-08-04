# Decisions — Accepted and Rejected Product/Architecture Decisions

Each file here is a decision record: `DEC-###_NAME.md`, following [../08_DECISION_TEMPLATE.md](../08_DECISION_TEMPLATE.md).

Use this when a real alternative was considered and one was chosen — not for routine implementation choices with no meaningful tradeoff. Rejected and superseded decisions stay here, marked as such; they are not deleted. See [../05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the authority boundary: a decision recorded here can never override an authoritative technical doc under `docs/` — if they conflict, the technical doc wins and the reconciliation is recorded here.

## Index

| ID | Title | Status | Affected features |
|---|---|---|---|
| [DEC-001](DEC-001_EVENT_DATA_AS_DURABLE_ARCHIVE_TRUTH.md) | Event Data as Durable Archive Truth | Accepted | AI-FEAT-004 |
| [DEC-002](DEC-002_FOLDER_STRUCTURE_PLUS_EMBEDDED_METADATA.md) | Folder Structure Plus Embedded Metadata | Accepted | AI-FEAT-004, AI-FEAT-018, AI-FEAT-029 |
| [DEC-003](DEC-003_LOCAL_FIRST_ON_PREMISES_ARCHITECTURE.md) | Local-First and On-Premises Architecture | Accepted | AI-FEAT-042, AI-FEAT-044 |
| [DEC-004](DEC-004_PRESERVE_BRIDGE_BASED_ARCHIVAL_PRACTICE.md) | Preserve Established Bridge-Based Archival Practice | Accepted | AI-FEAT-029, AI-FEAT-036 |
| [DEC-005](DEC-005_ORIGINAL_PRESERVATION_NON_DESTRUCTIVE_INGEST.md) | Original Preservation and Non-Destructive Ingest | Accepted | AI-FEAT-019, AI-FEAT-020, AI-FEAT-024, AI-FEAT-025 |
| [DEC-006](DEC-006_RAW_FILES_USE_XMP_SIDECARS.md) | RAW Files Use XMP Sidecars | Accepted | AI-FEAT-029 |
| [DEC-007](DEC-007_SHARED_METADATA_ENGINE_RESOLVER.md) | Metadata Uses One Shared Engine/Resolver | Accepted | AI-FEAT-029, AI-RM-001 |
| [DEC-008](DEC-008_DURABLE_METADATA_SURVIVES_RESTART.md) | Durable Metadata Work Survives Restart | Accepted | AI-FEAT-030, AI-RM-001 |
| [DEC-009](DEC-009_COPY_IDEMPOTENCY_MUST_NOT_SUPPRESS_METADATA_REPAIR.md) | Copy Idempotency Must Not Suppress Metadata Repair | Accepted | AI-FEAT-019, AI-FEAT-032 |
| [DEC-010](DEC-010_TRANSFER_UPDATE_MISSING_FILES_ONLY.md) | Transfer Update Is Missing-Files-Only | Accepted | AI-FEAT-040 |
| [DEC-011](DEC-011_QMZ_DEDICATED_DOMAIN_WORKFLOW.md) | QMZ Requires a Dedicated Domain Workflow | Accepted | AI-FEAT-047 |
| [DEC-012](DEC-012_ARCHIVE_ROOT_RESOLUTION_REQUIRES_EVIDENCE.md) | Archive Root Resolution Requires Evidence | Accepted | AI-FEAT-042, AI-FEAT-039 |
| [DEC-013](DEC-013_LOCK_CLEARING_MUST_BE_CONSTRAINED.md) | Lock Clearing Must Be Constrained | Accepted | AI-FEAT-045 |
| [DEC-014](DEC-014_CONTROLLED_KEYWORD_REGISTRY.md) | Controlled Keyword Registry | Accepted | AI-FEAT-036 |
| [DEC-015](DEC-015_PLANNED_ARCHITECTURE_SEPARATE_FROM_IMPLEMENTED.md) | Planned Architecture Remains Separate From Implemented Behaviour | Accepted | AI-FEAT-049–056, AI-RM-002–009 |
