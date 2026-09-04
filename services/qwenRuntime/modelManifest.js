'use strict';

// services/qwenRuntime/modelManifest.js — Ask AutoIngest Stage 3 (Qwen
// runtime + model lifecycle foundation), Section 7/10: single source of
// truth for the approved Ask AutoIngest model runtime configuration.
//
// Model identity is pinned explicitly (same discipline
// services/localJudge/modelManager.js already established for Gemma): no
// automatic upgrades, no silent quantization/revision substitution. The
// artifact identity below is the exact Checkpoint 12/14 qualification
// model, as supplied by the Product Owner's own Stage 3 brief -- this
// module does not independently re-derive it, since Section 2's own
// verification step (this stage's report) is the place that check
// happens, against the real local file when present.
//
// Everything a caller needs to know about the Ask AutoIngest model
// runtime lives here, in ONE place -- never scattered across the manager/
// runtime/worker files below (Section 7's own explicit requirement).
// Conversational prompts, tool definitions, and orchestrator policy are
// NOT model lifecycle data and do not belong here -- see Section 17's own
// boundary (Stage 4 territory).

const MODEL_KEY = 'qwen3.5-4b-instruct-q4km';

const MODEL_IDENTITY = Object.freeze({
  key: MODEL_KEY,
  family: 'Qwen3.5',
  displayName: 'Qwen3.5-4B-Instruct (Q4_K_M)',
  filename: 'qwen3.5-4b-instruct-Q4_K_M.gguf',
  quantization: 'Q4_K_M',
  // Checkpoint 12/14 qualification artifact -- Section 2's own verification
  // step checks the real local file against these exact values and STOPS
  // rather than substituting anything if they don't match.
  expectedSizeBytes: 2740937888,
  expectedSha256: '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4',
  // Not an OSI license id -- disclosed honestly, mirroring
  // modelManager.js's own MODEL_LICENSE discipline for Gemma. Not
  // independently re-verified against the model card this stage; a
  // required follow-up before any release build ships with this model,
  // same as Gemma's own disclosed gap.
  license: 'Qwen License (Alibaba/Qwen team) -- not independently re-verified against the model card this stage.',
});

// Runtime compatibility -- the exact node-llama-cpp version and chat-
// wrapper configuration the Checkpoint 12/14 qualification measured
// behavior against (Section 5/18). Verified this stage: the installed
// package.json dependency (^3.20.0) resolves to the exact 3.20.0 the
// qualification used -- zero version drift, so no compatibility
// re-assessment was required beyond confirming this fact directly.
const RUNTIME_COMPATIBILITY = Object.freeze({
  nodeLlamaCppVersion: '3.20.0',
  nodeLlamaCppVersionRange: '^3.20.0', // package.json's own pinned range, unchanged by this stage
  chatWrapper: Object.freeze({
    type: 'QwenChatWrapper',
    // Exact options the qualification used (engineC14.js, byte-identical
    // to C12/C13) -- verified directly against the installed package's
    // own QwenChatWrapper.d.ts, which documents this exact option shape.
    variation: '3.5',
    thoughts: 'discourage', // never expose chain-of-thought (Section 18)
  }),
});

// Context configuration (Section 7): 24576 is the qualified production
// candidate context size (Checkpoint 14's own long-conversation
// qualification, measured at substantially lower RAM than the
// unrestricted/default context). Never left to node-llama-cpp's own
// implicit default -- every context/session created by this runtime
// passes this value explicitly (see runtimeWorker.js's own
// createContext() call).
const CONTEXT_SIZE = 24576;

// Inference defaults relevant to model runtime configuration (NOT
// conversational policy -- Section 7's own "not conversational prompts"
// boundary). A future Stage 4 caller may override maxTokens/etc per
// request; these are the runtime-level defaults this module documents as
// a single source of truth, not a claim that Stage 3 itself performs
// conversational inference.
//
// sequences=2, NOT 1 -- a Stage 3.1 real-model finding, not the original
// Stage 3 design. The parent (runtime.js) still only ever dispatches ONE
// tracked, caller-visible request at a time (Section 20's "one active
// generation" invariant, unchanged and still enforced by its own FIFO
// queue) -- but this runtime's own cancellation strategy (Section 19,
// DEC-025) deliberately lets a cancelled request's native generation keep
// running in the background rather than interrupting it. With only 1
// sequence slot, an immediately-following request would collide with that
// still-running abandoned generation and fail with a real, reproduced
// "No sequences left" error (found via real-model cancellation-stress
// testing, not theorized). The second slot is a resource cushion for
// exactly that transient overlap, not an invitation for the parent to run
// two real concurrent generations -- each sequence still gets the full
// pinned CONTEXT_SIZE (24576), confirmed directly: creating a context with
// sequences:2 reports sequence.contextSize=24576 for each sequence, not a
// value divided between them (only the underlying total allocated KV-cache
// size doubles).
const INFERENCE_DEFAULTS = Object.freeze({
  sequences: 2,
});

// Storage: the subdirectory name under Electron's app.getPath('userData')
// this model's artifact lives in -- mirrors modelManager.js's own
// 'local-judge-models' convention exactly, parallel (not shared) so
// Qwen's own storage lifecycle is never entangled with Gemma's.
const STORAGE_SUBDIR = 'qwen-runtime-models';

// Acquisition/download source state (Section 9/13): no approved hosting
// source currently exists for this exact artifact -- represented
// explicitly as NOT_CONFIGURED, never a fabricated or guessed URL. Mirrors
// modelManager.js's own DOWNLOAD_URL='' + gated-off-entirely convention
// for Gemma. main/askAutoIngest.js's PRODUCTION_DOWNLOAD_SOURCE_APPROVED
// flag (unchanged by this stage) is the same production gate that keeps
// any download code path from running until a real, byte-verified source
// is resolved and explicitly approved.
const DOWNLOAD_SOURCE_STATE = 'NOT_CONFIGURED';
const DOWNLOAD_URL = '';

function buildManifest() {
  return Object.freeze({
    modelKey: MODEL_KEY,
    identity: MODEL_IDENTITY,
    runtimeCompatibility: RUNTIME_COMPATIBILITY,
    contextSize: CONTEXT_SIZE,
    inferenceDefaults: INFERENCE_DEFAULTS,
    storageSubdir: STORAGE_SUBDIR,
    downloadSourceState: DOWNLOAD_SOURCE_STATE,
    downloadUrl: DOWNLOAD_URL,
    manifestVersion: 1, // bump when any pinned field above changes -- used by the verification-cache invalidation policy (modelManager.js)
  });
}

module.exports = {
  MODEL_KEY, MODEL_IDENTITY, RUNTIME_COMPATIBILITY, CONTEXT_SIZE, INFERENCE_DEFAULTS,
  STORAGE_SUBDIR, DOWNLOAD_SOURCE_STATE, DOWNLOAD_URL, buildManifest,
};
