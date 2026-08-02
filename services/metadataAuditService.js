'use strict';

/**
 * metadataAuditService.js — read-only, streaming, resumable metadata compliance
 * scanner (plan §9). Never writes a file, never calls an ExifTool write operation.
 *
 * Job-state pattern mirrors archiveDiagnosticsService.js (jobId / poll-status /
 * fetch-report), extended for archive scale:
 *  - report records stream to a JSONL file under userData as they're produced —
 *    never accumulated fully in memory.
 *  - a small state.json is rewritten (atomically) only at EVENT boundaries — the
 *    cursor commits after every file belonging to that event has had its record
 *    durably appended, so a resume never re-emits a duplicate record for an event
 *    that fully completed, and at worst re-scans (harmless — read-only, idempotent)
 *    the one event that was in flight when the process stopped.
 *  - the scanOrder (deterministic, lexicographic-by-path event list) is frozen at
 *    job start and never silently extended on resume — new events added to the
 *    archive after a job started are out of that job's scope by design; a cheap
 *    structural check flags (not fixes) a changed scope in the final report.
 */

const fsp    = require('fs/promises');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const config = require('../config/app.config');
const exifService = require('../main/exifService');
const { resolveExpectedMetadata, METADATA_CONTRACT_VERSION, RESOLVER_VERSION } = require('./metadataExpectationService');
const { buildFileEvidence } = require('./eventEvidenceReconstruction');
const queueStore = require('../main/metadataQueueStore');

const CANDIDATE_EXTENSIONS = new Set([...config.PHOTO_EXTENSIONS, ...exifService.VIDEO_EXTENSIONS]);
const _SKIP_DIRS = new Set(['.autoingest', '.autoingest-transfer', '__MACOSX', '_Selected']);

const APP_VERSION = (() => {
  try { return require('../package.json').version || null; } catch { return null; }
})();

function _auditRootDir() {
  if (process.env.AUTOINGEST_METADATA_AUDIT_DIR) return process.env.AUTOINGEST_METADATA_AUDIT_DIR;
  const { app } = require('electron');
  return path.join(app.getPath('userData'), 'metadata-audit');
}

function _jobDir(jobId) {
  return path.join(_auditRootDir(), jobId);
}

function _statePath(jobId) {
  return path.join(_jobDir(jobId), 'state.json');
}

function _reportPath(jobId) {
  return path.join(_jobDir(jobId), 'report.jsonl');
}

async function _atomicWriteJson(filePath, data) {
  const tmp = filePath + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, filePath);
}

// ── Single-active-job state (module scope; durable state lives in state.json) ──

let _active = { jobId: null, cancelled: false };

// ── Field / keyword diff (plan §8) ──────────────────────────────────────────────

function _norm1(v) {
  if (v === undefined || v === null) return '';
  return String(Array.isArray(v) ? (v[0] ?? '') : v).trim();
}

/**
 * @returns {{expected:string, actual:string, status:'match'|'missing'|'incorrect'|'unexpected'}}
 */
function _fieldDiff(expected, actual) {
  const e = (expected || '').trim();
  const a = _norm1(actual);
  if (!e) return { expected: e, actual: a, status: a ? 'unexpected' : 'match' };
  if (!a) return { expected: e, actual: a, status: 'missing' };
  return { expected: e, actual: a, status: e === a ? 'match' : 'incorrect' };
}

/**
 * Duplicate/case/whitespace-aware keyword diff (plan §8) — retains the original
 * actual array (not just a normalized set), so a keyword written twice is visible
 * even though the set of distinct values is otherwise fully correct.
 */
