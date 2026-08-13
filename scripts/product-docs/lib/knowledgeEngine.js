'use strict';

// Stage 1 Knowledge Engine — grounded answer builder. Reuses lib/query.js's
// existing deterministic ranker unchanged (no second search implementation
// — see scripts/product-docs/README.md "Query ranking"). Turns a ranked
// match plus its docs/product/generated/knowledge-index.json record into
// the structured answer shape Stage 1's brief specifies. Never invents UI
// navigation, never invents steps, never upgrades Planned to Available.
//
// Architecture note (Phase 13 of the Stage 1 brief): this module is the
// ONLY place that turns retrieval + evidence into operator-facing text. A
// future conversational/LLM layer should call this module for its grounded
// facts and never re-implement retrieval or status resolution — see
// docs/product/features/AI-FEAT-058_*.md § Architectural Review.

const { runQuery } = require('./query');
const { RECORD_STATUS, QUERY_STATUS, matchKnownBoundary } = require('./statusResolution');

// Below this score, a match is not confident enough to answer from — see
// scripts/product-docs/README.md's ranking table: 100 is the minimum score
// a real keyword-token overlap produces; a bare summary-substring hit (10)
// is treated as too weak to found an answer on.
const CONFIDENCE_FLOOR = 100;
const MAX_MATCHES = 5;

