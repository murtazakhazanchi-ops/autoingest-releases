'use strict';
// Ask AutoIngest — Stage 1 deterministic retrieval foundation, Section 19.
// Scores the frozen, independent retrievalHoldout100.js benchmark against
// the CERTIFIED production configuration (buildRetrievalIndex(built),
// i.e. WITHOUT Section 13 decision-text enrichment -- the same
// configuration retrieval250Gate.test.js holds to its hard floor) exactly
// once. Per Section 19's own explicit instruction, this benchmark is not
// tuned afterward regardless of the result.
//
// Run with: node scripts/product-docs/bench/orchestrator/retrievalHoldout100Score.js
// Writes scripts/product-docs/bench/results/retrieval-stage1-holdout100.json

const fs = require('fs');
const path = require('path');
const build = require('../../lib/build');
const { buildEngineContext } = require('../../lib/knowledgeEngine');
const { search, buildRetrievalIndex } = require('../../lib/askRetrieval/retrieval');
const holdout = require('./retrievalHoldout100');

function normalizeForTitleCheck(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function containsTitle(query, title) {
  const q = normalizeForTitleCheck(query);
  const t = normalizeForTitleCheck(title);
  if (!t) return false;
  return q.includes(t);
}

function titleFor(id, built) {
  const f = built.featureIndex.find((x) => x.feature_id === id);
  if (f) return f.name;
  const w = built.workflowIndex.find((x) => x.id === id);
  if (w) return w.title;
  return id;
}

function main() {
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);
  const index = buildRetrievalIndex(built); // certified configuration, no decision-text enrichment

  const scored = holdout.filter((h) => h.style !== 'no-answer');
  const noAnswerQueries = holdout.filter((h) => h.style === 'no-answer');

  let top1 = 0, top3 = 0, top5 = 0, top10 = 0, mrrSum = 0;
  const failures = [];
  const withoutTitleCount = { total: 0, hitTop5: 0 };

  for (const item of scored) {
    const result = search(built, ctx, index, item.q);
    const ids = result.candidates.map((c) => c.id);
    let rank = -1;
    for (let i = 0; i < ids.length; i++) {
      if (item.expect.includes(ids[i])) { rank = i + 1; break; }
    }
    const title = titleFor(item.expect[0], built);
    const hasTitle = containsTitle(item.q, title);
    if (!hasTitle) {
      withoutTitleCount.total++;
      if (rank >= 1 && rank <= 5) withoutTitleCount.hitTop5++;
    }
    if (rank === 1) top1++;
    if (rank >= 1 && rank <= 3) top3++;
    if (rank >= 1 && rank <= 5) top5++;
    if (rank >= 1 && rank <= 10) top10++;
    if (rank > 0) mrrSum += 1 / rank;
    else {
      failures.push({
        id: item.id, q: item.q, style: item.style, expect: item.expect,
        top5Returned: ids.slice(0, 5), containsTitle: hasTitle,
      });
    }
  }

  // No-answer population: report how many candidates came back and
  // whether the true correct behavior (retrieval CAN return candidates;
  // it is not required to return zero -- Section 15's own finding) held.
  const noAnswerResults = noAnswerQueries.map((item) => {
    const result = search(built, ctx, index, item.q);
    return { id: item.id, q: item.q, candidateCount: result.candidates.length, top3: result.candidates.slice(0, 3).map((c) => c.id) };
  });

  const failuresByStyle = {};
  for (const f of failures) failuresByStyle[f.style] = (failuresByStyle[f.style] || 0) + 1;

  const report = {
    configuration: 'certified (no decision-text enrichment) -- same as retrieval250Gate.test.js',
    n: scored.length,
    top1Pct: +(100 * top1 / scored.length).toFixed(1),
    top3Pct: +(100 * top3 / scored.length).toFixed(1),
    top5Pct: +(100 * top5 / scored.length).toFixed(1),
    top10Pct: +(100 * top10 / scored.length).toFixed(1),
    mrr: +(mrrSum / scored.length).toFixed(3),
    coverageVerification: {
      totalQueries: holdout.length,
      scoredQueries: scored.length,
      noAnswerQueries: noAnswerQueries.length,
      withoutCanonicalTitlePct: +(100 * withoutTitleCount.total / scored.length).toFixed(1),
      withoutCanonicalTitleTop5HitRatePct: withoutTitleCount.total ? +(100 * withoutTitleCount.hitTop5 / withoutTitleCount.total).toFixed(1) : null,
      paraphraseOrIndirectPct: +(100 * scored.filter((s) => s.style === 'paraphrase' || s.style === 'indirect').length / scored.length).toFixed(1),
      crossFeaturePct: +(100 * scored.filter((s) => s.style === 'cross-feature').length / scored.length).toFixed(1),
      thinRoadmapPct: +(100 * scored.filter((s) => s.style === 'thin').length / scored.length).toFixed(1),
      distinctRecordsCovered: new Set(scored.flatMap((s) => s.expect)).size,
    },
    failureTaxonomy: {
      totalFailures: failures.length,
      failuresByStyle,
      failures,
    },
    noAnswerBehavior: noAnswerResults,
    runPolicy: 'Run ONCE per Section 19. This benchmark and its scoring configuration are not tuned in response to this result.',
  };

  const outPath = path.join(__dirname, '..', 'results', 'retrieval-stage1-holdout100.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

  console.log(`Holdout100 (n=${report.n}): Top-1=${report.top1Pct}% Top-3=${report.top3Pct}% Top-5=${report.top5Pct}% Top-10=${report.top10Pct}% MRR=${report.mrr}`);
  console.log(`Coverage: withoutTitle=${report.coverageVerification.withoutCanonicalTitlePct}% paraphrase/indirect=${report.coverageVerification.paraphraseOrIndirectPct}% cross-feature=${report.coverageVerification.crossFeaturePct}% thin=${report.coverageVerification.thinRoadmapPct}% records=${report.coverageVerification.distinctRecordsCovered}`);
  console.log(`Failures: ${failures.length} (${JSON.stringify(failuresByStyle)})`);
  console.log(`\nWritten to ${outPath}`);
}

main();
