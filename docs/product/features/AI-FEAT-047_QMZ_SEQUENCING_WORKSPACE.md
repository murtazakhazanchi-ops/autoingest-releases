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

## Summary

**QMZ = Qadam / Majlis / Ziyafat** — a standalone sequencing workspace distinct from standard Event Import, with its own root (`qmzRoot`), durable state file (`qmz-sequences.json`), namespaced renderer state/UI (`_qmz*` prefix throughout — explicitly documented in code comments as never touching Import's `sortKey`/`viewMode`), and its own IPC surface.

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

## Known Bugs / Troubleshooting

The metadata-system.md's live-verified regression test explicitly calls out that QMZ was originally affected by "the original root-cause bug this entire [metadata] system was built to fix" (silently dropping keywords/Hijri date due to a context-shape mismatch) — now proven fixed end-to-end through the real UI. Not yet backfilled as a dedicated `docs/product/bugs/` entry.

## Decisions

None recorded.

## Future Enhancements

`docs/metadata-system.md` § Non-Goals notes: "the primary QMZ flow (assign → auto-queue metadata) has been verified live through the real UI; less common paths through the QMZ Sequence Manager have not each been individually driven live" — an open verification gap, not a known bug.

## Related Files

- `main/qmzService.js`
- `renderer/renderer.js` (`_qmz*`-prefixed section)
- `test/qmzLiveE2E.test.js`
