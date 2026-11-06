'use strict';
const fsp  = require('fs').promises;
const path = require('path');

const { hidePathBestEffort } = require('./internalFileProtection');
const localSyncManifest      = require('./localSyncManifest');
const { log }                = require('./logger');
// Canonical Representation Audit, L6 (2026-08-11): seqPrefix() now lives in
// exactly one place, shared with the renderer via the same dual-export
// pattern renderer/pathUtils.js already established for main/renderer
// sharing — see that file for the full rationale.
const { seqPrefix }          = require('../renderer/photographerSequenceUtils.js');
// The ONE definition of the QMZ sequence-code shape (main/qmzService.js's own SEQ_RE,
// re-exported from there for exactly this main/renderer sharing problem) — reused here
// so a QMZ sequence container ("01Q", "05aMZ", …) can be recognized the same way
// everywhere a photographer folder is resolved. See isQmzContainerName below.
const { SEQ_RE }             = require('../renderer/qmzSequenceFormat.js');
// The SAME Windows/UNC-safe containment check main/main.js's own IPC handlers use
// (PathUtils.isPathUnderRoot) — reused here rather than re-implemented, so
// resolveScopeBaseDir's containment guarantee is identical to every other
// archive-root/staging-root boundary check in the app.
const PathUtils              = require('../renderer/pathUtils.js');

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

// QMZ's own reserved holding folders (mirrors main/qmzService.js's UNSEQUENCED/
// ENROUTE_DIR constants, duplicated here rather than imported — this file already
// stays decoupled from main/qmzService.js the same way main/qmzService.js's own
// PC_PREFIX_RE comment explains for the reverse direction).
const UNSEQUENCED = '_Unsequenced';
const ENROUTE_DIR = 'Enroute';

/**
 * True when `name` is a QMZ structural container — a sequence code ("01Q", "05aMZ", …),
 * the `_Unsequenced` holding folder, or the `Enroute` holding folder — never a
 * photographer itself, even though it sits at exactly the folder depth a photographer
 * folder normally would (bug: a QMZ sequence folder like "02-QMZ-BHUJ/01Q" being treated
 * as if "01Q" were the photographer, both in "Sequence Photographer Folders" and in
 * metadata Creator resolution). The real photographer folder, if any, is ONE level
 * deeper inside the container.
 *
 * Checked against the PC-prefix-stripped name so an already-damaged archive (a prior,
 * buggy run that renamed the container itself to "PC01-01Q") is still recognized as a
 * container going forward — this function never renames anything itself, it only
 * prevents the bug from being reinforced by a live scan; repairing an already-renamed
 * container is a separate, explicit, previewable operation.
 * @param {string} name
 * @returns {boolean}
 */
function isQmzContainerName(name) {
  const bare = canonicalName(name);
  return bare === UNSEQUENCED || bare === ENROUTE_DIR || SEQ_RE.test(bare);
}

// Folder names that should never be treated as photographer or component folders.
// _Selected/__MACOSX: mirror _NAS_SKIP_DIRS in main.js.
// VIDEO: excluded at every archive-walk level; never a photographer folder.
// .DS_Store/Thumbs.db: filesystem artefacts.
// _Unsequenced/Enroute are NOT listed here — they are QMZ structural containers
// (see isQmzContainerName) whose own children must still be scanned for real
// photographer folders, so they need different handling than a true dead-end skip.
const SKIP_DIRS = new Set([
  '_Selected', '__MACOSX', 'VIDEO',
  '.autoingest', '.DS_Store', 'Thumbs.db',
]);

function _skipDir(name) {
  if (typeof name !== 'string') return true;
  return SKIP_DIRS.has(name) || name.startsWith('.') || name.startsWith('#');
}

