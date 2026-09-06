'use strict';

// services/qwenOrchestrator/knowledgeBootstrap.js — Ask AutoIngest Stage 4,
// Section 3/5. Loads Stage 2's deterministic Knowledge Base
// (scripts/product-docs/lib/askKnowledge/) and Stage 1's certified
// retrieval configuration (scripts/product-docs/lib/askRetrieval/) exactly
// once, the same way those modules' own test suites already bootstrap
// them (`require('.../lib/build').assemble()` -> `{ built }`) -- no
// Electron dependency. Runs in the Electron MAIN process, alongside the
// rest of this orchestrator layer (DEC-026's revised tool-execution-
// locality decision: tool handlers execute in the parent, keeping the
// isolated Qwen child's own crash-sensitive surface exactly as narrow as
// Stage 3/3.1 already qualified it -- see that decision's own updated
// Consequences section).
//
// Deliberately reproduces Stage 2's own certified default exactly:
// buildKnowledgeContext(built) is called WITHOUT a decision-text-
// enrichment ctx override, reproducing Stage 1's own certified retrieval
// baseline (DEC-022) -- Section 34's own explicit "do not silently enable
// experimental enrichment" instruction.

const path = require('path');

let _cached = null;

function loadKnowledgeContext() {
  if (_cached) return _cached;
  // Resolved relative to this file, not process.cwd() -- this module may
  // run inside an isolated utilityProcess child whose cwd is not
  // guaranteed to be the repo root.
  const buildPath = path.join(__dirname, '..', '..', 'scripts', 'product-docs', 'lib', 'build.js');
  const askKnowledgePath = path.join(__dirname, '..', '..', 'scripts', 'product-docs', 'lib', 'askKnowledge', 'index.js');
  const build = require(buildPath);
  const { buildKnowledgeContext } = require(askKnowledgePath);

  const { built } = build.assemble();
  _cached = buildKnowledgeContext(built);
  return _cached;
}

// Test-only reset -- production code never needs to reload mid-process
// (the corpus is static generated data, not something that changes while
// a conversation is active).
function _resetForTesting() {
  _cached = null;
}

module.exports = { loadKnowledgeContext, _resetForTesting };
