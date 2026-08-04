# AI-FEAT-029 — Metadata Writing Engine

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-029 |
| Category | Metadata |
| Status | Implemented |
| Maturity | Foundational |
| Parent feature | None |
| Subfeatures | AI-FEAT-030, AI-FEAT-031, AI-FEAT-032, AI-FEAT-033, AI-FEAT-037 all depend on this |
| Dependencies | AI-FEAT-004 (writes into event.json's `metadataState` block via `updateEventJsonAtomic`) |
| Related roadmap milestone | AI-RM-001 |
| Related technical docs | `docs/metadata-system.md` (primary source for this entire category) |
| Evidence status | Verified from docs (already fully read as required context, full detail) |
| First-known implementation | Evidence pending overall; hardened extensively 2026-05-05 through 2026-06-22 (learning-log) |
| Latest major update | 2026-06-22 (Phantom RAW Extension Support) |

## Summary

The single shared engine and resolver that every metadata writer in the app consumes — Standard Import, QMZ, Reapply, crash-recovery resume, and Repair are all consumers of one code path, never independent write implementations. Covers JPEG/TIFF direct write, RAW XMP sidecar write, and video exclusion as one unified engine, not three separate systems.

## Current Behavior

Import first, metadata second — copy failures never block on metadata; metadata failures never block or roll back a copy. `main/exifService.js` is the only code path allowed to call an ExifTool write operation; shape is always `Expected → Write → Read Back → Compare → Result` — a write is never marked successful merely because the ExifTool process launched. `services/metadataExpectationService.js` is the only place "what metadata should this file have" is computed (versioned via `METADATA_CONTRACT_VERSION`/`RESOLVER_VERSION`). Fields owned: Photographer/Creator, Copyright (fixed `© Aljamea-tus-Saifiyah`), Keywords (component-derived, deduplicated case-insensitively), Location/City/Country, Hijri date, Description/Caption (event name only). Never written: `DateTimeOriginal`/`CreateDate`/`ModifyDate` or any capture-date field — enforced by construction. RAW → XMP sidecar (created fresh or merged in place, never deleted/recreated); JPEG/TIFF → direct tag write; video → excluded entirely, never a failure.

## Original Plan / Intent

Evidence pending — not yet documented as fact. The engine's versioning scheme (`METADATA_CONTRACT_VERSION`, `RESOLVER_VERSION`) implies deliberate design for future field/logic evolution from the outset.

## Evolution / Implementation Journal

- **2026-05-05** — "ExifService: Metadata Write Failures, Boolean Encoding, XMP vs IPTC Sidecar Fix" (learning-log).
- **2026-05-09** — "Metadata Architecture Refactor (8 Parts, commit fa30cbb)" (learning-log) — a major refactor consolidating the engine's current shape.
- **2026-05-09** — "JPEG Metadata Support, Preview Enrichment, and Row Interaction Patterns" (learning-log).
- **2026-06-22** — "Phantom RAW Extension Support in Metadata/EXIF Services" (learning-log) — most recent dated change found.
- **Field Consistency guardrail**: six independent codebase locations must agree on the field set (resolver, tag builder, read-back comparator, resume staleness comparator, audit's field-diff classifier, audit CSV export's column list); `test/fieldSpecsConsistency.test.js` behaviorally verifies all six against the resolver's real output. Not a structural fix — a documented follow-up (consolidating into one shared `FIELD_SPECS` table) remains open.

## Known Bugs / Troubleshooting

See the 2026-05-05 learning-log entry for narrative detail on the boolean-encoding and XMP/IPTC sidecar bugs found and fixed at that time. The engine's current shared-engine/resolver architecture (as opposed to earlier per-workflow write logic) is the direct fix for [BUG-007 — QMZ Metadata Context-Shape Mismatch](../bugs/BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md); the durable queue it depends on fixes [BUG-010 — Metadata Batches Held Only In-Memory](../bugs/BUG-010_METADATA_QUEUE_IN_MEMORY_LOSS_ON_CRASH.md); its `lastMetadataRun` persistence path was the site of [BUG-008 — lastMetadataRun EISDIR Silent Failure](../bugs/BUG-008_LASTMETADATARUN_EISDIR_SILENT_FAILURE.md); and its verification path fixes [BUG-009 — Same-Size Skip Left Metadata Unverified](../bugs/BUG-009_SAME_SIZE_SKIP_METADATA_UNVERIFIED.md). See [PM-001](../postmortems/PM-001_METADATA_CORRECTNESS_GAP_PRODUCTION_READINESS_REVIEW.md) for the combined remediation narrative.

## Decisions

See [DEC-006 — RAW Files Use XMP Sidecars](../decisions/DEC-006_RAW_FILES_USE_XMP_SIDECARS.md) and [DEC-007 — Metadata Uses One Shared Engine/Resolver](../decisions/DEC-007_SHARED_METADATA_ENGINE_RESOLVER.md).

## Future Enhancements

- **Gregorian date** field is deliberately deferred — no authoritative conversion utility or source field exists yet (`docs/metadata-system.md` § Non-Goals).
- **Field-consistency structural fix** (`FIELD_SPECS`-style shared table) — currently only a defensive test exists; consolidating the six sites into one shared table is documented as a real, open follow-up.

## Related Files

- `main/exifService.js` (the shared write engine)
- `services/metadataExpectationService.js` (the resolver)
- `main/eventJsonStore.js` (persistence)
