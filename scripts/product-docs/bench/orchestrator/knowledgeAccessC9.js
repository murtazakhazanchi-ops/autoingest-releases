'use strict';

// ASK AUTOINGEST — CHECKPOINT 9: ONE BRAIN, ONE ASSISTANT. EXPERIMENTAL,
// ISOLATED PROTOTYPE. Not wired to production/conversationalAsk.js.
//
// Replaces Checkpoint 7/8's tools.js (kept byte-identical, untouched, still
// the frozen C7/C8 control) with a session-scoped, HANDLE-based knowledge
// interface. Two architectural changes from tools.js, both directed by the
// Product Owner's Checkpoint 9 brief:
//
//   1. NO SECOND LEARNED MODEL. tools.js's search_knowledge merged the
//      deterministic ranker with a real BGE embedding index
//      (semanticRetrieval.js). This file calls semanticRetrieval.js
//      NOWHERE -- the only retrieval signal is the existing, unmodified,
//      genuinely-non-ML deterministic ranker (knowledgeEngine.js --
//      "still deterministic, still no embeddings", its own header, verified
//      by direct source read this checkpoint) plus two additions, both
//      deterministic software, neither a learned model:
//        (a) lib/candidateRecall.js -- a real, already-built, already-
//            reasoned-through recall-boost module (Checkpoint "C6.5" of
//            the pre-existing production-adjacent infrastructure) that
//            turned out, on inspection, to be built but never actually
//            wired into knowledgeEngine.js's live search path. Wired in
//            HERE (require-only, zero modification to that file or to
//            knowledgeEngine.js) as a last-resort candidate-admission
//            check, exactly the seam its own header comment describes.
//        (b) a full-catalogue fallback (Phase 2, Option B of the
//            checkpoint brief: "the LLM is given a compact knowledge
//            catalogue/index and chooses what knowledge to inspect") --
//            when deterministic + recall-surface candidates are empty or
//            very weak, search_autoingest returns the FULL list of every
//            feature/workflow title + one-line purpose (67 entries, small
//            enough to reason over directly) instead of nothing, so the
//            SAME conversational LLM's own language understanding -- not
//            a second model -- gets a chance to recognize a match a
//            token-overlap ranker cannot. Measured, not assumed: see the
//            checkpoint report's retrieval-diagnostic section for whether
//            this actually recovers recall BGE used to provide.
//
//   2. NO REAL REPOSITORY IDS REACH THE LLM. tools.js's search_knowledge
//      returned real ids (AI-FEAT-038, etc) and expected the LLM to pass
//      that same real id back into get_knowledge/get_capability_status --
//      exactly the "invent/select internal ids" cognitive burden Checkpoint
//      9's brief names as unnecessary overhead. This file issues
//      SESSION-SCOPED HANDLES (H1, H2, ...) instead, via HandleSession
//      below. The LLM never sees an AI-FEAT-###/AI-WF-### id. An invalid
//      handle (never issued, or issued in a different conversation) is a
//      PROTOCOL ERROR, structurally distinct in shape from "no detailed
//      record exists for this real id" and from "capability status:
//      NOT_SUPPORTED" -- Phase 5's mandatory invariant: not-found is never
//      capability truth. See readAutoIngest()/capabilityStatus() below.

const { answerQuestion, answerForKnownRecord } = require('../../lib/knowledgeEngine');
const { answerKnownRecordWithAuthority } = require('../../lib/answerWithAuthority');
const { findAllByFeatureId } = require('../../lib/knowledgeModel/index');
const { buildRecallSurfaceIndex, admitRecallCandidates } = require('../../lib/candidateRecall');

const VALID_DIMENSIONS = [
  'purpose', 'behavior', 'operatorWorkflow', 'preconditions',
  'actions', 'recovery', 'limitations', 'relationships', 'technicalDetail',
];

