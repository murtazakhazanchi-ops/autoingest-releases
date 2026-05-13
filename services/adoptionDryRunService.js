'use strict';

/**
 * adoptionDryRunService.js — Read-only dry-run validation for adoption candidates.
 *
 * Phase 13C-5: Simulates the pre-adoption checks required before writing event.json.
 * Does not write, rename, move, copy, or delete any files.
 *
 * Rules:
 *  - Strictly read-only. fsp.stat / fsp.access / fsp.readdir only.
 *  - Main process validates path containment — renderer paths are not trusted.
 *  - Re-reads folder from disk; does not rely on cached renderer data.
 *  - Run only on explicit user request.
 */

const fsp  = require('fs').promises;
const path = require('path');

const SKIP_DIRS   = new Set(['.autoingest', '.autoingest-transfer', '__MACOSX']);
const OUTPUT_DIRS = new Set(['_Selected', '_Metadata', '_Stills', '_Exports']);

const KNOWN_EXTERNAL_NAMES = new Set([
  'To-Give', 'To Give', 'Department Exports', 'Exports',
  'External', 'Clients', 'Client Copies',
]);

const FULL_RE    = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,3})\s+([\s\S]+)$/;
const PARTIAL_RE = /^(\d{4}-\d{2}-\d{2})\s+([\s\S]+)$/;

const VALID_ROOT_TYPES = new Set(['activeArchiveRoot', 'mainArchiveRoot', 'transferRoot']);

const NO_CHANGE_GUARANTEES = [
  'No files will be moved or copied',
  'No folders will be renamed',
  'No media will be modified',
  'No event.json will be written in this dry-run',
  'No metadata will be applied',
];

// ── Main entry point ──────────────────────────────────────────────────────────

