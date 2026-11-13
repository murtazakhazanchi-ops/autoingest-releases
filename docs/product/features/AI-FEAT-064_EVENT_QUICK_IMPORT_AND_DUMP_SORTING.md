# AI-FEAT-064 — Event Quick Import & Dump Sorting

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-064 |
| Category | Import |
| Status | In active development |
| Stage state | CAM-001 (photographer recognised on card detection, Keychain work isolated in a helper process) released as RC Preview `v0.9.18-rc.4` (`0a95901`, `fix/cam-001-startup-recognition`); not merged to Stable; EQI-2 to EQI-5 planned. *(2026-11-13 earlier:* EQI-1 released as RC Preview `v0.9.18-rc.1` (`4e4fd81`) and used at a live event; EQI-1.1 released as RC Preview `v0.9.18-rc.2` (`000f103`); EQI-1.2 (visual hierarchy and camera-aware photographer suggestions) released as RC Preview `v0.9.18-rc.3` (`cdeb0ea`, `fix/eqi-companion-hierarchy`); not merged to Stable; EQI-2 to EQI-5 planned.)* *(2026-11-13 earlier: EQI-1.1 RC `v0.9.18-rc.2` latest.)* *(2026-11-12: EQI-1 implemented and verified on `feature/event-quick-import-dump`, local, unmerged, unreleased.)* |
| Maturity | Experimental |
| Parent feature | AI-FEAT-061 (Quick Ingest & Desktop Companion) |
| Roadmap milestone | AI-RM-016 — Event Quick Import & Dump Sorting (PRIORITY 1 from 2026-11-12) |
| Dependencies | AI-FEAT-061 Q1–Q3 (companion, capture-date assessment, camera summary); AI-FEAT-063 Q4 learning (unchanged; Dump imports are learning-eligible imports); AI-FEAT-047 multi-event import engine (ImportSessionRunner); existing import transaction, Event Creator, Event Management, Sort QMZ, Delete from Source |
| Not a dependency | AI-FEAT-063 Q5e-2c META, S2–S8 and live photographer renaming (paused, see AI-RM-014) — no demonstrated data-integrity dependency |
| Owner direction | 2026-11-12: highest-priority active milestone, to be used during a live event; incremental, isolated macOS Preview builds, starting with the simplest complete Event Dump import |
| Latest major update | 2026-11-14 — CAM-001 startup photographer recognition, RC Preview `v0.9.18-rc.4` *(2026-11-13 — EQI-1.2 visual hierarchy and camera-aware photographer suggestions, RC Preview `v0.9.18-rc.3`; 2026-11-13 — EQI-1.1 adaptive companion, RC Preview `v0.9.18-rc.2`; 2026-11-12 — milestone created; EQI-1 implemented)* |
| Evidence status | CAM-001 commits `491e7fe` (app) + `0a95901` (tests) on `fix/cam-001-startup-recognition`, published as prerelease `v0.9.18-rc.4` (run 43500830453); macOS verified (unit, isolated live dev, isolated packaged arm64 incl. cold start); Windows NOT verified. *(Earlier:* EQI-1.2 commits `3799164` (app) + `cdeb0ea` (tests) on `fix/eqi-companion-hierarchy`, published as prerelease `v0.9.18-rc.3` (run 43473813921) and verified from the downloaded arm64 artifact; macOS verified (unit, isolated live with screenshots in both themes, isolated packaged arm64); Windows NOT verified. Stable unchanged (`v0.9.17` Latest).)* *(Earlier:* EQI-1.1 commits `b073e48` (app) + `000f103` (tests) on `fix/eqi-companion-adaptive-ui`, published as prerelease `v0.9.18-rc.2` (rc channel) and verified from the downloaded artifacts. macOS verified (unit, isolated live with screenshots, isolated packaged arm64); Windows NOT verified (installer built by CI, untested). Stable unchanged (`v0.9.17` Latest). *2026-11-12: EQI-1 `ede3fcd`, local, unmerged, unreleased.)* |

---

## Lifecycle Metadata

