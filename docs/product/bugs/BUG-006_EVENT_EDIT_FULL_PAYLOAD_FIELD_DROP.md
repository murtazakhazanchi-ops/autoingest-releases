# BUG-006 — Event-Edit Full-Payload Save Silently Drops Untracked Fields

| Field | Value |
|---|---|
| Related feature(s) | AI-FEAT-010, AI-FEAT-004, AI-FEAT-046 |
| Status | Fixed (recurring pattern — see Prevention) |
| Severity | High |
| Discovered | 2026-05-14 (first instance) |
| Fixed | 2026-05-14 (`adoption` field); 2026-08-02 (`status` field, second instance of the same class) |
| Evidence status | Verified from Git history (commit `5ac15eb`) and `.claude/learning-log.md` (2026-05-14 entry) |

## Symptom

Two separate instances of the same underlying defect, in different `event.json` fields, roughly three months apart:

1. **2026-05-14** — The `adoption` block (written by AI-FEAT-046's Archive Folder Adoption) was silently erased from `event.json` on every full-payload save made from Event Edit — every edit-and-save cycle after an event was adopted destroyed the record that it had been adopted.
2. **2026-08-02** — Event Edit's save payload hardcoded `status: 'created'` regardless of the event's actual current status, silently reverting an already-complete event's status back to `'created'` on every descriptive-field edit (commit `5ac15eb`).

## Root Cause

`updateEventJson` (the event.json writer backing Event Edit) has two write paths: a **partial-patch** path that spreads the existing `event.json` before merging the incoming payload (all existing fields survive automatically), and a **full-payload** path that constructs `dataToWrite` from a **hardcoded field list**. `_handleSaveEditedEvent` uses the full-payload path for both the rename and no-rename save flows. Any field not explicitly named in that hardcoded list is silently dropped on save — regardless of whether it existed before the edit.

`adoption` was not in the original hardcoded list. `status` was in the list, but the *value* threaded into that list came from a hardcoded literal (`'created'`) rather than the event's actual current status read from the scan-loaded entry.

## Investigation Log

- **2026-05-14** — Phase 13C-9 ("Adoption Block Silent Drop on Full-Payload Save"): traced to `updateEventJson`'s full-payload path constructing `dataToWrite` from a hardcoded list (`version`, `hijriDate`, `sequence`, `eventName`, `safeEventName`, `status`, `components`, `updatedAt`) that omitted `adoption` (`.claude/learning-log.md`).
- **2026-08-02** — Commit `5ac15eb` message: "Event Edit's save payload hardcoded `status:'created'` regardless of the event's actual current status, silently reverting an already-complete event back to `'created'` on every descriptive-field edit... found during the production-readiness review's Event Edit investigation. Unrelated to this pass's metadata work." Confirms this is a second, independently-discovered instance of the same architectural weakness, not a regression of the first fix.

## Fix

**Instance 1 (`adoption`, 2026-05-14)** — three-layer fix: (1) the `_viewingExisting` session object now captures `adoption: entry._eventJson?.adoption ?? null` so it survives the editing session; (2) both no-rename and rename `_handleSaveEditedEvent` payloads spread `...(adoption != null ? { adoption } : {})`; (3) `updateEventJson`'s full-payload path passes `adoption` through with the same `!= null` guard, so non-adopted events (where `adoption` is absent) are unaffected.

**Instance 2 (`status`, 2026-08-02)** — `renderer/eventCreator.js` (17 lines changed): the event's real status is now threaded through from the scan-loaded entry into `_viewingExisting` and both save payloads (rename and no-rename); only falls back to `'created'` when the event genuinely has no status yet (e.g. a just-repaired legacy event).

## Prevention / Reusable Lesson

**This is a recurring architectural weakness, not a one-off bug** — it has already manifested twice for two different fields (`adoption`, `status`) using the identical fix shape each time (session capture → payload spread → writer pass-through, each with a `!= null` guard). Any full-payload write path that constructs its output from a hardcoded field list will silently drop the *next* untracked field too, unless a structural fix is made. Diagnostic signal: a field is present immediately after its initiating write, then silently absent after the next Event Edit save — check whether `updateEventJson`'s full-payload path's hardcoded field list includes it, and whether the session-capture object (`_viewingExisting`) reads it from `entry._eventJson` in the first place. **Before adding any new field to `event.json` that Event Edit's full-payload save path might touch, audit both the hardcoded list and the session-capture object** — this has not yet been converted into a structural (spread-based) full-payload writer, so the third field is not protected by construction.

## Related

- [AI-FEAT-010 — Event Management & Editing](../features/AI-FEAT-010_EVENT_MANAGEMENT_EDITING.md)
- [AI-FEAT-004 — event.json Data Model & Persistence Contract](../features/AI-FEAT-004_EVENT_JSON_DATA_MODEL_PERSISTENCE_CONTRACT.md)
- [AI-FEAT-046 — Archive Folder Adoption](../features/AI-FEAT-046_ARCHIVE_FOLDER_ADOPTION.md)
- [DEC-001 — Event Data as Durable Archive Truth](../decisions/DEC-001_EVENT_DATA_AS_DURABLE_ARCHIVE_TRUTH.md)
