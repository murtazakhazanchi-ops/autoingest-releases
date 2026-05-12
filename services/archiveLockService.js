'use strict';

/**
 * archiveLockService.js — Photographer-level Active Archive write locks.
 *
 * Lock files live under:
 *   ACTIVE_ARCHIVE_ROOT/.autoingest/locks/<lockKey>.json
 *
 * Scope: collection + event + photographer (one lock per photographer folder).
 * Lock lifetime: 30 minutes (stale if expiresAt has passed).
 *
 * Rules:
 *  - Acquire is atomic on POSIX (write .tmp → rename).
 *  - If an active, non-stale lock exists → return { acquired: false }.
 *  - Stale locks (expiresAt past) may be overwritten.
 *  - Never delete another device's active lock.
 *  - Release is best-effort: ENOENT is not an error (already released).
 */

const fsp    = require('fs').promises;
const path   = require('path');
const crypto = require('crypto');
const os     = require('os');

const LOCK_DIR_RELPATH = path.join('.autoingest', 'locks');
const LOCK_TTL_MS      = 30 * 60 * 1000; // 30 minutes

/**
 * Deterministic lock key for a (collection, event, photographer) triple.
 * Uses null byte as separator — never valid in any path segment on any OS.
 */
function _lockKey(collection, eventFolderName, photographerFolderName) {
  const input = `${collection}\x00${eventFolderName}\x00${photographerFolderName}`;
  return crypto.createHash('sha1').update(input).digest('hex').slice(0, 16);
}

/**
 * Absolute path to the lock file on the Active Archive.
 */
function _lockPath(activeArchiveRoot, collection, eventFolderName, photographerFolderName) {
  const key = _lockKey(collection, eventFolderName, photographerFolderName);
  return path.join(activeArchiveRoot, LOCK_DIR_RELPATH, `${key}.json`);
}

/**
 * Attempt to acquire a photographer-level write lock on the Active Archive.
 *
 * @param {string} activeArchiveRoot
 * @param {{ collection: string, eventFolderName: string, photographerFolderName: string, jobId: string, batchId?: string|null }} params
 * @returns {Promise<{ acquired: boolean, lockPath?: string, lockData?: object, reason?: string, lockedBy?: string, expiresAt?: number }>}
 */
async function acquireLock(activeArchiveRoot, { collection, eventFolderName, photographerFolderName, jobId, batchId }) {
  const lockPath = _lockPath(activeArchiveRoot, collection, eventFolderName, photographerFolderName);
  const lockDir  = path.dirname(lockPath);

  await fsp.mkdir(lockDir, { recursive: true });

  const now       = Date.now();
  const expiresAt = now + LOCK_TTL_MS;
  const deviceName = os.hostname();

  // Read existing lock (ENOENT → no lock present)
  let existing = null;
  try {
    const raw = await fsp.readFile(lockPath, 'utf8');
    existing = JSON.parse(raw);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }

  if (existing && existing.status === 'active' && typeof existing.expiresAt === 'number' && existing.expiresAt > now) {
    // Active, non-stale lock held by another party (or our own process on another job)
    return {
      acquired:  false,
      reason:    'locked',
      lockedBy:  existing.deviceName || 'unknown',
      expiresAt: existing.expiresAt,
    };
  }

  // No lock, or stale lock — write ours atomically
  const lockData = {
    lockType:              'photographer-archive-write',
    collection,
    eventFolderName,
    photographerFolderName,
    deviceName,
    operation:             'background-archive-sync',
    jobId,
    batchId:               batchId || null,
    createdAt:             now,
    lastHeartbeatAt:       now,
    expiresAt,
    status:                'active',
  };

  const tmpPath = lockPath + '.tmp';
  await fsp.writeFile(tmpPath, JSON.stringify(lockData, null, 2), 'utf8');
  await fsp.rename(tmpPath, lockPath);

  return { acquired: true, lockPath, lockData };
}

/**
 * Release a lock by its absolute path.
 * ENOENT is not an error — lock was already released.
 *
 * @param {string} lockPath  Absolute path returned by acquireLock.
 * @returns {Promise<void>}
 */
async function releaseLock(lockPath) {
  try {
    await fsp.unlink(lockPath);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}

module.exports = { acquireLock, releaseLock };
