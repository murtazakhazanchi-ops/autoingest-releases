# AutoIngest — Claude Code Project Brief

This file is read automatically by Claude Code at the start of every session.
It contains permanent rules, architecture decisions, and project context.

---

## What This App Does

AutoIngest is a cross-platform Electron (Node.js) desktop app for macOS and Windows.
It imports photos and videos from camera memory cards into a structured local archive,
with optional NAS sync. It is designed for multi-photographer event coverage (e.g. Safar).

---

## File Structure

```
electron-app-v5/
├── config/
│   └── app.config.js        ← SOLE source of truth for media extensions
├── main/
│   ├── main.js              ← Electron main process, IPC handlers
│   ├── preload.js           ← contextBridge (window.api namespace)
│   ├── driveDetector.js     ← drivelist polling, DCIM detection
│   ├── fileBrowser.js       ← readDirectory(), getDCIMPath()
│   └── fileManager.js       ← copyFiles(), resolveDestPath()
├── renderer/
│   ├── index.html           ← All CSS inline, Catppuccin Mocha theme
│   └── renderer.js          ← All UI logic, no Node/Electron access
├── services/                ← Future: metadata tagger, sync engine
├── data/                    ← Future: local state, sync queue
└── package.json
```

---

## ══════════════════════════════════════════════════
## PERMANENT RULES — NEVER VIOLATE THESE
## ══════════════════════════════════════════════════

### 1. Media Extensions — config/app.config.js is the SOLE source of truth

**NEVER hardcode extension lists in fileBrowser.js or anywhere else.**
**NEVER reduce or replace these lists. Only append new formats.**

Full lists that must always be preserved:

```js
PHOTO_EXTENSIONS (18 — DO NOT REMOVE ANY):
  '.jpg', '.jpeg', '.png', '.tiff', '.tif',
  '.cr2', '.cr3', '.nef', '.nrw', '.arw',
  '.sr2', '.srf', '.dng', '.raf', '.orf',
  '.rw2', '.pef', '.x3f'

RAW_EXTENSIONS (13 — DO NOT REMOVE ANY):
  '.cr2', '.cr3', '.nef', '.nrw', '.arw',
  '.sr2', '.srf', '.dng', '.raf', '.orf',
  '.rw2', '.pef', '.x3f'

VIDEO_EXTENSIONS (2):
  '.mp4', '.mov'
```

`fileBrowser.js` must always:
- `require('../config/app.config')`
- Build Sets: `new Set(config.PHOTO_EXTENSIONS)` etc.
- Use `path.extname(filename).toLowerCase()` for matching

### 2. Security model — never weaken

```
contextIsolation: true
nodeIntegration: false
sandbox: true
```

All Node/Electron access goes through `preload.js` → `contextBridge`.
Renderer has zero direct Node access. Keep it that way.

### 3. File copy logic — never change the core rules

- File not at dest → copy
- File exists, same size → skip (exact duplicate)
- File exists, different size → rename with `_1`, `_2` suffix
- `copied` counter increments ONLY after `fs.promises.copyFile` resolves
- Return summary ONLY after the entire loop completes
- Each file wrapped in try/catch; errors continue the loop

### 4. macOS junk files — always filter in fileBrowser.js

```js
filename.startsWith('._')   // Apple Double resource forks
filename === '.DS_Store'    // macOS folder metadata
```

These must never appear in the UI, be selectable, or be imported.

---

## Architecture

### IPC Channels

| Channel | Direction | Purpose |
|---|---|---|
| `drives:get` | invoke | On-demand drive list |
| `drives:updated` | push | Polled every 5s |
| `files:get` | invoke | Read directory |
| `files:import` | invoke | Copy files |
| `import:progress` | push | Per-file progress |
| `dest:getDefault` | invoke | ~/Desktop/AutoIngestTest |
| `dest:choose` | invoke | Native folder picker |
| `dest:scanFiles` | invoke | Scan dest for duplicate detection |

### window.api (contextBridge)

```js
getDrives()
onDrivesUpdated(cb)
getFiles(drivePath, folderPath)
importFiles(filePaths, destination)
onImportProgress(cb)
getDefaultDest()
chooseDest()
scanDest(destPath)
```

### Drive Detection

- Uses `drivelist` npm package (dependency, not devDependency)
- Polls every 5 seconds
- Filters by presence of DCIM folder at mountpoint root
- Returns `{ label, mountpoint }`

### Default Import Destination

`~/Desktop/AutoIngestTest` — `path.join(os.homedir(), 'Desktop', 'AutoIngestTest')`
Not persisted yet (stored in memory only).

---

## UI Architecture

### Theme
Catppuccin Mocha dark theme. CSS variables in `:root`:
`--bg`, `--surface`, `--surface2`, `--surface3`, `--border`, `--text`, `--subtext`,
`--blue`, `--blue-dim`, `--green`, `--green-dim`, `--yellow`, `--mauve`, `--red`, `--peach`

