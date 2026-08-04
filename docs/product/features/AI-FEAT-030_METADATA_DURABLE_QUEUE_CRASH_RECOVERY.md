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

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | None beyond Dependencies/Parent/Subfeatures already listed in the header table above |
| Related decisions | [DEC-008](../decisions/DEC-008_DURABLE_METADATA_SURVIVES_RESTART.md) |
| Related bugs | [BUG-010](../bugs/BUG-010_METADATA_QUEUE_IN_MEMORY_LOSS_ON_CRASH.md) |
| Related postmortems | [PM-001](../postmortems/PM-001_METADATA_CORRECTNESS_GAP_PRODUCTION_READINESS_REVIEW.md) |
| Related architectural evolution sections | [§3C — C. Metadata Automation](../11_ARCHITECTURAL_EVOLUTION.md#c-metadata-automation) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | Referenced in 5 test file(s) (mechanical name/import match, not a coverage percentage — the test suite was not executed for this documentation pass): `test/fieldSpecsConsistency.test.js`, `test/metadataQueueResume.test.js`, `test/metadataQueueStore.test.js`, `test/metadataRepairService.test.js`, `test/metadataStateService.test.js` |
| Documentation completeness | Partial — 3 unresolved evidence gaps in this file (see fields/sections marked "Evidence pending" above) |

## Summary

Metadata batches are durable, not in-memory-only, under `userData/metadata-queue/`. Crash-recoverable: proven via a real `SIGKILL` mid-batch + relaunch test, not only a hand-constructed simulation.

## Current Behavior

`{batchId}.manifest.json` — written once atomically (temp-file + rename) before any file is processed; immutable thereafter. `{batchId}.journal.jsonl` — append-only, one line per per-file status transition; a corrupt/torn trailing line is quarantined to a `.quarantine` sibling file, never silently dropped. Startup recovery (`main/metadataQueueRecovery.js`'s `resumeInterruptedBatches()`) runs once, 3 seconds after launch (after splash, non-blocking): replays every active batch, normalizes any file left `writing` to `interrupted`, resumes via the shared write engine. Before resuming, it re-resolves the file's expectation from *current* `event.json` and compares against the frozen one — if they materially differ (e.g. operator edited event location between queuing and crash), the file is marked `stale` (re-audit required) rather than silently rewritten. Compaction: once `metadataState` durably reflects a batch's outcome, manifest+journal move to `metadata-queue/compacted/`, retained 90 days (`COMPACTED_RETENTION_MS`), then best-effort pruned.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

No dated entries beyond AI-FEAT-029's general metadata-architecture timeline were found specific to this subfeature.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending — no independently-verified first-implementation date exists in this file's header table.

**Architectural / workflow decisions**: [DEC-008](../decisions/DEC-008_DURABLE_METADATA_SURVIVES_RESTART.md) — see the Decisions section above and each record's own "Decision"/"Consequences" fields for what changed and why.

**Reliability / correctness fixes**: [BUG-010](../bugs/BUG-010_METADATA_QUEUE_IN_MEMORY_LOSS_ON_CRASH.md) — see the Known Bugs section above and each record's own "Root Cause"/"Fix" fields for what changed and why.

**Other dated milestones**: Evidence pending — Evolution / Implementation Journal above has no dated entries.

## Known Bugs / Troubleshooting

See [BUG-010 — Metadata Batches Held Only In-Memory, Lost on Crash/Restart](../bugs/BUG-010_METADATA_QUEUE_IN_MEMORY_LOSS_ON_CRASH.md) — this feature's durable manifest+journal architecture is the fix.

## Decisions

See [DEC-008 — Durable Metadata Work Survives Restart](../decisions/DEC-008_DURABLE_METADATA_SURVIVES_RESTART.md).

## Future Enhancements

None recorded.

## Related Files

- `main/metadataQueueRecovery.js`
- `main/metadataQueueStore.js`
