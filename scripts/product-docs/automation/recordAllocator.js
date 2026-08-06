'use strict';

// Race-resistant ID allocation for BUG-###, DEC-###, PM-###. Never
// renumbers an existing record; never allocates speculatively. The lock is
// a plain `wx`-flag file create (atomic at the filesystem level on every
// platform this repo targets) — no third-party lock library, matching Part
// 4's "no npm dependencies added" convention.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { LOCKS_DIR, REPO_ROOT } = require('./paths');
const { atomicWriteFileSync } = require('./atomicWrite');

const FAMILY_CONFIG = {
  bug: { prefix: 'BUG-', dir: path.join(REPO_ROOT, 'docs', 'product', 'bugs') },
  decision: { prefix: 'DEC-', dir: path.join(REPO_ROOT, 'docs', 'product', 'decisions') },
  postmortem: { prefix: 'PM-', dir: path.join(REPO_ROOT, 'docs', 'product', 'postmortems') },
};

const STALE_LOCK_MS = 60_000; // a lock older than this is assumed abandoned by a crashed process
const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 5_000;

function lockPath(family) {
  return path.join(LOCKS_DIR, `${family}.lock`);
}

function sleepSync(ms) {
  const arr = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(arr, 0, 0, ms);
}

// Breaks a lock file if it is older than STALE_LOCK_MS — recovers from a
// crashed session that acquired the lock and never released it. Never
// breaks a fresh lock a concurrent live session may be holding.
//
// A plain stat-then-unlink here would have a real TOCTOU window: if the
// original holder is merely slow (not crashed) and releases its lock
// between our stat and our unlink, we could delete ITS successor's fresh
// lock instead, letting two processes believe they both hold it — the
// exact bug class this module exists to prevent (found in code review).
// Renaming the lock file away is atomic at the filesystem level: if the
// original holder concurrently unlinks it first, our rename fails with
// ENOENT and we cleanly back off and retry the acquire loop instead of
// risking a live lock.
function breakStaleLockIfAny(family) {
  const p = lockPath(family);
  let stat;
  try {
    stat = fs.statSync(p);
  } catch {
    return false; // no lock present — nothing to break
  }
  if (Date.now() - stat.mtimeMs <= STALE_LOCK_MS) return false;
  const graveyard = `${p}.stale-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`;
  try {
    fs.renameSync(p, graveyard);
    fs.unlinkSync(graveyard);
    return true;
  } catch {
    return false; // lost the race to claim the stale lock — someone else handled it
  }
}

// Returns an opaque token identifying THIS acquisition. releaseLock only
// unlinks the lock file if its on-disk token still matches — if our lock
// was broken as stale and re-acquired by another process while we (contrary
// to the staleness assumption) were still legitimately working, releasing
// here must not delete that other process's live lock.
function acquireLock(family) {
  fs.mkdirSync(LOCKS_DIR, { recursive: true });
  const p = lockPath(family);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (;;) {
    const token = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      const fd = fs.openSync(p, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, token, acquired_at: new Date().toISOString() }));
      fs.closeSync(fd);
      return token;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      breakStaleLockIfAny(family);
      if (Date.now() > deadline) {
        throw new Error(`Timed out acquiring ${family} ID-allocation lock — another session may be stuck (see ${p})`);
      }
      sleepSync(LOCK_RETRY_MS);
    }
  }
}

function releaseLock(family, token) {
  const p = lockPath(family);
  try {
    const onDisk = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (onDisk.token !== token) {
      // Not ours anymore (broken as stale and re-acquired by someone else)
      // — do not delete a lock we no longer own.
      return;
    }
    fs.unlinkSync(p);
  } catch {
    // already gone — fine
  }
}

// Scans the real docs/product/{bugs,decisions,postmortems}/ directory
// (never a cached in-memory index, which could be stale relative to a
// concurrent session's just-written file) for the highest existing ID.
function currentMaxNumber(family) {
  const { prefix, dir } = FAMILY_CONFIG[family];
  if (!fs.existsSync(dir)) return 0;
  const re = new RegExp(`^${prefix}(\\d{3})`);
  let max = 0;
  for (const entry of fs.readdirSync(dir)) {
    const m = re.exec(entry);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

// Allocates the next ID for `family` and writes `content` to the new file
// under the lock, so allocation and the file becoming visible on disk are
// atomic with respect to a concurrent allocator in another process — there
// is no window where the ID is "reserved" but no file exists for it.
function allocateAndWriteRecord(family, slug, content) {
  if (!FAMILY_CONFIG[family]) throw new Error(`Unknown record family: ${family}`);
  const { prefix, dir } = FAMILY_CONFIG[family];
  const token = acquireLock(family);
  try {
    const next = currentMaxNumber(family) + 1;
    const id = `${prefix}${String(next).padStart(3, '0')}`;
    const safeSlug = String(slug || 'UNTITLED').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'UNTITLED';
    const fileName = `${id}_${safeSlug}.md`;
    const filePath = path.join(dir, fileName);
    if (fs.existsSync(filePath)) {
      // Should be unreachable under the lock — defensive guard only.
      throw new Error(`Record allocation collision: ${filePath} already exists`);
    }
    atomicWriteFileSync(filePath, content);
    return { id, filePath, relPath: path.relative(REPO_ROOT, filePath).split(path.sep).join('/') };
  } finally {
    releaseLock(family, token);
  }
}

module.exports = { FAMILY_CONFIG, currentMaxNumber, allocateAndWriteRecord, acquireLock, releaseLock, lockPath, STALE_LOCK_MS };
