'use strict';

// ASK AUTOINGEST — ARCHITECTURE-RESET CHECKPOINT (Phase 3/4/10). EXPERIMENTAL.
//
// The trusted knowledge-tool surface the LLM orchestrator is allowed to
// call. Everything in this file is a thin wrapper over ALREADY-EXISTING,
// UNMODIFIED deterministic/production modules -- this file adds NO new
// retrieval, ranking, or authority logic of its own. Its only job is to
// reshape existing outputs into small, structured, tool-call-friendly
// results and to withhold anything the LLM must not be handed directly
// (raw source paths, full KnowledgeRecord dumps, capability decisions
// bundled together with search results).
//
// Four tools, deliberately small and composable (Phase 4 instruction:
// "prefer a small number of composable tools rather than dozens of
// feature-specific functions"):
//
//   search_knowledge      -- "what might this be about?" (candidates only,
//                             no capability decision, no prose answer)
//   get_knowledge         -- "tell me these specific facets of X" (LLM
//                             picks the dimensions; Knowledge Model
//                             supplies/validates the facts)
//   get_capability_status -- "does X actually exist?" (the ONE
//                             authoritative, non-negotiable answer the LLM
//                             may never override)
//   get_roadmap_status    -- (Checkpoint 6, Phase 1C) the authoritative
//                             project roadmap/dashboard, for open-ended
//                             "what's next"-style questions no named
//                             subject id can answer -- see its own header
//                             comment below.

const { answerQuestion, answerForKnownRecord } = require('../../lib/knowledgeEngine');
const { answerKnownRecordWithAuthority } = require('../../lib/answerWithAuthority');
const { findAllByFeatureId } = require('../../lib/knowledgeModel/index');

const VALID_DIMENSIONS = [
  'purpose', 'behavior', 'operatorWorkflow', 'preconditions',
  'actions', 'recovery', 'limitations', 'relationships', 'technicalDetail',
];

function dedupJoin(strings, sep) {
  return [...new Set((strings || []).filter(Boolean))].join(sep);
}

function titleFor(id, ctx) {
  const f = ctx.knowledgeIndexById && ctx.knowledgeIndexById.get(id);
  if (f) return f.title || id;
  const w = ctx.workflowIndexById && ctx.workflowIndexById.get(id);
  if (w) return w.title || id;
  return id;
}

const PURPOSE_SNIPPET_CHARS = 180;
function truncateSnippet(text) {
  const t = String(text || '').trim();
  if (t.length <= PURPOSE_SNIPPET_CHARS) return t;
  const cut = t.slice(0, PURPOSE_SNIPPET_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 40 ? cut.slice(0, lastSpace) : cut) + '...';
}

// Checkpoint 7, Phase 4: a short "what is this" snippet per candidate, so
// the LLM can sanity-check relevance from search_knowledge's results alone
// rather than needing a full get_knowledge call just to rule a candidate
// in or out. Prefers the Knowledge Model's own authored `purpose` (short,
// operator-facing by design); falls back to the underlying feature/
// workflow index's own summary (longer, written for documentation, still
// usable truncated).
function purposeFor(id, ctx) {
  const km = findAllByFeatureId(id);
  if (km.length && km[0].purpose) return truncateSnippet(km[0].purpose);
  const f = ctx.knowledgeIndexById && ctx.knowledgeIndexById.get(id);
  if (f && f.summary) return truncateSnippet(f.summary);
  const w = ctx.workflowIndexById && ctx.workflowIndexById.get(id);
  if (w && w.whatItDoes) return truncateSnippet(w.whatItDoes);
  return null;
}

