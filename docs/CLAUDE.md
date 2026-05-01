# AutoIngest – Core Context

## System Overview
AutoIngest is an Electron-based ingestion system for structured archival workflows.

Core principles:
- event.json is the single source of truth
- ingestion is deterministic and idempotent
- UI reflects backend state exactly
- no overwriting of files (ever)

---

## Critical Constraints

### Media Extensions
- Defined ONLY in config/app.config.js
- Never hardcode elsewhere

### Security Model
- contextIsolation: true
- nodeIntegration: false
- sandbox: true

### File Copy Rules
- No overwrite ever
- Same file → skip
- Conflict → rename
- Operations must be idempotent
- Same input must always produce same output

### UI Rules
- UI must never diverge from backend state
- UI must not maintain independent or derived state
- UI must follow design-system.md for all visual elements

---

## Core Architecture

- Event System → event.json (single source of truth)
- Ingestion Engine → grouping + validation
- UI System → reflection layer
- Archive Writer → filesystem output
- Transaction Layer → controlled ingestion + state commit

---

## Transactional Ingest Layer

All ingestion operations must be executed as a single controlled transaction handled by the main process.

Execution Flow

import → logs → lastImport → status

1. Rules

- Renderer must NOT write to event.json directly
- All ingestion mutations must go through a single IPC transaction handler
- event.json must not be written in multiple independent steps during ingestion
- lastImport must be derived from imports (not independently computed)
- Status must only be set to "complete" after all steps succeed

2. Failure Behavior

If any step fails:
 - Do NOT update status to "complete"
 - Do NOT write partial logs or lastImport
 - System must revert to a safe state (status = "created")

3. Consistency Rule

- imports[] is the single source of truth for ingestion history
- lastImport must always reflect the latest entry in imports[]
- event.json must remain internally consistent at all times

4. Principle

- Validate → Execute → Commit
- Never partially update state

##  Task Documentation Routing
UI / layout / styling
→ docs/ui-system.md
→ docs/design-system.md
→ docs/performance.md

Import / copy / duplicate / routing
→ docs/ingestion-flow.md
→ docs/system-contracts.md
→ docs/data-model.md

event.json / persistence / validation
→ docs/data-model.md
→ docs/event-system.md
→ docs/system-contracts.md

Group mapping / sub-event assignment
→ docs/group-manager.md
→ docs/event-system.md
→ docs/ingestion-flow.md

Debugging / stabilization
→ docs/debug-playbook.md
→ docs/failure-patterns.md
→ docs/contract-aware-debugging.md

New feature planning
→ docs/features.md
→ docs/workflows.md
→ docs/decision-matrix.md

## Context Loading Protocol

- Architecture → /docs/architecture.md
- Ingestion → /docs/ingestion-flow.md
- UI → /docs/ui-system.md
- Data Model → /docs/data-model.md
- Event System → /docs/event-system.md
- Grouping → /docs/group-manager.md
- Performance → /docs/performance.md
- Debugging → /docs/debug-playbook.md
- Contracts → /docs/system-contracts.md
- Decision rules → /docs/decision-matrix.md
- Development rules → /docs/development-protocol.md
- Workflows → /docs/workflows.md
- Performance rules → /docs/performance-playbook.md
- Failure patterns → /docs/failure-patterns.md
- Contract debugging → /docs/contract-aware-debugging.md
- Edge cases → /docs/edge-cases.md
- Feature specs → /docs/features.md
- Design system → /docs/design-system.md

---

## Debug Protocol

If a contract error exists:
→ resolve that first

1. Check event.json (source of truth)
2. Validate mapping (GroupManager)
3. Trace ingestion (routing logic)
4. Verify filesystem output
5. Check UI (last step only)

---

## Renderer Memory Safety

- Never cache full IPC scan results that contain nested event objects (e.g. `_eventJson`, `imports[]`) in module-level renderer variables.
- Strip heavyweight data from IPC payloads immediately after receipt, before storing in any renderer state.
- Load per-event data lazily on selection via a single `readEventJson` IPC call — not upfront for all events at scan time.
- Violation causes V8/Oilpan OOM on large master archives with many events.

---

## Enforcement

If any rule or contract is violated:
→ STOP immediately  
→ Identify violated rule or contract  
→ Explain why it is invalid  
→ Propose a compliant redesign  

Never proceed with a violating implementation
