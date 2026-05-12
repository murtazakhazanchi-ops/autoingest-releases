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

### 2026-05-08 — v0.8.8 Source Cleanup Race Fix

Task type:
- Bug Fix / Ingestion / Async Safety / Renderer State

What happened:
- Source Cleanup was falsely rejecting legitimate imported files with "Path outside source root".
- Root cause: `activeSource` is a module-level renderer variable that `renderExtDrives()` polling can null during any `await`. When the user selects an external drive via the dialog button, `activeSource.path` is the chosen sub-folder (e.g. `/Volumes/HITACHI/Photos`), which never matches a polled `c.mountpoint` (the drive root). So polling falsely treats the drive as disconnected and sets `activeSource = null` on every cycle.
- If this fires during the long `commitImportTransaction` or `importFiles` await, the post-import handler finds `activeSource = null`. Either the early-return guard fires (cleanup never offered) or `activeSource?.path` resolves to `undefined` and `_csqSourceRoot` is set to `undefined`, making every `realpath` containment check fail.
- Fix: capture `activeSource?.path` synchronously before the first `await` in both import paths; pass it to `showProgressSummary` as `importCleanupRoot`; relax guard from `if (!activeSource) return` to `if (!activeSource && !_importCleanupRoot) return`.

Reusable lessons:
1. **Capture volatile state before first await**: Any module-level variable that background polling can mutate must be captured synchronously before the first `await` in a long async flow. The captured value is the source of truth for all downstream use — do not re-read the module variable after an await and assume it still reflects import-time state.
2. **Stable source root for post-import cleanup**: The cleanup containment root must come from import-time state, not from current UI/source state. Current state can change (polling, drive disconnect, folder navigation) between import start and import completion.
3. **Guard relaxation pattern**: When a captured fallback is added, update guards from `if (!primaryVar) return` to `if (!primaryVar && !capturedFallback) return` so that the post-import summary is still shown when polling transiently clears the live variable.

Promote to agents:
- `contract-debugger.md` — async race with polling state as a debugging pattern
- `ingestion-routing-specialist.md` — capture-before-await rule for post-import cleanup root

Status:
- Promoted

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

### 2026-05-05 — Event Management Modal X Button Removal and Hijri Date Async Prefill

Task type:
- UI / Renderer / Modal / Keyboard Accessibility / Form Prefill / Async IPC

What happened:

**Part A — Remove emmCloseBtn from Event Management modal:**
`emmCloseBtn` was removed from `#eventMgmtModal` in `renderer/index.html`, its click listener was removed from `renderer/renderer.js`, and its lazy DOM ref `$closeBtn` was removed from `renderer/eventMgmt.js`. A code-reviewer agent caught a third-file fix needed: `eventMgmt.js` used `$closeBtn()` as the focus fallback in `open()`. When the button was removed from the DOM, `$closeBtn()` returned `null`. Optional chaining prevented a crash but silently dropped focus on modal open — a keyboard accessibility regression. Fix: replaced `$closeBtn()` with `document.getElementById('emmBackBtn')`, which is persistently present in the footer.

**Part B — Prefill "Create New Event" Hijri date with today:**
Synchronous `coll?.hijriDate` fallback was replaced with async `window.api.getTodayDate()` IPC call. Two guards were added: module-level (`if (_newEventDate) return` before the `.then()` writes) to prevent clobbering user edits if IPC resolves after interaction, and field-level (`if (yEl && !yEl.value)`) to avoid overwriting partial user input. `_updateEventPreview()` is called inside `.then()` to sync the preview after async fill. All navigation-out paths reset `_newEventDate` to `null` to allow a fresh prefill on next entry.

Reusable lessons:

1. **Removing a modal close/X button requires searching all JS files for focus fallback references to its element ID.** Click listeners and HTML are the obvious targets; `open()` focus management in the module is easily missed. Grep for the element ID across the full renderer directory before closing the task.

2. **Focus fallback in a modal's `open()` must always target a persistently rendered element.** The Back/Done button in the footer is a reliable fallback. The modal X button is not — it may be conditionally absent. If the fallback element is removed, the modal will silently drop focus on open, causing a keyboard accessibility regression.

3. **Async form prefill in a re-entrant modal requires two guards and a preview trigger.** Module-state guard (`if (_newEventDate) return`) prevents duplicate IPC writes on re-entry. DOM-value guard (`if (el && !el.value)`) prevents overwriting partial user input. `_updateEventPreview()` call inside `.then()` keeps the preview in sync. Both guards are required — neither alone is sufficient.

Common failure modes:
- Removing a modal button from HTML and its click listener but missing its use as a focus fallback in the same or a related JS module.
- Using a conditionally rendered modal element (X button) as a focus target instead of a persistent footer element.
- Adding only a module-state guard for async prefill without checking the DOM field value (leaves partial input vulnerable to clobber on slow IPC).
- Forgetting to call `_updateEventPreview()` after async write to the date fields.

Preferred patterns:
- After removing any modal DOM element: grep for its ID across all renderer JS files before closing the task.
- Modal `open()` focus fallback: `document.getElementById('emmBackBtn')` or equivalent persistent footer element.
- Async prefill: `if (moduleState) return; ipc.then(() => { if (moduleState) return; if (el && !el.value) el.value = val; triggerPreview(); })`.

Promote to agents:
- ui-system-specialist.md (focus fallback must target persistent element; async prefill two-guard pattern)
- contract-debugger.md (removing DOM element → search all JS for focus fallback references)

Status:
- Promoted

---

### 2026-05-05 — Activity Log Tabbed UI, Source Cleanup Tracking, and Retry Failed Metadata

Task type:
- UI / Renderer / IPC / Feature

What happened:

**Activity Log tab architecture:**
Added five filter tabs (All / Import / Metadata / Source Cleanup / Errors) using `<div class="al-tabs" data-active="all">` as the container. Panel visibility is driven entirely by CSS: `[data-active="tab"] .al-panel[data-tabs~="tab"] { display: block }`. No per-panel JS class toggling. `_wireAlTabs()` sets `tabs.dataset.active` on button click. `_alLastImportEntries` is cached from each `_renderActivityLogBody()` call so live panel refreshes during background ops can access import data synchronously.

Source cleanup results are captured in a session-ephemeral module-level variable `_scLastBatch = { deleted, failed, timestamp, errors }` set inside the cleanup IPC result handler — the same approach as `_metaBatch*`. Volatile op results that don't belong in event.json use module-level state.

**Retry Failed Metadata button:**
`Retry Failed` button appears in the Metadata panel when `_metaBatchFailed > 0`. Click handler: disables the button immediately and sets "Retrying…" text — it does NOT re-enable the button on IPC return. After retry, the existing `onMetadataProgress` listener fires `batch_complete` and `batch_error` (because `retryFailed()` re-enqueues on the same batch, which re-satisfies the total). `_refreshAlMetadataPanel()` and `_refreshAlErrorsPanel()` are called from those branches, rebuilding the button in the correct enabled/hidden state from fresh `_metaBatch*` state.

Reusable lessons:

1. **Data-attribute CSS tabs for modal panels**: Use `data-active` on the container and `data-tabs~=` whitespace-token matching on panels. CSS handles all visibility; JS only updates `dataset.active`. No per-panel toggle logic needed.

2. **IPC async action buttons: disable on click, let the IPC listener re-render**: The click handler disables the button and shows loading text. The button's re-enabled or removed state comes from the panel refresh triggered by the progress listener (`batch_complete`, `batch_error`). Never re-enable the button from the click handler's success path — by the time the listener fires, the panel has already been rebuilt with the correct state.

3. **Live modal panel refresh via IPC progress listener**: When a modal panel reflects the state of a background operation, hook the refresh call into the existing IPC listener branches. Guard with `classList.contains('open')` before touching the DOM. Cache any async data (import entries) from the initial render so live refreshes are synchronous.

Common failure modes:
- Toggling panel visibility with per-panel JS class changes instead of using `data-active` + `data-tabs~=` CSS.
- Re-enabling an async action button in the IPC call's success/catch path — the panel refresh rebuilds the correct button state; a second re-enable races with that.
- Calling `body.innerHTML = _renderActivityLogBody(...)` on every `file_done` progress event — resets tab state and re-renders all panels on every file.

Promote to agents:
- ui-system-specialist.md (data-attribute tab panels; IPC async button disabled-guard; live panel refresh pattern)

Status:
- Promoted

---

### 2026-05-05 — Metadata Reapply: IPC Handler, Per-File Photographer, and Reapply UI

Task type:
- Metadata / IPC / ExifService / Renderer / UI / Feature

What happened:

**Task 1 — `metadata:reapplyEvent` IPC handler (main/main.js):**
New IPC handler scans the destination folder structure, discovers files, builds synthetic `copiedFiles` where `src === dest`, and calls `exifService.applyBatch()`. `resolvePhotographer(filePath, baseDir)` derives photographer from `path.relative(baseDir, f).split(path.sep)[0]` — always the photographer folder segment, depth-independent.

**Task 2 — Per-file photographer in exifService (main/exifService.js):**
Backward-compatible extension: `copiedFiles[i].photographer` stored in `fileStatuses` at batch-start, read in `_processFile` via `file.photographer != null ? file.photographer : context.photographer`. Propagated through `retryFailed()`. Callers that do not set `.photographer` on file objects continue to work via context fallback.

**Task 3 — Status state, summary card, reapply confirm (renderer/renderer.js + renderer/index.html):**
- `_computeMetaStatus()` — pure function deriving `idle`/`running`/`applied`/`partial`/`failed` from four module-level state variables. Status is never stored; always derived on call.
- `_metaBatchTimestamp` — epoch ms, cleared on `batch_start`, set on `batch_complete`.
- `REAPPLY_CONFIRM_THRESHOLD = 50` — estimated file count threshold from `_alLastImportEntries.reduce()`.
- Inline confirm pattern: swaps `#alReapplyArea` `innerHTML` on Confirm click; Cancel restores via `_refreshAlMetadataPanel()`; Confirm calls `_doReapply()` directly. No modal overlay required.
- Summary card reuses `.al-summary-row` design-system card pattern.

**Bugs caught:**

1. **Per-file photographer regression** — `context.photographer` (single string) would be applied to all files during reapply. Fix: per-file `.photographer` property on `copiedFiles[]`, stored in `fileStatuses`, read in `_processFile` with context fallback for callers that omit it.
2. **Undefined CSS variables** — `.al-reapply-btn:hover` used `--bg-tertiary` and `--border-hover`, which are not defined in the theme. Fixed by switching to `--border-subtle` / `--border-strong`.

Reusable lessons:

1. **Per-file property propagation on exifService batch objects requires a three-point change: set on the file object before batch-start, store in `fileStatuses` during batch-start, read in `_processFile` with context fallback.** Callers that omit the per-file property continue to work via fallback — backward-compatible by design. Must also propagate through `retryFailed()`.

2. **Derive operation status from state variables via a pure function; never store derived status as its own variable.** A pure `_computeMetaStatus()` reading `_metaBatchRunning`, `_metaBatchTotal`, `_metaBatchFailed`, `_metaBatchTimestamp` removes the risk of status/state desync. Call it fresh on each render.

3. **Inline confirm pattern for large-operation UI: swap the action area's `innerHTML`, restore via the panel refresh function on Cancel.** No modal overlay is needed for simple confirm/cancel flows within a panel. Cancel must use the existing panel refresh function (not a manual restore) so the panel state is always consistent.

