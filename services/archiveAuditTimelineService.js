'use strict';

/**
 * archiveAuditTimelineService.js — Read-only archive operations audit timeline (Phase 13D-5).
 *
 * Aggregates recent operational history across the archive operations layer:
 *  - Transfer export audit JSONL ({transferRoot}/.autoingest-transfer/exports.audit.jsonl)
 *  - Transfer import audit JSONL ({mainArchiveRoot}/.autoingest/transfer-imports/imports.audit.jsonl)
 *  - Sync queue terminal states (synced / sync-failed / needs-attention)
 *  - Sync review acknowledgements (userData/archiveSyncReviews.json)
 *  - In-memory: diagnostics, consistency report, completeness checklist
 *
 * Rules:
 *  - Strictly read-only. No file is created, modified, renamed, or deleted.
 *  - Does not mutate any service state.
 *  - Per-source try/catch: one source failing does not fail the full timeline.
 *  - JSONL reads are capped at MAX_JSONL_BYTES / MAX_JSONL_LINES per file.
 *  - Total entries capped at MAX_ENTRIES, sorted newest-first.
 *  - generateTimeline() never throws to the IPC layer.
 */

const fsp  = require('fs').promises;
const path = require('path');

const MAX_JSONL_BYTES = 4 * 1024 * 1024; // 4 MB tail cap for large files
const MAX_JSONL_LINES = 75;              // last N parsed lines per JSONL source
const MAX_QUEUE_JOBS  = 50;              // terminal sync-queue entries cap
const MAX_ENTRIES     = 150;             // final timeline cap

// ── JSONL tail reader ──────────────────────────────────────────────────────────

