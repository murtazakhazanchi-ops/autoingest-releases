# AI-FEAT-030 — Metadata Durable Queue & Crash Recovery

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-030 |
| Category | Metadata |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | AI-FEAT-029 |
| Subfeatures | None |
| Dependencies | AI-FEAT-029 |
| Related roadmap milestone | AI-RM-001 |
| Related technical docs | `docs/metadata-system.md` § Durable Queue Storage and Recovery Behavior |
| Evidence status | Verified from docs (already fully read as required context) and `test/metadataCrashRelaunch.test.js`, `test/metadataQueueResume.test.js` |
| First-known implementation | Evidence pending |
| Latest major update | Evidence pending |

## Summary

Metadata batches are durable, not in-memory-only, under `userData/metadata-queue/`. Crash-recoverable: proven via a real `SIGKILL` mid-batch + relaunch test, not only a hand-constructed simulation.

## Current Behavior

`{batchId}.manifest.json` — written once atomically (temp-file + rename) before any file is processed; immutable thereafter. `{batchId}.journal.jsonl` — append-only, one line per per-file status transition; a corrupt/torn trailing line is quarantined to a `.quarantine` sibling file, never silently dropped. Startup recovery (`main/metadataQueueRecovery.js`'s `resumeInterruptedBatches()`) runs once, 3 seconds after launch (after splash, non-blocking): replays every active batch, normalizes any file left `writing` to `interrupted`, resumes via the shared write engine. Before resuming, it re-resolves the file's expectation from *current* `event.json` and compares against the frozen one — if they materially differ (e.g. operator edited event location between queuing and crash), the file is marked `stale` (re-audit required) rather than silently rewritten. Compaction: once `metadataState` durably reflects a batch's outcome, manifest+journal move to `metadata-queue/compacted/`, retained 90 days (`COMPACTED_RETENTION_MS`), then best-effort pruned.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

No dated entries beyond AI-FEAT-029's general metadata-architecture timeline were found specific to this subfeature.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `main/metadataQueueRecovery.js`
- `main/metadataQueueStore.js`
