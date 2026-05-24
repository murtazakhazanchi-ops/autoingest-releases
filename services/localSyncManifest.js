'use strict';
const fsp  = require('fs').promises;
const path = require('path');

const { hidePathBestEffort } = require('./internalFileProtection');

const AUTOINGEST_DIR = '.autoingest';
const MANIFEST_FILE  = 'event.sync.json';

/**
 * Write (or overwrite) the ready-for-sync manifest inside a local staging event folder.
 * Path: {localEventPath}/.autoingest/event.sync.json
 *
 * @param {string} localEventPath  Absolute path to the local staging event folder.
 * @param {object} manifest        Manifest data to persist.
 * @returns {Promise<{ ok: boolean, path: string }>}
 */
async function writeManifest(localEventPath, manifest) {
  if (!localEventPath || typeof localEventPath !== 'string') {
    throw new Error('localSyncManifest.writeManifest: invalid localEventPath');
  }

  const dir      = path.join(localEventPath, AUTOINGEST_DIR);
  const filePath = path.join(dir, MANIFEST_FILE);
  const tmp      = filePath + '.tmp';

  await fsp.mkdir(dir, { recursive: true });
  hidePathBestEffort(dir).catch(() => {});

  const data = { ...manifest, updatedAt: Date.now() };
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, filePath);

  return { ok: true, path: filePath };
}

/**
 * Read the ready-for-sync manifest from a local staging event folder.
 * Returns null when no manifest exists yet.
 *
 * @param {string} localEventPath
 * @returns {Promise<object|null>}
 */
async function readManifest(localEventPath) {
  if (!localEventPath || typeof localEventPath !== 'string') return null;
  const filePath = path.join(localEventPath, AUTOINGEST_DIR, MANIFEST_FILE);
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

/**
 * Append or update a per-import job entry in the manifest's jobs[] array.
 * Flat fields (eventName, collectionName, batchId, importedAt, metadataStatus,
 * readyForSync, needsAttention, reason) are kept in sync with the most recent job
 * so old code reading the manifest without jobs[]-awareness still gets sensible values.
 *
 * @param {string} localEventPath
 * @param {{ importId: string, batchId?: string, eventName?: string, collectionName?: string,
 *            photographer?: string, fileCount?: number, importedAt?: number,
 *            metadataStatus?: string, readyForSync?: boolean, needsAttention?: boolean,
 *            reason?: string }} job
 * @returns {Promise<{ ok: boolean, path: string }>}
 */
async function appendJob(localEventPath, job) {
  if (!localEventPath || typeof localEventPath !== 'string') {
    throw new Error('localSyncManifest.appendJob: invalid localEventPath');
  }
  if (!job || !job.importId) {
    throw new Error('localSyncManifest.appendJob: job.importId required');
  }

  const dir      = path.join(localEventPath, AUTOINGEST_DIR);
  const filePath = path.join(dir, MANIFEST_FILE);
  const tmp      = filePath + '.tmp';

  await fsp.mkdir(dir, { recursive: true });
  hidePathBestEffort(dir).catch(() => {});

  let existing = null;
  try {
    const raw = await fsp.readFile(filePath, 'utf8');
    existing = JSON.parse(raw);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  const existingJobs = Array.isArray(existing?.jobs) ? existing.jobs : [];
  const MAX_JOBS = 200;

  const jobEntry = {
    importId:       job.importId,
    batchId:        job.batchId        ?? null,
    photographer:   job.photographer   || '',
    fileCount:      job.fileCount      ?? 0,
    files:          Array.isArray(job.files) && job.files.length > 0 ? job.files : null,
    importedAt:     job.importedAt     ?? Date.now(),
    metadataStatus: job.metadataStatus || null,
    readyForSync:   job.readyForSync   === true,
    needsAttention: job.needsAttention === true,
    reason:         job.reason         ?? null,
    updatedAt:      Date.now(),
  };

  const idx = existingJobs.findIndex(j => j.importId === job.importId);
  let jobs;
  if (idx >= 0) {
    jobs = existingJobs.slice();
    jobs[idx] = { ...existingJobs[idx], ...jobEntry };
  } else {
    jobs = [...existingJobs, jobEntry];
    if (jobs.length > MAX_JOBS) jobs = jobs.slice(-MAX_JOBS);
  }

  const latest = jobs[jobs.length - 1];
  const data = {
    ...(existing || {}),
    eventName:      job.eventName      || existing?.eventName      || '',
    collectionName: job.collectionName || existing?.collectionName || '',
    batchId:        latest.batchId     || latest.importId,
    importedAt:     latest.importedAt,
    metadataStatus: latest.metadataStatus,
    readyForSync:   jobs.some(j => j.readyForSync),
    needsAttention: jobs.some(j => j.needsAttention),
    reason:         latest.reason || null,
    jobs,
    updatedAt:      Date.now(),
  };

  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, filePath);

  return { ok: true, path: filePath };
}

module.exports = { writeManifest, readManifest, appendJob };
