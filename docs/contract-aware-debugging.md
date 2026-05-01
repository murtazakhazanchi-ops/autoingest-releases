# Contract-Aware Debugging

This system uses runtime contracts to detect violations early.
Debugging is driven by contract failures, not guesswork.

---

## 1. Core Idea

Every failure should map to:

- a violated contract
- a clear error message
- a known investigation path

Never debug blindly.

---

## 2. Error Format (MANDATORY)

All contract violations must follow this structure:

[CONTRACT:<TYPE>:<CODE>] message

- TYPE must match system-contract category

Examples:

[CONTRACT:GROUP:DUPLICATE_SUBEVENT]
[CONTRACT:DATA:MISSING_FOLDERNAME]
[CONTRACT:ROUTING:INVALID_SINGLE_MODE]

---

## 3. Contract Categories

### DATA
event.json issues

### GROUP
grouping / mapping issues

### ROUTING
import path logic issues

### INGEST
pipeline execution issues

### STATE
desynchronization between layers

### VALIDATION
precondition failures

### UI
state sync issues

### PERFORMANCE
inefficiency violations

---

## 4. Debug Workflow (Contract-Based)

If a contract violation exists:
→ it is the primary source of truth for debugging

When an error occurs:

### Step 1 — Identify Contract

Example:
[CONTRACT:GROUP:DUPLICATE_SUBEVENT]

→ Category: GROUP  
→ Problem: duplicate mapping

---

### Step 2 — Map to System Layer

| Contract Type | Layer |
|------|------|
| DATA | event.json |
| GROUP | GroupManager |
| ROUTING | ImportRouter |
| INGEST | import pipeline |
| STATE | cross-layer state |
| VALIDATION | pre-check logic |
| UI | renderer |
| PERFORMANCE | rendering / filesystem |

---

### Step 3 — Inspect Source

Follow debug order:

event.json → mapping → routing → filesystem → UI

---

### Step 4 — Fix Root Cause

- fix only violating layer
- do not patch UI to hide issue

---

## 5. Standard Contract Errors

### GROUP

DUPLICATE_SUBEVENT  
MISSING_SUBEVENT  
EMPTY_GROUP  

---

### DATA

INVALID_EVENT_JSON  
MISSING_FOLDERNAME  

---

### ROUTING

INVALID_SINGLE_MODE  
INVALID_PATH  

---

### INGEST

COUNT_MISMATCH  
PARTIAL_EXECUTION  

---

### STATE

DESYNC  

---

### VALIDATION

IMPORT_BLOCKED  
MISSING_MAPPING  

---

### UI

DESYNC_STATE  

---

### PERFORMANCE

EXCESSIVE_RENDER  
REPEATED_SCAN  

---

## 6. Logging Protocol

Every contract failure must log:

- contract code
- relevant identifiers (groupId, componentId)
- minimal state snapshot
- enough data to reproduce the issue

---

## 7. Debug Acceleration Rule

If contract error exists:

→ do NOT investigate other layers first  
→ fix that contract immediately  

---

## 8. No-Silent-Failure Rule

All contract violations must:

- throw (strict mode)
OR
- log clearly (non-strict mode)

- contract violations must be identifiable by code

Never fail silently.

---

## 9. Developer Behavior

When debugging:

- search by contract code
- locate validator
- inspect failing condition
- trace back to state origin
- cross-check with system-contracts.md

---

## 10. Outcome

With contract-aware debugging:

- errors become self-descriptive
- root cause is localized
- debugging time is reduced drastically