# AutoIngest v0.9.4 — Archive Root & Realtime Stability Tester Build

**Release date:** 2026-05-29
**Type:** Tester build
**Base:** v0.9.3

---

## What's New

### Archive Root — auto-resolution and temporary override

Active Archive Root now auto-resolves from Main Archive Root when available, with full support for intentional temporary overrides.

- **Auto-resolution:** when Main Archive Root is configured and reachable, Active Archive Root automatically uses it. Status shows **Auto: Using Main Archive Root**.
- **Temporary override:** user can click Choose and select a different Active Archive Root at any time, even when Main Archive Root is connected. Status shows **Temporary override — using Active Archive Root**.
- **Override persists:** the chosen override survives Save, reopen, and app restart — it is not silently reverted.
- **Clear override:** clicking Clear removes the override and returns to Auto: Using Main Archive Root.
- **Redundant override guard:** if chosen Active Archive Root equals Main Archive Root, the system treats it as auto/no override.
- **Main Archive Root is never overwritten:** selecting a temporary Active Archive Root does not affect Main Archive Root, `collection.link.json` targets, or NAS sync targets.

### Realtime — connection lifecycle hardening

Socket.IO lifecycle improvements for Cloudflare Tunnel deployment stability.

- **pingTimeout raised to 30 s** (from default 20 s) to absorb Cloudflare Tunnel round-trip latency without false disconnects.
- **pingInterval explicitly set to 25 s** to keep connections alive within Cloudflare's 100 s idle-close window.
- **Test Connection cleans up properly:** the ephemeral test socket now waits for the server-side disconnect to complete before the IPC call resolves, so the server sees a clean close instead of a ping timeout.
- **Unidentified socket logging:** sockets that disconnect before sending `device:hello` (test probes, mid-auth drops) are now logged as `[disconnect] unidentified socket <id>` — they do not affect device count and do not trigger a `dashboard:update`.

---

## Fixed

- Active Archive Root no longer reverts to Main Archive Root after choosing a temporary override and saving.
- Active Root equal to Main Root is treated as auto/no override — not a redundant duplicate override.
- Test Connection sockets now disconnect cleanly on the server; no delayed ping-timeout spam in server logs.
- Unidentified realtime sockets no longer pollute Team Live device count.
- `resolveEffectiveArchiveRoot` IPC bridge correctly exposed in preload.

---

## Included from v0.9.3

- Online Registry cross-device event publication (auto-publish on startup restore and event selection).
- Online Registry local-prepared detection (provisional entries show Needs Archive Match / Match to NAS — not Prepare Locally).
- Online Registry publisher identity display (operator name fallback chain; no raw UUIDs).
- Online Registry: Sequence Folders and Edit hidden for remote entries.
- Server Key authentication for public Cloudflare endpoint.

---

## Commits in v0.9.4

| Hash | Description |
|------|-------------|
| `a1381b0` | fix(archive): persist temporary active root override |
| `1e0bd9e` | fix(archive): expose resolveEffectiveArchiveRoot IPC bridge |
| `31fef9e` | fix(realtime): clean up socket test connections and disconnect logging |

---

## Tester Instructions

1. Install AutoIngest v0.9.4 (`.dmg` matching your Mac — Intel or arm64).
2. Open **Archive Location Setup**.
3. Confirm Active Archive Root shows **Auto: Using Main Archive Root** when Main Archive Root is connected.
4. Choose a temporary Active Archive Root only if importing elsewhere temporarily.
5. Open **Settings** (gear icon).
6. Enable **Team Live & Online Registry**.
7. Enter:
   - **Server URL:** `https://realtime.ajsphotoarchive.com`
   - **Server Key:** provided internally
8. Click **Test Connection** → expected: **Connected**
9. Open **Activity Log → Team Live**.
10. Open **Change Event → Online Registry**.

---

## Manual Validation Checklist

### Archive Locations

1. **Main Archive Root available, no Active override:**
   - Active Archive Root shows Main Archive Root path.
   - Status shows **Auto: Using Main Archive Root**.

2. **Choose different Active Archive Root:**
   - Save.
   - Reopen modal.
   - Override path remains visible.
   - Status shows **Temporary override — using Active Archive Root**.

3. **Restart app with override saved:**
   - Override path remains.
   - Import confirm uses override path.

4. **Clear Active Archive Root:**
   - Save.
   - Reopen modal.
   - Active Archive Root returns to Main Archive Root.
   - Status shows **Auto: Using Main Archive Root**.

5. **Main Archive unavailable:**
   - Active Archive Root remains selectable.
   - App uses selected Active Root as current working location.
   - Main Archive Root is not overwritten.

6. **Linked collection safety:**
   - Existing `collection.link.json` targets are not changed.
   - Surat/Marol NAS targets are not silently rerouted.

### Realtime

1. Start Windows realtime server with `REALTIME_SERVER_KEY`.
2. Confirm public health: `https://realtime.ajsphotoarchive.com/health`
3. Open AutoIngest — one connect + `device:hello`.
4. Click **Test Connection** multiple times — no delayed ping-timeout spam; unidentified sockets do not affect device count.
5. Close/reopen AutoIngest — device count updates cleanly.
6. Team Live and Online Registry still work.

---

## Realtime Server Deployment Instructions

**`realtime-server/server.js` has changed in v0.9.4.**
The server must be updated on the Windows machine before distributing this build.

**Copy updated server file to Windows, then start with:**

```bat
set REALTIME_SERVER_KEY=<private-key>
node .\server.js
```

Or using the `.bat` launcher:

```bat
set REALTIME_SERVER_KEY=<private-key>
node "%~dp0server.js"
```

**Steps:**
1. Copy updated `realtime-server/server.js` to the Windows machine.
2. Restart server with `REALTIME_SERVER_KEY` set.
3. Verify Cloudflare Tunnel is connected and `https://realtime.ajsphotoarchive.com/health` returns `{"status":"ok",...}`.
4. Confirm health URL responds before distributing the build.

---

## Known Limitations

- Cloudflare Tunnel and the Windows realtime server must both remain running for the public URL to work.
- Realtime server key is a shared internal key — not per-user login. If compromised, rotate in server env and redistribute via Settings.
- Stale entries may remain in `realtime-server/data/registry.json` until devices republish or the file is cleared.
- `config/service-account-key.json` remains bundled for Google Sheet reporting on trusted internal devices only.
- Windows installer must be built on a Windows machine (`npm.cmd run dist:win`) — cross-compilation from macOS is not supported for native modules.
