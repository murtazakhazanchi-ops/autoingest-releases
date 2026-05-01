# Features — System Capabilities & Scope

This document defines implemented and planned features, along with their system impact.

Use this as a reference before implementing or modifying any feature.

---

## Implemented Features

### 1. Drive Detection

**Description**
- Detects connected storage devices for import

**System Impact**
- FILESYSTEM
- UI

---

### 2. File Browser

**Description**
- Allows selection of files and folders for ingestion

**System Impact**
- UI
- FILESYSTEM

---

### 3. Grouping System

**Description**
- Assigns selected files into logical groups mapped to sub-events

**System Impact**
- GROUP
- STATE
- VALIDATION

---

### 4. Event Creator

**Description**
- Builds event.json structure from user input

**System Impact**
- DATA
- ROUTING
- VALIDATION

---

### 5. Import Pipeline

**Description**
- Processes grouped files and routes them into archive structure

**System Impact**
- INGEST
- ROUTING
- FILESYSTEM
- PERFORMANCE

---

### 6. Duplicate Detection

**Description**
- Prevents overwriting by identifying existing files

**System Impact**
- INGEST
- FILESYSTEM
- VALIDATION

---

### 7. UI Dashboard

**Description**
- Displays system state, grouping, and import preview

**System Impact**
- UI
- STATE

---

### 8. Atomic Transaction Write

**Description**
- event.json is written in a single atomic operation: import → logs (including `source` attribution) → lastImport → status, committed together via `import:commitTransaction` using tmp→rename

**System Impact**
- DATA
- INGEST
- STATE

---

### 9. Activity Log

**Description**
- On-demand audit view for any event in the master archive
- Import history grouped by date with event-level summary (photo count, video count, session count, last import attribution)
- Binary issue detection: amber "Check" badge on entries with missing or invalid fields; no badge on clean entries
- "Check Imports" warning at summary level only when issues exist; no false positives for old entries
- Event picker loads event names from lightweight cache; per-event history loaded lazily on selection
- Does not mutate active event selection or any import data

**System Impact**
- UI
- DATA (read-only)

---

### 10. Audit Integrity Verification

**Description**
- On-demand "Verify Integrity" button in the Activity Log
- Compares expected media count from `imports[].counts` totals against actual files found on disk
- Recursive folder walk (depth ≤ 8) counting files by extension; no minimum size filter
- Result shown inline: green (match), amber (mismatch with delta), or error (unreadable)
- Non-blocking: no auto-scan, no renderer blocking

**System Impact**
- DATA (read-only)
- FILESYSTEM (read-only)

---

### 11. Import Source Attribution

**Description**
- Each audit entry in `imports[]` records `source: {type, label, path}` identifying which memory card, external drive, or local folder was used
- Captured from renderer `activeSource` state at import time via `_buildImportSourceMeta()`
- Backward-compatible: old entries without `source` remain valid; displayed as "Source: Not recorded"
- Missing source never triggers a Check badge

**System Impact**
- DATA
- INGEST

---

## Planned Features

### 1. Metadata Tagging

**Description**
- Attach metadata (event, subject, tags) to files

**Expected Impact**
- DATA
- INGEST
- UI

**Notes**
- Must not break event.json structure
- Must remain deterministic

---

### 2. NAS Sync

**Description**
- Sync archive to network storage

**Expected Impact**
- FILESYSTEM
- PERFORMANCE
- INGEST

**Notes**
- Must be idempotent
- Must not duplicate files

---

### 3. Persistence Enhancements

**Description**
- Improve state persistence across sessions

**Expected Impact**
- DATA
- STATE

**Notes**
- event.json must remain source of truth

---

### 4. Multi-User Handling

**Description**
- Support concurrent users or roles

**Expected Impact**
- STATE
- VALIDATION
- SECURITY

**Notes**
- Must prevent conflicting writes
- Must maintain deterministic behavior

---

## Feature Implementation Rule

Before implementing any feature:

1. Identify impacted systems
2. Check against system-contracts.md
3. Use decision-matrix.md to choose approach
4. Follow development-protocol.md

Never implement a feature without mapping its system impact.