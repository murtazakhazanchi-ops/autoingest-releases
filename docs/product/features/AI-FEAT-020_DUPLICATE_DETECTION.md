# AI-FEAT-020 — Duplicate Detection

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-020 |
| Category | Import and Archive Writing |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | AI-FEAT-019 (Import Pipeline & Copy Engine) |
| Subfeatures | None |
| Dependencies | AI-FEAT-019 |
| Related roadmap milestone | None |
| Related technical docs | `docs/ingestion-flow.md` § Duplicate Handling, `docs/features.md` #6 |
| Evidence status | Verified from current code |
| First-known implementation | Evidence pending |
| Latest major update | Evidence pending |

## Summary

**Classification note**: this is documented as a separate feature file for lineage/continuity reasons — `docs/features.md` (an existing authoritative technical doc) lists it as its own top-level implemented feature (#6). Mechanically, it is entirely implemented inside AI-FEAT-019's `resolveDestPath()` — there is no independent service, state, or code path. Treat this as a **subfeature split out for documentation continuity**, not as an architecturally independent system. A reader should not assume this evolves separately from the Copy Engine.

## Current Behavior

Same name + size → skip. Different size → rename (`_1`, `_2` numbered-slot search). No overwrite under any condition. Prevents overwriting by identifying existing files at the destination before copy.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

No entries yet — this feature's evolution is the same as AI-FEAT-019's; see that file for the Copy Engine's history.

## Known Bugs / Troubleshooting

See `docs/failure-patterns.md` #3 (Duplicate Files or Unexpected Renaming).

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `main/fileManager.js` (`resolveDestPath`)
