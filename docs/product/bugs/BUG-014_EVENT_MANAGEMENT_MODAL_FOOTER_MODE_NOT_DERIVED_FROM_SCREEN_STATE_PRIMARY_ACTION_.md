# BUG-014 — Event Management modal footer mode not derived from screen state — primary action can render with no visible button

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-009, AI-FEAT-010 |
| Status | Fixed — Waiting for Windows RC verification |
| Severity | High |
| Discovered | 2026-08-07 |
| Fixed | 2026-08-07 — the tester's RC verification session did not reach the Create Event form (blocked earlier by BUG-011's still-open event-discovery defect), so this fix has real-Windows evidence pending, not yet contradicted or confirmed on the actual hardware. Re-verified locally 2026-08-10 (test/eventManagementReliabilityLive.test.js TEST D/E, unchanged, still passing). |
| Evidence status | Recorded by automated documentation orchestration from session `sess-2026-08-07T13-53-49-871Z-1bbbe4`; evidence source(s): explicit-user-statement, code-diff, test-output |

## Symptom

On the Create New Event form, with a fully valid, populated form (Hijri date, event types, location, city, country, folder preview all present), the primary Create/Continue action was completely missing from the modal footer — only "Back" remained. The form itself rendered correctly; only the primary action was gone.

## Root Cause

Two candidate causes were investigated and one was ruled out. (1) renderer/eventCreator.js's _buildEventHTML() renders an inline #ecEventContinue button (and a .ec-view-actions wrapper) with a hardcoded style="display:none" aria-hidden="true" that no code path ever reverses — but git history shows this was introduced in the SAME commit that added eventMgmt.js's docked modal footer (#emmCreateBtn etc.), and the real, currently-used primary-action buttons for the modal footer are #emmCreateBtn/#emmContinueBtn/etc. in renderer/index.html, driven by EventMgmt._syncFooterButtons() based on EventMgmt's _mode. The inline buttons were confirmed to be superseded/dead UI (ruled out as the cause; left hidden as-is). (2) The docked footer's visibility is entirely driven by EventMgmt's _mode ('master'|'select'|'create'|'edit'|'repair'), which is set only by the specific caller that transitions into each screen (e.g. the "+ Create New Event" button click sets mode='create' before calling _renderEventForm()). _renderEventForm() itself never set or derived the mode — it only had a narrow guard against mode==='select'. showEventStep() can reach _renderEventForm() directly, skipping the event list (where mode is normally set), whenever _scannedEvents or _eventComps are still populated from a prior visit in the same session — in that path, the footer mode is left at whatever the previous screen set it to (e.g. 'master', which _syncFooterButtons() renders with NO primary action at all, only Back), even though the form itself renders fully and correctly from unrelated state.

## Investigation Log

- **2026-08-07** — Confirmed live via test/eventManagementReliabilityLive.test.js TEST D (normal "+ Create New Event" flow: footer visible+disabled on an empty form, visible+enabled once valid — passed both before and after the fix, since the normal path already set mode correctly) and TEST E (create a second, brand-new collection after already having scanned a different one in the same session — asserts the footer is never left showing only Back). A comment in renderer.js's emmEditBtn click handler ("Point 4: setMode first so the footer updates before the form renders") shows this exact class of bug (mode set by the caller, not derived) was already independently discovered and worked around once for the Edit entry point specifically, which is why the fix here generalizes it into the render function itself instead of adding another one-off caller-side setMode call.

## Fix

renderer/eventCreator.js's _renderEventForm() now derives the correct EventMgmt mode from actual state (_repairMode → 'repair', _viewingExisting → 'edit', else → 'create') and calls EventMgmt.setMode() itself if the current mode does not already match, immediately after the existing select-mode guard. This makes the footer self-correcting regardless of which navigation path reached the form, instead of depending on every caller remembering to set the right mode first.

## Prevention / Reusable Lesson

Derived UI state (what should the footer show right now) should be computed from the screen's own actual data at render time, not remembered by whichever caller last transitioned into that screen. When a render function is reachable from more than one caller, do not rely on caller discipline for state that render function itself can derive.

## Related

None recorded.
