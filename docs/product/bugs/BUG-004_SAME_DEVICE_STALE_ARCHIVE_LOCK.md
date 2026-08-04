# BUG-004 — Same-Device Stale Archive Lock Blocks All Future Imports

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-045 |
| Status | Fixed |
| Severity | Medium |
| Discovered | 2026-05-12 (lock mechanism introduced without a same-device recovery path) |
| Fixed | 2026-07-02 (in two parts, same day) |
| Evidence status | Verified from Git history (commits `7335940`, `52a6799`, `659788b`) and code (`services/archiveLockService.js`) |

## Symptom

When a previous Direct Archive import on the same machine failed or closed unexpectedly, it left an active photographer-level write lock behind. Every subsequent import attempt on that device then saw "Archive Busy" indefinitely, with no way to recover short of waiting out the TTL.

## Root Cause

`archiveLockService` had lock acquire/release/renew logic (SHA1(collection+event+photographer)-keyed, 30-minute TTL, 5-minute heartbeat renewal) from its initial implementation, but no same-device-safe clear path reachable from the "Archive Busy" dialog. A process that failed or was killed simply left the lock file in place with no operator-facing recovery action, only a passive TTL expiry.

The first attempt at a fix then introduced its own regression: the "Clear & Continue" action silently swallowed IPC errors (`.catch(() => {})`) and always looped back to the same dialog on failure, making the button appear broken whenever the underlying clear call returned `ok: false`.

## Investigation Log

- **2026-05-12** — Initial stale-lock review/release logic built (commit `7335940`, "add stale lock review and release") — no same-device clear-and-continue path yet.
- **2026-07-02** — Commit `52a6799` — `archiveLockService.clearSelfLock()` added: own-device-only, heartbeat-recency-guarded; new IPC `archive:clearSelfStaleLock`; renderer detects the all-same-device case and offers "Clear & Continue."
- **2026-07-02** (same day, ~5 minutes later) — Commit `659788b` fixes a real regression in the first fix: the Clear & Continue path silently swallowed IPC errors and always re-showed the same dialog, making the button appear broken when `clearSelfLock` returned `ok: false`. Added a `force` option (bypasses the heartbeat-recency guard only when no background sync job is active, gated on `_syncingJobIds.size === 0`) and surfaced failures inline in the dialog instead of silently retrying.

## Fix

`services/archiveLockService.js`: `clearSelfLock()` (line ~177, `force` param ~197) — same-device-only, heartbeat-recency-guarded by default, with a narrowly-scoped `force` bypass gated on no active background sync job. `releaseStaleLock()` (line 227) and `_isValidLockPath()` (line 259) round out the mechanism. Surfaced through the Archive Diagnostics repair UI (AI-FEAT-043). Failures are now shown inline in the dialog rather than silently retried.

## Prevention / Reusable Lesson

A "safe recovery" action that can legitimately fail (e.g. a guard rejecting the clear because a sync job is still active) must never silently retry the same dialog via `.catch(() => {})` — the operator needs an explicit, human-readable reason inline. A `force` bypass of a safety guard must be scoped as narrowly as possible (same-device only, no active job, explicit user action, auditable) rather than granted broadly — see [DEC-013](../decisions/DEC-013_LOCK_CLEARING_MUST_BE_CONSTRAINED.md).

**Scope caveat**: this lock mechanism is event/photographer-editing-scoped, not confirmed to be the same mechanism behind AI-FEAT-038's Transfer Export "single-export-at-a-time" guard — do not conflate the two when debugging a similar-looking busy/lock symptom in Transfer Export.

## Related

- [AI-FEAT-045 — Archive Lock Handling & Stale-Lock Recovery](../features/AI-FEAT-045_ARCHIVE_LOCK_HANDLING_STALE_LOCK_RECOVERY.md)
- [DEC-013 — Lock Clearing Must Be Constrained](../decisions/DEC-013_LOCK_CLEARING_MUST_BE_CONSTRAINED.md)
