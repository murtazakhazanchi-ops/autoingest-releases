# Decision Matrix — How to Choose the Right Approach

This document defines how to decide between:
- patch vs refactor vs redesign
- quick fix vs structural change
- local vs system-wide impact

These rules prevent:
- over-engineering
- fragile fixes
- architectural drift

---

## 1. First Principle

Always ask:

> Is this a symptom or a root problem?

- If symptom → investigate deeper
- If root → fix properly

Never patch blindly.

---

## 2. Decision Tree

- No decision may violate system contracts (see system-contracts.md)

### Case A — Local Bug (Safe Patch)

Use a **patch** when ALL are true:

- Issue is isolated
- No data model impact
- No event.json change
- No cross-module dependency
- No contract violation

Action:
- Minimal fix
- No structural change

---

### Case B — Repeated Logic / Fragility (Refactor)

Use **refactor** when:

- Same logic duplicated
- Code is hard to reason about
- Bugs likely to repeat
- Performance inefficiency exists

Action:
- Improve structure
- Keep behavior identical
- No feature change
- Must preserve all system contracts

---

### Case C — System Inconsistency (Redesign)

Use **redesign** when:

- UI and backend diverge
- event.json cannot represent required state
- Multiple patches would be needed
- Logic conflicts with core rules
- Any system contract is at risk of being violated

Action:
- Propose new design
- Explain impact
- Do NOT implement immediately
- Wait for approval

---

## 3. Risk Levels

### Low Risk
- UI-only change
- Styling/layout
- isolated logic

→ proceed normally

---

### Medium Risk
- affects grouping
- affects mapping
- affects validation logic

→ proceed in small steps + verify each

---

### High Risk
- event.json structure
- ingestion routing
- filesystem operations
- any change affecting system contracts

→ MUST:
- explain design first
- get approval before coding

---

## 4. When to STOP and Ask

Stop immediately if:

- Requirement is ambiguous
- Multiple interpretations exist
- Change affects multiple systems
- You feel “this might break something else”

Ask instead of assuming.

---

## 5. Anti-Patterns (Never Do)

- Patch UI to hide backend issues
- Duplicate logic instead of fixing source
- Bypass validation
- Hardcode values that belong in config
- Modify event.json without validation
- Violate system contracts for quick fixes
- Introduce multiple sources of truth

---

## 6. Performance Decisions

Before optimizing, confirm:

- Is this actually a bottleneck?
- Is user impact measurable?

Only optimize if:
- repeated heavy operations
- large file sets involved
- UI lag observed

---

## 7. Consistency Rule

If a change affects:
- naming
- folder structure
- data flow

Then:
→ apply consistently across entire system

No partial updates.

---

## 8. Final Check Before Implementation

Ask:

- Does this respect event.json as source of truth?
- Does UI remain a pure reflection?
- Is the system still deterministic?
- Is the change reversible if needed?
- Does this comply with all system contracts?

If any answer is "no" → redesign required.