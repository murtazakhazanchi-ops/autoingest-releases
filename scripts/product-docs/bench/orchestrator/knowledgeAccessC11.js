'use strict';

// ASK AUTOINGEST — CHECKPOINT 11: GROUNDING DISCIPLINE, NOT BENCHMARK
// PATCHING. EXPERIMENTAL, ISOLATED PROTOTYPE.
//
// Reuses EVERY function from knowledgeAccessC9.js verbatim except
// searchAutoIngest and readAutoIngest, which get ONE small, general,
// disclosed addition each -- both traced directly to Checkpoint 11's own
// Phase 1 forensic finding, not invented from assumption:
//
// Phase 1 finding (48-conversation forensic classification of every
// Checkpoint-10 FAIL/PARTIAL): the single largest, most reproducible root
// cause is NOT a search-discipline failure or a Knowledge Base defect (zero
// confirmed KB defects found) -- it is that EVERY AI-WF-* (workflow) id in
// the entire corpus has ZERO Knowledge Model records (verified directly:
// `findAllByFeatureId('AI-WF-007').length === 0`, and identically for
// every other workflow id checked), while most AI-FEAT-* (feature) ids do
// have real, authored content. When search returns both a feature and a
// workflow candidate for the same topic, the model sometimes picks the
// workflow handle -- read_autoingest legitimately returns empty
// dimensions, and instead of saying so, the model fabricates plausible
// content. This exact bug reproduced BYTE-IDENTICALLY across two separate
// conversations (frozen19's "N_technical_question" and finalBlindC9's
// "N13_technical" -- the same wrong handle, the same empty read, the same
// fabricated non-answer), proving it is systematic, not a one-off.
//
// The correction: expose `hasDetail` (a plain boolean, computed the exact
// same way for every single search result, current or future, feature or
// workflow -- no id, title, or wording is special-cased) so the model has
// the deterministic information it needs to prefer a documented candidate
// over an undocumented one ITSELF, or to recognize up front that a
// candidate it's about to read may come back thin. This is Phase 5's
// explicit preference-order tier 2 ("improve generic tool
// semantics/descriptions") -- the ranking/selection logic itself is NOT
// touched, and the model's own judgment remains the deciding factor,
// exactly as the checkpoint brief requires ("the LLM still owns the
// conversation").

const {
  HandleSession, roadmapStatus, sanitizeTechnicalDetail, VALID_DIMENSIONS,
} = require('./knowledgeAccessC9');
const { answerQuestion, answerForKnownRecord } = require('../../lib/knowledgeEngine');
const { answerKnownRecordWithAuthority } = require('../../lib/answerWithAuthority');
const { findAllByFeatureId } = require('../../lib/knowledgeModel/index');
const { buildRecallSurfaceIndex, admitRecallCandidates } = require('../../lib/candidateRecall');

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
// The one new, general, deterministic fact this checkpoint exposes: does
// ANY Knowledge Model record exist for this id at all? Same computation,
// same rule, for every id -- not a lookup table of specific features.
function hasDetailFor(id) {
  return findAllByFeatureId(id).length > 0;
}

function deterministicCandidates(query, ctx, built) {
  const answer = answerQuestion(query, ctx);
  const seen = new Map();
  for (const c of [...(answer.matchedCapabilities || []), ...(answer.sources || [])]) {
    if (!c || !c.id || seen.has(c.id)) continue;
    if (c.entityType && c.entityType !== 'feature' && c.entityType !== 'workflow') continue;
    if (!/^AI-(FEAT|WF)-\d+$/.test(c.id)) continue;
    seen.set(c.id, { realId: c.id, matchType: 'search' });
  }
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

// --- Tool 1: search_autoingest (Checkpoint 11: + hasDetail) ----------------
async function searchAutoIngest({ query }, ctx, built, handleSession) {
  const q = String(query || '').trim();
  if (!q) return { results: [], note: 'Empty query.' };

  let candidates = deterministicCandidates(q, ctx, built);
  let usedCatalogue = false;
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
    hasDetail: hasDetailFor(c.realId),
    matchType: c.matchType,
  }));

  const note = !results.length
    ? 'No candidates found, even browsing the full AutoIngest subject list. This does not mean AutoIngest lacks the capability -- try search again with different, simpler wording, or ask the operator one clarifying question.'
    : usedCatalogue
      ? 'The normal search found few or no strong matches, so this is the FULL list of AutoIngest subjects (not ranked by relevance) so you can look for a plausible match yourself. Read titles and purposes carefully -- an unrelated subject appearing here is not evidence AutoIngest lacks the capability asked about. Prefer a candidate with hasDetail:true when more than one plausibly fits -- it has real documented facts to read; hasDetail:false means reading it will likely come back thin, so only pick it if it is clearly the best or only match.'
      : 'Candidates ranked by fuzzy match, not verified relevance -- read each purpose and use your own judgment about whether it plausibly fits what the operator described. If none clearly fit, search again with different wording before concluding nothing exists. Prefer a candidate with hasDetail:true when more than one plausibly fits -- it has real documented facts to read; hasDetail:false means reading it will likely come back thin, so only pick it if it is clearly the best or only match.';

  return { results, note };
}

