<!-- TO UPDATE THIS DOCUMENT: run `claude update-overview.md` in the project root -->

# AutoIngest — Complete Technical Codebase Overview

**Version:** 0.7.0-dev  
**Last updated:** 2026-04-20  
**HEAD:** `cecda35` — Commits A–F + patches done. Commit G (import routing) is next.

---

## 0a. v0.7.0-dev Commits B–F (2026-04-20)

### New renderer files

**`renderer/eventCreator.js`** — Module singleton. Orchestrates the 3-step event creation flow.
- Step 1 (Master Collection): Hijri date input (3 segments, auto-advance) + label → `{Y}-{MM}-{DD} _{Label}`. Existing session collections shown as selectable cards. Duplicate → auto-select + info banner.
- Step 2 (Event Details): Global City + per-component override. Components: multi-chip EventType (cleared after each pick) + optional Location + required City. City-grouping algorithm (Cases A/B/C) builds event folder name. Live preview card.
- Step 3 (Preview): Mode badge (Single / Multi-component). Folder tree: Collection → Event → [SubEvent →] (photographer) → VIDEO/. Event selector dropdown when multiple events exist. "Change" removes event + restores components to Step 2. "Add Another Event" resets Step 2. "Done" → showLanding().
- Public API: `start()`, `resume()`, `getActiveEventData()` → `{coll, event, idx}|null`, `getSubEventNames()` → `{id,name}[]`, `getSessionCollections()`, `getSelectedCollection()`, `setActiveEventIndex(idx)`, `syncRail()`, `resetSelection()`, `buildFolderPreviewHTML(coll, event)`.
- `getSubEventNames()` returns `[]` for single-component events or no active event.

**`renderer/groupManager.js`** — Module singleton. Manages file-to-group assignments.
- Group shape: `{ id: number, label: string, colorIdx: number, files: Set<string>, subEventId: string|null }`
- `subEventId` stores the sub-event folder name (from `EventCreator.getSubEventNames()[].id`), not an array index.
- `assignFiles(paths, groupId)` — reassigns from old group; auto-removes old group if now empty.
- `unassignFiles(paths)` — auto-removes any group that reaches 0 files.
- Groups are NEVER created empty: only via context menu or Cmd+G with files selected.
- `reset()` called on: drive change, eject, `showEventCreator`, `showEventCreatorResume`, event select dropdown.
- Validation query helpers (used by Commit G): `getUnassignedFiles(allPaths)`, `hasMissingSubEvents()`, `getDuplicateSubEvents()`.

### renderer/renderer.js additions (Commits B–F)

- `showEventCreator()` — resets groups, calls `EventCreator.start()`, shows `#eventCreatorPanel`.
- `showEventCreatorResume()` — resets groups, calls `EventCreator.resume()`.
- `showLanding()` — hides event creator + workspace, calls `_renderLandingEventCard()`.
- `_renderLandingEventCard()` — idle: default Create Event card. Active event: confirmed card with collection, event name/select, Change + New Event buttons.
- `renderGroupPanel()` — hides panel when no groups; renders coloured tabs, sub-event `<select>` (multi-component events only), file list, Remove button. No `+` button — groups created only via context menu / Cmd+G.
- `syncGroupBadge(path)` / `syncAllGroupBadges()` — O(1) badge updates via tileMap.
- Right-click handler on `#fileGrid` → `_showCtxMenu()` — context menu with group assign/create/unassign.
- `document keydown` Cmd+G / Ctrl+G → `_showGroupPickerModal()`.
- `GroupManager.reset()` added to `selectDrive()` and `resetAppState()`.

### renderer/index.html additions (Commits B–F)

- `#eventCreatorPanel` — full-height panel with `#ecHeader` (Back btn + title) and `#ecBody` (content rendered by EventCreator module).
- `#groupPanel` — 268px right column inside `#columns`; CSS `.visible` toggles `display: flex`.
- `#groupCtxMenu` — fixed-position context menu div (populated on right-click).
- `#groupPickerModal` — full-overlay group picker (Cmd+G).
- Landing card confirmed state CSS (`.landing-card-confirmed`, `.lc-ev-*`).
- Group panel CSS (`.gp-*`), badge CSS (`.grp-badge`, `.grp-badge-list`), context menu CSS (`.ctx-*`), picker CSS (`.gpm-*`).

---

## 0. v0.7.0-dev CHANGES (2026-04-20)

### New files
- `data/event-types.json` — 14 categories × 222 selectable events, 3-level tree (`{label, children[]}`). Category headers are not selectable.
- `data/cities.json` — 628 city strings, flat array.
- `data/locations.json` — 451 location nodes, flat array where some nodes have `children[]` (Kaaba, Jamrat, Raudat Tahera, etc.).
- `data/photographers.json` — 312 photographer names, flat array, deduplicated.
- `scripts/parse-lists.js` — one-time Node script that reads tab-indented source files from ~/Downloads and writes the four data files above.
- `main/listManager.js` — List loading service. `init(userDataPath)`, `getList(name)` → merged+deduped array, `addToList(name, value)` → normalize+properCase, save to userData override. Event-types is read-only.
- `main/aliasEngine.js` — Alias-aware search engine. `init(userDataPath)`, `normalize(str)` (lowercase, punctuation→space, collapse whitespace), `slugify(label)` (stable ID), `flattenToLeaves(listName, data)` (tree→flat selectable nodes; event-type category headers excluded), `match(input, listName, data)` → scored results, `learnAlias(listName, canonicalId, canonicalLabel, typed)` → persist to userData aliases file.
- `renderer/treeAutocomplete.js` — `TreeAutocomplete` class. Constructor: `{container, type, placeholder, onSelect}`. Public API: `getValue()`, `setValue(id, label)`, `clear()`, `setDisabled(v)`, `destroy()`. Internally: tree-browse mode (collapsible) when input empty; search mode (flat ranked results via IPC) when typing; Add New flow for writable lists; alias badge + breadcrumb on results; full keyboard nav.

### IPC additions (main/main.js)
- `lists:get (name)` → `listManager.getList(name)`
- `lists:add (name, value)` → `listManager.addToList(name, value)`
- `lists:match (name, input)` → `aliasEngine.match(input, name, listManager.getList(name))`
- `lists:learnAlias (name, canonicalId, label, typed)` → `aliasEngine.learnAlias(...)`

### window.api additions (main/preload.js)
- `getLists(name)`, `addToList(name, value)`, `matchList(name, input)`, `learnAlias(name, canonicalId, label, typedInput)`

### Landing screen redesign (renderer/index.html + renderer/renderer.js)
- `#step1Panel` is now a centered card-pair layout: two `280px` cards side-by-side on the app background. Hover: 5px translateY + glow ring matching card accent.
- Left card `#landingCard`: blue-tinted icon, existing card-import flow unchanged.
- Right card `#landingEvent`: mauve-tinted icon, "Create Event →" CTA.
- `#eventCreatorPanel`: hidden shell panel. Header with ← Back + title. Empty `#ecBody` to be populated by Commits C + D.
- `railMode` variable (`'card'|'event'`) + `setRailMode()` swaps step rail labels dynamically.
- `showEventCreator()` / `showLanding()` handle navigation between landing and event creator.
- `RAIL_LABELS` object defines label sets for both paths.

### Smoke-test infrastructure (to be removed after landing UI is verified)
- `#tacTestBtn` floating button (bottom-left, mauve) opens `#tacTestOverlay` modal with all four dropdown types and a selection log. Wired in `renderer.js` `initTacTestPanel()` IIFE.

---

## 0b. v0.6.0 CHANGES (2026-04-18)

This release replaces the DCIM-only file discovery with a full recursive scanner, introduces a Folder View with a nested sidebar tree, and consolidates the onboarding step rail.

### Scanner rewrite (main/fileBrowser.js)
- New scanMediaRecursive(startDir, onBatch, results, depth, visited) descends the entire card sequentially, batching 50 files at a time.
- Hardening: MAX_SCAN_DEPTH = 12, realpath-based visited set for symlink-loop protection, expanded SKIP_DIRS (fseventsd, .fseventsd, .TemporaryItems, RECYCLE.BIN, System Volume Information, .Spotlight-V100, .Trashes, lost+found), non-ENOENT readdir errors logged to [scan].
- New buildFolderTree(files) pure transform: O(n) Map-based insertion, longest-common-ancestor as root, alphabetical children sort. No filesystem access.
- Sony PRIVATE special-case scan removed -- recursion covers it.

