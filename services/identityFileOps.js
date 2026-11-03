/**
 * identityFileOps.js — crash-safe file primitives for the identity registry (AI-RM-014 Q4b).
 * The fs implementation is injected (fs.promises by default) so tests can inject faults
 * (ENOSPC, EACCES, interrupted writes) without touching real operator data.
 *
 * atomicWriteFile: write to a unique temp file in the same directory, fsync it, rename over
 * the target, then fsync the directory (best effort — Windows cannot open directories).
 * A crash leaves either the old file or the new file, never a partial target; a leftover
 * temp file is recognisable by its prefix and is quarantined on the next open.
 */

'use strict';

const path = require('path');
const crypto = require('crypto');

const TMP_MARK = '.tmp-';

async function _fsyncDir(fsx, dir) {
  let fh = null;
  try { fh = await fsx.open(dir, 'r'); await fh.sync(); }
  catch { /* not supported on every platform (Windows: EISDIR/EPERM) — the rename is still atomic */ }
  finally { if (fh) await fh.close().catch(() => {}); }
}

/**
 * @param {typeof import('fs').promises} fsx
 * @param {string} file
 * @param {string|Buffer} data
 */
async function atomicWriteFile(fsx, file, data) {
  const dir = path.dirname(file);
  const tmp = path.join(dir, `${path.basename(file)}${TMP_MARK}${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  let fh = null;
  try {
    fh = await fsx.open(tmp, 'wx', 0o600);
    await fh.writeFile(data);
    await fh.sync();
    await fh.close();
    fh = null;
    await fsx.rename(tmp, file);
  } catch (err) {
    if (fh) await fh.close().catch(() => {});
    await fsx.unlink(tmp).catch(() => {});
    throw err;
  }
  await _fsyncDir(fsx, dir);
}

async function readIfExists(fsx, file) {
  try { return await fsx.readFile(file); }
  catch (err) { if (err.code === 'ENOENT') return null; throw err; }
}

async function exists(fsx, file) {
  try { await fsx.stat(file); return true; } catch (err) { if (err.code === 'ENOENT') return false; throw err; }
}

/** Compact sortable UTC stamp for backup / quarantine names. */
const stamp = (date) => date.toISOString().replace(/[-:]/g, '').replace('.', '');

module.exports = { atomicWriteFile, readIfExists, exists, stamp, TMP_MARK };
