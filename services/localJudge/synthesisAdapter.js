'use strict';

// services/localJudge/synthesisAdapter.js — Phase C5. The production
// adapter for answer SYNTHESIS, mirroring judgeAdapter.js's structure
// exactly (same runtime, same infer() contract, same "thin, no fallback
// logic of its own" discipline) but built from the askSynthesis/*
// synthesis modules (promptTemplates.js/synthesisSchema.js/sourceHandles.js/
// safetyValidation.js) instead of the entailment ones.
//
// Interface: async (evidencePackage, { signal }) => resolved synthesis
// object (handles already converted back to real record ids/paths by
// safetyValidation.js's resolveHandles()) -- or throws. Every failure mode
// this checkpoint's Section N enumerates (model unavailable, malformed
// JSON, schema-invalid output, fabricated handle, status mismatch, timeout,
// cancellation) surfaces as a single rejected promise here; the caller
// (scripts/product-docs/lib/answerWithSynthesis.js) is responsible for
// catching it and falling back to the untouched deterministic/authority
// answer -- this module never has its own fallback opinion.

const path = require('path');
const PRODUCT_DOCS = path.join(__dirname, '..', '..', 'scripts', 'product-docs');
const { buildSynthesisPrompt } = require(path.join(PRODUCT_DOCS, 'lib', 'askSynthesis', 'promptTemplates'));
const { buildSynthesisSchema } = require(path.join(PRODUCT_DOCS, 'lib', 'askSynthesis', 'synthesisSchema'));
const { validateSynthesis } = require(path.join(PRODUCT_DOCS, 'lib', 'askSynthesis', 'safetyValidation'));
const { resolveMaxTokens } = require(path.join(PRODUCT_DOCS, 'lib', 'askSynthesis', 'synthesisBudget'));
const runtime = require('./runtime');

// Phase C5.2: maxTokens is no longer a single fixed value -- it is resolved
// per-request from the evidence package's own (already-deterministic)
// classification via synthesisBudget.js's resolveMaxTokens(), which is
// where the real-model-derived rationale and measurements live. `maxTokens`
// remains an optional CONSTRUCTOR override (tests only -- no production
// caller passes it) for parity with judgeAdapter.js's own override
// discipline; when omitted (the production path), every call computes its
// own budget fresh from that request's classification.
function createSynthesisAdapter({ modelPath, timeoutMs, maxTokens, repeatPenalty }) {
  if (!modelPath) throw new Error('createSynthesisAdapter requires an explicit modelPath');
  if (!timeoutMs) throw new Error('createSynthesisAdapter requires an explicit, measurement-derived timeoutMs');

  return async function synthesize(evidencePackage, { signal } = {}) {
    const { system, user, handleMap } = buildSynthesisPrompt(evidencePackage);
    const schema = buildSynthesisSchema(evidencePackage, handleMap);
    const effectiveMaxTokens = maxTokens || resolveMaxTokens(evidencePackage.classification);

    const result = await runtime.infer({ system, user, schema, maxTokens: effectiveMaxTokens, repeatPenalty, modelPath, timeoutMs, signal });

    if (result.parseError || !result.parsed) {
      throw new Error(result.parseError || 'synthesis model produced no parseable output');
    }

    const validation = validateSynthesis(result.parsed, evidencePackage, handleMap);
    if (!validation.ok) {
      throw Object.assign(
        new Error(`synthesis failed safety validation: ${validation.failedChecks.join(', ')}`),
        { failedChecks: validation.failedChecks, safetyValidationFailure: true },
      );
    }
    // `resolved` (safetyValidation.js's resolveHandles() output) is the
    // candidate with every handle already converted back to its real
    // record id -- the ONLY shape this module ever returns; raw handles
    // never leak past this function.
    return validation.resolved;
  };
}

module.exports = { createSynthesisAdapter };
