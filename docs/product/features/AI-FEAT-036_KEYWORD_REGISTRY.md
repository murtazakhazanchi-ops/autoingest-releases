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

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | None beyond Dependencies/Parent/Subfeatures already listed in the header table above |
| Related decisions | [DEC-004](../decisions/DEC-004_PRESERVE_BRIDGE_BASED_ARCHIVAL_PRACTICE.md); [DEC-014](../decisions/DEC-014_CONTROLLED_KEYWORD_REGISTRY.md) |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | [§3A — A. Established Adobe Bridge Workflow (pre-AutoIngest)](../11_ARCHITECTURAL_EVOLUTION.md#a-established-adobe-bridge-workflow-pre-autoingest); [§3C — C. Metadata Automation](../11_ARCHITECTURAL_EVOLUTION.md#c-metadata-automation) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | Evidence pending — this feature's related files are shared, multi-feature modules (e.g. `main/main.js`, `renderer/renderer.js`); automated basename matching against test/ is unreliable for these and was not attempted |
| Documentation completeness | Mostly complete — 1 unresolved evidence gap(s) in this file (see fields/sections marked "Evidence pending" above) |

## Summary

The controlled-vocabulary registry backing metadata keyword resolution: keywords, cities, event types, locations, and photographers.

## Current Behavior

Backing data: `data/keywords.registry.json`, `data/cities.json`, `data/event-types.json`, `data/locations.json`, `data/photographers.json`. Core: `_loadRegistryKeywords()` (`main/main.js:3925`). IPC: `keywords:loadRegistry`, `keywords:repairIds`, `keywords:addKeyword`, `keywords:saveCityCountry`.

**Adobe Bridge integration lives inside this feature, not as a separate one**: `keywords:updateFromBridgeTxt` / `keywords:chooseBridgeTxt` (Adobe Bridge `.txt` import/sync) are part of the Keyword Registry's own IPC surface — this was checklist item "Bridge/XMP external metadata updates," confirmed by direct code reading to be a Keyword Registry capability, not an independent AI-FEAT (avoiding double-counting the same code as two registry entries).

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

- **2026-05-09** — "Metadata Sync Phase 1D: Keyword Registry ID Stabilization and Modal Tab Refinement" (learning-log) — the registry's ID stability was hardened at this point, implying an earlier, less stable baseline this audit did not trace further.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: 2026-05-09 ("Keyword Registry ID Stabilization" — learning-log) (see header table's "First-known implementation" field for citation).

**Architectural / workflow decisions**: [DEC-004](../decisions/DEC-004_PRESERVE_BRIDGE_BASED_ARCHIVAL_PRACTICE.md); [DEC-014](../decisions/DEC-014_CONTROLLED_KEYWORD_REGISTRY.md) — see the Decisions section above and each record's own "Decision"/"Consequences" fields for what changed and why.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: Evolution / Implementation Journal above has exactly one entry (already reflected as Initial implementation, or see that section directly if it describes a later change).

## Known Bugs / Troubleshooting

None recorded.

## Decisions

See [DEC-014 — Controlled Keyword Registry](../decisions/DEC-014_CONTROLLED_KEYWORD_REGISTRY.md) and [DEC-004 — Preserve Established Bridge-Based Archival Practice](../decisions/DEC-004_PRESERVE_BRIDGE_BASED_ARCHIVAL_PRACTICE.md).

## Future Enhancements

None recorded.

## Related Files

- `data/keywords.registry.json`, `data/cities.json`, `data/event-types.json`, `data/locations.json`, `data/photographers.json`
- `main/main.js` (`_loadRegistryKeywords` and `keywords:*` IPC handlers)
