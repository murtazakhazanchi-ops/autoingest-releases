# AI-FEAT-036 — Keyword Registry

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-036 |
| Category | Metadata |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | Adobe Bridge `.txt` import/sync (folded in — see note below) |
| Dependencies | None |
| Related roadmap milestone | None |
| Related technical docs | None dedicated |
| Evidence status | Verified from current code |
| First-known implementation | 2026-05-09 ("Keyword Registry ID Stabilization" — learning-log) |
| Latest major update | 2026-05-09 |

## Summary

The controlled-vocabulary registry backing metadata keyword resolution: keywords, cities, event types, locations, and photographers.

## Current Behavior

Backing data: `data/keywords.registry.json`, `data/cities.json`, `data/event-types.json`, `data/locations.json`, `data/photographers.json`. Core: `_loadRegistryKeywords()` (`main/main.js:3925`). IPC: `keywords:loadRegistry`, `keywords:repairIds`, `keywords:addKeyword`, `keywords:saveCityCountry`.

**Adobe Bridge integration lives inside this feature, not as a separate one**: `keywords:updateFromBridgeTxt` / `keywords:chooseBridgeTxt` (Adobe Bridge `.txt` import/sync) are part of the Keyword Registry's own IPC surface — this was checklist item "Bridge/XMP external metadata updates," confirmed by direct code reading to be a Keyword Registry capability, not an independent AI-FEAT (avoiding double-counting the same code as two registry entries).

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

- **2026-05-09** — "Metadata Sync Phase 1D: Keyword Registry ID Stabilization and Modal Tab Refinement" (learning-log) — the registry's ID stability was hardened at this point, implying an earlier, less stable baseline this audit did not trace further.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

See [DEC-014 — Controlled Keyword Registry](../decisions/DEC-014_CONTROLLED_KEYWORD_REGISTRY.md) and [DEC-004 — Preserve Established Bridge-Based Archival Practice](../decisions/DEC-004_PRESERVE_BRIDGE_BASED_ARCHIVAL_PRACTICE.md).

## Future Enhancements

None recorded.

## Related Files

- `data/keywords.registry.json`, `data/cities.json`, `data/event-types.json`, `data/locations.json`, `data/photographers.json`
- `main/main.js` (`_loadRegistryKeywords` and `keywords:*` IPC handlers)
