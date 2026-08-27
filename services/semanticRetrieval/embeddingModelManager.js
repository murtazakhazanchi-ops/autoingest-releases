'use strict';

// Phase C8 — production model-management for the C7-validated semantic
// candidate-generation layer. Deliberately mirrors
// services/localJudge/modelManager.js's own established pattern (pinned
// identity, streaming SHA-256, sidecar-verified STATUS state machine) --
// not a second design, the same one applied to a second, much smaller
// model. Distinct from modelManager.js in the one place C7's evidence
// justifies: NO download machinery here. Phi's own downloadModel() is
// already production-gated OFF (PRODUCTION_DOWNLOAD_SOURCE_APPROVED =
// false in main/askAutoIngest.js) pending a real distribution decision;
// this checkpoint does not reopen that decision for a second model --
// bundling vs. on-demand download for a 36.7MB embedding model is an
// explicit, deferred, documented choice for the production-integration
// checkpoint that ships it, not this one (see the C8 report's own
// "Embedding model lifecycle" section).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MODEL_ID = 'bge-small-en-v1.5-q8_0';
const MODEL_FILENAME = 'bge-small-en-v1.5-q8_0.gguf';
// Pinned identity -- verified directly during C7's own research download
// (ggml-org's own canonical GGUF conversion of BAAI/bge-small-en-v1.5,
// MIT-licensed): size in bytes and a freshly-computed streaming SHA-256,
// the same verification discipline modelManager.js already uses for Phi.
const EXPECTED_SIZE_BYTES = 36685152;
const EXPECTED_SHA256 = 'f046db1dc724cf4f6f0a0c5917e922823b73eb1d27b8f9a9c2797f7866974804';
const SOURCE_URL = 'https://huggingface.co/ggml-org/bge-small-en-v1.5-Q8_0-GGUF/resolve/main/bge-small-en-v1.5-q8_0.gguf';
const MODEL_LICENSE = 'MIT (BAAI/bge-small-en-v1.5 base model; ggml-org GGUF conversion, verified via huggingface.co/ggml-org/bge-small-en-v1.5-Q8_0-GGUF license tag)';

const STATUS = Object.freeze({
  NOT_FOUND: 'NOT_FOUND',
  VERIFYING: 'VERIFYING',
  READY: 'READY',
  ERROR: 'ERROR',
});

function sidecarPathFor(finalPath) {
  return `${finalPath}.verified.json`;
}

// Same lazy-resolution discipline as modelManager.js's own
// resolveModelDir() -- require()able and unit-testable without Electron
// ready. Deliberately a SIBLING directory to local-judge-models, not
// inside it -- these are two independently-lifecycled models (see this
// file's own header) and should never be conflated by directory structure
// even though they currently share the same runtime library.
function resolveModelDir(overrideDir) {
  if (overrideDir) return overrideDir;
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'semantic-retrieval-models');
}

function resolvePaths(overrideDir) {
  const dir = resolveModelDir(overrideDir);
  const finalPath = path.join(dir, MODEL_FILENAME);
  return { dir, finalPath, sidecarPath: sidecarPathFor(finalPath) };
}

function statSafe(p) {
  try { return fs.statSync(p); } catch { return null; }
}
function readSidecarSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function streamingSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// Pure function of on-disk reality -- same contract as modelManager.js's
// getStatus(): never mutates anything, safe to call as often as needed
// (e.g. once per Ask AutoIngest drawer open, to decide whether semantic
// retrieval is even offerable this session).
function getStatus(overrideDir) {
  const { finalPath, sidecarPath } = resolvePaths(overrideDir);
  const finalStat = statSafe(finalPath);
  if (!finalStat) return { status: STATUS.NOT_FOUND, detail: {} };
  const sidecar = readSidecarSafe(sidecarPath);
  if (sidecar && sidecar.sha256 === EXPECTED_SHA256 && sidecar.size === EXPECTED_SIZE_BYTES && finalStat.size === EXPECTED_SIZE_BYTES) {
    return { status: STATUS.READY, detail: { verifiedAt: sidecar.verifiedAt, path: finalPath } };
  }
  return { status: STATUS.ERROR, detail: { reason: 'unverified-artifact-present', path: finalPath } };
}

// Explicit, one-time verify -- writes the sidecar on success. Mirrors
// modelManager.js's own verify() shape (streaming hash, never loads the
// whole file into memory) minus the download-resume machinery this model
// doesn't need yet (see header).
async function verify(overrideDir) {
  const { finalPath, sidecarPath, dir } = resolvePaths(overrideDir);
  const finalStat = statSafe(finalPath);
  if (!finalStat) return { status: STATUS.NOT_FOUND, detail: {} };
  if (finalStat.size !== EXPECTED_SIZE_BYTES) {
    return { status: STATUS.ERROR, detail: { reason: 'size-mismatch', expected: EXPECTED_SIZE_BYTES, actual: finalStat.size } };
  }
  const sha256 = await streamingSha256(finalPath);
  if (sha256 !== EXPECTED_SHA256) {
    return { status: STATUS.ERROR, detail: { reason: 'checksum-mismatch' } };
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(sidecarPath, JSON.stringify({ sha256, size: finalStat.size, verifiedAt: new Date().toISOString(), modelId: MODEL_ID }));
  return { status: STATUS.READY, detail: { path: finalPath } };
}

module.exports = {
  MODEL_ID, MODEL_FILENAME, EXPECTED_SIZE_BYTES, EXPECTED_SHA256, SOURCE_URL, MODEL_LICENSE,
  STATUS, resolveModelDir, resolvePaths, getStatus, verify, streamingSha256,
};
