'use strict';

/**
 * archiveConsistencyService.js — Read-only archive consistency report (Phase 13D-1).
 *
 * Aggregates lightweight summary data from existing services and produces a
 * consolidated operator-readable snapshot of archive health.
 *
 * Rules:
 *  - Strictly read-only. No file is created, modified, renamed, or deleted.
 *  - Does not mutate sync queue, review registry, lock files, or transfer metadata.
 *  - Reads roots from settings; stat() each for reachability — no deep scan.
 *  - Lock count covers activeArchiveRoot only (shallow readdir of lock dir).
 *  - Managed event count comes from cached nasEventCache — no NAS scan triggered.
 *  - Adoption candidate counts come from in-memory preview state — no new scan.
 *  - Each data source is isolated in its own try/catch; failure returns null fields.
 *  - generateReport() never throws to the IPC layer.
 */

const fsp  = require('fs').promises;
const path = require('path');

const LOCK_DIR_RELPATH = path.join('.autoingest', 'locks');

let _lastReport  = null;
let _inFlight    = false;

// ── Root status check ─────────────────────────────────────────────────────────

async function _checkRootStatus(rootPath) {
  if (!rootPath) return { path: null, status: 'not-set' };
  try {
    const st = await fsp.stat(rootPath);
    if (!st.isDirectory()) return { path: rootPath, status: 'error' };
    return { path: rootPath, status: 'ready' };
  } catch (err) {
    if (err.code === 'ENOENT') return { path: rootPath, status: 'not-found' };
    return { path: rootPath, status: 'error' };
  }
}

// ── Lock count (active archive root only) ─────────────────────────────────────

