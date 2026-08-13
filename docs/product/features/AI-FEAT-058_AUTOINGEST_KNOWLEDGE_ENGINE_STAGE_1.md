# AI-FEAT-058 — Knowledge Engine (Stage 1 Prototype)

| Field | Value |
|---|---|
| Feature ID | AI-FEAT-058 |
| Category | Knowledge & Onboarding |
| Status | Implemented — evolving |
| Maturity | Experimental |
| Parent feature | None |
| Subfeatures | None |
| Dependencies | None — reads the existing feature registry generically (all 57 `AI-FEAT` records) via `docs/product/generated/feature-index.json`, not a functional dependency on any single feature |
| Related roadmap milestone | AI-RM-011 |
| Related technical docs | None — this feature's own documentation home is `scripts/product-docs/README.md`, not the `docs/` technical-doc tier |
| Evidence status | Verified from current code (`scripts/product-docs/lib/knowledgeIndex.js`, `knowledgeEngine.js`, `statusResolution.js`, `knowledgeCli.js`, `knowledge-portal/server.js`+`index.html`) and `scripts/product-docs/test/knowledge.test.js` (18/18 passing, including the full existing 33-file suite unaffected), plus a live local-server smoke test (`knowledge serve`, `curl` against `/`, `/api/capabilities`, `/api/roadmap`, `/api/ask`) on 2026-08-13, and an independent forensic PR review (2026-08-13) that found and fixed one further defect (see Evolution Journal) |
| First-known implementation | 2026-08-13 |
| Latest major update | 2026-08-13 |

## Lifecycle Metadata

Additive fields not already covered by the header table or the Known Bugs/Decisions sections above — see [05_DOCUMENTATION_WORKFLOW.md](../05_DOCUMENTATION_WORKFLOW.md) for the evidence-discipline rules governing every field below.

| Field | Value |
|---|---|
| Related features | None beyond the generic feature-registry dependency already noted above |
| Related decisions | [DEC-019](../decisions/DEC-019_KNOWLEDGE_ENGINE_REUSES_EXISTING_RETRIEVAL_NO_NEW_SEARCH_SYSTEM.md) |
| Related bugs | None recorded — no `BUG-###` record was warranted; the defects found during this feature's own build (see Evolution below) were caught and fixed before commit, with no user-facing incident |
| Related postmortems | None |
| Related architectural evolution sections | Not yet covered in 11_ARCHITECTURAL_EVOLUTION.md's relationship map |
| Related release notes | Evidence pending — no release-notes file matched this feature's cited version(s) by filename; docs/product/10_CHANGELOG.md tracks the documentation system itself, not per-feature user-facing changes |
| Testing coverage | `scripts/product-docs/test/knowledge.test.js` (17 assertions: 10 covering the Phase 12 checklist, 7 dedicated negative/hallucination tests) |
| Documentation completeness | Complete — no unresolved "Evidence pending" markers in this file |

## Summary

A Stage 1 prototype proving that AutoIngest's existing `docs/product/` documentation system — the feature registry, roadmap, and the deterministic offline search engine already built in `scripts/product-docs/lib/query.js` — can power a grounded, citation-honest, natural-language "Ask AutoIngest" answer engine **without** an LLM, embeddings, or any hosted service. This is explicitly **not** the final operator-facing portal (see the Phase 1 Knowledge & Onboarding Portal audit): no Workflow/Navigation/Tutorial content exists yet, no visual design work was done, and no conversational multi-turn layer was built. It is the smallest working slice that validates the two claims the larger portal initiative depends on: that the existing generated-index layer is sufficient retrieval infrastructure, and that a citation-honest answer contract is achievable on top of it.

## Current Behavior

**Knowledge compiler** (`lib/knowledgeIndex.js`, wired into `lib/build.js`): generates `docs/product/generated/knowledge-index.json` (schema/docsys version 1.3.0), a 57-record portal-oriented projection of `feature-index.json` + `roadmap-dashboard.json` + linked bug statuses. Purely derived from already-parsed structures — adds no new Markdown-parsing logic, per this tool's own "do not duplicate canonical parsing logic" convention. Generated, never authoritative, same rule as every other file in `docs/product/generated/`.

**Status resolution** (`lib/statusResolution.js`): deterministically maps each feature's canonical `Status` field (plus linked-bug evidence) to one of `AVAILABLE` / `PARTIALLY_AVAILABLE` / `PLANNED`. A small, explicitly-curated, evidence-cited table (`KNOWN_BOUNDARIES`, 6 entries — face recognition, AI auto-tagging, photo editing, cloud storage, Linux, multi-user roles) is the only mechanism that can elevate an answer to `NOT_SUPPORTED`; a query with no confident match and no boundary citation is always `UNKNOWN`, never silently upgraded. Status is never inferred from a record's title or category.

