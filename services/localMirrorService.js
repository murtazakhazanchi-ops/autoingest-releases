'use strict';

/**
 * localMirrorService.js — Local mirror creation for Local First staging.
 *
 * Creates a minimal local staging copy of a NAS-managed event folder so
 * that a Local First import session has a valid local event structure to
 * target.  The mirror contains only the event.json and event.metadata.json
 * from the NAS source — no media files, no photographer folders.
 *
 * Rules:
 *  - Writes ONLY inside the configured Local Staging Root (settings.getLocalStagingRoot()).
 *  - Reads event.json and event.metadata.json from the NAS event path (read-only NAS access).
 *  - Does not write to NAS under any circumstance.
 *  - If a local event.json already exists and matches the NAS source, it is left in place (idempotent).
 *  - If a local event.json exists but differs from the NAS source, returns a conflict — does NOT overwrite.
 *  - Hidden/protected attributes are applied to copied internal files; failure to hide is non-fatal.
 *  - Path traversal is blocked: collectionName and eventName are sanitised and the resolved
 *    local paths are verified to be inside the staging root before any filesystem operation.
 *  - Does not create photographer folders, sub-event folders, or copy media files.
 */

const fsp  = require('fs').promises;
const path = require('path');
const { execFile } = require('child_process');

const settings = require('./settings');

// ── Constants ────────────────────────────────────────────────────────────────

const EVENT_JSON          = 'event.json';
const EVENT_METADATA_JSON = 'event.metadata.json';

// ── Path safety helpers ───────────────────────────────────────────────────────

/**
 * Strip all characters that are not safe in a single path segment.
 * Collapses any ".." component by rejecting names that contain "/" or "\"
 * or that equal "." or "..".
 * @param {string} name
 * @returns {string | null}  Sanitised segment, or null if unsafe.
 */
function _sanitiseSegment(name) {
  if (!name || typeof name !== 'string') return null;
  // Reject traversal, absolute, or null-byte injections
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return null;
  if (name === '.' || name === '..') return null;
  if (name.trim() === '') return null;
  return name;
}

/**
 * Verify that resolvedChild is strictly inside resolvedBase.
 * @param {string} resolvedBase   Absolute, normalised base path.
 * @param {string} resolvedChild  Absolute, normalised candidate path.
 * @returns {boolean}
 */
function _isInside(resolvedBase, resolvedChild) {
  const base = resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep;
  return resolvedChild.startsWith(base);
}

/**
 * Build and validate local collection + event paths from input.
 * Returns { localCollectionPath, localEventPath } or throws with a reason string.
 * @param {string} stagingRoot
 * @param {string} collectionName
 * @param {string} eventName
 * @returns {{ localCollectionPath: string, localEventPath: string }}
 */
function _resolveLocalPaths(stagingRoot, collectionName, eventName) {
  const safeCollection = _sanitiseSegment(collectionName);
  if (!safeCollection) throw new Error(`Unsafe collection name: "${collectionName}"`);

  const safeEvent = _sanitiseSegment(eventName);
  if (!safeEvent) throw new Error(`Unsafe event name: "${eventName}"`);

  const localCollectionPath = path.resolve(stagingRoot, safeCollection);
  const localEventPath      = path.resolve(localCollectionPath, safeEvent);

  const resolvedRoot = path.resolve(stagingRoot);
  if (!_isInside(resolvedRoot, localCollectionPath)) {
    throw new Error('Path traversal detected in collection name');
  }
  if (!_isInside(resolvedRoot, localEventPath)) {
    throw new Error('Path traversal detected in event name');
  }

  return { localCollectionPath, localEventPath };
}

// ── Hidden-attribute helper ───────────────────────────────────────────────────

/**
 * Apply platform-appropriate hidden/protected attributes to a file.
 * Non-fatal — if the operation fails the caller receives hiddenApplied: false.
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function _applyHidden(filePath) {
  return new Promise((resolve) => {
    const platform = process.platform;
    if (platform === 'darwin') {
      execFile('chflags', ['hidden', filePath], (err) => resolve(!err));
    } else if (platform === 'win32') {
      execFile('attrib', ['+H', filePath], (err) => resolve(!err));
    } else {
      // Linux/other: no standard way to hide files; skip silently
      resolve(false);
    }
  });
}

// ── File copy with conflict detection ─────────────────────────────────────────

/**
 * Copy srcPath to destPath with the following semantics:
 *  - If destPath does not exist: copy srcPath → destPath.
 *  - If destPath exists and content matches srcPath: no-op (idempotent).
 *  - If destPath exists and content differs: return conflict, do NOT overwrite.
 *
 * @param {string} srcPath
 * @param {string} destPath
 * @returns {Promise<{ copied: boolean, conflict: boolean, existed: boolean }>}
 */