async function _countLocks(activeArchiveRoot) {
  const base = { active: 0, stale: 0, scannedRoot: 'activeArchiveRoot' };
  if (!activeArchiveRoot) return base;

  const lockDir = path.join(activeArchiveRoot, LOCK_DIR_RELPATH);
  let lockFiles;
  try {
    lockFiles = await fsp.readdir(lockDir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return base;
    return base;
  }

  const now = Date.now();
  let active = 0;
  let stale  = 0;

  for (const f of lockFiles) {
    if (!f.isFile() || !f.name.endsWith('.json')) continue;
    try {
      const lock = JSON.parse(await fsp.readFile(path.join(lockDir, f.name), 'utf8'));
      if (lock.status !== 'active') continue;
      if (typeof lock.expiresAt === 'number' && lock.expiresAt > now) {
        active++;
      } else {
        stale++;
      }
    } catch { /* skip unparseable lock */ }
  }

  return { active, stale, scannedRoot: 'activeArchiveRoot' };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Generate a fresh consistency report.
 * Aggregates root stats, cache counts, sync queue, locks, and transfer state.
 * Does not mutate any file or service state.
 *
 * @returns {Promise<object>}
 */
async function generateReport() {
  if (_inFlight) return _lastReport || { generatedAt: new Date().toISOString(), busy: true };
  _inFlight = true;
  try {
    const settings                  = require('./settings');
    const nasEventCache             = require('./nasEventCache');
    const syncQueueService          = require('./syncQueueService');
    const syncReviewService         = require('./syncReviewService');
    const adoptionPreviewService    = require('./adoptionPreviewService');
    const transferExportService     = require('./transferExportService');
    const transferImportService     = require('./transferImportService');
    const archiveDiagnosticsService = require('./archiveDiagnosticsService');

    const nasPath    = settings.getNasRoot();
    const staging    = settings.getLocalStagingRoot();
    const txDrive    = settings.getTransferRoot();
    const mainRoot   = settings.getMainArchiveRoot();

    // ── Roots ──────────────────────────────────────────────────────────────────
    const [activeRoot, localRoot, transferRoot, mainArchRoot] = await Promise.all([
      _checkRootStatus(nasPath),
      _checkRootStatus(staging),
      _checkRootStatus(txDrive),
      _checkRootStatus(mainRoot),
    ]);

    // ── Events from NAS event cache (no NAS scan) ──────────────────────────────
    // Cache entries do not preserve the adoption block; adopted count unavailable.
    let managed  = null;
    let cacheAge = null;
    try {
      const cache = await nasEventCache.load();
      if (cache && Array.isArray(cache.collections)) {
        managed  = cache.collections.reduce(
          (sum, c) => sum + (Array.isArray(c.events) ? c.events.length : 0), 0
        );
        cacheAge = cache.cachedAt || null;
      }
    } catch { /* leave null */ }

    // ── Adoption candidates from in-memory preview state (no new scan) ─────────
    let adoptionCandidates = null;
    let blockedCandidates  = null;
    try {
      const previewReport = adoptionPreviewService.getAdoptionPreviewReport();
      if (Array.isArray(previewReport.items)) {
        adoptionCandidates = previewReport.items.length;
        blockedCandidates  = previewReport.items.filter(i => i.readiness === 'blocked').length;
      }
    } catch { /* leave null */ }

    // ── Sync queue summary ─────────────────────────────────────────────────────
    let sync = { ready: 0, syncing: 0, needsAttention: 0, reviewed: 0, failed: 0, total: 0, refreshedAt: null };
    try {
      const qSummary = await syncQueueService.getSummary();
      sync.ready          = qSummary.ready          || 0;
      sync.syncing        = qSummary.syncing         || 0;
      sync.needsAttention = qSummary.needsAttention  || 0;
      sync.failed         = qSummary.failed          || 0;
      sync.total          = qSummary.total           || 0;
      sync.refreshedAt    = qSummary.refreshedAt     || null;

      try {
        const reviews = await syncReviewService.getReviews();
        sync.reviewed = Object.keys(reviews).length;
      } catch { /* leave 0 */ }
    } catch { /* leave zeroed */ }

    // ── Active archive locks ───────────────────────────────────────────────────
    let locks = { active: 0, stale: 0, scannedRoot: 'activeArchiveRoot' };
    try {
      locks = await _countLocks(nasPath);
    } catch { /* leave zeroed */ }

    // ── Transfer status (in-memory, synchronous; strip operational fields) ─────
    let exportSummary = { running: false, completedAt: null };
    let importSummary = { running: false, completedAt: null };
    try {
      const es = transferExportService.getExportStatus();
      exportSummary = {
        running:     !!es.running,
        completedAt: es.result?.completedAt || null,
      };
    } catch { /* leave defaults */ }
    try {
      const is = transferImportService.getImportStatus();
      importSummary = {
        running:     !!is.running,
        completedAt: is.result?.completedAt || null,
      };
    } catch { /* leave defaults */ }

    // ── Diagnostics summary (in-memory, synchronous) ──────────────────────────
    let diagnostics = { errors: null, warnings: null, infos: null, completedAt: null };
    try {
      const dr     = archiveDiagnosticsService.getDiagnosticsReport();
      const dsStat = archiveDiagnosticsService.getDiagnosticsStatus();
      if (dr.generatedAt) {
        diagnostics = {
          errors:      dsStat.result?.errors   ?? null,
          warnings:    dsStat.result?.warnings ?? null,
          infos:       dsStat.result?.infos    ?? null,
          completedAt: dr.generatedAt,
        };
      }
    } catch { /* leave null */ }

    // ── Assemble ───────────────────────────────────────────────────────────────
    const report = {
      generatedAt: new Date().toISOString(),
      roots: {
        activeArchiveRoot: activeRoot,
        localStagingRoot:  localRoot,
        transferDriveRoot: transferRoot,
        mainArchiveRoot:   mainArchRoot,
      },
      events: {
        managed,
        adopted:            null, // adoption block not preserved in cache; not available without NAS scan
        adoptionCandidates,
        blockedCandidates,
        cacheAge,
      },
      sync,
      locks,
      transfer: {
        export: exportSummary,
        import: importSummary,
      },
      diagnostics,
    };

    _lastReport = report;
    _inFlight   = false;
    return report;

  } catch (err) {
    // Catastrophic failure guard — must never throw to IPC layer
    const report = {
      generatedAt: new Date().toISOString(),
      error:       err.message,
      roots: {
        activeArchiveRoot: { path: null, status: 'error' },
        localStagingRoot:  { path: null, status: 'error' },
        transferDriveRoot: { path: null, status: 'error' },
        mainArchiveRoot:   { path: null, status: 'error' },
      },
      events:      { managed: null, adopted: null, adoptionCandidates: null, blockedCandidates: null, cacheAge: null },
      sync:        { ready: 0, syncing: 0, needsAttention: 0, reviewed: 0, failed: 0, total: 0, refreshedAt: null },
      locks:       { active: 0, stale: 0, scannedRoot: 'activeArchiveRoot' },
      transfer:    { export: { running: false, completedAt: null }, import: { running: false, completedAt: null } },
      diagnostics: { errors: null, warnings: null, infos: null, completedAt: null },
    };
    _lastReport = report;
    _inFlight   = false;
    return report;
  }
}

/**
 * Return the last generated report, or null if none generated this session.
 * Synchronous — safe to call before generateReport().
 *
 * @returns {object|null}
 */
function getLastReport() {
  return _lastReport;
}

module.exports = { generateReport, getLastReport };
