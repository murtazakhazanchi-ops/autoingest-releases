# AI-FEAT-040 — Backup Update Scanning

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-040 |
| Category | Transfer and Backup |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | AI-FEAT-038 |
| Subfeatures | None |
| Dependencies | AI-FEAT-038 |
| Related roadmap milestone | None |
| Related technical docs | None dedicated |
| Evidence status | Verified from current code, git commit history, and git branch inspection |
| First-known implementation | Evidence pending (10+ dedicated commits, dates not individually attributed in this pass) |
| Latest major update | Evidence pending |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | None beyond Dependencies/Parent/Subfeatures already listed in the header table above |
| Related decisions | [DEC-010](../decisions/DEC-010_TRANSFER_UPDATE_MISSING_FILES_ONLY.md) |
| Related bugs | [BUG-005](../bugs/BUG-005_TRANSFER_EXPORT_RESUME_STATE_DIVERGENCE.md) |
| Related postmortems | None |
| Related architectural evolution sections | [§3E — E. Transfer and Distributed Working](../11_ARCHITECTURAL_EVOLUTION.md#e-transfer-and-distributed-working) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | No dedicated test file identified via automated search of `test/` (17 test files exist repository-wide, concentrated in the metadata subsystem — see AI-FEAT-029 through AI-FEAT-033) |
| Documentation completeness | Partial — 3 unresolved evidence gaps in this file (see fields/sections marked "Evidence pending" above) |

## Summary

A distinct mode of Transfer Export (`backupUpdate` mode) with genuinely different conflict semantics: it never overwrites and never creates `_1`/`_2` renamed files — a stricter no-mutation contract than standard export. Real and substantial, not aspirational: confirmed via 10+ dedicated `feat(backup)`/`fix(backup)`-prefixed commits, all merged to `main`.

## Current Behavior

IPC: `archive:scanBackupSync` → `transferExportService.scanBackupSync()`. `backupUpdate` mode (`services/transferExportService.js:57,128-131`). Supports custom source/destination folders (not just the standard Active→Transfer path), checkpoint/resume, sequence-prefixed folder rename detection, and a cross-device resume validation guard (confirms a resumed job's source root still matches the originating device — see 01_FEATURE_REGISTRY.md's Cross-Cutting Patterns note on "cross-device continuation," which is not a standalone feature but partly lives here).

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

Commits confirmed on `main` (via the fully-merged `feat/backup-sync-scan` branch, 0 commits ahead of main as of this audit): `13a4558` (correct event.json classification, update progress, detect folder renames), `8f9a351` (support custom source folder export), `385d60c` (hidden custom transfer job state), `0674d3a` (resume custom folder exports from checkpoint), `3238ade` (clean transfer backup scan summary layout), `4caad25`/`f2ea43a` (detect sequence-prefixed/reviewed nested folder renames), `9f825df` (show custom backup resume state), `e08fac2` (cross-device source validation for custom export resume), `803c756` (preserve queued progress total on resume). Individual commit dates were not attributed in this pass.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending (10+ dedicated commits, dates not individually attributed in this pass) (see header table's "First-known implementation" field for citation).

**Architectural / workflow decisions**: [DEC-010](../decisions/DEC-010_TRANSFER_UPDATE_MISSING_FILES_ONLY.md) — see the Decisions section above and each record's own "Decision"/"Consequences" fields for what changed and why.

**Reliability / correctness fixes**: [BUG-005](../bugs/BUG-005_TRANSFER_EXPORT_RESUME_STATE_DIVERGENCE.md) — see the Known Bugs section above and each record's own "Root Cause"/"Fix" fields for what changed and why.

**Other dated milestones**: Evidence pending — Evolution / Implementation Journal above has no dated entries.

## Known Bugs / Troubleshooting

Several of the commits above are bug fixes now backfilled as [BUG-005 — Transfer Export/Backup-Update Resume State Diverges From Backend Progress](../bugs/BUG-005_TRANSFER_EXPORT_RESUME_STATE_DIVERGENCE.md) (`803c756`, `9f825df`, and sibling commit `cb01b34`).

## Decisions

See [DEC-010 — Transfer Update Is Missing-Files-Only](../decisions/DEC-010_TRANSFER_UPDATE_MISSING_FILES_ONLY.md).

## Future Enhancements

None recorded.

## Related Files

- `services/transferExportService.js` (`scanBackupSync`, `backupUpdate` mode)
