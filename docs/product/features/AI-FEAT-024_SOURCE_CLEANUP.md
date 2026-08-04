# AI-FEAT-024 — Source Cleanup

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-024 |
| Category | Import and Archive Writing |
| Status | Implemented |
| Maturity | Stable |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | AI-FEAT-012 (activeSource/sourceRoot), AI-FEAT-019 (copiedFiles entries with copyVerified) |
| Related roadmap milestone | None |
| Related technical docs | `docs/system-contracts.md` §4, `docs/failure-patterns.md` #16 |
| Evidence status | Verified from current code and docs (already fully read as required context) |
| First-known implementation | Evidence pending |
| Latest major update | v0.8.8 (cleanup root stability fix) |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | None beyond Dependencies/Parent/Subfeatures already listed in the header table above |
| Related decisions | [DEC-005](../decisions/DEC-005_ORIGINAL_PRESERVATION_NON_DESTRUCTIVE_INGEST.md) |
| Related bugs | [BUG-001](../bugs/BUG-001_SOURCE_CLEANUP_POST_IMPORT_STATE_OWNERSHIP.md) |
| Related postmortems | None |
| Related architectural evolution sections | [§3D — D. Archive Integrity and Transaction Safety](../11_ARCHITECTURAL_EVOLUTION.md#d-archive-integrity-and-transaction-safety) |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | Evidence pending — this feature's related files are shared, multi-feature modules (e.g. `main/main.js`, `renderer/renderer.js`); automated basename matching against test/ is unreliable for these and was not attempted |
| Documentation completeness | Mostly complete — 2 unresolved evidence gap(s) in this file (see fields/sections marked "Evidence pending" above) |

## Summary

Post-import deletion of source files, gated by a strict 8-step validation order that must never delete a file that wasn't verifiably and completely copied.

## Current Behavior

IPC: `files:deleteFromSource` (`main/main.js:3610`). Validation order (`docs/system-contracts.md` §4): resolve `sourceRoot` realpath → resolve `src` realpath → containment check → `srcStat.isFile()` → size match (block on mismatch — source was modified after import) → destination must exist → size match unless `copyVerified` (non-blocking log-only when `copyVerified` is true, since destination may have legitimately grown from metadata writes after copy). UI: `#sourceCleanupOverlay` modal.

**Cleanup Root Capture Rule**: `sourceRoot` must be captured from `activeSource.path` synchronously before the first `await` in the import path — not read from `activeSource` at post-import summary time, because drive-polling can null `activeSource` during any `await`.

## Original Plan / Intent

Evidence pending — not yet documented as fact.

## Evolution / Implementation Journal

- **v0.5.8** — "v0.8.8 Source Cleanup Race Fix" (learning-log 2026-05-08).
- **v0.8.8** — stable import-time cleanup root: `showProgressSummary` receives `importCleanupRoot` captured synchronously before the first `await`; guard changed from `!activeSource` to `!activeSource && !_importCleanupRoot` (`docs/history.md`, `docs/failure-patterns.md` #16).

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type. It adds no new facts beyond what the header table, Evolution / Implementation Journal, Known Bugs, and Decisions sections above already establish — it is a categorized index over that same evidence, not a second changelog.

**Initial implementation**: Evidence pending — no independently-verified first-implementation date exists in this file's header table.

**Architectural / workflow decisions**: [DEC-005](../decisions/DEC-005_ORIGINAL_PRESERVATION_NON_DESTRUCTIVE_INGEST.md) — see the Decisions section above and each record's own "Decision"/"Consequences" fields for what changed and why.

**Reliability / correctness fixes**: [BUG-001](../bugs/BUG-001_SOURCE_CLEANUP_POST_IMPORT_STATE_OWNERSHIP.md) — see the Known Bugs section above and each record's own "Root Cause"/"Fix" fields for what changed and why.

**Other dated milestones**: 2 entries exist in the Evolution / Implementation Journal above; not individually re-classified by milestone type here to avoid restating evidence — read that section directly for the full dated sequence.

## Known Bugs / Troubleshooting

See `docs/failure-patterns.md` #16 ("Path Outside Source Root" on Cleanup After External Drive Import) — the root cause traces back to AI-FEAT-012's `activeSource` state, not this feature's own logic. Documented as [BUG-001 — Source Cleanup / Post-Import State Ownership Race](../bugs/BUG-001_SOURCE_CLEANUP_POST_IMPORT_STATE_OWNERSHIP.md).

## Decisions

See [DEC-005 — Original Preservation and Non-Destructive Ingest](../decisions/DEC-005_ORIGINAL_PRESERVATION_NON_DESTRUCTIVE_INGEST.md) for the source-of-truth decision behind this feature's strict copy-verification-gated deletion order.

## Future Enhancements

None recorded.

## Related Files

- `main/main.js` (`files:deleteFromSource`)