// Filesystem hardening (mirrors main/main.js's BUG-011 fix, and
// main/qmzService.js's identical hardening for the same bug class):
// Dirent.isDirectory() can misreport on some network shares. If Dirent says
// "not a directory" but a real stat() on the same path says otherwise, trust
// stat() — recovering a photographer folder a raw Dirent check alone would
// have silently dropped from "Sequence Photographer Folders" candidate
// discovery. Only adds a stat() call on the rare disagreement path.
async function _directoryHardened(parentDir, entry) {
  if (entry.isDirectory()) return true;
  try {
    const st = await fsp.stat(path.join(parentDir, entry.name));
    if (st.isDirectory()) {
      log(`[photographerSeq] DIRENT/STAT MISMATCH name=${JSON.stringify(entry.name)} parent=${JSON.stringify(parentDir)} `
        + `dirent.isDirectory()=false stat.isDirectory()=true — accepting stat() result, treating as a directory`);
      return true;
    }
  } catch { /* stat failed too — genuinely not a directory (or gone) */ }
  return false;
}

/**
 * Scan photographer folders, component/sub-event aware, and QMZ-sequence aware.
 *
 * Folder rules (matches importRouter.js):
 *   Single-component (components.length <= 1):
 *     EventFolder/<photographer>/... → scope key "__eventRoot__"
 *   Multi-component (components.length > 1):
 *     EventFolder/<comp.folderName>/<photographer>/... → scope key = comp.folderName
 *
 * QMZ addition: when a QMZ sequence passed through this event (or component), its
 * sequence-code folder ("01Q", "05aMZ", …) or `_Unsequenced`/`Enroute` holding folder
 * sits at exactly the depth a photographer folder normally would — but it is never a
 * photographer itself (see isQmzContainerName). Such a container is excluded from its
 * parent scope's `photographers` list and instead scanned ONE level deeper as its own
 * nested scope (scopeKey = "<parentScopeKey>/<containerName>", or bare "<containerName>"
 * at the event root), so:
 *   - a QMZ sequence container is never prefixed/renamed as if it were a photographer;
 *   - the same photographer name appearing in two different sequences gets two
 *     independent scopes, never merged;
 *   - photographer folders inside `_Unsequenced` are discovered and sequenceable.
 * Ordinary (non-QMZ) events have no folder matching isQmzContainerName, so this adds
 * zero extra scopes and leaves their existing behavior unchanged.
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

  async function readSubdirNames(dirPath) {
    try {
      const entries = await fsp.readdir(dirPath, { withFileTypes: true });
      const names = [];
      for (const e of entries) {
        if (_skipDir(e.name)) continue;
        if (await _directoryHardened(dirPath, e)) names.push(e.name);
      }
      return names;
    } catch { return []; }
  }

  // Scans one base directory for a single scope. Returns that scope's own
  // (non-QMZ) photographer folders, plus one additional nested scope per QMZ
  // container found directly inside it.
  async function scanScope(baseDir, baseScopeKey, baseScopeLabel, excludeNames) {
    const names = await readSubdirNames(baseDir);
    const photographers = [];
    const nestedScopes = [];

    for (const name of names) {
      if (excludeNames && excludeNames.has(name)) continue; // stale component folder from a prior state
      if (isQmzContainerName(name)) {
        const containerNames = await readSubdirNames(path.join(baseDir, name));
        const containerPhotographers = containerNames
          .filter(cname => !isQmzContainerName(cname)) // a container nested inside another container is never a photographer either
          .map(cname => ({ folderName: cname, canonical: canonicalName(cname) }));
        nestedScopes.push({
          scopeKey:      baseScopeKey ? `${baseScopeKey}/${name}` : name,
          scopeLabel:    baseScopeLabel ? `${baseScopeLabel} / ${name}` : name,
          photographers: containerPhotographers,
        });
        continue;
      }
      photographers.push({ folderName: name, canonical: canonicalName(name) });
    }

    return {
      scope: { scopeKey: baseScopeKey || EVENT_ROOT_KEY, scopeLabel: baseScopeLabel || null, photographers },
      nestedScopes,
    };
  }

  if (!isMulti) {
    // Single-component: photographer folders are directly under the event root.
    // Also filter out any component folder that might exist on disk from a previous
    // multi-component state to avoid confusing them with photographer names.
    const knownCompFolders = new Set(compFolders);
    const { scope, nestedScopes } = await scanScope(localEventPath, '', null, knownCompFolders);
    return [scope, ...nestedScopes];
  }

  // Multi-component: photographer folders are inside each component sub-folder.
  const result = [];
  for (const compFolder of compFolders) {
    const compPath = path.join(localEventPath, compFolder);
    const { scope, nestedScopes } = await scanScope(compPath, compFolder, compFolder, null);
    result.push(scope, ...nestedScopes);
  }
  return result;
}

/**
 * Validate a scopeKey (as produced by scanPhotographerFolders, or as sent back by the
 * renderer for event:applyPhotographerSequence) and resolve its absolute base directory
 * under `realEvent`.
 *
 * EVENT_ROOT_KEY maps directly to realEvent. Any other scopeKey is a '/'-joined relative
 * path — one segment for a plain component or top-level QMZ container ("CompFolder",
 * "01Q", "_Unsequenced"), two for a QMZ container nested inside a component
 * ("CompFolder/01Q") — see scanPhotographerFolders' own header comment for exactly which
 * shapes it produces. Every segment is checked individually (non-empty, no '\', not
 * literally '..') and the final resolved path must still land inside `realEvent` —
 * segment-level checks and the containment check are independent layers, since joining
 * alone is not trusted to stay contained on every platform.
 *
 * @param {string} realEvent  Absolute, already-resolved event folder path.
 * @param {string} scopeKey
 * @returns {{ ok: true, baseDir: string } | { ok: false, reason: string }}
 */
