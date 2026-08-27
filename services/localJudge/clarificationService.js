'use strict';

// Phase C8 — mirrors synthesisService.js exactly (same modelManager
// availability check, same shared runtime.js singleton/path, same
// "provider injected into the orchestrator, tests only override it"
// discipline). See clarificationAdapter.js for the actual call and its
// safety property.

const modelManager = require('./modelManager');
const { createClarificationAdapter } = require('./clarificationAdapter');

let _formulator = null;
function getFormulator() {
  if (!_formulator) {
    const { finalPath } = modelManager.resolvePaths();
    _formulator = createClarificationAdapter({ modelPath: finalPath });
  }
  return _formulator;
}

function getModelAvailability() {
  try {
    return modelManager.getStatus();
  } catch (err) {
    return { status: modelManager.STATUS.ERROR, detail: { reason: 'runtime-environment-unavailable', message: err.message } };
  }
}

async function productionFormulateClarification(input, { signal } = {}) {
  const availability = getModelAvailability();
  if (availability.status !== modelManager.STATUS.READY) {
    const reason = (availability.detail && availability.detail.reason) || availability.status;
    throw Object.assign(
      new Error(`local clarification model unavailable: model is ${availability.status}${reason && reason !== availability.status ? ` (${reason})` : ''}`),
      { modelState: availability.status, modelUnavailable: true },
    );
  }
  const formulate = getFormulator();
  return formulate(input, { signal });
}

module.exports = { productionFormulateClarification, getModelAvailability, getFormulator };
