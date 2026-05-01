# Failure Patterns — Known Issues & Likely Causes

This document maps symptoms → probable root causes.

If a contract error exists:
→ prioritize contract-aware debugging over pattern matching

Use this AFTER basic diagnosis, not as a shortcut for skipping the debug playbook.

---

## 1. UI Shows Wrong Data

### Primary Layer
UI / STATE

### Likely Contract Violations
- STATE:DESYNC
- UI:DESYNC_STATE

### Symptoms
- Wrong group badge
- Incorrect preview tree
- Missing or stale values

### Likely Causes
- UI not synced after state change
- tileMap not updated correctly
- stale local state

### First Check
- Compare event.json vs UI display

### Check
- event.json → correct?
- GroupManager state → correct?
- sync functions called?

---

## 2. Files Imported to Wrong Folder

### Primary Layer
ROUTING

### Likely Contract Violations
- ROUTING:INVALID_PATH
- GROUP:MAPPING_ERROR

### Symptoms
- Files in wrong sub-event
- Files missing from expected location

### Likely Causes
- Incorrect subEventId mapping
- ImportRouter logic issue
- folderName mismatch

### First Check
- Inspect generated path vs expected path

### Check
- group.subEventId
- event.json components
- routing path generation

---

## 3. Duplicate Files or Unexpected Renaming

### Primary Layer
INGEST / FILESYSTEM

### Likely Contract Violations
- INGEST:DUPLICATE_PROCESS
- FS:CONFLICT_RESOLUTION

### Symptoms
- _1, _2 files appearing unexpectedly
- duplicates not skipped

### Likely Causes
- incorrect duplicate detection
- size mismatch logic
- cache not used correctly

### First Check
- compare filename + size vs destination

### Check
- destFileCache
- filename + size comparison
- scanDest behavior

---

## 4. Files Not Imported

### Primary Layer
VALIDATION / GROUP

### Likely Contract Violations
- VALIDATION:IMPORT_BLOCKED
- GROUP:MISSING_SUBEVENT

### Symptoms
- selected files missing after import
- import count mismatch

### Likely Causes
- files unassigned to groups
- validation blocking import
- skipped due to duplicate detection

### First Check
- check for unassigned files

### Check
- GroupManager.getUnassignedFiles()
- validation warnings
- import summary

---

## 5. Event Name / Structure Incorrect

### Primary Layer
DATA / ROUTING

### Likely Contract Violations
- DATA:INVALID_EVENT_JSON
- ROUTING:MISMATCH_STRUCTURE

### Symptoms
- wrong event name
- incorrect folder structure

### Likely Causes
- EventCreator logic error
- city grouping rules mismatch
- incorrect component state

### First Check
- compare preview vs actual structure

### Check
- _eventComps state
- naming rules
- preview vs final output

---

## 6. UI Not Updating After Action

### Primary Layer
UI

### Likely Contract Violations
- UI:DESYNC_STATE

### Symptoms
- changes not reflected
- stale display

### Likely Causes
- missing sync call
- renderFileArea not triggered
- DOM update skipped

### First Check
- check if sync function was triggered

### Check
- tileMap usage
- sync functions
- render triggers

---

## 7. Groups Behaving Incorrectly

### Primary Layer
GROUP

### Likely Contract Violations
- GROUP:EMPTY_GROUP
- GROUP:DUPLICATE_SUBEVENT

### Symptoms
- groups disappear unexpectedly
- files assigned incorrectly

### Likely Causes
- auto-remove logic triggered
- incorrect assign/unassign flow
- reset not called on event change

### First Check
- inspect GroupManager state

### Check
- GroupManager state
- group lifecycle
- reset triggers

---

## 8. Import Flow Breaks or Stops

### Primary Layer
INGEST

### Likely Contract Violations
- INGEST:PARTIAL_EXECUTION

### Symptoms
- import stops midway
- incomplete results

### Likely Causes
- error not caught in loop
- async handling issue
- abort triggered

### First Check
- check last processed file vs total

### Check
- try/catch wrapping
- copy loop logic
- progress events

---

## 9. Legacy Event Issues

### Primary Layer
DATA

### Likely Contract Violations
- DATA:INVALID_EVENT_JSON

### Symptoms
- event cannot be opened
- missing data

### Likely Causes
- no event.json
- legacy structure mismatch

### First Check
- check presence of event.json

### Check
- legacy detection
- repair logic
- fallback behavior

---

## 10. Performance Issues

### Primary Layer
PERFORMANCE

### Likely Contract Violations
- PERF:EXCESSIVE_RENDER
- PERF:REPEATED_SCAN

### Symptoms
- UI lag
- slow import
- freezing

### Likely Causes
- excessive DOM re-render
- repeated filesystem operations
- large directory scans

### First Check
- identify repeating operations

### Check
- render triggers
- file operations count
- caching usage

---

## 11. State Desync (Critical)

### Primary Layer
STATE

### Likely Contract Violations
- STATE:DESYNC

### Symptoms
- UI shows one thing, system behaves differently

### Likely Causes
- multiple sources of truth
- event.json not updated
- UI derived state

### First Check
- compare event.json vs system behavior

### Check
- event.json vs UI
- state flow
- update sequence

---

---

## 12. Renderer OOM — Large IPC Allocation

### Primary Layer
PERFORMANCE / IPC

### Likely Contract Violations
- PERF:EXCESSIVE_RENDER (renderer memory, not DOM)

### Symptoms
- `V8 process OOM (Oilpan: Large allocation)` on modal open
- `Render frame was disposed before WebFrameMain could be accessed` in main process logs after crash
- Drive polling error loop after renderer crash

### Likely Causes
- Full IPC scan result (containing nested `_eventJson` / `imports[]` for every event) cached in a module-level renderer variable
- All event histories materialized simultaneously via structured clone on a single IPC response

### First Check
- Identify module-level renderer variables assigned directly from `scanMasterEvents` or similar scan IPC calls
- Check whether stored entries contain nested objects that grow with import history size

### Fix
- Strip heavyweight nested fields from scan results before caching (keep only scalar picker metadata)
- Load per-event data lazily on selection via `readEventJson` (single IPC call, single object in memory)
- See `docs/performance-playbook.md` § IPC Payload Size

---

## Usage Rule

This file is a guide, not a shortcut.

Always:
1. Confirm symptom
2. Match pattern
3. Check contract violations
4. Verify with debug-playbook
5. Fix root cause