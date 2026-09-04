'use strict';
// Ask AutoIngest — deterministic retrieval foundation. BM25 index (Stage 1,
// Section 7), productionized from Production Readiness Phase 1's own
// bm25IndexPR1.js prototype (see Section 3's audit for what changed and
// why: explicit index construction instead of implicit reference-keyed
// caching, decision-backed knowledge folded into the document surface,
// resilience against malformed input).
//
// Implements classic Okapi BM25 (Robertson/Sparck Jones/Walker) -- a
// well-established, purely deterministic information-retrieval algorithm.
// Not a learned model. Not embeddings. No network access. No GPU.
//
// k1=1.5, b=0.75 are the universally-cited TREC defaults from the original
// Robertson/Walker papers -- kept UNCHANGED from the prototype, not tuned
// against retrieval250 or any other benchmark. Recognizable BM25, not a
// bespoke scoring function disguised as one.
//
// Never modifies lib/query.js, lib/knowledgeEngine.js,
// lib/knowledgeSurfaceNormalization.js, lib/intentConcepts.js, or
// lib/candidateRecall.js -- those are live production docs-tooling
// infrastructure (Production Readiness Phase 1, Section 4/6's own
// finding), consumed here read-only where reused at all.
//
// KNOWN, INHERITED, NOT-A-BUG CHARACTERISTIC: because both query and
// document text are tokenized through normalizeQuery() -> textKeywords.js's
// keywordsFrom(), which de-duplicates every text into a Set before
// returning it, term frequency (tf) below is ALWAYS exactly 1 for every
// term present in a document -- this is effectively BM25 with binary
// term-presence weighting, not frequency-weighted BM25 (docLen/avgDocLen
// normalization and per-term IDF weighting still function normally; only
// within-document repeat-count signal is unavailable). This is NOT a
// regression introduced during productionization -- the byte-identical
// property existed in the Production Readiness Phase 1 prototype
// (bm25IndexPR1.js's own tf-counting loop ran over the same
// keywordsFrom()-deduplicated token stream) and is therefore already
// baked into the validated 64.1/80.2/87.3/93.7/0.740 retrieval250
// baseline this module is required to reproduce. Left unchanged per
// Section 7's own instruction not to alter BM25 behavior post-hoc without
// broad benchmark evidence -- switching to true frequency-preserving
// tokenization is a legitimate FUTURE general-improvement candidate, to be
// evaluated (not assumed) against retrieval250 and the independent
// holdout, never assumed correct-by-construction.

const { normalizeQuery } = require('./queryNormalization');
const { aliasHintFor } = require('./canonicalAliases');

const K1 = 1.5;
const B = 0.75;

// Document text per record: identity (title/aliases) + purpose (summary/
// whatItDoes) + behavior/procedural detail (current_behavior for Features;
// expectedResult/limitations/warnings/whereToGo/troubleshooting for
// Workflows) + this record's own canonical-alias enrichment (see
// canonicalAliases.js) + (Section 13, NEW this stage, not in the PR1
// prototype) operator-relevant Decision-backed text for any Feature with a
// linked Decision record, via the SAME already-tested, already-C14-proven
// ctx.authorityIndexByFeatureId/ctx.searchIndexById lookup
// decisionFactsFor() (knowledgeAccessC14.js) already uses for the tool
// layer's own `limitations` dimension -- reused read-only here too, so a
// query matching a Decision's own distinctive vocabulary can now also
// help surface the Feature it constrains, not only a query matching the
// Feature's own base text. `ctx` is OPTIONAL: when omitted, the index
// builds exactly as the PR1 prototype did (Feature/Workflow text only) --
// this keeps the index buildable from `built` alone for callers (tests,
// this module's own docs) that don't need a full engine context.
function documentTextFor(built, ctx) {
  const textById = new Map();
  for (const f of built.featureIndex || []) {
    const decisionText = ctx ? decisionTextFor(f.feature_id, ctx) : '';
    const text = [f.name, ...(f.aliases || []), f.summary, f.current_behavior, aliasHintFor(f.feature_id), decisionText]
      .filter(Boolean).join(' ');
    textById.set(f.feature_id, text);
  }
  for (const w of built.workflowIndex || []) {
    const text = [w.title, w.whatItDoes, w.whenToUseIt, w.expectedResult, w.limitations, w.warnings, w.whereToGo, w.troubleshooting, aliasHintFor(w.id)]
      .filter(Boolean).join(' ');
    textById.set(w.id, text);
  }
  return textById;
}

