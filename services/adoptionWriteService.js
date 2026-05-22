'use strict';

/**
 * adoptionWriteService.js — Phase 13C-7: Manual Folder Adoption Write.
 *
 * Validates and writes a minimal event.json into an existing manual folder,
 * converting it into an AutoIngest-managed event.
 *
 * Rules:
 *  - Called exclusively from the archive:adoptManualFolder IPC handler (main process).
 *  - Treats all renderer input as untrusted; re-validates every critical field from disk.
 *  - Writes only event.json (atomic tmp → rename). No other files are touched.
 *  - Never overwrites an existing event.json.
 *  - isValidEventJsonFn is injected from main.js to avoid a circular dependency.
 *  - The adoption.* block inside event.json is the audit record (contract Section F).
 */

const fsp  = require('fs').promises;
const path = require('path');
const { hidePathBestEffort } = require('./internalFileProtection');

const settings = require('./settings');
const {
  validateAdoptionInput,
  buildAdoptionEventJson,
} = require('./adoptionWriteContract');

// ── Constants (mirror adoptionDryRunService for consistency) ──────────────────

const FULL_RE = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,3})\s+([\s\S]+)$/;

const VALID_ROOT_TYPES = new Set(['activeArchiveRoot', 'mainArchiveRoot', 'transferRoot']);

const PROTECTED_NAMES = new Set([
  '_Selected', '.autoingest', '.autoingest-transfer', '__MACOSX',
]);

const KNOWN_EXTERNAL_NAMES = new Set([
  'To-Give', 'To Give', 'Department Exports', 'Exports',
  'External', 'Clients', 'Client Copies',
]);

const SKIP_DIRS   = new Set(['.autoingest', '.autoingest-transfer', '__MACOSX']);
const OUTPUT_DIRS = new Set(['_Selected', '_Metadata', '_Stills', '_Exports']);

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Adopt a manual folder by creating a minimal event.json.
 *
 * Called exclusively from the main-process IPC handler. All input is
 * treated as untrusted renderer data; every critical field is re-validated
 * from disk before the write proceeds.
 *
 * Validation sequence follows docs/archive-adoption-contract.md Section B.
 * The adoption audit record lives in the event.json `adoption` block (Section F).
 *
 * @param {object}      input              Renderer-supplied IPC payload (untrusted)
 * @param {function}    isValidEventJsonFn Injected from main.js — avoids circular dep
 * @param {object|null} activeUser         From userManager.getActiveUser()
 * @returns {Promise<{ok:boolean, data?:object, reason?:string, warnings?:string[]}>}
 */
