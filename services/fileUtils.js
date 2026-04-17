/**
 * fileUtils.js — Safe file-system helpers (main process).
 *
 * All functions use fs.promises internally — NO fs.open, NO FileHandle,
 * NO manual descriptor management. This prevents:
 *   • "Closing file descriptor on garbage collection" warnings
 *   • DEP0137 FileHandle-not-closed deprecation warnings
 *
 * Drop-in replacements for any code that previously used open() / FileHandle.
 */

'use strict';

const fsp  = require('fs').promises;
const fs   = require('fs');
const path = require('path');

/**
 * Read a file's contents into a Buffer (or string with encoding).
 * Safe: never opens an explicit FileHandle.
 *
 * @param {string} filePath
 * @param {string|null} [encoding=null]  null → Buffer, 'utf8' → string, etc.
 * @returns {Promise<Buffer|string>}
 */
async function safeRead(filePath, encoding = null) {
  return fsp.readFile(filePath, encoding ? { encoding } : undefined);
}

/**
 * Write data to a file atomically using a .tmp swap.
 * Safe: never opens an explicit FileHandle.
 *
 * @param {string} filePath
 * @param {Buffer|string} data
 * @returns {Promise<void>}
 */
async function safeWrite(filePath, data) {
  const tmpPath = filePath + '.tmp';
  await fsp.writeFile(tmpPath, data);
  await fsp.rename(tmpPath, filePath);
}

/**
 * Return fs.Stats for a path.
 * Safe: uses fs.promises.stat — no open() involved.
 *
 * @param {string} filePath
 * @returns {Promise<import('fs').Stats>}
 */
async function safeStat(filePath) {
  return fsp.stat(filePath);
}

/**
 * Return true if the path exists (any type: file, dir, symlink).
 * Does not throw — resolves to false on any error.
 *
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function safeExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

module.exports = { safeRead, safeWrite, safeStat, safeExists };
