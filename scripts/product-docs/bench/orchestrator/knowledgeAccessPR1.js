'use strict';
// PRODUCTION READINESS PHASE 1 — candidate deterministic retrieval design.
// Reuses everything from knowledgeAccessC14.js UNCHANGED (readAutoIngest,
// check_relationship, capability_status, roadmap_status, decisionFactsFor,
// directional relationships, all Checkpoint 14 leak fixes) except
// search_autoingest, replaced with Sections 7-11's own benchmarked design:
// BM25 (bm25IndexPR1.js) + the existing lexical scorer, combined via
// Reciprocal Rank Fusion (lexical weight 3, BM25 weight 1, k=60 -- the
// configuration that scored best across Top-1/3/5/10/MRR simultaneously
// on the frozen retrieval250 benchmark, not cherry-picked on any single
// metric), over alias-enriched BM25 documents (canonicalAliasesPR1.js).
// Measured: Top-5 81.0% -> 87.3%, Top-10 89.5% -> 93.7%, MRR 0.722 -> 0.740.
// Still short of the >=90% Top-5 target -- see the Phase 1 report's own
// Section 11 for the full accounting of why, and Section 28's disclosure
// that this is reported as a retrieval-engineering limitation, not
// grounds to add embeddings or a second model.

const c14 = require('./knowledgeAccessC14');
const { HandleSession, readAutoIngest, capabilityStatus, roadmapStatus, checkRelationship, sanitizeTechnicalDetail, VALID_DIMENSIONS } = c14;
const { answerQuestion } = require('../../lib/knowledgeEngine');
const { findAllByFeatureId } = require('../../lib/knowledgeModel/index');
const { buildBm25Index, bm25Rank } = require('./bm25IndexPR1');

function titleFor(id, ctx) {
  const f = ctx.knowledgeIndexById && ctx.knowledgeIndexById.get(id);
  if (f) return f.title || id;
  const w = ctx.workflowIndexById && ctx.workflowIndexById.get(id);
  if (w) return w.title || id;
  return id;
}
const PURPOSE_SNIPPET_CHARS = 180;
function truncateSnippet(text) {
  const t = String(text || '').trim();
  if (t.length <= PURPOSE_SNIPPET_CHARS) return t;
  const cut = t.slice(0, PURPOSE_SNIPPET_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut) + '...';
}
function purposeFor(id, ctx) {
  const km = findAllByFeatureId(id);
  if (km.length && km[0].purpose) return truncateSnippet(km[0].purpose);
  const f = ctx.knowledgeIndexById && ctx.knowledgeIndexById.get(id);
  if (f && f.summary) return truncateSnippet(f.summary);
  const w = ctx.workflowIndexById && ctx.workflowIndexById.get(id);
  if (w && w.whatItDoes) return truncateSnippet(w.whatItDoes);
  return null;
}
function hasDetailFor(id) { return findAllByFeatureId(id).length > 0; }
function fullCatalogue(ctx) {
  const out = [];
  for (const f of (ctx.knowledgeIndexById ? ctx.knowledgeIndexById.values() : [])) if (f && f.id) out.push({ realId: f.id, matchType: 'catalogue' });
  for (const w of (ctx.workflowIndexById ? ctx.workflowIndexById.values() : [])) if (w && w.id) out.push({ realId: w.id, matchType: 'catalogue' });
  return out;
}

let _bm25Cache = null;
function bm25IndexFor(built) {
  if (!_bm25Cache || _bm25Cache.built !== built) _bm25Cache = { built, index: buildBm25Index(built) };
  return _bm25Cache.index;
}

const RRF_K = 60;
const LEX_WEIGHT = 3;
const BM25_WEIGHT = 1;
function rrfFuse(weightedLists) {
  const scoreById = new Map();
  for (const [list, weight] of weightedLists) {
    list.forEach((id, idx) => { scoreById.set(id, (scoreById.get(id) || 0) + weight / (RRF_K + idx + 1)); });
  }
  return [...scoreById.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en', { numeric: true })).map((e) => e[0]);
}

function deterministicCandidatesPR1(query, ctx, built) {
  const answer = answerQuestion(query, ctx);
  const lexIds = [];
  const seenLex = new Set();
  for (const c of [...(answer.matchedCapabilities || []), ...(answer.sources || [])]) {
    if (!c || !c.id || seenLex.has(c.id)) continue;
    if (c.entityType && c.entityType !== 'feature' && c.entityType !== 'workflow') continue;
    if (!/^AI-(FEAT|WF)-\d+$/.test(c.id)) continue;
    seenLex.add(c.id); lexIds.push(c.id);
  }
  const bm25Ids = bm25Rank(query, bm25IndexFor(built)).map((r) => r.id);
  const fused = rrfFuse([[lexIds, LEX_WEIGHT], [bm25Ids, BM25_WEIGHT]]);
  return fused.map((id) => ({ realId: id, matchType: lexIds.includes(id) ? 'lexical+bm25-fused' : 'bm25-only-fused' }));
}

async function searchAutoIngestPR1({ query }, ctx, built, handleSession) {
  const q = String(query || '').trim();
  if (!q) return { results: [], note: 'Empty query.' };

  let candidates = deterministicCandidatesPR1(q, ctx, built);
  let usedCatalogue = false;
  const isRepeatSearch = handleSession.noteSearchAndCheckRepeat(q);
  if (candidates.length < 2 || isRepeatSearch) {
    const already = new Set(candidates.map((c) => c.realId));
    const cat = fullCatalogue(ctx).filter((c) => !already.has(c.realId));
    candidates = [...candidates, ...cat];
    usedCatalogue = true;
  }

  const results = candidates.slice(0, usedCatalogue ? 80 : 12).map((c) => ({
    title: titleFor(c.realId, ctx),
    kind: c.realId.startsWith('AI-WF-') ? 'workflow' : 'feature',
    purpose: purposeFor(c.realId, ctx),
    hasDetail: hasDetailFor(c.realId),
    matchType: c.matchType,
    handle: handleSession.issue(c.realId),
  }));

  const note = !results.length
    ? 'No candidates found, even browsing the full AutoIngest subject list. This does not mean AutoIngest lacks the capability -- try search again with different, simpler wording, or ask the operator one clarifying question.'
    : usedCatalogue
      ? 'The normal search found few or no strong matches, so this is the FULL list of AutoIngest subjects (not ranked by relevance) so you can look for a plausible match yourself. Read titles and purposes carefully -- an unrelated subject appearing here is not evidence AutoIngest lacks the capability asked about. Prefer a candidate with hasDetail:true when more than one plausibly fits.'
      : 'Candidates ranked by fuzzy match, not verified relevance -- read each purpose and use your own judgment about whether it plausibly fits what the operator described. If none clearly fit, search again with different wording before concluding nothing exists. Prefer a candidate with hasDetail:true when more than one plausibly fits.';

  return { results, note };
}

function buildToolDefinitionsPR1(ctx, built, handleSession) {
  const defs = c14.buildToolDefinitions(ctx, built, handleSession);
  defs.search_autoingest = {
    ...defs.search_autoingest,
    handlerImpl: (params) => searchAutoIngestPR1(params, ctx, built, handleSession),
  };
  return defs;
}

module.exports = {
  HandleSession, readAutoIngest, capabilityStatus, roadmapStatus, checkRelationship,
  sanitizeTechnicalDetail, VALID_DIMENSIONS,
  searchAutoIngest: searchAutoIngestPR1,
  buildToolDefinitions: buildToolDefinitionsPR1,
};
