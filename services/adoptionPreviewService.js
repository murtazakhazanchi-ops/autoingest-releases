'use strict';

/**
 * adoptionPreviewService.js — Read-only adoption preview for manual/external folders.
 *
 * Phase 13C-1: Detects event-like folders without event.json and classifies
 * them as adoption candidates.
 *
 * Rules:
 *  - Strictly read-only. No file is created, modified, renamed, or deleted.
 *  - Scan depth: root → collection → event-like folder → immediate children only.
 *  - _Selected is a valid output folder — excluded from photographerFolders.
 *  - Folders WITH event.json are skipped (already AutoIngest-managed).
 *  - Results are capped at MAX_ITEMS.
 *  - One scan may run at a time. Concurrent calls return { ok: false, reason: 'busy' }.
 *  - Run only on user request, never at startup.
 */

const fsp    = require('fs').promises;
const path   = require('path');
const crypto = require('crypto');

const MAX_ITEMS              = 200;
const MAX_PHOTOGRAPHER_FOLDERS = 20;

const SKIP_DIRS   = new Set(['.autoingest', '.autoingest-transfer', '__MACOSX']);
const OUTPUT_DIRS = new Set(['_Selected', '_Metadata', '_Stills', '_Exports']);

// Folder names that indicate known external/non-event directories
const KNOWN_EXTERNAL_NAMES = new Set([
  'To-Give', 'To Give', 'Department Exports', 'Exports',
  'External', 'Clients', 'Client Copies',
]);

// Full AutoIngest folder name: YYYY-MM-DD SEQ rest  (SEQ is 1–3 digits)
const FULL_RE    = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,3})\s+([\s\S]+)$/;
// Partial: YYYY-MM-DD rest (no numeric sequence immediately follows date)
const PARTIAL_RE = /^(\d{4}-\d{2}-\d{2})\s+([\s\S]+)$/;

// ── Module-scope state (single-active run) ────────────────────────────────────

let _state = {
  running:     false,
  jobId:       null,
  startedAt:   null,
  completedAt: null,
  items:       [],
  truncated:   false,
  result:      null,
};

let _itemSeq = 0;

// ── Folder name parser ────────────────────────────────────────────────────────

function _parseFolderName(name) {
  let m = FULL_RE.exec(name);
  if (m) {
    const [, hijriDate, seq, rest] = m;
    return {
      hijriDate,
      sequence:    seq.padStart(2, '0'),
      eventTokens: rest.trim().split(/\s+/).filter(Boolean),
      parseLevel:  'full',
    };
  }
  m = PARTIAL_RE.exec(name);
  if (m) {
    const [, hijriDate, rest] = m;
    return {
      hijriDate,
      sequence:    null,
      eventTokens: rest.trim().split(/\s+/).filter(Boolean),
      parseLevel:  'partial',
    };
  }
  return {
    hijriDate:   null,
    sequence:    null,
    eventTokens: name.trim().split(/\s+/).filter(Boolean),
    parseLevel:  'none',
  };
}

// ── Folder inspection ──────────────────────────────────────────────────────────

async function _inspectFolder(collPath, collName, evName, rootType) {
  const evPath = path.join(collPath, evName);

  // Skip if event.json present — already AutoIngest-managed
  try {
    await fsp.access(path.join(evPath, 'event.json'));
    return null;
  } catch (e) {
    if (e.code !== 'ENOENT') return null;
  }

  // Read immediate children only (no recursion)
  let children;
  try {
    children = await fsp.readdir(evPath, { withFileTypes: true });
  } catch {
    return null;
  }

  const photographerFolders = [];
  let hasSelectedFolder     = false;

  for (const child of children) {
    if (!child.isDirectory()) continue;
    if (child.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(child.name)) continue;
    if (child.name === '_Selected') { hasSelectedFolder = true; continue; }
    if (OUTPUT_DIRS.has(child.name)) continue;
    // Non-underscore, non-dot, non-output directories are photographer/component candidates
    if (!child.name.startsWith('_') && photographerFolders.length < MAX_PHOTOGRAPHER_FOLDERS) {
      photographerFolders.push(child.name);
    }
  }

  const parsed   = _parseFolderName(evName);
  const blockers = [];
  const warnings = [];
  const reasons  = [];
  let readiness, category;

  // Check for known external/non-event folder names
  if (KNOWN_EXTERNAL_NAMES.has(evName)) {
    blockers.push('Folder name matches a known external or non-event folder pattern');
  }

  if (parsed.parseLevel === 'full') {
    category = 'adoption-candidate';
    reasons.push('Folder name matches AutoIngest date + sequence format');

    if (blockers.length > 0) {
      readiness = 'blocked';
    } else if (parsed.sequence === '00') {
      readiness = 'needs-manual-review';
      warnings.push('Sequence 00 may indicate a highlights or compilation folder — manual review required');
      reasons.push('Sequence 00 detected — highlights-style folder');
    } else if (photographerFolders.length > 0) {
      readiness = 'ready-to-adopt-later';
      reasons.push(`${photographerFolders.length} content subfolder${photographerFolders.length !== 1 ? 's' : ''} detected`);
    } else if (hasSelectedFolder) {
      readiness = 'ready-to-adopt-later';
      reasons.push('_Selected output folder present');
      warnings.push('No photographer folders found — only _Selected present; verify content structure before adoption');
    } else {
      readiness = 'needs-manual-review';
      warnings.push('No content subfolders or _Selected folder found — folder may be empty');
      reasons.push('No content subfolders — manual inspection recommended');
    }
  } else if (parsed.parseLevel === 'partial') {
    category  = 'legacy-event-folder';
    readiness = blockers.length > 0 ? 'blocked' : 'needs-manual-review';
    reasons.push('Folder has Hijri date but no sequence number');
    warnings.push('No sequence number — must be assigned before adoption');
    if (photographerFolders.length > 0) {
      reasons.push(`${photographerFolders.length} content subfolder${photographerFolders.length !== 1 ? 's' : ''} detected`);
    }
  } else {
    category = 'manual-folder';
    if (!blockers.length) {
      blockers.push('Folder name cannot be parsed as an AutoIngest event folder');
    }
    readiness = 'blocked';
    reasons.push('No recognizable Hijri date or sequence in folder name');
  }

  _itemSeq++;
  return {
    id:             `adopt-${String(_itemSeq).padStart(4, '0')}`,
    rootType,
    collectionName: collName,
    collectionPath: collPath,
    folderName:     evName,
    folderPath:     evPath,
    inferred: {
      hijriDate:          parsed.hijriDate,
      sequence:           parsed.sequence,
      eventTokens:        parsed.eventTokens,
      city:               null,
      location:           null,
      photographerFolders,
      hasSelectedFolder,
    },
    readiness,
    category,
    blockers,
    warnings,
    reasons,
    recommendedAction: readiness === 'blocked'
      ? 'Folder cannot be adopted — see blockers for details'
      : readiness === 'ready-to-adopt-later'
      ? 'Ready for adoption review — content structure looks correct'
      : 'Manual review required before adoption',
  };
}