async function _readJsonlTail(filePath, maxLines) {
  let raw;
  try {
    const stat = await fsp.stat(filePath);
    if (stat.size > MAX_JSONL_BYTES) {
      const fd  = await fsp.open(filePath, 'r');
      const buf = Buffer.allocUnsafe(MAX_JSONL_BYTES);
      try {
        const { bytesRead } = await fd.read(buf, 0, MAX_JSONL_BYTES, stat.size - MAX_JSONL_BYTES);
        raw = buf.slice(0, bytesRead).toString('utf8');
      } finally {
        await fd.close();
      }
    } else {
      raw = await fsp.readFile(filePath, 'utf8');
    }
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return raw
    .split('\n')
    .filter(l => l.trim())
    .slice(-maxLines)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

// ── Source collectors ──────────────────────────────────────────────────────────

async function _collectTransferExports(transferRoot, sourceErrors) {
  const entries = [];
  try {
    if (!transferRoot) return entries;
    const auditPath = path.join(transferRoot, '.autoingest-transfer', 'exports.audit.jsonl');
    const lines     = await _readJsonlTail(auditPath, MAX_JSONL_LINES);
    for (const ln of lines) {
      entries.push({
        id:         `tx-export-${ln.batchId || ln.completedAt || Math.random()}`,
        timestamp:  ln.completedAt || ln.startedAt || null,
        type:       'transfer-export',
        status:     ln.status === 'ok' ? 'success' : ln.status === 'partial' ? 'warning' : 'info',
        title:      'Transfer Export',
        message:    `${ln.copied ?? 0} copied, ${ln.skipped ?? 0} skipped${ln.errorCount ? `, ${ln.errorCount} errors` : ''}`,
        operator:   ln.operatorName || null,
        deviceName: ln.deviceName   || null,
        source:     'transfer-export-audit',
      });
    }
  } catch (err) {
    sourceErrors.push({ source: 'transfer-export', message: err.message });
  }
  return entries;
}

async function _collectTransferImports(mainArchiveRoot, sourceErrors) {
  const entries = [];
  try {
    if (!mainArchiveRoot) return entries;
    const auditPath = path.join(mainArchiveRoot, '.autoingest', 'transfer-imports', 'imports.audit.jsonl');
    const lines     = await _readJsonlTail(auditPath, MAX_JSONL_LINES);
    for (const ln of lines) {
      entries.push({
        id:         `tx-import-${ln.batchId || ln.completedAt || Math.random()}`,
        timestamp:  ln.completedAt || ln.startedAt || null,
        type:       'transfer-import',
        status:     ln.status === 'ok' ? 'success' : ln.status === 'partial' ? 'warning' : 'info',
        title:      'Transfer Import',
        message:    `${ln.copied ?? 0} copied, ${ln.skipped ?? 0} skipped${ln.errorCount ? `, ${ln.errorCount} errors` : ''}`,
        operator:   ln.operatorName || null,
        deviceName: ln.deviceName   || null,
        source:     'transfer-import-audit',
      });
    }
  } catch (err) {
    sourceErrors.push({ source: 'transfer-import', message: err.message });
  }
  return entries;
}

async function _collectSyncQueue(sourceErrors) {
  const entries = [];
  try {
    const syncQueueSvc = require('./syncQueueService');
    const { jobs }     = await syncQueueSvc.getQueue();
    const TERMINAL     = new Set(['synced', 'sync-failed', 'needs-attention']);
    const interesting  = (jobs || []).filter(j => TERMINAL.has(j.status));

    interesting.sort((a, b) => {
      const ta = a.updatedAt || a.lastSeenAt || '';
      const tb = b.updatedAt || b.lastSeenAt || '';
      if (tb > ta) return  1;
      if (tb < ta) return -1;
      return 0;
    });

    for (const job of interesting.slice(0, MAX_QUEUE_JOBS)) {
      const st = job.status === 'synced'      ? 'success'
               : job.status === 'sync-failed' ? 'failed'
               : 'warning';
      entries.push({
        id:         `sq-${job.jobId}`,
        timestamp:  job.updatedAt || job.lastSeenAt || null,
        type:       'archive-sync',
        status:     st,
        title:      'Archive Sync',
        message:    `${job.collection} / ${job.event}${job.reason ? ` — ${job.reason}` : ''}`,
        operator:   null,
        deviceName: null,
        source:     'sync-queue',
      });
    }
  } catch (err) {
    sourceErrors.push({ source: 'sync-queue', message: err.message });
  }
  return entries;
}

async function _collectSyncReviews(sourceErrors) {
  const entries = [];
  try {
    const syncReviewSvc = require('./syncReviewService');
    const reviews       = await syncReviewSvc.getReviews();
    for (const review of Object.values(reviews)) {
      entries.push({
        id:         `sr-${review.jobId}`,
        timestamp:  review.reviewedAt || null,
        type:       'sync-review',
        status:     'reviewed',
        title:      'Sync Issue Reviewed',
        message:    review.reason ? String(review.reason).slice(0, 120) : 'Acknowledged',
        operator:   null,
        deviceName: review.deviceName || null,
        source:     'sync-reviews',
      });
    }
  } catch (err) {
    sourceErrors.push({ source: 'sync-reviews', message: err.message });
  }
  return entries;
}

function _collectInMemory(sourceErrors) {
  const entries = [];

  try {
    const diagSvc = require('./archiveDiagnosticsService');
    const status  = diagSvc.getDiagnosticsStatus();
    if (status.completedAt) {
      const r  = status.result || {};
      const st = r.errors > 0 ? 'failed' : r.warnings > 0 ? 'warning' : 'success';
      entries.push({
        id:         `diag-${status.completedAt}`,
        timestamp:  status.completedAt,
        type:       'diagnostics',
        status:     st,
        title:      'Diagnostics Run',
        message:    `${r.errors ?? 0} error${r.errors !== 1 ? 's' : ''}, ${r.warnings ?? 0} warning${r.warnings !== 1 ? 's' : ''}`,
        operator:   null,
        deviceName: null,
        source:     'diagnostics',
      });
    }
  } catch (err) {
    sourceErrors.push({ source: 'diagnostics', message: err.message });
  }

  try {
    const conSvc = require('./archiveConsistencyService');
    const report = conSvc.getLastReport();
    if (report?.generatedAt && !report.busy) {
      entries.push({
        id:         `cr-${report.generatedAt}`,
        timestamp:  report.generatedAt,
        type:       'consistency-report',
        status:     (report.sectionErrors?.length ?? 0) > 0 ? 'warning' : 'info',
        title:      'Consistency Report',
        message:    report.sectionErrors?.length
                      ? `Generated — ${report.sectionErrors.length} section(s) unavailable`
                      : 'Generated',
        operator:   null,
        deviceName: null,
        source:     'consistency-report',
      });
    }
  } catch (err) {
    sourceErrors.push({ source: 'consistency-report', message: err.message });
  }

  try {
    const clSvc = require('./archiveCompletenessService');
    const cl    = clSvc.getLastChecklist();
    if (cl?.generatedAt && !cl.busy) {
      const st = cl.readiness === 'blocked'         ? 'failed'
               : cl.readiness === 'needs-attention' ? 'warning'
               : 'success';
      entries.push({
        id:         `cl-${cl.generatedAt}`,
        timestamp:  cl.generatedAt,
        type:       'completeness-checklist',
        status:     st,
        title:      'Completeness Checklist',
        message:    `Readiness: ${cl.readiness ?? 'unknown'}${cl.summary ? ` — ${cl.summary.fail ?? 0} fail, ${cl.summary.warning ?? 0} warn` : ''}`,
        operator:   null,
        deviceName: null,
        source:     'completeness-checklist',
      });
    }
  } catch (err) {
    sourceErrors.push({ source: 'completeness-checklist', message: err.message });
  }

  return entries;
}

// ── Assembler ──────────────────────────────────────────────────────────────────

function _sortAndCap(entries) {
  return entries
    .filter(e => e.timestamp)
    .sort((a, b) => {
      if (b.timestamp > a.timestamp) return  1;
      if (b.timestamp < a.timestamp) return -1;
      return 0;
    })
    .slice(0, MAX_ENTRIES);
}

// ── Public API ─────────────────────────────────────────────────────────────────

let _lastTimeline = null;
let _inFlight     = false;

/**
 * Generate a fresh audit timeline.
 * Reads existing audit logs and in-memory service state.
 * Does not mutate any file or service state.
 *
 * @returns {Promise<object>}
 */
async function generateTimeline() {
  if (_inFlight) return _lastTimeline || { generatedAt: new Date().toISOString(), busy: true };
  _inFlight = true;
  try {
    const settings = require('./settings');
    const txRoot   = settings.getTransferRoot();
    const mainRoot = settings.getMainArchiveRoot();

    const sourceErrors = [];
    const [exportEntries, importEntries, queueEntries, reviewEntries] = await Promise.all([
      _collectTransferExports(txRoot,   sourceErrors),
      _collectTransferImports(mainRoot, sourceErrors),
      _collectSyncQueue(sourceErrors),
      _collectSyncReviews(sourceErrors),
    ]);
    const inMemEntries = _collectInMemory(sourceErrors);

    const entries = _sortAndCap([
      ...exportEntries,
      ...importEntries,
      ...queueEntries,
      ...reviewEntries,
      ...inMemEntries,
    ]);

    const timeline = {
      generatedAt:  new Date().toISOString(),
      sourceErrors,
      entryCount:   entries.length,
      entries,
    };
    _lastTimeline = timeline;
    _inFlight     = false;
    return timeline;

  } catch (err) {
    console.error('[AuditTimeline] generateTimeline failed:', err.message);
    const timeline = {
      generatedAt:  new Date().toISOString(),
      error:        err.message,
      sourceErrors: [],
      entryCount:   0,
      entries:      [],
    };
    _lastTimeline = timeline;
    _inFlight     = false;
    return timeline;
  }
}

/**
 * Return the last generated timeline, or null if none generated this session.
 * Synchronous — safe to call before generateTimeline().
 *
 * @returns {object|null}
 */
function getLastTimeline() {
  return _lastTimeline;
}

module.exports = { generateTimeline, getLastTimeline };
