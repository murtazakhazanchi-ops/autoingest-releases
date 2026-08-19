'use strict';

// Ask AutoIngest — synthesis schema, Phase A.2 revision (Track 2.A/2.B).
//
// Two structural changes from the Phase A version, both schema-level (grammar-
// enforced, not prompt-level):
//   1. Every sourceIds field is now a closed enum of opaque handles ("S1".."SN")
//      built fresh per question from that question's own evidence package
//      (sourceHandles.js) -- the model cannot reference a source it wasn't
//      given a handle for, and it never sees a raw AI-FEAT-*/AI-WF-*/DEC-*
//      identifier anywhere in its input to begin with.
//   2. `historicalNote` is OMITTED from the schema entirely (not just
//      described as conditional) whenever the evidence package's own
//      historical.admitted[] is empty -- grammar-constrained decoding makes
//      emitting it structurally impossible in that case, closing the
//      Phase A `historicalGrounded` failure mode at the decoding level
//      rather than relying on the model reading and obeying a prompt note.
//
// NOT wired into production code; consumed only by the Phase A.2 benchmark
// harness (bench/runBenchmark.mjs).

function buildSynthesisSchema(evidencePackage, handleMap) {
  const handleEnum = handleMap.validHandles.length ? handleMap.validHandles : ['__NONE__'];
  const sourceIdsField = { type: 'array', items: { type: 'string', enum: handleEnum } };
  const citedItem = (extra = {}) => ({
    type: 'object',
    additionalProperties: false,
    required: ['text', 'sourceIds'],
    properties: {
      text: { type: 'string' },
      sourceIds: { ...sourceIdsField, minItems: 1 },
      ...extra,
    },
  });

  const properties = {
    answer: {
      type: 'string',
      description: 'One to three sentences, plain operator language. Must restate only facts present in the supplied evidence. Never write a handle (like "S1") inside this text -- handles belong only in sourceIds arrays.',
    },
    capabilityStatus: {
      type: 'string',
      enum: ['AVAILABLE', 'PARTIALLY_AVAILABLE', 'PLANNED', 'NOT_SUPPORTED', 'UNKNOWN', 'ROADMAP'],
    },
    steps: {
      type: 'array',
      description: 'Only present for HOW_TO/TROUBLESHOOTING answers with real procedural evidence. Each step must cite at least one real handle.',
      items: citedItem(),
    },
    warnings: {
      type: 'array',
      description: 'Limitations, caveats, or safety notes. Every warning must cite at least one real handle.',
      items: citedItem(),
    },
    related: {
      type: 'array',
      description: 'Human-readable related capability names, each citing at least one real handle.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'sourceIds'],
        properties: {
          title: { type: 'string' },
          sourceIds: { ...sourceIdsField, minItems: 1 },
        },
      },
    },
    sourceIds: { ...sourceIdsField, description: 'Every handle this answer as a whole draws on.' },
    refused: {
      type: 'boolean',
      description: 'True only if the evidence is insufficient to answer at all -- in which case answer must restate the deterministic fallback\'s directAnswer, not a new refusal phrasing.',
    },
  };

  const required = ['answer', 'capabilityStatus', 'sourceIds'];

  // Structural gate (Track 2.B): the property literally does not exist in
  // the schema unless there is real admitted historical evidence to ground
  // it in -- this is the fix, not a stronger instruction.
  if ((evidencePackage.historical.admitted || []).length > 0) {
    properties.historicalNote = {
      type: ['string', 'null'],
      description: 'Must be phrased as "how this came to be," never as a restatement or contradiction of capabilityStatus. Cite the real handle(s) for the admitted historical evidence inline in prose is NOT required -- this field is prose-only, ungrounded claims here are still checked post-hoc.',
    };
  }

  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  };
}

module.exports = { buildSynthesisSchema };
