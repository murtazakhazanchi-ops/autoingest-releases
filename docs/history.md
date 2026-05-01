# History — System Evolution

This document tracks major system changes and their impact.

Use this for:
- debugging regressions
- understanding architectural evolution
- identifying when behavior changed

---

## v0.5.1 — Stabilization

### Changes
- Import pipeline hardening
- Performance fixes

### System Impact
- INGEST
- PERFORMANCE

### Notes
- Focus on reliability and consistency
- Reduced import failures

---

## v0.6.0 — File Handling & UI

### Changes
- Folder view
- Recursive scanner
- UI improvements

### System Impact
- FILESYSTEM
- UI
- PERFORMANCE

### Notes
- Increased filesystem complexity
- Potential performance bottlenecks introduced

---

## v0.7.x — Core System Architecture

### Changes
- Dashboard rebuild
- Event system introduction
- Grouping system
- Import routing

### System Impact
- DATA
- GROUP
- ROUTING
- STATE

### Notes
- Major architectural shift
- Introduced event.json as source of truth
- Established ingestion pipeline structure

---

## v0.7.4-dev — Stabilization Pass

### Changes
- Atomic transaction write: `import:commitTransaction` replaces multi-step event.json writes
- `isValidEventJson` made non-mutating (no write-back of `sequence`)
- `settings:verifyLastEvent` validates both collectionPath and event folder path
- `setWindowBoundsSync` for safe close-time settings persistence
- Dead code removed: `markEventImportComplete`, standalone `appendImports`, `debug:telemetry`, `debug:flush`
- `_scannedEvents` cache invalidated after each import
- Activity Log OOM fix: `_alEventList` stores only lightweight picker data; per-event `event.json` loaded lazily on picker change
- Drive polling guard: `!win.webContents.isDestroyed()` added to prevent post-crash send errors

### System Impact
- DATA
- INGEST
- STATE
- PERFORMANCE
- IPC

### Notes
- All event.json mutations now flow exclusively through `import:commitTransaction`
- Renderer memory safety rule: strip `_eventJson` from IPC scan results before caching

---

## Usage

When debugging:

1. Identify when the issue started
2. Match version with system changes
3. Focus on affected system layer