# AI-FEAT-061 — Quick Ingest & Desktop Companion (Menu Bar / System Tray)

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-061 |
| Category | Application Platform |
| Status | In active development |
| Maturity | Experimental |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-001 (Electron Application Shell & Security Model), AI-FEAT-005 (Application Settings & Configuration Store), AI-FEAT-019 (Import Pipeline & Copy Engine — reused, never duplicated), AI-FEAT-020 (Duplicate Detection — import index reused as indicative evidence only), AI-FEAT-025 (Checksum-Based File Verification), AI-FEAT-042 (Archive Root Configuration & Resolution), AI-FEAT-058 (Multi-Event Import — existing workspace the companion hands off to) |
| Related roadmap milestone | AI-RM-014 |
| Related technical docs | `docs/CLAUDE.md` (security model, file-copy rules), `docs/ingestion-flow.md`, `docs/multi-event-import.md`, `docs/archive-operations-layer.md`, `docs/commandLayer.md`, `docs/mxControlTransport.md` — none yet describe the companion, because nothing is implemented |
| Evidence status | Confirmed zero implementation (2026-10-27 audit of `origin/stable/0.9` @ `0eb9c43`): no `Tray`, `Notification`, `setLoginItemSettings`, `requestSingleInstanceLock`, `powerMonitor` or `app.dock` usage anywhere under `main/`, `services/`, `renderer/`. Architecture below is a **proposal awaiting owner approval**, not a description of shipped behavior. |
| First-known implementation | 2026-10-27 — Q1 foundation on `feature/menu-bar-companion-q1` @ `dd9493f` (not merged; owner review pending) |
| Latest major update | 2026-10-28 — Q1 foundation implemented and verified on its feature branch |

## Lifecycle Metadata

| Field | Value |
|---|---|
| Related features | AI-FEAT-062 (Backup Intelligence Foundation — later improves the confidence of what the companion displays; the companion must work without it) |
| Related decisions | [DEC-027](../decisions/DEC-027_QUICK_INGEST_PRIORITY_AND_MAIN_WINDOW_UI_FREEZE.md) |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | None yet — will qualify once the app gains an app-lifetime (not window-lifetime) source monitor |
| Related release notes | Not applicable — not released |
| Testing coverage | On `feature/menu-bar-companion-q1` @ `dd9493f`: `test/companionQ1.test.js` (unit), `test/companionQ1UiFreeze.test.js` (static UI-freeze guard), `test/companionQ1Live.test.js` (live Electron), `test/companionPopupLifecycle.bench.js`, `test/mainWindowVisualRegression.live.js`. Runtime reference on that branch: `docs/menu-bar-companion.md`. |
| Documentation completeness | Q0 complete; Q1–Q7 sections are plans, not evidence |

## Summary

A small, always-available AutoIngest presence in the macOS menu bar and the Windows system tray. It shows whether a memory card is connected, how many supported media files it holds, what is honestly known about whether those files were imported before, and whether the active archive is reachable — and offers a fast path into the **existing** import workflow. It is a presentation/control layer around existing AutoIngest services. It is not a second import engine, and it does not change the existing main window ([DEC-027](../decisions/DEC-027_QUICK_INGEST_PRIORITY_AND_MAIN_WINDOW_UI_FREEZE.md)).

## Current Behavior

Not implemented. The facts below describe the existing code the companion would build on; they come from the 2026-10-27 audit of `origin/stable/0.9` @ `0eb9c43` (v0.9.16, Electron `^30.0.0`).

