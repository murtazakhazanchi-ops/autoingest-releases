# DEC-007 — Metadata Uses One Shared Engine/Resolver

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-029, AI-RM-001 |
| Status | Accepted |
| Date | 2026-08-02 (commit `7372239`) |
| Evidence status | Verified from Git history (commit `7372239`) and code (`docs/metadata-system.md` § The Shared Write Engine) |

## Context

Before this decision, QMZ's two metadata entry points constructed their own metadata context independently of Standard Import's path, and that divergence produced a real, silent defect: a context-shape mismatch that dropped keywords and Hijri date from QMZ-routed files without any visible error (see [BUG-007](../bugs/BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md)). Multiple current and future workflows (Standard Import, QMZ, Reapply, crash-recovery resume, Repair, and eventually Transfer Import verification) all need to answer the same question — "what metadata should this file have, and has it been written correctly" — and letting each answer it independently is exactly what produced the defect.

## Options Considered

1. **Each workflow computes and writes its own metadata expectations independently** — the pre-existing state that produced the QMZ context-shape bug. Rejected: directly evidenced as the cause of a real, silent, archive-wide metadata-correctness defect.
2. **A single shared resolver and a single shared write engine, consumed by every workflow** — the option that was built.

## Decision

`services/metadataExpectationService.js` is the only place "what metadata should this file have" is computed — the resolver, versioned (`METADATA_CONTRACT_VERSION`, `RESOLVER_VERSION`) so future field/logic changes are traceable in every durable record that carries these versions. `main/exifService.js` is the only code path allowed to call an ExifTool write operation — every writer (Standard Import, both QMZ entry points, Reapply, crash-recovery resume, and Repair) is a consumer of this one engine. The engine's shape is always `Expected → Write → Read Back → Compare → Result`: a write is never marked successful merely because the ExifTool process launched (`docs/metadata-system.md` § The Shared Write Engine).

## Consequences

- Any new metadata-writing workflow added in the future (e.g. a hypothetical new import path) must consume the shared resolver and shared write engine — implementing an independent write call would reintroduce the exact class of bug this decision closed.
- The `METADATA_CONTRACT_VERSION`/`RESOLVER_VERSION` versioning commits future field changes to being traceable across every durable record (queue manifests, audit reports, repair results) — a field change that doesn't bump these versions where warranted breaks that traceability guarantee.
- A separate, real interim risk remains: six independent places in the codebase must still agree on the metadata field set (the resolver, the tag builder, the read-back comparator, the resume staleness comparator, the audit's field-diff classifier, and the audit CSV export's column list) — nothing *structurally* enforces this yet beyond a defensive test (`test/fieldSpecsConsistency.test.js`); consolidating into one shared field-specification table is a documented follow-up, not yet done (`docs/metadata-system.md` § Field Consistency Across Stages, § Non-Goals).

## Reconciliation Note

None recorded — matches `docs/metadata-system.md`'s current § The Shared Write Engine exactly.