function _keywordDiff(expectedKeywords, actualRaw) {
  const expected = Array.isArray(expectedKeywords) ? expectedKeywords : [];
  const actual = actualRaw === undefined || actualRaw === null
    ? []
    : (Array.isArray(actualRaw) ? actualRaw : [actualRaw]).map(v => String(v));

  const expectedFreq = new Map();
  for (const k of expected) expectedFreq.set(k, (expectedFreq.get(k) || 0) + 1);
  const actualFreq = new Map();
  for (const k of actual) actualFreq.set(k, (actualFreq.get(k) || 0) + 1);

  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);

  const missing = [];
  const caseVariants = [];
  const whitespaceVariants = [];
  // A physical actual token, once matched as SOME expected key's variant, must not
  // also satisfy a different expected key — e.g. expected ['Ahmed','AHMED'] against
  // actual ['ahmed'] must report one variant match + one missing, never two variant
  // matches off the same single token.
  const consumedActualTokens = new Set();
  for (const k of expectedSet) {
    if (actualSet.has(k)) continue;
    const normK = k.trim().toLowerCase();
    const variant = actual.find(a => a !== k && !consumedActualTokens.has(a) && a.trim().toLowerCase() === normK);
    if (variant) {
      consumedActualTokens.add(variant);
      if (variant.trim() !== variant) whitespaceVariants.push({ expected: k, actual: variant });
      else caseVariants.push({ expected: k, actual: variant });
    } else {
      missing.push(k);
    }
  }

  const consumedAsVariant = new Set([...caseVariants, ...whitespaceVariants].map(v => v.actual));
  const unexpected = [];
  for (const a of actualSet) {
    if (!expectedSet.has(a) && !consumedAsVariant.has(a)) unexpected.push(a);
  }

  const duplicates = [];
  for (const [k, count] of actualFreq) {
    if ((expectedFreq.get(k) || 0) <= 1 && count > 1) duplicates.push({ keyword: k, count });
  }

  const compliant = missing.length === 0 && unexpected.length === 0
    && duplicates.length === 0 && caseVariants.length === 0 && whitespaceVariants.length === 0;

  return { expected, actual, missing, unexpected, duplicates, caseVariants, whitespaceVariants, compliant };
}

// ── Per-file classification (read-only) ─────────────────────────────────────────

/**
 * @returns {Promise<object>} one audit record. Never throws — read/parse failures
 *   are captured as status:'read-error' on the record itself.
 */
async function classifyOneFile(eventFolderPath, eventJson, filePath) {
  const { isRaw, isVideo, verifyPath } = exifService.classifyForVerification(filePath);
  const base = {
    filePath, eventFolderPath, fileType: path.extname(filePath).toLowerCase(), isRaw, isVideo,
  };

  if (isVideo) {
    return { ...base, status: 'excluded', photographer: null, component: null, fields: null, keywords: null, error: null, ambiguityReason: null, evidenceSource: null };
  }

  const evidence = buildFileEvidence(eventFolderPath, eventJson, filePath);
  const expectation = resolveExpectedMetadata(evidence);

  if (expectation.status === 'ambiguous') {
    return {
      ...base, status: 'ambiguous', photographer: null, component: null, fields: null, keywords: null,
      error: null, ambiguityReason: expectation.ambiguityReason, evidenceSource: expectation.evidenceSource || null,
    };
  }

  // Snapshot of the file repair would actually write to (the sidecar for RAW, the
  // file itself otherwise), captured at audit time — repair's staleness guard compares
  // against this, never against a re-read at repair time (which could itself have
  // drifted further between preview and execution).
  let snapshot = { size: null, mtimeMs: null };
  let sidecarExists = true;
  try {
    const st = await fsp.stat(verifyPath);
    snapshot = { size: st.size, mtimeMs: st.mtimeMs };
  } catch { sidecarExists = false; }

  let actual = {};
  if (sidecarExists) {
    try {
      actual = await exifService.readFileTags(verifyPath);
    } catch (err) {
      return {
        ...base, status: 'read-error', photographer: expectation.photographer, component: expectation.component?.folderName || null,
        fields: null, keywords: null, error: err.message, ambiguityReason: null, evidenceSource: expectation.evidenceSource || null,
        // A read-error is on the SIDECAR read, not the expectation resolve — repair can
        // still retry writing this file's already-resolved frozen expectation.
        expectation, verifyPath, snapshot,
      };
    }
  }

  const fields = {
    photographer: _fieldDiff(expectation.photographer, actual.Creator ?? actual['XMP-dc:Creator']),
    description:  _fieldDiff(expectation.eventDescription, actual.Description ?? actual['XMP-dc:Description']),
    location:     _fieldDiff(expectation.component?.location || '', actual.Location ?? actual['XMP-iptcCore:Location']),
    city:         _fieldDiff(expectation.component?.city || '', actual.City ?? actual['XMP-photoshop:City']),
    country:      _fieldDiff(expectation.component?.country || '', actual.Country ?? actual['XMP-photoshop:Country']),
    copyright:    _fieldDiff(expectation.copyright, actual.Rights ?? actual['XMP-dc:Rights']),
    hijriDate:    _fieldDiff(expectation.hijriDate || '', actual.HijriDate ?? actual['XMP-ajs:HijriDate']),
  };
  const keywords = _keywordDiff(expectation.keywords, actual.Subject ?? actual['XMP-dc:Subject']);

  const allFieldsMatch = Object.values(fields).every(f => f.status === 'match');
  const status = (allFieldsMatch && keywords.compliant) ? 'complete' : 'partial';

  return {
    ...base, status, photographer: expectation.photographer, component: expectation.component?.folderName || null,
    fields, keywords, error: null, ambiguityReason: null, evidenceSource: expectation.evidenceSource || null,
    // Repair (Phase F) consumes exactly this frozen expectation — never re-resolved.
    expectation, verifyPath, snapshot,
  };
}

