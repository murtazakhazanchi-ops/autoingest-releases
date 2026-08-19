'use strict';

// Phase C2 (Semantic Authority Local Judge Runtime & Model Management).
// Model-free tests for services/localJudge/modelManager.js -- real
// filesystem, isolated tmp dir per run, no Electron (overrideDir parameter
// takes the place of app.getPath('userData'), same testability pattern as
// test/metadataQueueStore.test.js's AUTOINGEST_METADATA_QUEUE_DIR override).
// A local, disposable HTTP server (with genuine Range-request support)
// exercises the real download() code path deterministically -- no network
// access, no multi-gigabyte transfer needed for THIS suite. The one real,
// pre-existing local benchmark artifact is verified separately, once, as
// its own dedicated (slower) test.
//
// Run with: node test/localJudgeModelManager.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');

const modelManager = require('../services/localJudge/modelManager');

let passed = 0;
async function t(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok — ${name}`);
  } catch (err) {
    console.error(`  FAIL — ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ljmm-'));
}

// A small (not multi-gigabyte) synthetic "model" for exercising the real
// download()/verify() code paths quickly and deterministically.
function syntheticArtifact(sizeBytes = 256 * 1024) {
  const buf = crypto.randomBytes(sizeBytes);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  return { buf, size: buf.length, sha256 };
}

// Minimal HTTP server with genuine Range support (206/Content-Range),
// matching the real behavior independently verified against the actual
// HuggingFace CDN this checkpoint -- not a fake/simplified stand-in for
// what Range support looks like.
function startRangeServer(buf) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d+)-/.exec(range);
        const start = m ? Number(m[1]) : 0;
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${buf.length - 1}/${buf.length}`,
          'Content-Length': buf.length - start,
          'Accept-Ranges': 'bytes',
        });
        res.end(buf.slice(start));
      } else {
        res.writeHead(200, { 'Content-Length': buf.length, 'Accept-Ranges': 'bytes' });
        res.end(buf);
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/model.gguf` });
    });
  });
}