### IPC contract changes (main/main.js, main/preload.js)
- files:get final response now includes a folders tree object with fields name, path, children, files (was previously an empty array).
- Per-batch files:batch events send folders=null (tree is computed once from the complete file list on the final result).

### Folder View (renderer)
- New viewModeType state: 'media' (default, flat whole-card list) or 'folder' (sidebar-driven navigation).
- Toolbar toggle: Media / Folder buttons.
- Sidebar hidden in Media view, shown in Folder view as the primary navigation surface. Renders the full nested tree via renderTreeNodeRecursive with expand/collapse chevrons and depth-indented layout. Clicks route through pre-built tree helpers (enterFolderView, exitToFolderRoot, findNodeByPath, collectFilesRecursive) -- no IPC rescan.
- Leaf-only media rendering: intermediate folders (those with subfolders) show an instruction panel; only leaf folders render file tiles. Prevents media from leaking across folder boundaries and mirrors Finder-like navigation.
- Sidebar active-row highlight follows the current node on each navigation.
- Back bar above file grid shows the currently-viewed folder path.
- Selection persists globally across folder navigation and view toggles via the existing selectedFiles Set.

### UX polish
- Eject confirmation modal (#ejectOverlay + #ejectModal) replaces the 4-second footer toast. Success / failure state, keyboard accessible (Enter/Escape), app waits for user to acknowledge before returning to the drive list.
- Eject button restyled red (Catppuccin var(--red)) to signal its semi-destructive nature.
- Sidebar chevrons enlarged (0.65rem to 0.85rem), blue-tinted, bold, 18px touch target, hover scale-up -- clearly interactive.
- Step rail collapsed from 4 steps to 3: Select Memory Card -> Browse and Select Files -> Import.

### New state variables (renderer/renderer.js)
- currentFolderTree -- root tree object, set only on root browse (folderPath === null); preserved across subfolder navigation.
- currentFolderContext = {path, files, isRoot, isLeaf} -- what folder view is currently showing.
- viewModeType -- 'media' or 'folder'.

### New helpers (renderer/renderer.js)
- renderCurrentView() -- dispatches to renderFileArea (media view or folder-leaf) or renderFolderOnly (folder-view instruction panel).
- renderFolderOnly() -- instruction panel only; folder-card rendering removed in 11c after smoke-test feedback.
- folderCounts(node) -- pure recursive file-count + type breakdown (retained as unused helper for future sidebar badges).
- renderTreeNodeRecursive(node, depth, activePath) -- sidebar row rendering.
- cardDisplayName(path) -- drive name from mountpoint (cross-platform).
- wireFolderListClicks(list, opts) -- delegated sidebar click wiring.

### Commit history (since v0.5.1)
14-commit plan executed as Commits 1-14 with UX-correction patches 11b, 11c, 11d, 12b, 12c, 12d added from live smoke testing. See git log v0.5.1..v0.6.0 --oneline for the full list.

---


## 1. PROJECT OVERVIEW

AutoIngest is a cross-platform Electron desktop application for macOS and Windows. It imports photos and videos from camera memory cards into a structured local archive. The app is designed for multi-photographer event coverage workflows (e.g. Safar).

**What it does:**
- Detects DCIM-containing memory cards via drive polling
- Browses the card's folder structure and displays supported media files grouped by type (RAW / Image / Video)
- Lets the user select files with rich multi-select (shift-click, Cmd+A, per-group buttons)
- Copies selected files to a destination folder, enforcing no-overwrite semantics (skip exact duplicates, rename size-conflicting files)
- Tracks imported files in a cross-session index so already-imported files are badged on future card insertions
- Generates and caches 160px thumbnails for JPEG/PNG/RAW files
- Reports performance issues, crashes, and user feedback to a Google Sheets tracker
- Delivers automatic updates over GitHub Releases via electron-updater
- Supports safe drive ejection, Sony PRIVATE folder video detection, and deep SHA-256 checksum verification

**Targets:** macOS (x64, arm64) and Windows (x64)  
**Current version:** 0.5.0  
**No build step** — pure vanilla JS + HTML + CSS, launched with `npm start` / `electron .`

---

## 2. ARCHITECTURE

### Process model

Electron splits code into two sandboxed worlds:

| Process | Files | Capabilities |
|---|---|---|
| **Main process** | `main/main.js`, `main/driveDetector.js`, `main/fileBrowser.js`, `main/fileManager.js`, `services/*.js` | Full Node.js, filesystem, child_process, native dialogs, electron-updater |
| **Renderer process** | `renderer/index.html`, `renderer/renderer.js` | DOM only — zero Node access |
| **Preload script** | `main/preload.js` | Bridge only — runs in renderer with Node access, exposes `window.api` via `contextBridge` |

### Security model

```
contextIsolation: true
nodeIntegration:  false
sandbox:          true
```

The renderer has no `require()`, no `fs`, no `path`. Every interaction with the OS goes through the typed `window.api` object defined by `contextBridge.exposeInMainWorld` in `preload.js`. This is the CSP policy enforced in `index.html`:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' file:;
```

### How the two sides communicate

- **Renderer → Main (request/response):** `window.api.someMethod()` → `ipcRenderer.invoke()` → `ipcMain.handle()`
- **Main → Renderer (push):** `win.webContents.send(channel, payload)` → `ipcRenderer.on()` → `window.api.onSomething(cb)`
- **Renderer → Main (fire-and-forget):** `ipcRenderer.send()` → `ipcMain.on()`

### Services layer

All services live in `services/` and run in the main process only:

| Service | Role |
|---|---|
| `logger.js` | Appends timestamped lines to `<userData>/app.log` |
| `telemetry.js` | Queues reports and flushes them to Google Sheets every 30s |
| `crashReporter.js` | Passive hooks that feed all crashes/errors into telemetry |
| `performanceMonitor.js` | Detects event loop lag, slow thumbnails, slow imports, high memory |
| `autoUpdater.js` | electron-updater wrapper: checks GitHub, downloads, installs |
| `thumbnailer.js` | Generates 160px JPEG thumbnails with 5-tier concurrency control |
| `fileUtils.js` | Safe fs helpers (no explicit FileHandle) used by thumbnailer |
| `thumbnailCache.js` | Main-process LRU cache (500 entries) for thumbnail URLs; deduplicates in-flight requests |

---

## 3. FILE-BY-FILE BREAKDOWN

---

### `package.json`

Central project manifest and electron-builder configuration.

- **What it does:** Declares all dependencies, npm scripts, and the full electron-builder config for Mac/Windows distribution.
- **Key settings:**
  - `main: "main/main.js"` — Electron entry point
  - `dependencies`: `drivelist`, `electron-updater`, `exifr`, `googleapis`, `sharp`
  - `devDependencies`: `electron`, `electron-builder`
  - `build.publish` → GitHub Releases provider (repo: `murtazakhazanchi-ops/autoingest-releases`)
  - `build.extraResources` → bundles `config/service-account-key.json` into the packaged app
  - Mac targets: DMG + ZIP for x64 and arm64. Windows target: NSIS x64.

---

### `config/app.config.js`

**One sentence:** Central source of truth for all supported media file extensions and basic app settings.

**Exports:**
- `appName` — `'AutoIngest'`
- `version` — `'1.0.0'`
- `defaultWindowWidth` / `defaultWindowHeight` — `1200` / `800`
- `PHOTO_EXTENSIONS` — 18 lowercase extensions (JPEG, PNG, TIFF, all major camera RAW formats)
- `RAW_EXTENSIONS` — 13 lowercase RAW-only extensions (subset of PHOTO_EXTENSIONS)
- `VIDEO_EXTENSIONS` — `.mp4`, `.mov`

**Called by:** `main/fileBrowser.js`, `services/thumbnailer.js`

**Rule:** Never import directly in renderer; never hardcode extension lists anywhere else.

---

### `main/main.js`

**One sentence:** The Electron main-process entry point — creates the window, wires all IPC handlers, manages the global import index, and orchestrates service startup.

**Functions:**

| Function | What it does |
|---|---|
| `loadImportIndex()` | Reads `importIndex.json` from userData into `importIndex` object |
| `saveImportIndex()` | Writes `importIndex` to `importIndex.json` synchronously |
| `trimImportIndex()` | Evicts oldest entries when `importIndex` exceeds 5000 keys; entries without `addedAt` evict first |
| `updateImportIndex(filePaths, destPath)` | After a successful copy, stats each source file and upserts `{ size, addedAt }` into `importIndex` |
| `createWindow()` | Creates the BrowserWindow with security settings and loads `renderer/index.html` |
| `startDrivePolling()` | Calls `detectMemoryCards()` every 5s; pushes `drives:updated` to all windows |

**IPC handlers registered:**

| Handler | What it does |
|---|---|
| `drives:get` | Returns `detectMemoryCards()` on demand |
| `drive:eject` | Runs `diskutil eject` (mac) or PowerShell `Remove-Volume` (win) on the given mountpoint |
| `files:get` | Calls `readDirectory()` with streaming batch callbacks; merges Sony PRIVATE folder videos; sorts by date |
| `dest:getDefault` | Returns `~/Desktop/AutoIngestTest` |
| `dest:choose` | Opens native folder-picker dialog |
| `dest:scanFiles` | Reads all files in destPath, returns `{ filename: sizeBytes }` map |
| `files:import` | Creates dest dir, calls `copyFiles()`, sends `import:progress` events, updates import index, triggers telemetry on errors |
| `thumb:get` | Calls `getThumbnail()`, wraps with `perf.thumbStart/End()` |
| `ping` | Returns `'pong 🏓'` (legacy) |
| `copy:pause` / `copy:resume` | Calls `setPaused(true/false)` in fileManager |
| `importIndex:get` | Returns the in-memory `importIndex` object |
| `checksum:run` | SHA-256 compares every `{ src, dest }` pair from the last import; sends `checksum:progress` and `checksum:complete` |
| `getLastUpdateInfo` | Returns `storedUpdateInfo` (set from `lastUpdate.json` at startup, file deleted after read) |
| `feedback:send` | Enqueues a feedback report and immediately flushes telemetry |
| `debug:telemetry` | (temp debug) Validates service-account-key.json and tests a Sheets append |
| `debug:flush` | (temp debug) Directly appends a debug row to Google Sheets |
| `renderer:error` | Received from preload; forwarded to crashReporter |
| `renderer:unhandledRejection` | Received from preload; forwarded to crashReporter |
| `update:install` | Received from renderer; calls `autoUpdater.quitAndInstall()` |

**Called by:** Nothing calls main.js — it is the entry point.  
**Calls:** `driveDetector`, `fileBrowser`, `fileManager`, `thumbnailer`, `logger`, `telemetry`, `crashReporter`, `performanceMonitor`, `autoUpdater`

---

### `main/preload.js`

**One sentence:** The contextBridge layer that safely exposes a typed `window.api` to the renderer while blocking direct Node/Electron access.

**Exposes `window.electronAPI`** (low-level backwards-compat):
- `sendMessage(channel, data)` — `ipcRenderer.send`
- `invoke(channel, data)` — `ipcRenderer.invoke`
- `onMessage(channel, cb)` — `ipcRenderer.on`

**Exposes `window.api`:**

| Method | IPC action | Purpose |
|---|---|---|
| `getVersion()` | reads package.json | Current app version |
| `getDrives()` | invoke `drives:get` | On-demand drive list |
| `ejectDrive(mountpoint)` | invoke `drive:eject` | Safe drive ejection |
| `onDrivesUpdated(cb)` | listen `drives:updated` | Live drive updates |
| `getFiles(drivePath, folderPath, requestId)` | invoke `files:get` | Browse a folder |
| `onFilesBatch(cb)` | listen `files:batch` | Progressive file batches |
| `getDefaultDest()` | invoke `dest:getDefault` | Default destination path |
| `chooseDest()` | invoke `dest:choose` | Native folder picker |
| `scanDest(destPath)` | invoke `dest:scanFiles` | Scan destination for duplicates |
| `importFiles(filePaths, destination)` | invoke `files:import` | Copy files |
| `onImportProgress(cb)` | listen `import:progress` | Per-file progress |
| `pauseCopy()` | send `copy:pause` | Pause copy pipeline |
| `resumeCopy()` | send `copy:resume` | Resume copy pipeline |
| `getThumb(srcPath)` | invoke `thumb:get` | Get thumbnail URL |
| `sendFeedback(opts)` | invoke `feedback:send` | Send feedback report |
| `onUpdateAvailable(cb)` | listen `update:available` | Update download started |
| `onUpdateProgress(cb)` | listen `update:progress` | Download percent |
| `onUpdateReady(cb)` | listen `update:ready` | Update ready to install |
| `installUpdate()` | send `update:install` | Trigger install |
| `getImportIndex()` | invoke `importIndex:get` | Cross-session import index |
| `runChecksumVerification()` | invoke `checksum:run` | SHA-256 deep verify |
| `onChecksumProgress(cb)` | listen `checksum:progress` | Checksum file count |
| `onChecksumComplete(cb)` | listen `checksum:complete` | Checksum final result |
| `getLastUpdateInfo()` | invoke `getLastUpdateInfo` | What's New data |

**Also hooks:**
- `window.error` → sends `renderer:error` to main (throttled, 1 per 5s)
- `window.unhandledrejection` → sends `renderer:unhandledRejection` to main (throttled)

---

### `main/driveDetector.js`

**One sentence:** Enumerates all mounted drives via `drivelist` and returns only those containing a DCIM folder.

**Exports:**
- `detectMemoryCards()` → `Promise<Array<{ label, mountpoint }>>`
  - Lists all drives with `drivelist.list()`
  - For each mountpoint, calls `hasDCIM(path)` (sync `fs.existsSync` + `statSync`)
  - Returns an array of `{ label, mountpoint }` objects

**Called by:** `main.js` (polling loop and `drives:get` handler)

---

### `main/fileBrowser.js`

**One sentence:** Reads a DCIM folder on a memory card, returning typed and stat'd media file objects, filtered of macOS junk.

**Exports:**

| Function | What it does |
|---|---|
| `readDirectory(dirPath, onBatch?)` | Reads a directory, stats all media files in batches of 50, calls `onBatch` progressively, returns `{ folders, files }` sorted newest-first |
| `getDCIMPath(mountpoint)` | Returns path to the DCIM folder at the mountpoint, or null |
| `scanPrivateFolder(privatePath)` | Scans `PRIVATE/M4ROOT/CLIP` and `PRIVATE/AVCHD/BDMV/STREAM` for Sony video files (>500KB only) |
| `safeExists(p)` | Async `fsp.access` wrapper; returns boolean |

**Internal helpers:**
- `isJunkFile(filename)` — true for `._*` and `.DS_Store`
- `mediaType(filename)` — returns `'raw' | 'photo' | 'video' | null`
- `getExt(filename)` — lowercase extension with dot

**Called by:** `main.js` (`files:get` handler)  
**Depends on:** `config/app.config.js`

---

### `main/fileManager.js`

**One sentence:** Copies an array of source files to a destination folder with concurrent workers, resume support, speed-based adaptive concurrency, and mandatory size verification.

**Exports:**

| Function | What it does |
|---|---|
| `copyFiles(filePaths, destination, onProgress)` | Main copy pipeline — adaptive concurrency queue, pause/resume, ETA, returns `{ copied, skipped, errors, skippedReasons, failedFiles, copiedFiles, duration }` |
| `resolveDestPath(destDir, filename, sourceSize)` | Determines if a file should be copied, skipped (same size), or renamed (_1, _2...) |
| `setPaused(val)` | Sets `isPaused` flag; `waitIfPaused()` polls every 100ms |
| `getFileHash(filePath)` | Returns SHA-256 hex digest of a file via stream |

**Internal helpers:**
- `buildDestIndex(destFolder)` — pre-scans dest for resume fast-path
- `estimateAvgSize(filePaths)` — samples up to 10 files for concurrency tuning
- `getInitialConcurrency(avgFileSize, destType)` — returns 2-5 based on file size and dest type
- `adjustConcurrency()` — one-time upgrade after 5 files sampled; sets `MAX_CONCURRENT_COPIES` to 2/3/4 based on MB/s
- `getSpeedAndEta()` — exponential moving average speed + estimated seconds remaining
- `verifyFile(srcPath, destPath, srcSize)` — mandatory size check; optional SHA-256 when `ENABLE_CHECKSUM = true`
- `processFile(srcPath, origIndex)` — handles one file: pause → stat → resume check → copy → verify → retry (1 retry)

**Copy rules (enforced):**
1. File not at dest → copy
2. File exists, same size → skip
3. File exists, different size → rename `_N` then copy

**Called by:** `main.js` (`files:import` handler)

---

### `services/logger.js`

**One sentence:** Appends timestamped log lines asynchronously to `<userData>/app.log`.

**Exports:**
- `log(message)` — appends `[ISO timestamp] message\n` via `fs.appendFile` (non-blocking)

**Called by:** Every main-process module and service.

---

### `services/telemetry.js`

**One sentence:** A single pipeline that queues all reports (crashes, errors, performance, feedback) and flushes them as rows to a Google Sheets "Bug Tracker" tab every 30 seconds.

**Exports:**
- `init()` — loads persisted queue from `telemetry-queue.json`, starts 30s flush timer, registers `before-quit` handler
- `enqueue(report)` — deduplicates within 60s window, enforces 500-entry FIFO cap, persists queue to disk
- `flush()` — authenticates with Google service account JWT, appends all queued rows via Sheets API v4, retries reset after 5 min on 5 consecutive failures
- `isEnabled()` — returns `TELEMETRY_ENABLED` flag (currently `true`)

**Sheet columns (A–S):** ID, Date, Reporter, Version, Device, Card Type, File Volume, Action, Issue Type, Description, Expected, Actual, Import Result, Screenshot, Log Shared, Severity, Status, Assigned To, Notes

**Config:**
- `SHEET_ID` — hardcoded Google Sheet ID
- `KEY_PATH` — `config/service-account-key.json` (bundled via `extraResources` in production)
- `FLUSH_INTERVAL` — 30,000 ms
- `DEDUP_WINDOW_MS` — 60,000 ms
- `MAX_QUEUE_SIZE` — 500 entries

---

### `services/crashReporter.js`

**One sentence:** Passive hooks that capture all crashes and unhandled errors and route them to `telemetry.enqueue()`.

**Exports:**
- `init(mainWindow)` — wires four error hooks (no-op if telemetry disabled)

**Hooks registered:**
- `process.uncaughtException` → type: `'crash'`, severity: `'Critical'`
- `process.unhandledRejection` → type: `'error'`, severity: `'High'`
- `app.render-process-gone` → type: `'crash'`, severity: `'Critical'`
- `app.child-process-gone` (GPU only) → type: `'crash'`, severity: `'High'`
- `ipcMain renderer:error` → type: `'error'` (JS errors from renderer via preload)
- `ipcMain renderer:unhandledRejection` → type: `'error'`

**Internal helpers:**
- `classifyError(msg)` — maps error message keywords to Bug Tracker Issue Type strings
- `trimStack(stack)` — truncates stack trace to 8 lines, joins with ` → `

**Called by:** `main.js` (`crashReporter.init(mainWindow)` in `app.whenReady`)  
**Depends on:** `telemetry.js`, `logger.js`

---

### `services/performanceMonitor.js`

**One sentence:** Automatically samples event loop lag, thumbnail timing, import speed, and heap usage, reporting violations to telemetry.

**Exports:**
- `init()` — starts lag monitor (10s delayed) and memory monitor; no-op if telemetry disabled
- `stop()` — clears all timers and watchdogs
- `thumbStart(key)` — records start time and sets 15s watchdog timer for a thumbnail job
- `thumbEnd(key, { success, error })` — clears watchdog, reports slow (>5s) or failed thumbnails
- `importSpeedSample(bytesCopied, elapsedMs, totalBytes)` — logs if speed < 2 MB/s on imports > 50 MB

**Thresholds:**
- Event loop lag: warn >200ms, critical >1000ms (requires 2 occurrences per 30s window)
- Thumbnail stall: warn >5s, critical/watchdog >15s
- Import speed: warn <2 MB/s (only for transfers >50 MB)
- Memory: warn when heap >80% utilisation (checked every 60s, ignored if <200MB)

**Called by:** `main.js` (`perf.init()`, `perf.stop()`, `perf.thumbStart/End()`, `perf.importSpeedSample()`)

---

### `services/autoUpdater.js`

**One sentence:** Wraps `electron-updater` to check GitHub Releases for updates, download them silently, and let the renderer trigger installation.

**Exports:**
- `init()` — configures `autoUpdater`, registers event listeners, schedules first check (3s delay) and periodic checks (every 4h)

**Events handled:**
- `update-available` → broadcasts `update:available` to all windows
- `download-progress` → broadcasts `update:progress` with percent
- `update-downloaded` → broadcasts `update:ready`; writes `lastUpdate.json` to userData with version + release notes
- `error` → logs silently, never shown to user

**IPC handled:**
- `update:install` (one-way from renderer) → calls `app.relaunch()` then `autoUpdater.quitAndInstall(false, true)` after 500ms

**Called by:** `main.js` (`autoUpdater.init()` in `app.whenReady`)

---

### `services/thumbnailer.js`

**One sentence:** Generates and disk-caches 160px JPEG thumbnails, with a 5-layer concurrency control system to prevent file descriptor exhaustion.

**Exports:**
- `getThumbnail(srcPath)` → `Promise<string|null>` — returns a `file://` URL or data URL
- `clearCache()` — deletes all `.jpg` files from the thumb cache directory
- `shutdownWorkers()` — no-op (kept for lifecycle compatibility)

**Cache:**
- Directory: `<userData>/thumb-cache/`
- Key: SHA-1 of `(normalizedPath + ":" + size + ":" + mtime)`
- TTL: 7 days (evicted on access)
- Small files (<50KB) bypass generation and return a direct `file://` URL

**Generation pipeline for non-RAW files:**
1. EXIF embedded thumbnail (via `exifr.thumbnail`, 500ms timeout)
2. `sharp` resize to 160px wide, JPEG quality 50
3. `nativeImage.createFromPath` final fallback
4. SVG placeholder

**Generation pipeline for RAW files:**
- macOS: `qlmanage -t -s 300` (OS camera-raw plugin, 8s timeout)
- Windows: `nativeImage.createFromPath` (requires Microsoft RAW Image Extension)
- Linux/fallback: RAW SVG placeholder

**Concurrency gates (outer → inner):**
1. `runWithLimit` — outer gate, max 50 non-cached ops simultaneously
2. `withConcurrencyLimit` — inner gate, max 4 full generation jobs
3. `withExifLimit` — serialises exifr calls (max 1 at a time)
4. `withSharpLimit` — serialises sharp decodes (max 1 at a time)
5. `withFileReadLimit` — caps raw file-descriptor opens across all tools (max 2 at a time)

**Main-process LRU cache:** uses `thumbnailCache.js` — 500 entry LRU  
**In-flight deduplication:** `inFlightCache` (Map) prevents duplicate concurrent generation for the same file

**Called by:** `main.js` (`thumb:get` IPC handler)  
**Depends on:** `fileUtils.js`, `thumbnailCache.js`, `config/app.config.js`, `exifr`, `sharp`

---

### `services/thumbnailCache.js`

**One sentence:** A 500-entry LRU cache shared between `thumbnailer.js` and an in-flight deduplication Map.

**Exports:**
- `thumbnailCache` — `LRUCache` instance (500 entries); `get(key)` promotes to MRU, `set(key, value)` evicts oldest when full
- `inFlightCache` — `Map<key, Promise<string>>` for deduplicating concurrent generation requests
- `generateCacheKey(file)` → `string` — normalised lowercase path + size + lastModified

---

### `services/fileUtils.js`

**One sentence:** Safe `fs.promises`-based helpers that avoid explicit FileHandle to prevent DEP0137 warnings.

**Exports:**
- `safeRead(filePath, encoding?)` → `Promise<Buffer|string>`
- `safeWrite(filePath, data)` → atomic write via `.tmp` swap then `rename`
- `safeStat(filePath)` → `Promise<fs.Stats>`
- `safeExists(filePath)` → `Promise<boolean>` (never throws)

**Called by:** `thumbnailer.js`

---

### `renderer/index.html`

**One sentence:** The single HTML page containing all CSS (Catppuccin Mocha dark theme variables + component styles) and the full DOM structure for all UI panels.

**Key sections:**
- CSS custom properties (`:root`) — 15 colour variables
- `#topBar` — logo + Help button
- `#updateBanner` — hidden until auto-update event fires
- `#stepRail` — 4-step progress indicator
- `#step1Panel` — landing screen with drive card list
- `#workspace` — two-panel layout (sidebar + file panel + import footer), shown when a drive is selected
- `#fileGrid` — scrollable file area; JS writes all tile HTML here
- `#progressOverlay` — import progress modal with pause/resume
- `#dupWarningOverlay` — pre-import duplicate warning modal
- `#onboardingOverlay` — 4-screen first-launch onboarding
- `#helpOverlay` — Quick Reference modal
- `#feedbackOverlay` — Bug report modal
- `<script src="renderer.js">` — loaded at the bottom of `<body>`

---

### `renderer/renderer.js`

**One sentence:** All UI logic — drive selection, folder browsing, file rendering, selection management, import flow, thumbnail loading, and all modal interactions — with no direct Node or Electron access.

See **Section 8 (State Map)** for all state variables.  
See **Section 5 (Data Flow — Import Pipeline)** for the full import sequence.

**Key functions by category:**

**Utility / formatting:**
- `showMessage(msg, durationMs)` — non-blocking status bar message
- `showInlineHint(containerId, message, storageKey)` — one-time localStorage-gated hint banner
- `escapeHtml(s)`, `formatSize(b)`, `formatDate(iso)`, `formatETA(s)`, `formatDuration(ms)`, `formatSpeed(bps)`

**View organisation:**
- `pairFiles(files)` — reorders flat file list to place JPG/RAW pairs adjacent
- `groupByTime(files)` — groups files by date+hour for timeline view
- `prepareDisplayData(files)` — combines sort + pairing/timeline with cache invalidation
- `generateCacheKey(files)` — simple cache key (length + first path)

**Thumbnail system:**
- `LRUThumbCache` — 500-entry renderer-side LRU cache (prevents redundant IPC round-trips)
- `thumbHtml(file)` — builds `<img>` tag with data-src, or SVG fallback
- `requestThumbForImage(img, priority, session)` — enqueues or immediately starts a thumb load with staleness guards
- `requestThumbForPath(filePath, priority)` — looks up tile via tileMap, then calls `requestThumbForImage`
- `requestThumbsForPaths(filePaths)` — bulk priority thumb requests
- `requestVisibleAndSelectedThumbs()` — scans tileMap for visible/selected images needing loads
- `drainThumbQueue()` — processes next pending thumb load respecting rate limits
- `scheduleThumbDrain(delay)` — deferred `drainThumbQueue` via setTimeout
- `handleFileGridScroll()` — sets `isScrolling`, schedules idle recovery
- `recoverStuckThumbs()` — scans up to 200 images for stuck/retry state

**Destination cache:**
- `refreshDestCache()` — calls `scanDest`, rebuilds `destFileCache` Map
- `isAlreadyImported(file)` — checks `destFileCache` and `globalImportIndex`
- `getFileKey(file)` — `lowercaseName_size` composite key

**Step rail:**
- `updateSteps()` — computes and applies active/done classes to step indicators
- `setStep(id, state)` — applies a single step state

**Drive selection:**
- `renderDrives(cards)` — renders drive cards or no-drive message; detects disconnect
- `selectDrive(drive)` — transitions to workspace, clears all state, triggers initial folder browse
- `resetAppState()` — full state reset back to landing screen

**Folder sidebar:**
- `renderFolders(folders, dcimPath)` — renders DCIM root + children with expand/collapse

**Sort:**
- `sortGroup(files)` — sorts a file array by `sortKey`/`sortDir`
- `updateSortButtons()` — syncs sort button active states and arrows

**Render:**
- `renderFileArea(files)` — the only function that rebuilds file tile DOM; advances `renderSessionId`; creates `tileMap` and `IntersectionObserver`
- `buildSectionHtml({ key, label, icon, files })` — builds one grouped section (RAW/Photo/Video)
- `buildIconTilesHtml(files, enablePairing)` — builds icon-mode tile HTML
- `buildListRowsHtml(files, enablePairing)` — builds list-mode row HTML
- `buildFlatHtml(files)` — flat layout (used with Smart Pairing)
- `buildTimelineHtml(groups)` — builds timeline groups with sticky headers

**Selection:**
- `handleTileClick(filePath, shiftKey)` — toggles selection; handles shift-range via `getRenderedPathOrder()`
- `syncOneTile(filePath)` — O(1) class + checkbox update via tileMap
- `syncAllTiles()` — bulk tileMap iteration for Select All / Clear
- `syncPairLinks()` — highlights unselected tiles whose pair partner is selected
- `getRenderedPathOrder()` — returns paths in visual order for shift-click range
- `updateSelectionBar()` — updates counter, button disabled states, and import button visibility

**Browse:**
- `browseFolder(drivePath, folderPath)` — increments request ID, calls `getFiles` IPC, applies result
- `applyFileBatch(batch)` — handles progressive `files:batch` events
- `updateFileStatus(files, folders, processed, total)` — updates status bar file counts

**Destination:**
- `setDestPath(p)` — updates `destPath`, refreshes dest cache, re-renders file area
- `syncImportedBadges()` — in-place badge sync via tileMap (no re-render, scroll preserved)

**Duplicate detection:**
- `detectDuplicates(filePaths)` — splits selected paths into `{ duplicates, clean }` against `destFileCache`
- `showDupWarning(duplicates, total)` — shows modal, returns `Promise<'skip'|'import-all'|'cancel'>`

**Import:**
- `showProgress()` — resets and shows progress modal
- `updateProgress(event)` — updates bar, filename label, ETA/speed
- `showProgressSummary(result)` — shows final summary with integrity row and action buttons
- `formatETA(s)`, `formatDuration(ms)`, `formatSpeed(bps)` — display helpers

**Onboarding + help:**
- `obRender()` — renders current onboarding screen
- `obFinish()` — sets `onboarding_done` in localStorage, hides overlay
- `openHelp()` — populates and shows help modal
- `renderTipsContent()` — shared tips HTML used in onboarding step 4 and help modal
- `showWhatsNewModal({ version, notes })` — shows post-update What's New overlay

**Feedback:**
- `openFeedbackModal(prefill?)` — opens feedback form, restores saved name, pre-fills fields
- `closeFeedbackModal()` — hides overlay, clears error states
- `_setFpSeverity(sev)` — activates severity chip
- `_submitFeedback()` — validates, calls `window.api.sendFeedback()`, shows toast

**Init:**
- `initApp()` — loads import index, sets default dest, registers batch and drive listeners, gets initial drives, checks for What's New

---

### `.github/workflows/release.yml`

**One sentence:** GitHub Actions workflow that builds and publishes Mac + Windows releases to GitHub Releases whenever a `v*` tag is pushed.

**Jobs:** `build-mac` (macos-latest) and `build-windows` (windows-latest), running in parallel.

**Each job:**
1. Checkout code
2. Setup Node.js 20
3. `npm install`
4. Write `config/service-account-key.json` from the `SERVICE_ACCOUNT_KEY` GitHub secret
5. Run `npm run dist:mac -- -p always` or `npm run dist:win -- -p always`

**Secrets required:** `SERVICE_ACCOUNT_KEY` (Google service account JSON), `GH_TOKEN` (GitHub PAT with release write access)

---

## 4. IPC CHANNEL MAP

| Channel | Direction | Sender | Receiver | What it does |
|---|---|---|---|---|
| `drives:get` | renderer → main | `window.api.getDrives()` | `ipcMain.handle` | Returns current memory card list |
| `drives:updated` | main → renderer | `startDrivePolling()` every 5s | `window.api.onDrivesUpdated(cb)` | Pushes updated card list |
| `drive:eject` | renderer → main | `window.api.ejectDrive(mp)` | `ipcMain.handle` | Unmounts the drive via OS command |
| `files:get` | renderer → main | `window.api.getFiles(...)` | `ipcMain.handle` | Reads DCIM folder, merges Sony PRIVATE, returns all media |
| `files:batch` | main → renderer | `files:get` handler mid-scan | `window.api.onFilesBatch(cb)` | Progressive batch of up to 50 files during scan |
| `dest:getDefault` | renderer → main | `window.api.getDefaultDest()` | `ipcMain.handle` | Returns `~/Desktop/AutoIngestTest` |
| `dest:choose` | renderer → main | `window.api.chooseDest()` | `ipcMain.handle` | Opens native folder picker, returns chosen path |
| `dest:scanFiles` | renderer → main | `window.api.scanDest(p)` | `ipcMain.handle` | Returns `{ filename: sizeBytes }` for all files in destPath |
| `files:import` | renderer → main | `window.api.importFiles(...)` | `ipcMain.handle` | Copies files, fires progress events, returns summary |
| `import:progress` | main → renderer | `files:import` handler per file | `window.api.onImportProgress(cb)` | Per-file status: `{ total, index, completedCount, filename, status, eta, speedBps }` |
| `copy:pause` | renderer → main | `window.api.pauseCopy()` | `ipcMain.on` | Sets `isPaused = true` in fileManager |
| `copy:resume` | renderer → main | `window.api.resumeCopy()` | `ipcMain.on` | Sets `isPaused = false` in fileManager |
| `thumb:get` | renderer → main | `window.api.getThumb(srcPath)` | `ipcMain.handle` | Returns thumbnail URL (file:// or data:) or null |
| `feedback:send` | renderer → main | `window.api.sendFeedback(opts)` | `ipcMain.handle` | Enqueues report + immediately flushes telemetry |
| `update:available` | main → renderer | `autoUpdater` event | `window.api.onUpdateAvailable(cb)` | Update download started |
| `update:progress` | main → renderer | `autoUpdater` event | `window.api.onUpdateProgress(cb)` | Download percent |
| `update:ready` | main → renderer | `autoUpdater` event | `window.api.onUpdateReady(cb)` | Update downloaded and ready |
| `update:install` | renderer → main | `window.api.installUpdate()` | `ipcMain.on` (in autoUpdater) | Triggers `quitAndInstall` |
| `importIndex:get` | renderer → main | `window.api.getImportIndex()` | `ipcMain.handle` | Returns in-memory `importIndex` object |
| `checksum:run` | renderer → main | `window.api.runChecksumVerification()` | `ipcMain.handle` | SHA-256 verifies all last-imported files |
| `checksum:progress` | main → renderer | `checksum:run` handler per file | `window.api.onChecksumProgress(cb)` | `{ completed, total }` |
| `checksum:complete` | main → renderer | `checksum:run` handler on finish | `window.api.onChecksumComplete(cb)` | `{ total, failed, failures[] }` |
| `getLastUpdateInfo` | renderer → main | `window.api.getLastUpdateInfo()` | `ipcMain.handle` | Returns `{ version, notes }` once per update |
| `renderer:error` | renderer → main | preload `window.error` listener | `ipcMain.on` (crashReporter) | Forwards JS error to telemetry |
| `renderer:unhandledRejection` | renderer → main | preload `unhandledrejection` | `ipcMain.on` (crashReporter) | Forwards rejection to telemetry |
| `debug:telemetry` | renderer → main | (temp debug only) | `ipcMain.handle` | Tests Sheets auth and append |
| `debug:flush` | renderer → main | (temp debug only) | `ipcMain.handle` | Directly appends debug row to Sheets |
| `ping` | renderer → main | legacy | `ipcMain.handle` | Returns `'pong 🏓'` |

---

## 5. DATA FLOW — IMPORT PIPELINE

**Scenario:** User inserts a card, browses to a folder, selects files, clicks Import.

### Step 1 — Card detection
1. `startDrivePolling()` fires (every 5s)
2. `detectMemoryCards()` calls `drivelist.list()`, filters by `hasDCIM(mountpoint)`
3. Main sends `drives:updated` to all windows
4. Renderer's `renderDrives(cards)` renders drive cards in `#step1Panel`

### Step 2 — Drive selection
1. User clicks a drive card → `selectDrive(drive)` in renderer
2. All prior state cleared (`selectedFiles`, `currentFiles`, `tileMap`, etc.)
3. `workspace.visible` shown, `step1Panel` hidden
4. `browseFolder(drive.mountpoint, null)` called (populates sidebar only — no file area change)

### Step 3 — Folder browse
1. Renderer calls `window.api.getFiles(drivePath, folderPath, requestId)` → `ipcMain.handle('files:get')`
2. Main calls `getDCIMPath(drivePath)`, then `readDirectory(targetPath, onBatch)`
3. `readDirectory` reads entries in batches of 50, stats each file, calls `onBatch(batch)` per batch
4. For each batch, main sends `files:batch` → renderer's `applyFileBatch(batch)` updates sidebar and file area progressively
5. If browsing the DCIM root and a `PRIVATE` folder exists, main calls `scanPrivateFolder(privatePath)` and merges results
6. Final sorted full result returned to `getFiles` resolver
7. Renderer receives final result in `browseFolder()`, calls `refreshDestCache()` then `renderFileArea(currentFiles)`
8. `renderFileArea` builds all tile HTML as a string, sets `innerHTML`, builds `tileMap`, creates `IntersectionObserver`
9. Thumbnails begin loading via `IntersectionObserver` callbacks → `requestThumbForImage` → `window.api.getThumb(srcPath)` → `thumb:get` IPC → `getThumbnail()` in thumbnailer
10. Status bar updated: file counts by type

### Step 4 — File selection
1. User clicks a tile → delegated listener on `#fileGrid` → `handleTileClick(path, shiftKey)`
2. `selectedFiles` Set updated, `syncOneTile(path)` updates DOM via tileMap (O(1))
3. `updateSelectionBar()` shows count, enables Import button
4. `updateSteps()` advances step rail

### Step 5 — Import button click
1. `importBtn.click` → gathers `[...selectedFiles]` as `filePaths`
2. `detectDuplicates(filePaths)` checks `destFileCache` for same-name-same-size matches
3. If duplicates found → `showDupWarning()` modal → user chooses Skip / Import All / Cancel
4. If Skip: `filePaths = clean` (non-duplicates only)
5. `importRunning = true`, `showProgress()` shows the progress modal

### Step 6 — File copy
1. Renderer calls `window.api.importFiles(filePaths, destPath)` → `files:import` IPC
2. Main ensures dest directory exists (`fsp.mkdir recursive`)
3. `copyFiles(filePaths, destination, onProgress)` called
4. Pre-flight: `estimateAvgSize()`, `buildDestIndex()`, `getInitialConcurrency()`
5. Adaptive push queue starts; for each file: `waitIfPaused()` → `fsp.stat()` → `resolveDestPath()` → `fsp.copyFile()` → `verifyFile()` → retry on failure
6. After each completed file, `onProgress` callback fires → main sends `import:progress` → renderer's `updateProgress()` updates bar, filename, ETA/speed
7. Every 10 files: `perf.importSpeedSample()` checks speed threshold
8. After entire queue drains, `copyFiles` returns summary `{ copied, skipped, errors, skippedReasons, failedFiles, copiedFiles, duration }`

### Step 7 — Post-import
1. Main receives summary from `copyFiles`
2. `result.integrity = 'verified'` always set (size verification always runs)
3. If `result.copied > 0`: `updateImportIndex(filePaths, destination)` persists new entries
4. If `result.errors > 0`: `telemetry.enqueue()` auto-reports import failure
5. Main returns summary to renderer
6. Renderer calls `showProgressSummary(summary)` — shows Copied/Skipped/Failed rows, integrity row, optional Deep Verify button, Report Issue button
7. `importRunning = false`
8. User clicks Done → `syncImportedBadges()` updates `.already-imported` classes in-place (no re-render, scroll preserved)
9. `refreshDestCache()` and `getImportIndex()` both refreshed

---

## 6. DATA FLOW — TELEMETRY PIPELINE

**Scenario:** An import completes with errors, triggering an automatic report.

1. `files:import` handler in main.js detects `result.errors > 0`
2. `telemetry.enqueue({ type: 'error', issueType: 'Import Failure', severity: ..., description: ..., context: { destination, errors } })` called
3. `enqueue()` computes a dedup hash: `type|description[:80]|source`
4. If hash was seen within the last 60s: duplicate count incremented; only the 2nd occurrence actually queues the row (prevents log spam)
5. `buildRow(report)` is called:
   - Reads `package.json` for version
   - Formats date as `'16 Apr 2026'`
   - Builds Notes from `context` key-value pairs
   - Produces 19-column row (A–S)
6. Row is pushed to `queue[]`; `persistQueue()` writes `telemetry-queue.json` to disk (survives crash)
7. The 30s `flushTimer` fires (or `flush()` is called immediately for `feedback:send`)
8. `flush()` checks: enabled? not already flushing? queue non-empty? credentials file exists? sheet ID set?
9. JWT auth created from `service-account-key.json` → Google Sheets API v4 `spreadsheets.values.append` called
10. On success: sent rows removed from queue; `persistQueue()` updates disk; `consecutiveFailures = 0`
11. On failure: `consecutiveFailures++`; after 5 consecutive failures the timer stops for 5 minutes (back-off)
12. On `before-quit`: queue persisted to disk; one final `flush()` attempt

**For user-submitted feedback:**  
Steps are identical except `feedback:send` IPC calls `telemetry.flush()` immediately after `enqueue()` so the reporter sees confirmation within seconds.

**For crashes:**  
`crashReporter.js` hooks fire synchronously; `telemetry.flush()` is called best-effort before the process exits.

---

## 7. DATA FLOW — AUTO-UPDATE PIPELINE

**Scenario:** App launches and a new version is available on GitHub.

1. `app.whenReady()` → `autoUpdater.init()` called
2. `autoUpdater.logger = null` (suppresses spam); `autoInstallOnAppQuit = false`
3. All event listeners registered
4. `setTimeout(3000)` → `autoUpdater.checkForUpdatesAndNotify()` called
5. `electron-updater` reads the `publish` config from `package.json` → checks GitHub Releases API for a newer version

**If update found:**
6. `update-available` event → `broadcast('update:available', { version })` to all windows
7. Renderer's `initUpdateBanner()` receives `onUpdateAvailable` → shows `#updateBanner` with `"Downloading update v{version}…"`
8. `electron-updater` begins downloading in background
9. `download-progress` events → `broadcast('update:progress', { percent })` → banner shows `"43%"` etc.
10. `update-downloaded` event → `broadcast('update:ready', { version })` → banner shows `"v{version} ready to install"` + green Restart button
11. `autoUpdater` writes `lastUpdate.json` to `<userData>` with `{ version, notes }`

**User clicks "Restart & Install":**
12. Renderer calls `window.api.installUpdate()` → sends `update:install` IPC
13. Main: `app.relaunch()` registered; then after 500ms: `autoUpdater.quitAndInstall(false, true)` → app exits
14. OS runs installer / replaces binary
15. App restarts fresh

**On the new launch:**
16. `main.js` startup: reads `lastUpdate.json`, parses it into `storedUpdateInfo`, immediately deletes the file
17. Renderer `initApp()` calls `window.api.getLastUpdateInfo()` → `getLastUpdateInfo` IPC returns `storedUpdateInfo`
18. Renderer calls `showWhatsNewModal({ version, notes })` → "What's New" overlay appears

**Periodic re-checks:**
- `setInterval(4 hours)` keeps checking for newer updates throughout the session

---

## 8. STATE MAP — RENDERER

| Variable | Type | What it tracks | Read by | Written by |
|---|---|---|---|---|
| `activeDrive` | `{ label, mountpoint } \| null` | Currently selected memory card | `renderDrives`, `browseFolder`, `renderFolders`, `ejectBtn`, `resetAppState` | `selectDrive`, `changeDriveBtn`, `resetAppState`, `renderDrives` (disconnect) |
| `activeFolderPath` | `string \| null` | Path of the currently browsed folder | `renderFolders`, `browseFolder` | `selectDrive`, `browseFolder`, `applyFileBatch`, `changeDriveBtn`, `resetAppState` |
| `selectedFiles` | `Set<string>` | Absolute paths of selected files (selection truth) | `detectDuplicates`, `handleTileClick`, `updateSelectionBar`, `isAlreadyImported`, `syncAllTiles`, `syncOneTile`, `buildIconTilesHtml`, `buildListRowsHtml`, `requestVisibleAndSelectedThumbs`, `syncPairLinks`, `importBtn.click` | `handleTileClick`, `selectAllBtn`, `clearSelBtn`, `groupBtn`, `deselBtn`, `browseFolder`, `selectDrive`, `changeDriveBtn`, `resetAppState` |
| `currentFiles` | `Array<FileObject>` | All files in the current folder (flat) | `renderFileArea`, `detectDuplicates`, `sortGroup`, `updateSelectionBar`, `getRenderedPathOrder`, many builders | `browseFolder`, `applyFileBatch`, `selectDrive`, `changeDriveBtn`, `resetAppState` |
| `sortKey` | `'date' \| 'name' \| 'size'` | Active sort column | `sortGroup`, `updateSortButtons` | Sort button click handlers |
| `sortDir` | `'asc' \| 'desc'` | Sort direction | `sortGroup`, `updateSortButtons` | Sort button click handlers |
| `destPath` | `string` | Import destination folder path | `importBtn.click`, `detectDuplicates`, `refreshDestCache`, `setDestPath` | `setDestPath`, `initApp` (via `getDefaultDest`) |
| `importRunning` | `boolean` | True while an import IPC call is active | `updateSelectionBar`, `importBtn.click`, `renderDrives` (disconnect) | `importBtn.click`, `progressDoneBtn.click`, `resetAppState` |
| `viewMode` | `'icon' \| 'list'` | Current view mode | `renderFileArea`, `buildSectionHtml`, `syncImportedBadges`, all builders | `viewIconBtn`, `viewListBtn` |
| `lastClickedPath` | `string \| null` | Path of last clicked tile (for shift-range) | `handleTileClick` | `handleTileClick`, `browseFolder`, `selectDrive`, `changeDriveBtn`, `clearSelBtn`, `resetAppState` |
| `fileLoadRequestId` | `number` | Monotonic counter invalidating stale IPC responses | `browseFolder`, `applyFileBatch` | `browseFolder`, `selectDrive`, `changeDriveBtn`, `resetAppState` |
| `showThumbnails` | `boolean` | Whether thumbnails are enabled | `thumbHtml`, `requestThumbForImage`, `requestVisibleAndSelectedThumbs`, `shouldLoadThumb` | `thumbToggleBtn` |
| `isScrolling` | `boolean` | True while the user is scrolling the file grid | `requestThumbForImage`, `drainThumbQueue`, `requestVisibleAndSelectedThumbs` | `handleFileGridScroll`, `resetThumbLoadState`, `resetAppState` |
| `isShuttingDown` | `boolean` | True during eject — blocks all new thumbnail I/O | `requestThumbForImage`, `drainThumbQueue`, `ejectBtn` retry closure | `ejectBtn.click`, `resetAppState` |
| `destFileCache` | `Map<lowercaseName_size, true>` | All files in the destination folder by composite key | `isAlreadyImported`, `detectDuplicates`, `syncImportedBadges` | `refreshDestCache`, `browseFolder`, `resetAppState` |
| `globalImportIndex` | `Object<key, { size, addedAt }>` | Cross-session import index from main process | `isAlreadyImported` | `initApp`, `setDestPath`, `importBtn.click` (post-import), `onChecksumComplete` |
| `tileMap` | `Map<path, HTMLElement>` | Maps file path to its DOM tile (built once per render) | `syncOneTile`, `syncAllTiles`, `syncImportedBadges`, `syncPairLinks`, `requestThumbForPath` | `renderFileArea`, `selectDrive`, `changeDriveBtn`, `resetAppState` |
| `collapsedGroups` | `{ raw, photo, video }: boolean` | Collapse state of each file type section | `buildSectionHtml`, section toggle click | Section toggle click handler in delegated listener |
| `expandedFolders` | `Set<string>` | DCIM folder paths currently expanded in sidebar | `renderFolders` | `renderFolders` toggle click, `selectDrive`, `changeDriveBtn`, `resetAppState` |
| `dcimChildrenCache` | `Array<FolderObject>` | Cached list of DCIM's direct subfolders | `renderFolders` | `renderFolders`, `selectDrive`, `changeDriveBtn`, `resetAppState` |
| `cachedDcimPath` | `string \| null` | DCIM root path for the current drive | `renderFolders` | `renderFolders`, `selectDrive`, `changeDriveBtn`, `resetAppState` |
| `hasSelectedDrive` | `boolean` | True after first explicit drive card click | (informational gate) | `selectDrive`, `changeDriveBtn`, `resetAppState` |
| `isLoadingFiles` | `boolean` | True while a `getFiles` IPC call is in-flight | (informational gate) | `selectDrive`, `changeDriveBtn` |
| `currentFolder` | `string \| null` | Folder path currently shown in file area; null = "Select a folder" | `renderFileArea` | `browseFolder`, `selectDrive`, `changeDriveBtn`, `resetAppState` |
| `pairingEnabled` | `boolean` | Smart Pairing mode: place RAW+JPG pairs adjacent | `prepareDisplayData`, `renderFileArea`, `buildIconTilesHtml`, `buildListRowsHtml`, `syncPairLinks` | `pairToggle.change` |
| `timelineMode` | `boolean` | Timeline view: group by date+hour | `prepareDisplayData`, `renderFileArea` | `timelineViewBtn.click` |
| `cachedPaired` | `Array \| null` | Sorted+paired flat file array (cache) | `prepareDisplayData` | `prepareDisplayData`, `resetViewCache` |
| `cachedTimeline` | `Array \| null` | Timeline groups (cache) | `prepareDisplayData` | `prepareDisplayData`, `resetViewCache` |
| `cacheKey` | `string \| null` | Key for the pairing/timeline cache | `prepareDisplayData` | `prepareDisplayData`, `resetViewCache` |
| `thumbObserver` | `IntersectionObserver \| null` | Single intersection observer for viewport-based image loading | `renderFileArea`, `requestThumbForImage`, `ejectBtn`, `resetAppState` | `renderFileArea`, `resetAppState`, `ejectBtn` |
| `activeLoads` | `number` | Count of in-flight `getThumb` IPC calls | `drainThumbQueue`, `requestThumbForImage` | `requestThumbForImage` (++/--), `ejectBtn` (reset to 0) |
| `pendingThumbQueue` | `Array<function>` | Deferred thumbnail load starters | `drainThumbQueue` | `requestThumbForImage`, `renderFileArea` (cleared), `ejectBtn` (cleared), `resetThumbLoadState` |
| `renderSessionId` | `number` | Monotonic counter advanced per `renderFileArea` call; stales in-flight thumb results | `requestThumbForImage` (compare) | `renderFileArea` (++) |
| `thumbCache` | `LRUThumbCache` (500) | Renderer-side URL cache keyed by `path|size|modifiedAt` | `requestThumbForImage`, `thumbHtml` | `requestThumbForImage` (on success) |
| `obStep` | `number` | Current onboarding screen index (0–3) | `obRender` | `obNextBtn`, `obBackBtn` |
| `_fpSeverity` | `string` | Selected severity in feedback form (`'Low'` default) | `_submitFeedback` | `_setFpSeverity` |

---

## 9. WHAT IS NOT YET BUILT

The following features have no corresponding code yet:

### Commit G — Import Routing (NEXT)
- Pre-import validation: block if any group missing `subEventId`; warn (not block) on unassigned files; warn on duplicate sub-event mapping
- Final confirmation screen: Event Name + Photographer autocomplete (required) + group→sub-event mapping with file counts
- File routing: grouped files → `Collection/Event/SubEvent/Photographer/` (multi) or `Collection/Event/Photographer/` (single); VIDEO → `VIDEO/` subfolder
- `main/fileManager.js` extension: `resolveArchivePath(coll, event, subEventId, photographer, file)` and multi-destination copy loop
- Unassigned files are ignored (not copied, not moved)

### Metadata Tagging
- No EXIF write capability (the app only reads thumbnails via `exifr`)
- Planned fields: photographer name, event description, tags, Hijri date, copyright
- Planned as a background queue with progress saved to `data/` folder
- Videos explicitly excluded from tagging
- Resume on relaunch

### NAS Sync
- No NAS detection, path validation, or sync logic
- Planned: detect NAS via predefined path + sentinel file
- Planned: scan local archive for `.synced = false` events, prompt to sync
- Planned: copy missing events/photographers/files, skip duplicates, rename conflicts
- Planned: mark events as synced after success

### Destination Persistence
- `destPath` is initialised every launch from `getDefaultDest()` (hardcoded `~/Desktop/AutoIngestTest`)
- No `electron-store` or JSON file persisting last-used destination
- Comment in `main.js`: "Not persisted yet (stored in memory only)"

### Photographer Folder / Multi-User Handling
- No concept of "current photographer" in the UI
- No warning when same photographer being processed by another handler
- No additive-only enforcement per photographer

### `data/` directory
- Directory exists in the `build.files` config but contains no code
- Intended for: local state, sync queue, import queue

### Debug IPC handlers
- `debug:telemetry` and `debug:flush` are marked `// TEMPORARY DEBUG — remove after diagnosis` but still present

---

## 10. FEATURE INTEGRATION GUIDE

### Event / Archive System

**Files to touch:**
- `renderer/renderer.js` — add event creation modal, folder hierarchy UI, photographer selector
- `renderer/index.html` — HTML for event modal
- `main/main.js` — new IPC handler `event:create`
- `main/fileManager.js` — extend `resolveDestPath` or add `resolveArchivePath(event, photographer, file)` to build the 3-level path

**New IPC channels:**
- `event:create` (renderer → main) — receives `{ name, hijriDate, type, location, city }`, creates folder hierarchy
- `event:list` (renderer → main) — returns existing events from the archive root
- `photographer:list` (renderer → main) — returns known photographer names

**New renderer state:**
- `activeEvent` — the current event object
- `activePhotographer` — selected photographer name
- `archiveRoot` — base path for the structured archive (user-configurable)

**Data flow:** User selects card → picks event → picks photographer → browses files → Import routes files into `archiveRoot/Collection/Event_01/Photographer/` and `VIDEO/` subdirectory

---

### Hijri Date Logic

**Files to touch:**
- `renderer/renderer.js` — Hijri date picker in event creation UI
- `main/main.js` — optionally validate Hijri date server-side

**New IPC channels:** None strictly required if the conversion runs in the renderer. Add `hijri:convert` (renderer → main) if Node is needed for a library dependency.

**Implementation note:** A standalone Hijri conversion function can be a pure JS utility in `renderer/renderer.js` (or a new `utils/hijri.js` in the main process). No existing code needs modification.

---

### Metadata Tagging

**Files to touch:**
- `services/` — add new `services/metadataTagger.js` using `exiftool-vendored` or write raw EXIF
- `main/main.js` — add IPC handlers `tag:start`, `tag:progress`, `tag:pause`, `tag:resume`
- `data/` — add `tagQueue.json` for resume-on-relaunch
- `renderer/renderer.js` — add tagging progress UI (reuse progress modal pattern)

**New IPC channels:**
- `tag:start` — starts background queue with `{ filePaths, fields }`
- `tag:progress` — push event per file
- `tag:complete` — push event when queue drains

**New renderer state:**
- `taggingRunning` — boolean
- `tagQueue` — Array of `{ path, fields }` pending tagging

**Data flow:** Post-import → tag queue built from `copiedFiles[]` → background worker writes EXIF → `data/tagQueue.json` persisted after each file → on relaunch, incomplete queue auto-resumes

---

### NAS Sync

**Files to touch:**
- `services/` — add `services/nasSync.js`
- `main/main.js` — add IPC handlers `nas:detect`, `nas:scan`, `nas:sync`
- `data/` — add `syncState.json` tracking `{ eventPath, synced: boolean, syncedAt }` per event

**New IPC channels:**
- `nas:detect` — checks if NAS path is accessible, returns `{ connected: boolean }`
- `nas:scan` — returns list of unsynced local events
- `nas:sync` — starts sync; fires `nas:progress` push events
- `nas:progress` — push event per file/event
- `nas:complete` — push event when done

**New renderer state:**
- `nasConnected` — boolean
- `pendingSyncEvents` — Array of event paths needing sync

**Data flow:** App start → `nas:detect` → if NAS connected and unsynced events exist → prompt user → `nas:sync` → for each event: diff local vs NAS → copy missing → skip exact duplicates → rename conflicts → mark `.synced = true` in `syncState.json`

---

### Destination Persistence

**Files to touch:**
- `main/main.js` — load/save dest path from `<userData>/preferences.json` (or use `electron-store`)
- Change `DEFAULT_DEST` constant to be a fallback only

**New IPC channels:**
- `prefs:get` — returns `{ destPath }` from persisted preferences
- `prefs:set` — writes `{ destPath }` to preferences file

**No new renderer state needed** — `destPath` already exists; `setDestPath()` already handles all UI updates. Only the initialisation in `initApp()` needs to call `prefs:get` instead of `dest:getDefault`.

---

*End of CODEBASE_OVERVIEW.md*