| Area | What exists today | Consequence for the companion |
|---|---|---|
| Card / drive detection | `main/driveDetector.js` `listAllDrives()`: one `drivelist.list()` call (4 s timeout) → `dcim` (any mount with a root `DCIM/` folder) and `removable` (macOS: under `/Volumes/`; Windows: positive external bus signal). Records carry `label`, `mountpoint`, `size`, `busType` — **no volume UUID / serial**. | The companion reuses this classifier. A label is not an identity (two cards can both be `EOS_DIGITAL`). |
| Polling ownership | `main/main.js` `startDrivePolling()` polls every 5 s (`POLL_INTERVAL_MS`) and broadcasts `drives:updated` / `drives:allUpdated` to **every** `BrowserWindow`. It is started inside the `splash:complete` handler (i.e. only once the main window exists) and cleared in `window-all-closed`. | Today, no window means no polling. The companion needs app-lifetime polling. That means **moving** ownership of the one poller, not adding a second one. |
| Source scanning | `main/fileBrowser.js` `getDCIMPath()`, `scanMediaRecursive()`, `buildCardFolderTree()`; extensions only from `config/app.config.js` (`PHOTO_/RAW_/VIDEO_EXTENSIONS`). | Media counts must come from these functions so the counts match what the workspace shows. |
| Global import index | `main/main.js`: `importIndex` in `<userData>/importIndex.json`, key = `lowercase(filename) + '_' + size`, capped at 5000 entries (oldest evicted), **per computer**, no content hash. Exposed via `importIndex:get`. | A hit means "a file with this name and size was imported **on this computer**". That is indicative, not proof. A miss does **not** mean "new" (eviction, other computers). |
| Copy verification | `main/fileManager.js` `verifyFile()`: size check always. SHA-256 is gated by `ENABLE_CHECKSUM = false`, so it is **off**. Separately, `checksum:run` (user-triggered) hashes source and destination with SHA-256 for `lastImportedFiles` (in memory, current session only). | "Checksum verified" can only be claimed for files that passed `checksum:run` in the current session. A completed copy alone is "Copy recorded", not "Verified". |
| Archive destination | `_resolveEffectiveArchiveRoot()` stats Main Archive Root + reads `.autoingest/root/archive-root.json`. If Main is unreachable, it returns the Active/NAS root path **without probing it**. `transferImportService` has a write-probe preflight. | The companion needs its own **read-only, time-bounded** reachability probe. It must not write probe files to a NAS just to draw a status line, and it must never infer reachability from cached state. |
| Import workflow entry | `renderer/renderer.js` `selectSource({ type, path, label, driveObj })` is the existing entry point used when an operator picks a card or drive. | This is the natural handoff target for "Open Full Workspace" and "Quick Ingest". |
| External control precedent | `services/mxControlService.js` + `renderer/commandManager.js` (`AutoIngestCommands`, e.g. `event.openChooser`, `import.openConfirmation`) — a narrow, validated, fail-closed control path into the renderer. | It is a precedent for "an outside surface asks the workspace to do a known thing". The companion should follow the same fail-closed discipline. |
| Window lifecycle | `createMainWindow()` (sandboxed, `contextIsolation: true`), `createSplashWindow()`. `activate` recreates the splash only when `BrowserWindow.getAllWindows().length === 0`. `window-all-closed` shuts services down and quits on non-macOS. `before-quit` waits for `mxControlService.shutdown()`. | Any new `BrowserWindow` changes these counts (see Risk R1). |
| Window targeting | At least 7 `main/main.js` sites send import/checksum/archive progress to `BrowserWindow.getAllWindows().find(w => !w.isDestroyed())`, i.e. the **first** window (lines ~1321, 1467, 3495, 3599, 3683, 3778, 3888 at `0eb9c43`). `services/autoUpdater.js` and `services/realtimeOperationsService.js` broadcast to all windows. Several dialogs use `getFocusedWindow()`. | A companion `BrowserWindow` could silently receive progress events meant for the main window. This must be fixed first and without changing behavior (Risk R1). |
| Packaging | `electron-builder`: macOS dmg+zip (x64, arm64), `hardenedRuntime`, ad-hoc signed, not notarized. Windows NSIS x64, `appId com.autoingest.app`. `assets/` is already in `files`. | Tray icons fit the existing `assets/` glob. Windows toast notifications need `app.setAppUserModelId('com.autoingest.app')`. macOS notification behavior under ad-hoc signing has to be tested on hardware. |

## Original Plan / Intent

Recorded 2026-10-27 from the project owner's direction ([DEC-027](../decisions/DEC-027_QUICK_INGEST_PRIORITY_AND_MAIN_WINDOW_UI_FREEZE.md)). The visual inspiration is a third-party menu-bar backup utility's popover, rendered in AutoIngest's own identity.

