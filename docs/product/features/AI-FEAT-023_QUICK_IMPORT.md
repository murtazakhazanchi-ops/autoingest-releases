# AI-FEAT-023 — Quick Import

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-023 |
| Category | Import and Archive Writing |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | None (deliberately independent of AI-FEAT-004 — creates no event.json) |
| Related roadmap milestone | None |
| Related technical docs | `docs/metadata-system.md` § Non-Goals |
| Evidence status | Verified from current code and docs |
| First-known implementation | Evidence pending |
| Latest major update | Evidence pending |

## Summary

A staging-only, non-archival import path with a materially different backend contract from Event Import (AI-FEAT-009/019): it creates no `event.json`, so its files are permanently outside Metadata Audit (AI-FEAT-033) coverage — the audit scanner's traversal is gated on `event.json` presence at every level — and are never eligible for event-based Metadata Repair.

## Current Behavior

Renderer: `_renderQuickImportCard()`, `showQuickImportConfirmModal()`. UI: `#quickImportCard`, `#quickImportModal` + `qiModal*` sub-elements. Per `docs/metadata-system.md` § Non-Goals: "Quick Import is deliberately staging-only, non-archival... This is communicated directly in the Quick Import UI." Quick Import is also intentionally metadata-blind (see AI-FEAT-029's Import Path Coverage table) — this is stated directly in its own UI, not a silent gap.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

No dated entries found in this pass.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

If Quick Import content is ever intended as final archival ingest, `docs/metadata-system.md` states this "requires a deliberate design decision, not a Quick Import change" — recorded here as a standing note for whoever next considers extending this feature's scope.

## Future Enhancements

None recorded.

## Related Files

- `renderer/renderer.js` (`_renderQuickImportCard`, `showQuickImportConfirmModal`)
