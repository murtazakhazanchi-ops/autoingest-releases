'use strict';

/**
 * archiveDiagnosticsService.js — Read-only archive health diagnostics (Phase 13A).
 *
 * Inspects all configured archive roots and related system state for structural
 * problems, JSON validity, lock health, temp files, and sync-queue consistency.
 *
 * Rules:
 *  - Strictly read-only. No file is created, modified, renamed, or deleted.
 *  - Never acquires locks. Never writes to any archive or staging root.
 *  - Diagnostics run in the background; caller polls getDiagnosticsStatus().
 *  - Only one scan may run at a time. Concurrent calls return { ok:false, reason:'busy' }.
 *  - Results are capped at MAX_ITEMS to avoid large IPC payloads.
 *  - _Selected folders are classified as valid external output (info, not error).
 *  - event.json and event.metadata.json are read for JSON validity only; never written.
 *  - Lock files are read for stale/active status; never modified.
 *  - Scan depth: collection → event (never recurse into photographer subdirs).
 */

const fsp    = require('fs').promises;
const path   = require('path');
const crypto = require('crypto');

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_ITEMS               = 500;
const MAX_QUEUE_ACCESS_CHECKS = 50;  // cap fsp.access() calls for large queues
const LOCK_DIR_RELPATH   = path.join('.autoingest', 'locks');
const TRANSFER_META_DIR  = '.autoingest-transfer';
const TRANSFER_ROOT_JSON = 'transfer-root.json';
const MANIFEST_RELPATH   = path.join('.autoingest', 'event.sync.json');
const QUEUE_FILE         = 'archiveSyncQueue.json';

const _SKIP_DIRS = new Set(['.autoingest', '.autoingest-transfer', '__MACOSX']);

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

// ── Item factory ─────────────────────────────────────────────────────────────

function _mk(severity, category, title, message, rootType, filePath, relatedEvent, recommendedAction) {
  _itemSeq++;
  return {
    id:                `${category}-${String(_itemSeq).padStart(4, '0')}`,
    severity,
    category,
    title,
    message,
    rootType,
    path:              filePath          || null,
    relatedEvent:      relatedEvent      || null,
    recommendedAction: recommendedAction || null,
    detectedAt:        new Date().toISOString(),
  };
}

function _push(items, item) {
  if (items.length < MAX_ITEMS) { items.push(item); return true; }
  return false;
}

// ── Lock scan ─────────────────────────────────────────────────────────────────

async function _scanLocks(archiveRoot, rootType, items) {
  const lockDir = path.join(archiveRoot, LOCK_DIR_RELPATH);
  let lockFiles;
  try {
    lockFiles = await fsp.readdir(lockDir, { withFileTypes: true });
  } catch (e) {
    if (e.code !== 'ENOENT') {
      _push(items, _mk('warning', 'locks', 'Lock directory unreadable',
        `Cannot read lock directory at ${lockDir}: ${e.message}`,
        rootType, lockDir, null, null));
    }
    return;
  }

  const now = Date.now();
  for (const f of lockFiles) {
    if (!f.isFile() || !f.name.endsWith('.json')) continue;
    if (items.length >= MAX_ITEMS) break;

    const lockPath = path.join(lockDir, f.name);
    let lock;
    try {
      lock = JSON.parse(await fsp.readFile(lockPath, 'utf8'));
    } catch {
      _push(items, _mk('warning', 'locks', 'Unparseable lock file',
        `Lock file at ${lockPath} could not be parsed.`,
        rootType, lockPath, null,
        'Remove manually only if no import is actively running.'));
      continue;
    }

    if (lock.status !== 'active') continue;

    if (typeof lock.expiresAt === 'number' && lock.expiresAt > now) {
      _push(items, _mk('info', 'locks', 'Active archive lock',
        `Write lock held by "${lock.deviceName || 'unknown'}" for event "${lock.eventFolderName || '?'}". Expires ${new Date(lock.expiresAt).toISOString()}.`,
        rootType, lockPath, lock.eventFolderName || null, null));
    } else {
      _push(items, _mk('warning', 'locks', 'Stale archive lock',
        `Expired lock for event "${lock.eventFolderName || '?'}" from device "${lock.deviceName || 'unknown'}" (expired ${lock.expiresAt ? new Date(lock.expiresAt).toISOString() : 'unknown'}).`,
        rootType, lockPath, lock.eventFolderName || null,
        'Stale locks are automatically bypassed on next import attempt.'));
    }
  }
}

