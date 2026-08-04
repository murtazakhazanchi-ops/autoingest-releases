# DEC-003 — Local-First and On-Premises Architecture

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-042, AI-FEAT-044 |
| Status | Accepted |
| Date | Foundational (AI-FEAT-042's four-root model; AI-FEAT-044's title states the principle directly) |
| Evidence status | Verified from code and docs (`docs/archive-operations-layer.md` § Three-Root Model) |

## Context

Institutional archival media (photographs of events, with Creator/Copyright defaulting to `© Aljamea-tus-Saifiyah` per `docs/metadata-system.md`) needs to remain under the institution's own control, and the ingestion workflow needs to function on-location where network connectivity to any external service cannot be assumed.

## Options Considered

Only the chosen direction is evidenced. No commit, doc, or code path evidences a cloud-storage or cloud-service-dependent alternative having been built, attempted, or explicitly rejected. Full alternatives-considered detail: **Evidence pending**.

1. **Local/NAS-only storage roots, no required cloud dependency** — the option that was built.

## Decision

All four of AutoIngest's storage roots are local or NAS-based, never a third-party cloud service: Active Archive Root (portable NAS), Local Staging Root (operator SSD), Main Archive Root (permanent office NAS/server), Transfer Drive Root (physical external drive) — `docs/archive-operations-layer.md` § Three-Root Model. "Local-First Background Archive Sync" (AI-FEAT-044) is a named, dedicated feature, not an incidental property. The system only operates on a root that is currently mounted and readable — there is no fallback to a remote service when local storage is unavailable.

## Consequences

- Any future feature must not introduce a required cloud dependency for core ingestion, metadata, or archive-operations functionality without this decision being explicitly revisited.
- Offline/on-location operation must remain possible — a design that assumes always-on connectivity to any external service would violate this decision.
- Multi-site/multi-NAS movement must go through explicit Transfer Export/Import or root re-resolution mechanisms, not a cloud intermediary — see [DEC-012](DEC-012_ARCHIVE_ROOT_RESOLUTION_REQUIRES_EVIDENCE.md) for the related "no auto-routing without evidence" principle.

## Reconciliation Note

None recorded — no known divergence between this decision and current technical contracts.
