# AI-FEAT-052 — Archive Repair

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-052 |
| Category | Planned Archive Management |
| Status | Planned |
| Maturity | Planned |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-043 (expected to close the "diagnostics reports, doesn't fix" gap that feature documents) |
| Related roadmap milestone | AI-RM-007 |
| Related technical docs | None — no implementation exists yet |
| Evidence status | Confirmed NOT started, despite a filename collision — verified directly by reading `services/archiveRepairService.js` |
| First-known implementation | Not started |
| Latest major update | Not applicable |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | None beyond Dependencies/Parent/Subfeatures already listed in the header table above |
| Related decisions | None recorded |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | Not yet covered in 11_ARCHITECTURAL_EVOLUTION.md's relationship map |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | Not applicable — feature not yet implemented (see header table's Status/Evidence status fields) |
| Documentation completeness | Complete — no unresolved "Evidence pending" markers in this file |

## Summary

Planned broad archive-repair automation — seventh in the canonical roadmap order. `docs/archive-operations-layer.md` explicitly documents this exact gap today: "No broad repair automation: the diagnostics layer reports issues but does not auto-fix them" (AI-FEAT-043).

## Current Behavior

Not implemented as this planned capability. **Important disambiguation**: `services/archiveRepairService.js` exists in the codebase, but its actual scope — read directly during this audit — is "Phase 13B-2: Temp File Cleanup." It only deletes files whose basename ends in `.autoingest-sync-tmp` or `.autoingest-tx-tmp`, explicitly never touching media, `event.json`, locks, or manifests. Single call site: `main/main.js:4466` via `archive:cleanupTempFile`. **This is unrelated narrow infrastructure — do not treat it as a head start on this planned milestone.**

## Original Plan / Intent

Named as "Archive Repair" in the canonical roadmap order (see [../02_MASTER_ROADMAP.md](../02_MASTER_ROADMAP.md)). Specific scope is evidence-pending — not yet documented as fact.

## Evolution / Implementation Journal

Not started (for the planned broad-repair scope). The existing `archiveRepairService.js` temp-file-cleanup utility is a separate, already-shipped, narrow capability — not part of this feature's evolution.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Not applicable — feature not yet implemented.

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: Evidence pending — Evolution / Implementation Journal above has no dated entries.

## Known Bugs / Troubleshooting

Not applicable.

## Decisions

**Naming collision flagged**: whoever scopes this milestone should either rename the existing narrow `archiveRepairService.js` (temp-file cleanup) or choose a different service name for the new broad-repair capability, to avoid two unrelated things sharing a name in the codebase.

## Future Enhancements

Scope, design, and acceptance criteria are pending discovery/specification.

## Related Files

None — no implementation of the planned capability exists. (`services/archiveRepairService.js` exists but is a distinct, narrower, already-shipped utility — see Current Behavior.)