// --- Session-scoped handle manager -----------------------------------------
//
// One instance per conversation (created alongside the LlamaChatSession in
// engineC9.js's createConversation(), never shared across conversations).
// Handles are stable within a conversation -- searching for the same real
// subject twice in one conversation returns the SAME handle, so a
// follow-up turn's earlier handle stays valid for read_autoingest/
// capability_status without needing to re-search.
//
// Format deliberately distinctive ("H<n>", never colliding with any real
// AI-FEAT-###/AI-WF-###/KM-### id shape) so an accidental leak of a raw
// handle to the operator is trivially, structurally detectable -- see
// validatorC9.js's HANDLE_LEAK_RE, a new, disclosed structural check this
// checkpoint adds for exactly this reason.
class HandleSession {
  constructor() {
    this._byHandle = new Map(); // handle -> realId
    this._byRealId = new Map(); // realId -> handle
    this._counter = 0;
    // Forensic finding this checkpoint: a fixed "candidates.length < 2"
    // catalogue-fallback threshold (see searchAutoIngest below) never
    // triggers when 2+ WRONG candidates are found alongside a genuine
    // recall miss (exactly the B15-class paraphrase case -- "detect
    // duplicate files automatically" for AI-FEAT-020, still failing on
    // direct measurement even with candidateRecall.js wired in). Tracked
    // here, per conversation: once the model searches a SECOND time with
    // different query text, that is itself a signal the first attempt
    // didn't satisfy it -- Phase 11's own named test case
    // ("weak-search->re-search"). The catalogue is included on that
    // second-and-later distinct search regardless of candidate count.
    this._distinctSearchQueries = new Set();
  }

  issue(realId) {
    if (this._byRealId.has(realId)) return this._byRealId.get(realId);
    this._counter += 1;
    const handle = `H${this._counter}`;
    this._byHandle.set(handle, realId);
    this._byRealId.set(realId, handle);
    return handle;
  }

  // Returns the real id, or null if this handle was never issued in THIS
  // conversation. null is a PROTOCOL error, not a capability signal -- see
  // callers below, both of which return a distinctly-shaped error object
  // rather than silently falling through to "not found"/"not supported".
  resolve(handle) {
    return this._byHandle.get(String(handle || '')) || null;
  }

  // Returns true if a DIFFERENT search query was already issued earlier in
  // this same conversation -- i.e. this is a repeat/retry search, not the
  // first attempt.
  noteSearchAndCheckRepeat(query) {
    const norm = String(query || '').trim().toLowerCase();
    const isRepeat = this._distinctSearchQueries.size > 0 && !this._distinctSearchQueries.has(norm);
    this._distinctSearchQueries.add(norm);
    return isRepeat;
  }
}

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

function purposeFor(id, ctx) {
  const km = findAllByFeatureId(id);
  if (km.length && km[0].purpose) return truncateSnippet(km[0].purpose);
  const f = ctx.knowledgeIndexById && ctx.knowledgeIndexById.get(id);
  if (f && f.summary) return truncateSnippet(f.summary);
  const w = ctx.workflowIndexById && ctx.workflowIndexById.get(id);
  if (w && w.whatItDoes) return truncateSnippet(w.whatItDoes);
  return null;
}

// Phase 8 (checkpoint brief): "If the LLM does not need internal
// information to answer the operator, do not put that information into
// its context. Prevent leakage by information architecture first,
// validator second." Forensic finding THIS checkpoint (see the report's
// knowledge-base audit section): 34 of 66 Knowledge Model records' own
// `technicalDetail` field contains raw source file paths, line-number
// ranges, and bare function-call references directly in its prose (e.g.
// KM-transfer-export: "services/transferExportService.js:31-34,340-361",
// "resumeExportFromCheckpoint()") -- confirmed, by direct inspection, to be
// the SAME content Checkpoint 8's G20 leak actually relayed verbatim: not
// a model hallucination, a real corpus content-boundary gap. This
// checkpoint's brief explicitly forbids rewriting the Knowledge Model to
// improve benchmark scores, so the 66 records themselves are left
// untouched; this deterministic, regex-based redaction sits at the TOOL
// layer instead -- exactly where Phase 8 says leak-prevention belongs --
// so a source path/line-range/bare-function-call never enters the LLM's
// context in the first place, structurally, rather than relying on the
// LLM to notice and withhold it. Disclosed as an imperfect mitigation (see
// the report): the resulting prose is sometimes choppy, and a small
// residual class of implementation-shaped tokens (bare CONST_NAME
// declarations, inline code snippets) is not caught by this pass.
function sanitizeTechnicalDetail(text) {
  if (!text) return text;
  let t = String(text);
  t = t.replace(/\b(?:services|main|renderer|test|docs)\/[\w./-]+\.(?:js|json|md)(?::[\d,-]+)?\b/g, '[internal reference removed]');
  t = t.replace(/\b[a-zA-Z_][A-Za-z0-9_]*\(\)/g, '[internal reference removed]');
  t = t.replace(/\b[a-z][a-zA-Z]*:[a-zA-Z][a-zA-Z0-9]*\b/g, '[internal reference removed]');
  t = t.replace(/`[a-zA-Z_][A-Za-z0-9_]*`/g, '[internal reference removed]');
  // Forensic finding, direct testing this checkpoint: governance/decision
  // ids (DEC-021, BUG-###, etc) also turn up in ordinary `limitations`
  // prose, not only technicalDetail -- this same redaction is applied to
  // BOTH dimensions below (see readAutoIngest and capabilityStatus), not
  // just here, since the leak risk is identical regardless of which
  // dimension carries it.
  t = t.replace(/\b(?:KM|AI-FEAT|AI-WF|AI-MEM|AI-DEC|AI-BUG|AI-RM|DEC|BUG|PM)-[A-Za-z0-9-]+\b/g, '[internal reference removed]');
  t = t.replace(/\(\s*(?:\[internal reference removed\][\s,.;]*)+\)/g, '');
  t = t.replace(/(\[internal reference removed\][,.;]?\s*){2,}/g, '[internal implementation detail omitted] ');
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+([,.;)])/g, '$1').trim();
  return t;
}
// Alias -- the same redaction is applied to `limitations` text (see the
// header comment on sanitizeTechnicalDetail above for why: found by direct
// testing to carry the same class of raw internal reference).
const sanitizeLimitations = sanitizeTechnicalDetail;

