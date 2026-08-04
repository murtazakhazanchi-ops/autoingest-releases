# BUG-010 — Metadata Batches Held Only In-Memory, Lost on Crash/Restart

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-029, AI-FEAT-030 |
| Status | Fixed |
| Severity | High |
| Discovered | Evidence pending exact discovery date — fixed 2026-08-02 |
| Fixed | 2026-08-02 |
| Evidence status | Verified from Git history — `main/metadataQueueStore.js` and `main/metadataQueueRecovery.js` both show their first commit as `7372239`/`95af167` (2026-08-02); no durable queue store existed before that date |

## Symptom

Before the durable queue existed, a metadata batch in progress — EXIF/IPTC/XMP tag writes across a set of files — had no persistent record of its own state. An application crash or forced quit mid-batch would silently discard track of which files still needed metadata, with no automatic resume and no durable indication of what was left incomplete.

## Root Cause

Metadata batch state lived only in process memory. `git log --follow -- main/metadataQueueStore.js` and the same for `main/metadataQueueRecovery.js` both show their first commit is the 2026-08-02 architecture commit — confirming no `{batchId}.manifest.json` / `{batchId}.journal.jsonl` durable store existed prior to that date. There was no mechanism by which a restarted process could learn what a crashed process had been in the middle of doing.

## Investigation Log

- No separate "discovered, then later fixed" timeline is evidenced in Git history — the gap is inferred directly from the absence of any durable queue implementation before the fix commits, not from a reported incident. This is standard architectural-gap evidence (file did not exist → file now exists, in the same commit that also introduces crash-recovery logic), not a narrative of a live failure being observed and diagnosed.

## Fix

Commits `7372239` and `95af167` (both 2026-08-02). Metadata batches are now durable under `app.getPath('userData')/metadata-queue/`:
- `{batchId}.manifest.json` — written once, atomically (temp-file + rename), before any file in the batch is processed; immutable thereafter.
- `{batchId}.journal.jsonl` — append-only, one line per per-file status transition; a corrupt/torn trailing line is quarantined to a `.quarantine` sibling, never silently dropped.
- Startup recovery (`main/metadataQueueRecovery.js`'s `resumeInterruptedBatches()`) runs once, 3 seconds after launch: replays every active batch, normalizes any file left `writing` to `interrupted`, and resumes it via the shared write engine. Before resuming, it re-resolves the file's expectation from *current* `event.json` and compares against the frozen one — if they materially differ (e.g. the operator edited the event's location between queuing and the crash), the file is marked `stale` (re-audit required) rather than silently rewritten.
- Proven via a real `SIGKILL` mid-batch followed by a fresh app launch, not only a hand-constructed simulation — zero duplicate keywords, zero lost work (`docs/product/features/AI-FEAT-030_METADATA_DURABLE_QUEUE_CRASH_RECOVERY.md`).

## Prevention / Reusable Lesson

Any multi-step, potentially long-running write operation needs a persistent, resumable record of its own progress **before** it starts touching files — in-memory-only progress tracking is invisible to crash recovery by construction, no matter how reliable the happy path is. When adding durable recovery to an existing in-memory operation, verify the recovery logic against a real process kill (`SIGKILL`), not only a simulated interruption — a simulation can miss OS-level partial-write states a real kill exposes. See [DEC-008](../decisions/DEC-008_DURABLE_METADATA_SURVIVES_RESTART.md) for the decision this fix established.

## Related

- [AI-FEAT-029 — Metadata Writing Engine](../features/AI-FEAT-029_METADATA_WRITING_ENGINE.md)
- [AI-FEAT-030 — Metadata Durable Queue & Crash Recovery](../features/AI-FEAT-030_METADATA_DURABLE_QUEUE_CRASH_RECOVERY.md)
- [DEC-008 — Durable Metadata Work Survives Restart](../decisions/DEC-008_DURABLE_METADATA_SURVIVES_RESTART.md)
- [BUG-009 — Same-Size Skip Left Metadata Unverified](BUG-009_SAME_SIZE_SKIP_METADATA_UNVERIFIED.md) (fixed in the same commit cluster)
- [PM-001 — Metadata Correctness Gap Found in Production-Readiness Review](../postmortems/PM-001_METADATA_CORRECTNESS_GAP_PRODUCTION_READINESS_REVIEW.md)
