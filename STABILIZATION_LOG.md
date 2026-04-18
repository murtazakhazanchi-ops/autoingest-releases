# AutoIngest Stabilization Log

**Phase:** FIX-ONLY stabilization pass  
**Started:** 2026-04-18  
**Completed:** 2026-04-18  
**Version at start:** 0.5.0

---

## Tier 1 — Import Pipeline + Drive Detection + Abort Path

| # | File | Summary | Status |
|---|------|---------|--------|
| 1 | `main/fileManager.js` | Async `resolveDestPath` with `fsp.stat`, capped at 9999 | done |
| 2 | `main/fileManager.js` | `processFile` awaits `resolveDestPath` in its own try/catch | done |
| 3 | `main/fileManager.js` | Accounting invariant check before resolve() | done |
| 4 | `main/fileManager.js` | Null-safe `lastError` in retry-exhausted block | done |
| 5 | `main/fileManager.js` | Pass `fileSize` through every progress event | done |
| 6 | `main/main.js` | Remove `statSync` from files:import progress callback | done |
| 7 | `main/main.js` | Atomic async `saveImportIndex` with tmp→rename | done |
| 8 | `main/main.js` | Await `saveImportIndex` in `updateImportIndex` | done |
| 9 | `services/telemetry.js` | Atomic sync rename in `persistQueue` | done |
| 10 | `services/telemetry.js` | Set-based batch removal in `flush` | done |
| 32 | `main/fileManager.js` | Add `abortCopy` + `isAborted` flag | done |
| 33 | `main/main.js` | Register `copy:abort` IPC handler | done |
| 34 | `main/preload.js` | Expose `abortCopy` in `window.api` | done |
| 35 | `renderer/renderer.js` | Call `abortCopy` on drive disconnect | done |
| 36 | `renderer/renderer.js` | Guard `showProgressSummary` after disconnect | done |
| 37 | `main/driveDetector.js` | Async `hasDCIM` + 4s drivelist timeout + parallel checks | done |

---

## Tier 2 — Thumbnail Lifecycle + Abort Cleanup + Update Sequence

| # | File | Summary | Status |
|---|------|---------|--------|
| 11 | `main/fileManager.js` | Safe stream cleanup in `getFileHash` (removeAllListeners + destroy) | done |
| 12 | `main/main.js` + `preload.js` | Cancellable checksum (`checksumCancelled` flag + IPC) | done |
| 13 | `renderer/renderer.js` | Gate `selectDrive` on `isShuttingDown` | done |
| 14 | `renderer/renderer.js` | Immediate `getDrives()` poll after eject | done |
| 15 | `services/thumbnailer.js` | Remove duplicate `inFlight` map, use only `inFlightCache` | done |
| 16 | `renderer/renderer.js` | `recoverStuckThumbs` cooldown (1500ms) + tileMap-based visibility gate | done |
| 17 | `main/main.js` | Filter `dest:scanFiles` to known media extensions | done |
| 18 | `main/fileManager.js` | Event-driven pause/resume (resolvers array, no polling) | done |
| 29 | `renderer/renderer.js` | Remove inline `onerror` from `thumbHtml` + remove `SVG_FALLBACK_ESCAPED` | done |
| 30 | `renderer/renderer.js` | Replace `outerHTML` fallback with `src` + `thumb-error` class swap | done |
| 31 | `renderer/renderer.js` | Delegated `error` listener in `renderFileArea` (capture phase) | done |
| 42 | `services/autoUpdater.js` | Flush telemetry before quitAndInstall; fallback to relaunch+quit | done |

---

## Tier 3 — Hardening

| # | File | Summary | Status |
|---|------|---------|--------|
| 19 | `main/fileManager.js` | Distinguish ENOENT from real errors in `buildDestIndex` | done |
| 20 | `main/fileBrowser.js` | Parallelize stat calls in `scanPrivateFolder` | done |
| 21 | `main/main.js` | Validated argv-based `drive:eject` with `execFile` + card verification | done |
| 22 | `main/main.js` | Request-id sender tracking in `files:get` | done |
| 23 | `services/thumbnailer.js` | Startup sweep of expired cache entries (once, via setImmediate) | done |
| 24 | `renderer/renderer.js` | Skip caching SVG placeholders in renderer LRU | done |
| 25 | `services/autoUpdater.js` | Exponential backoff retry (30s→1m→2m→5m→10m→4h periodic) | done |
| 26 | `services/crashReporter.js` | Exit on truly fatal uncaughtException (non-EACCES/EPERM/EBUSY/ENOENT) | done |
| 27 | `renderer/renderer.js` | Create observer before building tileMap; one combined pass | done |
| 28 | `services/performanceMonitor.js` | `clearThumbTimers()` export; called in `drive:eject` | done |
| 38 | `services/crashReporter.js` | Idempotent `init` (`_hooksInstalled` flag) | done |
| 39 | `services/telemetry.js` | Idempotent `init` (`_initDone` flag) | done |
| 40 | `services/performanceMonitor.js` | Idempotent `init` (`_initDone` flag) | done |
| 41 | `services/autoUpdater.js` | Idempotent `init` (`_initDone` flag) | done |
| 43 | `services/autoUpdater.js` | Track last update state in `_lastUpdateState` | done |
| 44 | `main/main.js` | Expose `update:getLastState` IPC handler | done |
| 45 | `main/preload.js` | Expose `getLastUpdateState` in `window.api` | done |
| 46 | `renderer/renderer.js` | Replay last update state in `initUpdateBanner` IIFE | done |
| 47 | `renderer/renderer.js` | Add `peek()` to `LRUThumbCache` | done |
| 48 | `renderer/renderer.js` | Use `peek` (not `get`) in `thumbHtml` to avoid false LRU promotion | done |
| 49 | `renderer/renderer.js` | Await default-dest in `initApp` (after import index, before drives) | done |
| 50 | `main/preload.js` | Centralized `_register` listener tracking with `beforeunload` cleanup | done |
| 51 | `renderer/renderer.js` | `{ once: true }` on dup-warning buttons and What's New close | done |
| 52 | `services/autoUpdater.js` | Async atomic write in `update-downloaded` handler | done |

---

## Final Summary

All 52 patches applied across:
- `main/fileManager.js` — Patches 1–5, 11, 18, 19, 32
- `main/main.js` — Patches 6–8, 12, 17, 21–22, 28 (perf.clearThumbTimers call), 33, 44
- `main/preload.js` — Patches 12, 34, 45, 50
- `main/driveDetector.js` — Patch 37
- `main/fileBrowser.js` — Patch 20
- `renderer/renderer.js` — Patches 13, 14, 16, 24, 27, 29–31, 35–36, 46–49, 51
- `services/telemetry.js` — Patches 9–10, 39
- `services/thumbnailer.js` — Patches 15, 23
- `services/autoUpdater.js` — Patches 25, 41–43, 52 (also Patch 42 from Tier 2)
- `services/crashReporter.js` — Patches 26, 38
- `services/performanceMonitor.js` — Patches 28, 40
- `renderer/index.html` — Patch 31 (CSS for `.thumb-error`)

See `STABILIZATION_NOTES.md` for out-of-scope findings.

---

*Completed: 2026-04-18*
