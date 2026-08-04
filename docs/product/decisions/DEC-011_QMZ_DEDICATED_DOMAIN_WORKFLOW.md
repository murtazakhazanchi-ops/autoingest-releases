# DEC-011 — QMZ Requires a Dedicated Domain Workflow

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-047 |
| Status | Accepted |
| Date | 2026-07-02 (commit `b56f6ba`, initial QMZ Sequence Manager) through 2026-07-03 (commit `a2e3b7a`, full workspace conversion) |
| Evidence status | Verified from code (`main/qmzService.js`, `renderer/renderer.js` `_qmz*`-prefixed section) and docs (`docs/product/features/AI-FEAT-047_QMZ_SEQUENCING_WORKSPACE.md`) |

## Context

Not every archival event fits the generic single/multi-component Event Import model. QMZ (Qadam/Majlis/Ziyafat) events need explicit sequence modeling (numbered `01Q`/`02M`-style codes with type-specific maximums), sequence-folder conventions, and unsequenced-folder adoption into a reserved bucket — needs that don't map cleanly onto generic grouping/sub-event logic.

## Options Considered

Git history shows QMZ grew incrementally from a simple manager (`b56f6ba` — "add QMZ Sequence Manager and event-list entry point") into a full workspace (`a2e3b7a` — "convert QMZ Sequence Manager to a full workspace with sequence review, timeline, and event context"), implying the scope grew, but no commit or doc evidences a considered-and-rejected "force QMZ into the generic grouping model" alternative. Full alternatives-considered detail: **Evidence pending** beyond the incremental growth pattern itself.

1. **Force QMZ's sequencing needs into the existing generic Event Import/grouping model** — not evidenced as having been attempted or seriously considered.
2. **A standalone domain workflow with its own root, state, IPC surface, and renderer namespace** — the option that was built.

## Decision

QMZ is a standalone sequencing workspace, distinct from standard Event Import: its own root (`qmzRoot`), its own durable state file (`qmz-sequences.json`), its own namespaced renderer state/UI (`_qmz*` prefix throughout — explicitly documented in code comments as never touching Import's `sortKey`/`viewMode`), and its own IPC surface. Sequence creation/assignment, unsequenced-folder adoption (into a reserved `_Unsequenced/<photographerName>/` bucket — distinct from AI-FEAT-046's archive-wide Folder Adoption), and shortcuts/preview navigation are all QMZ-specific implementations, not reuses of Import's equivalents.

## Consequences

- QMZ's integration points with shared infrastructure (the metadata engine) must still go through the same shared resolver/write engine as every other workflow — a dedicated domain model is not license to also fork shared-infrastructure contracts. This boundary was learned the hard way: QMZ's early independent metadata context construction caused a real, silent metadata-loss bug (see [BUG-007](../bugs/BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md)).
- Future specialized workflows that don't fit the generic model should be evaluated against this same precedent — give them a real, separate domain model rather than overloading the generic one, per `docs/product/11_ARCHITECTURAL_EVOLUTION.md` §4's "special workflows require explicit domain models" lesson.
- QMZ's unsequenced-folder adoption and AI-FEAT-046's archive-wide Folder Adoption must be kept conceptually and terminologically distinct in any future documentation or UI — conflating them would misrepresent what each actually does.

## Reconciliation Note

None recorded — matches `docs/product/features/AI-FEAT-047_QMZ_SEQUENCING_WORKSPACE.md` and `docs/metadata-system.md` § Import Path Coverage exactly.
