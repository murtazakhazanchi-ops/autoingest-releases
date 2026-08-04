# AI-FEAT-008 — Design System & UI Consistency Framework

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-008 |
| Category | Product UI |
| Status | Implemented — evolving |
| Maturity | Foundational |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | None |
| Related roadmap milestone | None |
| Related technical docs | `docs/design-system.md`, `docs/ui-system.md` |
| Evidence status | Verified from docs and recent commit history |
| First-known implementation | Evidence pending |
| Latest major update | 2026-08-02/04 (Metadata Management Modal shell height rule, Audit & Repair spacing polish) |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | [AI-FEAT-016](AI-FEAT-016_PREVIEW_FOCUS_SELECTION_SEPARATION.md), [AI-FEAT-034](AI-FEAT-034_METADATA_MANAGEMENT_MODAL.md) (found via cross-reference in this file's own prose, not yet in Dependencies/Parent/Subfeatures above) |
| Related decisions | None recorded |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | Not yet covered in 11_ARCHITECTURAL_EVOLUTION.md's relationship map |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | Evidence pending — this feature's related files are shared, multi-feature modules (e.g. `main/main.js`, `renderer/renderer.js`); automated basename matching against test/ is unreliable for these and was not attempted |
| Documentation completeness | Mostly complete — 2 unresolved evidence gap(s) in this file (see fields/sections marked "Evidence pending" above) |

## Summary

The shared visual and component system every UI surface in AutoIngest must follow: glassmorphism-based styling, consistent buttons/cards/modals, SVG-only icons, a defined spacing scale, and documented interaction-state rules. This is infrastructure that every feature's UI depends on, not a feature a user directly invokes.

## Current Behavior

Per `docs/design-system.md`: consistency over variation, no one-off styling, light/dark mode support, SVG icons only (no emoji anywhere), consistent button/card/modal structure. Documented named patterns include: the `.al-action-row` reusable spacing token, the four file-tile visual states (default/hovered/selected/preview-focused per `docs/design-system.md` §8a — see AI-FEAT-016 for the underlying selection/focus split), and the `backdrop-filter` stacking-context rule for multi-row panels with dropdowns (§8b). `docs/ui-system.md` layers UI *behavior* (no independent state, UI is a pure reflection of backend state) on top of this document's *appearance* rules — the two documents are deliberately split (Component Responsibility) and must not mix logic/styling concerns.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

- **§8b backdrop-filter rule** — added after a real bug where `.ec-comp-row`'s `backdrop-filter` created per-row stacking contexts, causing later sibling rows to paint over an earlier row's open dropdown in the Event Creator (v0.8.8, `docs/history.md`).
- **Modal shell height rule** — added ("Multi-tab modals that share a shell class ... must use a scoped height rule on the specific modal ID") after a real visual-jumping bug across tab switches in the Metadata Management Modal (AI-FEAT-034), 2026-08-02.
- **Button `type="button"` rule** — added after a real bug where a modal close button without `type="button"` was treated as a form submit trigger (`docs/failure-patterns.md` #14).

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending — no independently-verified first-implementation date exists in this file's header table.

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: 3 entries exist in the Evolution / Implementation Journal above; not individually re-classified by milestone type here to avoid restating evidence — read that section directly for the full dated sequence.

## Known Bugs / Troubleshooting

See `docs/failure-patterns.md` #14 (modal close button form-submit bug) — the rule this bug produced is now permanent design-system policy.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- No single implementation file — this is a documented ruleset applied across `renderer/index.html`, `renderer/renderer.js`, and all renderer CSS.
