'use strict';

// services/qwenOrchestrator/toolDefinitions.js — Ask AutoIngest Stage 4,
// Sections 5-11. Wraps Stage 2's five production Knowledge operations
// (scripts/product-docs/lib/askKnowledge/index.js's own
// createKnowledgeOperations()) as node-llama-cpp tool definitions
// (`defineChatSessionFunction`-compatible {description, params, handler}
// shapes -- verified directly against node-llama-cpp 3.20.0's own
// defineChatSessionFunction.d.ts, not assumed).
//
// Tool descriptions/params are promoted near-verbatim from the qualified
// Checkpoint 14 bench prototype (knowledgeAccessC14.js's own
// buildToolDefinitions()) -- see DEC-026 for the full audit. The ONE real
// signature correction: Stage 2's real roadmapStatus(handle) takes an
// optional HANDLE (empty/undefined = general roadmap), not the bench
// prototype's own local free-text `query` parameter -- the tool schema
// below matches the REAL production function, not the bench precursor.
//
// This module does not execute anything itself -- `handlerImpl` closures
// call straight into the already-productionized Stage 2 operations
// (zero reimplementation of search/read/capability/roadmap/relationship
// logic here, per DEC-026's OBSOLETE classification of the bench
// versions).

const VALID_DIMENSIONS = require('../../scripts/product-docs/lib/askKnowledge/read').VALID_DIMENSIONS;

// knowledgeOperations: the object returned by Stage 2's own
// createKnowledgeOperations(knowledgeContext, handleSession) --
// { search_autoingest(query, options), read_autoingest(handle, dimensions),
//   capability_status(handle), roadmap_status(handle),
//   check_relationship(subjectHandle, objectHandle) }.
function buildToolDefinitions(knowledgeOperations) {
  return {
    search_autoingest: {
      description: 'Search AutoIngest\'s trusted knowledge base for subjects (features/workflows) that might relate to what the operator is asking about. Returns each candidate\'s title, a short purpose, hasDetail (whether real documented facts exist beyond the title/purpose), and a temporary handle (like "H3") at the end -- never a real internal id, never a capability decision. The handle exists ONLY so you can call the other tools; never write it in your answer to the operator, not even in parentheses as a citation. Call this first whenever you are not yet sure which AutoIngest capability the operator means. If nothing plausible comes back, try again with different, simpler wording, or ask the operator.',
      params: { type: 'object', properties: { query: { type: 'string', description: 'A short phrase describing what the operator seems to be asking about.' } }, required: ['query'] },
      handlerImpl: ({ query }) => knowledgeOperations.search_autoingest(query),
    },
    read_autoingest: {
      description: 'Fetch specific trusted facts about one AutoIngest subject, using the handle a previous search_autoingest call gave you -- never a made-up id. Choose only the dimensions you actually need: purpose, behavior, operatorWorkflow, preconditions, actions, recovery, limitations, relationships, technicalDetail. Request technicalDetail ONLY if the operator explicitly asked a technical/implementation question. The result includes knowledgeState: DOCUMENTED (real content), THIN (most of what you asked for isn\'t established), or EMPTY (no record at all). For THIN or EMPTY, say plainly that the detail isn\'t documented, or read a different candidate that does have it -- never invent the missing detail. The relationships dimension, when it names another subject, also states the DIRECTION of that connection in plain language when known (e.g. "happens before", "uses", "writes to") -- read that meaning exactly, never guess a direction it doesn\'t state. If the handle is invalid, that is a protocol error, not evidence the feature is missing -- search again.',
      params: {
        type: 'object',
        properties: {
          handle: { type: 'string', description: 'A handle returned by search_autoingest in this conversation.' },
          dimensions: { type: 'array', items: { type: 'string', enum: VALID_DIMENSIONS }, description: 'Which facets to retrieve.' },
        },
        required: ['handle', 'dimensions'],
      },
      handlerImpl: ({ handle, dimensions }) => knowledgeOperations.read_autoingest(handle, dimensions),
    },
    capability_status: {
      description: 'Get the AUTHORITATIVE status of one AutoIngest capability, using a handle from search_autoingest: AVAILABLE, NOT_SUPPORTED, PLANNED, or UNKNOWN. You must call this before asserting whether AutoIngest supports, does, or does not do something, and you must never contradict what it returns. An invalid handle here is a protocol error, not a "not supported" answer.',
      params: { type: 'object', properties: { handle: { type: 'string', description: 'A handle returned by search_autoingest in this conversation.' } }, required: ['handle'] },
      handlerImpl: ({ handle }) => knowledgeOperations.capability_status(handle),
    },
    roadmap_status: {
      description: 'Get the AUTHORITATIVE AutoIngest development roadmap: what is already completed, in progress, or planned. Leave handle empty for the general roadmap state ("what\'s next", "what\'s been completed" style questions). Pass a handle from search_autoingest to also check whether that one specific subject is planned, in progress, or already shipped. Not for questions about how an already-shipped feature behaves -- use search_autoingest/read_autoingest for that.',
      params: { type: 'object', properties: { handle: { type: 'string', description: 'A handle from search_autoingest to check one specific subject, or leave empty/omit for the general roadmap.' } }, required: [] },
      handlerImpl: ({ handle }) => knowledgeOperations.roadmap_status(handle || ''),
    },
    check_relationship: {
      description: 'Check whether AutoIngest\'s knowledge documents a relationship between TWO subjects you already have handles for (from search_autoingest) -- INCLUDING whether one happens before/after, uses, writes to, or reads from the other. Use this whenever the operator asks whether two AutoIngest things are the same, connected, one contains/uses/precedes the other, or are separate/independent -- do NOT rely on your own memory or on reading each subject\'s facts separately and guessing whether or how they connect, including ordering questions ("does X happen before Y", "can X and Y overlap"). Returns status: SUPPORTED (a real documented connection exists -- read each edge\'s "meaning" field for the exact evidenced direction/kind, e.g. "X happens before Y"), CONTRADICTED (AutoIngest\'s knowledge explicitly documents them as distinct/separate -- never describe them as the same or connected), or UNKNOWN (no relationship, including no ordering, is documented either way -- this means NOT ESTABLISHED, not "confirmed unrelated" or "confirmed simultaneous"; say plainly the relationship isn\'t documented rather than guessing in either direction). A relationship OR ORDERING between two AutoIngest concepts is itself an AutoIngest fact -- if it matters to your answer, check it before asserting it.',
      params: {
        type: 'object',
        properties: {
          subjectHandle: { type: 'string', description: 'A handle returned by search_autoingest for the first subject.' },
          objectHandle: { type: 'string', description: 'A handle returned by search_autoingest for the second subject.' },
        },
        required: ['subjectHandle', 'objectHandle'],
      },
      handlerImpl: ({ subjectHandle, objectHandle }) => knowledgeOperations.check_relationship(subjectHandle, objectHandle),
    },
  };
}

module.exports = { buildToolDefinitions };
