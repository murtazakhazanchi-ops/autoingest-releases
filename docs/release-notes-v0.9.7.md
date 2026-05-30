# AutoIngest v0.9.7 — Metadata & Registry Stability Tester Build

Release date: 2026-05-30
Build type: Internal tester build

---

## Fixed

### Metadata — packaged macOS ExifTool binary
- Vendored ExifTool binary is now extracted from `app.asar` via `asarUnpack` so the OS can execute it in packaged builds.
- Users/testers should no longer need to install ExifTool manually.
- Applies to both macOS (exiftool-vendored.pl) and Windows (exiftool-vendored.exe).
- Metadata was previously stuck at 0% on fresh packaged installs without manual ExifTool.

### Metadata — ExifTool BatchCluster lifecycle
- Dead ExifTool BatchCluster instances are now detected and reset before each metadata run.
- If `BatchCluster has ended, cannot enqueue` is thrown, the cluster is recreated and the run is retried once.
- Metadata batch fails fast with a clear error if ExifTool cannot start, instead of silently hanging at 0%.
- Retry Failed and Reapply Metadata now use a live ExifTool cluster.
- Mid-batch cluster deaths reset the instance so subsequent files in the same batch are not affected.

### Online Registry — local-prepared / provisional detection
- Locally prepared provisional collections no longer show "Prepare Locally" in the Online Registry.
- Registry entries whose collection exists in `sessionCollections` with `_linkStatus: provisional` or `stale-link` now correctly show "Needs Archive Match" with a "Match to NAS" action.
- Fixed a bug where `_getRegistryLocalStatus` returned `ready` for provisional collections if the event was found in `coll.events`, bypassing the link status check entirely.
- Same fix applies to collection-type registry entries (not only event entries).
- Publisher / operator name display is preserved.

---

## Included from earlier tester builds (v0.9.5 / v0.9.6)

- Public realtime Server Key authentication.
- Cloudflare Tunnel-compatible realtime endpoint (WebSocket-first transport order).
- Persistent application-level realtime presence heartbeat.
- Settings are now saved on all modal close paths (backdrop click, close button, Test Connection) so the persistent socket connects with current credentials.
- Team Live Online / Idle / Offline device semantics.
- Online Registry cross-device publishing with publisher identity display.
- Publisher identity fallback: `createdByOperator` → `createdByDeviceName` (never UUIDs or origin strings).
- Active Archive Root auto / override behavior (Main Archive Root auto-selection, temporary override, clear override).
- Realtime test socket cleanup (test sockets do not create ghost devices).

---

## Tester Setup

**Server URL:** `https://realtime.ajsphotoarchive.com`
**Server Key:** provided internally (do not share or commit)

---

## Tester Validation Checklist

### Metadata (packaged build only — dev mode is not sufficient)

1. Install the packaged `.dmg` / `.zip` build on macOS.
2. Import a small test batch containing ARW (or other RAW) files.
3. Confirm metadata starts after import — does not stay at 0%.
4. Open Activity Log → Metadata tab.
5. Confirm ARW files produce `.xmp` sidecars next to the destination RAW.
6. Confirm success / partial / failure is reported clearly.
7. If any failures appear, click Retry Failed — confirm it uses a live cluster.
8. Close app, reopen, run Reapply Metadata — confirm no "BatchCluster has ended" errors.
9. Failure mode: if ExifTool truly cannot start, confirm batch fails fast with a clear error rather than hanging at 0%.

### Online Registry

1. On Mac with a locally prepared provisional collection:
   - Open Change Event → Online Registry tab.
   - Confirm the event shows "Needs Archive Match" pill and "Match to NAS" button.
   - Confirm "Prepare Locally" is NOT shown.
2. On a remote event that is not local:
   - Confirm "Prepare Locally" still appears correctly.
3. Publisher display:
   - Confirm operator / device name is shown (e.g., `Event · From Mustafa Dohadwala`).
   - Confirm UUIDs and origin strings (archive-available, remote-created) are not shown.
4. Sequence Folders / Edit buttons:
   - Confirm they are hidden on the Online Registry tab.

### Realtime

1. Open `https://realtime.ajsphotoarchive.com/health` — confirm healthy.
2. Open Settings → enable Team Live & Online Registry → enter Server URL and Key.
3. Click Test Connection → confirm "Connected".
4. Close Settings — confirm persistent connection goes online (not just test socket).
5. Confirm presence stays online while app is open.
6. Confirm test sockets do not create ghost devices in Team Live.

### Archive Locations

1. Main Archive Root available → Active Root auto-uses Main Root.
2. Temporary Active Root override persists after save / reopen / restart.
3. Clear override returns to `Auto: Using Main Archive Root`.
4. Import confirmation shows the correct effective root.

### Import Safety

1. No false completion reported.
2. No silent copy failure.
3. No unrelated file-copy behavior changes.

---

## Known Limitations

- Metadata fix requires a fresh packaged build. Old installed builds do not benefit from `asarUnpack`.
- Cloudflare Tunnel service must remain running on the Windows server PC.
- Windows realtime-server must remain running during tester sessions.
- Realtime server key is a shared internal key, not per-user login. If it leaks, rotate and redistribute.
- Stale registry entries may remain in `realtime-server/data/registry.json` until devices republish or the registry file is cleaned.
- `config/service-account-key.json` remains bundled for trusted internal devices only (Google Sheet auto-reporting).
- Windows app build must be produced on a Windows machine if macOS cross-compile fails due to `drivelist` native module.

---

## Realtime Server Deployment Reminder

If `realtime-server/server.js` changed after the previous release, update the Windows realtime-server folder before tester sessions.

Start the server with:
```
set REALTIME_SERVER_KEY=<private-key>
node .\server.js
```

Cloudflare Tunnel must remain connected.

Public health endpoint: `https://realtime.ajsphotoarchive.com/health`

Do not commit or display the actual server key.

---

## Build Artifacts

| Platform | Format | Notes |
|----------|--------|-------|
| macOS Intel | `.dmg` | x64 |
| macOS Apple Silicon | `.dmg` | arm64 |
| macOS Intel | `.zip` | x64 |
| macOS Apple Silicon | `.zip` | arm64 |
| Windows | `.exe` installer | Must be built on Windows |

---

## Windows Build Instructions

Windows build cannot be cross-compiled from macOS (native `drivelist` module).

On Windows machine:
```
npm.cmd install
npm.cmd run dist:win
```
or:
```
npm.cmd run build:win
```
