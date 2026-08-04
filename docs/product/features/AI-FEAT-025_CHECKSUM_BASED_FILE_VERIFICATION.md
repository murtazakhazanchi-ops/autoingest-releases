# AI-FEAT-025 — Checksum-Based File Verification

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-025 |
| Category | Import and Archive Writing |
| Status | Implemented |
| Maturity | Operational |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-019 (shares `getFileHash`) |
| Related roadmap milestone | None (narrower prior-art relative to the planned AI-RM-006 archive-wide milestone — see AI-FEAT-054) |
| Related technical docs | None dedicated |
| Evidence status | Verified from current code |
| First-known implementation | Evidence pending |
| Latest major update | Evidence pending |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | [AI-FEAT-026](AI-FEAT-026_AUDIT_INTEGRITY_VERIFICATION.md), [AI-FEAT-044](AI-FEAT-044_LOCAL_FIRST_BACKGROUND_ARCHIVE_SYNC.md), [AI-FEAT-054](AI-FEAT-054_INTEGRITY_VERIFICATION_ARCHIVE_WIDE.md) (found via cross-reference in this file's own prose, not yet in Dependencies/Parent/Subfeatures above) |
| Related decisions | [DEC-005](../decisions/DEC-005_ORIGINAL_PRESERVATION_NON_DESTRUCTIVE_INGEST.md) *(found via reverse lookup — not yet cross-linked in the Decisions section above)* |
| Related bugs | None recorded |
| Related postmortems | None |
| Related architectural evolution sections | [§3D — D. Archive Integrity and Transaction Safety](../11_ARCHITECTURAL_EVOLUTION.md#d-archive-integrity-and-transaction-safety) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | Evidence pending — this feature's related files are shared, multi-feature modules (e.g. `main/main.js`, `renderer/renderer.js`); automated basename matching against test/ is unreliable for these and was not attempted |
| Documentation completeness | Partial — 3 unresolved evidence gaps in this file (see fields/sections marked "Evidence pending" above) |

## Summary

Two distinct, real, hash-based verification mechanisms, sharing `getFileHash()` but scoped differently: an import-batch checksum run and a Local-First sync-job checksum run. Named "Checksum-Based" specifically to disambiguate from AI-FEAT-026's count-only Audit Integrity Verification — the two do not share a mechanism and must not be conflated (confirmed by direct code reading, not merged despite the similar names).

## Current Behavior

- `checksum:run` IPC (`main/main.js:1434`) — post-import SHA hash comparison of every file in `lastImportedFiles`, with cancel support and progress reporting.
- `archive:verifyJobChecksum` (`main/main.js:3143`) — checksum verification scoped to a specific Local-First sync job (AI-FEAT-044).

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

No dated entries found in this pass.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending — no independently-verified first-implementation date exists in this file's header table.

**Architectural / workflow decisions**: [DEC-005](../decisions/DEC-005_ORIGINAL_PRESERVATION_NON_DESTRUCTIVE_INGEST.md) — see the Decisions section above and each record's own "Decision"/"Consequences" fields for what changed and why.

**Reliability / correctness fixes**: None recorded — see Known Bugs section above.

**Other dated milestones**: Evidence pending — Evolution / Implementation Journal above has no dated entries.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

The planned AI-RM-006 milestone (see AI-FEAT-054) targets a broader, archive-wide integrity-verification scope. This feature is prior art / foundation for that milestone, not a partial implementation of it — do not treat AI-RM-006 as "in progress" on the basis of this feature existing.

## Related Files

- `main/main.js` (`checksum:run`, `archive:verifyJobChecksum`)
