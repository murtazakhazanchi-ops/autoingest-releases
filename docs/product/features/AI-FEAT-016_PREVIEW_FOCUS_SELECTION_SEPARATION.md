# AI-FEAT-016 — Preview Focus / Selection Separation

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-016 |
| Category | Media Browsing |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | None |
| Related roadmap milestone | None |
| Related technical docs | `docs/ui-system.md` § Selection System, `docs/features.md` #13 |
| Evidence status | Verified from docs |
| First-known implementation | v0.8.1 |
| Latest major update | v0.8.1 |

## Summary

Two deliberately separate concepts that must never be conflated: import selection (`selectedFiles: Set`, controlled by Cmd/Ctrl-click, Shift-click, checkboxes) and preview focus (`lastClickedPath`, set by any click or arrow-key navigation, used only to open the preview overlay). A normal click sets preview focus only — it does not select a file for import.

## Current Behavior

`lastClickedPath` (preview focus) and `_selectionAnchor` (shift-range anchor) are independent variables. Cmd/Ctrl+D deselects all import selection while preserving preview focus. Arrow keys move preview focus through rendered order when the preview is closed. Visual indicator: `.pv-focused` CSS class (see AI-FEAT-008 § file tile visual states) — never implies import selection, and `.selected` never implies preview focus; both can coexist on the same tile.

## Original Plan / Intent

Introduced in v0.8.1 (`docs/history.md`).

## Evolution / Implementation Journal

- **v0.8.1** — `.pv-focused` preview focus ring (three visual states: primary/secondary/combined); O(1) `_setPreviewFocus` helper swaps CSS class via `tileMap` instead of DOM query; `_selectionAnchor`/`_prevFocusPath` module-level state added; keyboard arrow navigation added.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `renderer/renderer.js` (`_setPreviewFocus`, `lastClickedPath`, `_selectionAnchor`)
