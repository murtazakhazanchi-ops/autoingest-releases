'use strict';

/**
 * metadataRepairService.js — safe repair operation (plan §10). Consumes a
 * metadataAuditService job's frozen per-file snapshot ONLY — never calls the
 * resolver again. A staleness guard (current file size/mtime vs. the snapshot
 * captured at audit time) runs before any write; drifted files are excluded with
 * a "re-audit required" note, never silently re-resolved or force-written.
 *
 * Execution writes through exifService.resumeFrozenFile — the same frozen-write
 * path Phase C's crash recovery uses — so repair is just another kind of batch
 * through the one shared apply engine and the one shared durable manifest+journal
 * mechanism (metadataQueueStore), not a parallel reinvention of either.
 */

const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const exifService = require('./exifService');
const queueStore = require('./metadataQueueStore');
const metadataStateService = require('./metadataStateService');
const { buildFileEvidence } = require('../services/eventEvidenceReconstruction');

const REPAIRABLE_STATUSES = new Set(['partial', 'read-error']);
const REPAIR_CONCURRENCY = 3;

// Tracks the last time previewMetadataRepair was generated for a given auditJobId,
// IN THIS PROCESS'S LIFETIME ONLY (not persisted — cleared on restart). This is
// honest, real evidence ("preview was generated for this job before this repair
// ran, in this session") — it deliberately does NOT claim to prove the operator's
// exact UI click-through, since the current UI has no preview-session identifier
// that survives the round trip to runMetadataRepair. See runMetadataRepair's result
// report: `previewedInThisSession` reflects exactly and only this map, and
// `previewGeneratedAt` is null (not fabricated) when no entry exists — e.g. repair
// triggered without ever previewing in this process's lifetime, or after a restart.
const _lastPreviewByAuditJob = new Map();

// Mirrors metadataAuditService's `_active` single-job guard. Without this, two
// concurrent runMetadataRepair calls (retried IPC, a bypassed button-disable, two
// renderer windows) would each independently build their own file list and queue
// writes for the same destination files through the shared ExifTool pool — currently
// benign only because every write path resolves the identical frozen expectation for
// a given file (idempotent by construction), but nothing should rely on that as the
// only line of defense against a genuine double-run.
let _repairRunning = false;

function _resultDir() {
  if (process.env.AUTOINGEST_METADATA_REPAIR_DIR) return process.env.AUTOINGEST_METADATA_REPAIR_DIR;
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'metadata-repair-results');
}

