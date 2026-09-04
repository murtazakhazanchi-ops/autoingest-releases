'use strict';

// Ask AutoIngest Stage 3, Section 27A: model-independent tests for
// services/qwenRuntime/modelManager.js -- real filesystem, isolated tmp
// dir per run (overrideDir), no Electron, no real ~2.7GB artifact. A
// local, disposable HTTP server (genuine Range support) exercises the
// real download() code path deterministically. Adapted from the
// established test/localJudgeModelManager.test.js pattern (Gemma's own
// modelManager tests) -- extended with Qwen-specific cache-invalidation
// checks (mtime tamper, manifestVersion mismatch) and the
// DOWNLOAD_NOT_CONFIGURED first-class state that Gemma's own module does
// not have (Gemma always has a real, configured download source; Qwen's
// Section 9/13 explicitly allows "no source configured").
//
// Run with: node test/qwenRuntimeModelManager.test.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');

const modelManager = require('../services/qwenRuntime/modelManager');
const { MODEL_IDENTITY, RUNTIME_COMPATIBILITY } = require('../services/qwenRuntime/modelManifest');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'qwenmm-'));
}

function syntheticArtifact(sizeBytes = 256 * 1024) {
  const buf = crypto.randomBytes(sizeBytes);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  return { buf, size: buf.length, sha256 };
}

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

