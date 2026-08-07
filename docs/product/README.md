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
- [12_DEPENDENCY_MODEL.md](12_DEPENDENCY_MODEL.md) is a navigational index over relationships already documented elsewhere — it carries no authority of its own; if it and an individual record disagree, the record wins.
- [13_ENGINEERING_HANDBOOK.md](13_ENGINEERING_HANDBOOK.md) originates no new facts — every claim in it is downstream of a cited decision, technical doc, or other record.
- `features/` contains one permanent document per registered product feature, each with header metadata, a **Lifecycle Metadata** section (cross-cutting relationships), and an **Engineering Evolution** section (categorized history).
- `bugs/` contains reusable bug records and cross-feature troubleshooting knowledge — populated (`BUG-001`–`BUG-010`, see [bugs/README.md](bugs/README.md)).
- `decisions/` contains accepted and rejected architectural/product decisions — populated (`DEC-001`–`DEC-015`, see [decisions/README.md](decisions/README.md)).
- `postmortems/` contains records of significant incidents — populated (`PM-001`, see [postmortems/README.md](postmortems/README.md)).

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
- [12_DEPENDENCY_MODEL.md](12_DEPENDENCY_MODEL.md) — canonical relationship index: Milestone→Features, Decision→Decision, Bug→Decision, Bug→Bug, Architecture→Features/Decisions/Postmortems, Feature→Postmortem
- [13_ENGINEERING_HANDBOOK.md](13_ENGINEERING_HANDBOOK.md) — onboarding guide covering application, archival, metadata, folder, naming, UI, UX, performance, reliability, testing, release, documentation, decision, bug-documentation, and feature-lifecycle philosophy
- [14_VALIDATION_SPECIFICATION.md](14_VALIDATION_SPECIFICATION.md) — the integrity rules this system must satisfy (duplicate IDs, broken links, orphan records, roadmap inconsistencies, etc.) and how to check each one
- [15_MEMORY_TEMPLATE.md](15_MEMORY_TEMPLATE.md) — template for every Engineering Memory Capsule file (Part 6)
- [16_ENGINEERING_MEMORY_POLICY.md](16_ENGINEERING_MEMORY_POLICY.md) — the governing policy for `memory/`: authority model, ID model, significance rules, privacy/redaction, retention (Part 6)
- [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md) — mandatory maintenance workflow, including the 10-step Documentation Lifecycle Enforcement sequence
- [06_FEATURE_TEMPLATE.md](06_FEATURE_TEMPLATE.md) — template for every feature file
- [07_BUG_TEMPLATE.md](07_BUG_TEMPLATE.md) — troubleshooting/bug-record template
- [08_DECISION_TEMPLATE.md](08_DECISION_TEMPLATE.md) — architecture/product decision template
- [09_POSTMORTEM_TEMPLATE.md](09_POSTMORTEM_TEMPLATE.md) — significant-incident template
- [10_CHANGELOG.md](10_CHANGELOG.md) — log of changes to this documentation system itself
- [features/](features/) — one file per registered feature
- [bugs/](bugs/) — cross-project bug knowledge base
- [decisions/](decisions/) — accepted/rejected decision records
- [postmortems/](postmortems/) — significant-incident records
- [memory/](memory/) — durable Engineering Memory Capsules (`AI-MEM-####`) preserving the engineering conversation and reasoning behind meaningful work — historical evidence, not a technical contract (Part 6; see [16_ENGINEERING_MEMORY_POLICY.md](16_ENGINEERING_MEMORY_POLICY.md) § 3 for its place in the authority order)
- [exports/](exports/) — generated DOCX/PDF exports (not tracked in git, not the source of truth — see below)
- [generated/](generated/) — machine-queryable indexes, dependency graphs, timelines, and validation reports produced by `scripts/product-docs/` (Part 4). Tracked in git, unlike `exports/`, but never a source of new facts — see "Generated indexes are not source" below.

## Exports are not source

Anything under `exports/` is generated output for sharing outside the repository. It is never edited directly and never authoritative — regenerate it from the Markdown source instead. `exports/` content is excluded from version control (see `.gitignore`); only the Markdown under `docs/product/` is tracked.

## Generated indexes are not source

