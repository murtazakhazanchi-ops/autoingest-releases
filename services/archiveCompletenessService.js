'use strict';

/**
 * archiveCompletenessService.js — Read-only archive completeness checklist (Phase 13D-3).
 *
 * Derives a classified checklist from the archive consistency report.
 * Produces a top-level readiness verdict and per-item status for each
 * operational concern: roots, sync, locks, transfer, adoption, diagnostics.
 *
 * Rules:
 *  - Strictly read-only. No file is created, modified, renamed, or deleted.
 *  - Does not mutate any service state.
 *  - All data derived from archiveConsistencyService — no new scans or IPC calls.
 *  - If no consistency report is cached, generates one first.
 *  - generateChecklist() never throws to the IPC layer.
 *  - Items array is scalar/lightweight — no nested event objects or file lists.
 */

// ── Item shape helpers ─────────────────────────────────────────────────────────

function _pass(id, label, category, value, message) {
  return { id, label, status: 'pass', category, value: value ?? null, message: message ?? null, recommendedAction: null };
}

function _warn(id, label, category, value, message, action) {
  return { id, label, status: 'warning', category, value: value ?? null, message: message ?? null, recommendedAction: action ?? null };
}

function _fail(id, label, category, value, message, action) {
  return { id, label, status: 'fail', category, value: value ?? null, message: message ?? null, recommendedAction: action ?? null };
}

function _na(id, label, category, message) {
  return { id, label, status: 'not-available', category, value: null, message: message ?? null, recommendedAction: null };
}

// ── Root item classifier ───────────────────────────────────────────────────────

function _rootItem(id, label, rootInfo) {
  if (!rootInfo) return _na(id, label, 'roots', null);
  switch (rootInfo.status) {
    case 'ready':
      return _pass(id, label, 'roots', null, null);
    case 'not-set':
      return _na(id, label, 'roots', 'Not configured');
    case 'not-found':
      return _fail(id, label, 'roots', null, 'Path not found — configured location is unreachable',
        'Verify or reconfigure the root path in Settings');
    case 'error':
      return _fail(id, label, 'roots', null, 'Could not access path — check connectivity or permissions',
        'Verify filesystem permissions or network connectivity');
    default:
      return _na(id, label, 'roots', null);
  }
}

// ── Checklist builder ──────────────────────────────────────────────────────────

