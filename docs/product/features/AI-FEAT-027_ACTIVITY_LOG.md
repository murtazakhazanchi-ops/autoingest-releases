# AI-FEAT-027 — Activity Log

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-027 |
| Category | Import and Archive Writing |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | AI-FEAT-026 (Verify Integrity is surfaced here) |
| Dependencies | AI-FEAT-004, AI-FEAT-010 (shares the memory-safe picker/lazy-load pattern) |
| Related roadmap milestone | None |
| Related technical docs | `docs/features.md` #9, `docs/failure-patterns.md` #12 |
| Evidence status | Verified from docs (already fully read as required context) |
| First-known implementation | Evidence pending |
| Latest major update | v0.8.6 (OOM fix) |

## Summary

On-demand audit view for any event in the master archive: import history grouped by date with event-level summary (photo count, video count, session count, last import attribution), with binary issue detection (amber "Check" badge on entries with missing/invalid fields).

## Current Behavior

Event picker loads event names from a lightweight cache; per-event history is loaded lazily on selection — the exact same renderer-memory-safety pattern used by AI-FEAT-010's event list. "Check Imports" warning shows at summary level only when issues exist (no false positives for old entries). Does not mutate active event selection or any import data (read-only).

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

- **v0.7.4-dev** — Activity Log OOM fix: `_alEventList` stores only lightweight picker data; per-event `event.json` loaded lazily on picker change.
- **v0.8.6** — `master:scanEvents` strips `imports[]` before the IPC push, eliminating the V8/Oilpan OOM crash on Activity Log open for archives with large import histories (`docs/history.md`, `docs/failure-patterns.md` #12).
- **v0.8.7 / v0.8.1 era** — "Activity Log Tabbed UI, Source Cleanup Tracking, and Retry Failed Metadata" and "Activity Log Tab Content Separation" (learning-log, 2026-05-05/06).

## Known Bugs / Troubleshooting

See `docs/failure-patterns.md` #12 (Renderer OOM — Large IPC Allocation) — this feature was one of the two real-world triggers for that failure pattern (the other being AI-FEAT-010's event list).

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `renderer/renderer.js` (Activity Log module)
