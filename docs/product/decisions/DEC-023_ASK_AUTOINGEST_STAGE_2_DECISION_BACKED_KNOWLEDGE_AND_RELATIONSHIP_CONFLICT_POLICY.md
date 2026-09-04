# DEC-023 — Ask AutoIngest Stage 2: Decision-Backed Knowledge Policy Resolved (Reads Yes, Retrieval-Surface No), Relationship CONFLICT State Corrected Against Real Data

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-058 / AI-RM-011 |
| Status | Accepted |
| Date | 2026-09-04 |
| Evidence status | Verified from code (`scripts/product-docs/lib/askKnowledge/*.js`), Stage 1's own `DEC-022` evidence (`retrieval250`/holdout131 measurements), and a direct scan of the real Knowledge Model corpus (`scripts/product-docs/lib/knowledgeModel/records/*.js`) for relationship co-occurrence patterns |

## Context

Stage 1 (`DEC-022`) deliberately left Decision-text retrieval-surface enrichment as an unresolved Stage 2 decision point, having found it trades a Top-1/MRR cost for a Top-5/Top-10 gain on both `retrieval250` and an independent holdout, without recommending adoption. The Stage 2 brief (Section 6) requires this be resolved now, explicitly separating two concepts: (A) Decision records as authoritative product knowledge, and (B) Decision text as retrieval-surface enrichment, and explicitly warns against enabling (B) "merely because it produces 90.9% Top-5" without weighing candidate quality and "false attraction to implementation/provenance language."

Separately, while implementing Section 10's relationship-authority states (SUPPORTED/CONTRADICTED/UNKNOWN/CONFLICT), an initial CONFLICT-detection design (any `distinctFrom` edge co-occurring with a positive edge between the same pair) was tested directly against the real Knowledge Model corpus before being accepted, per this project's own "measure, don't assume" discipline.

## Options Considered — Decision-Backed Knowledge Policy

**1. Enable Decision-text retrieval-surface enrichment as Stage 2's default**, since it crosses 90% Top-5 on the independent holdout (a real, cross-benchmark-reproducible signal per `DEC-022`).
- Rejected: crossing 90% Top-5 is exactly the outcome Section 6 says must NOT be the deciding factor alone. The enrichment consistently costs Top-1/MRR (the "get the single best answer first" metric) on both `retrieval250` and the holdout — a real precision tradeoff, not free.

**2. Leave Decision-backed knowledge entirely out of Stage 2** (neither reads nor retrieval enrichment), deferring the whole question further.
- Rejected outright: Checkpoint 14 already demonstrated operator-relevant Decision-backed facts must be reachable, and `decisionFacts.js`'s `decisionFactsFor()` (promoted unchanged from Checkpoint 14 Phase 4) already does this safely and cheaply for reads — there is no real cost to deferring only this half.

**3. Chosen: separate the two questions completely.** Decision-backed facts are ALWAYS available once a feature is selected (Section 6A, via `read_autoingest`'s `limitations` dimension, unconditional, no flag). The retrieval SURFACE (Section 6B) keeps Stage 1's certified, no-enrichment configuration as Stage 2's own default (`buildRetrievalIndex(built)` called without `ctx` in `askKnowledge/index.js`'s `buildKnowledgeContext()`), decided on retrieval-quality grounds alone, independent of whatever is decided for reads.
- The two questions are genuinely independent in practice: a query that already finds the right Feature via its own summary/behavior text (the common case — a Decision constrains an already-documented feature, it does not exist in isolation) loses nothing by leaving retrieval enrichment off, since the Decision's own facts are still fully reachable the moment that Feature is read.
- The specific, previously-unquantified risk Section 6 names — "false attraction to implementation/provenance language" — is real and plausible: Decision `.detail` text is authored for engineers and can contain implementation-flavored vocabulary that risks pulling a Feature into BM25 relevance purely on technical-vocabulary overlap, not topical fit. This was not separately measured (candidate-quality, not just Top-K, would require its own study) — in the absence of that evidence, the conservative default (off) is chosen, exactly matching Section 6's own instruction not to adopt the change speculatively.

## Options Considered — Relationship CONFLICT Detection

