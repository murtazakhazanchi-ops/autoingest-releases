'use strict';
/**
 * services/performanceMonitor.js
 *
 * Automatically detects four classes of performance problems:
 *
 *  1. EVENT LOOP LAG  — main process blocked (timer drift method)
 *  2. THUMBNAIL STALL — single thumb not resolving within threshold
 *  3. IMPORT SPEED    — bytes/sec drops below acceptable threshold
 *  4. MEMORY PRESSURE — Node heap approaching limit
 *
 * All findings go to telemetry.enqueue() — nothing sent directly.
 * Call init() once in app.whenReady().then(), stop() on before-quit.
 *
 * Integration points in existing code:
 *  • services/thumbnailer.js  → call thumbStart(key) / thumbEnd(key) around getThumbnail()
 *  • main/fileManager.js      → call importSpeedSample(bytes, elapsedMs, totalBytes) in copy loop
 */

const telemetry = require('./telemetry');
const { log }   = require('./logger');

// ── Thresholds ────────────────────────────────────────────────────────────────
const LAG_WARN_MS        = 200;    // event loop blocked > 200 ms → log
const LAG_CRITICAL_MS    = 1000;   // blocked > 1 s → Critical
const LAG_CHECK_INTERVAL = 500;    // how often to sample (ms)
const LAG_DEDUP_WINDOW   = 30_000; // suppress repeated lag reports within 30 s

const THUMB_WARN_MS      = 5_000;  // single thumbnail > 5 s → log
const THUMB_CRITICAL_MS  = 15_000; // > 15 s → Critical (stall watchdog fires)

const IMPORT_SLOW_MBPS   = 2;      // import speed < 2 MB/s → log
const IMPORT_MIN_BYTES   = 50_000_000; // only flag imports > 50 MB

const MEM_WARN_MB        = 400;    // heap > 400 MB → log
const MEM_CHECK_INTERVAL = 60_000; // check every 60 s

// ── Internal state ─────────────────────────────────────────────────────────
let lagTimer            = null;
let memTimer            = null;
let lagCount            = 0;         // occurrences in current window
let lagWindowStart      = 0;         // ms timestamp when current window started
const activeThumbTimers = new Map(); // srcPath → { startMs, watchdog }
let _initDone = false;

// ── Bootstrap (Patch 40: idempotent) ─────────────────────────────────────────
function init() {
  if (_initDone) return;
  _initDone = true;
  if (!telemetry.isEnabled()) return;
  // Delay lag monitor by 10s — startup I/O always causes false positives
  // during module load, window creation, and initial drive polling.
  setTimeout(() => _startLagMonitor(), 10_000);
  _startMemMonitor();
}

