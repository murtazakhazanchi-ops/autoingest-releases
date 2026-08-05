# AI-FEAT-027 — Timeline

> Generated artifact — strictly extracted/reformatted from [features/AI-FEAT-027_ACTIVITY_LOG.md](../features/AI-FEAT-027_ACTIVITY_LOG.md)'s own Evolution / Implementation Journal, header table, Known Bugs, and Decisions sections. No new facts. Regenerate with `node scripts/product-docs/cli.js build`.

**Feature**: Activity Log

| Date | Event type | Summary | Related IDs | Confidence | Evidence source |
|---|---|---|---|---|---|
| v0.8.6 (OOM fix) | other dated milestone | Latest major update recorded for Activity Log | — | verified | features/AI-FEAT-027_ACTIVITY_LOG.md header table: Latest major update |
| Evidence pending | evidence pending | **v0.7.4-dev** — Activity Log OOM fix: `_alEventList` stores only lightweight picker data; per-event `event.json` loaded lazily on picker change. | — | undated | features/AI-FEAT-027_ACTIVITY_LOG.md § Evolution / Implementation Journal |
| Evidence pending | evidence pending | **v0.8.6** — `master:scanEvents` strips `imports[]` before the IPC push, eliminating the V8/Oilpan OOM crash on Activity Log open for archives with large import histories (`docs/history.md`, `docs/failure-patterns.md` #12). | — | undated | features/AI-FEAT-027_ACTIVITY_LOG.md § Evolution / Implementation Journal |
| Evidence pending | evidence pending | **v0.8.7 / v0.8.1 era** — "Activity Log Tabbed UI, Source Cleanup Tracking, and Retry Failed Metadata" and "Activity Log Tab Content Separation" (learning-log, 2026-05-05/06). | — | undated | features/AI-FEAT-027_ACTIVITY_LOG.md § Evolution / Implementation Journal |