4. **Verify CSS custom property names against the actual theme before shipping any new style rule.** Using `--bg-tertiary` or `--border-hover` without confirming they exist in the theme will silently produce no-op hover states (transparent/no border change). Check against `renderer/theme.css` or equivalent.

Common failure modes:
- Applying `context.photographer` (a single string) to all files in a reapply batch instead of per-file photographer derived from folder structure.
- Storing derived status as a module-level variable and failing to update it in every code path that changes state.
- Writing a custom restore path for inline confirm/cancel instead of reusing the panel refresh function.
- Using CSS variable names that look plausible but are undefined in the actual theme.

Preferred patterns:
- Per-file property on batch object: `copiedFiles[i].photographer = resolvePhotographer(...)` → `fileStatuses[i].photographer = file.photographer` → `_processFile` reads `file.photographer != null ? file.photographer : context.photographer`.
- Derived status: `function _computeMetaStatus() { if (_metaBatchRunning) return 'running'; ... }` — no stored status variable.
- Inline confirm: `area.innerHTML = confirmHtml` on action button click; Cancel button calls `_refreshAlMetadataPanel()`.

Promote to agents:
- autoingest-architect.md (per-file property propagation pattern for exifService batches)
- ui-system-specialist.md (derived status pure function; inline confirm pattern; CSS token verification)

Status:
- Promoted

---

### 2026-05-06 — Activity Log Tab Content Separation

Task type:
- UI / Renderer

What happened:
- The Import tab was showing metadata summary content. Root cause: `_refreshAlMetadataPanel()` used `.al-panel[data-tabs~="metadata"]`, which matched the shared header panel (`data-tabs="all import metadata cleanup errors"`) first in DOM order because the header panel appears before the metadata content panel and also contains the token "metadata". The metadata section content was written into the header panel, which shows on all tabs (including Import). The same bug existed in `_refreshAlErrorsPanel()` using `.al-panel[data-tabs~="errors"]`.
- The import section content was built entirely inline inside `_renderActivityLogBody()` (~80 lines), making it impossible to audit quickly which content belongs to which tab.

Reusable lessons:
1. **Shared-token header panels cause querySelector collisions.** The Activity Log header panel (`data-tabs="all import metadata cleanup errors"`) is a `.al-panel` that contains every tab's token. Any `querySelector('.al-panel[data-tabs~="<tab>"]')` will match the header first in DOM order. Refresh functions must use `.al-panel--section[data-tabs~="<tab>"]` — the header lacks `al-panel--section`, so the modifier class provides the selector specificity needed to skip it.
2. **One `_build<X>Section()` function per tab section.** Inline section builds inside `_renderActivityLogBody()` make tab content boundaries invisible and hard to audit. Each section belongs in a named builder function, matching the existing `_buildMetadataSection()`, `_buildSourceCleanupSection()`, and `_buildErrorsSection()` pattern. Import content must be in `_buildImportSection(summary, issueCount)`.

Common failure modes:
- Writing `.al-panel[data-tabs~="X"]` in a panel refresh function without checking whether the header panel also carries the token "X" — it does for every tab.
- Placing section HTML inline inside the body-render function and assuming content isolation is maintained by surrounding structure.

Preferred patterns:
- Panel refresh selector: `.al-panel--section[data-tabs~="metadata"]`, `.al-panel--section[data-tabs~="errors"]`.
- Section builder: `function _buildImportSection(summary, issueCount) { ... }` called in `_renderActivityLogBody()` template.

Promote to agents:
- ui-system-specialist.md (selector specificity rule for Activity Log refresh; section builder per tab rule)
- code-reviewer.md (validation check: Activity Log refresh function selector specificity)

Status:
- Promoted

---

### 2026-05-06 — Metadata Summary Persistence: Folder-vs-File Path and EISDIR Silent Failure

Task type:
- Persistence / Debugging / IPC / Event System

What happened:

**Root cause — `_writeLastMetadataRun` receiving a folder path:**
`_writeLastMetadataRun(eventJsonPath, ...)` was called from the import-triggered metadata path with `eventJsonPath` holding the event folder path (not the `event.json` file path). Inside `_writeLastMetadataRun`, `fsp.readFile(eventJsonFilePath, 'utf8')` received the folder path and threw `EISDIR`. That error was silently caught by the surrounding try/catch with only a log line. The caller received no indication of failure, so `lastMetadataRun` and `metadataSummary` were never written to `event.json` after successful import-triggered metadata runs.

The reapply path (the reference/correct path) already passed `path.join(folderPath, 'event.json')` — a file path.

**Fix 1 — Correct call site (main/main.js ~line 801):**
Changed from passing `eventJsonPath` (folder) to passing `path.join(eventJsonPath, 'event.json')` (file).

**Fix 2 — Atomic write:**
`_writeLastMetadataRun` was using a non-atomic `fsp.writeFile`. Upgraded to the tmp/rename pattern consistent with all other event.json writers.

Reusable lessons:

1. **Folder-vs-file path mismatch at persistence call sites.** IPC handlers that hold a folder path (`eventFolderPath`, `eventJsonPath`) must construct the full file path with `path.join(folderPath, 'event.json')` before passing to any persistence function whose parameter is named `*FilePath` or `*JsonPath`. Passing the folder silently fails via EISDIR.

2. **EISDIR silent failure pattern.** Any persistence function that opens a file path will silently fail if given a directory. The symptom is: fields that should be present in `event.json` after a successful operation are simply absent — no user-visible error, no crash. Diagnosis: check whether the call site is passing a folder path to a function expecting a file path.

3. **Atomic write required for all event.json mutations.** The tmp/rename pattern must be used consistently. Non-atomic `fsp.writeFile` is always wrong for `event.json` writers.

Common failure modes:
- A variable named `eventJsonPath` or `eventFolderPath` at the IPC handler level is the folder, not the file — passing it directly to a persistence function expecting a file path.
- Assuming a try/catch with a log line will surface a persistence failure visibly.
- Using non-atomic `writeFile` in a new or modified `event.json` writer.

Preferred patterns:
- Call site: `_writeLastMetadataRun(path.join(eventFolderPath, 'event.json'), ...)`.
- Function signature: parameter named `eventJsonFilePath` (not `eventJsonPath`) signals a file, not a folder.
- Diagnosis: when expected fields are absent from `event.json` after a successful operation, check the path type passed to the persistence function.

Promote to agents:
- event-data-guardian.md (folder-vs-file path mismatch; atomic write rule)
- contract-debugger.md (EISDIR silent failure as a diagnostic pattern)

Status:
- Promoted

---

### 2026-05-07 — Large External Drive and Local Folder Source Entry Performance

Task type:
- Performance / Renderer / IPC / Filesystem / UI / Source Loading

What happened:

**Root cause — blocking scan before workspace reveal:**
`selectSource()` always awaited `browseFolder(path, null)` before showing the workspace. `browseFolder` invokes `files:get` → `scanMediaRecursive(drivePath)` — a full recursive filesystem walk that stats every media file on the drive. For large SSDs with thousands of files, this blocked the renderer for seconds to minutes, causing a white-screen freeze. Memory cards were acceptable (bounded file count) but external drives and large local folders were not.

**Fix — source-type branching in `selectSource()`:**
External-drive and local-folder sources now: reveal the workspace immediately, set `_folderNavMode = 'scan'`, default to Folder view, and call `_loadSourceFolderTree(drivePath)` asynchronously after the workspace is visible. Memory card path is completely unchanged (still awaits `browseFolder` before reveal).

**`_loadSourceFolderTree()` (new renderer function):**
Calls `window.api.getFolders(drivePath)` → IPC `folders:get` → `getShallowFolderTree()` (new `fileBrowser.js` function). `getShallowFolderTree` reads directory entries only (no file stat calls), depth-capped at 4, node-count capped at 500. Returns within milliseconds even on a full SSD. Sidebar populates with folder names immediately. If source is flat (no subfolders), `_loadSourceFolderTree` shows "Scanning…" and triggers `browseFolder(drivePath, null)` after the workspace is already visible.

**`_folderNavMode` state variable:**
`'tree'` (memory card) — sidebar clicks call `enterFolderView(path)` from pre-built in-memory tree.
`'scan'` (external/local) — sidebar clicks call `browseFolder(drivePath, selectedPath)`, scanning only the selected folder on-demand.

**Stale scan protection:**
`activeSource?.path !== loadPath` guard in `_loadSourceFolderTree` drops results if source changed. Existing `fileLoadRequestId` guard in `browseFolder` drops stale media scan results.

**Thumbnail pipeline:** Untouched. No changes to `requestThumbForImage`, `thumbObserver`, `drainThumbQueue`, or any preview/cache behavior.

Reusable lessons:

1. **External/local source entry must reveal the workspace before any media scan.** The correct order is: reveal workspace → populate sidebar with cheap directory-names-only walk → scan only user-selected folder on-demand. The inverse order (scan → reveal) causes white-screen freezes on large drives.

2. **A shallow folder tree IPC channel (`folders:get`) is structurally different from a media scan channel (`files:get`).** The shallow tree reads `readdir` + `withFileTypes`, skips all file stat calls, enforces depth and node caps, and returns within milliseconds. It is not a fast version of a media scan — it returns no files, only folder names and paths. Keep these two operations separate; never try to make a media scan "fast enough" to front-load it.

3. **`_folderNavMode` ('tree' vs 'scan') must gate sidebar click behavior.** In 'scan' mode, every folder click calls `browseFolder(drivePath, selectedPath)` to scan on-demand. In 'tree' mode, every folder click calls `enterFolderView(path)` from a pre-built in-memory tree. These code paths must not cross. Any function that wires folder list click events must branch on `_folderNavMode`.

4. **`currentFolderTree = null` must be reset in `selectSource()` state cleanup.** Failing to reset it allows a stale tree from the previous source to leak into the new source's initial render, causing incorrect sidebar population.

5. **Flat local sources (no subfolders) require deferred scan, not pre-scan.** When `getShallowFolderTree` returns no children, the correct path is: show workspace → show "Scanning…" placeholder → trigger `browseFolder(drivePath, null)` asynchronously. This keeps the workspace visible and the renderer responsive while the scan runs.

Common failure modes:
- Awaiting a full recursive media scan before revealing the workspace for any source type.
- Using the same IPC channel for folder navigation and media scanning.
- Sidebar click handlers that ignore `_folderNavMode` and call `enterFolderView` or `browseFolder` unconditionally.
- Missing `currentFolderTree = null` reset in the common state cleanup block of `selectSource()`.
- Treating a "fast scan" as an alternative to a fundamentally deferred scan for large sources.

Preferred patterns:
- External/local source entry: `reveal workspace → getFolders(path) → populate sidebar → scan on folder select`.
- Memory card source entry: unchanged (`browseFolder(path, null) → reveal workspace`).
- Flat source detection: `tree.children.length === 0` → show "Scanning…" → `await browseFolder(drivePath, null)`.
- Stale scan guard: `if (activeSource?.path !== loadPath) return;` before any DOM mutation in async load functions.

Promote to agents:
- performance-auditor.md (source entry loading — workspace-before-scan rule, shallow folder tree pattern)

Status:
- Promoted

---

### 2026-05-07 — Non-Recursive Folder Navigation for External Drive and Local Folder

Task type:
- Performance / UI / Renderer / Filesystem Navigation / IPC

What happened:

