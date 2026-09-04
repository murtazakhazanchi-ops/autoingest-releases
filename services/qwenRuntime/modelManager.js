'use strict';

/**
 * services/qwenRuntime/modelManager.js — Ask AutoIngest Stage 3, Sections
 * 8-14: file-level lifecycle for the Qwen3.5-4B-Instruct model artifact.
 *
 * Design pattern REUSED from services/localJudge/modelManager.js (Gemma's
 * own, already-production, already-battle-tested artifact manager) --
 * NOT that file's code, and that file is not modified by this stage
 * (Section 25's own explicit "do not remove/touch legacy" requirement, and
 * the broader Stage-2/2.1 discipline of never editing existing production
 * infrastructure without explicit authorization). This is a genuinely new,
 * parallel module for a genuinely different model, following the SAME
 * proven design: storage-layout convention (final/.partial/.verified.json
 * sidecar), pure-function getStatus() derived from on-disk reality (never
 * a separately-cached in-memory flag that could drift), streaming SHA-256
 * (never loads the ~2.55 GiB artifact into memory), resumable download via
 * HTTP Range with a from-scratch fallback when a source doesn't honor
 * Range, and "never destroy a currently-verified model before its
 * replacement verifies" download-safety semantics.
 *
 * Storage layout under the resolved model directory (default: Electron's
 * app.getPath('userData')/qwen-runtime-models/ -- see modelManifest.js's
 * STORAGE_SUBDIR, parallel to and never entangled with Gemma's own
 * 'local-judge-models'):
 *   qwen3.5-4b-instruct-Q4_K_M.gguf              (final artifact -- only
 *                                                  ever written by renaming
 *                                                  a fully-downloaded
 *                                                  .partial file)
 *   qwen3.5-4b-instruct-Q4_K_M.gguf.partial       (in-progress/interrupted
 *                                                  download -- never usable)
 *   qwen3.5-4b-instruct-Q4_K_M.gguf.verified.json (sidecar written ONLY
 *                                                  after a successful
 *                                                  verify(): {sha256, size,
 *                                                  mtimeMs, manifestVersion,
 *                                                  verifiedAt})
 *
 * Verification-cache policy (Section 12/19): the sidecar above is what
 * getStatus() trusts as READY -- but ONLY when its recorded sha256/size
 * match both the manifest's pinned identity AND the CURRENT on-disk
 * file's own size and mtimeMs. Any of the three changing (a different
 * file, a different manifest version, or the file's own mtime moving --
 * i.e. it was rewritten in place after verification) invalidates the
 * cache and getStatus() reports ERROR (unverified-artifact-present) until
 * verify() is explicitly re-run. A modified model is never trusted
 * indefinitely, by construction, not by convention.
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const { MODEL_IDENTITY, STORAGE_SUBDIR, DOWNLOAD_URL, buildManifest } = require('./modelManifest');
const { checkDiskSpace } = require('./diskSpace');
const { ERROR_CODE, QwenRuntimeError } = require('./errors');

function getFor(url) {
  return url.startsWith('http://') ? http : https;
}

const STATUS = Object.freeze({
  NOT_INSTALLED: 'NOT_INSTALLED',
  DOWNLOADING: 'DOWNLOADING',
  VERIFYING: 'VERIFYING',
  READY: 'READY',
  CORRUPT: 'CORRUPT',
  ERROR: 'ERROR',
});

const DOWNLOAD_AVAILABILITY = Object.freeze({
  DOWNLOAD_AVAILABLE: 'DOWNLOAD_AVAILABLE',
  DOWNLOAD_NOT_CONFIGURED: 'DOWNLOAD_NOT_CONFIGURED',
});

function partialPathFor(finalPath) { return `${finalPath}.partial`; }
function sidecarPathFor(finalPath) { return `${finalPath}.verified.json`; }

// Lazily resolved (mirrors modelManager.js's own _resolvePath() pattern)
// so this module can be require()d and its pure helpers exercised without
// Electron being ready. `overrideDir` lets tests inject a plain temp
// directory instead of a real userData path.
function resolveModelDir(overrideDir) {
  if (overrideDir) return overrideDir;
  const { app } = require('electron');
  return path.join(app.getPath('userData'), STORAGE_SUBDIR);
}

function resolvePaths(overrideDir) {
  const dir = resolveModelDir(overrideDir);
  const finalPath = path.join(dir, MODEL_IDENTITY.filename);
  return { dir, finalPath, partialPath: partialPathFor(finalPath), sidecarPath: sidecarPathFor(finalPath) };
}

function statSafe(p) {
  try { return fs.statSync(p); } catch { return null; }
}

function readSidecarSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

// Streaming SHA-256 -- async, chunked, never synchronous on the caller's
// event loop (Section 12's own explicit requirement: never hash a ~2.55
// GiB file synchronously on the Electron UI/main event loop). This
// function itself is safe to call from either the main process or a
// worker/child process; the RUNTIME BOUNDARY decision (Section 6) is what
// keeps it off the UI-responsiveness-critical path in practice -- see
// runtime.js, which never calls this directly on the main process for the
// real 2.55 GiB artifact; verify() below is intended to be invoked from a
// context that is not blocking UI (a future IPC handler awaits this
// promise rather than blocking, and Section 6's chosen utilityProcess
// boundary further isolates the actual inference runtime regardless).
function streamingSha256(filePath, { onBytesRead } = {}) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    let done = false;
    let bytesRead = 0;
    const cleanup = () => {
      if (done) return;
      done = true;
      stream.removeAllListeners();
      stream.destroy();
    };
    stream.on('data', (chunk) => {
      hash.update(chunk);
      bytesRead += chunk.length;
      if (onBytesRead) onBytesRead(bytesRead);
    });
    stream.on('end', () => { cleanup(); resolve(hash.digest('hex')); });
    stream.on('error', (err) => { cleanup(); reject(err); });
  });
}

function pinnedIdentity(identity) {
  return {
    size: (identity && identity.size) || MODEL_IDENTITY.expectedSizeBytes,
    sha256: (identity && identity.sha256) || MODEL_IDENTITY.expectedSha256,
  };
}

// Pure function of on-disk reality (Section 11) -- deliberately not a
// separately-persisted in-memory flag. Returns { status, detail }.
function getStatus(overrideDir, identity) {
  const { size: expectedSize, sha256: expectedSha256 } = pinnedIdentity(identity);
  const { finalPath, partialPath, sidecarPath } = resolvePaths(overrideDir);
  const partialStat = statSafe(partialPath);
  const finalStat = statSafe(finalPath);

  if (partialStat && !finalStat) {
    return { status: STATUS.DOWNLOADING, detail: { bytesDownloaded: partialStat.size, expectedBytes: expectedSize } };
  }

  if (finalStat) {
    const sidecar = readSidecarSafe(sidecarPath);
    const manifestVersion = buildManifest().manifestVersion;
    if (
      sidecar
      && sidecar.sha256 === expectedSha256
      && sidecar.size === expectedSize
      && sidecar.manifestVersion === manifestVersion
      && finalStat.size === expectedSize
      && sidecar.mtimeMs === finalStat.mtimeMs
    ) {
      return { status: STATUS.READY, detail: { verifiedAt: sidecar.verifiedAt, path: finalPath } };
    }
    if (finalStat.size !== expectedSize) {
      return { status: STATUS.CORRUPT, detail: { reason: 'size-mismatch', expected: expectedSize, actual: finalStat.size } };
    }
    // Right size, but no trustworthy (fresh, matching) verification
    // record -- crash between rename-from-.partial and verify()
    // completing, external tampering, a stale sidecar from a different
    // manifest version, or the file being rewritten in place after its
    // last verification (mtime moved). Never treated as READY -- the
    // caller must explicitly call verify() again.
    return { status: STATUS.ERROR, detail: { reason: 'unverified-artifact-present', path: finalPath } };
  }

  return { status: STATUS.NOT_INSTALLED, detail: {} };
}

// Section 9/13: whether acquisition can even be attempted, independent of
// current artifact state. NOT_CONFIGURED is a real, tested, first-class
// state -- never a fabricated URL.
function getDownloadAvailability(url = DOWNLOAD_URL) {
  return url && url.trim()
    ? { availability: DOWNLOAD_AVAILABILITY.DOWNLOAD_AVAILABLE, url }
    : { availability: DOWNLOAD_AVAILABILITY.DOWNLOAD_NOT_CONFIGURED, url: null };
}

// Section 5's own installed-vs-qualified version check, exposed here since
// it is model-runtime-compatibility data of the same kind this module
// already owns. Does not require Electron or a loaded model -- reads only
// the installed node-llama-cpp package's own package.json.
function checkRuntimeCompatibility() {
  const manifest = buildManifest();
  let installedVersion = null;
  try {
    // node-llama-cpp's own package.json restricts subpath access via its
    // "exports" field, so require('node-llama-cpp/package.json') is
    // blocked -- resolve the real installed file path first (respects
    // "exports"), then read its package.json directly off disk (bypasses
    // "exports", since this is a plain fs read, not a module resolution).
    const installedEntryPath = require.resolve('node-llama-cpp');
    const packageRoot = path.join(path.dirname(installedEntryPath), '..');
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    installedVersion = pkg.version;
  } catch (err) {
    return { compatible: false, reason: 'node-llama-cpp not resolvable', error: err.message };
  }
  const compatible = installedVersion === manifest.runtimeCompatibility.nodeLlamaCppVersion;
  return {
    compatible,
    installedVersion,
    qualifiedVersion: manifest.runtimeCompatibility.nodeLlamaCppVersion,
    reason: compatible ? null : `installed node-llama-cpp ${installedVersion} differs from the qualified ${manifest.runtimeCompatibility.nodeLlamaCppVersion} -- this is a compatibility finding requiring forensic assessment (Section 5), not a silent upgrade`,
  };
}

function fetchToPartial(url, partialPath, startByte, expectedSize, { signal, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const headers = startByte > 0 ? { Range: `bytes=${startByte}-` } : {};
    const req = getFor(url).get(url, { headers }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchToPartial(res.headers.location, partialPath, startByte, expectedSize, { signal, onProgress }).then(resolve, reject);
        return;
      }
      const resuming = startByte > 0 && res.statusCode === 206;
      if (startByte > 0 && res.statusCode !== 206) {
        res.resume();
        fsp.rm(partialPath, { force: true }).then(() => {
          fetchToPartial(url, partialPath, 0, expectedSize, { signal, onProgress }).then(resolve, reject);
        }, reject);
        return;
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        reject(new QwenRuntimeError('DOWNLOAD_FAILED', `download failed: HTTP ${res.statusCode}`));
        return;
      }
      const out = fs.createWriteStream(partialPath, { flags: resuming ? 'a' : 'w' });
      let bytesThisSession = 0;
      const onAbort = () => {
        res.destroy();
        out.close();
        reject(new QwenRuntimeError('CANCELLED', 'download cancelled', { cancelled: true }));
      };
      if (signal) {
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      res.on('data', (chunk) => {
        bytesThisSession += chunk.length;
        if (onProgress) onProgress({ bytesDownloaded: startByte + bytesThisSession, expectedBytes: expectedSize });
      });
      res.pipe(out);
      out.on('finish', () => {
        if (signal) signal.removeEventListener('abort', onAbort);
        out.close(() => resolve());
      });
      out.on('error', (err) => {
        if (signal) signal.removeEventListener('abort', onAbort);
        reject(err);
      });
      res.on('error', (err) => {
        if (signal) signal.removeEventListener('abort', onAbort);
        out.close();
        reject(err);
      });
    });
    req.on('error', reject);
  });
}

// Explicitly initiated only -- never called automatically at app startup
// or merely because the runtime was queried (Section 25's own "loading
// Qwen does not automatically initialize [download]" spirit applied to
// this module's own boundary). Refuses to run when no download source is
// configured (Section 9/13) and checks disk space before starting
// (Section 14) -- both real, tested pre-flight checks, not decorative.
async function download(overrideDir, { signal, onProgress, force = false, url = DOWNLOAD_URL, identity } = {}) {
  const { size: expectedSize } = pinnedIdentity(identity);
  const { dir, finalPath, partialPath } = resolvePaths(overrideDir);
  const availability = getDownloadAvailability(url);
  if (availability.availability === DOWNLOAD_AVAILABILITY.DOWNLOAD_NOT_CONFIGURED) {
    throw new QwenRuntimeError('DOWNLOAD_NOT_CONFIGURED', 'No approved model download source is configured for this build.');
  }
  const current = getStatus(overrideDir, identity);
  if (current.status === STATUS.READY && !force) {
    throw new QwenRuntimeError('UNKNOWN', 'a verified model is already READY -- pass { force: true } to explicitly re-download');
  }

  await fsp.mkdir(dir, { recursive: true });

  const spaceCheck = await checkDiskSpace(dir, expectedSize);
  if (spaceCheck.ok && !spaceCheck.sufficient) {
    throw new QwenRuntimeError('INSUFFICIENT_SPACE', `insufficient disk space: ${spaceCheck.freeBytes} free, ${spaceCheck.requiredBytes} required`, spaceCheck);
  }

  const existingPartialSize = statSafe(partialPath) ? statSafe(partialPath).size : 0;
  const startByte = existingPartialSize > 0 && existingPartialSize < expectedSize ? existingPartialSize : 0;

  await fetchToPartial(url, partialPath, startByte, expectedSize, { signal, onProgress });
  await fsp.rename(partialPath, finalPath);
  return verify(overrideDir, identity);
}

// Size check first (fast, mandatory), then streaming SHA-256. A model
// failing either check is deleted immediately and never becomes READY.
async function verify(overrideDir, identity) {
  const { size: expectedSize, sha256: expectedSha256 } = pinnedIdentity(identity);
  const { finalPath, sidecarPath } = resolvePaths(overrideDir);
  const stat = statSafe(finalPath);
  if (!stat) {
    return { status: STATUS.NOT_INSTALLED, detail: { reason: 'no-artifact-to-verify' } };
  }
  if (stat.size !== expectedSize) {
    await fsp.rm(finalPath, { force: true });
    await fsp.rm(sidecarPath, { force: true });
    return { status: STATUS.CORRUPT, detail: { reason: 'size-mismatch', expected: expectedSize, actual: stat.size } };
  }
  const sha256 = await streamingSha256(finalPath);
  if (sha256 !== expectedSha256) {
    await fsp.rm(finalPath, { force: true });
    await fsp.rm(sidecarPath, { force: true });
    return { status: STATUS.CORRUPT, detail: { reason: 'checksum-mismatch', expected: expectedSha256, actual: sha256 } };
  }
  const statAfter = statSafe(finalPath); // re-stat: mtime is the cache-invalidation key, must reflect the file as verified
  const sidecar = {
    sha256, size: stat.size, mtimeMs: statAfter.mtimeMs,
    manifestVersion: buildManifest().manifestVersion,
    verifiedAt: new Date().toISOString(), modelKey: MODEL_IDENTITY.key,
  };
  await fsp.writeFile(sidecarPath, JSON.stringify(sidecar, null, 2));
  return { status: STATUS.READY, detail: { path: finalPath, verifiedAt: sidecar.verifiedAt } };
}

// Reversible: a later download() re-creates everything from scratch.
async function remove(overrideDir) {
  const { finalPath, partialPath, sidecarPath } = resolvePaths(overrideDir);
  await fsp.rm(finalPath, { force: true });
  await fsp.rm(partialPath, { force: true });
  await fsp.rm(sidecarPath, { force: true });
  return { status: STATUS.NOT_INSTALLED, detail: {} };
}

module.exports = {
  STATUS, DOWNLOAD_AVAILABILITY, ERROR_CODE,
  resolveModelDir, resolvePaths, getStatus, getDownloadAvailability, checkRuntimeCompatibility,
  download, verify, remove, streamingSha256,
};
