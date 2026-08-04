# AI-FEAT-013 — File Browser & Media Grid/List Viewing

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-013 |
| Category | Media Browsing |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | Grid/list view toggle (folded in — not independently durable, per Fork A verdict) |
| Dependencies | AI-FEAT-017 (reflects GroupManager state) |
| Related roadmap milestone | None |
| Related technical docs | `docs/ui-system.md` § File Panel, `docs/features.md` #2 |
| Evidence status | Verified from current code and docs |
| First-known implementation | v0.6.0 ("File Handling & UI" — folder view, recursive scanner, UI improvements) |
| Latest major update | v0.5.7 (large-source performance work, see Evolution) |

## Summary

Allows selection of files and folders for ingestion; presents them as grouped sections (RAW / Images / Video) in either grid or list view, with selection controls, always reflecting grouping and state from `GroupManager` (AI-FEAT-017).

## Current Behavior

Per `docs/ui-system.md` § File Panel: Grid/List view, grouped sections (RAW/Images/Video), selection controls. Grid/list is a view-mode toggle within this feature, not an independently durable capability (per research-pass verdict — folded in rather than given its own registry entry).

## Original Plan / Intent

Introduced/expanded in v0.6.0 "File Handling & UI" (`docs/history.md`), noted at the time as increasing filesystem complexity with potential performance bottlenecks.

## Evolution / Implementation Journal

- **v0.6.0** — folder view, recursive scanner, UI improvements.
- **2026-05-07** — "Large External Drive and Local Folder Source Entry Performance" and "Non-Recursive Folder Navigation for External Drive and Local Folder" (learning-log) — performance hardening for large sources.
- **2026-05-07** — "View-Mode State Sync: Media↔Folder Toggle and Folder-Click in Media View" (learning-log).

## Known Bugs / Troubleshooting

None recorded in `docs/product/bugs/` yet.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `main/fileBrowser.js`
