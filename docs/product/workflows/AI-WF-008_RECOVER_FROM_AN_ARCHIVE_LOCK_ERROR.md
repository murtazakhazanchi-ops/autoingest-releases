# AI-WF-008 — Recover From an Archive Lock Error

| Field | Value |
|---|---|
| Workflow ID | AI-WF-008 |
| Domain | Archive Management |
| Related capabilities | AI-FEAT-045, AI-FEAT-043 |
| Related roadmap milestone | None |
| Navigation verified | Yes |
| Evidence status | Verified from `services/archiveLockService.js` (cited directly in AI-FEAT-045's Current Behavior section) and `renderer/index.html` (`#diagTitle`, line 8698) |

## What It Does

Recovers from a stale photographer-folder import lock — a real, evidenced, distinct mechanism from both the Online Registry's sync-slot coordination (see AI-WF-006) and from Transfer Export's own separate concurrency guard.

## When To Use It

When AutoIngest reports that an event/photographer folder is locked and you believe no other import is actually in progress against it (e.g. after a crash on the same or another device).

## Before You Start

Confirm no import is genuinely still running against the same event/photographer combination before clearing a lock — this workflow does not state what happens if a lock is cleared while a real import is still active, because that isn't evidenced in this pass.

## Where To Go

**Archive Diagnostics** modal (`#diagTitle`, `renderer/index.html:8698`), reached from the Archive Health surface (AI-FEAT-043). The modal has a **"Run Diagnostics"** button (`#diagRunBtn`) confirmed in code. **The specific button/control used to release a stale lock from within this modal was not located in this pass** — the underlying capability (`releaseStaleLock()`, IPC channels `archive:releaseStaleLock` / `archive:clearSelfStaleLock`) is confirmed to exist in AI-FEAT-045's own record, but this workflow does not invent the exact UI control for triggering it.

## Steps

1. Open **Archive Diagnostics**.
2. Run diagnostics to surface the current lock state.
3. Use the lock-release capability once located and confirmed — not stated as a specific click sequence here, since it was not independently verified in this pass.

## What Happens Next / Expected Result

A genuinely stale lock (past its 30-minute TTL with no heartbeat renewal) is released, allowing import to proceed again for that event/photographer.

## Important Limitations

Lock-clearing is deliberately constrained (DEC-013, "Lock Clearing Must Be Constrained") — this is not an unrestricted "force unlock" action; consult DEC-013 directly for the exact constraint rationale rather than assuming it is unrestricted.

## Warnings

A real, historical bug existed here: a same-device stale lock could block all future imports (BUG-004) — fixed. This is direct evidence this exact failure mode is real and has occurred before, not hypothetical.

## Troubleshooting

If a lock error appears and you're confident it's stale, BUG-004's record documents the historical root cause and fix for the same-device case specifically.

## Related Actions

AI-WF-006 if the actual question is about Online Registry presence/coordination rather than this archive-level file lock — the two are separate mechanisms and should not be conflated.

## Source

`docs/product/features/AI-FEAT-045_*.md` (citing `services/archiveLockService.js`); `renderer/index.html:8698`; `docs/product/decisions/DEC-013_*.md`; `docs/product/bugs/BUG-004_*.md`.
