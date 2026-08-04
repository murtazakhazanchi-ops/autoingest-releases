# AI-FEAT-048 — Realtime Team Presence & Online Registry

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-048 |
| Category | Collaboration and Realtime Coordination |
| Status | Implemented |
| Maturity | Operational |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-005 (settings-gated toggle + credentials) |
| Related roadmap milestone | None |
| Related technical docs | `realtime-server/README.md` |
| Evidence status | Verified from current code and multiple release notes |
| First-known implementation | v0.9.1 |
| Latest major update | v0.9.7 |

## Discovery Note

**Not on the original 63-item feature checklist** — independently discovered by both research passes conducted for this audit. `autoingest-architect` review confirmed this as a legitimate new category ("Collaboration and Realtime Coordination"), structurally isolated (own server process, own settings-gated toggle, no writes to `event.json`).

## Summary

A full realtime multi-device coordination system: a Socket.IO relay server for sync-slot negotiation, live activity, and device presence, explicitly documented as **advisory-only** — `services/realtimeOperationsService.js` "never writes event.json, sync manifests, archive folders, metadata files, or any authoritative state." The app degrades gracefully to direct archive operations when the relay is unreachable.

## Current Behavior

`realtime-server/` — Socket.IO relay, port 4040, LAN/VPN-only, no auth by its own README (a real security-relevant constraint operators must be aware of — see Known Bugs / Troubleshooting). `services/realtimeOperationsService.js` — team presence/device-activity tracking and sync-slot coordination. IPC family: `realtime:getStatus`, `realtime:getTeamLiveSnapshot`, `realtime:getSyncSlotStatus`, `realtime:requestSyncSlot`, `realtime:getKnownNames`, `realtime:configure`. `services/offlineCollectionRegistryService.js` manages `collection.link.json` (NAS-link registry per staging collection) as a related but distinct capability. Cross-device event publication: startup restore and manual event selection both publish the active event to the Online Registry, gated behind a "Team Live & Online Registry" settings toggle.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

- **v0.9.1 (2026-05-28)** — Team Live identity display fix: device name/active user name display correctly; `device:hello` captures `deviceName` in addition to `deviceDisplayName`; identity-field aliasing normalization (`docs/release-notes-v0.9.1.md`).
- **v0.9.2 (2026-05-29)** — Server Key authentication for public Cloudflare Tunnel deployment without Tailscale/VPN; key persisted safely, never logged (`docs/release-notes-v0.9.2.md`).
- **v0.9.3 (2026-05-29)** — Online Registry cross-device event publication: startup restore and manual event selection both publish; `_lastRegistryEvtEntry` ensures republication survives reconnects (`docs/release-notes-v0.9.3.md`).
- **v0.9.5 (2026-05-29)** — correct idle/offline presence state model (`docs/release-notes-v0.9.5.md`).
- **v0.9.6 (2026-05-29)** — application-level presence heartbeat: a 45-second heartbeat now runs from socket-connect to disconnect, fixing devices incorrectly appearing Idle when open-but-not-importing (`docs/release-notes-v0.9.6.md`).
- **v0.9.7 (2026-05-30)** — metadata/registry stability fixes in the same release cycle, not specific to this feature (`docs/release-notes-v0.9.7.md`).

## Known Bugs / Troubleshooting

`realtime-server/README.md` documents the relay server as LAN/VPN-only with **no authentication** unless the Server Key mechanism (v0.9.2) is configured for public deployment — this is a real, documented security constraint operators must understand before exposing the relay publicly.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `realtime-server/` (Socket.IO relay server)
- `services/realtimeOperationsService.js`
- `services/offlineCollectionRegistryService.js`
