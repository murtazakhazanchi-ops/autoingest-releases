# Roadmap Dashboard (Generated)

> Generated artifact — cross-checked against 01_FEATURE_REGISTRY.md, 02_MASTER_ROADMAP.md, 03_IMPLEMENTATION_TIMELINE.md, and 04_PROJECT_DASHBOARD.md at generation time; generation fails with a diagnostic instead of silently picking a side if those sources disagree. Regenerate with `node scripts/product-docs/cli.js build`.

**Progress**: 2/11 milestones complete (18.2%)
**Current milestone**: AI-RM-002
**Following milestone**: AI-RM-003
**Total features**: 58

## Feature status counts (overall)

| Status | Count |
|---|---|
| Implemented — evolving | 5 |
| Implemented | 45 |
| Planned | 8 |

## Milestones

| ID | Name | Status | Included features | Dependencies | Planned estimate | Next action |
|---|---|---|---|---|---|---|
| AI-RM-001 | Metadata Audit & Repair | **Completed** | AI-FEAT-029, AI-FEAT-030, AI-FEAT-031, AI-FEAT-032, AI-FEAT-033, AI-FEAT-034, AI-FEAT-035, AI-FEAT-036, AI-FEAT-037 | — | Evidence pending (predates this documentation system) | None — complete. Recent work (2026-08-02 through 2026-08-04) has been UI polish on the already-delivered Metadata Management Modal, not new scope. |
| AI-RM-002 | Archive Maintenance | Planned — not started | AI-FEAT-049 | AI-RM-001 | 3–5 weeks (see [03_IMPLEMENTATION_TIMELINE.md](03_IMPLEMENTATION_TIMELINE.md)) | Discovery and specification |
| AI-RM-003 | Event Maintenance | Planned — not started | AI-FEAT-050 | AI-RM-002 | 4–6 weeks | Not started — follows AI-RM-002 |
| AI-RM-004 | Archive Browser | Planned — not started | AI-FEAT-051 | AI-RM-003 | 5–7 weeks | Not started — follows AI-RM-003 |
| AI-RM-005 | Global Search | Planned — not started | AI-FEAT-053 | AI-RM-004 | 3–5 weeks | Not started — follows AI-RM-004 |
| AI-RM-006 | Integrity Verification | Planned — not started | AI-FEAT-054 | AI-RM-005 | 3–4 weeks | Not started — follows AI-RM-005 |
| AI-RM-007 | Archive Repair | Planned — not started | AI-FEAT-052 | AI-RM-006 | 4–6 weeks | Not started — follows AI-RM-006 |
| AI-RM-008 | Archive Analytics | Planned — not started | AI-FEAT-055 | AI-RM-007 | 2–4 weeks | Not started — follows AI-RM-007 |
| AI-RM-009 | AI Archive Intelligence | Planned — not started | AI-FEAT-056 | AI-RM-008 | 6–10 weeks | Not started — follows AI-RM-008; final milestone in the AI-RM-001…009 archive-capability sequence (AI-RM-010 is a separate, parallel release-infrastructure track — see below, not a continuation of this sequence) |
| AI-RM-010 | Multi-Channel Release & Update System | **Completed** — verified on real Windows hardware (2026-08-13) | AI-FEAT-057 | — | Single implementation session (2026-08-12), plus a three-part live-pilot verification arc (2026-08-13) | None — complete. A future real Stable release (whenever separately authorized) will automatically carry the Update Channel selector to the entire existing Stable install base as an ordinary update; no further migration work is required for that transition. |
| AI-RM-011 | AutoIngest Knowledge & Onboarding Portal (Stage 1) | In Progress — Stage 1 (prototype) complete; Stage 2 not started | AI-FEAT-058 | AI-RM-001, AI-RM-010 | Single implementation session (2026-08-13) | Not started — Stage 2 (full portal UI, authored Workflow/Troubleshooting/Navigation content, retrieval-precision improvements) requires separate review and authorization before beginning, per the Stage 1 brief's own stop condition. |

## Blockers and risks

**Blockers**: None identified for AI-RM-002 beyond the absence of a defined scope

**Current risks**: (1) AI-RM-007's planned service name collides with an existing, unrelated `archiveRepairService.js` (temp-file cleanup only) — needs resolution before implementation starts. (2) AI-RM-006's scope needs explicit disambiguation from the already-implemented AI-FEAT-025 (narrower checksum verification) to avoid duplicating existing work without a clear reason.

## Recent and next

**Recently completed documentation work**: UI polish to the Metadata Management Modal / Audit & Repair tab (commits `4446a30` → `c5d200f`, 2026-08-02 through 2026-08-04) — cosmetic/layout only, no behavior change, all part of the already-complete AI-RM-001

**Next planned action**: Discovery and specification for AI-RM-002 (Archive Maintenance) — no scope exists yet

**Pending decisions**: Naming collision for AI-RM-007's service (see Current risks); scope disambiguation for AI-RM-006 vs. AI-FEAT-025

**Evidence gaps**: See each feature file's "Evidence status" field. Notable gaps: AI-FEAT-037 (Metadata Reapply/Sync — file-existence + learning-log evidence only, not independently code-audited), AI-FEAT-007 (Telemetry Pipeline — scope of data collected not yet audited), AI-FEAT-022 (Photographer-Folder Resolution — relationship to the v0.9.0 "Photographer Folder Sequencing" release-note item not yet confirmed as same-or-different code path)