// --- Deterministic candidate generation (Phase 2/3) -------------------------
//
// Returns [{ realId, title, kind, purpose, matchType }], never issuing
// handles itself (the caller, searchAutoIngest, owns handle issuance so it
// can dedupe against candidates found by more than one method).
function deterministicCandidates(query, ctx, built) {
  const answer = answerQuestion(query, ctx);
  const seen = new Map();
  for (const c of [...(answer.matchedCapabilities || []), ...(answer.sources || [])]) {
    if (!c || !c.id || seen.has(c.id)) continue;
    if (c.entityType && c.entityType !== 'feature' && c.entityType !== 'workflow') continue;
    if (!/^AI-(FEAT|WF)-\d+$/.test(c.id)) continue;
    seen.set(c.id, { realId: c.id, matchType: 'search' });
  }

  // candidateRecall.js -- real, pre-existing, deterministic recall-boost
  // module (see this file's header). Admits a candidate ONLY as a
  // last-resort addition when the primary deterministic search above
  // didn't already find it -- mirrors the exact seam its own header
  // describes ("an ADDITIONAL, LAST-RESORT admission check for records
  // the existing hint-injected runQuery() pool didn't already find").
  try {
    const recallSurfaceById = buildRecallSurfaceIndex(built);
    const admitted = admitRecallCandidates(query, recallSurfaceById, 2);
    for (const a of admitted) {
      if (!seen.has(a.id) && /^AI-(FEAT|WF)-\d+$/.test(a.id)) {
        seen.set(a.id, { realId: a.id, matchType: 'recall-surface' });
      }
    }
  } catch { /* recall-surface admission is supplementary; never blocks search */ }

  return [...seen.values()];
}

// Phase 2, Option B -- the full compact catalogue (title + short purpose
// per subject, no scores) every feature/workflow the deterministic search
// above did not already surface. Used ONLY as a fallback when primary
// candidates are empty or very few (see searchAutoIngest below) -- not
// injected on every search, so ordinary well-matched queries stay small
// and fast, exactly Phase 4's "minimize cognitive burden" instruction.
function fullCatalogue(ctx) {
  const out = [];
  for (const f of (ctx.knowledgeIndexById ? ctx.knowledgeIndexById.values() : [])) {
    if (f && f.id) out.push({ realId: f.id, matchType: 'catalogue' });
  }
  for (const w of (ctx.workflowIndexById ? ctx.workflowIndexById.values() : [])) {
    if (w && w.id) out.push({ realId: w.id, matchType: 'catalogue' });
  }
  return out;
}

