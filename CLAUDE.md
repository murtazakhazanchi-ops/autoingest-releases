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
electron-app-v24/
├── config/
│   └── app.config.js        ← SOLE source of truth for media extensions
├── data/                    ← Base controlled-vocabulary lists (committed)
│   ├── event-types.json     ← 14 categories, 222 events, 3-level tree
│   ├── cities.json          ← 628 cities, flat array
│   ├── locations.json       ← 451 locations, tree (some with sub-locations)
│   └── photographers.json   ← 312 names, flat array
├── main/
│   ├── main.js              ← Electron main process, IPC handlers
│   ├── preload.js           ← contextBridge (window.api namespace)
│   ├── driveDetector.js     ← drivelist polling, DCIM detection
│   ├── fileBrowser.js       ← readDirectory(), getDCIMPath()
│   ├── fileManager.js       ← copyFiles(), resolveDestPath()
│   ├── listManager.js       ← load/merge/dedupe base+override lists
│   └── aliasEngine.js       ← normalize, match, learnAlias for dropdowns
├── renderer/
│   ├── index.html           ← All CSS inline, Catppuccin Mocha theme
│   ├── renderer.js          ← All UI logic, no Node/Electron access
│   └── treeAutocomplete.js  ← Reusable tree+autocomplete dropdown class
├── scripts/
│   └── parse-lists.js       ← One-time parser: Downloads → data/*.json
├── services/                ← Metadata tagger, sync engine (future)
└── package.json
```

### userData (runtime, OS app-data dir — never committed)
```
~/Library/Application Support/AutoIngest/
├── importIndex.json
├── cities.override.json       ← user-added cities
├── locations.override.json    ← user-added locations
├── photographers.override.json← user-added photographers
├── cities.aliases.json        ← learned aliases per leaf node
├── locations.aliases.json
├── event-types.aliases.json
└── photographers.aliases.json
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
| `lists:get` | invoke | Load merged list (base + override) |
| `lists:add` | invoke | Add new entry to writable list |
| `lists:match` | invoke | Alias-aware ranked search |
| `lists:learnAlias` | invoke | Store typed→canonical alias |

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
// Controlled vocabulary lists
getLists(name)                           // 'cities'|'locations'|'event-types'|'photographers'
addToList(name, value)                   // cities/locations/photographers only
matchList(name, input)                   // ranked [{id,label,score,matchType}]
learnAlias(name, canonicalId, label, typed) // persist alias after user selection
```

### List Manager Rules (main/listManager.js)
- Base files in `data/` are **never modified** at runtime
- User additions go to `userData/{name}.override.json`
- Merged list = dedupe([...base, ...override])
- `event-types` is **read-only** — no addToList, no override file
- `normalize()` = trim + proper case before saving new entries

### Alias Engine Rules (main/aliasEngine.js)
- Matching is always **flat** (tree structure is UI-only)
- `flattenToLeaves()`: event-types skips category headers; all other nodes are selectable
- Alias storage: `userData/{name}.aliases.json` keyed by `slugify(label)`
- `learnAlias()` is a no-op if typed === canonical label (case-insensitive)
- Score ranking: exact=100, aliasExact=90, startsWith=80, aliasStarts=70, contains=60, aliasContains=50

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
- [x] Controlled-vocabulary data layer (event-types, cities, locations, photographers)
- [x] List manager with base+override merge and runtime persistence
- [x] Alias engine: normalize, match (scored), learnAlias, flattenToLeaves
- [x] TreeAutocomplete dropdown: tree browse + live alias-aware search + Add New
- [x] Two-card landing screen (Select Memory Card / Create Event)
- [x] Event Creator panel shell with back navigation and dynamic step rail

---

## TreeAutocomplete Component (renderer/treeAutocomplete.js)

Reusable dropdown class. Usage:
```js
const dd = new TreeAutocomplete({
  container: document.getElementById('myContainer'),
  type: 'cities',           // 'cities'|'locations'|'event-types'|'photographers'
  placeholder: 'Search…',
  onSelect: ({ id, label }) => { /* ... */ }
});
dd.getValue()              // → { id, label } or null
dd.setValue(id, label)
dd.clear()
dd.setDisabled(true)
dd.destroy()               // removes global listener, removes DOM
```

**Critical rules:**
- NEVER filter locally — always call `window.api.matchList()`
- Only `id` is stored in state; `label` is display-only
- `learnAlias` fires automatically on selection when typed ≠ label
- Add New shown only when no exact match AND type ≠ `event-types`
- Zero-results state shows tree below "No matches" so user can browse+teach alias

## Landing Screen State Machine (renderer/renderer.js)

```
Landing (step1Panel)
  ├─ Click drive card      → selectDrive() → workspace
  └─ Click Create Event →  → showEventCreator() → eventCreatorPanel
                                                    └─ ← Back → showLanding()