### Hard constraints

1. **Existing main-window UI is frozen.** Nothing in the main window may change in appearance, layout or behavior: landing page, step rail, Event Creator, card browsing, file grid, grouping, metadata/tag refinement, QMZ, Transfer, Archive Locations/settings, diagnostics/audit/repair, MX mappings. No card widgets, banners, buttons or panels are to be added there. The one proposed non-visual touchpoint (handoff listener, Q4) needs its own explicit approval.
2. **No second copy engine and no parallel metadata pipeline.** Quick Ingest reuses event/photographer selection, routing, copy, duplicate protection, metadata writing, import tracking and existing verification.
3. **No destructive actions.** No automatic source deletion, formatting or cleanup.
4. **Honest status.** "Verified" is never shown on the basis of filename, size or import-index history.
5. **No silent always-running services.** Launch-at-login is off by default. Close and quit semantics stay unchanged unless a compatibility review approves a change.
6. **One poller.** No second drive poller and no duplicate background workers.
7. **Electron security boundary is preserved.** Sandboxed renderer, `contextIsolation`, a dedicated narrow preload, validated IPC, and no raw filesystem paths accepted from the companion renderer.

### Proposed architecture

```
                         ┌────────────────────────── main process ──────────────────────────┐
 drivelist ─► driveDetector.listAllDrives()                                                  │
                         │                                                                    │
                 services/sourceMonitorService.js   (NEW; becomes the ONLY poller owner)      │
                   • app-lifetime 5 s poll (same interval)                                    │
                   • diff → attach/detach events, attachId per mount instance                 │
                   • re-broadcasts the SAME drives:updated / drives:allUpdated payloads       │──► main window (unchanged contract)
                   • powerMonitor resume → immediate poll; suspend → cancel scans             │
                         │                                                                    │
                 services/sourceSummaryService.js   (NEW)                                     │
                   • one bounded, cancellable scan per attached source (concurrency 1)        │
                   • counts via fileBrowser + config/app.config.js extensions only            │
                   • import-index evidence via a read-only accessor (indicative)              │
                         │                                                                    │
                 services/archiveStatusService.js   (NEW, read-only)                          │
                   • _resolveEffectiveArchiveRoot() result + stat/marker read with timeout    │
                   • never writes, never caches a "connected" answer across probes            │
                         │                                                                    │
                 services/companionService.js       (NEW; presentation controller)            │
                   • Tray (menu bar / system tray), popover lifecycle, Notifications          │
                   • CompanionSnapshot v1 builder + capability flags                          │
                   • handoff: focus/create main window → existing selectSource() (Q4)         │
                         │  companion:* IPC (validated, opaque sourceId only)                  │
                         ▼                                                                    │
     main/companionPreload.js (NEW) ─► renderer/companion/{companion.html,.js,.css} (NEW)    │
                                       sandboxed popover window, destroyed when hidden        │
                         └────────────────────────────────────────────────────────────────────┘
```

Everything above is new and lives in new files, apart from these deliberate, reviewable edits to existing code:

| Existing file | Proposed change | Why it is needed | Behavior-preservation argument |
|---|---|---|---|
| `main/main.js` | Replace the `startDrivePolling()` start/stop calls with `sourceMonitorService.start()/stop()` | Polling has to outlive the window | Same interval, same detector, same channel names and payloads. Verified by a broadcast-equivalence test. |
| `main/main.js` | Replace `getAllWindows().find(...)` progress targets with the already-tracked main-window reference (`_mxMainWin` pattern), falling back to the current expression when it is null | Prevents the companion popover receiving the main window's progress (R1) | With only one window, both expressions resolve to the same window. Verified by test before any companion window exists. |
| `main/main.js` | `activate`: count **main/splash** windows instead of all windows | A hidden companion window would block dock-click reopen | Identical when no companion window exists |
| `main/main.js` | Create the companion only when its preference is enabled | Opt-in | When disabled, the app behaves exactly as v0.9.16 does |
| `renderer/renderer.js` + `main/preload.js` | **One** non-visual listener: `onCompanionOpenSource(sourceRef)` → existing `selectSource(...)` (Q4 only, separately approved) | Handoff with context | Adds no DOM, CSS or layout. It refuses (fails closed) while an import is running or a different source holds a selection. |