// ── Temp file scan (event folder level only) ──────────────────────────────────

async function _scanTempFiles(evPath, rootType, relatedEvent, items) {
  let files;
  try { files = await fsp.readdir(evPath, { withFileTypes: true }); } catch { return; }
  for (const f of files) {
    if (!f.isFile()) continue;
    if (f.name.endsWith('.autoingest-tx-tmp') || f.name.endsWith('.autoingest-sync-tmp')) {
      _push(items, _mk('warning', 'temp-files', 'Leftover AutoIngest temp file',
        `Temp file at ${path.join(evPath, f.name)}. This may indicate an interrupted import.`,
        rootType, path.join(evPath, f.name), relatedEvent,
        'Remove manually only when no import is actively running.'));
    }
  }
}

// ── Archive root scan (Active Archive or Main Archive) ────────────────────────

async function _scanArchiveRoot(rootPath, rootType, items) {
  await _scanLocks(rootPath, rootType, items);

  let colls;
  try {
    colls = await fsp.readdir(rootPath, { withFileTypes: true });
  } catch (e) {
    _push(items, _mk('error', 'archive-root', 'Archive root unreadable',
      `Cannot list ${rootPath}: ${e.message}`, rootType, rootPath, null,
      'Check that the path is accessible and permissions are correct.'));
    return;
  }

  for (const coll of colls) {
    if (!coll.isDirectory()) continue;
    if (_SKIP_DIRS.has(coll.name) || coll.name.startsWith('.')) continue;

    const collPath = path.join(rootPath, coll.name);
    let evEntries;
    try { evEntries = await fsp.readdir(collPath, { withFileTypes: true }); }
    catch { continue; }

    for (const ev of evEntries) {
      if (!ev.isDirectory()) continue;
      if (_SKIP_DIRS.has(ev.name) || ev.name.startsWith('.')) continue;
      if (items.length >= MAX_ITEMS) break;

      const evPath = path.join(collPath, ev.name);

      // _Selected: valid external output folder — classify as info, not error
      if (ev.name === '_Selected') {
        _push(items, _mk('info', 'external-folder', '_Selected output folder',
          `_Selected folder at ${evPath} is a valid export-output folder.`,
          rootType, evPath, null, null));
        continue;
      }

      // Temp files at event level
      await _scanTempFiles(evPath, rootType, ev.name, items);

      // event.json — required, must be valid JSON
      const evJsonPath = path.join(evPath, 'event.json');
      let hasEventJson = false;
      try {
        const raw = await fsp.readFile(evJsonPath, 'utf8');
        hasEventJson = true;
        try { JSON.parse(raw); }
        catch {
          _push(items, _mk('error', 'event-structure', 'event.json contains invalid JSON',
            `event.json at ${evJsonPath} cannot be parsed.`,
            rootType, evJsonPath, ev.name,
            'Inspect and repair manually, or restore from backup.'));
        }
      } catch (e) {
        if (e.code !== 'ENOENT') {
          _push(items, _mk('error', 'event-structure', 'event.json unreadable',
            `Cannot read ${evJsonPath}: ${e.message}`, rootType, evJsonPath, ev.name,
            'Check file permissions.'));
        }
      }

      if (!hasEventJson) {
        // Folder without event.json — external or manually copied
        _push(items, _mk('warning', 'external-folder', 'Folder without event.json',
          `Directory "${ev.name}" in collection "${coll.name}" has no event.json. It may be an externally managed or manually copied folder.`,
          rootType, evPath, ev.name,
          'If this is an AutoIngest event, ensure event.json is present. Otherwise this warning can be ignored.'));
        continue;
      }

      // event.metadata.json — optional; validate only if present
      const metaJsonPath = path.join(evPath, 'event.metadata.json');
      try {
        const raw = await fsp.readFile(metaJsonPath, 'utf8');
        try { JSON.parse(raw); }
        catch {
          _push(items, _mk('error', 'metadata-index', 'event.metadata.json contains invalid JSON',
            `event.metadata.json at ${metaJsonPath} cannot be parsed.`,
            rootType, metaJsonPath, ev.name,
            'Inspect and repair manually, or restore from backup.'));
        }
      } catch (e) {
        if (e.code !== 'ENOENT') {
          _push(items, _mk('warning', 'metadata-index', 'event.metadata.json unreadable',
            `Cannot read ${metaJsonPath}: ${e.message}`, rootType, metaJsonPath, ev.name,
            'Check file permissions.'));
        }
      }
    }
  }
}

