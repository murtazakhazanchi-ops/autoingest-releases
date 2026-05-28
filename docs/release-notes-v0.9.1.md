# AutoIngest v0.9.1 — Internal Hotfix Release

**Release date:** 2026-05-28
**Type:** Internal hotfix
**Base:** v0.9.0

---

## What's Fixed

### Team Live identity display

- Device name and active user name now display correctly in Team Live Active Now and Devices tab.
  Previously showed "Unknown" or "Device" when identity fields were missing from older builds.
- Realtime server `device:hello` handler now captures `deviceName` (in addition to `deviceDisplayName`)
  so Windows clients using either field name are correctly registered.
- Realtime server `device:activity` relay now enriches payloads with the registered device identity
  when the payload itself omits identity fields — handles transitional/older builds automatically.
- Renderer normalizes all identity field aliases (`deviceName`, `deviceDisplayName`, `hostname`,
  `operatorName`, `userName`, `activeUserName`) into canonical `deviceName` / `userName` at ingestion.
- App startup now seeds the active AutoIngest user name into realtime presence synchronously,
  so the first presence publish includes the correct operator name.
- User switch (`users:setActive`) propagates the new user name to realtime presence immediately.

### Team Live version badge

- "Update recommended" badge no longer appears when both devices are on the same version.
- Version comparison normalizes leading `v` prefix (`v0.9.0` equals `0.9.0`).
- Missing or unknown remote version no longer triggers a false "Update recommended" badge.
- Badge only appears when the remote device version is strictly lower than the local version.

### Team Live activity row readability

- Recent Team Activity rows now show the event folder name as the primary bold element,
  with the action verb and device name as smaller secondary text below.
- Long event names truncate cleanly with ellipsis (2-line clamp); timestamp stays right-aligned.
- Active Now card shows the current event name on its own dedicated line, separated from the
  status row, making it readable even for long event folder names.

### Photographer folder sequencing — archive/NAS events

- Sequence Folders no longer requires a local staging path.
- Event folder path is now resolved using the same priority as all other event operations:
  explicit staging path → effective collection path → active master path.
- Works for local staging events, direct archive/NAS events, and existing events selected
  from the current collection scan.
- Main-process path containment check expanded to include all configured safe roots:
  local staging root, NAS root, archive root, main archive root.
- Error message when the event folder cannot be located is now:
  "Cannot sequence folders: the selected event folder could not be located."
- Error message when the path is outside all allowed roots:
  "Selected event folder is not accessible. Check archive location or reconnect the drive/NAS."

---

## Commits in v0.9.1

| Hash | Description |
|------|-------------|
| `b1c09c1` | fix(realtime): restore team live identity and improve activity display |
| `3024ed2` | fix(event): resolve accessible event path for folder sequencing |

---

## Manual Validation Checklist

1. Restart the Windows realtime server (updated `server.js` required — see below).
2. Restart Mac AutoIngest.
3. Restart Windows AutoIngest if available.
4. **Team Live — identity:** Active Now and Devices tab show real device hostname and user name,
   not "Unknown" or "Device".
5. **Team Live — version badge:** No "Update recommended" when both devices are on v0.9.1.
6. **Team Live — activity:** Recent Team Activity rows show event name bold and readable;
   timestamp stays right-aligned for long names.
7. **Sequence Folders — archive event:** Opens without "local staging path not available" error
   when the selected event lives on the archive/NAS.
8. **Sequence Folders — staging event:** Continues to work as before.
9. **Sequence Folders — create/edit screens:** Button remains hidden (only visible in event list).
10. **Realtime server health:** `http://localhost:4040/health` returns OK.

---

## Known Limitations (Internal Testing)

- Realtime server is LAN/VPN only. Do **not** expose port 4040 publicly.
- `config/service-account-key.json` remains bundled for Google Sheet reporting on trusted internal
  devices only. This is intentional for this internal testing phase.
- Windows realtime server folder must be updated manually because `realtime-server/server.js`
  changed in this release (see instructions below).

---

## Windows Realtime Server Update Instructions

Because `realtime-server/server.js` changed, the office Windows realtime server must be updated
before testing v0.9.1.

1. Copy the updated `realtime-server/server.js` to the Windows realtime server folder,
   **or** copy the entire updated `realtime-server/` folder.
2. If `realtime-server/package.json` changed, run `npm.cmd install` in that folder.
3. Restart the `.bat` launcher.

Verify: `http://localhost:4040/health` returns `{"status":"ok"}` or equivalent.
