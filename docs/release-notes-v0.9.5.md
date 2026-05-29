# AutoIngest v0.9.5 — Tester Build

**Release date:** 2026-05-29
**Type:** Tester build
**Base:** v0.9.4

v0.9.5 is cumulative and includes all fixes from v0.9.3 and v0.9.4 (public realtime deployment, archive root auto-resolution, socket lifecycle hardening).

---

## What's New in v0.9.5

### Team Live — correct idle/offline presence state

Connected devices that have not sent recent activity now show **Idle** instead of **Offline** in both the Team Activity and Devices tabs.

**State model:**

| Condition | Status shown |
|---|---|
| Device connected, activity < 2 min ago | **Online** (or Viewing / Importing / Syncing) |
| Device connected, activity ≥ 2 min ago | **Idle** |
| Device disconnected (`device:offline` received) | Removed from presence / Offline |

Previously, both tabs used different age thresholds and labeled connected-but-inactive devices as "Offline," causing the Devices tab and Team Activity tab to disagree. Now:

- `_tlDeviceCard` (Team Activity): stale entries show **Idle**, never Offline.
- `_renderDevicesTab` (Devices): uses the same 2-min threshold; stale entries show **Idle**.
- Health warnings (archive disconnected, sync issues) now visible for idle devices in the Devices tab — they were previously hidden.
- Snapshot hydration: when a new connection receives the device snapshot from the server, connected devices are timestamped at receipt time so they appear in Active Now rather than immediately as stale.

---

## Commits in v0.9.5

| Hash | Description |
|------|-------------|
| `619ca7b` | fix(realtime): show idle state for connected inactive devices |

---

## Included from v0.9.4

- Active Archive Root auto-resolves from Main Archive Root when available.
- Temporary Active Archive Root override persists after save/restart.
- Clearing override returns to Auto: Using Main Archive Root.
- Test Connection sockets disconnect cleanly; no ping-timeout spam.
- Unidentified realtime sockets do not affect device count.

## Included from v0.9.3

- Online Registry cross-device event publication.
- Online Registry local-prepared detection (Needs Archive Match / Match to NAS).
- Online Registry publisher identity (operator name; no raw UUIDs).
- Server Key authentication for public Cloudflare endpoint.

---

## Tester Instructions

1. Install AutoIngest v0.9.5 (`.dmg` matching your Mac — Intel or arm64).
2. Open **Archive Location Setup** and confirm archive root behavior.
3. Open **Settings** (gear icon).
4. Enable **Team Live & Online Registry**.
5. Enter:
   - **Server URL:** `https://realtime.ajsphotoarchive.com`
   - **Server Key:** provided internally
6. Click **Test Connection** → expected: **Connected**
7. Open **Activity Log → Team Live**.
8. Open **Change Event → Online Registry**.

---

## Manual Validation Checklist

1. **Public realtime health:** `https://realtime.ajsphotoarchive.com/health` returns `{"status":"ok",...}`.
2. **Settings:** Server URL saves, Server Key saves (password-masked), Test Connection shows **Connected**; wrong key shows failure.
3. **Team Live — presence state:**
   - Online devices show **Online**.
   - Wait 2+ minutes without activity → device shows **Idle** in both Team Activity and Devices tabs.
   - Close one device → other device shows it removed or offline consistently.
   - Reopen device → returns to **Online**.
   - Devices tab and Team Activity tab show consistent state.
4. **Online Registry:**
   - Mac sees Windows event; Windows sees Mac event.
   - Restored/current events publish correctly.
   - Provisional entry shows **Needs Archive Match** / **Match to NAS** — not Prepare Locally.
   - Publisher shows operator/device name — not UUID or `archive`.
   - Sequence Folders and Edit are hidden on Online Registry tab.
5. **Archive Locations:**
   - Main Archive Root available → Active Root shows **Auto: Using Main Archive Root**.
   - Choose a different Active Root → save → reopen → override path remains, shows **Temporary override**.
   - Clear → save → reopen → returns to **Auto: Using Main Archive Root**.
   - Import confirmation uses the correct effective root.
6. **Import safety:** no false completion, no silent copy failure, no unrelated file-copy changes.

---

## Realtime Server Deployment Instructions

`realtime-server/server.js` is **unchanged from v0.9.4**. No server update required if already running v0.9.4.

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
