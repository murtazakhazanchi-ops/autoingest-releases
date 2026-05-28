# AutoIngest v0.9.0 — Internal Testing Release Notes

**Release date:** 2026-05-28  
**Build type:** Internal testing  
**Platform:** macOS (primary), Windows (runtime + realtime server)

---

## Overview

v0.9.0 is a substantial reliability and capability release. It introduces Photographer Folder Sequencing, JSON-backed realtime registry persistence, multi-NAS explicit target routing, and extensive hardening across sync, import, and metadata layers. No architectural regressions from v0.8.x.

---

## 1. New Features

### Photographer Folder Sequencing

- **Sequence Folders** action added to Event Management footer (visible when an existing event is selected on the Create or Select Event screen).
- Opens a drag-to-reorder modal showing photographer folders grouped by sub-event/component.
- Assigns PC-prefix sequence numbers: `PC01-Name`, `PC02-Name`, … `PC999-Name`.
- **Two-phase rename** — all folders move to temp names first, then to final names, so A↔B swaps never collide.
- Sequences written atomically into `photographerSequences` in `event.json` (component-scoped shape).
- Re-runnable: existing sequences are pre-loaded; new photographers appear at the bottom.
- Import routing uses `photographerSequences` to route future imports into the correct `PCxx-Name` folder.
- Sync canonical merge: if the archive already has `PC01-Name` and the local folder is `Name`, sync lands in the existing sequenced archive folder (no duplicate plain-name folder created).
- Multi-component events: each component has its own independent sequencing scope; same photographer can be PC01 in each component.
- Metadata EXIF/IPTC creator field always strips the `PCxx-` prefix — canonical name recorded regardless of folder sequencing state.
- Active-sync blocking: sequencing is blocked while a sync job is running for the event.
- Path safety: main process validates all renderer-provided scope keys and canonical names for path traversal before any filesystem rename.

### JSON-Backed Realtime Registry Persistence

- Realtime server state (connected devices, sync slots, live status) is now persisted to JSON, surviving server restarts.
- Online Registry publication lifecycle hardened: unpublish/re-publish cycles are reliable across device reconnects.
- Team Live coordination and sync slot scheduling fully implemented and stable.

### Windows Realtime Server

- Realtime server is fully functional on Windows (Node.js LTS required).
- One-click `.bat` launcher included in `realtime-server/`.
- Setup instructions below.

---

## 2. Reliability Fixes

### Multi-NAS Explicit Target Routing

- Sync jobs now require an explicitly linked NAS target — no silent fallback to name-identity routing when a collection link exists but is stale or ambiguous.
- Surat NAS and Marol NAS are treated as separate routing targets; a job linked to Surat will not silently route to Marol.
- Stale link detection: if the stored `nasRoot` in `collection.link.json` no longer matches the active device's NAS root, sync is blocked with a clear error rather than routing blindly.

### Collection Link Registry Safety

- `collection.link.json` `registryId` is now preserved through `registry:prepare` operations — linked targets are never overwritten.
- Legacy no-link collections can be promoted to a linked target through the normal match/link flow.

### Import Hardening

- Import commit is now guarded against user-initiated aborts mid-transaction; partial commits are prevented.
- Final import truthfulness: `lastImport` is always derived from `imports[]`, never independently computed.
- Source disconnect during import: if the external drive is ejected mid-import, the operation aborts cleanly rather than writing a corrupt partial state.

### Metadata

- Silent metadata stall at 0% is fixed: the metadata queue now detects stuck jobs and surfaces them as errors rather than hanging indefinitely.
- Photographer/creator fields always reflect the canonical name (PC-prefix stripped) regardless of sequencing state.

---

## 3. Sync / Realtime Changes

- Sync slot scheduling is hardened: concurrent slot conflicts are detected and serialized.
- Realtime sync queue refresh is called after photographer folder renames so the queue reflects the updated folder structure.
- `event.sync.json` path entries are updated component-by-component after rename — single-component and multi-component manifest paths both rewritten correctly.
- Legacy no-link sync jobs are promoted through the match/link flow before running, preventing them from writing to unintended archive locations.

---

## 4. UI Changes

- **Sequence Folders** button appears in the Event Management footer between Edit and Continue, only when an existing event is selected on the event list screen.
- Button is hidden on: Create Collection, Create New Event, Edit Event, and any screen where no existing event is selected.
- `_syncFooterButtons()` in EventMgmt now registers the Sequence Folders button — it is hidden on all mode switches (edit/create/master/repair) and re-appears only on `listSelect`.
- System Overview cards reordered for clarity.
- Archive Location Setup card wording updated.
- Team Live and Online Registry settings organized into focused tabs.

---

## 5. Known Internal-Testing Limitations

| Limitation | Detail |
|---|---|
| Google Sheet telemetry credentials | `service-account-key.json` remains bundled. Acceptable for trusted internal devices only. Do not distribute publicly. |
| Realtime server — no auth | Server accepts all connections on the LAN/VPN. Do not expose port 4040 to the public internet. |
| Realtime server — no HTTPS | Plain HTTP only. Acceptable for trusted LAN/VPN; not suitable for wider deployment. |
| Multi-component archive sync photographer merge | Single-component: canonical merge fully implemented. Multi-component: photographer-level canonical merge inside component dirs on the archive side is implemented for Strategy A (file list sync). Strategy B/C (full-folder sync) uses the existing top-level lookup which is a no-op for component folder names — photographer merge inside component dirs for Strategy B/C is deferred. |
| Sync block heuristic | Active-sync block in `applyPhotographerSequence` uses `jobId.includes(eventFolderName)` — relies on jobIds embedding the event folder name. NAS file locks provide the hard concurrency guard. |

