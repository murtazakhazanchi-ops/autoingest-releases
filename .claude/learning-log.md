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

### 2026-05-04 — Import Progress Modal Footer Cleanup and Clean Up Source Result-State Fix

Task type:
- UI / Renderer / Modal

What happened:

**Part A — Import Progress Modal footer:**
The completion-state footer included a "Report Issue" button injected alongside the success-path actions (Deep Verify, Review Cleanup, Done). "Report Issue" is a debug/fallback action that has no role in a normal success flow. It was removed so the footer cleanly surfaces only success-path controls.

**Part B — Clean Up Source Modal result state:**
After deletion completed, the `.sc-file-list` container (the pre-deletion file selector) was left visible but empty, rendering as an ugly ghost box. Fix: explicitly `list.style.display = 'none'` in the result state alongside hiding `sc-confirm-gate` and `sc-select-all-row`. The Done button was also changed from `sc-btn-cancel` (outline/secondary) to `sc-btn-done` (blue primary), matching import modal convention.

Reusable lessons:

1. **Completion-state modal footers must contain only success-path actions.** Debug/fallback actions (e.g., "Report Issue") do not belong in the normal success footer of an import or operation modal. They are noise in the happy path and should be reserved for error states.

2. **When a modal transitions to a result state, every pre-action container element must be explicitly hidden or removed.** It is not sufficient to clear a list's children or hide only interactive controls. Container elements that held file lists, selectors, or inputs will render as ghost empty boxes if their `display` is not explicitly set to `none`. The rule is: transition to result state = hide all pre-action elements unconditionally.

Common failure modes:
- Adding debug/fallback buttons to success-state footers because they were convenient to inject in the same code block.
- Hiding only child elements (checkboxes, buttons) inside a container while leaving the container itself visible.
- Assuming a container with no children renders as nothing.

Preferred patterns:
- Completion-state footer: `[secondary actions] ... [primary Done]`. No debug actions unless the modal is showing an error.
- Result-state transition: enumerate and hide every pre-action element explicitly. Do not rely on child removal to collapse the container.
- Done buttons in result states should use the primary button style (`sc-btn-done` / blue primary), not the cancel/outline style.

Promote to agents:
- ui-system-specialist.md

Status:
- Promoted

---

### 2026-05-04 — Windows Window Chrome Fix (BrowserWindow Frame + Controls Placement)

Task type:
- Electron / Main Process / Renderer / Platform Compatibility / UI

What happened:

**Fix 1 — BrowserWindow platform-conditional frame (main/main.js):**
`titleBarStyle: 'hiddenInset'` is macOS-only and silently ignored on Windows. Without `frame: false`, Windows always renders the native blue title bar regardless of any renderer-side chrome styling. Fix: platform-conditional spread — macOS gets `titleBarStyle: 'hiddenInset'` + `trafficLightPosition`; non-macOS gets `frame: false`. `Menu.setApplicationMenu(null)` added for non-macOS to suppress the native menu bar. Security settings (`contextIsolation`, `nodeIntegration`, `sandbox`) are always unconditional.

**Fix 2 — Window controls DOM placement (renderer/index.html):**
Custom minimize/maximize/close controls were placed inside `#dashHeader` (the content header). On non-macOS this meant they appeared mid-layout inside every content page, cluttering the header. Fix: controls moved into `#appTitleBar` (the dedicated drag-region title bar element, `position: relative`, `-webkit-app-region: drag`). Controls use `position: absolute; right: 0; top: 0; bottom: 0` and `.wc-btn { -webkit-app-region: no-drag }`. The guard `.is-mac .window-controls { display: none }` hides them on macOS where native traffic lights serve this role.

Reusable lessons:

1. **Cross-platform BrowserWindow frame configuration must use a platform-conditional spread.** `titleBarStyle: 'hiddenInset'` is macOS-only; non-macOS requires `frame: false`. Security webPreferences are always unconditional.

2. **Custom window controls belong in the dedicated drag-region title bar element, not in any content header.** Placing them inside `#dashHeader` or equivalent content containers causes them to appear mid-layout on every platform. Only `#appTitleBar` (or the designated chrome row) is the correct host; a `.is-mac` guard hides them where native traffic lights apply.

Common failure modes:
- Assuming `titleBarStyle: 'hiddenInset'` suppresses the native frame on all platforms.
- Placing custom window controls inside a content header for layout convenience.
- Treating security webPreferences as platform-conditional alongside frame settings.

