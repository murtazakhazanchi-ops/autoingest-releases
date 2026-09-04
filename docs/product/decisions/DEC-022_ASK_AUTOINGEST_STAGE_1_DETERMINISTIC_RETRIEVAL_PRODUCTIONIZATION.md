# DEC-022 — Ask AutoIngest Stage 1: Deterministic Retrieval Foundation Productionized, Decision-Text Enrichment Kept Opt-In

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | Ask AutoIngest (feature/ask-autoingest), Knowledge Model / knowledge-engine track |
| Status | Accepted |
| Date | 2026-09-04 |
| Evidence status | Verified from code (`scripts/product-docs/lib/askRetrieval/*.js`), the frozen `retrieval250` benchmark (`scripts/product-docs/bench/orchestrator/retrieval250.js`), and this module's own test suite (`scripts/product-docs/test/askRetrieval/*.test.js`, 61 tests, 0 failures) |

## Context

"Ask AutoIngest — Production Readiness Phase 1" (prior, concluded phase) prototyped a deterministic retrieval design — BM25 + the existing lexical scorer, fused via Reciprocal Rank Fusion — as bench-only experimental code (`bm25IndexPR1.js`, `canonicalAliasesPR1.js`, `knowledgeAccessPR1.js`), and validated it against a frozen 252-query benchmark (`retrieval250`), establishing this baseline over the 237 scored (non-"no-answer") queries:

**Top-1: 64.1%, Top-3: 80.2%, Top-5: 87.3%, Top-10: 93.7%, MRR: 0.740.**

The Product Owner then authorized "Stage 1: Deterministic Retrieval Foundation" — genuine production implementation, not another experiment — with an explicit brief requiring this baseline be preserved as a floor (any regression must be forensically explained, not hidden via benchmark edits), the prototype code to be critically audited rather than copied verbatim, and the production module to additionally index a knowledge type the PR1 prototype never covered: operator-relevant Decision-backed knowledge (a Feature's linked Decision records' own `.detail`/`.summary` text, folded into that Feature's BM25 document).

Running the newly productionized module (`scripts/product-docs/lib/askRetrieval/`) against `retrieval250` with Decision-text enrichment enabled surfaced a real, reproducible tension: it improves Top-5/Top-10 but very slightly regresses Top-1/MRR relative to the frozen baseline.

## Options Considered

**1. Ship with Decision-text enrichment always on (accept the small Top-1/MRR dip as a permanent characteristic of the production module).**
- Rejected as the *default*: the brief's own required minimum is stated as a floor ("Top-1 >= 64.1%... any regression requires forensic explanation"), and baking in an unexamined regression — however small — as Stage 1's certified configuration would not honor that floor's own spirit, even though the same brief separately requires the retrieval design be *able* to index Decision-backed knowledge.

**2. Drop Decision-text enrichment entirely (never implement Section 13's Decision-backed-knowledge requirement).**
- Rejected outright: the Stage 1 brief explicitly and unconditionally requires the retrieval design support indexing "operator-relevant Decision-backed knowledge." Omitting it entirely would fail that requirement, not merely trade it off.

**3. Implement Decision-text enrichment as a genuine, tested, documented capability — but keep it *opt-in* at the index-build call site (`buildRetrievalIndex(built, ctx)` with `ctx` optional), certify only the without-`ctx` configuration as Stage 1's regression-gate baseline, and defer the "should this become the default" decision to the later general-improvement phase, where it can be evaluated against both `retrieval250` and a fresh, untouched holdout set before being adopted.**
- Chosen. This satisfies the brief's Decision-backed-knowledge requirement (the capability exists, is tested, and is real — grounded in each Feature's own linked Decision text via the same `ctx.authorityIndexByFeatureId`/`ctx.searchIndexById` lookup Checkpoint 14's tool layer already uses, never synthesized) without silently absorbing an unexamined regression into Stage 1's own certified numbers. It also does not hide the tradeoff: both configurations are measured, logged, and asserted-non-crashing in the same permanent regression-gate test (`scripts/product-docs/test/askRetrieval/retrieval250Gate.test.js`), satisfying "do not hide regressions through benchmark edits" by showing the numbers rather than picking one silently.

## Decision

1. `scripts/product-docs/lib/askRetrieval/bm25Index.js`'s `buildBm25Index(built, ctx)` keeps `ctx` optional; omitting it builds the index using only Feature/Workflow base text + canonical-alias hints (byte-for-byte the PR1 prototype's own document construction), while passing `ctx` additionally folds in each Feature's linked Decision text.
2. **Stage 1's certified/regression-gate configuration is `buildRetrievalIndex(built)` called WITHOUT `ctx`.** Measured against `retrieval250`: Top-1 64.1%, Top-3 80.2%, Top-5 87.3%, Top-10 93.7%, MRR 0.739 (≈0.740 within benchmark-composition rounding) — this is the PR1 prototype's own reference point, reproduced, not a new configuration newly held to its own bar.
3. **Decision-text enrichment (`ctx` passed) is implemented, unit-tested, and available, but is not Stage 1's default.** Measured against the same benchmark: Top-1 63.3% (-0.84pp), Top-3 80.2% (unchanged), Top-5 88.2% (+0.84pp), Top-10 94.9% (+1.27pp), MRR 0.737 (-0.0021). Both configurations are permanently, automatically re-measured together in `retrieval250Gate.test.js` on every test run — the tradeoff cannot silently drift out of view.
4. Whether Decision-text enrichment becomes Stage 1's (or a later stage's) default is deferred to the "attempt general improvements toward 90%" phase, where it will be evaluated on its own merits against `retrieval250` AND the independent holdout benchmark before any adoption decision, per that phase's own explicit "only accept improvements that are clearly general... do not overfit" instruction.
5. This is documented in `bm25Index.js`'s own header comment alongside a second, related, already-inherited (not newly introduced) architectural characteristic: because both query and document text are tokenized through the existing shared `keywordsFrom()` tokenizer, which de-duplicates every text into a `Set` before returning it, BM25 term frequency in this implementation is always exactly 1 per term per document (effectively binary term-presence weighting, not classic frequency-weighted BM25). This property is byte-identical to the PR1 prototype's own tokenization (verified directly against `bm25IndexPR1.js`) and is therefore already baked into the validated baseline being reproduced — left unchanged per the brief's own "do not tune BM25 post-hoc without broad benchmark evidence" instruction, flagged as a legitimate future general-improvement candidate rather than assumed to need fixing.