// --- Tool 1: search_knowledge ----------------------------------------------
//
// INPUT:      { query: string }
// OUTPUT:     { results: [{ id, title, kind, matchQuality }] }  (max 5)
// AUTHORITATIVE SOURCE: the existing deterministic ranker
//   (knowledgeEngine.answerQuestion -> matchedCapabilities/sources) merged
//   with the existing semantic embedding index (unchanged, real BGE model).
// CAN RETURN UNKNOWN?: yes -- an empty `results` array is itself meaningful
//   ("nothing plausible found"); this tool never invents a candidate.
// PROVENANCE: none asserted here -- these are CANDIDATES, not facts.
// SAFETY BOUNDARY: deliberately withholds capabilityStatus and any prose.
//   Returning "AVAILABLE"/"NOT_SUPPORTED" alongside a fuzzy search result
//   would let the LLM treat a retrieval guess as an authoritative decision
//   without ever calling get_capability_status -- exactly the failure mode
//   this architecture reset is meant to remove. Titles/ids/kind only.
//
// Checkpoint 6, Phase 1B addition: raw relevance `score` exposed per
// candidate (sorted descending), plus a fixed advisory note. Root-caused
// via a dedicated 16-case paraphrase diagnostic (not the literal B15
// wording): 7/16 (44%) of paraphrased queries against six different real
// features never surfaced the correct id in the top 5 at all -- a RECALL
// weakness in the inherited, unmodified deterministic ranker
// (knowledgeEngine.answerQuestion), not an LLM candidate-selection
// problem, and not something this checkpoint may fix by touching the
// corpus or the ranker itself (explicitly out of scope).
//
// A numeric "confidence" derived from the score margin between the top two
// candidates was BUILT AND MEASURED, then deliberately DROPPED: on the same
// 16-case diagnostic, the top1/top2 score ratio did not reliably separate
// genuine hits from misses (several correct matches scored a LOWER margin
// than several wrong ones -- e.g. a real hit at ratio 1.38 vs a real miss
// at ratio 1.80) -- shipping a threshold on this signal would have been a
// mis-calibrated heuristic dressed up as a real safeguard, and would have
// traded one failure mode (confident wrong guidance) for another (excessive
// unnecessary re-search/clarification on perfectly good matches, exactly
// what Phase 1D warns against). This negative result is disclosed rather
// than hidden -- see this checkpoint's report.
//
// Instead: raw scores are exposed (a real, existing fact, not an invented
// label) and the semantic-relevance judgment -- "does this title actually,
// plausibly match what the operator described?" -- is left to the LLM's
// own reasoning (engine.js's system prompt makes this explicit), which can
// actually read "Grouping System" against "detect duplicate files
// automatically" and recognize a mismatch a numeric score cannot capture.
//
// Checkpoint 7, Phase 3/4/5 finding and fix: B15's failure was forensically
// traced (not assumed) to the deterministic ranker having ZERO recall of
// AI-FEAT-020 (Duplicate Detection) for that exact query -- it is not
// merely low-ranked or truncated by the top-5 cap; it is entirely absent
// from both matchedCapabilities and sources. The Knowledge Model's own
// record for it is real and well-authored, ruling out inadequate KM
// representation. This is a lexical/terminology-mismatch recall gap in the
// inherited ranker, exactly the failure mode semantic embedding retrieval
// exists to catch -- verified directly: the same query scores AI-FEAT-020
// at 0.86 cosine similarity, a clear #1, via the existing, unmodified,
// already-validated C7/C8 embedding infrastructure (see
// semanticRetrieval.js's own header for why that infrastructure was
// available all along and only needed a non-Electron index-directory
// substitute, not a new implementation). search_knowledge now merges BOTH
// candidate sources and exposes each candidate's origin(s), its
// deterministic score, its semantic score (when available), and a short
// purpose snippet -- enough for the LLM to reason about fit itself,
// per Phase 4's explicit instruction not to make any single score an
// arbitrary truth threshold.
async function searchKnowledge({ query }, ctx, options) {
  const q = String(query || '').trim();
  if (!q) return { results: [] };

  const answer = answerQuestion(q, ctx);
  const seen = new Map();
  // Checkpoint 6 fix (found during dev-set shakeout, DC6_11): the
  // deterministic ranker's matchedCapabilities/sources can include
  // governance entities (BUG-*/DEC-*/PM-*) alongside real operator-facing
  // features/workflows -- e.g. a genuinely unsupported capability query
  // returns ONLY bug/decision records (real evidence the ranker found, but
  // not a "candidate subject" in any sense an operator's question means).
  // Offering those as if they were searchable subjects caused
  // get_capability_status to be called against a bug id and produced a
  // stalled, non-answering turn. Filtered to feature/workflow entities
  // only -- an empty result set is itself meaningful ("no candidate
  // subject found"), not a tool defect to work around.
  for (const c of [...(answer.matchedCapabilities || []), ...(answer.sources || [])]) {
    if (!c || !c.id || seen.has(c.id)) continue;
    if (c.entityType && c.entityType !== 'feature' && c.entityType !== 'workflow') continue;
    if (!/^AI-(FEAT|WF)-\d+$/.test(c.id)) continue;
    seen.set(c.id, {
      id: c.id, title: titleFor(c.id, ctx), kind: c.id.startsWith('AI-WF-') ? 'workflow' : 'feature',
      deterministicScore: typeof c.score === 'number' ? Math.round(c.score) : null,
      semanticScore: null, foundVia: ['deterministic'],
    });
  }

  if (options.semanticTopK) {
    try {
      const semTop = await options.semanticTopK(q, 8);
      for (const s of semTop || []) {
        const id = s && s.id;
        if (!id) continue;
        const semScore = typeof s.score === 'number' ? Math.round(s.score * 1000) / 1000 : null;
        const existing = seen.get(id);
        if (existing) {
          existing.semanticScore = semScore;
          existing.foundVia.push('semantic');
        } else {
          seen.set(id, {
            id, title: titleFor(id, ctx), kind: id.startsWith('AI-WF-') ? 'workflow' : 'feature',
            deterministicScore: null, semanticScore: semScore, foundVia: ['semantic'],
          });
        }
      }
    } catch { /* semantic retrieval is supplementary; never blocks search */ }
  }

  // Rank by whichever signal is present, preferring a candidate found by
  // BOTH sources, then by deterministic score, then by semantic score --
  // purely a display order, never a cutoff (every candidate found by
  // either source is returned; nothing is dropped for scoring low).
  const ranked = [...seen.values()].sort((a, b) => {
    const bothA = a.foundVia.length > 1 ? 1 : 0;
    const bothB = b.foundVia.length > 1 ? 1 : 0;
    if (bothA !== bothB) return bothB - bothA;
    return (b.deterministicScore || 0) - (a.deterministicScore || 0) || (b.semanticScore || 0) - (a.semanticScore || 0);
  });
  const results = ranked.slice(0, 8).map((r) => ({ ...r, purpose: purposeFor(r.id, ctx) }));
  const note = results.length
    ? 'These are candidates ranked by fuzzy lexical and/or semantic similarity, not verified relevance -- the top-ranked title is not always the right one. Read each candidate\'s purpose snippet and check it plausibly matches what the operator actually described before relying on it. If several candidates could plausibly fit, or none clearly do, get_knowledge on more than one before deciding, search again with different wording, or ask the operator.'
    : 'No candidates found from either search method.';
  return { results, note };
}

