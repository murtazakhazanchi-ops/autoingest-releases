# AI-WF-006 — See Who Else Is Online and What They're Working On

| Field | Value |
|---|---|
| Workflow ID | AI-WF-006 |
| Domain | Online Registry & Teamwork |
| Related capabilities | AI-FEAT-048 |
| Related roadmap milestone | None |
| Navigation verified | Yes |
| Evidence status | Verified from `renderer/index.html` (Settings toggle line 8058), `renderer/renderer.js` (`al-mode-tab` buttons, lines 2812–2813), `realtime-server/server.js`, `services/realtimeOperationsService.js`, and `main/main.js` emitter call sites — traced end-to-end during Stage 2's Online Registry architecture audit |

## What It Does

Shows which other AutoIngest devices/operators are currently connected to a shared local relay server, and — for two specific operations only — live progress on what they're doing right now.

**Read this before anything else in this workflow**: AutoIngest's Online Registry deliberately keeps four different things separate, and this workflow must never blur them into one:

1. **Presence** — is a device/operator currently connected. Tracked separately from activity.
2. **Activity / progress visibility** — what a connected device is currently doing, and how far along. Currently published for **Import and Transfer/Sync only** — not QMZ, not Metadata, not Audit/Repair.
3. **Conflict detection** — a `conflict:warning` message type is defined in the client/server protocol, but **no code anywhere in this repository currently emits it**. It is wired but dormant. Do not describe AutoIngest as detecting conflicts between operators on the basis of this alone.
4. **Archive-level file locking** (AI-FEAT-045) — an entirely separate mechanism (photographer-folder locks with a 30-minute TTL) that has no confirmed relationship to the Online Registry. A distinct **sync-slot** coordination mechanism (one concurrent sync at a time, server-arbitrated) does exist inside the Registry system for Transfer/Sync specifically — but the server's own code comment calls it "a timing hint only, not a correctness guarantee."

## When To Use It

Before starting an import or transfer into a shared archive, to see whether someone else is already working on the same event or destination — or simply to check who's currently active.

## Before You Start

**Team Live must be enabled first** — this is an explicit operator opt-in, not automatic. There is **no authentication by default**: the relay server accepts any connection unless an operator has separately configured a server key, and the server's own documentation states it is intended for LAN/VPN use only.

## Where To Go

Settings: a toggle labeled **"Enable Team Live & Online Registry"** (`renderer/index.html:8058`). Once enabled and connected, the **Activity Log** panel has two tabs: **Local Activity** and **Team Live** (`renderer/renderer.js:2812-2813`) — select **Team Live** to see other devices.

## Steps

1. In Settings, enable **Team Live & Online Registry** and set the relay server address if not already configured.
2. Open the **Activity Log** panel.
3. Select the **Team Live** tab.
4. Review connected devices/operators and, where shown, their current activity and progress for Import/Transfer operations specifically. The panel refreshes automatically roughly every 30 seconds.

## What Happens Next / Expected Result

Devices currently connected appear with their operator name and device name. If another device is actively importing or syncing, its progress (files copied / total, where published) is visible in near-real-time. **A device that has finished an operation, or is running QMZ/Metadata/Audit work, will show as present but will not show meaningful activity detail for that specific operation** — this is expected, not a bug, per the activity-publishing scope confirmed above.

## Important Limitations

- No enforced conflict prevention exists today for two operators independently working on the same event, beyond the narrow, hint-only sync-slot gate for Transfer/Sync specifically. Seeing someone else's presence does **not** mean AutoIngest will stop you from also working on the same event.
- Presence data is held only in server memory and is never persisted — a server restart clears it. Stale presence (a device that crashed without disconnecting cleanly) can take up to roughly 55 seconds to clear, governed by the underlying connection library's own ping-timeout, not an application-level staleness check.
- **No photographs or media files ever pass through this system.** Only small, size-capped status/metadata messages are exchanged. The archive's `event.json` remains the sole source of truth for event data; the Registry never replaces or overrides it.

## Warnings

If the relay server becomes unreachable, import and transfer/sync operations **continue normally** — they do not block on Registry connectivity (confirmed directly in the reconnect/fallback code). Team Live simply shows as offline/reconnecting until the connection returns.

## Troubleshooting

None recorded as a dedicated Troubleshooting Entry yet. Known, evidenced behavior for common questions: a stale "still online" entry after another operator's app crashed is expected for up to ~55 seconds, not a defect requiring a manual fix.

## Related Actions

AI-WF-001 (Import) and AI-WF-005 (Transfer/Backup) are the two workflows whose progress is visible here; AI-FEAT-045 (Archive Lock Handling) if the real question is about a filesystem-level import lock rather than teamwork visibility.

## Source

`renderer/index.html:8058`; `renderer/renderer.js:2812-2813`; `realtime-server/server.js`; `realtime-server/README.md`; `services/realtimeOperationsService.js`; `main/main.js` (emitter call sites for import/sync activity); `docs/product/features/AI-FEAT-048_*.md`.