async function _copyFileIfNotConflict(srcPath, destPath) {
  let srcContent;
  try {
    srcContent = await fsp.readFile(srcPath);
  } catch (err) {
    throw new Error(`Cannot read source file "${path.basename(srcPath)}": ${err.message}`);
  }

  let destContent = null;
  let existed = false;
  try {
    destContent = await fsp.readFile(destPath);
    existed = true;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw new Error(`Cannot read destination file "${path.basename(destPath)}": ${err.message}`);
    }
  }

  if (existed) {
    if (srcContent.equals(destContent)) {
      return { copied: false, conflict: false, existed: true };
    }
    return { copied: false, conflict: true, existed: true };
  }

  // Destination absent — write atomically
  const tmp = destPath + '.tmp';
  try {
    await fsp.writeFile(tmp, srcContent);
    await fsp.rename(tmp, destPath);
  } catch (err) {
    try { await fsp.unlink(tmp); } catch { /* ignore */ }
    throw new Error(`Cannot write "${path.basename(destPath)}": ${err.message}`);
  }

  return { copied: true, conflict: false, existed: false };
}

// ── Input validation ──────────────────────────────────────────────────────────

/**
 * Validate the required fields of an event record from Phase 2 NAS scan.
 * @param {object} params
 * @returns {{ valid: boolean, reason?: string }}
 */
