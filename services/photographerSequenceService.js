'use strict';
const fsp  = require('fs').promises;
const path = require('path');

const { hidePathBestEffort } = require('./internalFileProtection');
const localSyncManifest      = require('./localSyncManifest');

// PC prefix pattern: PC01- … PC999-
const PC_PREFIX_RE = /^PC(\d{2,3})-/;

// Scope key used when photographer folders live directly under the event root
// (single-component events only).
const EVENT_ROOT_KEY = '__eventRoot__';

/**
 * Strip the PCxx- prefix and return the canonical photographer name.
 * "PC01-M Murtaza Khazanchi" → "M Murtaza Khazanchi"
 * "M Murtaza Khazanchi"     → "M Murtaza Khazanchi" (no-op)
 * @param {string} name
 * @returns {string}
 */
function canonicalName(name) {
  return (name || '').replace(PC_PREFIX_RE, '');
}

/**
 * Build the padded PC prefix string for a 1-based sequence number.
 * 1 → "PC01", 10 → "PC10", 100 → "PC100"
 * @param {number} seq  1-based sequence number (>= 1)
 * @returns {string}
 */
function seqPrefix(seq) {
  if (seq < 10)  return `PC0${seq}`;
  return `PC${seq}`;
}

// Folder names that should never be treated as photographer or component folders.
// _Selected/__MACOSX: mirror _NAS_SKIP_DIRS in main.js.
// VIDEO: excluded at every archive-walk level; never a photographer folder.
// .DS_Store/Thumbs.db: filesystem artefacts.
const SKIP_DIRS = new Set([
  '_Selected', '__MACOSX', 'VIDEO',
  '.autoingest', '.DS_Store', 'Thumbs.db',
]);

function _skipDir(name) {
  if (typeof name !== 'string') return true;
  return SKIP_DIRS.has(name) || name.startsWith('.') || name.startsWith('#');
}

/**
 * Scan photographer folders, component/sub-event aware.
 *
 * Folder rules (matches importRouter.js):
 *   Single-component (components.length <= 1):
 *     EventFolder/<photographer>/... → scope key "__eventRoot__"
 *   Multi-component (components.length > 1):
 *     EventFolder/<comp.folderName>/<photographer>/... → scope key = comp.folderName
 *
 * @param {string} localEventPath
 * @param {Array<{ folderName?: string }>} components  Raw components[] from event.json
 * @returns {Promise<Array<{
 *   scopeKey:      string,
 *   scopeLabel:    string | null,
 *   photographers: Array<{ folderName: string, canonical: string }>
 * }>>}
 */
async function scanPhotographerFolders(localEventPath, components) {
  // Determine which component folders exist
  const compFolders = (components || [])
    .filter(c => c && typeof c.folderName === 'string' && c.folderName)
    .map(c => c.folderName);

  const isMulti = compFolders.length > 1;

  async function readPhotographerDirs(dirPath) {
    try {
      const entries = await fsp.readdir(dirPath, { withFileTypes: true });
      return entries
        .filter(e => e.isDirectory() && !_skipDir(e.name))
        .map(e => ({ folderName: e.name, canonical: canonicalName(e.name) }));
    } catch { return []; }
  }

  if (!isMulti) {
    // Single-component: photographer folders are directly under the event root.
    // Also filter out any component folder that might exist on disk from a previous
    // multi-component state to avoid confusing them with photographer names.
    const knownCompFolders = new Set(compFolders);
    const dirs = await readPhotographerDirs(localEventPath);
    const photographers = dirs.filter(p => !knownCompFolders.has(p.folderName));
    return [{
      scopeKey:      EVENT_ROOT_KEY,
      scopeLabel:    null,
      photographers,
    }];
  }

  // Multi-component: photographer folders are inside each component sub-folder.
  const result = [];
  for (const compFolder of compFolders) {
    const compPath     = path.join(localEventPath, compFolder);
    const photographers = await readPhotographerDirs(compPath);
    result.push({
      scopeKey:   compFolder,
      scopeLabel: compFolder,
      photographers,
    });
  }
  return result;
}

