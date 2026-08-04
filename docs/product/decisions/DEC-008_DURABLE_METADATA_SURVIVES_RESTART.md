# DEC-008 — Durable Metadata Work Survives Restart

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-030, AI-RM-001 |
| Status | Accepted |
| Date | 2026-08-02 (commits `7372239`, `95af167`) |
| Evidence status | Verified from Git history and code (`main/metadataQueueStore.js`, `main/metadataQueueRecovery.js`, `docs/metadata-system.md` § Durable Queue Storage and Recovery Behavior) |

## Context

Metadata batches involve writing tags across potentially many files, a process that can take long enough to be interrupted by a crash, a forced quit, or an unexpected shutdown. Before this decision, that work existed only in process memory (see [BUG-010](../bugs/BUG-010_METADATA_QUEUE_IN_MEMORY_LOSS_ON_CRASH.md)) — an interruption silently lost track of what had and hadn't been completed.

## Options Considered

1. **In-memory-only batch tracking** — the pre-existing state. Rejected: directly evidenced as producing silent work loss on crash/restart, with no resume mechanism.
2. **Durable manifest + append-only journal per batch, replayed at startup** — the option that was built.

## Decision

Metadata batches are durable, not in-memory-only, under `app.getPath('userData')/metadata-queue/`. `{batchId}.manifest.json` is written once, atomically, before any file is processed, and is immutable thereafter. `{batchId}.journal.jsonl` is append-only, one line per per-file status transition; a corrupt/torn trailing line is quarantined, never silently dropped. Startup recovery (`resumeInterruptedBatches()`, run once 3 seconds after launch, non-blocking) replays every active batch, normalizes interrupted files, and resumes via the shared write engine — re-resolving against *current* `event.json` and marking a file `stale` (not silently rewritten) if the evidence materially changed since queuing. This has been verified against a real `SIGKILL` mid-batch followed by a fresh relaunch, not only a hand-constructed simulation, with zero duplicate keywords and zero lost work.

Copy completion and metadata completion are explicitly separate states — a file's copy succeeding does not imply its metadata batch has (or has ever needed to) complete; the durable queue exists specifically to make that distinction survive a restart.

## Consequences

- Compacted batches are retained for 90 days (`COMPACTED_RETENTION_MS`) before best-effort pruning — any change to that retention window is a deliberate policy change, not an incidental one.
- Any future long-running, multi-step operation that writes to the archive should be evaluated against this same durability bar — an in-memory-only equivalent would reintroduce the class of defect this decision closed (see [BUG-010](../bugs/BUG-010_METADATA_QUEUE_IN_MEMORY_LOSS_ON_CRASH.md)'s Prevention/Reusable Lesson).
- Startup recovery must remain non-blocking and deliberately delayed past the splash screen — a design that made crash recovery block app launch would violate the spirit of this decision even if it satisfied durability.

## Reconciliation Note

None recorded — matches `docs/metadata-system.md`'s current § Durable Queue Storage and Recovery Behavior exactly.
