/**
 * transferStats.js — byte-level transfer statistics for a companion import (AI-FEAT-064 EQI-2.1).
 *
 * Every number comes from the import engine itself, never from file counts or average sizes:
 *   - completed bytes: the engine's own per-file `fileSize` (the stat'ed source size) on done/renamed;
 *   - skipped / failed bytes: the same per-file sizes, and the transaction summary at commit;
 *   - in-flight bytes: the engine's copy-attempt hooks name each destination while it is written;
 *     its growing size is read with one stat() per sample (no file is ever reread).
 * A retried attempt starts again at 0 bytes, and a file counts as completed once, so nothing is
 * counted twice. Speed is an exponential moving average of copied bytes per second; an estimate
 * is offered only after enough samples, and only while copying.
 */

'use strict';

const SAMPLE_MS = 500;
const EMA_ALPHA = 0.3;
const MIN_SAMPLES = 3;
const MIN_ELAPSED_MS = 1500;
const STALL_MS = 8000;

/**
 * @param {{ statSize: (p: string) => Promise<number|null>, now?: () => number }} deps
 */
function createTransferTracker({ statSize, now = Date.now }) {
  const events = [];          // per event: { totalBytes, totalFiles, copied, skipped, failed, copiedBytes, skippedBytes, failedBytes, final }
  const inflight = new Map(); // dest → { size, written }
  let current = -1;
  let ema = null, samples = 0, lastBytes = 0, lastAt = 0, startAt = 0, lastProgressAt = 0;

  function addEvent({ totalBytes, totalFiles }) {
    events.push({ totalBytes, totalFiles, copied: 0, skipped: 0, failed: 0, copiedBytes: 0, skippedBytes: 0, failedBytes: 0, final: false });
    return events.length - 1;
  }

  function setCurrent(i) { current = i; inflight.clear(); }

  function onCopyStart({ dest, size }) { inflight.set(dest, { size: Number(size) || 0, written: 0 }); }
  function onCopyEnd({ dest }) { inflight.delete(dest); }

  /** The engine's per-file progress (copyFileJobs). */
  function onFile(p) {
    const e = events[current];
    if (!e || e.final || !p) return;
    const size = Number(p.fileSize) || 0;
    if (p.status === 'done' || p.status === 'renamed') { e.copied++; e.copiedBytes += size; lastProgressAt = now(); }
    else if (p.status === 'skipped') { e.skipped++; e.skippedBytes += size; lastProgressAt = now(); }
    else if (p.status === 'error') { e.failed++; e.failedBytes += size; }
  }

  /**
   * The committed transaction is the final truth for one event: copied sizes from copiedFiles,
   * skipped files (same-size and "already in the Dump") by their planned sizes.
   * @param {Map<string, number>} sizeBySrc  planned source sizes
   */
  function reconcile(i, summary, sizeBySrc) {
    const e = events[i];
    if (!e || !summary) return;
    const copiedFiles = Array.isArray(summary.copiedFiles) ? summary.copiedFiles : [];
    const skippedFiles = Array.isArray(summary.skippedFiles) ? summary.skippedFiles : [];
    e.copied = copiedFiles.length;
    e.copiedBytes = copiedFiles.reduce((n, f) => n + (Number(f.size) || sizeBySrc.get(f.src) || 0), 0);
    e.skipped = Number(summary.skipped) || skippedFiles.length;
    e.skippedBytes = skippedFiles.reduce((n, f) => n + (sizeBySrc.get(f.src) || 0), 0);
    e.failed = Number(summary.errors) || 0;
    e.failedBytes = Math.max(0, e.totalBytes - e.copiedBytes - e.skippedBytes);
    if (e.failed === 0) e.failedBytes = 0;
    e.final = true;
  }

  /** An event that never committed (failed / not started): nothing copied by it is claimed. */
  function abandon(i) { const e = events[i]; if (e && !e.final) e.final = true; }

  function _inflightBytes() {
    let n = 0;
    for (const v of inflight.values()) n += Math.min(v.size, v.written);
    return n;
  }

  /** Reads the growing in-flight destinations once and updates the smoothed speed. */
  async function sample() {
    await Promise.all([...inflight.entries()].map(async ([dest, v]) => {
      const sz = await statSize(dest).catch(() => null);
      if (Number.isFinite(sz) && inflight.get(dest) === v) v.written = sz;
    }));
    const t = now();
    const copied = events.reduce((n, e) => n + e.copiedBytes, 0) + _inflightBytes();
    if (!startAt) { startAt = t; lastAt = t; lastBytes = copied; lastProgressAt = t; return; }
    const dt = (t - lastAt) / 1000;
    if (dt <= 0) return;
    const rate = Math.max(0, (copied - lastBytes) / dt);
    if (copied > lastBytes) lastProgressAt = t;
    ema = ema === null ? rate : EMA_ALPHA * rate + (1 - EMA_ALPHA) * ema;
    samples++;
    lastAt = t; lastBytes = copied;
  }

  /** @param {boolean} copying  only a copying stage gets a speed and an estimate */
  function view(copying) {
    const sum = (k) => events.reduce((n, e) => n + e[k], 0);
    const totalBytes = sum('totalBytes'), copiedBytes = sum('copiedBytes'), skippedBytes = sum('skippedBytes'), failedBytes = sum('failedBytes');
    const inflightBytes = copying ? _inflightBytes() : 0;
    const t = now();
    const enough = samples >= MIN_SAMPLES && startAt && t - startAt >= MIN_ELAPSED_MS;
    const stalled = copying && !!startAt && t - lastProgressAt >= STALL_MS && inflightBytes === 0;
    const speed = copying && enough && ema !== null ? ema : null;
    const remaining = Math.max(0, totalBytes - copiedBytes - skippedBytes - failedBytes - inflightBytes);
    return {
      totalBytes, copiedBytes, skippedBytes, failedBytes, inflightBytes,
      transferredBytes: copiedBytes + inflightBytes,
      processedBytes: Math.min(totalBytes, copiedBytes + skippedBytes + failedBytes + inflightBytes),
      files: { total: sum('totalFiles'), copied: sum('copied'), skipped: sum('skipped'), failed: sum('failed') },
      speedBps: speed !== null && speed > 0 ? speed : null,
      etaSec: speed && speed > 0 && !stalled ? Math.round(remaining / speed) : null,
      calculating: copying && !enough,
      stalled,
      events: events.map(e => ({ totalBytes: e.totalBytes, copiedBytes: e.copiedBytes, skippedBytes: e.skippedBytes, failedBytes: e.failedBytes,
        copied: e.copied, skipped: e.skipped, failed: e.failed, totalFiles: e.totalFiles })),
    };
  }

  return { addEvent, setCurrent, onCopyStart, onCopyEnd, onFile, reconcile, abandon, sample, view };
}

module.exports = { createTransferTracker, SAMPLE_MS, STALL_MS };