**Bug 1 — Sidebar invisible initially (renderer/renderer.js `_loadSourceFolderTree`):**
`_loadSourceFolderTree` called `renderFolders()` after getting the shallow tree, which populates `folderList.innerHTML`. But the `#sidebar` element itself had `display: none` from initialization (`viewModeType === 'media'` at startup hides it). Only `renderCurrentView()` makes it visible via `sidebar.style.display = (viewModeType === 'folder') ? '' : 'none'`. `_loadSourceFolderTree` never called `renderCurrentView()`, so the sidebar container stayed hidden while its list content was correctly populated. Fix: explicitly set `sidebar.style.display = ''` immediately after `renderFolders()` in `_loadSourceFolderTree`.

**Bug 2 — Recursive scan on folder click (renderer/renderer.js `wireFolderListClicks`):**
Scan-mode folder click called `browseFolder(activeSource.path, p)` → IPC `files:get` → `scanMediaRecursive(targetPath)`. `scanMediaRecursive` recursively descends ALL nested subdirectories, aggregating every descendant file regardless of depth. Clicking a top-level folder on a 2TB SSD triggered a full recursive scan. Fix: added `files:getDirect` IPC handler using `readDirectory(folderPath)` (existing non-recursive function), new `browseFolderDirect()` renderer function, updated scan-mode click to call `browseFolderDirect(p)`.

**Bug 3 — Local folder not auto-loading root media:**
`_loadSourceFolderTree` treated external-drive and local-folder identically — both showed "Select a folder" prompt. Spec requires local-folder to immediately show root's direct media. Fix: in `_loadSourceFolderTree`, after populating sidebar, check `activeSource.type === 'local-folder'` and call `browseFolderDirect(drivePath)`.

**Bug 4 — Stale `currentFolderContext` from prior source:**
`selectSource()` common cleanup did not reset `currentFolderContext`. If a prior source left `isLeaf: true` with old files, toggling views on the new source would render those old files. Fix: added `currentFolderContext = { path: null, files: [], isRoot: true, isLeaf: false }` to the common cleanup block.

**`browseFolderDirect` design:**
Sets `currentFolderContext.isLeaf = true` always. This makes `renderCurrentView()` correctly call `renderFileArea(currentFolderContext.files)` when the user toggles views — without requiring any change to `renderCurrentView()` itself.

**IPC added:**
- `files:getDirect` → `readDirectory(folderPath)` (immediate children, no file-stat recursion)
- `window.api.getFilesDirect(folderPath)` in preload

Reusable lessons:

1. **`renderFolders()` and `renderCurrentView()` are not equivalent for sidebar visibility.** `renderFolders()` only writes to `folderList.innerHTML` (list content). `renderCurrentView()` is the only function that sets `#sidebar` `display`. When calling `renderFolders()` outside `renderCurrentView()`, always follow it with `sidebar.style.display = ''` if folder mode is active.

2. **`files:get` (recursive) and `files:getDirect` (non-recursive) must never be conflated.** `files:get` calls `scanMediaRecursive` — always full recursive descent, always aggregates all descendants. `files:getDirect` calls `readDirectory` — one directory level only, immediate children. Folder navigation in scan mode must use `files:getDirect`; media view full-card scans use `files:get`.

3. **`currentFolderContext` must be reset in `selectSource()` common cleanup.** Resetting only `currentFolderTree` is insufficient. `currentFolderContext` (including `isLeaf`) must also be reset so view-toggle renders on the new source use the correct initial state.

4. **External-drive and local-folder have different initial render contracts.** External-drive: show "Select a folder" prompt, wait for user selection. Local-folder: immediately load root's direct media via `browseFolderDirect(drivePath)`. Both use `_folderNavMode = 'scan'` and the same sidebar tree, but the initial main-panel content differs.

5. **Setting `currentFolderContext.isLeaf = true` in scan-mode navigation is the correct pattern for view-toggle compatibility.** `renderCurrentView()` checks `isLeaf` to decide between `renderFolderOnly()` and `renderFileArea(currentFolderContext.files)`. In scan mode, `isLeaf: true` always (regardless of actual subfolders) ensures direct-listing content is preserved across view toggles without modifying `renderCurrentView()`.

Common failure modes:
- Calling `renderFolders()` and assuming the sidebar becomes visible — the sidebar element itself is controlled separately.
- Using `browseFolder()` (recursive) for folder-click navigation on large external sources.
- Omitting `currentFolderContext` from the common `selectSource()` state reset.
- Treating external-drive and local-folder identically in initial load (they have different initial panel states).

Preferred patterns:
- Sidebar show after `renderFolders()`: `if (sidebar) sidebar.style.display = ''`.
- Folder click in scan mode: `browseFolderDirect(p)` → `files:getDirect` → `readDirectory`.
- State reset in `selectSource()`: `currentFolderContext = { path: null, files: [], isRoot: true, isLeaf: false }`.
- Scan-mode `currentFolderContext` after folder load: `{ path, files: result.files, isRoot: false, isLeaf: true }`.

Promote to agents:
- performance-auditor.md (non-recursive folder navigation IPC; external vs local initial render; currentFolderContext reset)
- ui-system-specialist.md (renderFolders vs sidebar element visibility)

Status:
- Promoted

---

### 2026-05-07 — View-Mode State Sync: Media↔Folder Toggle and Folder-Click in Media View

Task type:
- Renderer / Async State / View-Mode / IPC / Debugging

What happened:

**Bug 1 — Media → Folder Toggle (three root causes):**

Root cause 1a: `viewFolderBtn` handler did not call `fileLoadRequestId++` when switching to Folder view. The view-guard (`viewModeType !== 'media'`) was the only protection against an in-flight `_startMediaScan` overwriting Folder view state. Adding `fileLoadRequestId++` provides a second, independent guard.

Root cause 1b: `renderCurrentView()` → `renderFileArea([])` showed the generic "No supported media files found" message when folder context was empty. Folder view requires "No media directly in this folder. Select a subfolder." The empty-array case must be intercepted in `renderCurrentView()` before delegating to `renderFileArea`.

Root cause 1c: `selectedFiles`, `lastClickedPath`, `_selectionAnchor`, `_prevFocusPath` were not cleared when switching from Media to Folder view. Stale selection state bled into the Folder view render and produced incorrect counts in `updateSelectionBar()`.

**Bug 2 — Folder Click While Media View Active:**

The folder-click handler in scan mode always called `browseFolderDirect(p)` regardless of `viewModeType`. When the user is in Media view, clicking another folder must call `_startMediaScan(p)` instead. The handler must branch on `viewModeType`.

Secondary root cause: `_startMediaScan` was only ever called from the view-toggle button (where `currentFolderContext` was already populated). When promoted to also handle folder-click from Media view, it needed to update `currentFolderContext`, `currentFolder`, `activeFolderPath`, sidebar highlight, breadcrumb, and selection state — none of which it previously owned. These must be set synchronously BEFORE the first `await`.

Reusable lessons:

1. **Double-guard async view operations**: increment `fileLoadRequestId` AND check `viewModeType` at every stale-guard point. One guard alone leaves a race window.

2. **Empty-state specificity before `renderFileArea`**: generic empty state is wrong for view/mode-specific contexts. Intercept the empty-array case in the caller before delegating to `renderFileArea`.

3. **Branch navigation actions on active view mode**: a folder-click handler that must behave differently in Media vs Folder view must branch on `viewModeType` at the handler level. Never default to one behavior that only serves one mode.

4. **Context completeness when a function gains new call sites**: audit all state a function must own (folder identity, UI identity, selection state, view cache) before the first `await`. Set synchronously at call-site entry, not inside the async body.

5. **Promise.all for parallel IPC fetches with `.catch()` fallback**: when a scan needs two independent data sets (direct listing + recursive listing), run both in parallel and add a `.catch(() => ({ files: [] }))` on the fast path so it doesn't abort the slow path.

6. **Guard at every `await` boundary**: re-check both `fileLoadRequestId` AND `viewModeType` guards after each `await` inside a stale-guarded async function. A previously unguarded `await` (e.g. `refreshDestCache()`) is a race window.

7. **Selection clear on cross-folder and cross-view navigation**: always clear `selectedFiles`, `lastClickedPath`, `_selectionAnchor`, `_prevFocusPath` when navigating to a new folder or switching view modes in scan mode.

Common failure modes:
- Incrementing request ID when entering Media view but not when leaving it.
- Delegating to `renderFileArea([])` from a view-mode-specific context that needs a custom empty state.
- A folder-click handler that ignores `viewModeType` and always calls the Folder-view path.
- Promoting a function to a new call site without auditing all state it must initialize.
- A `await` inside a stale-guarded async function that has no guard after it.
- Leaving selection state from a previous folder or view in place when the view switches.

Preferred patterns:
- View toggle: `fileLoadRequestId++; viewModeType = 'folder'; /* then check both guards after every await */`.
- Empty-state intercept: `if (_folderNavMode === 'scan' && currentFolderContext.files.length === 0) { showEmptyState(); return; } renderFileArea(files)`.
- Folder-click branch: `if (viewModeType === 'media') { _startMediaScan(p); } else { browseFolderDirect(p); }`.
- Call-site promotion: set `currentFolder`, `activeFolderPath`, `currentFolderContext`, sidebar highlight, breadcrumb, selection clear synchronously before `await`.
- Parallel IPC: `const [directResult, result] = await Promise.all([window.api.getFilesDirect(p).catch(() => ({ files: [] })), window.api.getFiles(...)]);`.
- Guard template: `if (reqId !== fileLoadRequestId || viewModeType !== expectedMode) return;` after each `await`.
- Selection clear: `selectedFiles.clear(); lastClickedPath = null; _selectionAnchor = null; _prevFocusPath = null;`.

Promote to agents:
- performance-auditor.md (view-mode async state safety; double-guard; per-await boundary guards; context completeness at new call sites; selection clear on navigation; parallel IPC fetch pattern)

Status:
- Promoted

---

---

### 2026-05-08 — Multi-Select MetaPicker Portal: Two-Function Close, In-Place Update, and metadataTags Contract

Task type:
- UI / Renderer / Portal Component / Group Mapping / Data Contract

What happened:

Replaced the single-select keyword dropdown on the group panel with a multi-select `MetaPicker` IIFE portal. The portal appends to `#dropdown-root` (outside the main DOM tree). Key patterns and contracts established:

**Two-function close pattern:**
A portal whose `onClose` callback triggers `renderGroupPanel()` cannot expose only one `close()` method, because `renderGroupPanel()` also needs to close the portal — creating an infinite loop: `close()` → `onClose()` → `renderGroupPanel()` → `close()` → ∞. Fix: separate `close()` (tears down + calls `onClose` callback) from `closeQuiet()` (tears down only, nulls callback, no callback invocation). `renderGroupPanel()` calls `closeQuiet()` on all open portals. Outside-click, Escape, and trigger re-click call `close()`.

**In-place DOM update for multi-select picker toggles:**
Each checkbox toggle inside an open picker must not call `renderGroupPanel()` — that would rebuild `innerHTML` and destroy the open picker. Instead, `_updateMetaTriggerInPlace(gid, newTags)` uses `querySelector('[data-gid="…"]')` to update only the trigger button's label and badge. `renderGroupPanel()` is called once on picker close (via the `onClose` callback).

**Portal CSS reuse:**
`MetaPicker` reuses `.gc-dropdown` class (glass morphism, animation, positioning) without duplicating CSS. Only delta CSS is added for behavioral differences.

**`metadataTags` three-value contract:**
- `null` = group was never assigned (warn before import)
- `[]` = explicit "No event keyword" selection (no warn)
- `string[]` = assigned keywords
The picker's `onChange` always delivers `string[]` (never `null`). `createGroup()` is the only producer of `null`. The unassigned-warning filter `groups.filter(g => g.metadataTags === null)` stays correct because the picker cannot produce `null`.