| Field | Value |
|---|---|
| Related features | AI-FEAT-061 (parent: the companion and its Q2/Q3 assessment); AI-FEAT-063 (Q4 learning — Dump imports are learning-eligible; Q5e stages paused); AI-FEAT-047 (multi-event import engine reused) |
| Related decisions | [DEC-027](../decisions/DEC-027_QUICK_INGEST_PRIORITY_AND_MAIN_WINDOW_UI_FREEZE.md) (main-window UI freeze — EQI-1 draws nothing in the main window; its exception is checked line by line in `test/companionQ1UiFreeze.test.js`) |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | None yet |
| Related release notes | GitHub prereleases `v0.9.18-rc.1` (EQI-1), `v0.9.18-rc.2` (EQI-1.1), `v0.9.18-rc.3` (EQI-1.2) and `v0.9.18-rc.4` (CAM-001), rc channel only; no Stable release notes *(previously: not released)* |
| Testing coverage | `test/eventDumpQuickImportEQI1.test.js` (unit), `test/eventDumpQuickImportLive.test.js` and `test/eventDumpRoundTripRecoveryLive.test.js` (isolated live, real companion popup), EQI-1.1: `test/eqiCompanionAdaptiveEQI11.test.js` (unit) and `test/eqiCompanionAdaptiveLive.test.js` (isolated live, window bounds + screenshots, sanitized real-world Dump fixture `test/fixtures/eqi11-realworld-dump-event.json`); EQI-1.2: `test/eqiCompanionHierarchyEQI12.test.js` (unit: suggestion states, registry unavailable, peek never opens, no Keychain access) and `test/eqiCompanionHierarchyLive.test.js` (isolated live, synthetic cards and in-memory registry, screenshots in both themes); CAM-001: `test/cam001RegistryStartup.test.js` (unit: helper adapter, store, child process, static guards) and `test/cam001StartupRecognitionLive.test.js` (isolated live: cold start, insert after launch, stalled/denied/crashed Keychain helper, missing key, corrupt registry, card swap, confirmation and Event Dump import); the EQI-1 exceptions in the stage-boundary/UI-freeze guards; isolated packaged macOS runs recorded in the EQI-1/EQI-1.1 reports |
| Documentation completeness | Rules, stage plan and EQI-1 behaviour recorded; technical docs under `docs/` not updated while unmerged |

## 1. Purpose

Let an operator covering a live event import a card from the menu bar straight into the event — one click, no grouping or component mapping at import time — into an unsorted **Dump**, and sort it into the event's final folders later with the tools AutoIngest already has.

## 2. Agreed rules (owner-approved 2026-11-12) — apply to every stage

### 2.1 The original Quick Import concept stays authoritative
When a card is inserted the companion discovers camera media with the existing discovery rules, groups it by capture date, shows today first, selects the eligible **new** photos of the chosen date, identifies already-imported files, shows other dates with new/imported counts, lets earlier unimported photos be selected, and may suggest a photographer (Q3/Q4) without ever assuming one. Established companion behaviour is never removed.

"New" is **file-level** (reliable per-file history), never "since the last import": an older batch that was never imported stays eligible after a newer batch was.

### 2.2 Default: everything selected → one event
Event Dump mode selects every eligible new photo of today, uses the currently selected event and the selected/confirmed photographer, and imports everything into that one event's Dump. No automatic splitting, no time entry. **Divide Photos Between Events** (EQI-2) is a secondary option; only opening it reveals multi-event controls. The standard non-event Quick Import destination remains a separate existing mode.

### 2.3 Event selection and creation
The companion shows the selected event, allows switching to another existing event, remembers the last successful event where appropriate, and revalidates the event and archive root before importing. **Create New Event** reuses the **existing Event Creator** (no second, simplified form): Menu Bar → Create New Event → existing Event Creator → Create → back to the menu bar with the new event selected. Collection rules, Event Type, Location, mandatory City, Hijri year and naming, sequence allocation, Multi-NAS root resolution and event.json creation/validation are the existing ones. Event creation and import are separate durable operations; cancelling restores the previous companion state.

### 2.4 Event Dump destination