Preferred patterns:
- Platform spread: `...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition } : { frame: false })` with security settings outside the spread.
- `if (!isMac) Menu.setApplicationMenu(null)` to suppress the native menu bar on Windows/Linux.
- Controls in `#appTitleBar` with `position: absolute` + `-webkit-app-region: no-drag`, hidden on macOS via CSS guard.

Promote to agents:
- autoingest-architect.md (BrowserWindow platform-conditional frame — main-process architectural pattern)
- ui-system-specialist.md (window controls DOM placement — renderer UI structural rule)

Status:
- Promoted

---

### 2026-05-05 — ExifService: Metadata Write Failures, Boolean Encoding, XMP vs IPTC Sidecar Fix

Task type:
- Metadata / Post-Import Hook / ExifTool / Debugging / Architecture

What happened:

**Fix 1 — `XMP-xmpRights:Marked: true` (boolean) caused total write failure:**
`exiftool-vendored`'s `WriteTask.enc()` handles null, number, string, DateTime, Array, and Struct — but throws `Error: cannot encode <value>` for any other type, including booleans. Passing `true` caused every call to `et.write()` to throw before ExifTool was ever invoked. Every file in every batch silently set `status = 'error'`. No metadata was written to any file. Fix: changed to `'True'` (string), which is the correct ExifTool value for XMP boolean fields.

**Fix 2 — ExifTool `-config` must be in `exiftoolArgs`, not `writeArgs`:**
`exiftool-vendored` spawns one persistent ExifTool process per slot using `exiftoolArgs`. Per-write args are sent to stdin after the process is already running — `-config` passed in `writeArgs` arrives too late and is silently ignored. The custom `XMP-ajs` namespace (HijriDate) was never registered. Fix: moved `-config EXIFTOOL_CONFIG` to `exiftoolArgs`, before the required batch-mode flags (`-stay_open True -@ -`). Note: `exiftoolArgs` replaces the default entirely — must include the batch-mode flags when overriding.

**Fix 3 — IPTC:* tags silently dropped when writing to standalone .xmp sidecar files:**
RAW sidecars wrote creator and HijriDate (already XMP tags) but keywords and location were missing. Root cause: `IPTC:Keywords`, `IPTC:City`, `IPTC:Sub-location`, `IPTC:Country-PrimaryLocationName` are not valid in standalone XMP files — there is no IPTC binary segment. ExifTool silently drops these tags. Fix: split `_buildTags` so all writes always include XMP-namespace tags (`XMP-dc:Subject`, `XMP-iptcCore:Location`, `XMP-photoshop:City`, `XMP-photoshop:Country`) and IPTC/EXIF tags are only added for direct image writes (`isRaw = false`).

**Fix 4 — Blank-placeholder detection after event creation:**
After creating a new event, `_tryCreateEvent()` calls `setEventState([_makeComp()])`, leaving `_eventComps` as a single blank component. The prior import guard (`!getEventComps().length`) only caught the length-0 case. The blank placeholder has `eventTypes: []` because `_makeComp()` always produces empty eventTypes. EventCreator's save-gate prevents any persisted event from having empty eventTypes — so `every(c => !c.eventTypes?.length)` is the correct and reliable blank-placeholder signal. Using `city === null` was wrong because `_makeComp()` copies `_globalCityVal` into the placeholder when a global city is set.

**Improvement — Batch failure visibility:**
All metadata write failures were silently accumulated as `batch.failed++` with no prominent surface. Added: `console.error` summary at batch completion (truncated to 10 files + "...and N more"), `batch_error` IPC event to renderer, `showMessage` toast from renderer on `batch_error`, `onclick = openActivityLogModal` on the persistent red error badge.

Reusable lessons:

1. **`exiftool-vendored` `enc()` throws on boolean values.** Use string `'True'`/`'False'` for XMP boolean fields, never JavaScript `true`/`false`.

2. **ExifTool `-config` must be in `exiftoolArgs` (spawn-time), not `writeArgs` (per-write).** The ExifTool process is already running by the time per-write args arrive. Overriding `exiftoolArgs` replaces the default entirely — must re-include `-stay_open True -@ -`.

3. **IPTC:* tags are silently dropped when writing to standalone .xmp files.** For RAW sidecars, use XMP-namespace equivalents: `XMP-dc:Subject` (keywords), `XMP-iptcCore:Location` (sublocation), `XMP-photoshop:City`, `XMP-photoshop:Country`. IPTC/EXIF tags belong only in direct image writes.

