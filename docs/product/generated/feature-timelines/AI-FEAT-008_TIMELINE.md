# AI-FEAT-008 — Timeline

> Generated artifact — strictly extracted/reformatted from [features/AI-FEAT-008_DESIGN_SYSTEM_UI_CONSISTENCY_FRAMEWORK.md](../features/AI-FEAT-008_DESIGN_SYSTEM_UI_CONSISTENCY_FRAMEWORK.md)'s own Evolution / Implementation Journal, header table, Known Bugs, and Decisions sections. No new facts. Regenerate with `node scripts/product-docs/cli.js build`.

**Feature**: Design System & UI Consistency Framework

| Date | Event type | Summary | Related IDs | Confidence | Evidence source |
|---|---|---|---|---|---|
| 2026-08-02/04 (Metadata Management Modal shell height rule, Audit & Repair spacing polish) | other dated milestone | Latest major update recorded for Design System & UI Consistency Framework | — | verified | features/AI-FEAT-008_DESIGN_SYSTEM_UI_CONSISTENCY_FRAMEWORK.md header table: Latest major update |
| Evidence pending | evidence pending | **§8b backdrop-filter rule** — added after a real bug where `.ec-comp-row`'s `backdrop-filter` created per-row stacking contexts, causing later sibling rows to paint over an earlier row's open dropdown in the Event Creator (v0.8.8, `docs/history.md`). | — | undated | features/AI-FEAT-008_DESIGN_SYSTEM_UI_CONSISTENCY_FRAMEWORK.md § Evolution / Implementation Journal |
| Evidence pending | evidence pending | **Modal shell height rule** — added ("Multi-tab modals that share a shell class ... must use a scoped height rule on the specific modal ID") after a real visual-jumping bug across tab switches in the Metadata Management Modal (AI-FEAT-034), 2026-08-02. | — | undated | features/AI-FEAT-008_DESIGN_SYSTEM_UI_CONSISTENCY_FRAMEWORK.md § Evolution / Implementation Journal |
| Evidence pending | evidence pending | **Button `type="button"` rule** — added after a real bug where a modal close button without `type="button"` was treated as a form submit trigger (`docs/failure-patterns.md` #14). | — | undated | features/AI-FEAT-008_DESIGN_SYSTEM_UI_CONSISTENCY_FRAMEWORK.md § Evolution / Implementation Journal |