function stop() {
  if (lagTimer) { clearInterval(lagTimer); lagTimer = null; }
  if (memTimer) { clearInterval(memTimer); memTimer = null; }
  for (const { watchdog } of activeThumbTimers.values()) clearTimeout(watchdog);
  activeThumbTimers.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. EVENT LOOP LAG
//    A repeating setInterval fires every LAG_CHECK_INTERVAL ms.
//    The actual elapsed time is compared to the expected interval.
//    Any excess is time the main process was unable to run JS — i.e. it was
//    blocked by a synchronous operation, heavy computation, or OS I/O wait.
// ─────────────────────────────────────────────────────────────────────────────
function _startLagMonitor() {
  let lastTick = Date.now();

  lagTimer = setInterval(() => {
    const now = Date.now();
    const lag = now - lastTick - LAG_CHECK_INTERVAL;
    lastTick  = now;

    if (lag <= LAG_WARN_MS) return;

    // Require 2 occurrences within the dedup window before reporting
    if (now - lagWindowStart > LAG_DEDUP_WINDOW) { lagCount = 0; lagWindowStart = now; }
    lagCount++;
    if (lagCount !== 2) return;  // report only on 2nd occurrence per window

    const severity = lag >= LAG_CRITICAL_MS ? 'Critical' : 'High';
    const msg      = `Main process event loop blocked ~${lag}ms`;
    log(`[perf] ${msg}`);

    telemetry.enqueue({
      type:        'performance',
      issueType:   'Performance',
      severity,
      description: msg,
      expected:    `Event loop responds within ${LAG_WARN_MS}ms`,
      actual:      `Blocked for ${lag}ms`,
      context:     { lagMs: lag, heapMB: _heapMB() },
    });
  }, LAG_CHECK_INTERVAL);

  if (lagTimer.unref) lagTimer.unref();
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. THUMBNAIL TIMING
//    thumbStart(key) — call when a thumbnail generation begins
//    thumbEnd(key)   — call when it resolves or rejects
//
//    A self-reporting watchdog fires if thumbEnd() is never called within
//    THUMB_CRITICAL_MS (catches permanently stuck thumbnails).
// ─────────────────────────────────────────────────────────────────────────────
function thumbStart(key) {
  const startMs = Date.now();

  const watchdog = setTimeout(() => {
    const elapsed = Date.now() - startMs;
    log(`[perf] Thumbnail stalled: ${key} (${elapsed}ms, never resolved)`);
    telemetry.enqueue({
      type:        'performance',
      issueType:   'Thumbnail Issue',
      severity:    'Critical',
      description: `Thumbnail stalled: never resolved after ${elapsed}ms`,
      expected:    `Thumbnail resolves within ${THUMB_WARN_MS}ms`,
      actual:      `Still pending after ${elapsed}ms`,
      context:     { thumbKey: key, elapsedMs: elapsed },
    });
    activeThumbTimers.delete(key);
  }, THUMB_CRITICAL_MS);

  if (watchdog.unref) watchdog.unref();
  activeThumbTimers.set(key, { startMs, watchdog });
}

function thumbEnd(key, { success = true, error = null } = {}) {
  const entry = activeThumbTimers.get(key);
  if (!entry) return;

  clearTimeout(entry.watchdog);
  activeThumbTimers.delete(key);

  const elapsed = Date.now() - entry.startMs;

  // Slow-but-resolved thumbnail: log at 5s, report to telemetry only at 15s+
  if (elapsed > THUMB_WARN_MS) {
    log(`[perf] Slow thumbnail: ${key} took ${elapsed}ms`);
  }
  if (elapsed > THUMB_CRITICAL_MS) {
    telemetry.enqueue({
      type:        'performance',
      issueType:   'Thumbnail Issue',
      severity:    'Critical',
      description: `Slow thumbnail: ${elapsed}ms for ${require('path').basename(key)}`,
      expected:    `< ${THUMB_WARN_MS}ms`,
      actual:      `${elapsed}ms`,
      context:     { thumbKey: key, elapsedMs: elapsed, success },
    });
  }

  // Explicit generation failure
  if (!success && error) {
    log(`[perf] Thumbnail failed: ${key}: ${error}`);
    telemetry.enqueue({
      type:        'performance',
      issueType:   'Thumbnail Issue',
      severity:    'Medium',
      description: `Thumbnail generation failed: ${error}`,
      context:     { thumbKey: key, error },
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. IMPORT SPEED SAMPLING
//    Call importSpeedSample(bytesCopied, elapsedMs, totalBytes) periodically
//    during an import run. Logs if speed drops below IMPORT_SLOW_MBPS.
// ─────────────────────────────────────────────────────────────────────────────
function importSpeedSample(bytesCopied, elapsedMs, totalBytes) {
  if (bytesCopied < IMPORT_MIN_BYTES) return;
  if (elapsedMs < 1000) return;

  const mbps = (bytesCopied / 1_048_576) / (elapsedMs / 1000);
  if (mbps >= IMPORT_SLOW_MBPS) return;

  const totalMB = totalBytes ? `${(totalBytes / 1_048_576).toFixed(0)}MB` : '';
  const msg     = `Import speed ${mbps.toFixed(2)} MB/s — below ${IMPORT_SLOW_MBPS} MB/s threshold`;
  log(`[perf] ${msg}`);

  telemetry.enqueue({
    type:        'performance',
    issueType:   'Performance',
    severity:    'Medium',
    description: msg,
    expected:    `≥ ${IMPORT_SLOW_MBPS} MB/s`,
    actual:      `${mbps.toFixed(2)} MB/s`,
    context:     { mbps: mbps.toFixed(2), bytesCopied, elapsedMs, totalMB },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. MEMORY MONITOR
// ─────────────────────────────────────────────────────────────────────────────
function _startMemMonitor() {
  memTimer = setInterval(() => {
    const mem   = process.memoryUsage();
    const mb    = Math.round(mem.heapUsed / 1_048_576);
    if (mb < 200) return;  // ignore small initial heap — always a false positive
    const ratio = mem.heapUsed / mem.heapTotal;
    if (ratio < 0.8) return;
    const pct = Math.round(ratio * 100);

    log(`[perf] High heap: ${mb}MB (${pct}%)`);
    telemetry.enqueue({
      type:        'performance',
      issueType:   'Performance',
      severity:    ratio > 0.9 ? 'Critical' : 'Medium',
      description: `High memory usage: ${mb}MB heap (${pct}%)`,
      expected:    '< 80% heap usage',
      actual:      `${pct}%`,
      context:     { heapMB: mb, heapRatio: ratio.toFixed(2) },
    });
  }, MEM_CHECK_INTERVAL);

  if (memTimer.unref) memTimer.unref();
}

function _heapMB() {
  return Math.round(process.memoryUsage().heapUsed / 1_048_576);
}

function clearThumbTimers() {
  for (const { watchdog } of activeThumbTimers.values()) clearTimeout(watchdog);
  activeThumbTimers.clear();
}

module.exports = { init, stop, thumbStart, thumbEnd, importSpeedSample, clearThumbTimers };
