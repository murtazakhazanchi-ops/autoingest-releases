'use strict';
// PRODUCTION READINESS PHASE 1, Section 7 — deterministic BM25-style index.
// New, local, additive code (never edits lib/query.js or any shared
// production file) implementing the classic Okapi BM25 ranking function
// (Robertson/Sparck Jones) -- a well-established, purely deterministic
// information-retrieval algorithm, not a learned model, not embeddings.
//
// Forensic motivation (Section 4's own trace): lib/query.js's scoreRecord
// keyword-overlap tier awards 100 points per matched token UNCONDITIONALLY
// -- a query sharing only corpus-wide-common words ("metadata", "separate")
// with the correct record scores identically to one sharing the record's
// own distinctive vocabulary ("consolidat*", "fragmentation"). BM25's
// inverse-document-frequency term is the standard, deterministic fix for
// exactly this: a term that appears in fewer documents contributes more to
// the score than one that appears in most of them.
//
// Standard BM25 parameters (k1=1.5, b=0.75) -- not tuned against this
// benchmark's own queries; these are the universally-cited defaults from
// the original Robertson/Walker TREC papers, kept unchanged so this is
// recognizable BM25, not a bespoke scoring function disguised as one.

const { keywordsFrom } = require('./../../lib/textKeywords');
const { aliasHintFor } = require('./canonicalAliasesPR1');

const K1 = 1.5;
const B = 0.75;

// Corpus-wide document text: a union of every field genuinely describing
// what a record IS or DOES -- title/aliases (identity), summary/whatItDoes
// (purpose), current_behavior/expectedResult+limitations+warnings+
// whereToGo+troubleshooting (behavior/procedural detail). Deliberately
// broader than lib/query.js's own `record.keywords` (which is itself
// pre-tokenized from an unknown historical mix) -- built directly from the
// same raw fields Checkpoint 14's own extended-recall-channel used, so the
// two are directly comparable.
function documentTextFor(built) {
  const textById = new Map();
  for (const f of built.featureIndex || []) {
    const text = [f.name, ...(f.aliases || []), f.summary, f.current_behavior, aliasHintFor(f.feature_id)].filter(Boolean).join(' ');
    textById.set(f.feature_id, text);
  }
  for (const w of built.workflowIndex || []) {
    const text = [w.title, w.whatItDoes, w.whenToUseIt, w.expectedResult, w.limitations, w.warnings, w.whereToGo, w.troubleshooting, aliasHintFor(w.id)].filter(Boolean).join(' ');
    textById.set(w.id, text);
  }
  return textById;
}

function buildBm25Index(built) {
  const textById = documentTextFor(built);
  const tokensById = new Map();
  const df = new Map(); // token -> number of documents containing it at least once
  let totalLen = 0;
  for (const [id, text] of textById) {
    const tokens = keywordsFrom(text);
    tokensById.set(id, tokens);
    totalLen += tokens.length;
    const seen = new Set(tokens);
    for (const t of seen) df.set(t, (df.get(t) || 0) + 1);
  }
  const N = textById.size;
  const avgDocLen = N ? totalLen / N : 0;
  const idf = new Map();
  for (const [t, d] of df) {
    // Standard BM25 idf (Robertson-Walker), floored at a small positive
    // value rather than allowed to go negative for very common terms (the
    // classic +1 inside the log, not a bespoke adjustment).
    idf.set(t, Math.log(1 + (N - d + 0.5) / (d + 0.5)));
  }
  // Per-document term frequency map, precomputed once.
  const tfById = new Map();
  for (const [id, tokens] of tokensById) {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    tfById.set(id, tf);
  }
  const docLenById = new Map();
  for (const [id, tokens] of tokensById) docLenById.set(id, tokens.length);

  return { idf, tfById, docLenById, avgDocLen, N };
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

// Ranks every document by BM25 score against the query, descending, ties
// broken by id ascending for determinism. Returns ALL scored docs (score>0)
// -- callers decide their own admission/truncation.
function bm25Rank(query, index) {
  const queryTokens = keywordsFrom(query);
  const out = [];
  for (const id of index.tfById.keys()) {
    const score = bm25Score(queryTokens, id, index);
    if (score > 0) out.push({ id, score });
  }
  out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, 'en', { numeric: true }));
  return out;
}

module.exports = { buildBm25Index, bm25Rank, bm25Score, documentTextFor, K1, B };
