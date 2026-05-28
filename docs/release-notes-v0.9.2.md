# AutoIngest v0.9.2 — Tester Release

**Release date:** 2026-05-29
**Type:** Tester build
**Base:** v0.9.1

---

## What's New

### Realtime public deployment — Server Key authentication

AutoIngest can now connect securely to the public Cloudflare Tunnel endpoint without Tailscale or VPN.

- **Server Key field** added to Settings → Realtime Server section (password-masked input).
- Server Key is persisted safely in app settings — never logged, never shown in Team Live or activity payloads.
- Realtime client sends `{ serverKey }` via Socket.IO `auth` on every connection and reconnect.
- Realtime server validates `REALTIME_SERVER_KEY` environment variable on every incoming connection.
- Wrong or missing key → `auth-failed` status in Settings with the message:
  `Authentication failed — check server key.`
- No `REALTIME_SERVER_KEY` set → server is open (LAN/dev compatibility preserved) with a startup warning:
  `[security] REALTIME_SERVER_KEY not set — realtime server is open.`
- **Test Connection** button uses the entered Server Key for a real socket.io auth test, reporting:
  `Connected`, `Auth failed — check key`, or `Cannot connect`.

### Public Cloudflare endpoint confirmed working

```
Server URL:  https://realtime.ajsphotoarchive.com
Server Key:  provided internally
Health URL:  https://realtime.ajsphotoarchive.com/health
```

---

## Included from v0.9.1 (hotfix)

### Team Live identity display

- Device name and active user name now display correctly in Active Now and Devices tab.
- Realtime server preserves identity from both `deviceName` and `deviceDisplayName` fields in `device:hello`.
- Server enriches `device:activity` relay from registered identity — handles older builds automatically.
- App startup seeds the active user name into realtime presence synchronously.
- User switch propagates the new user name to presence immediately.

### Team Live version badge

- "Update recommended" no longer shows when both devices are on the same version.
- Version comparison normalizes leading `v` prefix (`v0.9.2` = `0.9.2`).
- Missing remote version no longer triggers a false badge.

### Team Live activity row readability

- Event folder name is now the primary bold element in Recent Team Activity rows.
- Long event names truncate cleanly; timestamp stays right-aligned.
- Active Now card shows current event name on its own dedicated line.

### Photographer folder sequencing — archive/NAS events

- Sequence Folders works for local staging events, archive/NAS events, and any existing selected event.
- Main-process path containment expanded to all configured safe roots.
- Clearer error messages when event folder cannot be located or is inaccessible.

---

## Commits in v0.9.2

| Hash | Description |
|------|-------------|
| `7986504` | feat(realtime): add server key authentication |
| `b1c09c1` | fix(realtime): restore team live identity and improve activity display |
| `3024ed2` | fix(event): resolve accessible event path for folder sequencing |

---

## Tester Instructions

1. Install AutoIngest v0.9.2 (use the appropriate `.dmg` for your Mac — Intel or arm64).
2. Open **Settings** (gear icon).
3. Enable **Team Live & Online Registry**.
4. Enter:
   - **Server URL:** `https://realtime.ajsphotoarchive.com`
   - **Server Key:** provided internally
5. Click **Test Connection** → expected result: **Connected**
6. Open **Activity Log → Team Live** to verify device/user identity and activity feed.

---

## Manual Validation Checklist

1. **Server without key:** `node server.js` logs `[security] REALTIME_SERVER_KEY not set`; local clients connect as before.
2. **Server with key:** `REALTIME_SERVER_KEY=<key> node server.js`
   - Client with no key → `auth-failed`
   - Client with wrong key → `auth-failed`
   - Client with correct key → `Connected`
3. **Public Cloudflare URL:** `https://realtime.ajsphotoarchive.com/health` returns `{"status":"ok",...}`
4. **Settings UI:** URL saves, key saves (password-masked), Test Connection uses key, auth-failed message clear.
5. **Team Live:** works after authenticated connection; device/user identity correct; no false version badge.
6. **Online Registry:** works after authenticated connection.
7. **Sequence Folders:** existing archive/tester events open without "local staging path" error.

---

## Realtime Server Deployment Instructions

`realtime-server/server.js` changed in this release. Update the Windows realtime server before testing.

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
1. Copy updated `realtime-server/server.js` (or the full `realtime-server/` folder) to the Windows machine.
2. Run `npm.cmd install` if `package.json` changed.
3. Set `REALTIME_SERVER_KEY` and restart the launcher.
4. Verify: `https://realtime.ajsphotoarchive.com/health` returns OK.

---

## Known Limitations

- Cloudflare Tunnel and the Windows realtime server must both remain running for the public URL to work.
- `config/service-account-key.json` remains bundled for Google Sheet reporting on trusted internal devices only.
- Server Key is a shared internal key, not per-user login. If the key is compromised, rotate it in the server env and redistribute to devices via Settings.
- Windows installer must be built on a Windows machine (`npm.cmd run dist:win`) — cross-compilation from macOS is not supported for native modules.
