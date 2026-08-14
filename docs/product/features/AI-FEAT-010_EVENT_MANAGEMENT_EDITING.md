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

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | None beyond Dependencies/Parent/Subfeatures already listed in the header table above |
| Related decisions | [DEC-001](../decisions/DEC-001_EVENT_DATA_AS_DURABLE_ARCHIVE_TRUTH.md) |
| Related bugs | [BUG-001](../bugs/BUG-001_SOURCE_CLEANUP_POST_IMPORT_STATE_OWNERSHIP.md) *(found via reverse lookup — not yet cross-linked in the Known Bugs section above)*; [BUG-006](../bugs/BUG-006_EVENT_EDIT_FULL_PAYLOAD_FIELD_DROP.md) |
| Related postmortems | None |
| Related architectural evolution sections | Not yet covered in 11_ARCHITECTURAL_EVOLUTION.md's relationship map |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | No dedicated test file identified via automated search of `test/` (17 test files exist repository-wide, concentrated in the metadata subsystem — see AI-FEAT-029 through AI-FEAT-033) |
| Documentation completeness | Mostly complete — 2 unresolved evidence gap(s) in this file (see fields/sections marked "Evidence pending" above) |

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

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending (dedicated `eventMgmt.js` module existed by at least 2026-05-14 per learning-log Phase 13C-10) (see header table's "First-known implementation" field for citation).

**Architectural / workflow decisions**: [DEC-001](../decisions/DEC-001_EVENT_DATA_AS_DURABLE_ARCHIVE_TRUTH.md) — see the Decisions section above and each record's own "Decision"/"Consequences" fields for what changed and why.

**Reliability / correctness fixes**: [BUG-001](../bugs/BUG-001_SOURCE_CLEANUP_POST_IMPORT_STATE_OWNERSHIP.md); [BUG-006](../bugs/BUG-006_EVENT_EDIT_FULL_PAYLOAD_FIELD_DROP.md) — see the Known Bugs section above and each record's own "Root Cause"/"Fix" fields for what changed and why.

**Other dated milestones**: 3 entries exist in the Evolution / Implementation Journal above; not individually re-classified by milestone type here to avoid restating evidence — read that section directly for the full dated sequence.

## Known Bugs / Troubleshooting

See [BUG-006 — Event-Edit Full-Payload Save Silently Drops Untracked Fields](../bugs/BUG-006_EVENT_EDIT_FULL_PAYLOAD_FIELD_DROP.md) — a recurring architectural weakness in this feature's own save path, found for two different fields (`adoption`, `status`) roughly three months apart. **Material consequence for this feature**: this save path constructs its output from a hardcoded field list rather than spreading the existing record, so any new `event.json` field this feature's Save action might touch needs both that hardcoded list and the session-capture object (`_viewingExisting`) audited before shipping — otherwise the field can silently vanish on the very next save. See BUG-006's own Prevention / Reusable Lesson section for the full diagnostic procedure. See also the Phase 13C-10 guard-bug learning-log entry above for narrative detail on a separate, unrelated selection/redirect bug.

## Decisions

See [DEC-001 — Event Data as Durable Archive Truth](../decisions/DEC-001_EVENT_DATA_AS_DURABLE_ARCHIVE_TRUTH.md).

## Future Enhancements

None recorded.

## Related Files

- `renderer/eventMgmt.js`
