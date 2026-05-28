# AutoIngest v0.9.3 — Public Realtime Tester Build

**Release date:** 2026-05-29
**Type:** Tester build
**Base:** v0.9.2

---

## What's New

### Online Registry — cross-device event publication

AutoIngest now publishes the active event to the Online Registry automatically, so other connected devices can see it without any manual action.

- **Startup restore:** when AutoIngest starts and restores the last active event, that event is immediately published to the Online Registry.
- **Manual selection:** selecting an existing event from the event list publishes it to the Online Registry.
- Both paths set `_lastRegistryEvtEntry`, ensuring republication survives socket reconnects.

### Online Registry — local-prepared detection

The Online Registry now correctly detects events that have already been prepared locally on this device, even after an app restart.

- On each registry load, provisional collections are read from persistent `collection.link.json` files on disk.
- Registry entries whose collection exists locally as provisional/unlinked now show **Needs Archive Match** instead of **Prepare Locally**.
- Action button for provisional entries is **Match to NAS** — not **Prepare Locally**.
- Clicking **Match to NAS** opens the folder picker, links the collection, and updates both the registry panel and the master step.
- Non-local entries that have never been prepared still show **Prepare Locally** as before.

### Online Registry — publisher identity display

Registry cards now show a human-readable publisher name instead of UUIDs or internal origin values.

- Fallback order: `createdByOperator` → `operatorName` → `userName` → `activeUserName` → `createdByDeviceName` → `deviceName` → `Unknown device`.
- `createdByOperator` is the active user/profile name set at app startup (e.g. Mustafa Dohadwala, Murtaza Khazanchi).
- `createdByDeviceName` now falls back to `os.hostname()` if no display name is configured, ensuring the field is never null on any device.
- Raw UUIDs, `archive`, `archive-available`, `remote-created`, and `unknown` are blocked from the publisher line by a `_isMeaningfulDisplayName()` guard.
- Stale registry entries from older builds (no operator field) display `From Unknown device` until the owning device updates and republishes.

### Online Registry — local-only actions hidden for remote entries

- **Sequence Folders** and **Edit** are hidden for all Online Registry tab entries.
- `_openSeqModal()` is guarded: returns immediately if `_activeTab === 'online-registry'`.
- Tab switch to Online Registry dispatches `listDeselect`, clearing footer button state.

---

## Included from v0.9.2

### Realtime public deployment — Server Key authentication

- **Server Key field** added to Settings → Realtime Server section (password-masked).
- Server Key persisted safely — never logged, never shown in Team Live or activity payloads.
- Realtime client sends `{ serverKey }` via Socket.IO `auth` on every connect and reconnect.
- Server validates `REALTIME_SERVER_KEY` on every connection; wrong/missing key → `auth-failed`.
- **Test Connection** performs a real socket.io auth test.

### Public Cloudflare endpoint

```
Server URL:  https://realtime.ajsphotoarchive.com
Server Key:  provided internally
Health URL:  https://realtime.ajsphotoarchive.com/health
```

### Team Live identity, version badge, activity display (v0.9.1)

- Device name and active user name display correctly in Active Now and Devices tab.
- "Update recommended" no longer shows when both devices are on the same version.
- Event folder name is the primary bold element in Recent Team Activity rows.
- Sequence Folders works for local staging, archive/NAS, and existing selected events.

---

## Commits in v0.9.3

| Hash | Description |
|------|-------------|
| `51c6986` | fix(registry): add provisional status pill for local-prepared detection |
| `b0fac9b` | fix(registry): display meaningful publisher identity |
| `a33bbb9` | fix(registry): show publisher name instead of origin source |
| `4ac84ed` | fix(realtime): publish registry entry on startup restore and event selection |

---

## Tester Instructions

1. Install AutoIngest v0.9.3 (use the `.dmg` matching your Mac — Intel or arm64).
2. Open **Settings** (gear icon).
3. Enable **Team Live & Online Registry**.
4. Enter:
   - **Server URL:** `https://realtime.ajsphotoarchive.com`
   - **Server Key:** provided internally
5. Click **Test Connection** → expected: **Connected**
6. Open **Activity Log → Team Live** to verify device/user identity.
7. Open **Change Event → Online Registry** to view live events from other connected devices.
8. If a remote device shows **From Unknown device**, update that device to v0.9.3, then reopen or reselect its event so it republishes with full identity.

---

## Manual Validation Checklist

1. **Realtime server starts** with `REALTIME_SERVER_KEY` set; health URL returns `{"status":"ok",...}`.
2. **Mac AutoIngest:** Server URL saves, Server Key saves (password-masked), Test Connection shows **Connected**.
3. **Online Registry — publication:**
   - Restored Mac event appears in registry after startup.
   - Remote Windows event appears in Mac Online Registry.
4. **Online Registry — local-prepared detection:**
   - Provisional local event shows **Needs Archive Match** / **Match to NAS** — not **Prepare Locally**.
   - Non-local event still shows **Prepare Locally**.
5. **Publisher display:**
   - Updated entries show operator name (e.g. `From Mustafa Dohadwala`).
   - Stale entries without identity show `From Unknown device` — not UUID, not `From archive`.
6. **Team Live:** device/user identity correct; no false "Update recommended" badge.
7. **Online Registry actions:** Sequence Folders and Edit hidden for remote entries.
8. **Current Device tab:** Sequence Folders and Edit still visible for local accessible events.
9. **Wrong key test:** Test Connection fails with `Authentication failed — check server key.`
10. **Sequence Folders:** existing archive/tester events open without local staging path error.

---

## Realtime Server Deployment Instructions

`realtime-server/server.js` unchanged from v0.9.2. No server update required if already running v0.9.2.

**Start with key (required for public deployment):**

```bat
set REALTIME_SERVER_KEY=<private-key>
node .\server.js
```

Or add to the `.bat` launcher:

```bat
set REALTIME_SERVER_KEY=<private-key>
node "%~dp0server.js"
```

**Steps:**
1. Verify Cloudflare Tunnel is connected and `https://realtime.ajsphotoarchive.com/health` returns OK.
2. If `server.js` changed: copy updated `realtime-server/server.js` to the Windows machine.
3. Restart server with `REALTIME_SERVER_KEY` set.
4. Confirm health URL responds before distributing the build.

---

## Known Limitations

- Cloudflare Tunnel and the Windows realtime server must both remain running for the public URL to work.
- Devices must run v0.9.3 to publish full human-readable registry identity. Older device entries show `Unknown device` until that device updates and republishes.
- Stale entries may remain in `realtime-server/data/registry.json` until devices republish or the file is cleared.
- `config/service-account-key.json` remains bundled for Google Sheet reporting on trusted internal devices only.
- Server Key is a shared internal key — not per-user login. If compromised, rotate in server env and redistribute via Settings.
- Windows installer must be built on a Windows machine (`npm.cmd run dist:win`) — cross-compilation from macOS is not supported for native modules.
