'use strict';

// main/askAutoIngest.js — Phase C4. Thin IPC dispatcher for the Ask
// AutoIngest product surface, mirroring this codebase's existing
// "dispatcher thin, logic in a module" convention (see
// scripts/product-docs/lib/knowledgeCli.js's own header comment for the
// same discipline in that tool). All PURE shaping/sanitization logic
// lives in main/askAutoIngestPresentation.js (Electron-independent,
// unit-testable under plain `node`); this file owns only the Electron/IPC
// glue and the two pieces of real state (the in-flight query controller,
// the in-flight download controller). It reimplements NONE of C1/C2/C3's
// actual logic -- every real decision (authority scope, judge invocation,
// model verification) happens in the already-proven, unmodified modules
// this file only calls.
//
// Security posture (Part E/S): the renderer never receives a filesystem
// path, a download URL, or any way to supply one -- every IPC handler
// here takes either no arguments or a plain, validated question string.
// No shell execution. No arbitrary model source. No raw utilityProcess
// access -- the renderer only ever sees the shaped JSON answer/status
// objects below.

const path = require('path');
const { ipcMain } = require('electron');

const PRODUCT_DOCS = path.join(__dirname, '..', 'scripts', 'product-docs');
const { assemble } = require(path.join(PRODUCT_DOCS, 'lib', 'build.js'));
const { buildEngineContext } = require(path.join(PRODUCT_DOCS, 'lib', 'knowledgeEngine.js'));
// Phase C5: answerQuestionWithSynthesis()/answerKnownRecordWithSynthesis()
// call the unmodified answerQuestionWithAuthority()/
// answerKnownRecordWithAuthority() first, then attempt LLM synthesis on top
// -- see scripts/product-docs/lib/answerWithSynthesis.js's own header for
// the full pipeline and fallback contract. This file no longer calls
// answerWithAuthority.js directly; every real decision (authority scope,
// judge invocation, synthesis eligibility, safety validation) still lives
// in those already-tested modules, none of it here.
const { answerQuestionWithSynthesis, answerKnownRecordWithSynthesis } = require(path.join(PRODUCT_DOCS, 'lib', 'answerWithSynthesis.js'));
// Phase C8 — the conversational entrypoint. Reuses answerQuestionWithAuthority/
// trySynthesize/evaluateSynthesisEligibility internally (all unchanged); this
// file only supplies the same production synthesizer/semantic/clarification
// providers a one-shot ask already had access to, plus the SINGLE in-memory
// conversation state this drawer instance holds (mirrors _activeController's
// own "one thing at a time" precedent below, not session-persisted, not
// written to disk).
const { askConversational } = require(path.join(PRODUCT_DOCS, 'lib', 'conversationalAsk.js'));
const CS = require(path.join(PRODUCT_DOCS, 'lib', 'conversationState.js'));

const modelManager = require('../services/localJudge/modelManager');
const judgeService = require('../services/localJudge/judgeService');
const clarificationService = require('../services/localJudge/clarificationService');
const semanticRetrievalService = require('../services/semanticRetrieval/semanticRetrievalService');
const { shapeAnswerForUI, shapeModelStatus, shapeConversationalResponse } = require('./askAutoIngestPresentation');

// No approved production hosting source exists yet for the exact pinned
// artifact (Product Owner decision, C2/C3: modelManager.DOWNLOAD_URL is
// documented as a best-candidate that is NOT byte-identical to the pinned
// identity and would predictably fail checksum verification). Per this
// checkpoint's explicit instruction ("the Download button must NOT
// pretend to work... disable the actual download action"), download is
// gated behind this single flag rather than silently substituting or
// attempting a download known to fail. Flipping this to true (a future,
// separate Product Owner decision) is the ONLY change needed once a real
// source is approved -- no other code here changes.
const PRODUCTION_DOWNLOAD_SOURCE_APPROVED = false;

// Builds a fresh deterministic-engine context per request, matching the
// EXISTING convention already used by both knowledge-portal/server.js's
// /api/ask and lib/knowledgeCli.js's `ask` command (neither caches ctx
// across requests) -- not a new pattern introduced here.
function freshCtx() {
  const { built } = assemble();
  return buildEngineContext(built);
}

// One in-flight query at a time (matches C2's own single-inference-queue
// design -- a second concurrent query would simply queue behind the first
// inside runtime.js anyway; this AbortController is what lets the
// renderer's Cancel button actually interrupt the CURRENT one).
let _activeController = null;

async function handleAskQuery(question) {
  if (typeof question !== 'string' || !question.trim()) {
    throw new Error('A question is required.');
  }
  if (question.length > 2000) {
    throw new Error('Question is too long.');
  }
  if (_activeController) _activeController.abort();
  const controller = new AbortController();
  _activeController = controller;
  try {
    const ctx = freshCtx();
    const answer = await answerQuestionWithSynthesis(question.trim(), ctx, { signal: controller.signal });
    return shapeAnswerForUI(answer, ctx);
  } finally {
    if (_activeController === controller) _activeController = null;
  }
}

// Related-topic direct navigation checkpoint. `recordId` is never
// operator-typed free text -- it only ever comes from a previous shaped
// answer's own relatedCapabilities[].id (main/askAutoIngestPresentation.js's
// shapeAnswerForUI already resolved those from the deterministic engine's
// own real record ids). This validation is a plain system-boundary check
// against a malformed/tampered IPC payload, not a lookup -- the actual
// existence check happens inside answerForKnownRecord() (knowledgeEngine.js),
// which returns null for anything that isn't a real record.
const RECORD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

