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

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | None beyond Dependencies/Parent/Subfeatures already listed in the header table above |
| Related decisions | [DEC-009](../decisions/DEC-009_COPY_IDEMPOTENCY_MUST_NOT_SUPPRESS_METADATA_REPAIR.md) |
| Related bugs | [BUG-009](../bugs/BUG-009_SAME_SIZE_SKIP_METADATA_UNVERIFIED.md) |
| Related postmortems | [PM-001](../postmortems/PM-001_METADATA_CORRECTNESS_GAP_PRODUCTION_READINESS_REVIEW.md) |
| Related architectural evolution sections | [§3C — C. Metadata Automation](../11_ARCHITECTURAL_EVOLUTION.md#c-metadata-automation) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | Referenced in 1 test file(s) (mechanical name/import match, not a coverage percentage — the test suite was not executed for this documentation pass): `test/metadataVerificationService.test.js` |
| Documentation completeness | Partial — 3 unresolved evidence gaps in this file (see fields/sections marked "Evidence pending" above) |

## Summary

Read-only, post-hoc verification for files that landed via copy-only paths (Transfer Import, same-size-skip on Standard Import) where the copy step itself never checked metadata correctness.

## Current Behavior

Per `docs/metadata-system.md` § Import Path Coverage: Transfer Import / Update Import files land via copy only; a durable per-file outcome manifest records what happened, and a post-transfer read-only verification pass (never a destination-folder walk, which can't distinguish this transfer's files from unrelated pre-existing content) classifies each `copied`/`same-size-skipped`/`renamed`/`resumed` file. `failed`/`changed-skipped` outcomes are excluded from verification entirely. Auto-repair of anything incomplete is gated on the metadata setting; otherwise it lands in `metadata-verification-required` with a "Verify Metadata" action. Same-size-skip on Standard Import also triggers this regardless of whether the import's own copy batch had metadata enabled.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

No dated entries found specific to this subfeature beyond AI-FEAT-029's general timeline.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending — no independently-verified first-implementation date exists in this file's header table.

**Architectural / workflow decisions**: [DEC-009](../decisions/DEC-009_COPY_IDEMPOTENCY_MUST_NOT_SUPPRESS_METADATA_REPAIR.md) — see the Decisions section above and each record's own "Decision"/"Consequences" fields for what changed and why.

**Reliability / correctness fixes**: [BUG-009](../bugs/BUG-009_SAME_SIZE_SKIP_METADATA_UNVERIFIED.md) — see the Known Bugs section above and each record's own "Root Cause"/"Fix" fields for what changed and why.

**Other dated milestones**: Evidence pending — Evolution / Implementation Journal above has no dated entries.

## Known Bugs / Troubleshooting

This feature's existence is the direct fix for [BUG-009 — Same-Size Skip Left Metadata Unverified](../bugs/BUG-009_SAME_SIZE_SKIP_METADATA_UNVERIFIED.md).

## Decisions

See [DEC-009 — Copy Idempotency Must Not Suppress Metadata Repair](../decisions/DEC-009_COPY_IDEMPOTENCY_MUST_NOT_SUPPRESS_METADATA_REPAIR.md).

## Future Enhancements

None recorded.

## Related Files

- `main/metadataVerificationService.js`
