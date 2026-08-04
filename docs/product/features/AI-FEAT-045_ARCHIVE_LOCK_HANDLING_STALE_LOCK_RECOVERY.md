# AI-FEAT-045 — Archive Lock Handling & Stale-Lock Recovery

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-045 |
| Category | Archive Operations |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | Stale-lock recovery (folded in — same file, not independently durable) |
| Dependencies | None |
| Related roadmap milestone | None |
| Related technical docs | `docs/archive-operations-layer.md` § Direct Archive, § Safety Guarantees |
| Evidence status | Verified from current code |
| First-known implementation | Evidence pending |
| Latest major update | Evidence pending |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | [AI-FEAT-038](AI-FEAT-038_TRANSFER_EXPORT.md), [AI-FEAT-043](AI-FEAT-043_ARCHIVE_HEALTH_REPORTING.md) (found via cross-reference in this file's own prose, not yet in Dependencies/Parent/Subfeatures above) |
| Related decisions | [DEC-013](../decisions/DEC-013_LOCK_CLEARING_MUST_BE_CONSTRAINED.md) |
| Related bugs | [BUG-004](../bugs/BUG-004_SAME_DEVICE_STALE_ARCHIVE_LOCK.md) |
| Related postmortems | None |
| Related architectural evolution sections | [§3E — E. Transfer and Distributed Working](../11_ARCHITECTURAL_EVOLUTION.md#e-transfer-and-distributed-working); [§3G — G. Archive Operations Layer](../11_ARCHITECTURAL_EVOLUTION.md#g-archive-operations-layer) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | No dedicated test file identified via automated search of `test/` (17 test files exist repository-wide, concentrated in the metadata subsystem — see AI-FEAT-029 through AI-FEAT-033) |
| Documentation completeness | Partial — 3 unresolved evidence gaps in this file (see fields/sections marked "Evidence pending" above) |

## Summary

Photographer-level write locks for Direct Archive imports, preventing concurrent imports into the same event folder, with automatic detection and recovery of stale locks.

## Scope Caveat (per `autoingest-architect` review)

This lock mechanism is **event/photographer-editing-scoped** (SHA1(collection+eventFolderName+photographerFolderName)-keyed, 30-min TTL, 5-min heartbeat renewal). It has **not** been confirmed to be the same mechanism behind AI-FEAT-038's Transfer Export "single-export-at-a-time" guard — that appears to be a separate, simpler, unconfirmed mechanism. Do not treat this feature's doc as covering Transfer's concurrency guard.

## Current Behavior

`services/archiveLockService.js`: lock key = SHA1(collection+event+photographer); 30-minute TTL; atomic tmp→rename acquire; 5-minute heartbeat renewal. IPC: `archive:checkDirectArchiveLocks`. Stale-lock recovery: `releaseStaleLock()` (line 227), IPC `archive:releaseStaleLock` / `archive:clearSelfStaleLock`, surfaced through the Archive Diagnostics repair UI (AI-FEAT-043).

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

No dated entries found in this pass.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending — no independently-verified first-implementation date exists in this file's header table.

**Architectural / workflow decisions**: [DEC-013](../decisions/DEC-013_LOCK_CLEARING_MUST_BE_CONSTRAINED.md) — see the Decisions section above and each record's own "Decision"/"Consequences" fields for what changed and why.

**Reliability / correctness fixes**: [BUG-004](../bugs/BUG-004_SAME_DEVICE_STALE_ARCHIVE_LOCK.md) — see the Known Bugs section above and each record's own "Root Cause"/"Fix" fields for what changed and why.

**Other dated milestones**: Evidence pending — Evolution / Implementation Journal above has no dated entries.

## Known Bugs / Troubleshooting

See [BUG-004 — Same-Device Stale Archive Lock Blocks All Future Imports](../bugs/BUG-004_SAME_DEVICE_STALE_ARCHIVE_LOCK.md) (fixed 2026-07-02).

## Decisions

See [DEC-013 — Lock Clearing Must Be Constrained](../decisions/DEC-013_LOCK_CLEARING_MUST_BE_CONSTRAINED.md).

## Future Enhancements

None recorded.

## Related Files

- `services/archiveLockService.js`
