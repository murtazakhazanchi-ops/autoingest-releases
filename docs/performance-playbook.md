# Performance Playbook — AutoIngest System

This defines how performance must be handled across the system.

Performance is a core feature, not an afterthought.

---

## 1. Core Principle

Always optimize for:

- deterministic behavior
- minimal unnecessary work
- predictable scaling

Avoid:
- repeated scans
- redundant computation
- unnecessary DOM updates

---

## 2. Performance Layers

### Layer 1 — Context (Claude)

- CLAUDE.md must stay small (<20k chars ideal)
- Load only required docs
- Avoid injecting full system context unnecessarily

Rule:
More context ≠ better performance

---

### Layer 2 — Filesystem

Critical risks:
- large directory scans
- recursive traversal
- excessive file handles

Rules:
- Never scan full directory unnecessarily
- Cache results when possible
- Avoid repeated stat/read operations
- Batch operations instead of per-file calls

---

### Layer 2b — IPC Payload Size

Critical risks:
- large IPC responses containing nested arrays (e.g. `imports[]` per event) or full event objects
- caching full structured-clone IPC payloads in module-level renderer variables

Rules:
- Strip heavyweight fields from scan results before assigning to any renderer module state
- Never retain full event.json objects for multiple events simultaneously in renderer memory
- Load per-event data lazily on selection via a single IPC call (one object in memory at a time)

Failure mode: `V8 process OOM (Oilpan: Large allocation)` renderer crash on modal open

---

### Layer 3 — Ingestion Pipeline

Rules:
- No duplicate processing
- Idempotent operations
- Avoid recomputing folder names
- Use event.json as reference (not recalculation)

---

### Layer 4 — UI Rendering

Rules:
- Never re-render entire UI unnecessarily
- Use tileMap (O(1) updates)
- Avoid querySelectorAll loops
- Update only changed elements

Allowed triggers for full render:
- folder change
- sort change
- view change

---

### Layer 5 — State Management

Rules:
- Single source of truth (event.json)
- No duplicated state
- No derived UI-only state

---

## 3. Common Performance Problems

### Problem: Slow UI
Cause:
- full DOM re-renders

Fix:
- use sync functions instead of rebuild

---

### Problem: Slow import
Cause:
- repeated file operations

Fix:
- batch copy
- avoid duplicate checks per loop

---

### Problem: Claude slowing down
Cause:
- large CLAUDE.md or too many docs loaded

Fix:
- trim CLAUDE.md
- load only relevant docs

---

## 4. Optimization Rules

Before optimizing, ask:

- Is this actually slow?
- Where is the bottleneck?
- Is it CPU, IO, or UI?

---

## 5. Do NOT Optimize Prematurely

Avoid:
- micro-optimizations
- complex caching without need
- over-engineering

---

## 6. Mandatory Checks

Before finalizing any feature:

- Does this increase file operations?
- Does this trigger extra rendering?
- Does this increase context size?

If YES → reconsider design

---

## 7. Scaling Awareness

System must handle:

- large memory cards
- thousands of files
- deep folder structures

Design must remain stable under scale.