function _buildChecklist(report) {
  const items  = [];
  const sErr   = Array.isArray(report.sectionErrors) ? report.sectionErrors : [];
  const secErr = key => sErr.some(e => e.section === key);

  // ── A. Roots ──────────────────────────────────────────────────────────────
  items.push(_rootItem('root.active',   'Active Archive Root',  report.roots?.activeArchiveRoot));
  items.push(_rootItem('root.staging',  'Local Staging Root',   report.roots?.localStagingRoot));
  items.push(_rootItem('root.main',     'Main Archive Root',    report.roots?.mainArchiveRoot));
  items.push(_rootItem('root.transfer', 'Transfer Drive Root',  report.roots?.transferDriveRoot));

  // ── B. Sync ───────────────────────────────────────────────────────────────
  if (secErr('sync')) {
    items.push(_na('sync.status', 'Sync queue', 'sync', 'Sync service could not be reached'));
  } else {
    const s = report.sync ?? { ready: 0, syncing: 0, needsAttention: 0, reviewed: 0, failed: 0, total: 0 };

    if (s.total === 0) {
      items.push(_pass('sync.empty', 'Sync queue', 'sync', 0, 'Queue is empty'));
    } else {
      if (s.ready > 0) {
        items.push(_pass('sync.ready', 'Jobs ready for sync', 'sync', s.ready,
          `${s.ready} job${s.ready !== 1 ? 's' : ''} queued`));
      }
      if (s.syncing > 0) {
        items.push(_pass('sync.active', 'Sync in progress', 'sync', s.syncing,
          `${s.syncing} job${s.syncing !== 1 ? 's' : ''} currently syncing`));
      }

      if (s.failed > 0) {
        items.push(_fail('sync.failed', 'Failed sync jobs', 'sync', s.failed,
          `${s.failed} job${s.failed !== 1 ? 's' : ''} failed`,
          'Review failed jobs in Sync & Activity'));
      } else {
        items.push(_pass('sync.failed', 'No failed sync jobs', 'sync', 0, null));
      }

      if (s.needsAttention > 0) {
        if (secErr('sync.reviews')) {
          items.push(_warn('sync.attention', 'Needs-attention jobs', 'sync', s.needsAttention,
            `${s.needsAttention} job${s.needsAttention !== 1 ? 's' : ''} need attention — review count unavailable`,
            'Check review status in Sync & Activity'));
        } else {
          const unreviewed = Math.max(0, s.needsAttention - s.reviewed);
          if (unreviewed > 0) {
            items.push(_fail('sync.unreviewed', 'Unreviewed sync issues', 'sync', unreviewed,
              `${unreviewed} needs-attention job${unreviewed !== 1 ? 's' : ''} not yet reviewed`,
              'Acknowledge needs-attention jobs in Sync & Activity'));
          } else {
            items.push(_pass('sync.unreviewed', 'All sync issues reviewed', 'sync', s.needsAttention,
              `${s.needsAttention} issue${s.needsAttention !== 1 ? 's' : ''} acknowledged`));
          }
        }
      }
    }
  }

  // ── C. Locks ──────────────────────────────────────────────────────────────
  if (secErr('locks')) {
    items.push(_na('locks.status', 'Archive locks', 'locks', 'Lock scan unavailable'));
  } else {
    const l = report.locks ?? { active: 0, stale: 0 };
    if (l.stale > 0) {
      items.push(_warn('locks.stale', 'Stale locks detected', 'locks', l.stale,
        `${l.stale} stale lock${l.stale !== 1 ? 's' : ''} found — may clear on next successful sync`, null));
    } else {
      items.push(_pass('locks.stale', 'No stale locks', 'locks', 0, null));
    }
    if (l.active > 0) {
      items.push(_pass('locks.active', 'Active locks (sync in progress)', 'locks', l.active,
        `${l.active} active lock${l.active !== 1 ? 's' : ''}`));
    }
  }
  items.push(_na('locks.tempFiles', 'Stale temp files', 'locks', 'Run diagnostics to check temp files'));

  // ── D. Transfer ───────────────────────────────────────────────────────────
  if (secErr('transfer.export') && secErr('transfer.import')) {
    items.push(_na('transfer.status', 'Transfer status', 'transfer', 'Transfer service unavailable'));
  } else {
    const ex = report.transfer?.export;
    const im = report.transfer?.import;

    if (secErr('transfer.export')) {
      items.push(_na('transfer.export', 'Transfer export', 'transfer', null));
    } else if (ex?.running) {
      items.push(_pass('transfer.export', 'Export in progress', 'transfer', null, 'Export currently running'));
    } else if (ex?.completedAt) {
      items.push(_pass('transfer.export', 'Last export completed', 'transfer', ex.completedAt, null));
    } else {
      items.push(_na('transfer.export', 'Transfer export', 'transfer', 'No export recorded this session'));
    }

    if (secErr('transfer.import')) {
      items.push(_na('transfer.import', 'Transfer import', 'transfer', null));
    } else if (im?.running) {
      items.push(_pass('transfer.import', 'Import in progress', 'transfer', null, 'Import currently running'));
    } else if (im?.completedAt) {
      items.push(_pass('transfer.import', 'Last import completed', 'transfer', im.completedAt, null));
    } else {
      items.push(_na('transfer.import', 'Transfer import', 'transfer', 'No import recorded this session'));
    }
  }

  // ── E. Adoption ───────────────────────────────────────────────────────────
  if (secErr('adoption') || secErr('events')) {
    items.push(_na('adoption.status', 'Adoption preview', 'adoption', 'Adoption data unavailable'));
  } else {
    const ev          = report.events ?? {};
    const candidates  = ev.adoptionCandidates;
    const blocked     = ev.blockedCandidates;

    if (candidates === null) {
      items.push(_na('adoption.candidates', 'Adoption candidates', 'adoption', 'No adoption scan run this session'));
    } else if (candidates > 0) {
      items.push(_warn('adoption.candidates', 'Adoption candidates pending', 'adoption', candidates,
        `${candidates} folder${candidates !== 1 ? 's' : ''} available for adoption`,
        'Review adoption candidates when ready'));
    } else {
      items.push(_pass('adoption.candidates', 'No adoption candidates pending', 'adoption', 0, null));
    }

    if (blocked !== null && blocked > 0) {
      items.push(_warn('adoption.blocked', 'Blocked adoption candidates', 'adoption', blocked,
        `${blocked} candidate${blocked !== 1 ? 's' : ''} blocked — resolve structure issues before adoption`, null));
    }
  }
  // Adopted event count is always unavailable: adoption block is stripped from nasEventCache.
  items.push(_na('adoption.adopted', 'Adopted events count', 'adoption', 'Requires NAS re-scan to determine'));

  // ── F. Diagnostics ────────────────────────────────────────────────────────
  if (secErr('diagnostics')) {
    items.push(_na('diag.status', 'Diagnostics', 'diagnostics', 'Diagnostics service unavailable'));
  } else {
    const d = report.diagnostics ?? {};
    if (!d.completedAt) {
      items.push(_na('diag.lastRun', 'Diagnostics', 'diagnostics', 'No diagnostics run this session'));
    } else {
      const errCount  = d.errors   ?? 0;
      const warnCount = d.warnings ?? 0;
      if (errCount > 0) {
        items.push(_fail('diag.errors', 'Diagnostics errors', 'diagnostics', errCount,
          `${errCount} error${errCount !== 1 ? 's' : ''} found in last run`,
          'Run diagnostics repair to resolve errors'));
      } else {
        items.push(_pass('diag.errors', 'No diagnostics errors', 'diagnostics', 0, null));
      }
      if (warnCount > 0) {
        items.push(_warn('diag.warnings', 'Diagnostics warnings', 'diagnostics', warnCount,
          `${warnCount} warning${warnCount !== 1 ? 's' : ''} found in last run`,
          'Review warnings in diagnostics report'));
      } else {
        items.push(_pass('diag.warnings', 'No diagnostics warnings', 'diagnostics', 0, null));
      }
    }
  }

  if (sErr.length > 0) {
    items.push(_warn('report.sections', 'Report section failures', 'diagnostics', sErr.length,
      `${sErr.length} section${sErr.length !== 1 ? 's' : ''} could not be loaded — some checklist items may be incomplete`,
      null));
  }

  return items;
}

