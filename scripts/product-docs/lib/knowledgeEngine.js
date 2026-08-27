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
const { findConcept, findAllConcepts, findBoundaryConcept } = require('./intentConcepts');
const { QUESTION_TYPES, classifyQuestion } = require('./questionClassifier');
const { isEligibleForNormalization, matchedTokenCount, adjustKeywordOverlapScore, explainCandidate, ABSOLUTE_EVIDENCE_FLOOR_TOKENS } = require('./knowledgeSurfaceNormalization');
const { explainNeighborhood: labelNeighborhood } = require('./knowledgeNeighborhood');
const { explainHistoricalContext: labelHistoricalContext, historicalContextForFeature, unanchoredHistoricalContext } = require('./knowledgeHistoricalContext');

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

// Part 5 Phase 5.1 (Decision 4) — Feature -> Decision/Postmortem visibility.
// Deliberately NOT consolidated with knowledgeRecord.knownLimitations.openBugs
// (Feature -> Bug's existing, pre-Phase-5.1 path): that field carries
// distinct operational semantics (per-bug live status, "not yet marked
// Fixed" limitation text) that decisions/postmortems have no equivalent
// of — a decision is not "open" or "fixed", a postmortem is a historical
// record, not a tracked defect. Consolidating onto one shape merely for
// symmetry would either invent a fake status concept for decisions/
// postmortems or silently drop the real one bugs already have. Verified
// (fidelity audit, Phase 5.1 investigation): authorityIndex's relatedBugs
// is byte-identical to knownLimitations.openBugs' own id list for every
// one of the 58 canonical features — the two paths already agree on WHICH
// bugs exist, they just carry that agreement through different, equally
// legitimate shapes for different purposes.
//
// Reads ONLY the feature's own one-hop relatedDecisions/relatedPostmortems
// (authorityIndex, itself a direct, unmodified projection of the feature's
// own Lifecycle Metadata table) — never that decision/postmortem's own
// further-related records (no recursive graph traversal; Decision 4's own
// stated boundary, RF-5.1-004).
function governanceRelationshipsForFeature(featureId, authorityIndexByFeatureId, searchIndexById) {
  if (!authorityIndexByFeatureId || !searchIndexById) return { decisions: [], postmortems: [] };
  const entry = authorityIndexByFeatureId.get(featureId);
  if (!entry) return { decisions: [], postmortems: [] };
  const resolve = (id) => {
    const rec = searchIndexById.get(id);
    return rec ? { id, title: rec.title, path: rec.canonical_path } : { id, title: id, path: null };
  };
  return {
    decisions: (entry.relatedDecisions || []).map(resolve),
    postmortems: (entry.relatedPostmortems || []).map(resolve),
  };
}

function sourcesForRecord(knowledgeRecord, governanceRelationships, historicalContext) {
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
  // Part 5 Phase 5.1 — visibility only. This runs strictly AFTER primary
  // record selection and quality/confidence are already fully decided
  // above in answerQuestion(); appending here cannot retroactively change
  // which record was chosen or how confidently. Relationship membership
  // never adds ranking points (RF-5.1-003) — there are no points here to
  // add, this function has no return value that feeds back into scoring.
  if (governanceRelationships) {
    for (const dec of governanceRelationships.decisions) sources.push({ id: dec.id, title: dec.title, path: dec.path });
    for (const pm of governanceRelationships.postmortems) sources.push({ id: pm.id, title: pm.title, path: pm.path });
  }
  // Part 5 Phase 5.3 (Decision 5) — unlike the unconditional governance
  // append above, historicalContext.admitted already carries ONLY entries
  // that cleared the full historical-intent + grounding + materiality test
  // (lib/knowledgeHistoricalContext.js) — admission IS the visibility gate
  // here, not a separate diagnostic layer on top of unconditional citation.
  // Appended strictly after status/quality/confidence are decided, same
  // guarantee as governanceRelationships above — never influences ranking,
  // never touches capabilityStatus (computed earlier, from
  // knowledgeRecord.operatorStatus alone, untouched by this function).
  if (historicalContext) {
    for (const item of historicalContext.admitted) {
      sources.push({ id: item.id, title: item.title, path: item.path, role: 'historical-context', historicalType: item.type, evidenceQualification: item.evidenceQualification });
    }
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
// Part 5 Phase 5.2 (Decision 3) — when a Feature legitimately has more than
// one candidate companion Workflow (found: AI-FEAT-038/AI-FEAT-039, each
// cited by both AI-WF-005 "Export..." and AI-WF-009 "Import..." — 2 of 22
// features with any candidate at all), the lowest-ID tiebreak alone is
// arbitrary and can pick the objectively weaker match for THIS question
// (e.g. AI-WF-005 over AI-WF-009 for an import-focused question, purely
// because "05" < "09"). `workflowMatches` is the SAME single retrieval
// pass already scored for this exact question — no second query, no
// decomposition — so when more than one candidate exists, prefer whichever
// one independently clears CONFIDENCE_FLOOR with the highest score in that
// pass (Workflow's own authority role: "how to perform the operation" is
// best filled by whichever workflow the question's own wording most
// strongly, independently invokes). Falls back to the original
// deterministic lowest-ID behavior when workflowMatches isn't supplied, or
// when no candidate clears the floor there (preserves 100% of pre-Phase-5.2
// behavior for the 20/22 features with only one candidate, and for the
// weak-evidence case on the 2 ambiguous ones).
function findCompanionWorkflow(featureId, workflowIndexById, workflowMatches) {
  if (!workflowIndexById) return null;
  const candidates = Array.from(workflowIndexById.values())
    .filter((w) => w.relatedCapabilities.includes(featureId));
  if (!candidates.length) return null;
  if (workflowMatches && workflowMatches.length) {
    const scoreById = new Map(workflowMatches.map((m) => [m.id, m.score]));
    const independentlyStrong = candidates
      .filter((c) => scoreById.has(c.id) && scoreById.get(c.id) >= CONFIDENCE_FLOOR)
      .sort((a, b) => scoreById.get(b.id) - scoreById.get(a.id) || a.id.localeCompare(b.id, 'en', { numeric: true }));
    if (independentlyStrong.length) return independentlyStrong[0];
  }
  return candidates.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))[0];
}