**Answer engine** (`lib/knowledgeEngine.js`): reuses `lib/query.js`'s existing deterministic ranker completely unchanged (no second search implementation — see DEC-019). Classifies a match's confidence into `strong` / `weak` / `boundary` / `none` and hedges the answer language whenever the top match is a bare single-keyword-overlap or a multi-way tie, rather than presenting a low-relevance match as a confident answer (see Evolution below — this was added specifically because of a defect found during this feature's own testing). Every answer is a structured object: `query`, `classification`, `directAnswer`, `capabilityStatus`, `matchQuality`, `matchedCapabilities`, `guidance`, `limitations`, `relatedCapabilities`, `sources`, `confidence`. Guidance is either `null` or the one fixed sentence "AutoIngest supports this capability, but detailed operator instructions are not yet documented." — Stage 1 never invents step-by-step instructions, since no Workflow/Navigation record type exists yet.

**CLI** (`lib/knowledgeCli.js`, wired into `cli.js` as `knowledge <sub>`): `knowledge ask "<question>" [--json]`, `knowledge eval [--out <path>]` (runs the 20-question corpus, writes `docs/product/generated/knowledge-gap-report.json`), `knowledge serve [--port 5177]`.

**Minimal local portal** (`scripts/product-docs/knowledge-portal/`): `server.js` is a Node-core-only (`http`/`url`/`fs`) HTTP server bound to `127.0.0.1` only — never reachable off the local machine, no framework, no new npm dependency — serving `index.html` (a single static page: ask box, example questions, result area with status badge/direct answer/guidance/limitations/related capabilities/sources, plus simple Capabilities and Roadmap browse tabs) and three JSON endpoints (`/api/ask`, `/api/capabilities`, `/api/roadmap`) that call `knowledgeEngine.js` directly — no duplicated ranking logic in the browser.

**20-question eval corpus** (`lib/knowledgeTestCorpus.js` + `lib/knowledgeEval.js`): drawn from the Phase 1 audit's 92-question corpus, spanning Import/Events/Collections/Metadata/QMZ/Transfer/Backup/Archive operations/Settings/Updates/Future capabilities and every classification. Result as of 2026-08-13: **18/20 passed exactly as expected; 2/20 deviated in an already-documented, evidenced way (both recorded in the corpus's own `knownLimitation` field); 0/20 unexplained.**

## Original Plan / Intent

Scoped directly from the Stage 1 brief following the completed Phase 1 audit: prove the knowledge compiler, capability directory, search, 20 representative questions, grounded answers, and source references — before any visual portal work. Explicitly out of scope and not attempted: hosted AI, any external API integration, embeddings/vector database, the final portal UI, screenshot/tutorial content, analytics, public deployment.

## Evolution / Implementation Journal

