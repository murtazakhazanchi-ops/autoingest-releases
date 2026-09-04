'use strict';
// Ask AutoIngest — Stage 2 deterministic knowledge/tool foundation. Public
// entry point. NOTHING in the shipped application calls this module yet --
// it exists to be imported and tested independently, exactly like Stage
// 1's lib/askRetrieval/ before it (see that module's own header for the
// same boundary contract, restated here for Stage 2's own surface).
//
// Exposes the five deterministic knowledge operations (Section 14) as
// plain internal JS functions -- NOT node-llama-cpp tool definitions with
// natural-language descriptions aimed at guiding a model's tool selection
// (Section 14 explicitly forbids that at Stage 2: "do not register them
// with Qwen yet... do not create node-llama-cpp tool definitions"). A
// future Stage 3 orchestrator wraps these in whatever tool-calling
// convention Qwen's runtime needs; this module has no opinion about that.
//
// DECISION-BACKED KNOWLEDGE POLICY (Section 6, resolved -- see
// docs/product/decisions/DEC-023 for the full writeup): Decision records
// ARE authoritative product knowledge (Section 6A) -- decisionFacts.js
// folds a feature's linked Decision text into read_autoingest's own
// `limitations` dimension unconditionally, always available once a feature
// is selected. Decision TEXT is NOT used to enrich the retrieval SURFACE
// (Section 6B) in Stage 2's default configuration -- buildRetrievalIndex()
// below is called WITHOUT ctx, reproducing Stage 1's own certified
// baseline exactly, not the optional decision-text-enrichment variant.
// This is a considered choice, not an oversight: the enrichment variant
// consistently costs Top-1/MRR precision in exchange for Top-5/Top-10
// recall on BOTH retrieval250 and the independent holdout (see DEC-022),
// and Section 6 explicitly warns against enabling it "merely because it
// produces 90.9% Top-5" without weighing candidate-quality/false-attraction
// risk -- since Decision-backed facts are already fully reachable via
// reads regardless of this choice, the retrieval-surface question is
// decided independently, on retrieval quality alone.

const { buildEngineContext } = require('../knowledgeEngine');
const { buildRetrievalIndex } = require('../askRetrieval/retrieval');
const { HandleSession } = require('./handles');
const { searchAutoIngest } = require('./search');
const { readAutoIngest, VALID_DIMENSIONS } = require('./read');
const { capabilityStatus } = require('./capabilityStatus');
const { roadmapStatus } = require('./roadmapStatus');
const { checkRelationship } = require('./relationships');

// Builds the shared, immutable context this whole module tree needs from a
// single build.assemble() result: the existing production engine context
// (buildEngineContext, unchanged) plus Stage 1's own retrieval index, built
// ONCE via its own explicit lifecycle (buildRetrievalIndex(built) --
// deliberately WITHOUT ctx, see the policy note above) and held by the
// caller, exactly matching Stage 1's own "no module-level cache, explicit
// caller-owned index" discipline (askRetrieval/retrieval.js's own header).
function buildKnowledgeContext(built) {
  const ctx = buildEngineContext(built);
  const retrievalIndex = buildRetrievalIndex(built); // certified configuration, no decision-text enrichment
  return { built, ctx, retrievalIndex };
}

// One deterministic operations surface, bound to a single knowledgeContext
// (from buildKnowledgeContext) and a single HandleSession (one per future
// assistant session -- not created or owned by this module). Every method
// is a thin, structured wrapper over the individual op modules above; no
// new logic lives here beyond binding.
function createKnowledgeOperations(knowledgeContext, handleSession) {
  const { built, ctx, retrievalIndex } = knowledgeContext;
  return {
    search_autoingest(query, options) {
      return searchAutoIngest(query, ctx, built, retrievalIndex, handleSession, options || {});
    },
    read_autoingest(handle, dimensions) {
      return readAutoIngest(handle, dimensions, ctx, handleSession);
    },
    capability_status(handle) {
      return capabilityStatus(handle, ctx, handleSession);
    },
    roadmap_status(handle) {
      return roadmapStatus(handle, ctx, handleSession);
    },
    check_relationship(subjectHandle, objectHandle) {
      return checkRelationship(subjectHandle, objectHandle, handleSession);
    },
  };
}

module.exports = {
  buildKnowledgeContext, createKnowledgeOperations, HandleSession,
  searchAutoIngest, readAutoIngest, capabilityStatus, roadmapStatus, checkRelationship,
  VALID_DIMENSIONS,
};
