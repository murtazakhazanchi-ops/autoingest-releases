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

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `services/archiveLockService.js`
