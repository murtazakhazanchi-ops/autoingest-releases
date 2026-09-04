'use strict';
// Ask AutoIngest — Stage 2 deterministic knowledge/tool foundation, Section
// 6(A): Decision records as AUTHORITATIVE PRODUCT KNOWLEDGE. Productionized,
// unchanged in design, from Checkpoint 14 Phase 4's `decisionFactsFor`.
//
// Deliberately separate from Stage 1's Decision-text enrichment (Section
// 6(B): "Decision text as retrieval-surface enrichment", an optional BM25
// document-text fold-in evaluated in DEC-022) -- these are genuinely
// different concepts per the Stage 2 brief's own framing. This module
// answers "what does AutoIngest's knowledge say a Decision establishes
// about a feature, once that feature has already been selected" -- it
// never influences which candidates search_autoingest returns.
//
// For ANY feature being read, ctx.authorityIndexByFeatureId's own
// relatedDecisions field (the feature's OWN forward citation of its
// decisions -- the project's documented cross-linking authority direction,
// docs/product/CLAUDE.md § 7) names zero or more real Decision ids. Each
// resolves via ctx.searchIndexById to that decision's own `detail` text
// (the Decision/Consequences content, not `summary`, which is only the
// Context/problem statement). Folded into read.js's `limitations`
// dimension (a decision that constrains a feature's behavior is naturally
// a limitation on it) with the same resolve-then-sanitize treatment as
// every other operator-facing dimension -- never a raw id, only a resolved
// title where one exists, never invented content beyond the decision
// record's own text.

const { resolveThenSanitize } = require('./leakBoundary');

function decisionFactsFor(featureId, ctx) {
  if (!ctx || !ctx.authorityIndexByFeatureId || !ctx.searchIndexById) return [];
  const entry = ctx.authorityIndexByFeatureId.get(featureId);
  if (!entry || !entry.relatedDecisions || !entry.relatedDecisions.length) return [];
  const out = [];
  for (const decId of entry.relatedDecisions) {
    const dec = ctx.searchIndexById.get(decId);
    if (!dec || dec.entity_type !== 'decision') continue;
    const text = dec.detail || dec.summary;
    if (!text) continue;
    out.push(`Documented design decision: ${resolveThenSanitize(text)}`);
  }
  return out;
}

module.exports = { decisionFactsFor };
