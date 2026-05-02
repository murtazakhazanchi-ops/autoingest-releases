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

## Usage

When debugging:

1. Identify when the issue started
2. Match version with system changes
3. Focus on affected system layer