'use strict';
// Ask AutoIngest — deterministic retrieval foundation. Public boundary
// (Stage 1, Section 4). NOTHING in the shipped application calls this
// module yet -- it exists to be imported and tested independently.
//
// BOUNDARY CONTRACT (Section 4's own explicit spec):
// This module MAY determine: candidate relevance, deterministic rank,
// source-channel contribution, canonical identity, record type,
// human-readable title, and retrieval evidence/score metadata.
// This module MUST NOT determine: what the operator meant conversationally,
// whether Qwen should answer or clarify, capability truth, conversational
// intent, a final answer, or "unsupported" status merely from a retrieval
// miss. It returns candidates; it never returns operator-facing prose,
// tool-call handles, or conversational framing -- those belong to whatever
// (not-yet-modified-this-stage) tool/presentation layer eventually calls
// this module.
//
// Exactly zero learned retrieval (Section 5): only deterministic
// tokenization, BM25, RRF, and canonical aliases are used below. No BGE,
// no embeddings, no vector database, no reranker, no classifier, no judge,
// no cloud call.

const { answerQuestion } = require('../knowledgeEngine');
const { buildBm25Index, bm25Rank } = require('./bm25Index');
const { reciprocalRankFusion } = require('./fusion');
const { normalizeQuery } = require('./queryNormalization');

const RECORD_ID_RE = /^AI-(FEAT|WF)-\d+$/;

// Fusion configuration -- the exact values Production Readiness Phase 1's
// own systematic sweep (15+ strategies, multiple weight ratios) found to
// score best across Top-1/3/5/10/MRR simultaneously, not cherry-picked on
// a single metric. Unchanged here; any future retuning must be justified
// by broad retrieval250 (or its successor holdout) evidence, per Stage 1
// Section 7's own instruction, never by an individual query.
const RRF_K = 60;
const LEXICAL_CHANNEL_WEIGHT = 3;
const BM25_CHANNEL_WEIGHT = 1;

// Extracts the existing lexical scorer's own ranked candidate ids for one
// query, reusing lib/knowledgeEngine.js's answerQuestion() strictly
// read-only (never modified, per Phase 1 Section 6's own finding that this
// file is live production docs-tooling infrastructure). Filters to real
// Feature/Workflow ids only -- governance-type matches (bug/decision/
// postmortem) are a distinct retrieval surface Section 13 handles via
// bm25Index.js's own decision-text document enrichment instead, not via
// this channel returning a governance record id as if it were a
// selectable Feature/Workflow candidate.
function lexicalChannel(query, ctx) {
  let answer;
  try {
    answer = answerQuestion(query, ctx);
  } catch (err) {
    // Section 3's own audit finding: a channel failure must degrade, not
    // crash the whole search. Logged, not thrown -- the caller still gets
    // a usable (BM25-only) result.
    // eslint-disable-next-line no-console
    console.error('[askRetrieval] lexical channel failed, degrading to BM25-only:', err && err.message);
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const c of [...(answer.matchedCapabilities || []), ...(answer.sources || [])]) {
    if (!c || !c.id || seen.has(c.id)) continue;
    if (c.entityType && c.entityType !== 'feature' && c.entityType !== 'workflow') continue;
    if (!RECORD_ID_RE.test(c.id)) continue;
    seen.add(c.id);
    out.push(c.id);
  }
  return out;
}

// BM25 channel, same graceful-degradation discipline as the lexical
// channel above -- a broken index or malformed query must never crash the
// whole search.
function bm25Channel(query, bm25Index) {
  try {
    return bm25Rank(query, bm25Index).map((r) => r.id);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[askRetrieval] BM25 channel failed, degrading to lexical-only:', err && err.message);
    return [];
  }
}

function titleFor(id, ctx) {
  const f = ctx.knowledgeIndexById && ctx.knowledgeIndexById.get(id);
  if (f) return f.title || id;
  const w = ctx.workflowIndexById && ctx.workflowIndexById.get(id);
  if (w) return w.title || id;
  return id;
}

// The Stage 1 index lifecycle contract (Section 3's own audit fix): the
// caller builds the index ONCE (buildRetrievalIndex, below) and passes it
// into search() explicitly on every call. No module-level cache, no
// implicit rebuild-on-every-call trap.
function buildRetrievalIndex(built, ctx) {
  return buildBm25Index(built, ctx);
}

// The core search function. `query` is the primary (typically the
// operator's own original wording) query string. `options.alternateQuery`
// (Section 11) is an OPTIONAL second query string -- e.g. a future
// caller's own reformulated/shortened search phrasing -- fused alongside
// the primary query rather than replacing it, so a reformulation can only
// ADD candidates, never silently discard ones the original wording alone
// would have found. Nothing in this module generates `alternateQuery`
// itself; no reformulation logic, no model call, lives here.
function search(built, ctx, bm25Index, query, options = {}) {
  const primaryTokens = normalizeQuery(query);
  if (!primaryTokens.length) return { candidates: [], note: 'empty_query' };

  const primaryLex = lexicalChannel(query, ctx);
  const primaryBm25 = bm25Channel(query, bm25Index);

  const weightedLists = [
    [primaryLex, LEXICAL_CHANNEL_WEIGHT],
    [primaryBm25, BM25_CHANNEL_WEIGHT],
  ];

  // Section 11's own required test surface: when an alternate/reformulated
  // query is supplied, its own lexical+BM25 channels are fused in too, at
  // the SAME per-channel weights as the primary query (not a separate,
  // undocumented weighting scheme) -- deterministic candidate fusion
  // across both wordings, per Section 11's own explicit requirement,
  // without ever discarding the original wording's own candidates.
  // Computed once here (not per-candidate below) -- both channels are
  // pure functions of (query, index), so recomputing per candidate would
  // be wasted, non-trivial work for no behavioral difference.
  let altLex = [], altBm25 = [];
  const hasAlternate = typeof options.alternateQuery === 'string' && options.alternateQuery.trim();
  if (hasAlternate) {
    altLex = lexicalChannel(options.alternateQuery, ctx);
    altBm25 = bm25Channel(options.alternateQuery, bm25Index);
    weightedLists.push([altLex, LEXICAL_CHANNEL_WEIGHT], [altBm25, BM25_CHANNEL_WEIGHT]);
  }

  const fusedIds = reciprocalRankFusion(weightedLists, RRF_K);

  const primaryLexSet = new Set(primaryLex);
  const primaryBm25Set = new Set(primaryBm25);
  const altLexSet = new Set(altLex);
  const altBm25Set = new Set(altBm25);
  const sourceChannelsById = new Map();
  for (const id of fusedIds) {
    const channels = [];
    if (primaryLexSet.has(id)) channels.push('lexical');
    if (primaryBm25Set.has(id)) channels.push('bm25');
    if (hasAlternate) {
      if (altLexSet.has(id)) channels.push('lexical-alternate');
      if (altBm25Set.has(id)) channels.push('bm25-alternate');
    }
    sourceChannelsById.set(id, channels);
  }

  const candidates = fusedIds.map((id, idx) => ({
    id,
    kind: id.startsWith('AI-WF-') ? 'workflow' : 'feature',
    title: titleFor(id, ctx),
    rank: idx + 1,
    sourceChannels: sourceChannelsById.get(id) || [],
  }));

  return { candidates, note: candidates.length ? 'ok' : 'no_candidates' };
}

module.exports = {
  search, buildRetrievalIndex, lexicalChannel, bm25Channel,
  RRF_K, LEXICAL_CHANNEL_WEIGHT, BM25_CHANNEL_WEIGHT,
};
