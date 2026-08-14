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

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | None beyond Dependencies/Parent/Subfeatures already listed in the header table above |
| Related decisions | None recorded |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | Not yet covered in 11_ARCHITECTURAL_EVOLUTION.md's relationship map |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | No dedicated test file identified via automated search of `test/` (17 test files exist repository-wide, concentrated in the metadata subsystem — see AI-FEAT-029 through AI-FEAT-033) |
| Documentation completeness | Complete — no unresolved "Evidence pending" markers in this file |

## Summary

Allows selection of files and folders for ingestion; presents them as grouped sections (RAW / Images / Video) in either grid or list view, with selection controls, always reflecting grouping and state from `GroupManager` (AI-FEAT-017).

**Why this exists** (*Known from project history; repository evidence pending* — captured during the Product-Owner Purpose Capture interview, 2026-08-14): flattens the nested-folder navigation burden that repetitive Finder/Explorer/Adobe Bridge browsing imposed — operators can see media located across nested folders on a drive/card in one scrollable environment, organized by useful media-type distinctions (RAW/JPEG/video), reducing the risk of overlooking a folder and the time spent traversing storage structure. The timeline/hour-based navigation view is specifically important: operators frequently know the approximate start/end time of an event, and this view lets them locate media by when the event occurred, selecting the relevant interval while ignoring unrelated material before/after it. This functionality was explicitly regarded as unavailable or insufficient for this specific workflow in Finder, Explorer, and even Adobe Bridge — the objective was event-oriented source selection that is fast, precise, and difficult to overlook, not merely "having a custom browser" for its own sake.

## Current Behavior

Per `docs/ui-system.md` § File Panel: Grid/List view, grouped sections (RAW/Images/Video), selection controls. Grid/list is a view-mode toggle within this feature, not an independently durable capability (per research-pass verdict — folded in rather than given its own registry entry).

## Original Plan / Intent

Introduced/expanded in v0.6.0 "File Handling & UI" (`docs/history.md`), noted at the time as increasing filesystem complexity with potential performance bottlenecks.

## Evolution / Implementation Journal

- **v0.6.0** — folder view, recursive scanner, UI improvements.
- **2026-05-07** — "Large External Drive and Local Folder Source Entry Performance" and "Non-Recursive Folder Navigation for External Drive and Local Folder" (learning-log) — performance hardening for large sources.
- **2026-05-07** — "View-Mode State Sync: Media↔Folder Toggle and Folder-Click in Media View" (learning-log).
- **2026-08-14** — Purpose/history captured — Product-Owner Purpose Capture interview. Added the navigation-flattening/timeline-navigation rationale in Summary above, including the explicit product-owner claim that this workflow was unavailable/insufficient in Finder/Explorer/Bridge. No code changed.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: v0.6.0 ("File Handling & UI" — folder view, recursive scanner, UI improvements) (see header table's "First-known implementation" field for citation).

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: 3 entries exist in the Evolution / Implementation Journal above; not individually re-classified by milestone type here to avoid restating evidence — read that section directly for the full dated sequence.

## Known Bugs / Troubleshooting

None recorded in `docs/product/bugs/` yet.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `main/fileBrowser.js`