// ── Deterministic enumeration ────────────────────────────────────────────────────

async function _listDirs(dirPath) {
  let entries;
  try { entries = await fsp.readdir(dirPath, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !_SKIP_DIRS.has(e.name))
    .map(e => e.name)
    .sort();
}

async function _hasEventJson(dirPath) {
  try { await fsp.access(path.join(dirPath, 'event.json')); return true; } catch { return false; }
}

/**
 * Deterministic (lexicographic), stable event-folder enumeration for a scope.
 * @param {{type:'archiveRoot'|'collection'|'event', rootPath:string}} scope
 * @returns {Promise<string[]>} absolute event folder paths, sorted.
 */
async function enumerateEvents(scope) {
  if (scope.type === 'event') {
    return (await _hasEventJson(scope.rootPath)) ? [scope.rootPath] : [];
  }
  if (scope.type === 'collection') {
    const out = [];
    for (const name of await _listDirs(scope.rootPath)) {
      const p = path.join(scope.rootPath, name);
      if (await _hasEventJson(p)) out.push(p);
    }
    return out.sort();
  }
  // archiveRoot: collection → event (never recurse deeper), mirrors archiveDiagnosticsService.
  const out = [];
  for (const collName of await _listDirs(scope.rootPath)) {
    const collPath = path.join(scope.rootPath, collName);
    for (const evName of await _listDirs(collPath)) {
      const evPath = path.join(collPath, evName);
      if (await _hasEventJson(evPath)) out.push(evPath);
    }
  }
  return out.sort();
}

/**
 * Deterministic (lexicographic), recursive media-file enumeration within one event
 * folder. Skips sidecar .xmp files themselves (read as part of their RAW sibling's
 * verifyPath, never iterated as standalone items) and non-media files.
 */
async function enumerateFiles(eventFolderPath) {
  const out = [];
  async function walk(dir) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name.startsWith('.') || _SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { await walk(full); continue; }
      if (!e.isFile()) continue;
      if (CANDIDATE_EXTENSIONS.has(path.extname(e.name).toLowerCase())) out.push(full);
    }
  }
  await walk(eventFolderPath);
  return out.sort();
}

// ── Aggregation ───────────────────────────────────────────────────────────────

function _newAggregates() {
  return { byEvent: {}, byPhotographer: {}, byComponent: {}, byFileType: {}, byFailureCategory: {} };
}

function _bump(bucket, key, status) {
  if (!key) key = '(unattributed)';
  if (!bucket[key]) bucket[key] = { total: 0, complete: 0, partial: 0, ambiguous: 0, 'read-error': 0, excluded: 0 };
  bucket[key].total++;
  bucket[key][status] = (bucket[key][status] || 0) + 1;
}

function _accumulate(aggregates, record, eventFolderPath) {
  _bump(aggregates.byEvent, eventFolderPath, record.status);
  _bump(aggregates.byPhotographer, record.photographer, record.status);
  _bump(aggregates.byComponent, record.component, record.status);
  _bump(aggregates.byFileType, record.fileType, record.status);
  if (record.status === 'partial') {
    const reasons = [];
    if (record.fields) for (const [k, v] of Object.entries(record.fields)) if (v.status !== 'match') reasons.push(k);
    if (record.keywords && !record.keywords.compliant) reasons.push('keywords');
    for (const r of reasons) _bump(aggregates.byFailureCategory, r, record.status);
  } else if (record.status === 'ambiguous' || record.status === 'read-error') {
    _bump(aggregates.byFailureCategory, record.status, record.status);
  }
}

// ── Archive-root identity (reused marker mechanism, per plan §5) ───────────────