```
Event/
  Dump/
    <Photographer Name>/        ← plain name, NEVER PCxx
      <imported media>          (videos in VIDEO/, as in every import)
```

- Never a PCxx sequence inside Dump; Dump allocates, consumes or reserves no PC number.
- A later import by the same photographer reuses its Dump folder; repeated imports preserve what is there.
- Dump is never an event component, a photographer, a QMZ container or a final archive folder.
- RAW/JPEG relationships, sidecar conventions, import provenance, metadata history and photographer-identity evidence are preserved.
- The existing validated import engine is used, in Local First and Direct Archive modes. A missing archive location is never guessed.
- Backend guards reject any attempt to sequence a Dump photographer folder.

### 2.5 Multi-event assignment (EQI-2, planned)
Manual date/time ranges (several per event, non-contiguous, short gaps, interrupting events, crossing midnight); thumbnail boundary selection with **Split Here** on the existing thumbnail pipeline; optional gap suggestions (30/60/90/120 min) that never assign anything automatically. One clear destination per asset, RAW/JPEG pairs kept together, unassigned photos stay on the card, overlap warnings, event identity never inferred from time alone, existing events or the existing Event Creator, executed through **one** existing multi-event import transaction. Each event's Dump stays unsequenced.

### 2.6 Sort Dump (EQI-3, planned)
**Event Management → Event Name → Sort Dump**, beside Sort QMZ (whose behaviour is unchanged); shown only while the event has unsorted Dump media. Opens the **existing Import Workspace** in a Dump mode (Dump hierarchy on the left, thumbnail grid, selection, preview, G1/G2/G3, component/group mapping, tag refinement); source-photographer sequence entry hidden. Sorting **moves** (never duplicates) media into the final component/photographer folders under the existing PCxx rules (the same photographer may hold different numbers in different scopes), through a crash-recoverable move/finalization transaction: no silent overwrite, no duplicate provenance, a Dump source removed only after the destination and event records are durably verified. Empty Dump photographer folders: "This photographer folder is now empty. Would you like to delete it?" — Delete Empty Folder / Keep Folder, emptiness rechecked immediately before deletion, never removed with hidden metadata, failed files or unresolved operations inside.

### 2.7 Safe source-card cleanup (EQI-4, planned)
Diagnose why the existing Delete from Source works once and fails on later deletions in the same session; one shared cleanup service for Quick Import, single- and multi-event Dump and normal Event Import. Only copied-and-verified files, explicit confirmation, recoverable volume-local Trash only (macOS and Windows where supported), never permanent deletion, never unassigned/failed files, RAW/JPEG pairs protected, repeatable in one session with accurate status and safe retries, card and file identity revalidated first. Unsupported Trash → source untouched and the reason explained. **Off by default** until independently verified.

### 2.8 Compatibility (all stages)
Stable v0.9.17 QMZ attribution protections, Q4 learning, Q5 registry, the Q5 rename gate and S1 mapping-write restriction, Metadata Audit & Repair rules, event.json coordination, local/NAS archive identity, multi-event recovery, operator and source-lock behaviour are all preserved. No staging/NAS divergence, no ambiguous photographer assumption, no unverified source deletion.

## 3. Stages

| Stage | Scope | State |
|---|---|---|
| EQI-0 | Discovery, architecture, roadmap update | Done 2026-11-12 |
| EQI-1 | Menu-bar Event Dump Quick Import (single destination) | **Released as RC Preview `v0.9.18-rc.1`** (`4e4fd81`); used at a live event 2026-11-12 (89 files: 88 CR3 + 1 MP4 into `Event/Dump/<Photographer>/`, unsequenced, metadata complete, source untouched). *(Earlier: implemented and verified on `feature/event-quick-import-dump`, awaiting owner review.)* |
| EQI-1.1 | Adaptive menu-bar companion & live-event usability stabilization | **Released as RC Preview `v0.9.18-rc.2`** (`000f103`) — awaiting owner live-event feedback; not Stable |
| EQI-1.2 | Visual hierarchy & camera-aware photographer suggestions | **Released as RC Preview `v0.9.18-rc.3`** (`cdeb0ea`) — awaiting owner feedback; not Stable |
| CAM-001 | Immediate photographer recognition on card detection (Keychain work off the main process) | **Released as RC Preview `v0.9.18-rc.4`** (`0a95901`) — awaiting owner feedback; not Stable |
| EQI-2 | Multi-event manual time assignment | Planned — not started |
| EQI-3 | Sort Dump through the existing Import Workspace | Planned — not started |
| EQI-4 | Safe source cleanup and repeated-session deletion fix | Planned — not started |
| EQI-5 | Integrated regression, Windows verification, release readiness | Planned — not started |

