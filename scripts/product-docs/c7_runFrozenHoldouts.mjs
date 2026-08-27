import { loadEmbeddingContext, buildSemanticIndex, semanticTopK } from './c7_semanticPrototype.mjs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const build = require('./lib/build');
const { buildEngineContext, answerQuestion } = require('./lib/knowledgeEngine');

function top5Ids(answer) {
  const ids = [];
  for (const m of answer.matchedCapabilities || []) if (!ids.includes(m.id)) ids.push(m.id);
  for (const s of answer.sources || []) if (!ids.includes(s.id)) ids.push(s.id);
  return ids.slice(0, 5);
}

function metrics(results) {
  function calcRanked(getTop) {
    let top1 = 0, top3 = 0, top5 = 0;
    for (const r of results) {
      const top = getTop(r);
      if (r.gold.includes(top[0])) top1++;
      if (r.gold.some((g) => top.slice(0, 3).includes(g))) top3++;
      if (r.gold.some((g) => top.slice(0, 5).includes(g))) top5++;
    }
    const n = results.length;
    return { n, top1Pct: (100 * top1 / n).toFixed(1), top3Pct: (100 * top3 / n).toFixed(1), top5Pct: (100 * top5 / n).toFixed(1) };
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

async function evalHoldout(holdout, ctx, index, ec) {
  const results = [];
  for (const { q, gold } of holdout) {
    const a = answerQuestion(q, ctx);
    const detTop5 = top5Ids(a);
    const detStrong = a.matchQuality === 'strong' && a.matchedCapabilities[0] && a.matchedCapabilities[0].score >= 500;
    const sem = await semanticTopK(q, index, ec, 5);
    const semTop5 = sem.map((s) => s.id);
    results.push({ q, gold, detTop5, semTop5, detStrong });
  }
  return results;
}

async function main() {
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);
  ctx.recallSurfaceById = new Map();

  console.error('Loading embedding model + index...');
  const { ec } = await loadEmbeddingContext();
  const index = await buildSemanticIndex(built, ec);
  console.error(`Indexed ${index.chunks.length} chunks in ${index.indexingMs}ms`);

  const { BLIND_HOLDOUT_C64 } = require('/Users/funun_pa/.claude/jobs/6629ed37/tmp/c64_blind_holdout.js');
  const { BLIND_HOLDOUT_C65 } = require('/Users/funun_pa/.claude/jobs/6629ed37/tmp/c65_blind_holdout.js');

  console.error('Evaluating FROZEN C6.4 47q holdout (run once)...');
  const r64 = await evalHoldout(BLIND_HOLDOUT_C64, ctx, index, ec);
  console.log('C6.4-frozen-47q', JSON.stringify(metrics(r64)));

  console.error('Evaluating FROZEN C6.5 43q holdout (run once)...');
  const r65 = await evalHoldout(BLIND_HOLDOUT_C65, ctx, index, ec);
  console.log('C6.5-frozen-43q', JSON.stringify(metrics(r65)));

  process.exit(0);
}
main().catch((e) => { console.error('FAILED', e); process.exit(1); });