// ── Local Staging Root scan ────────────────────────────────────────────────────

async function _scanLocalStagingRoot(stagingRoot, items) {
  let colls;
  try {
    colls = await fsp.readdir(stagingRoot, { withFileTypes: true });
  } catch (e) {
    _push(items, _mk('error', 'archive-root', 'Local Staging Root unreadable',
      `Cannot list ${stagingRoot}: ${e.message}`, 'localStagingRoot', stagingRoot, null,
      'Check that the path is accessible and permissions are correct.'));
    return;
  }

  for (const coll of colls) {
    if (!coll.isDirectory() || coll.name.startsWith('.')) continue;

    const collPath = path.join(stagingRoot, coll.name);
    let evEntries;
    try { evEntries = await fsp.readdir(collPath, { withFileTypes: true }); }
    catch { continue; }

    for (const ev of evEntries) {
      if (!ev.isDirectory() || ev.name.startsWith('.')) continue;
      if (items.length >= MAX_ITEMS) break;

      const evPath       = path.join(collPath, ev.name);
      const manifestPath = path.join(evPath, MANIFEST_RELPATH);

      let manifest = null;
      try {
        const raw = await fsp.readFile(manifestPath, 'utf8');
        try { manifest = JSON.parse(raw); }
        catch {
          _push(items, _mk('warning', 'sync-queue', 'Sync manifest contains invalid JSON',
            `event.sync.json at ${manifestPath} is malformed.`, 'localStagingRoot', manifestPath, ev.name,
            'Re-run the Local First import to regenerate the manifest.'));
        }
      } catch (e) {
        // ENOENT: staging folder without manifest — not necessarily an error
        if (e.code !== 'ENOENT') {
          _push(items, _mk('warning', 'sync-queue', 'Sync manifest unreadable',
            `Cannot read ${manifestPath}: ${e.message}`, 'localStagingRoot', manifestPath, ev.name, null));
        }
      }

      if (!manifest) continue;

      // Check referenced NAS event path is accessible
      if (manifest.nasEventPath) {
        let nasOk = false;
        try { await fsp.access(manifest.nasEventPath); nasOk = true; } catch {}
        if (!nasOk) {
          _push(items, _mk('warning', 'sync-queue', 'Sync manifest references unavailable NAS path',
            `Manifest at ${manifestPath} references NAS path "${manifest.nasEventPath}" which is not accessible.`,
            'localStagingRoot', manifestPath, ev.name,
            'If the Active Archive is disconnected, reconnect it. Otherwise the event may have moved or been removed.'));
        }
      }

      // Check needs-attention flag
      if (manifest.needsAttention === true) {
        _push(items, _mk('warning', 'sync-queue', 'Sync job needs attention',
          `Event "${ev.name}" has needsAttention=true. Reason: ${manifest.reason || 'unspecified'}.`,
          'localStagingRoot', manifestPath, ev.name,
          'Open Sync & Activity to review this job.'));
      }

      // Ready-for-sync: verify local event path is accessible
      if (manifest.readyForSync === true && manifest.metadataStatus === 'complete') {
        let localOk = false;
        try { await fsp.access(evPath); localOk = true; } catch {}
        if (!localOk) {
          _push(items, _mk('error', 'sync-queue', 'Ready sync job path inaccessible',
            `Job for "${ev.name}" is ready-for-sync but local path ${evPath} is not accessible.`,
            'localStagingRoot', evPath, ev.name,
            'Check that the Local Staging Root is mounted and accessible.'));
        }
      }
    }
  }
}