async function _archiveRootIdentity(rootPath) {
  return queueStore.readRootIdentity(path.join(rootPath, '.autoingest', 'root', 'archive-root.json'));
}

// ── Job orchestration ────────────────────────────────────────────────────────────

async function _flushState(jobId, state) {
  await _atomicWriteJson(_statePath(jobId), state);
}

// Bounded concurrency for per-file classification WITHIN one event. Each file does
// one ExifTool read (classifyOneFile → exifService.readFileTags) through the shared
// singleton pool (maxProcs:4) — the scan was previously fully serial (one file at a
// time), leaving 3 of 4 ExifTool processes idle throughout an entire audit run
// (measured: ~8.8 files/sec serial against real tagged fixtures, projecting ~15.7
// hours for 500,000 photos). 3 leaves headroom for the write-side's own concurrency
// (exifService's MAX_CONCURRENCY=2) to keep making progress if an import/repair batch
// is running at the same time as an audit. Concurrent classifyOneFile calls are safe:
// each only reads (never writes), reportStream.write() is called with one complete
// JSON line per call (Node's stream write queue never interleaves partial writes),
// and state.scannedCount/exceptionCount/aggregates mutations are single synchronous
// statements per resolved promise — safe under Node's single-threaded event loop.
const AUDIT_FILE_CONCURRENCY = 3;

async function _classifyEventFiles(eventFolderPath, eventJson, files, reportStream, state) {
  let idx = 0;
  async function worker() {
    while (idx < files.length) {
      if (_active.cancelled) return;
      const filePath = files[idx++];
      let record;
      try {
        record = eventJson
          ? await classifyOneFile(eventFolderPath, eventJson, filePath)
          : { filePath, eventFolderPath, fileType: path.extname(filePath).toLowerCase(), isRaw: false, isVideo: false, status: 'read-error', error: 'event.json unreadable', photographer: null, component: null, fields: null, keywords: null, ambiguityReason: null, evidenceSource: null };
      } catch (err) {
        record = { filePath, eventFolderPath, fileType: path.extname(filePath).toLowerCase(), isRaw: false, isVideo: false, status: 'read-error', error: err.message, photographer: null, component: null, fields: null, keywords: null, ambiguityReason: null, evidenceSource: null };
      }

      reportStream.write(JSON.stringify(record) + '\n');
      state.scannedCount++;
      if (record.status !== 'complete' && record.status !== 'excluded') state.exceptionCount++;
      _accumulate(state.aggregates, record, eventFolderPath);
    }
  }
  await Promise.all(Array.from({ length: Math.min(AUDIT_FILE_CONCURRENCY, files.length) }, worker));
}

async function _runJob(jobId, state) {
  const reportStream = fs.createWriteStream(_reportPath(jobId), { flags: 'a' });
  try {
    for (let i = state.cursorIndex; i < state.scanOrder.length; i++) {
      if (_active.cancelled) { state.cancelled = true; break; }

      const eventFolderPath = state.scanOrder[i];
      let eventJson = null;
      try { eventJson = JSON.parse(await fsp.readFile(path.join(eventFolderPath, 'event.json'), 'utf8')); } catch { /* unreadable event.json — files below will read-error or be skipped */ }

      const files = eventJson ? await enumerateFiles(eventFolderPath) : [];
      state.totalFilesEstimate = Math.max(state.totalFilesEstimate, state.scannedCount + files.length);

      await _classifyEventFiles(eventFolderPath, eventJson, files, reportStream, state);
      if (_active.cancelled) { state.cancelled = true; break; }

      // Commit the cursor only after every file for this event is durably appended —
      // resume re-scans at worst the one event in flight when the process stopped
      // (harmless: read-only, idempotent), never omits or duplicates a completed event.
      if (!_active.cancelled) {
        state.cursorIndex = i + 1;
        await new Promise((resolve, reject) => reportStream.write('', err => err ? reject(err) : resolve()));
        await _flushState(jobId, state);
      }
    }
  } finally {
    await new Promise(resolve => reportStream.end(resolve));
  }

  state.completedAt = new Date().toISOString();
  state.running = false;
  await _flushState(jobId, state);
  _active = { jobId: null, cancelled: false };
}

/**
 * Starts a new audit job over `scope`. Only one job may run at a time.
 * @param {{type:'archiveRoot'|'collection'|'event', rootPath:string, label?:string}} scope
 * @returns {Promise<{ok:boolean, jobId?:string, reason?:string}>}
 */