// --- Tool 2: get_knowledge --------------------------------------------------
//
// INPUT:      { id: string, dimensions: string[] }  (dimensions from
//              VALID_DIMENSIONS above -- the LLM chooses which ones it needs)
// OUTPUT:     { id, extractionTier, dimensions: { <dim>: text|null } }
// AUTHORITATIVE SOURCE: the existing, unmodified Knowledge Model
//   (scripts/product-docs/lib/knowledgeModel) -- same forensic-verified /
//   registry-reshaped records production's evidence-shaping integration
//   already uses. This tool adds no new content, only per-dimension
//   selection driven by the CALLER (the LLM) instead of by
//   questionClassifier.js's fixed per-type table.
// CAN RETURN UNKNOWN?: yes, per dimension -- an unestablished dimension
//   returns an explicit "not established" string, never silent omission
//   (mirrors the existing Knowledge Model's own anti-silent-omission rule).
// PROVENANCE: `extractionTier` per merged record set (forensic-verified /
//   registry-reshaped / mixed).
// SAFETY BOUNDARY: `technicalDetail` is requestable like any other
//   dimension -- production's automatic technical-question gate is
//   deliberately NOT reproduced here (Phase 9: technical content should be
//   something the LLM deliberately requests). The backstop against
//   ACCIDENTAL technical leakage is the post-hoc validator (validator.js),
//   not a pre-emptive withholding at the tool layer.
function getKnowledge({ id, dimensions }, ctx) {
  const records = findAllByFeatureId(id);
  if (!records.length) {
    return { id, extractionTier: null, dimensions: {}, note: 'No Knowledge Model record exists for this id.' };
  }
  const requested = (Array.isArray(dimensions) ? dimensions : []).filter((d) => VALID_DIMENSIONS.includes(d));
  const out = {};
  for (const dim of requested.length ? requested : VALID_DIMENSIONS.slice(0, 2)) {
    let text = null;
    if (dim === 'purpose') text = dedupJoin(records.map((r) => r.purpose), ' ');
    else if (dim === 'behavior') text = dedupJoin(records.map((r) => r.behavior), ' ');
    else if (dim === 'operatorWorkflow') text = dedupJoin(records.flatMap((r) => r.operatorWorkflow), ' | ');
    else if (dim === 'preconditions') text = dedupJoin(records.flatMap((r) => r.preconditions), ' | ');
    else if (dim === 'actions') text = dedupJoin(records.flatMap((r) => r.actions.map((a) => `${a.label}: ${a.description}`)), ' | ');
    else if (dim === 'recovery') text = dedupJoin(records.map((r) => r.recovery), ' ');
    else if (dim === 'limitations') text = dedupJoin(records.flatMap((r) => r.limitations), ' | ');
    else if (dim === 'relationships') text = dedupJoin(records.flatMap((r) => r.relationships.map((rel) => `${rel.type} ${rel.targetId}: ${rel.note}`)), ' | ');
    else if (dim === 'technicalDetail') text = dedupJoin(records.map((r) => r.technicalDetail), ' ');
    out[dim] = text || 'Not established in AutoIngest\'s evidence -- do not guess at this.';
  }
  const extractionTier = records.every((r) => r.extractionTier === 'forensic-verified')
    ? 'forensic-verified'
    : (records.some((r) => r.extractionTier === 'forensic-verified') ? 'mixed' : 'registry-reshaped');
  return { id, extractionTier, dimensions: out };
}

