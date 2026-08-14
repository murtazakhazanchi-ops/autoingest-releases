# AI-WF-006 — See Who Else Is Online, Coordinate Shared Events, and See What They're Working On

| Field | Value |
|---|---|
| Workflow ID | AI-WF-006 |
| Domain | Online Registry & Teamwork |
| Related capabilities | AI-FEAT-048 |
| Related roadmap milestone | None |
| Navigation verified | Yes |
| Evidence status | Verified from `renderer/index.html` (Settings toggle line 8058), `renderer/renderer.js` (`al-mode-tab` buttons, lines 2812–2813), `realtime-server/server.js`, `services/realtimeOperationsService.js`, `main/main.js` emitter and IPC-handler call sites, `main/preload.js`, and `renderer/eventCreator.js` (Online Registry tab UI) — traced end-to-end, extended 2026-08-14 per a product-owner clarification that surfaced a real, substantially-implemented capability (event coordination/adoption) this record had not previously documented at all — a genuine coverage gap in this workflow's own prior version, not a correction of a false claim. |

## What It Does

**The Online Registry's primary purpose is coordinating operators working from separate physical locations who may not share a common NAS, Main Archive Root, or filesystem** — not merely showing an online-user list. It lets a field operator's newly-created event become discoverable, by name and identity, to an office/archive operator (or any other AutoIngest installation) who has no access to the field operator's local storage — and, where implemented, lets that second operator establish the *same* event locally rather than inventing an independently-named duplicate. Presence and live progress visibility (documented below) are real, but they are supporting capabilities of this larger collaboration goal, not the entire reason the Registry exists.

This system operates in a **coordination / control plane**, distinct from the **physical data plane** (the actual photo/video files, NAS, archive roots, imports, transfers). The Registry shares small, structural coordination state — device presence, registered event identity, activity/progress — never photo or video bytes. This is precisely why it stays useful when operators have no live NAS connection to each other: it doesn't need one.

**Read this before anything else in this workflow**: AutoIngest's Online Registry deliberately keeps five different things separate, and this workflow must never blur them into one:

1. **Presence** — is a device/operator currently connected. Tracked separately from activity.
2. **Activity / progress visibility** — what a connected device is currently doing, and how far along. Currently published for **Import and Transfer/Sync only** — not QMZ, not Metadata, not Audit/Repair.
3. **Conflict detection** — a `conflict:warning` message type is defined in the client/server protocol, but **no code anywhere in this repository currently emits it**. It is wired but dormant. Do not describe AutoIngest as detecting conflicts between operators on the basis of this alone — including for simultaneous event registration or adoption (§ Event Discovery & Coordination below).
4. **Archive-level file locking** (AI-FEAT-045) — an entirely separate mechanism (photographer-folder locks with a 30-minute TTL) that has no confirmed relationship to the Online Registry. A distinct **sync-slot** coordination mechanism (one concurrent sync at a time, server-arbitrated) does exist inside the Registry system for Transfer/Sync specifically — but the server's own code comment calls it "a timing hint only, not a correctness guarantee."
5. **Shared Event Discovery / Event Coordination** — the ability for a separated AutoIngest installation to learn about an event another operator already registered, and, where implemented, establish that same event locally instead of independently inventing another name/identity for it. This is the mechanism directly serving the Registry's primary collaboration purpose described above — see § Event Discovery & Coordination for the full, evidence-classified account.

## Event Discovery & Coordination (Primary Purpose)

**Forensic classification.** Every step below was traced directly in source, not inferred from product intent. Status key: **VERIFIED IMPLEMENTED** (real, working, reachable from the UI) / **PARTIALLY IMPLEMENTED** / **DORMANT** (code exists, not exercised) / **PLANNED / INTENDED** (not built) / **NOT SUPPORTED** / **UNKNOWN**.