async function runMetadataAudit(scope) {
  if (_active.jobId) return { ok: false, reason: 'busy' };
  if (!scope || !scope.rootPath) return { ok: false, reason: 'invalid-scope' };

  const jobId = crypto.randomBytes(6).toString('hex');
  await fsp.mkdir(_jobDir(jobId), { recursive: true });

  const scanOrder = await enumerateEvents(scope);
  const archiveRootIdentity = await _archiveRootIdentity(scope.rootPath).catch(() => null);

  const state = {
    schemaVersion: 1, jobId, scope, scanOrder, cursorIndex: 0,
    scannedCount: 0, totalFilesEstimate: 0, exceptionCount: 0,
    aggregates: _newAggregates(),
    metadataContractVersion: METADATA_CONTRACT_VERSION, resolverVersion: RESOLVER_VERSION,
    appVersion: APP_VERSION, archiveRootIdentity,
    startedAt: new Date().toISOString(), completedAt: null,
    running: true, cancelled: false, resumedOverChangedScope: false,
  };
  await _flushState(jobId, state);

  _active = { jobId, cancelled: false };
  _runJob(jobId, state).catch(async (err) => {
    state.running = false;
    state.completedAt = new Date().toISOString();
    state.error = err.message;
    await _flushState(jobId, state).catch(() => {});
    _active = { jobId: null, cancelled: false };
  });

  return { ok: true, jobId };
}

/**
 * Discards any report.jsonl records left behind by an interruption that landed
 * MID-EVENT (not at a clean event boundary) — cursorIndex only ever advances after
 * every file of an event has been durably appended, so a crash partway through an
 * event's file list leaves that event's already-scanned files recorded but
 * cursorIndex still pointing AT that event. Without this, resume would re-scan the
 * whole in-flight event from the top (by design — cheap, read-only, idempotent
 * per-file) but APPEND the fresh records on top of the stale partial ones instead
 * of replacing them, duplicating rows and double-counting scannedCount/aggregates
 * for exactly the files that were already recorded before the crash.
 *
 * Rebuilds scannedCount/exceptionCount/aggregates by replaying only the records
 * belonging to events strictly before cursorIndex (the only ones a clean boundary
 * guarantees are complete) and rewrites report.jsonl to match — a single streaming
 * pass, never fully buffered in memory, matching the rest of this module's scale
 * guarantees.
 */
