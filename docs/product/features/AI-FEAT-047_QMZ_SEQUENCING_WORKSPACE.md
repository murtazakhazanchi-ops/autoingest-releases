# AI-FEAT-047 — QMZ Sequencing Workspace

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-047 |
| Category | Special Workflows |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | Sequence creation/assignment, unsequenced-folder adoption, shortcuts/previews — all folded into this single entry (own root/state/IPC/renderer namespace, not independently durable as separate registry rows) |
| Dependencies | AI-FEAT-029 (queues metadata via the shared engine) |
| Related roadmap milestone | None |
| Related technical docs | `docs/metadata-system.md` § Import Path Coverage (QMZ row) |
| Evidence status | Verified from current code (`main/qmzService.js` full header + export list read) and `test/qmzLiveE2E.test.js` |
| First-known implementation | Evidence pending |
| Latest major update | Evidence pending |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | [AI-FEAT-016](AI-FEAT-016_PREVIEW_FOCUS_SELECTION_SEPARATION.md), [AI-FEAT-046](AI-FEAT-046_ARCHIVE_FOLDER_ADOPTION.md) (found via cross-reference in this file's own prose, not yet in Dependencies/Parent/Subfeatures above) |
| Related decisions | [DEC-011](../decisions/DEC-011_QMZ_DEDICATED_DOMAIN_WORKFLOW.md) |
| Related bugs | [BUG-007](../bugs/BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md) |
| Related postmortems | [PM-001](../postmortems/PM-001_METADATA_CORRECTNESS_GAP_PRODUCTION_READINESS_REVIEW.md) |
| Related architectural evolution sections | [§3F — F. Specialized Archival Workflows](../11_ARCHITECTURAL_EVOLUTION.md#f-specialized-archival-workflows) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | Referenced in 1 test file(s) (mechanical name/import match, not a coverage percentage — the test suite was not executed for this documentation pass): `test/qmzLiveE2E.test.js` |
| Documentation completeness | Partial — 3 unresolved evidence gaps in this file (see fields/sections marked "Evidence pending" above) |

## Summary

**QMZ = Qadam / Majlis / Ziyafat** — a standalone sequencing workspace distinct from standard Event Import, with its own root (`qmzRoot`), durable state file (`qmz-sequences.json`), namespaced renderer state/UI (`_qmz*` prefix throughout — explicitly documented in code comments as never touching Import's `sortKey`/`viewMode`), and its own IPC surface.

**Why this exists** (product-owner history, captured 2026-08-14 — *Known from project history; repository evidence pending* for the domain-specific rationale below, combined with [DEC-011](../decisions/DEC-011_QMZ_DEDICATED_DOMAIN_WORKFLOW.md)'s already-accepted "not every archival event fits the generic model" framing for why a dedicated workflow was warranted at all): a QMZ event can contain 10 to 50+ distinct real-world occurrences/sequences of Qadam, Majlis, or Ziyafat. Fully sequencing everything during live ingestion is counterproductive, so a photographer's material is initially ingested together and sequenced later by an archivist. Before this dedicated workspace existed, that later sequencing pass meant manually creating a sequence folder and photographer folders inside it, inspecting photographs, and moving/copy-sorting them — repeated per sequence, potentially 40+ times for a large event, using Finder, viewers, or Adobe Bridge. That repetition was tedious, mentally tiring, and therefore more prone to human error through fatigue — sequence order matters because the archive should correspond to the actual chronological occurrence order. This workspace exists to make that classification process focused, efficient, and less repetitive. The product owner explicitly noted this **remains an evolving workflow and may be improved further** — treat it as a first-generation solution, not a finished design; DEC-011 itself separately states evidence is still pending for the deeper history beyond this incremental-growth pattern.

## Current Behavior

`LETTER_TYPE = {Q: 'Qadam', M: 'Majlis', Z: 'Ziyafat'}`; `LETTER_MAX = {Q: 50, M: 51, Z: 52}` (max sequence numbers per type). Sequence codes match `/^\d{2}[QMZ]$/` (e.g. `01Q`, `02M`) — folder-naming convention only, **never** included in the keyword set at any entry point (verified live through the real UI per `docs/metadata-system.md`). Reads embedded EXIF capture date via `exifr` (photos) or ExifTool (RAW, reusing AI-FEAT-029's singleton process pool) — deliberately not filesystem mtime, which doesn't survive cross-volume copy.

**Sequence creation/assignment**: `createSequence`, `bulkCreateSequences`, `editSequenceType`, `removeSequence`, `moveFilesToSequence(qmzRoot, filePaths, sequenceCode, photographerName)`.

**Unsequenced adoption**: `initRoot(qmzRoot)` scans pre-existing folders and adopts them into a reserved `_Unsequenced/<photographerName>/` structure (`UNSEQUENCED` constant); `moveFilesToUnsequenced()` is the reverse/manual path. This is folder-content adoption into QMZ's own bucket — **unrelated to AI-FEAT-046's archive-wide Folder Adoption**, which registers whole archive folders as AutoIngest events via `event.json`.

**Shortcuts/previews**: own arrow-key grid navigation and preview-focus system, explicitly separated from AI-FEAT-016's Import equivalent — own sort controls (`_qmzSortKey`/`_qmzSortDir`), view-mode controls, tile click with shift-range select (`_qmzHandleTileClick`, `_qmzSelectionAnchor`), lazy thumbnail loading via its own queue (`_qmzThumbQueue`), own arrow-key focus targeting (`_qmzArrowFocusTarget`).

## Original Plan / Intent

Evidence pending — not yet documented as fact. Git history confirms at least two major commits: "add QMZ Sequence Manager and event-list entry point" followed by "convert QMZ Sequence Manager to a full workspace with sequence review, timeline, and event context" — implying incremental growth from a simple manager into a full workspace.

## Evolution / Implementation Journal

- Commit `b56f6ba` — "feat(qmz): add QMZ Sequence Manager and event-list entry point."
- Commit `a2e3b7a` — "feat(qmz): convert QMZ Sequence Manager to a full workspace with sequence review, timeline, and event context."
- **2026-08-14** — Purpose captured — Product-Owner Purpose Capture interview. The product owner supplied the domain-specific rationale (fatigue-driven error reduction for high-volume, multi-occurrence events) now recorded in Summary above, directly resolving the audit's explicit "do not infer QMZ's pre-feature workflow" flag, and noted this remains an evolving workflow. No code changed.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending — no independently-verified first-implementation date exists in this file's header table.

**Architectural / workflow decisions**: [DEC-011](../decisions/DEC-011_QMZ_DEDICATED_DOMAIN_WORKFLOW.md) — see the Decisions section above and each record's own "Decision"/"Consequences" fields for what changed and why.

**Reliability / correctness fixes**: [BUG-007](../bugs/BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md) — see the Known Bugs section above and each record's own "Root Cause"/"Fix" fields for what changed and why.

**Other dated milestones**: 2 entries exist in the Evolution / Implementation Journal above; not individually re-classified by milestone type here to avoid restating evidence — read that section directly for the full dated sequence.

## Known Bugs / Troubleshooting

The metadata-system.md's live-verified regression test explicitly calls out that QMZ was originally affected by "the original root-cause bug this entire [metadata] system was built to fix" (silently dropping keywords/Hijri date due to a context-shape mismatch) — now proven fixed end-to-end through the real UI. Documented as [BUG-007 — QMZ Metadata Context-Shape Mismatch Silently Drops Keywords/Hijri Date](../bugs/BUG-007_QMZ_METADATA_CONTEXT_SHAPE_MISMATCH.md); see also [PM-001](../postmortems/PM-001_METADATA_CORRECTNESS_GAP_PRODUCTION_READINESS_REVIEW.md) for the broader remediation this bug drove.

## Decisions

See [DEC-011 — QMZ Requires a Dedicated Domain Workflow](../decisions/DEC-011_QMZ_DEDICATED_DOMAIN_WORKFLOW.md).

## Future Enhancements

`docs/metadata-system.md` § Non-Goals notes: "the primary QMZ flow (assign → auto-queue metadata) has been verified live through the real UI; less common paths through the QMZ Sequence Manager have not each been individually driven live" — an open verification gap, not a known bug.

## Related Files

- `main/qmzService.js`
- `renderer/renderer.js` (`_qmz*`-prefixed section)
- `test/qmzLiveE2E.test.js`
