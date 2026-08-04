# AI-FEAT-037 — Metadata Reapply / Sync

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-037 |
| Category | Metadata |
| Status | Implemented |
| Maturity | Evolving |
| Parent feature | AI-FEAT-029 |
| Subfeatures | None |
| Dependencies | AI-FEAT-029, AI-FEAT-036 |
| Related roadmap milestone | None |
| Related technical docs | `docs/metadata-system.md` § Import Path Coverage (the "Reapply" row) |
| Evidence status | Known from project history (learning-log narrative + file existence); NOT independently function-level audited by either research fork in this pass — evidence status intentionally lower than most other Metadata entries |
| First-known implementation | 2026-05-09 |
| Latest major update | 2026-05-11 |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | None beyond Dependencies/Parent/Subfeatures already listed in the header table above |
| Related decisions | None recorded |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | [§3C — C. Metadata Automation](../11_ARCHITECTURAL_EVOLUTION.md#c-metadata-automation) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | No dedicated test file identified via automated search of `test/` (17 test files exist repository-wide, concentrated in the metadata subsystem — see AI-FEAT-029 through AI-FEAT-033) |
| Documentation completeness | Mostly complete — 1 unresolved evidence gap(s) in this file (see fields/sections marked "Evidence pending" above) |

## Summary

Detects when metadata needs to be reapplied to already-imported files (e.g. after an operator corrects event component location/city/country post-import) and syncs the corrected metadata across previously-imported files, with a preview modal showing affected folders and changed/removed fields. `docs/metadata-system.md`'s Import Path Coverage table lists "Reapply" as a synchronous write via the shared engine (AI-FEAT-029) — this feature is that Reapply capability plus its scan/sync/preview surface.

## Current Behavior

`main/metadataSyncService.js` exists as a dedicated file. Full current function-level behavior is evidence-pending — this entry is grounded in file existence, the learning-log narrative below, and the doc cross-reference, not an independent code audit. A future pass should verify current behavior directly against `main/metadataSyncService.js` before treating implementation details here as authoritative.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

- **2026-05-09** — "Metadata Sync MVP" (learning-log).
- **2026-05-09** — "Metadata Sync Phase 1B Stabilization" (learning-log).
- **2026-05-10** — "Metadata Sync Modal: Affected-Folder Chips, Changed/Removed Preview Section, +N More Truncation" (learning-log).
- **2026-05-10** — "previewEventMetadata Classification Fix (commit 1464c85)" (learning-log).
- **2026-05-10** — "Metadata Sync Stabilization and Scan Performance Optimization" (learning-log).
- **2026-05-11** — "Metadata Sync Hardening: Sync Resilience and Scan Reliability (commit b14d5fd)" (learning-log) — most recent dated entry found.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: 2026-05-09 (see header table's "First-known implementation" field for citation).

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: 6 entries exist in the Evolution / Implementation Journal above; not individually re-classified by milestone type here to avoid restating evidence — read that section directly for the full dated sequence.

## Known Bugs / Troubleshooting

None recorded in `docs/product/bugs/` yet — see the learning-log entries above (particularly the 2026-05-10 classification fix and 2026-05-11 hardening pass) for narrative detail on bugs found and fixed during this feature's development.

## Decisions

None recorded.

## Future Enhancements

A full function-level audit of `main/metadataSyncService.js` against the current codebase is an open follow-up — this entry's evidence status is deliberately marked lower than its siblings until that happens.

## Related Files

- `main/metadataSyncService.js`