/**
 * Apply photographer folder renames across all component scopes.
 *
 * @param {string} localEventPath
 * @param {Array<{
 *   scopeKey: string,
 *   ordered:  Array<{ canonical: string, sequence: number, folderName: string }>
 * }>} scopedOrdered
 * @returns {Promise<{ ok: boolean, renames: Array<{from:string,to:string}>, error?: string }>}
 */
async function applyRenames(localEventPath, scopedOrdered) {
  const allRenames = [];

  for (const scope of scopedOrdered) {
    const baseDir = scope.scopeKey === EVENT_ROOT_KEY
      ? localEventPath
      : path.join(localEventPath, scope.scopeKey);

    const result = await _applyRenamesInDir(baseDir, scope.ordered);
    if (!result.ok) return result;
    allRenames.push(...result.renames);
  }

  return { ok: true, renames: allRenames };
}

/**
 * Two-phase rename (old→temp, temp→final) within a single directory.
 * Handles A↔B swaps without collision.
 * @param {string} baseDir
 * @param {Array<{ canonical: string, sequence: number, folderName: string }>} ordered
 */
async function _applyRenamesInDir(baseDir, ordered) {
  const renames  = [];
  const rollback = [];

  // Phase 1: current → temp
  for (const entry of ordered) {
    if (_skipDir(entry.canonical)) continue;  // defensive: never rename system/selection folders
    const target = path.join(baseDir, entry.folderName);

    // Locate whichever folder currently holds this canonical name
    let currentFolder = null;
    try {
      const dirs = await fsp.readdir(baseDir, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory() && canonicalName(d.name) === entry.canonical) {
          currentFolder = d.name;
          break;
        }
      }
    } catch (err) {
      return { ok: false, renames, error: `Failed to scan ${baseDir}: ${err.message}` };
    }

    if (!currentFolder) continue; // folder not on disk — skip
    const currentPath = path.join(baseDir, currentFolder);
    if (currentPath === target) continue; // already the correct name

    const tmpName = `__seq_tmp_${Date.now()}_${entry.sequence}__`;
    const tmpPath = path.join(baseDir, tmpName);

    try {
      await fsp.rename(currentPath, tmpPath);
      rollback.push({ from: tmpPath, to: currentPath });
      renames.push({ phase: 1, tmpName, currentFolder, finalFolder: entry.folderName });
    } catch (err) {
      for (const rb of rollback.reverse()) {
        await fsp.rename(rb.from, rb.to).catch(() => {});
      }
      return { ok: false, renames, error: `Phase-1 rename failed for "${currentFolder}": ${err.message}` };
    }
  }

  // Phase 2: temp → final
  const completed = [];
  for (const r of renames) {
    const tmpPath   = path.join(baseDir, r.tmpName);
    const finalPath = path.join(baseDir, r.finalFolder);
    try {
      await fsp.rename(tmpPath, finalPath);
      completed.push({ from: r.currentFolder, to: r.finalFolder });
    } catch (err) {
      for (const done of completed.reverse()) {
        const f = path.join(baseDir, done.to);
        const b = path.join(baseDir, done.from);
        await fsp.rename(f, b).catch(() => {});
      }
      return { ok: false, renames: completed, error: `Phase-2 rename failed for "${r.currentFolder}" → "${r.finalFolder}": ${err.message}` };
    }
  }

  return { ok: true, renames: completed };
}

/**
 * Update the sync manifest (event.sync.json) after photographer folder renames.
 *
 * File path format in manifest jobs:
 *   Single-component: "PhotographerA/file.jpg"  → parts[0] = photographer
 *   Multi-component:  "CompFolder/PhA/file.jpg" → parts[0] = component, parts[1] = photographer
 *
 * @param {string} localEventPath
 * @param {Map<string, Map<string, string>>} scopedRenameMap
 *   scopeKey → Map<canonical, newFolderName>
 *   EVENT_ROOT_KEY → event-root photographer renames
 *   compFolderName → per-component photographer renames
 */
