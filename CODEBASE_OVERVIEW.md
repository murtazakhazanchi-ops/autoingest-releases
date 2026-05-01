<!-- TO UPDATE THIS DOCUMENT: run `claude update-overview.md` in the project root -->

# AutoIngest — Complete Technical Codebase Overview

**Version:** 0.7.4-dev  
**Last updated:** 2026-05-01  
**HEAD:** Activity Log enhancements, audit layer, source attribution, dead code cleanup

---

## 0f. v0.7.4-dev — Activity Log, Audit Layer, Source Attribution, Dead Code Cleanup (2026-05-01)

Continuation of v0.7.4-dev. Activity Log UI fully implemented with date-grouped history, issue detection, on-demand disk verification, and per-import source attribution. A-class dead code removed.

### renderer/renderer.js

- Activity Log renders import history grouped by date with `.al-date-label` section headers
- Event-level summary shows photo count, video count, session count, and last-import attribution
- `_hasEntryIssue` / `_getEventIssueCount` — binary issue detection; amber "Check" badge on problematic entries only; no badge on clean entries; "Check Imports" warning in summary only when issues exist
- On-demand "Verify Integrity" button via `_wireAlVerifyBtn` / `_runAlVerify`; result shown inline; no auto-scan, no blocking the renderer
- `_alEventList` stores only `{folderName, hijriDate, sequence, isLegacy}` — never full `_eventJson` (OOM prevention per Renderer Memory Safety rule)
- `_alCurrentEventPath` tracks displayed event folder path; cleared on modal close
- Per-event data loaded lazily on picker change via a single `readEventJson` IPC call
- Import source attribution: `_buildImportSourceMeta()` captures `{type, label, path}` from `activeSource` at import time; displayed as "Source: label · path" or "Source: Not recorded" for old entries; missing source never triggers Check badge
- `normalizeImportDisplayEntry` passes through `skipped` and `duplicates` fields (future-safe; fields not yet written to event.json)
- `auditContext` at import call site includes `source` field, passed through `commitImportTransaction`

### main/main.js

- `normalizeImportSource(src)` validates and normalises source shape before storage
- `buildAuditImportEntries` now includes `source: {type, label, path}` on each log entry
- `import:commitTransaction` destructures `source` from IPC payload; passes through `auditContext`
- `audit:verifyEvent` handler: reads event.json for expected counts, walks event folder tree (depth ≤ 8, no size filter), compares expected vs. actual media file count, returns `{ok, match, expectedPhotos, expectedVideos, expectedTotal, actualPhotos, actualVideos, actualTotal, delta}`
- Drive polling sends guarded with `!win.isDestroyed()` and `!win.webContents.isDestroyed()`
- Removed: `exec` from child_process destructure (now `execFile` only), four dead `fileBrowser` imports (`readDirectory`, `getDCIMPath`, `scanPrivateFolder`, `safeExists`), `findEventFolderForJobs` function, debug `console.log` statements inside `import:commitTransaction`, legacy `ping` IPC handler

### main/preload.js

- Added `verifyEventIntegrity(eventPath)` → `audit:verifyEvent`
- `commitImportTransaction` already uses `...auditContext` spread; no change needed for source pass-through

### renderer/index.html

- Added CSS: `.al-date-group`, `.al-date-label`, `.al-date-entries`, `.al-entry-badge`, `.al-entry-badge--warn`, `.al-summary-warn`, `.al-entry-quality`, `.al-entry-source`, `.al-verify-area`, `.al-verify-btn`, `.al-verify-result` (ok/warn/error variants)

### renderer/eventCreator.js

- Removed debug `console.log` inside `assertValidComponents` (the OK-path trace); `console.error` lines preserved

---

## 0e. v0.7.4-dev — Import Routing, Audit Log, SVG Icons, Legacy Event UX (2026-04-28 → 2026-04-30)

Five commits on top of v0.7.3-dev. Pure renderer + main-process additions; no IPC security model or copy-pipeline changes.

### New files

| File | What it does |
|---|---|
| `main/eventNameParser.js` | Pure function `parseEventName(folderName, lists)` — classifies tokens into CITY, LOCATION, EVENT_TYPE; produces `{ ok, hijriDate, sequence, components[] }` |
| `main/dateEngine.js` | Hijri/Gregorian date conversion API (`getToday`, `convertToHijri`, `convertToGregorian`, `getHijriCalendar`); all calendar math delegated to `hijriCore.js` |
| `main/hijriCore.js` | Low-level AJD-based Hijri math: `hijriFromGregorian`, `hijriToGregorian`, `buildCalendarCells`, month/year helpers. Months are 0-indexed internally |
| `renderer/eventMgmt.js` | `EventMgmt` IIFE singleton — manages `#eventMgmtModal`: open/close, mode switching (`select`/`create`/`edit`/`repair`/`master`), dirty-state guard, focus restoration, backdrop click |
| `renderer/folderNameHelper.js` | `buildFolderName(comp, idx, allSameCity)` and `ensureFolderName(diskComp, idx, allSameCity)` — pure, deterministic, no DOM/IPC |
| `renderer/importRouter.js` | `ImportRouter` IIFE: `buildFileJobs`, `simulateImport`, `validateGroups` — pure data transformation, no I/O |
| `services/settings.js` | `settings.json` persistence for `archiveRoot`, `lastDestPath`, `lastEvent`, `windowBounds`. Atomic tmp→rename writes. Loaded synchronously at startup |
| `services/thumbWorker.js` | `worker_threads` worker — receives `{ id, srcPath }`, reads the file synchronously, replies `{ id, ok, buffer }` |

### New IPC handlers in main.js

`files:importJobs` — event-based import using `copyFileJobs(fileJobs, onProgress)`. Each job carries its own `dest` path, enabling full archive routing (`Collection/Event/[SubEvent/]Photographer/[VIDEO/]`). Returns same shape as `files:import`.

`master:chooseArchiveRoot / chooseExisting / validateAccessible / checkExists / create / scanEvents / parseEvent / renameEvent` — master folder lifecycle (already documented in CLAUDE.md §IPC Channels but now fully wired).

`event:write / read / update / appendImports` — `event.json` disk-backed event persistence.

`dir:ensure / findByPrefix / exists / hasContent / inspectContent / rename` — filesystem helpers.

`settings:getArchiveRoot / setArchiveRoot / getLastDestPath / setLastDestPath / getLastEvent / setLastEvent / verifyLastEvent` — thin wrappers over `services/settings.js`.

`date:getToday / toHijri / toGregorian / getCalendar` — Hijri calendar IPC bridge.

`copy:abort` — calls `abortCopy()` in fileManager (added alongside abort logic).

### New window.api methods in preload.js

`importFileJobs(fileJobs)`, `abortCopy()`, `onAllDrivesUpdated(cb)`, `chooseArchiveRoot()`, `chooseExistingMaster(startPath)`, `validateMasterAccessible(folderPath)`, `checkMasterExists(basePath, folderName)`, `createMaster(basePath, folderName)`, `scanMasterEvents(masterPath)`, `parseEvent(folderName)`, `renameEvent(masterPath, oldName, newName)`, `getArchiveRootSetting()`, `setArchiveRootSetting(value)`, `getLastDestPath()`, `setLastDestPath(p)`, `getLastEvent()`, `setLastEvent(v)`, `verifyLastEvent(collectionPath)`, `writeEventJson(path, data)`, `readEventJson(path)`, `updateEventJson(path, patch)`, `appendImports(path, entries)`, `ensureDir(dirPath)`, `findDirByPrefix(basePath, prefix)`, `dirExists(dirPath)`, `dirHasContent(dirPath)`, `dirInspectContent(dirPath)`, `renameDir(oldPath, newPath)`, `getTodayDate()`, `convertToHijri(iso)`, `convertToGregorian(hijri)`, `getHijriCalendar(year, month)`, `cancelChecksum()`, `getLastUpdateState()`.

### fileManager.js additions

`copyFileJobs(fileJobs, onProgress)` — new function that accepts an array of `{ src, dest }` objects (pre-routed), creates all unique dest directories via `mkdir -p`, then runs the same adaptive concurrency queue used by `copyFiles`. `abortCopy()` — sets `isAborted` flag and resolves all pause-waiters, allowing in-flight copies to drain cleanly.

### EventCreator public API expansion

New methods: `primeFromSettings()`, `restoreLastEvent()`, `getActiveMaster()`, `getSessionArchiveRoot()`, `changeArchiveLocation()`, `isDirty()`, `getNavScreen()`, `goToMasterStep()`, `editSelectedEvent()`.

New nav screens: `masterStep` (collection picker), `eventList` (existing event list), `eventForm` (create/edit form), `previewStep` (Step 3 preview).

