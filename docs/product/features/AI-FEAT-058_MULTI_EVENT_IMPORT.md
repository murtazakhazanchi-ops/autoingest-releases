# AI-FEAT-058 — Multi-Event Import

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-058 |
| Category | Import and Archive Writing |
| Status | In active development |
| Maturity | Experimental |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-017 (Grouping System — per-event instances), AI-FEAT-018 (Event-Component Import Routing), AI-FEAT-019 (Import Pipeline & Copy Engine), AI-FEAT-021 (Atomic Import Transaction), AI-FEAT-009 / AI-FEAT-010 (Event Creation / Management — reused picker and creator), AI-FEAT-012 (Source Selection) |
| Related roadmap milestone | AI-RM-011 |
| Related technical docs | `docs/multi-event-import.md`, `docs/group-manager.md`, `docs/ingestion-flow.md`, `docs/system-contracts.md`, `docs/ui-system.md`, `docs/features.md` #16 |
| Evidence status | Verified from current code (branch `feature/multi-event-import`, uncommitted at the time of writing), tests, and live synthetic runs. Not yet merged to `stable/0.9` or released — see Status. |
| First-known implementation | 2026-09-20 (branch created from `stable/0.9`; implementation and verification the same session) |
| Latest major update | 2026-09-20 |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below

| Field | Value |
|---|---|
| Related features | AI-FEAT-020 (Duplicate Detection — retry safety), AI-FEAT-024 (Source Cleanup — eligibility is unchanged and never broadened), AI-FEAT-025 (Checksum-Based File Verification — Deep Verify now accumulates across a session), AI-FEAT-028 (Import Source Attribution), AI-FEAT-029 (Metadata Writing Engine — per-event context), AI-FEAT-044 (Local-First Background Archive Sync — per-event sync manifests) |
| Related decisions | [DEC-019](../decisions/DEC-019_MULTI_EVENT_IMPORT_ARCHITECTURE.md) |
| Related bugs | None recorded — the single-slot hazards found (see Engineering Evolution) were latent assumptions discovered during design, not defects observed in shipped behavior |
| Related postmortems | None |
| Related architectural evolution sections | [11_ARCHITECTURAL_EVOLUTION.md](../11_ARCHITECTURAL_EVOLUTION.md) — "Multi-Event Import Architecture" |
| Related release notes | Evidence pending — not yet released |
| Testing coverage | `test/importSession.test.js`, `test/importSessionRunner.test.js`, `test/metadataBatchTracker.test.js`, `test/multiEventImportLive.test.js`, `test/multiEventImportUiLive.test.js`, `test/multiEventNewEventUiLive.test.js`, `test/multiEventLocalFirstUiLive.test.js` |
| Documentation completeness | Complete for the implemented scope; merge/release evidence is pending (see fields above) |

## Summary

Imports **one opened source into several events with one final Import**: one opened import source → multiple event assignments → one final import. The source can be any source the normal workflow supports (camera card, drive, USB, local folder); the model is deliberately source-agnostic. Files are assigned to events through persistent, exclusive file→event ownership; the operator switches the Current Event from inside the Import workspace (reusing the existing picker/creator, returning to the same un-rescanned workspace); one combined review validates every participating event; one Import runs one existing transaction per event.

## Current Behavior

Grounded in `docs/multi-event-import.md` (the technical authority) and the code it cites:

- **Separate concepts.** UI selection (`selectedFiles`) is not an assignment. Persistent event assignment (ownership) lives in `ImportSession` (`renderer/importSession.js`). The Current Event and a file's Assigned Event are different things; changing the Current Event never rewrites ownership. `eventPath` is the session event identity.
- **Per-event workspace.** Each participating event owns an isolated `GroupManager` instance (`createGroupManager()` in `renderer/groupManager.js`) behind a facade bound to the Current Event, plus a set of directly-assigned files. Group/component state never leaks across events. Ownership is derived from those stores and exclusivity is enforced by an `onClaim` hook, so a file belongs to at most one event.
- **Assignment.** Multi-component events: group placement. Single-component events: an explicit **Assign to <event>** action. Change Event never claims selected files; Import never auto-assigns. Stable `E1/E2/…` ordinals are never renumbered.
- **Change Event.** `openEventPickerFromWorkspace()` reuses `EventMgmt`/`EventCreator`; picking or creating an event returns to the same workspace (`_returnToWorkspaceFromPicker`), hydrating first and swapping synchronously. The source, `tileMap`, `currentFiles`, folder navigation and thumbnails are untouched. Editing an event that owns files in the session is blocked.
- **Plan and review.** `ImportSession.buildPlan` builds a deterministic, frozen per-event plan via the existing `ImportRouter`; every participating event is re-read from disk and validated (errors name the event; **Go to E#** reopens the picker). One combined review with one photographer and one import method.
- **Execution.** `ImportSessionRunner` runs one unchanged `import:commitTransaction` per event. Event-local failures continue; abort / source disconnect stop the run. Completed events are cleared; failed and not-started events stay assigned; a completed-with-errors event keeps only its failed files. Source-cleanup eligibility is the union of `copiedFiles` from events whose transaction returned a summary. Transaction atomicity remains **per event**; the session is not filesystem-atomic.
- **Metadata / Local First.** `import:commitTransaction` echoes an optional `progressEventPath` on `metadata:progress`; `renderer/metadataBatchTracker.js` keeps per-batch state and one Local First sync manifest per batch. Deep Verify accumulates across a run via a shared `importSessionId`.
- **Original single-event path retained.** When the session is one event, groups-only and current (`ImportSession.isLegacyEligible()`), the original handler runs unchanged — a deliberate transitional regression-safety decision (see DEC-019).
- **Per-Photo Tag Refinement is held out of Stable (`ac75466`) and is NOT shipped by this feature.**

## Original Plan / Intent

Requested 2026-09-20: a single SD card frequently contains photographs from several events, forcing the operator to import Event A, leave, create/select Event B, reselect the same source, and import again. Goal: prepare all events from one opened source and press Import once, while keeping strict per-event routing, per-file metadata correctness, and every existing copy-safety, naming and metadata rule. The request was refined to be source-agnostic (any supported source, not only cards).

## Evolution / Implementation Journal

Append-only.

- **2026-09-20 — Investigation.** Traced the Stable import path end to end (state ownership, reset sites, routing, IPC, metadata, duplicate caches, cleanup). Findings that shaped the design: single-component events bypass GroupManager entirely (no assignment step existed); GroupManager and the refinement store were module singletons reset on event change; `import:commitTransaction` is inherently one-event (locks, event.json commit, metadata context); several renderer/main states were single-slot or read the *current* event on an asynchronous completion path (`_pendingLfSyncManifest`, `_metaBatchEventPath` at `batch_start`, `_csqEligibleFiles` replaced per summary, `lastImportedFiles` overwritten per call, copy-engine `isAborted`/`isPaused` reset per call, QMZ button and metadata-grouping tags reading the active event, `metadata:progress` carrying no event identity).
- **2026-09-20 — Design decisions.** Per-event GroupManager instances behind a facade; one existing transaction per event; explicit assignment for single-component events; legacy path retained; edit-block for participating events; one photographer per session — see [DEC-019](../decisions/DEC-019_MULTI_EVENT_IMPORT_ARCHITECTURE.md).
- **2026-09-20 — Base reconciliation.** Built first on `61eba47` (the last refinement-bearing Stable). `stable/0.9` then advanced (`ac75466`: per-photo tag refinement intentionally held out of v0.9.12; then the v0.9.12 version bump and a CI fix, tip `7f72e51`). The branch was **re-cut onto `7f72e51`**: the refinement-dependent parts (a `TagRefinementManager` factory, per-event refinement instances, `fileTagRefinements` in plans/payloads, a refinement summary in the review, refinement tests/fixtures) were removed; the held feature was not reintroduced. The workspace remains the documented extension point for any future event-scoped state (`docs/multi-event-import.md` §2).
- **2026-09-20 — Independent code review** (no CRITICAL/HIGH findings). Valid findings fixed: a stale Change-Event return target after card removal with the picker open (target now self-heals); retry after a per-file error could re-import already-tagged JPEG/PNG/TIFF files because metadata tagging rewrites destinations in place (a completed-with-errors event now keeps only its failed files — **the earlier claim that retry is idempotent by same-size skip was superseded**); a failed picker return could leave the group facade bound to the wrong event; source/operator audit identity is captured once at click time; the runner tolerates throwing UI callbacks; the pause controls reset right before each copy; the metadata batch snapshot no longer falls back to the current event; the Local First manifest registration cannot turn a committed event into a failed one; the session strip does no O(files) work outside a session; the tracker prunes finished batches.
- **2026-09-20 — Verification.** See Testing coverage. Live runs used synthetic fixtures only (temp userData, archive, staging and source directories).

## Engineering Evolution

Categorized index over the journal above; no new facts.

**Initial implementation**: 2026-09-20.

**Architectural / workflow decisions**: [DEC-019](../decisions/DEC-019_MULTI_EVENT_IMPORT_ARCHITECTURE.md); [11_ARCHITECTURAL_EVOLUTION.md](../11_ARCHITECTURAL_EVOLUTION.md) "Multi-Event Import Architecture".

**Reliability / correctness fixes found during design or review**: the single-slot / current-event-derived state items listed in the Investigation entry; the review fixes listed in the review entry.

**Rejected / superseded approaches**: see DEC-019 Options Considered; the "retry is idempotent by same-size skip" claim is superseded (review entry above).

## Known Bugs / Troubleshooting

None recorded.

Known limitations (documented in `docs/multi-event-import.md` §11): the "unassigned" count covers only files loaded in the current view (tree-mode sources are not scanned up front) — the invariant is that only explicitly assigned files import and everything else is untouched; one photographer per import session; editing a participating event is blocked; session state is not persisted across restart; a lost Direct Archive lock can abort the next event's copy; an event whose resolved path changes mid-session can appear under two `E#`s (ownership stays exclusive).

## Decisions

- [DEC-019 — Multi-Event Import Architecture](../decisions/DEC-019_MULTI_EVENT_IMPORT_ARCHITECTURE.md)

## Future Enhancements

- Per-event photographer (UI only — plan items already carry a photographer per event).
- Retire the retained single-event handler once the runner has proven itself in production, converging on one runner fed a one-event plan.
- Re-introduce event-scoped refinement state through the documented workspace extension point **if and when** Per-Photo Tag Refinement is released.
- Exact unassigned counts for tree-mode sources, if a background scan is ever justified.

## Related Files

- `renderer/importSession.js`, `renderer/importSessionRunner.js`, `renderer/importSessionUI.js`, `renderer/metadataBatchTracker.js`
- `renderer/groupManager.js`, `renderer/eventCreator.js`, `renderer/renderer.js`, `renderer/index.html`
- `main/main.js` (additive `progressEventPath` echo and `importSessionId` accumulation only)
- `docs/multi-event-import.md`
- Tests: `test/importSession.test.js`, `test/importSessionRunner.test.js`, `test/metadataBatchTracker.test.js`, `test/multiEventImportLive.test.js`, `test/multiEventImportUiLive.test.js`, `test/multiEventNewEventUiLive.test.js`, `test/multiEventLocalFirstUiLive.test.js`
