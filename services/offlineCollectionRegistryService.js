'use strict';

/**
 * offlineCollectionRegistryService.js — Collection-to-NAS link registry.
 *
 * Manages collection.link.json inside each staging collection's .autoingest/
 * folder. The file records whether the collection is linked to a specific NAS
 * master collection (prepared offline) or is provisional (created locally
 * without a NAS link).
 *
 * File location: <localStagingCollectionPath>/.autoingest/collection.link.json
 *
 * Authoritative rules:
 *  — NEVER modifies event.json or event.sync.json.
 *  — NEVER writes outside the staging collection path given to it.
 *  — "offline-ready" is a runtime derivation; it is NEVER written to disk.
 *  — Writes are atomic (tmp → rename), then hidden with hidePathBestEffort.
 */

const fsp  = require('fs').promises;
const path = require('path');

const { hidePathBestEffort } = require('./internalFileProtection');

const LINK_FILENAME  = 'collection.link.json';
const AUTOINGEST_DIR = '.autoingest';
const SCHEMA_VERSION = 1;

// ── Internal helpers ──────────────────────────────────────────────────────────

function _linkPath(localCollectionPath) {
  return path.join(localCollectionPath, AUTOINGEST_DIR, LINK_FILENAME);
}

function _autoingestDir(localCollectionPath) {
  return path.join(localCollectionPath, AUTOINGEST_DIR);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read the collection link file for a staging collection.
 * Returns { ok: true, link } on success or { ok: false, link: null, reason } on failure.
 * reason === 'not-found' means no link file exists (legacy / unlinked collection).
 */
async function readLink(localCollectionPath) {
  if (!localCollectionPath || typeof localCollectionPath !== 'string') {
    return { ok: false, link: null, reason: 'invalid-path' };
  }
  try {
    const raw  = await fsp.readFile(_linkPath(localCollectionPath), 'utf8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') {
      return { ok: false, link: null, reason: 'invalid-json' };
    }
    return { ok: true, link: data };
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: false, link: null, reason: 'not-found' };
    return { ok: false, link: null, reason: err.message };
  }
}

/**
 * Write (or overwrite) the collection link file atomically.
 * Callers supply the full linkData object; this function normalises and persists it.
 */
async function writeLink(localCollectionPath, linkData) {
  if (!localCollectionPath || typeof localCollectionPath !== 'string') {
    return { ok: false, reason: 'invalid-path' };
  }

  const dir      = _autoingestDir(localCollectionPath);
  const filePath = _linkPath(localCollectionPath);
  const tmpPath  = filePath + '.' + Date.now() + '.tmp';

  const payload = JSON.stringify({
    schemaVersion:              SCHEMA_VERSION,
    collectionName:             linkData.collectionName              || null,
    nasRoot:                    linkData.nasRoot                     || null,
    nasCollectionPath:          linkData.nasCollectionPath           || null,
    localStagingCollectionPath: linkData.localStagingCollectionPath  || localCollectionPath,
    preparedAt:                 linkData.preparedAt                  || Date.now(),
    deviceId:                   linkData.deviceId                    || null,
    operator:                   linkData.operator                    || null,
    status:                     linkData.status                      || 'provisional',
  }, null, 2);

  try {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(tmpPath, payload, 'utf8');
    await fsp.rename(tmpPath, filePath);
    await hidePathBestEffort(filePath);
    await hidePathBestEffort(dir);
    return { ok: true };
  } catch (err) {
    try { await fsp.unlink(tmpPath); } catch { /* ignore */ }
    return { ok: false, reason: err.message };
  }
}

/**
 * Remove the collection link file. Non-fatal if absent.
 */
async function clearLink(localCollectionPath) {
  try {
    await fsp.unlink(_linkPath(localCollectionPath));
    return { ok: true };
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: true };
    return { ok: false, reason: err.message };
  }
}

/**
 * Derive the display/routing status for a parsed link object.
 * "offline-ready" is never written to disk — only returned here.
 *
 * @param {object|null} link            Parsed link from readLink().
 * @param {string|null} currentNasRoot  Current settings.getNasRoot().
 * @param {boolean}     nasOnline       Whether the NAS is accessible right now.
 * @returns {'linked'|'offline-ready'|'provisional'|'stale-link'|'unlinked-legacy'}
 */
function deriveStatus(link, currentNasRoot, nasOnline = true) {
  if (!link) return 'unlinked-legacy';
  if (link.status === 'provisional') return 'provisional';
  if (!link.nasCollectionPath || !link.nasRoot) return 'provisional';
  if (currentNasRoot && link.nasRoot !== currentNasRoot) return 'stale-link';
  if (!nasOnline) return 'offline-ready';
  return 'linked';
}

module.exports = {
  readLink,
  writeLink,
  clearLink,
  deriveStatus,
  LINK_FILENAME,
  AUTOINGEST_DIR,
};