- 2026-08-13 — Re-verified Phase 1's proposed implementation against current repository state rather than assuming it: read `lib/query.js`, `lib/featureIndex.js`, `lib/build.js`, `automation/contextEngine.js`, `08_DECISION_TEMPLATE.md`, and the real `01_FEATURE_REGISTRY.md`/`02_MASTER_ROADMAP.md`/`04_PROJECT_DASHBOARD.md` directly. Confirmed `context task`/`context explain` already do deterministic natural-language routing (Part 7E) but decided against reusing that command family directly for the answer engine, since its `taskBundle`/`explainBundle` return raw canonical-record bundles for a developer audience (full `Related Files`, code paths, dependency chains) rather than a status-resolved, citation-bounded operator answer — a genuinely different output contract, not a redundant one. `knowledgeEngine.js` calls the same underlying `runQuery`/`lookupById` primitives `contextEngine.js` does, so there is still only one retrieval implementation.
- 2026-08-13 — Built the compiler and generated the first `knowledge-index.json` (57 records). Immediately found a real bug in the bug-status matching regex: `BUG-006`'s status text is `"Fixed (recurring pattern — see Prevention)"`, and an exact-match regex (`/^(Fixed|Resolved|Closed)$/i`) miscounted it as still-open, incorrectly downgrading AI-FEAT-010 to `PARTIALLY_AVAILABLE`. Fixed to a prefix match before the index was ever committed.
- 2026-08-13 — Wrote the 20-question corpus and ran it against the real engine. Found and fixed two further defects this way, both before commit: (1) "Can I delete an event?" and similar generic single-keyword ties (e.g. `event`, `import`, `archive`) could present a tangentially-matched record as a confident answer — added the `matchQuality`/hedge mechanism (`STRONG_MATCH_FLOOR`/`WEAK_SCORE_CEILING` in `knowledgeEngine.js`) so a weak or tied match is explicitly hedged rather than asserted; (2) "Does AutoIngest offer cloud backup?" keyword-matched `AI-FEAT-040` (Backup Update Scanning) via the single generic token "backup" and would have reported `AVAILABLE` for a capability that is architecturally excluded (DEC-003) — reordered `answerQuestion` so the curated boundary table is checked before a merely-weak feature match is allowed to stand.
- 2026-08-13 — Corrected one test expectation after learning real system behavior, not to force a pass: "What is QMZ?" was initially expected to hit the exact-alias tier (score 900) since "QMZ" is a registered alias, but `lib/query.js`'s exact-match tiers require the **entire query string** to equal the term — they cannot fire on a natural sentence that merely contains it. This is the corpus's single most consequential structural finding (see Architectural Review below) and is documented in the corpus file itself, not silently absorbed.
- 2026-08-13 — A fourth defect, self-inflicted and caught by re-running the eval corpus after this feature's own canonical record was added: this record's own original title, "AutoIngest Knowledge Engine (Stage 1 Prototype)", made "autoingest" one of its own search keywords (via `lib/featureIndex.js`'s standard name-tokenization) — and since "AutoIngest" appears in nearly every natural question about the product, this newly-added record started keyword-matching (and, for two previously-`UNKNOWN` corpus questions, incorrectly answering) almost every query in the corpus. No other one of the 57 pre-existing feature titles includes the word "AutoIngest" (confirmed by grep) — this was a naming mistake specific to this record, not a pre-existing or shared-code defect. Fixed by renaming to "Knowledge Engine (Stage 1 Prototype)", matching the naming convention every other feature title already follows. Recorded here as a general lesson for any future `AI-FEAT` record: a title should not restate the product's own name, since that name is present in almost every real operator question and would otherwise become a universal, uninformative keyword match.
- 2026-08-13 — A fifth defect, found by an independent forensic PR review (not the original implementation pass): `knowledgeEngine.js`'s `sourcesForRecord()` cited `knowledgeRecord.sourceFiles[0]` as "the" canonical source for a matched capability — but `sourceFiles` is an alphabetically-sorted merge of the canonical document, related code paths, and related technical docs, so index 0 is not reliably the canonical document. Quantified across the full registry: 39 of 58 records (67%) cited something other than their own feature file as the primary source, and 5 of those cited a bare, pathless fragment (e.g. `"#12"`) with no informational value — a pre-existing parsing artifact of a multi-footnote citation (`lib/subsystems.js`'s `parseRelatedTechnicalDocs`, e.g. AI-FEAT-010's `` `docs/failure-patterns.md` #1, #12 `` splitting into a valid entry plus a garbage bare `"#12"` entry), present in `feature-index.json` since Part 4, long before this feature existed — but never previously surfaced as a user-facing "primary source" citation the way this feature's answer contract does. The existing regression test ("5. source references resolve") did not catch this: it validates that every `sourceFiles` array entry resolves to *some* file, not that index 0 specifically is the canonical document, and its own skip-filter inadvertently exempted exactly the pathless `"#12"`-style entries from being checked at all. Fixed by adding a dedicated `canonicalDocument` field to the knowledge-index record (kept separate from the merged/sorted `sourceFiles` list) and citing that field explicitly instead of `sourceFiles[0]`. Verified the fix holds for all 58 records (new regression test 2b: querying by each record's own exact title cites exactly its own canonical document as the primary source) — 0 of 58 incorrect after the fix, versus 39 of 58 before it.

## Engineering Evolution

This section classifies this feature's already-evidenced history by milestone type — it adds no new facts beyond the header table and Evolution / Implementation Journal above.

**Initial implementation**: 2026-08-13, in one session, directly following the completed Phase 1 Knowledge & Onboarding Portal audit.

**Architectural / workflow decisions**: [DEC-019](../decisions/DEC-019_KNOWLEDGE_ENGINE_REUSES_EXISTING_RETRIEVAL_NO_NEW_SEARCH_SYSTEM.md) — reuse `lib/query.js` unchanged, add a local match-quality/hedge layer rather than trust every match, check the curated boundary table before a weak match is allowed to stand, and serve the minimal portal from a local Node-core HTTP server rather than a hosted service or a duplicated browser-side ranking implementation.

**Reliability / correctness fixes**: all three found and fixed pre-commit during this feature's own construction and testing (no `BUG-###` record — see Known Bugs below): the bug-status prefix-match fix, the weak-match hedging mechanism, and the boundary-table-precedence fix. Full detail in Evolution / Implementation Journal above.

**Other dated milestones**: 2026-08-13 — 20-question eval corpus run against the real engine: 18/20 passed exactly as expected, 2/20 documented known misses, 0/20 unexplained; full regression suite (`knowledge.test.js` 17/17, existing 33-file suite unaffected) and `validate` (0 errors) confirmed the same day.

## Known Bugs / Troubleshooting

None recorded as canonical `BUG-###` entries — every defect found during this feature's own construction (see Evolution above) was caught and fixed before the first commit, with no shipped/user-facing incident. Per `docs/product/CLAUDE.md` § 12, a `BUG-###` record is warranted when a fix pattern would help diagnose something similar faster later; the three fixes above are recorded in this file's own Evolution log instead, which is the more directly useful location for a feature that was never released in a broken state.

## Decisions

See [DEC-019](../decisions/DEC-019_KNOWLEDGE_ENGINE_REUSES_EXISTING_RETRIEVAL_NO_NEW_SEARCH_SYSTEM.md) — the decision to reuse `lib/query.js` unchanged, add a local Node-core HTTP server rather than duplicate ranking logic in browser JavaScript or add a hosted backend, and use a small curated boundary table rather than infer `NOT_SUPPORTED` from zero search results.

## Future Enhancements

Documented, evidence-grounded, all deferred to a later stage per the Stage 1 brief's explicit stop condition — not implemented here:

- **Retrieval precision.** The eval corpus surfaced three concrete, reproducible gaps in reusing `lib/query.js` unchanged for natural-language questions rather than short canonical lookups: (1) generic single-keyword overlaps (`event`, `import`, `archive`) frequently tie across several unrelated records, with the ascending-ID tiebreak sometimes surfacing a less-relevant record (e.g. "How do I import photographs from an SD card?" surfaces AI-FEAT-018 over the more directly relevant AI-FEAT-019); (2) ambiguous single words cause real topical drift ("How do I switch between Stable and Preview versions?" matches AI-FEAT-015/016 Media Preview, not AI-FEAT-057 Multi-Channel Release, via the word "preview"); (3) "Can I search my entire archive?" loses AI-FEAT-053 (Global Search, Planned — the genuinely relevant record) to five unrelated Archive Operations records that merely share the word "archive." None of these caused a false confident answer (the weak-match hedge fired correctly in every case), but they measurably reduce answer relevance. A scoped, additive Stage 2 candidate: a lightweight re-ranking pass local to `knowledgeEngine.js` (e.g. weighting by distinct-token coverage of the full query, not just count) — still no embeddings, still no change to the shared `lib/query.js` ranker other commands depend on.
- **Roadmap/dashboard routing.** "What's coming next for AutoIngest?" resolves `UNKNOWN` today — Stage 1's engine only matches `feature`-type search-index records, even though `roadmap-dashboard.json` answers this question well. Extending `answerQuestion` to also consider `roadmap`/`product_doc` entity types is a small, well-scoped Stage 2 item.
- **Boundary table coverage.** The curated `NOT_SUPPORTED` table is deliberately small (6 entries). "Can I have multiple people log in with different roles?" is genuinely not supported (per `01_FEATURE_REGISTRY.md`'s own Reconciliation Notes) but is not in the table, and the engine reports `AVAILABLE` via a coincidental match on `AI-FEAT-027` (Activity Log, via the word "log") instead. Recorded as a known, evidenced gap in the eval corpus (Q20) rather than curated around it.
- Workflow, Troubleshooting Entry, and Navigation Location record types (proposed in the Phase 1 audit's schema section) — none exist yet; every Stage 1 answer's `guidance` field is the honest fallback sentence for exactly this reason.
- Screenshots/visual assets, the full 8-screen portal information architecture, and a conversational multi-turn layer — all explicitly deferred past Stage 1.

## Related Files

- `scripts/product-docs/lib/knowledgeIndex.js`
- `scripts/product-docs/lib/statusResolution.js`
- `scripts/product-docs/lib/knowledgeEngine.js`
- `scripts/product-docs/lib/knowledgeCli.js`
- `scripts/product-docs/lib/knowledgeTestCorpus.js`
- `scripts/product-docs/lib/knowledgeEval.js`
- `scripts/product-docs/lib/build.js` (wiring)
- `scripts/product-docs/cli.js` (wiring)
- `scripts/product-docs/lib/version.js` (docsys/schema/generator version bump to 1.3.0)
- `scripts/product-docs/knowledge-portal/server.js`
- `scripts/product-docs/knowledge-portal/index.html`
- `scripts/product-docs/test/knowledge.test.js`
- `docs/product/generated/knowledge-index.json` (generated output)
- `docs/product/generated/knowledge-gap-report.json` (generated output)
