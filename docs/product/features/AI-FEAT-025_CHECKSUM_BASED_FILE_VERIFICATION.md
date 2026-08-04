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

## Summary

Two distinct, real, hash-based verification mechanisms, sharing `getFileHash()` but scoped differently: an import-batch checksum run and a Local-First sync-job checksum run. Named "Checksum-Based" specifically to disambiguate from AI-FEAT-026's count-only Audit Integrity Verification — the two do not share a mechanism and must not be conflated (confirmed by direct code reading, not merged despite the similar names).

## Current Behavior

- `checksum:run` IPC (`main/main.js:1434`) — post-import SHA hash comparison of every file in `lastImportedFiles`, with cancel support and progress reporting.
- `archive:verifyJobChecksum` (`main/main.js:3143`) — checksum verification scoped to a specific Local-First sync job (AI-FEAT-044).

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

No dated entries found in this pass.

## Known Bugs / Troubleshooting

None recorded.

## Decisions

None recorded.

## Future Enhancements

The planned AI-RM-006 milestone (see AI-FEAT-054) targets a broader, archive-wide integrity-verification scope. This feature is prior art / foundation for that milestone, not a partial implementation of it — do not treat AI-RM-006 as "in progress" on the basis of this feature existing.

## Related Files

- `main/main.js` (`checksum:run`, `archive:verifyJobChecksum`)
