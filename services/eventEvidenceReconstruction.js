'use strict';

/**
 * eventEvidenceReconstruction.js — the ONE place that rebuilds metadataExpectationService
 * evidence from archive-side state (event.json + folder structure), for every workflow that
 * runs after the original import: Audit, Repair, restart-resume staleness checks, Reapply and
 * Transfer verification. None of them carry their own refinement or MetaPicker logic.
 *
 * Folder-structure convention: photographer = the folder segment directly under the event
 * (or component) root, canonicalized via photographerSequenceService; component = whichever
 * event.json component's folder is a path-prefix of the file (multi-component events only).
 *
 * Durable operator intent is read from event.json through eventMetadataIntent:
 *   tagRefinements  → group.fileTagRefinements   (Tier 0)
 *   metadataGroups  → group.metadataTags         (Tier 1, legacy MetaPicker)
 * keyed by the file's DESTINATION-relative path. Precedence is decided by the resolver alone;
 * this module only supplies evidence. A file with NO record gets NO extra evidence keys, so
 * events without intent produce exactly the evidence they always did. A malformed or
 * conflicting record sets group.intentIntegrityError so the resolver fails closed (ambiguous)
 * instead of guessing Default.
 */

const path = require('path');
const photographerSeqService = require('./photographerSequenceService');
const intentModule = require('./eventMetadataIntent');
const RefinableTags = require('../renderer/refinableTags');

/** Advisory diagnostic: a persisted refinement names a tag the component no longer offers. */
const LABEL_DRIFT = 'tagRefinements:label-not-in-component';
/**
 * Advisory diagnostic: a file sits directly inside a QMZ sequence/holding container
 * (e.g. ".../01Q/photo.jpg") with no photographer sub-folder beneath it — there is no
 * reliable photographer to resolve. Never guessed as the container's own name (that is
 * exactly the "Creator becomes a QMZ sequence code" bug class) — flagged instead so
 * Audit/Repair surface the gap for a human to resolve.
 */
const PHOTOGRAPHER_UNRESOLVED_QMZ = 'photographer:qmz-container-unresolved';

/**
 * @returns {{ photographer: string, unresolved: boolean }} `unresolved` is true only for
 *   the PHOTOGRAPHER_UNRESOLVED_QMZ case above — callers must not write `photographer` as
 *   Creator/Artist/By-line when `unresolved` is true (it is always '' in that case; writing
 *   it would clear existing attribution instead of preserving it).
 */
function resolvePhotographerFromPath(filePath, baseDir, fallback) {
  const rel   = path.relative(baseDir, filePath);
  const parts = rel.split(path.sep);
  if (parts.length < 2) {
    return { photographer: photographerSeqService.canonicalName(fallback || ''), unresolved: false };
  }

  let seg = parts[0];
  // The first folder below the event/component root is a QMZ sequence container (or
  // _Unsequenced/Enroute) — never a photographer. The real photographer, if any, is one
  // level deeper. See photographerSequenceService.isQmzContainerName for the full set of
  // recognized names/patterns this guards against.
  if (photographerSeqService.isQmzContainerName(seg)) {
    if (parts.length < 3) {
      return { photographer: '', unresolved: true };
    }
    seg = parts[1];
  }
  return { photographer: photographerSeqService.canonicalName(seg || fallback || ''), unresolved: false };
}

/** Event-level facts every file shares (independent of any particular file). */
function _eventBasics(eventJson) {
  const components = Array.isArray(eventJson?.components) ? eventJson.components : [];
  const imports = Array.isArray(eventJson?.imports) ? eventJson.imports : [];
  return {
    components,
    isMulti: components.length > 1,
    fallbackPhotographer: imports.length > 0 ? (imports[imports.length - 1].photographer || '') : '',
  };
}

/** Shared by both builders: which component a file belongs to and who photographed it. */
function _locate(eventFolderPath, eventJson, filePath) {
  const { components, isMulti, fallbackPhotographer } = _eventBasics(eventJson);

  let component = null;
  let resolved;
  if (!isMulti) {
    resolved = resolvePhotographerFromPath(filePath, eventFolderPath, fallbackPhotographer);
  } else {
    component = components.find(c => c.folderName
      && filePath.startsWith(path.join(eventFolderPath, c.folderName) + path.sep)) || null;
    resolved = component
      ? resolvePhotographerFromPath(filePath, path.join(eventFolderPath, component.folderName), fallbackPhotographer)
      : { photographer: fallbackPhotographer, unresolved: false };
  }
  return {
    components, isMulti, component,
    photographer: resolved.photographer,
    photographerUnresolved: resolved.unresolved,
    fallbackPhotographer,
  };
}

/**
 * The evidence this file's durable intent contributes. Presence is decided ONLY by
 * `!== undefined` (never truthiness) so an explicit-empty record stays a record.
 * @returns {{ fields: object, diagnostics: string[], key: string|null }}
 */
