# DEC-013 — Lock Clearing Must Be Constrained

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-045 |
| Status | Accepted |
| Date | 2026-07-02 (commits `52a6799`, `659788b`) |
| Evidence status | Verified from code (`services/archiveLockService.js:177,197,227,259,292`) and Git history |

## Context

Photographer-level write locks (AI-FEAT-045) prevent concurrent Direct Archive imports into the same event folder — a real safety guarantee (`docs/archive-operations-layer.md` § Safety Guarantees). But a lock left behind by a failed or killed process with no recovery path makes the device permanently unusable for further imports until a 30-minute TTL expires (see [BUG-004](../bugs/BUG-004_SAME_DEVICE_STALE_ARCHIVE_LOCK.md)). Any escape hatch for this needs to avoid undermining the safety guarantee it's an exception to.

## Options Considered

1. **No recovery path short of TTL expiry** — the pre-existing behavior. Rejected: directly evidenced as blocking all future imports on the affected device with no operator recourse.
2. **A broad "force clear any lock" action** — not evidenced as having been built or seriously considered; would undermine the concurrent-import safety guarantee.
3. **A narrowly-scoped, same-device-only clear, gated on no active background sync and requiring explicit user action** — the option that was built.

## Decision

Stale-lock clearing is constrained to same-device-only, heartbeat-recency-guarded release (`clearSelfLock()`), with a `force` bypass of that recency guard permitted only when no background sync job is active for the affected scope (`_syncingJobIds.size === 0`, commit `659788b`). The action is always an explicit user click in the "Archive Busy" dialog, never automatic, and is surfaced through the Archive Diagnostics repair UI (AI-FEAT-043) for auditability. A failed clear attempt is surfaced inline with a human-readable reason, never silently retried.

## Consequences

- Any future lock-recovery mechanism (for this lock system or a structurally similar one) must preserve the same four constraints: same-device verification, no active conflicting operation, explicit user action, and auditable surfacing — relaxing any one of these to "simplify" the UX would undermine the safety guarantee the lock exists to provide.
- A guard that can reject a clear attempt (e.g. an active sync job) must fail visibly and specifically — never via a silently-swallowed error that causes the UI to loop back to the same dialog with no explanation (this exact regression happened once already, see [BUG-004](../bugs/BUG-004_SAME_DEVICE_STALE_ARCHIVE_LOCK.md)).
- This lock mechanism's constraints do not automatically extend to other, structurally different concurrency guards in the codebase (e.g. Transfer Export's separate, unconfirmed "single-export-at-a-time" mechanism) — each guard's own recovery design must be evaluated on its own terms, not assumed to inherit this one's rules.

## Reconciliation Note

None recorded — no full "alternatives considered" discussion is evidenced beyond the shipped, constrained design; only the pre-fix behavior (no recovery path) and the fix's own initial regression (silent-failure UX) are evidenced as the practical alternatives that were tried and moved past.
