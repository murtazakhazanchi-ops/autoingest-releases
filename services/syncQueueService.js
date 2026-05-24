'use strict';

/**
 * syncQueueService.js — Durable local sync queue for Local First imports.
 *
 * Discovers event.sync.json manifests under the configured Local Staging Root,
 * builds a persistent queue index in userData, and surfaces summary counts to
 * the renderer.
 *
 * Rules:
 *  - Scans only the Local Staging Root (never NAS).
 *  - Does NOT copy, sync, or write to NAS.
 *  - Does NOT acquire locks.
 *  - Persists across app restart (userData/archiveSyncQueue.json).
 *  - Queue items reference manifest paths; large file lists are never stored.
 *
 * Scan depth: stagingRoot / CollectionName / EventName / .autoingest / event.sync.json
 */

const fsp    = require('fs').promises;
const path   = require('path');
const crypto = require('crypto');

const QUEUE_FILE     = 'archiveSyncQueue.json';
const MANIFEST_RELPATH = path.join('.autoingest', 'event.sync.json');

let _queuePath = null;

function _resolvePath() {
  if (_queuePath) return _queuePath;
  const { app } = require('electron');
  _queuePath = path.join(app.getPath('userData'), QUEUE_FILE);
  return _queuePath;
}

/** Stable deterministic ID for a local event path (legacy event-level). */
function _jobId(localEventPath) {
  return crypto.createHash('sha1').update(localEventPath).digest('hex').slice(0, 16);
}

/** Stable deterministic ID for a per-import job (localEventPath + importId). */
function _importJobId(localEventPath, importId) {
  return crypto.createHash('sha1').update(localEventPath + '|' + importId).digest('hex').slice(0, 16);
}

/** Derive queue status from manifest fields.
 * Archive sync readiness is independent of metadata status — a metadata failure
 * must not prevent files from being copied to the archive.
 */
function _statusFromManifest(manifest) {
  if (manifest.readyForSync === true) {
    return 'ready-for-sync';
  }
  if (manifest.needsAttention === true) {
    return 'needs-attention';
  }
  return 'blocked';
}

async function _loadRaw() {
  try {
    const raw = await fsp.readFile(_resolvePath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.jobs)) return { jobs: [], refreshedAt: null };
    return parsed;
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[syncQueueService] Load failed:', err.message);
    return { jobs: [], refreshedAt: null };
  }
}

async function _saveRaw(data) {
  const p   = _resolvePath();
  const tmp = p + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, p);
}

/**
 * Scan the Local Staging Root, build queue items from manifests, and persist.
 * Called from IPC handler — never blocks the renderer directly.
 *
 * @returns {{ ok: boolean, jobs: Array, refreshedAt: number, reason?: string }}
 */
