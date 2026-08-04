# Changelog — docs/product/

This is a log of changes to the **documentation system itself** (registry entries added/changed, roadmap milestones moved, major restructuring) — not a user-facing release changelog. For user-facing release notes, see `docs/release-notes-*.md`.

Append newest first. Never edit or delete a prior entry — if something was wrong, add a correcting entry.

---

## 2026-08-04 — System established

- Created `docs/product/` as the canonical local product-roadmap and engineering-history system, per explicit user instruction.
- Integrated the starter `docs/product/README.md` that previously existed only on `origin/docs/feature-roadmap-system` (single commit, no conflicting local changes), amending it to the corrected two-ID authority model (`AI-FEAT-###` product features + `AI-RM-###` roadmap milestones) rather than the roadmap-only ID scheme the starter version used.
- Performed a full repository-backed feature inventory audit against source, tests, and existing `docs/` technical documentation.
- Established the initial `01_FEATURE_REGISTRY.md`, `02_MASTER_ROADMAP.md` (`AI-RM-001`–`AI-RM-009`), `03_IMPLEMENTATION_TIMELINE.md`, `04_PROJECT_DASHBOARD.md`, and `00_PROJECT_VISION.md`.
- Added a `docs/product/` exception to `.gitignore` (previously the entire directory was excluded by the blanket `docs/*` rule with only a short allowlist) so the system is trackable without force-adding files.
- No application/runtime code changed.
