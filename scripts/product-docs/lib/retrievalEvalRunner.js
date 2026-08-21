'use strict';

// Phase C6 — retrieval-quality metrics runner for lib/retrievalEvalCorpusC6.js.
// Deliberately separate from lib/knowledgeEval.js (which already owns the
// V1/V2/V3 pass/fail evaluators and their own gap-report/baseline outputs —
// untouched by this file). This module answers a narrower question than
// those: not "did the full answer meet every declared expectation" but
// "did retrieval select the right primary record," with the metric set
// Section U of the C6 checkpoint brief requires (Top-1, Top-3, wrong-
// primary rate, confusable-pair/exact-title/paraphrase/question-type
// breakdowns, HIGH-confidence accuracy, dev-vs-holdout). No answerQuestion()
// logic is reimplemented here — every metric is computed by observing the
// real, unmodified answer object.

const { answerQuestion } = require('./knowledgeEngine');

function primaryIdOf(answer) {
  if (answer.sources && answer.sources.length) return answer.sources[0].id;
  if (answer.matchedCapabilities && answer.matchedCapabilities.length) return answer.matchedCapabilities[0].id;
  return null;
}

function top3Ids(answer) {
  const ids = [];
  for (const m of answer.matchedCapabilities || []) if (!ids.includes(m.id)) ids.push(m.id);
  for (const s of answer.sources || []) if (!ids.includes(s.id)) ids.push(s.id);
  return ids.slice(0, 3);
}

// "Withheld" in this engine's own vocabulary: matchQuality 'none' (honest
// zero-match decline) or a curated 'boundary' decline (NOT_SUPPORTED), or
// capabilityStatus UNKNOWN. Reused, not reimplemented, from the real answer
// object's own fields.
function isWithheld(answer) {
  return answer.matchQuality === 'none' || answer.capabilityStatus === 'UNKNOWN' || (answer.matchQuality === 'boundary' && answer.capabilityStatus === 'NOT_SUPPORTED');
}

// "High confidence" reuses the engine's own matchQuality vocabulary
// (strong/boundary) rather than inventing a new numeric threshold — see
// this file's header. Never a second confidence scale.
function isHighConfidence(answer) {
  return answer.matchQuality === 'strong' || answer.matchQuality === 'boundary';
}

function questionMentionsExactTitle(question, allowedMemberIds, ctx) {
  if (!allowedMemberIds || !allowedMemberIds.length) return false;
  const q = String(question).toLowerCase();
  for (const id of allowedMemberIds) {
    const rec = ctx.searchIndexById ? ctx.searchIndexById.get(id) : ctx.searchIndex.find((r) => r.stable_id === id);
    if (!rec) continue;
    const phrases = [rec.title, ...(rec.aliases || [])].filter((p) => p && p.length >= 4);
    for (const p of phrases) {
      const re = new RegExp(`(^|[^a-z0-9])${p.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`, 'i');
      if (re.test(q)) return true;
    }
  }
  return false;
}

function evaluateEntry(entry, ctx) {
  const t0 = process.hrtime.bigint();
  const answer = answerQuestion(entry.question, ctx);
  const t1 = process.hrtime.bigint();
  const latencyMs = Number(t1 - t0) / 1e6;

  const primaryId = primaryIdOf(answer);
  const top3 = top3Ids(answer);

  let correct;
  if (entry.goldLabel === 'SHOULD_WITHHOLD') {
    correct = isWithheld(answer);
  } else if (entry.goldLabel === 'NO_SINGLE_PRIMARY') {
    correct = !!(entry.allowedMemberIds && entry.allowedMemberIds.includes(primaryId));
  } else {
    correct = !!(entry.allowedMemberIds && entry.allowedMemberIds.includes(primaryId));
  }
  const forbiddenHit = !!(entry.forbiddenMemberIds && entry.forbiddenMemberIds.includes(primaryId));
  if (forbiddenHit) correct = false;

  const top3Hit = entry.goldLabel === 'SHOULD_WITHHOLD'
    ? isWithheld(answer)
    : !!(entry.allowedMemberIds && entry.allowedMemberIds.some((id) => top3.includes(id)));

  const exactTitleMentioned = questionMentionsExactTitle(entry.question, entry.allowedMemberIds, ctx);

  return {
    id: entry.id, split: entry.split, category: entry.category, question: entry.question,
    goldLabel: entry.goldLabel, allowedMemberIds: entry.allowedMemberIds || null, forbiddenMemberIds: entry.forbiddenMemberIds || null,
    primaryId, top3, correct, top3Hit, forbiddenHit,
    exactTitleMentioned,
    matchQuality: answer.matchQuality, capabilityStatus: answer.capabilityStatus, confidence: answer.confidence,
    highConfidence: isHighConfidence(answer),
    withheld: isWithheld(answer),
    latencyMs,
  };
}

function pct(numerator, denominator) {
  return denominator === 0 ? null : Math.round((1000 * numerator) / denominator) / 10;
}

function summarizeGroup(results) {
  const n = results.length;
  return { n, top1: pct(results.filter((r) => r.correct).length, n), top3: pct(results.filter((r) => r.top3Hit).length, n) };
}

function runRetrievalEval(corpus, ctx) {
  const results = corpus.map((e) => evaluateEntry(e, ctx));

  const dev = results.filter((r) => r.split === 'dev');
  const holdout = results.filter((r) => r.split === 'holdout');
  const confusable = results.filter((r) => r.id.startsWith('C6-CONF-'));
  const exactTitle = results.filter((r) => r.exactTitleMentioned);
  const paraphrase = results.filter((r) => r.id.startsWith('C6-PARA-'));
  const highConf = results.filter((r) => r.highConfidence);
  const wrongPrimary = results.filter((r) => !r.correct && r.goldLabel !== 'SHOULD_WITHHOLD' && r.goldLabel !== 'NO_SINGLE_PRIMARY');
  const wrongPrimaryAmbiguousToo = results.filter((r) => !r.correct);

  const byCategory = {};
  for (const cat of ['HOW_TO', 'EXPLANATION', 'TROUBLESHOOTING', 'CAPABILITY', 'STATUS', 'WORKFLOW', 'NAVIGATION', 'COMPARISON', 'AMBIGUOUS', 'SHORT', 'LONG', 'ROADMAP']) {
    const g = results.filter((r) => r.category === cat);
    if (g.length) byCategory[cat] = summarizeGroup(g);
  }

  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const median = latencies[Math.floor(latencies.length / 2)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  const worst = latencies[latencies.length - 1];

  return {
    total: results.length,
    overall: summarizeGroup(results),
    dev: summarizeGroup(dev),
    holdout: summarizeGroup(holdout),
    confusablePair: summarizeGroup(confusable),
    exactTitleMentioned: summarizeGroup(exactTitle),
    paraphrase: summarizeGroup(paraphrase),
    highConfidence: { n: highConf.length, accuracy: pct(highConf.filter((r) => r.correct).length, highConf.length) },
    wrongPrimaryRate: pct(wrongPrimary.length, results.filter((r) => r.goldLabel !== 'SHOULD_WITHHOLD' && r.goldLabel !== 'NO_SINGLE_PRIMARY').length),
    wrongPrimaryCount: wrongPrimaryAmbiguousToo.length,
    byCategory,
    latency: { medianMs: Math.round(median * 100) / 100, p95Ms: Math.round(p95 * 100) / 100, worstMs: Math.round(worst * 100) / 100 },
    results,
  };
}

module.exports = { runRetrievalEval, evaluateEntry, primaryIdOf, top3Ids, isWithheld, isHighConfidence };
