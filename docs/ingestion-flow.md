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