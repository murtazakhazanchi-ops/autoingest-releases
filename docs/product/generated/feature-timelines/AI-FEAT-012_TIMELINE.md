# AI-FEAT-012 — Timeline

> Generated artifact — strictly extracted/reformatted from [features/AI-FEAT-012_SOURCE_SELECTION.md](../features/AI-FEAT-012_SOURCE_SELECTION.md)'s own Evolution / Implementation Journal, header table, Known Bugs, and Decisions sections. No new facts. Regenerate with `node scripts/product-docs/cli.js build`.

**Feature**: Source Selection (Local Folder / External Drive)

| Date | Event type | Summary | Related IDs | Confidence | Evidence source |
|---|---|---|---|---|---|
| 2026-05-08 (v0.8.8) | major bug fix | BUG-001 — Source Cleanup / Post-Import State Ownership Race | BUG-001 | verified | bugs/BUG-001_SOURCE_CLEANUP_POST_IMPORT_STATE_OWNERSHIP.md header table: Fixed |
| v0.8.7 (source card double-selection fix) | other dated milestone | Latest major update recorded for Source Selection (Local Folder / External Drive) | — | verified | features/AI-FEAT-012_SOURCE_SELECTION.md header table: Latest major update |
| Evidence pending | evidence pending | **v0.8.7** — source card double-selection fix: clicking between source types previously left the old type's checkmark visible until the next polling cycle; each click handler now immediately clears the other list's checkmarks; `_pendingSourcePath` added so polling renders stay consistent during the async scan window in `selectSource()` (`docs/history.md`). | — | undated | features/AI-FEAT-012_SOURCE_SELECTION.md § Evolution / Implementation Journal |
| Evidence pending | evidence pending | **v0.8.8** — Source Cleanup root-capture race fixed (see `docs/failure-patterns.md` #16 and AI-FEAT-024) — root cause was `activeSource` being nulled by drive-polling disconnect detection during an in-flight import await. | — | undated | features/AI-FEAT-012_SOURCE_SELECTION.md § Evolution / Implementation Journal |

