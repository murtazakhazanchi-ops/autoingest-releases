'use strict';

/**
 * eventEvidenceReconstruction.js — builds metadataExpectationService evidence for a
 * file that never passed through a renderer-built metadataGroups selection (Transfer
 * Import, resume staleness checks, archive-wide audit). Folder-structure convention:
 * photographer = the folder segment directly under the event (or component) root,
 * canonicalized via photographerSequenceService; component = whichever event.json
 * component's folder is a path-prefix of the file (multi-component events only).
 *
 * This is the same reconstruction main.js's Transfer Import verification
 * (_buildTransferVerificationContext) and metadataQueueRecovery.js's resume
 * staleness check independently implement — factored out here so the audit
 * scanner (Phase E) doesn't add a fourth copy. The other two call sites are
 * unchanged (already reviewed/shipped); only new code uses this module.
 */

const path = require('path');
const photographerSeqService = require('./photographerSequenceService');

function resolvePhotographerFromPath(filePath, baseDir, fallback) {
  const rel  = path.relative(baseDir, filePath);
  const parts = rel.split(path.sep);
  const seg  = parts.length > 1 ? parts[0] : '';
  return photographerSeqService.canonicalName(seg || fallback || '');
}

/**
 * @param {string} eventFolderPath Absolute path to the event's own folder (the
 *   directory containing event.json).
 * @param {object} eventJson Parsed event.json document.
 * @param {string} filePath Absolute path to the media file.
 * @returns {object} metadataExpectationService evidence (standard/diskComponents shape).
 */
function buildFileEvidence(eventFolderPath, eventJson, filePath) {
  const components = Array.isArray(eventJson?.components) ? eventJson.components : [];
  const isMulti = components.length > 1;
  const imports = Array.isArray(eventJson?.imports) ? eventJson.imports : [];
  const fallbackPhotographer = imports.length > 0 ? (imports[imports.length - 1].photographer || '') : '';

  let component = null;
  let photographer;
  if (!isMulti) {
    photographer = resolvePhotographerFromPath(filePath, eventFolderPath, fallbackPhotographer);
  } else {
    component = components.find(c => c.folderName
      && filePath.startsWith(path.join(eventFolderPath, c.folderName) + path.sep)) || null;
    photographer = component
      ? resolvePhotographerFromPath(filePath, path.join(eventFolderPath, component.folderName), fallbackPhotographer)
      : fallbackPhotographer;
  }

  // Multi-component with no resolvable component: no group entry at all (not a
  // 'root'-shaped fallback) — the resolver's tier-3 evidence match requires a group
  // whose subEventId names a real component folder; an empty groups array correctly
  // yields status:'ambiguous' (component-unresolved-multi-event) instead of silently
  // treating an unattributable multi-component file as if it belonged to a single root.
  const groups = isMulti
    ? (component ? [{ id: component.folderName, subEventId: component.folderName, files: [filePath] }] : [])
    : [{ id: 'root', subEventId: null, files: [filePath] }];

  return {
    filePath, photographer,
    hijriDate: eventJson?.hijriDate || null,
    eventDescription: eventJson?.eventName || null,
    groups, diskComponents: components,
  };
}

module.exports = { buildFileEvidence, resolvePhotographerFromPath };
