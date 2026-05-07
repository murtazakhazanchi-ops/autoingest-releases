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
- Metadata Layer → post-import archive metadata, defined in docs/metadata-system.md

---

## Transactional Ingest Layer

All ingestion operations must be executed as a single controlled transaction handled by the main process.

Execution Flow:

import → logs → lastImport → status

### 1. Rules

- Renderer must NOT write to event.json directly
- All ingestion mutations must go through a single IPC transaction handler
- event.json must not be written in multiple independent steps during ingestion
- lastImport must be derived from imports, not independently computed
- Status must only be set to "complete" after all steps succeed

### 2. Failure Behavior

If any step fails:

- Do NOT update status to "complete"
- Do NOT write partial logs or lastImport
- System must revert to a safe state, usually status = "created"

### 3. Consistency Rule

- imports[] is the single source of truth for ingestion history
- lastImport must always reflect the latest entry in imports[]
- event.json must remain internally consistent at all times

### 4. Principle

- Validate → Execute → Commit
- Never partially update state

---

## Task Documentation Routing

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

Metadata / EXIF / IPTC / XMP / sidecars / tagging  
→ docs/metadata-system.md  
→ docs/data-model.md  
→ docs/event-system.md  
→ docs/ingestion-flow.md  
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

---

## Agent Selection Routing

AutoIngest uses project-level Claude Code agents stored in `.claude/agents/`.

The main Claude Code session acts as the orchestrator. It must classify the task, route docs through Task Documentation Routing, then select only the relevant specialist agents.

### Available Agents

- `autoingest-architect`
- `ui-system-specialist`
- `contract-debugger`
- `ingestion-routing-specialist`
- `performance-auditor`
- `event-data-guardian`
- `group-mapping-specialist`
- `metadata-specialist`
- `documentation-update-specialist`
- `release-docs-writer`
- `agent-learning-specialist`
- `code-reviewer`

### Selection Rules

- Use agents only where useful.
- Use agents in parallel only for read-only analysis or review.
- Do not allow multiple agents to edit the same files.
- Only one implementation agent may edit files.
- Run `code-reviewer` after important changes, especially when contracts, event.json, ingestion, persistence, routing, performance, Electron security, or architecture are affected.

### Task-to-Agent Routing

UI / layout / styling / renderer behavior  
→ `ui-system-specialist`

Import / copy / duplicate handling / routing / transaction ingest  
→ `ingestion-routing-specialist`

event.json / persistence / validation / atomic writes / backward compatibility  
→ `event-data-guardian`

Metadata / EXIF / IPTC / XMP / sidecars / tagging / keywords / Creator fields  
→ `metadata-specialist`

Group mapping / sub-event assignment / GroupManager / grouping validation  
→ `group-mapping-specialist`

Debugging / stabilization / contract failures / root-cause tracing  
→ `contract-debugger`

Performance / IPC payload / renderer memory / scan speed / thumbnails / import speed  
→ `performance-auditor`

Documentation updates after implementation  
→ `documentation-update-specialist`

Release notes / changelog / HOD summary / user-facing explanation  
→ `release-docs-writer`

Architecture review / task classification / impact mapping / patch-vs-refactor-vs-redesign  
→ `autoingest-architect`

Agent Learning Update  
→ `agent-learning-specialist`

Post-change review  
→ `code-reviewer`

### Metadata Agent Rule

For any task involving metadata tagging, EXIF/IPTC/XMP writes, RAW sidecars, keyword generation, Creator/Artist fields, Hijri metadata, metadata retry/status behavior, metadata audit display, or metadata documentation, use `metadata-specialist`.

Metadata tasks must also follow Task Documentation Routing:

→ docs/metadata-system.md  
→ docs/data-model.md  
→ docs/event-system.md  
→ docs/ingestion-flow.md  
→ docs/system-contracts.md

### Agent Learning Rule

For Agent Learning Update tasks:

- Use `agent-learning-specialist`.
- Do not edit app code.
- Read `.claude/learning-rules.md`.
- Update `.claude/learning-log.md` first.
- Promote only durable reusable lessons into relevant `.claude/agents/*.md`.

