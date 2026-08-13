# DEC-019 — Knowledge Engine Reuses Existing Retrieval; No New Search System, No Hosted Backend

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-058 / AI-RM-011 |
| Status | Accepted |
| Date | 2026-08-13 |
| Evidence status | Verified from code (`scripts/product-docs/lib/query.js`, `knowledgeEngine.js`, `knowledge-portal/server.js`) and this feature's own eval run (18/20 corpus questions passed as expected, 2/20 documented known misses, 0 unexplained) |

## Context

The Phase 1 Knowledge & Onboarding Portal audit concluded that `scripts/product-docs/lib/query.js`'s existing deterministic lexical ranker was likely sufficient retrieval infrastructure for a Stage 1 prototype, and recommended reusing it rather than adding embeddings or an external AI service. Stage 1's brief explicitly required re-verifying that conclusion against current repository evidence rather than assuming it, and required a "minimal local interface" without introducing a hosted service. Three real architectural choices followed from acting on that re-verification.

## Options Considered

**1. Retrieval — reuse `lib/query.js` unchanged vs. build a second matching implementation vs. add embeddings.**
- Reusing `lib/query.js` unchanged means `query`/`impact`/`context`/`knowledge` all share one ranking implementation, and a future improvement to it benefits every consumer at once.
- Building a second, knowledge-engine-specific matcher was rejected outright — the Stage 1 brief explicitly prohibits it ("Do not create a parallel search engine unless existing architecture demonstrably cannot support the requirement"), and nothing found during implementation demonstrated that.
- Embeddings were rejected for Stage 1: the eval corpus (18/20 exact passes, the 2 misses both root-caused to specific, fixable retrieval-precision gaps rather than a fundamental inability to match natural language) did not demonstrate that lexical/keyword matching fails outright — it demonstrated real but scoped precision limitations (see AI-FEAT-058's Future Enhancements), which is a materially different and much cheaper problem to solve.

**2. Confident vs. weak matches — trust every match the ranker returns vs. add a local confidence tier.**
- Trusting every match above a bare floor score was the initial implementation and was found, during this feature's own adversarial testing, to risk presenting a low-relevance record as a confident answer (e.g. "Can I delete an event?" tying on the single generic token "event").
- A local confidence tier (`strong`/`weak`, computed only in `knowledgeEngine.js` from the score `lib/query.js` already returns) was chosen instead — it hedges the answer language for weak/ambiguous matches without touching the shared ranker other commands (`query`, `impact`, `context`) depend on.

**3. Local interface — a hosted/bundled AI-backed answer service vs. duplicate the ranking algorithm in browser JavaScript vs. a local Node-core HTTP server.**
- A hosted or externally-callable service was rejected: it would require an API key, network access, and cost, none of which this deliberately offline-first tool (per its own README's non-goals) or the Stage 1 brief ("Do not introduce hosted services") permits.
- Re-implementing `scoreRecord`/`runQuery` a second time in the static page's own JavaScript (since the browser cannot `require()` a Node module without a bundler, which this tool's architecture also deliberately avoids) was rejected — it would create exactly the "second search implementation" risk item 1 above already rejected, just relocated into the browser.
- A minimal Node-core-only (`http`/`url`/`fs`, zero new dependencies) HTTP server bound to `127.0.0.1` only, serving the static page and answering through `knowledgeEngine.js` directly, was chosen — it keeps exactly one retrieval and one answer-construction implementation, adds no dependency, and is not reachable from any other machine.

## Decision

1. `lib/knowledgeEngine.js` calls `lib/query.js`'s `runQuery`/`lookupById` unchanged — no second ranking implementation exists anywhere in this feature.
2. A local match-quality tier (`strong` / `weak` / `boundary` / `none`), computed entirely within `knowledgeEngine.js` from the score the shared ranker already returns, hedges any answer built on a bare single-keyword or tied match rather than presenting it with unwarranted confidence.
3. The curated `NOT_SUPPORTED` boundary table (`lib/statusResolution.js`) is checked before a merely-weak feature match is allowed to stand, so a coincidental generic-keyword match (e.g. "backup" matching Backup Update Scanning for a "does AutoIngest offer *cloud* backup" question) cannot override a documented architectural exclusion.
4. The minimal local portal is a Node-core-only HTTP server bound to `127.0.0.1`, with no framework and no new npm dependency, serving a static page whose JavaScript calls the server's JSON API rather than re-implementing any retrieval logic client-side.

## Consequences

- Any future improvement to `lib/query.js`'s ranking (e.g. a Stage 2 re-ranking pass) benefits `query`, `impact`, `context`, and `knowledge` simultaneously — but conversely, this feature cannot independently tune ranking behavior without either touching shared code (affecting those other commands) or continuing to layer local post-processing in `knowledgeEngine.js` as it already does for match-quality hedging.
- The match-quality/hedging layer is new surface area with its own real risk of drift from `lib/query.js`'s actual scoring thresholds if that module's weights ever change — `knowledgeEngine.js`'s `STRONG_MATCH_FLOOR`/`WEAK_SCORE_CEILING` constants are hardcoded against the documented scoring table in `scripts/product-docs/README.md` and should be reviewed if that table ever changes.
- The local server is a developer/reviewer prototype tool only — it is not bundled into the AutoIngest Electron application, has no authentication, and must not be exposed beyond `127.0.0.1` without a real security review; this is an explicit non-goal restated from the Stage 1 brief, not an oversight.
- This decision commits Stage 2 planning to treat "improve retrieval precision" and "add a hosted/conversational layer" as two separate, independently-justified pieces of future work, not one bundled decision — the eval evidence supports only the former as demonstrated by real testing.

## Reconciliation Note

None recorded — consistent with `scripts/product-docs/README.md`'s existing non-goals (no embeddings, no external AI API, no network calls) and with `docs/product/00_PROJECT_VISION.md`'s offline-first framing.
