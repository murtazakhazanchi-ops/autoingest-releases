/**
 * fileManager.js — Main-process module.
 *
 * Handles copying files from a memory card to a destination folder.
 *
 * Rules per file:
 *   • Does not exist at destination  → copy
 *   • Exists, same size              → skip  (already imported — exact duplicate)
 *   • Exists, different size         → rename with _1, _2 … then copy
 *
 * resolveDestPath() return contract:
 *   { action: 'skip',   destPath: null,   reason: 'already exists (same size)' }
 *   { action: 'copy',   destPath: string, reason: null }
 *   { action: 'rename', destPath: string, reason: 'renamed to _N (name conflict)' }
 */

'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const fsp    = require('fs').promises;
const path   = require('path');

// ── Constants ─────────────────────────────────────────────────────────────────

const ENABLE_CHECKSUM = false; // set true to enable SHA-256 post-copy verification
const MAX_RETRIES     = 1;     // retry a failed copy once before marking as failed

// ── Pause state ───────────────────────────────────────────────────────────────

let isPaused = false;

function setPaused(val) {
  isPaused = !!val;
}

async function waitIfPaused() {
  while (isPaused) {
    await new Promise(r => setTimeout(r, 100));
  }
}

// ── Destination type ──────────────────────────────────────────────────────────

function getDestinationType(destPath) {
  const lower = destPath.toLowerCase();
  return (lower.includes('ssd') || lower.includes('nvme')) ? 'ssd' : 'hdd';
}

// ── Concurrency helpers ───────────────────────────────────────────────────────

function getInitialConcurrency(avgFileSize, destType) {
  if (avgFileSize > 50 * 1024 * 1024) return destType === 'ssd' ? 3 : 2;
  if (avgFileSize < 5  * 1024 * 1024) return destType === 'ssd' ? 5 : 3;
  return destType === 'ssd' ? 4 : 3;
}

// Sample up to 10 files to estimate average size without stat-ing 500+ on a slow card.
async function estimateAvgSize(filePaths) {
  const n = Math.min(10, filePaths.length);
  let total = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    try { total += (await fsp.stat(filePaths[i])).size; count++; } catch { /* skip */ }
  }
  return count > 0 ? total / count : 0;
}

// ── Resume: pre-scan destination folder once ──────────────────────────────────

/**
 * Returns Map<lowercaseFilename, sizeBytes> of files already in the destination.
 * Used as a fast O(1) lookup to skip files that were fully copied in a prior run.
 */
async function buildDestIndex(destFolder) {
  const map = new Map();
  try {
    const entries = await fsp.readdir(destFolder);
    for (const name of entries) {
      try {
        const stat = await fsp.stat(path.join(destFolder, name));
        if (stat.isFile()) map.set(name.toLowerCase(), stat.size);
      } catch { /* skip unreadable entries */ }
    }
  } catch { /* folder does not exist yet — empty map is correct */ }
  return map;
}

// ── Verification ──────────────────────────────────────────────────────────────