// ── Readiness classifier ───────────────────────────────────────────────────────

// Items with these IDs trigger 'blocked' when they have status 'fail'.
const _CRITICAL_FAIL_IDS = new Set([
  'root.active',      // Active Archive Root configured but unreachable
  'root.main',        // Main Archive Root configured but unreachable
  'sync.failed',      // Failed sync jobs
  'sync.unreviewed',  // Unreviewed needs-attention jobs
  'diag.errors',      // Diagnostics errors found
]);

function _computeReadiness(items) {
  const hasCriticalFail = items.some(i => i.status === 'fail' && _CRITICAL_FAIL_IDS.has(i.id));
  const hasAnyFail      = items.some(i => i.status === 'fail');
  const hasAnyWarning   = items.some(i => i.status === 'warning');
  if (hasCriticalFail) return 'blocked';
  if (hasAnyFail || hasAnyWarning) return 'needs-attention';
  return 'ready';
}

// ── Public API ─────────────────────────────────────────────────────────────────

let _lastChecklist = null;
let _inFlight      = false;

/**
 * Generate a fresh completeness checklist.
 * Derives all data from archiveConsistencyService.generateReport().
 * Does not mutate any file or service state.
 *
 * @returns {Promise<object>}
 */
async function generateChecklist() {
  if (_inFlight) return _lastChecklist || { generatedAt: new Date().toISOString(), busy: true };
  _inFlight = true;
  try {
    const consistencySvc = require('./archiveConsistencyService');

    // Reuse cached report if available and not busy; otherwise generate a fresh one.
    let report = consistencySvc.getLastReport();
    if (!report || report.busy) {
      report = await consistencySvc.generateReport();
    }

    const items     = _buildChecklist(report);
    const readiness = _computeReadiness(items);
    const summary   = {
      pass:         items.filter(i => i.status === 'pass').length,
      warning:      items.filter(i => i.status === 'warning').length,
      fail:         items.filter(i => i.status === 'fail').length,
      notAvailable: items.filter(i => i.status === 'not-available').length,
    };

    const checklist = { generatedAt: new Date().toISOString(), readiness, summary, items };
    _lastChecklist  = checklist;
    _inFlight       = false;
    return checklist;

  } catch (err) {
    console.error('[CompletenessChecklist] generateChecklist failed:', err.message);
    const checklist = {
      generatedAt:  new Date().toISOString(),
      error:        err.message,
      readiness:    'blocked',
      summary:      { pass: 0, warning: 0, fail: 0, notAvailable: 0 },
      items:        [],
    };
    _lastChecklist = checklist;
    _inFlight      = false;
    return checklist;
  }
}

/**
 * Return the last generated checklist, or null if none generated this session.
 * Synchronous — safe to call before generateChecklist().
 *
 * @returns {object|null}
 */
function getLastChecklist() {
  return _lastChecklist;
}

module.exports = { generateChecklist, getLastChecklist };