// --- Tool 1: search_autoingest ----------------------------------------------
async function searchAutoIngest({ query }, ctx, built, handleSession) {
  const q = String(query || '').trim();
  if (!q) return { results: [], note: 'Empty query.' };

  let candidates = deterministicCandidates(q, ctx, built);
  let usedCatalogue = false;
  // Two independent, general (not query-specific) fallback triggers, both
  // disclosed in the report -- the first (candidate count) was the
  // original design; the second (repeat search) was ADDED after the first
  // retrieval-diagnostic run showed it was necessary: a query that returns
  // 2+ WRONG candidates (a real recall miss dressed up as "enough
  // results") never tripped the count-based trigger, exactly the B15-class
  // paraphrase failure. Both conditions are about the SHAPE of the
  // interaction (how many results, whether this is a retry), never about
  // the content of any specific query.
  const isRepeatSearch = handleSession.noteSearchAndCheckRepeat(q);
  if (candidates.length < 2 || isRepeatSearch) {
    const already = new Set(candidates.map((c) => c.realId));
    const cat = fullCatalogue(ctx).filter((c) => !already.has(c.realId));
    candidates = [...candidates, ...cat];
    usedCatalogue = true;
  }

  const results = candidates.slice(0, usedCatalogue ? 80 : 8).map((c) => ({
    handle: handleSession.issue(c.realId),
    title: titleFor(c.realId, ctx),
    kind: c.realId.startsWith('AI-WF-') ? 'workflow' : 'feature',
    purpose: purposeFor(c.realId, ctx),
    matchType: c.matchType,
  }));

  const note = !results.length
    ? 'No candidates found, even browsing the full AutoIngest subject list. This does not mean AutoIngest lacks the capability -- try search again with different, simpler wording, or ask the operator one clarifying question.'
    : usedCatalogue
      ? 'The normal search found few or no strong matches, so this is the FULL list of AutoIngest subjects (not ranked by relevance) so you can look for a plausible match yourself. Read titles and purposes carefully -- an unrelated subject appearing here is not evidence AutoIngest lacks the capability asked about.'
      : 'Candidates ranked by fuzzy match, not verified relevance -- read each purpose and use your own judgment about whether it plausibly fits what the operator described. If none clearly fit, search again with different wording before concluding nothing exists.';

  return { results, note };
}

// --- Tool 2: read_autoingest -------------------------------------------------
function readAutoIngest({ handle, dimensions }, ctx, handleSession) {
  const realId = handleSession.resolve(handle);
  if (!realId) {
    // Phase 5/9 invariant: an invalid handle is a PROTOCOL error, never
    // capability evidence. Distinct shape from "no KM record" below and
    // from get_capability_status's own NOT_SUPPORTED, on purpose.
    return {
      error: 'invalid_handle',
      note: `"${handle}" was not issued by a previous search in this conversation. This is a protocol error, not evidence AutoIngest lacks this feature -- call search_autoingest again to get a valid handle, or ask the operator to clarify what they mean.`,
    };
  }
  const records = findAllByFeatureId(realId);
  if (!records.length) {
    return {
      dimensions: {},
      note: 'No detailed Knowledge Base record exists for this subject yet. This does NOT mean AutoIngest lacks the capability -- call capability_status for the authoritative answer, or describe what little is known from the subject\'s title/purpose alone.',
    };
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
    else if (dim === 'limitations') text = sanitizeLimitations(dedupJoin(records.flatMap((r) => r.limitations), ' | '));
    else if (dim === 'relationships') text = dedupJoin(records.flatMap((r) => r.relationships.map((rel) => `${rel.type} ${rel.targetId}: ${rel.note}`)), ' | ');
    else if (dim === 'technicalDetail') text = sanitizeTechnicalDetail(dedupJoin(records.map((r) => r.technicalDetail), ' '));
    out[dim] = text || 'Not established in AutoIngest\'s evidence -- do not guess at this.';
  }
  const extractionTier = records.every((r) => r.extractionTier === 'forensic-verified')
    ? 'forensic-verified'
    : (records.some((r) => r.extractionTier === 'forensic-verified') ? 'mixed' : 'registry-reshaped');
  return { extractionTier, dimensions: out };
}

// --- Tool 3: capability_status -----------------------------------------------
async function capabilityStatus({ handle }, ctx, handleSession) {
  const realId = handleSession.resolve(handle);
  if (!realId) {
    return {
      error: 'invalid_handle',
      note: `"${handle}" was not issued by a previous search in this conversation. This is a protocol error -- it tells you NOTHING about whether AutoIngest supports this. Call search_autoingest again to get a valid handle.`,
    };
  }
  const base = answerForKnownRecord(realId, ctx);
  if (!base) return { status: 'UNKNOWN', provenance: [] };
  const withAuthority = await answerKnownRecordWithAuthority(realId, ctx);
  const answer = withAuthority || base;
  return {
    status: answer.capabilityStatus,
    provenance_count: (answer.sources || []).length, // count only -- never real ids, see this file's own header
    limitations: (answer.limitations || []).map(sanitizeLimitations),
  };
}

