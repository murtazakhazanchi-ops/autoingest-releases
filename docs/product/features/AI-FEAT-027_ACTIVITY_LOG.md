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

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | None beyond Dependencies/Parent/Subfeatures already listed in the header table above |
| Related decisions | None recorded |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | [§3D — D. Archive Integrity and Transaction Safety](../11_ARCHITECTURAL_EVOLUTION.md#d-archive-integrity-and-transaction-safety) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | Evidence pending — this feature's related files are shared, multi-feature modules (e.g. `main/main.js`, `renderer/renderer.js`); automated basename matching against test/ is unreliable for these and was not attempted |
| Documentation completeness | Mostly complete — 2 unresolved evidence gap(s) in this file (see fields/sections marked "Evidence pending" above) |

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

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending — no independently-verified first-implementation date exists in this file's header table.

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: 3 entries exist in the Evolution / Implementation Journal above; not individually re-classified by milestone type here to avoid restating evidence — read that section directly for the full dated sequence.

## Known Bugs / Troubleshooting

See `docs/failure-patterns.md` #12 (Renderer OOM — Large IPC Allocation) — this feature was one of the two real-world triggers for that failure pattern (the other being AI-FEAT-010's event list).

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `renderer/renderer.js` (Activity Log module)
