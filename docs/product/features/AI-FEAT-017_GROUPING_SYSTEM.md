# AI-FEAT-017 — Grouping System

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-017 |
| Category | Grouping and Routing |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-004 (must remain consistent with event.json mappings) |
| Related roadmap milestone | None |
| Related technical docs | `docs/group-manager.md`, `docs/features.md` #3 |
| Evidence status | Verified from current code and docs |
| First-known implementation | v0.7.x |
| Latest major update | Evidence pending |

## Summary

Assigns selected files into logical groups mapped to sub-events. A transient renderer state layer (`renderer/groupManager.js`) that must always sync with `event.json` and reset on event change.

## Current Behavior

Group shape: `{id, label, colorIdx, files: Set, subEventId, metadataTags}`. Rules: groups never empty (auto-removed when empty), one group → one sub-event, files must belong to exactly one group (structural exclusivity via `_fileGroupMap`, one groupId per filePath — not a keyboard-shortcut mechanism), groups must have a valid `subEventId` before import. Operations: `createGroup`, `assignFiles`, `unassignFiles`, `setSubEvent` — invalid operations are rejected, never silently corrected. 10 pastel colors keyed to `--group-N` CSS vars, derived at render time from array position (no drift after deletions).

**Evidence-pending note**: a "group shortcuts" keyboard-assignment mechanism (numeric-key group assignment) was searched for directly in `renderer/renderer.js` and not found. Do not assume this exists — the one-group-per-file *exclusivity* constraint is real and structural (`_fileGroupMap`), but a dedicated keyboard-shortcut UI for it is evidence-pending / possibly not implemented.

## Original Plan / Intent

Introduced as part of the v0.7.x "Core System Architecture" milestone (`docs/history.md`).

## Evolution / Implementation Journal

- **v0.7.x** — grouping system introduced.

## Known Bugs / Troubleshooting

See `docs/failure-patterns.md` #7 (Groups Behaving Incorrectly) for the documented symptom→cause map for this feature.

## Decisions

None recorded.

## Future Enhancements

Whether a keyboard-shortcut group-assignment mechanism should be added is an open question — not currently scoped in any roadmap milestone.

## Related Files

- `renderer/groupManager.js`