Single source of truth pipeline: `event.json` → `readEventJson` IPC → `loadEventFromDisk()` → `setEventState()` → `_eventComps`. All rehydration paths use this pipeline; direct `_eventComps` mutation is guarded.

### Settings persistence (G1 + startup restore)

`services/settings.js` stores `archiveRoot`, `lastDestPath`, `lastEvent` (lookup keys only — `{ collectionPath, collectionName, eventName }`), and `windowBounds`. `init()` loads synchronously at startup. All writes are atomic (`.tmp` → rename).

Window bounds are persisted on close and restored on next launch. Window is now `resizable: true` with `minWidth: 1100 / minHeight: 700`; size defaults to 85% × 90% of the primary display work area when no saved bounds exist.

---

## 0d. v0.7.3-dev — Theme System, activeDrive Fix + UI Polish (2026-04-26)

*(content unchanged — see previous version for details)*

---

## 0c. v0.7.2-dev — Home Screen Import Flow + UI Polish (2026-04-24)

*(content unchanged — see previous version for details)*

---

## 0b. v0.7.1-dev Dashboard Rebuild + UI Cleanup (2026-04-23)

*(content unchanged — see previous version for details)*

---

## 0a. v0.7.0-dev Commits B–F (2026-04-20)

*(content unchanged — see previous version for details)*

---

## 0. v0.7.0-dev CHANGES (2026-04-20)

*(content unchanged — see previous version for details)*

---

## 0b. v0.6.0 CHANGES (2026-04-18)

*(content unchanged — see previous version for details)*

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
- Creates and manages a structured archive (Master Collection → Event → [SubEvent/] → Photographer → VIDEO/)
- Persists user preferences (archive root, last event, window bounds) across sessions

**Targets:** macOS (x64, arm64) and Windows (x64)  
**Current version:** 0.6.0 (package.json; internal dev version is 0.7.4-dev)  
**No build step** — pure vanilla JS + HTML + CSS, launched with `npm start` / `electron .`

---

## 2. ARCHITECTURE

### Process model

Electron splits code into two sandboxed worlds:

| Process | Files | Capabilities |
|---|---|---|
| **Main process** | `main/main.js`, `main/driveDetector.js`, `main/fileBrowser.js`, `main/fileManager.js`, `main/listManager.js`, `main/aliasEngine.js`, `main/dateEngine.js`, `main/hijriCore.js`, `main/eventNameParser.js`, `services/*.js` | Full Node.js, filesystem, child_process, native dialogs, electron-updater |
| **Renderer process** | `renderer/index.html`, `renderer/renderer.js`, `renderer/eventCreator.js`, `renderer/eventMgmt.js`, `renderer/groupManager.js`, `renderer/importRouter.js`, `renderer/treeAutocomplete.js`, `renderer/folderNameHelper.js` | DOM only — zero Node access |
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
| `settings.js` | JSON key-value store for user preferences; atomic tmp→rename writes |
| `thumbWorker.js` | `worker_threads` worker — reads a file synchronously and returns a buffer |

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

**Called by:** `main/fileBrowser.js`, `services/thumbnailer.js`, `main/main.js` (`dest:scanFiles` handler)

**Rule:** Never import directly in renderer; never hardcode extension lists anywhere else.

---

### `main/main.js`

**One sentence:** The Electron main-process entry point — creates the window, wires all IPC handlers, manages the global import index, and orchestrates service startup.

**Functions:**

| Function | What it does |
|---|---|
| `loadImportIndex()` | Reads `importIndex.json` from userData into `importIndex` object |
| `saveImportIndex()` | Atomic write `importIndex` to `importIndex.json` via tmp→rename |
| `trimImportIndex()` | Evicts oldest entries when `importIndex` exceeds 5000 keys |
| `updateImportIndex(filePaths, destPath)` | After a successful copy, stats each source file and upserts `{ size, addedAt }` into `importIndex` |
| `createWindow()` | Creates the BrowserWindow; reads saved bounds from `settings.getWindowBounds()`; saves bounds on close |
| `startDrivePolling()` | Calls `listAllDrives()` every 5s; pushes both `drives:updated` (DCIM) and `drives:allUpdated` (removable) to all windows |
| `sanitizeForPath(name)` | Strips/replaces filesystem-unsafe characters (used internally for event folder name comparison) |
| `normalizeEventJson(data)` | Ensures `components[].id` is always a number |
| `isValidEventJson(obj)` | Shape validator for `event.json`; normalises sequence to number |
| `sortImports(a, b)` | Stable descending sort for import log entries (timestamp, then seq tiebreaker) |
| `isValidImportEntry(e)` | Guards `event:appendImports` against malformed entries |

**IPC handlers registered:**

| Handler | What it does |
|---|---|
| `drives:get` | Returns `detectMemoryCards()` on demand |
| `drive:eject` | Validates mountpoint, runs OS eject command (diskutil / PowerShell / udisksctl) |
| `files:get` | Full recursive scan via `scanMediaRecursive`; streams batches; returns `{ dcimPath, folderPath, folders (tree), files }` |
| `files:import` | Creates dest dir, calls `copyFiles()`, sends `import:progress`, updates import index, telemetry on errors |
| `files:importJobs` | Event-based import via `copyFileJobs(normalisedJobs, onProgress)`; normalises OS path separator; same result shape as `files:import` |
| `dest:getDefault` | Returns `~/Desktop/AutoIngestTest` |
| `dest:choose` | Opens native folder-picker dialog |
| `dest:scanFiles` | Reads all files in destPath filtered to known media extensions, returns `{ filename: sizeBytes }` |
| `thumb:get` | Calls `getThumbnail()`, wraps with `perf.thumbStart/End()` |
| `copy:pause` / `copy:resume` | Calls `setPaused(true/false)` in fileManager |
| `copy:abort` | Calls `abortCopy()` in fileManager |
| `importIndex:get` | Returns the in-memory `importIndex` object |
| `checksum:run` | SHA-256 compares `{ src, dest }` pairs from last import; sends `checksum:progress` and `checksum:complete` |
| `checksum:cancel` | Sets `checksumCancelled = true` to break the verification loop |
| `getLastUpdateInfo` | Returns `storedUpdateInfo` once per update; null thereafter |
| `update:getLastState` | Returns `autoUpdater.getLastUpdateState()` for renderer reload replay |
| `feedback:send` | Enqueues a feedback report and immediately flushes telemetry |
| `master:chooseArchiveRoot` | Opens native folder picker; returns `{ path }` or null |
| `master:chooseExisting` | Opens folder picker defaulting to `startPath`; returns `{ path }` or null |
| `master:validateAccessible` | `fsp.stat` + `fsp.access` check; returns `{ valid, reason? }` |
| `master:checkExists` | Checks if `basePath/folderName` is an existing directory |
| `master:create` | `fsp.mkdir({ recursive: true })` for the given path; returns `{ path, created }` |
| `master:scanEvents` | Reads all subdirectories of a master folder; runs `parseEventName` + tries `event.json`; returns sorted array of `{ folderName, hijriDate, sequence, components, isFromJson, isParseable, isLegacy, isCorrupt, needsReconciliation }`. Renderer must strip heavyweight data immediately and never cache `_eventJson` in module-level state (see Renderer Memory Safety rule in CLAUDE.md) |
| `import:commitTransaction` | Atomic single-write event.json update: merges prepared audit entries (including `source: {type, label, path}`), `lastImport`, and `status` in one tmp→rename operation; also updates import index |
| `audit:verifyEvent` | Reads event.json for expected media counts; recursively walks event folder tree (depth ≤ 8, no minimum size filter); returns `{ok, match, expectedPhotos, expectedVideos, expectedTotal, actualPhotos, actualVideos, actualTotal, delta}` |
| `master:parseEvent` | Calls `parseEventName(folderName, lists)`; returns `components[]` or `[]` |
| `master:renameEvent` | Fresh-stat collision check + `fsp.rename`; returns `{ ok, reason? }` |
| `event:write` | Idempotent: creates folder + writes `event.json` only when file does not already exist |
| `event:read` | Reads and validates `event.json`; returns normalized object or null |
| `event:update` | Detects full vs. partial payload; reads-merge-writes for partial (status-only) callers |
| `event:appendImports` | Double-read + deduplicate-by-id + cap-5000 + atomic write of `imports[]` |
| `dir:ensure` | `fsp.mkdir({ recursive: true })`; returns `{ ok, reason? }` |
| `dir:findByPrefix` | Reads a directory, returns first child folder whose name starts with `prefix` |
| `dir:exists` | `fsp.access` check; returns boolean |
| `dir:hasContent` | Reads dir, returns true if any entry is not `event.json` or hidden |
| `dir:inspectContent` | Returns `{ hasContent, folders[], files[], folderCount, fileCount }` excluding `event.json` and hidden entries |
| `dir:rename` | `fsp.rename(oldPath, newPath)`; returns `{ ok, reason? }` |
| `settings:getArchiveRoot` / `setArchiveRoot` | Thin wrappers over `services/settings.js` |
| `settings:getLastDestPath` / `setLastDestPath` | Thin wrappers over `services/settings.js` |
| `settings:getLastEvent` / `setLastEvent` | Thin wrappers over `services/settings.js` |
| `settings:verifyLastEvent` | `fsp.stat` to confirm collection folder still exists on disk |
| `lists:get` / `lists:add` / `lists:match` / `lists:learnAlias` | Controlled vocabulary list operations |
| `date:getToday` / `date:toHijri` / `date:toGregorian` / `date:getCalendar` | Hijri calendar IPC bridge |
| `window:minimize` / `window:toggleMaximize` / `window:close` | Frameless window controls |
| `debug:telemetry` / `debug:flush` | (temp debug) Validates Sheets auth and tests appends — marked `// TEMPORARY DEBUG`, not yet removed |
| `renderer:error` / `renderer:unhandledRejection` | Forwarded to crashReporter |

