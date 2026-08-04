# AutoIngest Product Documentation System

This directory is the canonical product-roadmap and implementation-history system for AutoIngest.

It records not only what is planned and completed, but how each feature evolved during implementation: investigations, bugs, options considered, decisions accepted or rejected, verification, and final outcomes.

## Authority and scope

- `01_MASTER_ROADMAP.md` is the canonical milestone order unless the project owner explicitly reprioritizes it.
- `03_PROJECT_DASHBOARD.md` records the current milestone, completed milestones, next milestone, and overall progress.
- `features/` contains one permanent document per roadmap feature.
- `bugs/` contains reusable bug records and cross-feature troubleshooting knowledge.
- `decisions/` contains accepted architectural and product decisions.
- Existing technical documents under `docs/` remain authoritative for runtime contracts, architecture, security, metadata, ingestion, UI, and data-model rules.

## Update rule

Documentation must be updated alongside meaningful feature work:

1. Before implementation: record original scope, goals, assumptions, dependencies, and acceptance criteria.
2. During implementation: append design revisions, discovered constraints, bugs, troubleshooting evidence, alternatives, and decisions.
3. After verification: record final architecture, files changed, tests, commits, unresolved risks, and follow-up work.
4. After completion: update the master roadmap, project dashboard, implementation timeline, feature status, and changelog.

Nothing in a feature's evolution history should be silently deleted. Superseded approaches remain documented and are clearly marked as rejected, superseded, or deferred.

## Files

- `00_PROJECT_VISION.md` — product purpose and long-term direction
- `01_MASTER_ROADMAP.md` — ordered implementation roadmap
- `02_IMPLEMENTATION_TIMELINE.md` — planned and actual milestone timing
- `03_PROJECT_DASHBOARD.md` — live project status
- `04_DOCUMENTATION_WORKFLOW.md` — mandatory maintenance workflow
- `05_FEATURE_TEMPLATE.md` — template for every feature
- `06_BUG_TEMPLATE.md` — troubleshooting and bug-record template
- `07_DECISION_TEMPLATE.md` — architecture/product decision template
- `features/` — feature specifications and evolution journals
- `bugs/` — cross-project bug knowledge base
- `decisions/` — accepted/rejected decision records

## Feature ID convention

Roadmap features use stable IDs:

- `AI-RM-001` Metadata Audit & Repair
- `AI-RM-002` Archive Maintenance
- `AI-RM-003` Event Maintenance
- `AI-RM-004` Archive Browser
- `AI-RM-005` Global Search
- `AI-RM-006` Integrity Verification
- `AI-RM-007` Archive Repair
- `AI-RM-008` Archive Analytics
- `AI-RM-009` AI Archive Intelligence

These IDs must remain stable even if a feature name evolves.