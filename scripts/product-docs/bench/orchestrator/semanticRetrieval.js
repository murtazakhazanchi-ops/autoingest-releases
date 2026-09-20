'use strict';

// ASK AUTOINGEST — CHECKPOINT 7, PHASE 5. EXPERIMENTAL.
//
// Reuses the existing, production-validated C7/C8 semantic-retrieval
// infrastructure VERBATIM (embeddingModelManager.js, embeddingRuntime.js,
// semanticIndex.js -- none of these three files are modified) instead of
// building a second implementation. The ONLY thing this file adds is a
// non-Electron substitute for services/semanticRetrieval/
// semanticRetrievalService.js's `indexDir()`, whose sole Electron
// dependency is `app.getPath('userData')` -- purely a choice of WHERE to
// cache the built index on disk, nothing else. embeddingModelManager.js's
// `resolvePaths(overrideDir)`/`getStatus(overrideDir)` and
// embeddingRuntime.js/semanticIndex.js were already Electron-free and
// already designed to accept an override directory for exactly this kind
// of non-Electron use (their own tests already do this).
//
// Checkpoint 5 disclosed semantic retrieval as "unavailable outside
// Electron" and search_knowledge fell back to deterministic-only ranking.
// That was accurate for the code AS IT STOOD then, but the fix was never
// investigated -- this file is that investigation's result: the real
// blocker was one directory-resolution call, not the retrieval mechanism
// itself. See this checkpoint's report for the forensic finding that
// motivated this (B15's query has ZERO deterministic recall for
// AI-FEAT-020 but scores it at 0.86 cosine similarity, clear top-1, via
// this exact infrastructure).
//
// Fails safe: any missing model, load error, or index-build error resolves
// to an empty candidate list (mirrors semanticRetrievalService.js's own
// discipline) -- semantic candidates are supplementary, never required.

const embeddingModelManager = require('../../../../services/semanticRetrieval/embeddingModelManager');
const embeddingRuntime = require('../../../../services/semanticRetrieval/embeddingRuntime');
const semanticIndex = require('../../lib/semanticIndex');
const build = require('../../lib/build');

let _indexPromise = null;

async function ensureIndex({ modelDir, indexDir }) {
  if (_indexPromise) return _indexPromise;
  _indexPromise = (async () => {
    const status = embeddingModelManager.getStatus(modelDir);
    if (status.status !== embeddingModelManager.STATUS.READY) {
      throw Object.assign(new Error(`semantic model unavailable: ${status.status}`), { modelState: status.status });
    }
    const { finalPath } = embeddingModelManager.resolvePaths(modelDir);
    await embeddingRuntime.ensureLoaded(finalPath);
    const { built } = build.assemble();
    return semanticIndex.buildOrLoadIndex(built, {
      embedBatch: (texts) => embeddingRuntime.embedBatch(texts),
      modelId: embeddingModelManager.MODEL_ID,
      indexDir,
    });
  })();
  _indexPromise.catch(() => { _indexPromise = null; });
  return _indexPromise;
}

// semanticTopK(question, k) -> [{id, title, score}]  (matches tools.js's
// existing `options.semanticTopK` contract unchanged -- searchKnowledge()
// already knew how to merge this shape in, it just never had a real
// implementation supplied to it outside Electron).
function makeSemanticTopK({ modelDir, indexDir }) {
  return async function semanticTopK(question, k = 5) {
    try {
      const index = await ensureIndex({ modelDir, indexDir });
      const results = await semanticIndex.semanticTopK(
        question, index,
        { embed: embeddingRuntime.embed, cosineSimilarity: embeddingRuntime.cosineSimilarity },
        k,
      );
      // tools.js's searchKnowledge only accepts feature/workflow ids
      // (BUG-*/DEC-*/PM-* governance entities are filtered there, same as
      // the deterministic path) -- filter here too so callers see a
      // consistent contract regardless of source.
      return results.filter((r) => /^AI-(FEAT|WF)-\d+$/.test(r.id)).map((r) => ({ id: r.id, title: r.title, score: r.score }));
    } catch {
      return [];
    }
  };
}

function _resetForTests() { _indexPromise = null; }

module.exports = { makeSemanticTopK, _resetForTests };
