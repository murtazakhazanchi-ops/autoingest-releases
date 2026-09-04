'use strict';
// Ask AutoIngest — Stage 1 deterministic retrieval foundation, Section 15
// (no-result behavior / score-distribution analysis). Measures the fused
// RRF score of the TOP candidate for three query populations drawn from
// retrieval250: (a) queries where the top candidate is actually correct,
// (b) queries where retrieval returns candidates but the top one is wrong
// (a real miss, not "no answer"), and (c) retrieval250's own deliberate
// no-answer/unknown-capability queries (style === 'no-answer'). Reports
// whether a stable score threshold could plausibly separate these
// populations -- per Section 15, this is investigation only; Stage 1 does
// NOT implement a threshold unless the evidence clearly supports one.
//
// Run with: node scripts/product-docs/bench/orchestrator/retrievalStage1NoResultAnalysis.js
// Writes a JSON report to scripts/product-docs/bench/results/retrieval-stage1-no-result-analysis.json

const fs = require('fs');
const path = require('path');
const build = require('../../lib/build');
const { buildEngineContext } = require('../../lib/knowledgeEngine');
const { buildRetrievalIndex, lexicalChannel, bm25Channel } = require('../../lib/askRetrieval/retrieval');
const { reciprocalRankFusionScored } = require('../../lib/askRetrieval/fusion');
const retrieval250 = require('./retrieval250');

const RRF_K = 60;
const LEXICAL_CHANNEL_WEIGHT = 3;
const BM25_CHANNEL_WEIGHT = 1;

function topFusedScore(query, built, ctx, index) {
  const lex = lexicalChannel(query, ctx);
  const bm25 = bm25Channel(query, index);
  const scored = reciprocalRankFusionScored([[lex, LEXICAL_CHANNEL_WEIGHT], [bm25, BM25_CHANNEL_WEIGHT]], RRF_K);
  return { topId: scored.length ? scored[0].id : null, topScore: scored.length ? scored[0].score : 0, all: scored };
}

function stats(arr) {
  if (!arr.length) return { n: 0, min: null, max: null, mean: null, median: null };
  const sorted = [...arr].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  return { n: sorted.length, min: +sorted[0].toFixed(5), max: +sorted[sorted.length - 1].toFixed(5), mean: +mean.toFixed(5), median: +median.toFixed(5) };
}

function main() {
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);
  const index = buildRetrievalIndex(built); // certified (no decision-text) configuration

  const correctTop = [];
  const wrongTop = [];
  const noAnswer = [];

  for (const item of retrieval250) {
    const { topId, topScore } = topFusedScore(item.q, built, ctx, index);
    if (item.style === 'no-answer') {
      noAnswer.push(topScore);
      continue;
    }
    if (topId && item.expect.includes(topId)) correctTop.push(topScore);
    else wrongTop.push(topScore);
  }

  const report = {
    populations: {
      correctTop1: stats(correctTop),
      wrongTop1: stats(wrongTop),
      deliberateNoAnswer: stats(noAnswer),
    },
    overlapAnalysis: null,
    conclusion: null,
  };

  // Overlap check: does the deliberate-no-answer population's score range
  // overlap the correct-top-1 population's score range? If yes, no single
  // threshold can cleanly separate "confidently correct" from "should not
  // have answered" without also rejecting genuine correct answers (or
  // admitting no-answer queries) -- the central empirical question
  // Section 15 asks to be investigated honestly.
  const c = report.populations.correctTop1;
  const w = report.populations.wrongTop1;
  const n = report.populations.deliberateNoAnswer;
  const overlapsCorrectVsNoAnswer = n.max !== null && c.min !== null && n.max >= c.min;
  const overlapsWrongVsCorrect = w.max !== null && c.min !== null && w.max >= c.min;

  report.overlapAnalysis = {
    deliberateNoAnswer_maxScore: n.max,
    correctTop1_minScore: c.min,
    wrongTop1_maxScore: w.max,
    noAnswerScoreRangeOverlapsCorrectScoreRange: overlapsCorrectVsNoAnswer,
    wrongTop1ScoreRangeOverlapsCorrectScoreRange: overlapsWrongVsCorrect,
  };

  report.conclusion = overlapsCorrectVsNoAnswer || overlapsWrongVsCorrect
    ? 'No stable deterministic confidence threshold is supported by this evidence: the deliberate-no-answer and/or wrong-top-1 score ranges overlap the correct-top-1 score range, so any single cutoff would either reject genuine correct answers or admit no-answer/wrong candidates. Per Section 15, no threshold is implemented in Stage 1 -- a later Qwen/tool layer should inspect weak candidates itself rather than retrieval self-censoring on a score alone.'
    : 'Score ranges are cleanly separated in this sample -- a threshold MAY be viable, but Section 15 requires this not be implemented in Stage 1 without further evidence beyond a single benchmark run; deferred to a future stage if pursued at all.';

  const outPath = path.join(__dirname, '..', 'results', 'retrieval-stage1-no-result-analysis.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n');

  console.log(JSON.stringify(report, null, 2));
  console.log(`\nWritten to ${outPath}`);
}

main();
