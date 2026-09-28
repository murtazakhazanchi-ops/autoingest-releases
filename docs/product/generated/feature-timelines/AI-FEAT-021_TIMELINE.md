# AI-FEAT-021 — Timeline

> Generated artifact — strictly extracted/reformatted from [features/AI-FEAT-021_ATOMIC_IMPORT_TRANSACTION.md](../features/AI-FEAT-021_ATOMIC_IMPORT_TRANSACTION.md)'s own Evolution / Implementation Journal, header table, Known Bugs, and Decisions sections. No new facts. Regenerate with `node scripts/product-docs/cli.js build`.

**Feature**: Atomic Import Transaction

| Date | Event type | Summary | Related IDs | Confidence | Evidence source |
|---|---|---|---|---|---|
| v0.7.4-dev | initial implementation | First-known implementation of Atomic Import Transaction | — | verified | features/AI-FEAT-021_ATOMIC_IMPORT_TRANSACTION.md header table: First-known implementation |
| v0.7.4-dev | other dated milestone | Latest major update recorded for Atomic Import Transaction | — | verified | features/AI-FEAT-021_ATOMIC_IMPORT_TRANSACTION.md header table: Latest major update |
| Evidence pending | evidence pending | **v0.7.4-dev** — `import:commitTransaction` introduced, replacing multi-step `event.json` writes; dead code removed (`markEventImportComplete`, standalone `appendImports`). | — | undated | features/AI-FEAT-021_ATOMIC_IMPORT_TRANSACTION.md § Evolution / Implementation Journal |
| Evidence pending | evidence pending | **2026-09-20 — clarification (Multi-Event Import).** The transaction boundary is unchanged: it is **per event.json**. AI-FEAT-058 ([DEC-019](../decisions/DEC-019_MULTI_EVENT_IMPORT_ARCHITECTURE.md)) orchestrates several independent `import:commitTransaction` calls for one source import; that orchestration is not filesystem-atomic and can partially complete (successfully copied events are never rolled back). `import:commitTransaction` gained two optional, additive inputs — `progressEventPath` (echoed on `metadata:progress`) and `importSessionId` (Deep Verify accumulation). Not yet merged/released. | — | undated | features/AI-FEAT-021_ATOMIC_IMPORT_TRANSACTION.md § Evolution / Implementation Journal |