Reusable lessons:

1. **Two-function close pattern for portal IIFE modules:** Any portal whose `onClose` callback re-renders the panel hosting the trigger must expose both `close()` (with callback) and `closeQuiet()` (without callback). The panel render path must call `closeQuiet()`.

2. **In-place trigger update for open picker toggles:** Multi-select pickers that stay open across toggles must update only the trigger button label/badge in-place; `renderGroupPanel()` is called once on close, not on each toggle.

3. **`metadataTags` three-value contract must be preserved through any picker change.** Picker `onChange` must always deliver `string[]`. Only `createGroup()` produces `null`. The `=== null` unassigned filter must not be widened to include `[]`.

Common failure modes:
- Calling `close()` from `renderGroupPanel()` when the portal's `onClose` fires `renderGroupPanel()` — creates infinite recursion.
- Calling `renderGroupPanel()` on each picker toggle (checkbox click) instead of only on picker close.
- Picker `onChange` returning `null` or `undefined` instead of `[]` when no keyword is selected — breaks the `=== null` unassigned filter.

Promote to agents:
- ui-system-specialist.md (two-function close pattern; in-place trigger update)
- group-mapping-specialist.md (metadataTags three-value contract)

Status:
- Promoted

---

### 2026-05-08 — Post-Import Completion Flow: Source-Aware Action Chooser

Task type:
- UI / Renderer / Modal / State Management / Import Flow

What happened:

Replaced the old "Done closes modal" behavior with a source-aware action chooser shown after a successful import. The chooser offers Eject Source / Exit to Home / Continue Importing / Close depending on source type.

**`_postImportSucceeded` flag gates post-import UX:**
A boolean flag set only in `showProgressSummary()` when `errors === 0` gates the post-success chooser in the Done handler. Inferring success from DOM state (e.g., checking if `#progressSummary` has a class) was considered and rejected — DOM state is fragile and can be mutated independently. The flag is the authoritative signal set at the exact point where success is determined.

**Dynamically injected panels need cleanup in two places:**
`#postImportActions` is removed in `_closeProgressModal()` (normal close path) AND in `showProgress()` (re-entry path at the start of each new import). Missing the re-entry cleanup leaves stale panels after abnormal flows such as card disconnect or IPC abort mid-import.

**State mutation order before shared teardown:**
`_continueImporting()` clears `selectedFiles` BEFORE calling `_closeProgressModal()` (which calls `updateSelectionBar()`). Clearing transient state before calling a shared teardown that syncs the UI eliminates duplicate DOM updates and ensures the sync call sees the final state.

**`resetAppState()` clears the active event — wrong for source-exit-only flows:**
`resetAppState()` calls `EventCreator.resetSelection()`, which destroys the active event. For "Exit to Home" (local folder) and "Continue Importing", the event must be preserved. The correct pattern is a partial reset: clear source/files/groups/selection but do NOT call `EventCreator.resetSelection()`. This mirrors `changeDriveBtn` logic. Using `resetAppState()` in the wrong context silently destroys in-progress event state.

**`ejectBtn.click()` delegation is safe and preferred:**
To trigger the eject flow from the post-import chooser, calling `document.getElementById('ejectBtn')?.click()` reuses the full 4-phase eject pipeline (I/O shutdown, OS flush, unmount, confirmation modal, `resetAppState()`). The only prerequisite: close any blocking overlay (progress modal) before triggering, so the eject confirmation can render unobstructed.

**`activeSource.type` is the canonical source-type dispatch key:**
Values are `'memory-card' | 'external-drive' | 'local-folder'`. Source-type-specific post-import behavior (eject vs exit-to-home) is driven by this field. Quick Import always uses ejectable sources — no special Quick Import branch needed in the chooser.

Reusable lessons:

1. **Use a dedicated success flag, not DOM state inference, to gate post-import UX.** Set the flag at the source of truth (`showProgressSummary`). DOM state is fragile.

2. **Dynamically injected modal panels must be cleaned up in two places:** the normal close/teardown function AND the re-entry/reset function at the start of a new operation.

3. **Clear transient state before calling a shared teardown that syncs the UI.** Ensures the sync call sees the final state and eliminates duplicate DOM updates.

4. **`resetAppState()` destroys the active event — never use it for source-exit-only or continue-importing flows.** Use a partial reset that mirrors `changeDriveBtn` logic.

5. **Delegate to `ejectBtn.click()` to reuse the full eject pipeline.** Close blocking overlays first so the eject confirmation renders unobstructed.

6. **`activeSource.type` is the canonical key for source-type dispatch in post-import UX.** Drive source-type-specific behavior from this field, not from Quick Import detection or UI labels.

Common failure modes:
- Inferring import success from DOM state (e.g., class presence) instead of a dedicated flag.
- Removing `#postImportActions` only in the teardown path and omitting it from the re-entry path.
- Calling `updateSelectionBar()` before clearing `selectedFiles`, producing a stale intermediate render.
- Calling `resetAppState()` for a partial-exit flow, silently destroying the active event.
- Re-implementing the eject pipeline inline instead of delegating to `ejectBtn.click()`.

Promote to agents:
- ui-system-specialist.md (lessons 1–5: flag-gated UX, two-place cleanup, mutation order, ejectBtn delegation)
- ingestion-routing-specialist.md (lesson 4: resetAppState event destruction; lesson 6: activeSource.type dispatch)

Status:
- Promoted

---

### 2026-05-09 — Metadata Sync MVP

Task type:
- Feature / Metadata / Persistence / IPC / UI / Data Model

What happened:

New `metadataSyncService.js` reads XMP sidecar keywords and Bridge TXT keyword registries, merges them into `event.json` per-file metadata fields, and exposes 6 IPC handlers wired through `preload.js`. A clickable system overview tile and modal were added to the renderer.

Key architectural decisions and contracts:

1. **Bridge/XMP is input-only — identity fields are never overwritten.** Event type, location, city, and country keywords from Bridge/XMP must be stored as `skippedConflicts` if they differ from AutoIngest identity. They are never applied.

2. **Four per-file metadata fields on event.json.** Each file record carries `autoKeywords`, `externalKeywords`, `unknownKeywords`, `effectiveKeywords`, plus `metadataDrift.removedInExternalTool` and `metadataDrift.skippedConflicts`.

3. **Per-event concurrency lock via `_activeSyncs` Map.** Before writing a sync result, check the Map. If the event is already being synced, abort. This guards against concurrent writes to the same `event.json`.

4. **Idempotent merge: Set-dedup on lowercased label.** `_mergeSyncResult()` uses a Set to deduplicate by lowercased label before writing. Never append a keyword that already exists by label.

5. **ExifTool pool must not be duplicated for read-only operations.** Add a `readFileTags()` export to `exifService` so the existing pool (`maxProcs: 2`) is shared. Do not create a second ExifTool instance.

6. **Atomic write with `lastMetadataSync` timestamp.** After a successful sync, always write `doc.lastMetadataSync = new Date().toISOString()` and `doc.updatedAt = Date.now()` in the same atomic tmp→rename write. `scanPendingEvents` uses `lastMetadataSync` to determine if re-sync is needed.

7. **Clickable overview tile pattern.** Uses `ov-tile ov-tile--action` + `role="button" tabindex="0"` + both `click` and `keydown` (Enter/Space) listeners. The modal follows `emm-overlay/emm-box/emm-topbar/emm-header/emm-footer` structure.

8. **Additional Keywords routing scope contract.** Scope must be `"event"` only when the tag applies to all files in the event; `"group"` or `"component"` for narrower scope. appliedAs values: `"additionalEventKeyword"`, `"additionalGroupKeyword"`, `"additionalComponentKeyword"`.

9. **Bridge TXT import: append-only, no auto-rename/merge/delete.** Only append new entries. Duplicate labels under different paths are allowed. Always preview before applying.

10. **Registry layering: `data/keywords.registry.json` (base) + `userData/keywords.override.json` (user extension).** Both are merged at load time; override takes precedence. Never modify the base registry at runtime.

Reusable lessons:

1. Bridge/XMP data is input-only for keyword enrichment; identity fields (event type, location, city, country) must be stored as `skippedConflicts`, not applied.
2. Per-event concurrency lock (`_activeSyncs` Map) guards event.json against concurrent write races in a sync service.
3. Idempotent keyword merge requires Set-dedup on normalized (lowercased) label, not append-always.
4. ExifTool read-only operations must reuse the existing pool via a new export, never create a second instance.
5. `lastMetadataSync` timestamp belongs in the same atomic write as the sync result — it is the signal for `scanPendingEvents`.
6. Registry layering: a base registry file (read-only at runtime) + a user override file merged at load. Override wins.
7. Bridge TXT import is append-only: no rename, no merge, no delete. Preview before apply.
8. Scope contract for Additional Keywords: `"event"` only when the keyword applies to all files; narrower scope uses `"group"` or `"component"`.

Promote to agents:
- `metadata-specialist.md` — lessons 1, 2, 3, 4, 5 (sync service contracts: input-only Bridge, concurrency lock, idempotent merge, ExifTool pool reuse, atomic sync timestamp)
- `event-data-guardian.md` — lesson 2 (per-event concurrency lock prevents concurrent event.json writes)
- `ui-system-specialist.md` — lesson 7 (clickable overview tile pattern with role=button and dual keyboard listener)

