# History — System Evolution

This document tracks major system changes and their impact.

Use this for:
- debugging regressions
- understanding architectural evolution
- identifying when behavior changed

---

## v0.5.1 — Stabilization

### Changes
- Import pipeline hardening
- Performance fixes

### System Impact
- INGEST
- PERFORMANCE

### Notes
- Focus on reliability and consistency
- Reduced import failures

---

## v0.6.0 — File Handling & UI

### Changes
- Folder view
- Recursive scanner
- UI improvements

### System Impact
- FILESYSTEM
- UI
- PERFORMANCE

### Notes
- Increased filesystem complexity
- Potential performance bottlenecks introduced

---

## v0.7.x — Core System Architecture

### Changes
- Dashboard rebuild
- Event system introduction
- Grouping system
- Import routing

### System Impact
- DATA
- GROUP
- ROUTING
- STATE

### Notes
- Major architectural shift
- Introduced event.json as source of truth
- Established ingestion pipeline structure

---

## v0.7.4-dev — Stabilization Pass

### Changes
- Atomic transaction write: `import:commitTransaction` replaces multi-step event.json writes
- `isValidEventJson` made non-mutating (no write-back of `sequence`)
- `settings:verifyLastEvent` validates both collectionPath and event folder path
- `setWindowBoundsSync` for safe close-time settings persistence
- Dead code removed: `markEventImportComplete`, standalone `appendImports`, `debug:telemetry`, `debug:flush`
- `_scannedEvents` cache invalidated after each import
- Activity Log OOM fix: `_alEventList` stores only lightweight picker data; per-event `event.json` loaded lazily on picker change
- Drive polling guard: `!win.webContents.isDestroyed()` added to prevent post-crash send errors

### System Impact
- DATA
- INGEST
- STATE
- PERFORMANCE
- IPC

### Notes
- All event.json mutations now flow exclusively through `import:commitTransaction`
- Renderer memory safety rule: strip `_eventJson` from IPC scan results before caching

---

## v0.8.1 — Operator Identity, Media Previews & Attribution

### Changes
- Splash screen: dedicated frameless BrowserWindow (980×480) with three states — "Welcome back" (returning operator), operator picker, and create-profile form (`renderer/splash.html`, `renderer/splash.js`)
- `main/userManager.js`: operator profile store — list, create, get/set active user; profiles persisted in settings
- `splash:complete` IPC: splash fades out, main window fades in via 200 ms CSS transition (no flash)
- In-app operator dropdown and add-user modal replace the old `#loginSplash` overlay
- `settings.js`: `getLastActiveUserId` / `setLastActiveUserId` helpers
- `_activeUser` renderer state: `{ id, name, role, initials }`
- Each `imports[]` entry in `event.json` now includes optional `importedBy: { id, name }` recording which operator triggered the session
- Activity Log entry cards display "Imported by: [name]" (or "Not recorded" for pre-attribution imports)
- Backward-compatible: old entries without `importedBy` remain valid; `isValidImportEntry` unchanged
- `main/videoThumbService.js`: generates cached video frame thumbnails; `thumbnail:getVideoThumb` IPC + `getVideoThumb` preload exposure
- Video file tiles show lazy-loaded frame thumbnail with play badge overlay
- `main/rawPreviewService.js`: RAW image preview rendering; `files:getPreviewUrl` and `preview:getRawPreview` IPC handlers + preload exposure
- `files:deleteFromSource` IPC handler for post-import source file removal; `deleteFromSource` exposed via preload
- `pv-focused` preview focus ring: three visual states (primary / secondary / combined), separate from import selection
- O(1) `_setPreviewFocus` helper swaps CSS class directly via `tileMap` instead of DOM query
- `_selectionAnchor` and `_prevFocusPath` module-level state for correct shift-click range and focus tracking
- Keyboard arrow navigation (Left / Right / Up / Down) for preview focus
- `LastImportArea` now shows the latest import entry's own photo/video count instead of the event-level total
- Removed stale root-level files: `AGENTS.md`, `CODEBASE_OVERVIEW.md`, `README.md`, `STABILIZATION_LOG.md`, `STABILIZATION_NOTES.md`, `update-overview.md`
- `.claude/agents/` specialist agent definitions added
- `docs/data-model.md` and `docs/ingestion-flow.md` updated to document `importedBy` schema and backward-compat rules

### System Impact
- UI
- IPC
- STATE
- DATA
- INGEST
- PERFORMANCE

### Notes
- `importedBy` is optional in the data model; existing imports without it remain valid and display "Not recorded"
- Thumbnail and preview services run in the main process and are cached; renderer never accesses media files directly
- Operator profiles are stored in settings, not in event.json; the event-level `importedBy` field records identity at import time only
- `LastImportArea` bug affected all events with more than one import session; fix is non-breaking

---

## v0.8.6 — Stabilization: IPC Memory, CSP, and Import State

### Changes
- `master:scanEvents` IPC handler strips `imports[]` from `_eventJson` before pushing to the IPC response; renderer now receives only scalar picker metadata — per-event history is loaded lazily on selection via `readEventJson`
- Theme-detection IIFE moved from inline `<script>` in `index.html` to `renderer/theme-init.js`; `index.html` loads it via `<script src="theme-init.js">` to satisfy `script-src 'self'` CSP
- `restoreLastEvent` stale-path branch now fully resets `selectedCollection`, `activeMaster`, `_viewingExisting`, and `_scannedEvents` before returning early — prevents partial state carry-over
- `reloadForImport(eventPath)` added to EventCreator public API: reads fresh component state from disk via `loadEventFromDisk` → `setEventState`; replaces the previous session-store fallback in the import handler

