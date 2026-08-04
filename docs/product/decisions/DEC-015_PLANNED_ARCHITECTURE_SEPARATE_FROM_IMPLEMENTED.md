# DEC-015 — Planned Architecture Remains Separate From Implemented Behaviour

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-049 through AI-FEAT-056, AI-RM-002 through AI-RM-009 |
| Status | Accepted |
| Date | 2026-08-04 (established as part of this documentation system itself) |
| Evidence status | Verified from docs (`docs/product/04_PROJECT_DASHBOARD.md` "Current risks" row, `docs/product/11_ARCHITECTURAL_EVOLUTION.md` §3I) |

## Context

This documentation system inventoried both implemented and planned capabilities in the same registry (`01_FEATURE_REGISTRY.md`). A real naming collision surfaced during that audit: `services/archiveRepairService.js` already exists in the codebase, but implements a narrow, unrelated temp-file-cleanup utility (Phase 13B-2, `.autoingest-sync-tmp`/`.autoingest-tx-tmp` cleanup only) — not the archive-wide repair capability planned under AI-RM-007/AI-FEAT-052. Without an explicit rule, the mere existence of a similarly-named file could be mistaken for partial implementation of the planned feature.

## Options Considered

Only the chosen direction is evidenced — this decision was made directly during this documentation system's own construction, not discovered after the fact. Full alternatives-considered detail is not applicable in the usual sense (there was no competing implementation approach weighed); the decision is a documentation-integrity rule, recorded here because it constrains how future implementation work on AI-RM-002 through AI-RM-009 must be scoped and described.

1. **Treat a similarly-named existing service as partial implementation of a planned feature** — rejected; would misrepresent AI-FEAT-052's actual (zero) implementation status and could cause future work to build on the wrong file's assumptions.
2. **Keep planned architecture strictly separate from implemented behavior, with each planned feature file explicitly stating "Confirmed zero implementation" evidence, and naming collisions called out explicitly as risks to resolve before implementation starts** — the option adopted.

## Decision

Planned features (AI-FEAT-049 through AI-FEAT-056, mapped to AI-RM-002 through AI-RM-009) must not be treated as partially implemented merely because a similarly-named narrow service already exists in the codebase for an unrelated purpose. Each planned feature's evidence status must explicitly confirm zero implementation where that is the case (`docs/product/11_ARCHITECTURAL_EVOLUTION.md` §3I). The known AI-RM-007/`archiveRepairService.js` naming collision is recorded as a current risk that must be resolved (e.g. renamed) before any implementation work begins on that milestone (`docs/product/04_PROJECT_DASHBOARD.md`).

## Consequences

- Whoever scopes AI-RM-007 must resolve the `archiveRepairService.js` naming collision (rename the existing narrow utility, or choose a different name for the new planned service) before adding code to that file — conflating the two would silently corrupt both the existing temp-file-cleanup behavior and the new archive-repair feature's identity.
- Future roadmap-scoping work for any AI-RM-### milestone must independently verify "zero implementation" (or state what partial implementation actually exists) rather than assuming it from the feature's planned status alone.
- This decision constrains documentation practice specifically — it does not itself change or authorize any implementation work.

## Reconciliation Note

None recorded — no known divergence between this decision and current documentation or code.
