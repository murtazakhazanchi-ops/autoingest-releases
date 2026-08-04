# AI-FEAT-022 — Photographer-Folder Resolution

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-022 |
| Category | Import and Archive Writing |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-018 |
| Related roadmap milestone | None |
| Related technical docs | None dedicated |
| Evidence status | Verified from current code |
| First-known implementation | Evidence pending (v0.9.0 introduced "Photographer Folder Sequencing" as a related but distinct capability — see Evolution) |
| Latest major update | Evidence pending |

## Summary

Resolves the photographer-level folder within an event's directory structure. Distinct identity concept from Login/Operator Identity (AI-FEAT-002, who is using the app) and Import Source Attribution (AI-FEAT-028, which device supplied the files) — three separate concepts that must not be collapsed into one, per `autoingest-architect` review, because this codebase's own contract treats photographer identity, operator identity, and import source as three independently-tracked things.

## Current Behavior

`services/photographerSequenceService.js`: `PC_PREFIX_RE` matches a `PCxx-` prefix convention (`PC01-` through `PC999-`), stripped to resolve the canonical photographer name. `EVENT_ROOT_KEY` (`__eventRoot__`) is used as the scope key when photographer folders live directly under the event root — i.e., single-component events where there's no separate sub-event layer.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

- **v0.9.0** — "Photographer Folder Sequencing" introduced as a related capability: a "Sequence Folders" action in Event Management letting an operator reorder photographer folders within an event via a drag-to-reorder modal (`docs/release-notes-v0.9.0.md`). Whether this is the same code path as the `PCxx-` prefix resolution or a separate later addition is evidence pending — flagged for a future pass rather than assumed.

## Known Bugs / Troubleshooting

See [BUG-002 — Photographer Sequence Folder Resolution Discards Existing Sequenced Folders](../bugs/BUG-002_PHOTOGRAPHER_SEQUENCE_FOLDER_RESOLUTION.md) (fixed 2026-06-24, commit `0d7e0b3`).

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `services/photographerSequenceService.js`