async function runAdoptionDryRun({ folderPath, collectionPath, rootType, candidateId } = {}) {
  if (!folderPath     || typeof folderPath     !== 'string') return { ok: false, reason: 'invalid-params' };
  if (!collectionPath || typeof collectionPath !== 'string') return { ok: false, reason: 'invalid-params' };

  const checks             = [];
  const blockers           = [];
  const warnings           = [];
  const manualReviewFields = [];
  const generatedAt        = new Date().toISOString();

  function addCheck(name, status, message) {
    checks.push({ name, status, message });
    if (status === 'fail')    blockers.push(message);
    if (status === 'warning') warnings.push(message);
  }

  const normalizedFolder     = path.normalize(folderPath);
  const normalizedCollection = path.normalize(collectionPath);

  // ── A. Candidate identity ──────────────────────────────────────────────────

  // A1. Root type valid
  if (VALID_ROOT_TYPES.has(rootType)) {
    addCheck('Root type', 'pass', `Root type '${rootType}' is recognised`);
  } else {
    addCheck('Root type', 'fail', `Unknown root type: '${rootType || '(none)'}'`);
  }

  // A2. Path containment under configured roots
  const settings = require('./settings');
  const nas  = settings.getNasRoot();
  const main = settings.getMainArchiveRoot();
  const tx   = settings.getTransferRoot();
  const configuredRoots = [nas, main, tx].filter(Boolean);

  const underRoot = configuredRoots.some(root => {
    const nr = path.normalize(root);
    return normalizedFolder === nr || normalizedFolder.startsWith(nr + path.sep);
  });

  if (configuredRoots.length === 0) {
    addCheck('Path containment', 'fail', 'No archive roots configured — cannot validate path safety');
  } else if (underRoot) {
    addCheck('Path containment', 'pass', 'Folder path is inside a configured archive root');
  } else {
    addCheck('Path containment', 'fail', 'Folder path is outside all configured archive roots');
  }

  // A3. Folder still exists
  let folderExists = false;
  try {
    const stat = await fsp.stat(normalizedFolder);
    if (stat.isDirectory()) {
      folderExists = true;
      addCheck('Folder exists', 'pass', 'Folder is accessible on disk');
    } else {
      addCheck('Folder exists', 'fail', 'Path exists but is not a directory');
    }
  } catch {
    addCheck('Folder exists', 'fail', 'Folder not found or not accessible');
  }

  // A4. No event.json (still unmanaged)
  if (folderExists) {
    try {
      await fsp.access(path.join(normalizedFolder, 'event.json'));
      addCheck('No event.json', 'fail', 'event.json already exists — folder is already AutoIngest-managed');
    } catch (e) {
      if (e.code === 'ENOENT') {
        addCheck('No event.json', 'pass', 'event.json absent — folder is not yet AutoIngest-managed');
      } else {
        addCheck('No event.json', 'warning', 'Could not confirm event.json absence — permission error');
      }
    }
  } else {
    addCheck('No event.json', 'skip', 'Skipped — folder not accessible');
  }

  // ── B. Folder name parse readiness ────────────────────────────────────────

  const folderName   = path.basename(normalizedFolder);
  let parsedHijriDate = null;
  let parsedSequence  = null;
  let parsedTokens    = [];
  let parseLevel      = 'none';

  const mFull = FULL_RE.exec(folderName);
  if (mFull) {
    const [, hDate, seq, rest] = mFull;
    parsedHijriDate = hDate;
    parsedSequence  = seq.padStart(2, '0');
    parsedTokens    = rest.trim().split(/\s+/).filter(Boolean);
    parseLevel      = 'full';
    addCheck('Folder name format', 'pass', 'Matches full AutoIngest format (YYYY-MM-DD SEQ name)');
  } else {
    const mPart = PARTIAL_RE.exec(folderName);
    if (mPart) {
      const [, hDate, rest] = mPart;
      parsedHijriDate = hDate;
      parsedTokens    = rest.trim().split(/\s+/).filter(Boolean);
      parseLevel      = 'partial';
      addCheck('Folder name format', 'warning', 'Has a Hijri date but no sequence number');
    } else {
      addCheck('Folder name format', 'fail', 'Cannot be parsed as an AutoIngest event folder');
    }
  }

  // B2. Sequence check
  if (parsedSequence !== null) {
    if (parsedSequence === '00') {
      addCheck('Sequence number', 'warning',
        'Sequence 00 typically indicates a highlights or compilation folder — manual review required');
    } else {
      addCheck('Sequence number', 'pass', `Sequence: ${parsedSequence}`);
    }
  } else if (parseLevel === 'partial') {
    addCheck('Sequence number', 'warning', 'No sequence number in folder name — must be assigned before adoption');
    manualReviewFields.push({ field: 'Sequence number', note: 'Not present in folder name — must be assigned' });
  } else if (parseLevel === 'none') {
    addCheck('Sequence number', 'skip', 'Skipped — folder name not parseable');
  }

  // B3. Event tokens
  if (parseLevel !== 'none') {
    if (parsedTokens.length > 0) {
      addCheck('Event name tokens', 'pass', `Tokens: ${parsedTokens.join(' ')}`);
    } else {
      addCheck('Event name tokens', 'warning', 'No event name tokens in folder name');
      manualReviewFields.push({ field: 'Event name / type', note: 'No name tokens detected — must be provided' });
    }
  }

  // B4. Known external name check
  if (KNOWN_EXTERNAL_NAMES.has(folderName)) {
    addCheck('Folder name pattern', 'fail',
      `Folder name '${folderName}' matches a known external or non-event folder pattern`);
  } else if (parseLevel !== 'none') {
    addCheck('Folder name pattern', 'pass', 'Folder name does not match any known external pattern');
  } else {
    addCheck('Folder name pattern', 'skip', 'Skipped — folder name not in AutoIngest format');
  }

  // ── C. Event schema readiness ─────────────────────────────────────────────

  const collectionName = path.basename(normalizedCollection);
  if (collectionName) {
    addCheck('Collection name', 'pass', `Collection: ${collectionName}`);
  } else {
    addCheck('Collection name', 'fail', 'Could not determine collection name from collection path');
  }

  if (parsedHijriDate) {
    addCheck('Hijri date', 'pass', `Hijri date: ${parsedHijriDate}`);
  } else {
    addCheck('Hijri date', 'fail', 'Hijri date not parseable from folder name');
    manualReviewFields.push({ field: 'Hijri date', note: 'Not detected — must be provided manually' });
  }

  if (!parsedSequence && parseLevel !== 'none') {
    manualReviewFields.push({ field: 'Sequence', note: 'Not detected — must be provided before event.json creation' });
  }

  // ── D. Child folder classification ────────────────────────────────────────

  let photographerFolders = [];
  let hasSelectedFolder   = false;
  let externalFolders     = [];
  let outputFolders       = [];

  if (folderExists) {
    try {
      const children = await fsp.readdir(normalizedFolder, { withFileTypes: true });

      for (const child of children) {
        if (!child.isDirectory()) continue;
        if (child.name.startsWith('.')) continue;
        if (SKIP_DIRS.has(child.name)) continue;
        if (child.name === '_Selected') { hasSelectedFolder = true; continue; }
        if (OUTPUT_DIRS.has(child.name)) { outputFolders.push(child.name); continue; }
        if (child.name.startsWith('_')) { externalFolders.push(child.name); continue; }
        photographerFolders.push(child.name);
      }

      const parts = [];
      if (photographerFolders.length) parts.push(`${photographerFolders.length} content folder(s)`);
      if (hasSelectedFolder) parts.push('_Selected (output)');
      if (externalFolders.length) parts.push(`${externalFolders.length} external folder(s)`);

      if (parts.length > 0) {
        addCheck('Child folder classification', 'pass', `Classified: ${parts.join(', ')}`);
      } else {
        addCheck('Child folder classification', 'warning',
          'No content subfolders or _Selected found — folder may be empty');
      }

      addCheck('_Selected treatment', hasSelectedFolder ? 'pass' : 'pass',
        hasSelectedFolder
          ? '_Selected present — classified as output, not photographer content'
          : '_Selected not present');

      if (externalFolders.length > 0) {
        addCheck('External folders', 'pass',
          `${externalFolders.length} external/manual folder(s) will be preserved: ${externalFolders.join(', ')}`);
      }

    } catch {
      addCheck('Child folder classification', 'warning', 'Could not read folder contents');
    }
  } else {
    addCheck('Child folder classification', 'skip', 'Skipped — folder not accessible');
    addCheck('_Selected treatment', 'skip', 'Skipped — folder not accessible');
  }

  // ── E. Duplicate / conflict risk ─────────────────────────────────────────

  if (parseLevel === 'full' && parsedHijriDate && parsedSequence) {
    try {
      const collEntries = await fsp.readdir(normalizedCollection, { withFileTypes: true });
      const conflicts   = [];
      for (const entry of collEntries) {
        if (!entry.isDirectory() || entry.name === folderName) continue;
        const em = FULL_RE.exec(entry.name);
        if (!em) continue;
        const [, eDate, eSeq] = em;
        if (eDate === parsedHijriDate && eSeq.padStart(2, '0') === parsedSequence) {
          conflicts.push(entry.name);
        }
      }
      if (conflicts.length === 0) {
        addCheck('Duplicate risk', 'pass',
          'No sibling folders share the same date and sequence number');
      } else {
        addCheck('Duplicate risk', 'warning',
          `${conflicts.length} sibling folder${conflicts.length !== 1 ? 's' : ''} share ` +
          `the same date+sequence (${parsedHijriDate} ${parsedSequence}): ${conflicts.join(', ')}`);
      }
    } catch {
      addCheck('Duplicate risk', 'warning', 'Could not scan collection for duplicates');
    }
  } else {
    addCheck('Duplicate risk', 'skip',
      parseLevel === 'full'
        ? 'Skipped — sequence or date not parseable'
        : 'Skipped — folder name not in full AutoIngest format');
  }

  // ── Verdict ───────────────────────────────────────────────────────────────

  const hasFail = checks.some(c => c.status === 'fail');
  const hasWarn = checks.some(c => c.status === 'warning');
  const readiness = hasFail ? 'blocked'
                  : hasWarn ? 'needs-review'
                  : 'adoption-possible';

  return {
    ok:                    true,
    candidateId:           candidateId || null,
    okForFutureAdoption:   readiness === 'adoption-possible',
    readiness,
    blockers,
    warnings,
    manualReviewFields,
    proposedEventJsonOutline: {
      collectionName:     collectionName || null,
      eventFolderName:    folderName,
      hijriDate:          parsedHijriDate,
      sequence:           parsedSequence,
      componentsPreview:  parsedTokens.length > 0 ? parsedTokens.join(' ') : null,
      photographerFolders,
      hasSelectedFolder,
      externalFolders,
      outputFolders,
    },
    checks,
    noChangeGuarantees: NO_CHANGE_GUARANTEES,
    generatedAt,
  };
}

module.exports = { runAdoptionDryRun };
