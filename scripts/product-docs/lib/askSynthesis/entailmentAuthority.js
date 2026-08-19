'use strict';

// Ask AutoIngest — Capability Entailment Judge Prototype, Part 6: the
// deterministic safety/fallback contract. The LLM's judgment is NEVER, by
// itself, sufficient to produce an AVAILABLE answer -- this function is the
// single place that decides the final authority-resolved status, and it is
// pure, deterministic code, not a model call.

// Phase C1 -- deterministic, order-preserving dedup. A model repeating the
// same real handle several times (observed with Qwen2.5-7B, e.g.
// ["S1","S1","S1"]) is semantically identical to citing it once; this never
// changes which handles are considered valid, only collapses repeats before
// the count/validity checks below run.
function dedupePreserveOrder(handles) {
  const seen = new Set();
  const out = [];
  for (const h of handles || []) {
    if (!seen.has(h)) {
      seen.add(h);
      out.push(h);
    }
  }
  return out;
}

function resolveEntailmentAuthority({ curatedBoundary, judgeResult, judgeError, handleMap }) {
  // 1. Existing curated boundary always wins -- never second-guessed by the
  // judge, per checkpoint §7. Checked first, unconditionally.
  if (curatedBoundary) {
    return {
      finalStatus: 'NOT_SUPPORTED',
      authoritySource: 'curated-boundary',
      note: `Existing KNOWN_BOUNDARIES entry "${curatedBoundary.id}" is authoritative and was not overridden.`,
      validatedEvidenceHandles: [],
    };
  }

  // 2. Model failure / timeout / malformed output -> safe fallback.
  if (judgeError || !judgeResult) {
    return { finalStatus: 'UNKNOWN', authoritySource: 'model-failure-fallback', note: judgeError || 'no judge result', validatedEvidenceHandles: [] };
  }

  // 3. Deterministic handle normalization, then schema/handle validation --
  // every cited handle must be real.
  const dedupedHandles = dedupePreserveOrder(judgeResult.evidenceHandles);
  const invalidHandles = dedupedHandles.filter((h) => !handleMap.idByHandle.has(h));
  if (invalidHandles.length) {
    return { finalStatus: 'UNKNOWN', authoritySource: 'invalid-handle-fallback', note: `judge cited unknown handle(s): ${invalidHandles.join(',')}`, validatedEvidenceHandles: [] };
  }

  const { judgment, confidence } = judgeResult;

  if (judgment === 'INSUFFICIENT_EVIDENCE') {
    return { finalStatus: 'UNKNOWN', authoritySource: 'judge-insufficient', note: 'judge found no evidence establishing the claim', validatedEvidenceHandles: dedupedHandles };
  }

  if (judgment === 'CONTRADICTS') {
    // Checkpoint §6: CONTRADICTS without an explicit canonical negative
    // boundary is investigated, never automatically turned into
    // NOT_SUPPORTED -- a model asserting a negative is exactly as
    // unverified as one asserting a positive; only the CURATED boundary
    // table (already handled in step 1) is trusted to assert negatives.
    return { finalStatus: 'UNKNOWN', authoritySource: 'judge-contradicts-unconfirmed', note: 'judge asserted CONTRADICTS but no curated boundary confirms it -- treated as insufficient evidence for a denial, not converted to NOT_SUPPORTED, per explicit Product Owner instruction not to trust an unconfirmed model-asserted negative either', validatedEvidenceHandles: dedupedHandles };
  }

  if (judgment === 'SUPPORTS') {
    if (confidence === 'LOW') {
      return { finalStatus: 'UNKNOWN', authoritySource: 'judge-supports-low-confidence', note: 'low-confidence SUPPORTS treated as insufficient evidence, per explicit safe-failure-direction instruction', validatedEvidenceHandles: dedupedHandles };
    }
    if (dedupedHandles.length === 0) {
      return { finalStatus: 'UNKNOWN', authoritySource: 'judge-supports-no-citation-fallback', note: 'SUPPORTS with zero cited evidence handles is treated as insufficient -- an affirmation must point at something', validatedEvidenceHandles: [] };
    }
    return { finalStatus: 'AVAILABLE', authoritySource: 'judge-supports', note: `judge SUPPORTS at ${confidence} confidence, citing ${JSON.stringify(dedupedHandles)}`, validatedEvidenceHandles: dedupedHandles };
  }

  // Unrecognized judgment value (should be schema-impossible, defensive only).
  return { finalStatus: 'UNKNOWN', authoritySource: 'unrecognized-judgment-fallback', note: `unrecognized judgment value: ${judgment}`, validatedEvidenceHandles: [] };
}

module.exports = { resolveEntailmentAuthority, dedupePreserveOrder };
