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
  // results: [{ gold: [...], detTop5: [...], semTop5: [...] }]
  // Strict ranked strategies (top1 is well-defined: index [0] of the
  // returned list).
  function calcRanked(getTop) {
    let top1 = 0, top3 = 0, top5 = 0, absent = 0;
    for (const r of results) {
      const top = getTop(r);
      if (r.gold.includes(top[0])) top1++;
      if (r.gold.some((g) => top.slice(0, 3).includes(g))) top3++;
      if (r.gold.some((g) => top.slice(0, 5).includes(g))) top5++;
      else absent++;
    }
    const n = results.length;
    return { n, top1Pct: (100 * top1 / n).toFixed(1), top3Pct: (100 * top3 / n).toFixed(1), top5Pct: (100 * top5 / n).toFixed(1), absentPct: (100 * absent / n).toFixed(1) };
  }
  // Union is a CANDIDATE POOL, not a ranked list — det's top-N and sem's
  // top-N are not merged/reordered by any rule, so "top1" has no
  // well-defined meaning for a pure union (reported as n/a, not silently
  // computed from concatenation order, which was a real bug in an earlier
  // version of this script — union[0] always equalled det[0], silently
  // degenerating "hybrid union" into deterministic-only). "top3"/"top5"
  // here mean "is gold recoverable within the union of det-top3+sem-top3
  // (pool of up to 6) / det-top5+sem-top5 (pool of up to 10)" — a fair
  // measurement of whether union-as-candidate-generation recovers the
  // record at all, which is what Section 8 actually asks this strategy to
  // measure (candidate generation, not final ranking).
  function calcUnionPool(nDet, nSem) {
    let n3 = 0, n5 = 0, absent = 0;
    for (const r of results) {
      const pool3 = new Set([...r.detTop5.slice(0, nDet), ...r.semTop5.slice(0, nSem)]);
      const pool5 = new Set([...r.detTop5, ...r.semTop5]);
      if (r.gold.some((g) => pool3.has(g))) n3++;
      if (r.gold.some((g) => pool5.has(g))) n5++;
      else absent++;
    }
    const n = results.length;
    return { n, top1Pct: 'n/a (unranked pool)', top3Pct: (100 * n3 / n).toFixed(1), top5Pct: (100 * n5 / n).toFixed(1), absentPct: (100 * absent / n).toFixed(1) };
  }
  return {
    deterministic: calcRanked((r) => r.detTop5),
    semantic: calcRanked((r) => r.semTop5),
    hybridUnion: calcUnionPool(3, 3),
    // Confidence/fallback hybrid (Section 8's actual definition):
    // deterministic remains authoritative when its own evidence is
    // strong; semantic is substituted (not merged) when deterministic is
    // weak/ambiguous/absent. A real, well-defined RANKED strategy, unlike
    // union above.
    hybridFallback: calcRanked((r) => (r.detStrong ? r.detTop5 : r.semTop5)),
  };
}

async function evalCorpus(corpus, qField, goldField, ctx, index, ec) {
  const results = [];
  for (const e of corpus) {
    if (e.goldLabel === 'SHOULD_WITHHOLD') continue;
    const gold = e[goldField];
    if (!gold || !gold.length) continue;
    const q = e[qField];
    const a = answerQuestion(q, ctx);
    const detTop5 = top5Ids(a);
    const detStrong = a.matchQuality === 'strong' && a.matchedCapabilities[0] && a.matchedCapabilities[0].score >= 500;
    const sem = await semanticTopK(q, index, ec, 5);
    const semTop5 = sem.map((s) => s.id);
    results.push({ id: e.id, q, gold, detTop5, semTop5, detStrong });
  }
  return results;
}

async function main() {
  const { built } = build.assemble();
  const ctx = buildEngineContext(built);
  ctx.recallSurfaceById = new Map(); // pure C6-committed deterministic baseline, C6.5 bypassed

  console.error('Loading embedding model...');
  const { ec } = await loadEmbeddingContext();
  console.error('Building semantic index...');
  const index = await buildSemanticIndex(built, ec);
  console.error(`Indexed ${index.chunks.length} chunks in ${index.indexingMs}ms`);

  const { SCORING_CORPUS_C63 } = require('./lib/scoringCompetitionCorpusC63');
  const { PARAPHRASE_CORPUS_C62 } = require('./lib/paraphraseDevCorpusC62');
  const { CORPUS_C6 } = require('./lib/retrievalEvalCorpusC6');

  for (const [name, corpus, qField, goldField] of [
    ['C6.1', CORPUS_C6, 'question', 'allowedMemberIds'],
    ['C6.2', PARAPHRASE_CORPUS_C62, 'question', 'allowedMemberIds'],
    ['C6.3', SCORING_CORPUS_C63, 'question', 'allowedMemberIds'],
  ]) {
    console.error(`Evaluating ${name}...`);
    const results = await evalCorpus(corpus, qField, goldField, ctx, index, ec);
    console.log(name, JSON.stringify(metrics(results)));
  }

  process.exit(0);
}
main().catch((e) => { console.error('FAILED', e); process.exit(1); });
