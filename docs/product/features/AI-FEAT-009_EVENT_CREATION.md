# AI-FEAT-009 — Event Creation

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-009 |
| Category | Event Management |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-004 (writes event.json), AI-FEAT-018 (routing derives from what this creates) |
| Related roadmap milestone | None |
| Related technical docs | `docs/event-system.md` § EventCreator, `docs/features.md` #4 |
| Evidence status | Verified from current code and docs |
| First-known implementation | v0.7.x (event system introduction) |
| Latest major update | v0.8.8 (Event Creator layout redesign) |

## Summary

The Event Creator wizard: defines a Collection, then Event metadata via one or more Components (EventType, Location, City, Country, Additional Keywords), generates the `event.json` structure, and previews the final folder structure before commit.

## Current Behavior

Component rows support drag-to-reorder (reorders `_eventComps` in-place, refreshes the folder-name preview immediately). Each component row is a 5-column grid: Event Type | Additional Keywords | Location | City | Country. Country uses the same `.tac-*` TreeAutocomplete structure as City but is excluded from the folder name. Additional Keywords with `useInFolderName: true` interleave around event tags per `folderPlacement` (`before-event-tag` / `after-event-tag` / `end-of-event-tags`); the in-editor preview and the final folder name share one source of truth via `folderNameHelper.js`. Naming: Collection = `{HijriDate}_{Label}`; Event name is deterministically generated from components and must remain stable once created. Validation before creation: all required components must exist, generated folder names must be valid, no duplicate subEvents.

## Original Plan / Intent

Introduced as part of the v0.7.x "Core System Architecture" milestone (`docs/history.md`).

## Evolution / Implementation Journal

- **v0.7.x** — event system introduction.
- **v0.8.8** — widened modal to 1320px; component row switched 3-column → 5-column grid; Country control redesigned to match City's TreeAutocomplete structure; `buildFolderName` interleaving logic added; dropdown `z-index` stacking-context fix (see AI-FEAT-008 §8b); removed unwanted auto-focus on new component; `[hidden]` CSS override added for Chromium UA sheet conflict. (`docs/history.md`)

## Known Bugs / Troubleshooting

None recorded in `docs/product/bugs/` yet.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `renderer/eventCreator.js`
- `renderer/folderNameHelper.js`
- `renderer/treeAutocomplete.js`
