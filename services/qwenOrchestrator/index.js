'use strict';

// services/qwenOrchestrator/index.js — Ask AutoIngest Stage 4. Public
// entry point. NOTHING in the shipped application calls this module yet
// -- same zero-production-callers discipline every prior stage's own
// entry point established (askRetrieval/retrieval.js, askKnowledge/
// index.js, qwenRuntime/runtime.js). Exists to be imported and tested
// independently; Stage 5 will decide how (or whether) main/
// askAutoIngest.js's own IPC surface eventually wires into this.

const runtime = require('../qwenRuntime/runtime');
const { OrchestratorSession } = require('./session');
const { loadKnowledgeContext } = require('./knowledgeBootstrap');

// buildOrchestratorKnowledgeContext(): the shared, immutable Stage-2
// knowledgeContext, built and cached exactly once by knowledgeBootstrap.js
// -- a real deployment calls this once at startup and passes the result
// to every session it creates; tests do the same.
function buildOrchestratorKnowledgeContext() {
  return loadKnowledgeContext();
}

let _sessionIdCounter = 0;
function nextSessionId() {
  _sessionIdCounter += 1;
  return `orch-${_sessionIdCounter}`;
}

// createOrchestratorSession(knowledgeContext, options?) -- the runtime
// (qwenRuntime) must already be load()ed by the caller before this is
// called; this module never loads the model itself (Section 2 of Stage
// 3's own boundary: model lifecycle is qwenRuntime's job, not this
// module's).
async function createOrchestratorSession(knowledgeContext, options = {}) {
  const session = new OrchestratorSession({ sessionId: options.sessionId || nextSessionId(), knowledgeContext, ...options });
  await session.create();
  return session;
}

module.exports = {
  buildOrchestratorKnowledgeContext, createOrchestratorSession, OrchestratorSession,
  runtime, // re-exported for convenience -- callers still load()/unload()/terminate() the Stage-3 runtime directly
};
