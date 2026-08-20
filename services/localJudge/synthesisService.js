'use strict';

// services/localJudge/synthesisService.js — Phase C5. The ONE authoritative
// construction path for answer SYNTHESIS, mirroring judgeService.js exactly
// (Part M's explicit requirement: "the same local model may perform
// authority judgment and answer synthesis... do not load two copies").
// Both this module and judgeService.js call runtime.ensureLoaded() with the
// SAME modelPath (modelManager.resolvePaths().finalPath) -- runtime.js's own
// ensureLoaded() is idempotent for a matching path (returns
// {alreadyLoaded:true} instead of spawning a second load), and both share
// the SAME module-level singleton child process and FIFO inference queue
// (runtime.js's own header comment) -- so a judge call and a synthesis call
// for the same request are strictly serialized through one process, never
// concurrent, never a second model instance.
//
// PRODUCTION_SYNTHESIS_TIMEOUT_MS: measured, not invented (Part L). Derived
// from services/localJudge/electronSynthesisBenchmark.js's two real,
// independent runs against the real Phi-4-mini-instruct GGUF through the
// real utilityProcess runtime (checkpoint Section U -- see
// bench/results/phase-c5-synthesis-13q-real-model.json): worst observed
// applied-synthesis latency across both runs was 20,636ms ("What is QMZ?",
// a long, historically-rich record); the longest single inference overall
// (a case that ultimately failed schema validation on truncated JSON, at
// maxTokens=500) was 18,633ms. 45,000ms is >2.1x the worst observed case --
// comparable headroom to judgeService.js's own PRODUCTION_JUDGE_TIMEOUT_MS
// (20,000ms against an ~8.2s worst case, ~2.4x). Deliberately a SEPARATE
// constant from PRODUCTION_JUDGE_TIMEOUT_MS (Part L's own question) --
// synthesis's maxTokens=500 (synthesisAdapter.js) is 2.5x the judge's
// maxTokens=200, and observed latency scales accordingly; a single shared
// 20s timeout would have been too tight for synthesis (would have clipped
// the 20,636ms case).
const PRODUCTION_SYNTHESIS_TIMEOUT_MS = 45000;

const modelManager = require('./modelManager');
const { createSynthesisAdapter } = require('./synthesisAdapter');

let _synthesizer = null;
function getSynthesizer() {
  if (!_synthesizer) {
    const { finalPath } = modelManager.resolvePaths();
    _synthesizer = createSynthesisAdapter({ modelPath: finalPath, timeoutMs: PRODUCTION_SYNTHESIS_TIMEOUT_MS });
  }
  return _synthesizer;
}

// Same environment-detection discipline as judgeService.js's
// getModelAvailability() -- modelManager.getStatus() requires a real
// Electron process; outside one, this module must report "unavailable",
// never throw or crash a plain-`node` caller (the knowledge portal, CLI,
// and this module's own unit tests all run outside Electron).
function getModelAvailability() {
  try {
    return modelManager.getStatus();
  } catch (err) {
    return { status: modelManager.STATUS.ERROR, detail: { reason: 'runtime-environment-unavailable', message: err.message } };
  }
}

// The production synthesizer PROVIDER injected into
// answerWithSynthesis.js's trySynthesize(). Availability is checked lazily,
// only when actually called -- the eligibility gate
// (askSynthesis/synthesisEligibility.js) already decides WHETHER to call
// this at all; this function only decides whether the model itself can
// currently serve that call.
async function productionSynthesize(evidencePackage, { signal } = {}) {
  const availability = getModelAvailability();
  if (availability.status !== modelManager.STATUS.READY) {
    const reason = (availability.detail && availability.detail.reason) || availability.status;
    throw Object.assign(
      new Error(`local synthesis model unavailable: model is ${availability.status}${reason && reason !== availability.status ? ` (${reason})` : ''}`),
      { modelState: availability.status, modelUnavailable: true },
    );
  }
  const synthesize = getSynthesizer();
  return synthesize(evidencePackage, { signal });
}

// No separate terminate() -- shares runtime.js's singleton with
// judgeService.js, which already owns app-quit teardown
// (judgeService.terminate() -> runtime.terminate()). Adding a second
// terminate() path here would risk exactly the double-teardown/race Part M
// warns against for no benefit; main/askAutoIngest.js's shutdown() already
// covers both judge and synthesis by tearing down the one shared runtime.

module.exports = {
  productionSynthesize,
  getModelAvailability,
  getSynthesizer,
  PRODUCTION_SYNTHESIS_TIMEOUT_MS,
};
