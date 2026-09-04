'use strict';
// Ask AutoIngest — Stage 1 deterministic retrieval foundation, Section 14
// (thin-documentation backlog). Identifies canonical records whose
// retrieval-relevant text is genuinely too sparse for robust natural-
// language discovery -- NOT a documentation-content task (Section 14
// forbids manufacturing knowledge to improve recall), only a REPORTING
// task: list what's thin so it can be triaged later as a documentation-
// quality backlog, separate from a retrieval-engineering defect.
//
// FINDING (first pass, superseded): a naive low-token-count heuristic
// (<=10 unique BM25 document tokens) found ZERO records -- the corpus's
// minimum was 39 unique tokens (AI-FEAT-018), and several Planned/no-
// architecture-finalized roadmap stubs (e.g. AI-FEAT-053) actually carry
// substantial vision-narrative prose in their own `summary` field, so raw
// token count does not capture "thin" in Section 14's intended sense at
// all. Corrected approach: use the canonical `status`/`maturity` field
// (already part of the Knowledge Base schema, not inferred) to identify
// records the corpus itself marks Planned/not-yet-built, since Section 14
// explicitly calls out exactly this category ("no architecture, scope, or
// design finalized"), then report retrieval250's own measured performance
// for queries targeting each such record for real, not assumed, impact.
//
// Run with: node scripts/product-docs/bench/orchestrator/retrievalStage1ThinDocsBacklog.js
// Writes a JSON report to scripts/product-docs/bench/results/retrieval-stage1-thin-docs-backlog.json

const fs = require('fs');
const path = require('path');
const build = require('../../lib/build');
const { buildEngineContext } = require('../../lib/knowledgeEngine');
const { documentTextFor, buildBm25Index } = require('../../lib/askRetrieval/bm25Index');
const { normalizeQuery } = require('../../lib/askRetrieval/queryNormalization');
const { search, buildRetrievalIndex } = require('../../lib/askRetrieval/retrieval');
const retrieval250 = require('./retrieval250');

function main() {
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);
  const index = buildRetrievalIndex(built); // certified configuration
  const textById = documentTextFor(built);

  const plannedFeatures = built.featureIndex.filter((f) => f.status === 'Planned' || f.maturity === 'Planned');

  const backlog = plannedFeatures.map((f) => {
    const tokenCount = normalizeQuery(textById.get(f.feature_id) || '').length;
    const targetingQueries = retrieval250.filter((item) => item.style !== 'no-answer' && item.expect.includes(f.feature_id));
    let hits = 0;
    const misses = [];
    for (const item of targetingQueries) {
      const result = search(built, ctx, index, item.q);
      const ids = result.candidates.map((c) => c.id);
      const rank = ids.indexOf(f.feature_id) + 1;
      if (rank >= 1 && rank <= 5) hits++;
      else misses.push({ q: item.q, style: item.style, rank: rank > 0 ? rank : null });
    }
    return {
      id: f.feature_id,
      name: f.name,
      status: f.status,
      maturity: f.maturity,
      documentTokenCount: tokenCount,
      retrieval250QueriesTargetingThisRecord: targetingQueries.length,
      top5HitsAgainstThoseQueries: hits,
      top5MissesAgainstThoseQueries: misses,
    };
  });

  backlog.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));

  const report = {
    classificationBasis: 'Canonical `status`/`maturity === "Planned"` field on each Feature record, not an inferred token-count heuristic (see header comment for why the naive heuristic found nothing meaningful).',
    plannedRecordCount: backlog.length,
    records: backlog,
    disposition: 'REPORTING ONLY. Per Section 14, retrieval text is not manufactured or expanded for any of these records during Stage 1. Each entry is a documentation-quality backlog candidate, to be triaged separately (and only acted on if an independently verified canonical documentation defect is found) -- never edited merely to improve a benchmark score. A record with zero retrieval250-targeting queries and/or zero misses is not evidence of a retrieval problem; it is included for completeness of the Planned-status inventory.',
  };

  const outPath = path.join(__dirname, '..', 'results', 'retrieval-stage1-thin-docs-backlog.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

  console.log(`Planned-status records: ${report.plannedRecordCount}`);
  for (const r of backlog) {
    console.log(`  ${r.id} ${r.name} — ${r.documentTokenCount} tokens, ${r.top5HitsAgainstThoseQueries}/${r.retrieval250QueriesTargetingThisRecord} top-5 hits`);
  }
  console.log(`\nWritten to ${outPath}`);
}

main();