### System Impact
- PERFORMANCE
- IPC
- UI
- STATE
- INGEST

### Notes
- Eliminates V8/Oilpan OOM crash on Activity Log open for archives with large import histories
- Inline script removal is a CSP compliance fix; no UI behavior change
- `reloadForImport` enforces the state-flow contract (event.json → logic → UI) after import; `liveComps` is always sourced from `getEventComps()`, never from a session-store workaround

---

## v0.8.7 — Post-Import UX, Multi-Select Keywords, and Source Selection Fixes

### Changes
- **Multi-select keyword picker**: Replaced the hardcoded combination dropdown (Tag A, Tag B, Tag A + Tag B) with a MetaPicker portal IIFE that lets users independently toggle any subset of event keywords. Each group stores `metadataTags: string[]` where `[]` = explicit no keyword, `null` = unassigned. Deduplication applied at source; declaration order preserved across toggles.
- **Post-import action chooser**: Done button after a successful (zero-error) import now shows an inline chooser instead of immediately closing. Ejectable sources (memory card, external drive) show: Eject Source, Continue Importing, Close. Local folders show: Exit to Home, Continue Importing, Close. Continue Importing dissolves group state and selection but preserves source and event context. Exit to Home returns to landing without clearing the active event.
- **Source card double-selection fix**: Clicking between source types (memory card ↔ external drive) previously left the old source type's checkmark visible until the next polling cycle. Each click handler now immediately clears the other list's checkmarks. Added `_pendingSourcePath` state so polling renders stay consistent during the async scan window in `selectSource()`.
- **Post-import Eject Source preserves event**: Eject Source from the post-import chooser now returns Home with the active event intact. Refactored `_performEject(mountpoint)` as a shared eject-mechanism helper (I/O shutdown → hardware eject → confirmation modal → await OK); callers supply the post-eject reset. Normal eject-button path unchanged. `resetAppState()` gains a `{ preserveEvent }` option; unexpected card disconnect also uses it so the active event survives an unplanned disconnect.

### System Impact
- UI
- STATE
- INGEST

### Notes
- `metadataTags: null` still indicates unassigned (warning rendered); `[]` is explicit no-keyword (no warning). Import and metadata pipeline behavior unchanged.
- `_continueImporting()` clears selection state before `_closeProgressModal()` to avoid a double `updateSelectionBar()` call.
- `_performEject` extraction is non-breaking: the ejectBtn handler calls it identically to the old inline code. Only the post-import path and disconnect path use `preserveEvent: true`.
- MetaPicker uses the same two-function close pattern (close / closeQuiet) as Dropdown to prevent re-render recursion.

---

## v0.8.8 — Source Cleanup Root Stability + Event Creator Redesign

### Additional Changes (same version)

**Event Creator layout and UI fixes:**
- Widened Event Creator modal to 1320px; component row switched from 3-column to 5-column grid (Event Type | Additional Keywords | Location | City | Country)
- Country control replaced bespoke chip+input design with `_mountCountryDD()` using identical `.tac-*` TreeAutocomplete structure as City; Country excluded from folder name; saved/reloaded correctly
- `buildFolderName` (`folderNameHelper.js`) now interleaves `additionalKeywords` with `useInFolderName: true` around event tags per `folderPlacement`; in-editor preview and final folder name share one source of truth
- Dropdown overlay fix: `backdrop-filter` on `.ec-comp-row` creates per-row stacking contexts; active row elevated to `z-index: 100` via `:has(.tac[data-open])` selector
- Removed auto-focus on new component after `+ Add Component` (TreeAutocomplete opens on focus unconditionally; programmatic focus was triggering dropdown on every new component)
- Added `[hidden] { display: none !important; }` override to prevent Chromium UA sheet from showing hidden advanced-panel warnings when collapsed

### System Impact (additional changes)
- UI

---

## v0.8.8 — Source Cleanup Root Stability

### Changes
- **Stable import-time cleanup root**: `showProgressSummary` now receives `importCleanupRoot` — `activeSource.path` captured synchronously before the first `await` in both Event Import and Quick Import paths. This eliminates a race window where drive-polling could null `activeSource` during the async IPC call, causing `_csqSourceRoot` to be set from a stale or null `activeSource` at summary time.
- **Guard update**: Event Import and Quick Import early-return guards now check `!activeSource && !_importCleanupRoot`, allowing the summary (and cleanup button) to appear even when polling has transiently cleared `activeSource` during the import.
- **`showProgressSummary` signature**: `importCleanupRoot = null` added as second parameter; `_csqSourceRoot = importCleanupRoot || activeSource?.path`. Falls back to live `activeSource.path` when no pre-captured root is available (no behavior change for normal flows).

### System Impact
- INGEST
- STATE
- UI

### Notes
- Root cause: `renderExtDrives` disconnect detection sets `activeSource = null` when `activeSource.path` (a dialog-chosen sub-folder) is not found in the polled drive mountpoint list. If this fires during the `commitImportTransaction` await, the post-import summary is skipped or `_csqSourceRoot` receives an undefined value — both manifesting as "Path outside source root" failures in cleanup.
- Safety preserved: `realpath` containment check in `files:deleteFromSource` is unchanged. All source/destination/size/symlink validations intact.
- No change to import copy logic, metadata pipeline, eject logic, or browsing behavior.

---

## Usage

When debugging:

1. Identify when the issue started
2. Match version with system changes
3. Focus on affected system layer