// --- Tool 2: read_autoingest (Checkpoint 11: stronger empty-result signal) --
function readAutoIngest({ handle, dimensions }, ctx, handleSession) {
  const realId = handleSession.resolve(handle);
  if (!realId) {
    return {
      error: 'invalid_handle',
      note: `"${handle}" was not issued by a previous search in this conversation. This is a protocol error, not evidence AutoIngest lacks this feature -- call search_autoingest again to get a valid handle, or ask the operator to clarify what they mean.`,
    };
  }
  const records = findAllByFeatureId(realId);
  if (!records.length) {
    // Checkpoint 11: this exact response shape was traced directly to the
    // dominant Checkpoint-10 fabrication pattern (see this file's header)
    // -- reworded to be harder to read past. Still says nothing
    // feature-specific; identical for every id with no KM record.
    return {
      dimensions: {},
      note: 'THIS SUBJECT HAS NO DETAILED KNOWLEDGE BASE RECORD. Nothing below is established fact -- do not describe how this works, where it stores anything, or what it does beyond the title/purpose you already have. This does NOT mean AutoIngest lacks the capability. Either say plainly that the detailed mechanism is not documented, or (if a related subject with real detail exists -- check search_autoingest\'s hasDetail flag) read that one instead.',
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
    else if (dim === 'limitations') text = sanitizeTechnicalDetail(dedupJoin(records.flatMap((r) => r.limitations), ' | '));
    else if (dim === 'relationships') text = dedupJoin(records.flatMap((r) => r.relationships.map((rel) => `${rel.type} ${rel.targetId}: ${rel.note}`)), ' | ');
    else if (dim === 'technicalDetail') text = sanitizeTechnicalDetail(dedupJoin(records.map((r) => r.technicalDetail), ' '));
    out[dim] = text || 'Not established in AutoIngest\'s evidence -- do not guess at this.';
  }
  const extractionTier = records.every((r) => r.extractionTier === 'forensic-verified')
    ? 'forensic-verified'
    : (records.some((r) => r.extractionTier === 'forensic-verified') ? 'mixed' : 'registry-reshaped');
  return { extractionTier, dimensions: out };
}

// --- Tool 3: capability_status (unchanged from knowledgeAccessC9.js) -------
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
    provenance_count: (answer.sources || []).length,
    limitations: (answer.limitations || []).map(sanitizeTechnicalDetail),
  };
}

function buildToolDefinitions(ctx, built, handleSession) {
  return {
    search_autoingest: {
      description: 'Search AutoIngest\'s trusted knowledge base for subjects (features/workflows) that might relate to what the operator is asking about. Returns each candidate as a temporary handle (like "H3") with its title, a short purpose, and hasDetail (whether real documented facts exist for it, beyond the title/purpose) -- never a real internal id, never a capability decision. Call this first whenever you are not yet sure which AutoIngest capability the operator means. If nothing plausible comes back, try again with different, simpler wording, or ask the operator.',
      params: { type: 'object', properties: { query: { type: 'string', description: 'A short phrase describing what the operator seems to be asking about.' } }, required: ['query'] },
      handlerImpl: (params) => searchAutoIngest(params, ctx, built, handleSession),
    },
    read_autoingest: {
      description: 'Fetch specific trusted facts about one AutoIngest subject, using the handle a previous search_autoingest call gave you (e.g. "H3") -- never a made-up id. Choose only the dimensions you actually need: purpose, behavior, operatorWorkflow, preconditions, actions, recovery, limitations, relationships, technicalDetail. Request technicalDetail ONLY if the operator explicitly asked a technical/implementation question. If the result comes back with no real content (hasDetail was false), that subject genuinely has no documented detail -- say so, or read a different candidate that does -- never invent the missing detail. If the handle is invalid, that is a protocol error, not evidence the feature is missing -- search again.',
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
      description: 'Get the AUTHORITATIVE AutoIngest development roadmap: what is already completed, in progress, or planned, and (optionally) whether a specific named subject is planned/completed. Use this for open-ended questions like "what\'s next" or "has X been completed" -- not for questions about how an already-shipped feature behaves (use search_autoingest/read_autoingest for that).',
      params: { type: 'object', properties: { query: { type: 'string', description: 'Name a specific subject to check its roadmap status, or pass an empty string for the general roadmap state.' } }, required: ['query'] },
      handlerImpl: (params) => roadmapStatus(params || {}, ctx),
    },
  };
}

module.exports = {
  HandleSession, searchAutoIngest, readAutoIngest, capabilityStatus, roadmapStatus,
  buildToolDefinitions, sanitizeTechnicalDetail, hasDetailFor, VALID_DIMENSIONS,
};