**Public/wider release requirements:**
- Telemetry credential redesign (remove bundled service-account-key.json)
- Realtime server authentication and HTTPS
- Port 4040 must not be exposed publicly

---

## 6. Manual Testing Checklist

### Photographer Folder Sequencing

- [ ] Open Event Management → select existing event → Sequence Folders button appears between Edit and Continue
- [ ] Sequence Folders button hidden on Create Collection screen
- [ ] Sequence Folders button hidden on Create New Event screen
- [ ] Sequence Folders button hidden on Edit Event screen
- [ ] Click Sequence Folders → modal opens
- [ ] Single-component event: photographers listed, drag to reorder, PC prefix previewed
- [ ] Multi-component event: photographers grouped by component, drag within component only
- [ ] Apply → folders renamed on disk with PC prefix
- [ ] Re-open modal → existing sequence pre-loaded
- [ ] New photographer → appears at bottom (unsequenced)
- [ ] Import after sequencing → files route into PCxx-Name folder
- [ ] Sync after sequencing → archive receives files in existing PCxx-Name folder (no duplicate plain-name folder)
- [ ] Metadata creator field after sequencing → canonical name (no PC prefix) in EXIF/IPTC
- [ ] PC01↔PC02 swap → completes without collision

### Multi-NAS Routing

- [ ] Surat NAS linked collection → sync routes to Surat only
- [ ] Marol NAS linked collection → sync routes to Marol only
- [ ] Stale link → sync blocked with error, not silently rerouted
- [ ] registry:prepare on linked collection → registryId preserved

### Import Safety

- [ ] Start import → eject drive mid-import → clean abort, no partial state committed
- [ ] Import commit → lastImport reflects latest imports[] entry
- [ ] Metadata queue → no stuck-at-0% jobs on a normal import

### Realtime / Online Registry

- [ ] Start realtime server → devices connect and appear in Team Live
- [ ] Publish event to Online Registry → appears on connected devices
- [ ] Unpublish → removed on connected devices
- [ ] Server restart → state restored from JSON persistence
- [ ] Sync slot scheduling → concurrent requests serialized correctly

---

## 7. Windows Realtime Server Setup

**Requirements:** Node.js LTS (18.x or 20.x) — download from nodejs.org

### Option A — Manual

```
1. Copy the realtime-server/ folder to the Windows PC.
2. Open Command Prompt or PowerShell in that folder.
3. Run: npm.cmd install
4. Run: node server.js
5. Server starts on port 4040.
```

### Option B — One-click launcher

```
1. Copy the realtime-server/ folder to the Windows PC.
2. Double-click start-server.bat (or equivalent .bat launcher in the folder).
3. Server starts on port 4040.
```

### Connecting AutoIngest clients

In AutoIngest → Settings → Realtime Server:

```
http://<WINDOWS-PC-IP>:4040
```

Example: `http://192.168.1.50:4040`

**Security reminder:** Port 4040 must only be accessible on the trusted LAN or VPN. Do not forward this port through the router.

---

## Commits in this release (since v0.8.8)

```
42eb0e5 feat(event): add photographer folder sequencing   (footer visibility fix)
87a33b2 feat(event): add photographer folder sequencing   (SELECT mode footer)
c4590ce feat(event): add photographer folder sequencing   (core implementation)
e15b1fe fix(sync): protect collection link from registry-prepare overwrites
9e9d831 fix(sync): enforce explicit NAS target routing
956113d chore: update package-lock for realtime scripts addition
83c957b fix(release): close remaining import and testing-readiness gaps
296727e fix(release): guard import commit against user-initiated abort
1f7f4a8 fix(release): stabilize core workflows before testing
8c6c91c fix(realtime): correct team live configuration states
1e547fc fix(realtime): organize team live into focused tabs
dd61493 feat(realtime): add team coordination and sync scheduling
2db145f fix(metadata): prevent silent metadata stalls after import
0cd1867 fix(ui): reorder system overview cards
c9628e0 fix(cross-platform): harden realtime registry and sync workflows
```

---

## Validation performed

All 18 runtime files passed `node --check` before this release:

```
main/main.js                                  PASS
main/preload.js                               PASS
renderer/renderer.js                          PASS
renderer/eventCreator.js                      PASS
renderer/eventMgmt.js                         PASS
renderer/importRouter.js                      PASS
main/exifService.js                           PASS
main/fileManager.js                           PASS
services/settings.js                          PASS
services/realtimeOperationsService.js         PASS
services/archiveSyncService.js                PASS
services/syncQueueService.js                  PASS
services/transferExportService.js             PASS
services/transferImportService.js             PASS
services/offlineCollectionRegistryService.js  PASS
services/photographerSequenceService.js       PASS
services/telemetry.js                         PASS
realtime-server/server.js                     PASS
```
