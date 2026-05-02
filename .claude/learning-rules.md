# AutoIngest Agent Learning Rules

This file defines how Claude Code should update AutoIngest project agents.

## Principle

Agent learning must be controlled, explicit, and reviewable.

Claude must not silently modify `.claude/agents/*.md`.

## When to run learning update

Run an agent-learning update after:

- A major feature is completed.
- A bug fix reveals a reusable rule.
- A UI pattern is finalized.
- A regression is discovered and fixed.
- A task exposes a recurring Claude mistake.
- A new validation checklist becomes necessary.
- A new architecture constraint is established.

Do not run learning update after:

- Tiny copy edits.
- One-off visual tweaks.
- Temporary experiments.
- Unvalidated ideas.
- Personal preference notes that do not affect future implementation quality.

## Learning workflow

1. Review the completed task.
2. Extract reusable lessons.
3. Add a concise entry to `.claude/learning-log.md`.
4. Decide whether any lesson should be promoted to `.claude/agents/*.md`.
5. Before editing agents, declare:
   - which agents were inspected
   - which agents need updates
   - which agents do not need updates and why
   - exact sections to modify
6. Promote only durable rules.
7. Avoid duplicate rules across many agents.
8. Keep agent files concise and operational.
9. Do not edit app code during a learning update task.

## What may be promoted

Promote:

- Architecture rules
- File ownership rules
- UI system rules
- Validation checklists
- Common failure modes
- Correct implementation patterns
- Do-not-touch constraints
- Source-of-truth rules

Do not promote:

- Long chat excerpts
- Screenshots
- Temporary wording
- Unvalidated assumptions
- Over-specific one-time fixes
- Duplicate rules already present elsewhere

## Agent update format

When adding to an agent file, prefer this structure:

```markdown
## Learned Rule — Short Name

Context:
- When this applies.

Rule:
- What must be preserved or done.

Avoid:
- Common mistake to prevent.

Validation:
- What to check before completion.
