# Data Model – event.json

## Role

event.json is the authoritative representation of:
- event structure
- sub-events
- group mappings
- ingestion state

- All system behavior must derive from event.json

---

## Rules

- Must always be valid JSON
- Must pass schema validation before write
- Must remain backward compatible
- Must never contain derived or UI-only state
- Must be the only source of truth for routing decisions

---

## Key Properties

- event → metadata (name, date, location)
- subEvents[] → individual components with folderName
- groups[] → file group definitions
- mappings[] → group ↔ subEvent relationships
- imports[] → ingestion log
- status → current state flags

---

## Constraints

- One group ↔ one sub-event
- No orphan groups
- No duplicate mappings
- Files must belong to exactly one group
- Folder structure must derive from this model
- Path generation must be deterministic from this model

---

## Persistence

- Atomic writes only
- Crash-safe updates
- Idempotent reconciliation
- Must be validated before and after write

---

## Validation Requirements

Before any write:

- structure must match schema
- all subEventIds must be valid
- all groups must have mappings
- no duplicate mappings allowed

If validation fails:
→ write must be blocked

---

## Contract Alignment

Violations map to:

- DATA → invalid structure
- GROUP → invalid mappings
- ROUTING → invalid folder structure
- STATE → desynchronization

event.json must always satisfy all system contracts

---

## Import Entry Schema

Each entry in `imports[]` has the following shape:

```json
{
  "id":             "string (UUID)",
  "seq":            "number (ascending per session)",
  "timestamp":      "string (ISO 8601)",
  "photographer":   "string",
  "componentIndex": "number",
  "componentName":  "string",
  "counts": {
    "photos": "number",
    "videos": "number"
  },
  "source": {
    "type":  "string ('memory-card' | 'external-drive' | 'local-folder' | 'unknown')",
    "label": "string (display name of the source)",
    "path":  "string (mount point or folder path)"
  }
}
```

`source` is optional and backward-compatible. Entries written before source attribution was implemented are valid without it. `isValidImportEntry` does not require `source`. The Activity Log displays "Source: Not recorded" for entries that lack it.

`importedBy` is optional and backward-compatible. Entries written before operator attribution was implemented are valid without it. `isValidImportEntry` does not require `importedBy`. The Activity Log displays "Imported by: Not recorded" for entries that lack it.

```json
{
  "importedBy": {
    "id":   "string (user UUID)",
    "name": "string (display name of the operator)"
  }
}
```

---

## copiedFiles In-Memory Entry Schema

`copiedFiles` is an in-memory array built during a copy session. It is never persisted to event.json. Each entry has the following shape:

```json
{
  "src":           "string (absolute source path)",
  "dest":          "string (absolute destination path)",
  "size":          "number (file size in bytes at copy time, verified equal to dest immediately after copy)",
  "copyVerified":  "boolean (true only when verifyFile() passed; absent on skipped or failed entries)"
}
```

`copyVerified` governs the `deleteFromSource` validation logic (see system-contracts.md Section 4). When `true`, a destination size larger than `size` is treated as a non-blocking metadata-growth condition (e.g. EXIF embedded after copy) rather than a mismatch error. Entries without `copyVerified` use the legacy blocking comparison.

---

## Debugging Role

event.json is the first point of inspection during debugging.

If event.json is correct:
→ issue lies in logic or UI

If incorrect:
→ issue originates in data layer