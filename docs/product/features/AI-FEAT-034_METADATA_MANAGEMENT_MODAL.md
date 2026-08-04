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
| Testing coverage | Referenced in 2 test file(s) (mechanical name/import match, not a coverage percentage — the test suite was not executed for this documentation pass): `test/dashboardMetadataHealthCard.test.js`, `test/metadataManagementModalUI.test.js` |
| Documentation completeness | Mostly complete — 1 unresolved evidence gap(s) in this file (see fields/sections marked "Evidence pending" above) |

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

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: 2026-08-02 (see header table's "First-known implementation" field for citation).

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: 3 entries exist in the Evolution / Implementation Journal above; not individually re-classified by milestone type here to avoid restating evidence — read that section directly for the full dated sequence.

## Known Bugs / Troubleshooting

The modal-shell height-collapse bug (fixed 2026-08-02) is now a standing design-system rule — see AI-FEAT-008.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `renderer/index.html` (`.emm-box` and modal markup)
- `test/metadataManagementModalUI.test.js`
