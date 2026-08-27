import { loadEmbeddingContext, buildSemanticIndex, semanticTopK } from './c7_semanticPrototype.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const build = require('./lib/build');
const { buildEngineContext, answerQuestion, classifyQuestion, QUESTION_TYPES } = require('./lib/knowledgeEngine');

function top5Ids(answer) {
  const ids = [];
  for (const m of answer.matchedCapabilities || []) if (!ids.includes(m.id)) ids.push(m.id);
  for (const s of answer.sources || []) if (!ids.includes(s.id)) ids.push(s.id);
  return ids.slice(0, 5);
}

function metrics(results) {
  function calcRanked(getTop) {
    let top1 = 0, top3 = 0, top5 = 0;
    let rrSum = 0;
    for (const r of results) {
      const top = getTop(r);
      if (r.gold.includes(top[0])) top1++;
      if (r.gold.some((g) => top.slice(0, 3).includes(g))) top3++;
      if (r.gold.some((g) => top.slice(0, 5).includes(g))) top5++;
      const rank = top.findIndex((id) => r.gold.includes(id));
      if (rank >= 0) rrSum += 1 / (rank + 1);
    }
    const n = results.length;
    return { n, top1Pct: (100 * top1 / n).toFixed(1), top3Pct: (100 * top3 / n).toFixed(1), top5Pct: (100 * top5 / n).toFixed(1), mrr: (rrSum / n).toFixed(3) };
  }
  function calcUnionPool() {
    let n3 = 0, n5 = 0;
    for (const r of results) {
      const pool3 = new Set([...r.detTop5.slice(0, 3), ...r.semTop5.slice(0, 3)]);
      const pool5 = new Set([...r.detTop5, ...r.semTop5]);
      if (r.gold.some((g) => pool3.has(g))) n3++;
      if (r.gold.some((g) => pool5.has(g))) n5++;
    }
    const n = results.length;
    return { n, top1Pct: 'n/a', top3Pct: (100 * n3 / n).toFixed(1), top5Pct: (100 * n5 / n).toFixed(1) };
  }
  return {
    deterministic: calcRanked((r) => r.detTop5),
    semantic: calcRanked((r) => r.semTop5),
    hybridUnion: calcUnionPool(),
    hybridFallback: calcRanked((r) => (r.detStrong ? r.detTop5 : r.semTop5)),
  };
}

async function main() {
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);
  ctx.recallSurfaceById = new Map();

  console.error('Loading embedding model + index...');
  const { ec } = await loadEmbeddingContext();
  const index = await buildSemanticIndex(built, ec);
  console.error(`Indexed ${index.chunks.length} chunks in ${index.indexingMs}ms`);

  const { BLIND_HOLDOUT_C7 } = require('/Users/funun_pa/.claude/jobs/6629ed37/tmp/c7_blind_holdout.js');
  console.error(`Evaluating NEW C7 blind holdout (${BLIND_HOLDOUT_C7.length}q, run once)...`);

  const results = [];
  const rows = [];
  const latencies = [];
  for (const { q, gold } of BLIND_HOLDOUT_C7) {
    const t0 = Date.now();
    const a = answerQuestion(q, ctx);
    const detTop5 = top5Ids(a);
    const detStrong = a.matchQuality === 'strong' && a.matchedCapabilities[0] && a.matchedCapabilities[0].score >= 500;
    const sem = await semanticTopK(q, index, ec, 5);
    const semTop5 = sem.map((s) => s.id);
    const t1 = Date.now();
    latencies.push(t1 - t0);
    const unionPool = new Set([...detTop5, ...semTop5]);
    const hitUnion = gold.some((g) => unionPool.has(g));
    results.push({ q, gold, detTop5, semTop5, detStrong });
    rows.push({ q, gold, detTop5, semTop5, hitUnion, cls: classifyQuestion(q) });
  }

  console.log('=== per-question (union hit/miss) ===');
  for (const r of rows) {
    console.log((r.hitUnion ? 'HIT ' : 'MISS'), '|', JSON.stringify(r.q), '| gold=' + JSON.stringify(r.gold), '| det=' + JSON.stringify(r.detTop5), '| sem=' + JSON.stringify(r.semTop5));
  }

  console.log('\n=== METRICS ===');
  console.log('C7-blind-52q', JSON.stringify(metrics(results), null, 2));

  latencies.sort((a, b) => a - b);
  console.log('latency median=', latencies[Math.floor(latencies.length / 2)], 'ms p95=', latencies[Math.floor(latencies.length * 0.95)], 'ms worst=', latencies[latencies.length - 1], 'ms');

  process.exit(0);
}
main().catch((e) => { console.error('FAILED', e); process.exit(1); });
