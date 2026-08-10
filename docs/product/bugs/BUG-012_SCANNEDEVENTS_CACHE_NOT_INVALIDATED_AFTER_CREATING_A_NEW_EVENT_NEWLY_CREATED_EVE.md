# BUG-012 — _scannedEvents cache not invalidated after creating a new event — newly-created events invisible on reopen

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-009, AI-FEAT-010 |
| Status | Fixed — Waiting for Windows RC verification |
| Severity | High |
| Discovered | 2026-08-07 |
| Fixed | 2026-08-07 — re-verified locally 2026-08-10 (test/eventManagementReliabilityLive.test.js TEST C/F), not yet confirmed on real Windows/NAS hardware |
| Evidence status | Recorded by automated documentation orchestration from session `sess-2026-08-07T13-53-49-871Z-1bbbe4`; evidence source(s): explicit-user-statement, code-diff, test-output |

## Symptom

After successfully creating a new event (folder + event.json written correctly to the archive), reopening Event Management for the same collection did not show the newly-created event in the "Existing Events" list.

## Root Cause

renderer/eventCreator.js caches the result of the last disk scan for the active collection in a module-level variable, _scannedEvents, and only re-scans when it is null (showEventStep()'s gate). _tryCreateEvent() wrote the new event to disk and pushed it into a SEPARATE in-session array (coll.events) but never invalidated _scannedEvents, so the disk-backed list used to render "Existing Events" kept showing the pre-creation snapshot until something else happened to reset it to null (e.g. explicitly changing collection).

## Investigation Log

- **2026-08-07** — Traced _scanAndRenderEventList/_renderEventList's data source to the module-level _scannedEvents variable and enumerated every place it is reset to null; _tryCreateEvent()'s success path was not one of them. Reproduced live (test/eventManagementReliabilityLive.test.js TEST C): created a second event through the real UI/IPC flow, closed and reopened Event Management for the same collection, and confirmed after the fix that both the pre-existing and the newly-created event appear (2 events) rather than only the original 1.

- **2026-08-08 — Note (not reopened): shares an unverified dependency with BUG-011.** Real Windows/NAS RC verification found that `master:scanEvents` itself is returning zero events for a collection with 38 real, event.json-backed folders (see BUG-011's 2026-08-08 entry) — a defect upstream of this bug's fix, which only concerns cache invalidation *after* a successful scan. This bug's own synthetic-fixture and live-E2E evidence still stands (the cache-invalidation mechanism itself works correctly whenever `master:scanEvents` succeeds), so Status stays Fixed — but this fix has not been independently exercised on the real Windows/NAS hardware yet (the tester never reached the "create a new event" step, since existing-event discovery already failed first). Do not treat this as Windows-verified until BUG-011's root cause is resolved and the tester can actually reach and test event creation.

## Fix

renderer/eventCreator.js: _tryCreateEvent() now sets _scannedEvents = null (and clears _scanError) once the event has actually been persisted to the archive or local staging, immediately before proceeding to the preview/done step — forcing the next entry into the event list to re-scan from durable disk evidence rather than reuse a snapshot that predates the new event.

## Prevention / Reusable Lesson

Any in-memory cache of "what exists on disk" must be invalidated at the exact point a write is known to have succeeded, not left to be invalidated incidentally by an unrelated navigation action. When adding a new write path, check what read-side cache it needs to invalidate before considering the write "done."

## Related

None recorded.
