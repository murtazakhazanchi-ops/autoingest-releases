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

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | [AI-FEAT-008](AI-FEAT-008_DESIGN_SYSTEM_UI_CONSISTENCY_FRAMEWORK.md) (found via cross-reference in this file's own prose, not yet in Dependencies/Parent/Subfeatures above) |
| Related decisions | None recorded |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | Not yet covered in 11_ARCHITECTURAL_EVOLUTION.md's relationship map |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | Evidence pending — this feature's related files are shared, multi-feature modules (e.g. `main/main.js`, `renderer/renderer.js`); automated basename matching against test/ is unreliable for these and was not attempted |
| Documentation completeness | Complete — no unresolved "Evidence pending" markers in this file |

## Summary

Two deliberately separate concepts that must never be conflated: import selection (`selectedFiles: Set`, controlled by Cmd/Ctrl-click, Shift-click, checkboxes) and preview focus (`lastClickedPath`, set by any click or arrow-key navigation, used only to open the preview overlay). A normal click sets preview focus only — it does not select a file for import.

**Why this exists** (*Known from project history; repository evidence pending* — captured during the Product-Owner Purpose Capture interview, 2026-08-14): prevents the act of viewing/inspecting a file from accidentally changing what's selected for import — viewing and selecting are conceptually different actions, and conflating them risks an operator accidentally including or excluding a file from the import selection while merely inspecting it. This was confirmed as proactive, precautionary UX/safety design, built ahead of any incident — not a response to a real accidental-import event.

## Current Behavior

`lastClickedPath` (preview focus) and `_selectionAnchor` (shift-range anchor) are independent variables. Cmd/Ctrl+D deselects all import selection while preserving preview focus. Arrow keys move preview focus through rendered order when the preview is closed. Visual indicator: `.pv-focused` CSS class (see AI-FEAT-008 § file tile visual states) — never implies import selection, and `.selected` never implies preview focus; both can coexist on the same tile.

## Original Plan / Intent

Introduced in v0.8.1 (`docs/history.md`).

## Evolution / Implementation Journal

- **v0.8.1** — `.pv-focused` preview focus ring (three visual states: primary/secondary/combined); O(1) `_setPreviewFocus` helper swaps CSS class via `tileMap` instead of DOM query; `_selectionAnchor`/`_prevFocusPath` module-level state added; keyboard arrow navigation added.
- **2026-08-14** — Purpose/history captured — Product-Owner Purpose Capture interview. Confirmed this separation was proactive precautionary design, not a reaction to a real incident; recorded in Summary above. No code changed.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: v0.8.1 (see header table's "First-known implementation" field for citation).

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: Evolution / Implementation Journal above has exactly one entry (already reflected as Initial implementation, or see that section directly if it describes a later change).

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `renderer/renderer.js` (`_setPreviewFocus`, `lastClickedPath`, `_selectionAnchor`)