// ── Sync queue scan ────────────────────────────────────────────────────────────

async function _scanSyncQueue(items) {
  const { app } = require('electron');
  const queuePath = path.join(app.getPath('userData'), QUEUE_FILE);

  let queue;
  try {
    const raw = await fsp.readFile(queuePath, 'utf8');
    queue = JSON.parse(raw);
  } catch (e) {
    if (e.code !== 'ENOENT') {
      _push(items, _mk('warning', 'sync-queue', 'Sync queue file unreadable',
        `Cannot read sync queue at ${queuePath}: ${e.message}`, 'system', queuePath, null, null));
    }
    return;
  }

  if (!queue || !Array.isArray(queue.jobs)) return;

  let accessChecks = 0;
  for (const job of queue.jobs) {
    if (items.length >= MAX_ITEMS) break;

    if (job.status === 'needs-attention') {
      _push(items, _mk('warning', 'sync-queue', 'Sync job needs attention',
        `Sync job for event "${job.event || job.jobId}" is in needs-attention state.`,
        'localStagingRoot', job.localEventPath || null, job.event || null,
        'Open Sync & Activity to review this job.'));
    }

    // Ready-for-sync with missing local path — capped to avoid unbounded stat calls
    if (job.status === 'ready-for-sync' && job.localEventPath &&
        accessChecks < MAX_QUEUE_ACCESS_CHECKS) {
      accessChecks++;
      let ok = false;
      try { await fsp.access(job.localEventPath); ok = true; } catch {}
      if (!ok) {
        _push(items, _mk('error', 'sync-queue', 'Ready sync job path missing',
          `Job for "${job.event || job.jobId}" is ready-for-sync but "${job.localEventPath}" is not accessible.`,
          'localStagingRoot', job.localEventPath, job.event || null,
          'Check that the Local Staging Root is mounted.'));
      }
    }
  }
}

// ── Transfer root scan ─────────────────────────────────────────────────────────

