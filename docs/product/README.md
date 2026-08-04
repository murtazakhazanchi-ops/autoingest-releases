# AutoIngest Product Documentation System

This directory is the canonical product-roadmap and implementation-history system for AutoIngest.

It records not only what is planned and completed, but how each feature evolved during implementation: investigations, bugs, options considered, decisions accepted or rejected, verification, and final outcomes.

> **Note on origin**: an earlier, minimal version of this README existed on the remote branch `origin/docs/feature-roadmap-system` (a single commit, roadmap-only IDs, older file numbering). This version supersedes it — it preserves that version's authority framing and update-rule philosophy but corrects the ID model (see below) and file layout to the two-ID system this system actually uses. See [10_CHANGELOG.md](10_CHANGELOG.md) for the integration decision.

## Authority and scope

- `docs/product/` is authoritative for **product planning, feature history, roadmap progress, bug investigations, decisions, implementation journals, and postmortems**.
- `docs/product/` is **not** authoritative for runtime behavior, contracts, security, event.json schema, ingestion behavior, metadata contracts, archive rules, UI system rules, data model, IPC contracts, persistence, performance requirements, or debugging contracts. Those remain owned by the existing technical documents under `docs/` (see `docs/CLAUDE.md`).
- If a product document and a technical document ever disagree, **the technical document is correct**. Fix the product document and record the reconciliation in the relevant feature or decision record — see [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md).
- [01_FEATURE_REGISTRY.md](01_FEATURE_REGISTRY.md) is the canonical inventory of product capabilities.
- [02_MASTER_ROADMAP.md](02_MASTER_ROADMAP.md) is the canonical milestone order, unless the project owner explicitly reprioritizes it.
- [04_PROJECT_DASHBOARD.md](04_PROJECT_DASHBOARD.md) records the current milestone, completed milestones, next milestone, and overall progress.
- [11_ARCHITECTURAL_EVOLUTION.md](11_ARCHITECTURAL_EVOLUTION.md) is the chronological architectural narrative — how the registry, roadmap, and decisions connect over time, and why major transitions happened. It does not carry its own authority over current behavior; it links to the records that do.
- `features/` contains one permanent document per registered product feature.
- `bugs/` contains reusable bug records and cross-feature troubleshooting knowledge.
- `decisions/` contains accepted and rejected architectural/product decisions.
- `postmortems/` contains records of significant incidents.

## Two separate ID systems — do not conflate them

- **`AI-FEAT-###`** — a permanent **product feature** identity. Represents a real, durable product capability, implemented or planned.
- **`AI-RM-###`** — a permanent **roadmap milestone** identity. Represents an implementation phase or planned development milestone.

A roadmap milestone may introduce one feature, expand several existing features, depend on multiple features, or consolidate multiple feature areas. **Roadmap IDs are not the product feature registry** — see [01_FEATURE_REGISTRY.md](01_FEATURE_REGISTRY.md) for the full 56-feature inventory, only a fraction of which map to a specific roadmap milestone (most already-implemented features predate the `AI-RM` numbering entirely).

Both ID systems are permanent: an ID is never reused or renumbered, even if a feature is later merged, deprecated, superseded, or reclassified.

## Update rule

Documentation must be updated alongside meaningful feature work — not reconstructed from memory after the fact:

1. **Before implementation** — record original scope, goals, assumptions, dependencies, and acceptance criteria.
2. **During implementation** — append design revisions, discovered constraints, bugs, troubleshooting evidence, and rejected alternatives as they happen.
3. **After verification** — record final architecture, files changed, tests, commits, unresolved risks, and follow-up work.
4. **After completion** — update the feature registry, master roadmap, implementation timeline, project dashboard, and changelog.

Nothing in a feature's evolution history should be silently deleted. Superseded approaches remain documented and are clearly marked as rejected, superseded, or deferred. See [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md) for the full mandatory workflow.

## Evidence discipline

Every factual claim here must trace to current source code, tests, existing technical docs, Git history, or current UI — or be marked explicitly as "Known from project history; repository evidence pending" or "Evidence pending — not yet documented as fact." Never invent dates, bugs, architecture, decisions, ownership, or maturity. See [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md) § Evidence Discipline.

## Files

- [00_PROJECT_VISION.md](00_PROJECT_VISION.md) — product purpose and long-term direction
- [01_FEATURE_REGISTRY.md](01_FEATURE_REGISTRY.md) — the canonical inventory of all 56 product features (`AI-FEAT-###`)
- [02_MASTER_ROADMAP.md](02_MASTER_ROADMAP.md) — ordered implementation roadmap (`AI-RM-001`–`AI-RM-009`)
- [03_IMPLEMENTATION_TIMELINE.md](03_IMPLEMENTATION_TIMELINE.md) — planned and actual milestone timing
- [04_PROJECT_DASHBOARD.md](04_PROJECT_DASHBOARD.md) — live project status
- [11_ARCHITECTURAL_EVOLUTION.md](11_ARCHITECTURAL_EVOLUTION.md) — the chronological narrative connecting the registry, roadmap, and decisions: how AutoIngest's architecture and archival workflow evolved, and why. Complements but does not duplicate the registry/roadmap/changelog/decisions.
- [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md) — mandatory maintenance workflow
- [06_FEATURE_TEMPLATE.md](06_FEATURE_TEMPLATE.md) — template for every feature file
- [07_BUG_TEMPLATE.md](07_BUG_TEMPLATE.md) — troubleshooting/bug-record template
- [08_DECISION_TEMPLATE.md](08_DECISION_TEMPLATE.md) — architecture/product decision template
- [09_POSTMORTEM_TEMPLATE.md](09_POSTMORTEM_TEMPLATE.md) — significant-incident template
- [10_CHANGELOG.md](10_CHANGELOG.md) — log of changes to this documentation system itself
- [features/](features/) — one file per registered feature
- [bugs/](bugs/) — cross-project bug knowledge base
- [decisions/](decisions/) — accepted/rejected decision records
- [postmortems/](postmortems/) — significant-incident records
- [exports/](exports/) — generated DOCX/PDF exports (not tracked in git, not the source of truth — see below)

## Exports are not source

Anything under `exports/` is generated output for sharing outside the repository. It is never edited directly and never authoritative — regenerate it from the Markdown source instead. `exports/` content is excluded from version control (see `.gitignore`); only the Markdown under `docs/product/` is tracked.

## How Claude Code and local agents must use this

See [CLAUDE.md](CLAUDE.md) for the mandatory agent-routing rules. In short: read the registry, roadmap, and dashboard before significant AutoIngest work; preserve stable IDs; update documentation alongside the work, not after; never let an export become authoritative; never contradict a technical contract under `docs/`.
