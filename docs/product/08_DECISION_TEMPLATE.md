# Decision Record Template

Copy this structure for every `docs/product/decisions/DEC-###_NAME.md` file. Use this when a real alternative was considered and one was chosen — not for routine implementation choices with no meaningful tradeoff.

---

```markdown
# DEC-### — <Short Name>

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-### / AI-RM-### |
| Status | Accepted / Rejected / Superseded by DEC-### / Deferred |
| Date | <date, if known> |
| Evidence status | Verified from Git history / code / docs, or "Known from project history; repository evidence pending." |

## Context

What problem or requirement prompted this decision.

## Options Considered

1. **Option A** — description, tradeoffs
2. **Option B** — description, tradeoffs
3. (etc.)

## Decision

Which option was chosen and why.

## Consequences

What this decision commits the project to, and what it forecloses. Include any known follow-up debt.

## Reconciliation Note

If this decision was later found to conflict with an authoritative technical doc under `docs/`, record what changed and which doc won (the technical doc always wins — see `05_DOCUMENTATION_WORKFLOW.md` § Authority Boundary).
```
