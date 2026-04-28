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
│   ├── treeAutocomplete.js  ← Reusable tree+autocomplete dropdown class
│   ├── eventCreator.js      ← Event creation flow (Steps 1–3: Collection → Event → Preview)
│   └── groupManager.js      ← File-to-group assignment state module
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
| `drives:updated` | push | Polled every 5s (DCIM cards only) |
| `drives:allUpdated` | push | Polled every 5s (all removable drives) |
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
| `dir:ensure` | invoke | mkdir -p a path |
| `dir:findByPrefix` | invoke | Find first dir in basePath whose name starts with prefix |
| `dir:rename` | invoke | Rename a directory (oldPath → newPath) |
| `event:appendImports` | invoke | Merge-safe append of audit log entries to event.json |

### window.api (contextBridge)

```js
getDrives()
onDrivesUpdated(cb)          // DCIM cards only
onAllDrivesUpdated(cb)       // all removable drives (for ext-drive list)
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
// Directory helpers
ensureDir(dirPath)                       // mkdir -p
findDirByPrefix(basePath, prefix)        // → { name } | null
renameDir(oldPath, newPath)              // → { ok, reason }
// Audit log
appendImports(eventFolderPath, entries)  // merge-safe append to event.json imports array
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
- [x] Master Collection creation form (Hijri date + label → `{HijriDate} _{Label}`)
- [x] Event creation form — component builder (EventType + Location + City), multi-chip event types
- [x] City-grouping rules in event name preview (Case A/B/C)
- [x] Step 3 preview — Single/Multi mode badge + folder tree (Collection → Event → SubEvent → Photographer → VIDEO)
- [x] Landing card updates to confirmed state after event creation (collection + event name, Change/New Event actions)
- [x] File-to-group assignment — right-click context menu on tiles
- [x] Cmd+G / Ctrl+G group picker modal
- [x] Group panel (right column, 268px) — coloured tabs, sub-event mapping dropdown, file list, Remove button
- [x] Group badges on tiles (icon view: coloured pill; list view: inline badge)
- [x] Auto-remove empty groups; groups only created when files are assigned
- [x] M1: Disk-backed Master creation — archive root picker (persists session), mkdir on Continue, "already exists" modal (Yes/No)
- [x] M1: Select Existing Master — folder picker + accessibility validation, adopts any readable directory
- [x] M1: sessionArchiveRoot persists across resets within a session; Change Location link re-opens picker; activeMaster = { name, path }
- [x] G1: archiveRoot persisted to `userData/settings.json` — auto-migrates on first master creation / change-location. Primed into EventCreator at startup so Location row appears without re-prompting on subsequent launches.
- [x] M2: Select Existing Master picker defaults to `sessionArchiveRoot` (soft nudge; user can still navigate elsewhere). Validation is accessibility-only — no naming or structure checks.
- [x] M3: Event scanner — `master:scanEvents` IPC + `master:chooseExisting` flow lists existing event folders on disk, sorted (hijriDate desc, sequence desc). Unresolved/unparseable folders grouped below with ⚠ badges.
- [x] M4: Event name parser (`main/eventNameParser.js`) — deterministic token classification per locked spec. CITY highest priority; unknown tokens → EVENT_TYPE with `isUnresolved:true`; parse fails ONLY on invalid prefix or no CITY. Pure function, no I/O.
- [x] M5: View-existing mode — clicking an existing event in the list rehydrates components into the Step-2 form (view-only for now; editing unlocks in M6). "Back to list" preserves scan cache; "Viewing Existing Event" badge; view-lock disables every dropdown + chip-remove + Add Component.
- [x] M6: Safe editing of viewed events — "Edit Event" outline button unlocks all dropdowns, chips, Add/Remove Component. "Save Changes →" validates, builds new name (hijriDate + sequence locked), calls `master:renameEvent` IPC (fresh `fs.stat` collision check + `fs.rename`), updates `_scannedEvents` cache, returns to list. Edit-to-same-name = no-op. "Back to list" while editing = silent discard. `_editMode` flag reset on `start()`, `resetSelection()`, `_openExistingEvent()`. Duplicate-content warning modal (non-blocking). `isUnresolved` cleared to false on save.
- [x] M7: New event auto-sequencing — hijri date picker on new-event form (pre-filled from `coll.hijriDate`, editable). `_computeNextSequence(hijriDate)` scans `_scannedEvents` (disk) + `coll.events` (session) for max sequence on that date, returns max+1. Preview and create both use `_newEventDate` + computed sequence. Date required for create; button gated on date validity. `_newEventDate` state reset on `start()`, `resetSelection()`, `_openExistingEvent()`, Back-to-list, Create New Event.
- [x] M8: Context bar (UX clarity) — `#contextBar` below step rail shows breadcrumb (Master › Event) + mode badge ("Event Import" blue / "Quick Import" green). Hidden inside event creator (has own breadcrumb). `_updateContextBar()` in renderer.js called from `_ecPanelOpen`, `showLanding`, `selectDrive`, `resetAppState`, `changeDriveBtn`. Passive, no interaction, no toggles.
- [x] Dashboard rebuild — `#step1Panel` replaced narrow card layout with structured 1100px dashboard: frosted-glass `#dashHeader` (brand / archive+event context / status), `#heroCard` (event state card), `#modeToggleRow` (Event Import | Quick Import segmented control), `#sourceSection` (3 horizontal source cards: Memory Card / External Drive / Local Folder), `#overviewSection` (5 stat tiles), `#dashFooter`.
- [x] Mode toggle — `importMode = 'event' | 'quick'` state; `_applyImportMode()` hides `#srcLocalFolder` in Quick mode. Listener registered once at init.
- [x] No-scroll layout — `#step1Panel` `overflow: hidden`; `.dash-container` `flex: 1; min-height: 0`; `#overviewSection` `margin-top: auto` (pushed to bottom); no scrollable zone on dashboard.
- [x] UI cleanup — removed `#topBar` (title bar), `#stepRail` (step nav bar), TAC smoke-test button/modal; `setStep()` null-guarded; `setRailMode()` simplified to state-only.
- [x] Utility buttons moved to footer — `#helpBtn`, `#bugReportBtn` (formerly floating `position:fixed`) and new `#settingsBtn` placeholder are `.footer-icon-btn` icon buttons in `#dashFooter` bottom-right. All existing JS listeners preserved.
- [x] Frameless window — `frame: false`, `titleBarStyle: 'hiddenInset'`, `trafficLightPosition: { x: 16, y: 8 }`; `#dashHeader` has `-webkit-app-region: drag`; interactive elements have `no-drag`. Window controls (`minimize`, `toggleMaximize`, `close`) exposed via `window.api` and handled by `window:minimize/toggleMaximize/close` IPC.
- [x] Explicit source selection — `activeSource` state `{ type: 'memory-card'|'external-drive'|'local-folder', name, path }`; user must click a device then press Continue — device click never auto-navigates. `_setActiveSource(source)` manages state + targeted hero updates without full innerHTML rebuild.
- [x] Inline device lists — `#deviceSection` entirely removed; memory card devices render inside `.src-card-device-list#srcMemCardList` within the Memory Card source card. `renderDrives()` targets `#srcMemCardList`. Selection persisted across re-renders via `activeSource` path comparison.
- [x] Source label format — hero displays `"EOS_DIGITAL (Memory Card)"` via `_typeLabelFor(type)` helper. `.hero-src-val` + `.hero-src-type` updated atomically via targeted DOM update (no rebuild, transitions animate cleanly).
- [x] Readiness status — `.hero-readiness` transitions between "Select a source to continue" (muted) and "Ready to import" (green) with CSS `color`/`opacity` transitions. Continue button `disabled` until `activeSource !== null`.
- [x] Selection animations — `@keyframes selectPulse` (device item confirmation glow), `deviceAppear` (fade-in + slide-up on list populate), `btnEnablePop` (Continue button scale pop on enable). JS wires `just-selected` / `just-enabled` classes with `animationend` self-cleanup via `{ once: true }`. `just-enabled` fires only on disabled→enabled transition (not on every `_setActiveSource` call).
- [x] Dual-mode home screen — Event Import / Quick Import segmented control (`#modeToggleRow`). `_applyImportMode(mode)` toggles card visibility, hides `#srcLocalFolder` in quick mode, and calls `_renderQuickImportCard()`. `activeSource` is NOT reset on mode switch.
- [x] Card crossfade system — `#heroCard` and `#quickImportCard` share a CSS grid slot (`grid-row: 1; grid-column: 1`). Class `.card-active` toggles `opacity + transform: translateY(6px→0) + visibility`. Transition `0.2s ease` on all three; `visibility: hidden` on inactive prevents interaction bleed during fade. No `setTimeout` needed — pure CSS.
- [x] Quick Import card (`#quickImportCard`) — dest persisted to `localStorage('quickImportDest')`. `_getEffectiveQuickDest()` returns `quickImportDest || sessionArchiveRoot || ''`. `_syncQiImportBtn()` disables "Import Now" unless both `activeSource` and `_getEffectiveQuickDest()` are truthy. On import: `setDestPath(dest)` then `selectDrive()` to navigate source browser.
- [x] External drive inline list — `driveDetector.listAllDrives()` returns `{ dcim, removable }` from a single `drivelist.list()` call. Main process emits `drives:allUpdated` with removable set alongside `drives:updated`. Renderer `renderExtDrives(cards)` filters out `_currentMemCardMountpoints` (DCIM overlap), uses diff-key `_prevExtKeys` to prevent flicker, detects physical disconnects, and falls back drive name via `d.label || d.device || d.mountpoint`.
- [x] Premium segmented toggle — `.mode-seg-group` uses `var(--bg-secondary)` container, `var(--border-subtle)` border, `var(--shadow-soft)`. Active pill: `var(--accent-soft)` fill + `var(--accent-border)` border + `0 2px 6px rgba(0,0,0,0.08)` elevation. Each button has `min-width: 140px` to prevent width jitter on switch. No hardcoded rgba for container — all semantic tokens.
- [x] "Change Event" button upgrade — `#heroSecondaryBtn` restyled as `var(--card-hover)` bg + `var(--border-strong)` border + pencil SVG icon. Hover: `var(--accent-soft)` fill + `var(--accent-border)` border + `var(--text-primary)` text. Active: `scale(0.98)`. All tokens, no hardcoded colors. Clearly secondary to primary Continue button.
- [x] Single-source-of-truth pipeline — `safeNormComps` deleted; all component rehydration flows through `loadEventFromDisk()` → `setEventState()`. `_eventComps` is the only live state; session store injected from live state at import time (`eventData.event.components = liveComps`).
- [x] Component subfolders at creation — `_tryCreateEvent()` (now async) creates one subfolder per component after `writeEventJson` using deterministic naming: `{01}-{TypePart}[-LocationPart][-CityPart]`. City included only when components have different cities. Uses `sanitizeForFolder`, sorted by component id, `Promise.all` with structured `{ ok, path }` results.
- [x] Subfolder sync on edit — `_handleSaveEditedEvent()` syncs component subfolders after `updateEventJson`: index-prefix match via `dir:findByPrefix`, rename if name changed, create via `dir:ensure` if absent. No deletes.
- [x] Import flow fix — import button handler snapshots `liveComps = EventCreator.getEventComps()`, validates early (`liveComps.length === 0` → abort), injects into `eventData.event.components` so all downstream consumers (`showEventImportConfirmModal`, `ImportRouter.buildFileJobs`) use live state.
- [x] Audit logging — append-only per-import log written to `event.json:imports[]` after each successful event import. Entry shape: `{ id, seq, timestamp, photographer, componentIndex, componentName, counts: { photos, videos } }`. ID uses base36 timestamp + random + machine name for cross-user uniqueness. Double-read before write for NAS concurrency safety. Entries deduplicated by `id`. Capped at 5000 entries (oldest trimmed). Validated via `isValidImportEntry`. Sorted by `sortImports` (timestamp desc, seq tiebreaker).

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
Landing (#step1Panel — full-screen dashboard, no scroll)
  ├─ Click device in #srcMemCardList → _setActiveSource() → hero updates, Continue enabled
  ├─ Click source card btn (ExtDrive/LocalFolder) → _setActiveSource() → hero updates
  ├─ Click Continue → selectDrive(activeSource) → workspace
  ├─ Click "Create Event →" (heroCard) → showEventCreator() → eventCreatorPanel (EventCreator.start)
  ├─ Click "Change Event"  (heroCard) → showEventCreatorResume() → eventCreatorPanel (EventCreator.resume)
  └─ Click "New Event →"   (heroCard) → EventCreator.resetSelection() → showEventCreator()
                                      eventCreatorPanel └─ ← Back → showLanding()
                                                               (re-renders hero card via _renderLandingEventCard)
```

`activeSource` variable: `{ type: 'memory-card'|'external-drive'|'local-folder', name, path }` | `null`
`_setActiveSource(source)` — sets state, syncs `.active-source` highlight on source cards, does targeted hero update (no innerHTML rebuild).

`railMode` variable: `'card'` | `'event'`
`setRailMode(mode)` — tracks mode only; `#stepRail` is removed so no DOM writes.

`importMode` variable: `'event'` | `'quick'`
`_applyImportMode(mode)` — toggles `.active` on mode buttons; hides/shows `#srcLocalFolder` (hidden in `'quick'` mode); calls `_switchModeCard(mode)` (CSS class toggle on `#heroCard` / `#quickImportCard`); if `'quick'`, calls `_renderQuickImportCard()` which syncs dest display + `_syncQiImportBtn()`.

`quickImportDest` — `string | null`, persisted in `localStorage('quickImportDest')`. `_getEffectiveQuickDest()` returns `quickImportDest || sessionArchiveRoot || ''`.
`_syncQiImportBtn()` — disables `#qiImportBtn` unless both `activeSource` and `_getEffectiveQuickDest()` are truthy. Called from `_setActiveSource()`, `_applyImportMode('quick')`, and the `#qiChangeDestBtn` handler.

`_currentMemCardMountpoints: Set` — updated in `renderDrives()`, read by `renderExtDrives()` to filter DCIM drives from the ext drive list.
`_prevExtKeys: string | null` — diff key for external drive list; prevents full innerHTML rebuild when the drive set hasn't changed.
`renderExtDrives(cards)` — listener on `drives:allUpdated`; filters DCIM overlap, detects disconnects, diff-renders the `#srcExtDriveList`.

`renderHome()` — called on `showLanding()`, `resetAppState()`, `changeDriveBtn` click:
- Calls `_renderHomeContextBar()`, `_renderLandingEventCard()`, `_renderInsightsBar()`, `_applyImportMode(importMode)`.

`_renderLandingEventCard()` — targets `#heroCard`, called every time `showLanding()` runs:
- No active event → hero with "Create New Event" + primary CTA button wired to `showEventCreator`.
- Active event → hero gains `.has-event` class; shows collection name, event name/select, source row (`hero-src-val` + readiness), "Continue Event →" (disabled until `activeSource`) + "Change Event" buttons.

---

## EventCreator Module (renderer/eventCreator.js)

Module singleton. Steps:
- **Step 1 — Master Collection**: Hijri date (year/month/day segments, auto-advance) + Label → `{Y}-{MM}-{DD} _{Label}`. Existing collections shown as selectable cards. Duplicate detection → auto-select + banner.
- **Step 2 — Event Details**: Global City default + per-component override. Components: EventType chips (multi-select, cleared after pick) + optional Location + required City. City-grouping logic builds event name per spec Cases A/B/C. Live preview.
- **Step 3 — Preview**: Mode badge (Single/Multi-component). Folder tree: Collection → Event → [SubEvent →] (photographer) → VIDEO/. Add Another Event resets Step 2 with global city preserved. Done → showLanding().

Public API:
```js
EventCreator.start()                // enter at step 1, full reset
EventCreator.resume()               // enter at step 3 (Change from landing)
EventCreator.getActiveEventData()   // → { coll, event, idx } | null
EventCreator.getEventComps()        // → deep clone of live _eventComps (source of truth for import handler)
EventCreator.getSubEventNames()     // → { id: string, name: string }[] ([] if single-component)
EventCreator.getSessionCollections()
EventCreator.getSelectedCollection()
EventCreator.setActiveEventIndex(idx)
EventCreator.syncRail()
EventCreator.resetSelection()
EventCreator.restoreLastEvent()     // async, no-arg — full restore from disk via loadEventFromDisk
EventCreator.editSelectedEvent()    // async — reload from disk + enter edit mode
```

**Key rule:** `getSubEventNames()` returns `{id, name}[]` where `id === name` (sub-event folder name). Returns `[]` for single-component events.

**Single source of truth pipeline:** `event.json` on disk → `loadEventFromDisk()` → `setEventState()` → `_eventComps`. All rehydration paths (view, edit, restore, import confirm) use this pipeline. Direct `_eventComps` assignment only inside `setEventState`.

**`sanitizeForFolder(name)`** — filesystem-safe label sanitizer used for component subfolder names. Strips `/ \ : * ? " < > |`, normalises spaces and dashes.

**`folderName` persistence** — each disk-format component carries an optional `folderName: string` field set once at creation and never recomputed. `buildFolderName(comp, idx, allSameCity)` computes the name; `ensureFolderName(diskComp, idx, allSameCity)` sets it if absent. Import routing reads `group.subEventId` (the persisted `folderName`), never calls `buildFolderName` at import time.

**Single-component subfolder rule** — subfolders are created only when `components.length > 1`. Single-component events route files directly into `Collection/Event/Photographer/`. The guard lives in `_tryCreateEvent` (creation) and `_handleSaveEditedEvent` (edit/save sync).

**Legacy event handling** — events without a valid `event.json` show a `LEGACY` amber badge in the event list. Clicking Continue opens `showLegacyEventWarningModal()` (glass modal, SVG icon). Choosing "Edit Event" calls `openEventForEdit(entry, { skipAutoRepair: true })` which opens the editor with a blank component, no disk write. `EventMgmt.setMode('edit')` is called before `_renderEventForm()` to bypass the SELECT-mode guard. Save creates `event.json` for the first time.

**`openEventForEdit(entry, { skipAutoRepair = false } = {})`** — `skipAutoRepair: true` skips `_repairLegacyEvent`, initialises blank `_makeComp()` state, sets `_viewingExisting.isLegacy = true`, transitions EventMgmt to `'edit'` mode. Default `false` keeps existing repair behaviour for explicitly corrupt entries.

**Structure-change warning** — editing a single-component event to add more components, when that event has existing imports, triggers `showStructureChangeWarningModal()` (blocking, glassmorphism). Guard: `_structureWarningPending` flag + `try/finally` reset prevents double-modal. `_legacyModalOpen` flag (same pattern) guards the legacy modal.

**`_renderEventForm` navigation guard** — fires `console.warn` when blocked by SELECT mode, making the class of bug (missing `EventMgmt.setMode` call before navigation) immediately visible in DevTools.

---

## GroupManager Module (renderer/groupManager.js)

Module singleton. Manages file-to-group assignments during the import session.

```js
// Group shape: { id: number, label: string, colorIdx: number,
//               files: Set<string>,   ← file paths (IDs in this app)
//               subEventId: string | null }

GroupManager.createGroup()                    // → groupId; only call when files will be assigned immediately
GroupManager.removeGroup(id)
GroupManager.assignFiles(paths, groupId)      // auto-removes source group if it empties
GroupManager.unassignFiles(paths)             // auto-removes group if it empties
GroupManager.getGroupForFile(path)            // → group | null
GroupManager.setSubEvent(groupId, subEventId) // subEventId = string (folder name) or ''
GroupManager.getColor(colorIdx)               // → { bg, fg } CSS var strings
GroupManager.getActiveTabId() / setActiveTabId(id)
GroupManager.reset()                          // called on: drive change, eject, showEventCreator, showEventCreatorResume, event select
GroupManager.hasGroups()
GroupManager.getGroups()
GroupManager.getUnassignedFiles(allPaths)     // → paths not in any group
GroupManager.hasMissingSubEvents()            // → true if any group lacks subEventId
GroupManager.getDuplicateSubEvents()          // → subEventId[] used by >1 group
```

**Critical rules:**
- Groups are NEVER created empty — only via context menu or Cmd+G when files are selected
- `unassignFiles` auto-removes groups that reach 0 files
- `GroupManager.reset()` must be called whenever the active event changes (sub-event IDs become stale)
- `subEventId` stores the sub-event folder name (string), not an array index

---

## Features NOT Yet Implemented (planned)

### Event Import Flow (Commit G — COMPLETE)
- [x] Pre-import validation: all groups must have sub-event assigned (blocks import) — `showMissingSubEventModal()` in renderer.js
- [x] Unassigned files warning → Continue / Cancel (non-blocking)
- [x] Duplicate sub-event mapping warning → Continue / Cancel — `showDupSubEventModal()` in renderer.js
- [x] Final confirmation screen: Photographer autocomplete + group→sub-event mapping — `showEventImportConfirmModal()` in renderer.js
- [x] File routing: grouped → `Collection/Event/SubEvent/Photographer/[VIDEO/]`; single → `Collection/Event/Photographer/` — `ImportRouter.buildFileJobs()` in `renderer/importRouter.js`
- [x] Unassigned files never imported — enforced in ImportRouter

### Import Routing + Legacy Event Hardening (session 2026-04-28 — COMPLETE)

- [x] `folderName` persisted on disk-format components at creation — never recomputed at import time
- [x] Single-component subfolder guard — `if (compsForDisk.length > 1)` in `_tryCreateEvent` + `_handleSaveEditedEvent`
- [x] `ImportRouter._buildDestBase` defensive assertion — logs error if single-component group arrives with `subEventId` set
- [x] `importRouter.js` confirmed clean — `buildFolderName` absent, routing uses `group.subEventId` throughout
- [x] `_buildSubEventFolderNames` prefers `comp.folderName` over recomputation for legacy-safe modal dropdown
- [x] Structure-change warning modal (`showStructureChangeWarningModal`) — blocks save when single→multi component change + existing imports; `_structureWarningPending` + `try/finally` guard
- [x] LEGACY badge (`ec-evl-badge--legacy`) in event list — amber pill, all CSS tokens, no hardcoded colours
- [x] `showLegacyEventWarningModal` — glass modal, SVG warning icon, "Edit Event" / "Cancel", Enter/Escape keyboard
- [x] `adoptSelectedEvent` — legacy detection moved above corrupt/reload guard; three states cleanly separated: legacy (modal) → corrupt (reload) → unexpected-post-check (silent error)
- [x] `openEventForEdit({ skipAutoRepair: true })` — no `_repairLegacyEvent` call, blank editor, `EventMgmt.setMode('edit')` before `_renderEventForm` to bypass SELECT guard
- [x] `_legacyModalOpen` double-click guard + `try/finally` reset
- [x] `_renderEventForm` SELECT-mode block now logs `console.warn` instead of silently returning

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


### v0.7.2-dev — Home Screen Import Flow + UI Polish (2026-04-24)

Uncommitted changes on top of `7f93af7`. Pure renderer + window-config changes; no import logic or data layer touched.

**Frameless window (`main/main.js`, `main/preload.js`):**
- Window size bumped to 1280×820, `frame: false`, `titleBarStyle: 'hiddenInset'`, `trafficLightPosition: { x: 16, y: 8 }`.
- `window:minimize / window:toggleMaximize / window:close` IPC handlers added.
- `window.api.minimize / toggleMaximize / close` exposed via preload.

**Layout fixes (`renderer/index.html`):**
- `.dash-container` expanded to `max-width: 1680px; padding: 0 32px` (was 1100px — caused empty space on wide displays).
- `#sourceGrid` uses `repeat(auto-fit, minmax(320px, 1fr))` (was fixed 3-column).
- `#heroCard` max-width 1150px, centred with `margin: var(--space-3) auto 0`.
- Body background: `radial-gradient(ellipse at 50% 28%, rgba(137,180,250,0.055)…)` for subtle depth.

**`#deviceSection` removed:**
- Entire `#deviceSection` / `#driveListLarge` removed from HTML and CSS.
- Memory card devices now render inside `.src-card-device-list#srcMemCardList` inside the Memory Card source card (`#srcMemCard`).
- `#overviewSection { margin-top: auto }` pushes stats + footer to bottom of flex column, preserving no-scroll layout.

**Source selection flow (`renderer/renderer.js`):**
- `activeSource` state: `{ type: 'memory-card'|'external-drive'|'local-folder', name, path }` or `null`.
- `_setActiveSource(source)` — updates state, syncs `.active-source` class on source cards, does targeted hero updates (no `innerHTML` rebuild; allows CSS transitions to fire).
- `_typeLabelFor(type)` — returns `'Memory Card'` / `'External Drive'` / `'Local Folder'`.
- `renderDrives(cards)` rewrote to target `#srcMemCardList`; re-applies `.selected` from `activeSource` on re-render without changing state. Two-line empty state. Stale `#driveListLarge` catch handler redirected.
- `selectExternalDrive()` / `selectLocalFolder()` now call `_setActiveSource()` instead of `selectDrive()`.
- `_updateMemCardBadge()` — stale `#deviceCountLabel` reference removed.
- `activeSource = null` on `resetAppState()` and `changeDriveBtn` handler.

**Readiness + button state:**
- Hero has-event branch shows source value as `"NAME (Type)"` + `.hero-readiness` text.
- Continue button `disabled` until `activeSource !== null`; transitions via `opacity` + `transform`.
- On device click: device item gets `.just-selected` (triggers `selectPulse` keyframe), removed on `animationend`.
- On button enable (disabled→enabled only): gets `.just-enabled` (triggers `btnEnablePop` keyframe), removed on `animationend`.

**CSS additions:**
- `@keyframes selectPulse` — glow pulse on device item selection (0.28s).
- `@keyframes deviceAppear` — fade-in + `translateY(4px→0)` for new items (0.2s).
- `@keyframes btnEnablePop` — subtle scale pop on Continue enable (0.22s).
- `.src-device-item.just-selected`, `.hero-btn-primary.just-enabled` — single-fire animation classes.
- `.hero-btn-primary:disabled { opacity: 0.5 }` (was 0.35).
- Scrollbar polish on device list: `scrollbar-width: thin`, 4px thumb.

---

### v0.7.3-dev — Theme System, activeDrive Fix + UI Polish (2026-04-26)

Pure `renderer/index.html` + `renderer/renderer.js` changes. No import logic, IPC, or data layer touched.

**Token system (`renderer/index.html` — `:root` and `[data-theme="light"]`):**
- Full two-layer theme: `:root` dark defaults, `[data-theme="light"]` light overrides.
- Glass surface hierarchy unified: `--glass-header/hero/card/tile` at progressive opacity (0.55/0.50/0.42/0.35) over `rgba(30,30,46,…)` base.
- Accent states differentiated: `--accent-hover: color-mix(in srgb, var(--accent) 20%, transparent)` (hover), `--accent-soft: 35%` (active/selected). Clear 20 vs 35% gap.
- Border tokens: `--border-subtle: color-mix(in srgb, white 10%, transparent)`, `--border-strong: 18%`. Light overrides: `rgba(0,0,0,0.08/0.16)`.
- `--divider-color` scoped to header separators only. No raw `rgba(255,255,255,…)` in component rules.
- All dashboard-layer elements (`.src-card-h`, `.drive-card-large`, `.ov-tile`, `#heroCard`, `#dashHeader`) converted from inline `rgba` borders to `var(--border-subtle)`.
- `[data-theme="light"]` structural overrides completed for all 6 surface elements.

**activeDrive architectural fix (`renderer/renderer.js`):**
- Verified all 6 plan changes already in place from prior session.
- `activeDrive` is null for `local-folder` sources; set for `memory-card` and `external-drive` (eject support).
- Disconnect guard in `renderDrives()`: `if (activeDrive && activeSource?.type === 'memory-card')` — local folder and external drive paths never trigger `resetAppState()`.
- All workspace guards use `activeSource` as the sentinel (`updateSteps`, `_updateContextBar`, folder nav, import callbacks). No false-disconnect resets for non-memory-card sources.

**Header alignment (`renderer/index.html`):**
- `.header-wrapper` horizontal padding set to `32px` to match `.dash-container` (was `12px`, causing 20px drift per side).
- `margin-top: 12px` added to `.header-wrapper` for breathing room below macOS traffic lights.
- `#dashHeader` given explicit `width: 100%; box-sizing: border-box`.
- `#sourceSection` and `#overviewSection` given explicit `width: 100%`.

**System Status icon layout (`renderer/index.html`):**
- Status block restructured from flex-column + inline-flex row to a 2-column CSS grid.
- Grid: `grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 8px; row-gap: 2px; align-items: center`.
- `.status-icon-wrap { grid-row: 1 / span 2 }` — icon vertically centered across both the label row and value row.
- Label (`SYSTEM STATUS`) and `.status-value` (`● Ready`) are direct grid children in column 2, rows 1 and 2.
- Heartbeat polyline SVG added (was missing entirely from HTML — only text label existed before).
- All `position: relative; top: …` offset hacks removed.

**Section spacing (`renderer/index.html`):**
- `#overviewSection` `margin-top` changed from `auto` (greedy flex spacer → pushed overview to window bottom) to `48px` (consistent fixed gap).

---

### v0.7.1-dev — Dashboard Rebuild + UI Cleanup (2026-04-23)

HEAD: `ba4c4a6`  Committed on top of af9d91a (smart defaulting). Commit G (import routing) is next.

**Dashboard rebuild (`renderer/index.html`, `renderer/renderer.js`):**
- `#step1Panel` replaced with structured 1100px dashboard (7 sections: header / hero / mode toggle / source / device / overview / footer).
- Frosted-glass `#dashHeader`: brand left, archive+event context centre, status right.
- `#heroCard`: single card that switches between no-event (Create Event CTA) and has-event (Continue + Change) states via `_renderLandingEventCard()`.
- `#modeToggleRow`: segmented control (Event Import | Quick Import). `importMode` state drives `_applyImportMode()`.
- `#sourceSection`: 3 horizontal source cards. Local Folder hidden in Quick mode.
- `#deviceSection`: wraps existing `renderDrives()` / `#driveListLarge` unchanged. `flex: 1` — grows to fill space.
- `#overviewSection`: 5 compact stat tiles.
- `#dashFooter`: version left + `.footer-icon-btn` group right (Help, Bug Report, Settings).

**No-scroll enforcement:**
- `#step1Panel` `overflow: hidden`, `.dash-container` `flex: 1; min-height: 0`, `#deviceSection` `flex: 1`, `#driveListLarge` `flex: 1; overflow-y: auto`.

**Removals:**
- `#topBar` (title bar + old help button) — HTML + CSS gone.
- `#stepRail` — HTML + CSS gone. `setStep()` null-guarded. `setRailMode()` state-only.
- TAC smoke-test panel (`#tacTestBtn`, `#tacTestOverlay`, `#tacTestModal`) — HTML + CSS gone. IIFE null-guard still present.
- Footer tagline "Built with ♥ for Safar Coverage" — removed.

**Moves:**
- `#helpBtn` → `#dashFooter` `.footer-icon-btn` (same id, JS listener unchanged).
- `#bugReportBtn` → `#dashFooter` `.footer-icon-btn` (was `position:fixed`; JS listener null-guarded so no change needed).

---

### v0.7.0-dev — Event Creation + Grouping (2026-04-20)

HEAD: `cecda35`  Commits A–F + patches complete. Commit G (import routing) is next.

**Data layer (earlier commits):**
- Four base JSON lists: `data/event-types.json` (14 categories, 222 events), `cities.json` (628), `locations.json` (451), `photographers.json` (312).
- `main/listManager.js` — load/merge/dedupe base+override, addToList, event-types read-only.
- `main/aliasEngine.js` — normalize, slugify, flattenToLeaves, match (6-score), learnAlias. Aliases in `userData/{name}.aliases.json`.
- IPC: `lists:get`, `lists:add`, `lists:match`, `lists:learnAlias`

**Commit A — TreeAutocomplete:**
- `renderer/treeAutocomplete.js` — tree browse + debounced alias-aware search + Add New + full keyboard nav.

**Commit B — Landing screen:**
- Two-card layout: Select Memory Card + Create Event. `#eventCreatorPanel` shell. Dynamic step rail via `setRailMode`.

**Commit C — Master Collection (Step 1):**
- `renderer/eventCreator.js` introduced. Hijri date segments + label → `{Y}-{MM}-{DD} _{Label}`. Existing collections selectable.

**Commit D + patch — Event Details (Step 2):**
- Component builder: multi-chip EventType + Location + City. Global city default. City-grouping rules (Cases A/B/C). Live event name preview.

**Commit E — Preview (Step 3):**
- Single/Multi mode badge. Folder tree. Add Another / Done. Landing card updates to confirmed state on return (`_renderLandingEventCard`).

**Commit F + patch — Grouping:**
- `renderer/groupManager.js` — group state module (files Set, subEventId string, auto-remove empty).
- Right-click context menu on tiles → assign/create group/unassign.
- Cmd+G / Ctrl+G modal → group picker.
- Group panel (#groupPanel, 268px right column) — coloured tabs, sub-event mapping dropdown (multi-component events only), file list, Remove button.
- Group badges on tiles (icon: coloured pill; list: inline badge).
- `EventCreator.getSubEventNames()` returns `{id, name}[]`.
- Reset: `GroupManager.reset()` on drive change, eject, showEventCreator, showEventCreatorResume, event select.

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