## Postscript — General-Improvement Attempt and Independent Holdout (Section 18-19)

After productionization, two general (non-benchmark-specific) improvement candidates were evaluated against `retrieval250`:

1. **Real (non-deduplicated) term-frequency BM25** on the document side (see `bm25Index.js`'s own header comment on the inherited tf-always-1 characteristic): Top-1 65.0% (+0.9pp), Top-3 80.2% (unchanged), Top-5 86.9% (-0.4pp), Top-10 94.5% (+0.8pp), MRR 0.746 (+0.007). Mixed result, not a clean win — **not adopted**.
2. **Decision-text enrichment** (already covered above): a genuine, reproducible tradeoff, not a clean win either.

Retuning the RRF channel-weight ratio (3:1 → 4:1) against `retrieval250` produced a more favorable-looking number (Top-5 88.2%, MRR 0.742) but was **rejected from Stage 1 deliverables** — `retrieval250` was already consulted throughout implementation and is therefore a development benchmark; retuning a weight specifically against it, without independent confirmation, is exactly the overfitting Section 18 prohibits.

**90% Top-5 was not reached on `retrieval250` through any evaluated general improvement.** Per Section 18's explicit permission ("if 90% cannot be reached without overfitting: STOP at the best general implementation. Report honestly"), Stage 1 stops at the certified configuration's 87.3%.

An independent holdout (`retrievalHoldout100.js`, 131 queries authored fresh after the module was frozen and after `retrieval250` was last consulted for tuning; 121 scored, 91.7% without the canonical title, 10 deliberate no-answer queries, all 67 records covered) was run exactly once and not tuned afterward:

- **Certified configuration:** Top-1 61.2%, Top-3 83.5%, **Top-5 89.3%**, Top-10 96.7%, MRR 0.736 — one genuine failure out of 121 queries.
- **Decision-text enrichment:** Top-1 60.3%, Top-3 82.6%, **Top-5 90.9%**, Top-10 95.9%, MRR 0.726 — crosses 90% Top-5 on this independent set, reproducing the identical tradeoff pattern seen on `retrieval250` (Top-5 gain, small cost elsewhere), which is reproducible cross-benchmark signal, not single-benchmark noise — but still a tradeoff, not a strict win, so it remains a documented Stage 2 decision point rather than Stage 1's default.

The holdout's own numbers (Top-5 89.3-90.9%, closely tracking `retrieval250`'s 87.3-88.2%, with the certified configuration's single miss being a genuine, understandable lexical-overlap limitation, not a defect) is direct evidence the design generalizes rather than having overfit to the benchmark it was developed against.

## Consequences

- A future caller of `search()`/`buildRetrievalIndex()` (none exists yet — Stage 1 has zero production callers by design) must consciously choose whether to pass `ctx`, rather than getting Decision-text enrichment "for free" by virtue of having a `ctx` object handy. This is a deliberate, minor ergonomic cost in exchange for keeping the certified baseline unambiguous.
- If a later stage adopts Decision-text enrichment as the default after holdout validation, this decision's own "certified configuration" language should be revisited/superseded — this is expected, not a defect in this decision.
- The tf-always-1 BM25 characteristic means within-document repeated-term signal is currently unavailable to the ranking function; switching to a frequency-preserving tokenization path is flagged as a real, evaluable future improvement, not assumed correct-by-construction, consistent with the same overfitting discipline governing Decision-text enrichment.

## Reconciliation Note

None recorded — consistent with the Stage 1 brief's own explicit instruction to forensically explain, not hide, any benchmark-metric movement, and with [DEC-019](DEC-019_KNOWLEDGE_ENGINE_REUSES_EXISTING_RETRIEVAL_NO_NEW_SEARCH_SYSTEM.md)'s established precedent of reusing existing deterministic retrieval infrastructure rather than introducing a second implementation.
