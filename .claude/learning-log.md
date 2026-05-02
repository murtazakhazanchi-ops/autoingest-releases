# AutoIngest Agent Learning Log

This file records reusable lessons from completed AutoIngest work.

Purpose:
- Capture recurring mistakes.
- Capture durable implementation rules.
- Capture validation checks.
- Capture architecture decisions that should influence future agent behavior.

Rules:
- This file may contain proposed lessons.
- Not every lesson should be promoted to agent files.
- Temporary one-off notes should stay out.
- Do not paste screenshots or long chat history.
- Keep entries concise and reusable.

---

### 2026-05-02 — Release v0.8.1 Preparation

Task type:
- Feature Status / Release / Documentation

What happened:
- v0.8.0 was committed and tagged without adding an entry to `docs/history.md`. The gap was discovered during v0.8.1 release prep when `docs/history.md` still showed v0.7.4-dev as the latest entry.
- v0.8.1 was the first release where `docs/history.md` was explicitly updated as part of the release commit.

Reusable lesson:
- `docs/history.md` is the canonical release history file for AutoIngest. Every tagged release must have a matching entry there. There is no separate CHANGELOG. If a prior release is missing its entry, note the gap rather than backfill it with invented content.

Common failure mode:
- Committing and tagging a release without appending to `docs/history.md`, leaving the version history permanently inconsistent.

Preferred pattern:
- During every release: read `docs/history.md`, append a new `## vX.Y.Z` section following the established format (Changes / System Impact / Notes), then include the doc update in the release commit.

Promote to agents:
- release-docs-writer.md

Status:
- Promoted

---

### 2026-05-02 — Three Bug Fixes: Activity Log OOM, CSP Inline Script, Event State Restoration

Task type:
- Performance / Security / Renderer / Event System / Debugging

What happened:

**Fix 1 — Activity Log OOM (main/main.js):**
`master:scanEvents` IPC handler included full `_eventJson` objects (containing large `imports[]` arrays) for every event in the master scan result. When many events were present, the structured-clone serialization caused V8 heap OOM in the renderer before the renderer could strip the data. Fix: destructure `imports` out of `eventJson` at the IPC handler (main process) before pushing to the response array. The renderer now receives only non-`imports` fields; `imports` are loaded lazily per event via `readEventJson`.

**Fix 2 — CSP inline script violation (renderer/index.html + renderer/theme-init.js):**
Theme detection IIFE was inlined in `index.html`, violating `script-src 'self'` CSP. Fix: externalized to `renderer/theme-init.js` and replaced the inline `<script>` block with `<script src="theme-init.js"></script>`.

**Fix 3 — Event state restoration inconsistency (renderer/eventCreator.js + renderer/renderer.js):**
`resetToList()` called `setEventState([])`, clearing `_eventComps`, but did not clear `selectedCollection`, `activeMaster`, `_activeEventIdx`, etc. If the modal was closed after "Change Event" without re-selecting, `getActiveEventData()` returned stale data while `_eventComps` was empty. The import handler's `[IMPORT FIX]` workaround tried `setEventComps(eventData.event.components)` but `setEventState` silently rejects disk-format components (no `eventTypes` property), causing `liveComps` to fall back to raw disk-format components and triggering a false "Complete all event details" validation failure.
Additionally, the stale-path branch of `restoreLastEvent` returned early without resetting `selectedCollection`, `activeMaster`, `_viewingExisting`, `_scannedEvents`.
Fixes:
- `restoreLastEvent` stale path: added explicit reset of all associated session fields before returning.
- New `reloadForImport(eventPath)` API on EventCreator: reads fresh components from disk via `loadEventFromDisk` → `setEventState`, always in session format.
- Import handler: removed `[IMPORT FIX]` hack; replaced with `reloadForImport` when `_eventComps` is empty; `liveComps` is now always `getEventComps()` with no disk-format fallback.

Reusable lessons:

1. **IPC payload stripping must happen at the source (main process), not only in the renderer cache.** Heavy nested arrays (`imports[]`, large metadata) must be excluded at the IPC handler level. Relying on the renderer to strip after structured-clone is too late and can OOM the renderer.

2. **No inline `<script>` blocks in Electron renderer HTML when `script-src 'self'` CSP is active.** All JavaScript must be in external `.js` files loaded via `src=""`. This applies to any initialization, theme detection, or startup logic.

3. **Partial state clears in renderer session modules are a recurring bug class.** When resetting event session state, every field that was set together must be cleared together. A function that clears the component list but leaves the active event reference, collection, and index intact creates desynced state. A reset function must be comprehensive or it must not be called a reset.

4. **Import handlers must not fall back to raw disk-format components from a cached event object.** When session-state components are empty or unavailable, the correct path is to reload from disk via a clean API that produces session-format data. Using `eventData.event.components` (disk format) directly bypasses normalization and produces false validation failures.

Common failure modes:
- Stripping heavy IPC data in the renderer when it should be stripped in the main-process handler before serialization.
- Inlining `<script>` blocks in renderer HTML to add initialization logic.
- Partial-clearing renderer session state (clearing one field but not all related fields).
- Falling back to raw disk-format components when session-format data is missing.

Promote to agents:
- performance-auditor.md (IPC stripping at source)
- ui-system-specialist.md (no inline scripts / CSP)
- event-data-guardian.md (partial state clear and disk-format component fallback)

Status:
- Promoted

---

## Entry Template

### YYYY-MM-DD — Task Name

Task type:
- UI / Renderer / Ingestion / Event System / Data Model / Performance / Debugging / Contracts / Feature Status / Security / Persistence

What happened:
- Brief factual summary.

Reusable lesson:
- Durable lesson learned.

Common failure mode:
- What to avoid in future.

Preferred pattern:
- Correct future approach.

Promote to agents:
- agent-name.md
- agent-name.md

Status:
- Proposed / Promoted / Rejected / Superseded