## 4. Implemented behaviour — EQI-1 (fact; `feature/event-quick-import-dump`)

- **Companion (menu bar)**: per card a *Review in AutoIngest | Event Dump* switch (Review stays the starting mode; the last choice is remembered for the session). Event Dump shows the main window's active event (names only), *Change event* / *Create New Event*, a photographer picker from the app's photographer list (never preselected; the last photographer used this session offered as a one-tap suggestion), new/already-imported counts for the shoot date, an optional "also import N new files from earlier dates", and **Import N files to Dump** with progress, copied/skipped/failed counts and the metadata outcome.
- **"New"** = the existing global import index (filename + size), the same file-level history the workspace uses. Undated files are never selected.
- **The import runs in the main window's existing machinery** — `ImportRouter.buildDumpFileJobs` → `ImportSessionRunner` (one-event plan) → the shared per-event prepare step (Local First mirror + remap, extracted unchanged from the multi-event import) → `commitImportTransaction(destination: 'dump')` → Local First sync registration — so locks, the atomic event.json commit, metadata, verification, import index and learning are the validated paths.
- **Import mode** follows the Confirm Event Import rule: pending-local or staging-started events use Local First; otherwise the archive default. Direct Archive refuses when the archive is offline or the folder is locked by another computer.
- **Event Creator**: the existing event list / Event Creator opens in the main window (from a live Import workspace without disturbing its assignments); once an event is chosen or created the companion shows it and reopens.
- **Provenance**: the event.json `imports[]` entry carries `destination: "dump"` and `componentName: "Dump"` (additive; `componentIndex` stays a number, so older builds keep the entry). The learning workflow label is `event-dump-import`.
- **No-sequencing guards**: Sequence Photographer Folders never offers Dump or its folders; renaming, scope resolution and recording a sequence for any scope inside Dump are refused (`dump-not-sequenceable`); the import transaction refuses a Dump import whose destinations are not exactly `<event>/Dump/<photographer>/[VIDEO/]<file>` with a plain (non-PC) photographer name.
- **Attribution**: Audit, Repair and resume resolve the photographer of `Dump/<Name>/…` as `<Name>` (never "Dump", never the last import's photographer); in multi-component events a Dump file reconstructs as the explicit no-component group the import wrote, not as ambiguous.
- **Not in EQI-1**: Divide Photos Between Events, Sort Dump, source deletion (unchanged and off), registry-based photographer suggestion in the companion (Q4 suggestions are not yet wired to the companion; opening the encrypted registry from the menu bar is deferred until the Keychain/main-thread risk recorded on AI-RM-014 is addressed), Windows.

## 4a. Implemented behaviour — EQI-1.1 (fact; `fix/eqi-companion-adaptive-ui`, RC `v0.9.18-rc.2`)

Live-event feedback on RC.1: the popup was too narrow, the event name was cut off, the photographer dropdown held hundreds of names, the scrollbar was oversized, Change Event went through the main window, and Import to Dump brought the main window forward. EQI-1.1 replaces the companion part of §4 (the per-card *Review | Event Dump* switch); the import path, Dump rules and guards in §4 are unchanged.

- **Two presentations of one popup window**: compact card overview (360 px; per card the Q2/Q3 assessment, *Review Selected Date*, *Event Dump*, import status) and expanded Event Dump (620 × 720 px), each fitted to the display's work area, kept under the menu-bar icon and re-fitted when displays change. *← Card Overview* returns to compact. Card, event and photographer choices survive view switches and closing/reopening the popup.
- **Selected Event**: the complete canonical event name in its own section, wrapping, never truncated; *Change Event* and *Create New Event* beneath it; destination preview `Collection / Event / Dump / Photographer`.
- **Photographer search**: a combobox over the app's existing photographer list — case-, accent- and punctuation-insensitive, partial and word-prefix matching (a stored initial may be omitted: "Murtaza Kha" finds "M Murtaza Khazanchi"), Up/Down/Enter/Escape. Typed text is never a selection; nothing is ever created; no registry/Keychain access from the menu bar.
- **One-click Change Event**: a companion-owned searchable picker listing the collection's events from the Event Creator's own scan (valid event.json only). The main window adopts the chosen event through its startup restore path **without coming forward** and its home card is refreshed. With an Import workspace open, the existing main-window picker opens instead (assignments untouched).
- **Create New Event**: opens the existing Event Creator in the main window in one click (architectural fallback — the Creator is coupled to the main window's DOM; extracting it into a separate window was judged unsafe). The companion returns to the expanded view afterwards; cancel keeps every choice.
- **Import to Dump stays in the background**: root cause on RC.1 — the workspace handoff called `openApp()` unconditionally. Now the main window is opened only if its renderer is not ready (e.g. closed on macOS, where splash/sign-in are needed). Progress and completion are shown in the companion. Safety dialogs (busy archive / locks) still bring the main window forward so the operator sees them; no lock is cleared without the operator's explicit choice; nothing is deleted from the source.
- **Scrolling**: thin theme-matched scrollbars; no horizontal scrolling. Dark and light themes both verified on screenshots.
- **Unchanged**: Dump folders never PC-sequenced; date filtering; the image-data re-import guard (`4e4fd81`); Local First behaviour and its documented limitation; the original Quick Import concept.

## 4b. Implemented behaviour — EQI-1.2 (fact; `fix/eqi-companion-hierarchy`, RC `v0.9.18-rc.3`)

Owner direction 2026-11-13: make the companion easier to read at a glance and suggest the photographer from the camera using the existing Q3–Q5 identity work. §4a stays valid except for the layout changes below; the import path, Dump rules and guards are unchanged.

- **Compact overview** (same 360 px window): per card the label and connection state, camera model and identity badge, a large **N NEW** count beside the shoot-date selector, the captured/earlier counts once (no repeated numbers), a one-line camera recognition indicator, and **Quick Import** / **Event Dump**. *Review earlier files* and *After midnight* sit on one quiet line beneath.
- **Expanded Event Dump** (same 620 px window), top to bottom: source (card, camera, big new count, date, counts) → **Importing into** panel (collection; the canonical event name exactly as stored, with the date and sequence emphasised; chips for date, event number, event types, location and component count; *Change Event* / *Create New Event*) → **Photographer** panel → **Destination** as `short event / Dump / Photographer`, with the full `Collection / Event / Dump / Photographer` path under *Full path* → the ready line and the Import button.
- **Camera-based suggestions** — `services/companionPhotographerSuggestion.js` composes the existing chain only: Q3 `assessCameras` (the card's own assessment) → Q4 `protectCameraGroups` + `matchCamera` → `photographerSuggestion.suggestForCameras` (retired profiles excluded) → official names mapped onto the app's photographer list. No new database, no new learning.
  - *Confirmed*: one photographer whose association with this camera body is confirmed — shown as "Camera confirmed for X" with a highlighted **Use X** button.
  - *Observed*: one photographer seen with this body but never confirmed — "seen with X, not confirmed".
  - *Multiple*: a shared camera or several bodies on the card — every candidate offered, none highlighted.
  - *Unknown*: nothing asserted; the reason is shown (camera not recognised, model-only evidence, conflicting evidence, no history, registry not open, learning switched off). Model make/model alone never names anyone.
  - *Last used this session* is offered separately and labelled as such.
  - Nothing is ever selected automatically: Import stays disabled until the operator clicks *Use X* or picks a name in the search. Typing never creates a photographer. Each card's suggestion is computed from that card's own evidence, so switching cards cannot show another card's photographer.
- **Keychain dependency (exact)**: body matching needs the registry's key, which is read through Electron `safeStorage` (a synchronous Keychain call on the main thread — the freeze risk recorded on AI-RM-014). The menu bar therefore **never opens the registry**. `photographerLearningRuntime.peekOpenRegistry()` reuses the registry only if this process already opened it — after a learning-eligible import (learning is on by default) or a Q5d registry decision in the main window. Before that the popup says "Camera recognition starts after the first import this session" (or that learning is off) and offers search and last-used only.
- **Event labels**: the workspace handoff now also passes the active event's type and location labels (sanitised strings) for the chips; the event name itself is never altered.
- **Unchanged**: import engine, Dump unsequenced rules, metadata and attribution, duplicate detection, locking, Local First / NAS sync, Event Creator and picker, registry schema and safety gates, app identity and profile.

## 4c. Implemented behaviour — CAM-001 startup photographer recognition (fact; `fix/cam-001-startup-recognition`, RC `v0.9.18-rc.4`)

Owner priority 2026-11-14 (before EQI-2): recognise the photographer as soon as a card is read, with no import needed in the session and without blocking Electron. This supersedes the "never opens the registry / starts after the first import" part of §4b; everything else in §4b stands.

- **Root cause of the delay**: the Q5 registry was opened only by import learning or a Q5d decision, and `peekOpenRegistry()` only reused an already-open store — so body matching appeared only after the first import. **Root cause of the freeze risk**: Electron `safeStorage` reads the "<app name> Safe Storage" Keychain item synchronously on the calling thread; in the main process a pending macOS access prompt (e.g. a new ad-hoc-signed build) or a stalled Keychain blocked the whole app.
- **Process isolation** (`services/secureStorageHelper.js`, `services/secureStorageHelperProcess.js`): on macOS the main process never calls `safeStorage`. It launches the app's own executable with `--autoingest-key-helper` and its app name as the expected identity; the windowless helper (no Dock icon, throwaway user-data directory) refuses to run under any other name, so it uses the same Keychain item and the same access rules — no key migration, no other item, no bypassed prompt. Requests and replies cross a private stdin/stdout pipe; errors carry codes only (`secure-storage-timeout`, `-helper-failed`, `-op-failed`), never key material or OS messages. Timeouts: start 30 s, request 300 s (long enough to answer a prompt); "waiting" after 2 s; the helper ends after 3 s idle. Windows/Linux keep the in-process adapter (DPAPI has no prompt) — unverified on Windows.
- **Startup** (`photographerLearningRuntime.startRegistryForSuggestions()`, called after the companion starts): opens the existing healthy registry only (read-only inspection first; never creates a registry or a key). Readiness phases `starting` → `waiting-keychain` → `ready` | `unavailable` (`no-registry`, `registry-locked`, `registry-unavailable`) | `off` (learning switched off). Every change pushes a fresh companion snapshot, so an attached card refreshes by itself.
- **Key failures**: refused access → "Keychain access was not granted"; a timed-out or crashed helper → "Could not read the camera key — retrying in the background" (at most once a minute); a missing or undecryptable key is reported, never regenerated. A transient helper failure never creates a key-less registry.
- **Companion**: while starting — "Checking camera history — this updates by itself"; while a prompt is pending — "Waiting for Keychain access — if macOS asks, allow AutoIngest to use its key". Search, last-used, Quick Import and Event Dump stay available throughout. Selection rules unchanged from §4b (confirmed offered prominently, multiple listed with none highlighted, unknown/model-only never name anyone, nothing auto-selected).
- **Known side effect**: if a registry exists but its Keychain item does not, the startup key read lets macOS create the app's own (empty-history) Safe Storage item — the existing key file is not replaced and stays undecryptable, as before. Previously the same happened at the first import or Q5d decision.
- **Unchanged**: registry encryption format, key files, app name, bundle ID, profile, import engine, Dump rules, Q5 browser (read-only; it shows the open store once startup has opened it).

## Engineering Evolution

**Initial implementation**: EQI-1 (2026-11-12) on `feature/event-quick-import-dump` — `ede3fcd`, not merged.

**Architectural / workflow decisions**: the companion requests the import and the main window's existing import machinery runs it (no second copy engine, no second event form); the import-mode rule and the per-event prepare step are shared with the existing imports rather than re-implemented. *Rejected*: running the import in the companion's main-process layer (would duplicate Local First mirroring, lock checks and sync registration that live in the renderer); a simplified event form in the companion (the brief requires the existing Event Creator).

**Other dated milestones**: 2026-11-12 — milestone, rules and EQI-1; EQI-1 RC `v0.9.18-rc.1` (`4e4fd81`) and live-event use. 2026-11-13 — EQI-1.1 adaptive companion, RC `v0.9.18-rc.2` (`000f103`); EQI-1.2 hierarchy and camera suggestions, RC `v0.9.18-rc.3` (`cdeb0ea`). 2026-11-14 — CAM-001 startup recognition, RC `v0.9.18-rc.4` (`0a95901`).

## 5. Evidence

EQI-1 commit `ede3fcd` on `feature/event-quick-import-dump`:
- `test/eventDumpQuickImportEQI1.test.js` — 19/19.
- `test/eventDumpQuickImportLive.test.js` — 37/37 (isolated dev Electron, real companion popup), and 37/37 against an isolated packaged arm64 build of `ede3fcd` (test-only identity, bundled ExifTool 13.00, real `node_modules`, no symlinks); packaged attribution verifier 33/33.
- Regression on the branch: unit 91 pass / 3 inherited Stable QMZ failures (A5, D4, TEST 1); live 25 suites pass; `companionQ1Live` intermittently fails on a popup-closed race that the Q5 baseline `60055ae` shows too (2 of 3 baseline runs) — inherited, not EQI-1.
- An unpublished, ad-hoc-signed experimental Preview (`0.9.18-eqi1.experimental.1`, arm64) was built locally from `ede3fcd`; it is not released, and Gatekeeper rejects it (no Developer ID on the build machine — the existing release workflow signs only in CI on tag push).

EQI-1.1 commits `b073e48` + `000f103` (`fix/eqi-companion-adaptive-ui`, from `bf822c0`):
- `test/eqiCompanionAdaptiveEQI11.test.js` — 11/11; `test/eqiCompanionAdaptiveLive.test.js` — 47/47 dev and 47/47 packaged arm64 (test-only identity), screenshots of every state in both themes inspected.
- Packaged (test identity, built from `000f103`): `eventDumpQuickImportLive` 37/37, `eventDumpRoundTripRecoveryLive` 69/69, attribution verifier 33/33.
- Regression: unit 90 pass + guard fixed (allow-list) / inherited QMZ failures A5, D4, TEST 1 unchanged; `qmzExpandedTypesRegression` run time is load-dependent (408 s on the RC.1 baseline). Focused live (companion, Event Dump, EQI, multi-event; 14 suites) all pass after fixing a `.card-label` selector collision found by `companionAutoPopupLive`/`companionQ1Live`.
- RC `v0.9.18-rc.2`: release branch `release/v0.9.18-rc.2` @ `000f103`, workflow_dispatch run 43413383248 (rc-tag, rc-build-mac, rc-build-windows succeeded; Stable jobs skipped); downloaded arm64 app = 0.9.18-rc.2 / `com.autoingest.app`, key files byte-identical to `000f103`, no `test/` in the asar, bundled ExifTool 13.00; ad-hoc signature (unsigned-mac RC path, as RC.1). Inherited: `rc-mac.yml` lists only the x64 files.

Windows: **not verified**.

EQI-1.2 commits `3799164` + `cdeb0ea` (`fix/eqi-companion-hierarchy`, from `000f103`):
- `test/eqiCompanionHierarchyEQI12.test.js` — 14/14; `test/eqiCompanionHierarchyLive.test.js` — 37/37 dev and 37/37 packaged arm64 (test-only identity); 16 screenshots (8 states × dark/light) inspected; `test/eqiCompanionAdaptiveLive.test.js` 47/47 dev and packaged (destination check moved to the full-path line).
- Packaged (test identity, built from `cdeb0ea`): `eventDumpQuickImportLive` 37/37, `eventDumpRoundTripRecoveryLive` 69/69, attribution verifier 33/33; no test Keychain item left; production Keychain items unchanged (presence only).
- Regression: unit 91/96 — inherited QMZ A5, D4 and TEST 1 (`qmzExpandedTypesRegression` fails only D4); `qmzSequenceEnhancementsCombinedRegression` passed on an isolated rerun (825 s; it also hit the 900 s cap on the RC.2 baseline); `qmzAdditionalSequencesRegression` reports all 24 checks passed but its process exceeds the runner's 900 s cap — sequencing suites, untouched by EQI-1.2; live 20/21, `eventDumpRoundTripRecoveryLive` failed once on a Playwright "promise garbage collected" error under load and passed on an isolated rerun.
- RC `v0.9.18-rc.3`: release branch `release/v0.9.18-rc.3` @ `cdeb0ea`, workflow_dispatch run 43473813921 (rc-tag, rc-build-mac, rc-build-windows succeeded; Stable jobs skipped); tag `v0.9.18-rc.3` → `cdeb0ea`; downloaded arm64 app = 0.9.18-rc.3 / `com.autoingest.app`, every changed file byte-identical to `cdeb0ea`, no `test/` in the asar, ExifTool 13.00, ad-hoc signature. `v0.9.17` still Latest; `stable/0.9` still `e78fdd0`. Inherited: `rc-mac.yml` lists only the x64 files.

CAM-001 commits `491e7fe` + `0a95901` (`fix/cam-001-startup-recognition`, from `cdeb0ea`):
- `test/cam001RegistryStartup.test.js` — 23/23. `test/cam001StartupRecognitionLive.test.js` — 47/47 dev Electron; packaged arm64 (test-only identity, built from `0a95901`) all checks passed in 2 of 3 runs. In the third, all recognition checks passed, then the test's Playwright wait for the main window timed out before the import step (not reproduced; test-harness intermittent). Measured: card inserted right after launch confirmed 5.5–5.6 s after launch, before any import; under a simulated 20 s Keychain stall the main process answered 39 round trips (max 3 ms), the tray popup opened in 11–13 ms, and a swapped card was recognised by itself when the key arrived; a 2.5 s main-thread block control is detected by the same probe. Registry and key files byte-identical across all launches; test Keychain item removed; production Keychain items unchanged (presence only); no helper temp profiles left.
- Packaged (test identity, `0a95901`): `eqiCompanionHierarchyLive`, `eqiCompanionAdaptiveLive`, `eventDumpQuickImportLive`, `eventDumpRoundTripRecoveryLive` and the attribution verifier all pass. The first packaged pass found a test-tooling defect: the packaged conversion of the CAM-001 test removed the dev harness's Keychain item name instead of the packaged test app's, leaving the test item behind; fixed in the conversion and rerun clean.
- Regression: unit and live 107 pass / 7 fail. 5 are the inherited QMZ failures (A5, D4, TEST 1) and 900 s-cap suites, unchanged. 2 were `photographerRegistryQ5aLive`/`Q5cLive`: their locked/corrupt/no-Keychain-item checks assumed the registry stays closed until the user opens it. These states are now set up before a launch (startup recognition meets them first), and the test identity's Safe Storage item is removed after the run. Both pass.
- RC `v0.9.18-rc.4`: release branch `release/v0.9.18-rc.4` @ `0a95901`, workflow_dispatch run 43500830453 (rc-tag, rc-build-mac, rc-build-windows succeeded; Stable jobs skipped); tag `v0.9.18-rc.4` → `0a95901`; downloaded arm64 app = 0.9.18-rc.4 / `com.autoingest.app`, all 151 app files byte-identical to `0a95901`, no `test/` in the asar, ExifTool 13.00, ad-hoc signature. `v0.9.17` still Latest; `stable/0.9` still `e78fdd0`. Inherited: `rc-mac.yml` lists only the x64 files. Windows: **not verified**.
