# Development Protocol — Feature Implementation Rules

This document defines how all new features, fixes, and changes must be implemented.

These rules are mandatory and must be followed for every task.

---

## 1. Core Philosophy

- Do not rush to code
- Understand the system first
- Preserve architecture integrity
- Prefer correctness over speed
- Avoid hacks and temporary fixes

---

## 2. Implementation Workflow (MANDATORY)

Every feature must follow this sequence:

### Step 1 — Understand the Requirement
- Restate the requirement clearly
- Identify affected systems:
  - UI
  - event.json (data layer)
  - ingestion logic
  - filesystem

- If unclear → ask questions before proceeding

---

### Step 2 — Load Relevant Context
Load only required documents:

- Architecture → architecture.md
- Ingestion → ingestion-flow.md
- UI → ui-system.md
- Event logic → event-system.md
- Grouping → group-manager.md

Do NOT proceed without context.

---
### Step 3 — Design Before Coding"
* For ingestion-related features:

  * Identify if the change affects the transaction flow
  * Ensure no new direct event.json writes are introduced
  * Ensure consistency with existing transaction pipeline


### Step 4 — Decide Approach

Use decision-matrix.md to determine:

- Patch → small isolated fix
- Refactor → structural improvement
- Redesign → system-level change

Do not proceed without selecting the correct approach.

---

### Step 5 — Design Before Coding
- Explain the approach
- Identify:
  - data flow changes
  - state changes
  - edge cases
  - failure conditions

- Ensure:
  - event.json remains source of truth
  - no UI-only logic is introduced
  - no system contract is violated

---

### Step 6 — Implement in Small Steps

Work in **very small, controlled steps**:

For each step:
1. Describe what will be done
2. Implement minimal change
3. Stop

- Each step must not violate system contracts

---

### Step 7 — Validation After Each Step

After each change:
- Verify logic correctness
- Check against system rules
- Validate against system contracts
- Ensure no regressions

---

### Step 8 — Refactor Safely
- Improve clarity only after correctness
- Do not change behavior during refactor

---

### Step 9 — Commit Discipline

After each step, suggest:

- A small, meaningful commit message
- Focus: one logical change per commit

---

## 3. Testing Strategy (Practical TDD)

Strict TDD is preferred but adapted for this system:

### Use TDD when:
- Core logic (grouping, routing, validation)
- event.json transformations
- ingestion pipeline

### Use validation-first approach when:
- UI work
- Electron interactions
- filesystem operations

---

### TDD Cycle (when applicable)

1. Write failing test (or expected behavior)
2. Implement minimal fix
3. Verify pass
4. Refactor

- Always validate event.json integrity after logic changes

---

## 4. Architectural Rules (Never Break)

- event.json is the single source of truth
- No UI-derived state
- No silent corrections
- No direct filesystem assumptions without validation
- No bypassing validation layers
- Filesystem must always reflect event.json structure
- System behavior must remain deterministic
* Ingestion must follow transactional execution:

  * Do not update event.json from renderer
  * Do not split ingestion into multiple independent writes
  * All ingestion-related updates must be handled in a single main-process transaction


---

## 5. Scope Control

- Do NOT implement full feature at once
- Do NOT introduce unrelated improvements
- Do NOT refactor unrelated modules

Stay strictly within scope.

---

## 6. Communication Protocol

After each step:

- Explain what was done
- Explain why it was done
- Highlight any risks
- Highlight any contract risks or potential violations
- Suggest next step
- Provide commit message

Then STOP.

Wait for confirmation before proceeding.

---

## 7. Output Format (Strict)

Every step must follow this structure:

### Step
<what is being done>

### Changes
<code or logic explanation>

### Validation
<what was checked>

### Contract Check
<which contracts were validated or affected>

### Commit Message
<short, precise message>

### Next Step
<small next action>