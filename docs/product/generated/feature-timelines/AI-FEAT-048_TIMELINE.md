# AI-FEAT-048 — Timeline

> Generated artifact — strictly extracted/reformatted from [features/AI-FEAT-048_REALTIME_TEAM_PRESENCE_ONLINE_REGISTRY.md](../features/AI-FEAT-048_REALTIME_TEAM_PRESENCE_ONLINE_REGISTRY.md)'s own Evolution / Implementation Journal, header table, Known Bugs, and Decisions sections. No new facts. Regenerate with `node scripts/product-docs/cli.js build`.

**Feature**: Realtime Team Presence & Online Registry

| Date | Event type | Summary | Related IDs | Confidence | Evidence source |
|---|---|---|---|---|---|
| v0.9.1 | initial implementation | First-known implementation of Realtime Team Presence & Online Registry | — | verified | features/AI-FEAT-048_REALTIME_TEAM_PRESENCE_ONLINE_REGISTRY.md header table: First-known implementation |
| v0.9.7 | other dated milestone | Latest major update recorded for Realtime Team Presence & Online Registry | — | verified | features/AI-FEAT-048_REALTIME_TEAM_PRESENCE_ONLINE_REGISTRY.md header table: Latest major update |
| Evidence pending | evidence pending | **v0.9.1 (2026-05-28)** — Team Live identity display fix: device name/active user name display correctly; `device:hello` captures `deviceName` in addition to `deviceDisplayName`; identity-field aliasing normalization (`docs/release-notes-v0.9.1.md`). | — | undated | features/AI-FEAT-048_REALTIME_TEAM_PRESENCE_ONLINE_REGISTRY.md § Evolution / Implementation Journal |
| Evidence pending | evidence pending | **v0.9.2 (2026-05-29)** — Server Key authentication for public Cloudflare Tunnel deployment without Tailscale/VPN; key persisted safely, never logged (`docs/release-notes-v0.9.2.md`). | — | undated | features/AI-FEAT-048_REALTIME_TEAM_PRESENCE_ONLINE_REGISTRY.md § Evolution / Implementation Journal |
| Evidence pending | evidence pending | **v0.9.3 (2026-05-29)** — Online Registry cross-device event publication: startup restore and manual event selection both publish; `_lastRegistryEvtEntry` ensures republication survives reconnects (`docs/release-notes-v0.9.3.md`). | — | undated | features/AI-FEAT-048_REALTIME_TEAM_PRESENCE_ONLINE_REGISTRY.md § Evolution / Implementation Journal |
| Evidence pending | evidence pending | **v0.9.5 (2026-05-29)** — correct idle/offline presence state model (`docs/release-notes-v0.9.5.md`). | — | undated | features/AI-FEAT-048_REALTIME_TEAM_PRESENCE_ONLINE_REGISTRY.md § Evolution / Implementation Journal |
| Evidence pending | evidence pending | **v0.9.6 (2026-05-29)** — application-level presence heartbeat: a 45-second heartbeat now runs from socket-connect to disconnect, fixing devices incorrectly appearing Idle when open-but-not-importing (`docs/release-notes-v0.9.6.md`). | — | undated | features/AI-FEAT-048_REALTIME_TEAM_PRESENCE_ONLINE_REGISTRY.md § Evolution / Implementation Journal |
| Evidence pending | evidence pending | **v0.9.7 (2026-05-30)** — metadata/registry stability fixes in the same release cycle, not specific to this feature (`docs/release-notes-v0.9.7.md`). | — | undated | features/AI-FEAT-048_REALTIME_TEAM_PRESENCE_ONLINE_REGISTRY.md § Evolution / Implementation Journal |

