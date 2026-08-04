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

## Known Bugs / Troubleshooting

See `docs/failure-patterns.md` #14 (modal close button form-submit bug) — the rule this bug produced is now permanent design-system policy.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- No single implementation file — this is a documented ruleset applied across `renderer/index.html`, `renderer/renderer.js`, and all renderer CSS.
