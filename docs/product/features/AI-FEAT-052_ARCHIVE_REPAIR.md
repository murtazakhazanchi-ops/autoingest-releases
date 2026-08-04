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

## Summary

Planned broad archive-repair automation — seventh in the canonical roadmap order. `docs/archive-operations-layer.md` explicitly documents this exact gap today: "No broad repair automation: the diagnostics layer reports issues but does not auto-fix them" (AI-FEAT-043).

## Current Behavior

Not implemented as this planned capability. **Important disambiguation**: `services/archiveRepairService.js` exists in the codebase, but its actual scope — read directly during this audit — is "Phase 13B-2: Temp File Cleanup." It only deletes files whose basename ends in `.autoingest-sync-tmp` or `.autoingest-tx-tmp`, explicitly never touching media, `event.json`, locks, or manifests. Single call site: `main/main.js:4466` via `archive:cleanupTempFile`. **This is unrelated narrow infrastructure — do not treat it as a head start on this planned milestone.**

## Original Plan / Intent

Named as "Archive Repair" in the canonical roadmap order (see [../02_MASTER_ROADMAP.md](../02_MASTER_ROADMAP.md)). Specific scope is evidence-pending — not yet documented as fact.

## Evolution / Implementation Journal

Not started (for the planned broad-repair scope). The existing `archiveRepairService.js` temp-file-cleanup utility is a separate, already-shipped, narrow capability — not part of this feature's evolution.

## Known Bugs / Troubleshooting

Not applicable.

## Decisions

**Naming collision flagged**: whoever scopes this milestone should either rename the existing narrow `archiveRepairService.js` (temp-file cleanup) or choose a different service name for the new broad-repair capability, to avoid two unrelated things sharing a name in the codebase.

## Future Enhancements

Scope, design, and acceptance criteria are pending discovery/specification.

## Related Files

None — no implementation of the planned capability exists. (`services/archiveRepairService.js` exists but is a distinct, narrower, already-shipped utility — see Current Behavior.)
