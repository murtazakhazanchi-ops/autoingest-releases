# Ingestion Flow

## Core Rules

- No overwrite ever
- Same file → skip
- Conflict → rename
- Copy loop must complete fully
- Errors must not break loop
- All routing must derive from event.json
- Operations must be idempotent

---

## Pipeline

1. File selection
2. Group assignment
3. Validation
4. Validate and finalize event.json state
5. Archive write (based on event.json)
6. UI sync

---

## Validation

- All groups must have sub-events
- No duplicate mappings
- No orphan files

If validation fails:
→ block import

---

## Routing

Single-component:
Collection/Event/Photographer/

Multi-component:
Collection/Event/SubEvent/Photographer/

VIDEO files:
→ inside VIDEO folder

- Paths must be generated deterministically from event.json
- No dynamic path computation during import

---

## Duplicate Handling

- Same name + size → skip
- Different size → rename
- No overwrite under any condition

---

## Import Logging

- Append-only logs
- Deduplicated entries (by `id`)
- Sorted by timestamp (descending), then `seq` tiebreaker
- Written to event.json `imports[]` via `import:commitTransaction` (single atomic write)
- Each entry records: `id`, `seq`, `timestamp`, `photographer`, `componentIndex`, `componentName`, `counts: {photos, videos}`, and optionally `source: {type, label, path}` and `importedBy: {id, name}`
- `source` is captured from the renderer's active source state (`activeSource`) at import time — not derived from the file system after the fact
- `importedBy` is captured from the renderer's active operator (`_activeUser`) at import time — the operator who triggered the import session
- Entries without `source` are backward-compatible and displayed as "Source: Not recorded" in the Activity Log
- Entries without `importedBy` are backward-compatible and displayed as "Imported by: Not recorded" in the Activity Log

---

## Failure Handling

- Errors must be caught per file
- Failed files must be logged
- Import must continue for remaining files
- Final result must report:
  - copied
  - skipped
  - errored

---

## Determinism

Given same input and event.json:
→ output folder structure and results must be identical

---

## Contract Alignment

Violations map to:

- INGEST → partial execution or mismatch
- ROUTING → incorrect path generation
- VALIDATION → invalid grouping or mappings
- DATA → incorrect event.json state

---

## Multi-Event Import

One opened source can be assigned to several events and imported in one pass. Ingestion rules are unchanged; only orchestration is new:

- The plan is built per event by the existing `ImportRouter` from that event's own groups and event data (Collection/Event/[SubEvent/]Photographer/[VIDEO/]) — never from Current-Event state.
- Each event runs through one existing `import:commitTransaction`. **Transaction atomicity remains per event.** A multi-event import is an orchestration of independent event transactions and is **not** filesystem-atomic; event-local failures may leave a partially completed session. Successfully copied files are never rolled back.
- Event-local failures continue to the next event; source-wide fatal conditions (abort, source disconnect) stop the run. Retries never overwrite (same-name+size skip / different-size rename / never-overwrite). An event that committed with per-file errors keeps only its failed files assigned — already-copied files are released, because metadata tagging rewrites JPEG/PNG/TIFF destinations in place and a same-size check would no longer recognise them.
- Completed events are cleared from the session; failed and not-started events stay assigned for retry (a completed-with-errors event keeps only its failed files).
- Source-cleanup eligibility is the union of `copiedFiles` from events whose transaction returned a summary — never broader.
- Only explicitly assigned files import; unassigned, unloaded files are never touched.

See [multi-event-import.md](multi-event-import.md).