**Called by:** Nothing calls main.js — it is the entry point.  
**Calls:** `driveDetector`, `fileBrowser`, `fileManager`, `listManager`, `aliasEngine`, `dateEngine`, `eventNameParser`, `thumbnailer`, `logger`, `telemetry`, `crashReporter`, `performanceMonitor`, `autoUpdater`, `settings`

---

### `main/preload.js`

**One sentence:** The contextBridge layer that safely exposes a typed `window.api` to the renderer while blocking direct Node/Electron access.

**Exposes `window.electronAPI`** (low-level backwards-compat):
- `sendMessage(channel, data)` — `ipcRenderer.send`
- `invoke(channel, data)` — `ipcRenderer.invoke`
- `onMessage(channel, cb)` — `ipcRenderer.on`

**Exposes `window.api`** (complete list):

| Method | IPC action | Purpose |
|---|---|---|
| `getVersion()` | reads package.json | Current app version |
| `getDrives()` | invoke `drives:get` | On-demand drive list |
| `ejectDrive(mountpoint)` | invoke `drive:eject` | Safe drive ejection |
| `onDrivesUpdated(cb)` | listen `drives:updated` | Live DCIM card updates |
| `onAllDrivesUpdated(cb)` | listen `drives:allUpdated` | Live all-removable updates |
| `getFiles(drivePath, folderPath, requestId)` | invoke `files:get` | Browse a folder |
| `onFilesBatch(cb)` | listen `files:batch` | Progressive file batches |
| `getDefaultDest()` | invoke `dest:getDefault` | Default destination path |
| `chooseDest()` | invoke `dest:choose` | Native folder picker |
| `scanDest(destPath)` | invoke `dest:scanFiles` | Scan destination for duplicates |
| `importFiles(filePaths, destination)` | invoke `files:import` | Copy files (Quick Import / legacy) |
| `importFileJobs(fileJobs)` | invoke `files:importJobs` | Event-routed import `[{src,dest}]` |
| `onImportProgress(cb)` | listen `import:progress` | Per-file progress |
| `pauseCopy()` | send `copy:pause` | Pause copy pipeline |
| `resumeCopy()` | send `copy:resume` | Resume copy pipeline |
| `abortCopy()` | send `copy:abort` | Abort copy pipeline |
| `getThumb(srcPath)` | invoke `thumb:get` | Get thumbnail URL |
| `sendFeedback(opts)` | invoke `feedback:send` | Send feedback report |
| `onUpdateAvailable(cb)` | listen `update:available` | Update download started |
| `onUpdateProgress(cb)` | listen `update:progress` | Download percent |
| `onUpdateReady(cb)` | listen `update:ready` | Update ready to install |
| `installUpdate()` | send `update:install` | Trigger install |
| `getImportIndex()` | invoke `importIndex:get` | Cross-session import index |
| `runChecksumVerification()` | invoke `checksum:run` | SHA-256 deep verify |
| `cancelChecksum()` | send `checksum:cancel` | Cancel in-progress checksum |
| `onChecksumProgress(cb)` | listen `checksum:progress` | Checksum file count |
| `onChecksumComplete(cb)` | listen `checksum:complete` | Checksum final result |
| `getLastUpdateInfo()` | invoke `getLastUpdateInfo` | What's New data |
| `getLastUpdateState()` | invoke `update:getLastState` | Update state replay on reload |
| `getLists(name)` | invoke `lists:get` | Load merged list |
| `addToList(name, value)` | invoke `lists:add` | Add entry to writable list |
| `matchList(name, input)` | invoke `lists:match` | Alias-aware ranked search |
| `learnAlias(name, id, label, typed)` | invoke `lists:learnAlias` | Store typed→canonical alias |
| `chooseArchiveRoot()` | invoke `master:chooseArchiveRoot` | Pick archive root folder |
| `chooseExistingMaster(startPath)` | invoke `master:chooseExisting` | Pick existing master folder |
| `validateMasterAccessible(folderPath)` | invoke `master:validateAccessible` | Validate folder accessibility |
| `checkMasterExists(basePath, folderName)` | invoke `master:checkExists` | Check if folder exists |
| `createMaster(basePath, folderName)` | invoke `master:create` | mkdir a master folder |
| `scanMasterEvents(masterPath)` | invoke `master:scanEvents` | Scan event subfolders |
| `parseEvent(folderName)` | invoke `master:parseEvent` | Parse event folder name |
| `renameEvent(masterPath, oldName, newName)` | invoke `master:renameEvent` | Rename event folder |
| `getArchiveRootSetting()` | invoke `settings:getArchiveRoot` | Read persisted archive root |
| `setArchiveRootSetting(value)` | invoke `settings:setArchiveRoot` | Persist archive root |
| `getLastDestPath()` | invoke `settings:getLastDestPath` | Read last import destination |
| `setLastDestPath(p)` | invoke `settings:setLastDestPath` | Persist last import destination |
| `getLastEvent()` | invoke `settings:getLastEvent` | Read last active event context |
| `setLastEvent(v)` | invoke `settings:setLastEvent` | Persist last active event context |
| `verifyLastEvent(collectionPath)` | invoke `settings:verifyLastEvent` | Confirm collection folder exists |
| `writeEventJson(path, data)` | invoke `event:write` | Idempotent event.json create |
| `readEventJson(path)` | invoke `event:read` | Read + validate event.json |
| `updateEventJson(path, patch)` | invoke `event:update` | Full or partial event.json update |
| `appendImports(path, entries)` | invoke `event:appendImports` | Merge-safe audit log append |
| `ensureDir(dirPath)` | invoke `dir:ensure` | mkdir -p |
| `findDirByPrefix(basePath, prefix)` | invoke `dir:findByPrefix` | First child dir matching prefix |
| `dirExists(dirPath)` | invoke `dir:exists` | Boolean existence check |
| `dirHasContent(dirPath)` | invoke `dir:hasContent` | Non-trivial content check |
| `dirInspectContent(dirPath)` | invoke `dir:inspectContent` | Structured content inspection |
| `renameDir(oldPath, newPath)` | invoke `dir:rename` | Rename a directory |
| `minimize()` | invoke `window:minimize` | Minimize window |
| `toggleMaximize()` | invoke `window:toggleMaximize` | Maximize/restore window |
| `close()` | invoke `window:close` | Close window |
| `getTodayDate()` | invoke `date:getToday` | Today in Gregorian + Hijri |
| `convertToHijri(isoDate)` | invoke `date:toHijri` | Gregorian → Hijri |
| `convertToGregorian(hijri)` | invoke `date:toGregorian` | Hijri → Gregorian |
| `getHijriCalendar(year, month)` | invoke `date:getCalendar` | Calendar cells for a month |
| `commitImportTransaction(fileJobs, eventJsonPath, auditContext)` | invoke `import:commitTransaction` | Atomic event.json write with audit entries including `source` |
| `verifyEventIntegrity(eventPath)` | invoke `audit:verifyEvent` | On-demand disk vs. audit count comparison |

**Also hooks:**
- `window.error` → sends `renderer:error` to main (throttled, 1 per 5s)
- `window.unhandledrejection` → sends `renderer:unhandledRejection` to main (throttled)
- `window.beforeunload` → removes all registered IPC listeners via `_renderListeners` map

---

### `main/driveDetector.js`

**One sentence:** Enumerates all mounted drives via `drivelist` and returns DCIM memory cards and all removable drives in a single pass.

