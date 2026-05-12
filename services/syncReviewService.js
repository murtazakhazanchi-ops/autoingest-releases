'use strict';

/**
 * syncReviewService.js — Operator acknowledgement registry for needs-attention
 * Local First sync manifests.
 *
 * Phase 13B-3: Broken Sync Manifest Review.
 *
 * Rules:
 *  - Review state is stored in userData/archiveSyncReviews.json — separate from
 *    archiveSyncQueue.json and event.sync.json.
 *  - Marking a job reviewed NEVER changes its sync queue status, sync eligibility,
 *    readyForSync flag, or metadataStatus.
 *  - Only files whose basename is exactly 'event.sync.json' and whose resolved path
 *    is inside the configured Local Staging Root are accepted.
 *  - Registry is upserted atomically (tmp-rename pattern).
 *  - ENOENT on first read is not an error — treated as empty registry.
 */

const fsp  = require('fs').promises;
const path = require('path');
const os   = require('os');

const REVIEWS_FILE = 'archiveSyncReviews.json';

let _reviewsPath = null;

function _resolvePath() {
  if (_reviewsPath) return _reviewsPath;
  const { app } = require('electron');
  _reviewsPath = path.join(app.getPath('userData'), REVIEWS_FILE);
  return _reviewsPath;
}

async function _loadRaw() {
  try {
    const raw    = await fsp.readFile(_resolvePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.reviews)) return { reviews: [] };
    return parsed;
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[syncReviewService] Load failed:', err.message);
    return { reviews: [] };
  }
}

async function _saveRaw(data) {
  const p   = _resolvePath();
  const tmp = p + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, p);
}

const REASON_MAX_LEN = 500;

/**
 * Validates that manifestPath is an event.sync.json inside the Local Staging Root.
 * Uses fsp.realpath on both paths to guard against symlink traversal.
 *
 * @param {string} manifestPath
 * @param {string} localStagingRoot
 * @returns {Promise<boolean>}
 */
async function _isValidManifestPath(manifestPath, localStagingRoot) {
  if (!manifestPath || typeof manifestPath !== 'string') return false;
  if (!localStagingRoot) return false;
  const normalized = path.normalize(manifestPath);
  if (path.basename(normalized) !== 'event.sync.json') return false;
  let resolvedPath, resolvedRoot;
  try { resolvedPath = await fsp.realpath(normalized); } catch { return false; }
  try { resolvedRoot = await fsp.realpath(localStagingRoot); } catch { return false; }
  const rel = path.relative(resolvedRoot, resolvedPath);
  return !!(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Mark a sync issue as reviewed / acknowledged by the operator.
 *
 * Upserts by jobId. Does NOT mutate the sync queue or event.sync.json.
 *
 * @param {{ jobId: string, batchId?: string|null, manifestPath: string,
 *           reason?: string|null, localStagingRoot: string }} params
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
async function markReviewed({ jobId, batchId, manifestPath, reason, localStagingRoot }) {
  if (!jobId || typeof jobId !== 'string') return { ok: false, reason: 'invalid-jobId' };
  if (batchId !== undefined && batchId !== null && typeof batchId !== 'string') {
    return { ok: false, reason: 'invalid-batchId' };
  }
  if (!await _isValidManifestPath(manifestPath, localStagingRoot)) {
    return { ok: false, reason: 'invalid-path' };
  }

  const data    = await _loadRaw();
  const reviews = data.reviews || [];
  const idx     = reviews.findIndex(r => r.jobId === jobId);

  const entry = {
    jobId,
    batchId:    (batchId  || null),
    manifestPath,
    status:     'reviewed',
    reason:     reason ? String(reason).slice(0, REASON_MAX_LEN) : null,
    reviewedAt: new Date().toISOString(),
    deviceName: os.hostname(),
  };

  if (idx >= 0) {
    reviews[idx] = entry;
  } else {
    reviews.push(entry);
  }

  await _saveRaw({ reviews });
  return { ok: true };
}

/**
 * Return all reviews indexed by jobId.
 * @returns {Promise<{ [jobId: string]: object }>}
 */
async function getReviews() {
  const { reviews } = await _loadRaw();
  return Object.fromEntries((reviews || []).map(r => [r.jobId, r]));
}

module.exports = { markReviewed, getReviews };