async function main() {
  console.log('qwenRuntimeModelManager');

  await t('getStatus: empty directory is NOT_INSTALLED', () => {
    const dir = freshDir();
    const s = modelManager.getStatus(dir);
    assert.equal(s.status, modelManager.STATUS.NOT_INSTALLED);
  });

  await t('verify: no artifact present resolves NOT_INSTALLED with a clear reason', async () => {
    const dir = freshDir();
    const r = await modelManager.verify(dir);
    assert.equal(r.status, modelManager.STATUS.NOT_INSTALLED);
    assert.equal(r.detail.reason, 'no-artifact-to-verify');
  });

  await t('verify: correct synthetic artifact becomes READY and writes a matching sidecar', async () => {
    const dir = freshDir();
    const { buf, size, sha256 } = syntheticArtifact();
    const { finalPath, sidecarPath } = modelManager.resolvePaths(dir);
    await fsp.writeFile(finalPath, buf);
    const r = await modelManager.verify(dir, { size, sha256 });
    assert.equal(r.status, modelManager.STATUS.READY);
    assert.equal(fs.existsSync(sidecarPath), true);
    const status = modelManager.getStatus(dir, { size, sha256 });
    assert.equal(status.status, modelManager.STATUS.READY);
  });

  await t('verify: wrong size is rejected (CORRUPT, size-mismatch) and the bad file + sidecar are deleted', async () => {
    const dir = freshDir();
    const { size, sha256 } = syntheticArtifact();
    const { finalPath } = modelManager.resolvePaths(dir);
    await fsp.writeFile(finalPath, crypto.randomBytes(size - 100));
    const r = await modelManager.verify(dir, { size, sha256 });
    assert.equal(r.status, modelManager.STATUS.CORRUPT);
    assert.equal(r.detail.reason, 'size-mismatch');
    assert.equal(fs.existsSync(finalPath), false);
  });

  await t('verify: right size but wrong checksum is rejected (CORRUPT, checksum-mismatch) and deleted', async () => {
    const dir = freshDir();
    const { size, sha256 } = syntheticArtifact();
    const { finalPath } = modelManager.resolvePaths(dir);
    await fsp.writeFile(finalPath, crypto.randomBytes(size));
    const r = await modelManager.verify(dir, { size, sha256 });
    assert.equal(r.status, modelManager.STATUS.CORRUPT);
    assert.equal(r.detail.reason, 'checksum-mismatch');
    assert.equal(fs.existsSync(finalPath), false);
  });

  await t('getStatus: a .partial file (no final file yet) reports DOWNLOADING with bytesDownloaded', () => {
    const dir = freshDir();
    const { partialPath } = modelManager.resolvePaths(dir);
    fs.writeFileSync(partialPath, Buffer.alloc(1000));
    const s = modelManager.getStatus(dir);
    assert.equal(s.status, modelManager.STATUS.DOWNLOADING);
    assert.equal(s.detail.bytesDownloaded, 1000);
  });

  await t('getStatus: a final-named file with no sidecar is ERROR (unverified-artifact-present), never silently READY', async () => {
    const dir = freshDir();
    const { buf, size, sha256 } = syntheticArtifact();
    const { finalPath } = modelManager.resolvePaths(dir);
    await fsp.writeFile(finalPath, buf);
    const s = modelManager.getStatus(dir, { size, sha256 });
    assert.equal(s.status, modelManager.STATUS.ERROR);
    assert.equal(s.detail.reason, 'unverified-artifact-present');
  });

  await t('getStatus: a sidecar recorded against a DIFFERENT pinned identity is never trusted as READY', async () => {
    const dir = freshDir();
    const a = syntheticArtifact();
    const b = syntheticArtifact();
    const { finalPath } = modelManager.resolvePaths(dir);
    await fsp.writeFile(finalPath, a.buf);
    await modelManager.verify(dir, { size: a.size, sha256: a.sha256 });
    const s = modelManager.getStatus(dir, { size: b.size, sha256: b.sha256 });
    assert.notEqual(s.status, modelManager.STATUS.READY);
  });

  await t('getStatus: a file rewritten in place after verification (mtime moved) invalidates the cache, never READY', async () => {
    const dir = freshDir();
    const { buf, size, sha256 } = syntheticArtifact();
    const { finalPath } = modelManager.resolvePaths(dir);
    await fsp.writeFile(finalPath, buf);
    await modelManager.verify(dir, { size, sha256 });
    assert.equal(modelManager.getStatus(dir, { size, sha256 }).status, modelManager.STATUS.READY);
    // Rewrite the SAME bytes (same size/hash) but touch mtime forward --
    // simulates external tampering/rewrite that doesn't change content
    // identity but must still invalidate trust, since verify() was never
    // re-run against this specific on-disk instance.
    await new Promise((r) => setTimeout(r, 5));
    const future = new Date(Date.now() + 10000);
    await fsp.utimes(finalPath, future, future);
    const s = modelManager.getStatus(dir, { size, sha256 });
    assert.notEqual(s.status, modelManager.STATUS.READY, 'a moved mtime must invalidate the verification cache even with matching size/hash');
  });

  await t('getStatus: a sidecar from a different manifestVersion is never trusted as READY', async () => {
    const dir = freshDir();
    const { buf, size, sha256 } = syntheticArtifact();
    const { finalPath, sidecarPath } = modelManager.resolvePaths(dir);
    await fsp.writeFile(finalPath, buf);
    await modelManager.verify(dir, { size, sha256 });
    const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    sidecar.manifestVersion = `${sidecar.manifestVersion}-stale-test-marker`;
    fs.writeFileSync(sidecarPath, JSON.stringify(sidecar));
    const s = modelManager.getStatus(dir, { size, sha256 });
    assert.notEqual(s.status, modelManager.STATUS.READY);
  });

  await t('corrupt-model recovery: after a checksum failure, writing the correct bytes and re-verifying succeeds', async () => {
    const dir = freshDir();
    const { buf, size, sha256 } = syntheticArtifact();
    const { finalPath } = modelManager.resolvePaths(dir);
    await fsp.writeFile(finalPath, crypto.randomBytes(size));
    const bad = await modelManager.verify(dir, { size, sha256 });
    assert.equal(bad.status, modelManager.STATUS.CORRUPT);
    assert.equal(modelManager.getStatus(dir, { size, sha256 }).status, modelManager.STATUS.NOT_INSTALLED);
    await fsp.writeFile(finalPath, buf);
    const good = await modelManager.verify(dir, { size, sha256 });
    assert.equal(good.status, modelManager.STATUS.READY);
  });

  await t('remove: reversible -- NOT_INSTALLED after remove(), READY again after a fresh correct write + verify()', async () => {
    const dir = freshDir();
    const { buf, size, sha256 } = syntheticArtifact();
    const { finalPath } = modelManager.resolvePaths(dir);
    await fsp.writeFile(finalPath, buf);
    await modelManager.verify(dir, { size, sha256 });
    assert.equal(modelManager.getStatus(dir, { size, sha256 }).status, modelManager.STATUS.READY);
    await modelManager.remove(dir);
    assert.equal(modelManager.getStatus(dir, { size, sha256 }).status, modelManager.STATUS.NOT_INSTALLED);
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
      fs.writeFileSync(partialPath, buf.slice(0, Math.floor(size / 2)));
      const result = await modelManager.download(dir, { url, identity: { size, sha256 } });
      assert.equal(result.status, modelManager.STATUS.READY);
    } finally {
      server.close();
    }
  });

  await t('download(): source that ignores Range (always 200) falls back to a clean full restart', async () => {
    const dir = freshDir();
    const { buf, size, sha256 } = syntheticArtifact();
    const { server, url } = await startNoRangeServer(buf);
    try {
      const { partialPath } = modelManager.resolvePaths(dir);
      fs.writeFileSync(partialPath, crypto.randomBytes(1000));
      const result = await modelManager.download(dir, { url, identity: { size, sha256 } });
      assert.equal(result.status, modelManager.STATUS.READY);
    } finally {
      server.close();
    }
  });

  await t('download(): cancellation via AbortSignal stops the transfer, never a false READY', async () => {
    const dir = freshDir();
    const { buf, size, sha256 } = syntheticArtifact(4 * 1024 * 1024);
    const { server, url } = await startRangeServer(buf);
    try {
      const controller = new AbortController();
      const p = modelManager.download(dir, {
        url, identity: { size, sha256 }, signal: controller.signal,
        onProgress: () => controller.abort(),
      });
      await assert.rejects(p, (err) => err.detail && err.detail.cancelled === true);
      const s = modelManager.getStatus(dir, { size, sha256 });
      assert.notEqual(s.status, modelManager.STATUS.READY);
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

  await t('download(): DOWNLOAD_NOT_CONFIGURED is a real, first-class refusal, never a fabricated URL', async () => {
    const dir = freshDir();
    await assert.rejects(
      modelManager.download(dir, { url: '', identity: { size: 100, sha256: 'x' } }),
      (err) => err.code === 'DOWNLOAD_NOT_CONFIGURED',
    );
    assert.equal(modelManager.getStatus(dir).status, modelManager.STATUS.NOT_INSTALLED, 'a refused download must leave no partial/final artifact');
  });

  await t('getDownloadAvailability(): empty/default URL reports DOWNLOAD_NOT_CONFIGURED; an explicit URL reports DOWNLOAD_AVAILABLE', () => {
    const empty = modelManager.getDownloadAvailability('');
    assert.equal(empty.availability, modelManager.DOWNLOAD_AVAILABILITY.DOWNLOAD_NOT_CONFIGURED);
    assert.equal(empty.url, null);
    const configured = modelManager.getDownloadAvailability('https://example.invalid/model.gguf');
    assert.equal(configured.availability, modelManager.DOWNLOAD_AVAILABILITY.DOWNLOAD_AVAILABLE);
  });

  await t('checkRuntimeCompatibility(): reads the real installed node-llama-cpp version and compares to the pinned manifest value', () => {
    const result = modelManager.checkRuntimeCompatibility();
    assert.equal(typeof result.compatible, 'boolean');
    assert.equal(result.qualifiedVersion, RUNTIME_COMPATIBILITY.nodeLlamaCppVersion);
    assert.ok(result.installedVersion, 'must resolve a real installed version string, not throw');
  });

  await t('MODEL_IDENTITY: pinned expectedSizeBytes/expectedSha256 match the qualified Stage 3 artifact identity', () => {
    assert.equal(MODEL_IDENTITY.expectedSizeBytes, 2740937888);
    assert.equal(MODEL_IDENTITY.expectedSha256, '00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4');
    assert.equal(MODEL_IDENTITY.expectedSha256.length, 64, 'must be a well-formed 64-hex-char SHA-256 digest');
  });

  console.log(`qwenRuntimeModelManager: ${passed} passed`);
}

main();