function resolveScopeBaseDir(realEvent, scopeKey) {
  if (scopeKey === EVENT_ROOT_KEY) return { ok: true, baseDir: realEvent };

  const segs = typeof scopeKey === 'string' ? scopeKey.split('/') : [];
  const badSeg = segs.find(seg => !seg || seg.includes('\\') || seg === '..');
  if (segs.length === 0 || badSeg !== undefined) {
    return { ok: false, reason: `scope key "${scopeKey}" is invalid.` };
  }

  const baseDir = path.resolve(path.join(realEvent, ...segs));
  if (!PathUtils.isPathUnderRoot(baseDir, realEvent)) {
    return { ok: false, reason: `scope key "${scopeKey}" resolves outside event directory.` };
  }
  return { ok: true, baseDir };
}

/**
 * Apply photographer folder renames across all component scopes.
 *
 * @param {string} localEventPath
 * @param {Array<{
 *   scopeKey: string,
 *   ordered:  Array<{ canonical: string, sequence: number, folderName: string }>
 * }>} scopedOrdered
 * @returns {Promise<{ ok: boolean, renames: Array<{from:string,to:string,scopeRel:string}>, error?: string }>}
 *   `renames` are the renames that are actually in effect on disk — on failure, the failing scope was
 *   rolled back, so only EARLIER scopes' renames are reported. `scopeRel` is the event-relative
 *   directory the rename happened in ('' for the event root), so callers can remap durable records
 *   keyed by event-relative path (event.json tagRefinements / metadataGroups) from the real pairs.
 */