async function refreshQueue() {
  const settings     = require('./settings');
  const stagingRoot  = settings.getLocalStagingRoot();
  if (!stagingRoot) return { ok: false, reason: 'No staging root configured', jobs: [], refreshedAt: null };

  // Load existing queue to preserve externally-set statuses (synced / failed)
  const existing     = await _loadRaw();
  const existingMap  = Object.fromEntries((existing.jobs || []).map(j => [j.jobId, j]));

  const jobs = [];
  const now  = Date.now();

  // Level 1 — collection dirs inside stagingRoot
  let collDirs;
  try {
    const entries = await fsp.readdir(stagingRoot, { withFileTypes: true });
    collDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch (err) {
    return { ok: false, reason: `Cannot read staging root: ${err.message}`, jobs: [], refreshedAt: null };
  }

  // Level 2 — event dirs inside each collection
  for (const collName of collDirs) {
    const collPath = path.join(stagingRoot, collName);
    let eventDirs;
    try {
      const entries = await fsp.readdir(collPath, { withFileTypes: true });
      eventDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch { continue; }

    for (const eventName of eventDirs) {
      const localEventPath  = path.join(collPath, eventName);
      const manifestPath    = path.join(localEventPath, MANIFEST_RELPATH);

      let manifest;
      try {
        const raw = await fsp.readFile(manifestPath, 'utf8');
        manifest  = JSON.parse(raw);
        if (!manifest || typeof manifest !== 'object') continue;
      } catch { continue; }

      const manifestJobs = Array.isArray(manifest.jobs) && manifest.jobs.length > 0
        ? manifest.jobs
        : null;

      if (manifestJobs) {
        // Per-import job cards: one queue item per manifest job entry.
        for (const mJob of manifestJobs) {
          if (!mJob || !mJob.importId) continue;

          const jobId = _importJobId(localEventPath, mJob.importId);
          const prev  = existingMap[jobId];

          const TERMINAL = new Set(['sync-failed']);
          const isSynced         = prev?.status === 'synced';
          const isNeedsAttention = prev?.status === 'needs-attention';
          const syncedAt         = isSynced        ? (prev.syncedAt  || 0) : 0;
          const prevUpdatedAt    = isNeedsAttention ? (prev.updatedAt || 0) : 0;
          const jobUpdatedAt     = mJob.updatedAt  || 0;
          const jobNewerThanSync      = isSynced         && jobUpdatedAt > syncedAt;
          const jobNewerThanAttention = isNeedsAttention && jobUpdatedAt > prevUpdatedAt;
          const preserveStatus = prev && (
            TERMINAL.has(prev.status) ||
            (isSynced         && !jobNewerThanSync) ||
            (isNeedsAttention && !jobNewerThanAttention)
          );

          const jobManifest = {
            readyForSync:   mJob.readyForSync   === true,
            needsAttention: mJob.needsAttention === true,
          };

          jobs.push({
            jobId,
            importId:       mJob.importId,
            batchId:        mJob.batchId         || null,
            collection:     manifest.collectionName || collName,
            event:          manifest.eventName      || eventName,
            localEventPath,
            manifestPath,
            photographer:   mJob.photographer    || '',
            fileCount:      mJob.fileCount       ?? null,
            metadataStatus: mJob.metadataStatus  || null,
            readyForSync:   mJob.readyForSync    === true,
            needsAttention: mJob.needsAttention  === true,
            status:         preserveStatus ? prev.status : _statusFromManifest(jobManifest),
            reason:         mJob.reason          || null,
            importedAt:     mJob.importedAt      || null,
            createdAt:      prev?.createdAt      || now,
            updatedAt:      mJob.updatedAt       || mJob.importedAt || null,
            lastSeenAt:     now,
            isLegacy:       false,
            syncedAt:       prev?.syncedAt       ?? null,
            syncResult:     prev?.syncResult     ?? null,
            syncError:      prev?.syncError      ?? null,
            checksumStatus: prev?.checksumStatus ?? null,
            checksumResult: prev?.checksumResult ?? null,
          });
        }
      } else {
        // Legacy: flat manifest without jobs[] → synthesize one event-level card.
        const jobId = _jobId(localEventPath);
        const prev  = existingMap[jobId];

        // Scan for photographer subdirectory names (display only — non-critical)
        let photographers = [];
        try {
          const phEntries = await fsp.readdir(localEventPath, { withFileTypes: true });
          photographers   = phEntries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e => e.name);
        } catch { /* ignore */ }

        const TERMINAL = new Set(['sync-failed']);
        const isSynced           = prev?.status === 'synced';
        const isNeedsAttention   = prev?.status === 'needs-attention';
        const syncedAt           = isSynced        ? (prev.syncedAt  || 0) : 0;
        const prevUpdatedAt      = isNeedsAttention ? (prev.updatedAt || 0) : 0;
        const manifestUpdatedAt  = manifest.updatedAt || 0;
        const manifestNewerThanSync      = isSynced         && manifestUpdatedAt > syncedAt;
        const manifestNewerThanAttention = isNeedsAttention && manifestUpdatedAt > prevUpdatedAt;
        const preserveStatus = prev && (
          TERMINAL.has(prev.status) ||
          (isSynced         && !manifestNewerThanSync) ||
          (isNeedsAttention && !manifestNewerThanAttention)
        );

        jobs.push({
          jobId,
          importId:       null,
          batchId:        manifest.batchId         || null,
          collection:     manifest.collectionName  || collName,
          event:          manifest.eventName       || eventName,
          localEventPath,
          manifestPath,
          photographer:   '',
          fileCount:      null,
          metadataStatus: manifest.metadataStatus  || null,
          readyForSync:   manifest.readyForSync    === true,
          needsAttention: manifest.needsAttention  === true,
          status:         preserveStatus ? prev.status : _statusFromManifest(manifest),
          reason:         manifest.reason           || null,
          importedAt:     manifest.importedAt       || null,
          createdAt:      prev?.createdAt           || now,
          updatedAt:      manifest.updatedAt        || manifest.importedAt || null,
          lastSeenAt:     now,
          isLegacy:       true,
          photographers,
          syncedAt:       prev?.syncedAt            ?? null,
          syncResult:     prev?.syncResult          ?? null,
        });
      }
    }
  }

  const data = { jobs, refreshedAt: now };
  await _saveRaw(data);
  return { ok: true, jobs, refreshedAt: now };
}

/**
 * Return the full persisted queue (cached; no re-scan).
 * @returns {{ jobs: Array, refreshedAt: number|null }}
 */
async function getQueue() {
  return _loadRaw();
}

/**
 * Return lightweight summary counts only.
 * @returns {{ ready: number, needsAttention: number, syncing: number, failed: number, total: number, refreshedAt: number|null }}
 */
async function getSummary() {
  const { jobs, refreshedAt } = await _loadRaw();
  const arr = jobs || [];
  return {
    ready:          arr.filter(j => j.status === 'ready-for-sync').length,
    needsAttention: arr.filter(j => j.status === 'needs-attention').length,
    syncing:        arr.filter(j => j.status === 'syncing').length,
    failed:         arr.filter(j => j.status === 'sync-failed').length,
    total:          arr.length,
    refreshedAt,
  };
}

/**
 * Return a single queue job by its jobId.
 * @param {string} jobId
 * @returns {object|null}
 */
async function getJob(jobId) {
  const { jobs } = await _loadRaw();
  return (jobs || []).find(j => j.jobId === jobId) || null;
}

/**
 * Atomically update a job in the persisted queue.
 * Merges `updates` into the matching job and saves.
 * No-op if jobId not found.
 *
 * @param {string} jobId
 * @param {object} updates  Partial job fields to merge
 * @returns {Promise<boolean>}  true if job was found and saved
 */
async function updateJob(jobId, updates) {
  const data = await _loadRaw();
  const jobs = data.jobs || [];
  const idx  = jobs.findIndex(j => j.jobId === jobId);
  if (idx === -1) return false;
  jobs[idx] = { ...jobs[idx], ...updates };
  await _saveRaw({ ...data, jobs });
  return true;
}

module.exports = { refreshQueue, getQueue, getSummary, getJob, updateJob };