function _validateInput(params) {
  const { collectionName, eventName, eventPath, eventJsonPath } = params || {};
  if (!collectionName || typeof collectionName !== 'string') return { valid: false, reason: 'Missing collectionName' };
  if (!eventName      || typeof eventName !== 'string')      return { valid: false, reason: 'Missing eventName' };
  if (!eventPath      || typeof eventPath !== 'string')      return { valid: false, reason: 'Missing eventPath' };
  if (!eventJsonPath  || typeof eventJsonPath !== 'string')  return { valid: false, reason: 'Missing eventJsonPath' };
  return { valid: true };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Preview what ensureLocalMirror would do, without creating or copying anything.
 *
 * @param {{ collectionName, eventName, eventPath, eventJsonPath }} params
 * @returns {Promise<{
 *   valid: boolean,
 *   reason?: string,
 *   localCollectionPath?: string,
 *   localEventPath?: string,
 *   eventJsonWillCopy?: boolean,
 *   metadataJsonWillCopy?: boolean,
 *   alreadyExists?: boolean,
 *   eventJsonConflict?: boolean,
 *   metadataJsonConflict?: boolean,
 * }>}
 */
async function previewLocalMirror(params) {
  const check = _validateInput(params);
  if (!check.valid) return { valid: false, reason: check.reason };

  const stagingRoot = settings.getLocalStagingRoot();
  if (!stagingRoot) return { valid: false, reason: 'Local Staging Root is not configured' };

  // Verify staging root is accessible
  try {
    const stat = await fsp.stat(stagingRoot);
    if (!stat.isDirectory()) return { valid: false, reason: 'Local Staging Root is not a directory' };
  } catch {
    return { valid: false, reason: 'Local Staging Root is inaccessible' };
  }

  let localCollectionPath, localEventPath;
  try {
    ({ localCollectionPath, localEventPath } = _resolveLocalPaths(
      stagingRoot, params.collectionName, params.eventName
    ));
  } catch (err) {
    return { valid: false, reason: err.message };
  }

  // Check whether the local event folder already exists
  let alreadyExists = false;
  try {
    const stat = await fsp.stat(localEventPath);
    alreadyExists = stat.isDirectory();
  } catch { /* ENOENT = not yet created */ }

  // Check NAS event.json readability
  try {
    await fsp.access(params.eventJsonPath);
  } catch {
    return { valid: false, reason: 'NAS event.json is not accessible' };
  }

  // Determine copy/conflict state for event.json
  let eventJsonWillCopy   = true;
  let eventJsonConflict   = false;
  const localEventJson = path.join(localEventPath, EVENT_JSON);
  try {
    const [srcBuf, dstBuf] = await Promise.all([
      fsp.readFile(params.eventJsonPath),
      fsp.readFile(localEventJson),
    ]);
    if (srcBuf.equals(dstBuf)) {
      eventJsonWillCopy = false; // identical — no-op
    } else {
      eventJsonWillCopy = false;
      eventJsonConflict = true;  // differs — would conflict
    }
  } catch { /* local doesn't exist yet — will copy */ }

  // Determine copy/conflict state for event.metadata.json
  let metadataJsonWillCopy = false;
  let metadataJsonConflict = false;
  const nasMetadataPath    = path.join(params.eventPath, EVENT_METADATA_JSON);
  const localMetadataJson  = path.join(localEventPath, EVENT_METADATA_JSON);
  try {
    await fsp.access(nasMetadataPath);
    // NAS metadata exists — check local
    try {
      const [srcBuf, dstBuf] = await Promise.all([
        fsp.readFile(nasMetadataPath),
        fsp.readFile(localMetadataJson),
      ]);
      if (srcBuf.equals(dstBuf)) {
        metadataJsonWillCopy = false; // identical
      } else {
        metadataJsonWillCopy = false;
        metadataJsonConflict = true;
      }
    } catch {
      metadataJsonWillCopy = true; // local doesn't exist — will copy
    }
  } catch { /* NAS metadata absent — nothing to copy */ }

  return {
    valid: true,
    localCollectionPath,
    localEventPath,
    eventJsonWillCopy,
    metadataJsonWillCopy,
    alreadyExists,
    eventJsonConflict,
    metadataJsonConflict,
  };
}

/**
 * Create the local mirror: collection folder + event folder + copy event.json
 * (and event.metadata.json if present on NAS).
 *
 * Idempotent — safe to call repeatedly.  Existing identical files are preserved.
 * Conflicting files (local differs from NAS source) are not overwritten.
 *
 * @param {{ collectionName, eventName, eventPath, eventJsonPath }} params
 * @returns {Promise<{
 *   ok: boolean,
 *   reason?: string,
 *   localCollectionPath?: string,
 *   localEventPath?: string,
 *   copiedEventJson?: boolean,
 *   copiedMetadataJson?: boolean,
 *   hiddenApplied?: boolean,
 *   eventJsonConflict?: boolean,
 *   metadataJsonConflict?: boolean,
 * }>}
 */
async function ensureLocalMirror(params) {
  const check = _validateInput(params);
  if (!check.valid) return { ok: false, reason: check.reason };

  const stagingRoot = settings.getLocalStagingRoot();
  if (!stagingRoot) return { ok: false, reason: 'Local Staging Root is not configured' };

  // Verify staging root is writable
  try {
    const stat = await fsp.stat(stagingRoot);
    if (!stat.isDirectory()) return { ok: false, reason: 'Local Staging Root is not a directory' };
  } catch {
    return { ok: false, reason: 'Local Staging Root is inaccessible' };
  }

  let localCollectionPath, localEventPath;
  try {
    ({ localCollectionPath, localEventPath } = _resolveLocalPaths(
      stagingRoot, params.collectionName, params.eventName
    ));
  } catch (err) {
    return { ok: false, reason: err.message };
  }

  // Verify NAS event.json is readable
  try {
    await fsp.access(params.eventJsonPath);
  } catch {
    return { ok: false, reason: 'NAS event.json is not accessible' };
  }

  // Create folders
  try {
    await fsp.mkdir(localEventPath, { recursive: true });
  } catch (err) {
    return { ok: false, reason: `Failed to create local event folder: ${err.message}` };
  }

  // Copy event.json
  const localEventJson = path.join(localEventPath, EVENT_JSON);
  let copiedEventJson    = false;
  let eventJsonConflict  = false;
  try {
    const result = await _copyFileIfNotConflict(params.eventJsonPath, localEventJson);
    copiedEventJson   = result.copied;
    eventJsonConflict = result.conflict;
  } catch (err) {
    return { ok: false, reason: err.message };
  }

  // Copy event.metadata.json if present on NAS
  const nasMetadataPath    = path.join(params.eventPath, EVENT_METADATA_JSON);
  const localMetadataJson  = path.join(localEventPath, EVENT_METADATA_JSON);
  let copiedMetadataJson    = false;
  let metadataJsonConflict  = false;
  try {
    await fsp.access(nasMetadataPath);
    // NAS metadata exists — copy
    try {
      const result = await _copyFileIfNotConflict(nasMetadataPath, localMetadataJson);
      copiedMetadataJson   = result.copied;
      metadataJsonConflict = result.conflict;
    } catch (err) {
      // Non-fatal — log but don't fail the whole operation
      console.error('[localMirrorService] event.metadata.json copy failed:', err.message);
    }
  } catch { /* NAS metadata absent — nothing to copy */ }

  // Apply hidden attributes to internal files
  const filesToHide = [localEventJson];
  if (copiedMetadataJson) filesToHide.push(localMetadataJson);
  const hiddenResults = await Promise.all(filesToHide.map(_applyHidden));
  const hiddenApplied = hiddenResults.every(Boolean);

  return {
    ok: true,
    localCollectionPath,
    localEventPath,
    copiedEventJson,
    copiedMetadataJson,
    hiddenApplied,
    eventJsonConflict,
    metadataJsonConflict,
  };
}

/**
 * Check the current status of the local mirror for a given event.
 * Does not create or modify anything.
 *
 * @param {{ collectionName, eventName, eventPath, eventJsonPath }} params
 * @returns {Promise<{
 *   valid: boolean,
 *   reason?: string,
 *   exists?: boolean,
 *   localCollectionPath?: string,
 *   localEventPath?: string,
 *   eventJsonPresent?: boolean,
 *   eventJsonMatches?: boolean | null,
 *   metadataJsonPresent?: boolean,
 *   metadataJsonMatches?: boolean | null,
 * }>}
 */
async function getLocalMirrorStatus(params) {
  const check = _validateInput(params);
  if (!check.valid) return { valid: false, reason: check.reason };

  const stagingRoot = settings.getLocalStagingRoot();
  if (!stagingRoot) return { valid: false, reason: 'Local Staging Root is not configured' };

  let localCollectionPath, localEventPath;
  try {
    ({ localCollectionPath, localEventPath } = _resolveLocalPaths(
      stagingRoot, params.collectionName, params.eventName
    ));
  } catch (err) {
    return { valid: false, reason: err.message };
  }

  // Check folder existence
  let exists = false;
  try {
    const stat = await fsp.stat(localEventPath);
    exists = stat.isDirectory();
  } catch { /* not created yet */ }

  if (!exists) {
    return { valid: true, exists: false, localCollectionPath, localEventPath };
  }

  // Check event.json
  const localEventJson = path.join(localEventPath, EVENT_JSON);
  let eventJsonPresent = false;
  let eventJsonMatches = null;
  try {
    const localBuf = await fsp.readFile(localEventJson);
    eventJsonPresent = true;
    try {
      const nasBuf = await fsp.readFile(params.eventJsonPath);
      eventJsonMatches = localBuf.equals(nasBuf);
    } catch {
      eventJsonMatches = null; // NAS not reachable — cannot compare
    }
  } catch { /* local event.json absent */ }

  // Check event.metadata.json
  const localMetadataJson   = path.join(localEventPath, EVENT_METADATA_JSON);
  const nasMetadataPath     = path.join(params.eventPath, EVENT_METADATA_JSON);
  let metadataJsonPresent   = false;
  let metadataJsonMatches   = null;
  try {
    const localBuf = await fsp.readFile(localMetadataJson);
    metadataJsonPresent = true;
    try {
      const nasBuf = await fsp.readFile(nasMetadataPath);
      metadataJsonMatches = localBuf.equals(nasBuf);
    } catch {
      metadataJsonMatches = null;
    }
  } catch { /* local metadata absent */ }

  return {
    valid: true,
    exists: true,
    localCollectionPath,
    localEventPath,
    eventJsonPresent,
    eventJsonMatches,
    metadataJsonPresent,
    metadataJsonMatches,
  };
}

module.exports = { previewLocalMirror, ensureLocalMirror, getLocalMirrorStatus };
