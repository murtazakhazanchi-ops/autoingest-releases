# AI-FEAT-031 — Metadata Event-State Derivation

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-031 |
| Category | Metadata |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | AI-FEAT-029 |
| Subfeatures | None |
| Dependencies | AI-FEAT-029, AI-FEAT-030 |
| Related roadmap milestone | AI-RM-001 |
| Related technical docs | `docs/metadata-system.md` § Event-Level Metadata State |
| Evidence status | Verified from docs (already fully read as required context) and `test/metadataStateService.test.js` |
| First-known implementation | Evidence pending |
| Latest major update | Evidence pending |

## Summary

An event's `metadataState.state` is always a pure derivation from durable per-file counts, recomputed fresh every time — never a field one callback happens to overwrite last.

## Current Behavior

Nine mutually-exclusive states, evaluated in fixed order: `metadata-not-required` → `metadata-interrupted` → `metadata-in-progress` → `metadata-complete` → `metadata-partial` → `metadata-failed` → `metadata-verification-required` → `metadata-queued` → `metadata-not-attempted`. A file whose write succeeded but whose read-back found a field mismatch (`partial`) is folded into the "incomplete" bucket — never counts toward `metadata-complete`. Video-excluded files never contribute to any count above `excluded`.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

No dated entries found specific to this subfeature beyond AI-FEAT-029's general timeline.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `main/metadataStateService.js`
