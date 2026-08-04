# AI-FEAT-032 — Metadata Verification

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-032 |
| Category | Metadata |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | AI-FEAT-029 |
| Subfeatures | None |
| Dependencies | AI-FEAT-029, AI-FEAT-039 (Transfer Import is a primary trigger) |
| Related roadmap milestone | AI-RM-001 |
| Related technical docs | `docs/metadata-system.md` § Import Path Coverage |
| Evidence status | Verified from docs (already fully read as required context) and `test/metadataVerificationService.test.js` |
| First-known implementation | Evidence pending |
| Latest major update | Evidence pending |

## Summary

Read-only, post-hoc verification for files that landed via copy-only paths (Transfer Import, same-size-skip on Standard Import) where the copy step itself never checked metadata correctness.

## Current Behavior

Per `docs/metadata-system.md` § Import Path Coverage: Transfer Import / Update Import files land via copy only; a durable per-file outcome manifest records what happened, and a post-transfer read-only verification pass (never a destination-folder walk, which can't distinguish this transfer's files from unrelated pre-existing content) classifies each `copied`/`same-size-skipped`/`renamed`/`resumed` file. `failed`/`changed-skipped` outcomes are excluded from verification entirely. Auto-repair of anything incomplete is gated on the metadata setting; otherwise it lands in `metadata-verification-required` with a "Verify Metadata" action. Same-size-skip on Standard Import also triggers this regardless of whether the import's own copy batch had metadata enabled.

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

- `main/metadataVerificationService.js`
