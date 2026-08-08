# BUG-011 — master:scanEvents / NAS archive scan collapse read-failure into "zero events/collections"

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-009, AI-FEAT-010 |
| Status | Fixed |
| Severity | High |
| Discovered | 2026-08-07 |
| Fixed | 2026-08-07 |
| Evidence status | Recorded by automated documentation orchestration from session `sess-2026-08-07T13-53-49-871Z-1bbbe4`; evidence source(s): explicit-user-statement, code-diff, test-output |

## Symptom

Event Management showed "Existing Events (0)" / "No resolvable events yet." for a collection that physically contained a valid, event.json-backed event on the NAS archive. The same collection sometimes showed its events correctly and sometimes did not, on the same machine and archive, with nothing about the archive itself changing.

## Root Cause

main/main.js's master:scanEvents IPC handler (used by Event Management to list a selected collection's events) caught ANY fsp.readdir() failure — including transient NAS/SMB read errors (permission blips, timeouts, disconnects) that have nothing to do with the collection's actual contents — and returned a bare empty array, identical to what a genuinely empty collection returns. The renderer (eventCreator.js's _scanAndRenderEventList) had no way to distinguish "scan failed" from "confirmed empty" and rendered the error case as "No resolvable events yet." The sibling NAS-wide scanner, _scanNasArchive/_runNasScan, had the same defect one level up: a marker-file read failure that was not ENOENT was reported as 'invalid-nas' (implying a misconfigured archive) instead of a transient-unreachable state, and a readdir failure on a single collection folder mid-scan silently produced a collection entry with events: [] and no error flag at all. On a local macOS/dev filesystem these transient failures are rare enough to go unnoticed; over a Windows UNC/SMB mount to a NAS they are common, which is why this was Windows/NAS-tester-visible and not caught earlier.

## Investigation Log

- **2026-08-07** — Traced the Event Management "Existing Events" list to master:scanEvents (main/main.js) and confirmed via code reading, then via a live Electron run (test/eventManagementReliabilityLive.test.js TEST B) that chmod 0000 on a real collection folder produced the exact same shape as a genuinely empty collection before the fix, and now returns {ok:false, events:[], errorReason:'EACCES'} distinguishable from {ok:true, events:[]}. Also found the same error-collapsing pattern in _scanNasArchive's top-level readdir catch (classified any non-ENOENT/ENOTCONN/EIO error as 'invalid-nas') and its per-collection readdir catch (silently pushed events: [] with no flag), and in _runNasScan's marker-file read (any non-ENOENT read error was reported as 'invalid-nas'). Confirmed _runNasScan already validates the archive-root marker before calling _scanNasArchive, so a readdir failure inside _scanNasArchive can only be transient, never evidence of an invalid archive — the prior invalid-nas classification there was never reachable-and-correct.

## Fix

main/main.js: master:scanEvents now returns {ok:true, events:[...]} on success and {ok:false, events:[], errorReason} on any readdir failure, instead of a bare array. _scanNasArchive's top-level readdir failure now always reports 'nas-disconnected' (transient/unreachable) rather than ever reporting 'invalid-nas' from that call site, since invalidity is already ruled out by the caller's prior marker check; its per-collection readdir failure now sets collection.scanError = true instead of silently looking like zero events. _runNasScan's marker read and JSON.parse are now separate try/catch blocks so a transient read failure (any non-ENOENT error) reports 'nas-disconnected', while only a genuinely corrupt or wrong-type marker reports 'invalid-nas'. renderer/eventCreator.js's _scanAndRenderEventList now checks the {ok, events, errorReason} shape: on a failed re-scan it keeps showing the last known-good _scannedEvents list (never overwrites good data with an error result) and renders a "could not read events right now" banner with a Retry button instead of silently showing "No resolvable events yet."; on a first-ever failed scan (no prior good data) it shows the same error+Retry state instead of the misleading empty-list text. renderer/renderer.js's Archive Locations event picker was updated for the new {ok, events} return shape.

**Post-review refinement (same session)**: `code-reviewer` found that the Activity Log picker's initial update (renderer/renderer.js) unwrapped `.events` but silently discarded `errorReason` on failure, re-collapsing a scan failure into "no events" — the exact pattern this bug fixes, on a different screen. Now logs a console warning distinguishing a failed scan from a genuinely empty collection for that picker too; it does not carry the full Retry-banner UI the primary Event Management list has, since it's a secondary picker where an explicit retry affordance was judged out of scope for this fix.

## Prevention / Reusable Lesson

Any IPC handler that reads a NAS/UNC path must never collapse a caught filesystem error into the same shape as "confirmed empty" — return an explicit ok/error signal so the renderer can distinguish "nothing here" from "could not check." When adding a second layer that validates a precondition before calling a lower-level scan function (e.g. _runNasScan validating the marker before calling _scanNasArchive), the lower-level function can safely assume that precondition already holds and should not re-guess "invalid" from a bare readdir failure.

## Related

None recorded.
