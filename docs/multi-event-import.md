# Multi-Event Import

Source-agnostic import of **one opened source into several events with one final Import**:

> one opened import source → multiple event assignments → one final import

The source can be any source the normal import workflow supports — a camera card, CFexpress media, an external HDD/SSD, a USB/removable drive, an ordinary local folder. Nothing in the assignment, planning, or execution model knows or cares which. Source-specific behavior (for example Eject, which applies only to ejectable media) stays source-specific and lives outside the model.

This document is the technical authority for the feature. Product history lives in `docs/product/` (see AI-FEAT-058 and DEC-019).

---

## 1. Concepts — five things that must never be conflated

| Concept | Owner | Lifetime |
|---|---|---|
| **UI selection** | `selectedFiles` in `renderer/renderer.js` | Transient highlight. Cleared by Clear, by an assignment, by navigation — it is *not* an assignment. |
| **Persistent event assignment** ("ownership") | `ImportSession` (`renderer/importSession.js`) | The source session. Survives selection changes, folder navigation, view/sort changes and event switches. |
| **Current Event** | `EventCreator.getActiveEventData()` + `ImportSession.getCurrentKey()` | The event whose working state the UI is editing right now. |
| **Assigned Event** (of a file) | Derived from the per-event stores | Independent of the Current Event. Changing the Current Event never rewrites it. |
| **Event workspace** | `ImportSession` | Everything event-scoped: currently its own `GroupManager` instance and a set of directly-assigned files. |

`eventPath` (normalized) is the session's **event identity** (`ImportSession.keyOf`). It is what keys workspaces, plan items, ordinals, and metadata batch attribution.

A **source session** is one opened source plus its assignments. The **import plan** is the frozen, per-event result of resolving those assignments (§5).

## 2. State model

```
ImportSession
├── workspaces: Map<eventKey, workspace>
│     workspace = { key, eventData, ordinal, groups, directFiles }
├── ordinals:   Map<eventKey, number>     E1, E2, E3 …  stable for the whole session
└── currentKey
```

* **Ownership is derived, not stored twice.** A file is owned by the workspace whose `GroupManager` or `directFiles` contains it. There is no parallel index that could drift.
* **Exclusivity is enforced by the model.** A source file belongs to at most one event. `GroupManager.assignFiles()` fires an `onClaim(paths)` hook *before* mutating; `ImportSession` uses it to release those paths from every other workspace (groups, and direct files; emptied groups are removed and renumbered by `GroupManager` as usual). `assignDirect()` goes through the same claim. Every UI route — ⌘G chord, drag onto a group card, context menu, Assign button — is covered because the rule lives in the model, not the UI. Explicit reassignment A→B removes the file from A.
* **The exported `GroupManager` is a facade** bound to the Current Event's instance (`GroupManager.bind(instance)`); `createGroupManager()` builds independent instances. All existing group-panel, badge and drag/drop code is unchanged.
* **Ordinals are stable.** An event gets `E<n>` the first time it owns a file and keeps it for the whole session, including after it is cleared and if it later participates again. Remaining events are never renumbered.
* **Empty, non-current workspaces are pruned**; workspaces that own files are never dropped except by `completeEvents()` or `reset()`.

### Extension point: more event-scoped state

The workspace is the single place to hang additional event-scoped working state. Adding a new kind of state (for example per-photo tag refinement, should that feature return to Stable) means:

1. add it to the workspace next to `groups` / `directFiles` (`_makeWorkspace`);
2. release it for the moved paths in `_claim()` and `release()`;
3. rebind/reset it where the `GroupManager` facade is rebound (`_bindTo` / `switchTo`);
4. include it in each plan item in `buildPlan()`.

Nothing else in the session model changes. **Per-Photo Tag Refinement is currently held out of Stable (`ac75466`) and is NOT shipped by this feature**; no placeholder code exists for it.

## 3. How files become assigned

| Event kind | How a file becomes owned | Extra step? |
|---|---|---|
| Multi-component | Putting it in a group (⌘G + number, drag onto a group card, context menu). Group membership *is* ownership. | None |
| Single-component (no groups) | The explicit **Assign to <event>** action in the selection cluster. **Unassign** removes direct assignments. | One explicit action |
| Single-component in metadata-grouping mode | Files placed in metadata groups are owned through the group; other files by **Assign**. | As above |

