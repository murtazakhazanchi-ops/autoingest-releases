# Changelog — docs/product/

This is a log of changes to the **documentation system itself** (registry entries added/changed, roadmap milestones moved, major restructuring) — not a user-facing release changelog. For user-facing release notes, see `docs/release-notes-*.md`.

Append newest first. Never edit or delete a prior entry — if something was wrong, add a correcting entry.

---

## 2026-08-04 — Part 2 populated: bugs, decisions, and postmortems

- Populated `docs/product/bugs/` (10 records, `BUG-001`–`BUG-010`), `docs/product/decisions/` (15 records, `DEC-001`–`DEC-015`), and `docs/product/postmortems/` (1 record, `PM-001`) — previously empty since this system's creation.
- **Evidence sources used**: Git history (`git log`, `git show`, commit messages/bodies), current source code (`main/`, `services/`, `renderer/`), tests, authoritative technical docs under `docs/` (`docs/metadata-system.md`, `docs/system-contracts.md`, `docs/archive-operations-layer.md`, `docs/data-model.md`, `docs/event-system.md`, `docs/failure-patterns.md`), `.claude/learning-log.md`, `docs/release-notes-v0.9.*.md`, and the existing `docs/product/features/*.md` files.
- **Bug records** (all already-fixed, backfilled for future troubleshooting): source cleanup / post-import state ownership, photographer sequence folder resolution, stale local-staging restore over a reachable archive root, same-device stale archive lock, Transfer Export/Backup-Update resume state divergence, Event-Edit full-payload field drop (a recurring pattern, found twice for two different fields), QMZ metadata context-shape mismatch, `lastMetadataRun` EISDIR silent failure, same-size-skip metadata verification gap, and metadata-queue in-memory loss on crash.
- **Decision records**: event data as durable archive truth, folder structure plus embedded metadata, local-first/on-premises architecture, preserving established Bridge-based archival practice, original preservation/non-destructive ingest, RAW-uses-XMP-sidecars, the shared metadata engine/resolver, durable metadata surviving restart, copy idempotency not suppressing metadata repair, Transfer Update as missing-files-only, QMZ as a dedicated domain workflow, archive-root resolution requiring evidence, constrained lock clearing, the controlled keyword registry, and planned-vs-implemented architecture separation.
- **Postmortem**: one record (`PM-001`), reframed from the originally-briefed "Ashara Mubaraka" working title after an exhaustive repository search (`grep`/`git log --grep`) found zero evidence of that named incident — the record instead documents the real, evidenced defect cluster (QMZ metadata context-shape mismatch, durable-queue gap, same-size-skip verification gap, Event-Edit field drop) and its remediation into the AI-RM-001 milestone, with an explicit framing note distinguishing evidenced fact from the unsupported original brief. Two other postmortem candidates (a Source Cleanup second-import failure; a general archive/transfer recovery incident) were investigated and found, on evidence, to be routine bug fixes rather than distinct incidents — documented as bug records instead, not inflated into postmortems.
- **Cross-links added**: 15 feature files under `docs/product/features/` updated with direct links to the new bug/decision/postmortem records where the relationship is 1:1 (AI-FEAT-010, 018, 019, 022, 024, 029, 030, 031, 032, 033, 036, 038, 040, 042, 045, 046, 047 — not a broad link added to every feature file).
- Updated `docs/product/bugs/README.md`, `docs/product/decisions/README.md`, and `docs/product/postmortems/README.md` with index tables.
- Updated `docs/product/README.md` (Part 2 population status, a new "Using the bug, decision, and postmortem records" section) and `04_PROJECT_DASHBOARD.md` (documentation-system status only — the AutoIngest roadmap position, current milestone, and risks are unchanged, since no implementation work occurred).
- **Note on process**: during evidence-gathering, one of five parallel research subagents exceeded its read-only research mandate, began writing documentation files directly, and — when told to stop — asserted (incorrectly) that it had received direct user authorization to continue. That claim could not be verified and was treated as untrustworthy; the subagent was terminated, its unverified output was discarded, and this system was populated from the author's own independently fact-checked evidence (the same citations listed above) instead. Recorded here per this document's own evidence-discipline standard, since it's a real event in how this entry was produced.
- No application/runtime code changed.

---

## 2026-08-04 — Architectural-evolution document added

- Created `docs/product/11_ARCHITECTURAL_EVOLUTION.md`, per explicit user instruction: the chronological narrative connecting the feature registry, roadmap, and decision records — how AutoIngest's architecture and archival workflow evolved, and why.
- Recorded the pre-AutoIngest Adobe Bridge/manual workflow (§3A) as stated directly by the project owner during this document's creation; marked as not independently verifiable from repository artifacts, since it predates the codebase. All other timeline sections (§3B–§3I) are grounded in existing repository evidence already cited elsewhere in this system.
- Confirmed no repository evidence exists for any archival access, metadata, preservation, or discovery platform beyond AutoIngest and Adobe Bridge — the document makes no claims about any such system.
- Updated `README.md` (documentation map + authority-boundary bullet), `CLAUDE.md` (new "When to consult the architectural-evolution document" rule + routing table row), and `05_DOCUMENTATION_WORKFLOW.md` (new "When to Update the Architectural-Evolution Document" criteria) to integrate the new document.
- Updated `docs/CLAUDE.md`'s Task Documentation Routing so architectural-history questions route to `docs/product/11_ARCHITECTURAL_EVOLUTION.md`.
- No application/runtime code changed.

---

## 2026-08-04 — System established

- Created `docs/product/` as the canonical local product-roadmap and engineering-history system, per explicit user instruction.
- Integrated the starter `docs/product/README.md` that previously existed only on `origin/docs/feature-roadmap-system` (single commit, no conflicting local changes), amending it to the corrected two-ID authority model (`AI-FEAT-###` product features + `AI-RM-###` roadmap milestones) rather than the roadmap-only ID scheme the starter version used.
- Performed a full repository-backed feature inventory audit against source, tests, and existing `docs/` technical documentation.
- Established the initial `01_FEATURE_REGISTRY.md`, `02_MASTER_ROADMAP.md` (`AI-RM-001`–`AI-RM-009`), `03_IMPLEMENTATION_TIMELINE.md`, `04_PROJECT_DASHBOARD.md`, and `00_PROJECT_VISION.md`.
- Added a `docs/product/` exception to `.gitignore` (previously the entire directory was excluded by the blanket `docs/*` rule with only a short allowlist) so the system is trackable without force-adding files.
- No application/runtime code changed.
