# DEC-019 — Multi-Event Import Architecture

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-058 / AI-RM-011 (also touches AI-FEAT-017, AI-FEAT-019, AI-FEAT-021, AI-FEAT-024, AI-FEAT-025, AI-FEAT-044) |
| Status | Accepted |
| Date | 2026-09-20 |
| Evidence status | Verified from current code, tests, `docs/multi-event-import.md`, and Git history (`61eba47`, `ac75466`, `7f72e51`). Merge/release not yet performed. |

## Context

One source (card, drive, USB, folder) often holds media for several events, but Event Import assumed one active event per import: the operator imported Event A, left, created/selected Event B, reselected the same source, and imported again. The feature must let an operator prepare several events from one opened source and import once, without weakening any copy-safety, archive-naming, metadata or transaction rule, and without being specific to cards.

Constraints that shaped the choices: `import:commitTransaction` is inherently one-event (locks, atomic event.json commit, metadata context); GroupManager was a module singleton reset on event change; single-component events had no assignment step; the copy engine resets its own abort/pause state per call; production Stable must stay low-risk; and Per-Photo Tag Refinement was deliberately held out of Stable partway through (`ac75466`).

## Options Considered

1. **Snapshot/restore of the GroupManager singleton on event switch.** Smallest code footprint. Rejected: exclusivity needs cross-event mutation (reassigning A→B must remove the file, and anything keyed to it, from A), which is awkward and error-prone on snapshots; positional group ids would also collide across events in any shared, group-id-keyed state.
2. **Isolated per-event GroupManager instances behind a facade bound to the Current Event, with ownership derived from the stores and exclusivity enforced by a claim hook.** No logic is cloned; existing call sites are unchanged; cross-event operations are trivial. **Chosen.**
3. **One extended `import:commitTransaction` carrying all events.** Rejected: the transaction's locks, atomic event.json commit, rollback and metadata context are per event; widening it would be a major main-process redesign and would change the transaction guarantees.
4. **One existing transaction per event, orchestrated by a runner.** Preserves every per-event guarantee and gives structural metadata isolation (each call carries only its own event's groups and event.json). **Chosen.** Cost: a session is not filesystem-atomic and may partially complete; accepted and documented.
5. **Implicit assignment (Change Event or Import claims the current selection).** Fewer clicks. Rejected: it conflates UI selection with persistent assignment and can silently import unintended files. Chosen instead: explicit assignment (group placement, or **Assign to <event>** for single-component events).
6. **Refactor the existing single-event handler into the new runner now.** Architecturally cleaner. Rejected for this release: the handler is proven production code and the refactor risk is not justified. Chosen: keep it for one-event, groups-only sessions as a **documented transitional regression-safety decision**, share ImportRouter/metadata/copy code (nothing duplicated), and design the plan/runner so a single event is a one-event plan.
7. **Re-key or reconcile events edited mid-session.** Rejected for v1: editing changes the event key, component ids and sub-event ids that assignments and mappings depend on. Chosen: block editing/renaming an event that owns files in the session.
8. **Per-event photographers.** Rejected for v1: a source normally represents one photographer's ingest. Chosen: one photographer per import session; the plan already stores photographer per event, so per-event photographers are a UI-only extension later.
9. **Stop the whole run on any event failure.** Rejected: an event-local failure (lock busy, destination, event.json write) should not discard independent, valid work. Chosen: event-local failures continue; source-wide fatals (abort, disconnect, cancelled copy) stop the run.
10. **Retry every retained event in full ("retry is idempotent by same-size skip").** Initially assumed; **superseded during independent review.** The copy engine skips only a same-size destination, but post-import metadata tagging rewrites JPEG/PNG/TIFF destinations in place and changes their size, so a retry would create `_1` duplicates. Chosen: failed and not-started events stay assigned in full; a completed-with-errors event keeps only its failed files.
11. **Keep Per-Photo Tag Refinement per-event state in this feature.** Rejected after `ac75466`: the held feature must not be re-shipped by another feature. Chosen: ImportSession's workspace carries no refinement state; the workspace is documented as the extension point.

## Decision

Adopt options 2, 4, 5, 6, 7, 8, 9, 10 (as amended) and 11: isolated per-event workspaces with derived, exclusive ownership; one unchanged transaction per event run by a runner with the failure policy above; explicit assignment; the original single-event handler retained transitionally; edit-block for participating events; one photographer per session; retry scope narrowed to failed files; no refinement state.

Supporting choices: `eventPath` is the session event identity; batch-scoped state (metadata attribution, Local First manifests) is keyed by an identity carried in the payload (`progressEventPath`, optional and additive) rather than by Current-Event UI state; Deep Verify accumulates across a run via a shared `importSessionId`; source-cleanup eligibility is the union of `copiedFiles` from events whose transaction returned a summary and is never derived from assignments; the "unassigned" count covers only files loaded in the current view and the UI says so.

## Consequences

- A multi-event import is an orchestration of independent event transactions. **Transaction atomicity remains per event**; a session may partially complete; successfully copied files are never rolled back; retries never overwrite.
- GroupManager's earlier invariant ("reset on event change") is superseded by: **group/component state must never leak across events**, guaranteed by isolated per-event instances. `docs/group-manager.md` and `docs/system-contracts.md` were updated accordingly. (The corresponding rule in `.claude/agents/group-mapping-specialist.md` is deliberately left for the separate, later Agent Learning Update.)
- Two small, additive main-process changes (`progressEventPath` echo on `metadata:progress`; `importSessionId` accumulation for `checksum:run`). The copy engine, naming/routing, metadata semantics and cleanup validation are unchanged.
- Two import code paths exist for now (retained single-event handler, and the session runner). Follow-up debt: retire the handler once the runner is proven.
- Known limitations are recorded in `docs/multi-event-import.md` §11.
- Future: reintroducing event-scoped state (for example Per-Photo Tag Refinement, if it ships) means extending the workspace per `docs/multi-event-import.md` §2, not redesigning ImportSession.

## Reconciliation Note

The pre-existing technical documentation stated that GroupManager "must reset on event change" (`docs/group-manager.md`; the matching agent rule in `.claude/agents/group-mapping-specialist.md` will be reconciled by the later Agent Learning Update). That statement is superseded, not deleted: its safety intent — group state must not leak across events — is preserved and now guaranteed structurally. The technical documents under `docs/` were updated in the same change; no conflict remains between them and this record.
