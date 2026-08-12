# Project Dashboard

Live project status. Update alongside meaningful feature work — see [05_DOCUMENTATION_WORKFLOW.md](05_DOCUMENTATION_WORKFLOW.md).

| Field | Value |
|---|---|
| Last updated | 2026-08-05 |
| Current product version | 0.9.9 (`package.json`) |
| Current branch | `main` |
| Latest relevant commit | `a78b97c` — "docs(product): add queryable documentation intelligence tooling" (Part 4), merged to `main`. |
| Documentation system status | Part 1 (feature registry, roadmap, dashboard) complete; Architectural Evolution complete; Part 2 (bugs/decisions/postmortems) complete; Part 3 (Documentation Intelligence & Lifecycle System) complete; Part 4 (Queryable Documentation & Engineering Intelligence — the `scripts/product-docs/` CLI's `build`/`validate`/`query`/`impact`/`changes` commands and the `docs/product/generated/` indexes) complete — all committed to `main` as of `a78b97c`. Part 5 (Autonomous Engineering Documentation Orchestration — `scripts/product-docs/automation/`, the `automation <sub>` CLI commands, Engineering Evidence Packets, and the version-controlled but not-yet-installed pre-commit/post-commit/pre-push hooks) implemented, reviewed, and locally validated 2026-08-05, committed to `main` 2026-08-06 — see [10_CHANGELOG.md](10_CHANGELOG.md) for the full entry. This documentation-system progress is independent of, and must not be read as advancing, the AutoIngest application roadmap below. |
| Total registered features | 57 (`AI-FEAT-001` through `AI-FEAT-057`) — this field and the rest of this dashboard were last fully reconciled 2026-08-05; only the counts directly touched by AI-FEAT-057/AI-RM-010 (2026-08-12) were updated here — the remaining fields below predate and are independent of that work and carry their own pre-existing staleness (see Documentation health row) |
| Implemented features | 45 (includes AI-FEAT-057) |
| Implemented — evolving | 4 (AI-FEAT-003, AI-FEAT-008, AI-FEAT-034, AI-FEAT-035) |
| Partially implemented | 0 |
| Planned features | 8 (AI-FEAT-049 through AI-FEAT-056, mapped 1:1 to AI-RM-002 through AI-RM-009) |
| Overall roadmap progress | 1/9 milestones complete |
| Completed roadmap milestones | AI-RM-001 (Metadata Audit & Repair); AI-RM-010 (Multi-Channel Release & Update System — a parallel infrastructure track, not part of the AI-RM-001…009 archive-capability sequence this dashboard otherwise tracks) |
| Current roadmap milestone | AI-RM-002 (Archive Maintenance) — not started |
| Active implementation task | None — not started (confirmed via exhaustive code/git search, see AI-FEAT-049) |
| Next milestone | AI-RM-002 (Archive Maintenance) |
| Following milestone | AI-RM-003 (Event Maintenance) |
| Blockers | None identified for AI-RM-002 beyond the absence of a defined scope |
| Current risks | (1) AI-RM-007's planned service name collides with an existing, unrelated `archiveRepairService.js` (temp-file cleanup only) — needs resolution before implementation starts. (2) AI-RM-006's scope needs explicit disambiguation from the already-implemented AI-FEAT-025 (narrower checksum verification) to avoid duplicating existing work without a clear reason. |
| Recently completed work | UI polish to the Metadata Management Modal / Audit & Repair tab (commits `4446a30` → `c5d200f`, 2026-08-02 through 2026-08-04) — cosmetic/layout only, no behavior change, all part of the already-complete AI-RM-001 |
| Next planned action | Discovery and specification for AI-RM-002 (Archive Maintenance) — no scope exists yet |
| Documentation health | This system (`docs/product/`) was established 2026-08-04 and extended through Parts 1–3 the same day; Part 4 (2026-08-05) added `docs/product/generated/documentation-health.md`/`.json` as a first mechanically-runnable implementation of [14_VALIDATION_SPECIFICATION.md](14_VALIDATION_SPECIFICATION.md)'s rules — see that generated report for the current live count (0 errors as of this update). All 56 feature files exist; evidence status varies per file (most are "Verified from current code," a minority — notably AI-FEAT-037 Metadata Reapply/Sync — are marked with intentionally lower evidence confidence pending a follow-up function-level audit). `bugs/`, `decisions/`, and `postmortems/` are populated (`BUG-001`–`BUG-010`, `DEC-001`–`DEC-015`, `PM-001`). Every feature file now also carries a mechanically-generated Lifecycle Metadata section (documentation-completeness is a computed field per file, not a subjective claim) and an Engineering Evolution section. |
| Evidence gaps | See each feature file's "Evidence status" field. Notable gaps: AI-FEAT-037 (Metadata Reapply/Sync — file-existence + learning-log evidence only, not independently code-audited), AI-FEAT-007 (Telemetry Pipeline — scope of data collected not yet audited), AI-FEAT-022 (Photographer-Folder Resolution — relationship to the v0.9.0 "Photographer Folder Sequencing" release-note item not yet confirmed as same-or-different code path) |
| Pending decisions | Naming collision for AI-RM-007's service (see Current risks); scope disambiguation for AI-RM-006 vs. AI-FEAT-025 |

## Roadmap Snapshot

```
AI-RM-001  Metadata Audit & Repair        [========== COMPLETE ==========]
AI-RM-002  Archive Maintenance            [ not started ]  ← next
AI-RM-003  Event Maintenance              [ not started ]
AI-RM-004  Archive Browser                [ not started ]
AI-RM-005  Global Search                  [ not started ]
AI-RM-006  Integrity Verification         [ not started ]
AI-RM-007  Archive Repair                 [ not started ]
AI-RM-008  Archive Analytics              [ not started ]
AI-RM-009  AI Archive Intelligence        [ not started ]
```

## How This Was Established

This dashboard, and the entire `docs/product/` system it summarizes, was created in a single documentation-only pass on 2026-08-04: full repository-backed feature inventory (two independent research passes + an `autoingest-architect` review pass), 56-entry feature registry, per-feature evidence-grounded documentation, and this roadmap/timeline/dashboard scaffold. No application code was changed. See [10_CHANGELOG.md](10_CHANGELOG.md) for the full entry.
