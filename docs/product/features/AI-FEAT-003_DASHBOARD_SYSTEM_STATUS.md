# AI-FEAT-003 — Dashboard & System Status

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-003 |
| Category | Application Platform |
| Status | Implemented — evolving |
| Maturity | Operational |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-004 (all displayed data must derive from event.json or system state) |
| Related roadmap milestone | None |
| Related technical docs | `docs/ui-system.md` § Dashboard, `docs/features.md` #7 "UI Dashboard" |
| Evidence status | Verified from current code, docs, and recent commit history |
| First-known implementation | Evidence pending (pre-dates `docs/history.md`'s earliest entry) |
| Latest major update | 2026-08-03/04 (Metadata Health card, Audit & Repair tab spacing) |

## Summary

The landing surface of AutoIngest: hero card (event state), Event/Quick mode toggle, source cards, and overview stats. All displayed data must derive from `event.json` or system state — the dashboard has no independent or derived state of its own (`docs/ui-system.md`).

## Current Behavior

Per `docs/ui-system.md` § Dashboard: hero card, mode toggle, source cards, overview stats. `LastImportArea` shows the latest import entry's own photo/video count (fixed in v0.8.1 — previously showed the event-level total). Theme detection (see AI-FEAT-001) feeds the dashboard's visual state at load. System Overview stats received an explicit startup-refresh fix (commit `23352ab`) and an "Archive Locations Modal and System Overview Card" simplification pass (learning-log 2026-05-20).

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

- **v0.8.1** — `LastImportArea` bug fix (was showing event-level total instead of latest import's own count).
- **v0.8.6** — theme-detection IIFE moved out of inline `<script>` (CSP compliance, see AI-FEAT-001).
- **2026-05-20** — "v0.8.8 RC UI Simplification: Archive Locations Modal and System Overview Card" (learning-log).
- **2026-08-02** — "Dashboard Metadata Health Card: Extend-in-Place Plan Correction + Text-Overflow Catch" (learning-log) — see AI-FEAT-035 for the metadata-specific tile, which is a distinct registry entry (reflection layer over AI-FEAT-031).
- **2026-08-03/04** — "Run Audit Full-Width Fix + Obsolete Metadata Audit Entry Point Removal" and Audit & Repair tab spacing polish (recent commits `6349c62`, `c5d200f`) — these changes are scoped to AI-FEAT-034 (Metadata Management Modal), not the Dashboard itself, but were adjacent work in the same session.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `renderer/renderer.js` (hero area rendering, `_renderHeroLastImportArea`)
- `renderer/theme-init.js`
