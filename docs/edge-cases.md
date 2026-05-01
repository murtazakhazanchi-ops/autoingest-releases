# Edge Cases — Exceptional Scenarios & Handling

This document defines non-standard scenarios where normal system assumptions may break.

These must be handled carefully to preserve system integrity.

---

## 1. Missing event.json (Legacy Events)

### Scenario
- Event folder exists without event.json

### Risk
- No source of truth
- Cannot determine structure or mappings

### Handling

- Detect as legacy event
- Enter **read-only mode** OR
- Trigger manual repair flow

### Contract Impact
- DATA:INVALID_EVENT_JSON

---

## 2. Partial Import Interruption

### Scenario
- Import stops midway (crash, manual stop)

### Risk
- Incomplete dataset
- inconsistent filesystem state

### Handling

- Use idempotent import logic
- Resume safely without duplicating files
- Validate counts after resume

### Contract Impact
- INGEST:PARTIAL_EXECUTION

---

## 3. Duplicate Files with Same Name but Different Content

### Scenario
- Same filename, different file size/content

### Risk
- accidental overwrite or misclassification

### Handling

- Compare filename + size (or hash if needed)
- Rename with suffix (_1, _2)
- Never overwrite

### Contract Impact
- INGEST:CONFLICT_RESOLUTION

---

## 4. Group Without Sub-Event Mapping

### Scenario
- Files assigned to group but no subEventId

### Risk
- Undefined routing
- incorrect folder placement

### Handling

- Block import
- Require user mapping before proceeding

### Contract Impact
- GROUP:MISSING_SUBEVENT
- VALIDATION:IMPORT_BLOCKED

---

## 5. Duplicate Sub-Event Mapping

### Scenario
- Multiple groups mapped to same subEventId

### Risk
- ambiguous routing
- data inconsistency

### Handling

- Block operation
- enforce one-to-one mapping

### Contract Impact
- GROUP:DUPLICATE_SUBEVENT

---

## 6. UI-State Desynchronization

### Scenario
- UI shows state different from backend

### Risk
- user confusion
- incorrect operations

### Handling

- force sync from event.json
- re-render affected components only

### Contract Impact
- STATE:DESYNC

---

## 7. Filesystem Write Failure

### Scenario
- disk error / permission issue

### Risk
- partial import
- data loss

### Handling

- catch per-file errors
- continue remaining files
- log failure clearly

### Contract Impact
- FS:COPY_FAILED
- INGEST:PARTIAL_EXECUTION

---

## 8. Invalid Folder Name Generation

### Scenario
- folderName missing or malformed

### Risk
- incorrect archive structure

### Handling

- validate before import
- block operation if invalid

### Contract Impact
- DATA:MISSING_FOLDERNAME
- ROUTING:INVALID_PATH

---

## 9. Extremely Large File Sets

### Scenario
- thousands of files imported at once

### Risk
- performance degradation
- UI freeze

### Handling

- batch operations
- avoid full re-renders
- use caching

### Contract Impact
- PERF:REPEATED_SCAN
- PERF:EXCESSIVE_RENDER

---

## 10. Event Structure Change Mid-Process

### Scenario
- event components modified during grouping/import

### Risk
- inconsistent routing
- broken mappings

### Handling

- lock structure during import
- require reset if modified

### Contract Impact
- STATE:INVALID_TRANSITION

---

## General Rules

- Never patch UI to hide edge case
- Always resolve via data or logic layer
- Always validate before proceeding
- Prefer blocking invalid operations over guessing behavior