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
 *  - Heartbeat renews only locks owned by this job/device; never extends another's lock.
 */

const fsp    = require('fs').promises;
const path   = require('path');
const crypto = require('crypto');
const os     = require('os');

const { hidePathBestEffort } = require('./internalFileProtection');

const LOCK_DIR_RELPATH       = path.join('.autoingest', 'locks');
const LOCK_TTL_MS            = 30 * 60 * 1000; // 30 minutes
const LOCK_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes — must be < TTL

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
  hidePathBestEffort(path.dirname(lockDir)).catch(() => {});

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
 * Non-acquiring advisory check — does an active, non-stale lock exist?
 * Returns { blocked: true, lockedBy, expiresAt } or { blocked: false }.
 * ENOENT or stale lock → not blocked.
 * Never acquires or modifies any lock file.
 *
 * @param {string} activeArchiveRoot
 * @param {{ collection: string, eventFolderName: string, photographerFolderName: string }} params
 * @returns {Promise<{ blocked: boolean, lockedBy?: string, expiresAt?: number }>}
 */
async function checkLock(activeArchiveRoot, { collection, eventFolderName, photographerFolderName }) {
  const lockPath = _lockPath(activeArchiveRoot, collection, eventFolderName, photographerFolderName);
  let existing = null;
  try {
    const raw = await fsp.readFile(lockPath, 'utf8');
    existing  = JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return { blocked: false };
    throw e;
  }
  const now = Date.now();
  if (existing && existing.status === 'active' && typeof existing.expiresAt === 'number' && existing.expiresAt > now) {
    return { blocked: true, lockedBy: existing.deviceName || 'unknown', expiresAt: existing.expiresAt };
  }
  return { blocked: false };
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

/**
 * Safely release a stale lock via the diagnostics repair UI.
 *
 * Safety rules:
 *  1. lockPath must resolve inside <configuredRoot>/.autoingest/locks/ — no traversal.
 *  2. lockPath must end with .json.
 *  3. Re-reads the lock file immediately before deletion; aborts if the lock
 *     has since become active (TOCTOU guard).
 *  4. ENOENT on re-read is treated as already-missing (idempotent OK).
 *
 * @param {string}   lockPath         Absolute path to the candidate lock file.
 * @param {string[]} configuredRoots  Archive roots from settings (nas + main).
 * @returns {Promise<{ ok: boolean, reason: string }>}
 */
async function releaseStaleLock(lockPath, configuredRoots) {
  if (!_isValidLockPath(lockPath, configuredRoots)) {
    return { ok: false, reason: 'invalid-path' };
  }

  let lock;
  try {
    const raw = await fsp.readFile(lockPath, 'utf8');
    lock = JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return { ok: true, reason: 'already-missing' };
    throw e;
  }

  const now = Date.now();
  if (lock.status === 'active' && typeof lock.expiresAt === 'number' && lock.expiresAt > now) {
    return { ok: false, reason: 'lock-active' };
  }

  try {
    await fsp.unlink(lockPath);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  return { ok: true, reason: 'released' };
}

/**
 * @param {string}   lockPath
 * @param {string[]} configuredRoots
 * @returns {boolean}
 */
function _isValidLockPath(lockPath, configuredRoots) {
  if (!lockPath || typeof lockPath !== 'string') return false;
  const normalized = path.normalize(lockPath);
  if (!normalized.endsWith('.json')) return false;
  if (!Array.isArray(configuredRoots)) return false;
  return configuredRoots.some(root => {
    if (!root) return false;
    const lockDir = path.join(root, '.autoingest', 'locks');
    const rel = path.relative(lockDir, normalized);
    // rel must be a flat filename inside lockDir — no subdirs, no traversal, no absolute path
    return rel &&
           !rel.startsWith('..') &&
           !path.isAbsolute(rel) &&
           !rel.includes(path.sep);
  });
}

/**
 * Renew a lock that this process already holds.
 * Reads the current lock file, verifies ownership (jobId + deviceName), then
 * writes an updated lastHeartbeatAt and expiresAt atomically.
 *
 * Returns { renewed: false } without throwing when:
 *   - lock file is gone (ENOENT)          → reason: 'lock-missing'
 *   - lock is no longer active            → reason: 'lock-inactive'
 *   - jobId or deviceName does not match  → reason: 'ownership-mismatch'
 *
 * Throws only on unexpected I/O errors.
 *
 * @param {string} lockPath   Absolute path returned by acquireLock.
 * @param {{ jobId: string, deviceName: string }} expectedOwner  Fields from lockData.
 * @returns {Promise<{ renewed: boolean, reason?: string }>}
 */
async function renewLock(lockPath, { jobId, deviceName }) {
  let existing;
  try {
    const raw = await fsp.readFile(lockPath, 'utf8');
    existing  = JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') return { renewed: false, reason: 'lock-missing' };
    throw e;
  }

  if (existing.status !== 'active') {
    return { renewed: false, reason: 'lock-inactive' };
  }
  if (existing.jobId !== jobId || existing.deviceName !== deviceName) {
    return { renewed: false, reason: 'ownership-mismatch' };
  }

  const now     = Date.now();
  const renewed = { ...existing, lastHeartbeatAt: now, expiresAt: now + LOCK_TTL_MS };

  const tmpPath = lockPath + '.tmp';
  await fsp.writeFile(tmpPath, JSON.stringify(renewed, null, 2), 'utf8');
  await fsp.rename(tmpPath, lockPath);

  return { renewed: true };
}

module.exports = {
  acquireLock,
  checkLock,
  releaseLock,
  releaseStaleLock,
  renewLock,
  LOCK_TTL_MS,
  LOCK_HEARTBEAT_INTERVAL_MS,
};
