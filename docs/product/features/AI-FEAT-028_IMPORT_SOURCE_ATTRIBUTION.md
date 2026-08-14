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

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | [AI-FEAT-002](AI-FEAT-002_LOGIN_OPERATOR_IDENTITY.md), [AI-FEAT-022](AI-FEAT-022_PHOTOGRAPHER_FOLDER_RESOLUTION.md), [AI-FEAT-027](AI-FEAT-027_ACTIVITY_LOG.md) (found via cross-reference in this file's own prose, not yet in Dependencies/Parent/Subfeatures above) |
| Related decisions | None recorded |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | [§3D — D. Archive Integrity and Transaction Safety](../11_ARCHITECTURAL_EVOLUTION.md#d-archive-integrity-and-transaction-safety) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | Evidence pending — this feature's related files are shared, multi-feature modules (e.g. `main/main.js`, `renderer/renderer.js`); automated basename matching against test/ is unreliable for these and was not attempted |
| Documentation completeness | Partial — 3 unresolved evidence gaps in this file (see fields/sections marked "Evidence pending" above) |

## Summary

Each audit entry in `imports[]` records `source: {type, label, path}` identifying which memory card, external drive, or local folder was used. Distinct identity concept from Login/Operator Identity (AI-FEAT-002, who) and Photographer-Folder Resolution (AI-FEAT-022, whose folder) — deliberately kept as three separate registry entries.

**Why this exists** (*Known from project history; repository evidence pending* — captured during the Product-Owner Purpose Capture interview, 2026-08-14): three combined purposes — avoiding unnecessary re-import by identifying what's already been imported from a source, archival provenance for tracing missing/damaged data back to its origin, and informing source-cleanup readiness decisions (feeds AI-FEAT-024's cleanup checks). Built proactively as part of the archive's provenance design, not in response to a specific incident.

## Current Behavior

Captured from the renderer's `activeSource` state at import time via `_buildImportSourceMeta()`. Backward-compatible: old entries without `source` remain valid; `isValidImportEntry` does not require it; the Activity Log displays "Source: Not recorded" for entries that lack it. Missing source never triggers a Check badge in the Activity Log (AI-FEAT-027).

## Original Plan / Intent

Evidence pending — not yet documented as fact regarding original scoping. See Summary above for the product-owner-supplied purpose captured 2026-08-14.

## Evolution / Implementation Journal

No dated entries found in this pass beyond its presence in the current `docs/data-model.md` schema, and the entry below.

- **2026-08-14** — Purpose/history captured — Product-Owner Purpose Capture interview. Product owner supplied the three-part rationale (re-import avoidance, provenance, source-cleanup readiness) now recorded in Summary above. No code changed.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending — no independently-verified first-implementation date exists in this file's header table.

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: Evidence pending — Evolution / Implementation Journal above has no dated entries.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `renderer/renderer.js` (`_buildImportSourceMeta`)