| # | Question | Classification | Evidence |
|---|---|---|---|
| 1 | What event information is sent when an event is created? | **VERIFIED IMPLEMENTED** | `main/main.js`'s `event:write` IPC handler (event-creation path) constructs an `eventJsonShell` — `version`, `hijriDate`, `sequence`, `eventName`, `safeEventName`, `status`, `components`, `updatedAt` — and calls `realtimeOps.emitRegistryEvent(...)` with it, plus `nasCollectionPath`/`nasEventPath` when the event is on a reachable NAS. **No photo or video file data is included.** |
| 2 | Are events persisted in the Registry, or only broadcast transiently? | **VERIFIED IMPLEMENTED (persisted)** | `realtime-server/server.js` writes registered entries to a `registry.json` file on disk (`REGISTRY_PATH`), reloads it on server startup, and keeps an in-memory `Map` synced to it. |
| 3 | How does another client discover registered events? | **VERIFIED IMPLEMENTED** | Two paths: (a) live — the server does `socket.broadcast.emit('registry:register', entry)` to every other connected client the moment one registers; (b) catch-up — a client sends `registry:request` (done automatically on connect, in `realtimeOperationsService.js`) and the server replies with a full `registry:snapshot` of every persisted entry. |
| 4 | What UI exposes remote/registered events? | **VERIFIED IMPLEMENTED** | `renderer/eventCreator.js` renders a real **"Online Registry"** tab (`data-tab="online-registry"`) alongside the "Current Device" tab on the event-list screen — a genuine, reachable operator-facing UI element, not hidden behind a flag. Each remote collection/event appears as a card with a status pill and an action button. |
| 5 | Can an operator duplicate/adopt a Registry event into their local environment? | **VERIFIED IMPLEMENTED** | The "Online Registry" tab's cards have **"prepare collection"** and **"prepare event"** buttons, wired to `window.api.prepareCollectionFromRegistry`/`prepareEventFromRegistry` (`main/preload.js`), which invoke `collection:prepareFromRegistry`/`event:prepareFromRegistry` (`main/main.js`). |
| 6 | What data is copied when adopting? | **VERIFIED IMPLEMENTED** | Only the structural `eventJsonShell` fields (see #1) — reconstructed into a real local `event.json`. No photo/video bytes; there are none to copy, since none were ever sent to the Registry. |
| 7 | Is `event.json` reconstructed/copied/generated? | **VERIFIED IMPLEMENTED (generated)** | `event:prepareFromRegistry` writes a genuine local `event.json` (atomic tmp→rename) built from the registry entry's shell fields, validated by the same `isValidEventJson()` check used for a normal local event creation. |
| 8 | Is the exact event folder name/sequence/components preserved? | **VERIFIED IMPLEMENTED** | The local folder is created at `path.join(localCollectionPath, eventFolderName)` using the *exact* `eventFolderName` string from the registry entry; `sequence`, `eventName`, `safeEventName`, and `components` are carried through unchanged into the generated local `event.json`. |
| 9 | What happens if the local installation already has the event? | **VERIFIED IMPLEMENTED (safe no-op)** | Idempotent — `event:prepareFromRegistry` checks for an existing `event.json` first and returns `{ alreadyExisted: true }` without overwriting it. |
| 10 | What happens with no NAS connection? | **VERIFIED IMPLEMENTED** | The event/collection is still adopted into **Local Staging** and marked `status: 'provisional'` (vs. `'linked'` when a validated NAS path is available) via `offlineCollectionRegistryService.js`'s `collection.link.json` — the same link-status mechanism already used for ordinary Local-First staging (AI-FEAT-044-adjacent infrastructure), not a new one built for this. |
| 11 | Do Registry-adopted events later reconcile with the common archive? | **VERIFIED IMPLEMENTED (via existing infrastructure)** | A `provisional` collection uses the same `collection.link.json` linked/provisional lifecycle as any other Local-First-staged collection — reconciliation follows that already-established path, not a Registry-specific one. Full reconciliation-timing detail is AI-FEAT-044's own scope, not re-documented here. |
| 12 | Is event creation broadcast immediately? | **VERIFIED IMPLEMENTED** | Yes — `socket.broadcast.emit(...)` fires synchronously on the server's receipt of `registry:register`. |
| 13 | Do disconnected clients receive previously-created events on reconnect? | **VERIFIED IMPLEMENTED** | Yes — `registry:request` → `registry:snapshot` on (re)connect, sourced from the server's persisted `registry.json`. |
| 14 | Is there persistent server-side event history/state? | **VERIFIED IMPLEMENTED** | `registry.json`, loaded on server startup, updated on every registration. |
| 15 | Can two operators independently adopt the same Registry event? | **VERIFIED IMPLEMENTED, by design** | Yes, safely — both pull the *same* canonical `eventJsonShell` from the *same* server-persisted entry (keyed by a deterministic `registryId`), so both end up with identical local `event.json` content under the identical folder name. This is the intended collaboration behavior, not a bug. |
| 16 | What prevents/detects conflicting event identities? | **DORMANT** | Nothing dedicated. If two operators independently create an event with the *same* folder name at nearly the same time before either registration reaches the server, the server's registry entry is simply overwritten by whichever registration arrives second (`_registry.set(entry.registryId, ...)`) — no warning fires. This is the same dormant `conflict:warning` gap already documented above (§ 3), not a separate mechanism. |
| 17 | Is activity/progress associated with the shared event identity? | **PARTIALLY IMPLEMENTED** | Activity/progress (§ 2 above) is keyed by `collectionName`/`eventFolderName`, the same identity fields the registry entry carries — so activity for a *registered* event is, in principle, attributable to it. Confirmed only for Import/Transfer-Sync, per the existing activity-scope limitation. |
| 18 | What happens when the Registry server is unavailable? | **VERIFIED IMPLEMENTED** | Import, transfer, and normal event creation all continue locally and normally — event registration and adoption simply aren't available until reconnection (unchanged from the already-documented Warnings section below). |
| 19 | What information leaves the local machine? | **VERIFIED IMPLEMENTED (structural only)** | Device/operator display names, collection/event folder names and display names, the `eventJsonShell` structural fields listed in #1, NAS path strings (only when a NAS root is configured and the path validates against it), and activity/progress counters. No file content. |
| 20 | Do any photograph/video bytes ever traverse the Registry? | **NOT SUPPORTED (confirmed, unchanged)** | No code path sends file bytes to the relay — confirmed again during this specific investigation, consistent with the pre-existing claim below. |

**Operator workflow, marked per the classification above** (every arrow reflects verified behavior, not intent):

```
FIELD INGESTER                    [operator action]
  creates/works on event
        ↓ (VERIFIED IMPLEMENTED — automatic on event:write)
ONLINE REGISTRY
  persists + broadcasts event identity/coordination state (never media)
        ↓ (VERIFIED IMPLEMENTED — live broadcast + reconnect snapshot)
REMOTE INGESTER
  discovers the team event in the "Online Registry" tab
        ↓ (VERIFIED IMPLEMENTED — operator clicks "prepare event")
LOCAL AUTOINGEST
  adopts/generates the established event locally (same name, sequence, components)
        ↓ (VERIFIED IMPLEMENTED, by design — see Q15)
BOTH OPERATORS
  work against the same logical event identity, in their own local storage
        ↓ (VERIFIED IMPLEMENTED — via the pre-existing Local-First linked/provisional mechanism, not a new one)
ARCHIVE RECONCILIATION
  separately-ingested material later enters the common archive through the existing Local-First sync path
```

**What this does NOT do, confirmed above**: it never transmits photo/video bytes (Q20); it provides no independent conflict detection for simultaneously-created or simultaneously-adopted events beyond the existing dormant `conflict:warning` (Q16); it does not invent a new archive-reconciliation mechanism (Q11) — it hands off to the one that already exists.

**A note on prior documentation of this record**: the original (2026-08-13) version of this Workflow documented only presence/activity/conflict/locking and never mentioned event coordination at all, despite it being the Registry's primary, substantially-implemented purpose. This was a real coverage gap in this record — not a case of previously-documented behavior turning out to be wrong — found and closed following an explicit product-owner clarification (2026-08-14). See `docs/product/11_ARCHITECTURAL_EVOLUTION.md` for a related, similarly-scoped pre-existing documentation gap this same investigation surfaced in AI-FEAT-048's own record (not rewritten here — out of this Workflow's scope).

## When To Use It

Two situations: (1) You're separated from a teammate — no shared NAS/Main Archive Root — and need to know whether they've already created the event you're both about to work on, or need your own local copy of an event they registered. (2) Before starting an import or transfer into a shared archive, to see whether someone else is already working on the same event or destination, or simply to check who's currently active.

## Before You Start

**Team Live must be enabled first** — this is an explicit operator opt-in, not automatic. There is **no authentication by default**: the relay server accepts any connection unless an operator has separately configured a server key, and the server's own documentation states it is intended for LAN/VPN use only. Event registration and adoption require a **Local Staging Root** to be configured (adopted events are written there).

## Where To Go

Two separate UI surfaces, for two separate purposes:
- **Presence / activity visibility**: Settings toggle **"Enable Team Live & Online Registry"** (`renderer/index.html:8058`). Once enabled and connected, the **Activity Log** panel has two tabs: **Local Activity** and **Team Live** (`renderer/renderer.js:2812-2813`) — select **Team Live** to see other devices.
- **Event discovery / adoption**: the event-list screen's **"Online Registry"** tab (`renderer/eventCreator.js`, alongside the "Current Device" tab) — lists collections/events registered by any connected device, each with a status pill and a **"prepare collection"**/**"prepare event"** action button.

## Steps

**To see who else is online / what they're doing:**
1. In Settings, enable **Team Live & Online Registry** and set the relay server address if not already configured.
2. Open the **Activity Log** panel.
3. Select the **Team Live** tab.
4. Review connected devices/operators and, where shown, their current activity and progress for Import/Transfer operations specifically. The panel refreshes automatically roughly every 30 seconds.

**To find and adopt an event another operator already created:**
1. With Team Live enabled and connected, open the event-list screen.
2. Select the **Online Registry** tab.
3. Locate the collection or event by name.
4. Click **"prepare collection"** (to bring the collection folder onto this device) or **"prepare event"** (to also generate that event's `event.json` locally, preserving its exact name, sequence, and components).

## What Happens Next / Expected Result

**Presence/activity**: Devices currently connected appear with their operator name and device name. If another device is actively importing or syncing, its progress (files copied / total, where published) is visible in near-real-time. **A device that has finished an operation, or is running QMZ/Metadata/Audit work, will show as present but will not show meaningful activity detail for that specific operation** — this is expected, not a bug, per the activity-publishing scope confirmed above.

**Event adoption**: The collection/event becomes available on the "Current Device" tab, using the same folder name and identity the original operator used — no independent renaming happens. If a NAS path was available and validated, it's marked `linked`; otherwise `provisional` (still usable in Local Staging, reconciled later through the same path any Local-First-staged collection uses). If the event already existed locally, nothing is overwritten — the existing local copy is used as-is.

## Important Limitations

- No enforced conflict prevention exists today for two operators independently working on the same event, beyond the narrow, hint-only sync-slot gate for Transfer/Sync specifically. Seeing someone else's presence does **not** mean AutoIngest will stop you from also working on the same event. This also applies to event registration/adoption: if two operators independently create an event with the same name at nearly the same moment, whichever registration reaches the server second silently wins — no warning fires (same dormant `conflict:warning` gap, not a separate one).
- Presence data is held only in server memory and is never persisted — a server restart clears it. Stale presence (a device that crashed without disconnecting cleanly) can take up to roughly 55 seconds to clear, governed by the underlying connection library's own ping-timeout, not an application-level staleness check.
- **No photographs or media files ever pass through this system, including during event registration or adoption.** Only small, size-capped status/metadata/event-identity messages are exchanged. The archive's `event.json` remains the sole source of truth for event data; the Registry never replaces or overrides it — an adopted event's `event.json` is generated locally by the same app code that writes any other local `event.json`, not written by the Registry itself.

## Warnings

If the relay server becomes unreachable, import and transfer/sync operations **continue normally** — they do not block on Registry connectivity (confirmed directly in the reconnect/fallback code). Team Live simply shows as offline/reconnecting until the connection returns.

## Troubleshooting

None recorded as a dedicated Troubleshooting Entry yet. Known, evidenced behavior for common questions: a stale "still online" entry after another operator's app crashed is expected for up to ~55 seconds, not a defect requiring a manual fix.

## Related Actions

AI-WF-001 (Import) and AI-WF-005 (Transfer/Backup) are the two workflows whose progress is visible here; AI-WF-002 (Create a New Event) is the local counterpart to event registration/adoption — the same `event.json` validation applies either way; AI-FEAT-045 (Archive Lock Handling) if the real question is about a filesystem-level import lock rather than teamwork visibility.

## Source

`renderer/index.html:8058`; `renderer/renderer.js:2812-2813`; `realtime-server/server.js` (registry persistence — `registry.json`, `registry:register`/`registry:request`/`registry:snapshot` handlers); `realtime-server/README.md`; `services/realtimeOperationsService.js` (`emitRegistryCollection`, `emitRegistryEvent`, incoming `registry:register`/`registry:snapshot` handling); `main/main.js` (`event:write`'s auto-registration, `event:publishRegistry`, `collection:prepareFromRegistry`, `event:prepareFromRegistry` IPC handlers); `main/preload.js` (`registryGetAll`, `prepareCollectionFromRegistry`, `prepareEventFromRegistry`); `renderer/eventCreator.js` (Online Registry tab UI, `_doPrepareCollFromRegistry`, `_doPrepareEventFromRegistry`); `services/offlineCollectionRegistryService.js` (`collection.link.json` linked/provisional reconciliation); `docs/product/features/AI-FEAT-048_*.md`.