**Exports:**
- `listAllDrives()` → `Promise<{ dcim: Array<{ label, mountpoint, size, description, busType, isCard }>, removable: Array<{ label, mountpoint, size, busType }> }>`
  - 4-second timeout wrapping `drivelist.list()`
  - Async `hasDCIM(mountpoint)` checks each mount point (non-blocking, all in parallel)
  - `removable` includes any non-system drive with `isRemovable: true`
- `detectMemoryCards()` → `Promise<Array<{ label, mountpoint }>>` — calls `listAllDrives()`, returns only `dcim` array

**Called by:** `main.js` (polling loop, `drives:get` handler)

---

### `main/fileBrowser.js`

**One sentence:** Recursively scans a memory card or folder, returning typed and stat'd media file objects filtered of macOS junk.

**Exports:**

| Function | What it does |
|---|---|
| `scanMediaRecursive(startDir, onBatch)` | Recursive descent, 50-file batches, MAX_SCAN_DEPTH=12, symlink-loop protection via realpath, expanded SKIP_DIRS list |
| `buildFolderTree(files)` | Pure O(n) transform: builds nested `{ name, path, children, files }` tree from flat file list |
| `readDirectory(dirPath, onBatch?)` | Legacy flat scanner (retained for backwards compat); reads entries in batches of 50 |
| `getDCIMPath(mountpoint)` | Returns path to DCIM folder at mountpoint, or null |
| `scanPrivateFolder(privatePath)` | Scans Sony PRIVATE/M4ROOT/CLIP and PRIVATE/AVCHD/BDMV/STREAM |
| `safeExists(p)` | Async `fsp.access` wrapper |

**Called by:** `main.js` (`files:get` handler)  
**Depends on:** `config/app.config.js`

---

### `main/fileManager.js`

**One sentence:** Copies files with concurrent workers, resume/abort support, and mandatory size verification.

**Exports:**

| Function | What it does |
|---|---|
| `copyFiles(filePaths, destination, onProgress)` | Flat-destination copy pipeline — all files go to `destination/` |
| `copyFileJobs(fileJobs, onProgress)` | Event-routed copy — each `{ src, dest }` job has its own full dest path; creates unique dest dirs via `mkdir -p` |
| `resolveDestPath(destDir, filename, sourceSize)` | skip/copy/rename decision |
| `setPaused(val)` | Sets `isPaused` flag; `waitIfPaused()` polls every 100ms |
| `abortCopy()` | Sets `isAborted = true`; resolves all pause-waiters so in-flight copies drain |
| `getFileHash(filePath)` | Returns SHA-256 hex digest via stream |

**Copy rules (enforced in both `copyFiles` and `copyFileJobs`):**
1. File not at dest → copy
2. File exists, same size → skip
3. File exists, different size → rename `_N` then copy

**Called by:** `main.js` (`files:import` and `files:importJobs` handlers)

---

### `main/listManager.js`

**One sentence:** Loads, merges, deduplicates, and saves the four controlled-vocabulary lists.

**Exports:** `init(userDataPath)`, `getList(name)` → merged array, `addToList(name, rawValue)` → `{ success, value, duplicate, error? }`

**Lists:** `cities` (flat string[]), `photographers` (flat string[]), `event-types` (TreeNode[], read-only), `locations` (TreeNode[])  
**Base files:** `data/*.json` (never modified at runtime)  
**Override files:** `<userData>/{name}.override.json` (user additions, flat string[])

---

### `main/aliasEngine.js`

**One sentence:** Alias-aware ranked search engine for the controlled-vocabulary lists.

**Exports:** `init(userDataPath)`, `normalize(str)`, `slugify(label)`, `flattenToLeaves(listName, data)`, `match(input, listName, data)` → `[{ id, label, score, matchType }]`, `learnAlias(listName, canonicalId, canonicalLabel, typedInput)`

**Score ranking:** exact=100, aliasExact=90, startsWith=80, aliasStarts=70, contains=60, aliasContains=50  
**Alias storage:** `<userData>/{name}.aliases.json` keyed by `slugify(label)`

---

### `main/eventNameParser.js`

**One sentence:** Pure function that classifies event folder name tokens into CITY / LOCATION / EVENT_TYPE components.

**Exports:** `parseEventName(folderName, lists)` → `{ ok, valid, hijriDate?, sequence?, components[]?, hasUnresolved?, reason? }`

**Algorithm:**
1. Match prefix `{YYYY-MM-DD} _{NN}-{rest}` — fail if no match
2. Split `rest` on `-`; classify each token against `cities`, `locations`, `eventTypes` lists
3. City has highest priority; one city = one component anchor
4. Case A (last pre-city token is a location): one component with location; Case B (no location): one component per preceding token
5. Unknown tokens become EVENT_TYPE with `isUnresolved: true`; parse fails ONLY on missing prefix or no city
6. Returns zero-padded `sequence` string preserved for `localeCompare` sort

**No filesystem access. No imports. Pure function.**

---

### `main/dateEngine.js`

**One sentence:** Hijri/Gregorian date conversion API used exclusively via IPC from the renderer.

**Exports:** `getToday()`, `convertToHijri(gregorianDateStr)`, `convertToGregorian(hijri)`, `getHijriCalendar(year, month)`, `normalizeDate(date)`, `formatGregorianDisplay(date)`, `formatHijriDisplay(h)`

**External API contract (month always 1-indexed):**
- `getToday()` → `{ gregorian: { iso, display }, hijri: { year, month, day, iso, display } }`
- `convertToHijri(iso)` → `{ year, month, day, iso, display }`
- `convertToGregorian({ year, month, day })` → `{ iso, display }`
- `getHijriCalendar(year, month)` → `{ cells[], todayISO }`

**Depends on:** `main/hijriCore.js`

---

### `main/hijriCore.js`

**One sentence:** Low-level AJD-based Hijri calendar arithmetic ported from an MIT-licensed open-source library.

**Exports:** `HIJRI_MONTH_NAMES_SHORT`, `HIJRI_MONTH_NAMES_LONG`, `isHijriKabisa(year)`, `daysInHijriMonth(year, month)`, `hijriFromGregorian(date)`, `hijriToGregorian(hd)`, `formatISODate(date)`, `prevHijriMonth(year, month)`, `nextHijriMonth(year, month)`, `gregSubtitle(hYear, hMonth)`, `buildCalendarCells(hYear, hMonth)`

**All months are 0-indexed internally.** Callers that need 1-indexed months must convert at the boundary (`dateEngine.js` handles this).

---

### `services/logger.js`

Appends timestamped log lines asynchronously to `<userData>/app.log` via `fs.appendFile` (non-blocking).  
**Exports:** `log(message)`

---

### `services/settings.js`

**One sentence:** JSON key-value preference store with atomic writes and synchronous startup load.

**Exports:** `init()`, `getArchiveRoot()`, `setArchiveRoot(value)`, `getLastDestPath()`, `setLastDestPath(value)`, `getLastEvent()`, `setLastEvent(value)`, `getWindowBounds()`, `setWindowBounds(value)`

**File location:** `<userData>/settings.json`  
**Write pattern:** `.tmp` → `rename` (crash-safe)  
**init():** Synchronous, idempotent, must be called once after `app.whenReady()`

**`getLastEvent()`** returns `{ collectionPath, collectionName, eventName }` or null. Only lookup keys are persisted — not component objects, which drift on rename. Components are always re-derived from disk at restore time.

**`getWindowBounds()`** returns `{ x, y, width, height }` or null. Saved on window `close` event; applied to `createWindow()` on next launch.

---

### `services/telemetry.js`

Queues all reports and flushes them to Google Sheets "Bug Tracker" tab every 30 seconds.  
**Exports:** `init()`, `enqueue(report)`, `flush()`, `isEnabled()`  
*(Full description unchanged from previous version — see v0.7.2-dev section)*

---

### `services/crashReporter.js`

Passive hooks that capture all crashes and unhandled errors and route them to `telemetry.enqueue()`.  
**Exports:** `init(mainWindow)`  
*(Unchanged — see v0.7.2-dev section)*

---

### `services/performanceMonitor.js`

Automatically samples event loop lag, thumbnail timing, import speed, and heap usage.  
**Exports:** `init()`, `stop()`, `thumbStart(key)`, `thumbEnd(key, opts)`, `importSpeedSample(bytesCopied, elapsedMs)`, `clearThumbTimers()`  
*(Mostly unchanged — see v0.7.2-dev section)*

---

### `services/autoUpdater.js`

Wraps `electron-updater` to check GitHub Releases, download silently, and let the renderer trigger installation.  
**Exports:** `init()`, `getLastUpdateState()`  
*(Mostly unchanged — see v0.7.2-dev section)*

