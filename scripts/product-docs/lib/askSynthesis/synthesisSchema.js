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
// Wired into production since Phase C5 (services/localJudge/synthesisAdapter.js);
// this header note was stale (it previously said "not wired into production").
//
// Phase C5.2 (Section D field audit): the `related` property (a
// human-readable related-capabilities list, separate from and unrelated to
// the deterministic Related-topic capsule feature) was removed here. Proven
// unused, not just low-value: grep across answerWithSynthesis.js/main/
// renderer.js turned up zero consumers of the resolved candidate's `related`
// field -- mergeSynthesizedAnswer() never reads it. It was already optional
// (never in `required`), so removing the property definition needs no
// change anywhere else: safetyValidation.js's existing `(candidate.related
// || [])` fallbacks already treat its absence as "zero items", exactly
// correct once the grammar can no longer produce it at all. Real-model
// measurement (bench/results/phase-c5.2-truncation-diagnostic.json) put its
// own output cost at only 1.6-5.2% of total generated JSON on the two
// largest observed cases -- a real but modest saving, not the truncation
// fix by itself (see synthesisBudget.js for that).
//
// `capabilityStatus` was also audited per Section D (it is generated only
// to be echoed back exactly, then checked post-hoc by
// safetyValidation.js's checkCapabilityStatusMatches() -- a candidate for
// the same "already known deterministically" argument) and deliberately
// NOT removed: the token saving is negligible (a single enum string) next
// to the real risk of touching the one field this whole checkpoint series
// treats as the most safety-critical guarantee (immutable capability
// status). Documented here as a considered-and-rejected change, not a gap.

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
      description: 'Plain operator language, in your own words -- not a restatement of the evidence\'s own document structure or wording. Length follows the question, not a fixed rule: a simple status/definition question usually needs one or two sentences; a genuine "why"/design explanation or a multi-step task may legitimately need more. Never pad for length, and never compress a real explanation down to a bare pointer sentence. Every fact must be grounded in the supplied evidence, but you do not have to mention every fact the evidence contains. Never write a handle (like "S1") inside this text -- handles belong only in sourceIds arrays.',
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