async function getFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash   = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data',  chunk => hash.update(chunk));
    stream.on('end',   ()    => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Verifies a completed copy.
 * Always checks file size (fast, mandatory).
 * Optionally computes SHA-256 for files > 1 MB when ENABLE_CHECKSUM is true.
 */
async function verifyFile(srcPath, destPath, srcSize) {
  const destStat = await fsp.stat(destPath);
  if (destStat.size !== srcSize) throw new Error('Size mismatch after copy');

  if (ENABLE_CHECKSUM && srcSize > 1 * 1024 * 1024) {
    const srcHash  = await getFileHash(srcPath);
    const destHash = await getFileHash(destPath);
    if (srcHash !== destHash) throw new Error('Checksum mismatch after copy');
  }
}

// ── resolveDestPath ───────────────────────────────────────────────────────────

/**
 * Resolve a non-colliding destination path for `filename` inside `destDir`.
 *
 * @param {string} destDir
 * @param {string} filename
 * @param {number} sourceSize  bytes of the source file
 * @returns {{ action: 'copy'|'rename'|'skip', destPath: string|null, reason: string|null }}
 */
function resolveDestPath(destDir, filename, sourceSize) {
  const ext       = path.extname(filename);
  const base      = path.basename(filename, ext);
  const candidate = path.join(destDir, filename);

  if (!fs.existsSync(candidate)) {
    return { action: 'copy', destPath: candidate, reason: null };
  }

  const existingSize = fs.statSync(candidate).size;
  if (existingSize === sourceSize) {
    return { action: 'skip', destPath: null, reason: 'already exists (same size)' };
  }

  let n = 1;
  while (true) {
    const numbered = path.join(destDir, `${base}_${n}${ext}`);
    if (!fs.existsSync(numbered)) {
      return { action: 'rename', destPath: numbered, reason: `renamed to _${n} (name conflict)` };
    }
    const numberedSize = fs.statSync(numbered).size;
    if (numberedSize === sourceSize) {
      return { action: 'skip', destPath: null, reason: 'already exists (same size, renamed copy)' };
    }
    n++;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Copy an array of source file paths to `destination`, reporting progress.
 *
 * Progress events:
 *   { total, index, completedCount, filename, status, skipReason?, error?, eta, speedBps }
 *   status: 'copying' | 'done' | 'skipped' | 'renamed' | 'error'
 *
 * Returns:
 *   { copied, skipped, errors, skippedReasons, failedFiles, duration }
 *
 * GUARANTEE: `copied` is ONLY incremented after fsp.copyFile resolves AND
 *            verifyFile passes. Summary returned ONLY after the queue drains.
 */
async function copyFiles(filePaths, destination, onProgress) {
  await fsp.mkdir(destination, { recursive: true });

  isPaused = false; // always start fresh

  const total = filePaths.length;
  if (total === 0) {
    return { copied: 0, skipped: 0, errors: 0, skippedReasons: [], failedFiles: [], duration: 0 };
  }

  // ── Pre-flight ────────────────────────────────────────────────────────────────
  const startTime   = Date.now();
  const avgFileSize = await estimateAvgSize(filePaths);
  const destIndex   = await buildDestIndex(destination); // for resume fast-path
  const destType    = getDestinationType(destination);
  const estimatedTotalBytes = avgFileSize * total;

  // Mutable — may be raised exactly once by adjustConcurrency()
  let MAX_CONCURRENT_COPIES = getInitialConcurrency(avgFileSize, destType);

  // ── Runtime speed sampling ────────────────────────────────────────────────────
  let sampleBytes  = 0;
  let sampleTime   = 0; // seconds
  let sampledFiles = 0;
  let hasAdjusted  = false;

  function adjustConcurrency() {
    if (hasAdjusted || sampledFiles < 5) return;
    const speed = sampleBytes / sampleTime; // bytes/sec
    if      (speed > 150 * 1024 * 1024) MAX_CONCURRENT_COPIES = 4; // V60/V90
    else if (speed > 80  * 1024 * 1024) MAX_CONCURRENT_COPIES = 3; // V30
    else                                MAX_CONCURRENT_COPIES = 2; // slow card
    hasAdjusted = true;
  }

  // ── Smoothed ETA (exponential moving average, throttled to 100ms) ─────────────
  let completedBytes = 0;
  let smoothedSpeed  = 0;
  let lastEtaUpdate  = 0;
  let lastEta        = null;

  function getSpeedAndEta() {
    if (completedBytes === 0) return { eta: null, speedBps: 0 };

    const now = Date.now();
    // Return cached value within the 100ms throttle window
    if (now - lastEtaUpdate < 100 && lastEta !== null) {
      return { eta: lastEta, speedBps: smoothedSpeed };
    }

    const elapsed      = (now - startTime) / 1000;
    const instantSpeed = completedBytes / elapsed;
    // Exponential smoothing: weight recent history more than early samples
    smoothedSpeed = smoothedSpeed
      ? 0.7 * smoothedSpeed + 0.3 * instantSpeed
      : instantSpeed;

    const remaining = Math.max(0, estimatedTotalBytes - completedBytes);
    lastEta         = remaining / smoothedSpeed;
    lastEtaUpdate   = now;
    return { eta: lastEta, speedBps: smoothedSpeed };
  }

  // ── Result tracking ───────────────────────────────────────────────────────────
  let queueIndex     = 0;
  let completedCount = 0;
  let copied         = 0;
  let skipped        = 0;
  let errors         = 0;
  const skippedReasons = [];
  const failedFiles    = []; // files that failed after all retries
  const copiedFiles    = []; // { src, dest } for every successfully copied file

  // ── Per-file processor (pause + stat + resume-check + copy + verify + retry) ──
  async function processFile(srcPath, origIndex) {
    await waitIfPaused();

    const filename = path.basename(srcPath);
    onProgress({ total, index: origIndex + 1, completedCount, filename, status: 'copying', eta: null, speedBps: 0 });

    // ── Stat source ──────────────────────────────────────────────────────────────
    let srcStat;
    try {
      srcStat = await fsp.stat(srcPath);
    } catch {
      errors++;
      completedCount++;
      const { eta, speedBps } = getSpeedAndEta();
      onProgress({ total, index: origIndex + 1, completedCount, filename,
                   status: 'error', error: 'Source file not found or inaccessible', eta, speedBps });
      return;
    }

    const fileSize = srcStat.size;

    // ── Resume fast-path: file already fully copied in a prior run ────────────────
    if (destIndex.get(filename.toLowerCase()) === fileSize) {
      skipped++;
      completedCount++;
      completedBytes += fileSize;
      skippedReasons.push(`Skipped: ${filename} — already exists (same size)`);
      const { eta, speedBps } = getSpeedAndEta();
      onProgress({ total, index: origIndex + 1, completedCount, filename,
                   status: 'skipped', skipReason: 'already exists (same size)', eta, speedBps });
      return;
    }

    // ── Resolve destination path (handles rename for size-conflict) ───────────────
    const resolved = resolveDestPath(destination, filename, fileSize);

    if (resolved.action === 'skip') {
      skipped++;
      completedCount++;
      completedBytes += fileSize;
      skippedReasons.push(`Skipped: ${filename} — ${resolved.reason}`);
      const { eta, speedBps } = getSpeedAndEta();
      onProgress({ total, index: origIndex + 1, completedCount, filename,
                   status: 'skipped', skipReason: resolved.reason, eta, speedBps });
      return;
    }

    // ── Copy + verify with retry ──────────────────────────────────────────────────
    let lastError;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Measure raw copy time (excludes pause, stat overhead)
        const copyStart = Date.now();
        await fsp.copyFile(srcPath, resolved.destPath);
        const copyDuration = (Date.now() - copyStart) / 1000;

        // Feed speed sampler (ignore sub-ms copies — tiny files give noisy data)
        if (copyDuration > 0.001) {
          sampleBytes += fileSize;
          sampleTime  += copyDuration;
          sampledFiles++;
          adjustConcurrency(); // no-op after first adjustment
        }

        // Mandatory size verification (+ optional checksum)
        await verifyFile(srcPath, resolved.destPath, fileSize);

        // ── Success ──────────────────────────────────────────────────────────────
        copied++;
        completedCount++;
        completedBytes += fileSize;
        const { eta, speedBps } = getSpeedAndEta();

        copiedFiles.push({ src: srcPath, dest: resolved.destPath });

        if (resolved.action === 'rename') {
          skippedReasons.push(`Renamed: ${filename} — ${resolved.reason}`);
          onProgress({ total, index: origIndex + 1, completedCount, filename,
                       status: 'renamed', skipReason: resolved.reason, eta, speedBps });
        } else {
          onProgress({ total, index: origIndex + 1, completedCount, filename,
                       status: 'done', eta, speedBps });
        }
        return; // ← exit retry loop on success

      } catch (err) {
        lastError = err;
        // Remove partial or corrupted dest file before retrying
        try { await fsp.unlink(resolved.destPath); } catch { /* already gone */ }
        // On last attempt, fall through to failure handling below
      }
    }

    // ── All retries exhausted ─────────────────────────────────────────────────────
    errors++;
    completedCount++;
    failedFiles.push({ filename, reason: lastError.message });
    const { eta, speedBps } = getSpeedAndEta();
    onProgress({ total, index: origIndex + 1, completedCount, filename,
                 status: 'error', error: lastError.message, eta, speedBps });
  }

  // ── Adaptive push queue ───────────────────────────────────────────────────────
  // next() re-reads MAX_CONCURRENT_COPIES on every call, so the one-time
  // concurrency upgrade (via adjustConcurrency) takes effect immediately on
  // the next worker slot that frees up — no restart needed.
  return new Promise((resolve) => {
    let active = 0;

    function next() {
      if (queueIndex >= total && active === 0) {
        resolve({ copied, skipped, errors, skippedReasons, failedFiles, copiedFiles, duration: Date.now() - startTime });
        return;
      }

      while (active < MAX_CONCURRENT_COPIES && queueIndex < total) {
        const i = queueIndex++;
        active++;

        processFile(filePaths[i], i)
          .catch(() => { /* errors are reported via onProgress inside processFile */ })
          .finally(() => {
            active--;
            next();
          });
      }
    }

    next(); // kick off initial batch
  });
}

module.exports = { copyFiles, resolveDestPath, setPaused, getFileHash };