---

### `services/thumbnailer.js`

Generates and disk-caches 160px JPEG thumbnails with 5-layer concurrency control.  
**Exports:** `getThumbnail(srcPath)` → `Promise<string|null>`, `clearCache()`, `shutdownWorkers()`  
**Depends on:** `services/thumbWorker.js` (worker_threads file reader), `fileUtils.js`, `thumbnailCache.js`, `config/app.config.js`, `exifr`, `sharp`  
*(Concurrency and cache behavior unchanged — see v0.7.2-dev section)*

---

### `services/thumbWorker.js`

**One sentence:** A `worker_threads` worker that reads a file synchronously and returns its buffer to the thumbnailer parent thread.

**Protocol:** Receives `{ id, srcPath }`; replies `{ id, ok: true, buffer }` or `{ id, ok: false, error: string }`.

---

### `services/thumbnailCache.js`

500-entry LRU cache shared between `thumbnailer.js` (thumbnail URLs) and an in-flight deduplication Map.  
**Exports:** `thumbnailCache` (LRUCache), `inFlightCache` (Map), `generateCacheKey(file)`  
*(Unchanged)*

---

### `services/fileUtils.js`

Safe `fs.promises`-based helpers that avoid explicit FileHandle.  
**Exports:** `safeRead`, `safeWrite`, `safeStat`, `safeExists`  
*(Unchanged)*

---

### `renderer/index.html`

**One sentence:** The single HTML page containing all CSS (Catppuccin Mocha dark theme + light theme overrides via `[data-theme="light"]`) and the full DOM structure for all UI panels.

**Key sections:**
- CSS custom properties (`:root`) — dual-theme token system (`--glass-*`, `--accent-*`, `--border-*`, semantic surfaces)
- `#updateBanner` — hidden until auto-update event fires
- `#contextBar` — breadcrumb bar shown in workspace; hidden on landing and in event creator
- `#step1Panel` — full-height no-scroll dashboard; `overflow: hidden`
  - `#dashHeader` — frosted-glass header (`-webkit-app-region: drag`) with macOS traffic light clearance
  - `#heroCard` / `#quickImportCard` — share CSS grid slot; `.card-active` crossfade system
  - `#modeToggleRow` — Event Import | Quick Import segmented control
  - `#sourceSection` / `#sourceGrid` — 3 source cards (`#srcMemCard`, `#srcExtDrive`, `#srcLocalFolder`)
  - `#overviewSection` / `#overviewGrid` — 5 stat tiles (`margin-top: 48px`)
  - `#dashFooter` — version left; `#helpBtn` `#bugReportBtn` `#settingsBtn` icon buttons right
- `#eventMgmtModal` — fullscreen event management modal (EventMgmt module)
- `#workspace` — two-panel layout (sidebar + file panel), shown when a source is selected
- `#fileGrid` — scrollable file area; JS writes all tile HTML here
- `#progressOverlay` — import progress modal with pause/resume/abort
- `#dupWarningOverlay` — pre-import duplicate warning modal
- `#onboardingOverlay` — 4-screen first-launch onboarding
- `#helpOverlay` — Quick Reference modal
- `#feedbackOverlay` — Bug report modal
- `<script>` tags — `treeAutocomplete.js`, `folderNameHelper.js`, `importRouter.js`, `groupManager.js`, `eventMgmt.js`, `eventCreator.js`, `renderer.js`

---

### `renderer/renderer.js`

**One sentence:** All UI logic — drive selection, folder browsing, file rendering, selection management, import flow, thumbnail loading, and all modal interactions — with no direct Node or Electron access.

See **Section 8 (State Map)** for all state variables.  
See **Section 5 (Data Flow — Import Pipeline)** for the full import sequence.

**Key functions by category:**

**Utility / formatting:**
- `showMessage(msg, durationMs)`, `setStatusBarMessage(key, text, priority)`, `showInlineHint(containerId, message, storageKey)`
- `escapeHtml(s)`, `formatSize(b)`, `formatDate(iso)`, `formatETA(s)`, `formatDuration(ms)`, `formatSpeed(bps)`
- `getEffectiveTheme()`, `applyTheme()`, `setThemePref(pref)`

**SVG icon system:**
- `const SVG = (() => { ... })()` IIFE defined immediately after `escapeHtml`
- `i(path, w=14)` generates `<svg>` with consistent `viewBox="0 0 24 24"` and `stroke-width="1.6"`
- Named icons: `check`, `checkCircle`, `warn`, `warnCircle`, `block`, `skip`, `clock`, `loader`, `download`, `pause`, `play`, `chevronRight`, `chevronDown`, `folder`, `folderLg`, `flag`, `info`, `camera`, `layers`, `save`, `sparkles`
- **Critical:** `eventCreator.js` and `eventMgmt.js` load before `renderer.js` — they must inline SVG strings directly

**View organisation:**
- `pairFiles(files)`, `groupByTime(files)`, `prepareDisplayData(files)`, `generateCacheKey(files)`

**Thumbnail system:**
- `LRUThumbCache` (500-entry renderer-side cache), `thumbHtml(file)`, `requestThumbForImage`, `requestThumbForPath`, `requestThumbsForPaths`, `requestVisibleAndSelectedThumbs`, `drainThumbQueue`, `scheduleThumbDrain`, `handleFileGridScroll`, `recoverStuckThumbs`

**Destination cache:**
- `refreshDestCache()`, `isAlreadyImported(file)`, `getFileKey(file)`

**Drive selection:**
- `renderDrives(cards)`, `renderExtDrives(cards)`, `selectDrive(source)`, `resetAppState()`
- `_setActiveSource(source)`, `_typeLabelFor(type)`

**Folder sidebar:**
- `renderFolders(folders, dcimPath)`, folder view helpers (enterFolderView, findNodeByPath, etc.)

**Import — Event flow:**
- `showEventImportConfirmModal(groups, eventData)` — renders modal with photographer TreeAutocomplete, group→sub-event mapping table, destination structure preview, file count summary
- `_renderDestinationTree(groups, eventData, photographerName)` — builds monospace tree mirroring archive routing
- `_updateTree(label)` — live tree update on photographer selection change

**Import — General:**
- `showProgress()`, `updateProgress(event)`, `showProgressSummary(result)`

**Selection:**
- `handleTileClick(filePath, shiftKey)`, `syncOneTile(filePath)`, `syncAllTiles()`, `syncPairLinks()`, `getRenderedPathOrder()`, `updateSelectionBar()`

**Grouping:**
- `renderGroupPanel()`, `syncGroupBadge(path)`, `syncAllGroupBadges()`, right-click `_showCtxMenu()`, Cmd+G `_showGroupPickerModal()`

**Landing / mode:**
- `renderHome()` → orchestrates `_renderHomeContextBar()` + `_renderLandingEventCard()` + `_renderInsightsBar()` + `_applyImportMode(importMode)`
- `_applyImportMode(mode)` — toggles source card visibility + crossfades hero/quick cards
- `_switchModeCard(mode)`, `_renderQuickImportCard()`, `_syncQiImportBtn()`

**Event creator navigation:**
- `showEventCreator()` — resets groups, fires `EventMgmt.open({ mode: 'create' })`
- `showEventCreatorResume()` — fires `EventMgmt.open({ mode: 'select' })`

**Activity Log:**
- `openActivityLogModal()`, `_alClose()`, `_onAlPickerChange(folderName)` — lifecycle and picker wiring
- `_alEventList` — lightweight picker cache; stores `{folderName, hijriDate, sequence, isLegacy}` only — never full event data
- `_alMasterPath` — master folder path used by Activity Log picker (module-level)
- `_alCurrentEventPath` — event folder path currently displayed (module-level, nullable; cleared on close)
- `normalizeImportDisplayEntry(entry)` — normalizes one import log entry; returns null for invalid entries
- `_hasEntryIssue(entry)`, `_getEventIssueCount(entries)` — issue detection: checks `timeMs`, `photographer`, `componentName`, `photos`/`videos`
- `_groupEntriesByDate(entries)` — groups sorted entries into `{date, entries[]}` arrays for date-header rendering
- `_buildImportSourceMeta()` — builds `{type, label, path}` from `activeSource` at import time
- `_formatImportSource(source)` — renders source as "label · path" or "Not recorded"
- `_wireAlVerifyBtn()`, `_runAlVerify()` — wires and executes on-demand Verify Integrity check; calls `audit:verifyEvent` IPC
- `_renderActivityLogBody(eventJson)` — renders full Activity Log panel for one event

