'use strict';

// ASK AUTOINGEST — CHECKPOINT 13: RELATIONAL KNOWLEDGE ARCHITECTURE.
// EXPERIMENTAL, ISOLATED PROTOTYPE. PRODUCT OWNER-AUTHORIZED FOLLOW-UP TO
// CHECKPOINT 12's NO-GO.
//
// Reuses knowledgeAccessC12.js's functions verbatim (search_autoingest,
// read_autoingest, capability_status, roadmap_status all unchanged) and
// adds exactly ONE new tool: check_relationship. Everything else in this
// file is identical to C12; only the new tool and its supporting lookup
// are new code.
//
// WHY (Checkpoint 13 Phase 1-6 forensic finding, not assumed): QX03's
// fabrication was traced to a real, well-evidenced gap -- the model
// requested read_autoingest's `behavior`/`operatorWorkflow` dimensions for
// both handles in the turn, never `relationships` (a dimension that
// already existed in Checkpoint 9-12 unmodified, unused). Even if it had,
// `relationships` returns ONE record's raw edge list as flat text
// ("relatedTo AI-FEAT-008: ... | relatedTo AI-FEAT-031: ...") -- correctly
// cross-referencing that list against a SECOND record's real id to
// determine whether the two are connected requires precise ID bookkeeping,
// which is exactly the failure class Checkpoint 12 already found this
// model unreliable at (raw handle/id leaks, Section 11 of the C12 report).
// check_relationship performs that cross-reference DETERMINISTICALLY --
// a lookup, not a judgment -- returning SUPPORTED / CONTRADICTED / UNKNOWN
// as data. Qwen still decides which two handles are relevant, whether it
// needs this at all, and how to phrase the answer. See
// /Users/funun_pa/.claude/jobs/6629ed37/tmp/c13/design_decisions.md for
// the full Phase 2-6 audit and design record.
//
// SCOPE DISCIPLINE, explicitly recorded (Phase 4): this file does NOT
// attempt to derive new relation types (e.g. "contains") from free-text
// cardinality patterns in canonical prose ("a 3-tab modal (A / B / C)").
// That was considered and rejected as too easy to mistake for a QX03-
// specific rule and too fragile to prove general. Instead, CONTRADICTED
// is returned ONLY when an explicit `distinctFrom` edge already exists in
// the Knowledge Model (Tier 1 hand-authored records have these; Tier 2
// registry-reshaped records currently do not -- a real, disclosed
// limitation, not silently worked around). Absence of any edge is always
// UNKNOWN, never inferred as negative -- Phase 4's explicit, non-negotiable
// rule.

const {
  HandleSession, searchAutoIngest, readAutoIngest, capabilityStatus, roadmapStatus,
  sanitizeTechnicalDetail, VALID_DIMENSIONS,
} = require('./knowledgeAccessC12');
const { findAllByFeatureId } = require('../../lib/knowledgeModel/index');

// Given a featureId, return the set of every string another record's
// relationships[].targetId might use to refer to it -- its own featureId
// (Tier 2's convention) AND every one of its own KM record ids (Tier 1's
// convention). Both conventions coexist in the corpus (a real, disclosed
// inconsistency found during Phase 2's audit, not invented for this fix);
// a general lookup must check both, not just one.
function identifiersFor(featureId) {
  const records = findAllByFeatureId(featureId);
  const ids = new Set([featureId]);
  for (const r of records) ids.add(r.id);
  return ids;
}

