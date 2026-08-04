# BUG-007 — QMZ Metadata Context-Shape Mismatch Silently Drops Keywords/Hijri Date

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-029, AI-FEAT-047, AI-FEAT-033 |
| Status | Fixed |
| Severity | High |
| Discovered | Evidence pending exact discovery date — fixed 2026-08-02 |
| Fixed | 2026-08-02 |
| Evidence status | Verified from Git history (commit `7372239`) and `docs/metadata-system.md` (§ Metadata Audit, "the original root-cause bug this entire system was built to fix") |

## Symptom

Files routed through QMZ (Qadam/Majlis/Ziyafat sequencing), at both its metadata entry points — the post-import button and the Event List "Sort QMZ Photos" action — had their **Hijri date and keyword fields silently dropped** from written metadata. No error was surfaced to the operator; affected files simply lacked fields that Standard Import's equivalent files had. This is documented directly in `docs/metadata-system.md` as "the original root-cause bug this entire [metadata] system was built to fix."

## Root Cause

Before the metadata engine was centralized, QMZ's two entry points constructed their own metadata context object independently of Standard Import's path. That context object did not match the shape the metadata-writing logic of the time expected — a **context-shape mismatch** — so fields that depended on the missing/misshapen context (keywords derived from component type/location/city/country, and the Hijri date) were silently omitted from the tag map handed to ExifTool, rather than causing a visible failure.

## Investigation Log

- Root cause and fix are both documented in the single commit that resolved it — no separate discovery-then-fix timeline is evidenced in Git history. `docs/metadata-system.md` independently confirms the bug's existence and its resolution: "the original root-cause bug this entire system was built to fix (QMZ silently dropping keywords/Hijri date due to a context-shape mismatch) has been proven fixed end-to-end through the real UI... Creator, Copyright, keywords, location/city/country, and Hijri date all confirmed correct via real ExifTool read-back, with sequence codes confirmed absent from keywords."

## Fix

Commit `7372239` (2026-08-02) — "feat(metadata): centralize expectations and verified metadata writes." Introduced the single pure resolver for metadata expectations (`services/metadataExpectationService.js`) and reduced `main/exifService.js` to the one sanctioned write engine (`Expected → Write → Read Back → Compare → Result`). "Fixes the original QMZ context-shape bug at both entry points (post-import button and Event List 'Sort QMZ Photos') so Hijri date and keywords are no longer silently dropped" (commit message). Every metadata writer — Standard Import, both QMZ entry points, Reapply, crash-recovery resume, and Repair — now consumes the same resolver and the same write engine; no workflow implements its own write call. This fix is also the direct evidence base for [DEC-007 — Metadata Uses One Shared Engine/Resolver](../decisions/DEC-007_SHARED_METADATA_ENGINE_RESOLVER.md).

## Prevention / Reusable Lesson

Any workflow that needs to feed a shared engine (metadata writing, or any similar cross-cutting service) must consume that engine's canonical input contract, not construct its own parallel context object — a shape mismatch between a caller's ad hoc context and the engine's expectations can silently drop fields rather than error, because "field absent" and "field not requested" look identical from inside the engine. When a specialized workflow (like QMZ, see [DEC-011](../decisions/DEC-011_QMZ_DEDICATED_DOMAIN_WORKFLOW.md)) is given its own domain model, its integration points with shared infrastructure (here, the metadata engine) still need to go through the same single, versioned resolver as every other caller — a dedicated domain model is not license to also fork the metadata contract.

## Related

- [AI-FEAT-029 — Metadata Writing Engine](../features/AI-FEAT-029_METADATA_WRITING_ENGINE.md)
- [AI-FEAT-047 — QMZ Sequencing Workspace](../features/AI-FEAT-047_QMZ_SEQUENCING_WORKSPACE.md)
- [AI-FEAT-033 — Metadata Audit & Repair](../features/AI-FEAT-033_METADATA_AUDIT_REPAIR.md)
- [DEC-007 — Metadata Uses One Shared Engine/Resolver](../decisions/DEC-007_SHARED_METADATA_ENGINE_RESOLVER.md)
- [PM-001 — Metadata Correctness Gap Found in Production-Readiness Review](../postmortems/PM-001_METADATA_CORRECTNESS_GAP_PRODUCTION_READINESS_REVIEW.md)
- [BUG-008 — lastMetadataRun Never Written Due to EISDIR Silent Failure](BUG-008_LASTMETADATARUN_EISDIR_SILENT_FAILURE.md) (related "metadata status not reflecting reality" class of bug)
