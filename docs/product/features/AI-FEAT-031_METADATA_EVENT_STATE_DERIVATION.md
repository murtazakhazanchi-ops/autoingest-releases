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

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | None beyond Dependencies/Parent/Subfeatures already listed in the header table above |
| Related decisions | None recorded |
| Related bugs | [BUG-008](../bugs/BUG-008_LASTMETADATARUN_EISDIR_SILENT_FAILURE.md) |
| Related postmortems | [PM-001](../postmortems/PM-001_METADATA_CORRECTNESS_GAP_PRODUCTION_READINESS_REVIEW.md) |
| Related architectural evolution sections | [§3C — C. Metadata Automation](../11_ARCHITECTURAL_EVOLUTION.md#c-metadata-automation) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | Referenced in 1 test file(s) (mechanical name/import match, not a coverage percentage — the test suite was not executed for this documentation pass): `test/metadataStateService.test.js` |
| Documentation completeness | Partial — 3 unresolved evidence gaps in this file (see fields/sections marked "Evidence pending" above) |

## Summary

An event's `metadataState.state` is always a pure derivation from durable per-file counts, recomputed fresh every time — never a field one callback happens to overwrite last.

## Current Behavior

Nine mutually-exclusive states, evaluated in fixed order: `metadata-not-required` → `metadata-interrupted` → `metadata-in-progress` → `metadata-complete` → `metadata-partial` → `metadata-failed` → `metadata-verification-required` → `metadata-queued` → `metadata-not-attempted`. A file whose write succeeded but whose read-back found a field mismatch (`partial`) is folded into the "incomplete" bucket — never counts toward `metadata-complete`. Video-excluded files never contribute to any count above `excluded`.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

No dated entries found specific to this subfeature beyond AI-FEAT-029's general timeline.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending — no independently-verified first-implementation date exists in this file's header table.

**Architectural / workflow decisions**: None recorded — see Decisions section above.

**Reliability / correctness fixes**: [BUG-008](../bugs/BUG-008_LASTMETADATARUN_EISDIR_SILENT_FAILURE.md) — see the Known Bugs section above and each record's own "Root Cause"/"Fix" fields for what changed and why.

**Other dated milestones**: Evidence pending — Evolution / Implementation Journal above has no dated entries.

## Known Bugs / Troubleshooting

See [BUG-008 — lastMetadataRun Never Written Due to EISDIR Silent Failure](../bugs/BUG-008_LASTMETADATARUN_EISDIR_SILENT_FAILURE.md) — a durable-record-of-completion bug in an adjacent persistence path, not this feature's derivation logic itself, but directly relevant to trusting this feature's state output.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `main/metadataStateService.js`