```

`railMode` variable: `'card'` | `'event'`
`setRailMode(mode)` swaps step rail labels:
- card:  Select Memory Card / Browse & Select Files / Import
- event: Create Collection / Create Event / Import

---

## Features NOT Yet Implemented (planned)

### Event Creation Flow (IN PROGRESS — next commits)
- **Commit C**: Master (Collection) creation form — Hijri date + label → `{HijriDate} _{Label}`
- **Commit D**: Event creation form — components (EventType + Location + City), live name preview, city-grouping rules
- **Commit E**: Single vs Multi mode + sub-event folder structure preview

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

---

## Stabilization History

### v0.5.1 — Stabilization Phase (2026-04-18)

FIX-ONLY pass, no new features, no architecture changes. 52 targeted patches applied across 3 tiers.

- **Tier 1** (Patches 1–10, 32–37): import pipeline hardening, drive detection, abort path
  - Async `resolveDestPath` with capped rename loop (no more TOCTOU window, no more event-loop stalls)
  - `abortCopy` IPC wired from renderer drive-disconnect to main-process copy loop
  - Atomic `saveImportIndex` via tmp→rename
  - `fileSize` passed through progress events (removed `statSync` from hot path)
  - `drivelist.list()` wrapped in 4s timeout; DCIM checks parallelised
- **Tier 2** (Patches 11–18, 29–31, 42): thumbnail lifecycle, queue cleanup, update sequence
  - Safe stream cleanup in `getFileHash`
  - Cancellable checksum verification
  - Duplicate `inFlight` map in thumbnailer consolidated to `inFlightCache`
  - `recoverStuckThumbs` rate-limited (1.5s cooldown, visibility-gated, 20/pass cap)
  - `outerHTML` thumbnail fallback replaced with `src` swap + `.thumb-error` class (preserves tileMap)
  - Telemetry flushed before `quitAndInstall` with 2s timeout
  - Event-driven pause/resume (no more polling)
- **Tier 3** (Patches 19–28, 38–52): hardening, idempotency, resource cleanup
  - All service `init()` methods idempotent (`_initDone` / `_hooksInstalled` flags)
  - Centralized `_register()` listener tracking in preload + `beforeunload` cleanup
  - Validated argv-based `drive:eject` (`execFile` with array args, card verification)
  - Request-id sender tracking in `files:get`
  - Exponential backoff for auto-update retries (30s→1m→2m→5m→10m→4h)
  - `_lastUpdateState` replay so renderer reloads don't miss update banner
  - `LRUThumbCache.peek()` — no-promote read used in `thumbHtml`
  - Thumbnail cache expiry sweep on first use
  - Observer creation reordered in `renderFileArea` (single combined pass)
  - `perf.clearThumbTimers()` called before OS eject

All naming conventions and archive rules (locked per this document) preserved. See `STABILIZATION_LOG.md` for per-patch status and `STABILIZATION_NOTES.md` for intentionally-deferred items (sync fs usage in pre-event-loop paths, debug handlers).


### v0.7.0-dev — Event Creation Foundation (2026-04-20)

Data layer:
- Four base JSON lists committed to `data/`: event-types (14 categories, 222 events, 3-level tree), cities (628), locations (451, with sub-locations), photographers (312, deduped).
- `scripts/parse-lists.js` — one-time parser from tab-indented source files. Run `node scripts/parse-lists.js` to regenerate from updated source files.
- `main/listManager.js` — load/merge/dedupe base+override, addToList with normalize+properCase, event-types read-only.
- `main/aliasEngine.js` — normalize (punctuation→space, lowercase), slugify, flattenToLeaves, match (6-score ranking), learnAlias (dedup, no-op if same-as-label). Aliases persisted per list in `userData/{name}.aliases.json`.

UI foundation:
- `renderer/treeAutocomplete.js` — TreeAutocomplete class. Tree browse (collapsible 3-level for event-types and locations, flat hint for cities/photographers) + debounced live search via matchList IPC (no local filtering). Zero-results state falls back to tree for alias teaching. Alias badge on alias matches. Breadcrumb path on search results. Add New flow (cities/locations/photographers only). Full keyboard nav (↑↓ Enter Esc).
- Landing screen redesigned as two floating cards centered on background: 📸 Select Memory Card (blue tint, existing import flow) + 🗂️ Create Event (mauve tint, new event flow). Hover: 5px lift + colour glow ring.
- `#eventCreatorPanel` shell added with ← Back nav. Step rail labels are dynamic via `setRailMode('card'|'event')`.
- Smoke-test modal (`#tacTestBtn` floating button, "⌗ Test Dropdowns") for verifying all 4 dropdown types — to be removed in Commit B or later.

