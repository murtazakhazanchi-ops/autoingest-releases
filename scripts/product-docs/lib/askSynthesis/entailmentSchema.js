'use strict';

// Ask AutoIngest — Capability Entailment Judge Prototype. Structured output
// schema per checkpoint §5: a classifier, not a narrator. No free-form
// answer field exists at all -- the model cannot produce operator-facing
// prose even if it tried, because the grammar has no slot for it.

// Phase C1 (Semantic Authority Core Integration, 2026-08-19): reasonCode
// removed from the production contract per explicit Product Owner decision
// -- it was model-generated free text, never operator-facing, never read by
// resolveEntailmentAuthority() for any decision (verified: that function
// only ever destructures `judgment`/`confidence`/`evidenceHandles`), and
// empirically prone to degenerate output (echoed instruction text, empty
// strings) across every benchmark in this investigation. Removing it from
// the schema (additionalProperties:false, so the grammar has no slot for it
// at all) both shortens generation and removes a demonstrated hallucination
// surface. A deterministic, application-generated fallbackReason remains
// available on the authority result -- that is a different, non-model
// concept and is unaffected by this change (see entailmentAuthority.js).
function buildEntailmentSchema(handleMap) {
  const handleEnum = handleMap.validHandles.length ? handleMap.validHandles : ['__NONE__'];
  return {
    type: 'object',
    additionalProperties: false,
    required: ['judgment', 'evidenceHandles', 'confidence'],
    properties: {
      judgment: {
        type: 'string',
        enum: ['SUPPORTS', 'CONTRADICTS', 'INSUFFICIENT_EVIDENCE'],
      },
      // Field order matters for grammar-constrained generation (fields are
      // produced in schema-declaration order) -- evidenceHandles immediately
      // follows judgment so citation is filled in while the judgment is
      // still "fresh" in the generation context, then confidence.
      evidenceHandles: {
        type: 'array',
        description: 'MANDATORY for SUPPORTS and CONTRADICTS: at least one handle pointing at the exact evidence item that justifies your judgment. You must fill this in immediately after judgment. Only INSUFFICIENT_EVIDENCE may leave this empty.',
        items: { type: 'string', enum: handleEnum },
      },
      confidence: {
        type: 'string',
        enum: ['HIGH', 'MEDIUM', 'LOW'],
      },
    },
  };
}

module.exports = { buildEntailmentSchema };
