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
