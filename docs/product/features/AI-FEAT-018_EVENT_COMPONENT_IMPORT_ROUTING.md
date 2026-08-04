# AI-FEAT-018 — Event-Component Import Routing

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-018 |
| Category | Grouping and Routing |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-004, AI-FEAT-009, AI-FEAT-017 |
| Related roadmap milestone | None |
| Related technical docs | `docs/event-system.md` § Routing Relationship, `docs/ingestion-flow.md` § Routing |
| Evidence status | Verified from docs (already fully read as required context) |
| First-known implementation | v0.7.x |
| Latest major update | Evidence pending |

## Summary

Derives archive folder paths purely from `event.json` — no dynamic path computation happens during import. Single-component events route to `Collection/Event/Photographer/`; multi-component events route to `Collection/Event/SubEvent/Photographer/`. Video files always land inside a `VIDEO` subfolder.

## Current Behavior

`ImportRouter` must use `event.json` for path generation; no dynamic path logic exists outside it. Folder names are persisted at event-creation/editing time (AI-FEAT-009/010), never recomputed during import. Paths must be deterministic given the same `event.json`.

## Original Plan / Intent

Introduced as part of the v0.7.x "Core System Architecture" milestone (`docs/history.md`), alongside the Dashboard rebuild, Event system, and Grouping system.

## Evolution / Implementation Journal

- **v0.7.x** — import routing introduced.

## Known Bugs / Troubleshooting

See `docs/failure-patterns.md` #2 (Files Imported to Wrong Folder) for the documented symptom→cause map.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `renderer/importRouter.js`