**Init:**
- `initApp()` — primes `EventCreator.primeFromSettings()`, calls `EventCreator.restoreLastEvent()`, loads import index, sets default dest, registers listeners, gets initial drives, checks for What's New

---

### `renderer/eventCreator.js`

**One sentence:** Module singleton that orchestrates the full event creation, selection, edit, and preview flow inside the `#eventMgmtModal`.

**Nav screens:** `masterStep` → `eventList` → (`eventForm` for create/edit) or `previewStep`

**Key internal functions:**

| Function | What it does |
|---|---|
| `loadEventFromDisk(eventPath)` | Reads `event.json` via IPC; normalizes disk format to UI format (`types[]` → `eventTypes[{label}]`) |
| `setEventState(components)` | Single entry point for `_eventComps` mutation; guards against disk-format passthrough |
| `_repairLegacyEvent(eventPath, entry)` | Writes minimal `event.json` for legacy folders; retries loadEventFromDisk up to 3 times |
| `showMasterStep()` | Renders the collection picker (create new or select existing) |
| `showEventStep()` / `_scanAndRenderEventList()` | Scans master folder; renders sortable event list with LEGACY / ⚠ badges |
| `_renderEventForm()` | Renders create/edit/repair form with component builder |
| `_handleSaveEditedEvent()` | Validates, builds new name (hijriDate + sequence locked), renames folder, syncs component subfolders, updates `_scannedEvents` cache |
| `_tryCreateEvent()` | Validates, builds event name, creates folder, writes `event.json`, creates component subfolders |
| `_tryRepairEvent()` | Writes `event.json` for legacy event then re-opens in normal view mode |
| `openEventForEdit(entry, { skipAutoRepair })` | Opens event in edit mode; `skipAutoRepair: true` skips `_repairLegacyEvent`, inits blank component state, sets `_viewingExisting.isLegacy = true` |
| `showLegacyEventWarningModal()` | Glass modal with "Edit Event" / "Cancel" for events without `event.json` |
| `showStructureChangeWarningModal(diskInfo)` | Blocks save when single→multi component change on event with existing imports |
| `_computeNextSequence(hijriDate)` | Scans `_scannedEvents` + `coll.events` for max sequence on that date, returns max+1 |
| `buildFolderName(comp, idx, allSameCity)` | Deterministic subfolder name (inline copy of `folderNameHelper.js`) |

**Public API:**

| Method | What it does |
|---|---|
| `start()` | Enter at master step, full reset (keeps `sessionArchiveRoot`) |
| `resetSelection()` | Reset selection state, keep `sessionArchiveRoot` and session collections |
| `syncRail()` | Sync rail highlight to current step |
| `getSelectedCollection()` | Returns `selectedCollection` string or null |
| `getSessionCollections()` | Returns session collections array |
| `getActiveMaster()` | Returns `{ name, path }` or null |
| `getSessionArchiveRoot()` | Returns session-scoped archive root path |
| `changeArchiveLocation()` | Opens picker; re-renders Step 1 if open |
| `primeFromSettings()` | `async` — loads `settings.archiveRoot` into `sessionArchiveRoot` at startup |
| `restoreLastEvent()` | `async` — reads `settings.lastEvent`, verifies path, loads from disk, populates session state |
| `getActiveEventData()` | Returns `{ coll, event, idx }` or null |
| `getEventComps()` | Returns deep clone of live `_eventComps` |
| `getSubEventNames()` | Returns `{ id, name }[]` (folder names); `[]` for single-component events |
| `setActiveEventIndex(idx)` | Set active event within a collection |
| `isDirty()` | True when on `eventForm` screen in create/edit/repair mode |
| `getNavScreen()` | Returns current nav screen name |
| `goToMasterStep()` | Navigate back to master step; clears all event state |
| `editSelectedEvent()` | `async` — opens highlighted event directly in edit mode |

**`folderName` persistence:** Each disk-format component carries `folderName: string` set once at creation, never recomputed. Import routing reads `group.subEventId` (the persisted `folderName`), never calls `buildFolderName` at import time.

**Single-component subfolder rule:** Subfolders created only when `components.length > 1`. Guard in `_tryCreateEvent` and `_handleSaveEditedEvent`.

---

### `renderer/eventMgmt.js`

**One sentence:** IIFE singleton managing the `#eventMgmtModal` overlay — open/close lifecycle, mode switching, dirty-state guard, and focus management.

**Modes:** `select` (event list + Continue button), `create` (event form + Create button), `edit` (event form + Save button), `repair` (repair form + Repair button), `master` (collection picker — footer shows only Back)

**Public API:**

| Method | What it does |
|---|---|
| `open({ mode })` | Saves trigger element; syncs footer buttons; adds `.open` class; moves focus into modal |
| `close()` | Removes `.open` class; restores focus to trigger element (re-queries by id if detached) |
| `requestClose()` | Dirty-check then dispatches `eventmgmt:requestClose` custom event |
| `handleBack()` | Smart back: SELECT-screen → `requestClose()`; CREATE/EDIT/PREVIEW → dirty-check then `EventCreator.navigateBack()` |
| `setMode(mode)` | Updates `_mode`, syncs footer buttons and collection bar |
| `isOpen()` | Returns `_isOpen` boolean |
| `getMode()` | Returns current mode string |

**Footer button visibility by mode:**
- `select` → Continue (disabled until row selected)
- `create` → Create (disabled until form valid)
- `edit` → Save Changes
- `repair` → Repair (disabled until form valid)
- `master` → (none — inline Continue button inside form)

---

### `renderer/folderNameHelper.js`

**One sentence:** Pure, side-effect-free helpers for computing component subfolder names.

**Exports (ES module `export`):**
- `buildFolderName(comp, idx, allSameCity)` → `string` — `{01}-{TypePart}[-LocationPart][-CityPart]`; city included only when `allSameCity === false`
- `ensureFolderName(diskComp, idx, allSameCity)` → `{ ...diskComp, folderName }` — sets `folderName` only if absent; existing value is never overwritten

**No DOM, no IPC.** Safe to import in tests.

---

### `renderer/importRouter.js`

**One sentence:** Pure data-transformation module that builds `{ src, dest }` file jobs for the event-based import flow.

**Public API (IIFE, exposed as `ImportRouter`):**

| Method | What it does |
|---|---|
| `buildFileJobs({ groups, eventData, photographer })` | Returns `{ fileJobs[], skippedSrcs[] }` — delegates to `simulateImport` |
| `simulateImport({ groups, eventData, photographer })` | Returns `{ fileJobs[], skippedSrcs[], summary }` — routing truth; dev-mode consistency assertion |
| `validateGroups({ groups, eventData })` | Returns `{ errors[], warnings[] }` — blocking errors: missing subEventId; non-blocking warnings: duplicate subEvent, unresolved tokens |

**Routing rules:**
- Single-component: `masterPath / eventName / Photographer / [VIDEO /] filename`
- Multi-component: `masterPath / eventName / subEventId / Photographer / [VIDEO /] filename`
- Group with no `subEventId` in multi mode → files go to `skippedSrcs` (never imported)
- VIDEO detection: extension match against `{ .mp4, .mov }` (must stay in sync with `app.config.js`)
- Path separator: `/` throughout; `main.js` normalises to OS native via `path.normalize()`

**No IPC. No DOM. No filesystem I/O.** Node.js compatible (`module.exports` fallback for tests).

---

### `renderer/groupManager.js`

Module singleton. Manages file-to-group assignments during the import session.  
*(Unchanged — see v0.7.0-dev Commits B–F section for full description)*

---

### `renderer/treeAutocomplete.js`

Reusable dropdown class for tree browse + alias-aware search.  
*(Unchanged — see v0.7.0-dev section)*

---

### `.github/workflows/release.yml`

GitHub Actions workflow that builds and publishes Mac + Windows releases on `v*` tag push.  
*(Unchanged — see v0.7.2-dev section)*

---

## 4. IPC CHANNEL MAP