async function _scanTransferRoot(transferRoot, items) {
  const metaDir    = path.join(transferRoot, TRANSFER_META_DIR);
  const markerPath = path.join(metaDir, TRANSFER_ROOT_JSON);

  let metaExists = false;
  try { await fsp.access(metaDir); metaExists = true; } catch {}

  if (!metaExists) {
    // Check whether the drive has archive-like folder structure
    let hasArchiveLike = false;
    try {
      const entries = await fsp.readdir(transferRoot, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.')) continue;
        const sub = await fsp.readdir(path.join(transferRoot, e.name), { withFileTypes: true }).catch(() => []);
        if (sub.some(s => s.isDirectory() && !s.name.startsWith('.'))) {
          hasArchiveLike = true;
          break;
        }
      }
    } catch {}

    if (hasArchiveLike) {
      _push(items, _mk('warning', 'transfer', 'Transfer Drive missing metadata',
        `Transfer Drive at ${transferRoot} has archive-like folders but no .autoingest-transfer/ metadata directory. The drive may not be initialized as a Transfer Drive.`,
        'transferRoot', transferRoot, null,
        'Run a Transfer Export to initialize the drive.'));
    } else {
      _push(items, _mk('info', 'transfer', 'Transfer Drive not initialized',
        `Transfer Drive at ${transferRoot} has no .autoingest-transfer/ metadata directory.`,
        'transferRoot', transferRoot, null,
        'Run a Transfer Export to use this drive as a Transfer Drive.'));
    }
    return;
  }

  // Read and validate marker file
  let marker;
  try {
    const raw = await fsp.readFile(markerPath, 'utf8');
    marker = JSON.parse(raw);
  } catch (e) {
    const title = e.code === 'ENOENT'
      ? 'Transfer Drive marker file missing'
      : 'Transfer Drive marker unreadable';
    _push(items, _mk('warning', 'transfer', title,
      `transfer-root.json at ${markerPath}: ${e.code === 'ENOENT' ? 'file not found' : e.message}.`,
      'transferRoot', markerPath, null,
      'Run a Transfer Export to reinitialize the drive.'));
    return;
  }

  _push(items, _mk('info', 'transfer', 'Transfer Drive initialized',
    `Initialized ${marker.createdAt || 'unknown'}, device "${marker.deviceName || 'unknown'}".`,
    'transferRoot', markerPath, null, null));

  // Check for any collection folders
  let hasColls = false;
  try {
    const entries = await fsp.readdir(transferRoot, { withFileTypes: true });
    hasColls = entries.some(e => e.isDirectory() && !e.name.startsWith('.') && !_SKIP_DIRS.has(e.name));
  } catch {}

  if (!hasColls) {
    _push(items, _mk('info', 'transfer', 'Transfer Drive has no collection folders',
      `Transfer Drive at ${transferRoot} is initialized but contains no collection folders. No content has been exported to it yet.`,
      'transferRoot', transferRoot, null, null));
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────

async function _doDiagnostics(scope) {
  _itemSeq = 0;
  const settings = require('./settings');
  const items    = [];

  const nas   = settings.getNasRoot();
  const local = settings.getLocalStagingRoot();
  const tx    = settings.getTransferRoot();
  const main  = settings.getMainArchiveRoot();

  const all = !scope || scope === 'allConfiguredRoots';

  if ((all || scope === 'activeArchiveRoot') && nas) {
    try { await _scanArchiveRoot(nas, 'activeArchiveRoot', items); } catch {}
  }
  // Scan main archive separately; skip if it is the same path as active archive
  if ((all || scope === 'mainArchiveRoot') && main && main !== nas) {
    try { await _scanArchiveRoot(main, 'mainArchiveRoot', items); } catch {}
  }
  if ((all || scope === 'localStagingRoot') && local) {
    try { await _scanLocalStagingRoot(local, items); } catch {}
  }
  if ((all || scope === 'transferRoot') && tx) {
    try { await _scanTransferRoot(tx, items); } catch {}
  }
  // Sync queue supplements staging root diagnostics
  if (all || scope === 'localStagingRoot') {
    try { await _scanSyncQueue(items); } catch {}
  }

  const truncated = items.length >= MAX_ITEMS;
  const errors    = items.filter(i => i.severity === 'error').length;
  const warnings  = items.filter(i => i.severity === 'warning').length;
  const infos     = items.filter(i => i.severity === 'info').length;

  _state.running     = false;
  _state.completedAt = new Date().toISOString();
  _state.items       = items;
  _state.truncated   = truncated;
  _state.result      = { errors, warnings, infos, total: items.length, truncated };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Start a read-only diagnostic scan in the background.
 * @param {string} [scope]  'allConfiguredRoots' | 'activeArchiveRoot' | 'localStagingRoot' | 'transferRoot' | 'mainArchiveRoot'
 * @returns {Promise<{ ok: boolean, jobId?: string, reason?: string }>}
 */
async function runDiagnostics(scope = 'allConfiguredRoots') {
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

  _doDiagnostics(scope).catch(e => {
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
function getDiagnosticsStatus() {
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
 * Full report — call after getDiagnosticsStatus shows running:false.
 * @returns {{ items: object[], truncated: boolean, generatedAt: string|null }}
 */
function getDiagnosticsReport() {
  return {
    items:       _state.items,
    truncated:   _state.truncated,
    generatedAt: _state.completedAt,
  };
}

module.exports = { runDiagnostics, getDiagnosticsStatus, getDiagnosticsReport };