### Stable companion contract (v1)

The companion renderer only ever receives this snapshot (push via `companion:snapshot`, pull via `companion:getSnapshot`). Each field has an explicit confidence so that the later Backup Intelligence work (AI-FEAT-062) can raise confidence without changing the UI's shape.

```js
CompanionSnapshot = {
  schemaVersion: 1,
  generatedAt,                         // ISO time of THIS snapshot
  capabilities: {                      // false until AI-FEAT-062 genuinely ships each one
    contentIdentity: false, verificationReceipts: false, sourceHistory: false,
  },
  sources: [SourceSummary],            // [] = "No card connected"
  archive: ArchiveStatus,
  importSession: { state: 'idle' | 'workspace-open' | 'importing' | 'unknown' },
}

SourceSummary = {
  sourceId,          // opaque, main-generated per attach instance; the ONLY handle the renderer may send back
  kind: 'camera-card' | 'external-drive',
  label, labelCollision: boolean,      // true when another attached source shares this label
  disambiguator,                       // e.g. capacity + mount name, shown only on collision
  scan: { state: 'pending'|'scanning'|'complete'|'cancelled'|'error', mediaCount, photoCount, rawCount, videoCount },
  evidence: {
    detected:           { count, confidence: 'certain' },
    previouslyImported: { count, basis: 'import-index:name+size:this-computer', confidence: 'indicative' } | null,
    copyRecorded:       null,          // needs per-file archive lookup — not cheap today
    checksumVerified:   null,          // only from this session's checksum:run, or AI-FEAT-062 receipts
  },
}

ArchiveStatus = {
  role: 'main' | 'active' | 'override' | 'none',
  displayName,                          // folder name only, never a full UNC/credential-bearing path
  reachability: 'connected' | 'unreachable' | 'unknown' | 'not-configured',
  probedAt, isMainArchiveRoot: boolean,
}
```

Companion → main requests (each validated in main; unknown fields rejected):

| Channel | Payload | Notes |
|---|---|---|
| `companion:getSnapshot` | none | read-only |
| `companion:openWorkspace` | `{ sourceId? }` | focus or create the main window; with `sourceId`, request handoff (Q4) |
| `companion:quickIngest` | `{ sourceId }` | Phase 1: identical to openWorkspace + handoff (see Quick Ingest below) |
| `companion:setPreferences` | `{ enabled?, launchAtLogin?, keepRunningWhenWindowClosed?, notifyOnCard?, notifyOnImport? }` | booleans only |
| `companion:hide` / `companion:quitApp` | none | Quit goes through the normal `app.quit()` path, so the `before-quit` MX shutdown guard still runs |

`sourceId` is resolved to a mountpoint **only in main**, and only if that source is still attached. A stale or unknown `sourceId` → `{ ok: false, reason: 'source-detached' }`. No path ever crosses from the companion renderer to main.

### Status terminology (binding UI vocabulary)

| Label shown | Shown when | Never shown when |
|---|---|---|
| **Detected** | the source is attached and the scan counted the file as supported media | — |
| **Previously imported** (subtext "matched by name + size on this computer") | import-index hit | presented as proof, or as "Verified" |
| **Not in this computer's import history** | import-index miss | worded as "New" while the evidence is only the capped, per-computer index |
| **Copy recorded** | (future) the archive / event `imports[]` record exists for the file | inferred from the import index |
| **Verification pending** | copy recorded, no hash comparison yet | — |
| **Checksum verified** | SHA-256 source == destination computed by `checksum:run` this session, or a future AI-FEAT-062 receipt | from name, size or history |
| **Archive unavailable** | the time-bounded probe failed or timed out | from a stale cached success |
| **Unknown** | anything not yet determined (scan pending, probe pending, capability absent) | — |

### Popover UI (new surface only)