function answerFromRecord(question, knowledgeRecord, matches, qType, companionWorkflow, governanceRelationships, historicalContext) {
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

  const sources = sourcesForRecord(knowledgeRecord, governanceRelationships, historicalContext);
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

// Part 2 remediation (Decision 1) — the real Feature this bug/decision/
// postmortem is documented against, per its own "Related feature(s)" header
// citation (already resolved into related_ids by lib/searchIndex.js). The
// LOWEST feature ID is used deterministically when more than one is cited
// (e.g. DEC-021 cites three) — a governance record's PRIMARY subject for
// authority-preservation purposes, not an attempt to rank relevance among
// them. Returns null (not a guess) when no citation resolves to a real,
// known feature — see answerFromGovernanceRecord for why that means the
// governance-primary path is not used at all rather than presenting a
// half-grounded answer.
function findPrimaryFeatureContext(relatedIds, knowledgeIndexById) {
  if (!knowledgeIndexById) return null;
  const featureIds = (relatedIds || []).filter((id) => /^AI-FEAT-/.test(id)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  for (const id of featureIds) {
    const featRec = knowledgeIndexById.get(id);
    if (featRec) return featRec;
  }
  return null;
}

const GOVERNANCE_LABEL = { bug: 'Known issue', decision: 'Documented decision', postmortem: 'Documented incident' };

// Part 2 remediation (Decision 1) — authority-preserving answer for when a
// bug/decision/postmortem is itself the strongest, most specific match
// (see answerQuestion's governanceIsBestEvidence gate). Mirrors the
// product owner's own worked examples (BUG-017/018 primary with AI-FEAT-007
// context; DEC-021 primary with AI-FEAT-038 context): the governance
// record's own Symptom/Root-Cause (or Context/Decision, or Summary/Root-
// Cause) text is the PRIMARY content, with its cited feature surfaced as
// supporting context — never the reverse, and never inventing a status this
// record's own evidence doesn't state.
//
// Deliberately returns null — asking the caller to fall through to the
// ordinary feature/workflow answer path — whenever no real feature citation
// resolves. A bug/decision/postmortem with no resolvable feature context is
// real evidence of a documentation gap in THAT record, not license to
// invent a capabilityStatus for this answer; the existing invented-nothing
// discipline (see this file's header comment) takes priority over
// completeness here.
function answerFromGovernanceRecord(question, searchRec, matches, qType, knowledgeIndexById) {
  const featureContext = findPrimaryFeatureContext(searchRec.related_ids, knowledgeIndexById);
  if (!featureContext) return null;

  const tiedCount = matches.filter((m) => m.score === matches[0].score).length;
  const quality = matchQualityFor(matches[0].score, tiedCount);
  const entityType = searchRec.entity_type;
  const label = GOVERNANCE_LABEL[entityType] || 'Documented record';

  const parts = [`${label} — ${searchRec.stable_id} (${searchRec.title}): ${searchRec.summary}`.trim()];
  if (searchRec.detail) parts.push(searchRec.detail);

  const limitations = [];
  if (entityType === 'bug') {
    // Read the bug's live status off the SAME already-resolved data
    // limitationsForRecord()/knowledgeIndex.js use for this exact feature
    // (f.related_bugs -> parsed.bugs.get(id).header['Status']) — no second
    // status source, no re-parsing. Reciprocal citation (the feature's own
    // "Related bugs" field naming this bug back) is what the project's
    // validators already enforce; when it's missing this simply omits the
    // status line rather than guessing.
    const openBug = (featureContext.knownLimitations.openBugs || []).find((b) => b.id === searchRec.stable_id);
    if (openBug) {
      parts.push(`Current status: ${openBug.status}.`);
      if (!/^(Fixed|Resolved|Closed)\b/i.test(openBug.status)) {
        limitations.push(`${searchRec.stable_id} is not yet marked Fixed (current status: ${openBug.status}).`);
      }
    }
  }

  parts.push(`Context: this relates to ${featureContext.title} (${featureContext.id}), which is ${featureContext.operatorStatus}.`);

  const sources = [
    { id: searchRec.stable_id, title: searchRec.title, path: searchRec.canonical_path },
    { id: featureContext.id, title: featureContext.title, path: featureContext.canonicalDocument },
  ];

  return {
    query: question,
    classification: qType,
    directAnswer: parts.join(' ').trim(),
    // Anchored on the cited feature's own real operator status — this
    // governance record is evidence ABOUT that feature (a defect, a
    // decision, an incident), never a claim that the feature itself
    // doesn't exist or isn't available.
    capabilityStatus: featureContext.operatorStatus,
    matchQuality: quality,
    matchedCapabilities: matches,
    guidance: null,
    limitations,
    relatedCapabilities: [featureContext.id],
    sources,
    confidence: quality === 'weak' ? Math.min(0.4, matches[0].score / 1000) : Math.min(1, matches[0].score / 1000),
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

// Part 5 Phase 5.3 Decision C — materiality safety closure (Product Owner
// directive, post body-indexing investigation). The unanchored fallback's
// own admission gate (strong + untied retrieval) was empirically proven to
// discriminate ELIGIBILITY, not MATERIALITY — a real, unanchored governance-
// primary question ("What does Transfer Export do and why was its locking
// kept process-local?", DEC-021 primary) admits ARCH-e on a genuine, unique,
// strong retrieval match whose specific matched tokens are demonstrably
// scattered across unrelated sentences in §3E's own body, not about the
// locking decision the question actually asks about. No existing
// deterministic signal (title-vs-body split, Feature-citation grounding,
// governance-primary-to-Architecture relationship path, whole-record
// keyword overlap) was found to reliably distinguish this from the genuine
// positive case (§3A) — see the Architecture Body-Indexing Safety Decision
// Report and the Unanchored Architecture Materiality Safety Report for the
// full empirical account. The one signal that DID distinguish them
// (sentence-level match concentration) would require inventing a new
// parser and threshold — explicitly out of bounds.
//
// Memory was investigated independently, not withdrawn merely for symmetry
// with Architecture (an explicit Product Owner instruction): a real, natural
// question ("How did the Windows/NAS event management reliability
// investigation evolve to resolve its three root causes?", DEC-016 primary)
// demonstrates unanchoredHistoricalContext() admitting AI-MEM-0003 — a
// capsule with ZERO real Feature/Decision/Bug grounding (its own Scope
// table is "Evidence pending — source conversation unavailable" for every
// field) — purely on a strong (700), unique raw retrieval score. Testing
// whether Memory's OWN existing structured materiality signal
// (memoryHasGenuineChronology()) would have caught this found a further,
// independent defect: AI-MEM-0003's own `unresolved_items` field is the
// literal placeholder array `['None recorded.']` (a non-empty array whose
// only element is boilerplate text meaning "nothing"), which
// memoryHasGenuineChronology()'s `.length > 0` check incorrectly counts as
// genuine chronology. Memory therefore reaches the public answer through
// the SAME retrieval-only admission weakness as Architecture, demonstrated
// with real evidence, not assumed from implementation symmetry — per the
// Product Owner's own second acceptable outcome.
//
// retrieved != material != admitted: this function computes the unanchored
// fallback INTERNALLY, for exactly one narrow purpose — deciding whether
// unknownAnswer()'s blanket "not enough evidence" wording would be false
// for this specific question (real historical/background material WAS
// found, just not confidently admittable) — and, if so, correcting that
// wording narrowly, without naming internal scoring or diagnostics. The
// full candidate/score/reason data returned by unanchoredHistoricalContext()
// is NEVER attached to the real public answer object. explainHistoricalContext()
// (the diagnostic seam, unchanged) remains the sole place this data is
// inspectable, for observability/testing only.
function reconcileUnknownEvidenceWording(answer, question, ctx) {
  if (answer.matchQuality !== 'none') return answer; // only unknownAnswer()'s own shape ever needs this -- a governance-primary answer already presents real evidence, never claims "no evidence exists"
  const uhc = unanchoredHistoricalContext(question, ctx, CONFIDENCE_FLOOR, matchQualityFor);
  if (!uhc.candidates.length) return answer;
  return {
    ...answer,
    directAnswer: 'AutoIngest\'s documentation does not have enough evidence to confidently answer what you asked about current capability. Related historical or background material exists but could not be confidently connected to this question, so it is not presented as part of the answer.',
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
  const questionLower = String(question || '').toLowerCase();
  const concept = findConcept(questionLower); // kept for the returned diagnostic shape below — first match only, unchanged meaning
  // Phase C6.2 — candidate queries now include EVERY matching cluster's
  // hints (findAllConcepts), not just the first. See intentConcepts.js's
  // own findAllConcepts header comment for the forensic finding. De-duped
  // since two clusters occasionally share an identical hint string.
  const allConcepts = findAllConcepts(questionLower);
  const allHints = [...new Set(allConcepts.flatMap((c) => c.hints))];
  const candidateQueries = [question, ...allHints];
  const bestByRecord = new Map();
  const bestRawByRecord = new Map(); // raw-question-only scores — see note below
  // Phase C6.3 (Section G/Option 1) — FORENSIC FINDING: bestByRecord above
  // picks whichever candidate query (the raw question OR a concept hint)
  // produced a record's max score, with no record of WHICH query that was.
  // The absolute-evidence-first tie-break below (and workflowClearlyBeaten
  // in answerQuestion()) both read matchedTokenCount(reasons) off that
  // max-scoring query's own reasons — so a record whose ENTIRE score came
  // from a synthetic hint (the raw question itself barely or never matched
  // it) competes on equal footing with a record whose evidence is real,
  // original-question support. Proven concretely via N1 ("Where do my
  // photos actually end up after an import finishes?"): AI-FEAT-002
  // ("Login & Operator Identity") won the token-count tie-break over
  // AI-FEAT-012 with 5 matched tokens vs 4 — but ALL 5 of AI-FEAT-002's
  // tokens came from the injected import-general hint text (which shares
  // generic attribution vocabulary — "import"/"memory"/"card"/"folder"/
  // "event" — with AI-FEAT-002's own unusually broad 106-keyword surface);
  // the raw question itself only ever scored 1 token (100) against it.
  // Measured corpus-wide (this checkpoint's own forensic sweep across the
  // C6.1/C6.2/C6.3 corpora, ~85 wrong-primary cases): this exact pattern
  // ("SPURIOUS_HINT_WIN") accounts for 7 further cases beyond N1, a real,
  // recurring failure mode, not a one-off. `bestOriginalReasonsByRecord`
  // captures each record's reasons from candidateQueries[0] (the raw
  // question) SPECIFICALLY, independent of whichever query won the max
  // score, so the tie-break below can prefer original-question evidence
  // without discarding hint-only evidence entirely (a record with ZERO
  // original-question support still keeps its hint-derived score and
  // reasons — hint-only recall, C6.2's own core mechanism, is untouched;
  // only the TOKEN-COUNT TIE-BREAK's provenance changes).
  const bestOriginalReasonsByRecord = new Map();
  // Part 2 remediation (Decision 1) — the candidate pool now also admits
  // bug/decision/postmortem records, not just feature/workflow. Approved
  // scope: cross-type retrieval + authority preservation, so a question
  // that is genuinely, specifically ABOUT a documented defect or decision
  // (not merely coincidentally sharing a keyword with one) can surface that
  // record instead of silently losing to an unrelated feature. See
  // answerFromGovernanceRecord below for how a governance-type match is
  // only ever allowed to become the primary answer when it wins on the
  // SAME strong/untied evidence bar every other entity type already uses
  // (no new classifier, no second confidence scale).
  const GOVERNANCE_TYPES = new Set(['bug', 'decision', 'postmortem']);
  for (let i = 0; i < candidateQueries.length; i++) {
    const cq = candidateQueries[i];
    const isRaw = i === 0;
    const results = runQuery(cq, searchIndex, { limit: 20 });
    for (const r of results) {
      if (r.record.entity_type !== 'feature' && r.record.entity_type !== 'workflow' && !GOVERNANCE_TYPES.has(r.record.entity_type)) continue;
      const prev = bestByRecord.get(r.record.stable_id);
      if (!prev || r.score > prev.score) {
        bestByRecord.set(r.record.stable_id, { id: r.record.stable_id, title: r.record.title, score: r.score, entityType: r.record.entity_type, reasons: r.reasons, surfaceSize: r.record.keywords.length });
      }
      if (isRaw) {
        bestRawByRecord.set(r.record.stable_id, r.score);
        bestOriginalReasonsByRecord.set(r.record.stable_id, r.reasons);
      }
    }
  }
  // Phase C6.3 (Section G/Option 1) — the provenance-aware token count used
  // by both tie-breaks below: original-question reasons when the raw
  // question itself matched this record at all, falling back to the
  // record's actual (possibly hint-sourced) winning reasons otherwise —
  // never zero for a record that only ever matched via a hint, preserving
  // 100% of C6.2's hint-only recall for records with no original-query
  // support at all. Only changes which query's reasons feed the TIE-BREAK
  // when both hint and original evidence exist for the same record.
  function originalAwareTokenCount(recordId, fallbackReasons) {
    const originalReasons = bestOriginalReasonsByRecord.get(recordId);
    if (originalReasons && originalReasons.length) return matchedTokenCount(originalReasons);
    return matchedTokenCount(fallbackReasons);
  }
  // Part 3 Phase 4.3 (Decision 2, E1 resolved: Option A) — bounded, local
  // relevance adjustment, applied once here to the WINNING raw score per
  // record (whichever candidate query — raw question or a concept hint —
  // produced it), never to the max-selection above. lib/query.js's own
  // ranker and the raw-vs-hint merge logic above are both completely
  // unmodified — this only re-weights the already-decided winning score
  // for candidates whose win is attributable purely to the keyword-overlap
  // tier (see lib/knowledgeSurfaceNormalization.js's header for the full
  // governing rationale and why REF=20/DAMPING=0.25 is the conservative
  // operating point). `bestRawByRecord` (used only for the boundary raw-
  // match override check, Decision 1/Phase 4.2's territory) is
  // deliberately left untouched below.
  //
  // Restricted to feature/workflow entity types only (see
  // isEligibleForNormalization's own comment) — every case investigated
  // and evidenced during Phase 4.3 (Gap A, Gap C, R23, R29, R05, the
  // sync-slot control) was a feature/workflow candidate. Governance records
  // (bug/decision/postmortem, Part 2's Decision 1) were never tested
  // against this mechanism; applying it there was found during
  // implementation to unexpectedly let a governance record become the
  // governance-primary winner in cases it previously wasn't (a real
  // regression, caught and excluded, not deliberately scoped in).
  for (const candidate of bestByRecord.values()) {
    candidate.rawScore = candidate.score;
    // Phase C6.3 (Section G/Option 1) — stored once here (not recomputed
    // per comparison) so both this function's own tie-break below AND
    // answerQuestion()'s workflowClearlyBeaten can read the same
    // provenance-aware count off diagnosticCandidates without a second
    // pass over bestOriginalReasonsByRecord.
    candidate.originalTokenCount = originalAwareTokenCount(candidate.id, candidate.reasons);
    if (isEligibleForNormalization(candidate.entityType, candidate.reasons)) {
      candidate.score = adjustKeywordOverlapScore(candidate.score, matchedTokenCount(candidate.reasons), candidate.surfaceSize, CONFIDENCE_FLOOR);
    }
  }
  // Part 4 closure / Phase 4.3 extension (Product Owner decision, absolute-
  // evidence-first ordering) — surface-size normalization is a SECONDARY
  // relevance calibration; it must never override a genuinely stronger
  // absolute-evidence (matched-token) signal. Matched-token ordering is
  // valid here ONLY because both candidates are keyword-overlap-tier
  // normalization participants (isEligibleForNormalization gates this on
  // the same test the normalization itself uses — never inferred from
  // entity type alone; an exact-alias/title/higher-tier candidate must
  // never be pulled into this keyword-tier comparison, see the archive-
  // locking-vs-Registry investigation's own W07/W08 sandbox bug for why).
  // When both are eligible: more matched tokens wins outright (the
  // "absolute-evidence band"); within an equal-token band, the existing
  // surface-normalized adjusted score still decides. Ineligible candidates
  // (governance types, or higher-tier feature/workflow matches) are
  // entirely unaffected and fall through to the pre-existing adjusted-
  // score comparison unchanged.
  // Phase C6.3 (Section G/Option 1) — TESTED AND REJECTED as a blanket
  // change to this tie-break: originalTokenCount (see this record's own
  // comment above, and originalAwareTokenCount) correctly fixed N1 in
  // isolation, but full-corpus regression proved it net HARMFUL when
  // applied here — C6.2's entire hint-injection mechanism depends on a
  // hint-derived token count legitimately outscoring a sparser/coincidental
  // raw-question match for genuine paraphrase recall; forcing original-only
  // provenance into this general tie-break regressed the C6.1 81-question
  // corpus (77.8% -> 72.8%, confusable-pair 95.8% -> 91.7%) and the C6.2
  // 100-question corpus (76% -> 66%) — far more damage than the ~7 spurious-
  // hint-win cases it fixed. originalTokenCount remains computed (harmless,
  // available on diagnosticCandidates for observability/explainNormalization)
  // but is NOT consulted by this sort. See this checkpoint's report,
  // rejected-options section, for the full before/after numbers.
  const all = Array.from(bestByRecord.values()).sort((a, b) => {
    if (isEligibleForNormalization(a.entityType, a.reasons) && isEligibleForNormalization(b.entityType, b.reasons)) {
      const tokenDelta = matchedTokenCount(b.reasons) - matchedTokenCount(a.reasons);
      if (tokenDelta !== 0) return tokenDelta;
    }
    return b.score - a.score || a.id.localeCompare(b.id, 'en', { numeric: true });
  });
  // Part 3 Phase 4.3 — `all`'s entries now carry internal-only diagnostic
  // fields (reasons, surfaceSize, rawScore) alongside the original public
  // shape. Never let those leak into matchedCapabilities/sources on the
  // final answer object (no premature commitment to a richer public answer
  // shape — Decision 3's territory) — every list consumed downstream by
  // answerQuestion() and eventually exposed publicly is trimmed back to
  // exactly the pre-Phase-4.3 shape here. explainNormalization() (below)
  // is the one, clearly-separate diagnostic surface that reads the full
  // fields — it calls searchCandidates() itself, independent of this trim.
  const toPublicMatch = (m) => ({ id: m.id, title: m.title, score: m.score, entityType: m.entityType });
  return {
    concept,
    featureMatches: all.filter((m) => m.entityType === 'feature').slice(0, MAX_MATCHES).map(toPublicMatch),
    workflowMatches: all.filter((m) => m.entityType === 'workflow').slice(0, MAX_MATCHES).map(toPublicMatch),
    governanceMatches: all.filter((m) => GOVERNANCE_TYPES.has(m.entityType)).slice(0, MAX_MATCHES).map(toPublicMatch),
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
    // earns, unaided, may do that. Deliberately built from bestRawByRecord's
    // untouched raw scores, never the Phase 4.3-adjusted ones.
    rawFeatureMatches: all.filter((m) => m.entityType === 'feature' && bestRawByRecord.has(m.id))
      .map((m) => toPublicMatch({ ...m, score: bestRawByRecord.get(m.id) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id, 'en', { numeric: true }))
      .slice(0, MAX_MATCHES),
    // Diagnostic-only — the full, untrimmed candidate list (with reasons,
    // surfaceSize, rawScore, and Phase 4.3-adjusted score all present).
    // Never read by answerQuestion() itself; exists solely for
    // explainNormalization() below and equivalent test/report tooling.
    diagnosticCandidates: all,
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
  const { searchIndex, knowledgeIndexById, workflowIndexById, dashboard, authorityIndexByFeatureId, searchIndexById } = ctx;
  const qType = classifyQuestion(question);

  if (qType === QUESTION_TYPES.ROADMAP && dashboard) {
    return roadmapAnswer(question, dashboard);
  }

  const { featureMatches, workflowMatches, governanceMatches, rawFeatureMatches, diagnosticCandidates } = searchCandidates(question, searchIndex);
  // Part 3 Phase 4.3 (Decision 2, E1-B resolved: Approach D) — a score may
  // only be directly compared across candidate classes when those scores
  // remain on a common calibration basis. Feature/Workflow keyword-overlap
  // scores are surface-normalized (adjusted) for intra-type relevance
  // ordering (see knowledgeSurfaceNormalization.js); Bug/Decision/
  // Postmortem scores are never touched. Comparing an adjusted
  // Feature/Workflow score directly against an untouched Governance score
  // is therefore NOT a like-for-like comparison — it silently favors
  // whichever side happens to still be on the larger scale. `rawScoreById`
  // exists ONLY to restore a common basis for the specific cross-type
  // comparisons below (governanceIsBestEvidence and its tie count). DO NOT
  // replace it with `.score` there merely because `.score` looks like the
  // newer/more-processed value — `.score` is intentionally the RIGHT choice
  // for intra-type (Feature-vs-Feature, Workflow-vs-Workflow, and
  // Feature-vs-Workflow, which share the same calibration) comparisons
  // elsewhere in this function, and the WRONG choice for Governance-vs-
  // Feature/Workflow specifically. See AI-FEAT-058's Phase 4.3 evolution
  // entry for the full empirical account (the sync-slot regression this
  // fixes) — do not "simplify" this away.
  const rawScoreById = new Map(diagnosticCandidates.map((c) => [c.id, c.rawScore]));

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

  // Stage 2 — a HOW_TO, TROUBLESHOOTING, or EXPLANATION question is better
  // served by a real Workflow record than by a Capability record's generic
  // fallback sentence, provided the workflow match is genuine evidence (>=
  // CONFIDENCE_FLOOR) and isn't clearly beaten by a strong, unambiguous
  // feature match with no comparable workflow score. TROUBLESHOOTING was
  // added after Stage 2's own testing found "My transfer stopped halfway —
  // what happens now?" (classified TROUBLESHOOTING, not HOW_TO) ignored a
  // clearly-superior AI-WF-005 match (score 500) entirely, falling through
  // to an unrelated, merely-tied feature (AI-FEAT-037, sharing nothing
  // topical, winning only the ascending-ID tiebreak) — a worse answer than
  // Stage 1 gave for the same question. EXPLANATION was added during Phase
  // 24's adversarial review after "What is a sync-slot?" (a term that only
  // exists inside AI-WF-006's own text, never in any Capability record)
  // fell through the same way to an unrelated Metadata-Sync feature tied at
  // a WEAK score, ignoring AI-WF-006's own clean, untied 200. This never
  // overrides a strong exact-title feature match with a merely-weak
  // workflow guess (workflowClearlyBeaten still gates on hasStrongFeatureMatch).
  const topWorkflow = workflowMatches[0];
  // Part 4 closure / Phase 4.3 extension (Product Owner decision) — the
  // same absolute-evidence-first principle as searchCandidates()'s `all`
  // sort, applied to this specific cross-type-but-same-calibration
  // (Feature-vs-Workflow) comparison. Matched-token ordering is valid here
  // ONLY because both topFeature and topWorkflow are keyword-overlap-tier
  // normalization participants — gated by isEligibleForNormalization,
  // never inferred from entity type alone (an exact-alias/title-tier
  // feature match, e.g. AI-FEAT-038 on "export photos to a transfer
  // drive", must fall through to the existing raw `.score` comparison
  // below unchanged). diagnosticCandidates (already computed above for
  // rawScoreById) is reused, not a second search.
  const topFeatureEligible = !!topFeature && isEligibleForNormalization(topFeature.entityType, diagnosticCandidates.find((c) => c.id === topFeature.id)?.reasons);
  const topWorkflowEligible = !!topWorkflow && isEligibleForNormalization(topWorkflow.entityType, diagnosticCandidates.find((c) => c.id === topWorkflow.id)?.reasons);
  // Hoisted from below (was computed just above the HOW_TO/TROUBLESHOOTING/
  // EXPLANATION/TEAM_ACTIVITY routing check) — needed here too as of
  // Phase C6.3's tier-mismatch fix immediately below. NAVIGATION added
  // (Section K) — see this checkpoint's NAVIGATION-routing audit: nothing
  // in the codebase documents feature-only NAVIGATION routing as a
  // deliberate design decision (unlike the boundary/authority exclusions
  // elsewhere, which cite an explicit rationale); it is simply that this
  // list was never extended to it. Corpus-wide audit (18 NAVIGATION-
  // classified questions across every corpus this checkpoint touches)
  // found multiple real cases whose best answer is a Workflow (most
  // visibly N1 — "Where do my photos actually end up after an import
  // finishes?" — see this checkpoint's N1 forensic trace: AI-WF-001 is the
  // single best-scoring candidate in the entire pool, 470.2 adjusted vs.
  // the next Feature's 320, yet was structurally invisible to primary
  // selection before this change), verified zero regression on the
  // Feature-appropriate majority (the existing score/confidence/
  // workflowClearlyBeaten gates below already require a workflow to
  // independently earn its win — most NAVIGATION questions have no
  // competing companion workflow at all, so this addition is a no-op for
  // them) via full regression across every existing corpus.
  const workflowPreferredType = qType === QUESTION_TYPES.HOW_TO || qType === QUESTION_TYPES.TROUBLESHOOTING || qType === QUESTION_TYPES.EXPLANATION || qType === QUESTION_TYPES.TEAM_ACTIVITY || qType === QUESTION_TYPES.NAVIGATION;
  let workflowClearlyBeaten;
  if (hasStrongFeatureMatch && topWorkflow && topFeatureEligible && topWorkflowEligible) {
    // Phase C6.3 (Section G/Option 1) — originalTokenCount tested here too
    // and rejected for the same reason as the `all` sort above (see that
    // comment) — reverted to matchedTokenCount(reasons) (whichever query
    // won), unchanged from pre-C6.3 behavior. This branch is nonetheless
    // exactly where N1 is actually resolved: N1's own topWorkflow
    // (AI-WF-001) independently out-scores topFeature on token count (6 vs
    // 5, both hint-derived) once NAVIGATION is included in
    // workflowPreferredType (see that flag's own comment) and this branch
    // runs at all — no provenance change was needed for N1 specifically,
    // only visibility.
    const topFeatureTokens = matchedTokenCount(diagnosticCandidates.find((c) => c.id === topFeature.id).reasons);
    const topWorkflowTokens = matchedTokenCount(diagnosticCandidates.find((c) => c.id === topWorkflow.id).reasons);
    workflowClearlyBeaten = topFeatureTokens !== topWorkflowTokens ? topFeatureTokens > topWorkflowTokens : topFeature.score > topWorkflow.score;
  } else {
    // Phase C6.3 (Section I/J, Option 3) — TESTED AND REJECTED: an earlier
    // candidate here suppressed workflowClearlyBeaten whenever topWorkflow
    // independently cleared ABSOLUTE_EVIDENCE_FLOOR_TOKENS, reasoning that
    // a Feature's higher-tier (identity-mention) score and a Workflow's
    // keyword-overlap score are not on a common calibration basis (proven
    // true for several real "wrong-workflow-competitor" cases, e.g.
    // AI-FEAT-033 beating AI-WF-004 for "steps to get missing metadata
    // fixed"). REJECTED by full-corpus regression: it also regressed Q5
    // ("How do I create a Transfer Export?", AI-FEAT-038 -> wrongly
    // AI-WF-005) and Q13 ("Why does Transfer Import exist?", AI-FEAT-039 ->
    // wrongly AI-WF-009) — C6.1's own two protected fixes, both of which
    // ALSO have a companion workflow scoring >= 2 tokens. The distinguishing
    // signal this checkpoint could NOT find a safe, non-arbitrary way to
    // express: Q5/Q13's exact-title/exact-alias feature match is the
    // record being named as ITSELF, and per this file's own
    // answerFromRecord()/findCompanionWorkflow() design, a Feature-primary
    // answer ALREADY cites its companion Workflow's steps as guidance
    // (Q5/Q13 lose no practical instructions by staying Feature-primary) —
    // whereas AI-FEAT-033's identity-mention on "metadata...archive" is a
    // much looser, more incidental phrase match with no equivalent
    // guarantee. Distinguishing "the record was deliberately named" from
    // "a generic multi-word phrase happened to match" would require either
    // a new invented threshold (forbidden, Section Q) or a change to
    // identity-mention's own matching in query.js (out of this
    // checkpoint's frozen-concept-layer scope, Section E). Left unfixed,
    // disclosed as a rejected option with its supporting evidence intact —
    // see this checkpoint's report Section 15 (rejected options).
    workflowClearlyBeaten = hasStrongFeatureMatch && (!topWorkflow || topFeature.score > topWorkflow.score);
  }

  // Part 2 remediation (Decision 1) — a bug/decision/postmortem becomes the
  // PRIMARY answer only when it is the single best piece of evidence found
  // anywhere in the whole candidate pool: a strong, untied match (the exact
  // same bar every other entity type already needs — no new classifier, no
  // separate confidence scale) that is not beaten by the top feature or
  // workflow match. This is deliberately conservative: a bare keyword-
  // overlap collision with some unrelated bug must never hijack a real
  // feature/workflow answer, but a question that IS specifically about a
  // documented defect or decision (an exact/near-exact ID or title match)
  // gets to say so, per the product owner's own worked examples (BUG-017/
  // 018 primary with AI-FEAT-007 context; DEC-021 primary with AI-FEAT-038
  // context). Checked before the boundary-precedence workflow routing below
  // since a curated NOT_SUPPORTED boundary already returned above if one
  // applied — evidence about a real, existing defect/decision is never in
  // tension with that check.
  // The tie count must be computed ACROSS every entity type at the top
  // governance score, not just within governanceMatches itself — found via
  // a real regression: "What routine maintenance does AutoIngest do on my
  // archive?" scored BUG-018 at 200 via a coincidental 2-token keyword
  // overlap, genuinely untied among bug/decision/postmortem records (so a
  // governance-only tie count called it "strong"), but that same score of
  // 200 was ALSO shared by three real, topically-relevant Planned features
  // (AI-FEAT-049/050/051) — exactly the kind of cross-type coincidence
  // matchQualityFor's tiedCount check exists to hedge against. Silently
  // preferred the bug and overrode a correct PLANNED answer with a
  // fabricated-looking PARTIALLY_AVAILABLE one.
  // Part 3 Phase 4.3 (E1-B, Approach D) — this tie count and the beat-checks
  // below are the cross-type Governance-authority gate, so they read
  // rawScoreById (common calibration basis), never the Feature/Workflow
  // entries' own (adjusted, intra-type-only) .score. topGovernance.score
  // is already raw — Governance is never normalized — so it's used as-is.
  const topGovernance = governanceMatches[0];
  const combinedTiedCount = topGovernance
    ? [...featureMatches, ...workflowMatches, ...governanceMatches].filter((m) => rawScoreById.get(m.id) === topGovernance.score).length
    : 0;
  const hasStrongGovernanceMatch = !!topGovernance && matchQualityFor(topGovernance.score, combinedTiedCount) === 'strong';
  const governanceIsBestEvidence = hasStrongGovernanceMatch
    && (!topFeature || topGovernance.score > rawScoreById.get(topFeature.id))
    && (!topWorkflow || topGovernance.score > rawScoreById.get(topWorkflow.id));
  if (governanceIsBestEvidence) {
    const searchRec = searchIndex.find((r) => r.stable_id === topGovernance.id);
    const governanceAnswer = searchRec ? answerFromGovernanceRecord(question, searchRec, governanceMatches, qType, knowledgeIndexById) : null;
    // answerFromGovernanceRecord returns null when it can't ground the
    // record in a real cited feature — falls through to the ordinary
    // feature/workflow logic below rather than answering half-grounded.
    if (governanceAnswer) return reconcileUnknownEvidenceWording(governanceAnswer, question, ctx);
  }

  // TEAM_ACTIVITY added 2026-08-14 during the event-coordination
  // reconciliation pass — this question type's own classifier regex is
  // narrowly scoped to Registry/team-live phrasing (see
  // questionClassifier.js), and AI-WF-006 is the only Workflow in that
  // domain, so broadening carries none of the cross-domain regression risk
  // the EXPLANATION broadening had to be re-verified against. Without this,
  // "What is the Online Registry for?" answered from AI-FEAT-048's generic
  // capability summary instead of AI-WF-006's specific, evidence-rich
  // collaboration-purpose content, even though guidance already cited it.
  // workflowPreferredType (NAVIGATION included, Phase C6.3 Section K) is
  // now hoisted above, next to workflowClearlyBeaten — see that comment.
  if (workflowPreferredType && topWorkflow && topWorkflow.score >= CONFIDENCE_FLOOR && !workflowClearlyBeaten && workflowIndexById) {
    const wf = workflowIndexById.get(topWorkflow.id);
    if (wf) return answerFromWorkflow(question, wf, workflowMatches, featureMatches, qType);
  }

  if (!topFeature || topFeature.score < CONFIDENCE_FLOOR) {
    return reconcileUnknownEvidenceWording(unknownAnswer(question, featureMatches, qType), question, ctx);
  }
  const knowledgeRecord = knowledgeIndexById.get(topFeature.id);
  if (!knowledgeRecord) return reconcileUnknownEvidenceWording(unknownAnswer(question, featureMatches, qType), question, ctx);

  const companionWorkflow = findCompanionWorkflow(knowledgeRecord.id, workflowIndexById, workflowMatches);
  const governanceRelationships = governanceRelationshipsForFeature(knowledgeRecord.id, authorityIndexByFeatureId, searchIndexById);
  // Part 5 Phase 5.3 (Decision 5) — computed unconditionally per Feature-
  // primary answer, same pattern as governanceRelationships above; the
  // historical-intent/materiality gate inside historicalContextForFeature()
  // itself is what keeps a non-historical question's admitted list empty,
  // not a conditional call site here.
  const historicalContext = historicalContextForFeature(knowledgeRecord.id, question, ctx);
  return answerFromRecord(question, knowledgeRecord, featureMatches, qType, companionWorkflow, governanceRelationships, historicalContext);
}

// Ask AutoIngest — Related-topic direct navigation checkpoint. Resolves a
// KNOWN, already-cited canonical record id (a value that only ever appears
// in an existing answer's own relatedCapabilities/sources array -- never
// operator-typed text) directly against the two id-keyed indexes this
// engine already builds, and formats it with the SAME existing
// answerFromRecord()/answerFromWorkflow() synthesis the ordinary retrieval
// path (answerQuestion(), above) already uses -- no runQuery(), no
// searchCandidates(), no second ranking mechanism, no new answer shape.
// The synthetic single-entry `matches` array below stands in for retrieval
// evidence with the maximum possible score (a direct id lookup IS the
// strongest possible evidence -- there is no stronger signal than "this is
// the exact record"), so matchQualityFor() deterministically resolves it
// to 'strong' via its own unmodified thresholds, never a new quality tier.
//
// classification is set to the real QUESTION_TYPES.CAPABILITY /
// QUESTION_TYPES.HOW_TO constants (not a new "direct nav" pseudo-type) so
// that capabilityAuthority.js's own unmodified shouldApplyCapabilityAuthority()
// scope predicate applies exactly the SAME authority-sensitivity gate to a
// Feature-primary direct navigation as it would to an ordinary "does
// AutoIngest support X" question about that exact feature -- the local
// judge/model is invoked here if and only if it would be for a normal
// question resolving to this same record, never unconditionally.
//
// historicalContext is deliberately omitted (passed null) -- there is no
// natural-language question text to run historicalContextForFeature()'s
// own materiality gate against for a direct id lookup, so this simply
// never admits historical material for this path, rather than inventing a
// synthetic question to feed that gate.
//
// Returns null when the id resolves to neither index (a data-integrity
// edge case the caller must handle, e.g. a stale/removed record) --
// deliberately NOT a fallback to fuzzy search over the record's own title,
// per this checkpoint's explicit instruction.
function answerForKnownRecord(recordId, ctx) {
  const { knowledgeIndexById, workflowIndexById, authorityIndexByFeatureId, searchIndexById } = ctx;
  const feature = knowledgeIndexById ? knowledgeIndexById.get(recordId) : null;
  if (feature) {
    const matches = [{ id: feature.id, title: feature.title, score: 1000, entityType: 'feature' }];
    const companionWorkflow = findCompanionWorkflow(feature.id, workflowIndexById);
    const governanceRelationships = governanceRelationshipsForFeature(feature.id, authorityIndexByFeatureId, searchIndexById);
    return answerFromRecord(feature.title, feature, matches, QUESTION_TYPES.CAPABILITY, companionWorkflow, governanceRelationships, null);
  }
  const workflow = workflowIndexById ? workflowIndexById.get(recordId) : null;
  if (workflow) {
    const matches = [{ id: workflow.id, title: workflow.title, score: 1000, entityType: 'workflow' }];
    return answerFromWorkflow(workflow.title, workflow, matches, [], QUESTION_TYPES.HOW_TO);
  }
  return null;
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
    // Part 5 Phase 5.1 (Decision 4) — the SAME already-built, already-
    // fidelity-audited projection lib/authorityTopics.js's buildAuthorityIndex()
    // produces (reused, never reparsed here). Feature entries only —
    // Workflow entries in the same array carry no relatedBugs/relatedDecisions/
    // relatedPostmortems fields at all (their own canonical header table has
    // no such columns; see governanceRelationshipsForFeature's own comment).
    authorityIndexByFeatureId: new Map(built.authorityIndex.filter((e) => e.recordType === 'feature').map((e) => [e.featureId, e])),
    // Resolves a governance record's title/canonical path for citation —
    // reuses the shared search index (already has every entity type's
    // title/canonical_path), the same lookup answerFromGovernanceRecord()
    // already performs via a linear searchIndex.find(), just memoized once.
    searchIndexById: new Map(built.searchIndex.map((r) => [r.stable_id, r])),
    // Part 5 Phase 5.3 (Decision 5) — the same already-built, already-parsed
    // lib/memoryIndex.js projection (never reparsed here). searchIndex's own
    // 'memory' records carry only a title/summary/relatedIds/evidenceStatus
    // projection (lib/searchIndex.js's rec() shape); this map exposes the
    // FULLER memoryIndex record (revision_count, rejected_approaches,
    // unresolved_items, evidence_classification) that
    // lib/knowledgeHistoricalContext.js's materiality/evidence-qualification
    // checks need but the flat search index doesn't carry.
    memoryIndexById: new Map((built.memoryIndex || []).map((r) => [r.memory_id, r])),
  };
}

// Part 3 Phase 4.3 (Decision 2) — diagnostic-only observability seam. Runs
// the exact same candidate discovery searchCandidates() already performs
// (raw question + concept hints, through the unmodified shared ranker) and
// returns, per candidate, the full breakdown named in Phase 4.3's
// observability requirement: raw score/tier, absolute matching evidence,
// surface-size measurement, the normalization adjustment, and why. Never
// consulted by answerQuestion() itself — this exists solely so the
// transformation can be inspected without reverse-engineering it, per the
// same "diagnostic observability, not a second implementation" discipline
// established for the Phase 4.1 A/B/C/D framework.
function explainNormalization(question, searchIndex) {
  const { diagnosticCandidates } = searchCandidates(question, searchIndex);
  return diagnosticCandidates
    .map((c) => explainCandidate({ id: c.id, entityType: c.entityType, score: c.rawScore, reasons: c.reasons, surfaceSize: c.surfaceSize }, CONFIDENCE_FLOOR))
    .sort((a, b) => b.adjustedScore - a.adjustedScore || a.id.localeCompare(b.id, 'en', { numeric: true }));
}

// Part 5 Phase 5.1 (Decision 4) — diagnostic-only observability seam,
// same discipline as explainNormalization() above: runs the real
// answerQuestion() pipeline and reports what it actually did, never a
// second implementation of relationship lookup. Never consulted by
// answerQuestion() itself. For each canonically-related Decision/Postmortem
// on the resolved primary record (Feature-primary only — see the "workflow"
// case below), reports:
//   - canonicalSource: the related record's own id/title/canonical path
//   - relationshipType: 'feature-decision' | 'feature-postmortem'
//   - projectionSource: always 'authorityTopics.js buildAuthorityIndex()'
//     (never a second parse)
//   - visibility: always 'visible-not-admitted' in this phase — appears in
//     `sources` (supporting context) but never in `matchedCapabilities`
//     (scored candidates) and never influences which record is primary
//   - influencedRanking: always false, provably — this function reads the
//     already-finalized answer.matchedCapabilities/matches[0] score,
//     computed entirely before any relationship lookup runs
function explainRelationships(question, ctx) {
  const answer = answerQuestion(question, ctx);
  const primary = answer.matchedCapabilities[0];
  if (!primary) return { primaryId: null, relationships: [], influencedRanking: false };
  if (primary.entityType !== 'feature') {
    // Workflow-primary (or Governance-primary): Decision 4's canonical
    // evidence covers Feature -> Decision/Postmortem only — a Workflow's
    // own header table has no relatedDecisions/relatedPostmortems columns
    // (verified against the schema during the Phase 5.1 investigation), so
    // there is no canonical basis to report a relationship here. Reporting
    // none is the evidence-respecting answer, not a gap.
    return { primaryId: primary.id, relationships: [], influencedRanking: false, note: `${primary.entityType}-primary: no canonical Governance-relationship field exists for this entity type in Phase 5.1's schema.` };
  }
  const rels = governanceRelationshipsForFeature(primary.id, ctx.authorityIndexByFeatureId, ctx.searchIndexById);
  const relationships = [
    ...rels.decisions.map((d) => ({ canonicalSource: d, relationshipType: 'feature-decision', projectionSource: 'authorityTopics.js buildAuthorityIndex()', visibility: 'visible-not-admitted' })),
    ...rels.postmortems.map((p) => ({ canonicalSource: p, relationshipType: 'feature-postmortem', projectionSource: 'authorityTopics.js buildAuthorityIndex()', visibility: 'visible-not-admitted' })),
  ];
  return { primaryId: primary.id, relationships, influencedRanking: false };
}

// Part 5 Phase 5.2 (Decision 3) — diagnostic-only observability seam, same
// discipline as explainNormalization()/explainRelationships() above: runs
// the real answerQuestion() once and labels what it already produced
// (see lib/knowledgeNeighborhood.js's own header for the full rationale).
// Never consulted by answerQuestion() itself.
function explainNeighborhood(question, ctx) {
  const answer = answerQuestion(question, ctx);
  return labelNeighborhood(question, answer, ctx);
}

// Part 5 Phase 5.3 (Decision 5) — read-only observability seam, same shape
// as explainNormalization()/explainRelationships()/explainNeighborhood()
// above (runs the real answerQuestion() once and reports on it) — but
// UNLIKE those three, its underlying admission logic (historicalContextForFeature(),
// called from answerFromRecord() above) IS consulted by answerQuestion()
// itself, not diagnostic-only; this wrapper's own added value is exposing
// the REJECTED candidates and their reasons, which the real answer object
// never carries. See lib/knowledgeHistoricalContext.js's own header for the
// full rationale.
function explainHistoricalContext(question, ctx) {
  const answer = answerQuestion(question, ctx);
  return labelHistoricalContext(question, answer, ctx, CONFIDENCE_FLOOR, matchQualityFor);
}

module.exports = {
  answerQuestion,
  answerForKnownRecord,
  classifyIntent,
  knowledgeIndexMap,
  workflowIndexMap,
  buildEngineContext,
  CONFIDENCE_FLOOR,
  STRONG_MATCH_FLOOR,
  QUESTION_TYPES,
  classifyQuestion,
  explainNormalization,
  explainRelationships,
  governanceRelationshipsForFeature,
  explainNeighborhood,
  explainHistoricalContext,
  reconcileUnknownEvidenceWording,
};