Rules that keep selection and assignment separate:

* Selecting files never assigns them.
* **Change Event never claims selected files**, and pressing **Import** never auto-assigns anything.
* After Assign / ⌘G the selection is consumed (existing ⌘G behavior); ownership persists.
* Reassigning files that another event owns is allowed and explicit; the toast reports how many moved and from which `E#`.

## 4. Change Event from inside the Import workspace

The existing event picker/creator (`EventMgmt` + `EventCreator`) is reused unchanged; only its exit differs.

1. The context bar's **Change Event** button calls `openEventPickerFromWorkspace()`: it makes sure the Current Event's workspace exists (adopting any grouping already done), records `returnTarget = 'workspace'`, snapshots `EventCreator.captureActiveSelection()`, and opens the picker at the event list (`resetToList`) — **without** resetting groups.
2. Picking an existing event *or creating a new one* dispatches `eventcreator:done`. Because the return target is set, the handler runs `_returnToWorkspaceFromPicker(false)` instead of `showLanding()`.
3. That function **hydrates first (async), then swaps synchronously**: it re-reads the event's components from disk (`EventCreator.reloadForImport` — after `resetToList` and after creation `_eventComps` is blank), then calls `ImportSession.switchTo()` and refreshes the UI. State is never half-switched across an `await`. A stale-guard (`_ecSwitchReq`) protects against overlapping returns.
4. Dismissing the picker (Back / Esc / backdrop) restores the snapshot (`restoreActiveSelection`) — required because choosing a *collection* in the picker mutates EventCreator's active selection immediately, before any event is adopted.
5. The return target is honored only while a **live** workspace exists (`activeSource`, a current session event, and a visible workspace) and clears itself otherwise. The picker can be closed by paths that fire no handled exit (for example card removal → `resetAppState`), and a stale target must never hijack a later landing-screen event change.
6. If anything fails while returning (for example the new event's components cannot be read), EventCreator is restored to the previous event and the session/`GroupManager` facade are rebound to it — EventCreator, the session and the facade always end on the **same** event.

Source-level state is untouched: `activeSource`, `tileMap`, `currentFiles`, folder navigation, sort/view, thumbnails and imported-file indicators all survive, and the source is not rescanned or reselected.

**Editing a participating event is blocked (v1).** `EventCreator.setEditGuard()` rejects editing/renaming an event that owns files in the session (matched by path and by collection + folder name), with an explanation. Editing would change the event key, component ids and sub-event ids that assignments and group mappings are bound to. Events with no assignments stay editable as before.

## 5. Import plan and validation

`ImportSession.buildPlan({ photographer, importMode, fresh, viewPaths })` is pure and deterministic:

* one plan item per participating event, ordered by ordinal;
* each item is routed by the existing `ImportRouter.simulateImport` from **that event's own** groups and event data — never from mutable Current-Event state;
* routing, VIDEO placement, photographer folders and naming are exactly the existing rules (nothing is re-implemented);
* the plan is deep-frozen (except the live `routingEventData` reference) so later UI changes cannot alter it.

Before the review, every participating event is **re-read from disk** (`EventCreator.loadEventSnapshot`, a non-mutating read) and validated — a problem in Event B is reported by name even while Event A is on screen:

| Blocking (per event, names the event) | Non-blocking (accepted at the review) |
|---|---|
| event unreadable / moved · no components · unresolved destination · incomplete component (type + city) · multi-component group with no sub-event · **stale sub-event id** · assigned-without-group in a multi-component event | duplicate sub-event mapping · metadata-grouping group without keyword assignment |

Blocking findings open a dialog with a **Go to E#** button that reopens the picker on that event. Nothing is copied until the whole plan validates and warnings are accepted.

The **combined review** (reusing the existing confirm overlay and `_renderDestinationTree`, once per event) shows each event's destination tree and group→component mapping, one photographer picker (**one photographer per import session** — stored on each plan item so per-event photographers are a UI-only extension later), and one import method. Local First is forced if any participating event exists only in Local Staging.

## 6. Execution — N independent event transactions

`ImportSessionRunner.run(plan, deps)` executes one **existing, unchanged** `import:commitTransaction` per event (locks, copy engine, audit entries, atomic event.json commit, rollback, metadata batch). It decides only ordering and failure isolation.

| Situation | Result |
|---|---|
| Event-local failure (lock busy, destination/mirror problem, event.json write) | That event is `failed`; later events **continue**. |
| Per-file errors inside a committed transaction | Existing continue-on-error; event is `completed-with-errors`, never reported as fully successful. |
| Source-wide fatal (explicit abort, source disconnected / unreadable, "Import was cancelled…") | Run **stops**; remaining events are `not-started`. |

The runner owns abort state because the copy engine resets `isAborted` / `isPaused` at the start of every `copyFileJobs` call — an abort between events would otherwise be lost. Source disconnect (the `renderDrives` path) sets `_multiImportAbort`; the source root is captured synchronously before the first `await`. Pause/Resume keep their existing per-transfer semantics; the pause controls are reset at each event boundary.

### Atomicity contract

* **Transaction atomicity remains per event.** Each event.json is still committed by one atomic transaction and rolled back to `created` on failure.
* **A multi-event source import is an orchestration of independent event transactions and is not filesystem-atomic.** Event-local failures can therefore leave a *partially completed session* (A complete, B failed, C complete). Successfully copied files are never rolled back.
* **Retries never overwrite** (existing rules: same-size skip, different-size rename `_1`/`_2`, never overwrite). They are also kept from re-importing finished work: a same-size check cannot be relied on for JPEG/PNG/TIFF, because post-import metadata tagging rewrites the destination in place and changes its size. So an event that committed with per-file errors stays assigned with **only its failed files** — the files it already copied or same-size-skipped are released from the session.

### After the run

* **Successfully completed events are cleared** from the session, so stale ownership can never cause a second import.
* **Failed and not-started events stay assigned** in full; a **completed-with-errors** event stays assigned with only its failed files (see above). The operator never reconstructs them. Ordinals are not renumbered.
* The source and Current Event stay usable.
* **Source-cleanup eligibility is the union of `copiedFiles` from events whose transaction returned a summary** — never derived from assignments, never broadened. A transaction that threw contributes nothing (same as a failed single-event import). `files:deleteFromSource` still re-validates every file itself.
* **Deep Verify** covers the whole session: transactions of one run share an `importSessionId`, and `checksum:run` accumulates across them.

## 7. Metadata and Local First across events

A multi-event import starts one metadata batch **per event** and they overlap. Batch-scoped state is therefore keyed, not slotted:

* `import:commitTransaction` accepts optional `progressEventPath` and echoes it on every `metadata:progress` payload, so progress is attributed to the batch's *own* event, never to whichever event is current. Payloads without it (single-event imports, retry/reapply) fall back to the previous behavior.
* `renderer/metadataBatchTracker.js` keeps per-batch records and **one pending Local First sync manifest per batch**. One event finishing or failing cannot consume or overwrite another's manifest; a batch that finished before its manifest was registered is written immediately instead of being dropped.
* The legacy scalar `_metaBatch*` globals mirror the most recently started batch; existing status consumers already scope by `_metaBatchEventPath`.
* Metadata correctness is structural: each call carries only its own event's `groups` and `event.json`, so one event's metadata context can never be applied to another's files.

## 8. Reset boundaries

| Action | Assignments |
|---|---|
| Change Current Event | **Kept** (all events' state preserved) |
| Clear UI selection · folder navigation · view/sort change | **Kept** |
| Assign / reassign / unassign | Updated (exclusive) |
| Successful event in a run | That event **cleared** |
| Failed / not-started event in a run | **Kept** for retry |
| Select a different / new source (`selectSource`) | **Reset** |
| Eject · source disconnect · reset app state (`resetAppState`) | **Reset** |
| Leave to home (`_exitToHome`) · change source (`resetWorkspaceState`) | **Reset** |
| Event picker opened from the landing screen (`showEventCreator*`, landing `eventcreator:done`) | **Reset** (there is no workspace to return to) |
| App restart | Nothing persisted — session state is in-memory only |

Group/component state **must never leak across events**. That was previously guaranteed by resetting a singleton on event change; it is now guaranteed by isolated per-event `GroupManager` instances.

## 9. The retained single-event path (transitional)

When the session is one event, groups-only and that event is current (`ImportSession.isLegacyEligible()`), the original single-event import handler still runs unchanged. This is a **deliberate transitional regression-safety decision**, not the intended permanent architecture: the model (`buildPlan`) and runner already treat a single event as a one-event plan, and both paths are meant to converge on the runner once the legacy branch is retired. Routing, metadata semantics and the copy engine are shared, never duplicated. Nothing new appears in the ordinary one-event workflow (no badges, no session strip).

## 10. UI

* **Change Event** button and **Import Session strip** (context bar): one chip per participating event (`E#`, name, file count), plus `assigned · unassigned in this view`.
* **Event badges** `E1/E2/…` on tiles (icon and list views): a squared pill in the theme's mauve accent, distinct from the round-dot group badge. Shown when it adds information (≥2 events participate, the owner is not the Current Event, or the file was assigned directly). Updated through `tileMap` — no grid rebuild.
* **Import button** reads `Import N Assigned Files` in a session; unchanged in the ordinary flow.
* **Run summary**: overall counters plus one row per event (completed / completed-with-errors / failed / not-started, with the reason) and a per-event metadata status.

## 11. Known limitations

* **"Unassigned" counts only files loaded in the current view.** Tree-mode sources are not scanned up front, so the strip and review say "unassigned … in the current view" (tooltip and dialog state that other files are not counted). The safety invariant does not depend on the number: **only explicitly assigned files are ever imported; unloaded or unassigned files are untouched.**
* One photographer per import session (per-event photographers are a UI-only extension; the plan already stores photographer per event).
* Editing/renaming a participating event is blocked until its assignments are removed; there is no re-keying.
* Additional Keywords are not written to files on the current Stable line; this feature does not change metadata semantics.
* Session state is not persisted across an app restart.
* **Direct Archive lock heartbeats.** An event's archive locks and heartbeat timers stay alive until its metadata batch completes. If a lock is genuinely lost, the heartbeat calls the engine-wide `abortCopy()`, which can land in the *next* event's copy; that event then fails as "Import was cancelled", the runner classifies it as source-wide fatal, and the remaining events are `not-started`. Files are safe (the event rolls back) and the operator can retry. This is existing lock behavior surfaced by sequential transactions; it is only reachable when a lock is actually lost.
* **Event identity is the event's resolved path.** If that path changes mid-session (an offline local copy resolving to the archive, or a pending-sync event using its staging path), the same logical event can appear as two events. File ownership stays exclusive and the copy engine's no-overwrite rules still apply, so this is confusing rather than unsafe.

## 12. Files

| File | Role |
|---|---|
| `renderer/importSession.js` | Pure model: workspaces, ownership, exclusivity, ordinals, plan, validation |
| `renderer/importSessionRunner.js` | N-event runner: failure classification, abort state, aggregation |
| `renderer/importSessionUI.js` | Badges, strip, Assign, Change Event round trip, review/issues dialogs, run summary, edit guard |
| `renderer/metadataBatchTracker.js` | Per-batch metadata/Local First manifest state |
| `renderer/groupManager.js` | `createGroupManager()` factory + facade + `onClaim` hook |
| `renderer/eventCreator.js` | `loadEventSnapshot`, `captureActiveSelection`/`restoreActiveSelection`, `preselectEvent`, `setEditGuard` |
| `main/main.js` | Additive: `progressEventPath` echo on `metadata:progress`; `importSessionId` accumulation for `checksum:run` |

## 13. Tests

| Test | Covers |
|---|---|
| `test/importSession.test.js` | Ownership, exclusivity, A→B→A isolation, ordinals, reset/cleanup, plan routing (VIDEO), per-event payload isolation, validation, source-agnostic paths |
| `test/importSessionRunner.test.js` | Event-local vs fatal failure, abort between events, cleanup union, retention, one-event plan |
| `test/metadataBatchTracker.test.js` | Per-batch event identity, independent Local First manifests |
| `test/multiEventImportLive.test.js` | Real Electron + ExifTool: routing, per-event metadata isolation, progress attribution, Deep Verify, duplicate skip, conflict rename, no overwrite, error continuation |
| `test/multiEventImportUiLive.test.js` | Card-style and plain-folder sources; A→B→C→A; no rescan; combined review; one import; cleanup list; source removal (incl. picker open) ; event-local failure + retry; failed picker return; per-file error → retry only the failed file; original single-event path |
| `test/multiEventNewEventUiLive.test.js` | Creating a new event from inside the workspace |
| `test/multiEventLocalFirstUiLive.test.js` | Three events in Local First: independent sync records |

All tests use synthetic fixtures only.
