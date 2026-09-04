'use strict';
// Ask AutoIngest — Stage 2 deterministic knowledge/tool foundation,
// Section 15 (search_autoingest) + Section 18 (Stage-1 retrieval
// integration) + Section 19 (multi-query support).
//
// This is the first authorized production consumer of Stage 1's retrieval
// module (scripts/product-docs/lib/askRetrieval/) -- an INTERNAL library
// consumer only, per Section 18's own explicit boundary. Stage 1's own
// module, tests, and retrieval250 regression gate are untouched; this file
// only calls its public search()/buildRetrievalIndex() API.
//
// Section 3 audit finding, REIMPLEMENTED (not promoted) from the C9-C14
// prototypes: those checkpoints generated candidates via the C8 lexical
// scorer (answerQuestion()) unioned with lib/candidateRecall.js's
// admission channels. Stage 2 replaces that entire mechanism with Stage
// 1's own BM25+RRF search() -- Section 2 forbids reopening retrieval
// experimentation, and Stage 1's fused retrieval is the sanctioned
// replacement, not a second parallel mechanism layered on top of it. The
// OUTER result shape (title/kind/purpose/hasDetail/matchType/handle) is
// preserved from the prototype lineage, since that shape is a genuinely
// reusable, non-retrieval-specific convention.

const { findAllByFeatureId } = require('../knowledgeModel/index');
const { search } = require('../askRetrieval/retrieval');
const { resolveThenSanitize } = require('./leakBoundary');

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

// Prefers the Knowledge Model's own `purpose` dimension (richer, dimension-
// authored text) when a real detailed record exists; falls back to the
// docs-tooling summary/whatItDoes fields Stage 1's retrieval index itself
// was built from, so every candidate -- including one with no detailed KM
// record -- still gets a usable one-line description.
//
// Section 20 leak-boundary finding (caught by this module's own
// integration test): the docs-tooling summary/whatItDoes fallback text is
// written for developers and routinely cross-references other AI-FEAT-###
// ids inline (e.g. a Workflow's own summary citing "AI-FEAT-033's own
// canonical Summary") -- exactly the leak this tool surface must never
// expose. resolveThenSanitize runs on EVERY branch, including the
// Knowledge Model's own `purpose` field (KM authoring discipline makes a
// raw id leak there unlikely, but sanitizing unconditionally, not
// selectively, is the same "general fix, not per-field" rule read.js's own
// dimension loop already follows). Sanitized BEFORE truncation so a
// resolved title or a redaction marker is never itself cut mid-string.
function purposeFor(id, ctx) {
  const km = findAllByFeatureId(id);
  if (km.length && km[0].purpose) return truncateSnippet(resolveThenSanitize(km[0].purpose));
  const f = ctx.knowledgeIndexById && ctx.knowledgeIndexById.get(id);
  if (f && f.summary) return truncateSnippet(resolveThenSanitize(f.summary));
  const w = ctx.workflowIndexById && ctx.workflowIndexById.get(id);
  if (w && w.whatItDoes) return truncateSnippet(resolveThenSanitize(w.whatItDoes));
  return null;
}

function hasDetailFor(id) {
  return findAllByFeatureId(id).length > 0;
}

// Section 15's own explicit requirement: "return a COMPACT candidate set",
// never a full dump. Stage 1's search() itself returns every candidate
// with score>0 (by design -- it does not decide admission policy, callers
// do, per its own module boundary). This is Stage 2's own admission
// policy: the same order of magnitude the C9-C14 prototype lineage used
// for a normal (non-catalogue-fallback) search.
const MAX_RESULTS = 10;

// searchAutoIngest(query, ctx, built, retrievalIndex, handleSession, options)
//   query          - primary operator wording (required)
//   options.alternateQuery - optional second wording (Section 19), fused
//                    deterministically by Stage 1's own search(), never
//                    generated here (there is no LLM in this stage).
//
// Returns a compact candidate set: session handle (never a real internal
// id), title, kind, a short purpose, hasDetail (whether a detailed
// Knowledge Model record exists beyond the title/purpose), and matchType
// (diagnostic only). Never dumps a full record; never itself asserts a
// capability claim (that is capabilityStatus.js's own, separate job).
function searchAutoIngest(query, ctx, built, retrievalIndex, handleSession, options = {}) {
  const q = String(query || '').trim();
  if (!q) return { results: [], note: 'Empty query.' };

  const searchOptions = {};
  if (options.alternateQuery && String(options.alternateQuery).trim()) {
    searchOptions.alternateQuery = options.alternateQuery;
  }
  const result = search(built, ctx, retrievalIndex, q, searchOptions);
  const isRepeatSearch = handleSession.noteSearchAndCheckRepeat(q);
  const truncated = result.candidates.length > MAX_RESULTS;

  const results = result.candidates.slice(0, MAX_RESULTS).map((c) => ({
    title: titleFor(c.id, ctx),
    kind: c.kind,
    purpose: purposeFor(c.id, ctx),
    hasDetail: hasDetailFor(c.id),
    matchType: c.sourceChannels.length ? c.sourceChannels.join('+') : 'search',
    handle: handleSession.issue(c.id),
  }));

  const truncationNote = truncated ? ` (${result.candidates.length - MAX_RESULTS} lower-ranked candidate(s) omitted for compactness.)` : '';
  const note = !results.length
    ? 'No candidates found. This does not mean AutoIngest lacks the capability -- try again with different, simpler wording.'
    : isRepeatSearch
      ? `This is a repeat search with different wording in the same session -- if the results still don't look right, consider that the capability may genuinely not be documented under this description rather than continuing to rephrase indefinitely.${truncationNote}`
      : `Candidates ranked by relevance, not verified fit -- read each purpose and use your own judgment. Prefer a candidate with hasDetail:true when more than one plausibly fits.${truncationNote}`;

  return { results, note };
}

module.exports = { searchAutoIngest, titleFor, purposeFor, hasDetailFor };