* **No card**: AutoIngest mark and name · "No card connected" · archive line (role, name, reachability, probed time) · **Open AutoIngest** · Preferences · Quit.
* **One card**: card icon + label (plus disambiguator on collision) · scan state + media count (photo / RAW / video) · evidence lines from the table above · destination block · **Quick Ingest** · **Open Full Workspace** · View History *(omitted until `capabilities.sourceHistory`)* · Close · Quit AutoIngest.
* **Several cards**: compact list, one row per `sourceId`, each with its own status and its own Quick Ingest / Open action.
* macOS: template tray image (monochrome, adapts to light/dark menu bar); left-click toggles the popover anchored under the icon. Windows: tray icon; left-click toggles the popover above the taskbar; right-click shows a native context menu (Open AutoIngest, Preferences, Quit). The native menu doubles as the fallback if the popover fails.
* The popover is a new sandboxed `BrowserWindow` (frameless, fixed ~360 px wide). It is created on open and **destroyed** on blur or hide, so an idle companion holds no renderer process. It has its own stylesheet using AutoIngest's identity tokens, copied rather than imported, so it can never alter main-window CSS. Keyboard navigable, `prefers-reduced-motion` respected.

### Quick Ingest behaviour (phase 1)

1. The operator clicks Quick Ingest on a card row.
2. Main focuses the existing main window, or opens it through the normal splash path if it is closed.
3. Main asks the workspace to open that source through the existing `selectSource(...)`. The current event, photographer and archive context are left as the workspace already holds them.
4. Everything after that is the existing workflow (event/photographer/component resolution, duplicate decisions, copy, metadata, tracking).
5. If the workspace is busy (import running, or another source with a selection), the handoff is **refused**. The companion says "AutoIngest is busy — finish the current import first", and the workspace is left untouched.

A fully independent one-click "import into last event" transaction is **deferred**. It cannot safely resolve event, photographer, component and duplicate decisions without either new main-window UI (frozen) or an unreviewed second pipeline. It needs its own proposal after Q4 proves the handoff.

### Background operation & lifecycle

| Topic | Proposal | Default |
|---|---|---|
| Companion enabled | preference | **off** for the first Preview, enabled by testers; default-on is decided before Stable |
| Window close (macOS) | unchanged: the app stays running (current behavior); the menu-bar item stays | unchanged |
| Window close (Windows) | unchanged: the last window closing quits the app and the tray icon disappears. Opt-in `keepRunningWhenWindowClosed` keeps the process and tray alive | **off** (no behavior change) |
| Quit | the tray/popover "Quit AutoIngest" → `app.quit()` → existing `before-quit` guard → services shut down | — |
| Launch at login | `app.setLoginItemSettings({ openAtLogin })`, starting tray-only (no splash or main window) | **off** |
| Single instance | `app.requestSingleInstanceLock()`; a second launch focuses the existing instance. Today two instances can run and both write `importIndex.json`. **Behavior change → needs explicit compatibility approval in Q1.** | proposed on |
| Sleep / wake | `powerMonitor` `suspend` → cancel scans, mark archive status unknown; `resume` → immediate poll and fresh probe | — |
| Eject during scan | the detach event cancels that source's scan; the row is removed; no notification spam | — |
| Offline NAS | probe timeout (proposed 3 s, constant) → "Archive unavailable"; never blocks the poll loop | — |
| Updates | the tray is destroyed in `before-quit`, so `quitAndInstall` is not blocked; verified in the packaged Preview | — |
| Notifications | Electron `Notification`: card connected (debounced per attach), import complete, actionable failure. Each type can be switched off; none is emitted when the main window is focused and already showing the same thing. Windows needs AUMID `com.autoingest.app`. | card: on / import: on (when companion enabled) |
| Resources | no new poller; scans are bounded and cancellable; the popover is destroyed when hidden. Target: no measurable idle CPU above the existing 5 s poll; idle RSS increase < 30 MB (to be measured, not assumed) | — |

### Risks identified in Q0