async function _rebuildStateForResume(jobId, state) {
  const committedEvents = new Set(state.scanOrder.slice(0, state.cursorIndex));
  const tmpPath = _reportPath(jobId) + '.rebuild.tmp';
  const outStream = fs.createWriteStream(tmpPath);
  const aggregates = _newAggregates();
  let scannedCount = 0;
  let exceptionCount = 0;

  let reportExists = true;
  try { await fsp.access(_reportPath(jobId)); } catch { reportExists = false; }

  if (reportExists) {
    const rl = require('readline').createInterface({ input: fs.createReadStream(_reportPath(jobId)), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (!committedEvents.has(rec.eventFolderPath)) continue; // mid-event leftover — discard, will be rescanned fresh.
      outStream.write(line + '\n');
      scannedCount++;
      if (rec.status !== 'complete' && rec.status !== 'excluded') exceptionCount++;
      _accumulate(aggregates, rec, rec.eventFolderPath);
    }
  }
  await new Promise((resolve, reject) => outStream.end(err => (err ? reject(err) : resolve())));
  await fsp.rename(tmpPath, _reportPath(jobId));

  state.scannedCount = scannedCount;
  state.exceptionCount = exceptionCount;
  state.aggregates = aggregates;
}

/**
 * Resumes a previously interrupted (not-completed) job. Detects whether the scope's
 * top-level shape changed since the job started (cheap structural check — event
 * count/paths) and flags (never silently extends) if so; the frozen scanOrder from
 * the original run is always what gets completed.
 * @param {string} jobId
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
async function resumeMetadataAudit(jobId) {
  if (_active.jobId) return { ok: false, reason: 'busy' };
  let state;
  try { state = JSON.parse(await fsp.readFile(_statePath(jobId), 'utf8')); }
  catch { return { ok: false, reason: 'job-not-found' }; }
  if (state.completedAt) return { ok: false, reason: 'already-complete' };

  await _rebuildStateForResume(jobId, state);

  const currentOrder = await enumerateEvents(state.scope);
  const originalSet = new Set(state.scanOrder);
  const currentSet = new Set(currentOrder);
  const changed = currentOrder.length !== state.scanOrder.length
    || [...originalSet].some(p => !currentSet.has(p));
  state.resumedOverChangedScope = changed;
  state.running = true;
  await _flushState(jobId, state);

  _active = { jobId, cancelled: false };
  _runJob(jobId, state).catch(async (err) => {
    state.running = false;
    state.completedAt = new Date().toISOString();
    state.error = err.message;
    await _flushState(jobId, state).catch(() => {});
    _active = { jobId: null, cancelled: false };
  });

  return { ok: true };
}

function cancelMetadataAudit(jobId) {
  if (_active.jobId === jobId) { _active.cancelled = true; return { ok: true }; }
  return { ok: false, reason: 'not-running' };
}

/**
 * Cheap, poll-safe status snapshot — never reads the full JSONL report.
 */
async function getMetadataAuditStatus(jobId) {
  try {
    const state = JSON.parse(await fsp.readFile(_statePath(jobId), 'utf8'));
    return {
      jobId: state.jobId, running: state.running, cancelled: state.cancelled,
      scannedCount: state.scannedCount, totalFilesEstimate: state.totalFilesEstimate,
      exceptionCount: state.exceptionCount, eventsTotal: state.scanOrder.length,
      eventsScanned: state.cursorIndex, startedAt: state.startedAt, completedAt: state.completedAt,
      resumedOverChangedScope: state.resumedOverChangedScope || false, error: state.error || null,
    };
  } catch {
    return null;
  }
}

/**
 * Full report for a completed (or in-progress, partial) job.
 * @param {string} jobId
 * @param {{offset?:number, limit?:number, statusFilter?:string}} [opts] Paging —
 *   reads only the requested slice of the JSONL file, never the whole file into
 *   memory for large archives.
 */
async function getMetadataAuditReport(jobId, opts = {}) {
  const { offset = 0, limit = 200, statusFilter = null } = opts;
  let state;
  try { state = JSON.parse(await fsp.readFile(_statePath(jobId), 'utf8')); }
  catch { return null; }

  const items = [];
  let skipped = 0;
  let matched = 0;
  const corrupt = [];
  const rl = require('readline').createInterface({ input: fs.createReadStream(_reportPath(jobId)), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec;
    // Matches metadataQueueStore.readJournal's posture for the same failure class
    // (a torn/partial trailing line from a crash mid-write): quarantine and log,
    // never silently drop — a corrupt row disappearing from an archival audit report
    // with no trace is itself a data-integrity concern, not just a parse nuisance.
    try { rec = JSON.parse(line); } catch { corrupt.push(line); continue; }
    if (statusFilter && rec.status !== statusFilter) continue;
    matched++;
    if (skipped < offset) { skipped++; continue; }
    if (items.length < limit) items.push(rec);
  }
  if (corrupt.length > 0) {
    const quarantinePath = _reportPath(jobId) + '.quarantine';
    try {
      await fsp.appendFile(
        quarantinePath,
        corrupt.map(l => JSON.stringify({ quarantinedAt: new Date().toISOString(), line: l })).join('\n') + '\n',
        'utf8'
      );
    } catch { /* best-effort — quarantine failure must not block returning the good records */ }
    console.error(`[metadataAuditService] Quarantined ${corrupt.length} corrupt report line(s) for job ${jobId}`);
  }

  return {
    reportMetadata: {
      jobId: state.jobId, scope: state.scope, metadataContractVersion: state.metadataContractVersion,
      resolverVersion: state.resolverVersion, appVersion: state.appVersion,
      archiveRootIdentity: state.archiveRootIdentity, startedAt: state.startedAt, completedAt: state.completedAt,
      resumedOverChangedScope: state.resumedOverChangedScope || false,
    },
    aggregates: state.aggregates,
    counts: {
      scanned: state.scannedCount, exceptions: state.exceptionCount, totalMatchingFilter: matched,
    },
    items, offset, limit,
  };
}

module.exports = {
  runMetadataAudit, resumeMetadataAudit, cancelMetadataAudit,
  getMetadataAuditStatus, getMetadataAuditReport,
  classifyOneFile, enumerateEvents, enumerateFiles,
  _fieldDiff, _keywordDiff,
  _jobDir, _statePath, _reportPath,
};