// Deterministic cross-reference: does ANY relationship edge connect these
// two features, in either direction, across ANY of either feature's own
// KM records? Returns the raw matching edges (for evidence/audit) plus a
// derived status. This is a lookup over already-existing data, not a new
// judgment -- the SAME edges `read_autoingest`'s `relationships` dimension
// already exposes, just correctly cross-referenced instead of left to the
// model to eyeball.
function resolveRelationship(subjectFeatureId, objectFeatureId) {
  const subjectRecords = findAllByFeatureId(subjectFeatureId);
  const objectRecords = findAllByFeatureId(objectFeatureId);
  const objectIds = identifiersFor(objectFeatureId);
  const subjectIds = identifiersFor(subjectFeatureId);

  const matches = [];
  for (const r of subjectRecords) {
    for (const rel of r.relationships || []) {
      if (objectIds.has(rel.targetId)) matches.push({ direction: 'subject->object', type: rel.type, note: rel.note });
    }
  }
  for (const r of objectRecords) {
    for (const rel of r.relationships || []) {
      if (subjectIds.has(rel.targetId)) matches.push({ direction: 'object->subject', type: rel.type, note: rel.note });
    }
  }

  if (!matches.length) {
    return {
      status: 'UNKNOWN',
      edges: [],
      note: 'No relationship edge exists between these two subjects in either direction in AutoIngest\'s knowledge. This means the relationship is NOT ESTABLISHED -- it does not mean the subjects are confirmed unrelated. Do not assert they are the same, connected, or definitely separate; say plainly that the specific relationship isn\'t documented.',
    };
  }
  const negative = matches.filter((m) => m.type === 'distinctFrom');
  if (negative.length) {
    return {
      status: 'CONTRADICTED',
      edges: matches,
      note: 'AutoIngest\'s knowledge explicitly documents these as DISTINCT/separate. Do not describe them as the same, connected, or sharing a mechanism/interface.',
    };
  }
  return {
    status: 'SUPPORTED',
    edges: matches,
    note: 'AutoIngest\'s knowledge documents a real connection between these two subjects (see edges for the specific type). This confirms SOME relationship exists -- read the edge type/note before assuming the specific nature of the connection (e.g. a generic "relatedTo" edge does not by itself confirm they share an interface, contain one another, or work identically).',
  };
}

function checkRelationship({ subjectHandle, objectHandle }, handleSession) {
  const subjectId = handleSession.resolve(subjectHandle);
  const objectId = handleSession.resolve(objectHandle);
  if (!subjectId || !objectId) {
    return {
      error: 'invalid_handle',
      note: 'One or both handles were not issued by a previous search_autoingest call in this conversation. This is a protocol error, not evidence about the relationship -- search again for the missing subject first.',
    };
  }
  if (subjectId === objectId) {
    return { status: 'SUPPORTED', edges: [], note: 'Both handles refer to the same subject.' };
  }
  return resolveRelationship(subjectId, objectId);
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
    // NEW, Checkpoint 13.
    check_relationship: {
      description: 'Check whether AutoIngest\'s knowledge documents a relationship between TWO subjects you already have handles for (from search_autoingest). Use this whenever the operator asks whether two AutoIngest things are the same, connected, one contains/uses the other, one replaced the other, or are separate/independent -- do NOT rely on your own memory or on reading each subject\'s facts separately and guessing whether they connect. Returns status: SUPPORTED (a real documented connection exists -- read the edges for what kind), CONTRADICTED (AutoIngest\'s knowledge explicitly documents them as distinct/separate -- never describe them as the same or connected), or UNKNOWN (no relationship is documented either way -- this means NOT ESTABLISHED, not "confirmed unrelated"; say plainly the relationship isn\'t documented rather than guessing). A relationship between two AutoIngest concepts is itself an AutoIngest fact -- if it matters to your answer, check it before asserting it.',
      params: {
        type: 'object',
        properties: {
          subjectHandle: { type: 'string', description: 'A handle returned by search_autoingest for the first subject.' },
          objectHandle: { type: 'string', description: 'A handle returned by search_autoingest for the second subject.' },
        },
        required: ['subjectHandle', 'objectHandle'],
      },
      handlerImpl: (params) => checkRelationship(params, handleSession),
    },
  };
}

module.exports = {
  HandleSession, searchAutoIngest, readAutoIngest, capabilityStatus, roadmapStatus,
  checkRelationship, resolveRelationship,
  buildToolDefinitions, sanitizeTechnicalDetail, VALID_DIMENSIONS,
};
