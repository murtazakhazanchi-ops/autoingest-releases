'use strict';

// services/localJudge/judgeAdapter.js — Phase C2. The production adapter
// satisfying C1's exact injected-judge interface:
//   async (pkg, handleMap) => { judgment, evidenceHandles, confidence }
// (or throws -- lib/capabilityAuthority.js's applyCapabilityAuthority()
// already catches any judge exception and resolves the safe UNKNOWN
// fallback; this file relies on that existing, already-tested contract
// rather than reimplementing its own fallback logic).
//
// Deliberately thin: builds the prompt/schema using the EXISTING,
// unmodified scripts/product-docs/lib/askSynthesis/entailmentPrompt.js and
// entailmentSchema.js (no prompt/schema change in C2, per Part H's
// explicit preference), calls runtime.js's generic infer(), and strips the
// response down to exactly the three C1-contract fields -- never leaks
// raw/parseError/timing or any other diagnostic field into the returned
// judgment object, and never adds operator-facing prose, recommendations,
// or tool-call-shaped output of any kind.

const path = require('path');
const { buildEntailmentPrompt } = require(path.join(__dirname, '..', '..', 'scripts', 'product-docs', 'lib', 'askSynthesis', 'entailmentPrompt'));
const { buildEntailmentSchema } = require(path.join(__dirname, '..', '..', 'scripts', 'product-docs', 'lib', 'askSynthesis', 'entailmentSchema'));
const runtime = require('./runtime');

const VALID_JUDGMENTS = new Set(['SUPPORTS', 'CONTRADICTS', 'INSUFFICIENT_EVIDENCE']);
const VALID_CONFIDENCE = new Set(['HIGH', 'MEDIUM', 'LOW']);

// maxTokens=200 and no repeatPenalty are the exact settings the successful
// Phi-4-mini benchmark used throughout every checkpoint in this
// investigation (98.2% accuracy, 0 false SUPPORTS) -- Qwen's
// repeatPenalty=1.3 is deliberately NOT copied here (Part J: "do not
// introduce it unless testing demonstrates a need"; Phi never needed it in
// any run). modelPath/timeoutMs are required, explicit constructor
// arguments -- never silently defaulted, since timeoutMs specifically must
// come from real measurement (Part L), not invention.
function createJudgeAdapter({ modelPath, timeoutMs, maxTokens = 200, repeatPenalty }) {
  if (!modelPath) throw new Error('createJudgeAdapter requires an explicit modelPath');
  if (!timeoutMs) throw new Error('createJudgeAdapter requires an explicit, measurement-derived timeoutMs');

  return async function judge(pkg, handleMap, { signal } = {}) {
    const { system, user } = buildEntailmentPrompt(pkg, handleMap);
    const schema = buildEntailmentSchema(handleMap);

    const result = await runtime.infer({ system, user, schema, maxTokens, repeatPenalty, modelPath, timeoutMs, signal });

    if (result.parseError || !result.parsed) {
      throw new Error(result.parseError || 'model produced no parseable output');
    }
    const { judgment, evidenceHandles, confidence } = result.parsed;
    if (!VALID_JUDGMENTS.has(judgment)) {
      throw new Error(`model produced an unrecognized judgment value: ${judgment}`);
    }
    if (!VALID_CONFIDENCE.has(confidence)) {
      throw new Error(`model produced an unrecognized confidence value: ${confidence}`);
    }
    // Strip to EXACTLY the C1 contract -- no raw text, no timing, no
    // reasonCode (already absent from the schema itself), nothing else.
    return { judgment, evidenceHandles: Array.isArray(evidenceHandles) ? evidenceHandles : [], confidence };
  };
}

module.exports = { createJudgeAdapter };