| Channel | Direction | Sender | Receiver | What it does |
|---|---|---|---|---|
| `drives:get` | renderer → main | `window.api.getDrives()` | `ipcMain.handle` | Returns current memory card list |
| `drives:updated` | main → renderer | `startDrivePolling()` every 5s | `window.api.onDrivesUpdated(cb)` | Pushes updated DCIM card list |
| `drives:allUpdated` | main → renderer | `startDrivePolling()` every 5s | `window.api.onAllDrivesUpdated(cb)` | Pushes all removable drives |
| `drive:eject` | renderer → main | `window.api.ejectDrive(mp)` | `ipcMain.handle` | Unmounts the drive via OS command |
| `files:get` | renderer → main | `window.api.getFiles(...)` | `ipcMain.handle` | Recursive scan; returns files + folder tree |
| `files:batch` | main → renderer | `files:get` handler mid-scan | `window.api.onFilesBatch(cb)` | Progressive batch of up to 50 files |
| `dest:getDefault` | renderer → main | `window.api.getDefaultDest()` | `ipcMain.handle` | Returns `~/Desktop/AutoIngestTest` |
| `dest:choose` | renderer → main | `window.api.chooseDest()` | `ipcMain.handle` | Opens native folder picker |
| `dest:scanFiles` | renderer → main | `window.api.scanDest(p)` | `ipcMain.handle` | Returns `{ filename: sizeBytes }` for dest |
| `files:import` | renderer → main | `window.api.importFiles(...)` | `ipcMain.handle` | Flat-destination copy; fires progress events |
| `files:importJobs` | renderer → main | `window.api.importFileJobs(jobs)` | `ipcMain.handle` | Event-routed copy `[{src,dest}]` |
| `import:progress` | main → renderer | both import handlers | `window.api.onImportProgress(cb)` | Per-file status |
| `copy:pause` | renderer → main | `window.api.pauseCopy()` | `ipcMain.on` | Sets `isPaused = true` |
| `copy:resume` | renderer → main | `window.api.resumeCopy()` | `ipcMain.on` | Sets `isPaused = false` |
| `copy:abort` | renderer → main | `window.api.abortCopy()` | `ipcMain.on` | Aborts copy pipeline |
| `thumb:get` | renderer → main | `window.api.getThumb(srcPath)` | `ipcMain.handle` | Returns thumbnail URL or null |
| `feedback:send` | renderer → main | `window.api.sendFeedback(opts)` | `ipcMain.handle` | Enqueues report + immediately flushes |
| `update:available` | main → renderer | `autoUpdater` event | `window.api.onUpdateAvailable(cb)` | Update download started |
| `update:progress` | main → renderer | `autoUpdater` event | `window.api.onUpdateProgress(cb)` | Download percent |
| `update:ready` | main → renderer | `autoUpdater` event | `window.api.onUpdateReady(cb)` | Update ready to install |
| `update:install` | renderer → main | `window.api.installUpdate()` | `ipcMain.on` | Triggers `quitAndInstall` |
| `importIndex:get` | renderer → main | `window.api.getImportIndex()` | `ipcMain.handle` | Returns in-memory `importIndex` |
| `checksum:run` | renderer → main | `window.api.runChecksumVerification()` | `ipcMain.handle` | SHA-256 verifies last-imported files |
| `checksum:cancel` | renderer → main | `window.api.cancelChecksum()` | `ipcMain.on` | Cancels in-progress checksum |
| `checksum:progress` | main → renderer | `checksum:run` per file | `window.api.onChecksumProgress(cb)` | `{ completed, total }` |
| `checksum:complete` | main → renderer | `checksum:run` on finish | `window.api.onChecksumComplete(cb)` | `{ total, failed, failures[] }` |
| `getLastUpdateInfo` | renderer → main | `window.api.getLastUpdateInfo()` | `ipcMain.handle` | Returns `{ version, notes }` once |
| `update:getLastState` | renderer → main | `window.api.getLastUpdateState()` | `ipcMain.handle` | Update state replay on reload |
| `renderer:error` | renderer → main | preload `window.error` listener | `ipcMain.on` (crashReporter) | Forwards JS error to telemetry |
| `renderer:unhandledRejection` | renderer → main | preload `unhandledrejection` | `ipcMain.on` (crashReporter) | Forwards rejection to telemetry |
| `window:minimize` | renderer → main | `window.api.minimize()` | `ipcMain.handle` | Minimizes window |
| `window:toggleMaximize` | renderer → main | `window.api.toggleMaximize()` | `ipcMain.handle` | Maximizes or restores window |
| `window:close` | renderer → main | `window.api.close()` | `ipcMain.handle` | Closes window |
| `master:chooseArchiveRoot` | renderer → main | `window.api.chooseArchiveRoot()` | `ipcMain.handle` | Opens folder picker for archive root |
| `master:chooseExisting` | renderer → main | `window.api.chooseExistingMaster(p)` | `ipcMain.handle` | Opens folder picker defaulting to `p` |
| `master:validateAccessible` | renderer → main | `window.api.validateMasterAccessible(p)` | `ipcMain.handle` | `stat` + `access` check |
| `master:checkExists` | renderer → main | `window.api.checkMasterExists(b,n)` | `ipcMain.handle` | Checks if `b/n` is a directory |
| `master:create` | renderer → main | `window.api.createMaster(b,n)` | `ipcMain.handle` | `mkdir -p` for master folder |
| `master:scanEvents` | renderer → main | `window.api.scanMasterEvents(p)` | `ipcMain.handle` | Scans event subdirs; returns parsed array |
| `master:parseEvent` | renderer → main | `window.api.parseEvent(n)` | `ipcMain.handle` | `parseEventName` → `components[]` |
| `master:renameEvent` | renderer → main | `window.api.renameEvent(m,o,n)` | `ipcMain.handle` | Collision-checked `fsp.rename` |
| `event:write` | renderer → main | `window.api.writeEventJson(p,d)` | `ipcMain.handle` | Idempotent create of `event.json` |
| `event:read` | renderer → main | `window.api.readEventJson(p)` | `ipcMain.handle` | Read + validate `event.json` |
| `event:update` | renderer → main | `window.api.updateEventJson(p,patch)` | `ipcMain.handle` | Full or partial `event.json` update |
| `event:appendImports` | renderer → main | `window.api.appendImports(p,entries)` | `ipcMain.handle` | Merge-safe audit log append (used by Quick Import only) |
| `import:commitTransaction` | renderer → main | `window.api.commitImportTransaction(jobs,path,ctx)` | `ipcMain.handle` | Atomic event.json write: audit entries + `lastImport` + `status` in one tmp→rename; also updates import index |
| `audit:verifyEvent` | renderer → main | `window.api.verifyEventIntegrity(eventPath)` | `ipcMain.handle` | Walks event folder tree, compares media count vs. event.json `imports[]` totals |
| `dir:ensure` | renderer → main | `window.api.ensureDir(p)` | `ipcMain.handle` | `mkdir -p` |
| `dir:findByPrefix` | renderer → main | `window.api.findDirByPrefix(b,pfx)` | `ipcMain.handle` | First child dir matching prefix |
| `dir:exists` | renderer → main | `window.api.dirExists(p)` | `ipcMain.handle` | Boolean existence check |
| `dir:hasContent` | renderer → main | `window.api.dirHasContent(p)` | `ipcMain.handle` | Non-trivial content check |
| `dir:inspectContent` | renderer → main | `window.api.dirInspectContent(p)` | `ipcMain.handle` | `{ hasContent, folders[], files[], … }` |
| `dir:rename` | renderer → main | `window.api.renameDir(o,n)` | `ipcMain.handle` | `fsp.rename(oldPath, newPath)` |
| `settings:getArchiveRoot` / `setArchiveRoot` | renderer ↔ main | `window.api.getArchiveRootSetting/setArchiveRootSetting` | `ipcMain.handle` | Archive root persistence |
| `settings:getLastDestPath` / `setLastDestPath` | renderer ↔ main | `window.api.getLastDestPath/setLastDestPath` | `ipcMain.handle` | Last import dest persistence |
| `settings:getLastEvent` / `setLastEvent` | renderer ↔ main | `window.api.getLastEvent/setLastEvent` | `ipcMain.handle` | Last event context persistence |
| `settings:verifyLastEvent` | renderer → main | `window.api.verifyLastEvent(p)` | `ipcMain.handle` | Confirm collection folder exists on disk |
| `lists:get` / `lists:add` / `lists:match` / `lists:learnAlias` | renderer → main | `window.api.*` | `ipcMain.handle` | Controlled vocabulary list operations |
| `date:getToday` / `date:toHijri` / `date:toGregorian` / `date:getCalendar` | renderer → main | `window.api.*` | `ipcMain.handle` | Hijri calendar bridge |
| `debug:telemetry` / `debug:flush` | renderer → main | temp debug only | `ipcMain.handle` | Tests Sheets auth / debug append — marked `// TEMPORARY DEBUG`, not yet removed |

---

## 5. DATA FLOW — IMPORT PIPELINE

### Quick Import (Legacy / flat-destination)

1–7 same as documented in previous version (card detection → drive selection → folder browse → file selection → import button → copy → post-import).

### Event Import (Archive-routed)

1. User selects files, assigns them to groups via right-click context menu or Cmd+G.
2. Import button → validation:
   - `GroupManager.hasMissingSubEvents()` → shows `showMissingSubEventModal()` (blocking)
   - `GroupManager.getUnassignedFiles(allPaths)` → shows unassigned warning (non-blocking)
   - `GroupManager.getDuplicateSubEvents()` → shows duplicate warning (non-blocking)
