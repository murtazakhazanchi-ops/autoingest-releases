'use strict';

// Phase C8 — production semantic candidate-generation service. Mirrors
// services/localJudge/synthesisService.js's own lazy-init/availability-
// checked/graceful-failure discipline, applied to the SEPARATE embedding
// runtime (embeddingRuntime.js, never runtime.js/Phi) and the persisted
// semantic index (semanticIndex.js). Every failure mode here -- model not
// downloaded/verified, index build failure, embedding inference error --
// resolves to an EMPTY candidate list, never a thrown error the caller has
// to handle specially: conversationalAsk.js's own safeSemanticTopK()
// already treats "no semantic evidence" as the deterministic-only
// fallback case per checkpoint Section 6, and clarificationDecision.js's
// own semantic-corroboration gate degrades safely to the pre-C8 default
// whenever no semantic evidence is available.
//
// Lazy, on first real conversational query only -- opening the Ask
// AutoIngest drawer, and asking a question that resolves CLEAR without any
// same-group deterministic rival, never touches this module's model/index
// machinery at all. Matches the checkpoint's explicit instruction that
// opening Ask AutoIngest must not unnecessarily load either local model.
//
// No production download source is configured for this model yet, mirroring
// Phi's own PRODUCTION_DOWNLOAD_SOURCE_APPROVED=false situation
// (main/askAutoIngest.js) -- see embeddingModelManager.js's own header for
// why this checkpoint deliberately defers that decision rather than
// reopening it. getSemanticModelAvailability() below is a pure read of
// on-disk reality: on a clean install with nothing manually placed, it
// reports NOT_FOUND and productionSemanticTopK() always resolves to [].

const path = require('path');
const embeddingModelManager = require('./embeddingModelManager');
const embeddingRuntime = require('./embeddingRuntime');

const PRODUCT_DOCS = path.join(__dirname, '..', '..', 'scripts', 'product-docs');
const { assemble } = require(path.join(PRODUCT_DOCS, 'lib', 'build.js'));
const semanticIndex = require(path.join(PRODUCT_DOCS, 'lib', 'semanticIndex.js'));

// A SIBLING directory to the model directory (semantic-retrieval-models),
// never inside it -- the index is derived data, not model identity, and
// keeping them apart matches embeddingModelManager.js's own "never
// conflate independently-lifecycled things by directory structure" note.
function indexDir() {
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'semantic-retrieval-index');
}

let _indexPromise = null;

async function ensureIndex() {
  if (_indexPromise) return _indexPromise;
  _indexPromise = (async () => {
    const status = embeddingModelManager.getStatus();
    if (status.status !== embeddingModelManager.STATUS.READY) {
      throw Object.assign(
        new Error(`semantic model unavailable: ${status.status}`),
        { modelState: status.status },
      );
    }
    const { finalPath } = embeddingModelManager.resolvePaths();
    await embeddingRuntime.ensureLoaded(finalPath);
    const { built } = assemble();
    return semanticIndex.buildOrLoadIndex(built, {
      embedBatch: (texts) => embeddingRuntime.embedBatch(texts),
      modelId: embeddingModelManager.MODEL_ID,
      indexDir: indexDir(),
    });
  })();
  // A failed attempt (model missing, load error, index build error) must
  // not permanently wedge every future query into the same rejection --
  // clear the memoized promise so the NEXT call retries from scratch
  // (e.g. after the operator installs/verifies the model mid-session).
  _indexPromise.catch(() => { _indexPromise = null; });
  return _indexPromise;
}

async function productionSemanticTopK(question, k = 5) {
  try {
    const index = await ensureIndex();
    return await semanticIndex.semanticTopK(
      question,
      index,
      { embed: embeddingRuntime.embed, cosineSimilarity: embeddingRuntime.cosineSimilarity },
      k,
    );
  } catch {
    return [];
  }
}

function getSemanticModelAvailability() {
  try {
    return embeddingModelManager.getStatus();
  } catch (err) {
    return { status: embeddingModelManager.STATUS.ERROR, detail: { reason: 'runtime-environment-unavailable', message: err.message } };
  }
}

// Test-only reset (mirrors embeddingRuntime.js's own _resetForTests
// discipline) -- never called by any production code path.
function _resetForTests() {
  _indexPromise = null;
}

module.exports = { productionSemanticTopK, getSemanticModelAvailability, indexDir, _resetForTests };