async function adoptFolder(input, isValidEventJsonFn, activeUser) {
  const warnings = [];

  // ── Step 1: Basic type checks ─────────────────────────────────────────────
  if (!input || typeof input !== 'object')
    return { ok: false, reason: 'invalid-params' };

  const { folderPath, collectionPath, rootType, candidateId } = input;
  if (!folderPath     || typeof folderPath     !== 'string') return { ok: false, reason: 'invalid-params: folderPath' };
  if (!collectionPath || typeof collectionPath !== 'string') return { ok: false, reason: 'invalid-params: collectionPath' };
  if (!rootType       || typeof rootType       !== 'string') return { ok: false, reason: 'invalid-params: rootType' };

  // ── Step 2: Contract input validation ─────────────────────────────────────
  const contractCheck = validateAdoptionInput(input);
  if (!contractCheck.ok) return { ok: false, reason: contractCheck.reason };

  // ── Step 3: Root type recognised ──────────────────────────────────────────
  if (!VALID_ROOT_TYPES.has(rootType))
    return { ok: false, reason: `unknown-root-type: ${rootType}` };

  // ── Step 4: Path containment under a configured archive root ──────────────
  const normalizedFolder     = path.normalize(folderPath);
  const normalizedCollection = path.normalize(collectionPath);

  const configuredRoots = [
    settings.getNasRoot(),
    settings.getMainArchiveRoot(),
    settings.getTransferRoot(),
  ].filter(Boolean);

  if (configuredRoots.length === 0)
    return { ok: false, reason: 'no-configured-roots' };

  const underRoot = configuredRoots.some(root => {
    const nr = path.normalize(root);
    return normalizedFolder === nr || normalizedFolder.startsWith(nr + path.sep);
  });
  if (!underRoot)
    return { ok: false, reason: 'folder-outside-configured-roots' };

  // ── Step 5: Folder must exist and be a directory ──────────────────────────
  try {
    const stat = await fsp.stat(normalizedFolder);
    if (!stat.isDirectory())
      return { ok: false, reason: 'path-is-not-a-directory' };
  } catch (err) {
    return { ok: false, reason: `folder-not-accessible: ${err.code || err.message}` };
  }

  // ── Step 6: event.json must be absent ← CRITICAL ─────────────────────────
  const jsonPath = path.join(normalizedFolder, 'event.json');
  try {
    await fsp.access(jsonPath);
    return { ok: false, reason: 'event-json-already-exists' };  // present → block
  } catch (e) {
    if (e.code !== 'ENOENT')
      return { ok: false, reason: `event-json-check-failed: ${e.code}` };
    // ENOENT = absent = pass
  }

  // ── Step 7: Protected / known-external folder name ────────────────────────
  const folderName = path.basename(normalizedFolder);
  if (PROTECTED_NAMES.has(folderName))
    return { ok: false, reason: `protected-folder-name: ${folderName}` };
  if (KNOWN_EXTERNAL_NAMES.has(folderName))
    return { ok: false, reason: `known-external-folder-name: ${folderName}` };

  // ── Step 8: collectionPath must be the immediate parent ───────────────────
  if (path.normalize(path.dirname(normalizedFolder)) !== normalizedCollection)
    return { ok: false, reason: 'collection-path-not-parent-of-folder' };

  // ── Step 9: Parse folder name — FULL_RE required ─────────────────────────
  const match = FULL_RE.exec(folderName);
  if (!match)
    return { ok: false, reason: 'folder-name-not-parseable-as-autoingest-event' };

  const [, parsedHijriDate, parsedSeqStr] = match;
  const parsedSeqInt = parseInt(parsedSeqStr, 10);
  if (!Number.isInteger(parsedSeqInt) || parsedSeqInt < 1)
    return { ok: false, reason: `sequence-must-be-integer-gte-1: parsed "${parsedSeqStr}"` };

  // ── Step 10: Operator-confirmed sequence ──────────────────────────────────
  const c = input.operatorConfirmation;
  const confirmedSeq = typeof c.sequence === 'number'
    ? c.sequence
    : parseInt(String(c.sequence), 10);
  if (!Number.isInteger(confirmedSeq) || confirmedSeq < 1)
    return { ok: false, reason: 'operator-sequence-must-be-integer-gte-1' };

  // ── Step 11: Cross-checks — warn only, operator values are used ──────────
  if (c.hijriDate !== parsedHijriDate) {
    warnings.push(
      `Operator hijriDate (${c.hijriDate}) differs from folder-parsed value (${parsedHijriDate}) — using operator-confirmed value`
    );
  }
  if (confirmedSeq !== parsedSeqInt) {
    warnings.push(
      `Operator sequence (${confirmedSeq}) differs from folder-parsed value (${parsedSeqInt}) — using operator-confirmed value`
    );
  }

  // ── Step 12: Duplicate managed-event check ────────────────────────────────
  try {
    const siblings = await fsp.readdir(normalizedCollection, { withFileTypes: true });
    for (const entry of siblings) {
      if (!entry.isDirectory() || entry.name === folderName) continue;
      const em = FULL_RE.exec(entry.name);
      if (!em) continue;
      const [, eDate, eSeq] = em;
      if (eDate === c.hijriDate && parseInt(eSeq, 10) === confirmedSeq) {
        try {
          await fsp.access(path.join(normalizedCollection, entry.name, 'event.json'));
          return { ok: false, reason: `duplicate-managed-event: sibling "${entry.name}" already has event.json` };
        } catch (e2) {
          if (e2.code === 'ENOENT')
            warnings.push(`Sibling with same date+sequence found (unmanaged): ${entry.name}`);
        }
      }
    }
  } catch (err) {
    warnings.push(`Collection duplicate scan failed (proceeding): ${err.message}`);
  }

  // ── Step 13: Re-read child folder classification ──────────────────────────
  let photographerFolders = [];
  let hasSelectedFolder   = false;
  let externalFolders     = [];

  try {
    const children = await fsp.readdir(normalizedFolder, { withFileTypes: true });
    for (const child of children) {
      if (!child.isDirectory()) continue;
      if (child.name.startsWith('.')) continue;
      if (SKIP_DIRS.has(child.name)) continue;
      if (child.name === '_Selected') { hasSelectedFolder = true; continue; }
      if (OUTPUT_DIRS.has(child.name)) continue;
      if (child.name.startsWith('_')) { externalFolders.push(child.name); continue; }
      photographerFolders.push(child.name);
    }
  } catch (err) {
    warnings.push(`Child folder classification failed (proceeding with empty lists): ${err.message}`);
  }

  // ── Step 14: Build event.json payload ─────────────────────────────────────
  const payload = buildAdoptionEventJson({
    folderName,
    hijriDate:         c.hijriDate,
    sequence:          confirmedSeq,
    photographerFolders,
    hasSelectedFolder,
    externalFolders,
    candidateId:       candidateId  || null,
    operatorId:        activeUser?.id   || null,
    operatorName:      activeUser?.name || null,
    warnings:          warnings.slice(),
    manualReviewNotes: Array.isArray(c.manualReviewNotes) ? c.manualReviewNotes : [],
  });

  // ── Step 15: Validate payload ─────────────────────────────────────────────
  if (!isValidEventJsonFn(payload))
    return { ok: false, reason: 'built-payload-failed-isValidEventJson' };

  // ── Step 16: Atomic write — writeFile(tmp) → second access check → rename ─
  const tmpPath = jsonPath + '.tmp';

  try {
    await fsp.writeFile(tmpPath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    try { await fsp.unlink(tmpPath); } catch {}
    return { ok: false, reason: `write-tmp-failed: ${err.message}` };
  }

  // Second absence check immediately before rename (minimises TOCTOU window)
  try {
    await fsp.access(jsonPath);
    try { await fsp.unlink(tmpPath); } catch {}
    return { ok: false, reason: 'event-json-appeared' };
  } catch (e) {
    if (e.code !== 'ENOENT') {
      try { await fsp.unlink(tmpPath); } catch {}
      return { ok: false, reason: `pre-rename-check-failed: ${e.code}` };
    }
    // ENOENT = still absent = safe to rename
  }

  try {
    await fsp.rename(tmpPath, jsonPath);
    hidePathBestEffort(jsonPath).catch(() => {});
  } catch (err) {
    try { await fsp.unlink(tmpPath); } catch {}
    return { ok: false, reason: `rename-failed: ${err.message}` };
  }

  return { ok: true, data: payload, warnings };
}

module.exports = { adoptFolder };
