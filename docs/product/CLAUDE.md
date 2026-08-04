# docs/product/ — Agent Rules

This file governs how Claude Code and other local agents must use and maintain the product documentation system. See [README.md](README.md) for what this system is and its authority boundary.

## Before significant AutoIngest work

Agents must read:

- [README.md](README.md)
- [01_FEATURE_REGISTRY.md](01_FEATURE_REGISTRY.md)
- [02_MASTER_ROADMAP.md](02_MASTER_ROADMAP.md)
- [04_PROJECT_DASHBOARD.md](04_PROJECT_DASHBOARD.md)
- the relevant feature document(s) under [features/](features/)
- linked bug records under [bugs/](bugs/)
- linked decision records under [decisions/](decisions/)
- the routed authoritative technical docs under `docs/` (per `docs/CLAUDE.md`'s Task Documentation Routing — this system does not replace that routing, it supplements it)

"Significant" means: implementing or modifying a registered feature, starting work on a roadmap milestone, or investigating a bug/decision that already has (or should have) a record here. Trivial or purely technical tasks (a one-line bug fix with no reusable lesson, a styling tweak) do not require reading this system first — use judgment consistent with `.claude/learning-rules.md`'s own "when not to" guidance.

## Agents must

- Preserve stable IDs (`AI-FEAT-###`, `AI-RM-###`) — never reuse, never renumber.
- Update product documentation alongside meaningful feature work, not after the fact from memory — see [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md).
- Never silently erase original plans or superseded approaches — append and mark, don't delete.
- Record bugs and troubleshooting evidence as they're discovered, in [bugs/](bugs/) when the pattern is reusable.
- Record alternatives considered and the decision made, in [decisions/](decisions/) when a real tradeoff existed.
- Update status/timeline/dashboard after completing work that changes a feature's or milestone's state.
- Never let a generated export (`exports/`) become authoritative — it is regenerated from the Markdown, never edited directly.
- Never contradict an authoritative technical doc under `docs/` — if this system and a technical doc disagree, the technical doc wins; fix this system and record the reconciliation.
- Never mark a feature `Implemented` (or a milestone `Complete`) without evidence and verification — evidence-pending is an acceptable, honest state; a fabricated-sounding "done" is not.

## Task-to-Doc Routing

| Task type | Read |
|---|---|
| Product feature registry / what capabilities exist | [01_FEATURE_REGISTRY.md](01_FEATURE_REGISTRY.md) |
| Roadmap / milestone progress / what's next | [02_MASTER_ROADMAP.md](02_MASTER_ROADMAP.md), [04_PROJECT_DASHBOARD.md](04_PROJECT_DASHBOARD.md) |
| Implementation timeline / estimates vs. actuals | [03_IMPLEMENTATION_TIMELINE.md](03_IMPLEMENTATION_TIMELINE.md) |
| Feature evolution / implementation journal | relevant `features/AI-FEAT-###_*.md` |
| Bug/troubleshooting knowledge base | [bugs/](bugs/) |
| Product/architecture decisions | [decisions/](decisions/) |
| Incident history | [postmortems/](postmortems/) |
| How to maintain this system | [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md) |

This file is intentionally short. It routes; it does not duplicate the full rules — those live in [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md).
