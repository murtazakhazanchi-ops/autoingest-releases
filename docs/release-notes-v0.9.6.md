# AutoIngest v0.9.6 — Realtime Presence Stability Tester Build

**Release date:** 2026-05-29
**Type:** Tester build
**Base:** v0.9.5

v0.9.6 is cumulative and includes all fixes from v0.9.3 through v0.9.5.

---

## What's New in v0.9.6

### Realtime — application-level presence heartbeat

Team Live presence now reflects whether the AutoIngest app is open and connected — not whether the Activity Log / Team Live modal is open.

**Root cause fixed:** `device:activity` was only emitted during import and sync operations. A device that was open and connected but not actively importing would stop emitting after its last import, causing remote devices to show it as Idle after 2 minutes — even if the app was in active use. The only way to appear consistently Online was to keep the Team Live modal open (a coincidental correlation with snapshot hydration timing, not an actual cause).

**Fix:** A lightweight 45-second presence heartbeat now runs in `realtimeOperationsService` from the moment the socket connects until it disconnects. On connect, `device:activity` is emitted immediately (populating the server's `_deviceActivity` map so this device appears in snapshots sent to devices that connect later), then every 45 s thereafter.

**Online / Idle / Offline semantics:**

| Condition | Status shown on remote devices |
|---|---|
| App open, realtime connected | **Online** — heartbeat refreshes every 45 s |
| App open, actively importing or syncing | **Importing / Syncing** — real progress callbacks (every 1 s) dominate the heartbeat |
| App closed / network lost / server disconnect | Removed from presence / **Offline** |

The heartbeat is cleared on disconnect and on auth-failed so it does not persist across reconnect cycles.

---

## Commits in v0.9.6

| Hash | Description |
|------|-------------|
| `bad5a06` | fix(realtime): keep device presence active outside team live modal |

---

## Included from v0.9.5

- Connected-but-inactive devices show **Idle** instead of **Offline** in both Team Activity and Devices tabs.
- Snapshot hydration timestamps devices at receipt time.

## Included from v0.9.4

- Active Archive Root auto-resolves from Main Archive Root.
- Temporary Active Root override persists after save/restart.
- Test Connection sockets disconnect cleanly.
- Unidentified sockets do not affect device count.
- `pingTimeout` raised for Cloudflare Tunnel stability.

## Included from v0.9.3

- Online Registry cross-device event publishing.
- Online Registry local-prepared detection (Needs Archive Match / Match to NAS).
- Online Registry publisher identity (operator name; no raw UUIDs).
- Server Key authentication for public Cloudflare endpoint.

---

## Tester Instructions

1. Install AutoIngest v0.9.6 (`.dmg` matching your Mac — Intel or arm64).
2. Open **Settings** (gear icon).
3. Enable **Team Live & Online Registry**.
4. Enter:
   - **Server URL:** `https://realtime.ajsphotoarchive.com`
   - **Server Key:** provided internally
5. Click **Test Connection** → expected: **Connected**
6. Open **Activity Log → Team Live**.
7. Confirm devices remain **Online** while the app is open, even when Activity Log is closed.
8. Open **Change Event → Online Registry** to view live events from other devices.

---

## Manual Validation Checklist

### Realtime presence

1. **Public health:** `https://realtime.ajsphotoarchive.com/health` returns `{"status":"ok",...}`.
2. Open Mac and Windows AutoIngest — confirm both connect.
3. Both devices show **Online** in Team Activity tab and Devices tab.
4. Close Activity Log on both devices. Keep both apps open for **5+ minutes**.
5. Reopen Team Live — both devices still show **Online**, not Idle or Offline.
6. Close one device — other shows it removed or offline consistently.
7. Reopen closed device — returns to **Online**.
8. Click **Test Connection** multiple times — no ghost devices, no ping-timeout spam; test sockets do not affect device count.

### Online Registry

1. Mac sees Windows event; Windows sees Mac event.
2. Provisional entry shows **Needs Archive Match / Match to NAS** — not Prepare Locally.
3. Publisher shows operator/device name — not UUID or `archive`.
4. Sequence Folders and Edit hidden on Online Registry tab.

### Archive Locations

1. Main Archive Root available → Active Root shows **Auto: Using Main Archive Root**.
2. Choose a different Active Root → save → reopen → override persists, shows **Temporary override**.
3. Clear → save → reopen → returns to **Auto: Using Main Archive Root**.
4. Import confirmation uses correct effective root.

### Import safety

1. No false completion, no silent copy failure, no unrelated file-copy changes.

---

## Realtime Server Deployment Instructions

`realtime-server/server.js` is **unchanged from v0.9.4**. No server update required if already running v0.9.4 or v0.9.5.

If starting fresh:

```bat
set REALTIME_SERVER_KEY=<private-key>
node .\server.js
```

Verify `https://realtime.ajsphotoarchive.com/health` responds before distributing.

---

## Known Limitations

- Cloudflare Tunnel and the Windows realtime server must both remain running for the public URL to work.
- Realtime server key is a shared internal key — not per-user login. If compromised, rotate in server env and redistribute via Settings.
- Stale entries may remain in `realtime-server/data/registry.json` until devices republish or the file is cleared.
- `config/service-account-key.json` remains bundled for Google Sheet reporting on trusted internal devices only.
- Windows installer must be built on a Windows machine (`npm.cmd run dist:win`) — cross-compilation from macOS is not supported for native modules.
