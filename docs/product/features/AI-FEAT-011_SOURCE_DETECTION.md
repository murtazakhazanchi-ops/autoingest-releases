# AI-FEAT-011 — Source Detection (Drives, DCIM, Sony PRIVATE)

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-011 |
| Category | Source Acquisition |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | None |
| Related roadmap milestone | None |
| Related technical docs | `docs/architecture.md` § Drive Detection |
| Evidence status | Verified from current code |
| First-known implementation | Evidence pending |
| Latest major update | Evidence pending |

## Summary

Detects connected storage devices eligible for import: polls for drives, filters by DCIM presence, and recognizes Sony camera folder conventions (PRIVATE/M4ROOT/CLIP for photos, PRIVATE/AVCHD/BDMV/STREAM for video). This is the backend detection layer consumed by Source Selection (AI-FEAT-012) — detection and selection are deliberately kept as separate registry entries because detection is genuinely distinct backend infrastructure (device polling, filesystem heuristics), while selection is a thin UI layer over the same underlying `activeSource` state regardless of source type.

## Current Behavior

`main/driveDetector.js` uses `drivelist`, polls every 5 seconds, filters by DCIM presence. IPC: `drives:get` / `drives:updated` / `drives:allUpdated`. `main/fileBrowser.js`'s `scanPrivateFolder()` (lines 376-410) checks exactly two known Sony subdirectory shapes — `PRIVATE/M4ROOT/CLIP` and `PRIVATE/AVCHD/BDMV/STREAM` — never recurses the full `PRIVATE` tree, filters junk files, applies a >500KB size floor, and tags results `source: 'private'`. A code comment in `main/main.js:406` notes this "naturally covers Sony PRIVATE/M4ROOT/CLIP, AVCHD/STREAM, any user-created subdirs."

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

No dated entries found in this pass. Sony PRIVATE folder support is referenced in current renderer UI copy (`renderer/renderer.js:11551`) but not dated.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `main/driveDetector.js`
- `main/fileBrowser.js` (`scanPrivateFolder`)
