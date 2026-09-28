# AI-FEAT-017 — Timeline

> Generated artifact — strictly extracted/reformatted from [features/AI-FEAT-017_GROUPING_SYSTEM.md](../features/AI-FEAT-017_GROUPING_SYSTEM.md)'s own Evolution / Implementation Journal, header table, Known Bugs, and Decisions sections. No new facts. Regenerate with `node scripts/product-docs/cli.js build`.

**Feature**: Grouping System

| Date | Event type | Summary | Related IDs | Confidence | Evidence source |
|---|---|---|---|---|---|
| v0.7.x | initial implementation | First-known implementation of Grouping System | — | verified | features/AI-FEAT-017_GROUPING_SYSTEM.md header table: First-known implementation |
| Evidence pending | evidence pending | **v0.7.x** — grouping system introduced. | — | undated | features/AI-FEAT-017_GROUPING_SYSTEM.md § Evolution / Implementation Journal |
| Evidence pending | evidence pending | **2026-09-20 — superseded statement (Multi-Event Import).** The Summary's "reset on event change" describes the original design: GroupManager was a singleton reset whenever the event changed. **Superseded** on branch `feature/multi-event-import` (AI-FEAT-058, [DEC-019](../decisions/DEC-019_MULTI_EVENT_IMPORT_ARCHITECTURE.md)): `renderer/groupManager.js` now exports a facade plus `createGroupManager()`, each participating event owns an isolated instance, and the invariant is "group/component state must never leak across events". The rules above (groups never empty, one group → one sub-event, one group per file) are unchanged and apply per instance. Not yet merged/released. | — | undated | features/AI-FEAT-017_GROUPING_SYSTEM.md § Evolution / Implementation Journal |