4. **Blank-placeholder detection must use `eventTypes.length === 0`, not `city === null`.** `_makeComp()` copies globalCity into the placeholder; city presence is not a reliable signal. The save-gate guarantees that any persisted event has non-empty eventTypes.

Promote to agents:
- autoingest-architect.md (ExifTool singleton constraints + IPTC vs XMP namespace separation)
- contract-debugger.md (boolean encoding silent failure)
- event-data-guardian.md (blank-placeholder detection signal)

Status:
- Promoted

---

### 2026-05-05 — Cross-Platform UI/Runtime Stabilization (Windows + macOS)

Task type:
- Electron / Renderer / Platform Compatibility / UI / Keyboard Interaction / Debugging

What happened:

**Fix 1 — `process is not defined` on Windows (renderer/renderer.js + main/preload.js):**
Renderer code referenced `process.platform` and `process.env.NODE_ENV` directly. With `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, the renderer has no Node `process` object. On macOS, Electron partially shims `process`, masking the bug. On Windows it throws `ReferenceError: process is not defined`. Fix: exposed `platform: process.platform` via `contextBridge.exposeInMainWorld` in `preload.js`; replaced renderer-side `process.platform` with `window.api.platform`.

**Fix 2 — Escape key not dismissing modal when focus was inside an input:**
The `keydown` handler placed the Escape check after the `INPUT/TEXTAREA/SELECT` early-return guard. When focus was inside a text field, Escape was swallowed. Fix: moved the Escape branch before the form-field guard. The guard must only block shortcuts that should not fire while typing — Escape is always an unconditional dismiss.

**Fix 3 — Drag-to-reorder component cards in EventCreator:**
Implemented HTML5 drag-to-reorder on `.ec-comp-row` elements. Key decisions: `draggable="true"` on the handle `<span>` only (not the card), events wired after each `innerHTML` rebuild in `_refreshCompList`, reorder performed directly on the `_eventComps` array via `splice`, then re-render via the existing `_refreshCompList()` + `_updateEventPreview()`. No external library required.

**Fix 4 — Portrait images clipped in preview modal:**
JS `onload` handler set inline `style.maxHeight = '1200px'` on the image element. On viewports where `calc(92vh - 52px) < 1200px`, the inline style overrode CSS `max-height`, causing overflow and clipping. Fix: removed the inline JS assignment; CSS changed to `max-height: calc(92vh - 52px)`.

**Fix 5 — Modal close buttons implicitly submitting forms:**
HTML `<button>` defaults to `type="submit"`. Six modal close buttons lacked an explicit type. Fix: added `type="button"` to all six.

Reusable lessons:

1. **Any `process.*` reference in Electron renderer code is a latent Windows crash.** With contextIsolation/sandbox, `process` is not shimmed on Windows. The correct pattern is to expose platform-specific values via `contextBridge` in `preload.js` and access them as `window.api.<field>`. Grep signal before closing any renderer PR: `process\.platform|process\.env`.

2. **Escape must precede the INPUT/TEXTAREA/SELECT guard in keyboard handlers.** The form-field guard should only block typing-sensitive shortcuts — it must never block Escape, which is always an unconditional modal dismiss.

3. **HTML5 drag-to-reorder in an Electron renderer: set `draggable` on the handle only, wire events after `innerHTML` rebuild, splice the source-of-truth array, and re-render via the existing refresh function.**

4. **Never set inline `style.maxHeight` on a flex-child image via JS.** Inline styles override CSS constraints and clip content on smaller viewports. Use an explicit viewport-anchored CSS value (`max-height: calc(92vh - Xpx)`) instead.

5. **Every `<button>` that is not a form submit must have `type="button"`.** Missing type defaults to `type="submit"`, causing accidental form submission from close/cancel/dismiss buttons.

Common failure modes:
- Referencing `process.platform` or `process.env` directly in renderer code (masked on macOS, crashes on Windows).
- Placing the Escape handler after the form-field early-return guard.
- Setting `style.maxHeight` in JS on flex-child images and expecting it to respect CSS constraint at all viewport sizes.
- Omitting `type="button"` from close/cancel buttons that live inside or near a form.

Promote to agents:
- autoingest-architect.md (process.* in renderer = Windows crash; architectural renderer security boundary)
- contract-debugger.md (process.* diagnostic signal; Escape key keyboard diagnostic)
- ui-system-specialist.md (Escape key handler pattern; HTML5 drag-to-reorder; no inline style.maxHeight; type="button" on close buttons)

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
