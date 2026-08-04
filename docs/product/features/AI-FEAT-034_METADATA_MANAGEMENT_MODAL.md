# AI-FEAT-034 — Metadata Management Modal

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-034 |
| Category | Metadata |
| Status | Implemented — evolving |
| Maturity | Operational |
| Parent feature | None (reflection layer over AI-FEAT-031, AI-FEAT-033, AI-FEAT-036) |
| Subfeatures | None |
| Dependencies | AI-FEAT-031, AI-FEAT-033, AI-FEAT-036, AI-FEAT-008 |
| Related roadmap milestone | AI-RM-001 |
| Related technical docs | None dedicated |
| Evidence status | Verified from recent commit history and `test/metadataManagementModalUI.test.js` |
| First-known implementation | 2026-08-02 |
| Latest major update | 2026-08-04 (commit `c5d200f`) |

## Classification Note (per `autoingest-architect` review)

This is a real, substantial UI shell (`_ms`-prefixed state, tabbed navigation, its own backdrop/Escape handling, header status strip) — not a trivial wrapper, and worth its own registry entry. But it owns **no backend state of its own**: it aggregates and reflects Metadata Event-State Derivation (AI-FEAT-031), Metadata Audit & Repair (AI-FEAT-033), and Keyword Registry (AI-FEAT-036). Per `docs/ui-system.md`'s "UI must remain a reflection layer" contract, this should be read as a **reflection-layer container**, not a fifth independent metadata capability with its own logic.

## Summary

A single tabbed modal consolidating three previously-separate metadata UI surfaces.

## Current Behavior

Tabbed navigation over the metadata surfaces listed above; shared modal shell (`.emm-box`) with a scoped per-modal `height` rule (not `max-height` alone) to prevent visual jumping across tab switches when content height varies between tabs (see AI-FEAT-008's design-system rule, which this bug produced).

## Original Plan / Intent

Evidence pending beyond the commit/learning-log trail below.

## Evolution / Implementation Journal

- **2026-08-02** — "Metadata Management Modal: Consolidating 3 UI Surfaces Into One Tabbed Modal" (learning-log; commit `4446a30` "consolidate metadata surfaces into a Metadata Management modal").
- **2026-08-03** — "compact Run Audit button; remove obsolete Metadata Audit entry point" (commit `6349c62`).
- **2026-08-03/04** — "rebalance Audit & Repair tab into a full-height flex layout with a single scroll region" (commit `2c2090a`); "polish Audit & Repair spacing across window heights" (commit `c5d200f`) — adds a media query so the documented minimum window height (700px) gets its own correctly-tuned spacing.

## Known Bugs / Troubleshooting

The modal-shell height-collapse bug (fixed 2026-08-02) is now a standing design-system rule — see AI-FEAT-008.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `renderer/index.html` (`.emm-box` and modal markup)
- `test/metadataManagementModalUI.test.js`