async function updateManifestAfterRename(localEventPath, scopedRenameMap) {
  const manifest = await localSyncManifest.readManifest(localEventPath);
  if (!manifest || !Array.isArray(manifest.jobs) || manifest.jobs.length === 0) return;

  const rootRenames = scopedRenameMap.get(EVENT_ROOT_KEY) || new Map();
  // Build per-component rename maps keyed by component folder name
  const compRenamesByFolder = new Map();
  for (const [key, rmap] of scopedRenameMap.entries()) {
    if (key !== EVENT_ROOT_KEY) compRenamesByFolder.set(key, rmap);
  }

  let changed = false;

  const updatedJobs = manifest.jobs.map(job => {
    let updatedJob = job;

    // Update job.photographer for single-component jobs (display field)
    const phCanonical = canonicalName(job.photographer || '');
    const rootNewFolder = rootRenames.get(phCanonical);
    if (rootNewFolder && rootNewFolder !== job.photographer) {
      changed = true;
      updatedJob = { ...updatedJob, photographer: rootNewFolder };
    }

    if (!Array.isArray(updatedJob.files)) return updatedJob;

    const newFiles = updatedJob.files.map(f => {
      const parts = f.replace(/\\/g, '/').split('/');
      if (parts.length === 0) return f;

      // Single-component path: parts[0] is the photographer folder
      if (rootRenames.size > 0) {
        const c0 = canonicalName(parts[0]);
        const newFolder = rootRenames.get(c0);
        if (newFolder && newFolder !== parts[0]) {
          changed = true;
          return [newFolder, ...parts.slice(1)].join('/');
        }
      }

      // Multi-component path: parts[0] = component folder, parts[1] = photographer folder
      if (parts.length >= 2) {
        const compMap = compRenamesByFolder.get(parts[0]);
        if (compMap) {
          const c1 = canonicalName(parts[1]);
          const newFolder = compMap.get(c1);
          if (newFolder && newFolder !== parts[1]) {
            changed = true;
            return [parts[0], newFolder, ...parts.slice(2)].join('/');
          }
        }
      }

      return f;
    });

    if (newFiles.some((f, i) => f !== updatedJob.files[i])) {
      updatedJob = { ...updatedJob, files: newFiles };
    }
    return updatedJob;
  });

  if (!changed) return;
  await localSyncManifest.writeManifest(localEventPath, { ...manifest, jobs: updatedJobs });
}

/**
 * Write the photographerSequences field (component-scoped) into event.json atomically.
 *
 * Shape written:
 *   {
 *     "__eventRoot__": {
 *       "M Murtaza Khazanchi": { "sequence": 1, "folderName": "PC01-M Murtaza Khazanchi" }
 *     }
 *   }
 * or for multi-component:
 *   {
 *     "01-Majlis-Saifee-Masjid-Surat": {
 *       "M Murtaza Khazanchi": { "sequence": 1, "folderName": "PC01-M Murtaza Khazanchi" }
 *     }
 *   }
 *
 * @param {string} localEventPath
 * @param {object} scopedSequences  { [scopeKey]: { [canonical]: { sequence, folderName } } }
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function writeSequencesToEventJson(localEventPath, scopedSequences) {
  const jsonPath = path.join(localEventPath, 'event.json');
  let existing   = {};
  try {
    const raw = await fsp.readFile(jsonPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') existing = parsed;
  } catch (err) {
    return { ok: false, error: `Cannot read event.json: ${err.message}` };
  }

  const updated = { ...existing, photographerSequences: scopedSequences, updatedAt: Date.now() };
  const tmp = jsonPath + '.tmp';
  try {
    await fsp.writeFile(tmp, JSON.stringify(updated, null, 2), 'utf8');
    await fsp.rename(tmp, jsonPath);
    hidePathBestEffort(jsonPath).catch(() => {});
    return { ok: true };
  } catch (err) {
    try { await fsp.unlink(tmp); } catch {}
    return { ok: false, error: `Failed to write event.json: ${err.message}` };
  }
}

module.exports = {
  EVENT_ROOT_KEY,
  canonicalName,
  seqPrefix,
  scanPhotographerFolders,
  applyRenames,
  updateManifestAfterRename,
  writeSequencesToEventJson,
};