// --- Tool 3: get_capability_status -----------------------------------------
//
// INPUT:      { id: string }
// OUTPUT:     { id, status: 'AVAILABLE'|'NOT_SUPPORTED'|'PLANNED'|'UNKNOWN', provenance: string[] }
// AUTHORITATIVE SOURCE: the existing, unmodified deterministic engine
//   (answerForKnownRecord) plus the existing, unmodified authority/judge
//   layer (answerKnownRecordWithAuthority) -- the SAME mechanism production
//   already trusts for capability truth, invoked explicitly instead of
//   automatically pre-decided before the LLM runs.
// CAN RETURN UNKNOWN?: yes -- and UNKNOWN here is itself the authoritative
//   answer, not a retrieval failure to route around.
// PROVENANCE: `answer.sources` ids, passed through verbatim.
// SAFETY BOUNDARY: this is the ONE tool result the LLM must never
//   contradict in its final answer. The post-hoc validator checks the
//   final answer's capability claim (if any) against the most recent
//   get_capability_status result for the same id.
async function getCapabilityStatus({ id }, ctx) {
  const base = answerForKnownRecord(id, ctx);
  if (!base) return { id, status: 'UNKNOWN', provenance: [] };
  const withAuthority = await answerKnownRecordWithAuthority(id, ctx);
  const answer = withAuthority || base;
  return {
    id,
    status: answer.capabilityStatus,
    provenance: (answer.sources || []).map((s) => s.id).filter(Boolean),
    limitations: answer.limitations || [],
  };
}

