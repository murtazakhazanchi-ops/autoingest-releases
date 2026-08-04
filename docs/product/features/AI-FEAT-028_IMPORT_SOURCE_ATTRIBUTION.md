# AI-FEAT-028 — Import Source Attribution

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-028 |
| Category | Import and Archive Writing |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-012, AI-FEAT-021 |
| Related roadmap milestone | None |
| Related technical docs | `docs/features.md` #11, `docs/data-model.md` § Import Entry Schema |
| Evidence status | Verified from docs (already fully read as required context) |
| First-known implementation | Evidence pending |
| Latest major update | Evidence pending |

## Summary

Each audit entry in `imports[]` records `source: {type, label, path}` identifying which memory card, external drive, or local folder was used. Distinct identity concept from Login/Operator Identity (AI-FEAT-002, who) and Photographer-Folder Resolution (AI-FEAT-022, whose folder) — deliberately kept as three separate registry entries.

## Current Behavior

Captured from the renderer's `activeSource` state at import time via `_buildImportSourceMeta()`. Backward-compatible: old entries without `source` remain valid; `isValidImportEntry` does not require it; the Activity Log displays "Source: Not recorded" for entries that lack it. Missing source never triggers a Check badge in the Activity Log (AI-FEAT-027).

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

No dated entries found in this pass beyond its presence in the current `docs/data-model.md` schema.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `renderer/renderer.js` (`_buildImportSourceMeta`)