async function applyRenames(localEventPath, scopedOrdered) {
  const allRenames = [];

  for (const scope of scopedOrdered) {
    const baseDir = scope.scopeKey === EVENT_ROOT_KEY
      ? localEventPath
      : path.join(localEventPath, scope.scopeKey);

    const result = await _applyRenamesInDir(baseDir, scope.ordered);
    if (!result.ok) return { ...result, renames: allRenames };
    const scopeRel = scope.scopeKey === EVENT_ROOT_KEY ? '' : scope.scopeKey;
    allRenames.push(...result.renames.map(r => ({ ...r, scopeRel })));
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
    // Defensive: never rename system/selection folders, nor a QMZ structural container
    // (a sequence code, _Unsequenced, or Enroute) even if one ever reached this far —
    // scanPhotographerFolders already excludes these from `photographers`, so this is a
    // backstop, not the primary defense.
    if (_skipDir(entry.canonical) || isQmzContainerName(entry.canonical)) continue;
    const target = path.join(baseDir, entry.folderName);

    // Locate whichever folder currently holds this canonical name
    let currentFolder = null;
    try {
      const dirs = await fsp.readdir(baseDir, { withFileTypes: true });
      for (const d of dirs) {
        if (canonicalName(d.name) === entry.canonical && await _directoryHardened(baseDir, d)) {
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
 * File path format in manifest jobs, generalized by scope depth (segs.length below):
 *   EVENT_ROOT_KEY (segs=[]):         "PhotographerA/file.jpg"            → parts[0] = photographer
 *   Single-segment (segs=[Comp]):     "CompFolder/PhA/file.jpg"           → parts[1] = photographer
 *   Nested QMZ scope (segs=[Comp,Seq] or [Seq]):
 *     "CompFolder/01Q/PhA/file.jpg"  or  "01Q/PhA/file.jpg"               → parts[segs.length] = photographer
 * A scope's segments must match the file path's own leading parts exactly before its
 * photographer slot is considered — so a rename in one scope never touches a file that
 * merely happens to share a photographer name in a different (e.g. different-sequence)
 * scope.
 *
 * @param {string} localEventPath
 * @param {Map<string, Map<string, string>>} scopedRenameMap
 *   scopeKey → Map<canonical, newFolderName>
 *   EVENT_ROOT_KEY → event-root photographer renames
 *   any other key ("CompFolder", "01Q", "CompFolder/01Q", "_Unsequenced", …) → that
 *   scope's own photographer renames, keyed by the exact scopeKey scanPhotographerFolders
 *   produced for it
 */
async function updateManifestAfterRename(localEventPath, scopedRenameMap) {
  const manifest = await localSyncManifest.readManifest(localEventPath);
  if (!manifest || !Array.isArray(manifest.jobs) || manifest.jobs.length === 0) return;

  const scopeEntries = [...scopedRenameMap.entries()].map(([scopeKey, rmap]) => ({
    segs: scopeKey === EVENT_ROOT_KEY ? [] : scopeKey.split('/'),
    rmap,
  }));
  const rootEntry = scopeEntries.find(s => s.segs.length === 0);

  let changed = false;

  const updatedJobs = manifest.jobs.map(job => {
    let updatedJob = job;

    // Update job.photographer (display field) — only meaningful for the plain event-root
    // scope; a job whose files live under a nested (component and/or QMZ-sequence) scope
    // has no single flat photographer field to correct here.
    if (rootEntry) {
      const phCanonical = canonicalName(job.photographer || '');
      const rootNewFolder = rootEntry.rmap.get(phCanonical);
      if (rootNewFolder && rootNewFolder !== job.photographer) {
        changed = true;
        updatedJob = { ...updatedJob, photographer: rootNewFolder };
      }
    }

    if (!Array.isArray(updatedJob.files)) return updatedJob;

    const newFiles = updatedJob.files.map(f => {
      const parts = f.replace(/\\/g, '/').split('/');
      for (const { segs, rmap } of scopeEntries) {
        if (parts.length <= segs.length) continue;
        if (!segs.every((seg, i) => parts[i] === seg)) continue;
        const phIdx = segs.length;
        const newFolder = rmap.get(canonicalName(parts[phIdx]));
        if (newFolder && newFolder !== parts[phIdx]) {
          changed = true;
          const next = [...parts];
          next[phIdx] = newFolder;
          return next.join('/');
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
  isQmzContainerName,
  resolveScopeBaseDir,
  seqPrefix,
  scanPhotographerFolders,
  applyRenames,
  updateManifestAfterRename,
  writeSequencesToEventJson,
  // Test-only: mirrors main/qmzService.js's identical export for the same
  // reason — see that file's export comment.
  _directoryHardened,
};