3. `showEventImportConfirmModal(groups, eventData)` — photographer TreeAutocomplete + destination structure preview + Continue / Cancel.
4. On Continue: `liveComps = EventCreator.getEventComps()` (snapshot), `eventData.event.components = liveComps`.
5. `ImportRouter.buildFileJobs({ groups, eventData, photographer })` → `{ fileJobs, skippedSrcs }`.
6. `window.api.importFileJobs(fileJobs)` → `files:importJobs` IPC → `copyFileJobs(normalisedJobs, onProgress)`.
7. `copyFileJobs` creates all unique dest dirs (`mkdir -p`), runs adaptive concurrency copy queue.
8. Post-import: `window.api.commitImportTransaction(fileJobs, eventJsonPath, auditContext)` — single atomic write to `event.json`. Audit entries include `{ id, seq, timestamp, photographer, componentIndex, componentName, counts: {photos, videos}, source: {type, label, path} }`. `source` is captured from `activeSource` at import time via `_buildImportSourceMeta()`. Old entries without `source` are backward-compatible; `isValidImportEntry` and `_hasEntryIssue` do not require the field.
9. `EventCreator.restoreLastEvent()` triggered on next app launch reads persisted event from `settings.lastEvent`.

---

## 6. DATA FLOW — TELEMETRY PIPELINE

*(Unchanged — see v0.7.2-dev section)*

---

## 7. DATA FLOW — AUTO-UPDATE PIPELINE

*(Unchanged — see v0.7.2-dev section)*

---

## 8. STATE MAP — RENDERER

| Variable | Type | What it tracks |
|---|---|---|
| `activeSource` | `{ type, name, path } \| null` | Which drive/folder the user has selected |
| `importMode` | `'event' \| 'quick'` | Active ingestion mode |
| `activeDrive` | `{ label, mountpoint } \| null` | Currently selected memory card (for eject support) |
| `activeFolderPath` | `string \| null` | Path of the currently browsed folder |
| `selectedFiles` | `Set<string>` | Absolute paths of selected files |
| `currentFiles` | `Array<FileObject>` | All files in the current folder (flat) |
| `sortKey` | `'date' \| 'name' \| 'size'` | Active sort column |
| `sortDir` | `'asc' \| 'desc'` | Sort direction |
| `destPath` | `string` | Import destination folder path |
| `importRunning` | `boolean` | True while an import IPC call is active |
| `viewMode` | `'icon' \| 'list'` | Current view mode |
| `viewModeType` | `'media' \| 'folder'` | Media view (flat) or Folder view (sidebar-driven) |
| `currentFolderTree` | `object \| null` | Root tree object set on root browse |
| `currentFolderContext` | `{ path, files, isRoot, isLeaf }` | Currently displayed folder in folder view |
| `lastClickedPath` | `string \| null` | Path of last clicked tile (for shift-range) |
| `fileLoadRequestId` | `number` | Monotonic counter invalidating stale IPC responses |
| `_prevDriveKeys` | `string \| null` | Diff key for memory card list |
| `_prevExtKeys` | `string \| null` | Diff key for external drive list |
| `_currentMemCardMountpoints` | `Set<string>` | Mountpoints of DCIM cards (for ext-drive filtering) |
| `quickImportDest` | `string \| null` | Quick Import destination, persisted in `localStorage` |
| `_draggedPaths` | `string[]` | Paths currently being dragged from the file grid |
| `showThumbnails` | `boolean` | Whether thumbnails are enabled |
| `isScrolling` | `boolean` | True while the user is scrolling the file grid |
| `isShuttingDown` | `boolean` | True during eject — blocks all new thumbnail I/O |
| `destFileCache` | `Map<name_size, true>` | Files in destination folder by composite key |
| `globalImportIndex` | `Object` | Cross-session import index from main process |
| `tileMap` | `Map<path, HTMLElement>` | Maps file path to DOM tile (built once per render) |
| `collapsedGroups` | `{ raw, photo, video }: boolean` | Collapse state of each file type section |
| `expandedFolders` | `Set<string>` | DCIM folder paths currently expanded in sidebar |
| `dcimChildrenCache` | `Array<FolderObject>` | Cached list of DCIM's direct subfolders |
| `cachedDcimPath` | `string \| null` | DCIM root path for the current drive |
| `hasSelectedDrive` | `boolean` | True after first explicit drive card click |
| `isLoadingFiles` | `boolean` | True while a `getFiles` IPC call is in-flight |
| `currentFolder` | `string \| null` | Folder path currently shown in file area |
| `pairingEnabled` | `boolean` | Smart Pairing mode: place RAW+JPG pairs adjacent |
| `timelineMode` | `boolean` | Timeline view: group by date+hour |
| `cachedPaired` | `Array \| null` | Sorted+paired flat file array (cache) |
| `cachedTimeline` | `Array \| null` | Timeline groups (cache) |
| `cacheKey` | `string \| null` | Key for the pairing/timeline cache |
| `thumbObserver` | `IntersectionObserver \| null` | Single intersection observer for viewport-based loading |
| `activeLoads` | `number` | Count of in-flight `getThumb` IPC calls |
| `pendingThumbQueue` | `Array<function>` | Deferred thumbnail load starters |
| `renderSessionId` | `number` | Monotonic counter advanced per `renderFileArea` call |
| `thumbCache` | `LRUThumbCache` (500) | Renderer-side URL cache |
| `obStep` | `number` | Current onboarding screen index (0–3) |
| `_fpSeverity` | `string` | Selected severity in feedback form |
| `importMode` | `'event' \| 'quick'` | Dashboard mode (also used for import routing) |
| `_alEventList` | `Array<{folderName, hijriDate, sequence, isLegacy}> \| null` | Lightweight Activity Log event picker cache; never stores `_eventJson` or `imports[]` |
| `_alMasterPath` | `string \| null` | Master folder path used to resolve event paths in Activity Log picker |
| `_alCurrentEventPath` | `string \| null` | Absolute path of the event folder currently displayed in Activity Log; cleared on modal close |

---

## 9. WHAT IS NOT YET BUILT

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

### Destination Persistence (partial)
- `destPath` in Quick Import mode is initialised from `settings.getLastDestPath()` — this is now persisted.
- `destPath` in Event Import mode is derived from `sessionArchiveRoot` — no separate picker.

### Debug IPC handlers
- `debug:telemetry` and `debug:flush` are marked `// TEMPORARY DEBUG — remove after diagnosis` but still present. `ping` was removed in the 2026-05-01 cleanup pass.

### B/D-class dead code (deferred)
- Some exported symbols in `fileBrowser.js` and `fileManager.js` are exported but not called by main.js (D-class). Flagged but not removed — exports are not harmful and removal was out of scope for the fix-only pass.

---

## 10. FEATURE INTEGRATION GUIDE

### Event / Archive System — COMPLETE

The full event/archive system is implemented:
- Collection picker (create or select existing master folder)
- Event list with scanner (`master:scanEvents`) and event name parser
- Create/edit/repair event forms with component builder
- Folder hierarchy created on disk at creation and synced on edit
- Event-routed import via `importFileJobs` + `ImportRouter.buildFileJobs`
- Audit log appended to `event.json:imports[]` after each successful import
- Startup restore via `settings.lastEvent` + `EventCreator.restoreLastEvent()`

### Hijri Date Logic — COMPLETE

`main/hijriCore.js` + `main/dateEngine.js` + IPC bridge (`date:*` channels). Renderer accesses all date conversion via `window.api.getTodayDate()`, `convertToHijri()`, `convertToGregorian()`, `getHijriCalendar()`.

### Destination Persistence — COMPLETE (for archive root)

`services/settings.js` persists `archiveRoot` (the master folder root), `lastDestPath` (Quick Import destination), `lastEvent` (last active event context keys), and `windowBounds`. All writes atomic.

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

### NAS Sync

**Files to touch:**
- `services/` — add `services/nasSync.js`
- `main/main.js` — add IPC handlers `nas:detect`, `nas:scan`, `nas:sync`
- `services/settings.js` — add `syncState` tracking per event

**New IPC channels:**
- `nas:detect`, `nas:scan`, `nas:sync`, `nas:progress`, `nas:complete`

**Data flow:** App start → `nas:detect` → if NAS connected and unsynced events exist → prompt user → `nas:sync` → for each event: diff local vs NAS → copy missing → skip exact duplicates → rename conflicts → mark `.synced = true`

---

*End of CODEBASE_OVERVIEW.md*
