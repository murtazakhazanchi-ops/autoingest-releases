'use strict';

// services/qwenOrchestrator/errors.js — Ask AutoIngest Stage 4, Section 31
// (error mapping). Typed orchestrator-level outcomes, layered on top of
// (never replacing) Stage 3's own qwenRuntime ERROR_CODE vocabulary --
// every Stage-3 code is re-exported unchanged so a caller never has to
// check two separate enums for the same underlying runtime failure.
// Orchestrator-only codes cover conversation/tool-loop/validation
// conditions that have no Stage-3 runtime equivalent (Stage 3 has no
// concept of a session, a tool, or an answer).

const { ERROR_CODE: RUNTIME_ERROR_CODE, QwenRuntimeError } = require('../qwenRuntime/errors');

const ORCHESTRATOR_ERROR_CODE = Object.freeze({
  // Re-exported Stage 3 runtime codes (not redefined -- same string values)
  ...RUNTIME_ERROR_CODE,
  // Session lifecycle
  SESSION_NOT_FOUND: 'SESSION_NOT_FOUND',
  SESSION_ALREADY_EXISTS: 'SESSION_ALREADY_EXISTS',
  SESSION_BUSY: 'SESSION_BUSY',
  // Knowledge-tool failures (Section 31: "relevant Knowledge-tool failures")
  KNOWLEDGE_TOOL_FAILED: 'KNOWLEDGE_TOOL_FAILED',
  // Turn-level safety outcomes
  ACTION_LIMIT_REACHED: 'ACTION_LIMIT_REACHED',
  PATHOLOGICAL_REPETITION: 'PATHOLOGICAL_REPETITION',
  ANSWER_VALIDATION_FAILED: 'ANSWER_VALIDATION_FAILED',
  REGENERATION_EXHAUSTED: 'REGENERATION_EXHAUSTED',
  TURN_CANCELLED: 'TURN_CANCELLED',
});

class OrchestratorError extends Error {
  constructor(code, message, detail) {
    super(message || code);
    this.name = 'OrchestratorError';
    this.code = ORCHESTRATOR_ERROR_CODE[code] ? code : 'UNKNOWN';
    this.detail = detail || null;
  }
}

// Same choke-point discipline as qwenRuntime/errors.js's own
// mapUnknownError(): every layer routes an unexpected failure through
// here, so a raw exception's message/stack never becomes the only signal
// a caller (eventually Stage 5's IPC layer) has to work with.
function mapUnknownError(err, fallbackCode = 'UNKNOWN') {
  if (err instanceof OrchestratorError) return err;
  if (err instanceof QwenRuntimeError) return new OrchestratorError(err.code, err.message, err.detail);
  const message = (err && err.message) ? err.message : String(err);
  return new OrchestratorError(fallbackCode, message, { original: message });
}

module.exports = { ORCHESTRATOR_ERROR_CODE, OrchestratorError, mapUnknownError };
