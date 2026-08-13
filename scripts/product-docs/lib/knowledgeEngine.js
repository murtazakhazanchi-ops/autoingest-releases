'use strict';

// AutoIngest Knowledge Engine — grounded answer builder. Stage 1 proved this
// module reusing lib/query.js's existing deterministic ranker unchanged (no
// second search implementation — see scripts/product-docs/README.md "Query
// ranking"). Stage 2 extends it with question-type classification, a small
// curated concept/synonym layer, Workflow-record-aware "how to" answers,
// and roadmap routing — all still deterministic, still no embeddings, still
// this one module as the ONLY place that turns retrieval + evidence into
// operator-facing text (see docs/product/features/AI-FEAT-058_*.md §
// Architectural Review, and docs/product/decisions/DEC-020_*.md for why
// this stays one module rather than forking a v2).
//
// Never invents UI navigation, never invents steps, never upgrades Planned
// to Available, never presents dormant/wired-but-unemitted server behavior
// (e.g. conflict:warning) as a live capability, never calls presence
// "synchronization" or visibility "locking" — see AI-WF-006's own record
// for the canonical statement of those four Online Registry distinctions,
// which this module must reflect, not blur.

const { runQuery } = require('./query');
const { RECORD_STATUS, QUERY_STATUS, matchKnownBoundary, KNOWN_BOUNDARIES } = require('./statusResolution');
const { findConcept, findBoundaryConcept } = require('./intentConcepts');
const { QUESTION_TYPES, classifyQuestion } = require('./questionClassifier');

// Below this score, a match is not confident enough to answer from — see
// scripts/product-docs/README.md's ranking table: 100 is the minimum score
// a real keyword-token overlap produces; a bare summary-substring hit (10)
// is treated as too weak to found an answer on.
const CONFIDENCE_FLOOR = 100;
const MAX_MATCHES = 5;