---

## Agent Learning Update Workflow

AutoIngest uses project-level Claude Code agents stored in `.claude/agents/`.

After significant completed work, Claude may be asked to run an Agent Learning Update.

### Purpose

The purpose is to improve future specialist-agent behavior by recording durable lessons from completed work.

### Rules

- Do not auto-edit `.claude/agents/*.md` without explicit user request.
- First record reusable lessons in `.claude/learning-log.md`.
- Use `.claude/learning-rules.md` as the policy for what may be promoted.
- Promote only durable, reusable rules into `.claude/agents/*.md`.
- Keep agent files concise.
- Do not duplicate the same rule across many agents unless each agent genuinely needs it.
- Never store temporary chat content, screenshots, or one-off wording as agent rules.
- Agent Learning Update is documentation-only.
- Do not edit app code during an Agent Learning Update task.

### When requested to run Agent Learning Update

Claude must:

1. Classify the completed work.
2. Read `.claude/learning-rules.md`.
3. Inspect only relevant `.claude/agents/*.md` files.
4. Add a concise entry to `.claude/learning-log.md`.
5. Declare which lessons should be promoted.
6. Update only the necessary agent files.
7. Return:
   - learning-log entry added
   - agent files inspected
   - agent files updated
   - rules promoted
   - validation checks added
   - suggested commit message

---

## Agent Learning Update Prompt Trigger

After completing significant AutoIngest work, Claude must evaluate whether the work produced reusable lessons for future specialist-agent behavior.

Claude must not automatically run Agent Learning Update.

Instead, Claude must ask the user whether to run it.

### When Claude should ask

Ask after work that includes any of the following:

- A bug fix that revealed a reusable debugging pattern
- A UI/layout correction that created a durable design rule
- A data model or event.json behavior change
- An ingestion, routing, transaction, or import-flow change
- A metadata, sidecar, tagging, or archive-search contract change
- A performance optimization or discovered bottleneck pattern
- A new workflow, validation rule, or contract clarification
- A repeated mistake that should be prevented in future tasks
- A change that affects how specialist agents should reason or validate

### When Claude should not ask

Do not ask after:

- Tiny wording changes
- One-off visual tweaks with no reusable lesson
- Temporary experiments
- Reverted changes
- Tasks that produced no durable rule
- Pure command/output assistance
- Simple explanations with no project behavior change

### Required post-task question

If the completed work appears to contain reusable lessons, Claude must end the task with:

> This work may contain reusable lessons for future AutoIngest agents. Should I run an Agent Learning Update?

Claude must wait for user confirmation.

### If the user says yes

Claude must run the Agent Learning Update Workflow:

1. Classify the completed work.
2. Read `.claude/learning-rules.md`.
3. Inspect only relevant `.claude/agents/*.md` files.
4. Add a concise entry to `.claude/learning-log.md`.
5. Declare which lessons should be promoted.
6. Update only the necessary agent files.
7. Return:
   - learning-log entry added
   - agent files inspected
   - agent files updated
   - rules promoted
   - validation checks added
   - suggested commit message

### If the user says no

Claude must not update `.claude/learning-log.md` or `.claude/agents/*.md`.

Claude may simply continue with the next requested task.

---

## Context Loading Protocol

- Architecture → /docs/architecture.md
- Ingestion → /docs/ingestion-flow.md
- UI → /docs/ui-system.md
- Data Model → /docs/data-model.md
- Event System → /docs/event-system.md
- Metadata → /docs/metadata-system.md
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

1. Check event.json source of truth
2. Validate mapping through GroupManager
3. Trace ingestion through routing logic
4. Verify filesystem output
5. Check UI last

For metadata-specific bugs:  
→ first read docs/metadata-system.md, then trace source data → queue/status → file/sidecar output → UI.

---

## Renderer Memory Safety

- Never cache full IPC scan results that contain nested event objects, such as `_eventJson` or `imports[]`, in module-level renderer variables.
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