| ID | Risk | Mitigation (phase) |
|---|---|---|
| R1 | A companion `BrowserWindow` would be included in `getAllWindows()`. That could misroute import/checksum/archive progress (≥7 sites), block dock-click reopen (`activate`), and suppress `window-all-closed`. | Q1 first lands the behavior-preserving main-window targeting refactor, with tests, **before** any companion window exists. |
| R2 | Moving the poller to app lifetime changes when `drives:*` events are emitted (before the main window exists). | Broadcast-equivalence test. The renderer already tolerates `drives:updated` at any time; this is to be confirmed in the Q1 review. |
| R3 | Single-instance lock is a behavior change. | Explicit approval in Q1. If it is not approved, the companion refuses to start a tray in a second instance. |
| R4 | Card identity: there is no volume UUID or serial in the `drivelist` output. | Q2 investigates read-only UUID retrieval (macOS `diskutil info -plist`, Windows volume serial). Until then: `attachId` per mount instance plus label-collision disambiguation; never key history by label. |
| R5 | Scanning large external drives (not cards) is expensive. | Default: count only DCIM cards automatically. External drives get an on-demand "Count files" action. |
| R6 | macOS ad-hoc signing (no notarization) may affect notification permission prompts and login items. | Physical packaged test on both architectures in Q7. Documented as a known limitation if it cannot be resolved without signing credentials. |
| R7 | Q4's handoff listener is the only main-window code touch. | It needs separate explicit approval. It is non-visual and fails closed. Visual regression proves zero rendering change. |

## Phased implementation plan

Every phase runs in its own dedicated worktree and feature branch cut from the verified `origin/stable/0.9` HEAD (one Claude Code session per worktree), ends with tests and a review, and needs owner approval before the next phase starts. Nothing is merged to `stable/0.9` and nothing is published without explicit approval.

| Phase | Scope | Exit criteria |
|---|---|---|
| **Q0** | Repository audit, architecture, UX specification, test matrix (this record + DEC-027) | Owner approves this plan — **current state** |
| **Q1** | Foundation & lifecycle: R1 window-targeting refactor; `sourceMonitorService` takes over the single poller; `companionService` with Tray (menu bar/tray) + native context menu; preferences (default off); single-instance (if approved); quit/close semantics unchanged | Main-window regression suite green (pixel + functional); broadcast-equivalence test; tray appears/disappears with the preference on macOS and Windows; one poller confirmed |
| **Q2** | Card detection & compact card status: popover window, `sourceSummaryService` scans, label-collision handling, multi-card list, insert/eject mid-scan | Fixture-driven counts equal the workspace's counts for the same source; eject cancels cleanly; no-card / one-card / multi-card states |
| **Q3** | Archive destination & import-index status: `archiveStatusService`, the honest terminology table, previously-imported (indicative) counts | Offline NAS shows "Archive unavailable" within the timeout; no "Verified" label reachable without a hash |
| **Q4** | Launch Quick Ingest & full workspace: focus/create window, handoff to `selectSource` (separately approved), busy refusal | Event/photographer context preserved across handoff; refusal path tested; zero main-window visual diff |
| **Q5** | Native notifications & activity indicators: card / import-complete / failure notifications, tray icon activity state | Debounce verified; AUMID on Windows; macOS packaged behavior recorded |
| **Q6** | Card-aware history entry points & verification hooks: capability-flagged slots wired to the v1 contract; "Checksum verified" from this session's `checksum:run` only | History stays omitted while `sourceHistory` is false; contract unchanged |
| **Q7** | Physical-device E2E, packaging, Preview RC: real cards (read-only), sleep/wake, prolonged run, macOS x64/arm64 + Windows x64 packaged builds | All rows of the test matrix pass → Preview RC. Stable needs packaged physical validation + explicit approval |

## Test matrix

Unit and integration tests follow the existing `test/*.test.js` style. Live Electron tests follow the existing `playwright-core` `_electron.launch` pattern (e.g. `test/multiEventImportUiLive.test.js`) with a temporary `--user-data-dir`, synthetic fixture volumes and temporary archive roots. Physical-device runs are **read-only** until an explicitly approved isolated test import.