// Section 13's own "do not expose repository IDs to the eventual operator"
// requirement does not apply at THIS layer -- this text is internal
// retrieval-index content, never returned to a caller, let alone an
// operator (see index.js's own returned shape, which carries only
// id/kind/title/score/sourceChannels). Mirrors decisionFactsFor()'s own
// read-only, additive, never-invented-content discipline: only a
// Feature's OWN forward-cited Decisions (authorityIndexByFeatureId, the
// project's documented cross-linking authority direction) contribute, and
// only their real `.detail`/`.summary` text -- nothing synthesized.
function decisionTextFor(featureId, ctx) {
  if (!ctx || !ctx.authorityIndexByFeatureId || !ctx.searchIndexById) return '';
  const entry = ctx.authorityIndexByFeatureId.get(featureId);
  if (!entry || !entry.relatedDecisions || !entry.relatedDecisions.length) return '';
  const parts = [];
  for (const decId of entry.relatedDecisions) {
    const dec = ctx.searchIndexById.get(decId);
    if (!dec || dec.entity_type !== 'decision') continue;
    if (dec.detail) parts.push(dec.detail);
    else if (dec.summary) parts.push(dec.summary);
  }
  return parts.join(' ');
}

// Builds a complete, immutable BM25 index from the Knowledge Base
// (`built`, from lib/build.js's assemble(), and optionally `ctx`, from
// lib/knowledgeEngine.js's buildEngineContext(), for Decision-text
// enrichment). Pure function -- no module-level state, no implicit
// caching. Callers own the index's lifecycle: build once, hold the
// returned object, pass it to search()/rank() explicitly. This is the
// Section 3 audit's own required fix -- the PR1 prototype's module-level
// `_bm25Cache` (keyed on object reference equality) would never hit under
// main/askAutoIngest.js's existing freshCtx()-per-request pattern; an
// explicit, caller-owned index avoids that silent-rebuild trap entirely.
function buildBm25Index(built, ctx) {
  if (!built || (!built.featureIndex && !built.workflowIndex)) {
    throw new TypeError('buildBm25Index requires a Knowledge Base object with featureIndex and/or workflowIndex.');
  }
  const textById = documentTextFor(built, ctx);
  const tokensById = new Map();
  const df = new Map();
  let totalLen = 0;
  for (const [id, text] of textById) {
    const tokens = normalizeQuery(text);
    tokensById.set(id, tokens);
    totalLen += tokens.length;
    const seen = new Set(tokens);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = textById.size;
  const avgDocLen = N ? totalLen / N : 0;
  const idf = new Map();
  for (const [t, d] of df) {
    idf.set(t, Math.log(1 + (N - d + 0.5) / (d + 0.5)));
  }
  const tfById = new Map();
  for (const [id, tokens] of tokensById) {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    tfById.set(id, tf);
  }
  const docLenById = new Map();
  for (const [id, tokens] of tokensById) docLenById.set(id, tokens.length);

  return Object.freeze({ idf, tfById, docLenById, avgDocLen, N, builtAt: Date.now() });
}

function bm25Score(queryTokens, docId, index) {
  const tf = index.tfById.get(docId);
  if (!tf) return 0;
  const docLen = index.docLenById.get(docId) || 0;
  let score = 0;
  for (const t of new Set(queryTokens)) {
    const f = tf.get(t) || 0;
    if (!f) continue;
    const termIdf = index.idf.get(t) || 0;
    const numerator = f * (K1 + 1);
    const denominator = f + K1 * (1 - B + B * (docLen / (index.avgDocLen || 1)));
    score += termIdf * (numerator / denominator);
  }
  return score;
}

// Ranks every indexed document by BM25 score against a raw query string,
// descending, ties broken by id ascending (deterministic, matches every
// other ranking pass in this module tree). Returns only score>0 documents
// -- callers decide their own admission/truncation policy. Never throws on
// a malformed query (normalizeQuery() already coerces defensively); throws
// on a malformed/missing index, since that is a genuine caller error, not
// a query-shape edge case to degrade gracefully around.
function bm25Rank(query, index) {
  if (!index || !index.tfById) throw new TypeError('bm25Rank requires a BM25 index built by buildBm25Index().');
  const queryTokens = normalizeQuery(query);
  if (!queryTokens.length) return [];
  const out = [];
  for (const id of index.tfById.keys()) {
    const score = bm25Score(queryTokens, id, index);
    if (score > 0) out.push({ id, score });
  }
  out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, 'en', { numeric: true }));
  return out;
}

module.exports = { buildBm25Index, bm25Rank, bm25Score, documentTextFor, decisionTextFor, K1, B };