### Layout
4-step rail: Select Card → Browse → Select Files → Import
- Step 1: full-screen drive picker panel
- Steps 2-4: two-panel workspace (210px folder sidebar + file panel)
- Import footer: destination path + Change Location + Import Selected

### File Panel
- Toolbar: sort buttons (Date/Name/Size) + view toggle (Icons/List)
- Selection bar: Select All, Clear, live counter "N selected"
- File area: grouped sections (RAW Files / Image Files / Video Files)
- Each section: sticky header + per-group "Select All TYPE" button

### Performance Rules (do not regress)
- `tileMap: Map<path, HTMLElement>` — built once per render, used for O(1) tile updates
- Event delegation: ALL tile clicks handled by ONE listener on `#fileGrid`
- `renderFileArea()` called ONLY on: folder change, sort change, view change, initial load
- NEVER called on: scroll, selection toggle, dest change, post-import
- Dest change / post-import → `syncImportedBadges()` (class sync only, no DOM rebuild)
- `loading="lazy" decoding="async"` on all `<img>` thumbnails
- `contain: layout style` on `.file-tile` for paint isolation
- `will-change: scroll-position` on `#fileGrid`

### Selection System
- `selectedFiles: Set<absolutePath>` — single source of truth
- `toggleFile()` / `syncOneTile()` — O(1) via tileMap, no DOM scan
- `syncAllTiles()` — iterates tileMap, no querySelectorAll
- Shift-click range: `getRenderedPathOrder()` → compute range, bulk add
- Cmd/Ctrl+A: select all files in `currentFiles`
- Per-group select: delegated from `#fileGrid` click on `.sel-group-btn`

### Already-Imported Indicators
- `destFileCache: Map<lowercaseName, size>` — single scan, O(1) lookups
- Match rule: same filename (case-insensitive) + same byte size
- Visual: `.already-imported` (dashed green border, 55% opacity)
- Badge: `.dup-overlay-badge` (yellow pill spanning top of tile)
- Cache rebuilt on: folder browse, dest change, post-import

---

## Features Implemented

- [x] Memory card detection (DCIM-based)
- [x] Drive polling every 5s
- [x] Folder browser with sidebar
- [x] File grid with grouped sections (RAW / Images / Video)
- [x] Icon view (grid with thumbnails)
- [x] List view (table with columns)
- [x] Real thumbnails for JPEG/PNG via `file://` URLs
- [x] SVG icons for RAW (chip icon with ext label), Video, generic photo
- [x] Sort by Date / Name / Size (within each group)
- [x] Select All / Clear / per-group Select All / Shift-click range / Cmd+A
- [x] Live selection counter
- [x] "Already Imported" detection + visual badge
- [x] Pre-import duplicate warning modal (Skip / Import Anyway / Cancel)
- [x] File copy with accurate counters (copied/skipped/errors)
- [x] Conflict renaming (_1, _2 suffix)
- [x] Progress modal with per-file status
- [x] Import summary with skip reasons
- [x] Destination folder picker (native dialog)
- [x] macOS junk file filtering (._* and .DS_Store)
- [x] Performance-optimised rendering (tileMap, event delegation, no scroll triggers)

---

## Features NOT Yet Implemented (planned)

### Metadata Tagging
- Write EXIF metadata after import (background queue)
- Fields: photographer name, event description, tags, Hijri date, copyright
- Videos excluded from tagging
- Resume on relaunch if app closed mid-tag
- Progress saved to `data/` folder

### Event / Archive System (from system document)
- Master Folder (collection) → Event Folder → Photographer Folder structure
- Event creation UI: Hijri date, event types, location, city
- Auto-generated folder names with sequence numbers (_01, _02...)
- Photographer folder with VIDEO subfolder

### NAS Sync
- Detect NAS via predefined path + validation file
- Scan local archive for unsynced events (`.synced = false` marker)
- Prompt: "Unsynced events found. Sync now?"
- Sync logic: copy missing events/photographers/files, skip exact duplicates, rename conflicts
- Mark event as synced after successful sync
- Offline mode: full local workflow when NAS unavailable

### Persistence
- Remember last destination path across sessions
- Store in `data/` using JSON file or electron-store

### Multi-User Handling
- Warning when same photographer already being processed by another handler
- All operations additive, no overwrites

---

## Development Notes

- Run: `npm start` (uses `electron .`)
- Main entry: `main/main.js`
- No build step required — pure vanilla JS + HTML + CSS
- Electron version: ^30.0.0
- Node dependency: `drivelist` ^9.2.4 (in `dependencies`, not `devDependencies`)
- CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' file:;`

---

## System Document Summary

The full system design is in `Final_Detailed_System_Document.pdf`. Key principles:
- No overwriting of files (ever)
- Strict folder hierarchy (3 levels: Collection → Event → Photographer)
- Background processing for performance
- Sync is always safe and additive
- System enforces discipline instead of relying on users
