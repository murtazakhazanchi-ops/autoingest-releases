'use strict';

// services/qwenRuntime/errors.js — Ask AutoIngest Stage 3, Section 22
// (error model). Typed internal runtime errors/result states shared by
// modelManager.js, runtime.js, and runtimeWorker.js -- so every layer of
// this module tree reports failures through the SAME small, closed
// vocabulary, never a raw native exception surfacing to whatever calls
// this runtime (Stage 3 is internal-only, but the boundary is built now,
// per the brief's own explicit instruction).

const ERROR_CODE = Object.freeze({
  MODEL_NOT_INSTALLED: 'MODEL_NOT_INSTALLED',
  MODEL_CORRUPT: 'MODEL_CORRUPT',
  MODEL_INCOMPATIBLE: 'MODEL_INCOMPATIBLE',
  MODEL_LOAD_FAILED: 'MODEL_LOAD_FAILED',
  CONTEXT_CREATE_FAILED: 'CONTEXT_CREATE_FAILED',
  INFERENCE_FAILED: 'INFERENCE_FAILED',
  INFERENCE_CANCELLED: 'INFERENCE_CANCELLED',
  RUNTIME_CRASHED: 'RUNTIME_CRASHED',
  OUT_OF_MEMORY: 'OUT_OF_MEMORY',
  CONTEXT_LIMIT: 'CONTEXT_LIMIT',
  DOWNLOAD_NOT_CONFIGURED: 'DOWNLOAD_NOT_CONFIGURED',
  DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
  INSUFFICIENT_SPACE: 'INSUFFICIENT_SPACE',
  CANCELLED: 'CANCELLED',
  UNKNOWN: 'UNKNOWN',
});

class QwenRuntimeError extends Error {
  constructor(code, message, detail) {
    super(message || code);
    this.name = 'QwenRuntimeError';
    this.code = ERROR_CODE[code] ? code : ERROR_CODE.UNKNOWN;
    this.detail = detail || null;
  }
}

// Maps a raw, untrusted error (a native exception, an HTTP failure, a
// JSON.parse failure, anything) into a QwenRuntimeError with the closest
// applicable code -- the single choke point every layer routes an
// unexpected failure through, so a raw native exception's message/stack
// never becomes the ONLY signal a caller has to work with (Section 22's
// own "do not expose raw native exceptions" requirement) while still
// preserving the original message/detail for internal diagnostics.
//
// Detection is pattern-based on the ORIGINAL error's own message/name,
// since node-llama-cpp does not (as of the qualified 3.20.0) expose a
// stable, documented error-code taxonomy of its own for every failure
// class listed here -- disclosed as a real limitation (Section 23), not
// silently assumed reliable. A future node-llama-cpp release exposing
// structured error types should replace this heuristic, not layer on top
// of it.
function mapUnknownError(err, fallbackCode = ERROR_CODE.UNKNOWN) {
  if (err instanceof QwenRuntimeError) return err;
  const message = (err && err.message) ? err.message : String(err);
  const lower = message.toLowerCase();
  if (err && err.cancelled) return new QwenRuntimeError('INFERENCE_CANCELLED', message, { original: message });
  if (/context.{0,20}(size|length|limit)|exceed.{0,20}context|too many tokens/i.test(message)) {
    return new QwenRuntimeError('CONTEXT_LIMIT', message, { original: message });
  }
  if (/out of memory|oom|allocation failed|cannot allocate/i.test(lower)) {
    return new QwenRuntimeError('OUT_OF_MEMORY', message, { original: message });
  }
  if (/enoent|no such file/i.test(lower)) {
    return new QwenRuntimeError('MODEL_NOT_INSTALLED', message, { original: message });
  }
  return new QwenRuntimeError(fallbackCode, message, { original: message });
}

module.exports = { ERROR_CODE, QwenRuntimeError, mapUnknownError };