`docs/product/generated/` is a locator/index layer built from the canonical Markdown above by `scripts/product-docs/` — see [scripts/product-docs/README.md](../../scripts/product-docs/README.md) for the full tool and its authority model. It is tracked in git (a rebuild-free browse is worth the discipline cost), but `node scripts/product-docs/cli.js validate` enforces freshness on every run by rebuilding in memory and diffing byte-for-byte against what's committed — treat any `stale-generated-output` finding as blocking. Like `12_DEPENDENCY_MODEL.md`, it originates no new facts: if it and a canonical record ever disagree, regenerate it, don't edit around the discrepancy. Query it for navigation (`node scripts/product-docs/cli.js query "..."`, `impact <path>`), never for implementation-time truth — always open the canonical Markdown a query points to before acting on it.

## Documentation-system version

`DOCSYS_VERSION` (currently `1.0.0`) tracks the shape of `docs/product/generated/`'s output — see [scripts/product-docs/README.md](../../scripts/product-docs/README.md) § Documentation-system version. This is distinct from the application's `package.json` version and from the `AI-FEAT-###`/`AI-RM-###` ID systems above; do not conflate the three.

## Automation (Part 5)

`scripts/product-docs/automation/` extends the Part 4 tooling into an orchestration layer that keeps this system alive alongside normal engineering work — the project owner requests/discusses a change, an AI agent implements it, tests run, changes are committed; automation identifies affected features/milestones, updates the feature evolution journal, creates bug/decision records only when the evidence actually supports one, updates the changelog, and rebuilds `generated/`. It is governed by the same authority model and evidence discipline as everything else in this document: an **Engineering Evidence Packet** distinguishes deterministic git facts from AI-observed context from genuinely unknown information, and never promotes the third kind into a canonical record. See [scripts/product-docs/README.md](../../scripts/product-docs/README.md) § Part 5 — Automation for the full model, [CLAUDE.md](CLAUDE.md) § AI Session Completion Contract for what this obligates an agent to do before declaring work complete, and [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md) § Automation and the Update Rule for how it relates to the manual workflow above. Part 5's own `.autoingest-docs/` run state is repository-local and gitignored — never canonical, never committed.

## Engineering Memory (Part 6)

`docs/product/memory/` (governed by [16_ENGINEERING_MEMORY_POLICY.md](16_ENGINEERING_MEMORY_POLICY.md)) preserves the engineering conversation and reasoning around meaningful work — the original request, plan revisions, rejected alternatives, investigations, user feedback, and final outcome — that Parts 1–5 don't capture on their own. It is historical evidence, sitting below every canonical record in the authority order (§ 3 of that policy); it explains *why* a decision or feature evolved the way it did, and never overrides *what* the canonical record currently says. `node scripts/product-docs/cli.js memory <sub>` (see [scripts/product-docs/automation/memory/README.md](../../scripts/product-docs/automation/memory/README.md)) drives capture and compilation, largely automatically alongside Part 5's own Evidence Packet lifecycle — see [CLAUDE.md](CLAUDE.md) § 19 for what this obligates an agent to do.

## Autonomous Engineering Intelligence (Part 7)

`scripts/product-docs/` extends Parts 4-6 into a zero-touch layer so ordinary engineering work updates this system **without** the project owner or an AI agent manually invoking `product-docs` commands, choosing feature IDs, or writing decision/bug/release prose by hand:

- **Zero-touch git integration** (`automation/hookAutomation.js`, hooks at `scripts/product-docs/hooks/{pre-commit,post-commit,pre-push}`): pre-commit discovers pending Evidence Packets overlapping staged files and blocks only on a genuine hard failure (stale `generated/`, an unfinalized STRICT-mode session); pre-push auto-finalizes any pending session whose evidence gate would already pass cleanly and reports a push-impact summary; post-commit links the new commit hash into the matching session without ever amending the commit itself. Installing the hooks into this repository's real `.git/hooks/` remains a separate, explicit, human-approved step (`automation install-hooks`, with a non-mutating `--dry-run` readiness report) — never automatic.
- **Architectural decision intelligence** (`automation/decisionIntelligence.js`): detects structural signals of an architectural change (a new service/IPC boundary, a persistence/schema/locking/security-model touch) from a session's own `affected_files` — never from diff shape alone — and, only when the packet's evidence already clears the same "≥2 alternatives + an accepted solution" bar Part 5's explicit decision path uses, drafts a canonical `decisions/DEC-###` record with `Status: Draft` for human review. Evidence-incomplete signals become a local, non-canonical, review-required candidate under `.autoingest-docs/decision-candidates/` instead of a fabricated record.
- **Evidence-based feature ownership** (`automation/ownershipEngine.js`, `lib/ownershipManifest.js`): a deterministic, weighted, multi-signal resolver (explicit `Related Files` citation, subsystem-directory containment, require-graph, test-to-source pairing, decision/bug body citation, git co-change history) for source paths the existing Part 4 `explicit`/`inferred`/`unknown` resolution can't answer — every signal and weight is a named, documented constant, never an opaque model. `node scripts/product-docs/cli.js automation ownership <path>` for on-demand resolution; `generated/ownership-manifest.json`/`OWNERSHIP_MANIFEST.md` for the already-explicit projection (feature↔code-path, feature↔test, subsystem↔feature, and a derived IPC/service-layer view).
- **Autonomous release intelligence** (`automation/releaseIntelligence.js`, `node scripts/product-docs/cli.js release prepare --to <ref>`): auto-discovers the prior release from verified Git tags, and produces a full evidence-labeled release draft (categorized commits, breaking changes, migration notes, currently-open known issues, roadmap impact, risk assessment, documentation-health summary, deterministic release manifest) — never infers a breaking change from file count alone, never completes a roadmap milestone, never publishes a GitHub release or writes `docs/release-notes-*.md`.
- **Universal repository context assistant** (`automation/contextEngine.js`, `node scripts/product-docs/cli.js context <sub>`): a tool-neutral, deterministic (no embeddings, no network) context-bundle interface — `context feature/subsystem/file/roadmap/bug/decision/postmortem/memory/release/task/explain/bundle` — reusing the same query/impact/ownership resolution as everything else in this document, every bundle restating its own authority order so any agent (Claude, Codex, Gemini, ChatGPT, or a future tool) can orient itself before planning without a vendor-specific integration.

See [scripts/product-docs/README.md](../../scripts/product-docs/README.md) § Part 7 for the full command reference and [CLAUDE.md](CLAUDE.md) § 20 for what this obligates an AI agent to do (and not do) before declaring work complete.

## How Claude Code and local agents must use this

See [CLAUDE.md](CLAUDE.md) for the mandatory agent-routing rules. In short: read the registry, roadmap, and dashboard before significant AutoIngest work; preserve stable IDs; update documentation alongside the work, not after; never let an export become authoritative; never contradict a technical contract under `docs/`.

## Using the bug, decision, and postmortem records

`bugs/`, `decisions/`, and `postmortems/` are now populated (`10_CHANGELOG.md`'s 2026-08-04 "Part 2 populated" entry has the full inventory). Before debugging a state-management, resolver, metadata, or lock issue, check [bugs/README.md](bugs/README.md)'s index for a prior occurrence of the same symptom class — several of the ten backfilled records document a *recurring* pattern (e.g. [BUG-006](bugs/BUG-006_EVENT_EDIT_FULL_PAYLOAD_FIELD_DROP.md)'s full-payload field-drop weakness, [BUG-002](bugs/BUG-002_PHOTOGRAPHER_SEQUENCE_FOLDER_RESOLUTION.md)/[BUG-003](bugs/BUG-003_STALE_LOCAL_STAGING_RESTORE_OVER_ARCHIVE_ROOT.md)'s "never guess, require confirming evidence" resolver principle, formalized as [DEC-012](decisions/DEC-012_ARCHIVE_ROOT_RESOLUTION_REQUIRES_EVIDENCE.md)) that is easy to reintroduce in a new subsystem without realizing it already happened once. Before an architectural decision that touches metadata, archive-root resolution, locking, or transfer semantics, check [decisions/README.md](decisions/README.md) first — several existing decisions (`DEC-007` through `DEC-013`) constrain exactly these areas. [PM-001](postmortems/PM-001_METADATA_CORRECTNESS_GAP_PRODUCTION_READINESS_REVIEW.md) is the one populated postmortem; read its framing note before citing it, since it explicitly does not confirm the specific named incident this documentation task was originally briefed to investigate.