| # | Area | Method | Key assertions |
|---|---|---|---|
| 1 | macOS menu-bar presence | live (macOS) + manual packaged | template icon visible in light/dark; click toggles popover; preference off → no tray |
| 2 | Windows tray presence | live (Windows) + manual packaged | icon present; left-click popover, right-click native menu; preference off → no tray |
| 3 | No-card state | live | "No card connected"; Open AutoIngest works with the main window both closed and open |
| 4 | One / multiple cards | unit (monitor diff) + live (fixture mounts) | one row per attach; independent actions per row |
| 5 | Insert/eject during scan | unit with fake fs + live | scan cancelled; row removed; no stale counts; no orphan scan |
| 6 | Label collisions | unit | two `EOS_DIGITAL` sources → `labelCollision` true, distinct `sourceId`s, disambiguator shown |
| 7 | Supported-media counts | unit against `config/app.config.js` | counts equal what the workspace scan reports for the same fixture; junk/hidden files excluded |
| 8 | Previously imported vs verified | unit (snapshot builder) | import-index hit → "Previously imported" (indicative); never `checksumVerified` without a SHA-256 match; miss → "Not in this computer's import history" |
| 9 | Offline archive roots | unit with hanging/failing stat + live with unmounted temp root | "Archive unavailable" within the timeout; poll loop never blocked; no write to the root |
| 10 | Quick Ingest handoff | live | correct source opened through `selectSource`; refusal while importing |
| 11 | Context preservation | live | active event, photographer and archive root identical before and after handoff |
| 12 | Window close/reopen | live per OS | macOS: close keeps the app + menu bar, dock click reopens; Windows: default close quits (unchanged), opt-in keeps the tray |
| 13 | Sleep/wake & restart | manual physical + unit (`powerMonitor` events faked) | fresh poll and probe after resume; preferences survive restart |
| 14 | Notifications | live + manual packaged | debounced per attach; suppressible; correct AUMID on Windows |
| 15 | Prolonged operation | scripted 8 h soak | no RSS growth trend; one poller; no timer leak |
| 16 | Packaged builds | CI RC jobs + manual | macOS x64/arm64 dmg, Windows NSIS; tray assets packaged |
| 17 | **Main-window regression** | Playwright screenshots of every main-window screen at fixed sizes, compared against a baseline captured from `0eb9c43` (pixel diff = 0 allowed regions); full existing `test/` suite; `git diff origin/stable/0.9 -- renderer/index.html renderer/*.css` must be empty; any `renderer/renderer.js` diff limited to the approved Q4 listener | zero unexpected change to main-window UI, CSS, layout, event workflow or operator interactions |

## Evolution / Implementation Journal

- **2026-10-27 — Q0 recorded.** Owner reprioritized Quick Ingest & Desktop Experience to the next active milestone (AI-RM-014). A read-only audit of `origin/stable/0.9` @ `0eb9c43` established the "Current Behavior" table above. Architecture, contract, terminology, lifecycle, risks, phase plan and test matrix proposed. No application code changed. Awaiting owner approval before Q1.

