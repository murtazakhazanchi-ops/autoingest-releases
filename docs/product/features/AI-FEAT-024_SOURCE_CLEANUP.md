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

## Known Bugs / Troubleshooting

See `docs/failure-patterns.md` #16 ("Path Outside Source Root" on Cleanup After External Drive Import) — the root cause traces back to AI-FEAT-012's `activeSource` state, not this feature's own logic.

## Decisions

None recorded.

## Future Enhancements

None recorded.

## Related Files

- `main/main.js` (`files:deleteFromSource`)