**1. Initial design: any `distinctFrom` edge co-occurring with a positive edge for the same pair = CONFLICT.**
- Tested directly against the real 66-record Knowledge Model before acceptance. Found 15 real pairs with this exact co-occurrence pattern (e.g. `AI-FEAT-011`/`AI-FEAT-012`, Source Detection/Source Selection: `precedesInWorkflow` AND `distinctFrom` for the same pair). Inspecting the actual relationship `.note` text confirmed these are NOT contradictions — this corpus's own authoring convention uses `distinctFrom` to mean "distinct mechanism/identity, do not conflate," fully compatible with a real directional/procedural relationship also existing. **Rejected**: this design would have produced 15 false-positive CONFLICT results relative to Checkpoint 13/14's own (correct, on this point) CONTRADICTED behavior.

**2. Chosen: `distinctFrom` alone means CONTRADICTED, matching the corpus's actual semantics and Checkpoint 13/14's own original design.** A narrower, genuinely meaningful CONFLICT check was added instead: a DIRECTIONAL type (`uses`/`writesTo`/`readsFrom`/`precedesInWorkflow`) is inherently asymmetric — if both subjects' own records assert the SAME directional type pointing at each other, that is a real same-type authoring contradiction (the edge cannot be true in both directions at once).
- This check found a genuine, pre-existing Knowledge Model defect: `KM-transfer-export` and `KM-transfer-import` each carry their own `precedesInWorkflow` edge pointing at the other. `KM-transfer-import`'s own edge note text ("Import reads what Export wrote") explicitly describes Export happening first, but the edge's own stored direction (on Import's own record, pointing at Export) literally encodes the opposite ordering under this project's own established `direction: subject->object` convention. This is a real, disclosed data-authoring inconsistency, not a false positive — `check_relationship('AI-FEAT-038', 'AI-FEAT-039')` now correctly returns `CONFLICT` rather than silently picking one direction.
- The underlying Knowledge Model record (`lib/knowledgeModel/records/transferAndArchive.js`) is left unmodified — it is Tier-1 hand-authored content outside Stage 2's own scope to silently edit; the defect is reported (this record, the corpus audit, and the final report) rather than fixed here, per this project's "append and mark, never silently alter" discipline.

## Decision

1. `read_autoingest`'s `limitations` dimension unconditionally folds in a selected feature's own linked Decision facts (`decisionFacts.js`, unchanged from Checkpoint 14) — no flag, always on.
2. `askKnowledge/index.js`'s `buildKnowledgeContext()` calls `buildRetrievalIndex(built)` WITHOUT `ctx` — Stage 1's certified, no-decision-enrichment configuration is Stage 2's own default retrieval surface. Revisiting this requires new evidence beyond a Top-5 percentage (e.g. a dedicated candidate-quality/precision study), not merely a future desire to cross 90%.
3. `relationships.js`'s `resolveRelationship()` returns CONTRADICTED for any `distinctFrom` edge (matching corpus semantics), and CONFLICT specifically when a directional type's edge exists in both directions for the same pair — verified against real data, not assumed.
4. The `KM-transfer-export`/`KM-transfer-import` `precedesInWorkflow` direction inconsistency is recorded here and in Stage 2's corpus audit as a known, disclosed Knowledge Model defect, left unfixed pending a dedicated documentation-maintenance pass.

## Consequences

- A future caller cannot get a stronger BM25 match on a Feature purely because a linked Decision happens to share technical vocabulary with the query — this is a deliberate precision-preserving choice, traded against a small, unquantified recall cost for genuinely Decision-vocabulary-only queries (rare in the corpus's own query distribution, per `retrieval250`'s and holdout131's own broad coverage).
- `check_relationship('AI-FEAT-038', 'AI-FEAT-039')` (Transfer Export vs. Transfer Import) now returns CONFLICT instead of a directional SUPPORTED answer, until the underlying Knowledge Model record is corrected by a future maintenance pass — a real, honest limitation, not a defect in Stage 2's own logic.
- If a future stage finds concrete evidence that Decision-text enrichment's precision cost is smaller than currently assumed (a dedicated candidate-quality study, not another aggregate Top-K run), this decision should be revisited explicitly, not silently overridden.

## Reconciliation Note

None recorded — consistent with [DEC-022](DEC-022_ASK_AUTOINGEST_STAGE_1_DETERMINISTIC_RETRIEVAL_PRODUCTIONIZATION.md)'s own disclosed tradeoff evidence, which this decision resolves rather than contradicts.