// Server that always ignores Range and resends the whole file with 200 --
// proves the "source doesn't honor Range" fallback path restarts cleanly
// rather than corrupting the partial file.
function startNoRangeServer(buf) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Length': buf.length });
      res.end(buf);
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/model.gguf` });
    });
  });
}

// modelManager.js selects http vs. https by the URL's own protocol (see
// that module's getFor() helper), so these tests call the real, unmodified
// production download()/verify()/getStatus() functions directly against a
// disposable local plain-HTTP server -- not a reimplementation or mock of
// the download logic.
async function main() {
  console.log('localJudgeModelManager');

  await t('getStatus: empty directory is NOT_DOWNLOADED', () => {
    const dir = freshDir();
    const s = modelManager.getStatus(dir);
    assert.equal(s.status, modelManager.STATUS.NOT_DOWNLOADED);
  });

  await t('verify: no artifact present resolves NOT_DOWNLOADED with a clear reason', async () => {
    const dir = freshDir();
    const r = await modelManager.verify(dir);
    assert.equal(r.status, modelManager.STATUS.NOT_DOWNLOADED);
    assert.equal(r.detail.reason, 'no-artifact-to-verify');
  });

  await t('verify: correct synthetic artifact becomes READY and writes a matching sidecar', async () => {
    const dir = freshDir();
    const { buf, size, sha256 } = syntheticArtifact();
    const { finalPath } = modelManager.resolvePaths(dir);
    await fsp.writeFile(finalPath, buf);
    const r = await modelManager.verify(dir, { size, sha256 });
    assert.equal(r.status, modelManager.STATUS.READY);
    const status = modelManager.getStatus(dir, { size, sha256 });
    assert.equal(status.status, modelManager.STATUS.READY);
  });

  await t('verify: wrong size is rejected (ERROR, size-mismatch) and the bad file is deleted, never READY', async () => {
    const dir = freshDir();
    const { size, sha256 } = syntheticArtifact();
    const { finalPath } = modelManager.resolvePaths(dir);
    await fsp.writeFile(finalPath, crypto.randomBytes(size - 100)); // wrong size
    const r = await modelManager.verify(dir, { size, sha256 });
    assert.equal(r.status, modelManager.STATUS.ERROR);
    assert.equal(r.detail.reason, 'size-mismatch');
    assert.equal(fs.existsSync(finalPath), false, 'a size-mismatched artifact must be deleted, never left in place');
  });

  await t('verify: right size but wrong checksum is rejected (ERROR, checksum-mismatch) and the bad file is deleted', async () => {
    const dir = freshDir();
    const { size, sha256 } = syntheticArtifact();
    const { finalPath } = modelManager.resolvePaths(dir);
    await fsp.writeFile(finalPath, crypto.randomBytes(size)); // right size, different bytes -> different hash
    const r = await modelManager.verify(dir, { size, sha256 });
    assert.equal(r.status, modelManager.STATUS.ERROR);
    assert.equal(r.detail.reason, 'checksum-mismatch');
    assert.equal(fs.existsSync(finalPath), false);
  });

  await t('verify: truncated file (smaller, named as final not .partial) fails size check, never treated as ready', async () => {
    const dir = freshDir();
    const { buf, size, sha256 } = syntheticArtifact();
    const { finalPath } = modelManager.resolvePaths(dir);
    await fsp.writeFile(finalPath, buf.slice(0, Math.floor(size / 2))); // truncated
    const r = await modelManager.verify(dir, { size, sha256 });
    assert.equal(r.status, modelManager.STATUS.ERROR);
    assert.equal(r.detail.reason, 'size-mismatch');
  });

  await t('getStatus: a .partial file (no final file yet) reports DOWNLOADING with bytesDownloaded', () => {
    const dir = freshDir();
    const { partialPath } = modelManager.resolvePaths(dir);
    fs.writeFileSync(partialPath, Buffer.alloc(1000));
    const s = modelManager.getStatus(dir);
    assert.equal(s.status, modelManager.STATUS.DOWNLOADING);
    assert.equal(s.detail.bytesDownloaded, 1000);
  });

  await t('getStatus: a final-named file with no/mismatched sidecar is ERROR (unverified-artifact-present), never silently READY', async () => {
    const dir = freshDir();
    const { buf, size, sha256 } = syntheticArtifact();
    const { finalPath } = modelManager.resolvePaths(dir);
    await fsp.writeFile(finalPath, buf);
    // No verify() called yet -- sidecar absent.
    const s = modelManager.getStatus(dir, { size, sha256 });
    assert.equal(s.status, modelManager.STATUS.ERROR);
    assert.equal(s.detail.reason, 'unverified-artifact-present');
  });

  await t('getStatus: a stale sidecar recorded against a DIFFERENT pinned identity is never trusted as READY', async () => {
    const dir = freshDir();
    const a = syntheticArtifact();
    const b = syntheticArtifact(); // different identity
    const { finalPath } = modelManager.resolvePaths(dir);
    await fsp.writeFile(finalPath, a.buf);
    await modelManager.verify(dir, { size: a.size, sha256: a.sha256 }); // verifies against A, writes sidecar for A
    // Re-check status against B's identity (simulating a pinned-identity
    // change without a corresponding re-download) -- must not be READY.
    const s = modelManager.getStatus(dir, { size: b.size, sha256: b.sha256 });
    assert.notEqual(s.status, modelManager.STATUS.READY);
  });

  await t('corrupt-model recovery: after a checksum failure, writing the correct bytes and re-verifying succeeds', async () => {
    const dir = freshDir();
    const { buf, size, sha256 } = syntheticArtifact();
    const { finalPath } = modelManager.resolvePaths(dir);
    await fsp.writeFile(finalPath, crypto.randomBytes(size)); // corrupt
    const bad = await modelManager.verify(dir, { size, sha256 });
    assert.equal(bad.status, modelManager.STATUS.ERROR);
    assert.equal(modelManager.getStatus(dir, { size, sha256 }).status, modelManager.STATUS.NOT_DOWNLOADED, 'after deletion, status must read back as NOT_DOWNLOADED, not stuck in ERROR');
    await fsp.writeFile(finalPath, buf); // supply the correct bytes
    const good = await modelManager.verify(dir, { size, sha256 });
    assert.equal(good.status, modelManager.STATUS.READY);
  });

  await t('remove: reversible -- NOT_DOWNLOADED after remove(), READY again after a fresh correct write + verify()', async () => {
    const dir = freshDir();
    const { buf, size, sha256 } = syntheticArtifact();
    const { finalPath } = modelManager.resolvePaths(dir);
    await fsp.writeFile(finalPath, buf);
    await modelManager.verify(dir, { size, sha256 });
    assert.equal(modelManager.getStatus(dir, { size, sha256 }).status, modelManager.STATUS.READY);
    await modelManager.remove(dir);
    assert.equal(modelManager.getStatus(dir, { size, sha256 }).status, modelManager.STATUS.NOT_DOWNLOADED);
    await fsp.writeFile(finalPath, buf);
    const r = await modelManager.verify(dir, { size, sha256 });
    assert.equal(r.status, modelManager.STATUS.READY);
  });

  await t('download(): full download from a Range-capable local server verifies READY end to end', async () => {
    const dir = freshDir();
    const { buf, size, sha256 } = syntheticArtifact();
    const { server, url } = await startRangeServer(buf);
    try {
      const result = await modelManager.download(dir, { url, identity: { size, sha256 } });
      assert.equal(result.status, modelManager.STATUS.READY);
    } finally {
      server.close();
    }
  });

  await t('download(): resumes from an existing .partial file via a genuine Range request', async () => {
    const dir = freshDir();
    const { buf, size, sha256 } = syntheticArtifact();
    const { server, url } = await startRangeServer(buf);
    try {
      const { partialPath } = modelManager.resolvePaths(dir);
      const half = Math.floor(size / 2);
      fs.writeFileSync(partialPath, buf.slice(0, half)); // pre-seed a partial download
      const result = await modelManager.download(dir, { url, identity: { size, sha256 } });
      assert.equal(result.status, modelManager.STATUS.READY, 'resumed download must still verify byte-identical to the source');
    } finally {
      server.close();
    }
  });

  await t('download(): source that ignores Range (always 200) falls back to a clean full restart, not a corrupted file', async () => {
    const dir = freshDir();
    const { buf, size, sha256 } = syntheticArtifact();
    const { server, url } = await startNoRangeServer(buf);
    try {
      const { partialPath } = modelManager.resolvePaths(dir);
      fs.writeFileSync(partialPath, crypto.randomBytes(1000)); // stale/irrelevant partial bytes
      const result = await modelManager.download(dir, { url, identity: { size, sha256 } });
      assert.equal(result.status, modelManager.STATUS.READY, 'must restart cleanly and still reach a correct, verified artifact');
    } finally {
      server.close();
    }
  });

  await t('download(): cancellation via AbortSignal stops the transfer, leaves a .partial (never a false READY)', async () => {
    const dir = freshDir();
    const { buf, size, sha256 } = syntheticArtifact(4 * 1024 * 1024);
    const { server, url } = await startRangeServer(buf);
    try {
      const controller = new AbortController();
      // Abort deterministically on the FIRST progress event, guaranteeing
      // the cancellation lands mid-transfer regardless of how fast the
      // localhost transfer itself completes (a fixed millisecond delay is
      // not reliable for a small payload over loopback).
      const p = modelManager.download(dir, {
        url,
        identity: { size, sha256 },
        signal: controller.signal,
        onProgress: () => controller.abort(),
      });
      await assert.rejects(p, (err) => err.cancelled === true);
      const s = modelManager.getStatus(dir, { size, sha256 });
      assert.notEqual(s.status, modelManager.STATUS.READY, 'a cancelled download must never be treated as ready');
    } finally {
      server.close();
    }
  });

  await t('download(): refuses to overwrite an already-READY model unless force:true is passed', async () => {
    const dir = freshDir();
    const { buf, size, sha256 } = syntheticArtifact();
    const { finalPath } = modelManager.resolvePaths(dir);
    await fsp.writeFile(finalPath, buf);
    await modelManager.verify(dir, { size, sha256 });
    const { server, url } = await startRangeServer(buf);
    try {
      await assert.rejects(modelManager.download(dir, { url, identity: { size, sha256 } }), /already READY/);
    } finally {
      server.close();
    }
  });

  // ---------------------------------------------------------------------
  // The one real, pre-existing local benchmark artifact -- the actual
  // production-pinned identity, streamed and hashed for real (no
  // synthetic substitute for this specific check).
  // ---------------------------------------------------------------------
  await t('real pinned artifact: the actual benchmark .gguf file (if present locally) verifies READY against the production-pinned identity', async () => {
    const realFile = path.join(__dirname, '..', 'scripts', 'product-docs', 'bench', 'models', modelManager.MODEL_FILENAME);
    if (!fs.existsSync(realFile)) {
      console.log('    (skipped -- real benchmark artifact not present in this environment)');
      return;
    }
    const dir = freshDir();
    const { finalPath } = modelManager.resolvePaths(dir);
    fs.symlinkSync(realFile, finalPath);
    const r = await modelManager.verify(dir); // no identity override -- real pinned constants
    assert.equal(r.status, modelManager.STATUS.READY);
  });

  console.log(`localJudgeModelManager: ${passed} passed`);
}

main();
