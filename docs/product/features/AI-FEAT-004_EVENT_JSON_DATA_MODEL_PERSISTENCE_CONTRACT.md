# AI-FEAT-004 — event.json Data Model & Persistence Contract

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-004 |
| Category | Application Platform |
| Status | Implemented |
| Maturity | Foundational |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | None |
| Related roadmap milestone | None |
| Related technical docs | `docs/data-model.md`, `docs/system-contracts.md` §1-2, `docs/event-system.md` |
| Evidence status | Verified from current code and docs |
| First-known implementation | v0.7.x ("Major architectural shift... Introduced event.json as source of truth" — `docs/history.md`) |
| Latest major update | v0.7.4-dev (atomic transaction write introduced; see AI-FEAT-021) |

## Summary

`event.json` is the single, authoritative representation of event structure, sub-events, group mappings, and ingestion state for every AutoIngest event. All system behavior — UI, routing, metadata, archive operations — derives from it. This is the foundational contract every other feature in this registry is built on top of.

## Current Behavior

Must always be valid JSON, pass schema validation before write, remain backward compatible, and never contain derived or UI-only state. Key top-level properties: `event` (metadata), `subEvents[]`, `groups[]`, `mappings[]`, `imports[]`, `status`. One group maps to exactly one sub-event; no orphan groups; no duplicate mappings. Writes are atomic, crash-safe, and idempotently reconciled. See `docs/system-contracts.md` §1 for the full MUST/MUST NOT list — these are non-negotiable invariants, not guidelines.

## Original Plan / Intent

Introduced as part of the v0.7.x "Core System Architecture" milestone alongside the Dashboard rebuild, Event system, Grouping system, and Import routing (`docs/history.md`).

## Evolution / Implementation Journal

- **v0.7.x** — event.json introduced as source of truth; ingestion pipeline structure established.
- **v0.7.4-dev** — `import:commitTransaction` replaces multi-step event.json writes (see AI-FEAT-021); `isValidEventJson` made non-mutating; dead code removed (`markEventImportComplete`, standalone `appendImports`).
- Ongoing — every feature that touches `event.json` (metadata's `metadataState` block, QMZ's sequence state, sync's `event.sync.json` manifest) writes exclusively through `main/eventJsonStore.js`'s `updateEventJsonAtomic`, never an independent read-modify-write (`docs/metadata-system.md`).

## Known Bugs / Troubleshooting

None recorded in `docs/product/bugs/` yet. `docs/failure-patterns.md` #5 and #9 map DATA-layer symptoms back to this contract.

## Decisions

None recorded.

## Future Enhancements

`docs/features.md`'s "Planned Features" § Persistence Enhancements ("Improve state persistence across sessions... event.json must remain source of truth") is too vague to map to a durable capability as currently documented — no specific mechanism, scope, or acceptance criteria exists in any doc read during this audit. Recorded here rather than invented as a new AI-FEAT.

## Related Files

- `main/eventJsonStore.js` (the only sanctioned read-modify-write path)
