# Debug Playbook — Systematic Debugging Protocol

---

## 0. Core Philosophy

Debugging is NOT guessing.

Always:
- gather evidence first
- identify root cause
- apply minimal fix
- verify stability
- use contract violations as primary signals when available

Never:
- assume cause
- patch blindly
- fix UI before backend

---

## 1. Quick Diagnostic (First 5 Minutes)

Before deep debugging, answer:

- What should happen?
- What is actually happening?
- When did it start?
- Is it reproducible?
- What changed recently?

If unclear → STOP and clarify before proceeding.

---

## 2. Debug Order (MANDATORY)

If a contract error exists:
→ resolve that first before following full debug flow

Always follow this sequence:

1. event.json (data truth)
2. Group + mapping logic
3. Ingestion / routing logic
4. Filesystem output
5. UI rendering

Never skip levels.

---

## 3. Systematic Debug Flow

### Step 1 — Reproduce
- Create exact scenario
- Identify trigger conditions

---

### Step 2 — Inspect Data (event.json)

Check:
- structure
- mappings
- components
- logs
- validate against data contracts

If incorrect → issue is in logic layer

---

### Step 3 — Validate Mapping

Check:
- group ↔ subEvent mapping
- no duplicates
- no missing assignments
- check for GROUP contract violations

---

### Step 4 — Trace Ingestion

Follow:

Group → SubEvent → Photographer → Path

Verify:
- routing logic
- folder names
- single vs multi behavior
- check for ROUTING contract violations

---

### Step 5 — Verify Filesystem

Compare:
Expected vs Actual

If mismatch → ingestion issue

---

### Step 6 — Validate UI

Only now check:
- tiles
- badges
- preview tree

If mismatch → UI sync issue

---

## 4. Debug Categories

### Data Issues
→ event.json incorrect (DATA contract)

### Mapping Issues
→ GroupManager logic (GROUP contract)

### Routing Issues
→ ImportRouter (ROUTING contract)

### Ingestion Issues
→ pipeline execution (INGEST contract)

### State Issues
→ desync between layers (STATE contract)

### UI Issues
→ rendering / sync (UI contract)

---

## 5. Evidence-Based Debugging

Before fixing, collect:

- event.json snapshot
- group state
- routing decision
- output path
- contract error logs (if any)

Never fix without evidence.

---

## 6. Minimal Fix Rule

- Fix root cause only
- Do NOT refactor unrelated code
- Do NOT introduce new behavior
- Fix must not violate any system contract

---

## 7. Regression Validation

After fix:

- reproduce original issue
- test adjacent flows
- verify:
  - grouping
  - routing
  - UI sync

---

## 8. Critical Issue Protocol

If system is breaking:

- Assess impact (data loss? wrong imports?)
- Identify violated contracts
- Stop further operations
- Preserve current state
- Avoid partial fixes
- Consider rollback

---

## 9. Anti-Patterns (Never Do)

- Fix UI to hide backend issue
- Skip validation checks
- Modify multiple systems at once
- Guess without inspecting data
- Ignore contract violations
- Fix symptoms instead of root cause

## 10. Transaction Debugging Protocol

All ingestion-related debugging must follow transaction boundaries.

1. Identify Transaction Stage

Failures must be mapped to one of:

- IMPORT → file copy / routing
- LOGS → audit log generation or append
- LAST_IMPORT → summary metadata update
- STATUS → final state update

2. Debug Order (Transaction-Aware)

- Verify import result (files present in filesystem)
- Check imports[] in event.json
- Check lastImport consistency with latest import
- Check status value

3. Failure Mapping

Symptom	                     Likely Cause

Files missing	               Import failure
Logs missing	               appendImports failure
lastImport mismatch	         incorrect derivation
status incorrect	           transaction order issue

4. Consistency Check (Mandatory)

After every ingest:

- lastImport.timestamp === latest imports[].timestamp
- lastImport.fileCount === sum of latest log counts
- status === "complete" only if all steps succeeded

5. No Partial State Rule

If any of the following is true:

  - logs exist but status is not complete
  - status is complete but logs missing
  - lastImport does not match latest log

→ Transaction violation

Action:
  - STOP
  - Fix transaction flow (do not patch data)

6. Debug Principle

- Do not debug UI first.
- Always debug in this order:
  event.json → transaction flow → filesystem → UI

---

## 11. Renderer OOM — Large IPC Allocation

Symptom: `V8 process OOM (Oilpan: Large allocation)` on modal open, followed by `Render frame was disposed before WebFrameMain could be accessed` in the main process.

Debug order:

1. Identify which modal triggered the crash.
2. Find the IPC call made at modal open (e.g. `scanMasterEvents`).
3. Inspect what the IPC response contains — check for nested arrays (`imports[]`) or full event objects (`_eventJson`).
4. Locate the module-level renderer variable that caches the IPC result.
5. Confirm the variable holds the full payload rather than stripped metadata.

Fix: Strip heavyweight nested fields from the response before caching. Load per-event data lazily on selection.

See `docs/failure-patterns.md` §12 and `docs/performance-playbook.md` § IPC Payload Size.