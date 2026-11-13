# AI-FEAT-064 — Event Quick Import & Dump Sorting

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-064 |
| Category | Import |
| Status | In active development |
| Stage state | EQI-1 released as RC Preview `v0.9.18-rc.1` (`4e4fd81`) and used at a live event; EQI-1.1 (adaptive companion stabilization) released as RC Preview `v0.9.18-rc.2` (`000f103`, `fix/eqi-companion-adaptive-ui`); not merged to Stable; EQI-2 to EQI-5 planned. *(2026-11-12: EQI-1 implemented and verified on `feature/event-quick-import-dump`, local, unmerged, unreleased.)* |
| Maturity | Experimental |
| Parent feature | AI-FEAT-061 (Quick Ingest & Desktop Companion) |
| Roadmap milestone | AI-RM-016 — Event Quick Import & Dump Sorting (PRIORITY 1 from 2026-11-12) |
| Dependencies | AI-FEAT-061 Q1–Q3 (companion, capture-date assessment, camera summary); AI-FEAT-063 Q4 learning (unchanged; Dump imports are learning-eligible imports); AI-FEAT-047 multi-event import engine (ImportSessionRunner); existing import transaction, Event Creator, Event Management, Sort QMZ, Delete from Source |
| Not a dependency | AI-FEAT-063 Q5e-2c META, S2–S8 and live photographer renaming (paused, see AI-RM-014) — no demonstrated data-integrity dependency |
| Owner direction | 2026-11-12: highest-priority active milestone, to be used during a live event; incremental, isolated macOS Preview builds, starting with the simplest complete Event Dump import |
| Latest major update | 2026-11-13 — EQI-1.1 adaptive companion, RC Preview `v0.9.18-rc.2` *(2026-11-12 — milestone created; EQI-1 implemented)* |
| Evidence status | EQI-1.1 commits `b073e48` (app) + `000f103` (tests) on `fix/eqi-companion-adaptive-ui`, published as prerelease `v0.9.18-rc.2` (rc channel) and verified from the downloaded artifacts. macOS verified (unit, isolated live with screenshots, isolated packaged arm64); Windows NOT verified (installer built by CI, untested). Stable unchanged (`v0.9.17` Latest). *(2026-11-12: EQI-1 `ede3fcd`, local, unmerged, unreleased.)* |

---

## Lifecycle Metadata

| Field | Value |
|---|---|
| Related features | AI-FEAT-061 (parent: the companion and its Q2/Q3 assessment); AI-FEAT-063 (Q4 learning — Dump imports are learning-eligible; Q5e stages paused); AI-FEAT-047 (multi-event import engine reused) |
| Related decisions | [DEC-027](../decisions/DEC-027_QUICK_INGEST_PRIORITY_AND_MAIN_WINDOW_UI_FREEZE.md) (main-window UI freeze — EQI-1 draws nothing in the main window; its exception is checked line by line in `test/companionQ1UiFreeze.test.js`) |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | None yet |
| Related release notes | GitHub prereleases `v0.9.18-rc.1` (EQI-1) and `v0.9.18-rc.2` (EQI-1.1), rc channel only; no Stable release notes *(previously: not released)* |
| Testing coverage | `test/eventDumpQuickImportEQI1.test.js` (unit), `test/eventDumpQuickImportLive.test.js` and `test/eventDumpRoundTripRecoveryLive.test.js` (isolated live, real companion popup), EQI-1.1: `test/eqiCompanionAdaptiveEQI11.test.js` (unit) and `test/eqiCompanionAdaptiveLive.test.js` (isolated live, window bounds + screenshots, sanitized real-world Dump fixture `test/fixtures/eqi11-realworld-dump-event.json`); the EQI-1 exceptions in the stage-boundary/UI-freeze guards; isolated packaged macOS runs recorded in the EQI-1/EQI-1.1 reports |
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

## Engineering Evolution

**Initial implementation**: EQI-1 (2026-11-12) on `feature/event-quick-import-dump` — `ede3fcd`, not merged.

**Architectural / workflow decisions**: the companion requests the import and the main window's existing import machinery runs it (no second copy engine, no second event form); the import-mode rule and the per-event prepare step are shared with the existing imports rather than re-implemented. *Rejected*: running the import in the companion's main-process layer (would duplicate Local First mirroring, lock checks and sync registration that live in the renderer); a simplified event form in the companion (the brief requires the existing Event Creator).

**Other dated milestones**: 2026-11-12 — milestone, rules and EQI-1; EQI-1 RC `v0.9.18-rc.1` (`4e4fd81`) and live-event use. 2026-11-13 — EQI-1.1 adaptive companion, RC `v0.9.18-rc.2` (`000f103`).

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