function classifyIntent(question) {
  const q = String(question || '').trim().toLowerCase();
  if (/^(what is|what's|what are|whats)\b/.test(q)) return 'definition';
  if (/^(how do i|how to|how can i|how does)\b/.test(q)) return 'howto';
  if (/\b(coming next|what's next|whats next|roadmap|planned next)\b/.test(q)) return 'roadmap';
  if (/^(can i|can autoingest|does autoingest|is there|will autoingest)\b/.test(q)) return 'capability-check';
  return 'general';
}

function sourcesForRecord(knowledgeRecord) {
  const sources = [{ id: knowledgeRecord.id, title: knowledgeRecord.title, path: knowledgeRecord.sourceFiles[0] || null }];
  for (const rel of knowledgeRecord.roadmapRelationship) {
    sources.push({ id: rel.roadmapId, title: `Roadmap milestone ${rel.roadmapId} (${rel.status})`, path: 'docs/product/02_MASTER_ROADMAP.md' });
  }
  for (const bug of knowledgeRecord.knownLimitations.openBugs) {
    sources.push({ id: bug.id, title: `${bug.id} (${bug.status})`, path: 'docs/product/bugs/' });
  }
  return sources;
}

function limitationsForRecord(knowledgeRecord) {
  const limitations = [];
  for (const bug of knowledgeRecord.knownLimitations.openBugs) {
    if (!/^(Fixed|Resolved|Closed)\b/i.test(bug.status)) {
      limitations.push(`Known issue ${bug.id} is not yet marked Fixed (current status: ${bug.status}).`);
    }
  }
  if (knowledgeRecord.knownLimitations.evidenceGapCount > 0) {
    limitations.push(`This capability's own documentation has ${knowledgeRecord.knownLimitations.evidenceGapCount} unresolved evidence gap(s) — some detail may be incomplete.`);
  }
  if (knowledgeRecord.knownLimitations.futureEnhancements) {
    limitations.push(`Documented future enhancement: ${knowledgeRecord.knownLimitations.futureEnhancements}`);
  }
  return limitations;
}

// A score of 500+ means lib/query.js's ranker found an exact-ID/alias/title
// match or a real title-substring hit — strong topical evidence on its own.
// A bare score of exactly 100 means exactly one generic keyword-token
// overlap — evidence the record merely SHARES A WORD with the question, not
// that it answers it. A tied top score (more than one record at the same
// score) is ambiguous regardless of how high that score is. Found during
// Stage 1's own Phase 8 adversarial testing: "Can I delete an event?"
// keyword-matches AI-FEAT-004/009/010 (all merely share the token "event")
// and the ascending-ID tiebreak silently picks whichever sorts first — none
// of which actually documents deletion. Rather than change the shared
// ranker (would affect query/impact/context too) or silently accept a
// misleadingly confident answer, a "weak" match is surfaced with an
// explicit hedge instead of asserted as the answer. A genuine, unambiguous
// multi-keyword match (e.g. score 200, not tied with anything else) is
// treated as strong — it is real, specific evidence, not a coincidence.
const STRONG_MATCH_FLOOR = 500;
const WEAK_SCORE_CEILING = 100;

function matchQualityFor(topScore, tiedCount) {
  if (topScore >= STRONG_MATCH_FLOOR) return 'strong';
  if (topScore <= WEAK_SCORE_CEILING || tiedCount > 1) return 'weak';
  return 'strong';
}

function answerFromRecord(question, knowledgeRecord, matches) {
  const status = knowledgeRecord.operatorStatus;
  const tiedCount = matches.filter((m) => m.score === matches[0].score).length;
  const quality = matchQualityFor(matches[0].score, tiedCount);
  let directAnswer;
  let guidance = null;

  if (status === RECORD_STATUS.PLANNED) {
    directAnswer = `${knowledgeRecord.title} is planned for AutoIngest but not yet implemented. ${knowledgeRecord.summary}`.trim();
    // Never state or imply steps for a Planned capability — there is
    // nothing to instruct an operator to do yet.
  } else {
    const hedge = quality === 'weak'
      ? (tiedCount > 1
        ? `Several AutoIngest capabilities loosely match this question; the closest is "${knowledgeRecord.title}", but this may not directly answer what you asked. `
        : `Closest documented match (this may not directly answer your question): `)
      : '';
    directAnswer = `${hedge}AutoIngest supports this: ${knowledgeRecord.summary}`.trim();
    // Stage 1 has no Workflow/Navigation record type yet (deliberately
    // deferred — see AI-FEAT-058's Summary). This fallback sentence is the
    // brief's own explicitly-endorsed honest Stage 1 answer, not a
    // placeholder to be "improved" by inventing plausible-sounding steps.
    guidance = 'AutoIngest supports this capability, but detailed operator instructions are not yet documented.';
  }

  return {
    query: question,
    classification: classifyIntent(question),
    directAnswer,
    capabilityStatus: status,
    matchQuality: quality,
    matchedCapabilities: matches,
    guidance,
    limitations: limitationsForRecord(knowledgeRecord),
    relatedCapabilities: knowledgeRecord.relatedFeatures,
    sources: sourcesForRecord(knowledgeRecord),
    confidence: quality === 'weak' ? Math.min(0.4, matches[0].score / 1000) : Math.min(1, matches[0].score / 1000),
  };
}

function boundaryAnswer(question, boundary, matches) {
  return {
    query: question,
    classification: classifyIntent(question),
    directAnswer: boundary.statement,
    capabilityStatus: QUERY_STATUS.NOT_SUPPORTED,
    matchQuality: 'boundary',
    matchedCapabilities: matches,
    guidance: null,
    limitations: [],
    relatedCapabilities: [],
    sources: [{ id: boundary.id, title: 'Documented boundary (curated, evidence-cited — see lib/statusResolution.js)', path: null, note: boundary.citation }],
    confidence: 1,
  };
}

function unknownAnswer(question, matches) {
  return {
    query: question,
    classification: classifyIntent(question),
    directAnswer: 'AutoIngest\'s documentation does not have enough evidence to answer this confidently. This is reported honestly rather than guessed.',
    capabilityStatus: QUERY_STATUS.UNKNOWN,
    matchQuality: 'none',
    matchedCapabilities: matches,
    guidance: null,
    limitations: [],
    relatedCapabilities: [],
    sources: [],
    confidence: 0,
  };
}

// { searchIndex, knowledgeIndexById } — a Map<featureId, knowledgeRecord>,
// built by the caller from docs/product/generated/knowledge-index.json (or
// the in-memory `built.knowledgeIndex` during `build`/tests).
function answerQuestion(question, { searchIndex, knowledgeIndexById }) {
  const results = runQuery(question, searchIndex, { limit: 20 });
  const featureMatches = results
    .filter((r) => r.record.entity_type === 'feature')
    .slice(0, MAX_MATCHES)
    .map((r) => ({ id: r.record.stable_id, title: r.record.title, score: r.score }));

  const top = featureMatches[0];
  const topTiedCount = top ? featureMatches.filter((m) => m.score === top.score).length : 0;
  const hasStrongMatch = !!top && matchQualityFor(top.score, topTiedCount) === 'strong';
  const boundary = matchKnownBoundary(question);

  // The curated boundary table is checked before deciding whether a weak
  // feature match should stand — found during Stage 1's own testing:
  // "Does AutoIngest offer cloud backup?" keyword-matches AI-FEAT-040
  // (Backup Update Scanning) via the single generic token "backup", which
  // would otherwise present cloud backup as available. A boundary citation
  // is stronger evidence than one bare keyword-token overlap; only a
  // STRONG feature match (exact ID/alias/title or real title-substring) is
  // allowed to override it.
  if (boundary && !hasStrongMatch) {
    return boundaryAnswer(question, boundary, featureMatches);
  }
  if (!top || top.score < CONFIDENCE_FLOOR) {
    return unknownAnswer(question, featureMatches);
  }
  const knowledgeRecord = knowledgeIndexById.get(top.id);
  if (!knowledgeRecord) return unknownAnswer(question, featureMatches);
  return answerFromRecord(question, knowledgeRecord, featureMatches);
}

function knowledgeIndexMap(knowledgeIndex) {
  return new Map(knowledgeIndex.map((r) => [r.id, r]));
}

module.exports = { answerQuestion, classifyIntent, knowledgeIndexMap, CONFIDENCE_FLOOR };