async function handleAskRelatedNavigate(recordId) {
  if (typeof recordId !== 'string' || !RECORD_ID_RE.test(recordId)) {
    throw new Error('That related topic could not be opened.');
  }
  // Shares the SAME single-in-flight-query controller as handleAskQuery
  // above -- a Related click still cancels an overlapping typed ask (or
  // vice versa) so a stale response can never land after a newer one.
  // The known-record lookup itself is a fast, synchronous-under-the-hood id
  // lookup (no judge/model call -- see answerWithAuthority.js's own header
  // comment); only the synthesis step on top of it is async/cancellable.
  if (_activeController) _activeController.abort();
  const controller = new AbortController();
  _activeController = controller;
  try {
    const ctx = freshCtx();
    const answer = await answerKnownRecordWithSynthesis(recordId, ctx, { signal: controller.signal });
    if (!answer) throw new Error('That related topic could not be opened.');
    return shapeAnswerForUI(answer, ctx);
  } finally {
    if (_activeController === controller) _activeController = null;
  }
}

// Phase C8 — the single, in-memory, session-local conversation this
// drawer instance holds (checkpoint Section 2: NOT session-persistent,
// never written to disk). Reset explicitly by the renderer (a fresh
// question the operator marks as unrelated to the prior thread) or
// implicitly by askConversational()'s own topic-change detection, which
// is threaded through the returned state, not this module.
let _conversationState = CS.createConversation();

async function handleAskConverse(message) {
  if (typeof message !== 'string' || !message.trim()) {
    throw new Error('A message is required.');
  }
  if (message.length > 2000) {
    throw new Error('Message is too long.');
  }
  if (_activeController) _activeController.abort();
  const controller = new AbortController();
  _activeController = controller;
  try {
    const ctx = freshCtx();
    const { state, response } = await askConversational(_conversationState, message.trim(), ctx, {
      signal: controller.signal,
      // synthesize: intentionally omitted -- trySynthesize() (reused
      // unchanged from answerWithSynthesis.js) already defaults to the
      // real productionSynthesize provider when this is absent, exactly
      // matching the one-shot ask:query path above.
      semanticTopK: (question) => semanticRetrievalService.productionSemanticTopK(question),
      formulateClarification: (input, opts) => clarificationService.productionFormulateClarification(input, opts),
    });
    _conversationState = state;
    return shapeConversationalResponse(response, ctx);
  } finally {
    if (_activeController === controller) _activeController = null;
  }
}

function handleResetConversation() {
  _conversationState = CS.createConversation();
  return { reset: true };
}

function handleCancelQuery() {
  if (_activeController) {
    _activeController.abort();
    _activeController = null;
    return { cancelled: true };
  }
  return { cancelled: false };
}

function getModelStatus() {
  return shapeModelStatus(judgeService.getModelAvailability(), {
    downloadSourceApproved: PRODUCTION_DOWNLOAD_SOURCE_APPROVED,
    modelId: modelManager.MODEL_ID,
    modelFilename: modelManager.MODEL_FILENAME,
    expectedSizeBytes: modelManager.EXPECTED_SIZE_BYTES,
    license: modelManager.MODEL_LICENSE,
  });
}

let _downloadController = null;

async function handleDownloadModel(event) {
  if (!PRODUCTION_DOWNLOAD_SOURCE_APPROVED) {
    throw new Error('No approved production model source is configured yet. Download is disabled until one is approved.');
  }
  if (_downloadController) throw new Error('A download is already in progress.');
  const controller = new AbortController();
  _downloadController = controller;
  const sender = event.sender;
  try {
    await modelManager.download(undefined, {
      signal: controller.signal,
      onProgress: (progress) => {
        if (!sender.isDestroyed()) sender.send('ask:downloadProgress', progress);
      },
    });
    return getModelStatus();
  } finally {
    _downloadController = null;
  }
}

function handleCancelDownload() {
  if (_downloadController) {
    _downloadController.abort();
    return { cancelled: true };
  }
  return { cancelled: false };
}

async function handleRetryVerification() {
  await modelManager.verify();
  return getModelStatus();
}

async function handleRemoveModel() {
  await modelManager.remove();
  return getModelStatus();
}

function registerIpcHandlers() {
  ipcMain.handle('ask:query', async (event, question) => handleAskQuery(question));
  ipcMain.handle('ask:relatedNavigate', async (event, recordId) => handleAskRelatedNavigate(recordId));
  ipcMain.handle('ask:converse', async (event, message) => handleAskConverse(message));
  ipcMain.handle('ask:resetConversation', () => handleResetConversation());
  ipcMain.handle('ask:cancelQuery', () => handleCancelQuery());
  ipcMain.handle('ask:modelStatus', () => getModelStatus());
  ipcMain.handle('ask:downloadModel', async (event) => handleDownloadModel(event));
  ipcMain.handle('ask:cancelDownload', () => handleCancelDownload());
  ipcMain.handle('ask:retryVerification', async () => handleRetryVerification());
  ipcMain.handle('ask:removeModel', async () => handleRemoveModel());
}

// App-quit cleanup (Part W) -- delegates to judgeService.terminate() ->
// runtime.terminate(), unchanged from C2/C3. Still no automatic
// idle-unload timer anywhere in this file or any file it calls.
function shutdown() {
  if (_activeController) _activeController.abort();
  if (_downloadController) _downloadController.abort();
  return judgeService.terminate();
}

module.exports = { registerIpcHandlers, shutdown, PRODUCTION_DOWNLOAD_SOURCE_APPROVED };
