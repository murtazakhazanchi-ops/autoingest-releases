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

module.exports = { writeManifest, readManifest };