function _intentFor(intent, eventFolderPath, destPath, srcForLookup, diskComponent) {
  const key = intentModule.fileRelKey(eventFolderPath, destPath);
  const fields = {};
  const diagnostics = [];

  const integrity = intentModule.integrityErrorFor(intent, key);
  if (integrity) fields.intentIntegrityError = integrity;

  if (key !== null) {
    const ref = intent.refinements.get(key);
    if (ref !== undefined) {
      fields.fileTagRefinements = { [path.normalize(srcForLookup)]: { eventTypes: [...ref.eventTypes], additionalKeywords: [...ref.additionalKeywords] } };
      if (diskComponent) {
        const avail = RefinableTags.availableTags(diskComponent);
        const has = (list, l) => list.includes(l) || list.includes(l.trim());
        const drifted = ref.eventTypes.some(l => !has(avail.eventTypes, l)) || ref.additionalKeywords.some(l => !has(avail.additionalKeywords, l));
        if (drifted) diagnostics.push(LABEL_DRIFT);
      }
    }
    const tags = intent.metaTags.get(key);
    if (tags !== undefined) fields.metadataTags = [...tags];
  }
  return { fields, diagnostics, key };
}

/**
 * @param {string} eventFolderPath Absolute path to the event's own folder (the
 *   directory containing event.json).
 * @param {object} eventJson Parsed event.json document.
 * @param {string} filePath Absolute path to the media file.
 * @returns {object} metadataExpectationService evidence (standard/diskComponents shape).
 */
function buildFileEvidence(eventFolderPath, eventJson, filePath) {
  const { components, isMulti, component, photographer, photographerUnresolved } = _locate(eventFolderPath, eventJson, filePath);

  // Multi-component with no resolvable component: no group entry at all (not a
  // 'root'-shaped fallback) — the resolver's tier-3 evidence match requires a group
  // whose subEventId names a real component folder; an empty groups array correctly
  // yields status:'ambiguous' (component-unresolved-multi-event) instead of silently
  // treating an unattributable multi-component file as if it belonged to a single root.
  const group = isMulti
    ? (component ? { id: component.folderName, subEventId: component.folderName, files: [filePath] } : null)
    : { id: 'root', subEventId: null, files: [filePath] };

  const evidence = {
    filePath, photographer, photographerUnresolved,
    hijriDate: eventJson?.hijriDate || null,
    eventDescription: eventJson?.eventName || null,
    groups: group ? [group] : [], diskComponents: components,
  };

  const diagnostics = photographerUnresolved ? [PHOTOGRAPHER_UNRESOLVED_QMZ] : [];
  if (group) {
    const intent = intentModule.getIntent(eventJson);             // built once per event document
    const { fields, diagnostics: intentDiagnostics } = _intentFor(intent, eventFolderPath, filePath, filePath, isMulti ? component : components[0]);
    Object.assign(group, fields);
    diagnostics.push(...intentDiagnostics);
  }
  if (diagnostics.length) evidence.intentDiagnostics = diagnostics;
  return evidence;
}

/**
 * Event-wide evidence CONTEXT (the shape exifService.applyBatch / metadataVerificationService
 * consume) for workflows that process many files at once: Reapply and Transfer verification.
 * Built from the very same per-file rules as buildFileEvidence — groups are only a compaction
 * of files that share (component, Tier-1 tags, integrity state) — so both paths resolve every
 * file identically (asserted by the parity tests).
 *
 * @param {string} eventFolderPath
 * @param {object} eventJson
 * @param {Array<{src?:string, dest:string}>} files
 * @returns {{ context: object, files: object[] }} files are copies carrying `photographer`.
 */
function buildEventEvidenceContext(eventFolderPath, eventJson, files) {
  const intent = intentModule.getIntent(eventJson);
  const { components, fallbackPhotographer } = _eventBasics(eventJson);
  const groupsByKey = new Map();
  const outFiles = [];
  let seq = 0;

  for (const f of files) {
    const loc = _locate(eventFolderPath, eventJson, f.dest);
    outFiles.push({ ...f, photographer: loc.photographer, photographerUnresolved: loc.photographerUnresolved });

    if (loc.isMulti && !loc.component) continue;                    // unresolvable: no group ⇒ resolver returns ambiguous
    const matchPath = f.src || f.dest;
    const { fields } = _intentFor(intent, eventFolderPath, f.dest, matchPath, loc.isMulti ? loc.component : loc.components[0]);

    const subEventId = loc.isMulti ? loc.component.folderName : null;
    const tagsKey = fields.metadataTags === undefined ? 'none' : JSON.stringify(fields.metadataTags);
    const gk = `${subEventId ?? ''}\u0000${tagsKey}\u0000${fields.intentIntegrityError ?? ''}`;
    let g = groupsByKey.get(gk);
    if (!g) {
      g = { id: subEventId ?? (tagsKey === 'none' && !fields.intentIntegrityError ? 'root' : `intent-${seq}`), subEventId, files: [] };
      seq++;
      if (fields.metadataTags !== undefined) g.metadataTags = fields.metadataTags;
      if (fields.intentIntegrityError) g.intentIntegrityError = fields.intentIntegrityError;
      groupsByKey.set(gk, g);
    }
    g.files.push(matchPath);
    if (fields.fileTagRefinements) g.fileTagRefinements = { ...(g.fileTagRefinements || {}), ...fields.fileTagRefinements };
  }

  return {
    context: {
      photographer: fallbackPhotographer,
      hijriDate: eventJson?.hijriDate || null,
      eventDescription: eventJson?.eventName || null,
      groups: [...groupsByKey.values()],
      diskComponents: components,
      eventJsonPath: path.join(eventFolderPath, 'event.json'),
    },
    files: outFiles,
  };
}

module.exports = {
  buildFileEvidence, buildEventEvidenceContext, resolvePhotographerFromPath,
  LABEL_DRIFT, PHOTOGRAPHER_UNRESOLVED_QMZ,
};
