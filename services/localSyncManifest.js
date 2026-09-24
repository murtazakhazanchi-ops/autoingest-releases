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

// ── D4: durable destination reservations ────────────────────────────────────────────
//
// Records, per job/import, the resolved archive destination for a source file that
// needed a conflict rename — so a retry of the SAME job/import recognizes an
// already-reserved (or already-copied) destination instead of allocating another `_N`
// suffix each time. A reservation is written BEFORE the copy it describes (see
// archiveSyncService.js's PAIR/RETRY INVARIANT comments): it means "this source owns
// this destination", not "the copy definitely completed" — every consumer must verify
// the mapped destination against live disk state before trusting it.
//
// Scope: per-import (`jobs[]` entry, keyed by importId) for the modern manifest shape;
// per-event (the manifest's own top level) for the legacy flat shape that predates
// jobs[] — this matches how every other field on a legacy manifest is already scoped,
// and keeps a genuinely new later import (a new importId) fully independent of an
// older one's reservations. relPath keys are canonical, forward-slash, event-relative —
// never an absolute machine path — so a manifest remains meaningful regardless of where
// the staging root is mounted.

/** Find the record (job entry, or the manifest itself for legacy) that owns reservations for `importId`. */
function _findScope(manifest, importId) {
  if (importId) {
    const jobs = Array.isArray(manifest?.jobs) ? manifest.jobs : [];
    return jobs.find(j => j.importId === importId) || null;
  }
  return manifest || null;
}

/**
 * Read a single reserved-destination record, if one exists.
 * @returns {Promise<{relPath:string, finalRelPath:string, size:number, checksum:string}|null>}
 */
async function getResolvedFile(localEventPath, importId, relPath) {
  const manifest = await readManifest(localEventPath);
  const scope = _findScope(manifest, importId);
  const list = Array.isArray(scope?.resolvedFiles) ? scope.resolvedFiles : [];
  return list.find(f => f.relPath === relPath) || null;
}

/**
 * Atomically upsert one or more resolved-destination reservations (by relPath) into the
 * scope for `importId` (a RAW+XMP pair passes both entries in one call so they land in a
 * single atomic write — never two independent suffix decisions). Preserves every other
 * field and every other job entry untouched. No-op (returns ok:false) if the target
 * scope (job entry) does not exist yet — reservations are only ever added to a job/event
 * that is already known to the manifest.
 *
 * @param {string} localEventPath
 * @param {string|null} importId  null selects the legacy (event-level) scope.
 * @param {{relPath:string, finalRelPath:string, size:number, checksum:string}[]} entries
 * @returns {Promise<{ ok: boolean, path?: string }>}
 */
async function reserveResolvedFiles(localEventPath, importId, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return { ok: false };

  const dir      = path.join(localEventPath, AUTOINGEST_DIR);
  const filePath = path.join(dir, MANIFEST_FILE);
  const tmp      = filePath + '.tmp';

  const existing = await readManifest(localEventPath);
  if (!existing) return { ok: false };

  const mergeInto = (scope) => {
    const list = Array.isArray(scope.resolvedFiles) ? scope.resolvedFiles.slice() : [];
    for (const entry of entries) {
      const idx = list.findIndex(f => f.relPath === entry.relPath);
      const record = { relPath: entry.relPath, finalRelPath: entry.finalRelPath, size: entry.size, checksum: entry.checksum };
      if (idx >= 0) list[idx] = record; else list.push(record);
    }
    return { ...scope, resolvedFiles: list };
  };

  let updated;
  if (importId) {
    const jobs = Array.isArray(existing.jobs) ? existing.jobs : [];
    const idx  = jobs.findIndex(j => j.importId === importId);
    if (idx === -1) return { ok: false }; // unknown import — nothing to attach the reservation to
    const newJobs = jobs.slice();
    newJobs[idx]  = mergeInto(jobs[idx]);
    updated = { ...existing, jobs: newJobs, updatedAt: Date.now() };
  } else {
    updated = { ...mergeInto(existing), updatedAt: Date.now() };
  }

  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(tmp, JSON.stringify(updated, null, 2), 'utf8');
  await fsp.rename(tmp, filePath);
  return { ok: true, path: filePath };
}

module.exports = { writeManifest, readManifest, appendJob, getResolvedFile, reserveResolvedFiles };
