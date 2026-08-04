# DEC-014 — Controlled Keyword Registry

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-036 |
| Status | Accepted |
| Date | First-known implementation 2026-05-09 ("Keyword Registry ID Stabilization") |
| Evidence status | Verified from code (`main/main.js:3925` `_loadRegistryKeywords()`, `keywords:updateFromBridgeTxt`/`keywords:chooseBridgeTxt` IPC) |

## Context

Keywords, event types, locations, and cities need to stay consistent across every event and every photographer contributing to the archive — divergent, ad hoc vocabulary per event or per operator would make the archive progressively less searchable and less consistent over time. The pre-existing Adobe Bridge workflow already had a controlled vocabulary in active use.

## Options Considered

Only the chosen direction is evidenced. Full alternatives-considered detail: **Evidence pending**.

1. **A divergent, per-event or per-operator keyword list** — not evidenced as having been built or considered.
2. **A single controlled registry, extensible only via a defined import path from the existing Bridge vocabulary** — the option that was built.

## Decision

`data/keywords.registry.json` (alongside `data/cities.json`, `data/event-types.json`, `data/locations.json`, `data/photographers.json`) is the single controlled-vocabulary source backing metadata keyword resolution. The registry is extended, not replaced, via Adobe Bridge `.txt` keyword export import (`keywords:updateFromBridgeTxt`/`keywords:chooseBridgeTxt`) — folded directly into the Keyword Registry's own IPC surface rather than treated as a separate feature. Existing keywords are never deleted by this import path.

## Consequences

- Any future keyword-adjacent feature (search, analytics, AI-assisted tagging under AI-RM-009) must resolve against this same registry, not introduce a parallel or looser vocabulary source.
- The Bridge `.txt` import path must remain additive-only (never-delete) — a future change that allowed deletion via this path would be a different decision requiring its own record.
- Reinforces [DEC-004](DEC-004_PRESERVE_BRIDGE_BASED_ARCHIVAL_PRACTICE.md) — this is the concrete mechanism implementing that decision's principle for the keyword vocabulary specifically.

## Reconciliation Note

None recorded — no known divergence between this decision and current code.
