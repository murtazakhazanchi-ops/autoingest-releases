# AI-FEAT-010 — Event Management & Editing

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-010 |
| Category | Event Management |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-004, AI-FEAT-009 (reuses EventCreator state via `reloadForImport`) |
| Related roadmap milestone | None |
| Related technical docs | `docs/event-system.md` § Editing, `docs/failure-patterns.md` #1, #12 |
| Evidence status | Verified from current code, docs, and learning-log.md |
| First-known implementation | Evidence pending (dedicated `eventMgmt.js` module existed by at least 2026-05-14 per learning-log Phase 13C-10) |
| Latest major update | v0.8.6 (`reloadForImport` API addition) |

## Summary

Selecting an existing event, editing it safely, and listing/picking events (`master:scanEvents`). Distinct from Event Creation (AI-FEAT-009) — has its own renderer module (`renderer/eventMgmt.js`) rather than being a mode of the creator wizard.

## Current Behavior

Editing is a safe rename with validation; no overwriting; legacy events (pre-dating current conventions) are handled separately. `event.json` must be updated before filesystem changes, and mapping integrity must be preserved. `master:scanEvents` powers the event list/picker; as of v0.8.6 it strips `imports[]`/`_eventJson` before the IPC push (renderer memory-safety pattern — see 01_FEATURE_REGISTRY.md's Cross-Cutting Patterns section and `docs/failure-patterns.md` #12), loading per-event history lazily via `readEventJson` on selection. `reloadForImport(eventPath)` (added v0.8.6) reads fresh component state from disk via `loadEventFromDisk` → `setEventState`, replacing an earlier session-store fallback.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

- **v0.8.6** — `master:scanEvents` IPC memory-safety fix (strips `imports[]`); `restoreLastEvent` stale-path branch fully resets state before returning early; `reloadForImport` added, replacing a session-store fallback (`docs/history.md`).
- **2026-05-14** — "Phase 13C-10: EventMgmt SELECT Guard Blocks `_renderEventForm` in Redirect Paths" (learning-log) — a guard bug in event selection/redirect handling was found and fixed.
- **2026-05-02** — "Three Bug Fixes: Activity Log OOM, CSP Inline Script, Event State Restoration" (learning-log) includes an event-state-restoration fix relevant to this feature.

## Known Bugs / Troubleshooting

None recorded in `docs/product/bugs/` yet — see the learning-log entries above for narrative detail on the Phase 13C-10 guard bug.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `renderer/eventMgmt.js`
