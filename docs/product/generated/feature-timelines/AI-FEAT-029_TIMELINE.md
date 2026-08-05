# AI-FEAT-029 — Timeline

> Generated artifact — strictly extracted/reformatted from [features/AI-FEAT-029_METADATA_WRITING_ENGINE.md](../features/AI-FEAT-029_METADATA_WRITING_ENGINE.md)'s own Evolution / Implementation Journal, header table, Known Bugs, and Decisions sections. No new facts. Regenerate with `node scripts/product-docs/cli.js build`.

**Feature**: Metadata Writing Engine

| Date | Event type | Summary | Related IDs | Confidence | Evidence source |
|---|---|---|---|---|---|
| 2026-05-05 | major bug fix | "ExifService: Metadata Write Failures, Boolean Encoding, XMP vs IPTC Sidecar Fix" (learning-log). | — | verified | features/AI-FEAT-029_METADATA_WRITING_ENGINE.md § Evolution / Implementation Journal |
| 2026-05-06 | major bug fix | BUG-008 — lastMetadataRun Never Written Due to EISDIR Silent Failure | BUG-008 | verified | bugs/BUG-008_LASTMETADATARUN_EISDIR_SILENT_FAILURE.md header table: Fixed |
| 2026-05-09 | redesign | "Metadata Architecture Refactor (8 Parts, commit fa30cbb)" (learning-log) — a major refactor consolidating the engine's current shape. | — | verified | features/AI-FEAT-029_METADATA_WRITING_ENGINE.md § Evolution / Implementation Journal |
| 2026-05-09 | other dated milestone | "JPEG Metadata Support, Preview Enrichment, and Row Interaction Patterns" (learning-log). | — | verified | features/AI-FEAT-029_METADATA_WRITING_ENGINE.md § Evolution / Implementation Journal |
| 2026-06-22 | other dated milestone | "Phantom RAW Extension Support in Metadata/EXIF Services" (learning-log) — most recent dated change found. | — | verified | features/AI-FEAT-029_METADATA_WRITING_ENGINE.md § Evolution / Implementation Journal |
| 2026-06-22 (Phantom RAW Extension Support) | other dated milestone | Latest major update recorded for Metadata Writing Engine | — | verified | features/AI-FEAT-029_METADATA_WRITING_ENGINE.md header table: Latest major update |
| 2026-08-02 | major bug fix | BUG-007 — QMZ Metadata Context-Shape Mismatch Silently Drops Keywords/Hijri Date | BUG-007 | verified | bugs/BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md header table: Fixed |
| 2026-08-02 | major bug fix | BUG-009 — Same-Size Skip Left Metadata Unverified | BUG-009 | verified | bugs/BUG-009_SAME_SIZE_SKIP_METADATA_UNVERIFIED.md header table: Fixed |
| 2026-08-02 | major bug fix | BUG-010 — Metadata Batches Held Only In-Memory, Lost on Crash/Restart | BUG-010 | verified | bugs/BUG-010_METADATA_QUEUE_IN_MEMORY_LOSS_ON_CRASH.md header table: Fixed |
| 2026-08-02 (commit `7372239`) | redesign | DEC-007 — Metadata Uses One Shared Engine/Resolver | DEC-007 | verified | decisions/DEC-007_SHARED_METADATA_ENGINE_RESOLVER.md header table: Date |
| Pre-AutoIngest origin (§3A); Bridge-import continuity point implemented by 2026-05-09 (AI-FEAT-036 first-known implementation) | redesign | DEC-004 — Preserve Established Bridge-Based Archival Practice | DEC-004 | verified | decisions/DEC-004_PRESERVE_BRIDGE_BASED_ARCHIVAL_PRACTICE.md header table: Date |
| Evidence pending | evidence pending | **Field Consistency guardrail**: six independent codebase locations must agree on the field set (resolver, tag builder, read-back comparator, resume staleness comparator, audit's field-diff classifier, audit CSV export's column list); `test/fieldSpecsConsistency.test.js` behaviorally verifies all six against the resolver's real output. Not a structural fix — a documented follow-up (consolidating into one shared `FIELD_SPECS` table) remains open. | — | undated | features/AI-FEAT-029_METADATA_WRITING_ENGINE.md § Evolution / Implementation Journal |
| Evidence pending | redesign | DEC-002 — Folder Structure Plus Embedded Metadata | DEC-002 | undated | decisions/DEC-002_FOLDER_STRUCTURE_PLUS_EMBEDDED_METADATA.md header table: Date |
| Evidence pending | redesign | DEC-006 — RAW Files Use XMP Sidecars | DEC-006 | undated | decisions/DEC-006_RAW_FILES_USE_XMP_SIDECARS.md header table: Date |