// Stage 1's original classifier — kept for backward compatibility with any
// external caller that imported it directly (none currently do; retained
// as a documented deprecation rather than a breaking removal). New code
// should use questionClassifier.js's classifyQuestion, which this module
// now uses internally.
function classifyIntent(question) {
  const q = String(question || '').trim().toLowerCase();
  if (/^(what is|what's|what are|whats)\b/.test(q)) return 'definition';
  if (/^(how do i|how to|how can i|how does)\b/.test(q)) return 'howto';
  if (/\b(coming next|what's next|whats next|roadmap|planned next)\b/.test(q)) return 'roadmap';
  if (/^(can i|can autoingest|does autoingest|is there|will autoingest)\b/.test(q)) return 'capability-check';
  return 'general';
}

function sourcesForRecord(knowledgeRecord) {
  // Cite the canonical document explicitly — NOT sourceFiles[0], which is
  // an alphabetically-sorted merge of canonical doc + code paths + technical
  // docs and is not reliably the canonical document itself (found during
  // the PR #5 forensic review; see lib/knowledgeIndex.js's comment on the
  // canonicalDocument field for the full account).
  const sources = [{ id: knowledgeRecord.id, title: knowledgeRecord.title, path: knowledgeRecord.canonicalDocument || null }];
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

// Stage 2 — a companion Workflow for a Capability, if one exists and cites
// it in its own Related capabilities field. At most one is used (the
// lowest AI-WF ID, deterministic) — never invented, only ever a real,
// already-authored record.
function findCompanionWorkflow(featureId, workflowIndexById) {
  if (!workflowIndexById) return null;
  const candidates = Array.from(workflowIndexById.values())
    .filter((w) => w.relatedCapabilities.includes(featureId))
    .sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
  return candidates[0] || null;
}

function answerFromRecord(question, knowledgeRecord, matches, qType, companionWorkflow) {
  const status = knowledgeRecord.operatorStatus;
  const tiedCount = matches.filter((m) => m.score === matches[0].score).length;
  const quality = matchQualityFor(matches[0].score, tiedCount);
  let directAnswer;
  let guidance = null;
  let steps = null;
  let whereToGo = null;

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
    if (companionWorkflow) {
      // A real, authored Workflow exists for this exact capability — use
      // its own verified fields verbatim rather than the generic fallback.
      // Never re-derive or paraphrase; cite exactly what the Workflow record
      // itself says, including its own honesty about unverified navigation.
      guidance = companionWorkflow.steps && companionWorkflow.steps.length
        ? `See ${companionWorkflow.id} (${companionWorkflow.title}) for step-by-step instructions.`
        : 'AutoIngest supports this capability, but detailed operator instructions are not yet documented.';
      steps = companionWorkflow.steps && companionWorkflow.steps.length ? companionWorkflow.steps : null;
      whereToGo = companionWorkflow.whereToGo || null;
    } else {
      // No Workflow record exists yet for this capability (Stage 2's
      // authored set is deliberately bounded — see
      // docs/product/workflows/README.md). This fallback sentence remains
      // the honest answer, exactly as Stage 1 established.
      guidance = 'AutoIngest supports this capability, but detailed operator instructions are not yet documented.';
    }
  }

  const sources = sourcesForRecord(knowledgeRecord);
  if (companionWorkflow) {
    sources.push({ id: companionWorkflow.id, title: companionWorkflow.title, path: companionWorkflow.canonicalDocument });
  }

  return {
    query: question,
    classification: qType,
    directAnswer,
    capabilityStatus: status,
    matchQuality: quality,
    matchedCapabilities: matches,
    guidance,
    whereToGo,
    steps,
    limitations: limitationsForRecord(knowledgeRecord),
    relatedCapabilities: knowledgeRecord.relatedFeatures,
    sources,
    confidence: quality === 'weak' ? Math.min(0.4, matches[0].score / 1000) : Math.min(1, matches[0].score / 1000),
  };
}

// Stage 2 — a Workflow record IS "how to" content; when one is the best
// match for a HOW_TO-classified question, answer from it directly rather
// than routing through a Capability record at all. Every field below is the
// Workflow's own verified content, verbatim — never re-derived.
function answerFromWorkflow(question, workflowRecord, workflowMatches, featureMatches, qType) {
  const allMatches = [...workflowMatches, ...featureMatches].slice(0, MAX_MATCHES);
  const tiedCount = workflowMatches.filter((m) => m.score === workflowMatches[0].score).length;
  const quality = matchQualityFor(workflowMatches[0].score, tiedCount);
  const hedge = quality === 'weak' ? `Closest documented workflow (this may not directly answer your question): ` : '';
  const sources = [{ id: workflowRecord.id, title: workflowRecord.title, path: workflowRecord.canonicalDocument }];
  for (const featId of workflowRecord.relatedCapabilities) sources.push({ id: featId, title: null, path: null });

  return {
    query: question,
    classification: qType,
    directAnswer: `${hedge}${workflowRecord.whatItDoes || workflowRecord.title}`.trim(),
    capabilityStatus: RECORD_STATUS.AVAILABLE, // a Workflow is only ever authored for something that exists — never for a Planned/unsupported capability
    matchQuality: quality,
    matchedCapabilities: allMatches,
    guidance: workflowRecord.whenToUseIt || null,
    whereToGo: workflowRecord.whereToGo || null,
    steps: workflowRecord.steps && workflowRecord.steps.length ? workflowRecord.steps : null,
    expectedResult: workflowRecord.expectedResult || null,
    limitations: [workflowRecord.limitations, workflowRecord.warnings].filter(Boolean),
    relatedCapabilities: workflowRecord.relatedCapabilities,
    sources,
    confidence: quality === 'weak' ? Math.min(0.4, workflowMatches[0].score / 1000) : Math.min(1, workflowMatches[0].score / 1000),
  };
}

function boundaryAnswer(question, boundary, matches, qType) {
  return {
    query: question,
    classification: qType,
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

function unknownAnswer(question, matches, qType) {
  return {
    query: question,
    classification: qType,
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

// Stage 2 Phase 19 — roadmap/status routing. A Stage 1 confirmed gap: "what's
// coming next" resolved UNKNOWN because the engine only ever matched
// feature-type search-index records, even though roadmap-dashboard.json
// answers it well. Routes directly to the SAME dashboard data `roadmap`
// screens/humans already read — never infers a commitment from anything
// else (no TODO comments, no speculative reading of code).
function roadmapAnswer(question, dashboard) {
  if (!dashboard) return unknownAnswer(question, [], QUESTION_TYPES.ROADMAP);
  const next = dashboard.milestones.find((m) => m.id === dashboard.next_milestone_id) || null;
  const following = dashboard.milestones.find((m) => m.id === dashboard.following_milestone_id) || null;
  const parts = [];
  parts.push(`${dashboard.completed_count} of ${dashboard.total_milestones} roadmap milestones are complete.`);
  if (next) parts.push(`Next: ${next.id} (${next.name}) — status: ${next.status}.`);
  if (following) parts.push(`Following: ${following.id} (${following.name}).`);
  const sources = [{ id: 'roadmap-dashboard', title: 'Project Roadmap Dashboard', path: 'docs/product/02_MASTER_ROADMAP.md' }];
  return {
    query: question,
    classification: QUESTION_TYPES.ROADMAP,
    directAnswer: parts.join(' '),
    capabilityStatus: QUESTION_TYPES.ROADMAP,
    matchQuality: 'roadmap',
    matchedCapabilities: [],
    guidance: null,
    limitations: dashboard.current_risks && dashboard.current_risks !== 'None recorded' ? [String(dashboard.current_risks)] : [],
    relatedCapabilities: next ? next.included_features : [],
    sources,
    confidence: 1,
  };
}

// Concept-expanded, multi-query candidate search across BOTH feature and
// workflow entity types, still entirely through lib/query.js's own
// runQuery() — no second ranking implementation. See lib/intentConcepts.js
// for what a "concept hint" is and why this isn't a giant per-question
// lookup table: a small number of curated alternate phrasings, not one
// entry per expected question.
function searchCandidates(question, searchIndex) {
  const concept = findConcept(String(question || '').toLowerCase());
  const candidateQueries = [question, ...(concept ? concept.hints : [])];
  const bestByRecord = new Map();
  const bestRawByRecord = new Map(); // raw-question-only scores — see note below
  for (let i = 0; i < candidateQueries.length; i++) {
    const cq = candidateQueries[i];
    const isRaw = i === 0;
    const results = runQuery(cq, searchIndex, { limit: 20 });
    for (const r of results) {
      if (r.record.entity_type !== 'feature' && r.record.entity_type !== 'workflow') continue;
      const prev = bestByRecord.get(r.record.stable_id);
      if (!prev || r.score > prev.score) {
        bestByRecord.set(r.record.stable_id, { id: r.record.stable_id, title: r.record.title, score: r.score, entityType: r.record.entity_type });
      }
      if (isRaw) bestRawByRecord.set(r.record.stable_id, r.score);
    }
  }
  const all = Array.from(bestByRecord.values()).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, 'en', { numeric: true }));
  return {
    concept,
    featureMatches: all.filter((m) => m.entityType === 'feature').slice(0, MAX_MATCHES),
    workflowMatches: all.filter((m) => m.entityType === 'workflow').slice(0, MAX_MATCHES),
    // Raw-question-only version of the same match lists — used ONLY to
    // decide whether a match is trustworthy enough to override a curated
    // boundary (see hasStrongFeatureMatch below). Found during Stage 2's
    // own testing: a concept hint aimed at "team collaboration" also fired
    // for "multiple people log in with different roles" (a real,
    // correctly-detected multi-user-ROLES boundary question) and, because
    // the hint text scored strongly against AI-FEAT-048, silently overrode
    // the boundary — reproducing the exact class of bug the PR #5 review
    // caught for raw keyword luck, this time via a hint. A hint is a recall
    // aid, not a confidence authority high enough to override curated,
    // evidenced exclusion data — only a match the RAW question itself
    // earns, unaided, may do that.
    rawFeatureMatches: all.filter((m) => m.entityType === 'feature' && bestRawByRecord.has(m.id))
      .map((m) => ({ ...m, score: bestRawByRecord.get(m.id) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, 'en', { numeric: true }))
      .slice(0, MAX_MATCHES),
  };
}

function boundaryFromConcept(question) {
  const boundaryId = findBoundaryConcept(String(question || '').toLowerCase());
  if (!boundaryId) return null;
  return KNOWN_BOUNDARIES.find((b) => b.id === boundaryId) || null;
}

// ctx: { searchIndex, knowledgeIndexById, workflowIndexById (optional,
// Stage 2), dashboard (optional, Stage 2 — enables ROADMAP routing) }.
// workflowIndexById/dashboard are optional so any existing Stage 1 caller
// that only passes { searchIndex, knowledgeIndexById } keeps working
// unchanged — this is a strictly additive extension of the same function.
function answerQuestion(question, ctx) {
  const { searchIndex, knowledgeIndexById, workflowIndexById, dashboard } = ctx;
  const qType = classifyQuestion(question);

  if (qType === QUESTION_TYPES.ROADMAP && dashboard) {
    return roadmapAnswer(question, dashboard);
  }

  const { featureMatches, workflowMatches, rawFeatureMatches } = searchCandidates(question, searchIndex);

  const topFeature = featureMatches[0];
  const topFeatureTied = topFeature ? featureMatches.filter((m) => m.score === topFeature.score).length : 0;
  const hasStrongFeatureMatch = !!topFeature && matchQualityFor(topFeature.score, topFeatureTied) === 'strong';

  const boundary = matchKnownBoundary(question) || boundaryFromConcept(question);

  // The curated boundary table is checked before deciding whether a weak
  // feature match should stand — found during Stage 1's own testing:
  // "Does AutoIngest offer cloud backup?" keyword-matches AI-FEAT-040
  // (Backup Update Scanning) via the single generic token "backup", which
  // would otherwise present cloud backup as available. A boundary citation
  // is stronger evidence than one bare keyword-token overlap; only a
  // STRONG feature match (exact ID/alias/title or real title-substring) is
  // allowed to override it — and, per Stage 2's own regression finding
  // above, only a strength earned by the RAW question itself, never one
  // manufactured by a concept hint (rawFeatureMatches, not featureMatches).
  const topRawFeature = rawFeatureMatches[0];
  const topRawFeatureTied = topRawFeature ? rawFeatureMatches.filter((m) => m.score === topRawFeature.score).length : 0;
  const hasStrongRawFeatureMatch = !!topRawFeature && matchQualityFor(topRawFeature.score, topRawFeatureTied) === 'strong';
  // Stage 2, Phase 20 — a `hardOverride: true` boundary (see
  // statusResolution.js's registry-* entries) is never overridden by a raw
  // feature match, however strong. Those boundaries make a narrower claim
  // about a real feature's documented SCOPE, not "this capability doesn't
  // exist" — a strong match on that same parent feature doesn't disprove
  // the narrower claim, so it must not be treated as competing evidence.
  if (boundary && (boundary.hardOverride || !hasStrongRawFeatureMatch)) {
    return boundaryAnswer(question, boundary, featureMatches, qType);
  }

  // Stage 2 — a HOW_TO or TROUBLESHOOTING question is better served by a
  // real Workflow record than by a Capability record's generic fallback
  // sentence, provided the workflow match is genuine evidence (>=
  // CONFIDENCE_FLOOR) and isn't clearly beaten by a strong, unambiguous
  // feature match with no comparable workflow score. TROUBLESHOOTING was
  // added after Stage 2's own testing found "My transfer stopped halfway —
  // what happens now?" (classified TROUBLESHOOTING, not HOW_TO) ignored a
  // clearly-superior AI-WF-005 match (score 500) entirely, falling through
  // to an unrelated, merely-tied feature (AI-FEAT-037, sharing nothing
  // topical, winning only the ascending-ID tiebreak) — a worse answer than
  // Stage 1 gave for the same question. This never overrides a strong
  // exact-title feature match with a merely-weak workflow guess.
  const topWorkflow = workflowMatches[0];
  const workflowClearlyBeaten = hasStrongFeatureMatch && (!topWorkflow || topFeature.score > topWorkflow.score);
  const workflowPreferredType = qType === QUESTION_TYPES.HOW_TO || qType === QUESTION_TYPES.TROUBLESHOOTING;
  if (workflowPreferredType && topWorkflow && topWorkflow.score >= CONFIDENCE_FLOOR && !workflowClearlyBeaten && workflowIndexById) {
    const wf = workflowIndexById.get(topWorkflow.id);
    if (wf) return answerFromWorkflow(question, wf, workflowMatches, featureMatches, qType);
  }

  if (!topFeature || topFeature.score < CONFIDENCE_FLOOR) {
    return unknownAnswer(question, featureMatches, qType);
  }
  const knowledgeRecord = knowledgeIndexById.get(topFeature.id);
  if (!knowledgeRecord) return unknownAnswer(question, featureMatches, qType);

  const companionWorkflow = findCompanionWorkflow(knowledgeRecord.id, workflowIndexById);
  return answerFromRecord(question, knowledgeRecord, featureMatches, qType, companionWorkflow);
}

function knowledgeIndexMap(knowledgeIndex) {
  return new Map(knowledgeIndex.map((r) => [r.id, r]));
}

function workflowIndexMap(workflowIndex) {
  return new Map((workflowIndex || []).map((r) => [r.id, r]));
}

// Convenience for every caller (CLI, local portal server, eval harness):
// build the full answerQuestion() context from a fresh build.assemble()
// result in one place, so no caller has to remember which fields matter.
function buildEngineContext(built) {
  return {
    searchIndex: built.searchIndex,
    knowledgeIndexById: knowledgeIndexMap(built.knowledgeIndex),
    workflowIndexById: workflowIndexMap(built.workflowIndex),
    dashboard: built.dashboard,
  };
}

module.exports = {
  answerQuestion,
  classifyIntent,
  knowledgeIndexMap,
  workflowIndexMap,
  buildEngineContext,
  CONFIDENCE_FLOOR,
  QUESTION_TYPES,
  classifyQuestion,
};
