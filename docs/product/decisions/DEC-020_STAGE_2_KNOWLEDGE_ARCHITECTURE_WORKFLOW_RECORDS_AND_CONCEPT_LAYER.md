# DEC-020 — Stage 2 Knowledge Architecture: Workflow Records, Concept Layer, and Hint-vs-Raw Boundary Precedence

| Field | Value |
|---|---|
| Related feature(s) / roadmap milestone | AI-FEAT-058 / AI-RM-011 |
| Status | Accepted |
| Date | 2026-08-13 |
| Evidence status | Verified from code (`scripts/product-docs/lib/knowledgeEngine.js`, `intentConcepts.js`, `parseProductDocs.js`) and Stage 2's own eval-corpus/regression testing |

## Context

Stage 1's own audit (approved before Stage 2 implementation began) proposed three architectural pieces for Stage 2: a Workflow record type distinct from Capability, a small curated Intent/concept-synonym layer for retrieval, and richer answer contracts. Building these surfaced three real design decisions with genuine alternatives, plus one regression discovered and fixed during Stage 2's own testing that is itself a decision worth recording (how hint-boosted scores interact with the curated `NOT_SUPPORTED` boundary table).

## Options Considered

**1. Workflow record storage — full Markdown parser/validator family (matching bugs/decisions) vs. structured JSON authored directly vs. Markdown reusing generic section-extraction.**
- A full bespoke Markdown family (its own ID allocator, concurrency-safe locking, etc., matching `recordAllocator.js`'s bug/decision/postmortem machinery) was rejected as disproportionate to Stage 2's scope — that machinery exists for high-volume, concurrently-authored record families; Workflow authoring is deliberate and low-volume.
- Structured JSON authored directly was rejected — Workflow content is fundamentally prose (steps, navigation descriptions, limitations) that benefits from Markdown's readability and this repository's existing review conventions, and JSON invites exactly the kind of un-reviewable data-only PRs the evidence-discipline culture here works against.
- **Chosen: Markdown files under `docs/product/workflows/AI-WF-###_NAME.md`, parsed by a new `parseWorkflowFile` that reuses `lib/markdown.js`'s existing generic `extractSection`/`extractHeaderTable` helpers (the same pattern `parseFeatureFile` already uses) — no new parsing primitives, only a new section-name mapping.** ID allocation is manual/sequential (same pattern used for `AI-FEAT-058`/`AI-RM-011`/`DEC-019` in Stage 1), not routed through `recordAllocator.js`'s concurrency-safe lock (that mechanism solves a problem — concurrent sessions racing on the same ID — that doesn't apply to a single deliberate authoring pass).

**2. Concept/synonym retrieval layer — embeddings vs. a large per-question lookup table vs. a small curated concept-cluster map.**
- Embeddings were rejected per the Stage 2 brief's own explicit instruction and Stage 1's own finding that the eval corpus's failures were scoped, fixable retrieval-precision gaps, not a fundamental inability to match natural language.
- A large per-question lookup table was rejected — it doesn't generalize to real paraphrases and was explicitly named as a failure mode to avoid ("Do NOT create a giant question→answer lookup table").
- **Chosen: a small (~18-cluster) curated map (`lib/intentConcepts.js`) of trigger phrases to alternate "hint" query strings, run through the SAME unchanged `lib/query.js` ranker as additional candidate queries** — paraphrase families converge on the same records without a second ranking implementation.

**3. Hint-boosted score vs. curated boundary precedence.**
- Initial implementation let ANY strong feature match (however produced) override a matched `NOT_SUPPORTED` boundary, exactly as Stage 1 had established. Testing found this reintroduced the precise class of bug PR #5's forensic review caught for raw keyword luck — this time via a concept hint: a "team-collaboration" hint aimed at a legitimate paraphrase family ("several users... simultaneously") also fired for "multiple people log in with different roles" (a genuine, correctly-detected multi-user-roles boundary question) and, because the hint scored strongly against `AI-FEAT-048`, silently overrode the boundary.
- **Chosen: a hint-boosted score may never override a curated boundary — only a score the raw, un-hinted question earns on its own may.** `searchCandidates()` now tracks raw-question-only scores (`rawFeatureMatches`) separately from the full hint-expanded merge, and the boundary-override check in `answerQuestion()` uses the raw-only version exclusively. A hint is a recall aid, not a confidence authority.

## Decision

Workflow records: Markdown under `docs/product/workflows/`, parsed via the existing generic section-extraction pattern, manually ID-allocated. Concept layer: a small, curated, inspectable phrase-to-hint map, still routed entirely through the unchanged shared ranker. Boundary precedence: raw-question strength only, never hint-boosted strength, may override a curated `NOT_SUPPORTED` boundary.

## Consequences

- Workflow authoring remains a deliberate, reviewed, low-volume activity — Stage 2 shipped 8 records covering the highest-value operator paths identified in the Phase 1-3 audit, not exhaustive coverage of the ~50 identified intents (recorded as a knowledge gap in `docs/product/workflows/README.md`, not silently absent).
- The concept layer is a real, ongoing maintenance surface: each cluster's `hints` must be verified against real keyword overlap with their intended target records (two clusters — `import-video`, `transfer-resume` — were found mis-aimed during Stage 2's own testing and corrected or deliberately left unboosted; see `AI-FEAT-058`'s Stage 2 Evolution Journal).
- A byproduct of investigating the boundary-override regression: `lib/searchIndex.js`'s `keywordsFrom()` previously had no stopword filtering (only a length>2 filter), which a short Capability summary rarely exposed but a much richer Workflow record's prose did — a real, separate, confirmed defect (`AI-WF-006` won "How do I switch between Stable and Preview versions?" confidently on the words "how"/"between"/"and" alone) fixed by adding a small curated stopword list, benefiting every future record in this family, not just Workflow.
- The raw-vs-hint distinction adds a second parallel candidate-scoring pass (`bestRawByRecord` alongside `bestByRecord`) inside `searchCandidates()` — a small, bounded cost, not a second ranking implementation (still one call to `lib/query.js`'s `runQuery` per candidate query, just tracked separately for the raw one).

## Reconciliation Note

None recorded — consistent with `scripts/product-docs/README.md`'s existing non-goals (no embeddings, no external AI, no network) and with DEC-019's own architecture, which this extends rather than supersedes.
