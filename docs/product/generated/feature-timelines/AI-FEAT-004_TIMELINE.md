# AI-FEAT-004 — Timeline

> Generated artifact — strictly extracted/reformatted from [features/AI-FEAT-004_EVENT_JSON_DATA_MODEL_PERSISTENCE_CONTRACT.md](../features/AI-FEAT-004_EVENT_JSON_DATA_MODEL_PERSISTENCE_CONTRACT.md)'s own Evolution / Implementation Journal, header table, Known Bugs, and Decisions sections. No new facts. Regenerate with `node scripts/product-docs/cli.js build`.

**Feature**: event.json Data Model & Persistence Contract

| Date | Event type | Summary | Related IDs | Confidence | Evidence source |
|---|---|---|---|---|---|
| 2026-05-14 (`adoption` field); 2026-08-02 (`status` field, second instance of the same class) | major bug fix | BUG-006 — Event-Edit Full-Payload Save Silently Drops Untracked Fields | BUG-006 | verified | bugs/BUG-006_EVENT_EDIT_FULL_PAYLOAD_FIELD_DROP.md header table: Fixed |
| 2026-06-16 (v0.9.8) | major bug fix | BUG-003 — Stale Local-Staging Restore Wins Over Reachable Archive Root | BUG-003 | verified | bugs/BUG-003_STALE_LOCAL_STAGING_RESTORE_OVER_ARCHIVE_ROOT.md header table: Fixed |
| v0.7.4-dev (atomic transaction write introduced; see AI-FEAT-021) | other dated milestone | Latest major update recorded for event.json Data Model & Persistence Contract | — | verified | features/AI-FEAT-004_EVENT_JSON_DATA_MODEL_PERSISTENCE_CONTRACT.md header table: Latest major update |
| v0.7.x ("Major architectural shift... Introduced event.json as source of truth" — `docs/history.md`) | initial implementation | First-known implementation of event.json Data Model & Persistence Contract | — | verified | features/AI-FEAT-004_EVENT_JSON_DATA_MODEL_PERSISTENCE_CONTRACT.md header table: First-known implementation |
| Evidence pending | evidence pending | **v0.7.x** — event.json introduced as source of truth; ingestion pipeline structure established. | — | undated | features/AI-FEAT-004_EVENT_JSON_DATA_MODEL_PERSISTENCE_CONTRACT.md § Evolution / Implementation Journal |
| Evidence pending | evidence pending | **v0.7.4-dev** — `import:commitTransaction` replaces multi-step event.json writes (see AI-FEAT-021); `isValidEventJson` made non-mutating; dead code removed (`markEventImportComplete`, standalone `appendImports`). | — | undated | features/AI-FEAT-004_EVENT_JSON_DATA_MODEL_PERSISTENCE_CONTRACT.md § Evolution / Implementation Journal |
| Evidence pending | evidence pending | Ongoing — every feature that touches `event.json` (metadata's `metadataState` block, QMZ's sequence state, sync's `event.sync.json` manifest) writes exclusively through `main/eventJsonStore.js`'s `updateEventJsonAtomic`, never an independent read-modify-write (`docs/metadata-system.md`). | — | undated | features/AI-FEAT-004_EVENT_JSON_DATA_MODEL_PERSISTENCE_CONTRACT.md § Evolution / Implementation Journal |
| Evidence pending | redesign | DEC-001 — Event Data as Durable Archive Truth | DEC-001 | undated | decisions/DEC-001_EVENT_DATA_AS_DURABLE_ARCHIVE_TRUTH.md header table: Date |
| Evidence pending | redesign | DEC-002 — Folder Structure Plus Embedded Metadata | DEC-002 | undated | decisions/DEC-002_FOLDER_STRUCTURE_PLUS_EMBEDDED_METADATA.md header table: Date |