Lessons NOT promoted (too specific / belong in feature doc):
- Registry layering detail (doc-level contract, not a recurring agent-level mistake)
- Bridge TXT append-only rule (feature-specific policy, not a reusable architectural pattern beyond metadata-specialist)
- Additional Keywords scope contract (feature-specific; already encapsulated in event-data-guardian's source-of-truth rule)

Status:
- Promoted

---

### 2026-05-09 — Metadata Sync Phase 1B Stabilization

Task type:
- Metadata / Persistence / IPC / Filesystem / Debugging

What happened:

Five stabilization bugs were fixed in the metadata sync service after the Phase 1 MVP was shipped:

1. `scanPendingEvents` was checking `lastMetadataSyncError` only when `!doc.lastMetadataSync`. A re-run failure after a prior success set the error field but the event never appeared in the pending list — it silently appeared as `'xmp-changed'` or not pending at all.
2. The XMP-change detection helper was walking the full subtree to collect matching paths before checking mtimes. Replaced with an early-exit stat walk that returns on the first modified `.xmp` file found.
3. `renderHome` called the pending-scan IPC without any busy guard, triggering overlapping calls on fast navigation.
4. `keywords:loadRegistry` initialized `result.base = []` (array) but overwrote it with `{ groups, keywords }` on success, creating a type mismatch between initialization and runtime shape.
5. On a failed sync, `lastMetadataSyncError` was written correctly, but on a subsequent successful sync, `delete doc.lastMetadataSyncError` was in a separate write from `lastMetadataSync`. Error clearing and success timestamp must be a single atomic write.

Reusable lessons:

1. **`scanPendingEvents` error priority**: `lastMetadataSyncError` must be checked first, regardless of whether `lastMetadataSync` exists. Priority order: `sync-error` → `never-synced` → XMP mtime check → not pending.
2. **Early-exit stat walk for change detection**: When only the existence of a single modified file is needed, use an early-exit recursive stat walk — call `fsp.stat` only on target files, return `true` immediately on first match, cap depth, skip `stat` errors without crash.
3. **Fire-and-forget background scan busy guard**: Module-level boolean guard + try/finally reset collapses overlapping background IPC calls. Store only lightweight primitive results (count, boolean). Do not queue — do not prevent re-entry after completion.
4. **IPC result initialization must match success-path type**: If a result field is `{ groups, keywords }` on success, initialize it as `{ groups: [], keywords: [] }`, not `[]`. Mismatched initialization type produces fragile fallback semantics.
5. **Atomic sync error/success pair**: Clearing `lastMetadataSyncError` and writing `lastMetadataSync` must be a single atomic tmp→rename write. Never split them. Error persistence on failure is best-effort (inner try/catch) — if it fails the event appears as `never-synced` or `xmp-changed`, which is acceptable.

Promote to agents:
- `metadata-specialist.md` — lessons 1, 5 (scanPendingEvents priority order; atomic error/success pair)
- `performance-auditor.md` — lessons 2, 3 (early-exit stat walk; fire-and-forget busy guard)
- `event-data-guardian.md` — lesson 4 (IPC result initialization type must match runtime type)

Status:
- Promoted

---

### 2026-05-11 — Archive Operations Layer: Phase 1 (Settings, IPC, Modal) and Phase 2 (NAS Event Scan, Cache)

Task type:
- Feature / IPC / Main Process / Renderer / Modal / Persistence / Async Safety

What happened:

**Phase 1 — Archive Settings, Validation IPC, Archive Locations Modal:**
- Added `getNasRoot/setNasRoot`, `getLocalStagingRoot/setLocalStagingRoot`, `getDefaultImportMode/setDefaultImportMode` to `services/settings.js`.
- Added 7 `archive:*` IPC handlers and 7 preload bridge methods.
- NAS validation reads `.autoingest/root/archive-root.json` and checks `type === 'autoingest-nas-root'`.
- Staging validation uses a write-probe temp file with a `finally` cleanup guard (not sequential unlink).
- `archive:getOperationsStatus` returns one of: `ready | nas-not-set | nas-disconnected | invalid-nas | local-staging-missing`.
- Added Archive Locations modal (`#archiveLocationsModal`) using `.emm-overlay` pattern.
- Re-entry guard: `overlay.classList.contains('open')` checked before the first `await` inside `_alocOpen()`.
- Pending-state pattern for all editable fields: capture `const nasRootChanged = _alocPendingNasRoot !== undefined` BEFORE calling `_alocClose()`, which resets all pending fields to `undefined`.
- Bug caught by code-reviewer (Phase 1): `_alocPendingNasRoot` was read AFTER `_alocClose()` reset it. The check always evaluated false.

**Phase 2 — NAS Event Scan Service and Cache:**
- Created `services/nasEventCache.js` — atomic write/read/clear for `userData/nasEventCache.json`.
- Added `_scanNasArchive(nasRoot)` in main: reads collections → event folders, classifies managed/external/corrupt events, skips `_Selected`/`.autoingest`/`__MACOSX`/dot-dirs.
- IPC payload safety: `const { imports: _omit, ...meta } = eventJson` before pushing to the scan result — same pattern as `master:scanEvents`.
- 4 IPC handlers + 4 preload methods: `archive:scanNasEvents`, `archive:refreshNasEvents`, `archive:getCachedNasEvents`, `archive:clearNasEventCache`.
- Added `#ovNasEvents` overview tile and `_applyNasEventsCard()` / `_refreshNasEventsCard()`. Renderer stores only aggregate counts (`_nasEventStats`), never event objects (Layer 2b of performance-playbook.md).
- Startup pattern: cache-first (instant display, `source: 'cache'` in IPC response) then live NAS scan (background update).
- Bug caught by code-reviewer (Phase 2): same pending-state-before-close pattern — `_alocPendingNasRoot !== undefined` check was after `_alocClose()`. Fixed with the same capture-before-close pattern.

Reusable lessons:

1. **Pending-state-before-close**: When a modal save handler checks a pending field (`_pendingX !== undefined`) to decide whether to trigger a side-effect after closing the modal, it must capture the boolean BEFORE calling `_close()`. `_close()` resets all pending fields to `undefined`, so any check after close always evaluates false. Capture: `const changed = _pendingX !== undefined; _alocClose(); if (changed) { ... }`.

2. **Dual-write DOM ownership**: Two async functions writing to the same DOM element produce silent clobbering. Each DOM element must have exactly one owning writer. When `_renderHomeContextBar()` and `_updateSystemStatus()` both update `#archivePath`, they overwrite each other on every navigation. Assign ownership to the natural writer and remove the competing write.

3. **Re-entry guard before first await in async modal open**: Any `async function _open()` that `await`s before showing the modal must check `overlay.classList.contains('open')` before the first `await`. Without this guard, a double-click triggers two parallel IPC round-trips; the second one resets pending edits mid-flight.

4. **`type="button"` on all `.emm-overlay` modal buttons**: All close/dismiss/action buttons inside `.emm-overlay` modals must carry `type="button"`. Missing this causes accidental form submission. (Already in ui-system-specialist.md — no promotion needed.)

5. **IPC payload safety — `imports[]` stripping at scan source**: NAS archive scan follows the same pattern as `master:scanEvents`. Destructure `imports[]` out of `eventJson` before pushing to the IPC response. Passing full event objects with `imports[]` OOMs the renderer. (Already in performance-auditor.md — no promotion needed.)

6. **Cache vs. authoritative distinction in IPC responses**: When returning cached data from a local file cache, include `source: 'cache'` in the IPC response so the renderer can label the display as stale. The cache is never authoritative — prefer live scan, fall back only on failure or first load. The UI must surface the stale state (e.g., CACHED badge).

7. **Write-probe cleanup in `finally`**: When a validation IPC handler writes a temp probe file to test write access, the `fsp.unlink` must be inside a `finally` block. A sequential unlink after the write leaves the probe file if any error occurs between write and unlink. Pattern: `await fsp.writeFile(probe, '1'); try { /* validate */ } finally { await fsp.unlink(probe).catch(() => {}); }`.

Common failure modes:
- Reading a pending field after calling the close function that resets it.
- Two functions owning the same DOM element, clobbering each other on each render cycle.
- An async `_open()` that awaits before the re-entry check, allowing double-invocation.
- Sequential file probe unlink that fails to clean up on error.

Promote to agents:
- `ui-system-specialist.md` — lessons 1 (pending-state-before-close), 2 (dual-write DOM ownership), 3 (re-entry guard for async modal open)
- `contract-debugger.md` — lesson 1 (pending-state-before-close as a debugging pattern), lesson 7 (write-probe cleanup)
- `autoingest-architect.md` — lesson 6 (cache vs. authoritative IPC response)

Lessons NOT promoted:
- Lesson 4 (`type="button"`): already in `ui-system-specialist.md`.
- Lesson 5 (IPC payload stripping): already in `performance-auditor.md`.

Status:
- Promoted

---

### 2026-05-09 — Metadata Sync Phase 1D: Keyword Registry ID Stabilization and Modal Tab Refinement

Task type:
- Metadata / Persistence / UI / Renderer / Data Model / Keyword Registry

What happened:

**Keyword ID generation (`metadataSyncService._generateKeywordId`):**
Bridge TXT hierarchy uses leading numbers in two distinct ways: sequential ordering markers (01, 04 etc.) and meaningful reference identifiers (53, 114 etc.). A threshold of 20 was established: strip a leading numeric prefix only when the number ≤ 20 (section ordering), preserve it when > 20 (meaningful reference number). This produces stable, deterministic IDs: `["05 People","01 Duat Mutlaqin","53 SMS Syedna..."]` → `people.duat_mutlaqin.53_sms_syedna_...`.

**Depth-0 Bridge TXT entries must be skipped in `_parseBridgeTxt`:**
Group root labels (e.g. "01 Event", "05 People") at depth 0 live in `registry.groups` and are category/root references — not usable keywords. The original parser emitted them into the keywords array. Fix: `if (depth === 0) continue` after updating the stack.

**Keyword ID deduplication order:**
`updateRegistryFromBridgeTxt` now checks in this order: (1) by generated ID (same ID + same label = unchanged; same ID + different label = possible spelling update), then (2) by label match (same label + different path = possible move), then (3) by parentId sibling + `_looksLikeSpellingUpdate` for legacy entries without IDs. This order prevents false positives. Checking label first would incorrectly flag spelling updates as moves.

**Metadata Sync modal tab structure:**
Two-tab modal (Metadata Updates / Keyword Registry) was added. Pattern used: `data-ms-tab="panelId"` on each tab button, `querySelectorAll('[data-ms-tab]').forEach(...)` delegate, `_msSetTab(id)` iterates all known panel IDs to update display and `aria-selected`. This is distinct from the `data-active` container pattern (suited to large panel sets) — the `data-ms-tab` delegate is preferred for smaller two-tab modals where there is no wrapping tab-container element carrying state.

**X button removal (Metadata Sync modal):**
The Activity Log and Event Management modals have no top-right X button. The Metadata Sync modal now matches. Removal required deleting HTML, the click listener, and replacing `msCloseBtn.focus()` with `document.getElementById('msTab-metadata')?.focus()`.

**Registry status fire-and-forget:**
`_msRefreshRegistryStatus()` is called without `await` in `openMetadataSyncModal` so the modal opens immediately. The registry count/warning populates asynchronously. Matches the existing pattern for background status reads on modal open.

**`possibleSpellingUpdates` are never auto-applied:**
The service returns `possibleSpellingUpdates: []` on `applyChanges=true` (apply only writes `newKeywords`). The renderer shows the count in the preview with explicit "not auto-applied" copy. This is a feature-specific UX policy.

Reusable lessons:

1. **Keyword ID ordering-prefix stripping must use a ≤20 threshold.** Numbers ≤ 20 are section markers; numbers > 20 are meaningful reference identifiers that belong in the slug.
2. **Depth-0 Bridge TXT entries (group headers) must be skipped; they belong in `registry.groups`, not keywords.**
3. **Keyword registry deduplication must check by ID first, then label, then parentId sibling.** Wrong order produces false positives (spelling update treated as move).
4. **`data-ms-tab` delegate pattern is preferred for two-tab modals without a wrapping tab container carrying `data-active` state.**

Promote to agents:
- `metadata-specialist.md` — lessons 1, 2 (keyword ID generation threshold; depth-0 skip rule)
- `contract-debugger.md` — lesson 3 (deduplication order as a correctness contract)
- `ui-system-specialist.md` — lesson 4 (data-ms-tab delegate as a variant tab pattern)

Lessons NOT promoted:
- X button removal convention — project-specific UI convention, not a reusable debugging or implementation rule.
- Registry status fire-and-forget — already covered by the IPC async and live panel refresh rules.
- `possibleSpellingUpdates` non-auto-apply — feature-specific UX policy; belongs in feature docs.

Status:
- Promoted

---

### 2026-05-09 — Metadata Architecture Refactor (8 Parts, commit fa30cbb)

Task type:
- Architecture / Metadata / Persistence / IPC / UI / Data Model / Migration

What happened:

A major 8-part refactor extracted per-file metadata out of `event.json` into a companion `event.metadata.json` child file. Covered companion-file contract, write-order guarantee, RAW peer identity, auto-migration, rich sync result UI, pending reason expansion, and optional external ID.

**1 — event.metadata.json child-index contract:**
`event.json` grew large due to per-file `fileMeta` objects. New pattern: slim `event.json` (master, always authoritative) + companion `event.metadata.json` (child, keyed by `event.json.metadataIndex`). Child is only valid because parent points to it. Child must never be read on home screen or background scan — only on explicit sync. Keywords stored once in `event.metadata.json.keywords[keywordId]`; files carry only `externalKeywordIds[]`.

**2 — Write-order guarantee for two-file atomic updates:**
Always write CHILD file first (`event.metadata.json` via tmp→rename), then update PARENT (`event.json` metadataIndex + lastMetadataSync). If child write fails, parent is untouched (consistent). If parent update fails, child is safe and retry can recover. Never reverse this order.

**3 — RAW peer lookup for file identity:**
XMP sidecars are not canonical identity. Key `event.metadata.json.files` by the RAW peer path (CR2/NEF/ARW/DNG), falling back to XMP path only when no RAW peer exists. Use `fsp.access()` for cheap existence check. When migrating, check both RAW and XMP keys because old data used XMP keys.

**4 — Auto-migration pattern for storage schema upgrades:**
Detect migration needed in `scanPendingEvents` (`fileMeta && !metadataIndex` → reason `migration-needed`). Perform migration inside `syncEventMetadata` before the actual sync. Build initial `event.metadata.json` from old `fileMeta`, merge new sync results on top. After success: delete `fileMeta`, write `metadataIndex`. Must be idempotent.

**5 — Rich sync result payload for UI feedback:**
IPC sync handlers should return a structured result with stats, keyword chips, file write status, elapsed ms, and backward-compat aliases so the UI can show meaningful feedback without a second round-trip. UI pattern: disable button on click, show inline `.ms-result-panel` below the row (do not hide row), show success with chips + stats or failure with Retry; remove previous result panel before starting a new sync.

**6 — Pending scan reasons extended:**
New reasons added to `scanPendingEvents`: `migration-needed` (`fileMeta && !metadataIndex`), `metadata-index-missing` (`metadataIndex.status === 'missing'`), `metadata-index-mismatch` (`metadataIndex.eventId ≠ doc.eventId` when both present). `never-synced` must be gated on actual XMP sidecar presence (`_hasXmpModifiedAfter(dir, 0, 0)`) — without this gate, empty events flood the pending list.

**7 — Optional external ID pattern:**
Archive Registry ID stored as `event.json.eventId` + `eventRegistry { system, id, linkedAt }`. Must be optional — legacy events without it continue working. Must NOT be used for folder naming, import routing, or generated inside AutoIngest. Validate consistency between `event.json.eventId` and `event.metadata.json.eventId` only when both are present; skip entirely for legacy events.

Reusable lessons:
1. event.metadata.json child-index contract: parent owns authority, child is valid only via pointer, never read child on home/background scan.
2. Two-file write order: child first (atomic), parent second. Never reverse.
3. RAW peer is canonical file identity key; XMP sidecar is not.
4. Lazy auto-migration on first sync click, triggered by `migration-needed` pending reason; must be idempotent.
5. Rich IPC result payload enables one-round-trip UI feedback; inline result panel pattern for sync rows.
6. `never-synced` must be gated on XMP presence; three new pending reasons: migration-needed, metadata-index-missing, metadata-index-mismatch.
7. Optional external ID must not affect routing, folder naming, or be auto-generated; validate consistency only when both sides present.

Promote to agents:
- `metadata-specialist.md` — lessons 1, 2, 3, 4, 6
- `contract-debugger.md` — lesson 2 (write-order as a diagnostic/correctness pattern)
- `ui-system-specialist.md` — lesson 5 (rich sync result panel)
- `ingestion-routing-specialist.md` — lesson 7 (optional external ID must not affect routing)

Status:
- Promoted

---

### 2026-05-09 — JPEG Metadata Support, Preview Enrichment, and Row Interaction Patterns

Task type:
- Metadata / UI / Renderer / IPC / Feature / Sync Service

What happened:

**JPEG embedded metadata support:**
`metadataSyncService.js` had four hardcoded `ext === '.xmp'` checks that made the entire pipeline blind to JPEG files. Adobe Bridge writes keywords as embedded IPTC/XMP directly into JPEGs — no sidecar. Fix: added `EMBEDDED_EXTENSIONS` Set and `_isMetadataBearingFile()` helper; replaced all 4 checks. Added `_readKeywordsFromJpeg()` that unions `tags.Subject`, `tags.Keywords`, and `tags.HierarchicalSubject` from the existing `readFileTags()` pool. Sync loop now routes by extension: JPEG uses itself as the canonical key; XMP uses `_findRawPeer()`. JPEG canonical key = JPEG relPath. XMP canonical key = RAW peer relPath. These must never be conflated.

**Metadata Change Preview modal:**
Read-only mirror of `syncEventMetadata`'s first half, capped at 200 files. Returns `willAdd`, `alreadyPresent`, `unknownKeywords`, `skippedConflicts` per file. Does NOT write any files. `masterFolderName` injected into each pending row via a single post-processing `.map()` at the end of `scanPendingEvents` — avoids touching every `pending.push()` call. Modal uses `_msEnsurePreviewModal()` lazy injection pattern: DOM created once, appended to `document.body` on first open.

**Full Bridge keyword comparison in preview:**
Root cause: `_classifyKeywords` silently drops identity-category keywords that match the event value (`continue` after checking IDENTITY_CATEGORIES — even a matching keyword is never returned). Preview must walk `foundKeywords` a second time after `_classifyKeywords` to build `protectedIdentityMatches`. Preview also builds `detectedBridgeKeywords` — a complete annotated list of all Bridge-detected keywords with `matchStatus` values (`will-add`, `already-present`, `protected-identity`, `unknown`). Event identity block rendered once above file cards as a purple chip row.

**Row interaction patterns:**
Row body has `data-event-path`, click opens preview. `.ms-sync-btn` inside the row must call `e.stopPropagation()`. Row click handler must check `if (e.target.closest('.ms-sync-btn')) return;`. Both guards are required. Update button handler cloned (`.cloneNode(true)`) before each open to remove stale listeners.

Reusable lessons:

1. **JPEG relPath is the canonical key for embedded-metadata files.** XMP canonical key = RAW peer relPath. Never conflate these two routing paths — they must be consistent between preview and sync.

2. **`_classifyKeywords` silently drops identity-category keywords, including matching ones.** Preview functions must run a second pass over `foundKeywords` to surface these as `protectedIdentityMatches`. This second pass must not modify the sync path.

3. **Preview enrichment must be a separate pass, not a modification of sync logic.** Call `_classifyKeywords` as-is for correctness, then annotate in additional passes for display only.

4. **`detectedBridgeKeywords` annotation pattern.** Build a complete annotated list with `matchStatus`. This is the single source of truth for the Bridge section in preview UI. `willAdd`, `alreadyPresent`, `skippedConflicts` are subsets.

5. **Post-processing `.map()` for scan result enrichment.** When adding a computed field (e.g., `masterFolderName`) to every item in a scan result, add one `.map()` at the end of the function. Avoids scattering the injection across every `pending.push()` call.

6. **Lazy modal injection pattern.** `_msEnsurePreviewModal()` creates DOM once on first call, appends to `document.body`. Subsequent calls reuse the same node. Avoids polluting static HTML with rarely-used modal markup.

7. **Row click guard when row contains a button.** Button handler calls `e.stopPropagation()`. Row handler checks `if (e.target.closest('.ms-sync-btn')) return;`. Both guards together are required — neither alone is sufficient.

8. **Clone button nodes before re-wiring to prevent stale listener accumulation.** Use `btn.cloneNode(true)` and replace the old node before adding a new listener, so each modal open starts with a clean handler.

Common failure modes:
- Routing JPEG files through `_findRawPeer()` — JPEG has no RAW peer.
- Modifying `_classifyKeywords` to surface identity matches instead of adding a separate preview pass — risks contaminating the sync path.
- Adding `masterFolderName` inside every `pending.push()` call instead of a single post-processing map.
- Stacking event listeners on the Update button by re-wiring without removing or cloning first.

Promote to agents:
- `metadata-specialist.md` — lessons 1, 2, 3, 4, 5
- `ui-system-specialist.md` — lessons 6, 7, 8

Status:
- Promoted

---

### 2026-05-10 — Metadata Sync Modal: Affected-Folder Chips, Changed/Removed Preview Section, +N More Truncation

Task type:
- Metadata / UI / Renderer / Preview / Bug Fix

What happened:

**Bug 1 — Main modal showed only 1 affected photographer folder instead of all:**
`_findChangedXmpSubfolders()` used `_hasXmpModifiedAfter(subfolder, lastSyncMs, 0)` to collect the `changedSubfolders` list. This mtime filter included only folders whose files were NEWER than `lastSyncMs`. But the preview scans ALL files and compares them against `event.metadata.json` — so it found more affected folders than the main modal showed. The two displays were inconsistent because they used different scoping rules.
Fix: added `_listMetadataSubfolders(eventDir)` which calls `_hasXmpModifiedAfter(full, 0, 0)` (sinceMs=0 = existence-only) to collect all subfolders containing any metadata-bearing files. Used instead of `_findChangedXmpSubfolders` for building the chip list in `xmp-changed` and `never-synced` pending rows.

Key distinction: the mtime check in `_findChangedXmpSubfolders` is CORRECT for determining IF an event is pending; it is WRONG for determining WHICH folders to show the operator in the affected-chip list.

**Bug 2 — Preview showed internal classification language, no Changed/Removed section:**
`_msBuildGroupCard()` used section labels "Existing", "Additions", "Unknown / Needs Review", "Ignored event identity" — internal backend field names visible to operators. "Changed / Removed" was not computed or shown at all. Summary chips pulled from backend `summary` object (`s.alreadyPresent`, `s.unknown`).

Fix (renderer-only, no backend change):
- Computed `removedKeywords` in `_msGroupFiles()` from data already in each file: `existingIndexedKeywords` (source='bridge') minus `detectedBridgeKeywords` labels.
- Included `removedKeywords` in the change-signature so groups with different removals are correctly separated.
- Renamed sections in `_msBuildGroupCard()`: Existing → "Existing Metadata", Additions → "New Additions", Unknown/Needs Review → "Needs Review"; added "Changed / Removed" section with `ms-pv-kw-chip--skip` chips; removed "Ignored event identity" note entirely.
- Derived summary chip counts from renderer's grouped data (not from `result.summary.*`) so `removedKeywords` count appears correctly.

**Part 3 — "+N more" truncation for photographer-folder chips:**
Multiple photographer-folder chips in a compact row are now truncated at 4 visible chips with a "+N more" chip (dashed border, italic style) to keep rows scannable without hiding information.

Reusable lessons:

1. **Affected-folder chip list must use existence-only scan (sinceMs=0), not mtime-filtered scan.** Mtime filtering is correct for DETECTING if an event is pending; it is wrong for SHOWING the operator which folders are affected.

2. **"Changed / Removed" bridge keywords are a pure renderer computation.** `existingIndexedKeywords.filter(k => k.source === 'bridge')` minus `detectedBridgeKeywords` labels. No backend change needed — the data is already in the preview payload.

3. **Summary chip counts must be derived from the renderer's grouped data when the renderer adds computed fields the backend doesn't know about.** Pulling from `result.summary.*` misses any field the renderer computed.

4. **Change-signature in `_msGroupFiles` must include ALL dimensions visible in the UI — including `removedKeywords`.** Missing a dimension causes visually different groups to be merged incorrectly.

5. **Preview UI section labels must use operator language: "Existing Metadata", "New Additions", "Changed / Removed", "Needs Review".** Never expose backend field names (`alreadyPresent`, `willAdd`, `unknownKeywords`, `protectedIdentityMatches`, `ignoredIdentity`) as section headings.

6. **When showing multiple compact chips in a pending row, truncate at 4 with a "+N more" chip (dashed border, italic) to keep rows scannable.**

7. **Classification logic stays in the backend; operator-friendly labels are applied only in the renderer.** The backend never needs to be modified to change what terminology the operator sees.

Common failure modes:
- Using mtime-filtered subfolder scan to build the chip list shown to the operator — shows fewer folders than the preview will actually process.
- Pulling summary chip counts from `result.summary.*` when the renderer adds fields that backend doesn't know about.
- Omitting `removedKeywords` from the group change-signature — merges groups that differ only in removed keywords.
- Using backend enum names or field names as visible section headings in preview UI.

Promote to agents:
- `metadata-specialist.md` — lessons 1, 2, 3, 4 (subfolder chip scoping; removedKeywords computation; summary derivation from renderer groups; change-signature completeness)
- `ui-system-specialist.md` — lessons 5, 6, 7 (operator language for preview sections; +N more chip; backend/renderer label separation)

Status:
- Promoted

---

### 2026-05-10 — previewEventMetadata Classification Fix (commit 1464c85)

Task type:
- Metadata / Sync Service / Bug Fix / Preview / Classification

What happened:

`previewEventMetadata` in `main/metadataSyncService.js` was misclassifying keywords like "Fajr Namaz" or "Surat" as New Additions even when they were already the current event's type or city. Two compounding bugs:

1. `_classifyKeywords` used the keyword's registry category (e.g., `'misc'`) to decide if it was an identity field. A keyword like "Fajr Namaz" with category `'misc'` bypassed the `IDENTITY_CATEGORIES` guard and landed in `willAdd` even though it was the event's event-type label.
2. The `willAdd`/`alreadyPresent` split only compared against `existingExtLabels` (previously stored Bridge keywords). Event identity label values from `event.json` were never in that comparison set.

Fix:
- Removed `IDENTITY_CATEGORIES` constant and the category-based guard from `_classifyKeywords` — all registry-known Bridge keywords now pass through unconditionally.
- Built `effectiveExistingLabels` = `existingExtLabels` ∪ `existingAutoLabels` ∪ event identity label values (lowercased).
- Used `effectiveExistingLabels` for the `willAdd`/`alreadyPresent` split — purely label-based, never category-based.
- Removed `protectedIdentityMatches` block and `protected-identity` matchStatus (dead concepts once category-based classification is removed).
- Fixed `hasChanges` to exclude `alreadyPresent.length > 0` — files with only already-known keywords no longer appear as changed.

Reusable lessons:

1. **Preview classification must compare against effectiveExistingLabels, never keyword registry category.** Build `effectiveExistingLabels` from: (a) previously stored `externalKeywordIds` labels, (b) `autoKeywordIds` labels, (c) current event identity label values (lowercased). A keyword is "existing" if its label is in this set — regardless of its registered category.

2. **Never use keyword registry category to decide "existing" vs "new addition" in preview.** Category membership (e.g., `IDENTITY_CATEGORIES.has(category)`) is unreliable: a keyword's functional role (event type, location) does not always match its registered category. Use label-exact comparison against the effective existing set instead.

3. **`hasChanges` in `previewEventMetadata` must reflect real pending changes only.** Only `willAdd.length > 0 || unknownKeywords.length > 0` constitutes a pending change. Including `alreadyPresent.length > 0` creates noise: files with only already-known metadata appear as changed when nothing needs operator review.

4. **`_classifyKeywords` is shared between preview and sync. Do not conflate the sync storage decision with the preview display decision.** In sync, all `externalKeywords` are stored in `externalKeywordIds` regardless of `willAdd`/`alreadyPresent` split. That split matters only for preview display; it must not affect sync storage.

5. **The `source: 'bridge'` annotation on `existingIndexedKeywords` entries is load-bearing.** The renderer's "Changed/Removed" computation filters by `source === 'bridge'`. Event identity keywords carry `source: 'auto-event'` and are intentionally excluded from removal detection. Do not change these source values without updating the renderer filter.

Promote to agents:
- `metadata-specialist.md` — all 5 lessons

Status:
- Promoted

---

### 2026-05-10 — Metadata Sync Stabilization and Scan Performance Optimization

Task type:
- Metadata / Sync Service / Bug Fix / Performance / UI / Classification / IPC

What happened:

Three correctness bugs in the Metadata Sync modal were fixed, then collection-wide scanning performance was optimized. Work spanned `main/metadataSyncService.js`, `main/main.js`, `renderer/renderer.js`, and `renderer/index.html`.

**Bug 1 — Display data and operation data used different classification logic:**
Pending row chips showed "affected photographer folders" from `_listMetadataSubfolders` (presence-only scan). The Metadata Change Preview showed groups from `effectiveExistingLabels + _classifyKeywords` (actionable-changes-only scan). One folder appeared in chips but not in preview because the two paths used different definitions of "affected." Fix: replaced `_listMetadataSubfolders` with `_classifySubfolders` — a new helper sharing the same `effectiveExistingLabels + _classifyKeywords` logic as the preview. Both paths now share one definition of "actionable."

**Bug 2 — `_classifySubfolders` performed a full recursive content scan on all subfolders upfront:**
After fixing the classification divergence, `_classifySubfolders` called `_scanXmpSidecars(eventFolderPath)` on all subfolders, then called `_readKeywordsFromSidecar` / `_readKeywordsFromJpeg` for every file including unchanged ones. Fix: restructured into a two-stage per-subfolder loop. Stage 1: top-level `readdir` + `_hasXmpModifiedAfter(subdir, sinceMs, 0)` (stat-only, no content reads). If no file is newer than `lastSyncMs`, skip the subfolder. Stage 2 (only for stale subfolders): `_scanXmpSidecars + read keywords + classify`, with `break` on first actionable file. Also threaded `lastSyncMs` from `_checkEventPending` into `_classifySubfolders`.

**Bug 3 — `eventIdentity is not defined` crash in `previewEventMetadata`:**
A prior session renamed `eventIdentity` (object) → `eventIdentityLabelSet` (Set) but missed one call site: `_classifyKeywords(foundKeywords, autoKeywordSet, eventIdentity)`. Because the function declared but never used the third parameter internally, passing `undefined` didn't crash inside — it crashed at the call site where `eventIdentity` was the undefined variable. Fix: removed the undefined argument from both call sites and dropped the now-unused parameter from `_classifyKeywords`. Verified with `grep -n "\beventIdentity\b"`.

**Semantic naming fix — `changedSubfolders` must mean "subfolders with actionable changes":**
`changedSubfolders` was populated with "all subfolders containing any metadata-bearing files." After the classification fix, it now contains only subfolders with at least one actionable change — matching the preview exactly. If only broad scanned folders are available (error/migration cases), `changedSubfolders` is omitted and reason text is shown instead.

**`userDataPath` must flow to registry-dependent functions:**
`_classifySubfolders` calls `_loadRegistry(userDataPath)`. The registry is a module-level singleton — O(1) after first load, but the first call needs `userDataPath` to locate `keywords.override.json`. `scanPendingEvents` and `scanSingleEventFolder` did not accept `userDataPath` and did not pass it through. Fix: added `userDataPath` parameter to both functions; updated the two IPC handlers in `main.js` to pass `app.getPath('userData')`.

**Select Event UI picker visual and context fixes:**
The scope picker appeared as a borderless floating element. Fix: added `border`, `padding`, `background` to `.ms-scope-picker`; added `border`, `border-radius`, `background` to `.ms-scope-event-list`; each event item now shows two lines (event name + master folder name); `msScopeResultLabel` element added to confirm which event's results are shown.

Reusable lessons:

1. **Same classification path for display and operation**: When two UI surfaces show data derived from the same scan (pending chips AND preview groups), both must use identical classification logic. Never let a lighter scan produce display data that diverges from the heavier classification.
2. **Two-stage mtime gate for per-subfolder scan**: For classify-per-group operations: (1) top-level readdir only, (2) per-subfolder stat-only mtime gate, (3) for stale subfolders only: content reads + `break` on first hit.
3. **Stale variable reference at call site after rename**: After any variable rename, grep the old name across the whole file, especially at call sites. A function that accepts but ignores a parameter will not crash inside — the crash surfaces at the call site where the old name is used as the argument.
4. **`changedSubfolders` semantic contract**: In the pending event object, `changedSubfolders` must contain only subfolders that will be visible in the preview. If a folder appears in chips, it MUST appear in the preview.
5. **`userDataPath` must flow to all registry-dependent functions**: Any function calling `_loadRegistry` (directly or transitively) must accept `userDataPath`. IPC handlers always have `app.getPath('userData')` — wire it down the call chain.
6. **Scope picker visual contract**: Any multi-item event/scope selector in the Metadata Sync modal needs a bordered container with background, two lines of context per item (name + collection/master), and a result label confirming which event's results are displayed.

Promote to agents:
- `metadata-specialist.md` — lessons 1, 2, 4, 5
- `contract-debugger.md` — lesson 3
- `ui-system-specialist.md` — lesson 6

Status:
- Promoted

---

### 2026-05-10 — Metadata Sync Hardening: Sync Resilience and Scan Reliability (commit b14d5fd)

Task type:
- Metadata / Performance / Persistence / IPC / UI / Renderer / Reliability / Hardening

What happened:

**Lesson 1 — eventId mismatch validation required in every function that loads event.metadata.json:**
Any function that reads `event.metadata.json` must compare the stored `eventId` against `doc.eventId` from `event.json` before trusting the index. Without this check, a stale or moved index file can contaminate keyword classification across events. Pattern applied in `syncEventMetadata`, `previewEventMetadata`, and `_classifySubfolders`. Must also be applied in any future function that loads the child index.

**Lesson 2 — Variable scope for multi-layer try/catch: lift `let doc = null` outside outer try:**
If a variable is declared inside the inner try block, the outer catch cannot access it. When error reporting needs the variable (e.g., to include `eventName` or `eventId` in the failure result), declare it as `let doc = null` before the outer try. Without this, every error result shows empty strings for event identity fields, making it impossible to identify which event failed.

**Lesson 3 — Stale-result prevention for async UI scans: `_msScanCounter` pattern:**
When a scan is async and the user can change scope before it completes, guard rendered output with a monotonically incrementing counter. The counter is incremented at the start of the leaf scan function; before rendering results, compare the local capture to the current counter value. Functions that delegate to the leaf scan (collection scope path) must NOT double-increment — only the leaf scan function increments. Non-collection branches that directly call IPC themselves DO increment.

**Lesson 4 — All-keywords-removed case: load existing stored keywords BEFORE the empty-keywords skip check:**
When a per-file loop skips files because `foundKeywords.length === 0`, it silently hides the "Changed / Removed" case: a file that previously had bridge keywords stored but now has none. Correct structure: (1) read current Bridge keywords, (2) fast-path skip only when no keywords AND no prior index (first sync), (3) compute relPath, (4) load stored bridge keywords, (5) skip only when both current AND stored are empty, (6) include file if `removedBridgeCount > 0`.

**Lesson 5 — Fast-path placement in two-stage loops to preserve performance for the all-removed fix:**
When restructuring a loop to compute `relPath` before the empty-keywords skip (needed for Lesson 4), add a fast-path guard `if (foundKeywords.length === 0 && !existingMetaDoc) continue` before the expensive relPath computation. This preserves the original skip rate for first-sync events where the all-removed case can never occur. Always pair the all-removed fix with this fast-path guard.

**Lesson 6 — Silent catch blocks that affect downstream behavior must log:**
Any `catch {}` block that discards an error affecting classification, persistence, or display must log the error. Replace silent catches with `catch (err) { log(...err.message...) }` so that "why was the index discarded?" is answerable from logs without a breakpoint.

**Lesson 7 — Collection scan diagnostics: log timing and counts per run:**
Any async function that walks a directory of events must log timing and outcome (events checked, pending count, elapsed ms, master folder name) after completion. Without this, a missing event due to wrong mtime, bad event.json, or wrong master path is completely invisible.

Reusable lessons:
1. eventId mismatch check required in every function loading event.metadata.json.
2. Declare `let doc = null` outside outer try when the catch block needs doc for error identity fields.
3. `_msScanCounter` monotonic counter guards async UI scan output; only the leaf scan function increments.
4. Load existing stored bridge keywords before the empty-keywords skip to capture the all-removed case.
5. Pair the all-removed fix with a fast-path `!existingMetaDoc` guard before expensive relPath computation.
6. Silent catch blocks affecting classification or persistence must log the error.
7. Collection scan functions must log timing and counts for diagnosability.

Common failure modes:
- Reading event.metadata.json without comparing its eventId to event.json — stale index silently contaminates classification.
- Declaring doc inside the inner try, leaving error results with empty identity fields.
- Incrementing `_msScanCounter` in the collection-scope branch when the leaf scan also increments — double-increment discards valid results.
- Placing the empty-keywords skip before loading existing stored keywords — hides the all-removed case.
- Adding the all-removed fix without the fast-path guard — triggers expensive stat calls on every file in first-sync events.
- Using `catch { }` without logging in paths affecting downstream behavior.
- Omitting timing/count logging from collection scan functions.

Promote to agents:
- `metadata-specialist.md` — lessons 1, 4, 5, 7 (eventId mismatch; all-removed case; fast-path pairing; scan diagnostics)
- `contract-debugger.md` — lessons 2, 6 (variable scope for catch; silent catch logging)
- `ui-system-specialist.md` — lesson 3 (stale-result counter pattern)

Status:
- Promoted

---

### 2026-05-11 — Phase 4: Modal Event Listener Cleanup via AbortController

Task type:
- UI / Renderer / Modal / Event Listeners / Cleanup

What happened:

Phase 4 added radio button `change` listeners inside the Promise executor of `showEventImportConfirmModal` (`renderer/renderer.js`, G5 section, ~line 6944). A code review flagged that these listeners were not cleaned up when the modal closed. The fix introduced `AbortController`: `const modeAbort = new AbortController()` is created before the listeners are added; `{ signal: modeAbort.signal }` is passed to each `addEventListener`; `modeAbort.abort()` is called at the top of the `close()` function, removing all tied listeners at once. `abort()` is idempotent, so calling it from both the cancel and confirm paths is safe.

Reusable lesson:

When a modal adds 3 or more `addEventListener` calls that must be removed on close, use an `AbortController` (`{ signal }` option) instead of storing named handler references. One `abort()` call tears down all listeners at once, is idempotent across cancel/confirm paths, and requires no per-listener bookkeeping.

Common failure mode:
- Adding multiple listeners inside a modal's Promise executor and omitting cleanup, leaving orphaned listeners after close.
- Tracking named handler variables to call `removeEventListener` individually — one variable per listener, all of which must be correctly removed from every close path.

Promote to agents:
- `ui-system-specialist.md` — modal listener cleanup via AbortController

Status:
- Promoted

---

### 2026-05-11 — Phase 6: innerHTML Lookup-Table Fallback XSS and Busy-Guard Coverage Gaps

Task type:
- Security / Renderer / UI / Async Safety

What happened (Lesson 1 — innerHTML lookup-table fallback XSS):
- In `renderer/renderer.js`, `_sqJobRow(job)` built an innerHTML row for a sync queue job. A `statusLabel` lookup table mapped known status strings to display labels. The fallback `|| job.status` (for unknown statuses) was injected raw into innerHTML without calling `_sqEsc()`. The lookup-table success paths appeared safe because they returned hand-written string literals. The fallback path silently re-exposed the raw IPC value, which could be tampered via a crafted `archiveSyncQueue.json`.

Reusable lesson (Lesson 1):
- When building innerHTML strings, every string injected via template literal must be escaped — including fallback/default branches of conditional expressions and lookup-table misses.
- The pattern `{ key: 'Safe Label' }[val] || val` is an XSS risk because the `|| val` branch injects the raw value.
- Always wrap the full expression: `_esc({ key: 'Safe Label' }[val] || val)`.
- Lookup table misses are easy to overlook during review because the table itself looks safe. The fallback is a silent raw passthrough.

Common failure mode (Lesson 1):
- Escaping the known/success paths in a lookup table, then leaving the `|| fallbackValue` branch unescaped because it appears to be a fallback, not a user value.

Preferred pattern (Lesson 1):
- `_sqEsc(STATUS_LABELS[job.status] || job.status)` — escape the whole expression, not just the known cases.

What happened (Lesson 2 — busy-guard coverage gap):
- `_refreshSyncQueueCard(fromCache)` used `_sqRefreshBusy` to prevent concurrent staging root filesystem scans during the startup double-call pattern. The `sqRefreshBtn` click handler performed its own `refreshSyncQueue()` IPC call without checking `_sqRefreshBusy`. During the startup window, clicking Refresh fired a second concurrent scan, with both writes landing on the same `archiveSyncQueue.json` file via concurrent tmp→rename. The file stayed structurally consistent but the second write could silently clobber the first's results.

Reusable lesson (Lesson 2):
- When a busy guard (`let _xBusy = false`) is introduced to protect an async operation, every call site that triggers the same underlying operation must check and apply the guard.
- A guard that only covers one call site (the startup path) provides no meaningful protection — it leaves the user-triggered path (button click) unguarded.
- Fix: set `_sqRefreshBusy = true` and check it at the top of the click handler before issuing any IPC.
- This pattern recurs in this codebase — NAS events card, metadata sync, and sync queue all use busy guards. Each time a new tile/button is added that triggers the same scan, the guard must be applied to the new button explicitly.

Common failure mode (Lesson 2):
- Introducing a busy guard for one obvious call site (startup double-call) and assuming it is sufficient, without auditing all other entry points to the same async operation.

Preferred pattern (Lesson 2):
- After introducing any `_xBusy` guard, grep every call site of the protected IPC/async function and apply the guard at each one before closing the task.

Promote to agents:
- `ui-system-specialist.md` — innerHTML escape: all template branches, including lookup-table fallbacks, must be escaped
- `ui-system-specialist.md` — busy-guard coverage: a guard applied to one call site is not sufficient; audit all call sites

Status:
- Promoted

---

### 2026-05-12 — Phase 7.1: setInterval with Async Callback — Silent Failure Without .catch()

Task type:
- Async Safety / Service Layer / Background Operations / Lock Heartbeat

What happened:
- Phase 7.1 added a heartbeat timer to renew archive sync locks during long jobs. The heartbeat calls `renewLock()` (an async function) inside `setInterval`. Without an explicit `.catch()` on the returned promise, any I/O error during renewal (e.g. archive volume disconnect, lock file permission error) would become an unhandled promise rejection — invisible to the caller and to the sync operation.
- The practical consequence: sync would continue writing files to the archive without a valid lock, defeating the entire purpose of the heartbeat.
- Fix: attach `.catch(err => { abortSignal.aborted = true; clearInterval(timer); })` inside the interval callback so any renewal failure conservatively aborts the sync and clears the timer.

Reusable lessons:
1. **setInterval does not await its callback.** The promise returned by an async callback inside `setInterval` is discarded by the runtime. Rejections become unhandled promise rejections and produce no visible error unless `.catch()` is attached.
2. **Always attach `.catch()` to async calls inside timers.** Either call `asyncFn().catch(handler)` directly, or wrap the callback body in an async IIFE with try/catch: `setInterval(() => { (async () => { try { await asyncFn(); } catch (err) { handle(err); } })(); }, ms)`.
3. **Timer handles must be cleared in all exit paths.** Every completion path (success, error, cancel, abort) must call `clearInterval`. Use `try/finally` in the owning operation to guarantee cleanup even on unexpected throws.
4. **Failure inside the timer must update operation state.** A silent timer failure that leaves an operation running with invalid state (e.g. writing to archive after lock expiry) is worse than a visible crash. The `.catch()` handler must propagate the failure into the owning operation (e.g. set `abortSignal.aborted = true`).

Applies to:
- Lock heartbeat timers
- Background queue refresh timers
- Polling loops that call async IPC or filesystem functions
- Retry timers
- Any renderer or main-process `setInterval` that invokes an async function

Common failure mode:
- Writing `setInterval(() => { asyncFn(); }, ms)` — the missing `await` and missing `.catch()` make this a silent fire-and-forget with no error handling.
- Timer handle stored in a `let` variable but only cleared on the success path, not in the `finally` block or error path.

Preferred pattern:
```javascript
let timer = setInterval(() => {
  asyncFn()
    .then(result => { /* handle success */ })
    .catch(err => {
      // propagate failure into owning operation
      abortSignal.aborted = true;
      clearInterval(timer);
      timer = null;
    });
}, intervalMs);

try {
  await doWork(abortSignal);
} finally {
  clearInterval(timer);   // always clears, even on throw
  timer = null;
}
```

Promote to agents:
- `contract-debugger.md` — async timer callback safety as a recurring Node.js pattern

Status:
- Promoted

---

### 2026-05-12 — Phase 12A: Main Archive Root Setting and Validation Foundation

Task type:
- Contracts / UI / Renderer / Persistence / Architecture

What happened:
- Added `archive:validateMainArchiveRoot` IPC handler and `_alocShowMainNasValidation` UI helper as part of the Main Archive Root modal section.
- The older `archive:validateNasRoot` handler conflates ENOENT-on-stat (directory unreachable) with ENOENT-on-readFile (marker absent): both return `reason: 'no-marker'`, making "Offline" and "Invalid archive" indistinguishable.
- The new handler uses a two-phase try/catch: stat in its own try/catch (any failure → `reason: 'offline'`), then marker-read in a second try/catch (ENOENT → `reason: 'no-marker'`, access error → `reason: 'no-access'`).
- A dedicated `_alocShowMainNasValidation` maps the four reason codes to operator-friendly status strings (Connected / Offline / Invalid archive / No access) rather than exposing raw codes or reusing the generic `_alocShowValidation` helper which shows ✓/✗ with technical message strings.
- `mainArchiveRoot` was threaded through all 7 return paths of `getArchiveOperationsStatus`. Reviewer confirmed all paths were correct.
- Modal open calls `validateMainArchiveRoot` as fire-and-forget (`.then(result => show(result)).catch(() => {})`) to avoid blocking modal open on a potentially slow filesystem stat.

Reusable lessons:
1. **Two-phase archive-root validator**: stat the path first (any error → `reason: 'offline'`), read the marker file second (ENOENT → `reason: 'no-marker'`, permission → `reason: 'no-access'`). Single try/catch conflates offline with invalid-archive.
2. **Status-string UI helper for archive sections**: map machine reason codes to operator-facing status strings in a dedicated display function. Do not expose raw reason codes in the UI; do not reuse generic validation helpers that show technical messages.
3. **All return paths when extending IPC handlers**: when a new field is added to a multi-return-path IPC handler, it must be added to every return path, not just the early-return path. Verify the total count of return paths before closing.
4. **Fire-and-forget validation on modal open**: call `window.api.validateX(path).then(result => showResult(result)).catch(() => {})` in the modal open function — do not await, do not block open on filesystem access.

Promote to agents:
- `autoingest-architect.md` — two-phase archive validator pattern and all-return-paths rule
- `ui-system-specialist.md` — status-string UI helper rule and fire-and-forget validation on modal open

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