// ── Root scan ─────────────────────────────────────────────────────────────────

async function _scanRoot(rootPath, rootType, items) {
  let colls;
  try {
    colls = await fsp.readdir(rootPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const coll of colls) {
    if (!coll.isDirectory()) continue;
    if (SKIP_DIRS.has(coll.name) || coll.name.startsWith('.')) continue;

    const collPath = path.join(rootPath, coll.name);
    let evEntries;
    try { evEntries = await fsp.readdir(collPath, { withFileTypes: true }); }
    catch { continue; }

    for (const ev of evEntries) {
      if (!ev.isDirectory()) continue;
      if (SKIP_DIRS.has(ev.name) || ev.name.startsWith('.')) continue;
      if (ev.name === '_Selected') continue;
      if (items.length >= MAX_ITEMS) return;

      const item = await _inspectFolder(collPath, coll.name, ev.name, rootType);
      if (item) items.push(item);
    }
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

async function _doPreview(scope) {
  _itemSeq = 0;
  const settings = require('./settings');
  const items    = [];

  const nas  = settings.getNasRoot();
  const main = settings.getMainArchiveRoot();
  const tx   = settings.getTransferRoot();

  const all = !scope || scope === 'allConfiguredRoots';

  if ((all || scope === 'activeArchiveRoot') && nas) {
    try { await _scanRoot(nas,  'activeArchiveRoot', items); } catch {}
  }
  if ((all || scope === 'mainArchiveRoot') && main && main !== nas) {
    try { await _scanRoot(main, 'mainArchiveRoot',   items); } catch {}
  }
  if ((all || scope === 'transferRoot') && tx) {
    try { await _scanRoot(tx,   'transferRoot',      items); } catch {}
  }

  _state.running     = false;
  _state.completedAt = new Date().toISOString();
  _state.items       = items;
  _state.truncated   = items.length >= MAX_ITEMS;
  _state.result      = { total: items.length, truncated: _state.truncated };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Start a read-only adoption preview scan in the background.
 * @param {string} [scope]  'allConfiguredRoots' | 'activeArchiveRoot' | 'mainArchiveRoot' | 'transferRoot'
 * @returns {Promise<{ ok: boolean, jobId?: string, reason?: string }>}
 */
async function runAdoptionPreview(scope = 'allConfiguredRoots') {
  if (_state.running) return { ok: false, reason: 'busy' };

  const jobId = crypto.randomBytes(6).toString('hex');
  _state = {
    running:     true,
    jobId,
    startedAt:   new Date().toISOString(),
    completedAt: null,
    items:       [],
    truncated:   false,
    result:      null,
  };

  _doPreview(scope).catch(e => {
    _state.running     = false;
    _state.completedAt = new Date().toISOString();
    _state.result      = { ok: false, error: e.message };
  });

  return { ok: true, jobId };
}

/**
 * Lightweight status snapshot — safe for frequent polling.
 * @returns {object}
 */
function getAdoptionPreviewStatus() {
  return {
    running:     _state.running,
    jobId:       _state.jobId,
    startedAt:   _state.startedAt,
    completedAt: _state.completedAt,
    result:      _state.result,
    itemCount:   _state.items.length,
    truncated:   _state.truncated,
  };
}

/**
 * Full report — call after getAdoptionPreviewStatus shows running:false.
 * @returns {{ items: object[], truncated: boolean, generatedAt: string|null }}
 */
function getAdoptionPreviewReport() {
  return {
    items:       _state.items,
    truncated:   _state.truncated,
    generatedAt: _state.completedAt,
  };
}

module.exports = { runAdoptionPreview, getAdoptionPreviewStatus, getAdoptionPreviewReport };