async function _readAuditRecords(auditJobId, jobStatePathFn, reportPathFn) {
  const readline = require('readline');
  const fs = require('fs');
  let state;
  try { state = JSON.parse(await fsp.readFile(jobStatePathFn(auditJobId), 'utf8')); }
  catch { return null; }

  const records = [];
  const rl = readline.createInterface({ input: fs.createReadStream(reportPathFn(auditJobId)), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { /* corrupt line — skip, preview is best-effort over a read-only report */ }
  }
  return { state, records };
}

async function _staleCheck(record) {
  if (!record.verifyPath) return { stale: false };
  let st;
  try { st = await fsp.stat(record.verifyPath); }
  catch {
    // Sidecar didn't exist at audit time either → not a drift, it's the expected repair target.
    if (!record.snapshot || record.snapshot.size == null) return { stale: false };
    return { stale: true, staleReason: 're-audit required: file no longer exists' };
  }
  const snap = record.snapshot;
  if (!snap || snap.size == null) {
    // Existed now but not at audit time — something else wrote it since. Don't
    // silently overwrite unknown external changes without a fresh audit.
    return { stale: true, staleReason: 're-audit required: file appeared since the audit ran' };
  }
  if (st.size !== snap.size || st.mtimeMs !== snap.mtimeMs) {
    return { stale: true, staleReason: 're-audit required: file changed since the audit ran' };
  }
  return { stale: false };
}

function _proposedFields(record) {
  const changes = [];
  if (record.fields) {
    for (const [field, diff] of Object.entries(record.fields)) {
      if (diff.status !== 'match') changes.push({ field, from: diff.actual, to: diff.expected, reason: diff.status });
    }
  }
  if (record.keywords && !record.keywords.compliant) {
    changes.push({
      field: 'keywords', from: record.keywords.actual, to: record.keywords.expected,
      reason: 'missing/unexpected/duplicate', detail: {
        missing: record.keywords.missing, unexpected: record.keywords.unexpected,
        duplicates: record.keywords.duplicates, caseVariants: record.keywords.caseVariants,
        whitespaceVariants: record.keywords.whitespaceVariants,
      },
    });
  }
  return changes;
}

/**
 * Exhaustive per-file preview — no writes. `ambiguous`/`complete`/`excluded` audit
 * records are never included (repairable set is exactly `partial`+`read-error`).
 * @param {string} auditJobId
 * @returns {Promise<{ok:boolean, items?:object[], reason?:string}>}
 */
async function previewMetadataRepair(auditJobId) {
  const audit = require('../services/metadataAuditService');
  const loaded = await _readAuditRecords(auditJobId, audit._statePath, audit._reportPath);
  if (!loaded) return { ok: false, reason: 'audit-job-not-found' };

  const items = [];
  for (const record of loaded.records) {
    if (!REPAIRABLE_STATUSES.has(record.status)) continue;
    const { stale, staleReason } = await _staleCheck(record);
    items.push({
      filePath: record.filePath, eventFolderPath: record.eventFolderPath, isRaw: record.isRaw,
      verifyPath: record.verifyPath, proposedAction: stale ? 'skip-stale' : 'write',
      stale, staleReason: staleReason || null,
      fieldsToChange: stale ? [] : _proposedFields(record),
    });
  }
  _lastPreviewByAuditJob.set(auditJobId, { previewGeneratedAt: new Date().toISOString(), itemCount: items.length });
  return { ok: true, items };
}

/**
 * Executes repair for a previously previewed audit job. Writes a durable manifest
 * before any file is touched (queued/interrupted-safe via the existing
 * metadataQueueRecovery.js resume path — a repair batch is indistinguishable from
 * any other queued batch to that machinery). `ambiguous` and stale-since-audit files
 * are never queued.
 *
 * The returned `result` (and the durably-persisted copy `getMetadataRepairResult`
 * returns) carries traceability fields: `snapshotIdentity` (auditJobId + the archive
 * root identity/contract/resolver versions the audit recorded at scan time — repair
 * never re-resolves, so this IS the ground truth the write decisions trace back to),
 * `startedAt`/`completedAt`, `approved`/`stale`/`eventUnreadable`/`written` counts,
 * and `previewGeneratedAt`/`previewedInThisSession`. The preview-linkage fields are
 * honest, not fabricated: `previewedInThisSession` is true only if
 * `previewMetadataRepair` was actually called for this exact `auditJobId` earlier in
 * this same process's lifetime (tracked in `_lastPreviewByAuditJob`, not persisted
 * across restarts) — it does not and cannot prove which UI session/click-through
 * produced that preview, since the current UI has no preview-session identifier that
 * survives the round trip to this function.
 * @param {string} auditJobId
 * @returns {Promise<{ok:boolean, batchId?:string, reason?:string, result?:object}>}
 */
async function runMetadataRepair(auditJobId) {
  if (_repairRunning) return { ok: false, reason: 'busy' };
  _repairRunning = true;
  try {
    return await _runMetadataRepairInner(auditJobId);
  } finally {
    _repairRunning = false;
  }
}

async function _runMetadataRepairInner(auditJobId) {
  const startedAt = new Date().toISOString();
  const audit = require('../services/metadataAuditService');
  const loaded = await _readAuditRecords(auditJobId, audit._statePath, audit._reportPath);
  if (!loaded) return { ok: false, reason: 'audit-job-not-found' };

  const preview = _lastPreviewByAuditJob.get(auditJobId) || null;

  const eventJsonCache = new Map();
  const filesByEvent = new Map(); // eventFolderPath -> manifest file entries

  // Diagnostic counts (item #7 traceability) — kept distinct so the operator can
  // see WHY a file didn't get repaired, not just that it didn't.
  let approvedCount = 0;        // repairable per the audit (what preview would show)
  let staleCount = 0;           // approved, but drifted since the audit ran
  let eventUnreadableCount = 0; // approved + not stale, but its event.json couldn't be read

  for (const record of loaded.records) {
    if (!REPAIRABLE_STATUSES.has(record.status)) continue;
    approvedCount++;
    const { stale } = await _staleCheck(record);
    if (stale) { staleCount++; continue; }

    if (!eventJsonCache.has(record.eventFolderPath)) {
      let doc = null;
      try { doc = JSON.parse(await fsp.readFile(path.join(record.eventFolderPath, 'event.json'), 'utf8')); } catch { /* event.json unreadable — skip this event's files below */ }
      eventJsonCache.set(record.eventFolderPath, doc);
    }
    const liveEventJson = eventJsonCache.get(record.eventFolderPath);
    if (!liveEventJson) { eventUnreadableCount++; continue; }

    const entry = {
      src: record.filePath, dest: record.filePath,
      relDestPath: path.relative(record.eventFolderPath, record.filePath),
      size: record.snapshot?.size ?? null, isRaw: record.isRaw, isVideo: false,
      evidence: buildFileEvidence(record.eventFolderPath, liveEventJson, record.filePath),
      expectation: record.expectation,
    };
    if (!filesByEvent.has(record.eventFolderPath)) filesByEvent.set(record.eventFolderPath, []);
    filesByEvent.get(record.eventFolderPath).push(entry);
  }

  const allFiles = [...filesByEvent.values()].flat();
  // Snapshot identity: what this repair run's decisions are traceable back to —
  // the exact audit job, the archive-root identity and contract/resolver versions
  // that job recorded at scan time (not re-read live, since the whole point of the
  // frozen-snapshot design is that repair never re-resolves against current state).
  const snapshotIdentity = {
    auditJobId,
    archiveRootIdentity: loaded.state.archiveRootIdentity || null,
    metadataContractVersion: loaded.state.metadataContractVersion ?? null,
    resolverVersion: loaded.state.resolverVersion ?? null,
  };
  const traceability = {
    snapshotIdentity,
    previewGeneratedAt: preview?.previewGeneratedAt ?? null,
    // True only if previewMetadataRepair was called for this exact auditJobId at
    // least once earlier in this same process's lifetime — real evidence, not a
    // fabricated link. Does NOT prove which UI session/click-through produced it;
    // the current UI has no preview-session identifier that survives the round
    // trip to runMetadataRepair (see this module's _lastPreviewByAuditJob comment
    // and the project's closure-review item #7 for the honestly-documented gap).
    previewedInThisSession: preview !== null,
    startedAt,
    approved: approvedCount, stale: staleCount, eventUnreadable: eventUnreadableCount,
  };

  if (allFiles.length === 0) {
    return { ok: true, batchId: null, reason: 'nothing-to-repair', ...traceability, written: 0, completedAt: new Date().toISOString() };
  }

  // One manifest+batch PER EVENT, not one combined multi-event manifest — Phase C's
  // crash-recovery (metadataQueueRecovery.js) keys its state-persist-then-compact
  // ordering off a single manifest.eventJsonPath. A multi-event manifest would leave
  // that field ambiguous/null, silently skipping durable state persistence for every
  // affected event if this run were interrupted and later resumed by that machinery.
  const runId = `repair-${auditJobId}-${crypto.randomBytes(4).toString('hex')}`;
  const { METADATA_CONTRACT_VERSION, RESOLVER_VERSION } = require('../services/metadataExpectationService');
  const results = [];
  const batchIds = [];

  for (const [eventFolderPath, files] of filesByEvent) {
    const eventJsonPath = path.join(eventFolderPath, 'event.json');
    const batchId = `${runId}-${crypto.randomBytes(3).toString('hex')}`;
    batchIds.push(batchId);

    await queueStore.writeManifestOnce(batchId, {
      schemaVersion: 1, batchId,
      metadataContractVersion: METADATA_CONTRACT_VERSION, resolverVersion: RESOLVER_VERSION,
      archiveRootIdentity: loaded.state.archiveRootIdentity, eventJsonPath,
      sourceAuditJobId: auditJobId, queuedAt: new Date().toISOString(), files,
    });

    let idx = 0;
    async function worker() {
      while (idx < files.length) {
        const i = idx++;
        const f = files[i];
        const r = await exifService.resumeFrozenFile(batchId, { dest: f.dest, isRaw: f.isRaw, expectation: f.expectation });
        results.push({ dest: f.dest, eventFolderPath, ...r });
      }
    }
    await Promise.all(Array.from({ length: Math.min(REPAIR_CONCURRENCY, files.length) }, worker));

    try {
      await metadataStateService.persistEventMetadataState(eventJsonPath);
    } catch (err) {
      console.error(`[metadataRepairService] Failed to persist metadata state for ${eventJsonPath}: ${err.message}`);
      continue; // do not compact — event.json doesn't durably reflect this batch yet, matching metadataQueueRecovery.js's own rule.
    }
    await queueStore.compactBatch(batchId).catch(() => {});
  }

  const resultReport = {
    runId, sourceAuditJobId: auditJobId, batchIds, completedAt: new Date().toISOString(),
    ...traceability,
    total: allFiles.length, written: allFiles.length,
    complete: results.filter(r => r.classification === 'complete').length,
    partial: results.filter(r => r.classification === 'partial').length,
    failed: results.filter(r => r.classification === 'failed').length,
    results,
  };
  await fsp.mkdir(_resultDir(), { recursive: true });
  // Temp-then-rename, matching every other durable state writer in this subsystem
  // (eventJsonStore, metadataQueueStore, metadataAuditService) — a crash mid-write
  // must never leave a truncated/invalid result report on disk.
  const resultPath = path.join(_resultDir(), `${runId}.json`);
  const tmpPath = resultPath + '.tmp';
  await fsp.writeFile(tmpPath, JSON.stringify(resultReport, null, 2), 'utf8');
  await fsp.rename(tmpPath, resultPath);

  return { ok: true, batchId: runId, result: resultReport };
}

async function getMetadataRepairResult(batchId) {
  try { return JSON.parse(await fsp.readFile(path.join(_resultDir(), `${batchId}.json`), 'utf8')); }
  catch { return null; }
}

module.exports = { previewMetadataRepair, runMetadataRepair, getMetadataRepairResult };