// --- Tool 4: roadmap_status --------------------------------------------------
// Phase 4 of the checkpoint brief explicitly permits keeping roadmap as
// "one deterministic roadmap read operation if necessary" rather than
// folding it into search_autoingest -- kept as its own tool here because
// it answers a genuinely different question ("what's planned/next", global
// dashboard data) that has no natural single "subject" to search for, and
// because Checkpoint 6 already found removing it caused open-ended roadmap
// questions to make zero tool calls at all. No ids of any kind (real or
// handle) are needed or returned here -- global data only.
function roadmapStatus({ query }, ctx) {
  const dashboard = ctx.dashboard;
  if (!dashboard) return { totalMilestones: 0, milestones: [], note: 'No roadmap data available.' };
  const milestones = (dashboard.milestones || []).map((m) => ({
    name: m.name, status: m.status, objective: m.objective,
    plannedEstimate: m.planned_estimate, nextAction: m.next_action,
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
      if (owning) out.matchedSubjectMilestone = { name: owning.name, status: owning.status, plannedEstimate: owning.planned_estimate, nextAction: owning.next_action };
    }
  }
  return out;
}

// node-llama-cpp GBNF-JSON-schema param defs for defineChatSessionFunction.
// Deliberately concept-framed (Phase 3): "search"/"read"/"status" over
// operator concepts, never "record"/"id lookup"/"database".
function buildToolDefinitions(ctx, built, handleSession) {
  return {
    search_autoingest: {
      description: 'Search AutoIngest\'s trusted knowledge base for subjects (features/workflows) that might relate to what the operator is asking about. Returns each candidate as a temporary handle (like "H3") with its title and a short purpose -- never a real internal id, never a capability decision. Call this first whenever you are not yet sure which AutoIngest capability the operator means. If nothing plausible comes back, try again with different, simpler wording, or ask the operator.',
      params: { type: 'object', properties: { query: { type: 'string', description: 'A short phrase describing what the operator seems to be asking about.' } }, required: ['query'] },
      handlerImpl: (params) => searchAutoIngest(params, ctx, built, handleSession),
    },
    read_autoingest: {
      description: 'Fetch specific trusted facts about one AutoIngest subject, using the handle a previous search_autoingest call gave you (e.g. "H3") -- never a made-up id. Choose only the dimensions you actually need: purpose, behavior, operatorWorkflow, preconditions, actions, recovery, limitations, relationships, technicalDetail. Request technicalDetail ONLY if the operator explicitly asked a technical/implementation question. If the handle is invalid, that is a protocol error, not evidence the feature is missing -- search again.',
      params: {
        type: 'object',
        properties: {
          handle: { type: 'string', description: 'A handle returned by search_autoingest in this conversation.' },
          dimensions: { type: 'array', items: { type: 'string', enum: VALID_DIMENSIONS }, description: 'Which facets to retrieve.' },
        },
        required: ['handle', 'dimensions'],
      },
      handlerImpl: (params) => readAutoIngest(params, ctx, handleSession),
    },
    capability_status: {
      description: 'Get the AUTHORITATIVE status of one AutoIngest capability, using a handle from search_autoingest: AVAILABLE, NOT_SUPPORTED, PLANNED, or UNKNOWN. You must call this before asserting whether AutoIngest supports, does, or does not do something, and you must never contradict what it returns. An invalid handle here is a protocol error, not a "not supported" answer.',
      params: { type: 'object', properties: { handle: { type: 'string', description: 'A handle returned by search_autoingest in this conversation.' } }, required: ['handle'] },
      handlerImpl: (params) => capabilityStatus(params, ctx, handleSession),
    },
    roadmap_status: {
      // Forensic finding this checkpoint: with `query` optional (no
      // `required` array at all), Gemma sometimes emitted the tool-call
      // SYNTAX as literal text ("roadmap_status()") instead of a real
      // structured function call -- the only one of the four tools here
      // with zero required parameters, and the only one observed to do
      // this. Making `query` required (empty string allowed, explicitly
      // documented as such) changes the GBNF grammar shape to always
      // include at least one property -- a general, disclosed fix for the
      // schema shape, not a benchmark-specific patch.
      description: 'Get the AUTHORITATIVE AutoIngest development roadmap: what is already completed, in progress, or planned, and (optionally) whether a specific named subject is planned/completed. Use this for open-ended questions like "what\'s next" or "has X been completed" -- not for questions about how an already-shipped feature behaves (use search_autoingest/read_autoingest for that).',
      params: { type: 'object', properties: { query: { type: 'string', description: 'Name a specific subject to check its roadmap status, or pass an empty string for the general roadmap state.' } }, required: ['query'] },
      handlerImpl: (params) => roadmapStatus(params || {}, ctx),
    },
  };
}

module.exports = {
  HandleSession, searchAutoIngest, readAutoIngest, capabilityStatus, roadmapStatus,
  buildToolDefinitions, sanitizeTechnicalDetail, VALID_DIMENSIONS,
};
