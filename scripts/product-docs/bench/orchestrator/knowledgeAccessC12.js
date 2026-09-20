'use strict';

// ASK AUTOINGEST — CHECKPOINT 12: QWEN3.5-4B FINAL QUALIFICATION.
// EXPERIMENTAL, ISOLATED PROTOTYPE.
//
// Reuses knowledgeAccessC11.js's functions verbatim except three targeted,
// general, disclosed changes, all traced to Checkpoint 12's own forensic
// findings (see engineC12.js/validatorC12.js headers for the full
// evidence):
//
//   1. Phase 3 — `hasDetail` (boolean) is now ALSO exposed as
//      `knowledgeState`: "DOCUMENTED" | "THIN" | "EMPTY". EMPTY means no
//      Knowledge Model record exists at all (the old hasDetail:false
//      case). THIN means a record exists but the SPECIFIC dimensions
//      read_autoingest returns come back "Not established" more often
//      than not. DOCUMENTED means real, substantive content came back.
//      This is deterministic metadata ABOUT the retrieval result -- it is
//      not a second intelligence, and the same one LLM still decides what
//      to do with it (search differently, read another candidate, ask,
//      or say plainly that AutoIngest's knowledge doesn't establish the
//      detail) -- Phase 3's own explicit framing.
//
//   2. Phase 6 — the `handle` field is now the LAST key in each search
//      result object (was first in knowledgeAccessC11.js), a deliberate,
//      general, pre-generation structural choice -- not a post-hoc
//      special-case of any specific handle string. Traced directly from
//      Checkpoint 12's own regeneration-forensics finding: 50% of every
//      Checkpoint-11 regeneration (32/64 events) was triggered by the
//      model citing a handle in parentheses next to a name it gave the
//      operator, e.g. `"Recover From an Archive Lock Error" (H6)` --
//      exactly the citation convention a model trained on technical
//      writing reaches for when a short reference code sits prominently
//      next to a named result. Reordering the field to be least salient,
//      combined with engineC12.js's new explicit anti-citation
//      instruction (see that file), is this checkpoint's general
//      mitigation -- not a rename or removal of the field, since machine
//      tool calls still need it.
//
//   3. Phase 1/2 — no change to search/read logic itself (the same
//      deterministic ranker, recall-surface admission, and catalogue
//      fallback from Checkpoint 9-11, untouched) -- the "identity claim"
//      correction lives entirely in validatorC12.js as a content-
//      grounding check on the FINAL ANSWER, not a change to retrieval.

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

// --- Tool 1: search_autoingest (Checkpoint 12: handle moved last) ----------
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
    // `handle` deliberately LAST -- see this file's header, Phase 6.
    title: titleFor(c.realId, ctx),
    kind: c.realId.startsWith('AI-WF-') ? 'workflow' : 'feature',
    purpose: purposeFor(c.realId, ctx),
    hasDetail: hasDetailFor(c.realId),
    matchType: c.matchType,
    handle: handleSession.issue(c.realId),
  }));

  const note = !results.length
    ? 'No candidates found, even browsing the full AutoIngest subject list. This does not mean AutoIngest lacks the capability -- try search again with different, simpler wording, or ask the operator one clarifying question.'
    : usedCatalogue
      ? 'The normal search found few or no strong matches, so this is the FULL list of AutoIngest subjects (not ranked by relevance) so you can look for a plausible match yourself. Read titles and purposes carefully -- an unrelated subject appearing here is not evidence AutoIngest lacks the capability asked about. Prefer a candidate with hasDetail:true when more than one plausibly fits.'
      : 'Candidates ranked by fuzzy match, not verified relevance -- read each purpose and use your own judgment about whether it plausibly fits what the operator described. If none clearly fit, search again with different wording before concluding nothing exists. Prefer a candidate with hasDetail:true when more than one plausibly fits.';

  return { results, note };
}

// --- Tool 2: read_autoingest (Checkpoint 12: + knowledgeState) -------------
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
    return {
      knowledgeState: 'EMPTY',
      dimensions: {},
      note: 'THIS SUBJECT HAS NO DETAILED KNOWLEDGE BASE RECORD. Nothing below is established fact -- do not describe how this works, where it stores anything, or what it does beyond the title/purpose you already have. This does NOT mean AutoIngest lacks the capability. Either say plainly that the detailed mechanism is not documented, or (if a related subject with real detail exists -- check search_autoingest\'s hasDetail flag) read that one instead.',
    };
  }
  const requested = (Array.isArray(dimensions) ? dimensions : []).filter((d) => VALID_DIMENSIONS.includes(d));
  const out = {};
  let establishedCount = 0;
  let totalCount = 0;
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
    totalCount++;
    if (text) establishedCount++;
    out[dim] = text || 'Not established in AutoIngest\'s evidence -- do not guess at this.';
  }
  // Phase 3: THIN when fewer than half the requested dimensions actually
  // came back with real content -- a deterministic ratio, the same rule
  // for every subject and every dimension combination, not tuned to any
  // specific record.
  const knowledgeState = establishedCount === 0 ? 'EMPTY' : (establishedCount < totalCount / 2 ? 'THIN' : 'DOCUMENTED');
  const extractionTier = records.every((r) => r.extractionTier === 'forensic-verified')
    ? 'forensic-verified'
    : (records.some((r) => r.extractionTier === 'forensic-verified') ? 'mixed' : 'registry-reshaped');
  const stateNote = knowledgeState === 'THIN'
    ? 'THIN: most of what you asked for is not established. Do not fill the gaps with a plausible guess -- say plainly what is and is not known.'
    : undefined;
  return { knowledgeState, extractionTier, dimensions: out, ...(stateNote ? { note: stateNote } : {}) };
}

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
      description: 'Search AutoIngest\'s trusted knowledge base for subjects (features/workflows) that might relate to what the operator is asking about. Returns each candidate\'s title, a short purpose, hasDetail (whether real documented facts exist for it beyond the title/purpose), and a temporary handle (like "H3") at the end -- never a real internal id, never a capability decision. The handle exists ONLY so you can call the other tools; never write it in your answer to the operator, not even in parentheses as a citation. Call this first whenever you are not yet sure which AutoIngest capability the operator means. If nothing plausible comes back, try again with different, simpler wording, or ask the operator.',
      params: { type: 'object', properties: { query: { type: 'string', description: 'A short phrase describing what the operator seems to be asking about.' } }, required: ['query'] },
      handlerImpl: (params) => searchAutoIngest(params, ctx, built, handleSession),
    },
    read_autoingest: {
      description: 'Fetch specific trusted facts about one AutoIngest subject, using the handle a previous search_autoingest call gave you -- never a made-up id. Choose only the dimensions you actually need: purpose, behavior, operatorWorkflow, preconditions, actions, recovery, limitations, relationships, technicalDetail. Request technicalDetail ONLY if the operator explicitly asked a technical/implementation question. The result includes knowledgeState: DOCUMENTED (real content), THIN (most of what you asked for isn\'t established), or EMPTY (no record at all). For THIN or EMPTY, say plainly that the detail isn\'t documented, or read a different candidate that does have it -- never invent the missing detail. If the handle is invalid, that is a protocol error, not evidence the feature is missing -- search again.',
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
