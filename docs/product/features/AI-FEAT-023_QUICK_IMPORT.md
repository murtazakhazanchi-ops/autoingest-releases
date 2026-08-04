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

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | [AI-FEAT-009](AI-FEAT-009_EVENT_CREATION.md), [AI-FEAT-029](AI-FEAT-029_METADATA_WRITING_ENGINE.md), [AI-FEAT-033](AI-FEAT-033_METADATA_AUDIT_REPAIR.md) (found via cross-reference in this file's own prose, not yet in Dependencies/Parent/Subfeatures above) |
| Related decisions | None recorded |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | Not yet covered in 11_ARCHITECTURAL_EVOLUTION.md's relationship map |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | Evidence pending — this feature's related files are shared, multi-feature modules (e.g. `main/main.js`, `renderer/renderer.js`); automated basename matching against test/ is unreliable for these and was not attempted |
| Documentation completeness | Partial — 3 unresolved evidence gaps in this file (see fields/sections marked "Evidence pending" above) |

## Summary

A staging-only, non-archival import path with a materially different backend contract from Event Import (AI-FEAT-009/019): it creates no `event.json`, so its files are permanently outside Metadata Audit (AI-FEAT-033) coverage — the audit scanner's traversal is gated on `event.json` presence at every level — and are never eligible for event-based Metadata Repair.

## Current Behavior

Renderer: `_renderQuickImportCard()`, `showQuickImportConfirmModal()`. UI: `#quickImportCard`, `#quickImportModal` + `qiModal*` sub-elements. Per `docs/metadata-system.md` § Non-Goals: "Quick Import is deliberately staging-only, non-archival... This is communicated directly in the Quick Import UI." Quick Import is also intentionally metadata-blind (see AI-FEAT-029's Import Path Coverage table) — this is stated directly in its own UI, not a silent gap.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

No dated entries found in this pass.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending — no independently-verified first-implementation date exists in this file's header table.

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: Evidence pending — Evolution / Implementation Journal above has no dated entries.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

If Quick Import content is ever intended as final archival ingest, `docs/metadata-system.md` states this "requires a deliberate design decision, not a Quick Import change" — recorded here as a standing note for whoever next considers extending this feature's scope.

## Future Enhancements

None recorded.

## Related Files

- `renderer/renderer.js` (`_renderQuickImportCard`, `showQuickImportConfirmModal`)
