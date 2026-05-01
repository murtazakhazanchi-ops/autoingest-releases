# System Contracts — Non-Negotiable Invariants

This document defines rules that must NEVER be violated.

If any change risks breaking these, STOP and redesign.

---

## 1. Data Contract — event.json

### MUST

- event.json is the single source of truth
- All system state must derive from it
- Must always be valid JSON
- Must pass validation before write
- Must remain backward compatible unless explicitly redesigned

### MUST NOT

- No direct UI state overrides
- No partial writes
- No silent mutations

---

## 2. State Flow Contract

System flow is strictly:

event.json → logic → filesystem → UI

### MUST

- UI reflects backend state
- Logic reads from event.json
- Filesystem mirrors event.json

### MUST NOT

- UI-driven state logic
- filesystem-driven assumptions
- multiple sources of truth

### ENFORCEMENT
- Any deviation is a STATE contract violation

---

## 3. Grouping Contract

### MUST

- Each group maps to exactly ONE sub-event
- Groups only exist if they contain files
- subEventId must always be valid
- Files must belong to exactly one group

### MUST NOT

- Empty groups
- duplicate sub-event mappings
- orphan files

---

## 4. Ingestion Contract

### MUST

- No file overwrites ever
- Same file → skip
- Conflict → rename (_1, _2)
- Operations must be idempotent
- All selected files must be processed (copied, skipped, or errored)

### MUST NOT

- Duplicate processing
- partial imports
- inconsistent routing

---

## 5. Folder Structure Contract

### MUST

- Structure derives from event.json
- Naming must be deterministic
- folderName must be persisted
- Path generation must be deterministic from event.json only

### MUST NOT

- recompute folder names during import
- dynamic path assumptions
- inconsistent hierarchy

---

## 6. UI Contract

### MUST

- UI is a pure reflection layer
- All changes originate from backend
- Updates must be explicit (sync functions)
- UI must never mutate system state directly

### MUST NOT

- hidden state
- UI-only logic
- silent corrections

---

## 7. Performance Contract

### MUST

- avoid unnecessary filesystem operations
- avoid full UI re-renders
- use caching where required
- operations must scale predictably with file count

### MUST NOT

- repeated scans
- DOM rebuilds for small updates
- unbounded recursion

---

## 8. Validation Contract

### MUST

- validate before any write
- reject invalid states early
- invalid operations must be blocked before execution

### MUST NOT

- allow invalid mappings
- bypass validation for convenience

---

## 9. Error Handling Contract

### MUST

- catch errors per file (no full stop)
- continue processing where possible
- log meaningful error context
- errors must be traceable to source operation

### MUST NOT

- silent failures
- breaking entire process due to one file

---

## 10. Determinism Contract

### MUST

- same input → same output
- system must be predictable
- output must not depend on external or hidden state

### MUST NOT

- random behavior
- hidden state changes

---

## 11. Consistency Contract

### MUST

- changes applied across all relevant modules
- system remains internally consistent
- all layers (data, logic, filesystem, UI) must remain aligned

### MUST NOT

- partial updates
- inconsistent naming or logic

---

## 12. Change Impact Rule

Before any change, verify:

- Does it affect event.json?
- Does it affect routing?
- Does it affect grouping?
- Does it affect any system contract?

If YES → high-risk → design first, do not patch

---

##  13. Transaction Contract

MUST

- All ingestion updates must be executed as a single transaction
- import, logs, lastImport, and status must be committed together
- lastImport must always reflect the latest entry in imports
- event.json must remain internally consistent at all times

MUST NOT

- Partial updates during ingestion
- Renderer-driven event.json mutations
- Independent writes for logs, lastImport, or status
- Divergence between imports[] and lastImport

Enforcement

If any inconsistency is detected:

- STOP
- Identify violation
- Fix transaction flow

Never patch inconsistencies after they occur

---

## Enforcement Rule

If any implementation violates a contract:

→ STOP immediately  
→ Identify the violated contract  
→ Classify it (DATA, GROUP, ROUTING, STATE, etc.)  
→ Explain why it is invalid  
→ Propose a compliant redesign  

Never proceed with a violating implementation