IPC additions: `lists:get`, `lists:add`, `lists:match`, `lists:learnAlias`
window.api additions: `getLists`, `addToList`, `matchList`, `learnAlias`

Commits: eb67276 → da5eb70 (7 commits)

### v0.6.0 — Folder View + Scanner Rewrite (2026-04-18)

Major feature release following the v0.5.1 stabilization pass.

Scanner:
- DCIM-only scan logic replaced with scanMediaRecursive: full recursive descent, 50-file batches, sequential subdir recursion, MAX_SCAN_DEPTH=12, realpath-based visited set, expanded skip list.
- New buildFolderTree(files) pure transform derives a nested tree with fields name, path, children, files from the flat scan. O(n) insertion, longest-common-ancestor root, alphabetical sort.
- Sony PRIVATE special-case scan removed -- recursion covers it.

Folder View (new):
- viewModeType state (media or folder) + toolbar toggle.
- Media view (default): flat whole-card file list, sidebar hidden.
- Folder view: sidebar renders full nested tree with expand/collapse chevrons; right side shows leaf-folder files only (intermediate folders show an instruction panel nudging the user to drill deeper). Navigation is sidebar-only; no IPC rescan on folder switch (uses the pre-built tree).
- Selection persists globally across folder navigation and view toggles.
- Back-bar above file grid shows currently-viewed folder path.

UX polish:
- Eject confirmation modal replaces the 4-second toast. Success/failure state, Enter/Escape keyboard. App waits for user OK before returning to drive list.
- Eject button restyled red (var(--red)) to signal its semi-destructive nature.
- Sidebar chevrons enlarged (0.65rem -> 0.85rem), blue-tinted, bold, 18px touch target, hover scale-up.
- Step rail collapsed from 4 steps to 3 (Browse + Select merged into one since the folder-view workflow treats them as one activity).
- Sidebar active-row highlight follows current folder on every navigation.

Commit history: see git log v0.5.1..v0.6.0 --oneline. 14-commit plan executed with live-smoke-test UX corrections patched in as 11b, 11c, 11d, 12b, 12c, 12d.

Preserved from earlier: all naming conventions, archive rules, no-overwrite semantics, v0.5.1 stabilization patches (52 of them across 3 tiers), intentional-sync-fs deferrals documented in STABILIZATION_NOTES.md.