- **2026-10-27/28 — Q1 foundation implemented** (owner-approved scope; branch `feature/menu-bar-companion-q1` @ `dd9493f`, cut from `origin/stable/0.9` @ `0eb9c43`; not merged, no Preview RC).
  - *Window targeting (R1)*: `services/windowRegistry.js`. All 7 `getAllWindows().find(...)` progress sites in `main/main.js` now use `getProgressTarget()`; `activate` counts app windows only. **R1 reproduced live**: with the popup open, the old expression returned the popup (window 3) instead of the main window (window 2). After the fix, `checksum:complete` reached the main window.
  - *One poller (R2)*: `services/sourceMonitorService.js` with named consumers (`main-window`, `companion`); one interval, polls never overlap; `drives:updated`/`drives:allUpdated` contract unchanged. The visual regression run found that the first main-window drive result arrived up to 5 s earlier than on Stable while the companion's interval was already running. Fixed: a new consumer now restarts the interval phase, as the old `splash:complete` code did.
  - *Single instance (R3, approved)*: lock at the top of `main.js`, before module-load side effects. A second launch exits (live: 210 ms, exit code 0) and forwards argv via `additionalData`; the running instance restores and focuses its window. The lock is per profile; a different `--user-data-dir` is not blocked.
  - *Popup lifecycle decision* (owner asked for an A/B comparison; measured by the benchmark): **A, on-demand create/destroy, chosen.** It opens in ~105 ms against ~4 ms for B. While closed, B costs +1 renderer process and +91 MB, and its hidden window stays in `getAllWindows()`, which would stop `window-all-closed` firing and stop Windows quitting when the main window closes — a behaviour change Q1 must not make. B is **rejected** for that reason.
  - *Deviation from Q0*: Q0 proposed the companion **off** by default for the first Preview. Q1 ships it **on** (`settings.getCompanionEnabled()`, opt out with `"companionEnabled": false` or `AUTOINGEST_DISABLE_COMPANION=1`), because no in-app toggle can exist while the main-window UI is frozen. The default before Stable is still an owner decision.
  - *Q4 handoff listener*: architecturally approved, **not implemented** (not needed by Q1).
  - *Verification*: unit 24/24; UI-freeze guard 5/5 (no existing renderer, preload or asset file differs from Stable); live companion test all checks pass. Main-window pixel comparison against a Stable export: splash identical; the remaining differences on the landing and folder-browse screens are confined to the status-bar clock line, plus 5 anti-aliasing pixels with a colour delta of 2/765. Existing unit suites: 54/73 pass under Node; the other 19 need Electron and give results identical to Stable under Electron. Existing live suites: 14 of 14 import, metadata, MX, transfer, QMZ and event-management live suites pass on the Q1 checkout with the companion enabled (multiEventImportUiLive, multiEventImportLive, multiEventLocalFirstUiLive, multiEventNewEventUiLive, multiEventCountSyncUiLive, cardFolderTreeBugfixUiLive, cardFolderTreeBugfixLive, metadataPipelineLive, mxControlTransportLive, mxCommandLayerImportLive, transferImportGeneralPurposeLiveE2E, transferExportConsecutiveExportsLiveE2E, qmzLiveE2E, eventManagementReliabilityLive); the remaining 39 live suites (other QMZ/transfer/tag-refinement variants and packaged-app E2E) were not run. Packaged macOS arm64 `--dir` build: companion files are in `app.asar`, and the packaged app shows its menu-bar item and popup.
  - *Not done in Q1*: Windows hardware run, Windows package, Preview RC. The live tests stub only `drivelist.list()`, because mounting synthetic disk images was not permitted in this environment.

## Engineering Evolution

**Initial implementation**: Not applicable — not yet implemented.

**Architectural / workflow decisions**: [DEC-027](../decisions/DEC-027_QUICK_INGEST_PRIORITY_AND_MAIN_WINDOW_UI_FREEZE.md).

**Reliability / correctness fixes**: None recorded.

**Other dated milestones**: 2026-10-27 — Q0 specification; 2026-10-27/28 — Q1 foundation on its feature branch.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

- [DEC-027](../decisions/DEC-027_QUICK_INGEST_PRIORITY_AND_MAIN_WINDOW_UI_FREEZE.md) — Quick Ingest prioritized; main-window UI frozen; companion built as an isolated presentation/control layer.

## Future Enhancements

- Independent one-click Quick Ingest transaction (deferred — see Quick Ingest behaviour).
- Per-card history, content identity and verification receipts once AI-FEAT-062 provides them (capability-flagged in the v1 contract).
- Default-on companion and launch-at-login decision before Stable promotion.

## Related Files

On `feature/menu-bar-companion-q1` @ `dd9493f` (not yet on `stable/0.9`): `services/windowRegistry.js`, `services/sourceMonitorService.js`, `services/companionModel.js`, `services/companionService.js`, `main/companionPreload.js`, `renderer/companion/companion.{html,css,js}`, `assets/tray/trayTemplate{,@2x}.png`; modified `main/main.js`, `services/settings.js`. Originally expected new files (Q0 plan, kept for history): `services/sourceMonitorService.js`, `services/sourceSummaryService.js`, `services/archiveStatusService.js`, `services/companionService.js`, `main/companionPreload.js`, `renderer/companion/companion.{html,js,css}`, `assets/tray/*`. Existing files expected to change are listed in "Proposed architecture" above.