// --- Tool 4: get_roadmap_status ---------------------------------------------
//
// INPUT:      { query?: string }  (optional -- name a specific subject to
//              check whether/when it's planned; omit for the general state)
// OUTPUT:     { totalMilestones, completedCount, progressPercent, milestones:
//              [{name, status, objective, plannedEstimate, nextAction}],
//              matchedSubjectMilestone?: {...} }
// AUTHORITATIVE SOURCE: the existing, unmodified roadmap dashboard
//   (ctx.dashboard, built from docs/product/02_MASTER_ROADMAP.md by the
//   existing build pipeline) -- the exact same data knowledgeEngine.js's
//   own roadmapAnswer() already uses for CLASSIFIED roadmap questions. This
//   tool adds no new roadmap logic; it exposes the SAME authoritative data
//   directly to the LLM instead of requiring questionClassifier.js to have
//   pre-classified the question as ROADMAP before that data becomes
//   reachable at all.
// CAN RETURN UNKNOWN?: yes -- {totalMilestones: 0} if no dashboard exists.
// PROVENANCE: implicit in the milestone/feature ids returned (never shown
//   to the operator directly; same discipline as the other three tools).
// SAFETY BOUNDARY: deliberately NARROW -- returns only the roadmap
//   dashboard's own structured fields (milestone name/status/objective/
//   estimate/next-action), never raw source paths or unrelated repository
//   content. Does not hardcode any answer text; the LLM decides what's
//   relevant to the operator's actual question from the returned data.
//   Checkpoint 6 addition (Phase 1C) -- closes the gap found in Checkpoint
//   5 (L_roadmap: "What's coming next?" made zero tool calls because no
//   tool existed for an open-ended, subject-less roadmap question; a
//   NAMED-subject roadmap question like "Is the Archive Browser available
//   yet?" already worked via get_capability_status and is unaffected).
function getRoadmapStatus({ query }, ctx) {
  const dashboard = ctx.dashboard;
  if (!dashboard) return { totalMilestones: 0, milestones: [], note: 'No roadmap data available.' };
  const milestones = (dashboard.milestones || []).map((m) => ({
    name: m.name,
    status: m.status,
    objective: m.objective,
    plannedEstimate: m.planned_estimate,
    nextAction: m.next_action,
  }));
  const out = {
    totalMilestones: dashboard.total_milestones,
    completedCount: dashboard.completed_count,
    progressPercent: dashboard.progress_percent,
    milestones,
  };
  const q = String(query || '').trim();
  if (q) {
    const matched = answerQuestion(q, ctx);
    const topId = matched.matchedCapabilities && matched.matchedCapabilities[0] && matched.matchedCapabilities[0].id;
    if (topId) {
      const owning = (dashboard.milestones || []).find((m) => (m.included_features || []).includes(topId) || (m.existing_features_extended || []).includes(topId));
      if (owning) {
        out.matchedSubjectMilestone = { name: owning.name, status: owning.status, plannedEstimate: owning.planned_estimate, nextAction: owning.next_action };
      }
    }
  }
  return out;
}

// node-llama-cpp GBNF-JSON-schema param defs for defineChatSessionFunction.
function buildToolDefinitions(ctx, options) {
  return {
    search_knowledge: {
      description: 'Search AutoIngest\'s trusted knowledge for candidate subjects (features/workflows) that might relate to what the operator is asking about, using both lexical and semantic matching. Returns each candidate\'s title, a short purpose snippet, and how it was found -- never a capability decision or prose answer. Call this first when you are not yet sure which AutoIngest capability the operator means. If the results don\'t clearly fit, try again with different, simpler wording before picking a candidate.',
      params: { type: 'object', properties: { query: { type: 'string', description: 'A short search phrase describing what the operator seems to be asking about.' } }, required: ['query'] },
      handlerImpl: (params) => searchKnowledge(params, ctx, options),
    },
    get_knowledge: {
      description: 'Fetch specific trusted facts about one AutoIngest subject (by id from search_knowledge). Choose only the dimensions you actually need: purpose, behavior, operatorWorkflow, preconditions, actions, recovery, limitations, relationships, technicalDetail. Request technicalDetail ONLY if the operator explicitly asked a technical/implementation question.',
      params: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The subject id returned by search_knowledge.' },
          dimensions: { type: 'array', items: { type: 'string', enum: VALID_DIMENSIONS }, description: 'Which facets to retrieve.' },
        },
        required: ['id', 'dimensions'],
      },
      handlerImpl: (params) => getKnowledge(params, ctx),
    },
    get_capability_status: {
      description: 'Get the AUTHORITATIVE status of one AutoIngest capability (by id): AVAILABLE, NOT_SUPPORTED, PLANNED, or UNKNOWN. You must call this before asserting whether AutoIngest supports something, and you must never contradict what it returns.',
      params: { type: 'object', properties: { id: { type: 'string', description: 'The subject id returned by search_knowledge.' } }, required: ['id'] },
      handlerImpl: (params) => getCapabilityStatus(params, ctx),
    },
    get_roadmap_status: {
      description: 'Get the AUTHORITATIVE AutoIngest development roadmap: what is already completed, what is being worked on next, what is planned after that, and (optionally) whether a specific named subject is planned/completed. Use this for open-ended questions like "what\'s next", "what are we working on", "what\'s coming later", or "has X been completed" -- NOT for questions about whether an already-shipped feature works a certain way (use search_knowledge/get_capability_status for that).',
      params: { type: 'object', properties: { query: { type: 'string', description: 'Optional: name a specific subject to check its roadmap status; omit for the general roadmap state.' } } },
      handlerImpl: (params) => getRoadmapStatus(params || {}, ctx),
    },
  };
}

module.exports = { searchKnowledge, getKnowledge, getCapabilityStatus, getRoadmapStatus, buildToolDefinitions, VALID_DIMENSIONS };
